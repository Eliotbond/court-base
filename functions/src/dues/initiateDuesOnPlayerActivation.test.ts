/**
 * Tests for the pure / extractable parts of initiateDuesOnPlayerActivation.
 *
 * Strategy : we don't spin up the full Firestore SDK. We mock
 * `./_helpers` so that `db()` / `col()` return tiny in-memory fakes,
 * then invoke the exported helpers (`diffNewPlayerIds`, `findActiveSeasonId`,
 * `createDuesIfMissing`) directly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeSnapshot {
  empty: boolean
  size: number
  docs: { id: string; data: () => Record<string, unknown> }[]
}

interface FakeQuery {
  where: (..._args: unknown[]) => FakeQuery
  limit: (_n: number) => FakeQuery
  get: () => Promise<FakeSnapshot>
}

interface FakeDocRef {
  id: string
  set: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
}

interface FakeCol {
  doc: (_id?: string) => FakeDocRef
  where: (..._args: unknown[]) => FakeQuery
}

interface FakeDb {
  doc: (_path: string) => FakeDocRef
  runTransaction: <T>(fn: (tx: FakeTx) => Promise<T>) => Promise<T>
  batch: () => { commit: () => Promise<void> }
}

interface FakeTx {
  get: (target: FakeQuery | FakeDocRef) => Promise<unknown>
  set: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
}

// Mocks registered up-front so that the imported module sees fakes.
const fakeDb: FakeDb = {
  doc: vi.fn(),
  runTransaction: vi.fn(),
  batch: vi.fn(),
}
const fakeCol = vi.fn()

vi.mock('./_helpers', async () => {
  const actual = await vi.importActual<typeof import('./_helpers')>('./_helpers')
  return {
    ...actual,
    db: () => fakeDb,
    col: (path: string) => fakeCol(path),
    serverTimestamp: () => '__SERVER_TS__',
    addDaysToTimestamp: (ts: { seconds: number; nanoseconds: number }, days: number) => ({
      seconds: ts.seconds + days * 86_400,
      nanoseconds: ts.nanoseconds,
    }),
    Timestamp: {
      now: () => ({ seconds: 1_000_000, nanoseconds: 0 }),
    },
  }
})

let mod: typeof import('./initiateDuesOnPlayerActivation')

beforeEach(async () => {
  vi.clearAllMocks()
  mod = await import('./initiateDuesOnPlayerActivation')
})
afterEach(() => {
  vi.restoreAllMocks()
})

// ---------- diffNewPlayerIds ----------
describe('diffNewPlayerIds', () => {
  it('detects players added in the after-state', () => {
    expect(mod.diffNewPlayerIds(['a', 'b'], ['a', 'b', 'c'])).toEqual(['c'])
  })
  it('returns empty when no change', () => {
    expect(mod.diffNewPlayerIds(['a', 'b'], ['a', 'b'])).toEqual([])
  })
  it('treats missing before-state as empty', () => {
    expect(mod.diffNewPlayerIds(undefined, ['a'])).toEqual(['a'])
  })
  it('ignores removed players (only NEW matter)', () => {
    expect(mod.diffNewPlayerIds(['a', 'b'], ['a'])).toEqual([])
  })
})

// ---------- findActiveSeasonId ----------
describe('findActiveSeasonId', () => {
  function buildSeasonsCol(docs: { id: string }[]): void {
    const snap: FakeSnapshot = {
      empty: docs.length === 0,
      size: docs.length,
      docs: docs.map((d) => ({ id: d.id, data: () => ({ status: 'active' }) })),
    }
    const query: FakeQuery = {
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue(snap),
    }
    fakeCol.mockReturnValue(query)
  }

  it('returns null when 0 active seasons', async () => {
    buildSeasonsCol([])
    const res = await mod.findActiveSeasonId()
    expect(res).toEqual({ seasonId: null, multiple: false })
  })

  it('returns the single seasonId when 1 active season', async () => {
    buildSeasonsCol([{ id: 'season-2025' }])
    const res = await mod.findActiveSeasonId()
    expect(res).toEqual({ seasonId: 'season-2025', multiple: false })
  })

  it('flags multiple = true when 2+ active seasons', async () => {
    buildSeasonsCol([{ id: 'a' }, { id: 'b' }])
    const res = await mod.findActiveSeasonId()
    expect(res.multiple).toBe(true)
  })
})

// ---------- createDuesIfMissing ----------
describe('createDuesIfMissing', () => {
  function setupColAndTx(args: { existingDuesEmpty: boolean }): {
    txSet: ReturnType<typeof vi.fn>
    txUpdate: ReturnType<typeof vi.fn>
    newDueRef: FakeDocRef
  } {
    const newDueRef: FakeDocRef = {
      id: 'new-due-id',
      set: vi.fn(),
      update: vi.fn(),
      get: vi.fn(),
    }
    const duesCol: FakeCol = {
      doc: vi.fn().mockReturnValue(newDueRef),
      where: vi.fn().mockReturnThis(),
    }
    // chained where().where().where().limit() returns a Query-shaped object.
    const duesQuery: FakeQuery & { where: ReturnType<typeof vi.fn> } = {
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn(),
    }
    // Wire col('dues') -> something that supports .doc(), .where().where().where().limit()
    const duesEntry = Object.assign(duesQuery, { doc: duesCol.doc })
    fakeCol.mockImplementation((path: string) => {
      if (path === 'dues') return duesEntry
      throw new Error(`unexpected col(${path})`)
    })

    const txSet = vi.fn()
    const txUpdate = vi.fn()
    const tx: FakeTx = {
      get: vi.fn().mockResolvedValue({
        empty: args.existingDuesEmpty,
        size: args.existingDuesEmpty ? 0 : 1,
        docs: [],
      }),
      set: txSet,
      update: txUpdate,
    }
    fakeDb.runTransaction = vi.fn(
      (fn: (t: FakeTx) => Promise<unknown>) => fn(tx),
    ) as unknown as FakeDb['runTransaction']
    fakeDb.doc = vi.fn().mockReturnValue({ id: 'member-ref-stub' }) as unknown as FakeDb['doc']
    return { txSet, txUpdate, newDueRef }
  }

  it('creates a dues doc and updates member when none exists (idempotent path)', async () => {
    const { txSet, txUpdate } = setupColAndTx({ existingDuesEmpty: true })
    const result = await mod.createDuesIfMissing({
      memberId: 'm1',
      teamId: 't1',
      seasonId: 's1',
      duesAmount: 250,
      gracePeriodDays: 21,
      registeredByUid: 'reg-user-1',
    })
    expect(result).toBe('created')
    expect(txSet).toHaveBeenCalledOnce()
    const [, dueDoc] = txSet.mock.calls[0]
    expect(dueDoc).toMatchObject({
      memberId: 'm1',
      teamId: 't1',
      seasonId: 's1',
      amount: 250,
      status: 'pending_grace',
      paidAt: null,
      dueAt: null,
      registeredByUid: 'reg-user-1',
    })
    // issuedAt = activatedAt + 21 days
    expect(dueDoc.issuedAt.seconds).toBe(1_000_000 + 21 * 86_400)
    expect(txUpdate).toHaveBeenCalledOnce()
    expect(txUpdate.mock.calls[0][1]).toMatchObject({
      duesStatus: 'pending_grace',
    })
  })

  it('skips creation when a dues doc already exists (idempotent retrigger)', async () => {
    const { txSet, txUpdate } = setupColAndTx({ existingDuesEmpty: false })
    const result = await mod.createDuesIfMissing({
      memberId: 'm1',
      teamId: 't1',
      seasonId: 's1',
      duesAmount: 250,
      gracePeriodDays: 21,
      registeredByUid: null,
    })
    expect(result).toBe('already-exists')
    expect(txSet).not.toHaveBeenCalled()
    expect(txUpdate).not.toHaveBeenCalled()
  })
})

// ---------- findRegisteredByUid ----------
describe('findRegisteredByUid', () => {
  function buildRegistrationsCol(
    docs: { submittedByUid: string; createdAt: { seconds: number } }[],
  ): void {
    const snap: FakeSnapshot = {
      empty: docs.length === 0,
      size: docs.length,
      docs: docs.map((d, i) => ({ id: `reg-${i}`, data: () => d })),
    }
    const query: FakeQuery = {
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue(snap),
    }
    fakeCol.mockImplementation((path: string) => {
      if (path === 'registrations') return query
      throw new Error(`unexpected col(${path})`)
    })
  }

  it('returns null when no registration matches', async () => {
    buildRegistrationsCol([])
    expect(await mod.findRegisteredByUid('m1', 't1')).toBeNull()
  })

  it('returns submittedByUid of the single matching registration', async () => {
    buildRegistrationsCol([{ submittedByUid: 'user-a', createdAt: { seconds: 100 } }])
    expect(await mod.findRegisteredByUid('m1', 't1')).toBe('user-a')
  })

  it('keeps the most recent registration when several match', async () => {
    buildRegistrationsCol([
      { submittedByUid: 'old-user', createdAt: { seconds: 100 } },
      { submittedByUid: 'recent-user', createdAt: { seconds: 999 } },
    ])
    expect(await mod.findRegisteredByUid('m1', 't1')).toBe('recent-user')
  })

  it('returns null (does not throw) when the lookup fails', async () => {
    fakeCol.mockImplementation(() => {
      throw new Error('firestore exploded')
    })
    expect(await mod.findRegisteredByUid('m1', 't1')).toBeNull()
  })
})
