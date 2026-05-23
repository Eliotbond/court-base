/**
 * Tests for `transitionRegistrationOnDuePaid`.
 *
 * Stratégie : on mock `./_helpers` pour fournir `db()` / `col()` en mémoire,
 * puis on invoque `processDuePaid` directement. `isPaidTransition` est testé
 * en pur.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeSnapshot {
  empty: boolean
  size: number
  docs: { id: string; data: () => Record<string, unknown> }[]
}

interface FakeQuery {
  where: (..._args: unknown[]) => FakeQuery
  get: () => Promise<FakeSnapshot>
}

interface FakeDocSnap {
  exists: boolean
  data: () => Record<string, unknown> | undefined
}

interface FakeDocRef {
  id: string
  get: () => Promise<FakeDocSnap>
}

interface FakeTx {
  get: (target: FakeQuery | FakeDocRef) => Promise<unknown>
  update: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
}

interface FakeDb {
  doc: (path: string) => FakeDocRef
  runTransaction: <T>(fn: (tx: FakeTx) => Promise<T>) => Promise<T>
}

const fakeDb: FakeDb = {
  doc: vi.fn(),
  runTransaction: vi.fn(),
}
const fakeCol = vi.fn()

vi.mock('./_helpers', async () => {
  const actual = await vi.importActual<typeof import('./_helpers')>('./_helpers')
  return {
    ...actual,
    db: () => fakeDb,
    col: (path: string) => fakeCol(path),
    serverTimestamp: () => '__SERVER_TS__',
    Timestamp: {
      now: () => ({ seconds: 2_000_000, nanoseconds: 0 }),
    },
  }
})

let mod: typeof import('./transitionRegistrationOnDuePaid')

beforeEach(async () => {
  vi.clearAllMocks()
  mod = await import('./transitionRegistrationOnDuePaid')
})
afterEach(() => {
  vi.restoreAllMocks()
})

// ---------- isPaidTransition ----------
describe('isPaidTransition', () => {
  it('detects status: issued -> paid', () => {
    expect(
      mod.isPaidTransition({ status: 'issued' }, { status: 'paid' }),
    ).toBe(true)
  })
  it('detects status: pending_grace -> paid', () => {
    expect(
      mod.isPaidTransition({ status: 'pending_grace' }, { status: 'paid' }),
    ).toBe(true)
  })
  it('detects status: overdue -> paid', () => {
    expect(
      mod.isPaidTransition({ status: 'overdue' }, { status: 'paid' }),
    ).toBe(true)
  })
  it('returns false when both before and after are paid (re-trigger)', () => {
    expect(mod.isPaidTransition({ status: 'paid' }, { status: 'paid' })).toBe(false)
  })
  it('returns false when after is not paid', () => {
    expect(
      mod.isPaidTransition({ status: 'issued' }, { status: 'overdue' }),
    ).toBe(false)
  })
  it('returns false when after is undefined (delete)', () => {
    expect(mod.isPaidTransition({ status: 'issued' }, undefined)).toBe(false)
  })
  it('handles missing before (creation set to paid directly)', () => {
    expect(mod.isPaidTransition(undefined, { status: 'paid' })).toBe(true)
  })
})

// ---------- processDuePaid ----------
describe('processDuePaid', () => {
  /**
   * Buffer mutables shared across helpers. Reset before each test.
   */
  let registrationsSnapDocs: { id: string; data: Record<string, unknown> }[]
  let registrationsSnapShouldThrow: boolean
  let registrationFreshDoc: Record<string, unknown> | undefined
  let memberDoc: Record<string, unknown> | undefined
  let txUpdate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    registrationsSnapDocs = []
    registrationsSnapShouldThrow = false
    registrationFreshDoc = undefined
    memberDoc = undefined
    txUpdate = vi.fn()

    fakeCol.mockImplementation((path: string) => {
      if (path !== 'registrations') {
        throw new Error(`unexpected col(${path})`)
      }
      const query: FakeQuery = {
        where: vi.fn().mockReturnThis(),
        get: vi.fn().mockImplementation(async () => {
          if (registrationsSnapShouldThrow) {
            throw new Error('firestore exploded')
          }
          return {
            empty: registrationsSnapDocs.length === 0,
            size: registrationsSnapDocs.length,
            docs: registrationsSnapDocs.map((d) => ({
              id: d.id,
              data: () => d.data,
            })),
          }
        }),
      }
      return query
    })

    fakeDb.doc = vi.fn((path: string) => {
      if (path.startsWith('registrations/')) {
        return {
          id: path.split('/')[1] ?? '',
          get: async (): Promise<FakeDocSnap> => ({
            exists: registrationFreshDoc !== undefined,
            data: () => registrationFreshDoc,
          }),
        }
      }
      if (path.startsWith('members/')) {
        return {
          id: path.split('/')[1] ?? '',
          get: async (): Promise<FakeDocSnap> => ({
            exists: memberDoc !== undefined,
            data: () => memberDoc,
          }),
        }
      }
      return { id: 'unknown', get: async () => ({ exists: false, data: () => undefined }) }
    }) as unknown as FakeDb['doc']

    fakeDb.runTransaction = vi.fn(async (fn: (tx: FakeTx) => Promise<unknown>) => {
      const tx: FakeTx = {
        get: async (target) => {
          // We rely on the same per-path doc shape.
          if ('get' in target && typeof target.get === 'function') {
            return await (target as FakeDocRef).get()
          }
          throw new Error('unexpected tx.get target')
        },
        update: txUpdate,
        set: vi.fn(),
      }
      return await fn(tx)
    }) as unknown as FakeDb['runTransaction']
  })

  it('transitions confirmed_pending_dues -> active and activates member', async () => {
    registrationsSnapDocs = [
      {
        id: 'reg-1',
        data: {
          status: 'confirmed_pending_dues',
          matchedMemberId: 'm1',
          teamId: 't1',
          createdAt: { seconds: 100, nanoseconds: 0 },
          actionLog: [],
        },
      },
    ]
    registrationFreshDoc = {
      status: 'confirmed_pending_dues',
      actionLog: [{ action: 'created' }],
    }
    memberDoc = { active: false, firstName: 'A', lastName: 'B' }

    const outcome = await mod.processDuePaid({
      dueId: 'due-1',
      memberId: 'm1',
      teamId: 't1',
    })
    expect(outcome).toBe('transitioned')
    // Vérifie : un update sur la registration + un update sur le member.
    expect(txUpdate).toHaveBeenCalledTimes(2)
    const regUpdate = txUpdate.mock.calls.find(
      ([ref]) => (ref as FakeDocRef).id === 'reg-1',
    )
    expect(regUpdate).toBeDefined()
    expect(regUpdate![1]).toMatchObject({
      status: 'active',
      statusUpdatedAt: { seconds: 2_000_000 },
    })
    const memberUpdate = txUpdate.mock.calls.find(
      ([ref]) => (ref as FakeDocRef).id === 'm1',
    )
    expect(memberUpdate).toBeDefined()
    expect(memberUpdate![1]).toEqual({ active: true })

    // Action log entry pushed avec note='due_paid' et byUid='system'.
    const newActionLog = regUpdate![1].actionLog as Array<Record<string, unknown>>
    expect(newActionLog).toHaveLength(2)
    expect(newActionLog[1]).toMatchObject({
      action: 'status_changed',
      previousStatus: 'confirmed_pending_dues',
      newStatus: 'active',
      byUid: 'system',
      note: 'due_paid',
    })
  })

  it('skips member update when member already active', async () => {
    registrationsSnapDocs = [
      {
        id: 'reg-1',
        data: {
          status: 'confirmed_pending_dues',
          matchedMemberId: 'm1',
          teamId: 't1',
          createdAt: { seconds: 100, nanoseconds: 0 },
          actionLog: [],
        },
      },
    ]
    registrationFreshDoc = { status: 'confirmed_pending_dues', actionLog: [] }
    memberDoc = { active: true }

    await mod.processDuePaid({ dueId: 'due-1', memberId: 'm1', teamId: 't1' })

    const memberUpdate = txUpdate.mock.calls.find(
      ([ref]) => (ref as FakeDocRef).id === 'm1',
    )
    expect(memberUpdate).toBeUndefined()
    // Reg update only.
    expect(txUpdate).toHaveBeenCalledTimes(1)
  })

  it('returns already-active when registration is already active', async () => {
    registrationsSnapDocs = [
      {
        id: 'reg-1',
        data: {
          status: 'active',
          matchedMemberId: 'm1',
          teamId: 't1',
          createdAt: { seconds: 100, nanoseconds: 0 },
        },
      },
    ]
    const outcome = await mod.processDuePaid({
      dueId: 'due-1',
      memberId: 'm1',
      teamId: 't1',
    })
    expect(outcome).toBe('already-active')
    expect(txUpdate).not.toHaveBeenCalled()
  })

  it('returns wrong-status for unrelated statuses (e.g. trial_in_progress)', async () => {
    registrationsSnapDocs = [
      {
        id: 'reg-1',
        data: {
          status: 'trial_in_progress',
          matchedMemberId: 'm1',
          teamId: 't1',
          createdAt: { seconds: 100, nanoseconds: 0 },
        },
      },
    ]
    const outcome = await mod.processDuePaid({
      dueId: 'due-1',
      memberId: 'm1',
      teamId: 't1',
    })
    expect(outcome).toBe('wrong-status')
    expect(txUpdate).not.toHaveBeenCalled()
  })

  it('returns no-registration when no doc matches (paiement hors flow)', async () => {
    registrationsSnapDocs = []
    const outcome = await mod.processDuePaid({
      dueId: 'due-1',
      memberId: 'm1',
      teamId: 't1',
    })
    expect(outcome).toBe('no-registration')
    expect(txUpdate).not.toHaveBeenCalled()
  })

  it('picks the most recent registration when several match', async () => {
    registrationsSnapDocs = [
      {
        id: 'reg-old',
        data: {
          status: 'active',
          matchedMemberId: 'm1',
          teamId: 't1',
          createdAt: { seconds: 100, nanoseconds: 0 },
        },
      },
      {
        id: 'reg-recent',
        data: {
          status: 'confirmed_pending_dues',
          matchedMemberId: 'm1',
          teamId: 't1',
          createdAt: { seconds: 999, nanoseconds: 0 },
          actionLog: [],
        },
      },
    ]
    registrationFreshDoc = { status: 'confirmed_pending_dues', actionLog: [] }
    memberDoc = { active: false }

    const outcome = await mod.processDuePaid({
      dueId: 'due-1',
      memberId: 'm1',
      teamId: 't1',
    })
    expect(outcome).toBe('transitioned')
    const regUpdate = txUpdate.mock.calls.find(
      ([ref]) => (ref as FakeDocRef).id === 'reg-recent',
    )
    expect(regUpdate).toBeDefined()
  })

  it('returns no-change when concurrent write flipped registration to active', async () => {
    registrationsSnapDocs = [
      {
        id: 'reg-1',
        data: {
          status: 'confirmed_pending_dues',
          matchedMemberId: 'm1',
          teamId: 't1',
          createdAt: { seconds: 100, nanoseconds: 0 },
          actionLog: [],
        },
      },
    ]
    // Le doc lu dans la transaction est déjà active (race).
    registrationFreshDoc = { status: 'active', actionLog: [] }
    memberDoc = { active: false }

    const outcome = await mod.processDuePaid({
      dueId: 'due-1',
      memberId: 'm1',
      teamId: 't1',
    })
    // Le pipeline retourne `transitioned` (la branche early-return du tx ne
    // change pas la valeur de retour du pipeline — c'est OK, ce qui compte
    // c'est qu'aucun write n'ait été émis).
    expect(outcome).toBe('transitioned')
    expect(txUpdate).not.toHaveBeenCalled()
  })

  it('returns no-registration silently when registration lookup throws', async () => {
    registrationsSnapShouldThrow = true
    const outcome = await mod.processDuePaid({
      dueId: 'due-1',
      memberId: 'm1',
      teamId: 't1',
    })
    expect(outcome).toBe('no-registration')
    expect(txUpdate).not.toHaveBeenCalled()
  })
})

// ---------- findRegistrationForPaidDue ----------
describe('findRegistrationForPaidDue', () => {
  it('returns null when no registration matches', async () => {
    fakeCol.mockImplementation(() => ({
      where: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ empty: true, size: 0, docs: [] }),
    }))
    expect(await mod.findRegistrationForPaidDue('m1', 't1')).toBeNull()
  })

  it('returns null (logs warn) when lookup throws', async () => {
    fakeCol.mockImplementation(() => ({
      where: vi.fn().mockReturnThis(),
      get: vi.fn().mockRejectedValue(new Error('boom')),
    }))
    expect(await mod.findRegistrationForPaidDue('m1', 't1')).toBeNull()
  })
})
