/**
 * `treasurerConfirmSignedDoc` — confirmation par le trésorier de la conformité
 * du document signé re-uploadé par le parent.
 *
 * Transition : `parent_signed` → `form_confirmed`.
 *
 * Auth : claim `rootAdmin` OU rôle `admin | treasurer | secretary` côté
 * `/users/{uid}`. Cf. `assertCanReviewAsTreasurer`.
 *
 * Validations input :
 *  - `requestId` non vide.
 *  - `notes?` : optionnel, trim, max 500 chars. `null` / `undefined` / ''
 *    après trim = pas de modif (champ non posé dans le patch).
 *
 * Idempotence : la transition est gardée par la pré-condition `status ===
 * 'parent_signed'`. Re-appeler après transition échoue en
 * `failed-precondition`. Un appel multiple avant transition n'a pas d'effet
 * supplémentaire problématique (les timestamps sont écrasés).
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
  TreasurerConfirmSignedDocInput,
  TreasurerConfirmSignedDocResult,
} from '@club-app/shared-types'
import { Timestamp, db } from '../dues/_helpers'
import {
  assertCanReviewAsTreasurer,
  loadCallerUser,
} from './_reviewHelpers'

const NOTES_MAX = 500

interface ParsedInput {
  requestId: string
  notes: string | null
}

function parseInput(data: TreasurerConfirmSignedDocInput | undefined): ParsedInput {
  const d = (data ?? {}) as Partial<TreasurerConfirmSignedDocInput>
  if (typeof d.requestId !== 'string' || d.requestId.length === 0) {
    throw new HttpsError('invalid-argument', 'requestId is required')
  }
  let notes: string | null = null
  if (d.notes !== undefined && d.notes !== null) {
    if (typeof d.notes !== 'string') {
      throw new HttpsError('invalid-argument', 'notes must be a string')
    }
    const trimmed = d.notes.trim()
    if (trimmed.length > NOTES_MAX) {
      throw new HttpsError(
        'invalid-argument',
        `notes must be ≤ ${NOTES_MAX} characters.`,
      )
    }
    notes = trimmed.length === 0 ? null : trimmed
  }
  return { requestId: d.requestId, notes }
}

export const treasurerConfirmSignedDoc = onCall(
  async (
    request: CallableRequest<TreasurerConfirmSignedDocInput>,
  ): Promise<TreasurerConfirmSignedDocResult> => {
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        '[treasurerConfirmSignedDoc] Must be signed in.',
      )
    }
    const callerUid = request.auth.uid
    const { requestId, notes } = parseInput(request.data)

    const user = await loadCallerUser(callerUid)
    assertCanReviewAsTreasurer(request, user)

    const requestRef = db().doc(`licenseRequests/${requestId}`)

    try {
      await db().runTransaction(async (tx) => {
        const snap = await tx.get(requestRef)
        if (!snap.exists) {
          throw new HttpsError(
            'not-found',
            `[treasurerConfirmSignedDoc] licenseRequest ${requestId} not found`,
          )
        }
        const lr = snap.data() as LicenseRequestData

        if (lr.status !== 'parent_signed') {
          throw new HttpsError(
            'failed-precondition',
            `[treasurerConfirmSignedDoc] cannot confirm signed doc in status '${lr.status}' — must be 'parent_signed'`,
          )
        }

        const now = Timestamp.now()
        const patch: Record<string, unknown> = {
          status: 'form_confirmed',
          formConfirmedAt: now,
          formConfirmedByUid: callerUid,
        }
        if (notes !== null) patch.treasurerNotes = notes
        tx.update(requestRef, patch as FirebaseFirestore.UpdateData<LicenseRequestData>)
      })
    } catch (err) {
      if (err instanceof HttpsError) throw err
      const msg = err instanceof Error ? err.message : 'unknown'
      logger.error(`[treasurerConfirmSignedDoc] transaction failed [${msg}]`, {
        err,
        requestId,
      })
      throw new HttpsError(
        'internal',
        '[treasurerConfirmSignedDoc] transaction failed',
      )
    }

    logger.info('[treasurerConfirmSignedDoc] ok', {
      requestId,
      callerUid,
      newStatus: 'form_confirmed',
    })

    return { newStatus: 'form_confirmed' }
  },
)
