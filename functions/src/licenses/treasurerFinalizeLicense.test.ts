/**
 * Tests pour `treasurerFinalizeLicense` — étape terminale phase trésorier
 * (sent_paid → approved + chaîne confirmLicenseCore : license active +
 * écriture compta + denorm membre + member.licensed=true + member.licenseNumber).
 *
 * Couvre :
 *  - auth (unauth / non-treasurer / rootAdmin) ;
 *  - validations input (licenseNumber non-vide, ≤ 50 chars) ;
 *  - happy path : license active + entry compta + member.licensed=true ;
 *  - pré-conditions (status non sent_paid, linkedLicenseId null) ;
 *  - idempotence (status approved + license active).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type DocData = Record<string, unknown>

interface FakeDocRef {
  id?: string
  path?: string
  __kind?: string
  __id?: string
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

let mod: typeof import('./treasurerFinalizeLicense')

function buildHandler(): AnyCallableHandler {
  return mod.treasurerFinalizeLicense as unknown as AnyCallableHandler
}

const DEFAULT_ACCOUNTS: DocData[] = [
  {
    id: 'acc-bank',
    name: 'Banque',
    number: '1020',
    nature: 'actif',
    isTreasury: true,
    active: true,
    displayOrder: 10,
  },
  {
    id: 'acc-licenses',
    name: 'Licences fédérales',
    number: '4300',
    nature: 'charge',
    isTreasury: false,
    active: true,
    displayOrder: 80,
  },
]

interface WireOpts {
  roles?: string[]
  request?: DocData | null
  license?: DocData | null
  member?: DocData | null
  accounts?: DocData[]
}

interface Captured {
  licenseUpdate?: DocData
  memberLicensedUpdate?: DocData
  requestUpdate?: DocData
  entry?: DocData
  memberDenormUpdate?: DocData
}

function wire(opts: WireOpts): { tx: FakeTx; captured: Captured } {
  const roles = opts.roles ?? ['treasurer']
  const accounts = opts.accounts ?? DEFAULT_ACCOUNTS
  const captured: Captured = {}

  fakeDb.doc = vi.fn((path: string): FakeDocRef => {
    const ref: FakeDocRef = { path, get: vi.fn() }
    if (path.startsWith('users/')) {
      ref.get = vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ roles, email: 'caller@x.ch' }),
      })
    } else if (path.startsWith('licenseRequests/')) {
      ref.__kind = 'request-ref'
    } else if (path.startsWith('licenses/')) {
      ref.__kind = 'license-ref'
      ref.__id = path.split('/').pop()
      // For hors-tx final get (after the tx)
      ref.get = vi.fn().mockResolvedValue({
        exists: opts.license !== null && opts.license !== undefined,
        data: () => opts.license ?? undefined,
      })
    } else if (path.startsWith('members/')) {
      ref.__kind = 'member-ref'
    }
    return ref
  })

  fakeDb.collection = vi.fn((name: string): unknown => {
    if (name === 'accounts') return { __kind: 'accounts-coll' }
    if (name === 'accountingEntries') {
      return { doc: () => ({ id: 'entry-1', __kind: 'entry-ref' }) }
    }
    throw new Error(`unexpected collection: ${name}`)
  })

  const tx: FakeTx = {
    get: vi.fn((target: { __kind?: string }) => {
      const kind = target.__kind
      if (kind === 'request-ref') {
        return Promise.resolve({
          exists: opts.request !== null && opts.request !== undefined,
          data: () => opts.request ?? undefined,
        })
      }
      if (kind === 'license-ref') {
        return Promise.resolve({
          exists: opts.license !== null && opts.license !== undefined,
          data: () => opts.license ?? undefined,
        })
      }
      if (kind === 'member-ref') {
        return Promise.resolve({
          exists: opts.member !== null && opts.member !== undefined,
          data: () => opts.member ?? undefined,
        })
      }
      if (kind === 'accounts-coll') {
        return Promise.resolve({
          docs: accounts.map((a) => ({ id: a.id as string, data: () => a })),
        })
      }
      throw new Error(`unexpected tx.get target: ${JSON.stringify(target)}`)
    }),
    update: vi.fn<(ref: unknown, patch: DocData) => void>((ref: unknown, patch) => {
      const r = ref as { __kind?: string }
      if (r.__kind === 'license-ref') captured.licenseUpdate = patch
      else if (r.__kind === 'member-ref') {
        // First member update by confirmLicenseCore is denorm (officialLicense /
        // coachLicense). Subsequent update by treasurerFinalizeLicense sets
        // licensed + licenseNumber.
        if (patch.licensed !== undefined) captured.memberLicensedUpdate = patch
        else captured.memberDenormUpdate = patch
      }
      else if (r.__kind === 'request-ref') captured.requestUpdate = patch
    }),
    set: vi.fn<(ref: unknown, data: DocData) => void>((ref: unknown, data) => {
      const r = ref as { __kind?: string }
      if (r.__kind === 'entry-ref') captured.entry = data
    }),
  }

  fakeDb.runTransaction = vi.fn((fn: (t: FakeTx) => Promise<unknown>) => fn(tx))
  return { tx, captured }
}

function buildRequest(overrides: Partial<DocData> = {}): DocData {
  return {
    memberId: 'm-1',
    teamId: 'team-1',
    seasonId: 'season-2025',
    requestedBy: 'coach-uid',
    status: 'sent_paid',
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
    sentToFederationAt: { seconds: 1, nanoseconds: 0 },
    paidAt: { seconds: 1, nanoseconds: 0 },
    paymentProofStoragePath: null,
    paymentProofUploadedAt: null,
    licenseNumber: null,
    licenseFinalizedAt: null,
    licenseFinalizedByUid: null,
    linkedLicenseId: 'lic-pending-1',
    treasurerNotes: null,
    ...overrides,
  }
}

function buildLicense(overrides: Partial<DocData> = {}): DocData {
  return {
    memberId: 'm-1',
    seasonId: 'season-2025',
    licenseTypeId: 'lt-player-junior',
    role: 'player',
    level: null,
    licenseName: 'Joueur Junior',
    feeSnapshot: 80,
    status: 'pending',
    createdAt: { seconds: 1, nanoseconds: 0 },
    createdByUid: 'treas-uid',
    confirmedAt: null,
    confirmedByUid: null,
    accountingEntryId: null,
    requestId: 'r-1',
    requestedByUid: 'coach-uid',
    ...overrides,
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  fakeDb.doc = vi.fn()
  fakeDb.collection = vi.fn()
  fakeDb.runTransaction = vi.fn()
  mod = await import('./treasurerFinalizeLicense')
})
afterEach(() => vi.restoreAllMocks())

describe('treasurerFinalizeLicense auth', () => {
  it('throws unauthenticated when no auth', async () => {
    wire({ request: buildRequest(), license: buildLicense(), member: { firstName: 'A', lastName: 'B' } })
    await expect(
      buildHandler().run({
        auth: null,
        data: { requestId: 'r-1', licenseNumber: 'SB-12345' },
      }),
    ).rejects.toThrow(/Must be signed in/)
  })

  it('accepts admin role (now permissive auth)', async () => {
    const w = wire({
      roles: ['admin'],
      request: buildRequest(),
      license: buildLicense(),
      member: { firstName: 'A', lastName: 'B' },
    })
    const out = (await buildHandler().run({
      auth: { uid: 'a-uid' },
      data: { requestId: 'r-1', licenseNumber: 'SB-12345' },
    })) as { newStatus: string }
    expect(out.newStatus).toBe('approved')
    expect(w.captured.requestUpdate?.status).toBe('approved')
  })

  it('accepts secretary role (now permissive auth)', async () => {
    const w = wire({
      roles: ['secretary'],
      request: buildRequest(),
      license: buildLicense(),
      member: { firstName: 'A', lastName: 'B' },
    })
    const out = (await buildHandler().run({
      auth: { uid: 's-uid' },
      data: { requestId: 'r-1', licenseNumber: 'SB-12345' },
    })) as { newStatus: string }
    expect(out.newStatus).toBe('approved')
    expect(w.captured.requestUpdate?.status).toBe('approved')
  })

  it('rejects signed-in caller without admin/treasurer/secretary role', async () => {
    wire({
      roles: ['coach'],
      request: buildRequest(),
      license: buildLicense(),
      member: { firstName: 'A', lastName: 'B' },
    })
    await expect(
      buildHandler().run({
        auth: { uid: 'coach-uid' },
        data: { requestId: 'r-1', licenseNumber: 'SB-12345' },
      }),
    ).rejects.toThrow(/rootAdmin, admin, treasurer or secretary/)
  })
})

describe('treasurerFinalizeLicense validations', () => {
  it('rejects empty licenseNumber', async () => {
    wire({ request: buildRequest(), license: buildLicense(), member: { firstName: 'A', lastName: 'B' } })
    await expect(
      buildHandler().run({
        auth: { uid: 'treas-uid' },
        data: { requestId: 'r-1', licenseNumber: '   ' },
      }),
    ).rejects.toThrow(/must not be empty/)
  })

  it('rejects licenseNumber > 50 chars', async () => {
    wire({ request: buildRequest(), license: buildLicense(), member: { firstName: 'A', lastName: 'B' } })
    await expect(
      buildHandler().run({
        auth: { uid: 'treas-uid' },
        data: { requestId: 'r-1', licenseNumber: 'x'.repeat(51) },
      }),
    ).rejects.toThrow(/≤ 50 characters/)
  })
})

describe('treasurerFinalizeLicense happy path (player)', () => {
  it('finalizes : license active + entry + member.licensed=true + lr approved', async () => {
    const w = wire({
      request: buildRequest(),
      license: buildLicense(),
      member: { firstName: 'Léo', lastName: 'Martin' },
    })

    const out = (await buildHandler().run({
      auth: { uid: 'treas-uid' },
      data: { requestId: 'r-1', licenseNumber: ' SB-12345 ' },
    })) as { newStatus: string; licenseId: string; memberPatch: unknown }

    expect(out.newStatus).toBe('approved')
    expect(out.licenseId).toBe('lic-pending-1')

    // Écriture comptable postée par confirmLicenseCore (partie double).
    expect(w.captured.entry).toBeDefined()
    expect(w.captured.entry?.label).toBe('Licence Joueur Junior — Léo Martin')

    // License updated to active.
    expect(w.captured.licenseUpdate?.status).toBe('active')
    expect(w.captured.licenseUpdate?.confirmedByUid).toBe('treas-uid')

    // Player → pas de denorm officialLicense / coachLicense.
    expect(w.captured.memberDenormUpdate).toBeUndefined()

    // Member.licensed=true + licenseNumber posé par treasurerFinalizeLicense.
    expect(w.captured.memberLicensedUpdate?.licensed).toBe(true)
    expect(w.captured.memberLicensedUpdate?.licenseNumber).toBe('SB-12345')

    // LicenseRequest passe à approved.
    expect(w.captured.requestUpdate?.status).toBe('approved')
    expect(w.captured.requestUpdate?.licenseNumber).toBe('SB-12345')
    expect(w.captured.requestUpdate?.licenseFinalizedByUid).toBe('treas-uid')
  })

  it('player role → memberPatch is { memberId, field: "playerLicense" } placeholder', async () => {
    wire({
      request: buildRequest(),
      license: buildLicense({ role: 'player' }),
      member: { firstName: 'A', lastName: 'B' },
    })
    const out = (await buildHandler().run({
      auth: { uid: 'treas-uid' },
      data: { requestId: 'r-1', licenseNumber: 'SB-1' },
    })) as { memberPatch: { memberId: string; field: string } | null }
    expect(out.memberPatch).toEqual({ memberId: 'm-1', field: 'playerLicense' })
  })
})

describe('treasurerFinalizeLicense preconditions', () => {
  it('throws failed-precondition when status is not sent_paid', async () => {
    wire({
      request: buildRequest({ status: 'form_confirmed' }),
      license: buildLicense(),
      member: { firstName: 'A', lastName: 'B' },
    })
    await expect(
      buildHandler().run({
        auth: { uid: 'treas-uid' },
        data: { requestId: 'r-1', licenseNumber: 'SB-1' },
      }),
    ).rejects.toThrow(/must be 'sent_paid'/)
  })

  it('throws failed-precondition when linkedLicenseId is null', async () => {
    wire({
      request: buildRequest({ linkedLicenseId: null }),
      license: buildLicense(),
      member: { firstName: 'A', lastName: 'B' },
    })
    await expect(
      buildHandler().run({
        auth: { uid: 'treas-uid' },
        data: { requestId: 'r-1', licenseNumber: 'SB-1' },
      }),
    ).rejects.toThrow(/linkedLicenseId is null/)
  })
})

describe('treasurerFinalizeLicense idempotence', () => {
  it('approved + active license → no-op, returns same id', async () => {
    const w = wire({
      request: buildRequest({
        status: 'approved',
        linkedLicenseId: 'lic-pending-1',
        licenseNumber: 'SB-OLD',
      }),
      license: buildLicense({ status: 'active' }),
      member: { firstName: 'A', lastName: 'B' },
    })
    const out = (await buildHandler().run({
      auth: { uid: 'treas-uid' },
      data: { requestId: 'r-1', licenseNumber: 'SB-NEW' },
    })) as { newStatus: string; licenseId: string }
    expect(out.newStatus).toBe('approved')
    expect(out.licenseId).toBe('lic-pending-1')
    // No writes
    expect(w.tx.set).not.toHaveBeenCalled()
    expect(w.captured.requestUpdate).toBeUndefined()
    expect(w.captured.licenseUpdate).toBeUndefined()
    expect(w.captured.memberLicensedUpdate).toBeUndefined()
  })
})
