/**
 * Tests pour `validateLicenseRequest` — décision finale du trésorier (PR3).
 *
 * Couvre :
 *  - auth refusée pour rôle non éligible ;
 *  - approve crée /licenses pending + snapshot LicenseType + status approved ;
 *  - reject ne crée pas /licenses + status rejected ;
 *  - approve refusé si tous les docs ne sont pas treasurer-accepted ;
 *  - pré-condition : refus si status !== coach_validated ;
 *  - pré-condition : refus si aucun /licenseTypes joueur seedé.
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

let mod: typeof import('./validateLicenseRequest')

function buildHandler(): AnyCallableHandler {
  return mod.validateLicenseRequest as unknown as AnyCallableHandler
}

const DEFAULT_LICENSE_TYPES: DocData[] = [
  {
    id: 'lt-player-junior',
    role: 'player',
    level: null,
    name: 'Joueur Junior',
    fee: 50,
    active: true,
    displayOrder: 1,
  },
  {
    id: 'lt-coach-1',
    role: 'coach',
    level: 1,
    name: 'Coach N1',
    fee: 30,
    active: true,
    displayOrder: 10,
  },
]

interface WireOpts {
  roles?: string[]
  request?: DocData | null
  member?: DocData | null
  licenseTypes?: DocData[]
}

interface WiredFake {
  tx: FakeTx
  capturedUpdate: DocData | null
  capturedSet: DocData | null
  capturedSetRef: { id?: string } | null
}

function wire(opts: WireOpts): WiredFake {
  const roles = opts.roles ?? ['treasurer']
  const licenseTypes = opts.licenseTypes ?? DEFAULT_LICENSE_TYPES
  let capturedUpdate: DocData | null = null
  let capturedSet: DocData | null = null
  let capturedSetRef: { id?: string } | null = null

  fakeDb.doc = vi.fn((path: string): FakeDocRef => {
    const ref: FakeDocRef = { path, get: vi.fn() }
    if (path.startsWith('users/')) {
      ref.get = vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ roles, email: 'caller@x.ch' }),
      })
    } else if (path.startsWith('licenseRequests/')) {
      ref.__kind = 'request-ref'
    } else if (path.startsWith('members/')) {
      ref.__kind = 'member-ref'
    }
    return ref
  })

  fakeDb.collection = vi.fn((name: string): unknown => {
    if (name === 'licenseTypes') {
      return {
        get: vi.fn().mockResolvedValue({
          docs: licenseTypes.map((t) => ({
            id: t.id as string,
            data: () => t,
          })),
        }),
      }
    }
    if (name === 'licenses') {
      return {
        doc: (): { id: string } => ({ id: 'lic-generated-1' }),
      }
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
      if (target.__kind === 'member-ref') {
        return Promise.resolve({
          exists: opts.member !== null && opts.member !== undefined,
          data: () => opts.member ?? undefined,
        })
      }
      throw new Error(`unexpected tx.get target: ${JSON.stringify(target)}`)
    }),
    update: vi.fn<(ref: unknown, patch: DocData) => void>((_, patch) => {
      capturedUpdate = patch
    }),
    set: vi.fn<(ref: unknown, data: DocData) => void>((ref, data) => {
      capturedSet = data
      capturedSetRef = ref as { id?: string }
    }),
  }

  fakeDb.runTransaction = vi.fn((fn: (t: FakeTx) => Promise<unknown>) => fn(tx))

  return {
    tx,
    get capturedUpdate(): DocData | null { return capturedUpdate },
    get capturedSet(): DocData | null { return capturedSet },
    get capturedSetRef(): { id?: string } | null { return capturedSetRef },
  }
}

/** Request coach_validated + tous les docs treasurer-accepted (cas approve). */
function buildValidatedRequest(overrides: Partial<DocData> = {}): DocData {
  const doc = {
    storagePath: 'p/x', uploadedAt: { seconds: 1, nanoseconds: 0 },
    fileName: 'x', sizeBytes: 1, contentType: 'image/jpeg',
    coachReview: {
      decision: 'accepted', at: { seconds: 1, nanoseconds: 0 },
      byUid: 'coach-uid', refusalReason: null,
    },
    treasurerReview: {
      decision: 'accepted', at: { seconds: 1, nanoseconds: 0 },
      byUid: 'tre-uid', refusalReason: null,
    },
  }
  return {
    memberId: 'm-1',
    teamId: 'team-1',
    seasonId: 'season-2025',
    requestedBy: 'coach-uid',
    status: 'coach_validated',
    requiredDocs: ['id_front', 'id_back'],
    parentUserIds: ['parent-1'],
    uploadedDocs: { id_front: doc, id_back: doc },
    foreignPlayerContext: null,
    parentSubmittedAvs: null,
    denorm: null,
    parentCompletedAt: { seconds: 1, nanoseconds: 0 },
    coachValidatedAt: { seconds: 1, nanoseconds: 0 },
    coachValidatedByUid: 'coach-uid',
    reviewedBy: null,
    reviewedAt: null,
    adminComment: null,
    createdAt: { seconds: 1, nanoseconds: 0 },
    ...overrides,
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  fakeDb.doc = vi.fn()
  fakeDb.collection = vi.fn()
  fakeDb.runTransaction = vi.fn()
  mod = await import('./validateLicenseRequest')
})
afterEach(() => vi.restoreAllMocks())

describe('validateLicenseRequest auth', () => {
  it('throws permission-denied for coach role', async () => {
    wire({
      roles: ['coach'],
      request: buildValidatedRequest(),
      member: { firstName: 'A', lastName: 'B' },
    })
    await expect(
      buildHandler().run({
        auth: { uid: 'c-uid' },
        data: { requestId: 'r-1', decision: 'approve' },
      }),
    ).rejects.toThrow(/rootAdmin, admin, treasurer or secretary/)
  })
})

describe('validateLicenseRequest approve', () => {
  it('creates /licenses with snapshot + flips request to approved', async () => {
    const w = wire({
      request: buildValidatedRequest(),
      member: { firstName: 'Jean', lastName: 'Dupont' },
    })

    const out = (await buildHandler().run({
      auth: { uid: 'tre-uid' },
      data: { requestId: 'r-1', decision: 'approve', comment: '  OK pour cette saison  ' },
    })) as { newStatus: string; licenseId: string | null }

    expect(out.newStatus).toBe('approved')
    expect(out.licenseId).toBe('lic-generated-1')

    // License set: snapshot from default player type.
    const lic = w.capturedSet
    expect(lic).toBeDefined()
    expect(lic?.memberId).toBe('m-1')
    expect(lic?.seasonId).toBe('season-2025')
    expect(lic?.licenseTypeId).toBe('lt-player-junior')
    expect(lic?.role).toBe('player')
    expect(lic?.level).toBeNull()
    expect(lic?.licenseName).toBe('Joueur Junior')
    expect(lic?.feeSnapshot).toBe(50)
    expect(lic?.status).toBe('pending')
    expect(lic?.requestId).toBe('r-1')
    expect(lic?.requestedByUid).toBe('coach-uid')
    expect(lic?.createdByUid).toBe('tre-uid')

    // Request update: approved + reviewed fields + trimmed comment.
    expect(w.capturedUpdate?.status).toBe('approved')
    expect(w.capturedUpdate?.reviewedBy).toBe('tre-uid')
    expect(w.capturedUpdate?.adminComment).toBe('OK pour cette saison')
  })

  it('refuses approve when not all docs are treasurer-accepted', async () => {
    const req = buildValidatedRequest({
      uploadedDocs: {
        id_front: {
          storagePath: 'p/f', uploadedAt: { seconds: 1, nanoseconds: 0 },
          fileName: 'f', sizeBytes: 1, contentType: 'image/jpeg',
          coachReview: {
            decision: 'accepted', at: { seconds: 1, nanoseconds: 0 },
            byUid: 'coach-uid', refusalReason: null,
          },
          treasurerReview: null,
        },
        id_back: {
          storagePath: 'p/b', uploadedAt: { seconds: 1, nanoseconds: 0 },
          fileName: 'b', sizeBytes: 1, contentType: 'image/jpeg',
          coachReview: {
            decision: 'accepted', at: { seconds: 1, nanoseconds: 0 },
            byUid: 'coach-uid', refusalReason: null,
          },
          treasurerReview: {
            decision: 'accepted', at: { seconds: 1, nanoseconds: 0 },
            byUid: 'tre-uid', refusalReason: null,
          },
        },
      },
    })
    wire({ request: req, member: { firstName: 'A', lastName: 'B' } })
    await expect(
      buildHandler().run({
        auth: { uid: 'tre-uid' },
        data: { requestId: 'r-1', decision: 'approve' },
      }),
    ).rejects.toThrow(/validés par le trésorier/)
  })

  it('throws failed-precondition when no player license type is seeded', async () => {
    wire({
      licenseTypes: [
        { id: 'lt-coach', role: 'coach', level: 1, name: 'C', fee: 10, active: true, displayOrder: 1 },
      ],
      request: buildValidatedRequest(),
      member: { firstName: 'A', lastName: 'B' },
    })
    await expect(
      buildHandler().run({
        auth: { uid: 'tre-uid' },
        data: { requestId: 'r-1', decision: 'approve' },
      }),
    ).rejects.toThrow(/licenseTypes joueur actif/)
  })
})

describe('validateLicenseRequest reject', () => {
  it('reject: no /licenses, request flips to rejected with comment', async () => {
    const w = wire({
      request: buildValidatedRequest(),
      member: { firstName: 'A', lastName: 'B' },
    })
    const out = (await buildHandler().run({
      auth: { uid: 'tre-uid' },
      data: { requestId: 'r-1', decision: 'reject', comment: 'Documents falsifies' },
    })) as { newStatus: string; licenseId: string | null }
    expect(out.newStatus).toBe('rejected')
    expect(out.licenseId).toBeNull()
    expect(w.capturedSet).toBeNull()
    expect(w.capturedUpdate?.status).toBe('rejected')
    expect(w.capturedUpdate?.adminComment).toBe('Documents falsifies')
  })

  it('reject: allowed directly from parent_docs_submitted (no coach validation required)', async () => {
    const w = wire({
      request: buildValidatedRequest({
        status: 'parent_docs_submitted',
        coachValidatedAt: null,
        coachValidatedByUid: null,
      }),
      member: { firstName: 'A', lastName: 'B' },
    })
    const out = (await buildHandler().run({
      auth: { uid: 'tre-uid' },
      data: { requestId: 'r-1', decision: 'reject', comment: 'Faux passeport' },
    })) as { newStatus: string; licenseId: string | null }
    expect(out.newStatus).toBe('rejected')
    expect(out.licenseId).toBeNull()
    expect(w.capturedSet).toBeNull()
    expect(w.capturedUpdate?.status).toBe('rejected')
    expect(w.capturedUpdate?.adminComment).toBe('Faux passeport')
  })
})

describe('validateLicenseRequest preconditions', () => {
  it('approve: throws failed-precondition when status is parent_docs_submitted', async () => {
    wire({
      request: buildValidatedRequest({ status: 'parent_docs_submitted' }),
      member: { firstName: 'A', lastName: 'B' },
    })
    await expect(
      buildHandler().run({
        auth: { uid: 'tre-uid' },
        data: { requestId: 'r-1', decision: 'approve' },
      }),
    ).rejects.toThrow(/cannot approve in status 'parent_docs_submitted'/)
  })

  it('reject: throws failed-precondition when status is pending_parent_docs', async () => {
    wire({
      request: buildValidatedRequest({
        status: 'pending_parent_docs',
        coachValidatedAt: null,
        coachValidatedByUid: null,
      }),
      member: { firstName: 'A', lastName: 'B' },
    })
    await expect(
      buildHandler().run({
        auth: { uid: 'tre-uid' },
        data: { requestId: 'r-1', decision: 'reject', comment: 'trop tot' },
      }),
    ).rejects.toThrow(/cannot reject in status 'pending_parent_docs'/)
  })

  it('reject: throws failed-precondition when status is already terminal', async () => {
    wire({
      request: buildValidatedRequest({ status: 'rejected' }),
      member: { firstName: 'A', lastName: 'B' },
    })
    await expect(
      buildHandler().run({
        auth: { uid: 'tre-uid' },
        data: { requestId: 'r-1', decision: 'reject', comment: 'doublon' },
      }),
    ).rejects.toThrow(/cannot reject in status 'rejected'/)
  })

  it('throws not-found when request does not exist', async () => {
    wire({ request: null })
    await expect(
      buildHandler().run({
        auth: { uid: 'tre-uid' },
        data: { requestId: 'missing', decision: 'reject' },
      }),
    ).rejects.toThrow(/not found/)
  })
})
