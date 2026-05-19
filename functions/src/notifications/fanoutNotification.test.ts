/**
 * Tests pour `fanoutNotification` — le fan-out FCM des notifications.
 *
 * Stratégie : on mock `./_helpers` (db / serverTimestamp) avec un Firestore
 * en mémoire, et `firebase-admin/messaging` pour intercepter
 * `sendEachForMulticast`. On exerce le cœur via `processNotification` et les
 * helpers exportés (`resolveAudience`, `collectTokens`, `chunk`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotificationData } from '@club-app/shared-types'

// --- Fakes Firestore --------------------------------------------------------

interface FakeDoc<T = Record<string, unknown>> {
  id: string
  data: () => T
}

interface FakeSnap<T = Record<string, unknown>> {
  empty: boolean
  size: number
  docs: FakeDoc<T>[]
}

function snapOf<T extends Record<string, unknown>>(
  entries: Array<{ id: string; data: T }>,
): FakeSnap<T> {
  return {
    empty: entries.length === 0,
    size: entries.length,
    docs: entries.map((e) => ({ id: e.id, data: () => e.data })),
  }
}

/** État global réinitialisé à chaque test. */
const state: {
  /** memberId -> member data */
  members: Map<string, Record<string, unknown>>
  /** parentPath (`bookings/x` | `matches/x`) -> assignment docs */
  assignments: Map<string, Array<{ id: string; data: Record<string, unknown> }>>
  /** uid -> token doc ids */
  fcmTokens: Map<string, string[]>
  /** deleted token doc paths */
  deletedPaths: string[]
} = {
  members: new Map(),
  assignments: new Map(),
  fcmTokens: new Map(),
  deletedPaths: [],
}

function fakeCollection(path: string): { get: () => Promise<FakeSnap> } {
  return {
    get: async () => {
      if (path === 'members') {
        return snapOf(
          [...state.members.entries()].map(([id, data]) => ({ id, data })),
        )
      }
      // `bookings/{id}/officialAssignments` or `matches/{id}/officialAssignments`
      const assignMatch = path.match(/^(.+)\/officialAssignments$/)
      if (assignMatch) {
        const parent = assignMatch[1]
        return snapOf(state.assignments.get(parent) ?? [])
      }
      // `users/{uid}/fcmTokens`
      const tokenMatch = path.match(/^users\/(.+)\/fcmTokens$/)
      if (tokenMatch) {
        const uid = tokenMatch[1]
        const tokens = state.fcmTokens.get(uid) ?? []
        return snapOf(
          tokens.map((tok) => ({
            id: tok,
            data: {
              token: tok,
              platform: 'ios',
              createdAt: { seconds: 0, nanoseconds: 0 },
              lastSeenAt: { seconds: 0, nanoseconds: 0 },
            },
          })),
        )
      }
      return snapOf([])
    },
  }
}

const fakeDb = {
  collection: vi.fn((path: string) => {
    // `members` collection also needs `.where()` for the array-contains query.
    if (path === 'members') {
      return {
        where: (_field: string, _op: string, value: unknown) => ({
          get: async () => {
            if (value === 'official') {
              return snapOf(
                [...state.members.entries()]
                  .filter(([, d]) => {
                    const roles = d.roles
                    return Array.isArray(roles) && roles.includes('official')
                  })
                  .map(([id, data]) => ({ id, data })),
              )
            }
            return snapOf([])
          },
        }),
        get: fakeCollection('members').get,
      }
    }
    return fakeCollection(path)
  }),
  doc: vi.fn((path: string) => ({
    delete: async () => {
      state.deletedPaths.push(path)
    },
  })),
}

// --- Mock FCM messaging -----------------------------------------------------

const sendEachForMulticast = vi.fn()

vi.mock('firebase-admin/messaging', () => ({
  getMessaging: () => ({
    sendEachForMulticast,
  }),
}))

vi.mock('./_helpers', async () => {
  const actual = await vi.importActual<typeof import('./_helpers')>('./_helpers')
  return {
    ...actual,
    db: () => fakeDb,
    serverTimestamp: () => '__SERVER_TS__',
  }
})

vi.mock('../shared/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

let mod: typeof import('./fanoutNotification')

beforeEach(async () => {
  vi.clearAllMocks()
  state.members = new Map()
  state.assignments = new Map()
  state.fcmTokens = new Map()
  state.deletedPaths = []
  // Default : every send succeeds.
  sendEachForMulticast.mockImplementation(
    async (msg: { tokens: string[] }) => ({
      successCount: msg.tokens.length,
      failureCount: 0,
      responses: msg.tokens.map(() => ({ success: true })),
    }),
  )
  mod = await import('./fanoutNotification')
})

afterEach(() => {
  vi.restoreAllMocks()
})

// --- Builders ---------------------------------------------------------------

function makeNotif(over: Partial<NotificationData> = {}): NotificationData {
  return {
    type: 'new_match',
    title: 'New match',
    body: 'A match was scheduled',
    sentBy: null,
    targetAudience: 'all_officials',
    relatedBookingId: null,
    relatedMatchId: null,
    createdAt: { seconds: 0, nanoseconds: 0 },
    readBy: [],
    pushedAt: null,
    ...over,
  }
}

function addMember(
  id: string,
  opts: {
    roles?: string[]
    officialLevel?: number | null
    linkedUserId?: string | null
  },
): void {
  state.members.set(id, {
    firstName: 'F',
    lastName: 'L',
    roles: opts.roles ?? [],
    officialLevel: opts.officialLevel ?? null,
    linkedUserId: opts.linkedUserId ?? null,
  })
}

function addAssignments(
  parentPath: string,
  rows: Array<{ memberId: string; status: string }>,
): void {
  state.assignments.set(
    parentPath,
    rows.map((r, idx) => ({
      id: `a-${idx}`,
      data: {
        memberId: r.memberId,
        officialLevel: 1,
        status: r.status,
      },
    })),
  )
}

// ---------------------------------------------------------------------------

describe('chunk', () => {
  it('splits into batches of at most size', () => {
    expect(mod.chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('returns empty for empty input', () => {
    expect(mod.chunk([], 500)).toEqual([])
  })

  it('handles a single full batch', () => {
    expect(mod.chunk([1, 2], 2)).toEqual([[1, 2]])
  })

  it('throws on non-positive size', () => {
    expect(() => mod.chunk([1], 0)).toThrow()
  })
})

describe('resolveAudience', () => {
  it('all_officials → every official with an Auth account', async () => {
    addMember('m1', { roles: ['official'], linkedUserId: 'u1' })
    addMember('m2', { roles: ['official'], linkedUserId: 'u2' })
    addMember('m3', { roles: ['player'], linkedUserId: 'u3' }) // not official

    const uids = await mod.resolveAudience(
      makeNotif({ targetAudience: 'all_officials' }),
    )
    expect([...uids].sort()).toEqual(['u1', 'u2'])
  })

  it('fallback : member with officialLevel but no official role is included', async () => {
    addMember('m1', { roles: [], officialLevel: 2, linkedUserId: 'u1' })

    const uids = await mod.resolveAudience(
      makeNotif({ targetAudience: 'all_officials' }),
    )
    expect([...uids]).toEqual(['u1'])
  })

  it('skips officials with no linkedUserId', async () => {
    addMember('m1', { roles: ['official'], linkedUserId: 'u1' })
    addMember('m2', { roles: ['official'], linkedUserId: null }) // no Auth

    const uids = await mod.resolveAudience(
      makeNotif({ targetAudience: 'all_officials' }),
    )
    expect([...uids]).toEqual(['u1'])
  })

  it('assigned_officials → officials assigned to the related booking', async () => {
    addMember('m1', { roles: ['official'], linkedUserId: 'u1' })
    addMember('m2', { roles: ['official'], linkedUserId: 'u2' })
    addMember('m3', { roles: ['official'], linkedUserId: 'u3' })
    addAssignments('bookings/b1', [
      { memberId: 'm1', status: 'confirmed' },
      { memberId: 'm2', status: 'pending' },
      { memberId: 'm3', status: 'declined' }, // declined → not assigned
    ])

    const uids = await mod.resolveAudience(
      makeNotif({
        targetAudience: 'assigned_officials',
        relatedBookingId: 'b1',
      }),
    )
    expect([...uids].sort()).toEqual(['u1', 'u2'])
  })

  it('assigned_officials → reads /matches sub-collection when relatedMatchId set', async () => {
    addMember('m1', { roles: ['official'], linkedUserId: 'u1' })
    addAssignments('matches/x1', [{ memberId: 'm1', status: 'confirmed' }])

    const uids = await mod.resolveAudience(
      makeNotif({
        targetAudience: 'assigned_officials',
        relatedMatchId: 'x1',
      }),
    )
    expect([...uids]).toEqual(['u1'])
  })

  it('unassigned_officials → all officials minus assigned', async () => {
    addMember('m1', { roles: ['official'], linkedUserId: 'u1' })
    addMember('m2', { roles: ['official'], linkedUserId: 'u2' })
    addMember('m3', { roles: ['official'], linkedUserId: 'u3' })
    addAssignments('bookings/b1', [{ memberId: 'm1', status: 'confirmed' }])

    const uids = await mod.resolveAudience(
      makeNotif({
        targetAudience: 'unassigned_officials',
        relatedBookingId: 'b1',
      }),
    )
    expect([...uids].sort()).toEqual(['u2', 'u3'])
  })

  it('falls back to all_officials when event-based audience has no related event', async () => {
    addMember('m1', { roles: ['official'], linkedUserId: 'u1' })
    addMember('m2', { roles: ['official'], linkedUserId: 'u2' })

    const uids = await mod.resolveAudience(
      makeNotif({
        targetAudience: 'unassigned_officials',
        relatedBookingId: null,
        relatedMatchId: null,
      }),
    )
    expect([...uids].sort()).toEqual(['u1', 'u2'])
  })
})

describe('collectTokens', () => {
  it('collects and dedups token strings across users', async () => {
    state.fcmTokens.set('u1', ['tokA', 'tokB'])
    state.fcmTokens.set('u2', ['tokB', 'tokC']) // tokB shared → dedup

    const map = await mod.collectTokens(new Set(['u1', 'u2']))
    expect([...map.keys()].sort()).toEqual(['tokA', 'tokB', 'tokC'])
    // tokB's owner is the last writer (u2).
    expect(map.get('tokB')).toEqual({ uid: 'u2', tokenDocId: 'tokB' })
  })

  it('returns an empty map when no user has tokens', async () => {
    const map = await mod.collectTokens(new Set(['u1']))
    expect(map.size).toBe(0)
  })
})

describe('processNotification', () => {
  it('idempotency guard : pushedAt already set → no-op', async () => {
    addMember('m1', { roles: ['official'], linkedUserId: 'u1' })
    state.fcmTokens.set('u1', ['tokA'])
    const markPushed = vi.fn(async () => {})

    const out = await mod.processNotification(
      'n1',
      makeNotif({ pushedAt: { seconds: 123, nanoseconds: 0 } }),
      markPushed,
    )

    expect(out).toEqual({ pushed: false, recipients: 0, tokens: 0 })
    expect(sendEachForMulticast).not.toHaveBeenCalled()
    expect(markPushed).not.toHaveBeenCalled()
  })

  it('sends a push to resolved officials and marks pushedAt', async () => {
    addMember('m1', { roles: ['official'], linkedUserId: 'u1' })
    addMember('m2', { roles: ['official'], linkedUserId: 'u2' })
    state.fcmTokens.set('u1', ['tokA'])
    state.fcmTokens.set('u2', ['tokB'])
    const markPushed = vi.fn(async () => {})

    const out = await mod.processNotification(
      'n1',
      makeNotif({ targetAudience: 'all_officials' }),
      markPushed,
    )

    expect(out).toEqual({ pushed: true, recipients: 2, tokens: 2 })
    expect(sendEachForMulticast).toHaveBeenCalledTimes(1)
    const msg = sendEachForMulticast.mock.calls[0][0]
    expect(msg.tokens.sort()).toEqual(['tokA', 'tokB'])
    expect(msg.notification).toEqual({
      title: 'New match',
      body: 'A match was scheduled',
    })
    expect(msg.data).toEqual({
      notificationId: 'n1',
      type: 'new_match',
      relatedBookingId: '',
      relatedMatchId: '',
    })
    expect(msg.android.priority).toBe('high')
    expect(markPushed).toHaveBeenCalledTimes(1)
  })

  it('data payload uses string values, null → empty string', async () => {
    addMember('m1', { roles: ['official'], linkedUserId: 'u1' })
    state.fcmTokens.set('u1', ['tokA'])

    await mod.processNotification(
      'n2',
      makeNotif({
        type: 'officials_needed',
        relatedBookingId: 'b9',
        relatedMatchId: null,
      }),
      async () => {},
    )

    const msg = sendEachForMulticast.mock.calls[0][0]
    expect(msg.data).toEqual({
      notificationId: 'n2',
      type: 'officials_needed',
      relatedBookingId: 'b9',
      relatedMatchId: '',
    })
  })

  it('zero tokens : skips send but still marks pushedAt', async () => {
    addMember('m1', { roles: ['official'], linkedUserId: 'u1' })
    // u1 has no fcmTokens registered.
    const markPushed = vi.fn(async () => {})

    const out = await mod.processNotification(
      'n1',
      makeNotif({ targetAudience: 'all_officials' }),
      markPushed,
    )

    expect(out).toEqual({ pushed: true, recipients: 1, tokens: 0 })
    expect(sendEachForMulticast).not.toHaveBeenCalled()
    expect(markPushed).toHaveBeenCalledTimes(1)
  })

  it('dedups a token shared by two users into a single multicast entry', async () => {
    addMember('m1', { roles: ['official'], linkedUserId: 'u1' })
    addMember('m2', { roles: ['official'], linkedUserId: 'u2' })
    state.fcmTokens.set('u1', ['shared'])
    state.fcmTokens.set('u2', ['shared'])

    const out = await mod.processNotification(
      'n1',
      makeNotif(),
      async () => {},
    )

    expect(out.tokens).toBe(1)
    const msg = sendEachForMulticast.mock.calls[0][0]
    expect(msg.tokens).toEqual(['shared'])
  })

  it('cleans up stale tokens reported by FCM', async () => {
    addMember('m1', { roles: ['official'], linkedUserId: 'u1' })
    state.fcmTokens.set('u1', ['good', 'dead', 'bad'])

    sendEachForMulticast.mockImplementationOnce(
      async (msg: { tokens: string[] }) => ({
        successCount: 1,
        failureCount: 2,
        responses: msg.tokens.map((tok) => {
          if (tok === 'dead') {
            return {
              success: false,
              error: { code: 'messaging/registration-token-not-registered' },
            }
          }
          if (tok === 'bad') {
            return {
              success: false,
              error: { code: 'messaging/invalid-argument' },
            }
          }
          return { success: true }
        }),
      }),
    )

    await mod.processNotification('n1', makeNotif(), async () => {})

    expect(state.deletedPaths.sort()).toEqual([
      'users/u1/fcmTokens/bad',
      'users/u1/fcmTokens/dead',
    ])
  })

  it('does not delete tokens for transient (non-stale) FCM errors', async () => {
    addMember('m1', { roles: ['official'], linkedUserId: 'u1' })
    state.fcmTokens.set('u1', ['transient'])

    sendEachForMulticast.mockImplementationOnce(async () => ({
      successCount: 0,
      failureCount: 1,
      responses: [
        { success: false, error: { code: 'messaging/internal-error' } },
      ],
    }))

    await mod.processNotification('n1', makeNotif(), async () => {})

    expect(state.deletedPaths).toEqual([])
  })

  it('chunks tokens into batches of 500 for multicast', async () => {
    addMember('m1', { roles: ['official'], linkedUserId: 'u1' })
    const tokens = Array.from({ length: 1200 }, (_, i) => `t${i}`)
    state.fcmTokens.set('u1', tokens)

    const out = await mod.processNotification('n1', makeNotif(), async () => {})

    expect(out.tokens).toBe(1200)
    expect(sendEachForMulticast).toHaveBeenCalledTimes(3)
    const batchSizes = sendEachForMulticast.mock.calls.map(
      (c) => (c[0] as { tokens: string[] }).tokens.length,
    )
    expect(batchSizes).toEqual([500, 500, 200])
  })
})
