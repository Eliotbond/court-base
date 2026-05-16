/**
 * Tests pour updateDue — focus sur le contrôle d'accès, le rejet de
 * `status: 'paid'`, la sémantique du diff partiel (champ absent vs `null`),
 * et le wiring de l'`update` Firestore.
 *
 * On mock `./_helpers` et `./_emailEnqueue` pour éviter Firestore réel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeDocRef {
  get: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
}

const fakeDb = {
  doc: vi.fn<(path: string) => FakeDocRef>(),
}

vi.mock('./_helpers', async () => {
  const actual = await vi.importActual<typeof import('./_helpers')>('./_helpers')
  return {
    ...actual,
    db: () => fakeDb,
    serverTimestamp: () => '__SERVER_TS__',
    Timestamp: {
      now: () => ({ seconds: 1_000_000, nanoseconds: 0 }),
      fromMillis: (ms: number) => ({
        seconds: Math.floor(ms / 1000),
        nanoseconds: 0,
        __fromMillis: ms,
      }),
    },
  }
})

vi.mock('./_emailEnqueue', async () => {
  return {
    errCode: () => 'unknown',
  }
})

interface AnyCallableHandler {
  run: (req: {
    auth?: { uid: string; token?: { rootAdmin?: boolean } } | null
    data: Record<string, unknown>
  }) => Promise<unknown>
}

let mod: typeof import('./updateDue')

function buildHandler(): AnyCallableHandler {
  return mod.updateDue as unknown as AnyCallableHandler
}

/**
 * Stub le doc /users/{uid} (roles) et le doc /dues/{id} (existant ou non).
 * Retourne le `FakeDocRef` du due pour inspecter `update`.
 */
function wire(opts: { roles: string[]; dueExists?: boolean }): FakeDocRef {
  const dueRef: FakeDocRef = {
    get: vi.fn().mockResolvedValue({
      exists: opts.dueExists ?? true,
      data: () => ({ memberId: 'm1', amount: 250, status: 'issued' }),
    }),
    update: vi.fn().mockResolvedValue(undefined),
    set: vi.fn(),
  }
  fakeDb.doc = vi.fn((path: string): FakeDocRef => {
    if (path.startsWith('users/')) {
      return {
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ roles: opts.roles, email: 'caller@x.ch' }),
        }),
        update: vi.fn(),
        set: vi.fn(),
      }
    }
    return dueRef
  })
  return dueRef
}

beforeEach(async () => {
  vi.clearAllMocks()
  fakeDb.doc = vi.fn()
  mod = await import('./updateDue')
})
afterEach(() => vi.restoreAllMocks())

describe('updateDue permissions', () => {
  it('throws unauthenticated when no auth', async () => {
    wire({ roles: ['admin'] })
    await expect(
      buildHandler().run({ auth: null, data: { dueId: 'd', notes: 'x' } }),
    ).rejects.toThrow(/Must be signed in/)
  })

  it('throws permission-denied for a non-admin / non-treasurer caller', async () => {
    wire({ roles: ['coach'] })
    await expect(
      buildHandler().run({
        auth: { uid: 'caller-uid' },
        data: { dueId: 'd', notes: 'x' },
      }),
    ).rejects.toThrow(/rootAdmin, admin or treasurer/)
  })

  it('accepts treasurer role', async () => {
    const dueRef = wire({ roles: ['treasurer'] })
    const out = await buildHandler().run({
      auth: { uid: 'caller-uid' },
      data: { dueId: 'd', notes: 'paid offline' },
    })
    expect(out).toEqual({ ok: true })
    expect(dueRef.update).toHaveBeenCalledOnce()
  })

  it('accepts rootAdmin claim even without admin role in /users', async () => {
    const dueRef = wire({ roles: ['coach'] })
    const out = await buildHandler().run({
      auth: { uid: 'caller-uid', token: { rootAdmin: true } },
      data: { dueId: 'd', status: 'cancelled' },
    })
    expect(out).toEqual({ ok: true })
    expect(dueRef.update.mock.calls[0][0].status).toBe('cancelled')
  })
})

describe('updateDue status validation', () => {
  it("rejects status 'paid' with invalid-argument", async () => {
    wire({ roles: ['admin'] })
    await expect(
      buildHandler().run({
        auth: { uid: 'caller-uid' },
        data: { dueId: 'd', status: 'paid' },
      }),
    ).rejects.toThrow(/markDuePaid flow/)
  })

  it('rejects an unknown status', async () => {
    wire({ roles: ['admin'] })
    await expect(
      buildHandler().run({
        auth: { uid: 'caller-uid' },
        data: { dueId: 'd', status: 'archived' },
      }),
    ).rejects.toThrow(/status must be one of/)
  })

  it('accepts each non-paid status', async () => {
    for (const status of ['pending_grace', 'issued', 'overdue', 'excepted', 'cancelled']) {
      const dueRef = wire({ roles: ['admin'] })
      const out = await buildHandler().run({
        auth: { uid: 'caller-uid' },
        data: { dueId: 'd', status },
      })
      expect(out).toEqual({ ok: true })
      expect(dueRef.update.mock.calls[0][0].status).toBe(status)
    }
  })
})

describe('updateDue partial diff semantics', () => {
  it('only patches the fields explicitly provided', async () => {
    const dueRef = wire({ roles: ['admin'] })
    await buildHandler().run({
      auth: { uid: 'caller-uid' },
      data: { dueId: 'd', notes: 'hello' },
    })
    const patch = dueRef.update.mock.calls[0][0]
    expect(Object.keys(patch)).toEqual(['notes'])
    expect(patch.notes).toBe('hello')
  })

  it('treats explicit null as field erasure for issuedAt / dueAt / notes', async () => {
    const dueRef = wire({ roles: ['admin'] })
    await buildHandler().run({
      auth: { uid: 'caller-uid' },
      data: { dueId: 'd', issuedAt: null, dueAt: null, notes: null },
    })
    const patch = dueRef.update.mock.calls[0][0]
    expect(patch.issuedAt).toBeNull()
    expect(patch.dueAt).toBeNull()
    expect(patch.notes).toBeNull()
  })

  it('rejects null for activatedAt (non-nullable)', async () => {
    wire({ roles: ['admin'] })
    await expect(
      buildHandler().run({
        auth: { uid: 'caller-uid' },
        data: { dueId: 'd', activatedAt: null },
      }),
    ).rejects.toThrow(/activatedAt cannot be null/)
  })

  it('converts epoch-millis dates to Timestamps', async () => {
    const dueRef = wire({ roles: ['admin'] })
    await buildHandler().run({
      auth: { uid: 'caller-uid' },
      data: { dueId: 'd', activatedAt: 1_700_000_000_000, dueAt: 1_700_500_000_000 },
    })
    const patch = dueRef.update.mock.calls[0][0]
    expect(patch.activatedAt.__fromMillis).toBe(1_700_000_000_000)
    expect(patch.dueAt.__fromMillis).toBe(1_700_500_000_000)
  })

  it('rejects a non-numeric date', async () => {
    wire({ roles: ['admin'] })
    await expect(
      buildHandler().run({
        auth: { uid: 'caller-uid' },
        data: { dueId: 'd', issuedAt: '2024-01-01' },
      }),
    ).rejects.toThrow(/issuedAt must be an epoch-millis number/)
  })

  it('throws invalid-argument when no field is provided', async () => {
    wire({ roles: ['admin'] })
    await expect(
      buildHandler().run({
        auth: { uid: 'caller-uid' },
        data: { dueId: 'd' },
      }),
    ).rejects.toThrow(/no field to update/)
  })

  it('trims notes and stores empty string as null', async () => {
    const dueRef = wire({ roles: ['admin'] })
    await buildHandler().run({
      auth: { uid: 'caller-uid' },
      data: { dueId: 'd', notes: '   ' },
    })
    expect(dueRef.update.mock.calls[0][0].notes).toBeNull()
  })
})

describe('updateDue preconditions', () => {
  it('throws invalid-argument when dueId is missing', async () => {
    wire({ roles: ['admin'] })
    await expect(
      buildHandler().run({
        auth: { uid: 'caller-uid' },
        data: { notes: 'x' },
      }),
    ).rejects.toThrow(/dueId is required/)
  })

  it('throws not-found when the due does not exist', async () => {
    const dueRef = wire({ roles: ['admin'], dueExists: false })
    await expect(
      buildHandler().run({
        auth: { uid: 'caller-uid' },
        data: { dueId: 'missing', notes: 'x' },
      }),
    ).rejects.toThrow(/not found/)
    expect(dueRef.update).not.toHaveBeenCalled()
  })
})
