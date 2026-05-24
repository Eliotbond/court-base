/**
 * `treasurerUploadSignableDoc` — première étape de la phase trésorier d'une
 * `/licenseRequests/{id}`.
 *
 * Le trésorier uploade le formulaire fédéral pré-rempli ("signable doc") dans
 * Storage AVANT d'appeler cette callable. La callable enregistre la référence
 * et fait transiter la demande pour que le parent récupère, signe et re-uploade
 * le doc.
 *
 * Transition : `coach_validated` → `awaiting_parent_signature`.
 *
 * Auth : claim `rootAdmin` OU rôle `admin | treasurer | secretary` côté
 * `/users/{uid}`. Cf. `assertCanReviewAsTreasurer`. Même population que
 * `treasurerReviewLicenseDoc` / `validateLicenseRequest` / `confirmLicense` —
 * cohérent avec l'accès à la page `/license-requests` (admin/treasurer/
 * secretary + rootAdmin bypass).
 *
 * Validations input :
 *  - `requestId` non vide.
 *  - `storagePath` conforme à `licenseRequests/{callerUid}/{requestId}/signable.pdf`
 *    — défense en profondeur, même si Storage rules garde le path.
 *  - `fileName` non vide.
 *  - `sizeBytes` strictement positif.
 *  - `contentType === 'application/pdf'`.
 *
 * Idempotence : un re-appel avec un autre `storagePath` écrase les champs
 * `signableDoc*` (le parent retrouvera la dernière version). Pas de
 * conséquence métier — le re-uploade par le parent reste à faire.
 *
 * Region : europe-west6.
 *
 * NOTE deploy : nouvelle Function v2 → après le premier deploy, ajouter le
 * binding IAM `allUsers/run.invoker` (cf. `functions/CLAUDE.md`).
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import type {
  LicenseRequestData,
  TreasurerUploadSignableDocInput,
  TreasurerUploadSignableDocResult,
} from '@club-app/shared-types'
import { Timestamp, db } from '../dues/_helpers'
import {
  assertCanReviewAsTreasurer,
  loadCallerUser,
} from './_reviewHelpers'

interface ParsedInput {
  requestId: string
  storagePath: string
  fileName: string
  sizeBytes: number
  contentType: string
}

function parseInput(
  data: TreasurerUploadSignableDocInput | undefined,
  callerUid: string,
): ParsedInput {
  const d = (data ?? {}) as Partial<TreasurerUploadSignableDocInput>
  if (typeof d.requestId !== 'string' || d.requestId.length === 0) {
    throw new HttpsError('invalid-argument', 'requestId is required')
  }
  if (typeof d.storagePath !== 'string' || d.storagePath.length === 0) {
    throw new HttpsError('invalid-argument', 'storagePath is required')
  }
  // Convention : `licenseRequests/{callerUid}/{requestId}/signable.pdf`.
  // Défense en profondeur — Storage rules doit déjà garder le path, mais on
  // refuse un path mal formé côté serveur pour éviter qu'une UI buggée pose
  // une référence pourrie.
  const expectedPrefix = `licenseRequests/${callerUid}/${d.requestId}/`
  if (!d.storagePath.startsWith(expectedPrefix)) {
    throw new HttpsError(
      'invalid-argument',
      `storagePath must start with '${expectedPrefix}'.`,
    )
  }
  if (typeof d.fileName !== 'string' || d.fileName.length === 0) {
    throw new HttpsError('invalid-argument', 'fileName is required')
  }
  if (typeof d.sizeBytes !== 'number' || !Number.isFinite(d.sizeBytes) || d.sizeBytes <= 0) {
    throw new HttpsError('invalid-argument', 'sizeBytes must be a positive number')
  }
  if (d.contentType !== 'application/pdf') {
    throw new HttpsError(
      'invalid-argument',
      "contentType must be 'application/pdf'.",
    )
  }
  return {
    requestId: d.requestId,
    storagePath: d.storagePath,
    fileName: d.fileName,
    sizeBytes: d.sizeBytes,
    contentType: d.contentType,
  }
}

export const treasurerUploadSignableDoc = onCall(
  async (
    request: CallableRequest<TreasurerUploadSignableDocInput>,
  ): Promise<TreasurerUploadSignableDocResult> => {
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        '[treasurerUploadSignableDoc] Must be signed in.',
      )
    }
    const callerUid = request.auth.uid
    const parsed = parseInput(request.data, callerUid)

    const user = await loadCallerUser(callerUid)
    assertCanReviewAsTreasurer(request, user)

    const requestRef = db().doc(`licenseRequests/${parsed.requestId}`)

    try {
      await db().runTransaction(async (tx) => {
        const snap = await tx.get(requestRef)
        if (!snap.exists) {
          throw new HttpsError(
            'not-found',
            `[treasurerUploadSignableDoc] licenseRequest ${parsed.requestId} not found`,
          )
        }
        const lr = snap.data() as LicenseRequestData

        if (lr.status !== 'coach_validated') {
          throw new HttpsError(
            'failed-precondition',
            `[treasurerUploadSignableDoc] cannot upload signable doc in status '${lr.status}' — must be 'coach_validated'`,
          )
        }

        const now = Timestamp.now()
        tx.update(requestRef, {
          signableDocStoragePath: parsed.storagePath,
          signableDocUploadedAt: now,
          signableDocUploadedByUid: callerUid,
          status: 'awaiting_parent_signature',
        })
      })
    } catch (err) {
      if (err instanceof HttpsError) throw err
      const msg = err instanceof Error ? err.message : 'unknown'
      logger.error(`[treasurerUploadSignableDoc] transaction failed [${msg}]`, {
        err,
        requestId: parsed.requestId,
      })
      throw new HttpsError(
        'internal',
        '[treasurerUploadSignableDoc] transaction failed',
      )
    }

    logger.info('[treasurerUploadSignableDoc] ok', {
      requestId: parsed.requestId,
      callerUid,
      storagePath: parsed.storagePath,
      newStatus: 'awaiting_parent_signature',
    })

    return { newStatus: 'awaiting_parent_signature' }
  },
)
