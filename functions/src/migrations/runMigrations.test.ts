/**
 * Unit tests for `runMigrations`.
 *
 * On mock un Firestore minimaliste (un `Map<docPath, data>`) et on bypass
 * l'enveloppe `onCall` en appelant `runMigrationsHandler` directement.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// -----------------------------------------------------------------------------
// Mocks — doivent être déclarés AVANT l'import du module sous test.
// -----------------------------------------------------------------------------

// Mock firebase-admin : seul `firestore.Timestamp.now` est utilisé par le code prod.
vi.mock('firebase-admin', () => {
  const TimestampStub = {
    now: () => ({ seconds: 1_700_000_000, nanoseconds: 0 }),
  }
  return {
    firestore: Object.assign(() => ({}), { Timestamp: TimestampStub }),
    // Pas utilisé par le handler mais le module se charge :
    initializeApp: vi.fn(),
    auth: vi.fn(),
  }
})

// FakeFirestore : un store en mémoire qui simule juste ce dont on a besoin :
// `.collection(name).doc(id).get()` et `.runTransaction(fn)`.
type DocPath = string
type DocData = Record<string, unknown>

class FakeFirestore {
  private store = new Map<DocPath, DocData>()

  seed(path: DocPath, data: DocData): void {
    this.store.set(path, { ...data })
  }

  read(path: DocPath): DocData | undefined {
    const d = this.store.get(path)
    return d ? { ...d } : undefined
  }

  collection(name: string): FakeCollection {
    return new FakeCollection(this, name)
  }

  async runTransaction<T>(
    fn: (tx: FakeTransaction) => Promise<T>,
  ): Promise<T> {
    // Pas de vrai retry/locking — suffisant pour les tests unit.
    return fn(new FakeTransaction(this))
  }

  _get(path: DocPath): { exists: boolean; data: DocData | undefined } {
    const d = this.store.get(path)
    return { exists: d !== undefined, data: d ? { ...d } : undefined }
  }

  _set(path: DocPath, data: DocData, opts?: { merge?: boolean }): void {
    if (opts?.merge && this.store.has(path)) {
      const prev = this.store.get(path) ?? {}
      this.store.set(path, { ...prev, ...data })
    } else {
      this.store.set(path, { ...data })
    }
  }
}

class FakeCollection {
  constructor(
    private fs: FakeFirestore,
    private name: string,
  ) {}
  doc(id: string): FakeDocRef {
    return new FakeDocRef(this.fs, `${this.name}/${id}`)
  }
}

class FakeDocRef {
  // path public lecture-seule pour la tx
  constructor(
    private fs: FakeFirestore,
    public readonly path: DocPath,
  ) {}
  async get(): Promise<FakeSnap> {
    const r = this.fs._get(this.path)
    return new FakeSnap(r.exists, r.data)
  }
}

class FakeSnap {
  constructor(
    public readonly exists: boolean,
    private _data: DocData | undefined,
  ) {}
  data(): DocData | undefined {
    return this._data ? { ...this._data } : undefined
  }
}

class FakeTransaction {
  constructor(private fs: FakeFirestore) {}
  async get(ref: FakeDocRef): Promise<FakeSnap> {
    return ref.get()
  }
  set(ref: FakeDocRef, data: DocData, opts?: { merge?: boolean }): void {
    this.fs._set(ref.path, data, opts)
  }
}

// Singleton partagé entre le module sous test et les assertions.
const fakeFs = new FakeFirestore()

// Mock `../shared/firestore` pour rendre `db()` → fakeFs.
vi.mock('../shared/firestore', () => ({
  db: () => fakeFs,
}))

// Mock `../shared/logger` : silencieux.
vi.mock('../shared/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// -----------------------------------------------------------------------------
// Imports du module sous test — APRÈS les mocks.
// -----------------------------------------------------------------------------
import { runMigrationsHandler } from './runMigrations'
import { latestVersion } from './registry'
import { HttpsError } from 'firebase-functions/v2/https'
import type { CallableRequest } from 'firebase-functions/v2/https'

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

interface FakeAuthInput {
  uid?: string
  rootAdmin?: boolean
  admin?: boolean
}

function makeRequest(
  data: { targetVersion?: number } = {},
  auth?: FakeAuthInput | null,
): CallableRequest<{ targetVersion?: number }> {
  const req = {
    data,
    rawRequest: {} as never,
    acceptsStreaming: false,
  } as Partial<CallableRequest<{ targetVersion?: number }>>
  if (auth === null) {
    return req as CallableRequest<{ targetVersion?: number }>
  }
  const a = auth ?? { uid: 'caller-uid', rootAdmin: true }
  ;(req as { auth?: unknown }).auth = {
    uid: a.uid ?? 'caller-uid',
    token: {
      ...(a.rootAdmin ? { rootAdmin: true } : {}),
      ...(a.admin ? { admin: true } : {}),
    },
  }
  return req as CallableRequest<{ targetVersion?: number }>
}

beforeEach(() => {
  // Reset the in-memory store between tests.
  // Recreate by clearing internal map via re-seeding.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(fakeFs as unknown as { store: Map<string, DocData> }).store = new Map()
})

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('runMigrations — auth', () => {
  it('rejects unauthenticated callers', async () => {
    await expect(runMigrationsHandler(makeRequest({}, null))).rejects.toBeInstanceOf(
      HttpsError,
    )
    await expect(runMigrationsHandler(makeRequest({}, null))).rejects.toMatchObject({
      code: 'unauthenticated',
    })
  })

  it('rejects authenticated callers without admin/rootAdmin claim or role', async () => {
    // No user doc seeded → roles[] empty.
    const req = makeRequest({}, { uid: 'random-user' })
    await expect(runMigrationsHandler(req)).rejects.toMatchObject({
      code: 'permission-denied',
    })
  })

  it('accepts caller with admin claim', async () => {
    const req = makeRequest({}, { uid: 'admin-user', admin: true })
    const result = await runMigrationsHandler(req)
    expect(result.to).toBe(latestVersion)
  })

  it('accepts caller with /users/{uid}.roles containing "admin"', async () => {
    fakeFs.seed('users/admin-via-role', { roles: ['admin'] })
    const req = makeRequest({}, { uid: 'admin-via-role' })
    const result = await runMigrationsHandler(req)
    expect(result.to).toBe(latestVersion)
  })
})

describe('runMigrations — fresh project', () => {
  it('applies migration_001 and bumps version to 1', async () => {
    const req = makeRequest({}, { uid: 'root-uid', rootAdmin: true })
    const result = await runMigrationsHandler(req)

    expect(result).toEqual({
      from: 0,
      to: 1,
      applied: [{ version: 1, name: '001_initial_schema' }],
    })

    const schema = fakeFs.read('_meta/schema')
    expect(schema).toBeDefined()
    expect(schema?.version).toBe(1)
    const log = schema?.migrationLog as Array<{
      version: number
      appliedBy: string
      notes: string
    }>
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({
      version: 1,
      appliedBy: 'root-uid',
      notes: '001_initial_schema',
    })
  })
})

describe('runMigrations — already up to date', () => {
  it('is a no-op when current === latestVersion', async () => {
    fakeFs.seed('_meta/schema', { version: latestVersion, migrationLog: [] })
    const req = makeRequest({}, { uid: 'root-uid', rootAdmin: true })
    const result = await runMigrationsHandler(req)
    expect(result).toEqual({ from: latestVersion, to: latestVersion, applied: [] })
  })
})

describe('runMigrations — targetVersion validation', () => {
  it('throws out-of-range if targetVersion > latestVersion', async () => {
    const req = makeRequest(
      { targetVersion: latestVersion + 99 },
      { uid: 'root-uid', rootAdmin: true },
    )
    await expect(runMigrationsHandler(req)).rejects.toMatchObject({
      code: 'out-of-range',
    })
  })

  it('throws invalid-argument if targetVersion is not a non-negative integer', async () => {
    const req = makeRequest(
      { targetVersion: -1 },
      { uid: 'root-uid', rootAdmin: true },
    )
    await expect(runMigrationsHandler(req)).rejects.toMatchObject({
      code: 'invalid-argument',
    })
  })

  it('throws failed-precondition if asked to migrate backward', async () => {
    fakeFs.seed('_meta/schema', { version: 1, migrationLog: [] })
    const req = makeRequest(
      { targetVersion: 0 },
      { uid: 'root-uid', rootAdmin: true },
    )
    await expect(runMigrationsHandler(req)).rejects.toMatchObject({
      code: 'failed-precondition',
    })
  })
})

describe('registry validation', () => {
  it('exposes a contiguous chain starting at 0', async () => {
    // Réimport dynamique pour observer la validation au load.
    const mod = await import('./registry')
    expect(mod.migrations.length).toBeGreaterThan(0)
    let expected = 0
    for (const m of mod.migrations) {
      expect(m.from).toBe(expected)
      expect(m.to).toBe(expected + 1)
      expected = m.to
    }
    expect(mod.latestVersion).toBe(expected)
  })

  it('rejects re-runs when current version mismatches plan after a migration step (race)', async () => {
    // Cas pathologique : la migration `run()` met `version` à autre chose
    // par accident → la transaction du runner doit échouer.
    // Ici on simule en seedant un schema doc avec un version inattendue avant
    // le commit : on appelle directement applyOneMigration via __internal.
    const { __internal } = await import('./runMigrations')
    fakeFs.seed('_meta/schema', { version: 5, migrationLog: [] })
    const fakeMigration = {
      from: 0,
      to: 1,
      name: 'bogus',
      async run(): Promise<void> {
        // intentionally no-op; the seeded version=5 must trigger the guard
      },
    }
    await expect(
      __internal.applyOneMigration(
        fakeFs as unknown as FirebaseFirestore.Firestore,
        fakeMigration,
        'tester',
      ),
    ).rejects.toMatchObject({ code: 'aborted' })
  })
})
