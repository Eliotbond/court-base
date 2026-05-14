/**
 * Tests pour `refuseRegistration` — focus sur l'archivage du member quand
 * `registration.matchedMemberId` est présent (trial_in_progress / confirmed /
 * matched registration). Couvre aussi :
 *  - skip archive si matchedMemberId === null
 *  - skip archive si member.exists === false
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

function makeDocRef(path: string) {
  return {
    path,
    collection: (sub: string) => ({
      doc: () => ({ id: 'log-1', path: `${path}/${sub}/log-1` }),
    }),
    get: vi.fn(async (): Promise<FakeDocSnap> => {
      const data = fakeStore.get(path)
      return { exists: data != null, data: () => data ?? undefined }
    }),
  }
}

const fakeDb = {
  doc: vi.fn((path: string) => makeDocRef(path)),
  collection: vi.fn((path: string) => ({
    doc: (id?: string) => ({
      id: id ?? 'auto-id',
      path: `${path}/${id ?? 'auto-id'}`,
    }),
  })),
  runTransaction: vi.fn(),
}

vi.mock('./_helpers', () => ({
  db: () => fakeDb,
  serverTimestamp: () => '__SERVER_TS__',
  Timestamp: {
    now: () => ({ seconds: 1_700_000_000, nanoseconds: 0 }),
    fromMillis: (ms: number) => ({ seconds: Math.floor(ms / 1000), nanoseconds: 0 }),
  },
}))

interface CallableHandler {
  run: (req: {
    auth?: { uid: string } | null
    data: Record<string, unknown>
  }) => Promise<unknown>
}

let mod: typeof import('./refuseRegistration')

function setupBaseFixture(opts: {
  callerRoles: string[]
  callerTeamIds?: string[]
  matchedMemberId: string | null
  memberExists: boolean
}): { tx: FakeTx } {
  fakeStore.clear()
  fakeStore.set('users/caller-uid', {
    roles: opts.callerRoles,
    teamIds: opts.callerTeamIds ?? [],
  })
  const tx: FakeTx = {
    get: vi.fn(async (target: { path?: string }) => {
      const path = target.path ?? ''
      if (path.startsWith('registrations/')) {
        return {
          exists: true,
          data: () => ({
            teamId: 'team-1',
            status: 'trial_in_progress',
            matchedMemberId: opts.matchedMemberId,
            player: { firstName: 'A', lastName: 'B' },
            submittedByUid: 'submitter-uid',
            actionLog: [],
          }),
        }
      }
      if (path.startsWith('teams/')) {
        return {
          exists: true,
          data: () => ({ coachIds: ['caller-uid'] }),
        }
      }
      if (path.startsWith('members/')) {
        return {
          exists: opts.memberExists,
          data: () => (opts.memberExists ? { firstName: 'A', lastName: 'B' } : undefined),
        }
      }
      return { exists: false, data: () => undefined }
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
  fakeDb.collection = vi.fn((path: string) => ({
    doc: (id?: string) => ({ id: id ?? 'auto-id', path: `${path}/${id ?? 'auto'}` }),
  }))
  mod = await import('./refuseRegistration')
})
afterEach(() => vi.restoreAllMocks())

describe('refuseRegistration — member archive side-effect', () => {
  it('archives member when matchedMemberId is set', async () => {
    const { tx } = setupBaseFixture({
      callerRoles: ['coach'],
      callerTeamIds: ['team-1'],
      matchedMemberId: 'm-123',
      memberExists: true,
    })
    const handler = mod.refuseRegistration as unknown as CallableHandler
    await handler.run({
      auth: { uid: 'caller-uid' },
      data: { registrationId: 'reg-1', reason: 'no fit' },
    })
    // Find the tx.update call targeting members/m-123
    const memberCall = tx.update.mock.calls.find((c: unknown[]) => {
      const ref = c[0] as { path?: string } | undefined
      return typeof ref?.path === 'string' && ref.path.startsWith('members/')
    })
    expect(memberCall).toBeDefined()
    if (!memberCall) return
    const payload = memberCall[1] as Record<string, unknown>
    expect(payload.status).toBe('archived')
    expect(payload.archivedReason).toBe('no fit')
    expect(payload.archivedByUid).toBe('caller-uid')
    expect(payload.active).toBe(false)
  })

  it('does NOT archive when matchedMemberId is null', async () => {
    const { tx } = setupBaseFixture({
      callerRoles: ['admin'],
      matchedMemberId: null,
      memberExists: false,
    })
    const handler = mod.refuseRegistration as unknown as CallableHandler
    await handler.run({
      auth: { uid: 'caller-uid' },
      data: { registrationId: 'reg-1', reason: 'no fit' },
    })
    const memberCall = tx.update.mock.calls.find((c: unknown[]) => {
      const ref = c[0] as { path?: string } | undefined
      return typeof ref?.path === 'string' && ref.path.startsWith('members/')
    })
    expect(memberCall).toBeUndefined()
  })

  it('does NOT archive when member doc is missing', async () => {
    const { tx } = setupBaseFixture({
      callerRoles: ['admin'],
      matchedMemberId: 'm-gone',
      memberExists: false,
    })
    const handler = mod.refuseRegistration as unknown as CallableHandler
    await handler.run({
      auth: { uid: 'caller-uid' },
      data: { registrationId: 'reg-1', reason: 'no fit' },
    })
    const memberCall = tx.update.mock.calls.find((c: unknown[]) => {
      const ref = c[0] as { path?: string } | undefined
      return typeof ref?.path === 'string' && ref.path.startsWith('members/')
    })
    expect(memberCall).toBeUndefined()
  })
})
