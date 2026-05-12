/**
 * Tests de `previewSeasonBookings` :
 *  - calcule les compteurs sans écrire
 *  - refuse les callers non-admin
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('firebase-admin', () => ({
  default: {},
  firestore: Object.assign(() => ({}), {
    Timestamp: { fromDate: (d: Date) => ({ seconds: d.getTime() / 1000, nanoseconds: 0 }) },
    FieldValue: { serverTimestamp: () => '__SERVER_TIMESTAMP__' },
  }),
  initializeApp: vi.fn(),
}))

vi.mock('firebase-functions/v2', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// onCall wrapper passthrough — on appellera le handler directement.
vi.mock('firebase-functions/v2/https', async () => {
  const real = await vi.importActual<typeof import('firebase-functions/v2/https')>(
    'firebase-functions/v2/https',
  )
  return {
    ...real,
    onCall: <T,>(handler: T) => handler,
  }
})

import { previewSeasonBookings, computePreview } from './previewSeasonBookings'
import * as helpers from './_helpers'
import type { SeasonDoc } from './_helpers'
import { HttpsError } from 'firebase-functions/v2/https'

interface FakeSnap {
  id: string
  exists: boolean
  data: () => Record<string, unknown>
}

interface FakeStore {
  season: SeasonDoc | null
  courtsByVenue: Map<string, FakeSnap[]>
  slotsByVenueCourt: Map<string, FakeSnap[]>
  user: { exists: boolean; data?: () => Record<string, unknown> }
  writes: number
}

function tsFromDate(d: Date): FirebaseFirestore.Timestamp {
  return {
    seconds: Math.floor(d.getTime() / 1000),
    nanoseconds: 0,
    toDate: () => new Date(d.getTime()),
  } as unknown as FirebaseFirestore.Timestamp
}

function makeFakeFirestore(store: FakeStore): FirebaseFirestore.Firestore {
  const firestore = {
    collection(name: string) {
      if (name === 'seasons') {
        return {
          doc(_id: string) {
            return {
              async get(): Promise<FakeSnap> {
                if (store.season === null) {
                  return { id: 'S1', exists: false, data: () => ({}) }
                }
                return {
                  id: 'S1',
                  exists: true,
                  data: () => store.season as unknown as Record<string, unknown>,
                }
              },
              async update(_payload: Record<string, unknown>) {
                store.writes += 1
              },
            }
          },
        }
      }
      if (name === 'venues') {
        return {
          doc(venueId: string) {
            return {
              collection(_sub: string) {
                return {
                  where(_f: string, _o: string, _v: unknown) {
                    return {
                      async get() {
                        return { docs: store.courtsByVenue.get(venueId) ?? [] }
                      },
                    }
                  },
                  doc(courtId: string) {
                    return {
                      collection(_sub2: string) {
                        return {
                          where(_f: string, _o: string, _v: unknown) {
                            return {
                              where(_f2: string, _o2: string, _v2: unknown) {
                                return {
                                  async get() {
                                    return {
                                      docs:
                                        store.slotsByVenueCourt.get(
                                          `${venueId}/${courtId}`,
                                        ) ?? [],
                                    }
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
              },
            }
          },
        }
      }
      if (name === 'closurePeriods') {
        return {
          doc(id: string) {
            return { id }
          },
        }
      }
      if (name === 'users') {
        return {
          doc(_uid: string) {
            return {
              async get() {
                return store.user
              },
            }
          },
        }
      }
      throw new Error(`unexpected collection ${name}`)
    },
    async getAll(...refs: Array<{ id: string }>): Promise<FakeSnap[]> {
      return refs.map((r) => ({ id: r.id, exists: false, data: () => ({}) }))
    },
  }
  return firestore as unknown as FirebaseFirestore.Firestore
}

let store: FakeStore

beforeEach(() => {
  store = {
    season: null,
    courtsByVenue: new Map(),
    slotsByVenueCourt: new Map(),
    user: { exists: false },
    writes: 0,
  }
  vi.spyOn(helpers, 'db').mockImplementation(() => makeFakeFirestore(store))
})

function makeSeason(): SeasonDoc {
  return {
    name: '2025-2026',
    startDate: tsFromDate(helpers.utcMidnight(2025, 8, 1)),
    endDate: tsFromDate(helpers.utcMidnight(2025, 8, 30)),
    status: 'active',
    activeVenueIds: ['V1'],
    closurePeriodIds: [],
    generatedAt: null,
  }
}

const mondaySlot: FakeSnap = {
  id: 'T1',
  exists: true,
  data: () => ({
    dayOfWeek: 1,
    startTime: '18:00',
    endTime: '19:30',
    label: 't',
    seasonId: 'S1',
    requiresFullCourt: true,
    teamId: 'TEAM1',
    slotType: 'training',
    customTypeName: null,
    matchTypeId: null,
    active: true,
  }),
}

const court: FakeSnap = {
  id: 'C1',
  exists: true,
  data: () => ({
    name: 'C1',
    courtSize: 'normal',
    isCombined: false,
    combinedCourtIds: [],
    sport: 'basket',
    active: true,
  }),
}

describe('computePreview', () => {
  it('retourne count + byCourt + byDayOfWeek sans écrire', async () => {
    store.season = makeSeason()
    store.courtsByVenue.set('V1', [court])
    store.slotsByVenueCourt.set('V1/C1', [mondaySlot])
    const res = await computePreview('S1')
    expect(res.count).toBe(5)
    expect(res.byCourt).toEqual({ C1: 5 })
    // dayOfWeek 1 = Monday → 5 entrées
    expect(res.byDayOfWeek).toEqual([0, 5, 0, 0, 0, 0, 0])
    expect(store.writes).toBe(0)
  })

  it("404 si la saison n'existe pas", async () => {
    store.season = null
    await expect(computePreview('S1')).rejects.toThrow()
  })
})

describe('previewSeasonBookings (callable wrapper)', () => {
  function callHandler(
    auth: { uid: string; token: Record<string, unknown> } | null,
    data: { seasonId?: string } = { seasonId: 'S1' },
  ): Promise<unknown> {
    const handler = previewSeasonBookings as unknown as (req: unknown) => Promise<unknown>
    return handler({ auth, data, rawRequest: {} })
  }

  it('refuse sans auth', async () => {
    await expect(callHandler(null)).rejects.toBeInstanceOf(HttpsError)
  })

  it('refuse caller sans rootAdmin ni rôle admin', async () => {
    store.season = makeSeason()
    store.user = {
      exists: true,
      data: () => ({ roles: ['coach'] }),
    }
    await expect(callHandler({ uid: 'u1', token: {} })).rejects.toBeInstanceOf(HttpsError)
  })

  it('accepte rootAdmin', async () => {
    store.season = makeSeason()
    store.courtsByVenue.set('V1', [court])
    store.slotsByVenueCourt.set('V1/C1', [mondaySlot])
    const out = (await callHandler({ uid: 'u1', token: { rootAdmin: true } })) as {
      count: number
    }
    expect(out.count).toBe(5)
  })

  it('accepte admin via /users/{uid}.roles', async () => {
    store.season = makeSeason()
    store.courtsByVenue.set('V1', [court])
    store.slotsByVenueCourt.set('V1/C1', [mondaySlot])
    store.user = {
      exists: true,
      data: () => ({ roles: ['admin'] }),
    }
    const out = (await callHandler({ uid: 'u1', token: {} })) as { count: number }
    expect(out.count).toBe(5)
  })

  it("invalid-argument sur seasonId manquant", async () => {
    await expect(
      callHandler({ uid: 'u1', token: { rootAdmin: true } }, {}),
    ).rejects.toBeInstanceOf(HttpsError)
  })
})
