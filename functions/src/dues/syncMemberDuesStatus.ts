/**
 * `syncMemberDuesStatus`
 *
 * Firestore trigger on `dues/{dueId}` writes. Recomputes the member's
 * `duesStatus` (worst-status-wins) by looking at ALL of their dues across
 * teams/seasons. Single source of truth for the member-level status flag
 * shown in the UI.
 *
 * Mapping rules (see `computeMemberDuesStatus` in `_helpers.ts`) :
 *   - any 'overdue'        -> 'excluded'
 *   - else any 'excepted'  -> 'excepted'
 *   - else any 'issued'    -> 'due'
 *   - else any 'pending_grace' -> 'pending_grace'
 *   - else if at least one due exists and all are paid/cancelled -> 'ok'
 *   - else (no dues at all) -> 'n/a'
 *
 * Idempotence / no-op guard : we only write the member doc if the computed
 * status differs from the current one. This avoids trigger amplification if
 * any future Function watches /members.
 *
 * Edge case — memberId change : a `dues` doc update *should* not change its
 * memberId (the doc is immutable on that field per business rules), but
 * defensively we recompute for BOTH the before and after memberIds if they
 * differ. Same for deletes (use the before memberId).
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions/v2'
import type { DueData, DueStatus } from '@club-app/shared-types'
import {
  col,
  computeMemberDuesStatus,
  db,
  serverTimestamp,
} from './_helpers'

/** Read all dues for a member and recompute their status inside a transaction. */
async function recomputeMemberStatus(memberId: string): Promise<void> {
  const memberRef = db().doc(`members/${memberId}`)
  await db().runTransaction(async (tx) => {
    // NOTE: a transactional Query.get is allowed; this gives us a consistent
    // view of dues + member doc at commit time.
    const duesSnap = await tx.get(col<DueData>('dues').where('memberId', '==', memberId))
    const statuses: DueStatus[] = duesSnap.docs.map((d) => d.data().status)
    const nextStatus = computeMemberDuesStatus(statuses)

    const memberSnap = await tx.get(memberRef)
    if (!memberSnap.exists) {
      logger.warn('syncMemberDuesStatus: member not found, skipping', { memberId })
      return
    }
    const currentStatus = memberSnap.data()?.duesStatus
    if (currentStatus === nextStatus) return // no-op: avoid trigger amplification

    tx.update(memberRef, {
      duesStatus: nextStatus,
      duesStatusUpdatedAt: serverTimestamp(),
    })
  })
}

export const syncMemberDuesStatus = onDocumentWritten('dues/{dueId}', async (event) => {
  const change = event.data
  if (!change) {
    logger.warn('syncMemberDuesStatus: missing event.data, skipping')
    return
  }
  const beforeData = change.before.exists ? (change.before.data() as DueData) : undefined
  const afterData = change.after.exists ? (change.after.data() as DueData) : undefined

  // Collect every memberId touched by this write (usually one, two if rewired).
  const memberIds = new Set<string>()
  if (beforeData?.memberId) memberIds.add(beforeData.memberId)
  if (afterData?.memberId) memberIds.add(afterData.memberId)
  if (memberIds.size === 0) {
    logger.warn('syncMemberDuesStatus: no memberId in before/after, skipping', {
      dueId: event.params.dueId,
    })
    return
  }

  for (const memberId of memberIds) {
    try {
      await recomputeMemberStatus(memberId)
    } catch (err) {
      logger.error('syncMemberDuesStatus: failed to recompute', { memberId, err })
    }
  }
})
