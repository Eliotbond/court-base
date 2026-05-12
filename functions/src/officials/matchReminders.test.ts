/**
 * Tests for `matchReminders` — the hourly J-1 / H-2 reminder scheduler.
 *
 * Strategy : mock `./_helpers` to provide a stable in-memory backend and
 * deterministic Timestamp arithmetic. We then drive the public helpers
 * (`hourInZurich`, `tomorrowDayWindowZurich`, `h2Window`,
 * `emitMatchReminderForBooking`, `runMatchReminders`) directly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeTimestamp {
  seconds: number
  nanoseconds: number
  toDate: () => Date
}

function ts(seconds: number): FakeTimestamp {
  return {
    seconds,
    nanoseconds: 0,
    toDate: () => new Date(seconds * 1000),
  }
}

interface FakeSnap<T = Record<string, unknown>> {
  empty: boolean
  size: number
  docs: FakeDoc<T>[]
}

interface FakeDoc<T = Record<string, unknown>> {
  id: string
  ref: { id: string; path: string }
  data: () => T
}

interface FakeQuery {
  where: (..._args: unknown[]) => FakeQuery
  limit: (_n: number) => FakeQuery
  get: () => Promise<FakeSnap>
}

interface FakeCollection {
  add: ReturnType<typeof vi.fn>
  where: (..._args: unknown[]) => FakeQuery
}

const state: {
  /** Bookings returned by every bookings query (we pre-filter in the test). */
  bookingsSnap: FakeSnap
  assignmentsByBooking: Map<string, FakeSnap>
  notificationsDedupeEmpty: boolean
  addCalls: unknown[]
} = {
  bookingsSnap: { empty: true, size: 0, docs: [] },
  assignmentsByBooking: new Map(),
  notificationsDedupeEmpty: true,
  addCalls: [],
}

const bookingsCollection: FakeCollection = {
  add: vi.fn(),
  where(): FakeQuery {
    const q: FakeQuery = {
      where: () => q,
      limit: () => q,
      get: async () => state.bookingsSnap,
    }
    return q
  },
}

const notificationsCollection: FakeCollection = {
  add: vi.fn(async (payload: unknown) => {
    state.addCalls.push(payload)
    return { id: `notif-${state.addCalls.length}` }
  }),
  where(): FakeQuery {
    const q: FakeQuery = {
      where: () => q,
      limit: () => q,
      get: async () => ({
        empty: state.notificationsDedupeEmpty,
        size: state.notificationsDedupeEmpty ? 0 : 1,
        docs: [],
      }),
    }
    return q
  },
}

vi.mock('./_helpers', async () => {
  const actual = await vi.importActual<typeof import('./_helpers')>('./_helpers')
  return {
    ...actual,
    db: () => ({ doc: vi.fn() }),
    col: (path: string) => {
      if (path === 'bookings') return bookingsCollection
      if (path === 'notifications') return notificationsCollection
      return {
        add: vi.fn(),
        where: () => ({
          where: () => ({
            limit: () => ({ get: async () => ({ empty: true, size: 0, docs: [] }) }),
            get: async () => ({ empty: true, size: 0, docs: [] }),
          }),
        }),
      }
    },
    subcol: (parentPath: string, name: string) => {
      const bookingId = parentPath.split('/').slice(-1)[0] ?? ''
      const snap =
        name === 'officialAssignments'
          ? state.assignmentsByBooking.get(bookingId) ?? {
              empty: true,
              size: 0,
              docs: [],
            }
          : { empty: true, size: 0, docs: [] }
      return { get: async () => snap }
    },
    serverTimestamp: () => '__SERVER_TS__',
    Timestamp: function FakeTimestampClass(seconds: number, nanoseconds: number) {
      return ts(seconds + (nanoseconds ?? 0) / 1e9)
    },
    timestampFromDate: (d: Date) => ts(Math.floor(d.getTime() / 1000)),
    addMinutesToTimestamp: (t: FakeTimestamp, minutes: number) =>
      ts(t.seconds + Math.round(minutes * 60)),
    addHoursToTimestamp: (t: FakeTimestamp, hours: number) =>
      ts(t.seconds + Math.round(hours * 3600)),
  }
})

vi.mock('../shared/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

let mod: typeof import('./matchReminders')

beforeEach(async () => {
  vi.clearAllMocks()
  state.bookingsSnap = { empty: true, size: 0, docs: [] }
  state.assignmentsByBooking = new Map()
  state.notificationsDedupeEmpty = true
  state.addCalls = []
  bookingsCollection.add = vi.fn()
  notificationsCollection.add = vi.fn(async (payload: unknown) => {
    state.addCalls.push(payload)
    return { id: `notif-${state.addCalls.length}` }
  })
  mod = await import('./matchReminders')
})

afterEach(() => {
  vi.restoreAllMocks()
})

function makeBookingDoc(opts: {
  id: string
  dateSeconds: number
  startTime: string
}): FakeDoc {
  return {
    id: opts.id,
    ref: { id: opts.id, path: `bookings/${opts.id}` },
    data: () => ({
      seasonId: 'S1',
      venueId: 'V1',
      courtId: 'C1',
      timeSlotId: 'T1',
      teamId: null,
      slotType: 'match_home',
      matchTypeId: 'mt-1',
      date: ts(opts.dateSeconds),
      startTime: opts.startTime,
      endTime: '20:00',
      status: 'scheduled',
      cancelReason: null,
      linkedBookingIds: [],
      isCombinedCourtEvent: false,
      actionLog: [],
    }),
  }
}

function setAssignments(
  bookingId: string,
  statuses: ReadonlyArray<'pending' | 'confirmed' | 'declined'>,
): void {
  state.assignmentsByBooking.set(bookingId, {
    empty: statuses.length === 0,
    size: statuses.length,
    docs: statuses.map((s, idx) => ({
      id: `a-${idx}`,
      ref: { id: `a-${idx}`, path: `bookings/${bookingId}/officialAssignments/a-${idx}` },
      data: () => ({
        memberId: `m-${idx}`,
        officialLevel: 1,
        status: s,
        assignedAt: ts(0),
        assignedBy: 'u1',
        respondedAt: null,
      }),
    })),
  })
}

// ----- Pure helpers ---------------------------------------------------------

describe('hourInZurich', () => {
  it('returns the Zurich hour for a known UTC instant in winter', () => {
    // 2026-01-15 22:00 UTC = 23:00 Zurich (UTC+1, no DST)
    const winterUtc = Math.floor(Date.UTC(2026, 0, 15, 22, 0, 0) / 1000)
    expect(
      mod.hourInZurich(ts(winterUtc) as unknown as FirebaseFirestore.Timestamp),
    ).toBe(23)
  })

  it('returns the Zurich hour for a known UTC instant in summer (DST)', () => {
    // 2026-07-15 21:00 UTC = 23:00 Zurich (UTC+2, DST)
    const summerUtc = Math.floor(Date.UTC(2026, 6, 15, 21, 0, 0) / 1000)
    expect(
      mod.hourInZurich(ts(summerUtc) as unknown as FirebaseFirestore.Timestamp),
    ).toBe(23)
  })
})

describe('tomorrowDayWindowZurich', () => {
  it('returns midnight-to-midnight UTC for the day after the Zurich "now"', () => {
    // 2026-05-12 21:00 UTC = 23:00 Zurich. Tomorrow Zurich = 2026-05-13.
    const now = Math.floor(Date.UTC(2026, 4, 12, 21, 0, 0) / 1000)
    const win = mod.tomorrowDayWindowZurich(
      ts(now) as unknown as FirebaseFirestore.Timestamp,
    )
    expect(win.start.seconds).toBe(Math.floor(Date.UTC(2026, 4, 13, 0, 0, 0) / 1000))
    expect(win.end.seconds).toBe(Math.floor(Date.UTC(2026, 4, 14, 0, 0, 0) / 1000))
  })
})

describe('h2Window', () => {
  it('returns [now+1h45m, now+2h15m]', () => {
    const now = ts(1_000_000) as unknown as FirebaseFirestore.Timestamp
    const win = mod.h2Window(now)
    expect(win.start.seconds).toBe(1_000_000 + 105 * 60)
    expect(win.end.seconds).toBe(1_000_000 + 135 * 60)
  })
})

// ----- emitMatchReminderForBooking -----------------------------------------

describe('emitMatchReminderForBooking', () => {
  it('skips when no confirmed officials', async () => {
    setAssignments('b-1', ['pending', 'declined'])
    const booking = makeBookingDoc({
      id: 'b-1',
      dateSeconds: 2_000_000,
      startTime: '18:00',
    }).data() as unknown as import('@club-app/shared-types').BookingData
    const created = await mod.emitMatchReminderForBooking('b-1', booking, {
      kind: 'h2',
      dedupeCutoff: ts(0) as unknown as FirebaseFirestore.Timestamp,
    })
    expect(created).toBe(false)
    expect(state.addCalls).toHaveLength(0)
  })

  it('emits one notification per booking when confirmed officials exist', async () => {
    setAssignments('b-1', ['confirmed', 'confirmed', 'pending'])
    const booking = makeBookingDoc({
      id: 'b-1',
      dateSeconds: 2_000_000,
      startTime: '18:00',
    }).data() as unknown as import('@club-app/shared-types').BookingData
    const created = await mod.emitMatchReminderForBooking('b-1', booking, {
      kind: 'j1',
      dedupeCutoff: ts(0) as unknown as FirebaseFirestore.Timestamp,
    })
    expect(created).toBe(true)
    expect(state.addCalls).toHaveLength(1)
    const payload = state.addCalls[0] as Record<string, unknown>
    expect(payload).toMatchObject({
      type: 'match_reminder',
      targetAudience: 'assigned_officials',
      relatedBookingId: 'b-1',
      sentBy: null,
      readBy: [],
    })
  })

  it('dedupes when a recent reminder exists', async () => {
    setAssignments('b-1', ['confirmed'])
    state.notificationsDedupeEmpty = false
    const booking = makeBookingDoc({
      id: 'b-1',
      dateSeconds: 2_000_000,
      startTime: '18:00',
    }).data() as unknown as import('@club-app/shared-types').BookingData
    const created = await mod.emitMatchReminderForBooking('b-1', booking, {
      kind: 'h2',
      dedupeCutoff: ts(0) as unknown as FirebaseFirestore.Timestamp,
    })
    expect(created).toBe(false)
    expect(state.addCalls).toHaveLength(0)
  })
})

// ----- runMatchReminders ---------------------------------------------------

describe('runMatchReminders', () => {
  it('outside both windows -> no-op', async () => {
    // Run at 10:00 Zurich (which is not the 23:00 J-1 hour) and no bookings.
    const now = Math.floor(Date.UTC(2026, 4, 12, 8, 0, 0) / 1000) // 10:00 Zurich CEST
    const out = await mod.runMatchReminders(
      ts(now) as unknown as FirebaseFirestore.Timestamp,
    )
    expect(out).toEqual({ j1: 0, h2: 0 })
    expect(state.addCalls).toHaveLength(0)
  })

  it('at 23:00 Zurich with a match tomorrow -> J-1 emits a reminder', async () => {
    // 23:00 Zurich CET (UTC+1 in May? No — May is CEST UTC+2, so 21:00 UTC).
    const now = Math.floor(Date.UTC(2026, 4, 12, 21, 0, 0) / 1000)
    // Tomorrow's date in Zurich = 2026-05-13 -> midnight UTC.
    const tomorrowDate = Math.floor(Date.UTC(2026, 4, 13, 0, 0, 0) / 1000)
    setAssignments('b-tomorrow', ['confirmed'])
    state.bookingsSnap = {
      empty: false,
      size: 1,
      docs: [
        makeBookingDoc({
          id: 'b-tomorrow',
          dateSeconds: tomorrowDate,
          startTime: '18:00',
        }),
      ],
    }

    const out = await mod.runMatchReminders(
      ts(now) as unknown as FirebaseFirestore.Timestamp,
    )

    // J-1 emits at least one. The H-2 sweep may also pick this up if the
    // booking start falls inside [now+1h45m, now+2h15m] — but at 23:00 Zurich
    // with the match at 18:00 next day, that's ~19h away, so H-2 = 0.
    expect(out.j1).toBe(1)
    expect(out.h2).toBe(0)
    expect(state.addCalls).toHaveLength(1)
    const payload = state.addCalls[0] as Record<string, unknown>
    expect(payload.relatedBookingId).toBe('b-tomorrow')
    expect(payload.targetAudience).toBe('assigned_officials')
  })

  it('H-2 window detected -> emits a reminder', async () => {
    // We schedule the booking to start exactly at now + 2h, then run at "now".
    const now = 1_000_000
    const matchStartSeconds = now + 2 * 3600
    // Booking `date` is midnight UTC of the match day; startTime carries the
    // hours/minutes. We pick a `date` such that `date + startTime == matchStartSeconds`.
    // For the test the simplest approach: set date = matchStartSeconds and
    // startTime = "00:00" so the derived start === date.
    setAssignments('b-h2', ['confirmed'])
    state.bookingsSnap = {
      empty: false,
      size: 1,
      docs: [
        makeBookingDoc({
          id: 'b-h2',
          dateSeconds: matchStartSeconds,
          startTime: '00:00',
        }),
      ],
    }

    const out = await mod.runMatchReminders(
      ts(now) as unknown as FirebaseFirestore.Timestamp,
    )

    // Only H-2 should fire; J-1 trigger requires Zurich hour == 23 and `now`
    // = 1_000_000s = 1970-01-12 13:46:40 UTC = 14:46 Zurich (CET).
    expect(out.h2).toBe(1)
    expect(out.j1).toBe(0)
    expect(state.addCalls).toHaveLength(1)
    const payload = state.addCalls[0] as Record<string, unknown>
    expect(payload.relatedBookingId).toBe('b-h2')
  })

  it('H-2 dedupe within 2h -> no second notification', async () => {
    const now = 1_000_000
    const matchStartSeconds = now + 2 * 3600
    setAssignments('b-h2', ['confirmed'])
    state.bookingsSnap = {
      empty: false,
      size: 1,
      docs: [
        makeBookingDoc({
          id: 'b-h2',
          dateSeconds: matchStartSeconds,
          startTime: '00:00',
        }),
      ],
    }
    state.notificationsDedupeEmpty = false // existing reminder within window

    const out = await mod.runMatchReminders(
      ts(now) as unknown as FirebaseFirestore.Timestamp,
    )

    expect(out.h2).toBe(0)
    expect(state.addCalls).toHaveLength(0)
  })

  it('booking outside the H-2 window is filtered out', async () => {
    const now = 1_000_000
    // Match in 5 hours — outside both windows.
    const matchStartSeconds = now + 5 * 3600
    setAssignments('b-far', ['confirmed'])
    state.bookingsSnap = {
      empty: false,
      size: 1,
      docs: [
        makeBookingDoc({
          id: 'b-far',
          dateSeconds: matchStartSeconds,
          startTime: '00:00',
        }),
      ],
    }

    const out = await mod.runMatchReminders(
      ts(now) as unknown as FirebaseFirestore.Timestamp,
    )

    expect(out.h2).toBe(0)
    expect(state.addCalls).toHaveLength(0)
  })
})
