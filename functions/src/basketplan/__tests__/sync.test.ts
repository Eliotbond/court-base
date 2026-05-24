/**
 * Tests Vitest pour `_sync.ts` (algorithme `applyGame`).
 *
 * On mock Firestore au niveau de l'admin SDK : pas d'emulator nécessaire.
 * Les fixtures XML existantes (`__fixtures__/showLeagueSchedule.xml`,
 * Marly Basket 2LM saison 25/26) fournissent des `Game` réels parsés via
 * `parseLeagueSchedule`.
 *
 * Cas couverts (cf. brief § 5.3 + chantier PR 2) :
 *   1. Création AWAY (game.guestTeamId === link.teamIdInLeague,
 *      pas d'existing) → action 'created-away' + match data correct.
 *   2. AWAY déjà existant (externalGameNumber match) → action
 *      'patched-existing' + patch des arbitres + status played si homologué.
 *   3. Match manuel à enrichir (date proche, opponent fuzzy match
 *      Levenshtein ≤ 2) → action 'linked-manual' + patch des champs external*.
 *   4. Match homologué → status forcé à 'played' (sur patch et sur création).
 *   5. Cas conflit dédup (fuzzy match > seuil) → pas de link, AWAY créé
 *      en plus si guest=us.
 *   6. HOME skip → action 'skipped-home' + reason
 *      'home-creation-deferred-to-pr3'.
 *
 * Tests unitaires bonus :
 *   - `levenshtein` : casses limites (vide, identique, distance 2).
 *   - `fuzzyMatchOpponent` : normalisation lowercase + espaces.
 *   - `endTimePlusTwoHours` : clip à 23:59.
 *   - `basketplanDateToTimestamp` : validation format + minuit UTC.
 *   - `resolveMatchTypeId` : mapping explicit + fallback + cache.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import type {
  BasketplanCompetitionLink,
  MatchData,
} from '@club-app/shared-types'
import { parseLeagueSchedule, type Game } from '../_parsers'
import {
  applyGame,
  basketplanDateToTimestamp,
  emptySyncActionsSummary,
  endTimePlusTwoHours,
  fuzzyMatchOpponent,
  isHomologatedState,
  levenshtein,
  resolveMatchTypeId,
  shiftTimestampHours,
  tallyAction,
  __resetMatchTypeCacheForTests,
  FUZZY_MATCH_THRESHOLD,
  DEFAULT_BASKETPLAN_MATCH_TYPE_NAME,
} from '../_sync'

// ---------------------------------------------------------------------------
// Mocks Firestore (fake admin SDK)
// ---------------------------------------------------------------------------

interface FakeDoc {
  id: string
  data: Record<string, unknown>
  ref: FakeDocRef
}

interface FakeDocRef {
  update: ReturnType<typeof vi.fn>
  id: string
}

interface FakeSnapshot {
  empty: boolean
  docs: FakeDoc[]
}

interface FakeQuery {
  where: (field: string, op: string, value: unknown) => FakeQuery
  limit: (n: number) => FakeQuery
  get: () => Promise<FakeSnapshot>
}

interface FakeCollection extends FakeQuery {
  add: ReturnType<typeof vi.fn>
}

interface FakeDocAccess {
  get: () => Promise<{
    exists: boolean
    data: () => Record<string, unknown>
  }>
}

/**
 * Construit un mock Firestore minimal :
 *  - `collection('matches')` retourne un faux query builder qui filtre la
 *    liste `matchesStore` en fonction des `where` chaînés.
 *  - `collection('matchTypes')` permet de simuler le fallback resolveMatchTypeId.
 *  - `doc('config/club')` retourne le `clubConfig` injecté.
 *  - `add(...)` push dans `matchesStore` (avec un id auto-incrémenté).
 */
function makeFakeFirestore(opts: {
  matchesStore: FakeDoc[]
  matchTypesStore: FakeDoc[]
  clubConfig?: Record<string, unknown>
  addedMatches?: Array<Record<string, unknown>>
  addedMatchTypes?: Array<Record<string, unknown>>
}): FirebaseFirestore.Firestore {
  let nextMatchId = 1
  let nextMatchTypeId = 1

  const buildQuery = (store: FakeDoc[]): FakeQuery => {
    const filters: Array<(d: FakeDoc) => boolean> = []
    let limitN: number | null = null
    const q: FakeQuery = {
      where(field, op, value) {
        filters.push((d) => {
          const v = d.data[field]
          if (op === '==') return v === value
          if (op === '>=' && typeof v === 'object' && v != null && 'toMillis' in (v as object)) {
            return (
              (v as FirebaseFirestore.Timestamp).toMillis() >=
              (value as FirebaseFirestore.Timestamp).toMillis()
            )
          }
          if (op === '<=' && typeof v === 'object' && v != null && 'toMillis' in (v as object)) {
            return (
              (v as FirebaseFirestore.Timestamp).toMillis() <=
              (value as FirebaseFirestore.Timestamp).toMillis()
            )
          }
          return false
        })
        return q
      },
      limit(n) {
        limitN = n
        return q
      },
      async get() {
        let docs = store.filter((d) => filters.every((f) => f(d)))
        if (limitN != null) docs = docs.slice(0, limitN)
        // Expose `data` comme une fonction (cf. API
        // `QueryDocumentSnapshot.data()` de Firestore).
        const wrapped = docs.map((d) => ({
          id: d.id,
          ref: d.ref,
          data: () => d.data,
        }))
        return {
          empty: wrapped.length === 0,
          docs: wrapped as unknown as FakeDoc[],
        }
      },
    }
    return q
  }

  const collection = (name: string): FakeCollection => {
    if (name === 'matches') {
      const q = buildQuery(opts.matchesStore)
      return {
        ...q,
        add: vi.fn(async (data: Record<string, unknown>) => {
          const id = `m-${nextMatchId++}`
          opts.addedMatches?.push(data)
          opts.matchesStore.push({
            id,
            data,
            ref: { update: vi.fn(), id },
          })
          return { id, path: `matches/${id}` }
        }),
      }
    }
    if (name === 'matchTypes') {
      const q = buildQuery(opts.matchTypesStore)
      return {
        ...q,
        add: vi.fn(async (data: Record<string, unknown>) => {
          const id = `mt-${nextMatchTypeId++}`
          opts.addedMatchTypes?.push(data)
          opts.matchTypesStore.push({
            id,
            data,
            ref: { update: vi.fn(), id },
          })
          return { id, path: `matchTypes/${id}` }
        }),
      }
    }
    throw new Error(`Unknown collection in mock: ${name}`)
  }

  const doc = (path: string): FakeDocAccess => {
    if (path === 'config/club') {
      return {
        async get() {
          return {
            exists: opts.clubConfig != null,
            data: () => opts.clubConfig ?? {},
          }
        },
      }
    }
    throw new Error(`Unknown doc in mock: ${path}`)
  }

  return {
    collection,
    doc,
  } as unknown as FirebaseFirestore.Firestore
}

// ---------------------------------------------------------------------------
// Fixture loader
// ---------------------------------------------------------------------------

const FIXTURES = join(__dirname, '__fixtures__')

function loadGames(): Game[] {
  const xml = readFileSync(join(FIXTURES, 'showLeagueSchedule.xml'), 'utf8')
  return parseLeagueSchedule(xml).games
}

function makeLink(overrides: Partial<BasketplanCompetitionLink> = {}): BasketplanCompetitionLink {
  return {
    id: 'link-1',
    federationId: 9,
    federationCode: 'AFBB',
    leagueHoldingId: 10584,
    leagueHoldingName: '2LM - Saison 25/26 - Phase préliminaire',
    season: '25/26',
    teamIdInLeague: 6570, // Marly Basket dans cette ligue (cf. fixture)
    teamNameInLeague: 'Marly Basket',
    active: true,
    addedAt: { seconds: 0, nanoseconds: 0 },
    addedBy: 'u-eliot',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Unit tests : helpers
// ---------------------------------------------------------------------------

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('marly', 'marly')).toBe(0)
  })

  it('returns the length when one side is empty', () => {
    expect(levenshtein('', 'marly')).toBe(5)
    expect(levenshtein('marly', '')).toBe(5)
  })

  it('returns distance for 1 substitution', () => {
    expect(levenshtein('marly', 'marlz')).toBe(1)
  })

  it('returns distance for 2 inserts', () => {
    expect(levenshtein('bulle', 'bulles')).toBe(1)
    expect(levenshtein('bulle', 'bullets')).toBe(2)
  })

  it('handles longer strings symmetrically', () => {
    expect(levenshtein('Marly Basket', 'Marly Bsket')).toBe(1)
    expect(levenshtein('Marly Bsket', 'Marly Basket')).toBe(1)
  })
})

describe('fuzzyMatchOpponent', () => {
  it('returns Infinity for null inputs', () => {
    expect(fuzzyMatchOpponent(null, 'Marly')).toBe(Number.POSITIVE_INFINITY)
    expect(fuzzyMatchOpponent('Marly', null)).toBe(Number.POSITIVE_INFINITY)
  })

  it('normalizes case before comparing', () => {
    expect(fuzzyMatchOpponent('MARLY', 'marly')).toBe(0)
  })

  it('normalizes whitespace before comparing', () => {
    expect(fuzzyMatchOpponent('Marly  Basket', 'Marly Basket')).toBe(0)
  })

  it('returns small distance for typos', () => {
    expect(fuzzyMatchOpponent('Marly Bsket', 'Marly Basket')).toBe(1)
  })
})

describe('endTimePlusTwoHours', () => {
  it('adds 2 hours to a standard start time', () => {
    expect(endTimePlusTwoHours('20:00')).toBe('22:00')
    expect(endTimePlusTwoHours('14:30')).toBe('16:30')
  })

  it('clips to 23:59 when crossing midnight', () => {
    expect(endTimePlusTwoHours('22:30')).toBe('23:59')
    expect(endTimePlusTwoHours('23:00')).toBe('23:59')
  })

  it('returns 22:00 default for invalid input', () => {
    expect(endTimePlusTwoHours(null)).toBe('22:00')
    expect(endTimePlusTwoHours('garbage')).toBe('22:00')
  })
})

describe('basketplanDateToTimestamp', () => {
  it('returns null on invalid format', () => {
    expect(basketplanDateToTimestamp('not-a-date')).toBeNull()
    expect(basketplanDateToTimestamp('2025/10/01')).toBeNull()
  })

  it('returns a Timestamp at UTC midnight', () => {
    const ts = basketplanDateToTimestamp('2025-10-01')
    expect(ts).not.toBeNull()
    const d = ts!.toDate()
    expect(d.getUTCFullYear()).toBe(2025)
    expect(d.getUTCMonth()).toBe(9) // 0-indexed → Oct
    expect(d.getUTCDate()).toBe(1)
    expect(d.getUTCHours()).toBe(0)
    expect(d.getUTCMinutes()).toBe(0)
  })

  it('shiftTimestampHours moves forward/backward', () => {
    const ts = basketplanDateToTimestamp('2025-10-01')!
    const plus24 = shiftTimestampHours(ts, 24)
    const minus24 = shiftTimestampHours(ts, -24)
    expect(plus24.toMillis() - ts.toMillis()).toBe(24 * 3600 * 1000)
    expect(ts.toMillis() - minus24.toMillis()).toBe(24 * 3600 * 1000)
  })
})

describe('isHomologatedState', () => {
  it('matches "homologué" (with accent)', () => {
    expect(isHomologatedState('homologué')).toBe(true)
    expect(isHomologatedState('Homologué')).toBe(true)
  })

  it('matches "homologue" (without accent)', () => {
    expect(isHomologatedState('homologue')).toBe(true)
  })

  it('does not match "joué"', () => {
    expect(isHomologatedState('joué')).toBe(false)
  })

  it('does not match empty/null', () => {
    expect(isHomologatedState(null)).toBe(false)
    expect(isHomologatedState('')).toBe(false)
  })
})

describe('tallyAction', () => {
  it('counts each action category', () => {
    const s = emptySyncActionsSummary()
    tallyAction(s, { action: 'created-away', matchId: 'a' })
    tallyAction(s, { action: 'patched-existing', matchId: 'b' })
    tallyAction(s, { action: 'linked-manual', matchId: 'c', confidence: 1 })
    tallyAction(s, { action: 'skipped-home', reason: 'home-creation-deferred-to-pr3' })
    tallyAction(s, { action: 'skipped-noise', reason: 'foo' })
    expect(s).toEqual({
      processed: 5,
      patched: 1,
      linked: 1,
      created: 1,
      skipped: 2,
      errors: 0,
    })
  })

  it('respects threshold constant', () => {
    expect(FUZZY_MATCH_THRESHOLD).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// resolveMatchTypeId
// ---------------------------------------------------------------------------

describe('resolveMatchTypeId', () => {
  beforeEach(() => {
    __resetMatchTypeCacheForTests()
  })

  it('uses explicit mapping when present', async () => {
    const matchesStore: FakeDoc[] = []
    const matchTypesStore: FakeDoc[] = []
    const firestore = makeFakeFirestore({
      matchesStore,
      matchTypesStore,
      clubConfig: {
        basketplan: {
          matchTypeMapping: { AFBB: 'mt-explicit-afbb' },
        },
      },
    })
    const id = await resolveMatchTypeId(makeLink(), {
      firestoreOverride: firestore,
    })
    expect(id).toBe('mt-explicit-afbb')
  })

  it('falls back to existing default matchType when no mapping', async () => {
    const matchesStore: FakeDoc[] = []
    const matchTypesStore: FakeDoc[] = [
      {
        id: 'mt-fallback',
        data: { name: DEFAULT_BASKETPLAN_MATCH_TYPE_NAME },
        ref: { update: vi.fn(), id: 'mt-fallback' },
      },
    ]
    const firestore = makeFakeFirestore({
      matchesStore,
      matchTypesStore,
      clubConfig: {},
    })
    const id = await resolveMatchTypeId(makeLink(), {
      firestoreOverride: firestore,
    })
    expect(id).toBe('mt-fallback')
  })

  it('creates default matchType when none exists', async () => {
    const matchesStore: FakeDoc[] = []
    const matchTypesStore: FakeDoc[] = []
    const addedMatchTypes: Array<Record<string, unknown>> = []
    const firestore = makeFakeFirestore({
      matchesStore,
      matchTypesStore,
      clubConfig: {},
      addedMatchTypes,
    })
    const id = await resolveMatchTypeId(makeLink(), {
      firestoreOverride: firestore,
    })
    expect(id).toBe('mt-1')
    expect(addedMatchTypes).toHaveLength(1)
    expect(addedMatchTypes[0]).toMatchObject({
      name: DEFAULT_BASKETPLAN_MATCH_TYPE_NAME,
      active: true,
    })
  })

  it('caches the resolved matchType (no second lookup)', async () => {
    const matchTypesStore: FakeDoc[] = [
      {
        id: 'mt-cached',
        data: { name: DEFAULT_BASKETPLAN_MATCH_TYPE_NAME },
        ref: { update: vi.fn(), id: 'mt-cached' },
      },
    ]
    const firestore = makeFakeFirestore({
      matchesStore: [],
      matchTypesStore,
      clubConfig: {},
    })
    const id1 = await resolveMatchTypeId(makeLink(), {
      firestoreOverride: firestore,
    })
    // 2e appel — devrait court-circuiter le lookup matchTypes.
    // Si le cache marche, peu importe que `matchTypesStore` soit vidé.
    const matchTypesStore2: FakeDoc[] = []
    const firestore2 = makeFakeFirestore({
      matchesStore: [],
      matchTypesStore: matchTypesStore2,
      clubConfig: {},
    })
    const id2 = await resolveMatchTypeId(makeLink(), {
      firestoreOverride: firestore2,
    })
    expect(id1).toBe('mt-cached')
    expect(id2).toBe('mt-cached') // ← venu du cache
  })
})

// ---------------------------------------------------------------------------
// applyGame — cas obligatoires
// ---------------------------------------------------------------------------

describe('applyGame', () => {
  beforeEach(() => {
    __resetMatchTypeCacheForTests()
  })

  it('creates an AWAY match when team is guest and no existing match', async () => {
    const games = loadGames()
    // Pick a game where Marly (id 6570) is the guest team.
    const awayGame = games.find(
      (g) => g.guestTeam.id === 6570 && g.gameNumber.length > 0,
    )
    expect(awayGame).toBeDefined()

    const addedMatches: Array<Record<string, unknown>> = []
    const matchTypesStore: FakeDoc[] = [
      {
        id: 'mt-default',
        data: { name: DEFAULT_BASKETPLAN_MATCH_TYPE_NAME },
        ref: { update: vi.fn(), id: 'mt-default' },
      },
    ]
    const firestore = makeFakeFirestore({
      matchesStore: [],
      matchTypesStore,
      clubConfig: {},
      addedMatches,
    })

    const res = await applyGame(
      { id: 'team-marly', name: 'Marly Basket' },
      makeLink(),
      awayGame!,
      { firestoreOverride: firestore },
    )

    expect(res.action).toBe('created-away')
    expect(addedMatches).toHaveLength(1)
    const created = addedMatches[0] as MatchData & Record<string, unknown>
    expect(created.kind).toBe('away')
    expect(created.teamId).toBe('team-marly')
    expect(created.bookingId).toBeNull()
    expect(created.externalSource).toBe('basketplan')
    expect(created.externalGameNumber).toBe(awayGame!.gameNumber)
    expect(created.externalLeagueHoldingId).toBe(10584)
    expect(created.matchTypeId).toBe('mt-default')
    expect(created.opponentName).toBe(awayGame!.homeTeam.name)
    expect(created.createdBy).toBe('system:basketplan')
  })

  it('patches an existing match (matched by externalGameNumber)', async () => {
    const games = loadGames()
    const game = games.find((g) => g.gameNumber.length > 0)!
    // Pré-existant : un match avec ce gameNumber.
    const existingRef = { update: vi.fn(), id: 'm-existing' }
    const existing: FakeDoc = {
      id: 'm-existing',
      data: {
        externalGameNumber: game.gameNumber,
        kind: 'away',
        status: 'scheduled',
        teamId: 'team-marly',
        externalSource: 'basketplan',
      } as Record<string, unknown>,
      ref: existingRef,
    }
    const firestore = makeFakeFirestore({
      matchesStore: [existing],
      matchTypesStore: [],
      clubConfig: {},
    })

    const res = await applyGame(
      { id: 'team-marly', name: 'Marly Basket' },
      makeLink(),
      game,
      { firestoreOverride: firestore },
    )

    expect(res.action).toBe('patched-existing')
    if (res.action === 'patched-existing') {
      expect(res.matchId).toBe('m-existing')
    }
    expect(existingRef.update).toHaveBeenCalledTimes(1)
    const patch = existingRef.update.mock.calls[0][0]
    expect(patch).toHaveProperty('externalReferees')
    expect(patch).toHaveProperty('externalResult')
    expect(patch).toHaveProperty('externalLastSyncedAt')
  })

  it('forces status=played on patch when game is homologated', async () => {
    const game: Game = {
      id: 1,
      gameNumber: '25-99999',
      date: '2025-10-05',
      time: '18:00',
      state: 'homologué',
      stateId: 9,
      homeTeam: { id: 1, name: 'Opponent', clubId: 99, clubName: 'Opponent FC' },
      guestTeam: { id: 6570, name: 'Marly Basket', clubId: 60, clubName: 'Marly' },
      location: null,
      referee1Name: 'Ref1',
      referee2Name: null,
      expertName: null,
      result: {
        homeScore: 70,
        guestScore: 80,
        homePoints: 0,
        guestPoints: 2,
        byQuarter: [
          { home: 20, guest: 22 },
          { home: 15, guest: 20 },
          { home: 18, guest: 22 },
          { home: 17, guest: 16 },
        ],
      },
    }
    const existingRef = { update: vi.fn(), id: 'm-existing' }
    const existing: FakeDoc = {
      id: 'm-existing',
      data: {
        externalGameNumber: '25-99999',
        status: 'scheduled',
      } as Record<string, unknown>,
      ref: existingRef,
    }
    const firestore = makeFakeFirestore({
      matchesStore: [existing],
      matchTypesStore: [],
      clubConfig: {},
    })

    const res = await applyGame(
      { id: 'team-marly', name: 'Marly Basket' },
      makeLink(),
      game,
      { firestoreOverride: firestore },
    )
    expect(res.action).toBe('patched-existing')
    const patch = existingRef.update.mock.calls[0][0]
    expect(patch.status).toBe('played')
    expect(patch.externalResult).toMatchObject({
      homeScore: 70,
      awayScore: 80,
      homologated: true,
    })
  })

  it('forces status=played on create when game is homologated', async () => {
    const game: Game = {
      id: 2,
      gameNumber: '25-77777',
      date: '2025-10-05',
      time: '18:00',
      state: 'homologué',
      stateId: 9,
      homeTeam: { id: 1, name: 'Opponent', clubId: 99, clubName: 'Opponent FC' },
      guestTeam: { id: 6570, name: 'Marly Basket', clubId: 60, clubName: 'Marly' },
      location: { name: 'Hall', line1: 'Rue X', zip: '1700', city: 'Fribourg' },
      referee1Name: null,
      referee2Name: null,
      expertName: null,
      result: {
        homeScore: 80,
        guestScore: 60,
        homePoints: 2,
        guestPoints: 0,
        byQuarter: [],
      },
    }
    const addedMatches: Array<Record<string, unknown>> = []
    const firestore = makeFakeFirestore({
      matchesStore: [],
      matchTypesStore: [
        {
          id: 'mt-default',
          data: { name: DEFAULT_BASKETPLAN_MATCH_TYPE_NAME },
          ref: { update: vi.fn(), id: 'mt-default' },
        },
      ],
      clubConfig: {},
      addedMatches,
    })

    const res = await applyGame(
      { id: 'team-marly', name: 'Marly Basket' },
      makeLink(),
      game,
      { firestoreOverride: firestore },
    )
    expect(res.action).toBe('created-away')
    const created = addedMatches[0]
    expect(created.status).toBe('played')
  })

  it('links a manual match by fuzzy opponentName match within ±24h', async () => {
    const game: Game = {
      id: 3,
      gameNumber: '25-55555',
      date: '2025-10-05',
      time: '20:00',
      state: 'fixé',
      stateId: 4,
      homeTeam: { id: 1234, name: 'Bulle Basket', clubId: 12, clubName: 'Bulle' },
      guestTeam: { id: 6570, name: 'Marly Basket', clubId: 60, clubName: 'Marly' },
      location: null,
      referee1Name: 'Arbitre A',
      referee2Name: null,
      expertName: null,
      result: null,
    }
    const dateTs = basketplanDateToTimestamp('2025-10-05')!
    const manualRef = { update: vi.fn(), id: 'm-manual' }
    const manual: FakeDoc = {
      id: 'm-manual',
      data: {
        teamId: 'team-marly',
        date: dateTs,
        opponentName: 'Bulle Bsket', // typo distance 1
        status: 'scheduled',
        // pas de externalSource — match créé à la main
      } as Record<string, unknown>,
      ref: manualRef,
    }
    const firestore = makeFakeFirestore({
      matchesStore: [manual],
      matchTypesStore: [],
      clubConfig: {},
    })

    const res = await applyGame(
      { id: 'team-marly', name: 'Marly Basket' },
      makeLink(),
      game,
      { firestoreOverride: firestore },
    )
    expect(res.action).toBe('linked-manual')
    if (res.action === 'linked-manual') {
      expect(res.matchId).toBe('m-manual')
      expect(res.confidence).toBe(1)
    }
    expect(manualRef.update).toHaveBeenCalledTimes(1)
    const patch = manualRef.update.mock.calls[0][0]
    expect(patch.externalSource).toBe('basketplan')
    expect(patch.externalGameNumber).toBe('25-55555')
    expect(patch.externalLeagueHoldingId).toBe(10584)
    expect(patch.externalReferees).toMatchObject({ referee1: 'Arbitre A' })
  })

  it('does not link when fuzzy distance exceeds threshold (creates AWAY instead)', async () => {
    const game: Game = {
      id: 4,
      gameNumber: '25-44444',
      date: '2025-10-05',
      time: '20:00',
      state: 'fixé',
      stateId: 4,
      homeTeam: {
        id: 1234,
        name: 'Bulle Basket',
        clubId: 12,
        clubName: 'Bulle',
      },
      guestTeam: { id: 6570, name: 'Marly', clubId: 60, clubName: 'Marly' },
      location: null,
      referee1Name: null,
      referee2Name: null,
      expertName: null,
      result: null,
    }
    const dateTs = basketplanDateToTimestamp('2025-10-05')!
    const manualRef = { update: vi.fn(), id: 'm-manual' }
    const manual: FakeDoc = {
      id: 'm-manual',
      data: {
        teamId: 'team-marly',
        date: dateTs,
        opponentName: 'Fribourg Olympic', // distance >>> 2 vs "Bulle Basket"
        status: 'scheduled',
      } as Record<string, unknown>,
      ref: manualRef,
    }
    const addedMatches: Array<Record<string, unknown>> = []
    const firestore = makeFakeFirestore({
      matchesStore: [manual],
      matchTypesStore: [
        {
          id: 'mt-default',
          data: { name: DEFAULT_BASKETPLAN_MATCH_TYPE_NAME },
          ref: { update: vi.fn(), id: 'mt-default' },
        },
      ],
      clubConfig: {},
      addedMatches,
    })

    const res = await applyGame(
      { id: 'team-marly', name: 'Marly Basket' },
      makeLink(),
      game,
      { firestoreOverride: firestore },
    )
    expect(res.action).toBe('created-away')
    expect(manualRef.update).not.toHaveBeenCalled()
    expect(addedMatches).toHaveLength(1)
  })

  it('skips HOME games (deferred to PR3)', async () => {
    const game: Game = {
      id: 5,
      gameNumber: '25-33333',
      date: '2025-10-05',
      time: '20:00',
      state: 'fixé',
      stateId: 4,
      homeTeam: { id: 6570, name: 'Marly', clubId: 60, clubName: 'Marly' },
      guestTeam: {
        id: 1234,
        name: 'Bulle Basket',
        clubId: 12,
        clubName: 'Bulle',
      },
      location: null,
      referee1Name: null,
      referee2Name: null,
      expertName: null,
      result: null,
    }
    const addedMatches: Array<Record<string, unknown>> = []
    const firestore = makeFakeFirestore({
      matchesStore: [],
      matchTypesStore: [],
      clubConfig: {},
      addedMatches,
    })

    const res = await applyGame(
      { id: 'team-marly', name: 'Marly Basket' },
      makeLink(),
      game,
      { firestoreOverride: firestore },
    )
    expect(res.action).toBe('skipped-home')
    if (res.action === 'skipped-home') {
      expect(res.reason).toBe('home-creation-deferred-to-pr3')
    }
    expect(addedMatches).toHaveLength(0)
  })

  it('skips noise: missing gameNumber', async () => {
    const game: Game = {
      id: 6,
      gameNumber: '',
      date: '2025-10-05',
      time: null,
      state: '',
      stateId: 0,
      homeTeam: { id: 6570, name: 'Marly', clubId: 60, clubName: 'Marly' },
      guestTeam: {
        id: 1234,
        name: 'Bulle',
        clubId: 12,
        clubName: 'Bulle',
      },
      location: null,
      referee1Name: null,
      referee2Name: null,
      expertName: null,
      result: null,
    }
    const firestore = makeFakeFirestore({
      matchesStore: [],
      matchTypesStore: [],
      clubConfig: {},
    })
    const res = await applyGame(
      { id: 'team-marly', name: 'Marly Basket' },
      makeLink(),
      game,
      { firestoreOverride: firestore },
    )
    expect(res.action).toBe('skipped-noise')
    if (res.action === 'skipped-noise') {
      expect(res.reason).toBe('missing-gameNumber')
    }
  })

  it('ignores already-linked manual matches when searching for a manual candidate', async () => {
    const game: Game = {
      id: 7,
      gameNumber: '25-22222',
      date: '2025-10-05',
      time: '20:00',
      state: 'fixé',
      stateId: 4,
      homeTeam: { id: 8888, name: 'Riviera', clubId: 88, clubName: 'Riviera' },
      guestTeam: { id: 6570, name: 'Marly', clubId: 60, clubName: 'Marly' },
      location: null,
      referee1Name: null,
      referee2Name: null,
      expertName: null,
      result: null,
    }
    const dateTs = basketplanDateToTimestamp('2025-10-05')!
    // Match déjà lié à une autre compétition (gameNumber différent) —
    // doit être ignoré par la passe 2 même si l'opponent matche.
    const otherLinkedRef = { update: vi.fn(), id: 'm-other' }
    const otherLinked: FakeDoc = {
      id: 'm-other',
      data: {
        teamId: 'team-marly',
        date: dateTs,
        opponentName: 'Riviera',
        status: 'scheduled',
        externalSource: 'basketplan',
        externalGameNumber: '25-OTHER',
      } as Record<string, unknown>,
      ref: otherLinkedRef,
    }
    const addedMatches: Array<Record<string, unknown>> = []
    const firestore = makeFakeFirestore({
      matchesStore: [otherLinked],
      matchTypesStore: [
        {
          id: 'mt-default',
          data: { name: DEFAULT_BASKETPLAN_MATCH_TYPE_NAME },
          ref: { update: vi.fn(), id: 'mt-default' },
        },
      ],
      clubConfig: {},
      addedMatches,
    })

    const res = await applyGame(
      { id: 'team-marly', name: 'Marly Basket' },
      makeLink(),
      game,
      { firestoreOverride: firestore },
    )
    expect(res.action).toBe('created-away')
    expect(otherLinkedRef.update).not.toHaveBeenCalled()
  })
})
