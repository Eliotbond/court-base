/**
 * Tests pour `setMemberLicensePhoto`. Mock Firestore + Storage minimaux,
 * focus sur :
 *  - unauthenticated si pas d'auth
 *  - invalid-argument : memberId/storagePath manquant, contentType invalide,
 *    sizeBytes > 5 Mo, storagePath hors `members/{memberId}/`
 *  - permission-denied : coach hors scope, scope coach OK passe
 *  - failed-precondition : fichier Storage absent
 *  - not-found : member doc inexistant
 *  - happy path : pose les 3 champs + best-effort delete de l'ancien path
 *    quand différent ; pas de delete si même path (replace au même nom).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeDocSnap {
  exists: boolean
  data: () => Record<string, unknown> | undefined
}

interface FakeQuerySnap {
  docs: { id: string }[]
}

// Store partagé pour les docs.
const fakeStore = new Map<string, Record<string, unknown> | null>()
// Index pour les `where` queries : key -> ids.
const fakeQueryIndex = new Map<string, string[]>()
// Mock Storage : map path -> exists boolean.
const fakeStorageExists = new Map<string, boolean>()
// Audit des deletes Storage demandés.
let storageDeleteCalls: string[] = []
// Audit des updates Firestore demandés.
let firestoreUpdates: Array<{ path: string; patch: Record<string, unknown> }> = []

function makeDocRef(path: string) {
  return {
    path,
    get: vi.fn(async (): Promise<FakeDocSnap> => {
      const data = fakeStore.get(path)
      return { exists: data != null, data: () => data ?? undefined }
    }),
    update: vi.fn(async (patch: Record<string, unknown>) => {
      firestoreUpdates.push({ path, patch })
      const existing = fakeStore.get(path) ?? {}
      fakeStore.set(path, { ...existing, ...patch })
    }),
  }
}

function makeCollectionRef(path: string) {
  return {
    where: vi.fn((field: string, op: string, value: unknown) => ({
      get: vi.fn(async (): Promise<FakeQuerySnap> => {
        const key = `${path}|${field}|${op}|${String(value)}`
        return { docs: (fakeQueryIndex.get(key) ?? []).map((id) => ({ id })) }
      }),
    })),
  }
}

const fakeDb = {
  doc: vi.fn((path: string) => makeDocRef(path)),
  collection: vi.fn((path: string) => makeCollectionRef(path)),
  runTransaction: vi.fn(),
}

vi.mock('../registrations/_helpers', () => ({
  db: () => fakeDb,
  serverTimestamp: () => '__SERVER_TS__',
  Timestamp: {
    now: () => ({ seconds: 1_700_000_000, nanoseconds: 0 }),
    fromMillis: (ms: number) => ({ seconds: Math.floor(ms / 1000), nanoseconds: 0 }),
  },
}))

// Mock Storage Admin SDK
vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      file: (path: string) => ({
        exists: vi.fn(async (): Promise<[boolean]> => [
          fakeStorageExists.get(path) ?? false,
        ]),
        delete: vi.fn(async (): Promise<void> => {
          storageDeleteCalls.push(path)
          fakeStorageExists.set(path, false)
        }),
      }),
    }),
  }),
}))

interface CallableHandler {
  run: (req: {
    auth?: { uid: string; token?: { rootAdmin?: boolean } } | null
    data: Record<string, unknown>
  }) => Promise<unknown>
}

let mod: typeof import('./setMemberLicensePhoto')

interface SetupOpts {
  callerRoles?: string[]
  callerTeamIds?: string[]
  callerExists?: boolean
  memberExists?: boolean
  member?: Record<string, unknown>
  memberTeamIds?: string[]
  /** Map path -> bool pour pré-peupler les fichiers présents dans le bucket. */
  storage?: Record<string, boolean>
}

function setupFixture(opts: SetupOpts): void {
  fakeStore.clear()
  fakeQueryIndex.clear()
  fakeStorageExists.clear()
  storageDeleteCalls = []
  firestoreUpdates = []

  if (opts.callerExists !== false) {
    fakeStore.set('users/caller-uid', {
      roles: opts.callerRoles ?? ['coach'],
      teamIds: opts.callerTeamIds ?? [],
    })
  }

  if (opts.memberExists !== false) {
    fakeStore.set('members/m-1', {
      firstName: 'Alice',
      lastName: 'Martin',
      status: 'active',
      active: true,
      photoStoragePath: null,
      photoUpdatedAt: null,
      photoUpdatedByUid: null,
      ...(opts.member ?? {}),
    })
  }

  fakeQueryIndex.set(
    'teams|playerIds|array-contains|m-1',
    opts.memberTeamIds ?? [],
  )

  if (opts.storage) {
    for (const [k, v] of Object.entries(opts.storage)) {
      fakeStorageExists.set(k, v)
    }
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  fakeDb.doc = vi.fn((path: string) => makeDocRef(path))
  fakeDb.collection = vi.fn((path: string) => makeCollectionRef(path))
  mod = await import('./setMemberLicensePhoto')
})
afterEach(() => vi.restoreAllMocks())

async function callSet(args: {
  auth?: { uid: string; token?: { rootAdmin?: boolean } } | null
  data: Record<string, unknown>
}): Promise<{ ok: boolean; out?: unknown; error?: { code: string; message: string } }> {
  const handler = mod.setMemberLicensePhoto as unknown as CallableHandler
  try {
    const out = await handler.run(args)
    return { ok: true, out }
  } catch (err) {
    const e = err as { code?: string; message?: string }
    return {
      ok: false,
      error: { code: e.code ?? 'unknown', message: e.message ?? '' },
    }
  }
}

const VALID_INPUT = {
  memberId: 'm-1',
  storagePath: 'members/m-1/license-photo.jpg',
  contentType: 'image/jpeg',
  sizeBytes: 200_000,
}

describe('setMemberLicensePhoto — guards', () => {
  it('throws unauthenticated when not signed-in', async () => {
    setupFixture({})
    const res = await callSet({ auth: null, data: VALID_INPUT })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('unauthenticated')
  })

  it('throws invalid-argument when memberId is missing', async () => {
    setupFixture({})
    const res = await callSet({
      auth: { uid: 'caller-uid' },
      data: { ...VALID_INPUT, memberId: undefined },
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('invalid-argument')
  })

  it('throws invalid-argument for an unsupported contentType', async () => {
    setupFixture({ callerRoles: ['admin'] })
    const res = await callSet({
      auth: { uid: 'caller-uid' },
      data: { ...VALID_INPUT, contentType: 'image/gif' },
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('invalid-argument')
  })

  it('throws invalid-argument when sizeBytes exceeds 5 MB', async () => {
    setupFixture({ callerRoles: ['admin'] })
    const res = await callSet({
      auth: { uid: 'caller-uid' },
      data: { ...VALID_INPUT, sizeBytes: 6 * 1024 * 1024 },
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('invalid-argument')
  })

  it('throws invalid-argument when storagePath escapes members/{id}/', async () => {
    setupFixture({ callerRoles: ['admin'] })
    const res = await callSet({
      auth: { uid: 'caller-uid' },
      data: { ...VALID_INPUT, storagePath: 'members/other-id/license-photo.jpg' },
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('invalid-argument')
  })

  it('throws permission-denied for a coach not scoping the member', async () => {
    setupFixture({
      callerRoles: ['coach'],
      callerTeamIds: ['t-other'],
      memberTeamIds: ['t-1'],
      storage: { 'members/m-1/license-photo.jpg': true },
    })
    const res = await callSet({
      auth: { uid: 'caller-uid' },
      data: VALID_INPUT,
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('permission-denied')
  })

  it('throws failed-precondition when no file exists at storagePath', async () => {
    setupFixture({
      callerRoles: ['admin'],
      // pas de storage fixture → exists() = false
    })
    const res = await callSet({
      auth: { uid: 'caller-uid' },
      data: VALID_INPUT,
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('failed-precondition')
  })

  it('throws not-found when member does not exist', async () => {
    setupFixture({
      callerRoles: ['admin'],
      memberExists: false,
      storage: { 'members/m-1/license-photo.jpg': true },
    })
    const res = await callSet({
      auth: { uid: 'caller-uid' },
      data: VALID_INPUT,
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('not-found')
  })
})

describe('setMemberLicensePhoto — happy paths', () => {
  it('coach in scope: poses photoStoragePath + audit fields', async () => {
    setupFixture({
      callerRoles: ['coach'],
      callerTeamIds: ['t-1'],
      memberTeamIds: ['t-1'],
      storage: { 'members/m-1/license-photo.jpg': true },
    })
    const res = await callSet({
      auth: { uid: 'caller-uid' },
      data: VALID_INPUT,
    })
    expect(res.ok).toBe(true)
    expect(res.out).toEqual({
      ok: true,
      memberId: 'm-1',
      photoStoragePath: 'members/m-1/license-photo.jpg',
    })
    const update = firestoreUpdates.find((u) => u.path === 'members/m-1')
    expect(update).toBeDefined()
    expect(update?.patch.photoStoragePath).toBe('members/m-1/license-photo.jpg')
    expect(update?.patch.photoUpdatedByUid).toBe('caller-uid')
    expect(update?.patch.photoUpdatedAt).toBeDefined()
  })

  it('replaces old file: deletes old Storage object when path differs', async () => {
    setupFixture({
      callerRoles: ['admin'],
      member: {
        photoStoragePath: 'members/m-1/license-photo.png',
      },
      storage: {
        'members/m-1/license-photo.jpg': true, // nouveau path
        'members/m-1/license-photo.png': true, // ancien path encore présent
      },
    })
    const res = await callSet({
      auth: { uid: 'caller-uid' },
      data: VALID_INPUT,
    })
    expect(res.ok).toBe(true)
    expect(storageDeleteCalls).toContain('members/m-1/license-photo.png')
  })

  it('does NOT delete old file when storagePath is unchanged', async () => {
    setupFixture({
      callerRoles: ['admin'],
      member: {
        photoStoragePath: 'members/m-1/license-photo.jpg',
      },
      storage: { 'members/m-1/license-photo.jpg': true },
    })
    const res = await callSet({
      auth: { uid: 'caller-uid' },
      data: VALID_INPUT,
    })
    expect(res.ok).toBe(true)
    // Pas de delete — même path.
    expect(storageDeleteCalls).toHaveLength(0)
  })

  it('admin role bypasses team scope', async () => {
    setupFixture({
      callerRoles: ['admin'],
      callerTeamIds: [],
      memberTeamIds: ['t-99'],
      storage: { 'members/m-1/license-photo.jpg': true },
    })
    const res = await callSet({
      auth: { uid: 'caller-uid' },
      data: VALID_INPUT,
    })
    expect(res.ok).toBe(true)
  })

  it('rootAdmin claim bypasses team scope', async () => {
    setupFixture({
      callerRoles: ['coach'],
      callerTeamIds: ['t-other'],
      memberTeamIds: ['t-1'],
      storage: { 'members/m-1/license-photo.jpg': true },
    })
    const res = await callSet({
      auth: { uid: 'caller-uid', token: { rootAdmin: true } },
      data: VALID_INPUT,
    })
    expect(res.ok).toBe(true)
  })
})
