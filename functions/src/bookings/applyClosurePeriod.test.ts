/**
 * Tests pour `applyClosurePeriod` :
 *   - new closure cancels scheduled bookings in range
 *   - already-cancelled bookings skipped (la query Firestore les exclut)
 *   - closure removed from `closurePeriodIds` → no action
 *   - diff utility behaviour
 *
 * Stratégie : on mocke `../shared/firestore` pour fournir un faux Firestore
 * in-memory, et `../shared/logger` pour silencer les logs. On invoque
 * directement `applyClosures` et `diffNewClosureIds` (exportés pour tests).
 *
 * Le trigger lui-même est aussi exercé via un handler-passthrough mock de
 * `firebase-functions/v2/firestore` pour valider la condition "no action si
 * closures retirées".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('firebase-admin', () => {
  // Minimal stub : on n'a besoin que de `FieldValue.arrayUnion` et
  // `Timestamp.now()` dans applyClosurePeriod.
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

// Mock shared/firestore with a swappable `db()` implementation.
const dbImpl: { current: () => FirebaseFirestore.Firestore } = {
  current: () =>
    ({}) as unknown as FirebaseFirestore.Firestore,
}
vi.mock('../shared/firestore', () => ({
  db: () => dbImpl.current(),
}))

import {
  applyClosurePeriod,
  applyClosures,
  diffNewClosureIds,
} from './applyClosurePeriod'

// ------------------------------------------------------------
// Fake Firestore.
// ------------------------------------------------------------

interface FakeBookingSnap {
  id: string
  ref: { __id: string }
  data: () => Record<string, unknown>
}

interface FakeClosure {
  id: string
  startSeconds: number
  endSeconds: number
}

interface FakeStore {
  closures: Map<string, FakeClosure>
  bookings: FakeBookingSnap[]
  updates: Array<{ id: string; payload: Record<string, unknown> }>
  commits: number
}

function tsFromSeconds(seconds: number): FirebaseFirestore.Timestamp {
  return {
    seconds,
    nanoseconds: 0,
    toDate: () => new Date(seconds * 1000),
  } as unknown as FirebaseFirestore.Timestamp
}

function makeFakeFirestore(store: FakeStore): FirebaseFirestore.Firestore {
  let lastQuery: {
    seasonId?: string
    status?: string
    start?: FirebaseFirestore.Timestamp
    end?: FirebaseFirestore.Timestamp
  } = {}
  const firestore = {
    collection(name: string) {
      if (name === 'closurePeriods') {
        return {
          doc(id: string) {
            return {
              async get() {
                const c = store.closures.get(id)
                if (!c) return { exists: false, data: () => undefined }
                return {
                  exists: true,
                  data: () => ({
                    name: `closure ${id}`,
                    startDate: tsFromSeconds(c.startSeconds),
                    endDate: tsFromSeconds(c.endSeconds),
                    type: 'holiday',
                    createdBy: 'u',
                  }),
                }
              },
            }
          },
        }
      }
      if (name === 'bookings') {
        const chain = {
          where(field: string, _op: string, val: unknown) {
            if (field === 'seasonId') lastQuery.seasonId = val as string
            if (field === 'status') lastQuery.status = val as string
            if (field === 'date' && (_op === '>=' || _op === '>')) {
              lastQuery.start = val as FirebaseFirestore.Timestamp
            }
            if (field === 'date' && (_op === '<=' || _op === '<')) {
              lastQuery.end = val as FirebaseFirestore.Timestamp
            }
            return chain
          },
          async get() {
            const startS = lastQuery.start?.seconds ?? -Infinity
            const endS = lastQuery.end?.seconds ?? Infinity
            const status = lastQuery.status
            const docs = store.bookings.filter((b) => {
              const data = b.data()
              if (lastQuery.seasonId && data.seasonId !== lastQuery.seasonId) {
                return false
              }
              if (status && data.status !== status) return false
              const date = data.date as FirebaseFirestore.Timestamp | undefined
              if (!date) return false
              return date.seconds >= startS && date.seconds <= endS
            })
            // reset for next query
            lastQuery = {}
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

function mkBooking(
  id: string,
  fields: { seasonId: string; status: string; dateSeconds: number },
): FakeBookingSnap {
  return {
    id,
    ref: { __id: id },
    data: () => ({
      seasonId: fields.seasonId,
      status: fields.status,
      date: tsFromSeconds(fields.dateSeconds),
    }),
  }
}

let store: FakeStore

beforeEach(() => {
  store = {
    closures: new Map(),
    bookings: [],
    updates: [],
    commits: 0,
  }
  dbImpl.current = () => makeFakeFirestore(store)
})

// ------------------------------------------------------------
// diffNewClosureIds — pure function.
// ------------------------------------------------------------

describe('diffNewClosureIds', () => {
  it('returns IDs added in after but absent from before', () => {
    expect(diffNewClosureIds(['a'], ['a', 'b'])).toEqual(['b'])
  })
  it('ignores IDs removed (no auto-uncancel)', () => {
    expect(diffNewClosureIds(['a', 'b'], ['a'])).toEqual([])
  })
  it('returns [] when no change', () => {
    expect(diffNewClosureIds(['a', 'b'], ['a', 'b'])).toEqual([])
  })
  it('deduplicates duplicates in after', () => {
    expect(diffNewClosureIds([], ['a', 'a', 'b'])).toEqual(['a', 'b'])
  })
})

// ------------------------------------------------------------
// applyClosures — core logic.
// ------------------------------------------------------------

describe('applyClosures', () => {
  it('cancels scheduled bookings whose date falls in the closure range', async () => {
    // closure: seconds 100..200 (inclusive)
    store.closures.set('CL1', { id: 'CL1', startSeconds: 100, endSeconds: 200 })
    store.bookings = [
      mkBooking('B_in', { seasonId: 'S1', status: 'scheduled', dateSeconds: 150 }),
      mkBooking('B_out', { seasonId: 'S1', status: 'scheduled', dateSeconds: 250 }),
      mkBooking('B_edge_start', {
        seasonId: 'S1',
        status: 'scheduled',
        dateSeconds: 100,
      }),
      mkBooking('B_edge_end', { seasonId: 'S1', status: 'scheduled', dateSeconds: 200 }),
    ]

    const res = await applyClosures('S1', ['CL1'])
    expect(res.totalCancelled).toBe(3)
    expect(res.byClosure).toEqual({ CL1: 3 })
    // All 3 in-range bookings updated, none of the out-of-range.
    const ids = store.updates.map((u) => u.id).sort()
    expect(ids).toEqual(['B_edge_end', 'B_edge_start', 'B_in'])
    // Each update sets status=cancelled + cancelReason=closure + actionLog
    // arrayUnion entry.
    for (const u of store.updates) {
      expect(u.payload.status).toBe('cancelled')
      expect(u.payload.cancelReason).toBe('closure')
      expect(u.payload.actionLog).toMatchObject({
        __arrayUnion: [
          {
            by: 'system',
            action: 'closure_cancel',
            note: 'CL1',
          },
        ],
      })
    }
  })

  it('skips already-cancelled bookings (query filters them out)', async () => {
    store.closures.set('CL1', { id: 'CL1', startSeconds: 100, endSeconds: 200 })
    store.bookings = [
      mkBooking('B_sch', { seasonId: 'S1', status: 'scheduled', dateSeconds: 150 }),
      mkBooking('B_canc', { seasonId: 'S1', status: 'cancelled', dateSeconds: 150 }),
      mkBooking('B_freed', { seasonId: 'S1', status: 'freed', dateSeconds: 150 }),
    ]
    const res = await applyClosures('S1', ['CL1'])
    expect(res.totalCancelled).toBe(1)
    expect(store.updates.map((u) => u.id)).toEqual(['B_sch'])
  })

  it('skips bookings of another season', async () => {
    store.closures.set('CL1', { id: 'CL1', startSeconds: 100, endSeconds: 200 })
    store.bookings = [
      mkBooking('B_s1', { seasonId: 'S1', status: 'scheduled', dateSeconds: 150 }),
      mkBooking('B_s2', { seasonId: 'S2', status: 'scheduled', dateSeconds: 150 }),
    ]
    const res = await applyClosures('S1', ['CL1'])
    expect(res.totalCancelled).toBe(1)
    expect(store.updates.map((u) => u.id)).toEqual(['B_s1'])
  })

  it('handles a missing closurePeriod doc gracefully', async () => {
    // closure 'GHOST' doesn't exist in store
    store.bookings = [
      mkBooking('B', { seasonId: 'S1', status: 'scheduled', dateSeconds: 150 }),
    ]
    const res = await applyClosures('S1', ['GHOST'])
    expect(res.totalCancelled).toBe(0)
    expect(res.byClosure).toEqual({ GHOST: 0 })
    expect(store.updates).toEqual([])
  })

  it('returns 0 when no scheduled bookings match the range', async () => {
    store.closures.set('CL1', { id: 'CL1', startSeconds: 100, endSeconds: 200 })
    store.bookings = [
      mkBooking('B_out', { seasonId: 'S1', status: 'scheduled', dateSeconds: 999 }),
    ]
    const res = await applyClosures('S1', ['CL1'])
    expect(res.totalCancelled).toBe(0)
    expect(store.commits).toBe(0)
  })

  it('processes multiple closures in one invocation', async () => {
    store.closures.set('CL1', { id: 'CL1', startSeconds: 100, endSeconds: 200 })
    store.closures.set('CL2', { id: 'CL2', startSeconds: 300, endSeconds: 400 })
    store.bookings = [
      mkBooking('B1', { seasonId: 'S1', status: 'scheduled', dateSeconds: 150 }),
      mkBooking('B2', { seasonId: 'S1', status: 'scheduled', dateSeconds: 350 }),
    ]
    const res = await applyClosures('S1', ['CL1', 'CL2'])
    expect(res.totalCancelled).toBe(2)
    expect(res.byClosure).toEqual({ CL1: 1, CL2: 1 })
  })
})

// ------------------------------------------------------------
// Trigger gate — `applyClosurePeriod` handler.
// ------------------------------------------------------------

describe('applyClosurePeriod trigger gate', () => {
  function makeEvent(args: {
    before?: { status: string; closurePeriodIds?: string[] }
    after?: { status: string; closurePeriodIds?: string[] }
  }) {
    return {
      params: { seasonId: 'S1' },
      data: {
        before: args.before ? { data: () => args.before } : undefined,
        after: args.after ? { data: () => args.after } : undefined,
      },
    }
  }

  it('no-op when after is undefined (season deleted)', async () => {
    const handler = applyClosurePeriod as unknown as (e: unknown) => Promise<void>
    await handler(makeEvent({ before: { status: 'active' }, after: undefined }))
    expect(store.updates).toEqual([])
  })

  it('no-op when before.status != active', async () => {
    const handler = applyClosurePeriod as unknown as (e: unknown) => Promise<void>
    await handler(
      makeEvent({
        before: { status: 'draft', closurePeriodIds: [] },
        after: { status: 'active', closurePeriodIds: ['CL1'] },
      }),
    )
    expect(store.updates).toEqual([])
  })

  it('no-op when no new closures (set unchanged)', async () => {
    const handler = applyClosurePeriod as unknown as (e: unknown) => Promise<void>
    store.closures.set('CL1', { id: 'CL1', startSeconds: 100, endSeconds: 200 })
    store.bookings = [
      mkBooking('B', { seasonId: 'S1', status: 'scheduled', dateSeconds: 150 }),
    ]
    await handler(
      makeEvent({
        before: { status: 'active', closurePeriodIds: ['CL1'] },
        after: { status: 'active', closurePeriodIds: ['CL1'] },
      }),
    )
    expect(store.updates).toEqual([])
  })

  it('no-op when closure is REMOVED (no auto-uncancel)', async () => {
    const handler = applyClosurePeriod as unknown as (e: unknown) => Promise<void>
    store.closures.set('CL1', { id: 'CL1', startSeconds: 100, endSeconds: 200 })
    store.bookings = [
      mkBooking('B', { seasonId: 'S1', status: 'cancelled', dateSeconds: 150 }),
    ]
    await handler(
      makeEvent({
        before: { status: 'active', closurePeriodIds: ['CL1'] },
        after: { status: 'active', closurePeriodIds: [] },
      }),
    )
    expect(store.updates).toEqual([])
  })

  it('cancels in-range scheduled bookings when a new closure is added', async () => {
    const handler = applyClosurePeriod as unknown as (e: unknown) => Promise<void>
    store.closures.set('CL1', { id: 'CL1', startSeconds: 100, endSeconds: 200 })
    store.bookings = [
      mkBooking('B', { seasonId: 'S1', status: 'scheduled', dateSeconds: 150 }),
    ]
    await handler(
      makeEvent({
        before: { status: 'active', closurePeriodIds: [] },
        after: { status: 'active', closurePeriodIds: ['CL1'] },
      }),
    )
    expect(store.updates.map((u) => u.id)).toEqual(['B'])
    expect(store.updates[0].payload).toMatchObject({
      status: 'cancelled',
      cancelReason: 'closure',
    })
  })
})
