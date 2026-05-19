/**
 * Tests pour `confirmRegistration` — focus sur la réactivation du member
 * réutilisé (`registration.matchedMemberId` présent) :
 *  - member `active:false`   → réactivé (`active:true` / `status:'active'`)
 *  - member `status:'archived'` → réactivé + champs archived remis à `null`
 *  - member déjà actif       → pas de régression (binding toujours appliqué,
 *                              pas de champ de réactivation posé)
 *
 * Le mock du SDK Admin s'inspire strictement de `refuseRegistration.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeTx {
  get: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
}

function makeDocRef(path: string) {
  return {
    path,
    collection: (sub: string) => ({
      doc: () => ({ id: 'log-1', path: `${path}/${sub}/log-1` }),
    }),
    get: vi.fn(),
  }
}

const fakeDb = {
  doc: vi.fn((path: string) => makeDocRef(path)),
  collection: vi.fn((path: string) => ({
    doc: (id?: string) => ({ id: id ?? 'auto-id', path: `${path}/${id ?? 'auto-id'}` }),
  })),
  runTransaction: vi.fn(),
}

vi.mock('./_helpers', () => ({
  db: () => fakeDb,
  serverTimestamp: () => '__SERVER_TS__',
  normalizeName: (s: string) => s.trim().toLowerCase(),
  Timestamp: {
    now: () => ({ seconds: 1_700_000_000, nanoseconds: 0 }),
    fromMillis: (ms: number) => ({ seconds: Math.floor(ms / 1000), nanoseconds: 0 }),
    fromDate: (d: Date) => ({ seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0 }),
  },
}))

// Mock du SDK Admin pour `admin.firestore.FieldValue.arrayUnion`.
vi.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      arrayUnion: (...vals: unknown[]) => ({ __arrayUnion: vals }),
    },
  },
}))

interface CallableHandler {
  run: (req: {
    auth?: { uid: string } | null
    data: Record<string, unknown>
  }) => Promise<unknown>
}

let mod: typeof import('./confirmRegistration')

function setupFixture(opts: {
  registrationFor: 'self' | 'dependent'
  member: Record<string, unknown>
}): { tx: FakeTx } {
  const resolveSnap = (path: string): { exists: boolean; data: () => unknown } => {
    if (path.startsWith('registrations/')) {
      return {
        exists: true,
        data: () => ({
          teamId: 'team-1',
          status: 'trial_in_progress',
          matchedMemberId: 'm-123',
          registrationFor: opts.registrationFor,
          submittedByUid: 'submitter-uid',
          foreignTransfer: false,
          player: {
            firstName: 'Alice',
            lastName: 'Martin',
            birthDate: { seconds: 1_000_000_000, nanoseconds: 0 },
            avs: null,
          },
          actionLog: [],
        }),
      }
    }
    if (path.startsWith('teams/')) {
      return { exists: true, data: () => ({ coachIds: ['caller-uid'], playerIds: [] }) }
    }
    if (path.startsWith('members/')) {
      return { exists: true, data: () => opts.member }
    }
    return { exists: false, data: () => undefined }
  }
  const tx: FakeTx = {
    get: vi.fn((target: { path?: string }) =>
      Promise.resolve(resolveSnap(target.path ?? '')),
    ),
    update: vi.fn(),
    set: vi.fn(),
  }
  fakeDb.runTransaction = vi.fn((fn: (t: FakeTx) => Promise<unknown>) => fn(tx))
  return { tx }
}

beforeEach(async () => {
  vi.clearAllMocks()
  fakeDb.doc = vi.fn((path: string) => makeDocRef(path))
  fakeDb.collection = vi.fn((path: string) => ({
    doc: (id?: string) => ({ id: id ?? 'auto-id', path: `${path}/${id ?? 'auto-id'}` }),
  }))
  // Caller = admin (passe `assertCoachOrAdmin` sans dépendre de teamIds).
  const userRef = makeDocRef('users/caller-uid')
  userRef.get = vi.fn(() =>
    Promise.resolve({ exists: true, data: () => ({ roles: ['admin'] }) }),
  )
  fakeDb.doc = vi.fn((path: string) =>
    path === 'users/caller-uid' ? userRef : makeDocRef(path),
  )
  mod = await import('./confirmRegistration')
})
afterEach(() => vi.restoreAllMocks())

function memberUpdateCalls(tx: FakeTx): unknown[][] {
  return tx.update.mock.calls.filter((c: unknown[]) => {
    const ref = c[0] as { path?: string } | undefined
    return typeof ref?.path === 'string' && ref.path.startsWith('members/')
  })
}

function memberUpdate(tx: FakeTx): Record<string, unknown> | undefined {
  const call = memberUpdateCalls(tx)[0]
  return call ? (call[1] as Record<string, unknown>) : undefined
}

describe('confirmRegistration — member reactivation on reuse', () => {
  it('reactivates an inactive (active:false) matched member', async () => {
    const { tx } = setupFixture({
      registrationFor: 'dependent',
      member: {
        firstName: 'Alice',
        lastName: 'Martin',
        active: false,
        status: 'active',
        archivedAt: null,
        archivedReason: null,
        archivedByUid: null,
        guardianUserIds: ['submitter-uid'], // déjà tuteur → pas de binding
      },
    })
    const handler = mod.confirmRegistration as unknown as CallableHandler
    const res = await handler.run({
      auth: { uid: 'caller-uid' },
      data: { registrationId: 'reg-1' },
    })
    expect((res as { memberCreated: boolean }).memberCreated).toBe(false)

    const patch = memberUpdate(tx)
    expect(patch).toBeDefined()
    expect(patch?.active).toBe(true)
    expect(patch?.status).toBe('active')
    expect(patch?.archivedAt).toBeNull()
    expect(patch?.archivedReason).toBeNull()
    expect(patch?.archivedByUid).toBeNull()
  })

  it('reactivates an archived (status:archived) matched member and clears archive fields', async () => {
    const { tx } = setupFixture({
      registrationFor: 'dependent',
      member: {
        firstName: 'Alice',
        lastName: 'Martin',
        active: false,
        status: 'archived',
        archivedAt: { seconds: 123, nanoseconds: 0 },
        archivedReason: 'no fit',
        archivedByUid: 'old-coach',
        guardianUserIds: ['submitter-uid'],
      },
    })
    const handler = mod.confirmRegistration as unknown as CallableHandler
    await handler.run({
      auth: { uid: 'caller-uid' },
      data: { registrationId: 'reg-1' },
    })

    const patch = memberUpdate(tx)
    expect(patch).toBeDefined()
    expect(patch?.active).toBe(true)
    expect(patch?.status).toBe('active')
    expect(patch?.archivedAt).toBeNull()
    expect(patch?.archivedReason).toBeNull()
    expect(patch?.archivedByUid).toBeNull()
  })

  it('merges reactivation with guardian binding in a single update', async () => {
    const { tx } = setupFixture({
      registrationFor: 'dependent',
      member: {
        firstName: 'Alice',
        lastName: 'Martin',
        active: false,
        status: 'archived',
        archivedAt: { seconds: 123, nanoseconds: 0 },
        archivedReason: 'no fit',
        archivedByUid: 'old-coach',
        guardianUserIds: [], // submitter PAS encore tuteur → binding requis
      },
    })
    const handler = mod.confirmRegistration as unknown as CallableHandler
    await handler.run({
      auth: { uid: 'caller-uid' },
      data: { registrationId: 'reg-1' },
    })

    // Un seul tx.update ciblant le member.
    expect(memberUpdateCalls(tx)).toHaveLength(1)

    const patch = memberUpdate(tx)
    expect(patch).toBeDefined()
    expect(patch?.active).toBe(true)
    expect(patch?.status).toBe('active')
    expect(patch?.archivedAt).toBeNull()
    // Binding guardian fusionné dans le même patch.
    expect(patch?.guardianUserIds).toEqual({ __arrayUnion: ['submitter-uid'] })
  })

  it('does NOT add reactivation fields when member is already active (no regression on binding)', async () => {
    const { tx } = setupFixture({
      registrationFor: 'dependent',
      member: {
        firstName: 'Alice',
        lastName: 'Martin',
        active: true,
        status: 'active',
        archivedAt: null,
        archivedReason: null,
        archivedByUid: null,
        guardianUserIds: [], // binding encore requis
      },
    })
    const handler = mod.confirmRegistration as unknown as CallableHandler
    await handler.run({
      auth: { uid: 'caller-uid' },
      data: { registrationId: 'reg-1' },
    })

    const patch = memberUpdate(tx)
    // Le binding s'applique toujours…
    expect(patch).toBeDefined()
    expect(patch?.guardianUserIds).toEqual({ __arrayUnion: ['submitter-uid'] })
    // …mais aucun champ de réactivation n'est posé (member déjà actif).
    expect(patch).not.toHaveProperty('active')
    expect(patch).not.toHaveProperty('status')
    expect(patch).not.toHaveProperty('archivedAt')
  })

  it('does NOT write a member update when already active and binding already in place', async () => {
    const { tx } = setupFixture({
      registrationFor: 'self',
      member: {
        firstName: 'Alice',
        lastName: 'Martin',
        active: true,
        status: 'active',
        archivedAt: null,
        archivedReason: null,
        archivedByUid: null,
        linkedUserId: 'submitter-uid', // déjà lié → pas de binding
      },
    })
    const handler = mod.confirmRegistration as unknown as CallableHandler
    await handler.run({
      auth: { uid: 'caller-uid' },
      data: { registrationId: 'reg-1' },
    })

    // Aucun tx.update sur le member (patch vide → pas de write).
    expect(memberUpdate(tx)).toBeUndefined()
  })
})
