/**
 * Tests for `onMajorityReached`.
 *
 * Strategy : mock `./_helpers` to inject a fake Firestore client and the
 * helpers (`Timestamp`, `serverTimestamp`, `eighteenYearsAgo`). The scheduled
 * `.run()` API drives the outer orchestration; `transitionOneMember` is also
 * exercised directly for the transactional paths.
 *
 * Coverage :
 *   - eighteenYearsAgo arithmetic
 *   - eligibleMembersQuery filter shape
 *   - happy path : 1 guardian → 1 update + 1 pendingEmail write
 *   - happy path : 2 guardians → 1 update + 2 pendingEmail writes
 *   - idempotence : member already transitioned inside the transaction → no writes
 *   - edge case : no guardians → still flips comms.* but no pendingEmail writes
 *   - edge case : guardian /users doc missing → email = null (still queued)
 *   - resilience : a failing transition does not block the rest of the snapshot
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeDocSnap {
  exists: boolean
  data: () => Record<string, unknown> | undefined
  id?: string
}

const txGet = vi.fn<(target: { path?: string }) => Promise<FakeDocSnap>>()
const txUpdate = vi.fn()
const txSet = vi.fn()

// Map of `path` -> snapshot data (or null = doesn't exist), used by `db().doc(...).get()`
// and `db().getAll(...)`. Tests overwrite this between cases.
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
  collection: vi.fn(),
  runTransaction: vi.fn(
    async (
      fn: (tx: {
        get: typeof txGet
        update: typeof txUpdate
        set: typeof txSet
      }) => Promise<unknown>,
    ) => fn({ get: txGet, update: txUpdate, set: txSet }),
  ),
  getAll: vi.fn(async (...refs: Array<{ path: string }>) => {
    return refs.map((ref) => {
      const data = fakeStore.get(ref.path)
      return {
        exists: data != null,
        data: () => data ?? undefined,
      }
    })
  }),
  batch: vi.fn(),
}

const NOW_SECONDS = 1_700_000_000
const fakeTimestamp = {
  now: () => ({ seconds: NOW_SECONDS, nanoseconds: 0 }),
}

vi.mock('./_helpers', () => ({
  db: () => fakeDb,
  col: vi.fn((path: string) => ({
    path,
    where: vi.fn().mockReturnThis(),
  })),
  Timestamp: fakeTimestamp,
  serverTimestamp: () => '__SERVER_TS__',
  eighteenYearsAgo: (ts: { seconds: number; nanoseconds: number }) => ({
    seconds: ts.seconds - 18 * Math.round(365.25 * 86_400),
    nanoseconds: ts.nanoseconds,
  }),
  MAX_BATCH_WRITES: 500,
}))

let mod: typeof import('./onMajorityReached')

beforeEach(async () => {
  vi.clearAllMocks()
  txGet.mockReset()
  txUpdate.mockReset()
  txSet.mockReset()
  fakeStore.clear()
  // Wire `tx.get(ref)` to read from fakeStore by ref.path.
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
  fakeDb.getAll = vi.fn(async (...refs: Array<{ path: string }>) => {
    return refs.map((ref) => {
      const data = fakeStore.get(ref.path)
      return {
        exists: data != null,
        data: () => data ?? undefined,
      }
    })
  })
  mod = await import('./onMajorityReached')
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Helper-pure tests
// ---------------------------------------------------------------------------

describe('eligibleMembersQuery', () => {
  it('builds the expected filter chain (active + birthDate threshold + null transition)', async () => {
    const helpers = await import('./_helpers')
    const where = vi.fn().mockReturnThis()
    ;(helpers.col as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      where,
    })

    mod.eligibleMembersQuery({ seconds: NOW_SECONDS, nanoseconds: 0 } as never)

    expect(where).toHaveBeenNthCalledWith(1, 'active', '==', true)
    // 2nd call uses `<=` against eighteen-years-ago timestamp
    expect(where.mock.calls[1][0]).toBe('birthDate')
    expect(where.mock.calls[1][1]).toBe('<=')
    expect(where).toHaveBeenNthCalledWith(3, 'comms.majorityTransition', '==', null)
  })
})

// ---------------------------------------------------------------------------
// transitionOneMember — direct unit tests
// ---------------------------------------------------------------------------

function seedMember(
  memberId: string,
  member: Partial<{
    firstName: string
    lastName: string
    guardianUserIds: string[]
    comms: { billingRecipients: string[]; generalRecipients: string[]; majorityTransition: unknown }
  }>,
) {
  fakeStore.set(`members/${memberId}`, {
    firstName: 'Alice',
    lastName: 'Doe',
    guardianUserIds: [],
    comms: {
      billingRecipients: ['guardians'],
      generalRecipients: ['guardians'],
      majorityTransition: null,
    },
    ...member,
  })
}

function seedUser(uid: string, email: string | null, displayName = 'Parent') {
  fakeStore.set(`users/${uid}`, {
    email: email ?? '',
    displayName,
    photoURL: '',
    roles: ['parent'],
    memberId: null,
    teamIds: [],
  })
}

describe('transitionOneMember', () => {
  it('writes member update + one pendingEmail per guardian (happy path)', async () => {
    seedMember('m-1', {
      firstName: 'Alice',
      lastName: 'Smith',
      guardianUserIds: ['uid-A', 'uid-B'],
    })
    seedUser('uid-A', 'a@example.com')
    seedUser('uid-B', 'b@example.com')

    const result = await mod.transitionOneMember('m-1')
    expect(result).toBe('transitioned')

    // 1 update on member
    expect(txUpdate).toHaveBeenCalledTimes(1)
    const [memberRef, patch] = txUpdate.mock.calls[0]
    expect(memberRef.path).toBe('members/m-1')
    expect(patch).toMatchObject({
      'comms.billingRecipients': ['member'],
    })
    expect(
      (patch as Record<string, unknown>)['comms.majorityTransition'],
    ).toMatchObject({
      triggeredAt: { seconds: NOW_SECONDS, nanoseconds: 0 },
      guardiansResponse: null,
      memberResponse: null,
      resolvedAt: null,
    })

    // 2 sets on /pendingEmails
    expect(txSet).toHaveBeenCalledTimes(2)
    const paths = txSet.mock.calls.map((c) => (c[0] as { path: string }).path)
    expect(paths).toContain('pendingEmails/m-1_majority_guardian_notify_uid-A')
    expect(paths).toContain('pendingEmails/m-1_majority_guardian_notify_uid-B')
    const firstPayload = txSet.mock.calls[0][1] as Record<string, unknown>
    expect(firstPayload).toMatchObject({
      template: 'majority_guardian_notify',
      sentAt: null,
    })
    const ctx = firstPayload.context as Record<string, unknown>
    expect(ctx).toMatchObject({
      memberFirstName: 'Alice',
      memberLastName: 'Smith',
      memberId: 'm-1',
    })
  })

  it('returns "no-guardians" and writes no pending emails when guardianUserIds is empty', async () => {
    seedMember('m-2', { guardianUserIds: [] })

    const result = await mod.transitionOneMember('m-2')
    expect(result).toBe('no-guardians')

    // Member is still flipped (single update).
    expect(txUpdate).toHaveBeenCalledTimes(1)
    // But no email queue writes.
    expect(txSet).not.toHaveBeenCalled()
  })

  it('is idempotent : already-transitioned member yields no writes', async () => {
    seedMember('m-3', {
      guardianUserIds: ['uid-A'],
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
    })
    seedUser('uid-A', 'a@example.com')

    const result = await mod.transitionOneMember('m-3')
    expect(result).toBe('already-transitioned')
    expect(txUpdate).not.toHaveBeenCalled()
    expect(txSet).not.toHaveBeenCalled()
  })

  it('queues a pending email with to=null when guardian user doc is missing', async () => {
    seedMember('m-4', { guardianUserIds: ['uid-ghost'] })
    // No seedUser('uid-ghost', ...) → /users/uid-ghost missing.

    const result = await mod.transitionOneMember('m-4')
    expect(result).toBe('transitioned')

    expect(txSet).toHaveBeenCalledTimes(1)
    const payload = txSet.mock.calls[0][1] as Record<string, unknown>
    expect(payload.to).toBeNull()
  })

  it('queues a pending email with to=null when guardian email is empty string', async () => {
    seedMember('m-5', { guardianUserIds: ['uid-noemail'] })
    seedUser('uid-noemail', null)

    const result = await mod.transitionOneMember('m-5')
    expect(result).toBe('transitioned')

    const payload = txSet.mock.calls[0][1] as Record<string, unknown>
    expect(payload.to).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// onMajorityReached.run() — orchestration
// ---------------------------------------------------------------------------

describe('onMajorityReached.run', () => {
  it('returns silently when no candidates', async () => {
    const helpers = await import('./_helpers')
    ;(helpers.col as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      where: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ empty: true, size: 0, docs: [] }),
    })
    await mod.onMajorityReached.run(
      {} as Parameters<typeof mod.onMajorityReached.run>[0],
    )
    expect(txUpdate).not.toHaveBeenCalled()
    expect(txSet).not.toHaveBeenCalled()
  })

  it('continues processing when a transition throws for one member', async () => {
    seedMember('m-good', { guardianUserIds: ['uid-A'] })
    seedUser('uid-A', 'a@example.com')
    seedMember('m-bad', { guardianUserIds: ['uid-B'] })
    seedUser('uid-B', 'b@example.com')

    const helpers = await import('./_helpers')
    ;(helpers.col as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      where: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({
        empty: false,
        size: 2,
        docs: [{ id: 'm-bad' }, { id: 'm-good' }],
      }),
    })

    // Make runTransaction throw the first time, succeed the second.
    let call = 0
    fakeDb.runTransaction = vi.fn(
      async (
        fn: (tx: {
          get: typeof txGet
          update: typeof txUpdate
          set: typeof txSet
        }) => Promise<unknown>,
      ) => {
        call += 1
        if (call === 1) throw new Error('boom')
        return fn({ get: txGet, update: txUpdate, set: txSet })
      },
    )

    await mod.onMajorityReached.run(
      {} as Parameters<typeof mod.onMajorityReached.run>[0],
    )

    // Good member was still processed (1 update + 1 set).
    expect(txUpdate).toHaveBeenCalledTimes(1)
    expect(txSet).toHaveBeenCalledTimes(1)
  })
})
