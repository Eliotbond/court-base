/**
 * `respondMemberConsent`
 *
 * Callable invoked by the now-adult member after they receive the
 * majority-confirmation email (sent only when guardians answered `yes`).
 * Records the member's final `yes`/`no` choice and applies the resulting
 * `comms.generalRecipients` policy :
 *
 *   - `yes` → keep parents in the loop. `generalRecipients = ['member', 'guardians']`
 *   - `no`  → adult-only.              `generalRecipients = ['member']`
 *
 * Either choice resolves the flow (`resolvedAt = now`).
 *
 * Auth :
 *   - Caller must be signed-in (`unauthenticated` otherwise).
 *   - Caller UID must match `member.linkedUserId` (`permission-denied`).
 *
 * State preconditions :
 *   - `comms.majorityTransition != null`
 *   - `comms.majorityTransition.guardiansResponse?.answer === 'yes'`
 *   - `comms.majorityTransition.memberResponse == null`
 *
 * A second call throws `failed-precondition` (idempotence: frontend may treat
 * as success-already-recorded if desired).
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import type { MemberData } from '@club-app/shared-types'
import { Timestamp, db } from './_helpers'

interface RespondMemberConsentInput {
  memberId: unknown
  answer: unknown
}

export interface RespondMemberConsentOutput {
  ok: true
  answer: 'yes' | 'no'
}

function parseInput(data: RespondMemberConsentInput): {
  memberId: string
  answer: 'yes' | 'no'
} {
  const { memberId, answer } = data ?? ({} as RespondMemberConsentInput)
  if (typeof memberId !== 'string' || memberId.length === 0) {
    throw new HttpsError('invalid-argument', 'memberId is required')
  }
  if (answer !== 'yes' && answer !== 'no') {
    throw new HttpsError('invalid-argument', "answer must be 'yes' or 'no'")
  }
  return { memberId, answer }
}

export const respondMemberConsent = onCall(
  async (
    request: CallableRequest<RespondMemberConsentInput>,
  ): Promise<RespondMemberConsentOutput> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.')
    }
    const callerUid = request.auth.uid
    const { memberId, answer } = parseInput(request.data)

    const memberRef = db().doc(`members/${memberId}`)

    await db().runTransaction(async (tx) => {
      const snap = await tx.get(memberRef)
      if (!snap.exists) {
        throw new HttpsError('not-found', `member ${memberId} not found`)
      }
      const member = snap.data() as MemberData

      if (member.linkedUserId !== callerUid) {
        throw new HttpsError(
          'permission-denied',
          'Caller is not the linked user for this member.',
        )
      }

      const transition = member.comms?.majorityTransition
      if (transition == null) {
        throw new HttpsError(
          'failed-precondition',
          'majority transition not initiated for this member',
        )
      }
      if (transition.guardiansResponse?.answer !== 'yes') {
        throw new HttpsError(
          'failed-precondition',
          'guardians have not approved member consent step',
        )
      }
      if (transition.memberResponse != null) {
        throw new HttpsError(
          'failed-precondition',
          'member response already recorded',
        )
      }

      const now = Timestamp.now()
      const generalRecipients =
        answer === 'yes' ? ['member', 'guardians'] : ['member']

      tx.update(memberRef, {
        'comms.generalRecipients': generalRecipients,
        'comms.majorityTransition.memberResponse': {
          answer,
          respondedAt: now,
          respondedByUid: callerUid,
        },
        'comms.majorityTransition.resolvedAt': now,
      })
    })

    logger.info('respondMemberConsent: recorded', {
      memberId,
      callerUid,
      answer,
    })

    return { ok: true, answer }
  },
)
