/**
 * Tests pour markDuePaid — focus sur le contrôle d'accès, la précondition
 * `status !== 'paid'`, et le wiring transactionnel (set status='paid' + champs).
 *
 * On mock `./_helpers` et `./_emailEnqueue` pour éviter Firestore réel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeDocRef {
  set: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
}

interface FakeTx {
  get: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
}

const fakeDb = {
  doc: vi.fn<(path: string) => FakeDocRef>(),
  runTransaction: vi.fn(),
  getAll: vi.fn(),
}

vi.mock('./_helpers', async () => {
  const actual = await vi.importActual<typeof import('./_helpers')>('./_helpers')
  return {
    ...actual,
    db: () => fakeDb,
    serverTimestamp: () => '__SERVER_TS__',
    Timestamp: {
      now: () => ({ seconds: 1_000_000, nanoseconds: 0 }),
      fromMillis: (ms: number) => ({ seconds: Math.floor(ms / 1000), nanoseconds: 0 }),
    },
  }
})

vi.mock('./_emailEnqueue', async () => {
  return {
    buildPaymentReference: (id: string) => `DUE-${id.slice(0, 8).toUpperCase()}`,
    enqueueDuesPaymentRequest: vi.fn(),
    enqueueDuesPaymentConfirmed: vi.fn().mockResolvedValue(undefined),
    errCode: () => 'unknown',
    nowIso: () => '1970-01-12T13:46:40.000Z',
    resolveBillingRecipients: vi.fn().mockResolvedValue(['a@b.ch']),
    readClubBanking: vi.fn(),
    tsToIso: () => null,
    FieldValue: {},
    TEMPLATE_DUES_PAYMENT_REQUEST: 'dues_payment_request',
    TEMPLATE_DUES_PAYMENT_CONFIRMED: 'dues_payment_confirmed',
  }
})

interface AnyCallableHandler {
  run: (req: {
    auth?: { uid: string; token?: { rootAdmin?: boolean } } | null
    data: Record<string, unknown>
  }) => Promise<unknown>
}

let mod: typeof import('./markDuePaid')

function buildHandler(): AnyCallableHandler {
  return mod.markDuePaid as unknown as AnyCallableHandler
}

beforeEach(async () => {
  vi.clearAllMocks()
  fakeDb.doc = vi.fn()
  fakeDb.runTransaction = vi.fn()
  fakeDb.getAll = vi.fn()
  mod = await import('./markDuePaid')
})
afterEach(() => vi.restoreAllMocks())

function stubUser(roles: string[]): void {
  // user fetch + due fetch + member fetch all happen via db().doc(...).get()
  // The first call is for users/{uid}; map subsequent calls per path.
  fakeDb.doc = vi.fn((path: string): FakeDocRef => {
    if (path.startsWith('users/')) {
      return {
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ roles, email: 'caller@x.ch' }),
        }),
        set: vi.fn(),
        update: vi.fn(),
      } as unknown as FakeDocRef
    }
    return {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          memberId: 'm1',
          firstName: 'A',
          lastName: 'B',
          amount: 250,
          status: 'issued',
          paymentReference: 'DUE-XYZ',
          comms: { billingRecipients: ['member'], generalRecipients: [], majorityTransition: null },
          linkedUserId: 'u1',
          guardianUserIds: [],
        }),
      }),
      set: vi.fn(),
      update: vi.fn(),
    } as unknown as FakeDocRef
  })
}

describe('markDuePaid permissions', () => {
  it('throws unauthenticated when no auth', async () => {
    stubUser(['admin'])
    const handler = buildHandler()
    await expect(handler.run({ auth: null, data: { dueId: 'd', paymentMethod: 'transfer' } }))
      .rejects.toThrow(/Must be signed in/)
  })

  it('throws permission-denied when user has neither admin nor treasurer role', async () => {
    stubUser(['coach'])
    const handler = buildHandler()
    await expect(
      handler.run({
        auth: { uid: 'caller-uid' },
        data: { dueId: 'd', paymentMethod: 'transfer' },
      }),
    ).rejects.toThrow(/admin or treasurer/)
  })

  it('accepts treasurer role', async () => {
    stubUser(['treasurer'])
    // Wire a tx that returns a non-paid due then update it.
    const tx: FakeTx = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          memberId: 'm1',
          amount: 250,
          status: 'issued',
          paymentReference: 'DUE-X',
        }),
      }),
      update: vi.fn(),
      set: vi.fn(),
    }
    fakeDb.runTransaction = vi.fn(async (fn: (t: FakeTx) => Promise<unknown>) => fn(tx))
    const handler = buildHandler()
    const out = await handler.run({
      auth: { uid: 'caller-uid' },
      data: { dueId: 'due-1234abcd', paymentMethod: 'transfer' },
    })
    expect(out).toEqual({ ok: true, dueId: 'due-1234abcd' })
    expect(tx.update).toHaveBeenCalledOnce()
    const updateArgs = tx.update.mock.calls[0][1]
    expect(updateArgs.status).toBe('paid')
    expect(updateArgs.paidAmount).toBe(250)
    expect(updateArgs.recordedBy).toBe('caller-uid')
    expect(updateArgs.paymentMethod).toBe('transfer')
  })
})

describe('markDuePaid partial amount (comité only)', () => {
  function makeTx(amount: number): FakeTx {
    return {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          memberId: 'm1',
          amount,
          status: 'issued',
          paymentReference: 'DUE-X',
        }),
      }),
      update: vi.fn(),
      set: vi.fn(),
    }
  }

  it('rejects admin (no rootAdmin claim, no treasurer role) when paidAmount < due.amount', async () => {
    stubUser(['admin'])
    fakeDb.runTransaction = vi.fn(async (fn: (t: FakeTx) => Promise<unknown>) =>
      fn(makeTx(250)),
    )
    const handler = buildHandler()
    await expect(
      handler.run({
        auth: { uid: 'caller-uid' },
        data: { dueId: 'd', paymentMethod: 'cash', paidAmount: 100 },
      }),
    ).rejects.toThrow(/rootAdmin or treasurer.*partial/i)
  })

  it('accepts treasurer with partial paidAmount', async () => {
    stubUser(['treasurer'])
    const tx = makeTx(250)
    fakeDb.runTransaction = vi.fn(async (fn: (t: FakeTx) => Promise<unknown>) => fn(tx))
    const handler = buildHandler()
    const out = await handler.run({
      auth: { uid: 'caller-uid' },
      data: { dueId: 'd', paymentMethod: 'cash', paidAmount: 100 },
    })
    expect(out).toEqual({ ok: true, dueId: 'd' })
    expect(tx.update.mock.calls[0][1].paidAmount).toBe(100)
  })

  it('accepts rootAdmin claim with partial paidAmount (even without treasurer role)', async () => {
    // Caller a juste le rôle `admin` côté /users, mais le claim Auth `rootAdmin:
    // true` doit suffire pour autoriser le montant partiel.
    stubUser(['admin'])
    const tx = makeTx(250)
    fakeDb.runTransaction = vi.fn(async (fn: (t: FakeTx) => Promise<unknown>) => fn(tx))
    const handler = buildHandler()
    const out = await handler.run({
      auth: { uid: 'caller-uid', token: { rootAdmin: true } },
      data: { dueId: 'd', paymentMethod: 'cash', paidAmount: 100 },
    })
    expect(out).toEqual({ ok: true, dueId: 'd' })
    expect(tx.update.mock.calls[0][1].paidAmount).toBe(100)
  })

  it('accepts admin when paidAmount equals due.amount (full payment, no partial check)', async () => {
    stubUser(['admin'])
    const tx = makeTx(250)
    fakeDb.runTransaction = vi.fn(async (fn: (t: FakeTx) => Promise<unknown>) => fn(tx))
    const handler = buildHandler()
    const out = await handler.run({
      auth: { uid: 'caller-uid' },
      data: { dueId: 'd', paymentMethod: 'cash', paidAmount: 250 },
    })
    expect(out).toEqual({ ok: true, dueId: 'd' })
    expect(tx.update.mock.calls[0][1].paidAmount).toBe(250)
  })

  it('accepts admin when paidAmount is omitted (defaults to full due.amount)', async () => {
    stubUser(['admin'])
    const tx = makeTx(250)
    fakeDb.runTransaction = vi.fn(async (fn: (t: FakeTx) => Promise<unknown>) => fn(tx))
    const handler = buildHandler()
    const out = await handler.run({
      auth: { uid: 'caller-uid' },
      data: { dueId: 'd', paymentMethod: 'cash' },
    })
    expect(out).toEqual({ ok: true, dueId: 'd' })
    expect(tx.update.mock.calls[0][1].paidAmount).toBe(250)
  })
})

describe('markDuePaid preconditions', () => {
  it('throws failed-precondition when due is already paid', async () => {
    stubUser(['admin'])
    const tx: FakeTx = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ memberId: 'm1', amount: 250, status: 'paid' }),
      }),
      update: vi.fn(),
      set: vi.fn(),
    }
    fakeDb.runTransaction = vi.fn(async (fn: (t: FakeTx) => Promise<unknown>) => fn(tx))
    const handler = buildHandler()
    await expect(
      handler.run({
        auth: { uid: 'caller-uid' },
        data: { dueId: 'd', paymentMethod: 'cash' },
      }),
    ).rejects.toThrow(/already paid/)
  })

  it('throws not-found when due is missing', async () => {
    stubUser(['admin'])
    const tx: FakeTx = {
      get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
      update: vi.fn(),
      set: vi.fn(),
    }
    fakeDb.runTransaction = vi.fn(async (fn: (t: FakeTx) => Promise<unknown>) => fn(tx))
    const handler = buildHandler()
    await expect(
      handler.run({
        auth: { uid: 'caller-uid' },
        data: { dueId: 'missing', paymentMethod: 'cash' },
      }),
    ).rejects.toThrow(/not found/)
  })

  it('rejects invalid paymentMethod', async () => {
    stubUser(['admin'])
    const handler = buildHandler()
    await expect(
      handler.run({
        auth: { uid: 'caller-uid' },
        data: { dueId: 'd', paymentMethod: 'bitcoin' },
      }),
    ).rejects.toThrow(/paymentMethod/)
  })
})
