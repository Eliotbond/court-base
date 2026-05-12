/**
 * `issueDuesScheduled`
 *
 * Daily scheduled function (06:00 europe-west6). Transitions dues from
 * `pending_grace` to `issued` once their `issuedAt` is in the past, and sets
 * `dueAt = issuedAt + paymentDueDays`. Also flips the member's `duesStatus`
 * to `'due'` (the syncMemberDuesStatus trigger will reconcile but we set it
 * here directly to avoid lag for the UI).
 *
 * Idempotence : the query filters `status == 'pending_grace'` AND
 * `issuedAt <= now()`. Once a due has flipped to `issued` it no longer
 * matches the query, so re-runs are safe.
 *
 * Batching : Firestore caps a WriteBatch at 500 ops. We split into chunks
 * of `MAX_BATCH_WRITES` ops, counting both the dues update AND the member
 * update against the limit.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { logger } from 'firebase-functions/v2'
import type {
  DocumentReference,
  Query,
  QueryDocumentSnapshot,
} from 'firebase-admin/firestore'
import type { DueData } from '@club-app/shared-types'
import {
  MAX_BATCH_WRITES,
  Timestamp,
  addDaysToTimestamp,
  col,
  db,
  serverTimestamp,
} from './_helpers'

interface DuesConfigLike {
  paymentDueDays: number
}

async function readPaymentDueDays(): Promise<number> {
  const cfgSnap = await db().doc('config/club').get()
  const cfg = cfgSnap.data() as { duesConfig?: DuesConfigLike } | undefined
  const value = cfg?.duesConfig?.paymentDueDays
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    logger.warn(
      'issueDuesScheduled: invalid duesConfig.paymentDueDays — defaulting to 14',
      { value },
    )
    return 14
  }
  return value
}

type DuesQuery = Query<DueData>

function pendingGraceDueQuery(): DuesQuery {
  return col<DueData>('dues')
    .where('status', '==', 'pending_grace')
    .where('issuedAt', '<=', Timestamp.now())
}

/**
 * Process one batch of pending_grace dues. Two writes per due (dues doc +
 * member doc) so the slice size is `MAX_BATCH_WRITES / 2`.
 *
 * Exposed for unit tests via `__internal`.
 */
export async function processDuesIssuanceBatch(args: {
  docs: readonly QueryDocumentSnapshot<DueData>[]
  paymentDueDays: number
}): Promise<void> {
  const { docs, paymentDueDays } = args
  if (docs.length === 0) return

  // We pair each due update with a member update -> 2 writes per element.
  const half = Math.floor(MAX_BATCH_WRITES / 2)
  for (let i = 0; i < docs.length; i += half) {
    const slice = docs.slice(i, i + half)
    const batch = db().batch()
    for (const docSnap of slice) {
      const due = docSnap.data()
      // DueData.issuedAt is typed as the SDK-neutral Timestamp shape from
      // @club-app/shared-types; at runtime in Functions it's a real
      // admin Firestore Timestamp. Cast through unknown.
      const issuedAt = due.issuedAt as unknown as FirebaseFirestore.Timestamp | null
      if (!issuedAt) {
        logger.warn('issueDuesScheduled: dues row missing issuedAt — skipping', {
          dueId: docSnap.id,
        })
        continue
      }
      const dueAt = addDaysToTimestamp(issuedAt, paymentDueDays)
      batch.update(docSnap.ref, {
        status: 'issued',
        dueAt,
      })
      const memberRef: DocumentReference = db().doc(`members/${due.memberId}`)
      batch.update(memberRef, {
        duesStatus: 'due',
        duesStatusUpdatedAt: serverTimestamp(),
      })
    }
    await batch.commit()
  }
}

export const issueDuesScheduled = onSchedule(
  {
    schedule: '0 6 * * *',
    timeZone: 'Europe/Zurich',
  },
  async () => {
    const paymentDueDays = await readPaymentDueDays()
    const snap = await pendingGraceDueQuery().get()
    if (snap.empty) {
      logger.info('issueDuesScheduled: nothing to issue')
      return
    }
    logger.info('issueDuesScheduled: issuing dues', { count: snap.size })
    await processDuesIssuanceBatch({ docs: snap.docs, paymentDueDays })
  },
)
