/**
 * Tests for `respondGuardianConsent` callable.
 *
 * Coverage :
 *   - input validation (memberId, answer)
 *   - auth required
 *   - permission-denied when caller is not in guardianUserIds
 *   - precondition failure when transition not initiated
 *   - precondition failure when guardian response already recorded (idempotence)
 *   - happy path 'no' : sets generalRecipients=['member'], resolvedAt set,
 *     no member-confirm email queued
 *   - happy path 'yes' : guardiansResponse set, member-confirm email queued
 *     with deterministic ID
 *   - 'yes' precondition: member.linkedUserId missing → failed-precondition
 *   - 'yes' precondition: linked /users doc missing → failed-precondition
 *   - 'yes' precondition: linked user has no email → failed-precondition
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeDocSnap {
  exists: boolean
  data: () => Record<string, unknown> | undefined
}

const txGet = vi.fn<(target: { path?: string }) => Promise<FakeDocSnap>>()
const txUpdate = vi.fn()
const txSet = vi.fn()

const fakeStore = new Map<string, Record<string, unknown> | null>()

function makeDocRef(path: string) {
  return {
    path,
    get: vi.fn(async (): Promise<FakeDocSnap> => {
      const data = fakeStore.get(path)
      return {
        exists: data != null,
        data: () => data ?? undefined,
      }
    }),
  }
}

const fakeDb = {
  doc: vi.fn((path: string) => makeDocRef(path)),
  runTransaction: vi.fn(
    async (
      fn: (tx: {
        get: typeof txGet
        update: typeof txUpdate
        set: typeof txSet
      }) => Promise<unknown>,
    ) => fn({ get: txGet, update: txUpdate, set: txSet }),
  ),
}

const NOW_SECONDS = 1_700_000_000

vi.mock('./_helpers', () => ({
  db: () => fakeDb,
  Timestamp: { now: () => ({ seconds: NOW_SECONDS, nanoseconds: 0 }) },
  serverTimestamp: () => '__SERVER_TS__',
  col: vi.fn(),
  eighteenYearsAgo: vi.fn(),
  MAX_BATCH_WRITES: 500,
}))

let mod: typeof import('./respondGuardianConsent')

beforeEach(async () => {
  vi.clearAllMocks()
  txGet.mockReset()
  txUpdate.mockReset()
  txSet.mockReset()
  fakeStore.clear()

  // Wire the in-transaction `tx.get(ref)` to read from fakeStore by path.
  txGet.mockImplementation(async (ref) => {
    const path = ref.path ?? ''
    const data = fakeStore.get(path)
    return {
      exists: data != null,
      data: () => data ?? undefined,
    }
  })

  fakeDb.doc = vi.fn((path: string) => makeDocRef(path))
  fakeDb.runTransaction = vi.fn(
    async (
      fn: (tx: {
        get: typeof txGet
        update: typeof txUpdate
        set: typeof txSet
      }) => Promise<unknown>,
    ) => fn({ get: txGet, update: txUpdate, set: txSet }),
  )
  mod = await import('./respondGuardianConsent')
})

afterEach(() => {
  vi.restoreAllMocks()
})

function seedMember(
  memberId: string,
  member: Partial<{
    firstName: string
    lastName: string
    guardianUserIds: string[]
    linkedUserId: string | null
    comms: { billingRecipients: string[]; generalRecipients: string[]; majorityTransition: unknown }
  }>,
) {
  fakeStore.set(`members/${memberId}`, {
    firstName: 'Alice',
    lastName: 'Doe',
    guardianUserIds: [],
    linkedUserId: null,
    comms: {
      billingRecipients: ['member'],
      generalRecipients: ['guardians'],
      majorityTransition: {
        triggeredAt: { seconds: NOW_SECONDS - 100, nanoseconds: 0 },
        guardiansResponse: null,
        memberResponse: null,
        resolvedAt: null,
      },
    },
    ...member,
  })
}

function seedUser(uid: string, email: string | null) {
  fakeStore.set(`users/${uid}`, {
    email: email ?? '',
    displayName: 'X',
    photoURL: '',
    roles: [],
    memberId: null,
    teamIds: [],
  })
}

function makeRequest(opts: {
  authUid?: string | null
  memberId?: unknown
  answer?: unknown
}) {
  return {
    auth: opts.authUid == null ? undefined : { uid: opts.authUid, token: {} },
    data: { memberId: opts.memberId, answer: opts.answer },
  } as Parameters<typeof mod.respondGuardianConsent.run>[0]
}

describe('respondGuardianConsent — input validation & auth', () => {
  it('throws unauthenticated when no auth', async () => {
    await expect(
      mod.respondGuardianConsent.run(
        makeRequest({ authUid: null, memberId: 'm-1', answer: 'yes' }),
      ),
    ).rejects.toMatchObject({ code: 'unauthenticated' })
  })

  it('rejects missing memberId', async () => {
    await expect(
      mod.respondGuardianConsent.run(
        makeRequest({ authUid: 'uid-A', memberId: '', answer: 'yes' }),
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it("rejects answer that is not 'yes' or 'no'", async () => {
    await expect(
      mod.respondGuardianConsent.run(
        makeRequest({ authUid: 'uid-A', memberId: 'm-1', answer: 'maybe' }),
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it('throws not-found when member doc missing', async () => {
    await expect(
      mod.respondGuardianConsent.run(
        makeRequest({ authUid: 'uid-A', memberId: 'm-missing', answer: 'no' }),
      ),
    ).rejects.toMatchObject({ code: 'not-found' })
  })

  it('throws permission-denied when caller is not a guardian', async () => {
    seedMember('m-1', { guardianUserIds: ['uid-OTHER'] })
    await expect(
      mod.respondGuardianConsent.run(
        makeRequest({ authUid: 'uid-A', memberId: 'm-1', answer: 'no' }),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' })
  })
})

describe('respondGuardianConsent — state preconditions', () => {
  it('throws failed-precondition when transition not initiated', async () => {
    seedMember('m-1', {
      guardianUserIds: ['uid-A'],
      comms: {
        billingRecipients: ['guardians'],
        generalRecipients: ['guardians'],
        majorityTransition: null,
      },
    })
    await expect(
      mod.respondGuardianConsent.run(
        makeRequest({ authUid: 'uid-A', memberId: 'm-1', answer: 'no' }),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' })
  })

  it('throws failed-precondition when guardian response already recorded (idempotence guard)', async () => {
    seedMember('m-1', {
      guardianUserIds: ['uid-A'],
      comms: {
        billingRecipients: ['member'],
        generalRecipients: ['guardians'],
        majorityTransition: {
          triggeredAt: { seconds: NOW_SECONDS - 100, nanoseconds: 0 },
          guardiansResponse: {
            answer: 'yes',
            respondedAt: { seconds: NOW_SECONDS - 50, nanoseconds: 0 },
            respondedByUid: 'uid-A',
          },
          memberResponse: null,
          resolvedAt: null,
        },
      },
      linkedUserId: 'uid-MEMBER',
    })
    seedUser('uid-MEMBER', 'member@example.com')

    await expect(
      mod.respondGuardianConsent.run(
        makeRequest({ authUid: 'uid-A', memberId: 'm-1', answer: 'no' }),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' })
  })
})

describe("respondGuardianConsent — answer === 'no'", () => {
  it('writes guardiansResponse + sets generalRecipients=member + resolvedAt; no email queued', async () => {
    seedMember('m-1', { guardianUserIds: ['uid-A'] })

    const out = await mod.respondGuardianConsent.run(
      makeRequest({ authUid: 'uid-A', memberId: 'm-1', answer: 'no' }),
    )
    expect(out).toEqual({ ok: true, answer: 'no' })

    expect(txUpdate).toHaveBeenCalledTimes(1)
    const [ref, patch] = txUpdate.mock.calls[0]
    expect(ref.path).toBe('members/m-1')
    expect(patch).toMatchObject({
      'comms.generalRecipients': ['member'],
      'comms.majorityTransition.guardiansResponse': {
        answer: 'no',
        respondedAt: { seconds: NOW_SECONDS, nanoseconds: 0 },
        respondedByUid: 'uid-A',
      },
      'comms.majorityTransition.resolvedAt': { seconds: NOW_SECONDS, nanoseconds: 0 },
    })

    expect(txSet).not.toHaveBeenCalled()
  })
})

describe("respondGuardianConsent — answer === 'yes'", () => {
  it('writes guardiansResponse and enqueues member-confirm email with deterministic ID', async () => {
    seedMember('m-1', {
      firstName: 'Bob',
      lastName: 'Doe',
      guardianUserIds: ['uid-A'],
      linkedUserId: 'uid-MEMBER',
    })
    seedUser('uid-MEMBER', 'bob@example.com')

    const out = await mod.respondGuardianConsent.run(
      makeRequest({ authUid: 'uid-A', memberId: 'm-1', answer: 'yes' }),
    )
    expect(out).toEqual({ ok: true, answer: 'yes' })

    expect(txUpdate).toHaveBeenCalledTimes(1)
    const [, patch] = txUpdate.mock.calls[0]
    expect(patch).toMatchObject({
      'comms.majorityTransition.guardiansResponse': {
        answer: 'yes',
        respondedAt: { seconds: NOW_SECONDS, nanoseconds: 0 },
        respondedByUid: 'uid-A',
      },
    })
    // No generalRecipients flip yet — that's the member's call in the next step.
    expect((patch as Record<string, unknown>)['comms.generalRecipients']).toBeUndefined()
    expect((patch as Record<string, unknown>)['comms.majorityTransition.resolvedAt']).toBeUndefined()

    expect(txSet).toHaveBeenCalledTimes(1)
    const [emailRef, payload] = txSet.mock.calls[0]
    expect(emailRef.path).toBe('pendingEmails/m-1_majority_member_confirm')
    expect(payload).toMatchObject({
      to: 'bob@example.com',
      template: 'majority_member_confirm',
      sentAt: null,
    })
    expect((payload as Record<string, unknown>).context).toMatchObject({
      memberFirstName: 'Bob',
      memberLastName: 'Doe',
      memberId: 'm-1',
    })
  })

  it('throws failed-precondition when member has no linkedUserId', async () => {
    seedMember('m-1', {
      guardianUserIds: ['uid-A'],
      linkedUserId: null,
    })
    await expect(
      mod.respondGuardianConsent.run(
        makeRequest({ authUid: 'uid-A', memberId: 'm-1', answer: 'yes' }),
      ),
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      message: expect.stringContaining('no linked account'),
    })
    expect(txUpdate).not.toHaveBeenCalled()
    expect(txSet).not.toHaveBeenCalled()
  })

  it('throws failed-precondition when linked /users doc is missing', async () => {
    seedMember('m-1', {
      guardianUserIds: ['uid-A'],
      linkedUserId: 'uid-MEMBER-ghost',
    })
    await expect(
      mod.respondGuardianConsent.run(
        makeRequest({ authUid: 'uid-A', memberId: 'm-1', answer: 'yes' }),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' })
  })

  it('throws failed-precondition when linked user has no email', async () => {
    seedMember('m-1', {
      guardianUserIds: ['uid-A'],
      linkedUserId: 'uid-MEMBER',
    })
    seedUser('uid-MEMBER', null)
    await expect(
      mod.respondGuardianConsent.run(
        makeRequest({ authUid: 'uid-A', memberId: 'm-1', answer: 'yes' }),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' })
  })
})
