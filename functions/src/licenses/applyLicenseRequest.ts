/**
 * `applyLicenseRequest`
 *
 * Firestore trigger on `licenseRequests/{requestId}` writes.
 *
 * Per `docs/main.md` ("License requests") and `docs/firebase.md` :
 *
 *   pending  → no-op (the request is awaiting admin review).
 *   approved → flip `/members/{memberId}.licensed = true`.
 *              The federal procedure happens out-of-band ; this Function
 *              only mirrors the admin's decision into Firestore.
 *   rejected → no-op on the member doc (the license was never granted).
 *
 * Demotion (un-license) is performed by an admin directly on the member
 * doc and is **not** routed through this trigger.
 *
 * Idempotence : we only write the member doc when `licensed` is not already
 * `true`. Replays of the same `pending → approved` transition are no-ops.
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import type { LicenseRequestData, MemberData } from '@club-app/shared-types'
import { db } from '../shared/firestore'
import { logger } from '../shared/logger'

type Transition = 'approve' | 'reject' | 'none'

export function classifyLicenseTransition(
  before: LicenseRequestData | undefined,
  after: LicenseRequestData | undefined,
): Transition {
  if (!before || !after) return 'none'
  if (before.status !== 'pending') return 'none'
  if (after.status === 'approved') return 'approve'
  if (after.status === 'rejected') return 'reject'
  return 'none'
}

export async function grantLicense(memberId: string): Promise<void> {
  const memberRef = db().doc(`members/${memberId}`)
  await db().runTransaction(async (tx) => {
    const memberSnap = await tx.get(memberRef)
    if (!memberSnap.exists) {
      logger.warn('applyLicenseRequest: member not found, skipping', { memberId })
      return
    }
    const member = memberSnap.data() as MemberData | undefined
    // Idempotence : already licensed → no-op.
    if (member?.licensed === true) return
    tx.update(memberRef, { licensed: true })
  })
}

export const applyLicenseRequest = onDocumentWritten(
  'licenseRequests/{requestId}',
  async (event) => {
    const change = event.data
    if (!change) {
      logger.warn('applyLicenseRequest: missing event.data, skipping')
      return
    }
    const before = change.before.exists
      ? (change.before.data() as LicenseRequestData)
      : undefined
    const after = change.after.exists
      ? (change.after.data() as LicenseRequestData)
      : undefined

    const transition = classifyLicenseTransition(before, after)
    if (transition === 'none' || !after) return

    // Rejection : no side-effect on member doc — the request itself carries
    // the audit info (`reviewedBy`, `adminComment`).
    if (transition === 'reject') {
      logger.info('applyLicenseRequest: rejected, no-op on member', {
        requestId: event.params.requestId,
        memberId: after.memberId,
      })
      return
    }

    try {
      await grantLicense(after.memberId)
      logger.info('applyLicenseRequest: approved, member licensed', {
        requestId: event.params.requestId,
        memberId: after.memberId,
      })
    } catch (err) {
      logger.error('applyLicenseRequest: failed to grant license', {
        requestId: event.params.requestId,
        memberId: after.memberId,
        err,
      })
    }
  },
)
