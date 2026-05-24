/**
 * Tests pour `acceptReplacement` — transfert atomique d'une assignation
 * officiel suite à acceptation d'une demande de remplacement.
 *
 * Couvre :
 *  - unauthenticated quand pas d'auth
 *  - not-found quand la demande n'existe pas
 *  - permission-denied quand le caller n'est pas la cible
 *  - failed-precondition quand la demande n'est pas pending
 *  - happy path HOME : update request + decline original + create new assign
 *  - happy path AWAY : idem mais sur `/matches/.../officialAssignments`
 *  - invalid-argument quand requestId manquant
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
  runTransaction: vi.fn(),
}

vi.mock('../dues/_helpers', async () => {
  const actual =
    await vi.importActual<typeof import('../dues/_helpers')>('../dues/_helpers')
  return {
    ...actual,
    db: () => fakeDb,
    serverTimestamp: () => '__SERVER_TS__',
  }
})

interface AnyCallableHandler {
  run: (req: {
    auth?: { uid: string; token?: Record<string, unknown> } | null
    data: DocData
  }) => Promise<unknown>
}

let mod: typeof import('./replacement')

function buildHandler(): AnyCallableHandler {
  return mod.acceptReplacement as unknown as AnyCallableHandler
}

interface WireOpts {
  /** Doc `/users/{callerUid}` — `null` = inexistant. Default existe avec memberId 'm-target'. */
  user?: DocData | null
  /** Doc `/replacementRequests/{requestId}` — `null` = inexistant. */
  request?: DocData | null
  /** Doc d'assignation d'origine — `null` = inexistant. */
  originalAssignment?: DocData | null
}

interface WireResult {
  tx: FakeTx
  /** Captures writes pour assertion. */
  updates: Array<{ refPath: string; patch: DocData }>
  sets: Array<{ refPath: string; data: DocData }>
}

function wire(opts: WireOpts): WireResult {
  const userFixture =
    opts.user === undefined ? { memberId: 'm-target', roles: ['official'] } : opts.user
  const requestFixture = opts.request ?? null
  const originalFixture = opts.originalAssignment ?? null

  const updates: Array<{ refPath: string; patch: DocData }> = []
  const sets: Array<{ refPath: string; data: DocData }> = []

  fakeDb.doc = vi.fn((path: string): FakeDocRef => {
    const ref: FakeDocRef = { path, get: vi.fn() }
    if (path.startsWith('users/')) {
      ref.get = vi.fn().mockResolvedValue({
        exists: userFixture !== null,
        data: () => userFixture ?? undefined,
      })
    } else if (path.startsWith('replacementRequests/')) {
      ref.__kind = 'request-ref'
    } else if (
      path.includes('/officialAssignments/') &&
      requestFixture &&
      typeof requestFixture === 'object' &&
      'originalAssignmentId' in requestFixture &&
      path.endsWith(`/${(requestFixture as { originalAssignmentId: string }).originalAssignmentId}`)
    ) {
      ref.__kind = 'original-assign-ref'
    } else if (path.includes('/officialAssignments/')) {
      ref.__kind = 'new-assign-ref'
    }
    return ref
  })

  const tx: FakeTx = {
    get: vi.fn((target: FakeDocRef) => {
      if (target.__kind === 'request-ref') {
        return Promise.resolve({
          exists: requestFixture !== null,
          data: () => requestFixture ?? undefined,
        })
      }
      if (target.__kind === 'original-assign-ref') {
        return Promise.resolve({
          exists: originalFixture !== null,
          data: () => originalFixture ?? undefined,
        })
      }
      throw new Error(`unexpected tx.get target: ${JSON.stringify(target)}`)
    }),
    update: vi.fn<(ref: unknown, patch: DocData) => void>((ref, patch) => {
      updates.push({ refPath: (ref as FakeDocRef).path ?? '', patch })
    }),
    set: vi.fn<(ref: unknown, data: DocData) => void>((ref, data) => {
      sets.push({ refPath: (ref as FakeDocRef).path ?? '', data })
    }),
  }

  fakeDb.runTransaction = vi.fn((fn: (t: FakeTx) => Promise<unknown>) => fn(tx))

  return { tx, updates, sets }
}

/** Build d'une demande pending valide. */
function buildRequest(overrides: Partial<DocData> = {}): DocData {
  return {
    parentKind: 'home',
    parentId: 'booking-1',
    originalAssignmentId: 'm-requester',
    requesterMemberId: 'm-requester',
    requesterDisplayName: 'Alice R.',
    targetMemberId: 'm-target',
    targetDisplayName: 'Bob T.',
    matchDateMs: 1_700_000_000_000,
    matchStartTime: '19:00',
    matchEndTime: '20:30',
    matchTypeName: 'Championnat',
    matchOpponentName: 'Lions Genève',
    matchVenueLabel: 'Salle A · Court 1',
    officialLevel: 2,
    message: null,
    status: 'pending',
    createdAt: { seconds: 1_699_000_000, nanoseconds: 0 },
    respondedAt: null,
    declineReason: null,
    ...overrides,
  }
}

/** Build d'une assignation d'origine confirmée. */
function buildOriginalAssign(overrides: Partial<DocData> = {}): DocData {
  return {
    memberId: 'm-requester',
    officialLevel: 2,
    status: 'confirmed',
    assignedAt: { seconds: 1_698_500_000, nanoseconds: 0 },
    assignedBy: 'admin-uid',
    respondedAt: { seconds: 1_698_600_000, nanoseconds: 0 },
    ...overrides,
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  fakeDb.doc = vi.fn()
  fakeDb.runTransaction = vi.fn()
  mod = await import('./replacement')
})
afterEach(() => vi.restoreAllMocks())

describe('acceptReplacement — auth & input', () => {
  it('throws unauthenticated when no auth', async () => {
    wire({ request: buildRequest(), originalAssignment: buildOriginalAssign() })
    await expect(
      buildHandler().run({ auth: null, data: { requestId: 'r-1' } }),
    ).rejects.toThrow(/Must be signed in/)
  })

  it('throws invalid-argument when requestId missing', async () => {
    wire({ request: buildRequest(), originalAssignment: buildOriginalAssign() })
    await expect(
      buildHandler().run({ auth: { uid: 'target-uid' }, data: {} }),
    ).rejects.toThrow(/requestId is required/)
  })

  it('throws permission-denied when user doc missing', async () => {
    wire({ user: null, request: buildRequest(), originalAssignment: buildOriginalAssign() })
    await expect(
      buildHandler().run({ auth: { uid: 'target-uid' }, data: { requestId: 'r-1' } }),
    ).rejects.toThrow(/no \/users\/\{uid\} doc/)
  })

  it('throws permission-denied when caller is not linked to any member', async () => {
    wire({
      user: { memberId: null, roles: [] },
      request: buildRequest(),
      originalAssignment: buildOriginalAssign(),
    })
    await expect(
      buildHandler().run({ auth: { uid: 'target-uid' }, data: { requestId: 'r-1' } }),
    ).rejects.toThrow(/not linked to any member/)
  })
})

describe('acceptReplacement — preconditions', () => {
  it('throws not-found when request does not exist', async () => {
    wire({ request: null })
    await expect(
      buildHandler().run({ auth: { uid: 'target-uid' }, data: { requestId: 'r-missing' } }),
    ).rejects.toThrow(/not found/)
  })

  it('throws permission-denied when caller is not the target', async () => {
    wire({
      user: { memberId: 'm-someone-else' },
      request: buildRequest(), // target = m-target
      originalAssignment: buildOriginalAssign(),
    })
    await expect(
      buildHandler().run({ auth: { uid: 'other-uid' }, data: { requestId: 'r-1' } }),
    ).rejects.toThrow(/not the target/)
  })

  it('throws failed-precondition when status is not pending (accepted)', async () => {
    wire({
      request: buildRequest({ status: 'accepted' }),
      originalAssignment: buildOriginalAssign(),
    })
    await expect(
      buildHandler().run({ auth: { uid: 'target-uid' }, data: { requestId: 'r-1' } }),
    ).rejects.toThrow(/cannot accept in status 'accepted'/)
  })

  it('throws failed-precondition when status is declined', async () => {
    wire({
      request: buildRequest({ status: 'declined' }),
      originalAssignment: buildOriginalAssign(),
    })
    await expect(
      buildHandler().run({ auth: { uid: 'target-uid' }, data: { requestId: 'r-1' } }),
    ).rejects.toThrow(/'declined'/)
  })

  it('throws not-found when original assignment is missing', async () => {
    wire({
      request: buildRequest(),
      originalAssignment: null,
    })
    await expect(
      buildHandler().run({ auth: { uid: 'target-uid' }, data: { requestId: 'r-1' } }),
    ).rejects.toThrow(/original assignment .* not found/)
  })
})

describe('acceptReplacement — happy path HOME', () => {
  it('transfers the assignment: marks request accepted, declines original, creates new', async () => {
    const w = wire({
      request: buildRequest(),
      originalAssignment: buildOriginalAssign(),
    })
    const out = (await buildHandler().run({
      auth: { uid: 'target-uid' },
      data: { requestId: 'r-1' },
    })) as { ok: true; newAssignmentId: string }

    expect(out.ok).toBe(true)
    expect(out.newAssignmentId).toBe('m-target')

    // 2 updates : request.accepted + original.declined
    expect(w.updates).toHaveLength(2)
    const reqUpdate = w.updates.find((u) => u.refPath.startsWith('replacementRequests/'))
    expect(reqUpdate?.patch.status).toBe('accepted')
    expect(reqUpdate?.patch.respondedAt).toBeDefined()

    const originalUpdate = w.updates.find(
      (u) => u.refPath === 'bookings/booking-1/officialAssignments/m-requester',
    )
    expect(originalUpdate?.patch.status).toBe('declined')
    expect(originalUpdate?.patch.respondedAt).toBeDefined()

    // 1 set : nouvelle assignation pour la cible
    expect(w.sets).toHaveLength(1)
    const newAssign = w.sets[0]!
    expect(newAssign.refPath).toBe('bookings/booking-1/officialAssignments/m-target')
    expect(newAssign.data.memberId).toBe('m-target')
    expect(newAssign.data.officialLevel).toBe(2)
    expect(newAssign.data.status).toBe('confirmed')
    expect(newAssign.data.assignedBy).toBe('m-target')
  })
})

describe('acceptReplacement — happy path AWAY', () => {
  it('writes on /matches/{}/officialAssignments when parentKind is away', async () => {
    const w = wire({
      request: buildRequest({ parentKind: 'away', parentId: 'match-99' }),
      originalAssignment: buildOriginalAssign(),
    })
    await buildHandler().run({
      auth: { uid: 'target-uid' },
      data: { requestId: 'r-1' },
    })

    const originalUpdate = w.updates.find(
      (u) => u.refPath === 'matches/match-99/officialAssignments/m-requester',
    )
    expect(originalUpdate).toBeDefined()
    expect(originalUpdate?.patch.status).toBe('declined')

    expect(w.sets[0]!.refPath).toBe('matches/match-99/officialAssignments/m-target')
  })
})

describe('acceptReplacement — preserves officialLevel from original', () => {
  it('snapshots the original officialLevel on the new assignment', async () => {
    const w = wire({
      request: buildRequest({ officialLevel: 99 }), // value sur la request
      originalAssignment: buildOriginalAssign({ officialLevel: 4 }), // value source
    })
    await buildHandler().run({
      auth: { uid: 'target-uid' },
      data: { requestId: 'r-1' },
    })
    // On préfère la value de l'assignation source — c'est elle qui fait foi.
    expect(w.sets[0]!.data.officialLevel).toBe(4)
  })
})
