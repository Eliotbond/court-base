/**
 * Tests pour `onTrialExpired`.
 *
 * Couvre :
 *   - composeTrialExpiredNotifs : un par coach + un parent ; absence de team
 *     → seule la notif parent ; idempotence des ids.
 *   - processExpiredTrials : pas de docs → no-op ; flux normal → écritures sur
 *     /notifications ; cap MAX_REGISTRATIONS_PER_RUN ; team manquante.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RegistrationData, TeamData } from '@club-app/shared-types'

type StoredNotif = Record<string, unknown>
const notifStore = new Map<string, StoredNotif>()

// État configurable par test pour la query registrations et le lookup team.
let registrationsResult: Array<{ id: string; data: RegistrationData }> = []
let teamLookupResult: Partial<TeamData> | null = null

const fakeQuery = {
  where: vi.fn(() => fakeQuery),
  limit: vi.fn(() => fakeQuery),
  get: vi.fn(async () => ({
    size: registrationsResult.length,
    docs: registrationsResult.map((r) => ({
      id: r.id,
      data: () => r.data,
    })),
  })),
}

const fakeDb = {
  doc: vi.fn((path: string) => ({
    path,
    get: vi.fn(async () => ({
      exists: path.startsWith('teams/') && teamLookupResult != null,
      data: () => teamLookupResult ?? undefined,
    })),
  })),
  collection: vi.fn((path: string) => ({
    doc: (id: string) => ({
      id,
      path: `${path}/${id}`,
      set: vi.fn(async (data: StoredNotif) => {
        notifStore.set(`${path}/${id}`, data)
      }),
    }),
  })),
}

vi.mock('./_helpers', async () => {
  const actual = await vi.importActual<typeof import('./_helpers')>('./_helpers')
  return {
    ...actual,
    db: () => fakeDb,
    col: vi.fn(() => fakeQuery),
    serverTimestamp: () => '__SERVER_TS__',
    Timestamp: actual.Timestamp,
  }
})

let mod: typeof import('./onTrialExpired')

beforeEach(async () => {
  notifStore.clear()
  registrationsResult = []
  teamLookupResult = { name: 'U15F', coachIds: ['coach-mem-1', 'coach-mem-2'] }
  vi.clearAllMocks()
  fakeQuery.where = vi.fn(() => fakeQuery)
  fakeQuery.limit = vi.fn(() => fakeQuery)
  fakeQuery.get = vi.fn(async () => ({
    size: registrationsResult.length,
    docs: registrationsResult.map((r) => ({
      id: r.id,
      data: () => r.data,
    })),
  }))
  fakeDb.doc = vi.fn((path: string) => ({
    path,
    get: vi.fn(async () => ({
      exists: path.startsWith('teams/') && teamLookupResult != null,
      data: () => teamLookupResult ?? undefined,
    })),
  }))
  fakeDb.collection = vi.fn((path: string) => ({
    doc: (id: string) => ({
      id,
      path: `${path}/${id}`,
      set: vi.fn(async (data: StoredNotif) => {
        notifStore.set(`${path}/${id}`, data)
      }),
    }),
  }))
  mod = await import('./onTrialExpired')
})

afterEach(() => vi.restoreAllMocks())

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

function makeReg(overrides: Partial<RegistrationData> = {}): RegistrationData {
  return {
    submittedByUid: 'submitter-uid',
    registrationFor: 'dependent',
    relationship: 'parent',
    relationshipOther: null,
    player: {
      firstName: 'Lina',
      lastName: 'Martin',
      birthDate: { seconds: 1_000_000_000, nanoseconds: 0 },
      gender: 'F',
      avs: '756.1234.5678.90',
      phone: null,
    },
    matchedMemberId: null,
    teamId: 'team-1',
    previouslyLicensed: false,
    previousClubName: null,
    previousClubAbroad: false,
    transferLetterStoragePath: null,
    foreignTransfer: false,
    status: 'trial_in_progress',
    statusUpdatedAt: { seconds: 1_700_000_000, nanoseconds: 0 },
    trialStartedAt: { seconds: 1_699_000_000, nanoseconds: 0 },
    refusalReason: null,
    refusedByUid: null,
    actionLog: [],
    coachNotifiedAt: null,
    adminNotifiedAt: null,
    createdAt: { seconds: 1_699_000_000, nanoseconds: 0 },
    ...overrides,
  } as RegistrationData
}

// -----------------------------------------------------------------------------
// composeTrialExpiredNotifs
// -----------------------------------------------------------------------------

describe('composeTrialExpiredNotifs', () => {
  it('emits one notif per coach + one parent', () => {
    const out = mod.composeTrialExpiredNotifs({
      registrationId: 'reg-1',
      reg: makeReg(),
      team: {
        name: 'U15F',
        coachIds: ['coach-mem-1', 'coach-mem-2'],
      } as unknown as TeamData,
    })
    expect(out.length).toBe(3) // 2 coachs + 1 parent
    expect(out.every((n) => n.type === 'trial_expired_alert')).toBe(true)
    expect(
      out.filter((n) => n.recipientMemberId != null).length,
    ).toBe(2)
    expect(
      out.filter((n) => n.recipientUid === 'submitter-uid').length,
    ).toBe(1)
  })

  it('falls back to parent-only when team is null', () => {
    const out = mod.composeTrialExpiredNotifs({
      registrationId: 'reg-1',
      reg: makeReg(),
      team: null,
    })
    expect(out.length).toBe(1)
    expect(out[0]!.recipientUid).toBe('submitter-uid')
    expect(out[0]!.id).toBe('reg-1_trial_expired_parent')
  })

  it('ids are deterministic (no timestamp suffix)', () => {
    const a = mod.composeTrialExpiredNotifs({
      registrationId: 'reg-9',
      reg: makeReg(),
      team: {
        name: 'X',
        coachIds: ['c1'],
      } as unknown as TeamData,
    })
    const b = mod.composeTrialExpiredNotifs({
      registrationId: 'reg-9',
      reg: makeReg(),
      team: {
        name: 'X',
        coachIds: ['c1'],
      } as unknown as TeamData,
    })
    expect(a.map((n) => n.id).sort()).toEqual(b.map((n) => n.id).sort())
    expect(a.map((n) => n.id)).toContain('reg-9_trial_expired_coach_c1')
    expect(a.map((n) => n.id)).toContain('reg-9_trial_expired_parent')
  })

  it('uses player firstName in the parent title', () => {
    const out = mod.composeTrialExpiredNotifs({
      registrationId: 'reg-1',
      reg: makeReg({
        player: {
          firstName: 'Hugo',
          lastName: 'Doe',
          birthDate: { seconds: 1, nanoseconds: 0 },
          gender: 'M',
          avs: '756.0000.0000.00',
          phone: null,
        },
      }),
      team: { name: 'X', coachIds: [] } as unknown as TeamData,
    })
    const parent = out.find((n) => n.recipientUid)
    expect(parent?.title).toContain('Hugo')
  })
})

// -----------------------------------------------------------------------------
// processExpiredTrials — flow d'orchestration
// -----------------------------------------------------------------------------

describe('processExpiredTrials', () => {
  it('no-ops when no registrations match', async () => {
    registrationsResult = []
    const res = await mod.processExpiredTrials()
    expect(res).toEqual({ scanned: 0, fanoutCount: 0, cappedAtLimit: false })
    expect(notifStore.size).toBe(0)
  })

  it('writes notifs for each registration found', async () => {
    registrationsResult = [
      { id: 'reg-A', data: makeReg() },
      { id: 'reg-B', data: makeReg() },
    ]
    const res = await mod.processExpiredTrials()
    expect(res.scanned).toBe(2)
    // 2 coachs + 1 parent = 3 par reg → 6 notifs.
    expect(res.fanoutCount).toBe(6)
    expect(res.cappedAtLimit).toBe(false)
    expect(notifStore.size).toBe(6)
    expect(notifStore.has('notifications/reg-A_trial_expired_parent')).toBe(true)
    expect(notifStore.has('notifications/reg-B_trial_expired_coach_coach-mem-1')).toBe(true)
  })

  it('caps at MAX_REGISTRATIONS_PER_RUN (501 → 500 traités, cappedAtLimit=true)', async () => {
    registrationsResult = Array.from({ length: 501 }, (_, i) => ({
      id: `reg-${i}`,
      data: makeReg(),
    }))
    const res = await mod.processExpiredTrials()
    expect(res.scanned).toBe(500)
    expect(res.cappedAtLimit).toBe(true)
  })

  it('falls back to parent-only when team lookup fails', async () => {
    registrationsResult = [{ id: 'reg-1', data: makeReg() }]
    teamLookupResult = null // simule team absente
    const res = await mod.processExpiredTrials()
    expect(res.scanned).toBe(1)
    // Pas de notif coach (team manquante) — seulement parent.
    expect(res.fanoutCount).toBe(1)
    expect(notifStore.has('notifications/reg-1_trial_expired_parent')).toBe(true)
  })

  it('writeNotifs is idempotent — re-run same data produces same docs (set overwrite)', async () => {
    registrationsResult = [{ id: 'reg-1', data: makeReg() }]
    await mod.processExpiredTrials()
    const firstCount = notifStore.size
    await mod.processExpiredTrials()
    // set() overwrite → même nombre de docs.
    expect(notifStore.size).toBe(firstCount)
  })

  it('returns gracefully if the query throws (missing index)', async () => {
    registrationsResult = []
    fakeQuery.get = vi.fn(async () => {
      throw new Error('FAILED_PRECONDITION: index not found')
    })
    const res = await mod.processExpiredTrials()
    expect(res).toEqual({ scanned: 0, fanoutCount: 0, cappedAtLimit: false })
  })
})

// -----------------------------------------------------------------------------
// timestampDaysAgo
// -----------------------------------------------------------------------------

describe('timestampDaysAgo', () => {
  it('subtracts N * 86400 seconds from now', () => {
    const ts = mod.timestampDaysAgo(14)
    const now = Math.floor(Date.now() / 1000)
    // Tolérance large : (now - 14d) ± 5s.
    expect(ts.seconds).toBeGreaterThan(now - 14 * 86_400 - 5)
    expect(ts.seconds).toBeLessThan(now - 14 * 86_400 + 5)
  })
})
