/**
 * Tests pour `coachDeactivateMember`. Mock Firestore minimaliste, focus sur :
 *  - unauthenticated si pas d'auth
 *  - invalid-argument : mode inconnu, reason manquant en mode archive
 *  - permission-denied pour un coach hors scope du membre
 *  - happy path bench : active:false seulement
 *  - happy path archive : status/archivedAt/archivedReason/archivedByUid/active
 *  - idempotence : déjà benché / déjà archivé ⇒ no-op write
 *  - not-found si le membre n'existe pas
 *
 * On mock `../registrations/_helpers` (utilisé par la callable ET par
 * `_coachAuth`) pour éviter Firestore réel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeDocSnap {
  exists: boolean
  data: () => Record<string, unknown> | undefined
}

interface FakeQuerySnap {
  docs: { id: string }[]
}

interface FakeTx {
  get: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
}

const fakeStore = new Map<string, Record<string, unknown> | null>()
const fakeQueryIndex = new Map<string, string[]>()

function makeDocRef(path: string) {
  return {
    path,
    get: vi.fn(async (): Promise<FakeDocSnap> => {
      const data = fakeStore.get(path)
      return { exists: data != null, data: () => data ?? undefined }
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

interface CallableHandler {
  run: (req: {
    auth?: { uid: string; token?: { rootAdmin?: boolean } } | null
    data: Record<string, unknown>
  }) => Promise<unknown>
}

let mod: typeof import('./coachDeactivateMember')

interface SetupOpts {
  callerRoles?: string[]
  callerTeamIds?: string[]
  callerExists?: boolean
  memberExists?: boolean
  member?: Record<string, unknown>
  memberTeamIds?: string[]
}

function setupFixture(opts: SetupOpts): { tx: FakeTx } {
  fakeStore.clear()
  fakeQueryIndex.clear()

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
      ...(opts.member ?? {}),
    })
  }

  fakeQueryIndex.set(
    'teams|playerIds|array-contains|m-1',
    opts.memberTeamIds ?? [],
  )

  const tx: FakeTx = {
    get: vi.fn(async (target: { path?: string }): Promise<FakeDocSnap> => {
      const path = target.path ?? ''
      const data = fakeStore.get(path)
      return { exists: data != null, data: () => data ?? undefined }
    }),
    update: vi.fn(),
    set: vi.fn(),
  }
  fakeDb.runTransaction = vi.fn(async (fn: (t: FakeTx) => Promise<unknown>) => fn(tx))
  return { tx }
}

beforeEach(async () => {
  vi.clearAllMocks()
  fakeDb.doc = vi.fn((path: string) => makeDocRef(path))
  fakeDb.collection = vi.fn((path: string) => makeCollectionRef(path))
  mod = await import('./coachDeactivateMember')
})
afterEach(() => vi.restoreAllMocks())

async function callDeactivate(args: {
  auth?: { uid: string; token?: { rootAdmin?: boolean } } | null
  data: Record<string, unknown>
}): Promise<{ ok: boolean; out?: unknown; error?: { code: string; message: string } }> {
  const handler = mod.coachDeactivateMember as unknown as CallableHandler
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

describe('coachDeactivateMember — guards', () => {
  it('throws unauthenticated when not signed-in', async () => {
    setupFixture({})
    const res = await callDeactivate({ auth: null, data: { memberId: 'm-1', mode: 'bench' } })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('unauthenticated')
  })

  it('throws invalid-argument for an unknown mode', async () => {
    setupFixture({})
    const res = await callDeactivate({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', mode: 'destroy' },
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('invalid-argument')
  })

  it('throws invalid-argument when archive mode lacks a reason', async () => {
    setupFixture({})
    const res = await callDeactivate({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', mode: 'archive' },
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('invalid-argument')
    expect(res.error?.message).toContain('reason is required')
  })

  it('throws invalid-argument when archive reason is blank', async () => {
    setupFixture({})
    const res = await callDeactivate({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', mode: 'archive', reason: '   ' },
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('invalid-argument')
  })

  it('throws permission-denied for a coach not scoping the member', async () => {
    setupFixture({
      callerRoles: ['coach'],
      callerTeamIds: ['t-other'],
      memberTeamIds: ['t-1'],
    })
    const res = await callDeactivate({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', mode: 'bench' },
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('permission-denied')
  })

  it('throws not-found when the member does not exist', async () => {
    setupFixture({ callerRoles: ['admin'], memberExists: false })
    const res = await callDeactivate({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', mode: 'bench' },
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('not-found')
  })
})

describe('coachDeactivateMember — bench mode', () => {
  it('sets active:false only and keeps status', async () => {
    const { tx } = setupFixture({
      callerRoles: ['coach'],
      callerTeamIds: ['t-1'],
      memberTeamIds: ['t-1'],
    })
    const res = await callDeactivate({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', mode: 'bench' },
    })
    expect(res.ok).toBe(true)
    expect(res.out).toEqual({ ok: true, memberId: 'm-1', mode: 'bench' })

    expect(tx.update).toHaveBeenCalledOnce()
    const patch = tx.update.mock.calls[0][1] as Record<string, unknown>
    expect(patch).toEqual({ active: false })
  })

  it('is idempotent — already benched member yields a no-op write', async () => {
    const { tx } = setupFixture({
      callerRoles: ['admin'],
      member: { active: false },
    })
    const res = await callDeactivate({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', mode: 'bench' },
    })
    expect(res.ok).toBe(true)
    expect(res.out).toEqual({ ok: true, memberId: 'm-1', mode: 'bench' })
    expect(tx.update).not.toHaveBeenCalled()
  })
})

describe('coachDeactivateMember — archive mode', () => {
  it('sets status, archivedAt, archivedReason, archivedByUid and active:false', async () => {
    const { tx } = setupFixture({
      callerRoles: ['coach'],
      callerTeamIds: ['t-1'],
      memberTeamIds: ['t-1'],
    })
    const res = await callDeactivate({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', mode: 'archive', reason: '  Départ du club  ' },
    })
    expect(res.ok).toBe(true)
    expect(res.out).toEqual({ ok: true, memberId: 'm-1', mode: 'archive' })

    expect(tx.update).toHaveBeenCalledOnce()
    const patch = tx.update.mock.calls[0][1] as Record<string, unknown>
    expect(patch.status).toBe('archived')
    expect(patch.archivedReason).toBe('Départ du club')
    expect(patch.archivedByUid).toBe('caller-uid')
    expect(patch.active).toBe(false)
    expect(patch.archivedAt).toEqual({ seconds: 1_700_000_000, nanoseconds: 0 })
  })

  it('does NOT remove the member from team.playerIds', async () => {
    const { tx } = setupFixture({
      callerRoles: ['admin'],
    })
    await callDeactivate({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', mode: 'archive', reason: 'fin' },
    })
    // Aucune écriture sur une collection teams.
    const teamWrites = tx.update.mock.calls.filter(
      (c: unknown[]) => (c[0] as { path?: string }).path?.startsWith('teams/'),
    )
    expect(teamWrites).toHaveLength(0)
  })

  it('is idempotent — already archived member yields a no-op write', async () => {
    const { tx } = setupFixture({
      callerRoles: ['admin'],
      member: { status: 'archived', active: false },
    })
    const res = await callDeactivate({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', mode: 'archive', reason: 'fin' },
    })
    expect(res.ok).toBe(true)
    expect(res.out).toEqual({ ok: true, memberId: 'm-1', mode: 'archive' })
    expect(tx.update).not.toHaveBeenCalled()
  })

  it('rootAdmin claim bypasses team scope', async () => {
    setupFixture({
      callerRoles: ['coach'],
      callerTeamIds: ['t-other'],
      memberTeamIds: ['t-1'],
    })
    const res = await callDeactivate({
      auth: { uid: 'caller-uid', token: { rootAdmin: true } },
      data: { memberId: 'm-1', mode: 'archive', reason: 'fin' },
    })
    expect(res.ok).toBe(true)
  })
})
