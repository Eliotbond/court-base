/**
 * Tests pour `handleMatchSlotChange` :
 *   - slot becomes match_home → trainings same team same dayOfWeek cancelled
 *     with cancelReason='match_home'
 *   - slot was already match_home and just renamed (re-write) → no action
 *   - teamId=null → skip with warning
 *   - dayOfWeek filtering: trainings on a different weekday left intact
 *   - transition detection (`isTransitionToMatch`) — pure
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('firebase-admin', () => {
  const arrayUnion = (...vals: unknown[]) => ({ __arrayUnion: vals })
  const now = () => ({ seconds: 1_700_000_000, nanoseconds: 0 })
  return {
    default: {},
    firestore: Object.assign(() => ({}), {
      FieldValue: { arrayUnion },
      Timestamp: { now },
    }),
    initializeApp: vi.fn(),
  }
})

vi.mock('../shared/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentWritten: (_path: string, handler: unknown) => handler,
}))

const dbImpl: { current: () => FirebaseFirestore.Firestore } = {
  current: () =>
    ({}) as unknown as FirebaseFirestore.Firestore,
}
vi.mock('../shared/firestore', () => ({
  db: () => dbImpl.current(),
}))

import {
  cancelTrainingsConflictingWith,
  handleMatchSlotChange,
  isTransitionToMatch,
} from './handleMatchSlotChange'

// ------------------------------------------------------------
// Fake Firestore.
// ------------------------------------------------------------

interface FakeBookingSnap {
  id: string
  ref: { __id: string }
  data: () => Record<string, unknown>
}

interface FakeStore {
  bookings: FakeBookingSnap[]
  updates: Array<{ id: string; payload: Record<string, unknown> }>
  commits: number
}

function tsFromDate(d: Date): FirebaseFirestore.Timestamp {
  return {
    seconds: Math.floor(d.getTime() / 1000),
    nanoseconds: 0,
    toDate: () => new Date(d.getTime()),
  } as unknown as FirebaseFirestore.Timestamp
}

function makeFakeFirestore(store: FakeStore): FirebaseFirestore.Firestore {
  let where: Record<string, unknown> = {}
  const firestore = {
    collection(name: string) {
      if (name === 'bookings') {
        const chain = {
          where(field: string, _op: string, val: unknown) {
            where[field] = val
            return chain
          },
          async get() {
            const local = { ...where }
            where = {}
            const docs = store.bookings.filter((b) => {
              const data = b.data()
              for (const k of Object.keys(local)) {
                if (data[k] !== local[k]) return false
              }
              return true
            })
            return { empty: docs.length === 0, size: docs.length, docs }
          },
        }
        return chain
      }
      throw new Error(`unexpected collection ${name}`)
    },
    batch() {
      const ops: Array<{ id: string; payload: Record<string, unknown> }> = []
      return {
        update(ref: { __id: string }, payload: Record<string, unknown>) {
          ops.push({ id: ref.__id, payload })
        },
        async commit() {
          store.commits += 1
          store.updates.push(...ops)
        },
      }
    },
  }
  return firestore as unknown as FirebaseFirestore.Firestore
}

function mkTraining(
  id: string,
  args: { seasonId: string; teamId: string; status: string; date: Date },
): FakeBookingSnap {
  return {
    id,
    ref: { __id: id },
    data: () => ({
      seasonId: args.seasonId,
      teamId: args.teamId,
      slotType: 'training',
      status: args.status,
      date: tsFromDate(args.date),
    }),
  }
}

let store: FakeStore

beforeEach(() => {
  store = { bookings: [], updates: [], commits: 0 }
  dbImpl.current = () => makeFakeFirestore(store)
})

// ------------------------------------------------------------
// Pure transition predicate.
// ------------------------------------------------------------

describe('isTransitionToMatch', () => {
  it('true for newly created match_home slot (no before)', () => {
    expect(isTransitionToMatch(undefined, { slotType: 'match_home' })).toBe(true)
  })
  it('true for newly created match_away slot', () => {
    expect(isTransitionToMatch(undefined, { slotType: 'match_away' })).toBe(true)
  })
  it('true for training -> match_home transition', () => {
    expect(
      isTransitionToMatch({ slotType: 'training' }, { slotType: 'match_home' }),
    ).toBe(true)
  })
  it('false when already match_home (renamed only)', () => {
    expect(
      isTransitionToMatch({ slotType: 'match_home' }, { slotType: 'match_home' }),
    ).toBe(false)
  })
  it('false when match_away -> match_home (still match)', () => {
    expect(
      isTransitionToMatch({ slotType: 'match_away' }, { slotType: 'match_home' }),
    ).toBe(false)
  })
  it('false for non-match after type', () => {
    expect(
      isTransitionToMatch({ slotType: 'training' }, { slotType: 'training' }),
    ).toBe(false)
  })
  it('false when after is undefined', () => {
    expect(isTransitionToMatch({ slotType: 'training' }, undefined)).toBe(false)
  })
})

// ------------------------------------------------------------
// Core: cancelTrainingsConflictingWith.
// ------------------------------------------------------------

describe('cancelTrainingsConflictingWith', () => {
  // Monday = getUTCDay() === 1
  const mon1 = new Date(Date.UTC(2025, 8, 1)) // 2025-09-01 Mon
  const mon2 = new Date(Date.UTC(2025, 8, 8)) // 2025-09-08 Mon
  const tue1 = new Date(Date.UTC(2025, 8, 2)) // 2025-09-02 Tue

  it('cancels trainings same team + same dayOfWeek with cancelReason=match_home', async () => {
    store.bookings = [
      mkTraining('B_mon1', {
        seasonId: 'S1',
        teamId: 'T1',
        status: 'scheduled',
        date: mon1,
      }),
      mkTraining('B_mon2', {
        seasonId: 'S1',
        teamId: 'T1',
        status: 'scheduled',
        date: mon2,
      }),
      mkTraining('B_tue', {
        seasonId: 'S1',
        teamId: 'T1',
        status: 'scheduled',
        date: tue1,
      }),
    ]
    const res = await cancelTrainingsConflictingWith({
      seasonId: 'S1',
      teamId: 'T1',
      dayOfWeek: 1,
      slotType: 'match_home',
      sourceSlotId: 'SLOT_X',
    })
    expect(res.cancelled).toBe(2)
    expect(store.updates.map((u) => u.id).sort()).toEqual(['B_mon1', 'B_mon2'])
    for (const u of store.updates) {
      expect(u.payload.status).toBe('cancelled')
      expect(u.payload.cancelReason).toBe('match_home')
      expect(u.payload.actionLog).toMatchObject({
        __arrayUnion: [
          { by: 'system', action: 'match_slot_cancel', note: 'SLOT_X' },
        ],
      })
    }
  })

  it('uses cancelReason=match_away when slotType is match_away', async () => {
    store.bookings = [
      mkTraining('B', {
        seasonId: 'S1',
        teamId: 'T1',
        status: 'scheduled',
        date: mon1,
      }),
    ]
    const res = await cancelTrainingsConflictingWith({
      seasonId: 'S1',
      teamId: 'T1',
      dayOfWeek: 1,
      slotType: 'match_away',
      sourceSlotId: 'SLOT_X',
    })
    expect(res.cancelled).toBe(1)
    expect(store.updates[0].payload.cancelReason).toBe('match_away')
  })

  it('skips trainings of other teams or other seasons (Firestore where filters)', async () => {
    store.bookings = [
      mkTraining('B_match', {
        seasonId: 'S1',
        teamId: 'T1',
        status: 'scheduled',
        date: mon1,
      }),
      mkTraining('B_other_team', {
        seasonId: 'S1',
        teamId: 'T2',
        status: 'scheduled',
        date: mon1,
      }),
      mkTraining('B_other_season', {
        seasonId: 'S2',
        teamId: 'T1',
        status: 'scheduled',
        date: mon1,
      }),
    ]
    const res = await cancelTrainingsConflictingWith({
      seasonId: 'S1',
      teamId: 'T1',
      dayOfWeek: 1,
      slotType: 'match_home',
      sourceSlotId: 'X',
    })
    expect(res.cancelled).toBe(1)
    expect(store.updates.map((u) => u.id)).toEqual(['B_match'])
  })

  it('skips trainings on a different weekday (dayOfWeek filter)', async () => {
    store.bookings = [
      mkTraining('B_tue', {
        seasonId: 'S1',
        teamId: 'T1',
        status: 'scheduled',
        date: tue1,
      }),
    ]
    const res = await cancelTrainingsConflictingWith({
      seasonId: 'S1',
      teamId: 'T1',
      dayOfWeek: 1,
      slotType: 'match_home',
      sourceSlotId: 'X',
    })
    expect(res.cancelled).toBe(0)
    expect(store.commits).toBe(0)
  })

  it('returns 0 when no matching training exists', async () => {
    const res = await cancelTrainingsConflictingWith({
      seasonId: 'S1',
      teamId: 'T1',
      dayOfWeek: 1,
      slotType: 'match_home',
      sourceSlotId: 'X',
    })
    expect(res.cancelled).toBe(0)
    expect(store.commits).toBe(0)
  })
})

// ------------------------------------------------------------
// Trigger gate.
// ------------------------------------------------------------

describe('handleMatchSlotChange trigger gate', () => {
  function makeSlotEvent(args: {
    before?: Record<string, unknown>
    after?: Record<string, unknown>
  }) {
    return {
      params: { venueId: 'V', courtId: 'C', slotId: 'SLOT1' },
      data: {
        before: args.before ? { data: () => args.before } : undefined,
        after: args.after ? { data: () => args.after } : undefined,
      },
    }
  }

  const mon = new Date(Date.UTC(2025, 8, 1))

  it('no-op when after is undefined (slot deleted)', async () => {
    const handler = handleMatchSlotChange as unknown as (e: unknown) => Promise<void>
    await handler(makeSlotEvent({ before: { slotType: 'match_home' } }))
    expect(store.updates).toEqual([])
  })

  it('no-op when after.slotType is non-match (training)', async () => {
    const handler = handleMatchSlotChange as unknown as (e: unknown) => Promise<void>
    store.bookings = [
      mkTraining('B', {
        seasonId: 'S1',
        teamId: 'T1',
        status: 'scheduled',
        date: mon,
      }),
    ]
    await handler(
      makeSlotEvent({
        after: {
          slotType: 'training',
          seasonId: 'S1',
          teamId: 'T1',
          dayOfWeek: 1,
        },
      }),
    )
    expect(store.updates).toEqual([])
  })

  it('no-op when slot was already match_home (re-write)', async () => {
    const handler = handleMatchSlotChange as unknown as (e: unknown) => Promise<void>
    store.bookings = [
      mkTraining('B', {
        seasonId: 'S1',
        teamId: 'T1',
        status: 'scheduled',
        date: mon,
      }),
    ]
    await handler(
      makeSlotEvent({
        before: {
          slotType: 'match_home',
          seasonId: 'S1',
          teamId: 'T1',
          dayOfWeek: 1,
        },
        after: {
          slotType: 'match_home',
          seasonId: 'S1',
          teamId: 'T1',
          dayOfWeek: 1,
        },
      }),
    )
    expect(store.updates).toEqual([])
  })

  it('skips when teamId is null', async () => {
    const handler = handleMatchSlotChange as unknown as (e: unknown) => Promise<void>
    store.bookings = [
      mkTraining('B', {
        seasonId: 'S1',
        teamId: 'T1',
        status: 'scheduled',
        date: mon,
      }),
    ]
    await handler(
      makeSlotEvent({
        after: {
          slotType: 'match_home',
          seasonId: 'S1',
          teamId: null,
          dayOfWeek: 1,
        },
      }),
    )
    expect(store.updates).toEqual([])
  })

  it('cancels trainings on transition training -> match_home', async () => {
    const handler = handleMatchSlotChange as unknown as (e: unknown) => Promise<void>
    store.bookings = [
      mkTraining('B', {
        seasonId: 'S1',
        teamId: 'T1',
        status: 'scheduled',
        date: mon,
      }),
    ]
    await handler(
      makeSlotEvent({
        before: {
          slotType: 'training',
          seasonId: 'S1',
          teamId: 'T1',
          dayOfWeek: 1,
        },
        after: {
          slotType: 'match_home',
          seasonId: 'S1',
          teamId: 'T1',
          dayOfWeek: 1,
        },
      }),
    )
    expect(store.updates.map((u) => u.id)).toEqual(['B'])
    expect(store.updates[0].payload.cancelReason).toBe('match_home')
  })

  it('cancels trainings on slot creation as match_away', async () => {
    const handler = handleMatchSlotChange as unknown as (e: unknown) => Promise<void>
    store.bookings = [
      mkTraining('B', {
        seasonId: 'S1',
        teamId: 'T1',
        status: 'scheduled',
        date: mon,
      }),
    ]
    await handler(
      makeSlotEvent({
        after: {
          slotType: 'match_away',
          seasonId: 'S1',
          teamId: 'T1',
          dayOfWeek: 1,
        },
      }),
    )
    expect(store.updates.map((u) => u.id)).toEqual(['B'])
    expect(store.updates[0].payload.cancelReason).toBe('match_away')
  })
})
