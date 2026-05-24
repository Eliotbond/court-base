/**
 * Tests pour `removeMemberLicensePhoto`. Mock Firestore + Storage minimaux,
 * focus sur :
 *  - unauthenticated si pas d'auth
 *  - permission-denied : coach refusé (admin-only), rootAdmin / admin OK
 *  - idempotence : member sans photo → no-op (renvoie ok sans écriture)
 *  - happy path admin : delete Storage + clear 3 champs Firestore
 *  - not-found si member inexistant
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeDocSnap {
  exists: boolean
  data: () => Record<string, unknown> | undefined
}

const fakeStore = new Map<string, Record<string, unknown> | null>()
const fakeStorageExists = new Map<string, boolean>()
let storageDeleteCalls: string[] = []
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

const fakeDb = {
  doc: vi.fn((path: string) => makeDocRef(path)),
  collection: vi.fn(),
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

let mod: typeof import('./removeMemberLicensePhoto')

interface SetupOpts {
  callerRoles?: string[]
  callerExists?: boolean
  memberExists?: boolean
  member?: Record<string, unknown>
  storage?: Record<string, boolean>
}

function setupFixture(opts: SetupOpts): void {
  fakeStore.clear()
  fakeStorageExists.clear()
  storageDeleteCalls = []
  firestoreUpdates = []

  if (opts.callerExists !== false) {
    fakeStore.set('users/caller-uid', {
      roles: opts.callerRoles ?? ['admin'],
      teamIds: [],
    })
  }

  if (opts.memberExists !== false) {
    fakeStore.set('members/m-1', {
      firstName: 'Alice',
      lastName: 'Martin',
      photoStoragePath: 'members/m-1/license-photo.jpg',
      photoUpdatedAt: { seconds: 1_699_000_000, nanoseconds: 0 },
      photoUpdatedByUid: 'someone',
      ...(opts.member ?? {}),
    })
  }

  if (opts.storage) {
    for (const [k, v] of Object.entries(opts.storage)) {
      fakeStorageExists.set(k, v)
    }
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  fakeDb.doc = vi.fn((path: string) => makeDocRef(path))
  mod = await import('./removeMemberLicensePhoto')
})
afterEach(() => vi.restoreAllMocks())

async function callRemove(args: {
  auth?: { uid: string; token?: { rootAdmin?: boolean } } | null
  data: Record<string, unknown>
}): Promise<{ ok: boolean; out?: unknown; error?: { code: string; message: string } }> {
  const handler = mod.removeMemberLicensePhoto as unknown as CallableHandler
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

describe('removeMemberLicensePhoto — guards', () => {
  it('throws unauthenticated when not signed-in', async () => {
    setupFixture({})
    const res = await callRemove({ auth: null, data: { memberId: 'm-1' } })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('unauthenticated')
  })

  it('throws invalid-argument when memberId is missing', async () => {
    setupFixture({})
    const res = await callRemove({
      auth: { uid: 'caller-uid' },
      data: {},
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('invalid-argument')
  })

  it('throws permission-denied for a coach (admin-only callable)', async () => {
    setupFixture({
      callerRoles: ['coach'],
      storage: { 'members/m-1/license-photo.jpg': true },
    })
    const res = await callRemove({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1' },
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('permission-denied')
  })

  it('throws permission-denied for treasurer (only admin/rootAdmin)', async () => {
    setupFixture({
      callerRoles: ['treasurer'],
      storage: { 'members/m-1/license-photo.jpg': true },
    })
    const res = await callRemove({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1' },
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('permission-denied')
  })

  it('rootAdmin claim bypasses role check', async () => {
    setupFixture({
      callerRoles: ['coach'],
      storage: { 'members/m-1/license-photo.jpg': true },
    })
    const res = await callRemove({
      auth: { uid: 'caller-uid', token: { rootAdmin: true } },
      data: { memberId: 'm-1' },
    })
    expect(res.ok).toBe(true)
  })

  it('throws not-found when member does not exist', async () => {
    setupFixture({
      callerRoles: ['admin'],
      memberExists: false,
    })
    const res = await callRemove({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1' },
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('not-found')
  })
})

describe('removeMemberLicensePhoto — happy paths', () => {
  it('admin removes existing photo: clears 3 fields + deletes Storage object', async () => {
    setupFixture({
      callerRoles: ['admin'],
      storage: { 'members/m-1/license-photo.jpg': true },
    })
    const res = await callRemove({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1' },
    })
    expect(res.ok).toBe(true)
    expect(res.out).toEqual({ ok: true, memberId: 'm-1' })
    // Storage delete called for the old path.
    expect(storageDeleteCalls).toContain('members/m-1/license-photo.jpg')
    // Firestore update clears the 3 fields.
    const update = firestoreUpdates.find((u) => u.path === 'members/m-1')
    expect(update).toBeDefined()
    expect(update?.patch.photoStoragePath).toBeNull()
    expect(update?.patch.photoUpdatedAt).toBeNull()
    expect(update?.patch.photoUpdatedByUid).toBeNull()
  })

  it('is idempotent: member without photo → no-op (no write, no storage call)', async () => {
    setupFixture({
      callerRoles: ['admin'],
      member: {
        photoStoragePath: null,
        photoUpdatedAt: null,
        photoUpdatedByUid: null,
      },
    })
    const res = await callRemove({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1' },
    })
    expect(res.ok).toBe(true)
    expect(res.out).toEqual({ ok: true, memberId: 'm-1' })
    expect(firestoreUpdates).toHaveLength(0)
    expect(storageDeleteCalls).toHaveLength(0)
  })

  it('admin removes when Storage object already absent: still clears fields', async () => {
    setupFixture({
      callerRoles: ['admin'],
      // photoStoragePath posée mais pas de fixture storage → exists=false
    })
    const res = await callRemove({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1' },
    })
    expect(res.ok).toBe(true)
    // Pas de delete (le file n'existe pas), mais Firestore est nettoyé.
    expect(storageDeleteCalls).toHaveLength(0)
    const update = firestoreUpdates.find((u) => u.path === 'members/m-1')
    expect(update?.patch.photoStoragePath).toBeNull()
  })
})
