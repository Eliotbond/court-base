/**
 * Tests pour `treasurerConfirmSignedDoc` — étape 2 phase trésorier
 * (parent_signed → form_confirmed).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type DocData = Record<string, unknown>

interface FakeDocRef {
  path?: string
  __kind?: string
  get: ReturnType<typeof vi.fn>
}

interface FakeTx {
  get: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn<(ref: unknown, patch: DocData) => void>>
  set: ReturnType<typeof vi.fn<(ref: unknown, data: DocData) => void>>
}

const fakeDb = {
  doc: vi.fn<(path: string) => FakeDocRef>(),
  collection: vi.fn<(name: string) => unknown>(),
  runTransaction: vi.fn(),
}

vi.mock('../dues/_helpers', async () => {
  const actual =
    await vi.importActual<typeof import('../dues/_helpers')>('../dues/_helpers')
  return {
    ...actual,
    db: () => fakeDb,
    Timestamp: {
      now: () => ({ seconds: 1_700_000_000, nanoseconds: 0 }),
    },
  }
})

interface AnyCallableHandler {
  run: (req: {
    auth?: { uid: string; token?: { rootAdmin?: boolean } } | null
    data: DocData
  }) => Promise<unknown>
}

let mod: typeof import('./treasurerConfirmSignedDoc')

function buildHandler(): AnyCallableHandler {
  return mod.treasurerConfirmSignedDoc as unknown as AnyCallableHandler
}

interface WireOpts {
  roles?: string[]
  request?: DocData | null
}

function wire(opts: WireOpts): { tx: FakeTx; capturedUpdate: () => DocData | null } {
  const roles = opts.roles ?? ['treasurer']
  let capturedUpdate: DocData | null = null

  fakeDb.doc = vi.fn((path: string): FakeDocRef => {
    const ref: FakeDocRef = { path, get: vi.fn() }
    if (path.startsWith('users/')) {
      ref.get = vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ roles, email: 'caller@x.ch' }),
      })
    } else if (path.startsWith('licenseRequests/')) {
      ref.__kind = 'request-ref'
    }
    return ref
  })

  const tx: FakeTx = {
    get: vi.fn((target: { __kind?: string }) => {
      if (target.__kind === 'request-ref') {
        return Promise.resolve({
          exists: opts.request !== null && opts.request !== undefined,
          data: () => opts.request ?? undefined,
        })
      }
      throw new Error(`unexpected tx.get target: ${JSON.stringify(target)}`)
    }),
    update: vi.fn<(ref: unknown, patch: DocData) => void>((_, patch) => {
      capturedUpdate = patch
    }),
    set: vi.fn<(ref: unknown, data: DocData) => void>(),
  }

  fakeDb.runTransaction = vi.fn((fn: (t: FakeTx) => Promise<unknown>) => fn(tx))
  return { tx, capturedUpdate: () => capturedUpdate }
}

function buildRequest(overrides: Partial<DocData> = {}): DocData {
  return {
    memberId: 'm-1',
    teamId: 'team-1',
    seasonId: 'season-2025',
    requestedBy: 'coach-uid',
    status: 'parent_signed',
    requiredDocs: ['id_front'],
    parentUserIds: ['parent-1'],
    uploadedDocs: {},
    foreignPlayerContext: null,
    parentSubmittedAvs: null,
    denorm: null,
    parentCompletedAt: null,
    coachValidatedAt: { seconds: 1_699_500_000, nanoseconds: 0 },
    coachValidatedByUid: 'coach-uid',
    reviewedBy: null,
    reviewedAt: null,
    adminComment: null,
    createdAt: { seconds: 1_698_000_000, nanoseconds: 0 },
    signableDocStoragePath: 'licenseRequests/treas-uid/r-1/signable.pdf',
    signableDocUploadedAt: { seconds: 1_699_700_000, nanoseconds: 0 },
    signableDocUploadedByUid: 'treas-uid',
    signedDocStoragePath: 'licenseRequests/parent-1/r-1/signed.pdf',
    signedDocUploadedAt: { seconds: 1_699_800_000, nanoseconds: 0 },
    signedDocUploadedByUid: 'parent-1',
    formConfirmedAt: null,
    formConfirmedByUid: null,
    sentToFederationAt: null,
    paidAt: null,
    paymentProofStoragePath: null,
    paymentProofUploadedAt: null,
    licenseNumber: null,
    licenseFinalizedAt: null,
    licenseFinalizedByUid: null,
    linkedLicenseId: null,
    treasurerNotes: null,
    ...overrides,
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  fakeDb.doc = vi.fn()
  fakeDb.collection = vi.fn()
  fakeDb.runTransaction = vi.fn()
  mod = await import('./treasurerConfirmSignedDoc')
})
afterEach(() => vi.restoreAllMocks())

describe('treasurerConfirmSignedDoc auth', () => {
  it('throws unauthenticated when no auth', async () => {
    wire({ request: buildRequest() })
    await expect(
      buildHandler().run({ auth: null, data: { requestId: 'r-1' } }),
    ).rejects.toThrow(/Must be signed in/)
  })

  it('accepts admin role (now permissive auth)', async () => {
    const w = wire({ roles: ['admin'], request: buildRequest() })
    await buildHandler().run({
      auth: { uid: 'a-uid' },
      data: { requestId: 'r-1' },
    })
    expect(w.tx.update).toHaveBeenCalled()
  })

  it('accepts secretary role (now permissive auth)', async () => {
    const w = wire({ roles: ['secretary'], request: buildRequest() })
    await buildHandler().run({
      auth: { uid: 'sec-uid' },
      data: { requestId: 'r-1' },
    })
    expect(w.tx.update).toHaveBeenCalled()
  })

  it('rejects signed-in caller without admin/treasurer/secretary role', async () => {
    wire({ roles: ['coach'], request: buildRequest() })
    await expect(
      buildHandler().run({ auth: { uid: 'coach-uid' }, data: { requestId: 'r-1' } }),
    ).rejects.toThrow(/rootAdmin, admin, treasurer or secretary/)
  })

  it('accepts rootAdmin claim', async () => {
    const w = wire({ roles: [], request: buildRequest() })
    await buildHandler().run({
      auth: { uid: 'root-uid', token: { rootAdmin: true } },
      data: { requestId: 'r-1' },
    })
    expect(w.tx.update).toHaveBeenCalled()
  })
})

describe('treasurerConfirmSignedDoc happy path', () => {
  it('transitions parent_signed → form_confirmed + posts fields', async () => {
    const w = wire({ request: buildRequest() })
    const out = (await buildHandler().run({
      auth: { uid: 'treas-uid' },
      data: { requestId: 'r-1' },
    })) as { newStatus: string }
    expect(out.newStatus).toBe('form_confirmed')
    const patch = w.capturedUpdate()
    expect(patch?.status).toBe('form_confirmed')
    expect(patch?.formConfirmedByUid).toBe('treas-uid')
    expect(patch?.formConfirmedAt).toBeDefined()
    expect(patch?.treasurerNotes).toBeUndefined() // pas posé si pas fourni
  })

  it('posts treasurerNotes when provided (trimmed)', async () => {
    const w = wire({ request: buildRequest() })
    await buildHandler().run({
      auth: { uid: 'treas-uid' },
      data: { requestId: 'r-1', notes: '  Signature OK, RAS  ' },
    })
    const patch = w.capturedUpdate()
    expect(patch?.treasurerNotes).toBe('Signature OK, RAS')
  })

  it('does not post treasurerNotes when notes is empty string', async () => {
    const w = wire({ request: buildRequest() })
    await buildHandler().run({
      auth: { uid: 'treas-uid' },
      data: { requestId: 'r-1', notes: '   ' },
    })
    expect(w.capturedUpdate()?.treasurerNotes).toBeUndefined()
  })

  it('rejects notes > 500 chars', async () => {
    wire({ request: buildRequest() })
    await expect(
      buildHandler().run({
        auth: { uid: 'treas-uid' },
        data: { requestId: 'r-1', notes: 'x'.repeat(501) },
      }),
    ).rejects.toThrow(/≤ 500 characters/)
  })
})

describe('treasurerConfirmSignedDoc preconditions', () => {
  it('throws not-found when request does not exist', async () => {
    wire({ request: null })
    await expect(
      buildHandler().run({
        auth: { uid: 'treas-uid' },
        data: { requestId: 'missing' },
      }),
    ).rejects.toThrow(/not found/)
  })

  it('throws failed-precondition when status is not parent_signed', async () => {
    wire({ request: buildRequest({ status: 'coach_validated' }) })
    await expect(
      buildHandler().run({
        auth: { uid: 'treas-uid' },
        data: { requestId: 'r-1' },
      }),
    ).rejects.toThrow(/must be 'parent_signed'/)
  })
})
