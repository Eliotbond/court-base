/**
 * Test du gardien d'idempotence du trigger `generateSeasonBookings`.
 *
 * Le trigger doit no-op dans ces cas :
 *  - doc supprimé (after = undefined)
 *  - after.status != 'active'
 *  - before.status == 'active' (déjà active, pas une transition)
 *  - after.generatedAt != null
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('firebase-admin', () => ({
  default: {},
  firestore: Object.assign(() => ({}), {
    Timestamp: { fromDate: (d: Date) => ({ seconds: d.getTime() / 1000, nanoseconds: 0 }) },
    FieldValue: { serverTimestamp: () => '__SERVER_TIMESTAMP__' },
  }),
  initializeApp: vi.fn(),
}))

vi.mock('firebase-functions/v2', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// onDocumentWritten passthrough : on extrait le handler pour l'appeler.
vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentWritten: (_path: string, handler: unknown) => handler,
}))

import { generateSeasonBookings } from './generateSeasonBookings'
import * as helpers from './_helpers'

function tsFromDate(d: Date): FirebaseFirestore.Timestamp {
  return {
    seconds: Math.floor(d.getTime() / 1000),
    nanoseconds: 0,
    toDate: () => new Date(d.getTime()),
  } as unknown as FirebaseFirestore.Timestamp
}

interface SeasonShape {
  status: 'draft' | 'active' | 'archived'
  generatedAt: FirebaseFirestore.Timestamp | null
  activeVenueIds?: string[]
  closurePeriodIds?: string[]
}

function makeEvent(beforeData: SeasonShape | undefined, afterData: SeasonShape | undefined) {
  return {
    params: { seasonId: 'S1' },
    data: {
      before: beforeData ? { data: () => makeSeasonDoc(beforeData) } : undefined,
      after: afterData ? { data: () => makeSeasonDoc(afterData) } : undefined,
    },
  }
}

function makeSeasonDoc(s: SeasonShape) {
  return {
    name: '2025-2026',
    startDate: tsFromDate(helpers.utcMidnight(2025, 8, 1)),
    endDate: tsFromDate(helpers.utcMidnight(2025, 8, 30)),
    status: s.status,
    activeVenueIds: s.activeVenueIds ?? [],
    closurePeriodIds: s.closurePeriodIds ?? [],
    generatedAt: s.generatedAt,
  }
}

let dbCallCount = 0

beforeEach(() => {
  dbCallCount = 0
  vi.spyOn(helpers, 'db').mockImplementation(() => {
    dbCallCount += 1
    // Si la function entre dans `runGeneration`, on aura un appel db() — ce qu'on veut détecter.
    return {} as unknown as FirebaseFirestore.Firestore
  })
})

describe('idempotency guards', () => {
  const handler = generateSeasonBookings as unknown as (event: unknown) => Promise<void>

  it('no-op si after is undefined (delete)', async () => {
    await handler(makeEvent({ status: 'active', generatedAt: null }, undefined))
    expect(dbCallCount).toBe(0)
  })

  it('no-op si after.status != active', async () => {
    await handler(makeEvent({ status: 'draft', generatedAt: null }, { status: 'draft', generatedAt: null }))
    expect(dbCallCount).toBe(0)
  })

  it('no-op si before déjà active (pas une transition vers active)', async () => {
    await handler(
      makeEvent({ status: 'active', generatedAt: null }, { status: 'active', generatedAt: null }),
    )
    expect(dbCallCount).toBe(0)
  })

  it('no-op si after.generatedAt != null', async () => {
    await handler(
      makeEvent(
        { status: 'draft', generatedAt: null },
        { status: 'active', generatedAt: tsFromDate(new Date()) },
      ),
    )
    expect(dbCallCount).toBe(0)
  })

  it('procède si transition draft -> active ET generatedAt null', async () => {
    // Cette transition entre dans runGeneration() qui va appeler db() -> on attend ≥ 1 appel.
    // On laisse le handler crash après le 1er accès db (fake vide) — peu importe, on
    // veut juste prouver que la garde est passée.
    await handler(
      makeEvent(
        { status: 'draft', generatedAt: null },
        {
          status: 'active',
          generatedAt: null,
          activeVenueIds: [],
          closurePeriodIds: [],
        },
      ),
    ).catch(() => {
      // Le fake Firestore vide rendra .collection() undefined → on swallow ici.
    })
    expect(dbCallCount).toBeGreaterThanOrEqual(1)
  })
})
