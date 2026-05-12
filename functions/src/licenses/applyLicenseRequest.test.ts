/**
 * Tests for applyLicenseRequest.
 *
 * Covers :
 *   - classifyLicenseTransition (pure helper)
 *   - approval → member.licensed = true
 *   - rejection → no-op on member
 *   - idempotence: already licensed → no-op
 *   - non-transitions (pending → pending) → no-op
 *   - missing member doc → no-op (logged warning)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeDocSnap {
  exists: boolean
  data: () => Record<string, unknown> | undefined
}

const txGet = vi.fn<(target: { path?: string }) => Promise<FakeDocSnap>>()
const txUpdate = vi.fn()

const fakeDb = {
  doc: vi.fn((path: string) => ({ path })),
  runTransaction: vi.fn(
    async (fn: (tx: { get: typeof txGet; update: typeof txUpdate }) => Promise<unknown>) =>
      fn({ get: txGet, update: txUpdate }),
  ),
}

vi.mock('../shared/firestore', () => ({
  db: () => fakeDb,
}))

vi.mock('../shared/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

let mod: typeof import('./applyLicenseRequest')

beforeEach(async () => {
  vi.clearAllMocks()
  txGet.mockReset()
  txUpdate.mockReset()
  fakeDb.runTransaction = vi.fn(
    async (fn: (tx: { get: typeof txGet; update: typeof txUpdate }) => Promise<unknown>) =>
      fn({ get: txGet, update: txUpdate }),
  )
  fakeDb.doc = vi.fn((path: string) => ({ path }))
  mod = await import('./applyLicenseRequest')
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------- classifyLicenseTransition ----------

describe('classifyLicenseTransition', () => {
  it('returns "approve" on pending → approved', () => {
    expect(
      mod.classifyLicenseTransition(
        { status: 'pending' } as never,
        { status: 'approved' } as never,
      ),
    ).toBe('approve')
  })
  it('returns "reject" on pending → rejected', () => {
    expect(
      mod.classifyLicenseTransition(
        { status: 'pending' } as never,
        { status: 'rejected' } as never,
      ),
    ).toBe('reject')
  })
  it('returns "none" on approved → approved (no transition)', () => {
    expect(
      mod.classifyLicenseTransition(
        { status: 'approved' } as never,
        { status: 'approved' } as never,
      ),
    ).toBe('none')
  })
  it('returns "none" on pending → pending', () => {
    expect(
      mod.classifyLicenseTransition(
        { status: 'pending' } as never,
        { status: 'pending' } as never,
      ),
    ).toBe('none')
  })
  it('returns "none" when before is missing (create-only)', () => {
    expect(
      mod.classifyLicenseTransition(undefined, { status: 'pending' } as never),
    ).toBe('none')
  })
})

// ---------- trigger event helpers ----------

interface WrittenEvent {
  data:
    | {
        before: { exists: boolean; data: () => Record<string, unknown> | undefined }
        after: { exists: boolean; data: () => Record<string, unknown> | undefined }
      }
    | undefined
  params: { requestId: string }
}

function makeWrittenEvent(opts: {
  requestId?: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
}): WrittenEvent {
  return {
    params: { requestId: opts.requestId ?? 'req-1' },
    data: {
      before: { exists: !!opts.before, data: () => opts.before },
      after: { exists: !!opts.after, data: () => opts.after },
    },
  }
}

function programMember(member: Record<string, unknown> | null) {
  txGet.mockImplementation(async () => ({
    exists: member !== null,
    data: () => (member === null ? undefined : member),
  }))
}

// ---------- trigger ----------

describe('applyLicenseRequest trigger', () => {
  it('flips member.licensed = true on approval', async () => {
    programMember({ licensed: false })
    const event = makeWrittenEvent({
      before: { status: 'pending', memberId: 'm-1', teamId: 't-1' },
      after: { status: 'approved', memberId: 'm-1', teamId: 't-1' },
    })
    await mod.applyLicenseRequest.run(
      event as Parameters<typeof mod.applyLicenseRequest.run>[0],
    )
    expect(txUpdate).toHaveBeenCalledOnce()
    const [ref, patch] = txUpdate.mock.calls[0]
    expect(ref).toEqual({ path: 'members/m-1' })
    expect(patch).toMatchObject({ licensed: true })
  })

  it('is a no-op on rejection', async () => {
    programMember({ licensed: false })
    const event = makeWrittenEvent({
      before: { status: 'pending', memberId: 'm-1', teamId: 't-1' },
      after: { status: 'rejected', memberId: 'm-1', teamId: 't-1' },
    })
    await mod.applyLicenseRequest.run(
      event as Parameters<typeof mod.applyLicenseRequest.run>[0],
    )
    expect(txGet).not.toHaveBeenCalled()
    expect(txUpdate).not.toHaveBeenCalled()
  })

  it('is idempotent on retrigger: already licensed → no write', async () => {
    programMember({ licensed: true })
    const event = makeWrittenEvent({
      before: { status: 'pending', memberId: 'm-1', teamId: 't-1' },
      after: { status: 'approved', memberId: 'm-1', teamId: 't-1' },
    })
    await mod.applyLicenseRequest.run(
      event as Parameters<typeof mod.applyLicenseRequest.run>[0],
    )
    expect(txUpdate).not.toHaveBeenCalled()
  })

  it('is a no-op on pending → pending replay', async () => {
    const event = makeWrittenEvent({
      before: { status: 'pending', memberId: 'm-1', teamId: 't-1' },
      after: { status: 'pending', memberId: 'm-1', teamId: 't-1' },
    })
    await mod.applyLicenseRequest.run(
      event as Parameters<typeof mod.applyLicenseRequest.run>[0],
    )
    expect(txGet).not.toHaveBeenCalled()
    expect(txUpdate).not.toHaveBeenCalled()
  })

  it('is a no-op on approved → approved replay', async () => {
    const event = makeWrittenEvent({
      before: { status: 'approved', memberId: 'm-1', teamId: 't-1' },
      after: { status: 'approved', memberId: 'm-1', teamId: 't-1' },
    })
    await mod.applyLicenseRequest.run(
      event as Parameters<typeof mod.applyLicenseRequest.run>[0],
    )
    expect(txGet).not.toHaveBeenCalled()
    expect(txUpdate).not.toHaveBeenCalled()
  })

  it('warns and skips when member doc is missing', async () => {
    programMember(null)
    const event = makeWrittenEvent({
      before: { status: 'pending', memberId: 'm-missing', teamId: 't-1' },
      after: { status: 'approved', memberId: 'm-missing', teamId: 't-1' },
    })
    await mod.applyLicenseRequest.run(
      event as Parameters<typeof mod.applyLicenseRequest.run>[0],
    )
    expect(txUpdate).not.toHaveBeenCalled()
  })
})
