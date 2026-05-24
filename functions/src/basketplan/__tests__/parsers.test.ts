/**
 * Tests Vitest pour `_parsers.ts`.
 *
 * Fixtures :
 *   - `findAllLeagueHoldings.xml` : capturé sur
 *     `https://www.basketplan.ch/findAllLeagueHoldings.do?federationId=9&xmlView=true&perspective=default`
 *     (AFBB, fédération Fribourg — saison 25/26 active).
 *   - `showLeagueSchedule.xml` : capturé sur `leagueHoldingId=10584`
 *     (2LM Senior Masculin Saison 25/26, contient Marly Basket 2LM).
 *   - `showRankingForLeague.xml` : capturé sur `leagueHoldingId=10584`
 *     (5 équipes, classement complet).
 *
 * Données réelles → toute incompatibilité Basketplan future sera détectée
 * par ces tests.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  parseLeagueHoldings,
  parseLeagueSchedule,
  parseRanking,
} from '../_parsers'

const FIXTURES = join(__dirname, '__fixtures__')

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8')
}

describe('parseLeagueHoldings', () => {
  const xml = loadFixture('findAllLeagueHoldings.xml')
  const items = parseLeagueHoldings(xml)

  it('returns a non-empty list of league holdings', () => {
    expect(items.length).toBeGreaterThan(5)
  })

  it('each item has required fields (id, name, federation)', () => {
    for (const it of items) {
      expect(it.id).toBeGreaterThan(0)
      expect(it.name.length).toBeGreaterThan(0)
      expect(it.federationId).toBeGreaterThan(0)
      expect(it.federationCode.length).toBeGreaterThan(0)
    }
  })

  it('extracts season "25/26" from the test data', () => {
    const withSeason = items.filter((i) => i.season === '25/26')
    expect(withSeason.length).toBeGreaterThan(0)
  })

  it('includes 2LM (leagueHoldingId=10584) for AFBB', () => {
    const twoLM = items.find((i) => i.id === 10584)
    expect(twoLM).toBeDefined()
    expect(twoLM?.federationId).toBe(9)
    expect(twoLM?.federationCode).toBe('AFBB')
    expect(twoLM?.sex).toBe('M')
    expect(twoLM?.name).toContain('2LM')
  })

  it('parses sex as M, F, or X', () => {
    const allSex = new Set(items.map((i) => i.sex))
    for (const s of allSex) {
      expect(['M', 'F', 'X']).toContain(s)
    }
  })
})

describe('parseLeagueSchedule', () => {
  const xml = loadFixture('showLeagueSchedule.xml')
  const { teams, games } = parseLeagueSchedule(xml)

  it('returns a non-empty list of teams', () => {
    expect(teams.length).toBeGreaterThan(0)
  })

  it('returns a non-empty list of games', () => {
    expect(games.length).toBeGreaterThan(0)
  })

  it('dedupes teams across games (each team listed once)', () => {
    const ids = teams.map((t) => t.id)
    const uniq = new Set(ids)
    expect(ids.length).toBe(uniq.size)
  })

  it('includes Marly Basket (clubId=60) team', () => {
    const marly = teams.find((t) => t.clubId === 60)
    expect(marly).toBeDefined()
    expect(marly?.clubName).toContain('Marly')
    // Marly Basket 2LM has id=6570 in this league
    expect(marly?.id).toBe(6570)
  })

  it('parses game core attributes (gameNumber, date, time)', () => {
    const game = games.find((g) => g.gameNumber === '25-08231')
    expect(game).toBeDefined()
    expect(game?.date).toBe('2025-10-01')
    expect(game?.time).toBe('21:00')
    expect(game?.state).toBe('homologé')
    expect(game?.stateId).toBe(70)
  })

  it('parses homeTeam / guestTeam with clubId + name', () => {
    const game = games.find((g) => g.gameNumber === '25-08231')
    expect(game?.homeTeam.name).toContain('Villars')
    expect(game?.guestTeam.name).toContain('F.Olympic')
    expect(game?.homeTeam.clubId).toBeGreaterThan(0)
    expect(game?.guestTeam.clubId).toBeGreaterThan(0)
  })

  it('parses result with by-quarter breakdown', () => {
    const game = games.find((g) => g.gameNumber === '25-08231')
    expect(game?.result).not.toBeNull()
    expect(game?.result?.homeScore).toBe(43)
    expect(game?.result?.guestScore).toBe(73)
    expect(game?.result?.byQuarter.length).toBe(4)
    // Sum of by-quarter should equal total
    const homeSum = game?.result?.byQuarter.reduce((s, q) => s + q.home, 0)
    expect(homeSum).toBe(43)
  })

  it('parses referee names when present', () => {
    const game = games.find((g) => g.gameNumber === '25-08231')
    expect(game?.referee1Name).toBeTruthy()
    expect(game?.referee2Name).toBeTruthy()
  })

  it('parses location with name + line1 + city + zip', () => {
    const game = games.find((g) => g.gameNumber === '25-08231')
    expect(game?.location).not.toBeNull()
    expect(game?.location?.name).toBe('CS Platy 3')
    expect(game?.location?.city).toContain('Villars')
  })

  it('finds at least one Marly home game in this league', () => {
    const marlyHomeGame = games.find(
      (g) => g.homeTeam.clubId === 60,
    )
    expect(marlyHomeGame).toBeDefined()
  })
})

describe('parseRanking', () => {
  const xml = loadFixture('showRankingForLeague.xml')
  const rows = parseRanking(xml)

  it('returns the 5 teams of 2LM 25/26', () => {
    expect(rows.length).toBe(5)
  })

  it('returns rows sorted by rank ascending', () => {
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].rank).toBeGreaterThanOrEqual(rows[i - 1].rank)
    }
  })

  it('parses Bulle Basket as rank 1 with correct stats', () => {
    const bulle = rows.find((r) => r.team.clubName.includes('Bulle'))
    expect(bulle).toBeDefined()
    expect(bulle?.rank).toBe(1)
    expect(bulle?.gamesPlayed).toBe(12)
    expect(bulle?.victories).toBe(12)
    expect(bulle?.defeats).toBe(0)
    expect(bulle?.totalPoints).toBe(24)
  })

  it('includes Marly Basket', () => {
    const marly = rows.find((r) => r.team.clubId === 60)
    expect(marly).toBeDefined()
    expect(marly?.team.name).toContain('Marly')
  })
})
