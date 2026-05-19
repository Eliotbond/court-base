/**
 * Tests pour `confirmLicense` — callable de confirmation d'une licence
 * fédérale `/licenses/{id}`.
 *
 * Couvre :
 *   - auth refusée pour un caller sans rôle ;
 *   - confirmation nominale d'une licence `official` → status `active` +
 *     écriture comptable postée (partie double équilibrée) + member.officialLicense ;
 *   - rôle `coach` → member.coachLicense ;
 *   - idempotence : licence déjà `active` → pas de double écriture ;
 *   - statut `cancelled` → `failed-precondition`.
 *
 * On mock `../dues/_helpers` pour éviter Firestore réel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Doc data générique posée par `tx.set` / `tx.update`. */
type DocData = Record<string, unknown>
/** Ligne d'écriture comptable telle que postée par la callable. */
interface EntryLine {
  accountId: string
  debit: number
  credit: number
}

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

let mod: typeof import('./confirmLicense')

function buildHandler(): AnyCallableHandler {
  return mod.confirmLicense as unknown as AnyCallableHandler
}

/** Plan comptable minimal seedé (charge + trésorerie). */
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
  userExists?: boolean
  license?: DocData | null
  member?: DocData | null
  accounts?: DocData[]
}

/**
 * Programme `fakeDb` : user fetch hors-tx, puis tx avec license / member /
 * accounts. Retourne le `tx` capturé pour les assertions.
 */
function wire(opts: WireOpts): { tx: FakeTx } {
  const roles = opts.roles ?? ['admin']
  const userExists = opts.userExists ?? true
  const accounts = opts.accounts ?? DEFAULT_ACCOUNTS

  fakeDb.doc = vi.fn((path: string): FakeDocRef => {
    const ref: FakeDocRef = { path, get: vi.fn() }
    if (path.startsWith('users/')) {
      ref.get = vi.fn().mockResolvedValue({
        exists: userExists,
        data: () => ({ roles, email: 'caller@x.ch' }),
      })
    } else if (path.startsWith('licenses/')) {
      ref.__kind = 'license-ref'
    } else if (path.startsWith('members/')) {
      ref.__kind = 'member-ref'
    }
    return ref
  })

  fakeDb.collection = vi.fn((name: string): unknown => {
    if (name === 'accounts') return { __kind: 'accounts-coll' }
    if (name === 'accountingEntries') {
      return { doc: () => ({ id: 'entry-generated-1' }) }
    }
    throw new Error(`unexpected collection: ${name}`)
  })

  const tx: FakeTx = {
    get: vi.fn((target: { __kind?: string }) => {
      const kind = target.__kind
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
    update: vi.fn<(ref: unknown, patch: DocData) => void>(),
    set: vi.fn<(ref: unknown, data: DocData) => void>(),
  }

  fakeDb.runTransaction = vi.fn((fn: (t: FakeTx) => Promise<unknown>) => fn(tx))

  return { tx }
}

/** Récupère le `patch` du premier `tx.update` satisfaisant `predicate`. */
function findUpdate(tx: FakeTx, predicate: (patch: DocData) => boolean): DocData | undefined {
  const call = tx.update.mock.calls.find((c) => predicate(c[1]))
  return call?.[1]
}

beforeEach(async () => {
  vi.clearAllMocks()
  fakeDb.doc = vi.fn()
  fakeDb.collection = vi.fn()
  fakeDb.runTransaction = vi.fn()
  mod = await import('./confirmLicense')
})
afterEach(() => vi.restoreAllMocks())

describe('confirmLicense auth', () => {
  it('throws unauthenticated when no auth', async () => {
    wire({})
    await expect(
      buildHandler().run({ auth: null, data: { licenseId: 'lic-1' } }),
    ).rejects.toThrow(/Must be signed in/)
  })

  it('throws permission-denied when caller has no eligible role', async () => {
    wire({ roles: ['coach'] })
    await expect(
      buildHandler().run({
        auth: { uid: 'caller-uid' },
        data: { licenseId: 'lic-1' },
      }),
    ).rejects.toThrow(/rootAdmin, admin, treasurer or secretary/)
  })

  it('accepts secretary role', async () => {
    const { tx } = wire({
      roles: ['secretary'],
      license: {
        memberId: 'm-1',
        seasonId: 's-1',
        role: 'official',
        level: 2,
        licenseName: 'Officiel N2',
        feeSnapshot: 80,
        status: 'pending',
      },
      member: { firstName: 'Ann', lastName: 'Doe' },
    })
    const out = (await buildHandler().run({
      auth: { uid: 'caller-uid' },
      data: { licenseId: 'lic-1' },
    })) as { ok: boolean }
    expect(out.ok).toBe(true)
    expect(tx.set).toHaveBeenCalledOnce()
  })
})

describe('confirmLicense nominal — official', () => {
  it('confirms an official license: status active, posts entry, sets member.officialLicense', async () => {
    const { tx } = wire({
      roles: ['treasurer'],
      license: {
        memberId: 'm-1',
        seasonId: 'season-2025',
        role: 'official',
        level: 3,
        licenseName: 'Officiel N3',
        feeSnapshot: 120,
        status: 'pending',
      },
      member: { firstName: 'Jean', lastName: 'Dupont' },
    })

    const out = (await buildHandler().run({
      auth: { uid: 'treasurer-uid' },
      data: { licenseId: 'lic-1' },
    })) as { ok: boolean; alreadyActive: boolean; accountingEntryId: string | null }

    expect(out.ok).toBe(true)
    expect(out.alreadyActive).toBe(false)
    expect(out.accountingEntryId).toBe('entry-generated-1')

    // Écriture comptable : partie double équilibrée, débit charge / crédit banque.
    const entryArgs = tx.set.mock.calls[0][1]
    expect(entryArgs.source).toBe('manual')
    expect(entryArgs.label).toBe('Licence Officiel N3 — Jean Dupont')
    expect(entryArgs.createdBy).toBe('treasurer-uid')
    const lines = entryArgs.lines as EntryLine[]
    expect(lines).toHaveLength(2)
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0)
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0)
    expect(totalDebit).toBe(120)
    expect(totalCredit).toBe(120)
    const debitLine = lines.find((l) => l.debit > 0)
    const creditLine = lines.find((l) => l.credit > 0)
    expect(debitLine?.accountId).toBe('acc-licenses')
    expect(creditLine?.accountId).toBe('acc-bank')

    // Update licence : status active + champs de confirmation.
    const licenseUpdate = findUpdate(tx, (p) => p.status === 'active')
    expect(licenseUpdate).toBeDefined()
    expect(licenseUpdate?.confirmedByUid).toBe('treasurer-uid')
    expect(licenseUpdate?.accountingEntryId).toBe('entry-generated-1')

    // Update membre : officialLicense posé.
    const memberUpdate = findUpdate(tx, (p) => p.officialLicense !== undefined)
    expect(memberUpdate).toBeDefined()
    expect(memberUpdate?.officialLicense).toEqual({
      licenseId: 'lic-1',
      seasonId: 'season-2025',
      level: 3,
    })
  })
})

describe('confirmLicense nominal — coach', () => {
  it('sets member.coachLicense for a coach role license', async () => {
    const { tx } = wire({
      roles: ['admin'],
      license: {
        memberId: 'm-2',
        seasonId: 'season-2025',
        role: 'coach',
        level: 1,
        licenseName: 'Coach Niveau 1',
        feeSnapshot: 60,
        status: 'pending',
      },
      member: { firstName: 'Marie', lastName: 'Martin' },
    })

    await buildHandler().run({
      auth: { uid: 'admin-uid' },
      data: { licenseId: 'lic-coach' },
    })

    const coachUpdate = findUpdate(tx, (p) => p.coachLicense !== undefined)
    expect(coachUpdate).toBeDefined()
    expect(coachUpdate?.coachLicense).toEqual({
      licenseId: 'lic-coach',
      seasonId: 'season-2025',
      level: 1,
    })
    // Pas de officialLicense posé.
    expect(findUpdate(tx, (p) => p.officialLicense !== undefined)).toBeUndefined()
  })
})

describe('confirmLicense idempotence', () => {
  it('returns alreadyActive without posting any entry when license is already active', async () => {
    const { tx } = wire({
      roles: ['admin'],
      license: {
        memberId: 'm-1',
        seasonId: 's-1',
        role: 'official',
        level: 2,
        licenseName: 'Officiel N2',
        feeSnapshot: 80,
        status: 'active',
      },
      member: { firstName: 'A', lastName: 'B' },
    })

    const out = (await buildHandler().run({
      auth: { uid: 'admin-uid' },
      data: { licenseId: 'lic-1' },
    })) as { ok: boolean; alreadyActive: boolean; accountingEntryId: string | null }

    expect(out.ok).toBe(true)
    expect(out.alreadyActive).toBe(true)
    expect(out.accountingEntryId).toBeNull()
    expect(tx.set).not.toHaveBeenCalled()
    expect(tx.update).not.toHaveBeenCalled()
  })
})

describe('confirmLicense preconditions', () => {
  it('throws failed-precondition when license is cancelled', async () => {
    wire({
      roles: ['admin'],
      license: {
        memberId: 'm-1',
        seasonId: 's-1',
        role: 'official',
        level: 2,
        licenseName: 'Officiel N2',
        feeSnapshot: 80,
        status: 'cancelled',
      },
      member: { firstName: 'A', lastName: 'B' },
    })

    await expect(
      buildHandler().run({
        auth: { uid: 'admin-uid' },
        data: { licenseId: 'lic-1' },
      }),
    ).rejects.toThrow(/must be 'pending'/)
  })

  it('throws not-found when license does not exist', async () => {
    wire({ roles: ['admin'], license: null })
    await expect(
      buildHandler().run({
        auth: { uid: 'admin-uid' },
        data: { licenseId: 'missing' },
      }),
    ).rejects.toThrow(/not found/)
  })

  it('throws failed-precondition when accounting plan is not seeded', async () => {
    wire({
      roles: ['admin'],
      accounts: [],
      license: {
        memberId: 'm-1',
        seasonId: 's-1',
        role: 'official',
        level: 2,
        licenseName: 'Officiel N2',
        feeSnapshot: 80,
        status: 'pending',
      },
      member: { firstName: 'A', lastName: 'B' },
    })
    await expect(
      buildHandler().run({
        auth: { uid: 'admin-uid' },
        data: { licenseId: 'lic-1' },
      }),
    ).rejects.toThrow(/Comptes comptables non initialisés/)
  })
})
