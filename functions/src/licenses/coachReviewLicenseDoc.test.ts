/**
 * Tests pour `coachReviewLicenseDoc` — review per-doc d'une license request
 * par un coach (PR2).
 *
 * Couvre :
 *  - auth refusée (non signed-in / pas coach de la team) ;
 *  - happy path accept tous → status `coach_validated` + coachValidatedAt/ByUid ;
 *  - accept partiel → reste `parent_docs_submitted` ;
 *  - refuse → status `pending_parent_docs` + raison persistée ;
 *  - pré-condition refus si mauvais status ;
 *  - validation refusalReason (requise si refuse, longueur 5-500) ;
 *  - idempotence : re-accept même doc OK.
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

let mod: typeof import('./coachReviewLicenseDoc')

function buildHandler(): AnyCallableHandler {
  return mod.coachReviewLicenseDoc as unknown as AnyCallableHandler
}

interface WireOpts {
  roles?: string[]
  teamIds?: string[]
  userExists?: boolean
  request?: DocData | null
  /**
   * Doc `/members/{memberId}` lu en transaction pour le gate "photo membre
   * requise" (cf. PR-B `docs/members/license-photo.md`).
   *  - `undefined` → fixture par défaut avec `photoStoragePath` posée (les
   *    tests "accept all" passent le gate sans avoir à le configurer).
   *  - objet sans `photoStoragePath` → membre sans photo (utile pour tester
   *    le `failed-precondition` du gate).
   *  - `null` → member doc inexistant (test edge case).
   */
  member?: DocData | null
}

/**
 * Programme `fakeDb` : user fetch hors-tx, puis tx avec licenseRequest +
 * member doc (lu pour le gate photo). Le tx capturé est retourné pour les
 * assertions.
 */
function wire(opts: WireOpts): { tx: FakeTx; capturedUpdate: DocData | null } {
  const roles = opts.roles ?? ['coach']
  const teamIds = opts.teamIds ?? ['team-1']
  const userExists = opts.userExists ?? true
  // Default member fixture : photoStoragePath posée → passe le gate.
  const memberFixture =
    opts.member === undefined
      ? { photoStoragePath: 'members/m-1/license-photo.jpg' }
      : opts.member
  let capturedUpdate: DocData | null = null

  fakeDb.doc = vi.fn((path: string): FakeDocRef => {
    const ref: FakeDocRef = { path, get: vi.fn() }
    if (path.startsWith('users/')) {
      ref.get = vi.fn().mockResolvedValue({
        exists: userExists,
        data: () => ({ roles, teamIds, email: 'caller@x.ch' }),
      })
    } else if (path.startsWith('licenseRequests/')) {
      ref.__kind = 'request-ref'
    } else if (path.startsWith('members/')) {
      ref.__kind = 'member-ref'
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
      if (target.__kind === 'member-ref') {
        return Promise.resolve({
          exists: memberFixture !== null,
          data: () => memberFixture ?? undefined,
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

  return { tx, get capturedUpdate(): DocData | null { return capturedUpdate } }
}

/** Build d'une license request valide pré-state `parent_docs_submitted`. */
function buildRequest(overrides: Partial<DocData> = {}): DocData {
  return {
    memberId: 'm-1',
    teamId: 'team-1',
    seasonId: 'season-2025',
    requestedBy: 'coach-uid',
    status: 'parent_docs_submitted',
    requiredDocs: ['id_front', 'id_back'],
    parentUserIds: ['parent-1'],
    uploadedDocs: {
      id_front: {
        storagePath: 'licenseRequests/u/r/id_front.jpg',
        uploadedAt: { seconds: 1_699_000_000, nanoseconds: 0 },
        fileName: 'front.jpg',
        sizeBytes: 100,
        contentType: 'image/jpeg',
        coachReview: null,
        treasurerReview: null,
      },
      id_back: {
        storagePath: 'licenseRequests/u/r/id_back.jpg',
        uploadedAt: { seconds: 1_699_000_000, nanoseconds: 0 },
        fileName: 'back.jpg',
        sizeBytes: 100,
        contentType: 'image/jpeg',
        coachReview: null,
        treasurerReview: null,
      },
    },
    foreignPlayerContext: null,
    parentSubmittedAvs: null,
    denorm: null,
    parentCompletedAt: { seconds: 1_699_500_000, nanoseconds: 0 },
    coachValidatedAt: null,
    coachValidatedByUid: null,
    reviewedBy: null,
    reviewedAt: null,
    adminComment: null,
    createdAt: { seconds: 1_698_000_000, nanoseconds: 0 },
    ...overrides,
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  fakeDb.doc = vi.fn()
  fakeDb.collection = vi.fn()
  fakeDb.runTransaction = vi.fn()
  mod = await import('./coachReviewLicenseDoc')
})
afterEach(() => vi.restoreAllMocks())

describe('coachReviewLicenseDoc auth', () => {
  it('throws unauthenticated when no auth', async () => {
    wire({ request: buildRequest() })
    await expect(
      buildHandler().run({
        auth: null,
        data: { requestId: 'r-1', kind: 'id_front', decision: 'accept' },
      }),
    ).rejects.toThrow(/Must be signed in/)
  })

  it('throws permission-denied when caller is not coach of team', async () => {
    wire({
      roles: ['coach'],
      teamIds: ['team-other'],
      request: buildRequest(),
    })
    await expect(
      buildHandler().run({
        auth: { uid: 'c-uid' },
        data: { requestId: 'r-1', kind: 'id_front', decision: 'accept' },
      }),
    ).rejects.toThrow(/coach of this team/)
  })

  it('accepts admin role even without teamIds match', async () => {
    const w = wire({
      roles: ['admin'],
      teamIds: [],
      request: buildRequest(),
    })
    await buildHandler().run({
      auth: { uid: 'admin-uid' },
      data: { requestId: 'r-1', kind: 'id_front', decision: 'accept' },
    })
    expect(w.tx.update).toHaveBeenCalled()
  })
})

describe('coachReviewLicenseDoc accept flow', () => {
  it('accept partial: status remains parent_docs_submitted', async () => {
    const w = wire({ request: buildRequest() })
    const out = (await buildHandler().run({
      auth: { uid: 'coach-uid' },
      data: { requestId: 'r-1', kind: 'id_front', decision: 'accept' },
    })) as { newStatus: string; allCoachAccepted: boolean }
    expect(out.newStatus).toBe('parent_docs_submitted')
    expect(out.allCoachAccepted).toBe(false)
    expect(w.capturedUpdate?.['uploadedDocs.id_front.coachReview']).toBeDefined()
    // No status field in the patch when staying.
    expect(w.capturedUpdate?.status).toBeUndefined()
  })

  it('accept all: transitions to coach_validated + sets validation fields', async () => {
    // id_back already accepted in fixture
    const requestWithOneAccepted = buildRequest({
      uploadedDocs: {
        id_front: {
          storagePath: 'p/front', uploadedAt: { seconds: 1, nanoseconds: 0 },
          fileName: 'f', sizeBytes: 1, contentType: 'image/jpeg',
          coachReview: null, treasurerReview: null,
        },
        id_back: {
          storagePath: 'p/back', uploadedAt: { seconds: 1, nanoseconds: 0 },
          fileName: 'b', sizeBytes: 1, contentType: 'image/jpeg',
          coachReview: {
            decision: 'accepted',
            at: { seconds: 1, nanoseconds: 0 },
            byUid: 'coach-uid',
            refusalReason: null,
          },
          treasurerReview: null,
        },
      },
    })
    const w = wire({ request: requestWithOneAccepted })
    const out = (await buildHandler().run({
      auth: { uid: 'coach-uid' },
      data: { requestId: 'r-1', kind: 'id_front', decision: 'accept' },
    })) as { newStatus: string; allCoachAccepted: boolean }
    expect(out.newStatus).toBe('coach_validated')
    expect(out.allCoachAccepted).toBe(true)
    expect(w.capturedUpdate?.status).toBe('coach_validated')
    expect(w.capturedUpdate?.coachValidatedByUid).toBe('coach-uid')
    expect(w.capturedUpdate?.coachValidatedAt).toBeDefined()
  })
})

describe('coachReviewLicenseDoc refuse flow', () => {
  it('refuse: transitions to pending_parent_docs + persists reason + resets validation', async () => {
    const w = wire({ request: buildRequest() })
    const out = (await buildHandler().run({
      auth: { uid: 'coach-uid' },
      data: {
        requestId: 'r-1',
        kind: 'id_front',
        decision: 'refuse',
        refusalReason: 'Document flou, illisible',
      },
    })) as { newStatus: string }
    expect(out.newStatus).toBe('pending_parent_docs')
    expect(w.capturedUpdate?.status).toBe('pending_parent_docs')
    expect(w.capturedUpdate?.coachValidatedAt).toBeNull()
    expect(w.capturedUpdate?.coachValidatedByUid).toBeNull()
    const review = w.capturedUpdate?.[
      'uploadedDocs.id_front.coachReview'
    ] as { decision: string; refusalReason: string } | undefined
    expect(review?.decision).toBe('refused')
    expect(review?.refusalReason).toBe('Document flou, illisible')
  })

  it('rejects refuse without reason', async () => {
    wire({ request: buildRequest() })
    await expect(
      buildHandler().run({
        auth: { uid: 'coach-uid' },
        data: { requestId: 'r-1', kind: 'id_front', decision: 'refuse' },
      }),
    ).rejects.toThrow(/refusalReason is required/)
  })

  it('rejects refuse with reason < 5 chars', async () => {
    wire({ request: buildRequest() })
    await expect(
      buildHandler().run({
        auth: { uid: 'coach-uid' },
        data: {
          requestId: 'r-1',
          kind: 'id_front',
          decision: 'refuse',
          refusalReason: 'nok',
        },
      }),
    ).rejects.toThrow(/between 5 and 500/)
  })
})

describe('coachReviewLicenseDoc preconditions', () => {
  it('throws failed-precondition when request status is not parent_docs_submitted', async () => {
    wire({ request: buildRequest({ status: 'coach_validated' }) })
    await expect(
      buildHandler().run({
        auth: { uid: 'coach-uid' },
        data: { requestId: 'r-1', kind: 'id_front', decision: 'accept' },
      }),
    ).rejects.toThrow(/must be 'parent_docs_submitted'/)
  })

  it('throws not-found when request does not exist', async () => {
    wire({ request: null })
    await expect(
      buildHandler().run({
        auth: { uid: 'coach-uid' },
        data: { requestId: 'missing', kind: 'id_front', decision: 'accept' },
      }),
    ).rejects.toThrow(/not found/)
  })

  it('throws failed-precondition when kind is not in requiredDocs', async () => {
    wire({ request: buildRequest({ requiredDocs: ['id_front', 'id_back'] }) })
    await expect(
      buildHandler().run({
        auth: { uid: 'coach-uid' },
        data: { requestId: 'r-1', kind: 'avs', decision: 'accept' },
      }),
    ).rejects.toThrow(/not in this request's requiredDocs/)
  })

  it('throws invalid-argument for unknown kind', async () => {
    wire({ request: buildRequest() })
    await expect(
      buildHandler().run({
        auth: { uid: 'coach-uid' },
        data: { requestId: 'r-1', kind: 'nonsense', decision: 'accept' },
      }),
    ).rejects.toThrow(/kind must be one of/)
  })
})

describe('coachReviewLicenseDoc — gate photo membre (PR-B)', () => {
  // Cf. docs/members/license-photo.md : la photo membre est requise pour la
  // transition `parent_docs_submitted → coach_validated`. Pas pour les
  // accepts partiels, pas pour les refus.

  it('accept partial without photo: OK (gate ne s\'applique pas)', async () => {
    const w = wire({
      request: buildRequest(),
      member: {}, // pas de photoStoragePath
    })
    const out = (await buildHandler().run({
      auth: { uid: 'coach-uid' },
      data: { requestId: 'r-1', kind: 'id_front', decision: 'accept' },
    })) as { newStatus: string; allCoachAccepted: boolean }
    expect(out.newStatus).toBe('parent_docs_submitted')
    expect(out.allCoachAccepted).toBe(false)
    // Le patch est posé (review per-doc) mais pas de status / coachValidated*.
    expect(w.capturedUpdate?.['uploadedDocs.id_front.coachReview']).toBeDefined()
    expect(w.capturedUpdate?.status).toBeUndefined()
  })

  it('accept last doc WITHOUT photo: failed-precondition', async () => {
    const requestWithOneAccepted = buildRequest({
      uploadedDocs: {
        id_front: {
          storagePath: 'p/front', uploadedAt: { seconds: 1, nanoseconds: 0 },
          fileName: 'f', sizeBytes: 1, contentType: 'image/jpeg',
          coachReview: null, treasurerReview: null,
        },
        id_back: {
          storagePath: 'p/back', uploadedAt: { seconds: 1, nanoseconds: 0 },
          fileName: 'b', sizeBytes: 1, contentType: 'image/jpeg',
          coachReview: {
            decision: 'accepted',
            at: { seconds: 1, nanoseconds: 0 },
            byUid: 'coach-uid',
            refusalReason: null,
          },
          treasurerReview: null,
        },
      },
    })
    wire({
      request: requestWithOneAccepted,
      member: {}, // pas de photoStoragePath
    })
    await expect(
      buildHandler().run({
        auth: { uid: 'coach-uid' },
        data: { requestId: 'r-1', kind: 'id_front', decision: 'accept' },
      }),
    ).rejects.toThrow(/Photo membre requise/)
  })

  it('accept last doc WITH photo: passes gate → coach_validated', async () => {
    const requestWithOneAccepted = buildRequest({
      uploadedDocs: {
        id_front: {
          storagePath: 'p/front', uploadedAt: { seconds: 1, nanoseconds: 0 },
          fileName: 'f', sizeBytes: 1, contentType: 'image/jpeg',
          coachReview: null, treasurerReview: null,
        },
        id_back: {
          storagePath: 'p/back', uploadedAt: { seconds: 1, nanoseconds: 0 },
          fileName: 'b', sizeBytes: 1, contentType: 'image/jpeg',
          coachReview: {
            decision: 'accepted',
            at: { seconds: 1, nanoseconds: 0 },
            byUid: 'coach-uid',
            refusalReason: null,
          },
          treasurerReview: null,
        },
      },
    })
    const w = wire({
      request: requestWithOneAccepted,
      member: { photoStoragePath: 'members/m-1/license-photo.jpg' },
    })
    const out = (await buildHandler().run({
      auth: { uid: 'coach-uid' },
      data: { requestId: 'r-1', kind: 'id_front', decision: 'accept' },
    })) as { newStatus: string; allCoachAccepted: boolean }
    expect(out.newStatus).toBe('coach_validated')
    expect(out.allCoachAccepted).toBe(true)
    expect(w.capturedUpdate?.status).toBe('coach_validated')
  })

  it('refuse without photo: OK (gate ne s\'applique pas aux refus)', async () => {
    const w = wire({
      request: buildRequest(),
      member: {}, // pas de photoStoragePath
    })
    const out = (await buildHandler().run({
      auth: { uid: 'coach-uid' },
      data: {
        requestId: 'r-1',
        kind: 'id_front',
        decision: 'refuse',
        refusalReason: 'Document flou',
      },
    })) as { newStatus: string }
    expect(out.newStatus).toBe('pending_parent_docs')
    expect(w.capturedUpdate?.status).toBe('pending_parent_docs')
  })
})

describe('coachReviewLicenseDoc idempotence', () => {
  it('re-accept already accepted doc still ok (overwrites at + byUid)', async () => {
    const req = buildRequest({
      uploadedDocs: {
        id_front: {
          storagePath: 'p/f', uploadedAt: { seconds: 1, nanoseconds: 0 },
          fileName: 'f', sizeBytes: 1, contentType: 'image/jpeg',
          coachReview: {
            decision: 'accepted',
            at: { seconds: 1, nanoseconds: 0 },
            byUid: 'coach-old',
            refusalReason: null,
          },
          treasurerReview: null,
        },
        id_back: {
          storagePath: 'p/b', uploadedAt: { seconds: 1, nanoseconds: 0 },
          fileName: 'b', sizeBytes: 1, contentType: 'image/jpeg',
          coachReview: null,
          treasurerReview: null,
        },
      },
    })
    const w = wire({ request: req })
    const out = (await buildHandler().run({
      auth: { uid: 'coach-uid' },
      data: { requestId: 'r-1', kind: 'id_front', decision: 'accept' },
    })) as { allCoachAccepted: boolean }
    expect(out.allCoachAccepted).toBe(false) // id_back still not reviewed
    const review = w.capturedUpdate?.[
      'uploadedDocs.id_front.coachReview'
    ] as { byUid: string } | undefined
    expect(review?.byUid).toBe('coach-uid')
  })
})
