/**
 * Tests pour `treasurerUploadSignableDoc` — étape 1 phase trésorier.
 * Couvre : auth (unauth / admin OK / secretary OK / sans rôle refusé /
 * rootAdmin) ; validations input ; happy path ; pré-condition status invalide.
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

let mod: typeof import('./treasurerUploadSignableDoc')

function buildHandler(): AnyCallableHandler {
  return mod.treasurerUploadSignableDoc as unknown as AnyCallableHandler
}

interface WireOpts {
  roles?: string[]
  userExists?: boolean
  request?: DocData | null
}

function wire(opts: WireOpts): { tx: FakeTx; capturedUpdate: () => DocData | null } {
  const roles = opts.roles ?? ['treasurer']
  const userExists = opts.userExists ?? true
  let capturedUpdate: DocData | null = null

  fakeDb.doc = vi.fn((path: string): FakeDocRef => {
    const ref: FakeDocRef = { path, get: vi.fn() }
    if (path.startsWith('users/')) {
      ref.get = vi.fn().mockResolvedValue({
        exists: userExists,
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
    status: 'coach_validated',
    requiredDocs: ['id_front', 'id_back'],
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
    signableDocStoragePath: null,
    signableDocUploadedAt: null,
    signableDocUploadedByUid: null,
    signedDocStoragePath: null,
    signedDocUploadedAt: null,
    signedDocUploadedByUid: null,
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
  mod = await import('./treasurerUploadSignableDoc')
})
afterEach(() => vi.restoreAllMocks())

describe('treasurerUploadSignableDoc auth', () => {
  it('throws unauthenticated when no auth', async () => {
    wire({ request: buildRequest() })
    await expect(
      buildHandler().run({
        auth: null,
        data: {
          requestId: 'r-1',
          storagePath: 'licenseRequests/treas-uid/r-1/signable.pdf',
          fileName: 'signable.pdf',
          sizeBytes: 1024,
          contentType: 'application/pdf',
        },
      }),
    ).rejects.toThrow(/Must be signed in/)
  })

  it('accepts admin role (now permissive auth)', async () => {
    const w = wire({ roles: ['admin'], request: buildRequest() })
    await buildHandler().run({
      auth: { uid: 'admin-uid' },
      data: {
        requestId: 'r-1',
        storagePath: 'licenseRequests/admin-uid/r-1/signable.pdf',
        fileName: 'signable.pdf',
        sizeBytes: 1024,
        contentType: 'application/pdf',
      },
    })
    expect(w.tx.update).toHaveBeenCalled()
  })

  it('accepts secretary role (now permissive auth)', async () => {
    const w = wire({ roles: ['secretary'], request: buildRequest() })
    await buildHandler().run({
      auth: { uid: 'sec-uid' },
      data: {
        requestId: 'r-1',
        storagePath: 'licenseRequests/sec-uid/r-1/signable.pdf',
        fileName: 'signable.pdf',
        sizeBytes: 1024,
        contentType: 'application/pdf',
      },
    })
    expect(w.tx.update).toHaveBeenCalled()
  })

  it('rejects signed-in caller without admin/treasurer/secretary role', async () => {
    wire({ roles: ['coach'], request: buildRequest() })
    await expect(
      buildHandler().run({
        auth: { uid: 'coach-uid' },
        data: {
          requestId: 'r-1',
          storagePath: 'licenseRequests/coach-uid/r-1/signable.pdf',
          fileName: 'signable.pdf',
          sizeBytes: 1024,
          contentType: 'application/pdf',
        },
      }),
    ).rejects.toThrow(/rootAdmin, admin, treasurer or secretary/)
  })

  it('accepts rootAdmin claim', async () => {
    const w = wire({ roles: [], request: buildRequest() })
    await buildHandler().run({
      auth: { uid: 'root-uid', token: { rootAdmin: true } },
      data: {
        requestId: 'r-1',
        storagePath: 'licenseRequests/root-uid/r-1/signable.pdf',
        fileName: 'signable.pdf',
        sizeBytes: 1024,
        contentType: 'application/pdf',
      },
    })
    expect(w.tx.update).toHaveBeenCalled()
  })
})

describe('treasurerUploadSignableDoc validations', () => {
  it('rejects empty requestId', async () => {
    wire({ request: buildRequest() })
    await expect(
      buildHandler().run({
        auth: { uid: 'treas-uid' },
        data: {
          requestId: '',
          storagePath: 'licenseRequests/treas-uid//signable.pdf',
          fileName: 'signable.pdf',
          sizeBytes: 1024,
          contentType: 'application/pdf',
        },
      }),
    ).rejects.toThrow(/requestId is required/)
  })

  it('rejects storagePath not matching expected prefix', async () => {
    wire({ request: buildRequest() })
    await expect(
      buildHandler().run({
        auth: { uid: 'treas-uid' },
        data: {
          requestId: 'r-1',
          storagePath: 'somewhere-else/r-1/signable.pdf',
          fileName: 'signable.pdf',
          sizeBytes: 1024,
          contentType: 'application/pdf',
        },
      }),
    ).rejects.toThrow(/storagePath must start with/)
  })

  it('rejects non-pdf contentType', async () => {
    wire({ request: buildRequest() })
    await expect(
      buildHandler().run({
        auth: { uid: 'treas-uid' },
        data: {
          requestId: 'r-1',
          storagePath: 'licenseRequests/treas-uid/r-1/signable.pdf',
          fileName: 'signable.pdf',
          sizeBytes: 1024,
          contentType: 'image/jpeg',
        },
      }),
    ).rejects.toThrow(/application\/pdf/)
  })

  it('rejects zero sizeBytes', async () => {
    wire({ request: buildRequest() })
    await expect(
      buildHandler().run({
        auth: { uid: 'treas-uid' },
        data: {
          requestId: 'r-1',
          storagePath: 'licenseRequests/treas-uid/r-1/signable.pdf',
          fileName: 'signable.pdf',
          sizeBytes: 0,
          contentType: 'application/pdf',
        },
      }),
    ).rejects.toThrow(/positive number/)
  })
})

describe('treasurerUploadSignableDoc happy path', () => {
  it('transitions coach_validated → awaiting_parent_signature + posts fields', async () => {
    const w = wire({ request: buildRequest() })
    const out = (await buildHandler().run({
      auth: { uid: 'treas-uid' },
      data: {
        requestId: 'r-1',
        storagePath: 'licenseRequests/treas-uid/r-1/signable.pdf',
        fileName: 'formulaire_pre_rempli.pdf',
        sizeBytes: 25_000,
        contentType: 'application/pdf',
      },
    })) as { newStatus: string }
    expect(out.newStatus).toBe('awaiting_parent_signature')
    const patch = w.capturedUpdate()
    expect(patch?.status).toBe('awaiting_parent_signature')
    expect(patch?.signableDocStoragePath).toBe('licenseRequests/treas-uid/r-1/signable.pdf')
    expect(patch?.signableDocUploadedByUid).toBe('treas-uid')
    expect(patch?.signableDocUploadedAt).toBeDefined()
  })
})

describe('treasurerUploadSignableDoc preconditions', () => {
  it('throws not-found when request does not exist', async () => {
    wire({ request: null })
    await expect(
      buildHandler().run({
        auth: { uid: 'treas-uid' },
        data: {
          requestId: 'missing',
          storagePath: 'licenseRequests/treas-uid/missing/signable.pdf',
          fileName: 'signable.pdf',
          sizeBytes: 1024,
          contentType: 'application/pdf',
        },
      }),
    ).rejects.toThrow(/not found/)
  })

  it('throws failed-precondition when status is not coach_validated', async () => {
    wire({ request: buildRequest({ status: 'awaiting_parent_signature' }) })
    await expect(
      buildHandler().run({
        auth: { uid: 'treas-uid' },
        data: {
          requestId: 'r-1',
          storagePath: 'licenseRequests/treas-uid/r-1/signable.pdf',
          fileName: 'signable.pdf',
          sizeBytes: 1024,
          contentType: 'application/pdf',
        },
      }),
    ).rejects.toThrow(/must be 'coach_validated'/)
  })
})
