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

  /** Helper : ctx "vide" (path B / hors flux register). */
  const emptyCtx = (): {
    registeredByUid: string | null
    status: null
    trialStartedAt: null
  } => ({
    registeredByUid: null,
    status: null,
    trialStartedAt: null,
  })

  it('path B: creates pending_grace dues when no registration context', async () => {
    const { txSet, txUpdate } = setupColAndTx({ existingDuesEmpty: true })
    const result = await mod.createDuesIfMissing({
      memberId: 'm1',
      teamId: 't1',
      seasonId: 's1',
      duesAmount: 250,
      gracePeriodDays: 21,
      paymentDueDays: 14,
      regCtx: { ...emptyCtx(), registeredByUid: 'reg-user-1' },
    })
    expect(result.outcome).toBe('created')
    expect(result.needsImmediateEmail).toBe(false)
    expect(result.dueId).toBe('new-due-id')
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
      emailedAt: null,
      registeredByUid: 'reg-user-1',
    })
    // issuedAt = activatedAt + 21 days
    expect(dueDoc.issuedAt.seconds).toBe(1_000_000 + 21 * 86_400)
    expect(txUpdate).toHaveBeenCalledOnce()
    expect(txUpdate.mock.calls[0][1]).toMatchObject({
      duesStatus: 'pending_grace',
    })
  })

  it('path A: creates issued dues with dueAt=trialStartedAt+paymentDueDays when status=trial_in_progress', async () => {
    const { txSet, txUpdate } = setupColAndTx({ existingDuesEmpty: true })
    // trialStartedAt = day 0, paymentDueDays = 14 → dueAt = day 14
    const trialSeconds = 500_000
    const result = await mod.createDuesIfMissing({
      memberId: 'm1',
      teamId: 't1',
      seasonId: 's1',
      duesAmount: 300,
      gracePeriodDays: 21,
      paymentDueDays: 14,
      regCtx: {
        registeredByUid: 'parent-1',
        status: 'trial_in_progress',
        trialStartedAt: { seconds: trialSeconds, nanoseconds: 0 },
      },
    })
    expect(result.outcome).toBe('created')
    expect(result.needsImmediateEmail).toBe(true)
    expect(result.dueId).toBe('new-due-id')

    const [, dueDoc] = txSet.mock.calls[0]
    expect(dueDoc).toMatchObject({
      status: 'issued',
      registeredByUid: 'parent-1',
    })
    // dueAt = trialStartedAt + 14 days
    expect(dueDoc.dueAt.seconds).toBe(trialSeconds + 14 * 86_400)
    // issuedAt = now (path A)
    expect(dueDoc.issuedAt.seconds).toBe(1_000_000)
    // emailedAt = now (path A)
    expect(dueDoc.emailedAt.seconds).toBe(1_000_000)
    expect(txUpdate.mock.calls[0][1]).toMatchObject({
      duesStatus: 'due',
    })
  })

  it('path A: confirm tardif → dueAt dans le passé (immédiatement overdue)', async () => {
    const { txSet } = setupColAndTx({ existingDuesEmpty: true })
    // trialStartedAt = now - 30 days, paymentDueDays = 14 → dueAt = now - 16 days
    const trialSeconds = 1_000_000 - 30 * 86_400
    const result = await mod.createDuesIfMissing({
      memberId: 'm1',
      teamId: 't1',
      seasonId: 's1',
      duesAmount: 250,
      gracePeriodDays: 21,
      paymentDueDays: 14,
      regCtx: {
        registeredByUid: 'parent-1',
        status: 'confirmed_pending_dues',
        trialStartedAt: { seconds: trialSeconds, nanoseconds: 0 },
      },
    })
    expect(result.outcome).toBe('created')
    expect(result.needsImmediateEmail).toBe(true)
    const [, dueDoc] = txSet.mock.calls[0]
    expect(dueDoc.status).toBe('issued')
    expect(dueDoc.dueAt.seconds).toBe(trialSeconds + 14 * 86_400)
    // Sanity-check : dueAt < now → immédiatement overdue
    expect(dueDoc.dueAt.seconds).toBeLessThan(1_000_000)
  })

  it('path B: status=submitted does NOT trigger path A even if trialStartedAt present', async () => {
    const { txSet } = setupColAndTx({ existingDuesEmpty: true })
    const result = await mod.createDuesIfMissing({
      memberId: 'm1',
      teamId: 't1',
      seasonId: 's1',
      duesAmount: 250,
      gracePeriodDays: 21,
      paymentDueDays: 14,
      regCtx: {
        registeredByUid: 'parent-1',
        status: 'submitted',
        trialStartedAt: { seconds: 500_000, nanoseconds: 0 },
      },
    })
    expect(result.needsImmediateEmail).toBe(false)
    const [, dueDoc] = txSet.mock.calls[0]
    expect(dueDoc.status).toBe('pending_grace')
    expect(dueDoc.dueAt).toBeNull()
    expect(dueDoc.emailedAt).toBeNull()
  })

  it('path B: status=trial_in_progress without trialStartedAt falls back to pending_grace', async () => {
    const { txSet } = setupColAndTx({ existingDuesEmpty: true })
    const result = await mod.createDuesIfMissing({
      memberId: 'm1',
      teamId: 't1',
      seasonId: 's1',
      duesAmount: 250,
      gracePeriodDays: 21,
      paymentDueDays: 14,
      regCtx: {
        registeredByUid: 'parent-1',
        status: 'trial_in_progress',
        trialStartedAt: null, // missing
      },
    })
    expect(result.needsImmediateEmail).toBe(false)
    const [, dueDoc] = txSet.mock.calls[0]
    expect(dueDoc.status).toBe('pending_grace')
  })

  it('skips creation when a dues doc already exists (idempotent retrigger)', async () => {
    const { txSet, txUpdate } = setupColAndTx({ existingDuesEmpty: false })
    const result = await mod.createDuesIfMissing({
      memberId: 'm1',
      teamId: 't1',
      seasonId: 's1',
      duesAmount: 250,
      gracePeriodDays: 21,
      paymentDueDays: 14,
      regCtx: emptyCtx(),
    })
    expect(result.outcome).toBe('already-exists')
    expect(result.needsImmediateEmail).toBe(false)
    expect(result.dueId).toBeNull()
    expect(txSet).not.toHaveBeenCalled()
    expect(txUpdate).not.toHaveBeenCalled()
  })
})

// ---------- shouldIssueImmediately ----------
describe('shouldIssueImmediately', () => {
  const ts = { seconds: 100, nanoseconds: 0 }

  it('returns true for trial_in_progress with trialStartedAt', () => {
    expect(
      mod.shouldIssueImmediately({
        registeredByUid: 'x',
        status: 'trial_in_progress',
        trialStartedAt: ts,
      }),
    ).toBe(true)
  })

  it('returns true for confirmed_pending_dues with trialStartedAt', () => {
    expect(
      mod.shouldIssueImmediately({
        registeredByUid: 'x',
        status: 'confirmed_pending_dues',
        trialStartedAt: ts,
      }),
    ).toBe(true)
  })

  it('returns false for trial_in_progress without trialStartedAt', () => {
    expect(
      mod.shouldIssueImmediately({
        registeredByUid: 'x',
        status: 'trial_in_progress',
        trialStartedAt: null,
      }),
    ).toBe(false)
  })

  it('returns false for submitted (out-of-window)', () => {
    expect(
      mod.shouldIssueImmediately({
        registeredByUid: 'x',
        status: 'submitted',
        trialStartedAt: ts,
      }),
    ).toBe(false)
  })

  it('returns false when status is null (no registration matched)', () => {
    expect(
      mod.shouldIssueImmediately({
        registeredByUid: null,
        status: null,
        trialStartedAt: null,
      }),
    ).toBe(false)
  })

  it('returns false for active (player already integrated — would be a re-trigger)', () => {
    expect(
      mod.shouldIssueImmediately({
        registeredByUid: 'x',
        status: 'active',
        trialStartedAt: ts,
      }),
    ).toBe(false)
  })
})

// ---------- findRegistrationContext / findRegisteredByUid ----------
describe('findRegistrationContext', () => {
  function buildRegistrationsCol(
    docs: Array<{
      submittedByUid: string
      status?: string
      trialStartedAt?: { seconds: number; nanoseconds: number } | null
      createdAt: { seconds: number }
    }>,
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

  it('returns empty context when no registration matches', async () => {
    buildRegistrationsCol([])
    expect(await mod.findRegistrationContext('m1', 't1')).toEqual({
      registeredByUid: null,
      status: null,
      trialStartedAt: null,
    })
  })

  it('extracts submittedByUid + status + trialStartedAt from single match', async () => {
    buildRegistrationsCol([
      {
        submittedByUid: 'user-a',
        status: 'trial_in_progress',
        trialStartedAt: { seconds: 500_000, nanoseconds: 0 },
        createdAt: { seconds: 100 },
      },
    ])
    expect(await mod.findRegistrationContext('m1', 't1')).toEqual({
      registeredByUid: 'user-a',
      status: 'trial_in_progress',
      trialStartedAt: { seconds: 500_000, nanoseconds: 0 },
    })
  })

  it('keeps the most recent registration when several match', async () => {
    buildRegistrationsCol([
      {
        submittedByUid: 'old-user',
        status: 'cancelled',
        trialStartedAt: null,
        createdAt: { seconds: 100 },
      },
      {
        submittedByUid: 'recent-user',
        status: 'confirmed_pending_dues',
        trialStartedAt: { seconds: 999_000, nanoseconds: 0 },
        createdAt: { seconds: 999 },
      },
    ])
    const ctx = await mod.findRegistrationContext('m1', 't1')
    expect(ctx.registeredByUid).toBe('recent-user')
    expect(ctx.status).toBe('confirmed_pending_dues')
  })

  it('returns empty context (does not throw) when the lookup fails', async () => {
    fakeCol.mockImplementation(() => {
      throw new Error('firestore exploded')
    })
    expect(await mod.findRegistrationContext('m1', 't1')).toEqual({
      registeredByUid: null,
      status: null,
      trialStartedAt: null,
    })
  })
})

describe('findRegisteredByUid (backward-compat shim)', () => {
  it('returns submittedByUid via findRegistrationContext', async () => {
    const snap: FakeSnapshot = {
      empty: false,
      size: 1,
      docs: [
        {
          id: 'reg-0',
          data: () => ({
            submittedByUid: 'user-a',
            status: 'trial_in_progress',
            trialStartedAt: { seconds: 1, nanoseconds: 0 },
            createdAt: { seconds: 100 },
          }),
        },
      ],
    }
    fakeCol.mockImplementation(() => ({
      where: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue(snap),
    }))
    expect(await mod.findRegisteredByUid('m1', 't1')).toBe('user-a')
  })
})
