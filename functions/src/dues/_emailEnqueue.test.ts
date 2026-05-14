/**
 * Tests des helpers d'enqueue email (résolution recipients + idempotence
 * via doc IDs déterministes).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeDocRef {
  set: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
}

const fakeDb = {
  doc: vi.fn<(path: string) => FakeDocRef>(),
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
      fromMillis: (ms: number) => ({
        seconds: Math.floor(ms / 1000),
        nanoseconds: 0,
      }),
    },
  }
})

let mod: typeof import('./_emailEnqueue')

beforeEach(async () => {
  vi.clearAllMocks()
  fakeDb.doc = vi.fn()
  fakeDb.getAll = vi.fn()
  mod = await import('./_emailEnqueue')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildPaymentReference', () => {
  it('formats DUE-<first 8 chars in upper>', () => {
    expect(mod.buildPaymentReference('abcdef1234567890')).toBe('DUE-ABCDEF12')
  })
  it('handles short dueId gracefully (slice no-op)', () => {
    expect(mod.buildPaymentReference('abc')).toBe('DUE-ABC')
  })
})

describe('errCode', () => {
  it('extracts .code when present', () => {
    expect(mod.errCode({ code: 'permission-denied' })).toBe('permission-denied')
  })
  it('returns unknown on unknown shapes', () => {
    expect(mod.errCode(new Error('boom'))).toBe('unknown')
    expect(mod.errCode(null)).toBe('unknown')
    expect(mod.errCode(undefined)).toBe('unknown')
    expect(mod.errCode('plain string')).toBe('unknown')
  })
})

describe('resolveBillingRecipients', () => {
  function buildUserSnap(email: string | null) {
    return {
      exists: true,
      data: () => ({ email: email ?? '' }),
    }
  }

  it('returns [] when billingRecipients is empty', async () => {
    const member = {
      firstName: 'A',
      lastName: 'B',
      linkedUserId: null,
      guardianUserIds: [],
      comms: { billingRecipients: [], generalRecipients: [], majorityTransition: null },
    } as unknown as Parameters<typeof mod.resolveBillingRecipients>[0]
    const out = await mod.resolveBillingRecipients(member)
    expect(out).toEqual([])
  })

  it('resolves member email when recipient = member', async () => {
    const member = {
      firstName: 'A',
      lastName: 'B',
      linkedUserId: 'u1',
      guardianUserIds: [],
      comms: {
        billingRecipients: ['member'],
        generalRecipients: ['member'],
        majorityTransition: null,
      },
    } as unknown as Parameters<typeof mod.resolveBillingRecipients>[0]

    fakeDb.doc = vi.fn().mockReturnValue({ id: 'u1-ref' })
    fakeDb.getAll = vi.fn().mockResolvedValue([buildUserSnap('a@b.ch')])

    const out = await mod.resolveBillingRecipients(member)
    expect(out).toEqual(['a@b.ch'])
  })

  it('resolves guardians + dedupes', async () => {
    const member = {
      firstName: 'A',
      lastName: 'B',
      linkedUserId: null,
      guardianUserIds: ['g1', 'g2'],
      comms: {
        billingRecipients: ['guardians'],
        generalRecipients: ['guardians'],
        majorityTransition: null,
      },
    } as unknown as Parameters<typeof mod.resolveBillingRecipients>[0]
    fakeDb.doc = vi.fn().mockReturnValue({})
    fakeDb.getAll = vi
      .fn()
      .mockResolvedValue([buildUserSnap('p@x.ch'), buildUserSnap('p@x.ch')])
    const out = await mod.resolveBillingRecipients(member)
    expect(out).toEqual(['p@x.ch'])
  })

  it('skips users without email', async () => {
    const member = {
      firstName: 'A',
      lastName: 'B',
      linkedUserId: null,
      guardianUserIds: ['g1', 'g2'],
      comms: {
        billingRecipients: ['guardians'],
        generalRecipients: ['guardians'],
        majorityTransition: null,
      },
    } as unknown as Parameters<typeof mod.resolveBillingRecipients>[0]
    fakeDb.doc = vi.fn().mockReturnValue({})
    fakeDb.getAll = vi
      .fn()
      .mockResolvedValue([buildUserSnap(null), buildUserSnap('p2@x.ch')])
    const out = await mod.resolveBillingRecipients(member)
    expect(out).toEqual(['p2@x.ch'])
  })
})

describe('enqueueDuesPaymentRequest', () => {
  it('writes to deterministic doc id with full context', async () => {
    const set = vi.fn().mockResolvedValue({ writeTime: 'x' })
    fakeDb.doc = vi.fn().mockReturnValue({ set })
    await mod.enqueueDuesPaymentRequest({
      dueId: 'due-xyz',
      amount: 250,
      memberId: 'm1',
      memberFirstName: 'Alice',
      memberLastName: 'Doe',
      recipients: ['a@b.ch'],
      banking: {
        iban: 'CH00',
        bic: 'X',
        bankName: 'Y',
        accountHolder: 'Z',
        paymentInstructions: 'pls',
      },
      paymentReference: 'DUE-XYZ',
      dueAt: '2026-09-01T00:00:00.000Z',
      seasonName: '2026/27',
    })
    // Verify the doc path is deterministic
    expect(fakeDb.doc).toHaveBeenCalledWith('pendingEmails/due-xyz_dues_payment_request')
    expect(set).toHaveBeenCalledOnce()
    const written = set.mock.calls[0][0] as Record<string, unknown>
    expect(written.template).toBe('dues_payment_request')
    expect(written.to).toEqual(['a@b.ch'])
    const ctx = written.context as Record<string, unknown>
    expect(ctx.amount).toBe(250)
    expect(ctx.currency).toBe('CHF')
    expect(ctx.iban).toBe('CH00')
    expect(ctx.memberName).toBe('Alice Doe')
    expect(ctx.paymentReference).toBe('DUE-XYZ')
    expect(written.sentAt).toBe(null)
  })

  it('uses to=null when no recipients (so the worker can flag the incident)', async () => {
    const set = vi.fn().mockResolvedValue({ writeTime: 'x' })
    fakeDb.doc = vi.fn().mockReturnValue({ set })
    await mod.enqueueDuesPaymentRequest({
      dueId: 'd',
      amount: 0,
      memberId: 'm',
      memberFirstName: 'A',
      memberLastName: 'B',
      recipients: [],
      banking: {
        iban: null,
        bic: null,
        bankName: null,
        accountHolder: null,
        paymentInstructions: null,
      },
      paymentReference: 'DUE-D',
      dueAt: null,
    })
    expect(set.mock.calls[0][0].to).toBe(null)
  })
})
