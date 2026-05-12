/**
 * Cloud Function — `applyClosurePeriod`.
 *
 * Trigger : Firestore `onDocumentWritten` sur `/seasons/{seasonId}`.
 * Déclenchement effectif : `before.status === 'active' && after.status === 'active'`
 * ET au moins un `closurePeriodId` a été *ajouté* dans `after.closurePeriodIds`
 * (set-diff after − before).
 *
 * Pour chaque closure nouvellement ajoutée :
 *   - charge `/closurePeriods/{periodId}` → `startDate`, `endDate` (inclusifs)
 *   - query `/bookings` WHERE seasonId == seasonId AND status == 'scheduled'
 *     AND date >= closure.startDate AND date <= closure.endDate
 *   - flip `status = 'cancelled'`, `cancelReason = 'closure'`, append entry
 *     `{ at: serverTimestamp(), by: 'system', action: 'closure_cancel',
 *        note: <closurePeriodId> }` à `actionLog`
 *   - batched writes (max 450 ops/batch, marge sous la limite Firestore 500)
 *
 * Idempotence :
 *   - on n'agit QUE sur `status == 'scheduled'`. Un re-trigger ne ré-impactera
 *     pas les `cancelled` ou `freed` (la query Firestore les exclut d'office).
 *   - le log `actionLog` est append-only : on accepte qu'une retry double-écrive
 *     une entrée. Trade-off raisonnable car la condition de query (status ==
 *     'scheduled') filtre la quasi-totalité des doublons en pratique.
 *   - les closures *retirées* de `closurePeriodIds` ne déclenchent AUCUNE action :
 *     l'admin doit re-planifier manuellement (cf. docs/main.md "Bookings").
 *
 * Voir `docs/firebase.md` (Cloud Functions, ligne `applyClosurePeriod`).
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import * as admin from 'firebase-admin'
import { db } from '../shared/firestore'
import { logger } from '../shared/logger'

/** Firestore limite à 500 ops par batch. Marge sous le plafond. */
const MAX_OPS_PER_BATCH = 450

/** Subset de `/seasons/{id}` utilisé par ce trigger. */
interface SeasonStatusDoc {
  status: 'draft' | 'active' | 'archived'
  closurePeriodIds?: readonly string[]
}

/** Subset de `/closurePeriods/{id}`. */
interface ClosurePeriodDoc {
  name: string
  startDate: FirebaseFirestore.Timestamp
  endDate: FirebaseFirestore.Timestamp
  type: 'holiday' | 'custom'
  createdBy: string
}

export const applyClosurePeriod = onDocumentWritten(
  'seasons/{seasonId}',
  async (event) => {
    const seasonId = event.params.seasonId
    const before = event.data?.before?.data() as SeasonStatusDoc | undefined
    const after = event.data?.after?.data() as SeasonStatusDoc | undefined

    if (!after) {
      logger.info('applyClosurePeriod: season deleted, skipping', { seasonId })
      return
    }

    // Strict : la saison doit être active AVANT et APRÈS. La transition
    // draft -> active est gérée par `generateSeasonBookings`. Toute autre
    // mutation status est hors scope de ce trigger.
    if (before?.status !== 'active' || after.status !== 'active') {
      return
    }

    const newIds = diffNewClosureIds(
      before.closurePeriodIds ?? [],
      after.closurePeriodIds ?? [],
    )
    if (newIds.length === 0) {
      return
    }

    logger.info('applyClosurePeriod: new closures added', {
      seasonId,
      newClosureIds: newIds,
    })

    await applyClosures(seasonId, newIds)
  },
)

/**
 * Set difference `after − before`. Retourne les IDs présents dans `after`
 * et absents dans `before`. Conserve l'ordre de `after`. Pure — testable.
 */
export function diffNewClosureIds(
  before: readonly string[],
  after: readonly string[],
): string[] {
  const beforeSet = new Set(before)
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of after) {
    if (beforeSet.has(id)) continue
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * Cœur du trigger — exporté pour testabilité. Pour chaque closure :
 *   1. charge la définition pour récupérer `[startDate, endDate]`
 *   2. query les bookings affectés
 *   3. batch les `update(status=cancelled, cancelReason=closure, ...actionLog)`
 */
export async function applyClosures(
  seasonId: string,
  closurePeriodIds: readonly string[],
): Promise<{ totalCancelled: number; byClosure: Record<string, number> }> {
  const firestore = db()
  const byClosure: Record<string, number> = {}
  let totalCancelled = 0

  for (const closureId of closurePeriodIds) {
    const closureSnap = await firestore
      .collection('closurePeriods')
      .doc(closureId)
      .get()
    if (!closureSnap.exists) {
      logger.warn('applyClosurePeriod: closurePeriod not found, skipping', {
        seasonId,
        closurePeriodId: closureId,
      })
      byClosure[closureId] = 0
      continue
    }
    const closure = closureSnap.data() as ClosurePeriodDoc
    const start = closure.startDate
    const end = closure.endDate

    // Query : seulement les bookings encore `scheduled` sur la fenêtre.
    // Composite index `bookings(seasonId, status, date)` requis — géré par
    // un autre agent dans `firestore.indexes.json`.
    const bookingsSnap = await firestore
      .collection('bookings')
      .where('seasonId', '==', seasonId)
      .where('status', '==', 'scheduled')
      .where('date', '>=', start)
      .where('date', '<=', end)
      .get()

    if (bookingsSnap.empty) {
      logger.info('applyClosurePeriod: no scheduled bookings to cancel', {
        seasonId,
        closurePeriodId: closureId,
      })
      byClosure[closureId] = 0
      continue
    }

    let count = 0
    let batch = firestore.batch()
    let ops = 0
    for (const docSnap of bookingsSnap.docs) {
      batch.update(docSnap.ref, {
        status: 'cancelled',
        cancelReason: 'closure',
        actionLog: admin.firestore.FieldValue.arrayUnion({
          at: admin.firestore.Timestamp.now(),
          by: 'system',
          action: 'closure_cancel',
          note: closureId,
        }),
      })
      ops += 1
      count += 1
      if (ops >= MAX_OPS_PER_BATCH) {
        await batch.commit()
        logger.info('applyClosurePeriod: batch committed', {
          seasonId,
          closurePeriodId: closureId,
          size: ops,
        })
        batch = firestore.batch()
        ops = 0
      }
    }
    if (ops > 0) {
      await batch.commit()
      logger.info('applyClosurePeriod: batch committed', {
        seasonId,
        closurePeriodId: closureId,
        size: ops,
      })
    }
    byClosure[closureId] = count
    totalCancelled += count
  }

  logger.info('applyClosurePeriod: done', {
    seasonId,
    totalCancelled,
    closureCount: closurePeriodIds.length,
  })

  return { totalCancelled, byClosure }
}
