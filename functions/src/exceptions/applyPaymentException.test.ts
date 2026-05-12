/**
 * Tests for applyPaymentException (onCreate + onWrite).
 *
 * We mock `../shared/firestore` to inject a fake Firestore client, then drive
 * the trigger handlers directly through `.run()` (v2 CloudFunction API).
 *
 * Coverage :
 *   - pure helpers: classifyTransition, restoredDueStatus
 *   - onCreate: sets `dues.status = 'excepted'` + `exceptionRequestId`
 *   - onCreate idempotence: re-trigger on same already-excepted dues is no-op
 *   - onWrite approval: dues issuedAt/dueAt updated, status recomputed
 *   - onWrite approval: when newDueAt is in the past → status = 'overdue'
 *   - onWrite rejection: exceptionRequestId cleared, excepted → issued/overdue
 *   - onWrite rejection idempotence: already cleared & non-excepted → no-op
 *   - non-transitions (pending→pending, approved→approved) are no-ops
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

// Make `admin.firestore.Timestamp.now()` deterministic.
const NOW_SECONDS = 1_700_000_000
vi.mock('firebase-admin', () => {
  return {
    firestore: Object.assign(() => ({}), {
      Timestamp: {
        now: () => ({ seconds: NOW_SECONDS, nanoseconds: 0 }),
      },
      FieldValue: {
        serverTimestamp: () => '__SERVER_TS__',
      },
    }),
  }
})

let mod: typeof import('./applyPaymentException')

beforeEach(async () => {
  vi.clearAllMocks()
  txGet.mockReset()
  txUpdate.mockReset()
  fakeDb.runTransaction = vi.fn(
    async (fn: (tx: { get: typeof txGet; update: typeof txUpdate }) => Promise<unknown>) =>
      fn({ get: txGet, update: txUpdate }),
  )
  fakeDb.doc = vi.fn((path: string) => ({ path }))
  mod = await import('./applyPaymentException')
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------- helpers under test ----------

describe('classifyTransition', () => {
  it('returns "approve" on pending → approved', () => {
    expect(
      mod.classifyTransition(
        { status: 'pending' } as never,
        { status: 'approved' } as never,
      ),
    ).toBe('approve')
  })
  it('returns "reject" on pending → rejected', () => {
    expect(
      mod.classifyTransition(
        { status: 'pending' } as never,
        { status: 'rejected' } as never,
      ),
    ).toBe('reject')
  })
  it('returns "none" on approved → approved (no transition)', () => {
    expect(
      mod.classifyTransition(
        { status: 'approved' } as never,
        { status: 'approved' } as never,
      ),
    ).toBe('none')
  })
  it('returns "none" on pending → pending', () => {
    expect(
      mod.classifyTransition(
        { status: 'pending' } as never,
        { status: 'pending' } as never,
      ),
    ).toBe('none')
  })
  it('returns "none" when before is missing (create event)', () => {
    expect(
      mod.classifyTransition(undefined, { status: 'pending' } as never),
    ).toBe('none')
  })
})

describe('restoredDueStatus', () => {
  it('returns "overdue" when dueAt is in the past', () => {
    expect(mod.restoredDueStatus({ seconds: NOW_SECONDS - 10, nanoseconds: 0 }, NOW_SECONDS)).toBe(
      'overdue',
    )
  })
  it('returns "issued" when dueAt is in the future', () => {
    expect(mod.restoredDueStatus({ seconds: NOW_SECONDS + 10, nanoseconds: 0 }, NOW_SECONDS)).toBe(
      'issued',
    )
  })
  it('returns "issued" when dueAt is null (no date → not overdue)', () => {
    expect(mod.restoredDueStatus(null, NOW_SECONDS)).toBe('issued')
  })
})

// ---------- helpers to build trigger events ----------

interface CreatedEvent {
  data: { data: () => Record<string, unknown> | undefined } | undefined
  params: { requestId: string }
}

function makeCreatedEvent(opts: {
  requestId?: string
  request?: Record<string, unknown> | undefined
}): CreatedEvent {
  return {
    params: { requestId: opts.requestId ?? 'req-1' },
    data:
      opts.request === undefined
        ? undefined
        : { data: () => opts.request },
  }
}

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
      before: {
        exists: !!opts.before,
        data: () => opts.before,
      },
      after: {
        exists: !!opts.after,
        data: () => opts.after,
      },
    },
  }
}

function programDue(due: Record<string, unknown> | null) {
  txGet.mockImplementation(async () => ({
    exists: due !== null,
    data: () => (due === null ? undefined : due),
  }))
}

// ---------- onCreate (pending) ----------

describe('applyPaymentExceptionOnCreate', () => {
  it('marks dues as excepted + links exceptionRequestId', async () => {
    programDue({
      status: 'issued',
      exceptionRequestId: null,
      issuedAt: { seconds: 1, nanoseconds: 0 },
      dueAt: { seconds: 2, nanoseconds: 0 },
    })
    const event = makeCreatedEvent({
      requestId: 'req-A',
      request: { status: 'pending', dueId: 'due-A' },
    })
    await mod.applyPaymentExceptionOnCreate.run(
      event as Parameters<typeof mod.applyPaymentExceptionOnCreate.run>[0],
    )
    expect(txUpdate).toHaveBeenCalledOnce()
    const [ref, patch] = txUpdate.mock.calls[0]
    expect(ref).toEqual({ path: 'dues/due-A' })
    expect(patch).toMatchObject({ status: 'excepted', exceptionRequestId: 'req-A' })
  })

  it('is a no-op when dues already excepted and linked to same request', async () => {
    programDue({ status: 'excepted', exceptionRequestId: 'req-A' })
    const event = makeCreatedEvent({
      requestId: 'req-A',
      request: { status: 'pending', dueId: 'due-A' },
    })
    await mod.applyPaymentExceptionOnCreate.run(
      event as Parameters<typeof mod.applyPaymentExceptionOnCreate.run>[0],
    )
    expect(txUpdate).not.toHaveBeenCalled()
  })

  it('skips terminal dues (paid)', async () => {
    programDue({ status: 'paid', exceptionRequestId: null })
    const event = makeCreatedEvent({
      requestId: 'req-A',
      request: { status: 'pending', dueId: 'due-A' },
    })
    await mod.applyPaymentExceptionOnCreate.run(
      event as Parameters<typeof mod.applyPaymentExceptionOnCreate.run>[0],
    )
    expect(txUpdate).not.toHaveBeenCalled()
  })

  it('skips when the request is not pending', async () => {
    programDue({ status: 'issued', exceptionRequestId: null })
    const event = makeCreatedEvent({
      request: { status: 'approved', dueId: 'due-A' },
    })
    await mod.applyPaymentExceptionOnCreate.run(
      event as Parameters<typeof mod.applyPaymentExceptionOnCreate.run>[0],
    )
    expect(txUpdate).not.toHaveBeenCalled()
  })
})

// ---------- onWrite (approve / reject) ----------

describe('applyPaymentException (approve)', () => {
  it('applies newIssuedAt + newDueAt and sets status = issued when future', async () => {
    programDue({
      status: 'excepted',
      exceptionRequestId: 'req-A',
      issuedAt: { seconds: 1, nanoseconds: 0 },
      dueAt: { seconds: 2, nanoseconds: 0 },
    })
    const event = makeWrittenEvent({
      requestId: 'req-A',
      before: { status: 'pending', dueId: 'due-A' },
      after: {
        status: 'approved',
        dueId: 'due-A',
        newIssuedAt: { seconds: NOW_SECONDS + 100, nanoseconds: 0 },
        newDueAt: { seconds: NOW_SECONDS + 1_000, nanoseconds: 0 },
      },
    })
    await mod.applyPaymentException.run(
      event as Parameters<typeof mod.applyPaymentException.run>[0],
    )
    expect(txUpdate).toHaveBeenCalledOnce()
    const [, patch] = txUpdate.mock.calls[0]
    expect(patch).toMatchObject({
      issuedAt: { seconds: NOW_SECONDS + 100, nanoseconds: 0 },
      dueAt: { seconds: NOW_SECONDS + 1_000, nanoseconds: 0 },
      status: 'issued',
      exceptionRequestId: 'req-A',
    })
  })

  it('leaves status as "overdue" when new dueAt is still in the past', async () => {
    programDue({
      status: 'excepted',
      exceptionRequestId: 'req-A',
      issuedAt: { seconds: 1, nanoseconds: 0 },
      dueAt: { seconds: 2, nanoseconds: 0 },
    })
    const event = makeWrittenEvent({
      requestId: 'req-A',
      before: { status: 'pending', dueId: 'due-A' },
      after: {
        status: 'approved',
        dueId: 'due-A',
        newIssuedAt: { seconds: NOW_SECONDS - 1_000, nanoseconds: 0 },
        newDueAt: { seconds: NOW_SECONDS - 10, nanoseconds: 0 },
      },
    })
    await mod.applyPaymentException.run(
      event as Parameters<typeof mod.applyPaymentException.run>[0],
    )
    expect(txUpdate.mock.calls[0][1]).toMatchObject({ status: 'overdue' })
  })

  it('flips an overdue dues back to issued when new dueAt is in the future', async () => {
    programDue({
      status: 'overdue',
      exceptionRequestId: null,
      issuedAt: { seconds: 1, nanoseconds: 0 },
      dueAt: { seconds: 2, nanoseconds: 0 },
    })
    const event = makeWrittenEvent({
      requestId: 'req-B',
      before: { status: 'pending', dueId: 'due-B' },
      after: {
        status: 'approved',
        dueId: 'due-B',
        newIssuedAt: { seconds: NOW_SECONDS + 100, nanoseconds: 0 },
        newDueAt: { seconds: NOW_SECONDS + 1_000, nanoseconds: 0 },
      },
    })
    await mod.applyPaymentException.run(
      event as Parameters<typeof mod.applyPaymentException.run>[0],
    )
    expect(txUpdate.mock.calls[0][1]).toMatchObject({
      status: 'issued',
      exceptionRequestId: 'req-B',
    })
  })

  it('skips terminal dues (paid/cancelled)', async () => {
    programDue({ status: 'paid', exceptionRequestId: null })
    const event = makeWrittenEvent({
      before: { status: 'pending', dueId: 'due-A' },
      after: {
        status: 'approved',
        dueId: 'due-A',
        newIssuedAt: { seconds: NOW_SECONDS + 1, nanoseconds: 0 },
        newDueAt: { seconds: NOW_SECONDS + 2, nanoseconds: 0 },
      },
    })
    await mod.applyPaymentException.run(
      event as Parameters<typeof mod.applyPaymentException.run>[0],
    )
    expect(txUpdate).not.toHaveBeenCalled()
  })

  it('is idempotent: re-trigger with already-applied values is a no-op', async () => {
    const dueAt = { seconds: NOW_SECONDS + 1_000, nanoseconds: 0 }
    const issuedAt = { seconds: NOW_SECONDS + 100, nanoseconds: 0 }
    programDue({
      status: 'issued',
      exceptionRequestId: 'req-A',
      issuedAt,
      dueAt,
    })
    const event = makeWrittenEvent({
      requestId: 'req-A',
      before: { status: 'pending', dueId: 'due-A' },
      after: {
        status: 'approved',
        dueId: 'due-A',
        newIssuedAt: issuedAt,
        newDueAt: dueAt,
      },
    })
    await mod.applyPaymentException.run(
      event as Parameters<typeof mod.applyPaymentException.run>[0],
    )
    expect(txUpdate).not.toHaveBeenCalled()
  })
})

describe('applyPaymentException (reject)', () => {
  it('clears exceptionRequestId and restores status to issued (dueAt future)', async () => {
    programDue({
      status: 'excepted',
      exceptionRequestId: 'req-A',
      issuedAt: { seconds: 1, nanoseconds: 0 },
      dueAt: { seconds: NOW_SECONDS + 1_000, nanoseconds: 0 },
    })
    const event = makeWrittenEvent({
      requestId: 'req-A',
      before: { status: 'pending', dueId: 'due-A' },
      after: { status: 'rejected', dueId: 'due-A' },
    })
    await mod.applyPaymentException.run(
      event as Parameters<typeof mod.applyPaymentException.run>[0],
    )
    expect(txUpdate).toHaveBeenCalledOnce()
    const [, patch] = txUpdate.mock.calls[0]
    expect(patch).toMatchObject({ exceptionRequestId: null, status: 'issued' })
  })

  it('clears exceptionRequestId and restores to overdue when dueAt is past', async () => {
    programDue({
      status: 'excepted',
      exceptionRequestId: 'req-A',
      issuedAt: { seconds: 1, nanoseconds: 0 },
      dueAt: { seconds: NOW_SECONDS - 10, nanoseconds: 0 },
    })
    const event = makeWrittenEvent({
      requestId: 'req-A',
      before: { status: 'pending', dueId: 'due-A' },
      after: { status: 'rejected', dueId: 'due-A' },
    })
    await mod.applyPaymentException.run(
      event as Parameters<typeof mod.applyPaymentException.run>[0],
    )
    expect(txUpdate.mock.calls[0][1]).toMatchObject({
      exceptionRequestId: null,
      status: 'overdue',
    })
  })

  it('is a no-op when the dues was never linked to this request', async () => {
    programDue({
      status: 'issued',
      exceptionRequestId: null,
      issuedAt: { seconds: 1, nanoseconds: 0 },
      dueAt: { seconds: NOW_SECONDS + 1_000, nanoseconds: 0 },
    })
    const event = makeWrittenEvent({
      requestId: 'req-A',
      before: { status: 'pending', dueId: 'due-A' },
      after: { status: 'rejected', dueId: 'due-A' },
    })
    await mod.applyPaymentException.run(
      event as Parameters<typeof mod.applyPaymentException.run>[0],
    )
    expect(txUpdate).not.toHaveBeenCalled()
  })

  it('only clears the link when a different request now owns the dues', async () => {
    programDue({
      status: 'issued',
      exceptionRequestId: 'req-OTHER',
      issuedAt: { seconds: 1, nanoseconds: 0 },
      dueAt: { seconds: NOW_SECONDS + 1_000, nanoseconds: 0 },
    })
    const event = makeWrittenEvent({
      requestId: 'req-A',
      before: { status: 'pending', dueId: 'due-A' },
      after: { status: 'rejected', dueId: 'due-A' },
    })
    await mod.applyPaymentException.run(
      event as Parameters<typeof mod.applyPaymentException.run>[0],
    )
    // not linked-to-this AND not excepted → no-op
    expect(txUpdate).not.toHaveBeenCalled()
  })
})

describe('applyPaymentException (no-transition)', () => {
  it('does nothing on approved → approved replay', async () => {
    programDue({ status: 'issued', exceptionRequestId: 'req-A' })
    const event = makeWrittenEvent({
      requestId: 'req-A',
      before: { status: 'approved', dueId: 'due-A' },
      after: { status: 'approved', dueId: 'due-A' },
    })
    await mod.applyPaymentException.run(
      event as Parameters<typeof mod.applyPaymentException.run>[0],
    )
    expect(txGet).not.toHaveBeenCalled()
    expect(txUpdate).not.toHaveBeenCalled()
  })

  it('does nothing on pending → pending', async () => {
    const event = makeWrittenEvent({
      before: { status: 'pending', dueId: 'due-A' },
      after: { status: 'pending', dueId: 'due-A' },
    })
    await mod.applyPaymentException.run(
      event as Parameters<typeof mod.applyPaymentException.run>[0],
    )
    expect(txGet).not.toHaveBeenCalled()
    expect(txUpdate).not.toHaveBeenCalled()
  })
})
