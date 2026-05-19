/**
 * Tests for `coachCreateAwayMatch` — the coach/admin away-match callable.
 *
 * Strategy : we mock `./_helpers` (db / freeConflictingTrainings /
 * serverTimestamp / utcMidnight) with in-memory fakes, and `../shared/logger`.
 * `utcMidnight` is kept REAL (imported from the actual module) — the
 * UTC-midnight contract is exactly what we want to assert.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HttpsError } from 'firebase-functions/v2/https'

interface FakeDoc {
  exists: boolean
  data: () => Record<string, unknown> | undefined
}

const state: {
  /** path → fake doc. */
  docs: Map<string, FakeDoc>
  /** payloads passed to matches.add(). */
  addCalls: Record<string, unknown>[]
  /** when set, matches.add() rejects. */
  addThrows: boolean
  /** when set, freeConflictingTrainings rejects. */
  freeThrows: boolean
  /** ids returned by a successful freeConflictingTrainings. */
  freedIds: string[]
  /** args captured from the freeConflictingTrainings call. */
  freeArgs: Record<string, unknown> | null
} = {
  docs: new Map(),
  addCalls: [],
  addThrows: false,
  freeThrows: false,
  freedIds: [],
  freeArgs: null,
}

const fakeDb = {
  doc: (path: string) => ({
    path,
    get: async (): Promise<FakeDoc> =>
      state.docs.get(path) ?? { exists: false, data: () => undefined },
  }),
  collection: (name: string) => ({
    add: async (payload: Record<string, unknown>) => {
      if (name === 'matches' && state.addThrows) {
        throw new Error('add failed')
      }
      state.addCalls.push(payload)
      return { id: `match-${state.addCalls.length}` }
    },
  }),
}

vi.mock('./_helpers', async () => {
  const actual = await vi.importActual<typeof import('./_helpers')>('./_helpers')
  return {
    ...actual,
    db: () => fakeDb,
    serverTimestamp: () => '__SERVER_TS__',
    freeConflictingTrainings: vi.fn(
      async (args: Record<string, unknown>): Promise<string[]> => {
        state.freeArgs = args
        if (state.freeThrows) throw new Error('free failed')
        return state.freedIds
      },
    ),
  }
})

vi.mock('../shared/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

let mod: typeof import('./coachCreateAwayMatch')
let helpers: typeof import('./_helpers')

beforeEach(async () => {
  vi.clearAllMocks()
  state.docs = new Map()
  state.addCalls = []
  state.addThrows = false
  state.freeThrows = false
  state.freedIds = []
  state.freeArgs = null
  mod = await import('./coachCreateAwayMatch')
  helpers = await import('./_helpers')
})

afterEach(() => {
  vi.restoreAllMocks()
})

// --- fixture helpers --------------------------------------------------------

function setUser(
  uid: string,
  opts: { roles?: string[]; teamIds?: string[] } = {},
): void {
  state.docs.set(`users/${uid}`, {
    exists: true,
    data: () => ({
      email: `${uid}@club.test`,
      displayName: uid,
      photoURL: '',
      roles: opts.roles ?? [],
      memberId: null,
      teamIds: opts.teamIds ?? [],
      phone: null,
      address: null,
      profileCompletedAt: null,
      createdAt: { seconds: 0, nanoseconds: 0 },
    }),
  })
}

function setTeam(teamId: string): void {
  state.docs.set(`teams/${teamId}`, {
    exists: true,
    data: () => ({ name: teamId, categoryId: 'cat-1' }),
  })
}

function setMatchType(id: string): void {
  state.docs.set(`matchTypes/${id}`, {
    exists: true,
    data: () => ({
      name: 'Championnat',
      requiredCourtSize: 'normal',
      homeOfficialRequirements: [],
      awayOfficialCount: 0,
      color: '#000000',
      active: true,
      createdAt: { seconds: 0, nanoseconds: 0 },
    }),
  })
}

interface MakeRequestOpts {
  uid?: string | null
  rootAdmin?: boolean
  data?: Record<string, unknown>
}

/** Valid base payload — overridable via `data`. */
function makeRequest(opts: MakeRequestOpts = {}) {
  const auth =
    opts.uid === null
      ? undefined
      : {
          uid: opts.uid ?? 'coach-1',
          token: opts.rootAdmin ? { rootAdmin: true } : {},
        }
  return {
    auth,
    data: {
      teamId: 'team-1',
      matchTypeId: 'mt-1',
      opponentName: 'Adversaire FC',
      awayAddress: 'Gymnase, Ville',
      // 2026-06-15T14:30:00Z — afternoon UTC, to prove date is floored to UTC midnight.
      date: Date.UTC(2026, 5, 15, 14, 30, 0),
      startTime: '18:00',
      endTime: '20:00',
      notes: null,
      ...opts.data,
    },
  } as unknown as Parameters<typeof mod.coachCreateAwayMatch>[0]
}

/** Invoke the callable handler. firebase-functions wraps the fn in `.run`. */
function call(
  req: ReturnType<typeof makeRequest>,
): Promise<import('./coachCreateAwayMatch').CoachCreateAwayMatchOutput> {
  const fn = mod.coachCreateAwayMatch as unknown as {
    run: (
      r: unknown,
    ) => Promise<import('./coachCreateAwayMatch').CoachCreateAwayMatchOutput>
  }
  return fn.run(req)
}

async function expectHttpsError(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code } as Partial<HttpsError>)
}

// --- tests ------------------------------------------------------------------

describe('coachCreateAwayMatch — happy path', () => {
  it('creates an away match as a coach of the team', async () => {
    setUser('coach-1', { roles: ['coach'], teamIds: ['team-1'] })
    setTeam('team-1')
    setMatchType('mt-1')

    const out = await call(makeRequest())

    expect(out).toEqual({
      ok: true,
      matchId: 'match-1',
      freedBookingIds: [],
    })
    expect(state.addCalls).toHaveLength(1)
    const payload = state.addCalls[0]!
    expect(payload).toMatchObject({
      bookingId: null,
      kind: 'away',
      teamId: 'team-1',
      matchTypeId: 'mt-1',
      opponentName: 'Adversaire FC',
      awayAddress: 'Gymnase, Ville',
      startTime: '18:00',
      endTime: '20:00',
      status: 'scheduled',
      notes: null,
      createdBy: 'coach-1',
      createdAt: '__SERVER_TS__',
    })
  })

  it('creates an away match as an admin (not on the team)', async () => {
    setUser('admin-1', { roles: ['admin'], teamIds: [] })
    setTeam('team-1')
    setMatchType('mt-1')

    const out = await call(makeRequest({ uid: 'admin-1' }))
    expect(out.ok).toBe(true)
    expect(state.addCalls).toHaveLength(1)
  })

  it('creates an away match as a rootAdmin via claim', async () => {
    setUser('root-1', { roles: [], teamIds: [] })
    setTeam('team-1')
    setMatchType('mt-1')

    const out = await call(makeRequest({ uid: 'root-1', rootAdmin: true }))
    expect(out.ok).toBe(true)
  })

  it('trims and keeps non-empty notes', async () => {
    setUser('coach-1', { roles: ['coach'], teamIds: ['team-1'] })
    setTeam('team-1')
    setMatchType('mt-1')

    await call(makeRequest({ data: { notes: '  derby important  ' } }))
    expect(state.addCalls[0]!.notes).toBe('derby important')
  })
})

describe('coachCreateAwayMatch — UTC-midnight date', () => {
  it('floors match.date to UTC midnight of the input day', async () => {
    setUser('coach-1', { roles: ['coach'], teamIds: ['team-1'] })
    setTeam('team-1')
    setMatchType('mt-1')

    await call(makeRequest())

    const stored = state.addCalls[0]!.date as FirebaseFirestore.Timestamp
    // Compare against the real utcMidnight helper.
    const expected = helpers.utcMidnight(Date.UTC(2026, 5, 15, 14, 30, 0))
    expect(stored.toMillis()).toBe(expected.toMillis())
    // Explicit: must be 2026-06-15T00:00:00.000Z.
    expect(stored.toDate().toISOString()).toBe('2026-06-15T00:00:00.000Z')
  })

  it('does not drift to the previous day for a late-evening UTC time', async () => {
    setUser('coach-1', { roles: ['coach'], teamIds: ['team-1'] })
    setTeam('team-1')
    setMatchType('mt-1')

    await call(
      makeRequest({ data: { date: Date.UTC(2026, 5, 15, 23, 45, 0) } }),
    )
    const stored = state.addCalls[0]!.date as FirebaseFirestore.Timestamp
    expect(stored.toDate().toISOString()).toBe('2026-06-15T00:00:00.000Z')
  })
})

describe('coachCreateAwayMatch — permission denied', () => {
  it('rejects an unauthenticated caller', async () => {
    await expectHttpsError(call(makeRequest({ uid: null })), 'unauthenticated')
  })

  it('rejects a caller without a /users doc', async () => {
    // no setUser → doc missing
    setTeam('team-1')
    setMatchType('mt-1')
    await expectHttpsError(call(makeRequest()), 'permission-denied')
  })

  it('rejects a coach who is not on the team', async () => {
    setUser('coach-1', { roles: ['coach'], teamIds: ['other-team'] })
    setTeam('team-1')
    setMatchType('mt-1')
    await expectHttpsError(call(makeRequest()), 'permission-denied')
  })

  it('rejects a plain official / parent', async () => {
    setUser('user-1', { roles: ['official', 'parent'], teamIds: ['team-1'] })
    setTeam('team-1')
    setMatchType('mt-1')
    await expectHttpsError(
      call(makeRequest({ uid: 'user-1' })),
      'permission-denied',
    )
  })

  it('does not create a match when permission is denied', async () => {
    setUser('coach-1', { roles: ['coach'], teamIds: ['other-team'] })
    setTeam('team-1')
    setMatchType('mt-1')
    await expectHttpsError(call(makeRequest()), 'permission-denied')
    expect(state.addCalls).toHaveLength(0)
  })
})

describe('coachCreateAwayMatch — invalid argument', () => {
  beforeEach(() => {
    setUser('coach-1', { roles: ['coach'], teamIds: ['team-1'] })
    setTeam('team-1')
    setMatchType('mt-1')
  })

  it('rejects an empty teamId', async () => {
    await expectHttpsError(
      call(makeRequest({ data: { teamId: '   ' } })),
      'invalid-argument',
    )
  })

  it('rejects a missing opponentName (required for away)', async () => {
    await expectHttpsError(
      call(makeRequest({ data: { opponentName: '' } })),
      'invalid-argument',
    )
  })

  it('rejects a missing awayAddress (required for away)', async () => {
    await expectHttpsError(
      call(makeRequest({ data: { awayAddress: null } })),
      'invalid-argument',
    )
  })

  it('rejects a malformed startTime', async () => {
    await expectHttpsError(
      call(makeRequest({ data: { startTime: '8:00' } })),
      'invalid-argument',
    )
  })

  it('rejects a malformed endTime', async () => {
    await expectHttpsError(
      call(makeRequest({ data: { endTime: '25:00' } })),
      'invalid-argument',
    )
  })

  it('rejects endTime <= startTime', async () => {
    await expectHttpsError(
      call(makeRequest({ data: { startTime: '20:00', endTime: '18:00' } })),
      'invalid-argument',
    )
  })

  it('rejects a non-numeric date', async () => {
    await expectHttpsError(
      call(makeRequest({ data: { date: '2026-06-15' } })),
      'invalid-argument',
    )
  })
})

describe('coachCreateAwayMatch — referenced docs not found', () => {
  it('rejects when the team does not exist', async () => {
    setUser('coach-1', { roles: ['coach'], teamIds: ['team-1'] })
    setMatchType('mt-1')
    // team-1 not set
    await expectHttpsError(call(makeRequest()), 'not-found')
  })

  it('rejects when the matchType does not exist', async () => {
    setUser('coach-1', { roles: ['coach'], teamIds: ['team-1'] })
    setTeam('team-1')
    // mt-1 not set
    await expectHttpsError(call(makeRequest()), 'not-found')
  })
})

describe('coachCreateAwayMatch — conflicting trainings', () => {
  it('returns the freed booking ids and passes the right args', async () => {
    setUser('coach-1', { roles: ['coach'], teamIds: ['team-1'] })
    setTeam('team-1')
    setMatchType('mt-1')
    state.freedIds = ['booking-a', 'booking-b']

    const out = await call(makeRequest())

    expect(out.freedBookingIds).toEqual(['booking-a', 'booking-b'])
    expect(helpers.freeConflictingTrainings).toHaveBeenCalledTimes(1)
    expect(state.freeArgs).toMatchObject({
      teamId: 'team-1',
      startTime: '18:00',
      endTime: '20:00',
      reason: 'match_away',
      editorUid: 'coach-1',
    })
    // dayStart passed to free must be the UTC-midnight Timestamp.
    const dayStart = state.freeArgs!.dayStart as FirebaseFirestore.Timestamp
    expect(dayStart.toDate().toISOString()).toBe('2026-06-15T00:00:00.000Z')
  })
})

describe('coachCreateAwayMatch — best-effort free', () => {
  it('still creates the match when freeConflictingTrainings throws', async () => {
    setUser('coach-1', { roles: ['coach'], teamIds: ['team-1'] })
    setTeam('team-1')
    setMatchType('mt-1')
    state.freeThrows = true

    const out = await call(makeRequest())

    expect(out).toEqual({
      ok: true,
      matchId: 'match-1',
      freedBookingIds: [],
    })
    expect(state.addCalls).toHaveLength(1)
  })

  it('throws internal when the match add() itself fails', async () => {
    setUser('coach-1', { roles: ['coach'], teamIds: ['team-1'] })
    setTeam('team-1')
    setMatchType('mt-1')
    state.addThrows = true

    await expectHttpsError(call(makeRequest()), 'internal')
  })
})
