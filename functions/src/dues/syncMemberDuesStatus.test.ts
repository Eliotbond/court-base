/**
 * Tests for syncMemberDuesStatus.
 *
 * The status-mapping logic is exhaustively covered in `_helpers.test.ts`
 * (computeMemberDuesStatus). Here we verify that the trigger:
 *   - writes the new status when it differs from the current one
 *   - is a no-op when status already matches (avoid trigger amplification)
 *
 * We mock `./_helpers` to inject a fake firestore.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DueStatus } from '@club-app/shared-types'

interface FakeMemberSnap {
  exists: boolean
  data: () => { duesStatus: string } | undefined
}
interface FakeDuesQuerySnap {
  docs: { data: () => { status: DueStatus } }[]
}

const txGet = vi.fn()
const txUpdate = vi.fn()

const fakeDb = {
  doc: vi.fn((path: string) => ({ path })),
  runTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    return fn({ get: txGet, update: txUpdate, set: vi.fn() })
  }),
}

const fakeColQuery = {
  where: vi.fn().mockReturnThis(),
}

vi.mock('./_helpers', async () => {
  const actual = await vi.importActual<typeof import('./_helpers')>('./_helpers')
  return {
    ...actual,
    db: () => fakeDb,
    col: () => fakeColQuery,
    serverTimestamp: () => '__SERVER_TS__',
  }
})

// Internal recomputeMemberStatus is not exported. We test through the trigger
// by simulating an event with before/after data. Re-import the trigger
// implementation. We need to invoke the trigger handler directly, so we
// reach into the CloudFunction object which exposes `.run()` in v2.
let mod: typeof import('./syncMemberDuesStatus')

beforeEach(async () => {
  vi.clearAllMocks()
  txGet.mockReset()
  txUpdate.mockReset()
  fakeDb.runTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    return fn({ get: txGet, update: txUpdate, set: vi.fn() })
  })
  mod = await import('./syncMemberDuesStatus')
})

afterEach(() => {
  vi.restoreAllMocks()
})

interface MinimalChange {
  before: { exists: boolean; data: () => Record<string, unknown> | undefined }
  after: { exists: boolean; data: () => Record<string, unknown> | undefined }
}
interface MinimalEvent {
  data: MinimalChange | undefined
  params: { dueId: string }
}

function makeEvent(opts: {
  beforeMemberId?: string
  afterMemberId?: string
  afterStatus?: DueStatus
}): MinimalEvent {
  return {
    params: { dueId: 'due-x' },
    data: {
      before: {
        exists: !!opts.beforeMemberId,
        data: () =>
          opts.beforeMemberId ? { memberId: opts.beforeMemberId } : undefined,
      },
      after: {
        exists: !!opts.afterMemberId,
        data: () =>
          opts.afterMemberId
            ? { memberId: opts.afterMemberId, status: opts.afterStatus ?? 'issued' }
            : undefined,
      },
    },
  }
}

/**
 * Programs the transaction-bound `get()` calls in the order the handler will
 * invoke them: first a Query (returning dues snapshot), then a DocRef
 * (returning member snapshot).
 */
function programTx(opts: {
  dueStatusesByMember: Record<string, DueStatus[]>
  memberStatusByMember: Record<string, string | null>
}) {
  // We need to dispatch by call ordering since transaction.get receives both
  // a Query and a DocRef. The handler does: tx.get(Query) then tx.get(DocRef)
  // per member. We track via call index modulo 2 -- but more cleanly, inspect
  // the argument: query objects have .where, doc refs have .path.
  txGet.mockImplementation(async (target: unknown) => {
    if (target && typeof target === 'object' && 'where' in target) {
      // Query for dues by memberId. We can't see which member without
      // tracking the .where args — but for our tests there's only one
      // member queried per call. Use the most-recently-passed member.
      const memberId = lastMemberQueried
      const statuses = opts.dueStatusesByMember[memberId] ?? []
      const snap: FakeDuesQuerySnap = {
        docs: statuses.map((s) => ({ data: () => ({ status: s }) })),
      }
      return snap
    }
    // DocRef (member doc)
    const ref = target as { path?: string }
    const path = ref.path ?? ''
    const memberId = path.replace('members/', '')
    const cur = opts.memberStatusByMember[memberId] ?? null
    const snap: FakeMemberSnap = {
      exists: cur !== null,
      data: () => (cur === null ? undefined : { duesStatus: cur }),
    }
    return snap
  })
}

// Capture which member is being queried via the col() chain.
let lastMemberQueried = ''
beforeEach(() => {
  lastMemberQueried = ''
  fakeColQuery.where = vi.fn((field: string, _op: string, value: string) => {
    if (field === 'memberId') lastMemberQueried = value
    return fakeColQuery
  })
})

describe('syncMemberDuesStatus trigger', () => {
  it('writes "excluded" when an overdue due exists', async () => {
    programTx({
      dueStatusesByMember: { 'm-1': ['paid', 'overdue'] },
      memberStatusByMember: { 'm-1': 'ok' },
    })
    const event = makeEvent({ afterMemberId: 'm-1', afterStatus: 'overdue' })
    await mod.syncMemberDuesStatus.run(event as Parameters<typeof mod.syncMemberDuesStatus.run>[0])
    expect(txUpdate).toHaveBeenCalledOnce()
    expect(txUpdate.mock.calls[0][1]).toMatchObject({ duesStatus: 'excluded' })
  })

  it('writes "excepted" when no overdue but an excepted exists', async () => {
    programTx({
      dueStatusesByMember: { 'm-2': ['paid', 'excepted'] },
      memberStatusByMember: { 'm-2': 'due' },
    })
    const event = makeEvent({ afterMemberId: 'm-2' })
    await mod.syncMemberDuesStatus.run(event as Parameters<typeof mod.syncMemberDuesStatus.run>[0])
    expect(txUpdate.mock.calls[0][1]).toMatchObject({ duesStatus: 'excepted' })
  })

  it('writes "due" when only issued + paid dues exist', async () => {
    programTx({
      dueStatusesByMember: { 'm-3': ['paid', 'issued'] },
      memberStatusByMember: { 'm-3': 'pending_grace' },
    })
    const event = makeEvent({ afterMemberId: 'm-3' })
    await mod.syncMemberDuesStatus.run(event as Parameters<typeof mod.syncMemberDuesStatus.run>[0])
    expect(txUpdate.mock.calls[0][1]).toMatchObject({ duesStatus: 'due' })
  })

  it('writes "pending_grace" when only pending_grace + paid exist', async () => {
    programTx({
      dueStatusesByMember: { 'm-4': ['pending_grace', 'paid'] },
      memberStatusByMember: { 'm-4': 'ok' },
    })
    const event = makeEvent({ afterMemberId: 'm-4' })
    await mod.syncMemberDuesStatus.run(event as Parameters<typeof mod.syncMemberDuesStatus.run>[0])
    expect(txUpdate.mock.calls[0][1]).toMatchObject({ duesStatus: 'pending_grace' })
  })

  it('writes "ok" when all dues are paid', async () => {
    programTx({
      dueStatusesByMember: { 'm-5': ['paid', 'paid'] },
      memberStatusByMember: { 'm-5': 'due' },
    })
    const event = makeEvent({ afterMemberId: 'm-5' })
    await mod.syncMemberDuesStatus.run(event as Parameters<typeof mod.syncMemberDuesStatus.run>[0])
    expect(txUpdate.mock.calls[0][1]).toMatchObject({ duesStatus: 'ok' })
  })

  it('writes "n/a" when no dues exist (last due deleted)', async () => {
    programTx({
      dueStatusesByMember: { 'm-6': [] },
      memberStatusByMember: { 'm-6': 'ok' },
    })
    // Pure-delete event: only before-state.
    const event = makeEvent({ beforeMemberId: 'm-6' })
    await mod.syncMemberDuesStatus.run(event as Parameters<typeof mod.syncMemberDuesStatus.run>[0])
    expect(txUpdate.mock.calls[0][1]).toMatchObject({ duesStatus: 'n/a' })
  })

  it('is a no-op when the computed status equals the current status', async () => {
    programTx({
      dueStatusesByMember: { 'm-7': ['paid', 'overdue'] },
      memberStatusByMember: { 'm-7': 'excluded' }, // already excluded
    })
    const event = makeEvent({ afterMemberId: 'm-7', afterStatus: 'overdue' })
    await mod.syncMemberDuesStatus.run(event as Parameters<typeof mod.syncMemberDuesStatus.run>[0])
    expect(txUpdate).not.toHaveBeenCalled()
  })
})
