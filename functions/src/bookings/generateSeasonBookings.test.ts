/**
 * Tests bout-en-bout (Firestore mocké) de `runGeneration` (cœur extrait du trigger).
 *
 * Stratégie : on mocke `./_helpers.db` pour renvoyer un faux `Firestore` qui
 * répond aux quelques opérations utilisées par `runGeneration` :
 *  - `collection('venues').doc(v).collection('courts').where(...).get()`
 *  - `collection('venues').doc(v).collection('courts').doc(c).collection('timeSlots').where(...).get()`
 *  - `collection('closurePeriods').doc(id)` + `firestore.getAll(...refs)`
 *  - `collection('seasons').doc(s).update(...)`
 *  - `firestore.batch()` + `firestore.doc(path)`
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock `firebase-admin` AVANT d'importer le module sous test : sinon
// `admin.firestore.Timestamp.fromDate` / `admin.firestore.FieldValue.serverTimestamp`
// référencés dans `runGeneration` exploseraient.
vi.mock('firebase-admin', () => {
  const fromDate = (d: Date): unknown => ({
    seconds: Math.floor(d.getTime() / 1000),
    nanoseconds: 0,
    toDate: () => new Date(d.getTime()),
  })
  const serverTimestamp = (): string => '__SERVER_TIMESTAMP__'
  return {
    default: {},
    firestore: Object.assign(() => ({}), {
      Timestamp: { fromDate },
      FieldValue: { serverTimestamp },
    }),
    initializeApp: vi.fn(),
  }
})

vi.mock('firebase-functions/v2', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// `firebase-functions/v2/firestore` exporte `onDocumentWritten` qu'on n'invoque pas
// directement dans les tests : on ne teste que `runGeneration`. Stub par sécurité.
vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentWritten: (_path: string, handler: unknown) => handler,
}))

import { runGeneration } from './generateSeasonBookings'
import * as helpers from './_helpers'
import type { SeasonDoc } from './_helpers'

interface FakeSnap {
  id: string
  exists: boolean
  data: () => Record<string, unknown>
}

interface FakeQuerySnap {
  docs: FakeSnap[]
}

// ------------------------------------------------------------
// In-memory faux Firestore.
// ------------------------------------------------------------

interface FakeFirestoreStore {
  courtsByVenue: Map<string, FakeSnap[]>
  slotsByVenueCourt: Map<string, FakeSnap[]>
  closurePeriods: Map<string, FakeSnap>
  bookingWrites: Array<{ path: string; payload: Record<string, unknown> }>
  seasonUpdates: Array<Record<string, unknown>>
  batchCommitCount: number
}

function makeFakeFirestore(store: FakeFirestoreStore): FirebaseFirestore.Firestore {
  function venuesPath(venueId: string, courtId?: string) {
    return courtId ? `${venueId}/${courtId}` : venueId
  }
  const firestore = {
    collection(name: string) {
      if (name === 'venues') {
        return {
          doc(venueId: string) {
            return {
              collection(sub: string) {
                if (sub === 'courts') {
                  return {
                    where(_field: string, _op: string, _val: unknown) {
                      return {
                        async get(): Promise<FakeQuerySnap> {
                          return { docs: store.courtsByVenue.get(venueId) ?? [] }
                        },
                      }
                    },
                    doc(courtId: string) {
                      return {
                        collection(sub2: string) {
                          if (sub2 !== 'timeSlots') throw new Error('unexpected')
                          return {
                            where(_f: string, _o: string, _v: unknown) {
                              return {
                                where(_f2: string, _o2: string, _v2: unknown) {
                                  return {
                                    async get(): Promise<FakeQuerySnap> {
                                      const key = venuesPath(venueId, courtId)
                                      return { docs: store.slotsByVenueCourt.get(key) ?? [] }
                                    },
                                  }
                                },
                              }
                            },
                          }
                        },
                      }
                    },
                  }
                }
                throw new Error(`unexpected sub ${sub}`)
              },
            }
          },
        }
      }
      if (name === 'closurePeriods') {
        return {
          doc(id: string) {
            return { id, __closure: true } as unknown as FirebaseFirestore.DocumentReference
          },
        }
      }
      if (name === 'seasons') {
        return {
          doc(_id: string) {
            return {
              async update(payload: Record<string, unknown>) {
                store.seasonUpdates.push(payload)
              },
            }
          },
        }
      }
      throw new Error(`unexpected collection ${name}`)
    },
    async getAll(...refs: Array<{ id: string; __closure?: boolean }>): Promise<FakeSnap[]> {
      return refs.map((r) => {
        const existing = store.closurePeriods.get(r.id)
        if (existing) return existing
        return { id: r.id, exists: false, data: () => ({}) }
      })
    },
    batch() {
      const ops: Array<{ path: string; payload: Record<string, unknown> }> = []
      return {
        set(ref: { __path: string }, payload: Record<string, unknown>) {
          ops.push({ path: ref.__path, payload })
        },
        async commit() {
          store.batchCommitCount += 1
          store.bookingWrites.push(...ops)
        },
      }
    },
    doc(path: string) {
      return { __path: path } as unknown as FirebaseFirestore.DocumentReference
    },
  }
  return firestore as unknown as FirebaseFirestore.Firestore
}

function makeSeasonDoc(overrides: Partial<SeasonDoc> = {}): SeasonDoc {
  const start = helpers.utcMidnight(2025, 8, 1) // Mon 2025-09-01
  const end = helpers.utcMidnight(2025, 8, 30) // Tue 2025-09-30
  const tsFromDate = (d: Date): FirebaseFirestore.Timestamp =>
    ({
      seconds: Math.floor(d.getTime() / 1000),
      nanoseconds: 0,
      toDate: () => new Date(d.getTime()),
    }) as unknown as FirebaseFirestore.Timestamp
  return {
    name: '2025-2026',
    startDate: tsFromDate(start),
    endDate: tsFromDate(end),
    status: 'active',
    activeVenueIds: ['V1'],
    closurePeriodIds: [],
    generatedAt: null,
    ...overrides,
  }
}

function mondaySlotSnap(): FakeSnap {
  return {
    id: 'T1',
    exists: true,
    data: () => ({
      dayOfWeek: 1,
      startTime: '18:00',
      endTime: '19:30',
      label: 'training U20F',
      seasonId: 'S1',
      requiresFullCourt: true,
      teamId: 'TEAM1',
      slotType: 'training',
      customTypeName: null,
      matchTypeId: null,
      active: true,
    }),
  }
}

function courtSnap(): FakeSnap {
  return {
    id: 'C1',
    exists: true,
    data: () => ({
      name: 'Court 1',
      courtSize: 'normal',
      isCombined: false,
      combinedCourtIds: [],
      sport: 'basket',
      active: true,
    }),
  }
}

let store: FakeFirestoreStore

beforeEach(() => {
  store = {
    courtsByVenue: new Map(),
    slotsByVenueCourt: new Map(),
    closurePeriods: new Map(),
    bookingWrites: [],
    seasonUpdates: [],
    batchCommitCount: 0,
  }
  vi.spyOn(helpers, 'db').mockImplementation(() => makeFakeFirestore(store))
})

describe('runGeneration — date iteration', () => {
  it('5 lundis dans [2025-09-01, 2025-09-30] → 5 bookings', async () => {
    store.courtsByVenue.set('V1', [courtSnap()])
    store.slotsByVenueCourt.set('V1/C1', [mondaySlotSnap()])
    const res = await runGeneration('S1', makeSeasonDoc())
    expect(res.totalBookings).toBe(5)
    expect(res.byCourt).toEqual({ C1: 5 })
    expect(store.bookingWrites).toHaveLength(5)
    expect(store.bookingWrites.map((w) => w.path)).toEqual([
      'bookings/S1_C1_T1_20250901',
      'bookings/S1_C1_T1_20250908',
      'bookings/S1_C1_T1_20250915',
      'bookings/S1_C1_T1_20250922',
      'bookings/S1_C1_T1_20250929',
    ])
    expect(store.seasonUpdates).toHaveLength(1)
    expect(store.seasonUpdates[0]).toEqual({ generatedAt: '__SERVER_TIMESTAMP__' })
  })

  it('payload de booking : status=scheduled, mirrors le slot', async () => {
    store.courtsByVenue.set('V1', [courtSnap()])
    store.slotsByVenueCourt.set('V1/C1', [mondaySlotSnap()])
    await runGeneration('S1', makeSeasonDoc())
    const first = store.bookingWrites[0]?.payload
    expect(first).toBeDefined()
    expect(first?.seasonId).toBe('S1')
    expect(first?.venueId).toBe('V1')
    expect(first?.courtId).toBe('C1')
    expect(first?.timeSlotId).toBe('T1')
    expect(first?.teamId).toBe('TEAM1')
    expect(first?.slotType).toBe('training')
    expect(first?.matchTypeId).toBeNull()
    expect(first?.startTime).toBe('18:00')
    expect(first?.endTime).toBe('19:30')
    expect(first?.status).toBe('scheduled')
    expect(first?.cancelReason).toBeNull()
    expect(first?.linkedBookingIds).toEqual([])
    expect(first?.isCombinedCourtEvent).toBe(false)
    expect(first?.actionLog).toEqual([])
  })
})

describe('runGeneration — closure skipping', () => {
  it('closure [2025-09-08, 2025-09-14] → skip 2025-09-08 (mon), keep 4 autres lundis', async () => {
    const tsFromDate = (d: Date): FirebaseFirestore.Timestamp =>
      ({
        seconds: Math.floor(d.getTime() / 1000),
        nanoseconds: 0,
        toDate: () => new Date(d.getTime()),
      }) as unknown as FirebaseFirestore.Timestamp
    store.closurePeriods.set('CL1', {
      id: 'CL1',
      exists: true,
      data: () => ({
        name: 'fall break',
        type: 'holiday',
        createdBy: 'u',
        startDate: tsFromDate(helpers.utcMidnight(2025, 8, 8)),
        endDate: tsFromDate(helpers.utcMidnight(2025, 8, 14)),
      }),
    })
    store.courtsByVenue.set('V1', [courtSnap()])
    store.slotsByVenueCourt.set('V1/C1', [mondaySlotSnap()])
    const res = await runGeneration(
      'S1',
      makeSeasonDoc({ closurePeriodIds: ['CL1'] }),
    )
    expect(res.totalBookings).toBe(4)
    expect(store.bookingWrites.map((w) => w.path)).toEqual([
      'bookings/S1_C1_T1_20250901',
      'bookings/S1_C1_T1_20250915',
      'bookings/S1_C1_T1_20250922',
      'bookings/S1_C1_T1_20250929',
    ])
  })
})

describe('runGeneration — batching', () => {
  it('split en plusieurs batches au-dessus du seuil', async () => {
    // Forge plusieurs courts pour passer la barre des 450.
    const COURTS = 100 // 100 courts × 5 lundis = 500 bookings → 2 batches
    const courts: FakeSnap[] = []
    for (let i = 0; i < COURTS; i += 1) {
      const id = `C${i}`
      courts.push({
        id,
        exists: true,
        data: () => ({
          name: `Court ${i}`,
          courtSize: 'normal',
          isCombined: false,
          combinedCourtIds: [],
          sport: 'basket',
          active: true,
        }),
      })
      store.slotsByVenueCourt.set(`V1/${id}`, [mondaySlotSnap()])
    }
    store.courtsByVenue.set('V1', courts)
    const res = await runGeneration('S1', makeSeasonDoc())
    expect(res.totalBookings).toBe(COURTS * 5)
    expect(store.batchCommitCount).toBeGreaterThanOrEqual(2)
  })
})
