/**
 * Tests pour `coachCreateMember`. Focus :
 *  - unauthenticated si pas d'auth
 *  - invalid-argument : champs requis manquants, birthDate mal typé
 *  - permission-denied pour un coach hors scope de la team
 *  - not-found si la team n'existe pas
 *  - happy path création : /members + /private/contact + arrayUnion playerIds
 *  - dédup : findExactMemberMatch renvoie un id ⇒ memberCreated:false, pas de set
 *
 * On mock `./_helpers` (findExactMemberMatch / defaultComms) pour piloter la
 * dédup sans Firestore réel, et `../registrations/_helpers` (db / Timestamp).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeDocSnap {
  exists: boolean
  data: () => Record<string, unknown> | undefined
}

interface FakeTx {
  get: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
}

const fakeStore = new Map<string, Record<string, unknown> | null>()
let generatedMemberId = 'new-member-id'

function makeDocRef(path: string) {
  return {
    path,
    id: path.split('/').pop() ?? '',
    get: vi.fn(async (): Promise<FakeDocSnap> => {
      const data = fakeStore.get(path)
      return { exists: data != null, data: () => data ?? undefined }
    }),
  }
}

function makeCollectionRef(path: string) {
  return {
    doc: vi.fn(() => makeDocRef(`${path}/${generatedMemberId}`)),
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
    fromMillis: (ms: number) => ({
      seconds: Math.floor(ms / 1000),
      nanoseconds: 0,
    }),
  },
  normalizeName: (s: string) => s.trim().toLowerCase(),
}))

const { findExactMemberMatch, defaultComms } = vi.hoisted(() => ({
  findExactMemberMatch: vi.fn(),
  defaultComms: vi.fn(() => ({
    billingRecipients: ['member'],
    generalRecipients: ['member'],
    majorityTransition: null,
  })),
}))
vi.mock('./_helpers', () => ({ findExactMemberMatch, defaultComms }))

vi.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      arrayUnion: (...ids: unknown[]) => ({ __arrayUnion: ids }),
    },
  },
}))

interface CallableHandler {
  run: (req: {
    auth?: { uid: string; token?: { rootAdmin?: boolean } } | null
    data: Record<string, unknown>
  }) => Promise<unknown>
}

let mod: typeof import('./coachCreateMember')

interface SetupOpts {
  callerRoles?: string[]
  callerTeamIds?: string[]
  callerExists?: boolean
  teamExists?: boolean
  matchedMemberId?: string | null
}

function setupFixture(opts: SetupOpts): { tx: FakeTx } {
  fakeStore.clear()
  generatedMemberId = 'new-member-id'

  if (opts.callerExists !== false) {
    fakeStore.set('users/caller-uid', {
      roles: opts.callerRoles ?? ['coach'],
      teamIds: opts.callerTeamIds ?? ['t-1'],
    })
  }
  if (opts.teamExists !== false) {
    fakeStore.set('teams/t-1', { name: 'U14', playerIds: [] })
  }

  findExactMemberMatch.mockResolvedValue(opts.matchedMemberId ?? null)

  const tx: FakeTx = {
    get: vi.fn(async (target: { path?: string }): Promise<FakeDocSnap> => {
      const path = target.path ?? ''
      const data = fakeStore.get(path)
      return { exists: data != null, data: () => data ?? undefined }
    }),
    update: vi.fn(),
    set: vi.fn(),
  }
  fakeDb.runTransaction = vi.fn(async (fn: (t: FakeTx) => Promise<unknown>) =>
    fn(tx),
  )
  return { tx }
}

beforeEach(async () => {
  vi.clearAllMocks()
  fakeDb.doc = vi.fn((path: string) => makeDocRef(path))
  fakeDb.collection = vi.fn((path: string) => makeCollectionRef(path))
  mod = await import('./coachCreateMember')
})
afterEach(() => vi.restoreAllMocks())

async function call(args: {
  auth?: { uid: string; token?: { rootAdmin?: boolean } } | null
  data: Record<string, unknown>
}): Promise<{
  ok: boolean
  out?: unknown
  error?: { code: string; message: string }
}> {
  const handler = mod.coachCreateMember as unknown as CallableHandler
  try {
    return { ok: true, out: await handler.run(args) }
  } catch (err) {
    const e = err as { code?: string; message?: string }
    return {
      ok: false,
      error: { code: e.code ?? 'unknown', message: e.message ?? '' },
    }
  }
}

const validData = {
  teamId: 't-1',
  firstName: 'Alice',
  lastName: 'Martin',
  birthDate: Date.UTC(2012, 0, 15),
  avs: null,
  email: 'a@example.com',
  phone: '079 000 00 00',
}

describe('coachCreateMember — guards', () => {
  it('throws unauthenticated when not signed-in', async () => {
    setupFixture({})
    const res = await call({ auth: null, data: validData })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('unauthenticated')
  })

  it('throws invalid-argument when firstName is missing', async () => {
    setupFixture({})
    const res = await call({
      auth: { uid: 'caller-uid' },
      data: { ...validData, firstName: '  ' },
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('invalid-argument')
  })

  it('throws invalid-argument when birthDate is not a number', async () => {
    setupFixture({})
    const res = await call({
      auth: { uid: 'caller-uid' },
      data: { ...validData, birthDate: 'yesterday' },
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('invalid-argument')
  })

  it('throws permission-denied for a coach not scoping the team', async () => {
    setupFixture({ callerRoles: ['coach'], callerTeamIds: ['t-other'] })
    const res = await call({ auth: { uid: 'caller-uid' }, data: validData })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('permission-denied')
  })

  it('throws not-found when the team does not exist', async () => {
    setupFixture({ callerRoles: ['admin'], teamExists: false })
    const res = await call({ auth: { uid: 'caller-uid' }, data: validData })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('not-found')
  })
})

describe('coachCreateMember — creation', () => {
  it('creates the member, the contact doc and adds to team.playerIds', async () => {
    const { tx } = setupFixture({ callerRoles: ['coach'], callerTeamIds: ['t-1'] })
    const res = await call({ auth: { uid: 'caller-uid' }, data: validData })

    expect(res.ok).toBe(true)
    expect(res.out).toEqual({
      ok: true,
      memberId: 'new-member-id',
      memberCreated: true,
      addedToTeam: true,
    })

    // /members/{id} créé en joueur
    const memberSet = tx.set.mock.calls.find(
      (c: unknown[]) => (c[0] as { path?: string }).path === 'members/new-member-id',
    )
    expect(memberSet).toBeTruthy()
    const member = memberSet![1] as Record<string, unknown>
    expect(member.roles).toEqual(['player'])
    expect(member.status).toBe('active')
    expect(member.officialLevel).toBeNull()
    expect(member.officialLicense).toBeNull()
    expect(member.coachLicense).toBeNull()
    expect(member.duesStatus).toBe('n/a')
    expect(member.active).toBe(true)

    // /private/contact écrit
    const contactSet = tx.set.mock.calls.find(
      (c: unknown[]) =>
        (c[0] as { path?: string }).path === 'members/new-member-id/private/contact',
    )
    expect(contactSet).toBeTruthy()
    expect(contactSet![1]).toEqual({
      email: 'a@example.com',
      phone: '079 000 00 00',
    })

    // arrayUnion sur team.playerIds
    expect(tx.update).toHaveBeenCalledOnce()
    const [teamRef, patch] = tx.update.mock.calls[0] as [
      { path: string },
      Record<string, unknown>,
    ]
    expect(teamRef.path).toBe('teams/t-1')
    expect(patch.playerIds).toEqual({ __arrayUnion: ['new-member-id'] })
  })

  it('writes empty strings to contact when email/phone are null', async () => {
    const { tx } = setupFixture({ callerRoles: ['admin'] })
    await call({
      auth: { uid: 'caller-uid' },
      data: { ...validData, email: null, phone: null },
    })
    const contactSet = tx.set.mock.calls.find(
      (c: unknown[]) =>
        (c[0] as { path?: string }).path === 'members/new-member-id/private/contact',
    )
    expect(contactSet![1]).toEqual({ email: '', phone: '' })
  })

  it('rootAdmin claim bypasses team scope', async () => {
    setupFixture({ callerRoles: ['coach'], callerTeamIds: ['t-other'] })
    const res = await call({
      auth: { uid: 'caller-uid', token: { rootAdmin: true } },
      data: validData,
    })
    expect(res.ok).toBe(true)
  })
})

describe('coachCreateMember — dedup', () => {
  it('reuses an existing member and does not create a new doc', async () => {
    const { tx } = setupFixture({
      callerRoles: ['coach'],
      callerTeamIds: ['t-1'],
      matchedMemberId: 'existing-m',
    })
    const res = await call({ auth: { uid: 'caller-uid' }, data: validData })

    expect(res.ok).toBe(true)
    expect(res.out).toEqual({
      ok: true,
      memberId: 'existing-m',
      memberCreated: false,
      addedToTeam: true,
    })
    // Aucun /members/... ni /private/contact écrit.
    expect(tx.set).not.toHaveBeenCalled()
    // Mais le membre existant est rattaché à l'équipe.
    const [, patch] = tx.update.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(patch.playerIds).toEqual({ __arrayUnion: ['existing-m'] })
  })
})
