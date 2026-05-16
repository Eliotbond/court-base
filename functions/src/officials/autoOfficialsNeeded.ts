/**
 * `autoOfficialsNeededNotification`
 *
 * Daily scheduled function (08:00 europe-west6, runs after the dues schedules
 * at 06:00/07:00). Scans upcoming matches within the next 7 days and creates
 * an `officials_needed` notification when a match is under-staffed — covering
 * BOTH home and away matches.
 *
 * Logic (see docs/main.md "Officials" + docs/firebase.md table):
 *   HOME — query `/bookings` where `slotType == 'match_home'`,
 *     `status == 'scheduled'`, `date` in [now, now + 7d]. Required officials
 *     come from `matchType.homeOfficialRequirements` (per-level). Assignments
 *     live in `/bookings/{id}/officialAssignments`.
 *   AWAY — query `/matches` on the `date` window (single-field range, no
 *     composite index), then filter `kind == 'away'` + `status == 'scheduled'`
 *     in JS (`/matches` over a 7-day window is a small set). Required
 *     officials come from `matchType.awayOfficialCount` (flat total).
 *     Assignments live in `/matches/{id}/officialAssignments`.
 *   For every under-staffed match: dedupe against the last 24 h of
 *   `/notifications` (`relatedBookingId` for home, `relatedMatchId` for away,
 *   `type == 'officials_needed'`); create a fresh notification if none.
 *
 * Idempotence : guaranteed by the 24 h dedupe lookup. A re-run within the
 * same day will find the freshly-created doc and skip.
 *
 * Performance : iterations are sequential per match — sub-collection reads
 * cannot be batched via a single Firestore query (no collection-group index
 * defined for `officialAssignments`). 7 days of matches is a small set in
 * practice; this is acceptable.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler'

import { logger } from '../shared/logger'
import type {
  BookingData,
  MatchData,
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

/**
 * Required officials for an AWAY match — `matchType.awayOfficialCount` is a
 * flat total (no per-level breakdown). Clamps to a non-negative integer so a
 * misconfigured / missing value degrades to "no officials required".
 * Exposed for unit-testing.
 */
export function computeRequiredAwayOfficials(
  count: MatchTypeData['awayOfficialCount'] | undefined,
): number {
  return Number.isFinite(count) && (count as number) > 0
    ? Math.floor(count as number)
    : 0
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
  const dateForBody = formatEventDate(booking.date, booking.startTime)
  const notification: Omit<NotificationData, 'createdAt'> & {
    createdAt: FirebaseFirestore.FieldValue
  } = {
    type: 'officials_needed',
    title: 'Officials needed',
    body: `${missingCount} official${missingCount > 1 ? 's' : ''} still needed for ${dateForBody}`,
    sentBy: null,
    targetAudience: 'unassigned_officials',
    relatedBookingId: bookingId,
    // A home match_home booking carries `matchId` once a match is attached —
    // link the notification to the match entity too when available.
    relatedMatchId: booking.matchId ?? null,
    createdAt: serverTimestamp(),
    readBy: [],
  }
  await col<NotificationData>('notifications').add(notification)
  return true
}

/**
 * Format an event date for the notification body. Falls back to a generic
 * label if the timestamp is missing. Keeps the message human but
 * deterministic enough to be greppable in logs. Shared by the home (booking)
 * and away (match) paths.
 */
function formatEventDate(
  // `BookingData['date']` et `MatchData['date']` sont tous deux des `Timestamp`.
  date: BookingData['date'],
  startTime: string | undefined,
): string {
  const ts = date as unknown as FirebaseFirestore.Timestamp | null
  if (!ts || typeof ts.toDate !== 'function') {
    return 'upcoming match'
  }
  const d = ts.toDate()
  // YYYY-MM-DD HH:MM — UTC representation is fine for an internal notification.
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const datePart = `${yyyy}-${mm}-${dd}`
  const timePart = startTime ? ` ${startTime}` : ''
  return `${datePart}${timePart}`
}

/**
 * Process a single AWAY match — the away counterpart of
 * `processBookingForOfficialsNeeded`. Away matches have no booking: their
 * `officialAssignments` live on `/matches/{matchId}` and the requirement is
 * `matchType.awayOfficialCount` (flat total).
 *
 * Returns `true` if a notification was created, `false` otherwise.
 */
export async function processAwayMatchForOfficialsNeeded(
  matchId: string,
  match: MatchData,
  deps: BookingProcessingDeps,
): Promise<boolean> {
  if (!match.matchTypeId) {
    logger.warn('autoOfficialsNeeded: away match with no matchTypeId', {
      matchId,
    })
    return false
  }

  // 1. Load match type.
  const matchTypeSnap = await db().doc(`matchTypes/${match.matchTypeId}`).get()
  if (!matchTypeSnap.exists) {
    logger.warn('autoOfficialsNeeded: matchType not found (away match)', {
      matchId,
      matchTypeId: match.matchTypeId,
    })
    return false
  }
  const matchType = matchTypeSnap.data() as MatchTypeData
  const requiredCount = computeRequiredAwayOfficials(matchType.awayOfficialCount)
  if (requiredCount <= 0) {
    // Match type explicitly requires no away officials.
    return false
  }

  // 2. Count current assignments that occupy a slot — on the match doc.
  const assignmentsSnap = await subcol<OfficialAssignmentData>(
    `matches/${matchId}`,
    'officialAssignments',
  ).get()
  const filledCount = assignmentsSnap.docs.reduce((acc, snap) => {
    const status = snap.data().status
    return SLOT_OCCUPYING_STATUSES.includes(status) ? acc + 1 : acc
  }, 0)
  if (filledCount >= requiredCount) {
    return false
  }

  // 3. Dedupe: last 24 h of notifications for this match (`relatedMatchId`).
  const cutoff = addHoursToTimestamp(deps.now, -24)
  const dedupeSnap = await col<NotificationData>('notifications')
    .where('relatedMatchId', '==', matchId)
    .where('type', '==', 'officials_needed')
    .where('createdAt', '>', cutoff)
    .limit(1)
    .get()
  if (!dedupeSnap.empty) {
    return false
  }

  // 4. Create the notification.
  const missingCount = requiredCount - filledCount
  const dateForBody = formatEventDate(match.date, match.startTime)
  const notification: Omit<NotificationData, 'createdAt'> & {
    createdAt: FirebaseFirestore.FieldValue
  } = {
    type: 'officials_needed',
    title: 'Officials needed',
    body: `${missingCount} official${missingCount > 1 ? 's' : ''} still needed for away match on ${dateForBody}`,
    sentBy: null,
    targetAudience: 'unassigned_officials',
    // Away matches have no booking — only the match reference.
    relatedBookingId: null,
    relatedMatchId: matchId,
    createdAt: serverTimestamp(),
    readBy: [],
  }
  await col<NotificationData>('notifications').add(notification)
  return true
}

/**
 * Core handler — exposed for unit-testing without invoking the v2 scheduler
 * wrapper. The scheduled export below is a thin shim that calls this.
 */
export async function runAutoOfficialsNeeded(
  now: FirebaseFirestore.Timestamp = timestampFromDate(new Date()),
): Promise<{ scanned: number; notified: number }> {
  const horizon = addDaysToTimestamp(now, 7)
  let scanned = 0
  let notified = 0

  // --- HOME : match_home bookings -----------------------------------------
  const bookingsSnap = await col<BookingData>('bookings')
    .where('slotType', '==', 'match_home')
    .where('status', '==', 'scheduled')
    .where('date', '>=', now)
    .where('date', '<=', horizon)
    .get()
  for (const docSnap of bookingsSnap.docs) {
    scanned += 1
    const created = await processBookingForOfficialsNeeded(
      docSnap.id,
      docSnap.data(),
      { now },
    )
    if (created) notified += 1
  }

  // --- AWAY : matches with kind='away' ------------------------------------
  // Range query on `date` only (no composite index needed) — `kind`/`status`
  // are filtered in JS since `/matches` over a 7-day window is a small set
  // (cf. CLAUDE.md règle 10 : petit volume → query simple + filtre JS).
  const matchesSnap = await col<MatchData>('matches')
    .where('date', '>=', now)
    .where('date', '<=', horizon)
    .get()
  for (const docSnap of matchesSnap.docs) {
    const match = docSnap.data()
    if (match.kind !== 'away' || match.status !== 'scheduled') continue
    scanned += 1
    const created = await processAwayMatchForOfficialsNeeded(
      docSnap.id,
      match,
      { now },
    )
    if (created) notified += 1
  }

  logger.info('autoOfficialsNeeded: scan complete', { scanned, notified })
  return { scanned, notified }
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
