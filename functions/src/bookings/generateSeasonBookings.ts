/**
 * Cloud Function — `generateSeasonBookings`.
 *
 * Trigger : Firestore `onDocumentWritten` sur `/seasons/{seasonId}`.
 * Déclenchement effectif : transition `status` `*` -> `active` ET `generatedAt == null`.
 *
 * Génère une instance `/bookings/{auto-id}` pour chaque (court actif × timeSlot actif
 * de la saison × date du calendrier matchant `dayOfWeek`) en excluant les dates qui
 * tombent dans une closure période rattachée à la saison.
 *
 * Idempotence — stratégie retenue : **doc IDs déterministes**
 *   `${seasonId}_${courtId}_${timeSlotId}_${YYYYMMDD}`.
 * `WriteBatch.set` est un upsert : un retrigger ou un crash mid-génération sera
 * rejoué sans dupliquer (les mêmes documents seront ré-écrits avec le même payload).
 * Le `generatedAt` final agit comme verrou côté condition de trigger : une fois
 * écrit, la condition `after.generatedAt == null` est fausse et la function exit
 * early. Cf. `docs/firebase.md` (section "Cloud Functions").
 *
 * Voir `docs/main.md` (section "Bookings") pour la sémantique métier.
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions/v2'
import * as admin from 'firebase-admin'
import {
  db,
  type SeasonDoc,
  type CourtDoc,
  type TimeSlotDoc,
  type ClosurePeriodDoc,
  type ClosureRange,
  closurePeriodToRange,
  dateRangeForDayOfWeek,
  isInsideClosure,
  deterministicBookingId,
  buildBookingPayload,
  utcMidnight,
} from './_helpers'

/** Firestore limite à 500 ops par batch. On reste sous la limite avec une marge. */
const MAX_OPS_PER_BATCH = 450

export const generateSeasonBookings = onDocumentWritten(
  'seasons/{seasonId}',
  async (event) => {
    const seasonId = event.params.seasonId
    const before = event.data?.before?.data() as SeasonDoc | undefined
    const after = event.data?.after?.data() as SeasonDoc | undefined

    // Doc supprimé : rien à faire.
    if (!after) {
      logger.info('generateSeasonBookings: season deleted, skipping', { seasonId })
      return
    }

    // Condition de trigger : transition vers `active` ET pas déjà généré.
    const wasActive = before?.status === 'active'
    const isActive = after.status === 'active'
    if (!isActive) {
      return
    }
    if (wasActive) {
      // Re-update sur une saison déjà active : on ne régénère pas. La regen
      // se fait par un autre flux (admin force).
      return
    }
    if (after.generatedAt != null) {
      logger.info('generateSeasonBookings: generatedAt already set, idempotent skip', {
        seasonId,
      })
      return
    }

    await runGeneration(seasonId, after)
  },
)

/**
 * Cœur de la génération. Exporté pour testabilité.
 */
export async function runGeneration(seasonId: string, season: SeasonDoc): Promise<{
  totalBookings: number
  byCourt: Record<string, number>
}> {
  const firestore = db()
  logger.info('generateSeasonBookings: starting', {
    seasonId,
    venueCount: season.activeVenueIds.length,
    closureCount: season.closurePeriodIds.length,
  })

  // 1. Charger les closure periods de la saison.
  const closures = await loadClosures(firestore, season.closurePeriodIds)
  logger.info('generateSeasonBookings: closures loaded', {
    seasonId,
    closureCount: closures.length,
  })

  const startDate = season.startDate.toDate()
  const endDate = season.endDate.toDate()
  const totalsByCourt: Record<string, number> = {}
  let totalBookings = 0

  // 2. Itérer venues -> courts actifs -> timeSlots actifs de la saison.
  const pendingWrites: Array<{
    docPath: string
    payload: ReturnType<typeof buildBookingPayload>
  }> = []

  for (const venueId of season.activeVenueIds) {
    const courtsSnap = await firestore
      .collection('venues')
      .doc(venueId)
      .collection('courts')
      .where('active', '==', true)
      .get()

    for (const courtDoc of courtsSnap.docs) {
      const courtId = courtDoc.id
      const court = courtDoc.data() as CourtDoc
      const slotsSnap = await firestore
        .collection('venues')
        .doc(venueId)
        .collection('courts')
        .doc(courtId)
        .collection('timeSlots')
        .where('seasonId', '==', seasonId)
        .where('active', '==', true)
        .get()

      for (const slotDoc of slotsSnap.docs) {
        const timeSlotId = slotDoc.id
        const slot = slotDoc.data() as TimeSlotDoc
        const dates = dateRangeForDayOfWeek(startDate, endDate, slot.dayOfWeek)
        for (const d of dates) {
          if (isInsideClosure(d.getTime(), closures)) {
            continue
          }
          const bookingId = deterministicBookingId({
            seasonId,
            courtId,
            timeSlotId,
            date: d,
          })
          const ts = admin.firestore.Timestamp.fromDate(
            utcMidnight(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
          )
          const payload = buildBookingPayload(
            {
              seasonId,
              venueId,
              courtId,
              timeSlotId,
              teamId: slot.teamId,
              slotType: slot.slotType,
              matchTypeId: slot.matchTypeId,
              startTime: slot.startTime,
              endTime: slot.endTime,
              date: d,
              isCombinedCourtEvent: court.isCombined ?? false,
            },
            ts,
          )
          pendingWrites.push({ docPath: `bookings/${bookingId}`, payload })
          totalsByCourt[courtId] = (totalsByCourt[courtId] ?? 0) + 1
          totalBookings += 1
        }
      }
    }
  }

  logger.info('generateSeasonBookings: bookings computed', {
    seasonId,
    totalBookings,
    courtCount: Object.keys(totalsByCourt).length,
  })

  // 3. Flush en batches < 500.
  for (let i = 0; i < pendingWrites.length; i += MAX_OPS_PER_BATCH) {
    const slice = pendingWrites.slice(i, i + MAX_OPS_PER_BATCH)
    const batch = firestore.batch()
    for (const w of slice) {
      batch.set(firestore.doc(w.docPath), w.payload)
    }
    await batch.commit()
    logger.info('generateSeasonBookings: batch committed', {
      seasonId,
      from: i,
      size: slice.length,
    })
  }

  // 4. Marquer la saison comme générée (verrou idempotence côté trigger).
  await firestore.collection('seasons').doc(seasonId).update({
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  logger.info('generateSeasonBookings: done', {
    seasonId,
    totalBookings,
  })

  return { totalBookings, byCourt: totalsByCourt }
}

async function loadClosures(
  firestore: FirebaseFirestore.Firestore,
  ids: readonly string[],
): Promise<ClosureRange[]> {
  if (ids.length === 0) {
    return []
  }
  const refs = ids.map((id) => firestore.collection('closurePeriods').doc(id))
  const snaps = await firestore.getAll(...refs)
  const out: ClosureRange[] = []
  for (const snap of snaps) {
    if (!snap.exists) {
      logger.warn('generateSeasonBookings: closurePeriod not found, skipping', {
        closurePeriodId: snap.id,
      })
      continue
    }
    const data = snap.data() as ClosurePeriodDoc
    out.push(closurePeriodToRange(snap.id, data))
  }
  return out
}
