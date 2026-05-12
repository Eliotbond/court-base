/**
 * Cloud Function — `handleMatchSlotChange`.
 *
 * Trigger : Firestore `onDocumentWritten` sur
 *   `venues/{venueId}/courts/{courtId}/timeSlots/{slotId}`.
 *
 * Déclenchement effectif :
 *   - le slot vient d'être créé avec `slotType in ('match_home', 'match_away')`,
 *     OU
 *   - le slot existait et `slotType` a transitionné depuis un type *non-match*
 *     (training/reserve/custom) vers `match_home` ou `match_away`.
 *   Un re-update d'un slot qui était DÉJÀ match (`match_home` -> `match_home`)
 *   n'a aucun effet — idempotent.
 *
 * Logique métier (cf. docs/main.md "Slot types") :
 *   - `match_home` → suspend les `training` de la même équipe ce jour-là.
 *   - `match_away` → libère les `training` de l'équipe ce jour-là.
 *   Dans les deux cas on flippe les bookings concernés en `status=cancelled`
 *   avec `cancelReason` reflétant le motif (`match_home`/`match_away`).
 *
 * Approche `dayOfWeek` :
 *   Firestore ne permet pas de filtrer par `date.getUTCDay()`. On query par
 *   `seasonId + teamId + slotType=='training' + status=='scheduled'` puis on
 *   filtre `date.getUTCDay() === slot.dayOfWeek` côté code. Volume acceptable :
 *   au pire ~250 trainings/team/season (5 trainings/sem × 50 sem).
 *
 * Idempotence :
 *   - on ne cancel QUE des bookings encore `scheduled`. Un re-trigger ne
 *     re-cancellera pas les bookings déjà flippés.
 *   - la condition de transition `(before non-match) -> (after match)` court-
 *     circuite les re-runs sur un slot déjà match.
 *   - `actionLog` append-only : on accepte un doublon d'entrée en cas de retry
 *     bénin (trade-off identique à `applyClosurePeriod`).
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import * as admin from 'firebase-admin'
import { db } from '../shared/firestore'
import { logger } from '../shared/logger'

const MAX_OPS_PER_BATCH = 450

type SlotType = 'training' | 'match_home' | 'match_away' | 'reserve' | 'custom'

interface TimeSlotDoc {
  dayOfWeek: number
  startTime: string
  endTime: string
  label: string
  seasonId: string
  requiresFullCourt: boolean
  teamId: string | null
  slotType: SlotType
  customTypeName: string | null
  matchTypeId: string | null
  active: boolean
}

interface BookingDoc {
  seasonId: string
  teamId: string | null
  slotType: SlotType
  status: 'scheduled' | 'cancelled' | 'freed'
  date: FirebaseFirestore.Timestamp
}

const MATCH_TYPES: ReadonlySet<SlotType> = new Set<SlotType>([
  'match_home',
  'match_away',
])

export const handleMatchSlotChange = onDocumentWritten(
  'venues/{venueId}/courts/{courtId}/timeSlots/{slotId}',
  async (event) => {
    const venueId = event.params.venueId
    const courtId = event.params.courtId
    const slotId = event.params.slotId
    const before = event.data?.before?.data() as TimeSlotDoc | undefined
    const after = event.data?.after?.data() as TimeSlotDoc | undefined

    if (!after) {
      // Slot supprimé : pas de cascade ici (les bookings existants gardent
      // leur état ; l'admin gère via un autre flux).
      return
    }

    if (!MATCH_TYPES.has(after.slotType)) {
      return
    }

    // Re-update d'un slot DÉJÀ match : on no-op (idempotent).
    if (before && MATCH_TYPES.has(before.slotType)) {
      return
    }

    if (after.teamId == null) {
      logger.warn('handleMatchSlotChange: slot has no teamId, skipping', {
        venueId,
        courtId,
        slotId,
        slotType: after.slotType,
      })
      return
    }

    logger.info('handleMatchSlotChange: match slot detected', {
      venueId,
      courtId,
      slotId,
      slotType: after.slotType,
      teamId: after.teamId,
      seasonId: after.seasonId,
      dayOfWeek: after.dayOfWeek,
    })

    await cancelTrainingsConflictingWith({
      seasonId: after.seasonId,
      teamId: after.teamId,
      dayOfWeek: after.dayOfWeek,
      slotType: after.slotType as 'match_home' | 'match_away',
      sourceSlotId: slotId,
    })
  },
)

/**
 * Pure helper — `true` si un slot vient de transitionner vers un type match.
 * Exporté pour les tests.
 */
export function isTransitionToMatch(
  before: { slotType?: SlotType } | undefined,
  after: { slotType?: SlotType } | undefined,
): boolean {
  if (!after) return false
  if (!MATCH_TYPES.has(after.slotType as SlotType)) return false
  if (before && MATCH_TYPES.has(before.slotType as SlotType)) return false
  return true
}

/**
 * Cœur de la fonction — exporté pour testabilité. Query les training
 * bookings de la même équipe + même saison + `scheduled`, filtre par
 * `dayOfWeek` côté code, puis batch update vers `cancelled`.
 */
export async function cancelTrainingsConflictingWith(args: {
  seasonId: string
  teamId: string
  dayOfWeek: number
  slotType: 'match_home' | 'match_away'
  /** Origine de la cascade — loggé dans `actionLog.note` pour traçabilité. */
  sourceSlotId: string
}): Promise<{ cancelled: number }> {
  const firestore = db()
  const { seasonId, teamId, dayOfWeek, slotType, sourceSlotId } = args

  // Query large (sans `date`) car on n'a pas d'index sur `getUTCDay()`.
  const snap = await firestore
    .collection('bookings')
    .where('seasonId', '==', seasonId)
    .where('teamId', '==', teamId)
    .where('slotType', '==', 'training')
    .where('status', '==', 'scheduled')
    .get()

  if (snap.empty) {
    logger.info('handleMatchSlotChange: no scheduled trainings to cancel', {
      seasonId,
      teamId,
      dayOfWeek,
    })
    return { cancelled: 0 }
  }

  const toCancel: FirebaseFirestore.QueryDocumentSnapshot[] = []
  for (const docSnap of snap.docs) {
    const data = docSnap.data() as BookingDoc
    if (data.date.toDate().getUTCDay() !== dayOfWeek) continue
    toCancel.push(docSnap)
  }

  if (toCancel.length === 0) {
    logger.info('handleMatchSlotChange: no trainings match dayOfWeek', {
      seasonId,
      teamId,
      dayOfWeek,
      scanned: snap.size,
    })
    return { cancelled: 0 }
  }

  // NB: la table cancelReason canonique (docs/firebase.md) liste
  // "closure" | "holiday" | "manual" | "match_away" | "coach_cancel".
  // Pour `match_home` on stocke `slotType` tel quel afin de tracer l'origine
  // côté UI. Si l'écosystème de types se durcit plus tard, ce raison sera
  // ajouté au union (cf. report task).
  const cancelReason: 'match_home' | 'match_away' = slotType

  let batch = firestore.batch()
  let ops = 0
  for (const docSnap of toCancel) {
    batch.update(docSnap.ref, {
      status: 'cancelled',
      cancelReason,
      actionLog: admin.firestore.FieldValue.arrayUnion({
        at: admin.firestore.Timestamp.now(),
        by: 'system',
        action: 'match_slot_cancel',
        note: sourceSlotId,
      }),
    })
    ops += 1
    if (ops >= MAX_OPS_PER_BATCH) {
      await batch.commit()
      logger.info('handleMatchSlotChange: batch committed', {
        seasonId,
        teamId,
        size: ops,
      })
      batch = firestore.batch()
      ops = 0
    }
  }
  if (ops > 0) {
    await batch.commit()
    logger.info('handleMatchSlotChange: batch committed', {
      seasonId,
      teamId,
      size: ops,
    })
  }

  logger.info('handleMatchSlotChange: done', {
    seasonId,
    teamId,
    dayOfWeek,
    cancelled: toCancel.length,
  })
  return { cancelled: toCancel.length }
}
