/**
 * `onMajorityReached`
 *
 * Daily scheduled function (03:00 europe-west6 / Zurich). Detects active
 * members who have just crossed the 18-year birthdate threshold and have not
 * yet had the majority-transition flow initialised, then :
 *
 *   1. Sets `member.comms.majorityTransition` to a fresh pending state
 *      `{ triggeredAt: now, guardiansResponse: null, memberResponse: null,
 *      resolvedAt: null }`.
 *   2. Switches `member.comms.billingRecipients` to `['member']` — billing
 *      auto-pivots to the now-adult member, independent of any consent flow
 *      (see `docs/main.md`, section "Majority transition").
 *   3. For each `guardianUserId`, enqueues a `/pendingEmails/{deterministicId}`
 *      doc addressed to the guardian's email (resolved via `/users/{uid}`).
 *      The doc ID is `{memberId}_majority_guardian_notify_{uid}` so re-runs
 *      do not produce duplicate emails — the email vendor (TBD) will own
 *      consumption + `sentAt`.
 *
 * Idempotence :
 *   - The query filters `comms.majorityTransition == null`, so a member that
 *     was already transitioned in a previous run is not re-fetched.
 *   - Inside the transaction we re-read the member and short-circuit if the
 *     state has flipped in the meantime (concurrent admin edit / replay).
 *   - The `/pendingEmails` writes use deterministic IDs (`set` with merge
 *     semantics implied), so a partial-failure re-run produces no duplicate
 *     queue entries.
 *
 * NOTE on callbackUrlYes/No : the spec asks the function to embed callback
 * URLs in the email context. The URL base is owned by the email-rendering
 * vendor (not yet wired in this repo — see `docs/firebase.md` "Email
 * pipeline"). We emit a `null` placeholder for each so the renderer can fill
 * them deterministically from `memberId`. Once the vendor is selected we'll
 * either move URL construction here or into a Function-config helper.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { logger } from 'firebase-functions/v2'
import type { Timestamp as AdminTimestamp } from 'firebase-admin/firestore'
import type { MemberData, UserData } from '@club-app/shared-types'
import {
  Timestamp,
  col,
  db,
  eighteenYearsAgo,
  serverTimestamp,
} from './_helpers'

/**
 * Result of one member transition. Exposed for tests and for the orchestrator
 * to aggregate counts in logs.
 */
export type TransitionResult =
  | 'transitioned'
  | 'already-transitioned'
  | 'no-guardians'

interface PendingEmailDoc {
  to: string | null
  template: 'majority_guardian_notify'
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

/**
 * Run the transition for a single member ID inside a transaction.
 * Exposed for unit tests via direct import.
 */
export async function transitionOneMember(memberId: string): Promise<TransitionResult> {
  const memberRef = db().doc(`members/${memberId}`)

  // Read guardian user docs *outside* the transaction. The user docs are
  // effectively immutable for this flow (email/displayName changes are rare),
  // and reading them inside the transaction would force re-reads on contention
  // for no extra correctness.
  const memberSnap = await memberRef.get()
  if (!memberSnap.exists) {
    logger.warn('onMajorityReached: member missing', { memberId })
    return 'already-transitioned'
  }
  const member = memberSnap.data() as MemberData
  const guardians = member.guardianUserIds ?? []
  const guardianContacts = await resolveGuardianContacts(guardians)

  return db().runTransaction(async (tx) => {
    const fresh = await tx.get(memberRef)
    if (!fresh.exists) return 'already-transitioned'
    const freshMember = fresh.data() as MemberData
    // Idempotence : if the flow has already been kicked off (or fully resolved)
    // since the query was issued, do nothing.
    if (freshMember.comms?.majorityTransition != null) {
      return 'already-transitioned'
    }

    const now = Timestamp.now()
    tx.update(memberRef, {
      'comms.billingRecipients': ['member'],
      'comms.majorityTransition': {
        triggeredAt: now,
        guardiansResponse: null,
        memberResponse: null,
        resolvedAt: null,
      },
    })

    // Enqueue one pending email per guardian. Deterministic IDs make replay safe.
    for (const { uid, email } of guardianContacts) {
      const pendingRef = db().doc(
        `pendingEmails/${memberId}_majority_guardian_notify_${uid}`,
      )
      const payload: PendingEmailDoc = {
        to: email,
        template: 'majority_guardian_notify',
        context: {
          memberFirstName: freshMember.firstName,
          memberLastName: freshMember.lastName,
          memberId,
          // See file header note on callback URL composition.
          callbackUrlYes: null,
          callbackUrlNo: null,
        },
        createdAt: serverTimestamp(),
        sentAt: null,
      }
      tx.set(pendingRef, payload)
    }

    return guardianContacts.length === 0 ? 'no-guardians' : 'transitioned'
  })
}

interface GuardianContact {
  uid: string
  email: string | null
}

/**
 * Resolve guardian `uid` → email via `/users/{uid}`. Missing or empty email
 * is recorded as `null` (the email vendor will skip) and logged for ops to
 * investigate.
 */
export async function resolveGuardianContacts(
  guardianUids: readonly string[],
): Promise<GuardianContact[]> {
  if (guardianUids.length === 0) return []
  const refs = guardianUids.map((uid) => db().doc(`users/${uid}`))
  const snaps = await db().getAll(...refs)
  return snaps.map((snap, idx) => {
    const uid = guardianUids[idx]
    if (!snap.exists) {
      logger.warn('onMajorityReached: guardian user doc missing', { uid })
      return { uid, email: null }
    }
    const user = snap.data() as UserData
    const email = typeof user.email === 'string' && user.email.length > 0
      ? user.email
      : null
    if (!email) {
      logger.warn('onMajorityReached: guardian has no email on /users doc', { uid })
    }
    return { uid, email }
  })
}

/**
 * Query members eligible for majority transition. Exposed for tests so they
 * can assert the filter shape.
 */
export function eligibleMembersQuery(now: AdminTimestamp) {
  return col<MemberData>('members')
    .where('active', '==', true)
    .where('birthDate', '<=', eighteenYearsAgo(now))
    .where('comms.majorityTransition', '==', null)
}

export const onMajorityReached = onSchedule(
  {
    schedule: '0 3 * * *',
    timeZone: 'Europe/Zurich',
  },
  async () => {
    const snap = await eligibleMembersQuery(Timestamp.now()).get()
    if (snap.empty) {
      logger.info('onMajorityReached: nothing to transition')
      return
    }
    logger.info('onMajorityReached: candidates found', { count: snap.size })

    let transitioned = 0
    let noGuardians = 0
    let skipped = 0
    for (const doc of snap.docs) {
      try {
        const result = await transitionOneMember(doc.id)
        if (result === 'transitioned') transitioned += 1
        else if (result === 'no-guardians') noGuardians += 1
        else skipped += 1
      } catch (err) {
        logger.error('onMajorityReached: transition failed', {
          memberId: doc.id,
          err,
        })
        // Continue with other members — a single failure shouldn't block the rest.
      }
    }
    logger.info('onMajorityReached: done', {
      transitioned,
      noGuardians,
      skipped,
      total: snap.size,
    })
  },
)
