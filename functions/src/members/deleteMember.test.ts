/**
 * Tests pour `deleteMember`. Mock Firestore minimaliste, focus sur :
 *  - unauthenticated si pas d'auth
 *  - permission-denied si pas admin
 *  - not-found si member absent
 *  - invalid-argument si confirmName mismatch (et normalisation diacritiques)
 *  - failed-precondition si due paid existe
 *  - happy path : member supprimé, teams nettoyées, regs unlinkées, dues
 *    non-paid supprimés
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// --- Mock firebase-admin pour exposer FieldValue.arrayRemove sans Admin SDK init.
vi.mock('firebase-admin', () => {
  return {
    default: {
      firestore: {
        FieldValue: {
          arrayRemove: (id: string) => ({ __op: 'arrayRemove', value: id }),
          serverTimestamp: () => '__SERVER_TS__',
        },
        Timestamp: {
          now: () => ({ seconds: 1_700_000_000, nanoseconds: 0 }),
        },
      },
    },
    firestore: {
      FieldValue: {
        arrayRemove: (id: string) => ({ __op: 'arrayRemove', value: id }),
        serverTimestamp: () => '__SERVER_TS__',
      },
      Timestamp: {
        now: () => ({ seconds: 1_700_000_000, nanoseconds: 0 }),
      },
    },
  }
})

interface FakeDocSnap {
  exists: boolean
  data: () => Record<string, unknown> | undefined
}

interface FakeQuerySnap {
  docs: { id: string; ref: { path: string }; data: () => Record<string, unknown> }[]
}

interface FakeTx {
  get: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

// Store partagé : path -> data (null = doc inexistant).
const fakeStore = new Map<string, Record<string, unknown> | null>()
// Indexes pour les `where` queries.
const fakeQueryIndex = new Map<string, FakeQuerySnap>()

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
        return fakeQueryIndex.get(key) ?? { docs: [] }
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
  },
  normalizeName: (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim()
      .toLowerCase(),
}))

interface CallableHandler {
  run: (req: {
    auth?: { uid: string } | null
    data: Record<string, unknown>
  }) => Promise<unknown>
}

let mod: typeof import('./deleteMember')

interface SetupOpts {
  callerRoles?: string[]
  callerExists?: boolean
  memberExists?: boolean
  memberFirstName?: string
  memberLastName?: string
  dues?: { id: string; status: string }[]
  teamsAsPlayer?: { id: string; playerIds: string[]; coachIds: string[] }[]
  teamsAsCoach?: { id: string; playerIds: string[]; coachIds: string[] }[]
  registrations?: {
    id: string
    matchedMemberId: string | null
    status: string
    actionLog?: unknown[]
  }[]
}

function setupFixture(opts: SetupOpts): { tx: FakeTx } {
  fakeStore.clear()
  fakeQueryIndex.clear()

  // Caller user doc.
  if (opts.callerExists !== false) {
    fakeStore.set('users/caller-uid', {
      roles: opts.callerRoles ?? ['admin'],
    })
  }

  // Member doc.
  if (opts.memberExists !== false) {
    fakeStore.set('members/m-1', {
      firstName: opts.memberFirstName ?? 'Alice',
      lastName: opts.memberLastName ?? 'Martin',
    })
  }

  // Dues query result.
  const dueDocs = (opts.dues ?? []).map((d) => ({
    id: d.id,
    ref: { path: `dues/${d.id}` },
    data: () => ({ status: d.status, memberId: 'm-1' }),
  }))
  fakeQueryIndex.set('dues|memberId|==|m-1', { docs: dueDocs })
  // Chaque due existe aussi dans le store (sera lu par tx.delete indirect).
  for (const d of opts.dues ?? []) {
    fakeStore.set(`dues/${d.id}`, { status: d.status, memberId: 'm-1' })
  }

  // Teams queries.
  fakeQueryIndex.set('teams|playerIds|array-contains|m-1', {
    docs: (opts.teamsAsPlayer ?? []).map((t) => ({
      id: t.id,
      ref: { path: `teams/${t.id}` },
      data: () => ({ playerIds: t.playerIds, coachIds: t.coachIds }),
    })),
  })
  fakeQueryIndex.set('teams|coachIds|array-contains|m-1', {
    docs: (opts.teamsAsCoach ?? []).map((t) => ({
      id: t.id,
      ref: { path: `teams/${t.id}` },
      data: () => ({ playerIds: t.playerIds, coachIds: t.coachIds }),
    })),
  })
  for (const t of [...(opts.teamsAsPlayer ?? []), ...(opts.teamsAsCoach ?? [])]) {
    fakeStore.set(`teams/${t.id}`, {
      playerIds: t.playerIds,
      coachIds: t.coachIds,
    })
  }

  // Registrations query.
  fakeQueryIndex.set('registrations|matchedMemberId|==|m-1', {
    docs: (opts.registrations ?? []).map((r) => ({
      id: r.id,
      ref: { path: `registrations/${r.id}` },
      data: () => ({
        matchedMemberId: r.matchedMemberId,
        status: r.status,
        actionLog: r.actionLog ?? [],
      }),
    })),
  })
  for (const r of opts.registrations ?? []) {
    fakeStore.set(`registrations/${r.id}`, {
      matchedMemberId: r.matchedMemberId,
      status: r.status,
      actionLog: r.actionLog ?? [],
    })
  }

  // Transaction simulée : lookup dans le store pour chaque tx.get.
  const tx: FakeTx = {
    get: vi.fn(async (target: { path?: string }): Promise<FakeDocSnap> => {
      const path = target.path ?? ''
      const data = fakeStore.get(path)
      return { exists: data != null, data: () => data ?? undefined }
    }),
    update: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  }
  fakeDb.runTransaction = vi.fn(async (fn: (t: FakeTx) => Promise<unknown>) => fn(tx))
  return { tx }
}

beforeEach(async () => {
  vi.clearAllMocks()
  fakeDb.doc = vi.fn((path: string) => makeDocRef(path))
  fakeDb.collection = vi.fn((path: string) => makeCollectionRef(path))
  mod = await import('./deleteMember')
})
afterEach(() => vi.restoreAllMocks())

async function callDelete(
  args: { auth?: { uid: string } | null; data: Record<string, unknown> },
): Promise<{ ok: boolean; error?: { code: string; message: string } }> {
  const handler = mod.deleteMember as unknown as CallableHandler
  try {
    const out = (await handler.run(args)) as { ok: true }
    return { ok: out.ok === true }
  } catch (err) {
    const e = err as { code?: string; message?: string }
    return {
      ok: false,
      error: { code: e.code ?? 'unknown', message: e.message ?? '' },
    }
  }
}

describe('deleteMember — guards', () => {
  it('throws unauthenticated when not signed-in', async () => {
    setupFixture({})
    const res = await callDelete({
      auth: null,
      data: { memberId: 'm-1', confirmName: 'Alice Martin' },
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('unauthenticated')
  })

  it('throws permission-denied when caller is not admin', async () => {
    setupFixture({ callerRoles: ['coach'] })
    const res = await callDelete({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', confirmName: 'Alice Martin' },
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('permission-denied')
  })

  it('throws permission-denied for treasurer alone (no admin)', async () => {
    setupFixture({ callerRoles: ['treasurer'] })
    const res = await callDelete({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', confirmName: 'Alice Martin' },
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('permission-denied')
  })

  it('throws not-found when member does not exist', async () => {
    setupFixture({ memberExists: false })
    const res = await callDelete({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', confirmName: 'Alice Martin' },
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('not-found')
  })

  it('throws invalid-argument when confirmName does not match', async () => {
    setupFixture({})
    const res = await callDelete({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', confirmName: 'Bob Dupont' },
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('invalid-argument')
    expect(res.error?.message).toContain('Le nom de confirmation ne correspond pas')
  })

  it('accepts confirmName regardless of diacritics and casing', async () => {
    setupFixture({
      memberFirstName: 'François',
      memberLastName: 'Müller',
    })
    const res = await callDelete({
      auth: { uid: 'caller-uid' },
      // tape "francois muller" — sans accents, lowercase.
      data: { memberId: 'm-1', confirmName: '  francois muller  ' },
    })
    expect(res.ok).toBe(true)
  })

  it('throws failed-precondition when a paid due exists', async () => {
    setupFixture({
      dues: [
        { id: 'due-1', status: 'paid' },
        { id: 'due-2', status: 'issued' },
      ],
    })
    const res = await callDelete({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', confirmName: 'Alice Martin' },
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('failed-precondition')
    expect(res.error?.message).toContain('archive')
  })
})

describe('deleteMember — happy path', () => {
  it('cleans up teams, unlinks registrations, deletes non-paid dues, deletes member', async () => {
    const { tx } = setupFixture({
      dues: [
        { id: 'due-1', status: 'issued' },
        { id: 'due-2', status: 'pending_grace' },
        { id: 'due-3', status: 'cancelled' },
      ],
      teamsAsPlayer: [
        { id: 't-1', playerIds: ['m-1', 'm-99'], coachIds: [] },
      ],
      teamsAsCoach: [
        { id: 't-2', playerIds: [], coachIds: ['m-1'] },
      ],
      registrations: [
        { id: 'reg-1', matchedMemberId: 'm-1', status: 'trial_in_progress' },
        { id: 'reg-2', matchedMemberId: 'm-1', status: 'refused' },
      ],
    })

    const res = await callDelete({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', confirmName: 'Alice Martin' },
    })
    expect(res.ok).toBe(true)

    // Member supprimé.
    const deletedPaths = tx.delete.mock.calls.map(
      (c: unknown[]) => (c[0] as { path?: string }).path ?? '',
    )
    expect(deletedPaths).toContain('members/m-1')

    // 3 dues supprimés + 2 pendingEmails par due (best-effort).
    expect(deletedPaths).toContain('dues/due-1')
    expect(deletedPaths).toContain('dues/due-2')
    expect(deletedPaths).toContain('dues/due-3')
    expect(deletedPaths).toContain('pendingEmails/due-1_dues_payment_request')
    expect(deletedPaths).toContain('pendingEmails/due-1_dues_payment_confirmed')

    // Teams nettoyées : 1 update sur t-1 (playerIds) + 1 sur t-2 (coachIds).
    const teamUpdates = tx.update.mock.calls.filter((c: unknown[]) => {
      const ref = c[0] as { path?: string }
      return (ref.path ?? '').startsWith('teams/')
    })
    expect(teamUpdates).toHaveLength(2)
    const t1Patch = teamUpdates.find(
      (c: unknown[]) => (c[0] as { path?: string }).path === 'teams/t-1',
    )?.[1] as Record<string, unknown> | undefined
    expect(t1Patch?.playerIds).toEqual({ __op: 'arrayRemove', value: 'm-1' })
    expect(t1Patch?.coachIds).toBeUndefined()
    const t2Patch = teamUpdates.find(
      (c: unknown[]) => (c[0] as { path?: string }).path === 'teams/t-2',
    )?.[1] as Record<string, unknown> | undefined
    expect(t2Patch?.coachIds).toEqual({ __op: 'arrayRemove', value: 'm-1' })
    expect(t2Patch?.playerIds).toBeUndefined()

    // Registrations : `matchedMemberId = null`, status préservé,
    // actionLog augmenté.
    const regUpdates = tx.update.mock.calls.filter((c: unknown[]) => {
      const ref = c[0] as { path?: string }
      return (ref.path ?? '').startsWith('registrations/')
    })
    expect(regUpdates).toHaveLength(2)
    for (const c of regUpdates) {
      const patch = c[1] as { matchedMemberId: unknown; actionLog: unknown[] }
      expect(patch.matchedMemberId).toBeNull()
      expect(Array.isArray(patch.actionLog)).toBe(true)
      const last = patch.actionLog[patch.actionLog.length - 1] as {
        action: string
        previousStatus: string
        newStatus: string
        byUid: string
        note: string
      }
      expect(last.action).toBe('status_changed')
      expect(last.previousStatus).toBe(last.newStatus)
      expect(last.byUid).toBe('caller-uid')
      expect(last.note).toContain('matched member deleted')
    }
  })

  it('returns correct counts in the output payload', async () => {
    setupFixture({
      dues: [
        { id: 'due-1', status: 'issued' },
        { id: 'due-2', status: 'pending_grace' },
      ],
      teamsAsPlayer: [
        { id: 't-1', playerIds: ['m-1'], coachIds: [] },
      ],
      teamsAsCoach: [],
      registrations: [
        { id: 'reg-1', matchedMemberId: 'm-1', status: 'submitted' },
      ],
    })
    const handler = mod.deleteMember as unknown as CallableHandler
    const out = (await handler.run({
      auth: { uid: 'caller-uid' },
      data: { memberId: 'm-1', confirmName: 'Alice Martin' },
    })) as {
      ok: true
      memberId: string
      removedFromTeamsCount: number
      unlinkedRegistrationsCount: number
      deletedDuesCount: number
    }
    expect(out.ok).toBe(true)
    expect(out.memberId).toBe('m-1')
    expect(out.removedFromTeamsCount).toBe(1)
    expect(out.unlinkedRegistrationsCount).toBe(1)
    expect(out.deletedDuesCount).toBe(2)
  })
})
