/**
 * `respondGuardianConsent`
 *
 * Callable invoked by a guardian after they receive the majority-notification
 * email. Records their `yes`/`no` answer on the member doc and (if `yes`)
 * enqueues a confirmation email addressed to the now-adult member.
 *
 * Auth :
 *   - Caller must be signed-in (`unauthenticated` otherwise).
 *   - Caller UID must appear in `member.guardianUserIds`
 *     (`permission-denied` otherwise).
 *
 * State preconditions (atomic, inside the transaction) :
 *   - `comms.majorityTransition != null`
 *   - `comms.majorityTransition.guardiansResponse == null`
 *   A second call for the same member throws `failed-precondition`, which
 *   the frontend can treat as "already recorded".
 *
 * Effects (transactional) :
 *   - Set `guardiansResponse = { answer, respondedAt: now, respondedByUid }`
 *   - If `answer === 'no'` : final state is reached →
 *       - `comms.generalRecipients = ['member']`
 *       - `comms.majorityTransition.resolvedAt = now`
 *   - If `answer === 'yes'` : enqueue
 *       `/pendingEmails/{memberId}_majority_member_confirm` addressed to the
 *       member's email (via `/users/{linkedUserId}.email`). If the member
 *       has no `linkedUserId`, throw `failed-precondition` ("member has no
 *       linked account") — without an account we cannot route the next step.
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import type { MemberData, UserData } from '@club-app/shared-types'
import { Timestamp, db, serverTimestamp } from './_helpers'

interface RespondGuardianConsentInput {
  memberId: unknown
  answer: unknown
}

export interface RespondGuardianConsentOutput {
  ok: true
  answer: 'yes' | 'no'
}

function parseInput(data: RespondGuardianConsentInput): {
  memberId: string
  answer: 'yes' | 'no'
} {
  const { memberId, answer } = data ?? ({} as RespondGuardianConsentInput)
  if (typeof memberId !== 'string' || memberId.length === 0) {
    throw new HttpsError('invalid-argument', 'memberId is required')
  }
  if (answer !== 'yes' && answer !== 'no') {
    throw new HttpsError('invalid-argument', "answer must be 'yes' or 'no'")
  }
  return { memberId, answer }
}

interface MemberConfirmPendingEmail {
  to: string
  template: 'majority_member_confirm'
  context: {
    memberFirstName: string
    memberLastName: string
    memberId: string
    callbackUrlYes: string | null
    callbackUrlNo: string | null
  }
  createdAt: FirebaseFirestore.FieldValue
  sentAt: null
}

export const respondGuardianConsent = onCall(
  async (
    request: CallableRequest<RespondGuardianConsentInput>,
  ): Promise<RespondGuardianConsentOutput> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.')
    }
    const callerUid = request.auth.uid
    const { memberId, answer } = parseInput(request.data)

    const memberRef = db().doc(`members/${memberId}`)

    // For the `yes` branch we need the member's linked user email. Read it
    // outside the transaction (the user doc is stable for this flow), then
    // re-validate state atomically inside.
    let memberEmailForConfirm: string | null = null
    let memberFirstName = ''
    let memberLastName = ''
    let linkedUserId: string | null = null

    const preSnap = await memberRef.get()
    if (!preSnap.exists) {
      throw new HttpsError('not-found', `member ${memberId} not found`)
    }
    const preMember = preSnap.data() as MemberData
    if (!preMember.guardianUserIds?.includes(callerUid)) {
      throw new HttpsError(
        'permission-denied',
        'Caller is not a guardian of this member.',
      )
    }
    memberFirstName = preMember.firstName
    memberLastName = preMember.lastName
    linkedUserId = preMember.linkedUserId

    if (answer === 'yes') {
      if (!linkedUserId) {
        throw new HttpsError(
          'failed-precondition',
          'member has no linked account',
        )
      }
      const userSnap = await db().doc(`users/${linkedUserId}`).get()
      if (!userSnap.exists) {
        throw new HttpsError(
          'failed-precondition',
          'member linkedUserId points to a missing /users doc',
        )
      }
      const linkedUser = userSnap.data() as UserData
      if (typeof linkedUser.email !== 'string' || linkedUser.email.length === 0) {
        throw new HttpsError(
          'failed-precondition',
          'member linked user has no email',
        )
      }
      memberEmailForConfirm = linkedUser.email
    }

    await db().runTransaction(async (tx) => {
      const snap = await tx.get(memberRef)
      if (!snap.exists) {
        throw new HttpsError('not-found', `member ${memberId} not found`)
      }
      const member = snap.data() as MemberData

      // Re-check guardianship inside the transaction (defensive against
      // racing edits that strip the caller from `guardianUserIds`).
      if (!member.guardianUserIds?.includes(callerUid)) {
        throw new HttpsError(
          'permission-denied',
          'Caller is not a guardian of this member.',
        )
      }

      const transition = member.comms?.majorityTransition
      if (transition == null) {
        throw new HttpsError(
          'failed-precondition',
          'majority transition not initiated for this member',
        )
      }
      if (transition.guardiansResponse != null) {
        throw new HttpsError(
          'failed-precondition',
          'guardian response already recorded',
        )
      }

      const now = Timestamp.now()
      const responsePatch = {
        answer,
        respondedAt: now,
        respondedByUid: callerUid,
      }

      if (answer === 'no') {
        tx.update(memberRef, {
          'comms.generalRecipients': ['member'],
          'comms.majorityTransition.guardiansResponse': responsePatch,
          'comms.majorityTransition.resolvedAt': now,
        })
      } else {
        tx.update(memberRef, {
          'comms.majorityTransition.guardiansResponse': responsePatch,
        })

        // Enqueue member-confirm email (deterministic ID for idempotence).
        if (memberEmailForConfirm == null) {
          // Should have been caught above; defensive throw keeps types tight.
          throw new HttpsError(
            'internal',
            'memberEmailForConfirm missing inside transaction',
          )
        }
        const pendingRef = db().doc(
          `pendingEmails/${memberId}_majority_member_confirm`,
        )
        const payload: MemberConfirmPendingEmail = {
          to: memberEmailForConfirm,
          template: 'majority_member_confirm',
          context: {
            memberFirstName,
            memberLastName,
            memberId,
            callbackUrlYes: null,
            callbackUrlNo: null,
          },
          createdAt: serverTimestamp(),
          sentAt: null,
        }
        tx.set(pendingRef, payload)
      }
    })

    logger.info('respondGuardianConsent: recorded', {
      memberId,
      callerUid,
      answer,
    })

    return { ok: true, answer }
  },
)
