/**
 * Tests pour `coachUpdateMember`. Mock Firestore minimaliste, focus sur :
 *  - unauthenticated si pas d'auth
 *  - invalid-argument si aucun champ éditable / champs malformés
 *  - permission-denied pour un coach hors scope du membre
 *  - happy path coach : patch member + contact
 *  - happy path admin : bypass scope
 *  - whitelist : seuls les champs autorisés sont écrits
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

// Store partagé : path -> data (null = doc inexistant).
const fakeStore = new Map<string, Record<string, unknown> | null>()
// Index pour les `where` queries : key -> ids.
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

let mod: typeof import('./coachUpdateMember')

interface SetupOpts {
  callerRoles?: string[]
  callerTeamIds?: string[]
  callerExists?: boolean
  memberExists?: boolean
  member?: Record<string, unknown>
  /** Équipes dont playerIds contient m-1. */
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
      comms: { billingRecipients: ['guardians'], generalRecipients: ['guardians'], majorityTransition: null },
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
  mod = await import('./coachUpdateMember')
})
afterEach(() => vi.restoreAllMocks())

async function callUpdate(args: {
  auth?: { uid: string; token?: { rootAdmin?: boolean } } | null
  data: Record<string, unknown>
}): Promise<{ ok: boolean; out?: unknown; error?: { code: string; message: string } }> {
  const handler = mod.coachUpdateMember as unknown as CallableHandler
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

describe('coachUpdateMember — guards', () => {
  it('throws unauthenticated when not signed-in', async () => {
    setupFixture({})
    const res = await callUpdate({ auth: null, data: { memberId: 'm-1', firstName: 'Bob' } })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('unauthenticated')
  })

  it('throws invalid-argument when no editable field is provided', async () => {
    setupFixture({})
    const res = await callUpdate({ auth: { uid: 'caller-uid' }, data: { memberId: 'm-1' } })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('invalid-argument')
    expect(res.error?.message).toContain('no editable field')
  })

  it('throws invalid-argument when memberId is missing', async () => {
    setupFixture({})
    const res = await callUpdate({ auth: { uid: 'caller-uid' }, data: { firstName: 'Bob' } })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('invalid-argument')
  })

  it('throws permission-denied for a coach not scoping the member', async () => {
    setupFixture({
      callerRoles: ['coach'],
      callerTeamIds: ['t-other'],
      memberTeamIds: ['t-1'],
    })
    const res = await callUpdate({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', firstName: 'Bob' },
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('permission-denied')
  })

  it('throws not-found when the member does not exist', async () => {
    setupFixture({
      callerRoles: ['admin'],
      memberExists: false,
    })
    const res = await callUpdate({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', firstName: 'Bob' },
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('not-found')
  })
})

describe('coachUpdateMember — input validation', () => {
  it('rejects empty firstName', async () => {
    setupFixture({ callerRoles: ['admin'] })
    const res = await callUpdate({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', firstName: '   ' },
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('invalid-argument')
  })

  it('rejects non-numeric birthDate', async () => {
    setupFixture({ callerRoles: ['admin'] })
    const res = await callUpdate({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', birthDate: 'yesterday' },
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('invalid-argument')
  })

  it('rejects empty comms.generalRecipients array', async () => {
    setupFixture({ callerRoles: ['admin'] })
    const res = await callUpdate({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', comms: { generalRecipients: [] } },
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('invalid-argument')
  })

  it('rejects invalid recipient value', async () => {
    setupFixture({ callerRoles: ['admin'] })
    const res = await callUpdate({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', comms: { generalRecipients: ['member', 'coach'] } },
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('invalid-argument')
  })
})

describe('coachUpdateMember — happy path', () => {
  it('updates name + birthDate on member doc for an in-scope coach', async () => {
    const { tx } = setupFixture({
      callerRoles: ['coach'],
      callerTeamIds: ['t-1', 't-2'],
      memberTeamIds: ['t-1'],
    })
    const res = await callUpdate({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', firstName: 'Bob', lastName: 'Durand', birthDate: 1_000_000_000_000 },
    })
    expect(res.ok).toBe(true)
    expect(res.out).toEqual({ ok: true, memberId: 'm-1' })

    const memberUpdate = tx.update.mock.calls.find(
      (c: unknown[]) => (c[0] as { path?: string }).path === 'members/m-1',
    )
    expect(memberUpdate).toBeDefined()
    const patch = memberUpdate![1] as Record<string, unknown>
    expect(patch.firstName).toBe('Bob')
    expect(patch.lastName).toBe('Durand')
    expect(patch.birthDate).toEqual({ seconds: 1_000_000_000, nanoseconds: 0 })
  })

  it('writes email/phone to the private/contact subdoc with merge', async () => {
    const { tx } = setupFixture({
      callerRoles: ['coach'],
      callerTeamIds: ['t-1'],
      memberTeamIds: ['t-1'],
    })
    const res = await callUpdate({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', email: 'bob@x.ch', phone: '+41790000000' },
    })
    expect(res.ok).toBe(true)

    const contactSet = tx.set.mock.calls.find(
      (c: unknown[]) => (c[0] as { path?: string }).path === 'members/m-1/private/contact',
    )
    expect(contactSet).toBeDefined()
    expect(contactSet![1]).toEqual({ email: 'bob@x.ch', phone: '+41790000000' })
    expect(contactSet![2]).toEqual({ merge: true })
    // Pas de tx.update sur le member doc (aucun champ member fourni).
    expect(tx.update).not.toHaveBeenCalled()
  })

  it('patches only comms.generalRecipients (not billing / majorityTransition)', async () => {
    const { tx } = setupFixture({
      callerRoles: ['coach'],
      callerTeamIds: ['t-1'],
      memberTeamIds: ['t-1'],
    })
    const res = await callUpdate({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', comms: { generalRecipients: ['member', 'guardians'] } },
    })
    expect(res.ok).toBe(true)

    const memberUpdate = tx.update.mock.calls.find(
      (c: unknown[]) => (c[0] as { path?: string }).path === 'members/m-1',
    )
    const patch = memberUpdate![1] as Record<string, unknown>
    expect(patch['comms.generalRecipients']).toEqual(['member', 'guardians'])
    expect(Object.keys(patch)).toEqual(['comms.generalRecipients'])
  })

  it('clears birthDate / email when null is passed explicitly', async () => {
    const { tx } = setupFixture({ callerRoles: ['admin'] })
    const res = await callUpdate({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', birthDate: null, email: null },
    })
    expect(res.ok).toBe(true)
    const memberUpdate = tx.update.mock.calls.find(
      (c: unknown[]) => (c[0] as { path?: string }).path === 'members/m-1',
    )
    expect((memberUpdate![1] as Record<string, unknown>).birthDate).toBeNull()
    const contactSet = tx.set.mock.calls.find(
      (c: unknown[]) => (c[0] as { path?: string }).path === 'members/m-1/private/contact',
    )
    expect((contactSet![1] as Record<string, unknown>).email).toBeNull()
  })

  it('admin bypasses team scope (no membership query needed)', async () => {
    const { tx } = setupFixture({
      callerRoles: ['admin'],
      callerTeamIds: [],
      memberTeamIds: ['t-99'],
    })
    const res = await callUpdate({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', firstName: 'Bob' },
    })
    expect(res.ok).toBe(true)
    expect(tx.update).toHaveBeenCalledOnce()
  })

  it('rootAdmin claim bypasses team scope even without admin role', async () => {
    setupFixture({
      callerRoles: ['coach'],
      callerTeamIds: ['t-other'],
      memberTeamIds: ['t-1'],
    })
    const res = await callUpdate({
      auth: { uid: 'caller-uid', token: { rootAdmin: true } },
      data: { memberId: 'm-1', firstName: 'Bob' },
    })
    expect(res.ok).toBe(true)
  })

  it('is idempotent — re-running the same patch yields the same result', async () => {
    setupFixture({ callerRoles: ['admin'] })
    const first = await callUpdate({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', firstName: 'Bob' },
    })
    setupFixture({ callerRoles: ['admin'], member: { firstName: 'Bob' } })
    const second = await callUpdate({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', firstName: 'Bob' },
    })
    expect(first.out).toEqual(second.out)
  })
})
