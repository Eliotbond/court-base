/**
 * Tests for `autoOfficialsNeededNotification` — the under-staffed match scan.
 *
 * Strategy : we mock `./_helpers` (db / col / subcol / serverTimestamp) and
 * `../shared/logger` to provide in-memory fakes. We exercise the core
 * orchestration via `processBookingForOfficialsNeeded` and `runAutoOfficialsNeeded`
 * with hand-built docs.
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

interface MatchTypeDoc {
  exists: boolean
  data: () => unknown
}

const state: {
  bookingsSnap: FakeSnap
  matchTypeDocs: Map<string, MatchTypeDoc>
  assignmentsByBooking: Map<string, FakeSnap>
  notificationsDedupeEmpty: boolean
  addCalls: unknown[]
} = {
  bookingsSnap: { empty: true, size: 0, docs: [] },
  matchTypeDocs: new Map(),
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

const fakeDb = {
  doc: vi.fn((path: string) => {
    const id = path.split('/').slice(-1)[0] ?? ''
    return {
      path,
      id,
      get: async (): Promise<MatchTypeDoc> => {
        if (path.startsWith('matchTypes/')) {
          const found = state.matchTypeDocs.get(id)
          if (!found) {
            return { exists: false, data: () => undefined }
          }
          return found
        }
        return { exists: false, data: () => undefined }
      },
    }
  }),
}

vi.mock('./_helpers', async () => {
  const actual = await vi.importActual<typeof import('./_helpers')>('./_helpers')
  return {
    ...actual,
    db: () => fakeDb,
    col: (path: string) => {
      if (path === 'bookings') return bookingsCollection
      if (path === 'notifications') return notificationsCollection
      return { add: vi.fn(), where: () => ({ get: async () => ({ empty: true, size: 0, docs: [] }) }) }
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
      return {
        get: async () => snap,
      }
    },
    serverTimestamp: () => '__SERVER_TS__',
    Timestamp: {
      now: () => ts(1_000_000),
    },
    timestampFromDate: (d: Date) => ts(Math.floor(d.getTime() / 1000)),
    addDaysToTimestamp: (t: FakeTimestamp, days: number) =>
      ts(t.seconds + days * 86_400),
    addHoursToTimestamp: (t: FakeTimestamp, hours: number) =>
      ts(t.seconds + hours * 3600),
  }
})

vi.mock('../shared/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

let mod: typeof import('./autoOfficialsNeeded')

beforeEach(async () => {
  vi.clearAllMocks()
  state.bookingsSnap = { empty: true, size: 0, docs: [] }
  state.matchTypeDocs = new Map()
  state.assignmentsByBooking = new Map()
  state.notificationsDedupeEmpty = true
  state.addCalls = []
  bookingsCollection.add = vi.fn()
  notificationsCollection.add = vi.fn(async (payload: unknown) => {
    state.addCalls.push(payload)
    return { id: `notif-${state.addCalls.length}` }
  })
  mod = await import('./autoOfficialsNeeded')
})

afterEach(() => {
  vi.restoreAllMocks()
})

function makeBookingDoc(opts: {
  id: string
  matchTypeId: string | null
  startTime?: string
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
      matchTypeId: opts.matchTypeId,
      date: ts(2_000_000),
      startTime: opts.startTime ?? '18:00',
      endTime: '20:00',
      status: 'scheduled',
      cancelReason: null,
      linkedBookingIds: [],
      isCombinedCourtEvent: false,
      actionLog: [],
    }),
  }
}

function setMatchType(
  id: string,
  requirements: { level: number; count: number }[],
): void {
  state.matchTypeDocs.set(id, {
    exists: true,
    data: () => ({
      name: 'Test Match',
      requiredCourtSize: 'normal',
      homeOfficialRequirements: requirements,
      awayOfficialCount: 0,
      color: '#000',
      active: true,
      createdAt: ts(0),
    }),
  })
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

describe('computeRequiredOfficials', () => {
  it('sums counts across levels', () => {
    expect(
      mod.computeRequiredOfficials([
        { level: 1, count: 2 },
        { level: 2, count: 1 },
      ]),
    ).toBe(3)
  })

  it('ignores invalid / non-positive counts', () => {
    expect(
      mod.computeRequiredOfficials([
        { level: 1, count: 2 },
        { level: 2, count: 0 },
        { level: 3, count: Number.NaN },
        { level: 4, count: -1 },
      ]),
    ).toBe(2)
  })

  it('returns 0 for empty input', () => {
    expect(mod.computeRequiredOfficials([])).toBe(0)
  })
})

describe('processBookingForOfficialsNeeded', () => {
  it('creates a notification when under-staffed and no recent notif', async () => {
    setMatchType('mt-1', [{ level: 1, count: 2 }])
    setAssignments('b-1', ['confirmed']) // 1 filled, 2 required
    const booking = makeBookingDoc({ id: 'b-1', matchTypeId: 'mt-1' }).data() as unknown as import('@club-app/shared-types').BookingData

    const created = await mod.processBookingForOfficialsNeeded('b-1', booking, {
      now: ts(1_000_000) as unknown as FirebaseFirestore.Timestamp,
    })

    expect(created).toBe(true)
    expect(state.addCalls).toHaveLength(1)
    const payload = state.addCalls[0] as Record<string, unknown>
    expect(payload).toMatchObject({
      type: 'officials_needed',
      targetAudience: 'unassigned_officials',
      relatedBookingId: 'b-1',
      sentBy: null,
      readBy: [],
    })
    expect(payload.body).toContain('1 official')
  })

  it('counts both pending and confirmed toward filled', async () => {
    setMatchType('mt-1', [{ level: 1, count: 2 }])
    setAssignments('b-1', ['pending', 'confirmed']) // 2 filled = required
    const booking = makeBookingDoc({ id: 'b-1', matchTypeId: 'mt-1' }).data() as unknown as import('@club-app/shared-types').BookingData

    const created = await mod.processBookingForOfficialsNeeded('b-1', booking, {
      now: ts(1_000_000) as unknown as FirebaseFirestore.Timestamp,
    })

    expect(created).toBe(false)
    expect(state.addCalls).toHaveLength(0)
  })

  it('skips when fully staffed', async () => {
    setMatchType('mt-1', [{ level: 1, count: 1 }])
    setAssignments('b-1', ['confirmed'])
    const booking = makeBookingDoc({ id: 'b-1', matchTypeId: 'mt-1' }).data() as unknown as import('@club-app/shared-types').BookingData

    const created = await mod.processBookingForOfficialsNeeded('b-1', booking, {
      now: ts(1_000_000) as unknown as FirebaseFirestore.Timestamp,
    })

    expect(created).toBe(false)
    expect(state.addCalls).toHaveLength(0)
  })

  it('skips when a recent notification exists (dedupe)', async () => {
    setMatchType('mt-1', [{ level: 1, count: 2 }])
    setAssignments('b-1', []) // none filled, 2 required
    state.notificationsDedupeEmpty = false
    const booking = makeBookingDoc({ id: 'b-1', matchTypeId: 'mt-1' }).data() as unknown as import('@club-app/shared-types').BookingData

    const created = await mod.processBookingForOfficialsNeeded('b-1', booking, {
      now: ts(1_000_000) as unknown as FirebaseFirestore.Timestamp,
    })

    expect(created).toBe(false)
    expect(state.addCalls).toHaveLength(0)
  })

  it('skips when matchTypeId is null', async () => {
    setAssignments('b-1', [])
    const booking = makeBookingDoc({ id: 'b-1', matchTypeId: null }).data() as unknown as import('@club-app/shared-types').BookingData

    const created = await mod.processBookingForOfficialsNeeded('b-1', booking, {
      now: ts(1_000_000) as unknown as FirebaseFirestore.Timestamp,
    })

    expect(created).toBe(false)
  })

  it('skips when matchType doc is missing', async () => {
    setAssignments('b-1', [])
    // Intentionally do NOT set the matchType.
    const booking = makeBookingDoc({ id: 'b-1', matchTypeId: 'missing-mt' }).data() as unknown as import('@club-app/shared-types').BookingData

    const created = await mod.processBookingForOfficialsNeeded('b-1', booking, {
      now: ts(1_000_000) as unknown as FirebaseFirestore.Timestamp,
    })

    expect(created).toBe(false)
  })

  it('skips when requiredCount resolves to 0', async () => {
    setMatchType('mt-1', [{ level: 1, count: 0 }])
    setAssignments('b-1', [])
    const booking = makeBookingDoc({ id: 'b-1', matchTypeId: 'mt-1' }).data() as unknown as import('@club-app/shared-types').BookingData

    const created = await mod.processBookingForOfficialsNeeded('b-1', booking, {
      now: ts(1_000_000) as unknown as FirebaseFirestore.Timestamp,
    })

    expect(created).toBe(false)
  })
})

describe('runAutoOfficialsNeeded', () => {
  it('returns zero counts when no bookings match', async () => {
    const out = await mod.runAutoOfficialsNeeded(
      ts(1_000_000) as unknown as FirebaseFirestore.Timestamp,
    )
    expect(out).toEqual({ scanned: 0, notified: 0 })
    expect(state.addCalls).toHaveLength(0)
  })

  it('notifies under-staffed bookings, skips full ones', async () => {
    setMatchType('mt-needs', [{ level: 1, count: 2 }])
    setMatchType('mt-full', [{ level: 1, count: 1 }])
    setAssignments('b-needs', ['confirmed'])
    setAssignments('b-full', ['confirmed'])
    state.bookingsSnap = {
      empty: false,
      size: 2,
      docs: [
        makeBookingDoc({ id: 'b-needs', matchTypeId: 'mt-needs' }),
        makeBookingDoc({ id: 'b-full', matchTypeId: 'mt-full' }),
      ],
    }

    const out = await mod.runAutoOfficialsNeeded(
      ts(1_000_000) as unknown as FirebaseFirestore.Timestamp,
    )

    expect(out).toEqual({ scanned: 2, notified: 1 })
    expect(state.addCalls).toHaveLength(1)
    const payload = state.addCalls[0] as Record<string, unknown>
    expect(payload.relatedBookingId).toBe('b-needs')
  })
})
