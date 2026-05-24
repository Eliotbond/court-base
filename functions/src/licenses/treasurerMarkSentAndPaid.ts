/**
 * `treasurerMarkSentAndPaid` — étape "envoi fédération + paiement effectué"
 * de la phase trésorier.
 *
 * Transition : `form_confirmed` → `sent_paid`. À cette transition, on crée
 * AUSSI une `/licenses/{id}` en `status:'pending'` — la licence est
 * **utilisable par le coach dès cet instant** pour aligner un joueur sur un
 * match, avant même la confirmation finale fédération (qui passe par
 * `treasurerFinalizeLicense` + `confirmLicenseCore`).
 *
 * Auth : claim `rootAdmin` OU rôle `admin | treasurer | secretary` côté
 * `/users/{uid}`. Cf. `assertCanReviewAsTreasurer`.
 *
 * Idempotence : si `status === 'sent_paid'` ET `linkedLicenseId !== null`,
 * la callable retourne sans rien écrire (cas du re-call après crash réseau).
 *
 * Sélection du `LicenseType` snapshot pour la licence créée : alignée avec
 * `validateLicenseRequest` — premier `/licenseTypes` actif `role: 'player'`,
 * tri `displayOrder asc`. Aucun → `failed-precondition` "Aucun type de
 * licence joueur actif configuré".
 *
 * Region : europe-west6.
 *
 * NOTE deploy : nouvelle Function v2 → après le premier deploy, ajouter le
 * binding IAM `allUsers/run.invoker` (cf. `functions/CLAUDE.md`).
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import type {
  LicenseData,
  LicenseRequestData,
  LicenseTypeData,
  TreasurerMarkSentAndPaidInput,
  TreasurerMarkSentAndPaidResult,
} from '@club-app/shared-types'
import { Timestamp, db } from '../dues/_helpers'
import {
  assertCanReviewAsTreasurer,
  loadCallerUser,
} from './_reviewHelpers'

interface ParsedInput {
  requestId: string
  paymentProofStoragePath: string | null
}

function parseInput(
  data: TreasurerMarkSentAndPaidInput | undefined,
  callerUid: string,
): ParsedInput {
  const d = (data ?? {}) as Partial<TreasurerMarkSentAndPaidInput>
  if (typeof d.requestId !== 'string' || d.requestId.length === 0) {
    throw new HttpsError('invalid-argument', 'requestId is required')
  }
  let paymentProofStoragePath: string | null = null
  if (d.paymentProofStoragePath !== undefined && d.paymentProofStoragePath !== null) {
    if (
      typeof d.paymentProofStoragePath !== 'string' ||
      d.paymentProofStoragePath.length === 0
    ) {
      throw new HttpsError(
        'invalid-argument',
        'paymentProofStoragePath must be a non-empty string when provided.',
      )
    }
    const expectedPrefix = `licenseRequests/${callerUid}/${d.requestId}/`
    if (!d.paymentProofStoragePath.startsWith(expectedPrefix)) {
      throw new HttpsError(
        'invalid-argument',
        `paymentProofStoragePath must start with '${expectedPrefix}'.`,
      )
    }
    paymentProofStoragePath = d.paymentProofStoragePath
  }
  return { requestId: d.requestId, paymentProofStoragePath }
}

interface ResolvedLicenseType {
  id: string
  data: LicenseTypeData
}

export const treasurerMarkSentAndPaid = onCall(
  async (
    request: CallableRequest<TreasurerMarkSentAndPaidInput>,
  ): Promise<TreasurerMarkSentAndPaidResult> => {
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        '[treasurerMarkSentAndPaid] Must be signed in.',
      )
    }
    const callerUid = request.auth.uid
    const { requestId, paymentProofStoragePath } = parseInput(request.data, callerUid)

    const user = await loadCallerUser(callerUid)
    assertCanReviewAsTreasurer(request, user)

    const requestRef = db().doc(`licenseRequests/${requestId}`)

    // La résolution du LicenseType joueur se fait dans la transaction (lecture
    // de la collection `/licenseTypes` via `tx.get` — référentiel petit, et la
    // règle Firestore [READS] avant [WRITES] est respectée). Si la
    // pré-condition n'est pas remplie (aucun type joueur actif), on throw avant
    // tout write.
    const ctx: { playerType: ResolvedLicenseType | null; licenseId: string } = {
      playerType: null,
      licenseId: '',
    }

    try {
      await db().runTransaction(async (tx) => {
        const snap = await tx.get(requestRef)
        if (!snap.exists) {
          throw new HttpsError(
            'not-found',
            `[treasurerMarkSentAndPaid] licenseRequest ${requestId} not found`,
          )
        }
        const lr = snap.data() as LicenseRequestData

        // Idempotence : déjà en sent_paid avec une licence liée → no-op.
        if (lr.status === 'sent_paid' && lr.linkedLicenseId) {
          ctx.licenseId = lr.linkedLicenseId
          return
        }

        if (lr.status !== 'form_confirmed') {
          throw new HttpsError(
            'failed-precondition',
            `[treasurerMarkSentAndPaid] cannot mark sent+paid in status '${lr.status}' — must be 'form_confirmed'`,
          )
        }

        // Lazy resolution : seulement quand on s'apprête à créer la licence.
        // (Le caller a déjà passé la tx, on ne peut pas re-fetch hors-tx ici.
        //  Heureusement, /licenseTypes est lisible en tx aussi.)
        const ltSnap = await tx.get(db().collection('licenseTypes'))
        const players = ltSnap.docs
          .map((d) => ({ id: d.id, data: d.data() as LicenseTypeData }))
          .filter((t) => t.data.active && t.data.role === 'player')
          .sort((a, b) => a.data.displayOrder - b.data.displayOrder)
        const type = players[0]
        if (!type) {
          throw new HttpsError(
            'failed-precondition',
            'Aucun type de licence joueur actif configuré.',
          )
        }
        ctx.playerType = type

        const now = Timestamp.now()

        // 1. Création de la /licenses/{auto-id}
        const licenseRef = db().collection('licenses').doc()
        const licenseData: LicenseData = {
          memberId: lr.memberId,
          seasonId: lr.seasonId,
          licenseTypeId: type.id,
          role: type.data.role,
          level: type.data.level,
          licenseName: type.data.name,
          feeSnapshot: type.data.fee,
          status: 'pending',
          createdAt: now,
          createdByUid: callerUid,
          confirmedAt: null,
          confirmedByUid: null,
          accountingEntryId: null,
          requestId,
          requestedByUid: lr.requestedBy,
        }
        tx.set(licenseRef, licenseData)
        ctx.licenseId = licenseRef.id

        // 2. Update de la /licenseRequests
        const patch: Record<string, unknown> = {
          status: 'sent_paid',
          sentToFederationAt: now,
          paidAt: now,
          linkedLicenseId: licenseRef.id,
        }
        if (paymentProofStoragePath !== null) {
          patch.paymentProofStoragePath = paymentProofStoragePath
          patch.paymentProofUploadedAt = now
        }
        tx.update(requestRef, patch as FirebaseFirestore.UpdateData<LicenseRequestData>)
      })
    } catch (err) {
      if (err instanceof HttpsError) throw err
      const msg = err instanceof Error ? err.message : 'unknown'
      logger.error(`[treasurerMarkSentAndPaid] transaction failed [${msg}]`, {
        err,
        requestId,
      })
      throw new HttpsError(
        'internal',
        '[treasurerMarkSentAndPaid] transaction failed',
      )
    }

    logger.info('[treasurerMarkSentAndPaid] ok', {
      requestId,
      callerUid,
      newStatus: 'sent_paid',
      licenseId: ctx.licenseId,
      licenseTypeId: ctx.playerType?.id ?? null,
    })

    return { newStatus: 'sent_paid', licenseId: ctx.licenseId }
  },
)
