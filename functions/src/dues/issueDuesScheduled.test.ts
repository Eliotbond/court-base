/**
 * Tests for `processDuesIssuanceBatch` — the core of issueDuesScheduled.
 *
 * We mock `./_helpers` to provide a fake batch + fake `addDaysToTimestamp`,
 * then invoke `processDuesIssuanceBatch` with a hand-built docs array.
 * This covers the "issuedAt past -> transitions to issued + dueAt set" path
 * and the "missing issuedAt -> skip" path. The Firestore query itself is
 * not exercised here (would need full SDK) — its filters are simple equality
 * checks reviewed by integration tests later.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeBatch {
  update: ReturnType<typeof vi.fn>
  commit: ReturnType<typeof vi.fn>
}

const fakeBatch: FakeBatch = {
  update: vi.fn(),
  commit: vi.fn().mockResolvedValue(undefined),
}

const fakeDb = {
  batch: vi.fn().mockReturnValue(fakeBatch),
  doc: vi.fn((path: string) => ({ path })),
}

vi.mock('./_helpers', async () => {
  const actual = await vi.importActual<typeof import('./_helpers')>('./_helpers')
  return {
    ...actual,
    db: () => fakeDb,
    col: vi.fn(),
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

let mod: typeof import('./issueDuesScheduled')

beforeEach(async () => {
  vi.clearAllMocks()
  fakeBatch.update = vi.fn()
  fakeBatch.commit = vi.fn().mockResolvedValue(undefined)
  fakeDb.batch = vi.fn().mockReturnValue(fakeBatch)
  fakeDb.doc = vi.fn((path: string) => ({ path }))
  mod = await import('./issueDuesScheduled')
})

afterEach(() => {
  vi.restoreAllMocks()
})

interface DueDocStub {
  id: string
  ref: { id: string }
  data: () => {
    memberId: string
    issuedAt: { seconds: number; nanoseconds: number } | null
    status: string
  }
}

function makeDueDoc(opts: {
  id: string
  memberId: string
  issuedAtSeconds: number | null
}): DueDocStub {
  return {
    id: opts.id,
    ref: { id: opts.id },
    data: () => ({
      memberId: opts.memberId,
      issuedAt:
        opts.issuedAtSeconds === null
          ? null
          : { seconds: opts.issuedAtSeconds, nanoseconds: 0 },
      status: 'pending_grace',
    }),
  }
}

describe('processDuesIssuanceBatch', () => {
  it('does nothing when docs array is empty', async () => {
    await mod.processDuesIssuanceBatch({ docs: [], paymentDueDays: 14 })
    expect(fakeBatch.update).not.toHaveBeenCalled()
    expect(fakeBatch.commit).not.toHaveBeenCalled()
  })

  it('transitions pending_grace -> issued and computes dueAt = issuedAt + paymentDueDays', async () => {
    const due = makeDueDoc({ id: 'due-1', memberId: 'm-1', issuedAtSeconds: 2_000_000 })
    // Cast through unknown to satisfy the QueryDocumentSnapshot<DueData> type.
    await mod.processDuesIssuanceBatch({
      docs: [due] as unknown as Parameters<typeof mod.processDuesIssuanceBatch>[0]['docs'],
      paymentDueDays: 14,
    })

    expect(fakeBatch.commit).toHaveBeenCalledOnce()
    // 2 update calls per due: dues row + member row
    expect(fakeBatch.update).toHaveBeenCalledTimes(2)
    const [duesRef, duesPatch] = fakeBatch.update.mock.calls[0]
    expect(duesRef).toBe(due.ref)
    expect(duesPatch).toMatchObject({
      status: 'issued',
      dueAt: { seconds: 2_000_000 + 14 * 86_400, nanoseconds: 0 },
    })
    const [memberRef, memberPatch] = fakeBatch.update.mock.calls[1]
    expect(memberRef).toEqual({ path: 'members/m-1' })
    expect(memberPatch).toMatchObject({ duesStatus: 'due' })
  })

  it('skips dues rows with missing issuedAt and does not write them', async () => {
    const broken = makeDueDoc({ id: 'broken', memberId: 'm-x', issuedAtSeconds: null })
    await mod.processDuesIssuanceBatch({
      docs: [broken] as unknown as Parameters<typeof mod.processDuesIssuanceBatch>[0]['docs'],
      paymentDueDays: 14,
    })
    expect(fakeBatch.update).not.toHaveBeenCalled()
    // commit() is still called for the empty slice — acceptable.
    expect(fakeBatch.commit).toHaveBeenCalled()
  })
})
