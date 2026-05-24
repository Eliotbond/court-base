/**
 * Tests pour `treasurerMarkSentAndPaid` — étape 3 phase trésorier
 * (form_confirmed → sent_paid + création /licenses/{id} status='pending').
 *
 * Couvre auth, validations, happy path (création licence + update lr),
 * idempotence (re-call sur sent_paid avec linkedLicenseId), erreur sur
 * `/licenseTypes` joueur absent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type DocData = Record<string, unknown>

interface FakeDocRef {
  id?: string
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

let mod: typeof import('./treasurerMarkSentAndPaid')

function buildHandler(): AnyCallableHandler {
  return mod.treasurerMarkSentAndPaid as unknown as AnyCallableHandler
}

const DEFAULT_LICENSE_TYPES: DocData[] = [
  {
    id: 'lt-player-junior',
    role: 'player',
    level: null,
    name: 'Joueur Junior',
    fee: 80,
    displayOrder: 10,
    active: true,
  },
]

interface WireOpts {
  roles?: string[]
  request?: DocData | null
  licenseTypes?: DocData[]
}

function wire(opts: WireOpts): {
  tx: FakeTx
  capturedLicense: () => DocData | null
  capturedUpdate: () => DocData | null
  newLicenseId: string
} {
  const roles = opts.roles ?? ['treasurer']
  const licenseTypes = opts.licenseTypes ?? DEFAULT_LICENSE_TYPES
  const newLicenseId = 'lic-generated-1'
  let capturedLicense: DocData | null = null
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

  fakeDb.collection = vi.fn((name: string): unknown => {
    if (name === 'licenseTypes') return { __kind: 'lts-coll' }
    if (name === 'licenses') {
      return { doc: () => ({ id: newLicenseId, __kind: 'license-ref' }) }
    }
    throw new Error(`unexpected collection: ${name}`)
  })

  const tx: FakeTx = {
    get: vi.fn((target: { __kind?: string }) => {
      if (target.__kind === 'request-ref') {
        return Promise.resolve({
          exists: opts.request !== null && opts.request !== undefined,
          data: () => opts.request ?? undefined,
        })
      }
      if (target.__kind === 'lts-coll') {
        return Promise.resolve({
          docs: licenseTypes.map((lt) => ({ id: lt.id as string, data: () => lt })),
        })
      }
      throw new Error(`unexpected tx.get target: ${JSON.stringify(target)}`)
    }),
    update: vi.fn<(ref: unknown, patch: DocData) => void>((ref: unknown, patch) => {
      // Only capture license request update (the request-ref).
      const r = ref as { __kind?: string }
      if (r.__kind === 'request-ref') capturedUpdate = patch
    }),
    set: vi.fn<(ref: unknown, data: DocData) => void>((ref: unknown, data) => {
      const r = ref as { __kind?: string }
      if (r.__kind === 'license-ref') capturedLicense = data
    }),
  }

  fakeDb.runTransaction = vi.fn((fn: (t: FakeTx) => Promise<unknown>) => fn(tx))
  return {
    tx,
    capturedLicense: () => capturedLicense,
    capturedUpdate: () => capturedUpdate,
    newLicenseId,
  }
}

function buildRequest(overrides: Partial<DocData> = {}): DocData {
  return {
    memberId: 'm-1',
    teamId: 'team-1',
    seasonId: 'season-2025',
    requestedBy: 'coach-uid',
    status: 'form_confirmed',
    requiredDocs: ['id_front'],
    parentUserIds: ['parent-1'],
    uploadedDocs: {},
    foreignPlayerContext: null,
    parentSubmittedAvs: null,
    denorm: null,
    parentCompletedAt: null,
    coachValidatedAt: { seconds: 1, nanoseconds: 0 },
    coachValidatedByUid: 'coach-uid',
    reviewedBy: null,
    reviewedAt: null,
    adminComment: null,
    createdAt: { seconds: 1, nanoseconds: 0 },
    signableDocStoragePath: 'licenseRequests/treas-uid/r-1/signable.pdf',
    signableDocUploadedAt: { seconds: 1, nanoseconds: 0 },
    signableDocUploadedByUid: 'treas-uid',
    signedDocStoragePath: 'licenseRequests/parent-1/r-1/signed.pdf',
    signedDocUploadedAt: { seconds: 1, nanoseconds: 0 },
    signedDocUploadedByUid: 'parent-1',
    formConfirmedAt: { seconds: 1, nanoseconds: 0 },
    formConfirmedByUid: 'treas-uid',
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
  mod = await import('./treasurerMarkSentAndPaid')
})
afterEach(() => vi.restoreAllMocks())

describe('treasurerMarkSentAndPaid auth', () => {
  it('throws unauthenticated when no auth', async () => {
    wire({ request: buildRequest() })
    await expect(
      buildHandler().run({ auth: null, data: { requestId: 'r-1' } }),
    ).rejects.toThrow(/Must be signed in/)
  })

  it('accepts admin role (now permissive auth)', async () => {
    const w = wire({ roles: ['admin'], request: buildRequest() })
    const out = (await buildHandler().run({
      auth: { uid: 'a-uid' },
      data: { requestId: 'r-1' },
    })) as { newStatus: string }
    expect(out.newStatus).toBe('sent_paid')
    expect(w.tx.set).toHaveBeenCalled()
  })

  it('accepts secretary role (now permissive auth)', async () => {
    const w = wire({ roles: ['secretary'], request: buildRequest() })
    const out = (await buildHandler().run({
      auth: { uid: 's-uid' },
      data: { requestId: 'r-1' },
    })) as { newStatus: string }
    expect(out.newStatus).toBe('sent_paid')
    expect(w.tx.set).toHaveBeenCalled()
  })

  it('rejects signed-in caller without admin/treasurer/secretary role', async () => {
    wire({ roles: ['coach'], request: buildRequest() })
    await expect(
      buildHandler().run({ auth: { uid: 'coach-uid' }, data: { requestId: 'r-1' } }),
    ).rejects.toThrow(/rootAdmin, admin, treasurer or secretary/)
  })
})

describe('treasurerMarkSentAndPaid happy path', () => {
  it('creates /licenses pending + updates lr to sent_paid', async () => {
    const w = wire({ request: buildRequest() })
    const out = (await buildHandler().run({
      auth: { uid: 'treas-uid' },
      data: { requestId: 'r-1' },
    })) as { newStatus: string; licenseId: string }

    expect(out.newStatus).toBe('sent_paid')
    expect(out.licenseId).toBe(w.newLicenseId)

    // license created
    const license = w.capturedLicense()
    expect(license?.memberId).toBe('m-1')
    expect(license?.seasonId).toBe('season-2025')
    expect(license?.licenseTypeId).toBe('lt-player-junior')
    expect(license?.role).toBe('player')
    expect(license?.level).toBeNull()
    expect(license?.licenseName).toBe('Joueur Junior')
    expect(license?.feeSnapshot).toBe(80)
    expect(license?.status).toBe('pending')
    expect(license?.createdByUid).toBe('treas-uid')
    expect(license?.requestId).toBe('r-1')
    expect(license?.requestedByUid).toBe('coach-uid')

    // lr updated
    const patch = w.capturedUpdate()
    expect(patch?.status).toBe('sent_paid')
    expect(patch?.linkedLicenseId).toBe(w.newLicenseId)
    expect(patch?.sentToFederationAt).toBeDefined()
    expect(patch?.paidAt).toBeDefined()
    expect(patch?.paymentProofStoragePath).toBeUndefined()
  })

  it('attaches paymentProof when provided', async () => {
    const w = wire({ request: buildRequest() })
    await buildHandler().run({
      auth: { uid: 'treas-uid' },
      data: {
        requestId: 'r-1',
        paymentProofStoragePath: 'licenseRequests/treas-uid/r-1/payment-proof.pdf',
      },
    })
    const patch = w.capturedUpdate()
    expect(patch?.paymentProofStoragePath).toBe(
      'licenseRequests/treas-uid/r-1/payment-proof.pdf',
    )
    expect(patch?.paymentProofUploadedAt).toBeDefined()
  })

  it('rejects paymentProof path with wrong prefix', async () => {
    wire({ request: buildRequest() })
    await expect(
      buildHandler().run({
        auth: { uid: 'treas-uid' },
        data: {
          requestId: 'r-1',
          paymentProofStoragePath: 'other-bucket/proof.pdf',
        },
      }),
    ).rejects.toThrow(/must start with/)
  })
})

describe('treasurerMarkSentAndPaid idempotence', () => {
  it('re-call on sent_paid + linkedLicenseId returns same id without writing', async () => {
    const w = wire({
      request: buildRequest({
        status: 'sent_paid',
        linkedLicenseId: 'lic-existing-7',
      }),
    })
    const out = (await buildHandler().run({
      auth: { uid: 'treas-uid' },
      data: { requestId: 'r-1' },
    })) as { newStatus: string; licenseId: string }
    expect(out.newStatus).toBe('sent_paid')
    expect(out.licenseId).toBe('lic-existing-7')
    expect(w.tx.set).not.toHaveBeenCalled()
    expect(w.capturedUpdate()).toBeNull()
  })
})

describe('treasurerMarkSentAndPaid preconditions', () => {
  it('throws failed-precondition when status is not form_confirmed', async () => {
    wire({ request: buildRequest({ status: 'coach_validated' }) })
    await expect(
      buildHandler().run({
        auth: { uid: 'treas-uid' },
        data: { requestId: 'r-1' },
      }),
    ).rejects.toThrow(/must be 'form_confirmed'/)
  })

  it('throws failed-precondition when no active player licenseType', async () => {
    wire({
      request: buildRequest(),
      licenseTypes: [
        // non-player + inactive
        {
          id: 'lt-coach',
          role: 'coach',
          level: 1,
          name: 'Coach N1',
          fee: 60,
          displayOrder: 1,
          active: true,
        },
        {
          id: 'lt-player-old',
          role: 'player',
          level: null,
          name: 'Joueur Senior (legacy)',
          fee: 100,
          displayOrder: 5,
          active: false,
        },
      ],
    })
    await expect(
      buildHandler().run({
        auth: { uid: 'treas-uid' },
        data: { requestId: 'r-1' },
      }),
    ).rejects.toThrow(/Aucun type de licence joueur actif/)
  })
})
