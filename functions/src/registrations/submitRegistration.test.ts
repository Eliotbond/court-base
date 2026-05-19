/**
 * Tests pour `submitRegistration` — focus sur la cohérence du rôle `parent`.
 *
 * Couvre :
 *  - registration "dependent" + caller SANS member lié → `parent` ajouté
 *    uniquement sur `/users/{uid}.roles` (parent "pur" — le trigger
 *    `syncUserRolesFromMember` ne touche jamais ce user).
 *  - registration "dependent" + caller AVEC member lié (`memberId != null`) →
 *    `parent` ajouté sur `/users/{uid}.roles` ET sur `/members/{memberId}.roles`
 *    (sinon `syncUserRolesFromMember` écraserait le rôle au prochain write
 *    du membre lié).
 *  - registration "self" → aucun write de rôle `parent`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeTx {
  get: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
}

/** Sentinelle renvoyée par le mock de `arrayUnion` — comparée dans les assertions. */
function arrayUnionSentinel(...values: unknown[]): { __op: 'arrayUnion'; values: unknown[] } {
  return { __op: 'arrayUnion', values }
}

const fakeStore = new Map<string, Record<string, unknown> | null>()

function makeDocRef(path: string) {
  return {
    path,
    id: path.split('/').pop() ?? path,
    // Non-async : `get()` est `await`'d côté function — une valeur simple est
    // awaitable, et ça évite le faux positif `require-await` (cf. règle ESLint).
    get: vi.fn(() => {
      const data = fakeStore.get(path)
      return { exists: data != null, data: () => data ?? undefined }
    }),
  }
}

const fakeDb = {
  doc: vi.fn((path: string) => makeDocRef(path)),
  collection: vi.fn((path: string) => ({
    doc: (id?: string) => makeDocRef(`${path}/${id ?? 'auto-reg-id'}`),
  })),
  runTransaction: vi.fn(),
}

vi.mock('./_helpers', () => ({
  db: () => fakeDb,
  serverTimestamp: () => '__SERVER_TS__',
  Timestamp: {
    now: () => ({ seconds: 1_700_000_000, nanoseconds: 0 }),
    fromDate: (d: Date) => ({ seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0 }),
    fromMillis: (ms: number) => ({ seconds: Math.floor(ms / 1000), nanoseconds: 0 }),
  },
}))

vi.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      arrayUnion: (...values: unknown[]) => arrayUnionSentinel(...values),
      serverTimestamp: () => '__SERVER_TS__',
    },
  },
}))

interface CallableHandler {
  run: (req: {
    auth?: { uid: string } | null
    data: Record<string, unknown>
  }) => Promise<unknown>
}

let mod: typeof import('./submitRegistration')

const VALID_PLAYER = {
  firstName: 'Léa',
  lastName: 'Martin',
  birthDate: '2012-04-03',
  gender: 'F',
  avs: '756.1234.5678.90',
  phone: null,
}

/**
 * Amorce le store + la transaction factice.
 * @param callerMemberId  `memberId` posé sur `/users/caller-uid` (null = parent pur).
 */
function setupFixture(opts: { callerMemberId: string | null }): { tx: FakeTx } {
  fakeStore.clear()
  fakeStore.set('teams/team-1', {
    registrationStatus: 'open',
    coachIds: [],
  })
  fakeStore.set('users/caller-uid', {
    email: 'parent@example.com',
    roles: [],
    memberId: opts.callerMemberId,
  })

  const tx: FakeTx = {
    get: vi.fn((target: { path?: string }) => {
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

/** Retrouve l'appel `tx.update` ciblant un path donné. */
function findUpdate(tx: FakeTx, pathPrefix: string): Record<string, unknown> | undefined {
  const call = tx.update.mock.calls.find((c: unknown[]) => {
    const ref = c[0] as { path?: string } | undefined
    return typeof ref?.path === 'string' && ref.path.startsWith(pathPrefix)
  })
  return call ? (call[1] as Record<string, unknown>) : undefined
}

beforeEach(async () => {
  vi.clearAllMocks()
  fakeDb.doc = vi.fn((path: string) => makeDocRef(path))
  fakeDb.collection = vi.fn((path: string) => ({
    doc: (id?: string) => makeDocRef(`${path}/${id ?? 'auto-reg-id'}`),
  }))
  mod = await import('./submitRegistration')
})
afterEach(() => vi.restoreAllMocks())

describe('submitRegistration — cohérence du rôle parent', () => {
  it('dependent + caller sans member lié : parent ajouté uniquement sur /users', async () => {
    const { tx } = setupFixture({ callerMemberId: null })
    const handler = mod.submitRegistration as unknown as CallableHandler
    await handler.run({
      auth: { uid: 'caller-uid' },
      data: {
        registrationFor: 'dependent',
        relationship: 'parent',
        relationshipOther: null,
        player: VALID_PLAYER,
        matchedMemberId: null,
        teamId: 'team-1',
        previouslyLicensed: false,
        previousClubName: null,
        previousClubAbroad: false,
        transferLetterStoragePath: null,
      },
    })

    const userUpdate = findUpdate(tx, 'users/')
    expect(userUpdate).toBeDefined()
    expect(userUpdate?.roles).toEqual(arrayUnionSentinel('parent'))

    // Aucun write sur /members — le caller n'est pas un membre lié.
    expect(findUpdate(tx, 'members/')).toBeUndefined()
  })

  it('dependent + caller AVEC member lié : parent ajouté sur /users ET /members', async () => {
    const { tx } = setupFixture({ callerMemberId: 'member-99' })
    const handler = mod.submitRegistration as unknown as CallableHandler
    await handler.run({
      auth: { uid: 'caller-uid' },
      data: {
        registrationFor: 'dependent',
        relationship: 'parent',
        relationshipOther: null,
        player: VALID_PLAYER,
        matchedMemberId: null,
        teamId: 'team-1',
        previouslyLicensed: false,
        previousClubName: null,
        previousClubAbroad: false,
        transferLetterStoragePath: null,
      },
    })

    const userUpdate = findUpdate(tx, 'users/')
    expect(userUpdate?.roles).toEqual(arrayUnionSentinel('parent'))

    const memberUpdate = findUpdate(tx, 'members/member-99')
    expect(memberUpdate).toBeDefined()
    expect(memberUpdate?.roles).toEqual(arrayUnionSentinel('parent'))
  })

  it('self registration : aucun write du rôle parent', async () => {
    const { tx } = setupFixture({ callerMemberId: 'member-99' })
    const handler = mod.submitRegistration as unknown as CallableHandler
    await handler.run({
      auth: { uid: 'caller-uid' },
      data: {
        registrationFor: 'self',
        relationship: null,
        relationshipOther: null,
        player: VALID_PLAYER,
        matchedMemberId: null,
        teamId: 'team-1',
        previouslyLicensed: false,
        previousClubName: null,
        previousClubAbroad: false,
        transferLetterStoragePath: null,
      },
    })

    // Pas de role parent sur /users ni /members. Le seul tx.update attendu
    // sur la registration est le tracking `coachNotifiedAt`/`adminNotifiedAt`.
    const userUpdate = findUpdate(tx, 'users/')
    expect(userUpdate).toBeUndefined()
    expect(findUpdate(tx, 'members/')).toBeUndefined()
  })
})
