/**
 * `matchReminders`
 *
 * Hourly scheduled function (`0 * * * *`, Europe/Zurich). One function covers
 * the two reminder windows documented in `docs/main.md` ("Officials"):
 *
 *   - **J-1 23:00** — for matches happening tomorrow. We only fire this when
 *     the current run is the 23:00 hour in Europe/Zurich; other hourly runs
 *     skip the J-1 sweep. Matches `[tomorrow 00:00, tomorrow 23:59:59]`
 *     against the `date` field.
 *   - **H-2** — for matches starting in roughly two hours. The hourly cron
 *     granularity means we accept anything in `[now + 1h45m, now + 2h15m]`
 *     so that — given the scheduler isn't second-accurate — the match is
 *     always caught exactly once. (A booking starts at, say, 18:00 → it will
 *     fall into the 16:00 run's window.)
 *
 * Per booking, we emit **one** notification with
 * `targetAudience: 'assigned_officials'` (cheaper than fanning out per
 * assignment, matches the schema, and the FCM/in-app layer is responsible
 * for routing the message to the right uids). We still read the
 * `officialAssignments` sub-collection — if there's no `confirmed` official
 * we skip (no point reminding an empty roster).
 *
 * Dedupe :
 *   - J-1   → look back 24 h (one reminder per booking per day).
 *   - H-2   → look back 2 h  (covers boundary cases where the booking sits
 *             in two adjacent windows after we widened the H-2 tolerance).
 *
 * Idempotence : the dedupe lookup makes re-runs no-ops within their window.
 */
import { onSchedule, type ScheduledEvent } from 'firebase-functions/v2/scheduler'

import { logger } from '../shared/logger'
import type {
  BookingData,
  NotificationData,
  OfficialAssignmentData,
} from './_types'
import {
  Timestamp,
  addHoursToTimestamp,
  addMinutesToTimestamp,
  col,
  serverTimestamp,
  subcol,
  timestampFromDate,
} from './_helpers'

/** How many hours back we look when deduping notifications. */
const DEDUPE_HOURS_J1 = 24
const DEDUPE_HOURS_H2 = 2

/** H-2 tolerance window — 15 min either side of the centre (now + 2 h). */
const H2_TOLERANCE_MINUTES = 15

/** The hour-of-day (Europe/Zurich) at which we run the J-1 sweep. */
const J1_TRIGGER_HOUR_ZURICH = 23

/**
 * Returns the hour of the day (0–23) in Europe/Zurich for the given UTC
 * timestamp. We use `Intl.DateTimeFormat` so DST shifts are handled by the
 * runtime ICU data — no hand-rolled offset math.
 */
export function hourInZurich(now: FirebaseFirestore.Timestamp): number {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    hour12: false,
    timeZone: 'Europe/Zurich',
  })
  const parts = fmt.formatToParts(now.toDate())
  const hourPart = parts.find((p) => p.type === 'hour')
  const parsed = hourPart ? Number.parseInt(hourPart.value, 10) : Number.NaN
  if (!Number.isFinite(parsed)) {
    // Fallback to UTC hour — better than crashing.
    return now.toDate().getUTCHours()
  }
  // "24" can show up in some locales when hour12=false; collapse to 0.
  return parsed === 24 ? 0 : parsed
}

/**
 * Compute the J-1 window: from the start of tomorrow (Zurich) to the start
 * of the day after tomorrow (Zurich), expressed as UTC Timestamps. We don't
 * care about the time-of-day inside the matched bookings — only the calendar
 * day.
 */
export function tomorrowDayWindowZurich(now: FirebaseFirestore.Timestamp): {
  start: FirebaseFirestore.Timestamp
  end: FirebaseFirestore.Timestamp
} {
  // Get the date parts (Y-M-D) in Zurich for "now + 24h" to obtain
  // tomorrow's calendar date deterministically.
  const tomorrowDate = addHoursToTimestamp(now, 24).toDate()
  const fmt = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Europe/Zurich',
  })
  const parts = fmt.formatToParts(tomorrowDate)
  const y = parts.find((p) => p.type === 'year')?.value
  const m = parts.find((p) => p.type === 'month')?.value
  const d = parts.find((p) => p.type === 'day')?.value
  if (!y || !m || !d) {
    // Defensive fallback — should never happen.
    const fallbackStart = addHoursToTimestamp(now, 24)
    return {
      start: fallbackStart,
      end: addHoursToTimestamp(fallbackStart, 24),
    }
  }
  // We construct midnight UTC of `tomorrow`. The `date` field on bookings is
  // stored as a midnight-UTC Timestamp at generation time (see
  // `bookings/generateSeasonBookings.ts`). Using UTC here avoids straddling
  // the Zurich/UTC boundary in the comparison.
  const startUtcSeconds =
    Math.floor(
      Date.UTC(
        Number.parseInt(y, 10),
        Number.parseInt(m, 10) - 1,
        Number.parseInt(d, 10),
        0,
        0,
        0,
      ) / 1000,
    )
  const start = new Timestamp(startUtcSeconds, 0)
  const end = new Timestamp(startUtcSeconds + 24 * 3600, 0)
  return { start, end }
}

/**
 * Build the H-2 window: [now + (2h - tolerance), now + (2h + tolerance)].
 */
export function h2Window(now: FirebaseFirestore.Timestamp): {
  start: FirebaseFirestore.Timestamp
  end: FirebaseFirestore.Timestamp
} {
  const centre = addHoursToTimestamp(now, 2)
  return {
    start: addMinutesToTimestamp(centre, -H2_TOLERANCE_MINUTES),
    end: addMinutesToTimestamp(centre, H2_TOLERANCE_MINUTES),
  }
}

interface ReminderContext {
  kind: 'j1' | 'h2'
  /** Lookback window for dedupe. */
  dedupeCutoff: FirebaseFirestore.Timestamp
}

/**
 * Combine the booking date (midnight UTC) with the `startTime` ("HH:MM") to
 * obtain an absolute UTC Timestamp for the match start. Used by the H-2
 * filter to keep only bookings whose real start time falls inside the window
 * (the Firestore query is on `date` which is day-granular only).
 */
function bookingStartTimestamp(
  booking: BookingData,
): FirebaseFirestore.Timestamp | null {
  const ts = booking.date as unknown as FirebaseFirestore.Timestamp | null
  if (!ts || typeof ts.toDate !== 'function') return null
  const [hh, mm] = (booking.startTime ?? '00:00').split(':')
  const hours = Number.parseInt(hh ?? '0', 10) || 0
  const minutes = Number.parseInt(mm ?? '0', 10) || 0
  const seconds = ts.seconds + hours * 3600 + minutes * 60
  return new Timestamp(seconds, ts.nanoseconds)
}

/**
 * Emit a `match_reminder` notification for a single booking, after checking
 * the dedupe window and confirming at least one official is `confirmed`.
 *
 * Returns `true` when a notification was created.
 */
export async function emitMatchReminderForBooking(
  bookingId: string,
  booking: BookingData,
  ctx: ReminderContext,
): Promise<boolean> {
  const assignmentsSnap = await subcol<OfficialAssignmentData>(
    `bookings/${bookingId}`,
    'officialAssignments',
  ).get()
  const confirmedCount = assignmentsSnap.docs.reduce(
    (acc, snap) => (snap.data().status === 'confirmed' ? acc + 1 : acc),
    0,
  )
  if (confirmedCount === 0) {
    return false
  }

  // Dedupe.
  const dedupeSnap = await col<NotificationData>('notifications')
    .where('relatedBookingId', '==', bookingId)
    .where('type', '==', 'match_reminder')
    .where('createdAt', '>', ctx.dedupeCutoff)
    .limit(1)
    .get()
  if (!dedupeSnap.empty) {
    return false
  }

  const dateForBody = formatBookingDateTime(booking)
  const titleSuffix = ctx.kind === 'j1' ? '(J-1)' : '(in 2h)'
  const notification: Omit<NotificationData, 'createdAt'> & {
    createdAt: FirebaseFirestore.FieldValue
  } = {
    type: 'match_reminder',
    title: `Match reminder ${titleSuffix}`,
    body: `Reminder: match on ${dateForBody}`,
    sentBy: null,
    targetAudience: 'assigned_officials',
    relatedBookingId: bookingId,
    relatedMatchId: booking.matchId ?? null,
    createdAt: serverTimestamp(),
    readBy: [],
    pushedAt: null,
  }
  await col<NotificationData>('notifications').add(
    notification as unknown as NotificationData,
  )
  return true
}

function formatBookingDateTime(booking: BookingData): string {
  const ts = booking.date as unknown as FirebaseFirestore.Timestamp | null
  if (!ts || typeof ts.toDate !== 'function') {
    return 'upcoming match'
  }
  const d = ts.toDate()
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const datePart = `${yyyy}-${mm}-${dd}`
  const timePart = booking.startTime ? ` at ${booking.startTime}` : ''
  return `${datePart}${timePart}`
}

/**
 * Run the J-1 sweep: every booking with `date` falling in tomorrow's Zurich
 * day gets a single reminder. Only invoked at the 23:00 hourly tick.
 */
async function runJ1Sweep(now: FirebaseFirestore.Timestamp): Promise<number> {
  const { start, end } = tomorrowDayWindowZurich(now)
  const snap = await col<BookingData>('bookings')
    .where('slotType', '==', 'match_home')
    .where('status', '==', 'scheduled')
    .where('date', '>=', start)
    .where('date', '<', end)
    .get()
  if (snap.empty) {
    logger.info('matchReminders.J1: no bookings tomorrow')
    return 0
  }
  const ctx: ReminderContext = {
    kind: 'j1',
    dedupeCutoff: addHoursToTimestamp(now, -DEDUPE_HOURS_J1),
  }
  let emitted = 0
  for (const docSnap of snap.docs) {
    const created = await emitMatchReminderForBooking(
      docSnap.id,
      docSnap.data(),
      ctx,
    )
    if (created) emitted += 1
  }
  logger.info('matchReminders.J1: sweep complete', {
    scanned: snap.size,
    emitted,
  })
  return emitted
}

/**
 * Run the H-2 sweep: bookings whose `date+startTime` falls in
 * [now+1h45m, now+2h15m].
 *
 * Firestore can't filter on a derived "date+startTime" composite, so we
 * first widen the `date` filter to a one-day window (matches happening any
 * time today/tomorrow within 24 h of the H-2 centre) and then narrow client-
 * side using the actual start datetime.
 */
async function runH2Sweep(now: FirebaseFirestore.Timestamp): Promise<number> {
  const { start: winStart, end: winEnd } = h2Window(now)
  // Day window: from one day before winStart to one day after winEnd. The
  // booking `date` is midnight UTC, so we only need a small wrapping window.
  const dayStart = addHoursToTimestamp(winStart, -24)
  const dayEnd = addHoursToTimestamp(winEnd, 24)
  const snap = await col<BookingData>('bookings')
    .where('slotType', '==', 'match_home')
    .where('status', '==', 'scheduled')
    .where('date', '>=', dayStart)
    .where('date', '<=', dayEnd)
    .get()
  if (snap.empty) {
    logger.info('matchReminders.H2: no candidate bookings in day window')
    return 0
  }
  const ctx: ReminderContext = {
    kind: 'h2',
    dedupeCutoff: addHoursToTimestamp(now, -DEDUPE_HOURS_H2),
  }
  let emitted = 0
  let inWindow = 0
  for (const docSnap of snap.docs) {
    const booking = docSnap.data()
    const startTs = bookingStartTimestamp(booking)
    if (!startTs) continue
    if (
      startTs.seconds < winStart.seconds ||
      startTs.seconds > winEnd.seconds
    ) {
      continue
    }
    inWindow += 1
    const created = await emitMatchReminderForBooking(
      docSnap.id,
      booking,
      ctx,
    )
    if (created) emitted += 1
  }
  logger.info('matchReminders.H2: sweep complete', {
    scanned: snap.size,
    inWindow,
    emitted,
  })
  return emitted
}

/**
 * Core handler — exposed for unit tests. Decides which sweep(s) to run based
 * on the current hour in Zurich.
 */
export async function runMatchReminders(
  now: FirebaseFirestore.Timestamp = timestampFromDate(new Date()),
): Promise<{ j1: number; h2: number }> {
  const hour = hourInZurich(now)
  const j1 = hour === J1_TRIGGER_HOUR_ZURICH ? await runJ1Sweep(now) : 0
  const h2 = await runH2Sweep(now)
  return { j1, h2 }
}

export const matchReminders = onSchedule(
  {
    schedule: '0 * * * *',
    timeZone: 'Europe/Zurich',
  },
  async (_event: ScheduledEvent) => {
    await runMatchReminders(Timestamp.now())
  },
)
