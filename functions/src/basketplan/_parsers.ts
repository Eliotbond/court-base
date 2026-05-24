/**
 * `_parsers.ts` — extracteurs typés du JSON produit par `parseXml` (cf.
 * `_client.ts`) vers des objets domain-friendly :
 *
 *  - `parseLeagueHoldings(xml)` → `LeagueHolding[]` (liste des compétitions
 *    d'une fédération).
 *  - `parseLeagueSchedule(xml)` → `{ teams: ClubTeamInLeague[]; games: Game[] }`
 *    (équipes + matchs d'une compétition).
 *  - `parseRanking(xml)` → `RankingRow[]` (classement live).
 *
 *  Convention : on accepte du XML déjà sous forme string ou déjà parsé en
 *  JS (objet `unknown`). Les normalisations communes (un seul élément vs
 *  array) sont centralisées dans `asArray`.
 *
 *  PR 1 utilise principalement `parseLeagueHoldings` et `parseLeagueSchedule`
 *  (cascade de mapping). `parseRanking` est posé pour la PR 2/3 (affichage
 *  classement live optionnel) — implémentation minimale mais réelle.
 */
import { parseXml } from './_client'

// ---------------------------------------------------------------------------
// Types domain (exportés — consommés par les callables PR 1)
// ---------------------------------------------------------------------------

/**
 * Une compétition Basketplan (championnat ou coupe) — extrait pertinent de
 * `findAllLeagueHoldings.do`. Cache pour le dropdown UI + résolution noms
 * lors du linkage.
 */
export interface LeagueHolding {
  /** Id Basketplan de la compétition. */
  id: number
  /** Nom court ("2LM - Saison 25/26 - Phase préliminaire"). */
  name: string
  /** Nom complet ("2LM 2LM - Saison 25/26 - Phase préliminaire"). */
  fullName: string
  /** Code court de la fédération (ex. "AFBB"). */
  federationCode: string
  /** Id de la fédération (ex. 9). */
  federationId: number
  /** Saison court format (ex. "25/26"). */
  season: string
  /** Sexe (`M` | `F` | `X` mixte). */
  sex: 'M' | 'F' | 'X'
  /** Date début / fin (YYYY-MM-DD). */
  from: string
  to: string
}

/**
 * Une équipe d'un club donné, dans une compétition donnée — extrait du
 * `showLeagueSchedule.do` (déduit des `homeTeam` / `guestTeam` de chaque
 * `<game>`).
 */
export interface ClubTeamInLeague {
  /** Id Basketplan de l'équipe DANS cette ligue (≠ id team club global). */
  id: number
  /** Nom de l'équipe ("Marly Basket 2LM"). */
  name: string
  /** Id Basketplan du club propriétaire. */
  clubId: number
  /** Nom du club ("Marly Basket"). */
  clubName: string
}

/** Identité d'une équipe dans un match parsé. */
export interface GameTeam {
  id: number
  name: string
  clubId: number
  clubName: string
}

/** Score d'un match parsé. `null` quand pas encore joué. */
export interface GameResult {
  homeScore: number
  guestScore: number
  /** Score par quart-temps (4 quarts standard). */
  byQuarter: Array<{ home: number; guest: number }>
  /** Points fédéraux (typiquement 2 = win, 1 = loss, 0 = forfait). */
  homePoints: number
  guestPoints: number
}

/** Un match parsé depuis `showLeagueSchedule.do`. */
export interface Game {
  /** Id Basketplan numérique du match. */
  id: number
  /** Numéro de match fédéral (clé unique stable, ex. "25-08231"). */
  gameNumber: string
  /** Date "YYYY-MM-DD". */
  date: string
  /** Heure "HH:MM" — peut être omise (défaut côté caller). */
  time: string | null
  /** Etat ("homologé", "pas joué", "fixé", "joué", …). */
  state: string
  /** Nom canonique de l'état Basketplan (id numérique). */
  stateId: number
  homeTeam: GameTeam
  guestTeam: GameTeam
  /** Lieu de la rencontre (peut être null pour les matchs futurs sans hall). */
  location: {
    name: string
    line1: string
    zip: string
    city: string
  } | null
  /** Arbitres fédéraux — `null` quand pas désignés. */
  referee1Name: string | null
  referee2Name: string | null
  expertName: string | null
  /** Résultat — `null` quand pas joué / pas saisi. */
  result: GameResult | null
}

/** Une ligne de classement live. */
export interface RankingRow {
  rank: number
  team: ClubTeamInLeague
  gamesPlayed: number
  victories: number
  defeats: number
  totalPoints: number
  scoreFor: number
  scoreAgainst: number
}

// ---------------------------------------------------------------------------
// Helpers d'accès défensifs — fast-xml-parser produit du JS arbitraire
// ---------------------------------------------------------------------------

/**
 * Normalise un noeud XML qui peut être `undefined`, un objet unique, ou un
 * array d'objets, en un array toujours. `null` → `[]`.
 */
function asArray<T>(node: T | T[] | undefined | null): T[] {
  if (node == null) return []
  return Array.isArray(node) ? node : [node]
}

/** Cast défensif vers `Record<string, unknown>`. `null`/non-object → `{}`. */
function asRecord(node: unknown): Record<string, unknown> {
  if (typeof node === 'object' && node !== null && !Array.isArray(node)) {
    return node as Record<string, unknown>
  }
  return {}
}

/** Lecture d'un attribut string (trim, défaut `''` si absent). */
function s(node: Record<string, unknown>, key: string, fallback = ''): string {
  const v = node[key]
  return typeof v === 'string' ? v.trim() : fallback
}

/** Lecture d'un attribut number — défaut `0` si invalide. */
function n(node: Record<string, unknown>, key: string, fallback = 0): number {
  const v = node[key]
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.length > 0) {
    const parsed = Number(v)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
}

/**
 * Lecture d'un attribut number, retournant `null` si absent ou invalide
 * (pour les champs vraiment optionnels — score, expert id, etc.).
 */
function nOrNull(node: Record<string, unknown>, key: string): number | null {
  const v = node[key]
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.length > 0) {
    const parsed = Number(v)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** Lecture d'un attribut string ou `null` si absent / vide. */
function sOrNull(node: Record<string, unknown>, key: string): string | null {
  const v = node[key]
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Accepte une string XML ou un objet déjà parsé. Renvoie toujours un
 * `Record<string, unknown>` qui pointe sur la racine `<basketplan>`.
 *
 * Tolérance au cas où la racine est l'objet `basketplan` directement
 * (selon comment l'appelant a parsé).
 */
function rootBasketplan(xmlOrParsed: string | unknown): Record<string, unknown> {
  const parsed = typeof xmlOrParsed === 'string' ? parseXml(xmlOrParsed) : xmlOrParsed
  const r = asRecord(parsed)
  // Cas standard : { basketplan: {...} }
  if ('basketplan' in r) {
    return asRecord(r.basketplan)
  }
  // Cas dégradé : l'appelant a déjà déballé.
  return r
}

/**
 * Extrait un "season shortName" depuis le `name` ou `fullName` d'un
 * leagueHolding. Pattern récurrent dans Basketplan : "... - Saison 25/26 - ...".
 * Fallback : retourne `''` si pas trouvé (au caller de gérer).
 */
function extractSeasonFromName(name: string): string {
  const m = name.match(/Saison\s+(\d{2}\/\d{2})/i)
  return m ? m[1] : ''
}

// ---------------------------------------------------------------------------
// Parsers publics
// ---------------------------------------------------------------------------

/**
 * Parse la réponse XML de `findAllLeagueHoldings.do?federationId=X`.
 *
 * Structure observée :
 *   <basketplan>
 *     <leagueHoldingList>
 *       <ArrayList>
 *         <leagueHolding id="..." name="..." fullName="..." from="..." to="...">
 *           <league sex="M|F|X" ...>
 *             <federation id="..." shortName="..." />
 *             ...
 *           </league>
 *           <season shortName="25/26" .../>
 *         </leagueHolding>
 *         ...
 *       </ArrayList>
 *     </leagueHoldingList>
 *   </basketplan>
 *
 * Renvoie un array vide si pas de leagueHolding (fédération vide / inexistante).
 */
export function parseLeagueHoldings(xmlOrParsed: string | unknown): LeagueHolding[] {
  const root = rootBasketplan(xmlOrParsed)
  const lhList = asRecord(root.leagueHoldingList)
  const arrayList = asArray(lhList.ArrayList)
  // ArrayList est forcé en array (cf. `_client`). Chaque élément contient
  // potentiellement plusieurs `leagueHolding` (souvent un seul wrapper avec
  // tous les holdings dedans).
  const out: LeagueHolding[] = []
  for (const al of arrayList) {
    const alRec = asRecord(al)
    const holdings = asArray(alRec.leagueHolding)
    for (const lh of holdings) {
      const lhRec = asRecord(lh)
      const league = asRecord(lhRec.league)
      const fed = asRecord(league.federation)
      const seasonNode = asRecord(lhRec.season)
      const name = s(lhRec, 'name')
      const seasonShort = s(seasonNode, 'shortName') || extractSeasonFromName(name)
      const sexRaw = s(league, 'sex')
      const sex: 'M' | 'F' | 'X' =
        sexRaw === 'M' || sexRaw === 'F' || sexRaw === 'X' ? sexRaw : 'X'
      out.push({
        id: n(lhRec, 'id'),
        name,
        fullName: s(lhRec, 'fullName'),
        federationCode: s(fed, 'shortName') || s(fed, 'name'),
        federationId: n(fed, 'id'),
        season: seasonShort,
        sex,
        from: s(lhRec, 'from'),
        to: s(lhRec, 'to'),
      })
    }
  }
  return out
}

/**
 * Parse la réponse XML de `showLeagueSchedule.do?leagueHoldingId=Y`.
 *
 * Structure observée :
 *   <basketplan>
 *     <gameList>
 *       <Array>
 *         <game id=... gameNumber=... date=... time=... ...>
 *           <homeTeam id=... clubId=... clubName=... name=.../>
 *           <guestTeam id=... clubId=... clubName=... name=.../>
 *           <location name=... line1=... zip=... city=.../>
 *           <result homeTeamScore=... guestTeamScore=... .../>  // optionnel
 *           <state id=... name="homologé"/>
 *         </game>
 *         ...
 *       </Array>
 *     </gameList>
 *   </basketplan>
 *
 * Renvoie aussi un `teams` dédupliqué (id → entry) calculé sur l'ensemble
 * des homeTeam + guestTeam — c'est ce qui alimente le step 3 de la cascade
 * de linkage (filtré côté caller par `clubId` du club court-base).
 */
export function parseLeagueSchedule(
  xmlOrParsed: string | unknown,
): { teams: ClubTeamInLeague[]; games: Game[] } {
  const root = rootBasketplan(xmlOrParsed)
  const gameList = asRecord(root.gameList)
  const arrays = asArray(gameList.Array)
  const games: Game[] = []
  const teamsById = new Map<number, ClubTeamInLeague>()

  for (const a of arrays) {
    const aRec = asRecord(a)
    const gameNodes = asArray(aRec.game)
    for (const gn of gameNodes) {
      const g = asRecord(gn)
      const homeTeamRaw = asRecord(g.homeTeam)
      const guestTeamRaw = asRecord(g.guestTeam)
      const homeTeam: GameTeam = {
        id: n(homeTeamRaw, 'id'),
        name: s(homeTeamRaw, 'name'),
        clubId: n(homeTeamRaw, 'clubId'),
        clubName: s(homeTeamRaw, 'clubName'),
      }
      const guestTeam: GameTeam = {
        id: n(guestTeamRaw, 'id'),
        name: s(guestTeamRaw, 'name'),
        clubId: n(guestTeamRaw, 'clubId'),
        clubName: s(guestTeamRaw, 'clubName'),
      }

      // Dédup teams (un même team apparait dans N games).
      if (homeTeam.id > 0 && !teamsById.has(homeTeam.id)) {
        teamsById.set(homeTeam.id, homeTeam)
      }
      if (guestTeam.id > 0 && !teamsById.has(guestTeam.id)) {
        teamsById.set(guestTeam.id, guestTeam)
      }

      const locRaw = g.location ? asRecord(g.location) : null
      const location = locRaw
        ? {
            name: s(locRaw, 'name'),
            line1: s(locRaw, 'line1'),
            zip: s(locRaw, 'zip'),
            city: s(locRaw, 'city'),
          }
        : null

      const stateRec = asRecord(g.state)
      const resultRaw = g.result ? asRecord(g.result) : null
      const result: GameResult | null = resultRaw
        ? {
            homeScore: n(resultRaw, 'homeTeamScore'),
            guestScore: n(resultRaw, 'guestTeamScore'),
            homePoints: n(resultRaw, 'homeTeamPoints'),
            guestPoints: n(resultRaw, 'guestTeamPoints'),
            byQuarter: [
              {
                home: n(resultRaw, 'homeTeamScoreLeg1'),
                guest: n(resultRaw, 'guestTeamScoreLeg1'),
              },
              {
                home: n(resultRaw, 'homeTeamScoreLeg2'),
                guest: n(resultRaw, 'guestTeamScoreLeg2'),
              },
              {
                home: n(resultRaw, 'homeTeamScoreLeg3'),
                guest: n(resultRaw, 'guestTeamScoreLeg3'),
              },
              {
                home: n(resultRaw, 'homeTeamScoreLeg4'),
                guest: n(resultRaw, 'guestTeamScoreLeg4'),
              },
            ],
          }
        : null

      games.push({
        id: n(g, 'id'),
        gameNumber: s(g, 'gameNumber'),
        date: s(g, 'date'),
        time: sOrNull(g, 'time'),
        state: s(stateRec, 'name'),
        stateId: n(stateRec, 'id'),
        homeTeam,
        guestTeam,
        location,
        referee1Name: sOrNull(g, 'referee1Name'),
        referee2Name: sOrNull(g, 'referee2Name'),
        expertName: sOrNull(g, 'expertName'),
        result,
      })
    }
  }

  return {
    teams: Array.from(teamsById.values()),
    games,
  }
}

/**
 * Parse la réponse XML de `showRankingForLeague.do?leagueHoldingId=Y`.
 *
 * Structure observée :
 *   <basketplan>
 *     <teamList>
 *       <Array>
 *         <Ranking>
 *           <rankingDataVO currentRanking="1" defeats="0" gamesPlayed="12"
 *                          totalPoints="24" totalScoreAgainst="706"
 *                          totalScoreFor="900" victories="12" .../>
 *           <team id=... clubId=... clubName=... name=.../>
 *         </Ranking>
 *         ...
 *       </Array>
 *     </teamList>
 *   </basketplan>
 *
 * PR 1 utilise ce parser surtout pour le sanity check des fixtures — il
 * sera consommé en UI en PR 2/3 (widget classement). Retourne un array
 * trié par `rank` croissant.
 */
export function parseRanking(xmlOrParsed: string | unknown): RankingRow[] {
  const root = rootBasketplan(xmlOrParsed)
  const teamList = asRecord(root.teamList)
  const arrays = asArray(teamList.Array)
  const out: RankingRow[] = []
  for (const a of arrays) {
    const aRec = asRecord(a)
    const rankings = asArray(aRec.Ranking)
    for (const r of rankings) {
      const rRec = asRecord(r)
      const data = asRecord(rRec.rankingDataVO)
      const teamRaw = asRecord(rRec.team)
      const team: ClubTeamInLeague = {
        id: n(teamRaw, 'id'),
        name: s(teamRaw, 'name'),
        clubId: n(teamRaw, 'clubId'),
        clubName: s(teamRaw, 'clubName'),
      }
      out.push({
        rank: n(data, 'currentRanking'),
        team,
        gamesPlayed: n(data, 'gamesPlayed'),
        victories: n(data, 'victories'),
        defeats: n(data, 'defeats'),
        totalPoints: n(data, 'totalPoints'),
        scoreFor: n(data, 'totalScoreFor'),
        scoreAgainst: n(data, 'totalScoreAgainst'),
      })
    }
  }
  out.sort((x, y) => x.rank - y.rank)
  return out
}

/**
 * Helper public : extrait le `season shortName` (ex. "25/26") du `name`
 * d'un leagueHolding — réutilisé par `linkTeam.ts` quand on remplit le
 * cache `BasketplanCompetitionLink.season`. Non couplé à un cas particulier.
 *
 * `nOrNull` est ré-exporté pour les callers qui voudraient parser à la main
 * (non utilisé en PR 1, garde pour la PR 2 sync).
 */
export { extractSeasonFromName, nOrNull }
