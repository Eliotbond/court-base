/**
 * Tests for `respondMemberConsent` callable.
 *
 * Coverage :
 *   - input validation (memberId, answer)
 *   - auth required
 *   - permission-denied when caller is not member.linkedUserId
 *   - failed-precondition: transition not initiated
 *   - failed-precondition: guardiansResponse not 'yes'
 *   - failed-precondition: memberResponse already set (idempotence guard)
 *   - happy path 'yes' : generalRecipients=['member','guardians'], resolvedAt
 *   - happy path 'no'  : generalRecipients=['member'], resolvedAt
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

const fakeDb = {
  doc: vi.fn((path: string) => ({ path })),
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

let mod: typeof import('./respondMemberConsent')

beforeEach(async () => {
  vi.clearAllMocks()
  txGet.mockReset()
  txUpdate.mockReset()
  txSet.mockReset()
  fakeStore.clear()

  txGet.mockImplementation(async (ref) => {
    const path = ref.path ?? ''
    const data = fakeStore.get(path)
    return {
      exists: data != null,
      data: () => data ?? undefined,
    }
  })

  fakeDb.doc = vi.fn((path: string) => ({ path }))
  fakeDb.runTransaction = vi.fn(
    async (
      fn: (tx: {
        get: typeof txGet
        update: typeof txUpdate
        set: typeof txSet
      }) => Promise<unknown>,
    ) => fn({ get: txGet, update: txUpdate, set: txSet }),
  )
  mod = await import('./respondMemberConsent')
})

afterEach(() => {
  vi.restoreAllMocks()
})

function seedMember(
  memberId: string,
  member: Partial<{
    linkedUserId: string | null
    guardianUserIds: string[]
    comms: { billingRecipients: string[]; generalRecipients: string[]; majorityTransition: unknown }
  }>,
) {
  fakeStore.set(`members/${memberId}`, {
    firstName: 'X',
    lastName: 'Y',
    guardianUserIds: ['uid-G'],
    linkedUserId: 'uid-MEMBER',
    comms: {
      billingRecipients: ['member'],
      generalRecipients: ['guardians'],
      majorityTransition: {
        triggeredAt: { seconds: NOW_SECONDS - 200, nanoseconds: 0 },
        guardiansResponse: {
          answer: 'yes',
          respondedAt: { seconds: NOW_SECONDS - 100, nanoseconds: 0 },
          respondedByUid: 'uid-G',
        },
        memberResponse: null,
        resolvedAt: null,
      },
    },
    ...member,
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
  } as Parameters<typeof mod.respondMemberConsent.run>[0]
}

describe('respondMemberConsent — input validation & auth', () => {
  it('throws unauthenticated when no auth', async () => {
    await expect(
      mod.respondMemberConsent.run(
        makeRequest({ authUid: null, memberId: 'm-1', answer: 'yes' }),
      ),
    ).rejects.toMatchObject({ code: 'unauthenticated' })
  })

  it('rejects missing memberId', async () => {
    await expect(
      mod.respondMemberConsent.run(
        makeRequest({ authUid: 'uid-MEMBER', memberId: '', answer: 'yes' }),
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it("rejects invalid answer", async () => {
    await expect(
      mod.respondMemberConsent.run(
        makeRequest({ authUid: 'uid-MEMBER', memberId: 'm-1', answer: 'sure' }),
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it('throws not-found when member doc missing', async () => {
    await expect(
      mod.respondMemberConsent.run(
        makeRequest({ authUid: 'uid-MEMBER', memberId: 'm-missing', answer: 'yes' }),
      ),
    ).rejects.toMatchObject({ code: 'not-found' })
  })

  it('throws permission-denied when caller is not linkedUserId', async () => {
    seedMember('m-1', { linkedUserId: 'uid-MEMBER' })
    await expect(
      mod.respondMemberConsent.run(
        makeRequest({ authUid: 'uid-IMPOSTER', memberId: 'm-1', answer: 'yes' }),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' })
  })
})

describe('respondMemberConsent — state preconditions', () => {
  it('throws failed-precondition when transition not initiated', async () => {
    seedMember('m-1', {
      comms: {
        billingRecipients: ['guardians'],
        generalRecipients: ['guardians'],
        majorityTransition: null,
      },
    })
    await expect(
      mod.respondMemberConsent.run(
        makeRequest({ authUid: 'uid-MEMBER', memberId: 'm-1', answer: 'yes' }),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' })
  })

  it('throws failed-precondition when guardians answered "no"', async () => {
    seedMember('m-1', {
      comms: {
        billingRecipients: ['member'],
        generalRecipients: ['member'],
        majorityTransition: {
          triggeredAt: { seconds: NOW_SECONDS - 200, nanoseconds: 0 },
          guardiansResponse: {
            answer: 'no',
            respondedAt: { seconds: NOW_SECONDS - 100, nanoseconds: 0 },
            respondedByUid: 'uid-G',
          },
          memberResponse: null,
          resolvedAt: { seconds: NOW_SECONDS - 100, nanoseconds: 0 },
        },
      },
    })
    await expect(
      mod.respondMemberConsent.run(
        makeRequest({ authUid: 'uid-MEMBER', memberId: 'm-1', answer: 'yes' }),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' })
  })

  it('throws failed-precondition when guardians have not answered yet', async () => {
    seedMember('m-1', {
      comms: {
        billingRecipients: ['member'],
        generalRecipients: ['guardians'],
        majorityTransition: {
          triggeredAt: { seconds: NOW_SECONDS - 200, nanoseconds: 0 },
          guardiansResponse: null,
          memberResponse: null,
          resolvedAt: null,
        },
      },
    })
    await expect(
      mod.respondMemberConsent.run(
        makeRequest({ authUid: 'uid-MEMBER', memberId: 'm-1', answer: 'yes' }),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' })
  })

  it('throws failed-precondition when memberResponse is already recorded', async () => {
    seedMember('m-1', {
      comms: {
        billingRecipients: ['member'],
        generalRecipients: ['member', 'guardians'],
        majorityTransition: {
          triggeredAt: { seconds: NOW_SECONDS - 200, nanoseconds: 0 },
          guardiansResponse: {
            answer: 'yes',
            respondedAt: { seconds: NOW_SECONDS - 100, nanoseconds: 0 },
            respondedByUid: 'uid-G',
          },
          memberResponse: {
            answer: 'yes',
            respondedAt: { seconds: NOW_SECONDS - 50, nanoseconds: 0 },
            respondedByUid: 'uid-MEMBER',
          },
          resolvedAt: { seconds: NOW_SECONDS - 50, nanoseconds: 0 },
        },
      },
    })
    await expect(
      mod.respondMemberConsent.run(
        makeRequest({ authUid: 'uid-MEMBER', memberId: 'm-1', answer: 'no' }),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' })
  })
})

describe('respondMemberConsent — happy paths', () => {
  it("'yes' → generalRecipients=['member','guardians'] + memberResponse + resolvedAt", async () => {
    seedMember('m-1', {})
    const out = await mod.respondMemberConsent.run(
      makeRequest({ authUid: 'uid-MEMBER', memberId: 'm-1', answer: 'yes' }),
    )
    expect(out).toEqual({ ok: true, answer: 'yes' })

    expect(txUpdate).toHaveBeenCalledTimes(1)
    const [ref, patch] = txUpdate.mock.calls[0]
    expect((ref as { path: string }).path).toBe('members/m-1')
    expect(patch).toMatchObject({
      'comms.generalRecipients': ['member', 'guardians'],
      'comms.majorityTransition.memberResponse': {
        answer: 'yes',
        respondedAt: { seconds: NOW_SECONDS, nanoseconds: 0 },
        respondedByUid: 'uid-MEMBER',
      },
      'comms.majorityTransition.resolvedAt': { seconds: NOW_SECONDS, nanoseconds: 0 },
    })
  })

  it("'no' → generalRecipients=['member'] + memberResponse + resolvedAt", async () => {
    seedMember('m-1', {})
    const out = await mod.respondMemberConsent.run(
      makeRequest({ authUid: 'uid-MEMBER', memberId: 'm-1', answer: 'no' }),
    )
    expect(out).toEqual({ ok: true, answer: 'no' })

    const [, patch] = txUpdate.mock.calls[0]
    expect(patch).toMatchObject({
      'comms.generalRecipients': ['member'],
      'comms.majorityTransition.memberResponse': {
        answer: 'no',
        respondedAt: { seconds: NOW_SECONDS, nanoseconds: 0 },
        respondedByUid: 'uid-MEMBER',
      },
      'comms.majorityTransition.resolvedAt': { seconds: NOW_SECONDS, nanoseconds: 0 },
    })
  })
})
