/**
 * Cloud Function — `previewSeasonBookings`.
 *
 * Callable dry-run de `generateSeasonBookings`. Réplique la même logique
 * d'itération (venues → courts actifs → timeSlots actifs × dates × closures)
 * mais **n'écrit rien**. Retourne uniquement des compteurs.
 *
 * Auth : `rootAdmin` (custom claim) OU rôle `admin` dans `/users/{uid}`.
 * Cf. `docs/firebase.md` section "Security rules".
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
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
} from './_helpers'

interface PreviewInput {
  seasonId: string
}

export interface PreviewOutput {
  count: number
  byCourt: Record<string, number>
  /** Index 0 = Sunday, ..., 6 = Saturday. */
  byDayOfWeek: number[]
}

export const previewSeasonBookings = onCall(
  async (request: CallableRequest<PreviewInput>): Promise<PreviewOutput> => {
    await assertCallerIsAdmin(request)

    const data = request.data ?? ({} as Partial<PreviewInput>)
    const seasonId = data.seasonId
    if (typeof seasonId !== 'string' || seasonId.length === 0) {
      throw new HttpsError('invalid-argument', '`seasonId` must be a non-empty string.')
    }

    return computePreview(seasonId)
  },
)

/**
 * Cœur du dry-run — séparé pour permettre des tests unitaires sans passer par
 * la couche `onCall` (auth, runtime CallableRequest).
 */
export async function computePreview(seasonId: string): Promise<PreviewOutput> {
  const firestore = db()
  const seasonSnap = await firestore.collection('seasons').doc(seasonId).get()
  if (!seasonSnap.exists) {
    throw new HttpsError('not-found', `Season ${seasonId} not found.`)
  }
  const season = seasonSnap.data() as SeasonDoc

  const closures = await loadClosures(firestore, season.closurePeriodIds)

  const startDate = season.startDate.toDate()
  const endDate = season.endDate.toDate()

  const byCourt: Record<string, number> = {}
  const byDayOfWeek: number[] = [0, 0, 0, 0, 0, 0, 0]
  let count = 0

  for (const venueId of season.activeVenueIds) {
    const courtsSnap = await firestore
      .collection('venues')
      .doc(venueId)
      .collection('courts')
      .where('active', '==', true)
      .get()

    for (const courtDoc of courtsSnap.docs) {
      const courtId = courtDoc.id
      // courtDoc.data() lu pour valider la forme ; pas nécessaire en preview.
      void (courtDoc.data() as CourtDoc)
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
        const slot = slotDoc.data() as TimeSlotDoc
        const dates = dateRangeForDayOfWeek(startDate, endDate, slot.dayOfWeek)
        for (const d of dates) {
          if (isInsideClosure(d.getTime(), closures)) {
            continue
          }
          byCourt[courtId] = (byCourt[courtId] ?? 0) + 1
          const dow = d.getUTCDay()
          byDayOfWeek[dow] = (byDayOfWeek[dow] ?? 0) + 1
          count += 1
        }
      }
    }
  }

  logger.info('previewSeasonBookings: computed', {
    seasonId,
    count,
    courtCount: Object.keys(byCourt).length,
  })

  return { count, byCourt, byDayOfWeek }
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
      continue
    }
    out.push(closurePeriodToRange(snap.id, snap.data() as ClosurePeriodDoc))
  }
  return out
}

interface UserDocLike {
  roles?: string[]
}

async function assertCallerIsAdmin(request: CallableRequest<PreviewInput>): Promise<void> {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in.')
  }
  if (request.auth.token.rootAdmin === true) {
    return
  }
  const uid = request.auth.uid
  const userSnap = await db().collection('users').doc(uid).get()
  if (!userSnap.exists) {
    throw new HttpsError('permission-denied', 'Caller has no /users mirror; access denied.')
  }
  const user = userSnap.data() as UserDocLike | undefined
  const roles = Array.isArray(user?.roles) ? user!.roles : []
  if (!roles.includes('admin')) {
    throw new HttpsError(
      'permission-denied',
      'previewSeasonBookings requires admin or rootAdmin.',
    )
  }
}
