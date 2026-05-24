/**
 * Tests pour `treasurerReviewLicenseDoc` — review per-doc trésorier (PR3).
 *
 * Couvre :
 *  - auth refusée (caller sans rôle treasurer/admin/secretary) ;
 *  - happy path accept tous → status reste `coach_validated` + allAccepted=true ;
 *  - refuse → reset complet (status `pending_parent_docs`, coachValidatedAt/ByUid=null) ;
 *  - bypass coach : accept autorisé en `parent_docs_submitted` et
 *    `pending_parent_docs` (status inchangé) ;
 *  - pré-conditions : refus si status hors set autorisé (accept et refuse
 *    ont des sets distincts).
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

let mod: typeof import('./treasurerReviewLicenseDoc')

function buildHandler(): AnyCallableHandler {
  return mod.treasurerReviewLicenseDoc as unknown as AnyCallableHandler
}

interface WireOpts {
  roles?: string[]
  userExists?: boolean
  request?: DocData | null
}

function wire(opts: WireOpts): { tx: FakeTx; capturedUpdate: DocData | null } {
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

  return { tx, get capturedUpdate(): DocData | null { return capturedUpdate } }
}

function buildRequest(overrides: Partial<DocData> = {}): DocData {
  // par défaut : coach_validated avec coach review accepted sur les 2 docs.
  return {
    memberId: 'm-1',
    teamId: 'team-1',
    seasonId: 'season-2025',
    requestedBy: 'coach-uid',
    status: 'coach_validated',
    requiredDocs: ['id_front', 'id_back'],
    parentUserIds: ['parent-1'],
    uploadedDocs: {
      id_front: {
        storagePath: 'p/f', uploadedAt: { seconds: 1, nanoseconds: 0 },
        fileName: 'f', sizeBytes: 1, contentType: 'image/jpeg',
        coachReview: {
          decision: 'accepted',
          at: { seconds: 1, nanoseconds: 0 },
          byUid: 'coach-uid',
          refusalReason: null,
        },
        treasurerReview: null,
      },
      id_back: {
        storagePath: 'p/b', uploadedAt: { seconds: 1, nanoseconds: 0 },
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
    foreignPlayerContext: null,
    parentSubmittedAvs: null,
    denorm: null,
    parentCompletedAt: { seconds: 1_699_500_000, nanoseconds: 0 },
    coachValidatedAt: { seconds: 1_699_900_000, nanoseconds: 0 },
    coachValidatedByUid: 'coach-uid',
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
  mod = await import('./treasurerReviewLicenseDoc')
})
afterEach(() => vi.restoreAllMocks())

describe('treasurerReviewLicenseDoc auth', () => {
  it('throws permission-denied for coach role', async () => {
    wire({ roles: ['coach'], request: buildRequest() })
    await expect(
      buildHandler().run({
        auth: { uid: 'c-uid' },
        data: { requestId: 'r-1', kind: 'id_front', decision: 'accept' },
      }),
    ).rejects.toThrow(/rootAdmin, admin, treasurer or secretary/)
  })

  it('accepts secretary role', async () => {
    const w = wire({ roles: ['secretary'], request: buildRequest() })
    await buildHandler().run({
      auth: { uid: 'sec-uid' },
      data: { requestId: 'r-1', kind: 'id_front', decision: 'accept' },
    })
    expect(w.tx.update).toHaveBeenCalled()
  })
})

describe('treasurerReviewLicenseDoc accept flow', () => {
  it('accept all: stays coach_validated, allTreasurerAccepted=true', async () => {
    // pose déjà treasurerReview accepted sur id_back ; on accept id_front
    const req = buildRequest({
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
    const w = wire({ request: req })
    const out = (await buildHandler().run({
      auth: { uid: 'tre-uid' },
      data: { requestId: 'r-1', kind: 'id_front', decision: 'accept' },
    })) as { newStatus: string; allTreasurerAccepted: boolean }
    expect(out.newStatus).toBe('coach_validated')
    expect(out.allTreasurerAccepted).toBe(true)
    // No status flip — only the per-doc review is touched.
    expect(w.capturedUpdate?.status).toBeUndefined()
  })

  it('accept partial: still allTreasurerAccepted=false', async () => {
    const w = wire({ request: buildRequest() })
    const out = (await buildHandler().run({
      auth: { uid: 'tre-uid' },
      data: { requestId: 'r-1', kind: 'id_front', decision: 'accept' },
    })) as { allTreasurerAccepted: boolean }
    expect(out.allTreasurerAccepted).toBe(false)
    expect(w.capturedUpdate?.[
      'uploadedDocs.id_front.treasurerReview'
    ]).toBeDefined()
  })
})

describe('treasurerReviewLicenseDoc refuse flow', () => {
  it('refuse: resets to pending_parent_docs + clears coachValidatedAt/ByUid', async () => {
    const w = wire({ request: buildRequest() })
    const out = (await buildHandler().run({
      auth: { uid: 'tre-uid' },
      data: {
        requestId: 'r-1',
        kind: 'id_front',
        decision: 'refuse',
        refusalReason: 'Carte d identite expiree',
      },
    })) as { newStatus: string }
    expect(out.newStatus).toBe('pending_parent_docs')
    expect(w.capturedUpdate?.status).toBe('pending_parent_docs')
    expect(w.capturedUpdate?.coachValidatedAt).toBeNull()
    expect(w.capturedUpdate?.coachValidatedByUid).toBeNull()
  })
})

describe('treasurerReviewLicenseDoc preconditions', () => {
  it('accept: BYPASS COACH — accepté en parent_docs_submitted (sans validation coach)', async () => {
    // Cas d'usage : le trésorier valide un doc avant que le coach n'ait
    // fait sa review (coach absent, doc évident, urgence). Le status doit
    // rester `parent_docs_submitted` (pas de transition automatique).
    const w = wire({ request: buildRequest({ status: 'parent_docs_submitted' }) })
    const out = (await buildHandler().run({
      auth: { uid: 'tre-uid' },
      data: { requestId: 'r-1', kind: 'id_front', decision: 'accept' },
    })) as { newStatus: string; allTreasurerAccepted: boolean }
    expect(out.newStatus).toBe('parent_docs_submitted')
    expect(w.capturedUpdate?.status).toBeUndefined()
    const review = w.capturedUpdate?.[
      'uploadedDocs.id_front.treasurerReview'
    ] as { decision: string } | undefined
    expect(review?.decision).toBe('accepted')
  })

  it('accept: BYPASS COACH — accepté en pending_parent_docs (autres docs OK après un refus précédent)', async () => {
    // Cas d'usage : un refus antérieur a fait basculer en
    // `pending_parent_docs` mais d'autres docs uploadés peuvent rester
    // valides. Le trésorier doit pouvoir les valider dans la même session.
    const w = wire({
      request: buildRequest({
        status: 'pending_parent_docs',
        coachValidatedAt: null,
        coachValidatedByUid: null,
      }),
    })
    const out = (await buildHandler().run({
      auth: { uid: 'tre-uid' },
      data: { requestId: 'r-1', kind: 'id_front', decision: 'accept' },
    })) as { newStatus: string }
    expect(out.newStatus).toBe('pending_parent_docs')
    expect(w.capturedUpdate?.status).toBeUndefined()
  })

  it('accept: throws failed-precondition for statuses outside the allowed set', async () => {
    // `awaiting_parent_signature` est une étape trésorier interne — pas une
    // étape de review per-doc. La callable doit refuser.
    wire({ request: buildRequest({ status: 'awaiting_parent_signature' }) })
    await expect(
      buildHandler().run({
        auth: { uid: 'tre-uid' },
        data: { requestId: 'r-1', kind: 'id_front', decision: 'accept' },
      }),
    ).rejects.toThrow(/cannot accept in status 'awaiting_parent_signature'/)
  })

  it('refuse: ENCHAÎNEMENT — accepté aussi en pending_parent_docs (refus consécutifs)', async () => {
    // Cas d'usage : le trésorier refuse `id_front`, status bascule en
    // `pending_parent_docs`, puis il veut refuser aussi `id_back` dans la
    // même session. La callable doit accepter ce 2e refus.
    const w = wire({
      request: buildRequest({
        status: 'pending_parent_docs',
        coachValidatedAt: null,
        coachValidatedByUid: null,
      }),
    })
    const out = (await buildHandler().run({
      auth: { uid: 'tre-uid' },
      data: {
        requestId: 'r-1',
        kind: 'id_back',
        decision: 'refuse',
        refusalReason: 'Doc également invalide',
      },
    })) as { newStatus: string }
    expect(out.newStatus).toBe('pending_parent_docs')
    expect(w.capturedUpdate?.status).toBe('pending_parent_docs')
    const review = w.capturedUpdate?.[
      'uploadedDocs.id_back.treasurerReview'
    ] as { decision: string; refusalReason: string } | undefined
    expect(review?.decision).toBe('refused')
    expect(review?.refusalReason).toBe('Doc également invalide')
  })

  it('refuse: throws failed-precondition for statuses outside {coach_validated, pending_parent_docs}', async () => {
    wire({ request: buildRequest({ status: 'parent_docs_submitted' }) })
    await expect(
      buildHandler().run({
        auth: { uid: 'tre-uid' },
        data: {
          requestId: 'r-1',
          kind: 'id_front',
          decision: 'refuse',
          refusalReason: 'Refus tardif',
        },
      }),
    ).rejects.toThrow(/cannot refuse in status 'parent_docs_submitted'/)
  })
})
