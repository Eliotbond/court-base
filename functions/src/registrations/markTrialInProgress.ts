/**
 * `markTrialInProgress`
 *
 * Callable invoquée par un coach (ou admin) pour passer une registration en
 * `trial_in_progress` — démarre la période d'essai de 14 jours suivie par le
 * scheduled `onTrialExpired` (cf. `docs/registrations/lifecycle.md` §4 et §6).
 *
 * Effets transactionnels :
 *  1. `registration.status = 'trial_in_progress'`.
 *  2. `registration.trialStartedAt = now` (ou laisse en place si déjà set —
 *     idempotence : un re-call ne réinitialise pas le compteur).
 *  3. Append entrée `actionLog` (action: 'status_changed').
 *
 * Auth : signed-in. Le caller doit être admin OU coach de la team
 * (`team.coachIds.includes(callerUid)` via `/users.teamIds`).
 *
 * State preconditions : `status` ∈ {`open_pending_trial`,
 * `conditional_pending_review`, `conditional_pending_trial`}. Depuis
 * `conditional_pending_review`, on auto-collapse l'étape "accept" — un
 * coach peut directement marquer "essai en cours" sans passer par
 * `conditional_pending_trial`.
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import type {
  RegistrationActionLogEntry,
  RegistrationData,
  RegistrationStatus,
  UserData,
} from '@club-app/shared-types'
import { Timestamp, db } from './_helpers'

interface MarkTrialInProgressInput {
  registrationId: unknown
}

export interface MarkTrialInProgressOutput {
  ok: true
  registrationId: string
  status: 'trial_in_progress'
  trialStartedAt: { seconds: number; nanoseconds: number }
}

const TRIAL_STARTABLE_STATUSES: readonly RegistrationStatus[] = [
  'open_pending_trial',
  'conditional_pending_review',
  'conditional_pending_trial',
]

function parseInput(data: MarkTrialInProgressInput): { registrationId: string } {
  const d = data ?? ({} as MarkTrialInProgressInput)
  if (typeof d.registrationId !== 'string' || d.registrationId.length === 0) {
    throw new HttpsError('invalid-argument', 'registrationId is required')
  }
  return { registrationId: d.registrationId }
}

function assertCoachOrAdmin(user: UserData, teamId: string): void {
  if (user.roles?.includes('admin')) return
  if (user.roles?.includes('coach') && (user.teamIds ?? []).includes(teamId)) return
  throw new HttpsError(
    'permission-denied',
    'Caller is neither admin nor coach of this team.',
  )
}

export const markTrialInProgress = onCall(
  async (
    request: CallableRequest<MarkTrialInProgressInput>,
  ): Promise<MarkTrialInProgressOutput> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.')
    }
    const callerUid = request.auth.uid
    const { registrationId } = parseInput(request.data)

    const userSnap = await db().doc(`users/${callerUid}`).get()
    if (!userSnap.exists) {
      throw new HttpsError('permission-denied', 'No /users doc for caller.')
    }
    const userData = userSnap.data() as UserData

    const registrationRef = db().doc(`registrations/${registrationId}`)
    let resolvedTrialStartedAt = Timestamp.now()

    await db().runTransaction(async (tx) => {
      const regSnap = await tx.get(registrationRef)
      if (!regSnap.exists) {
        throw new HttpsError('not-found', `registration ${registrationId} not found`)
      }
      const reg = regSnap.data() as RegistrationData

      assertCoachOrAdmin(userData, reg.teamId)

      if (!TRIAL_STARTABLE_STATUSES.includes(reg.status)) {
        throw new HttpsError(
          'failed-precondition',
          `cannot start trial from status '${reg.status}'`,
        )
      }

      const now = Timestamp.now()
      // Idempotence : si `trialStartedAt` est déjà set (ex. re-call), on garde
      // l'horodatage initial pour ne pas réinitialiser le compteur 14j.
      // Reconstruit en admin `Timestamp` pour matcher la signature du write
      // (shared-types expose un `{ seconds, nanoseconds }` minimal).
      const trialStartedAt: FirebaseFirestore.Timestamp = reg.trialStartedAt
        ? new Timestamp(reg.trialStartedAt.seconds, reg.trialStartedAt.nanoseconds)
        : now
      resolvedTrialStartedAt = trialStartedAt

      const action: RegistrationActionLogEntry = {
        at: now,
        byUid: callerUid,
        action: 'status_changed',
        previousStatus: reg.status,
        newStatus: 'trial_in_progress',
        note: 'trial started',
      }
      tx.update(registrationRef, {
        status: 'trial_in_progress',
        statusUpdatedAt: now,
        trialStartedAt,
        actionLog: [...(reg.actionLog ?? []), action],
      })
    })

    logger.info('markTrialInProgress: ok', {
      registrationId,
      callerUid,
      trialStartedAt: resolvedTrialStartedAt.toMillis(),
    })

    return {
      ok: true,
      registrationId,
      status: 'trial_in_progress',
      trialStartedAt: {
        seconds: resolvedTrialStartedAt.seconds,
        nanoseconds: resolvedTrialStartedAt.nanoseconds,
      },
    }
  },
)
