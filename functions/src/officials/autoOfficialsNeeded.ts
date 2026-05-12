/**
 * `autoOfficialsNeededNotification`
 *
 * Daily scheduled function (08:00 europe-west6, runs after the dues schedules
 * at 06:00/07:00). Scans upcoming `match_home` bookings within the next 7 days
 * and creates an `officials_needed` notification when the booking is
 * under-staffed.
 *
 * Logic (see docs/main.md "Officials" + docs/firebase.md table):
 *   1. Query `/bookings` where `slotType == 'match_home'`,
 *      `status == 'scheduled'`, `date >= now`, `date <= now + 7d`.
 *   2. For each booking:
 *        - load its `matchType` (skip with warning if missing or
 *          slot-data-only — no matchTypeId).
 *        - sum `homeOfficialRequirements[].count` -> requiredCount.
 *        - read `officialAssignments` sub-collection and count entries with
 *          `status in ('pending', 'confirmed')` -> filledCount.
 *        - if filledCount >= requiredCount → fully staffed, skip.
 *        - else look up the last 24 h of `/notifications` filtered by
 *          `relatedBookingId == bookingId` and `type == 'officials_needed'`.
 *          If a doc exists → already notified, skip (dedupe).
 *        - else create a fresh notification.
 *
 * Idempotence : guaranteed by the 24 h dedupe lookup. A re-run within the
 * same day will find the freshly-created doc and skip.
 *
 * Performance : iterations are sequential per booking — sub-collection reads
 * cannot be batched across bookings via a single Firestore query (no
 * collection-group index defined for `officialAssignments`). 7 days of
 * `match_home` events is a small set in practice; this is acceptable.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler'

import { logger } from '../shared/logger'
import type {
  BookingData,
  MatchTypeData,
  NotificationData,
  OfficialAssignmentData,
} from './_types'
import {
  Timestamp,
  addDaysToTimestamp,
  addHoursToTimestamp,
  col,
  db,
  serverTimestamp,
  subcol,
  timestampFromDate,
} from './_helpers'

/** Statuses that occupy an officials slot (i.e. count toward "filled"). */
const SLOT_OCCUPYING_STATUSES: ReadonlyArray<OfficialAssignmentData['status']> = [
  'pending',
  'confirmed',
]

/**
 * Compute required officials from a `MatchType.homeOfficialRequirements`.
 * Exposed for unit-testing the pure math separate from Firestore plumbing.
 */
export function computeRequiredOfficials(
  reqs: MatchTypeData['homeOfficialRequirements'],
): number {
  return reqs.reduce(
    (acc, r) => acc + (Number.isFinite(r.count) && r.count > 0 ? r.count : 0),
    0,
  )
}

interface BookingProcessingDeps {
  /** Used to compute "now" deterministically in tests. */
  now: FirebaseFirestore.Timestamp
}

/**
 * Process a single booking — orchestrates: matchType load, assignment count,
 * dedupe lookup, and (if applicable) notification create. Pulled out of the
 * scheduled handler so unit tests can drive it without mocking onSchedule.
 *
 * Returns `true` if a notification was created, `false` otherwise (skipped
 * for any reason — fully staffed, dedupe hit, missing matchType, etc.).
 */
export async function processBookingForOfficialsNeeded(
  bookingId: string,
  booking: BookingData,
  deps: BookingProcessingDeps,
): Promise<boolean> {
  if (!booking.matchTypeId) {
    logger.warn('autoOfficialsNeeded: match_home booking with no matchTypeId', {
      bookingId,
    })
    return false
  }

  // 1. Load match type.
  const matchTypeSnap = await db().doc(`matchTypes/${booking.matchTypeId}`).get()
  if (!matchTypeSnap.exists) {
    logger.warn('autoOfficialsNeeded: matchType not found', {
      bookingId,
      matchTypeId: booking.matchTypeId,
    })
    return false
  }
  const matchType = matchTypeSnap.data() as MatchTypeData
  const requiredCount = computeRequiredOfficials(matchType.homeOfficialRequirements)
  if (requiredCount <= 0) {
    // Match type explicitly requires no officials.
    return false
  }

  // 2. Count current assignments that occupy a slot.
  const assignmentsSnap = await subcol<OfficialAssignmentData>(
    `bookings/${bookingId}`,
    'officialAssignments',
  ).get()
  const filledCount = assignmentsSnap.docs.reduce((acc, snap) => {
    const status = snap.data().status
    return SLOT_OCCUPYING_STATUSES.includes(status) ? acc + 1 : acc
  }, 0)
  if (filledCount >= requiredCount) {
    return false
  }

  // 3. Dedupe: look up the last 24 h of notifications for this booking.
  const cutoff = addHoursToTimestamp(deps.now, -24)
  const dedupeSnap = await col<NotificationData>('notifications')
    .where('relatedBookingId', '==', bookingId)
    .where('type', '==', 'officials_needed')
    .where('createdAt', '>', cutoff)
    .limit(1)
    .get()
  if (!dedupeSnap.empty) {
    return false
  }

  // 4. Create the notification.
  const missingCount = requiredCount - filledCount
  const dateForBody = formatBookingDate(booking)
  const notification: Omit<NotificationData, 'createdAt'> & {
    createdAt: FirebaseFirestore.FieldValue
  } = {
    type: 'officials_needed',
    title: 'Officials needed',
    body: `${missingCount} official${missingCount > 1 ? 's' : ''} still needed for ${dateForBody}`,
    sentBy: null,
    targetAudience: 'unassigned_officials',
    relatedBookingId: bookingId,
    createdAt: serverTimestamp(),
    readBy: [],
  }
  await col<NotificationData>('notifications').add(
    notification as unknown as NotificationData,
  )
  return true
}

/**
 * Format the booking date for the notification body. Falls back to ISO if
 * `startTime` is missing. Keeps the message human but deterministic enough
 * to be greppable in logs.
 */
function formatBookingDate(booking: BookingData): string {
  const ts = booking.date as unknown as FirebaseFirestore.Timestamp | null
  if (!ts || typeof ts.toDate !== 'function') {
    return 'upcoming match'
  }
  const d = ts.toDate()
  // YYYY-MM-DD HH:MM — UTC representation is fine for an internal notification.
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const datePart = `${yyyy}-${mm}-${dd}`
  const timePart = booking.startTime ? ` ${booking.startTime}` : ''
  return `${datePart}${timePart}`
}

/**
 * Core handler — exposed for unit-testing without invoking the v2 scheduler
 * wrapper. The scheduled export below is a thin shim that calls this.
 */
export async function runAutoOfficialsNeeded(
  now: FirebaseFirestore.Timestamp = timestampFromDate(new Date()),
): Promise<{ scanned: number; notified: number }> {
  const horizon = addDaysToTimestamp(now, 7)
  const snap = await col<BookingData>('bookings')
    .where('slotType', '==', 'match_home')
    .where('status', '==', 'scheduled')
    .where('date', '>=', now)
    .where('date', '<=', horizon)
    .get()

  if (snap.empty) {
    logger.info('autoOfficialsNeeded: no upcoming match_home bookings in window')
    return { scanned: 0, notified: 0 }
  }

  let notified = 0
  for (const docSnap of snap.docs) {
    const created = await processBookingForOfficialsNeeded(
      docSnap.id,
      docSnap.data(),
      { now },
    )
    if (created) notified += 1
  }
  logger.info('autoOfficialsNeeded: scan complete', {
    scanned: snap.size,
    notified,
  })
  return { scanned: snap.size, notified }
}

export const autoOfficialsNeededNotification = onSchedule(
  {
    schedule: '0 8 * * *',
    timeZone: 'Europe/Zurich',
  },
  async () => {
    await runAutoOfficialsNeeded(Timestamp.now())
  },
)
