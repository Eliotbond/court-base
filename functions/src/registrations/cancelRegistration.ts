/**
 * `cancelRegistration`
 *
 * Callable invoquée par le **user** lui-même pour annuler sa registration
 * avant validation coach. Status cibles autorisés : `submitted`,
 * `open_pending_trial`, `conditional_pending_review`. Au-delà
 * (`*_trial_in_progress`, `confirmed_pending_dues`, `active`), l'annulation
 * doit passer par l'admin (callable séparée à venir).
 *
 * Auth : signed-in + `submittedByUid == callerUid`.
 *
 * Effets :
 *  1. `status = 'cancelled'` + `statusUpdatedAt = now`.
 *  2. Append `actionLog` (action: 'status_changed').
 *  3. Notif admin uniquement (les coachs voient via la liste filtrée).
 *
 * Idempotent : si déjà `cancelled`, retourne ok sans rejouer.
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import type {
  RegistrationActionLogEntry,
  RegistrationData,
  RegistrationStatus,
} from '@club-app/shared-types'
import { Timestamp, db, serverTimestamp } from './_helpers'

interface CancelRegistrationInput {
  registrationId: unknown
  note: unknown
}

export interface CancelRegistrationOutput {
  ok: true
  registrationId: string
  status: RegistrationStatus
}

const CANCELLABLE_STATUSES: readonly RegistrationStatus[] = [
  'draft',
  'submitted',
  'open_pending_trial',
  'conditional_pending_review',
]

export const cancelRegistration = onCall(
  async (
    request: CallableRequest<CancelRegistrationInput>,
  ): Promise<CancelRegistrationOutput> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.')
    }
    const callerUid = request.auth.uid
    const d = request.data ?? ({} as CancelRegistrationInput)
    if (typeof d.registrationId !== 'string' || d.registrationId.length === 0) {
      throw new HttpsError('invalid-argument', 'registrationId is required')
    }
    const note = typeof d.note === 'string' && d.note.trim().length > 0
      ? d.note.trim()
      : null

    const ref = db().doc(`registrations/${d.registrationId}`)
    let finalStatus: RegistrationStatus = 'cancelled'

    await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists) {
        throw new HttpsError('not-found', `registration ${d.registrationId} not found`)
      }
      const reg = snap.data() as RegistrationData
      if (reg.submittedByUid !== callerUid) {
        throw new HttpsError('permission-denied', 'Not your registration')
      }
      if (reg.status === 'cancelled') {
        finalStatus = 'cancelled'
        return
      }
      if (!CANCELLABLE_STATUSES.includes(reg.status)) {
        throw new HttpsError(
          'failed-precondition',
          `cannot cancel registration in status '${reg.status}'`,
        )
      }
      const now = Timestamp.now()
      const action: RegistrationActionLogEntry = {
        at: now,
        byUid: callerUid,
        action: 'status_changed',
        previousStatus: reg.status,
        newStatus: 'cancelled',
        note,
      }
      tx.update(ref, {
        status: 'cancelled',
        statusUpdatedAt: now,
        actionLog: [...(reg.actionLog ?? []), action],
      })

      // Notif admin — broadcast (les coachs se débrouillent via list filtré).
      const notifRef = db().collection('notifications').doc(
        `${d.registrationId}_cancelled_admin`,
      )
      tx.set(notifRef, {
        type: 'registration_cancelled',
        recipientRole: 'admin',
        payload: {
          registrationId: d.registrationId,
          teamId: reg.teamId,
          playerName: `${reg.player.firstName} ${reg.player.lastName}`,
          cancelledByUid: callerUid,
          note,
        },
        readBy: [],
        createdAt: serverTimestamp(),
      })
    })

    logger.info('cancelRegistration: cancelled', {
      registrationId: d.registrationId,
      callerUid,
    })

    return { ok: true, registrationId: d.registrationId, status: finalStatus }
  },
)
