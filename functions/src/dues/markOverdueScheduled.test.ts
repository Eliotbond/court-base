/**
 * Tests for `processOverdueBatch` — the core of markOverdueScheduled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fakeBatch = {
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
    Timestamp: {
      now: () => ({ seconds: 1_000_000, nanoseconds: 0 }),
    },
  }
})

let mod: typeof import('./markOverdueScheduled')

beforeEach(async () => {
  vi.clearAllMocks()
  fakeBatch.update = vi.fn()
  fakeBatch.commit = vi.fn().mockResolvedValue(undefined)
  fakeDb.batch = vi.fn().mockReturnValue(fakeBatch)
  fakeDb.doc = vi.fn((path: string) => ({ path }))
  mod = await import('./markOverdueScheduled')
})

afterEach(() => {
  vi.restoreAllMocks()
})

function makeDueDoc(opts: { id: string; memberId: string }) {
  return {
    id: opts.id,
    ref: { id: opts.id },
    data: () => ({
      memberId: opts.memberId,
      status: 'issued',
    }),
  }
}

describe('processOverdueBatch', () => {
  it('does nothing on empty docs', async () => {
    await mod.processOverdueBatch([])
    expect(fakeBatch.update).not.toHaveBeenCalled()
    expect(fakeBatch.commit).not.toHaveBeenCalled()
  })

  it('flips issued -> overdue and member -> excluded', async () => {
    const due = makeDueDoc({ id: 'due-1', memberId: 'm-1' })
    await mod.processOverdueBatch([due] as unknown as Parameters<typeof mod.processOverdueBatch>[0])

    expect(fakeBatch.commit).toHaveBeenCalledOnce()
    expect(fakeBatch.update).toHaveBeenCalledTimes(2)
    const [duesRef, duesPatch] = fakeBatch.update.mock.calls[0]
    expect(duesRef).toBe(due.ref)
    expect(duesPatch).toMatchObject({ status: 'overdue' })
    const [memberRef, memberPatch] = fakeBatch.update.mock.calls[1]
    expect(memberRef).toEqual({ path: 'members/m-1' })
    expect(memberPatch).toMatchObject({ duesStatus: 'excluded' })
  })

  it('writes 2 ops per due (batch size accounting)', async () => {
    const dues = Array.from({ length: 3 }, (_, i) =>
      makeDueDoc({ id: `due-${i}`, memberId: `m-${i}` }),
    )
    await mod.processOverdueBatch(dues as unknown as Parameters<typeof mod.processOverdueBatch>[0])
    expect(fakeBatch.update).toHaveBeenCalledTimes(6)
  })
})
