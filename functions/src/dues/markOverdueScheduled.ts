/**
 * `markOverdueScheduled`
 *
 * Daily scheduled function (07:00 europe-west6). Finds dues that have been
 * `issued` past their `dueAt` and transitions them to `overdue`. Marks the
 * affected members as `excluded` (worst-status wins — see docs/main.md).
 *
 * Idempotence : same filter pattern as issueDuesScheduled — once a due is
 * `overdue` it no longer matches.
 *
 * Batching : 2 writes per due (dues + member). Slice by `MAX_BATCH_WRITES/2`.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { logger } from 'firebase-functions/v2'
import type {
  DocumentReference,
  Query,
  QueryDocumentSnapshot,
} from 'firebase-admin/firestore'
import type { CotisationData as DueData } from '@club-app/shared-types'
import {
  MAX_BATCH_WRITES,
  Timestamp,
  col,
  db,
  serverTimestamp,
} from './_helpers'

type DuesQuery = Query<DueData>

function overdueCandidateQuery(): DuesQuery {
  return col<DueData>('dues')
    .where('status', '==', 'issued')
    .where('dueAt', '<', Timestamp.now())
}

/** Exposed for unit tests via `__internal`. */
export async function processOverdueBatch(
  docs: readonly QueryDocumentSnapshot<DueData>[],
): Promise<void> {
  if (docs.length === 0) return
  const half = Math.floor(MAX_BATCH_WRITES / 2)
  for (let i = 0; i < docs.length; i += half) {
    const slice = docs.slice(i, i + half)
    const batch = db().batch()
    for (const docSnap of slice) {
      const due = docSnap.data()
      batch.update(docSnap.ref, { status: 'overdue' })
      const memberRef: DocumentReference = db().doc(`members/${due.memberId}`)
      batch.update(memberRef, {
        duesStatus: 'excluded',
        duesStatusUpdatedAt: serverTimestamp(),
      })
    }
    await batch.commit()
  }
}

export const markOverdueScheduled = onSchedule(
  {
    schedule: '0 7 * * *',
    timeZone: 'Europe/Zurich',
  },
  async () => {
    const snap = await overdueCandidateQuery().get()
    if (snap.empty) {
      logger.info('markOverdueScheduled: nothing to mark overdue')
      return
    }
    logger.info('markOverdueScheduled: marking overdue', { count: snap.size })
    await processOverdueBatch(snap.docs)
  },
)
