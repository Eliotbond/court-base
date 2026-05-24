/**
 * `listClubTeamsInLeague` — callable signed-in.
 *
 * Étape 3 de la cascade de mapping : pour une compétition Basketplan
 * donnée, retourne la liste des équipes du **club courant** (lookup
 * `config.club.basketplan.clubId`) inscrites dans cette compétition.
 *
 * Source : on fetch `showLeagueSchedule.do` (le `findTeamById.do` exige
 * une auth Basketplan, indisponible publiquement — cf. brief § 2.1).
 * `parseLeagueSchedule` extrait les teams (déduplication par id) à partir
 * des `homeTeam` / `guestTeam` de chaque game.
 *
 * Auth : tout user signed-in. Pas de scope team (le caller a déjà choisi
 * la compétition → on ne révèle pas plus que ce qui est public).
 *
 * Input wire : `{ leagueHoldingId: number }`.
 *
 * Pré-condition : `/config/club.basketplan.clubId` doit être posé. Sinon
 * on renvoie `failed-precondition` avec un message explicite (l'UI doit
 * envoyer l'admin sur Settings → Intégrations).
 *
 * Try/catch : toute erreur Basketplan → `unavailable`.
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import { logger } from '../shared/logger'
import type { ClubConfigData } from '@club-app/shared-types'
import {
  buildBasketplanUrl,
  fetchBasketplanXml,
  parseXml,
} from './_client'
import { parseLeagueSchedule, type ClubTeamInLeague } from './_parsers'

interface ListClubTeamsInLeagueInput {
  leagueHoldingId: unknown
}

export interface ListClubTeamsInLeagueOutput {
  ok: true
  leagueHoldingId: number
  clubId: number
  items: ClubTeamInLeague[]
}

function parseInput(data: ListClubTeamsInLeagueInput): { leagueHoldingId: number } {
  const d = data ?? ({} as ListClubTeamsInLeagueInput)
  const id = d.leagueHoldingId
  if (typeof id !== 'number' || !Number.isFinite(id) || id <= 0) {
    throw new HttpsError(
      'invalid-argument',
      'leagueHoldingId must be a positive number',
    )
  }
  return { leagueHoldingId: id }
}

/**
 * Lit `/config/club.basketplan.clubId`. Throw `failed-precondition` si
 * l'intégration n'est pas configurée (clubId requis pour filtrer).
 */
async function loadClubBasketplanId(): Promise<number> {
  const snap = await admin.firestore().doc('config/club').get()
  if (!snap.exists) {
    throw new HttpsError(
      'failed-precondition',
      'config/club not initialized — set up the club first.',
    )
  }
  const cfg = snap.data() as ClubConfigData
  const clubId = cfg.basketplan?.clubId
  if (typeof clubId !== 'number' || !Number.isFinite(clubId) || clubId <= 0) {
    throw new HttpsError(
      'failed-precondition',
      'config/club.basketplan.clubId is not set — configure the Basketplan integration in Settings.',
    )
  }
  return clubId
}

export const listClubTeamsInLeague = onCall(
  async (
    request: CallableRequest<ListClubTeamsInLeagueInput>,
  ): Promise<ListClubTeamsInLeagueOutput> => {
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        '[listClubTeamsInLeague] Must be signed in.',
      )
    }
    const { leagueHoldingId } = parseInput(request.data)
    const clubId = await loadClubBasketplanId()

    const url = buildBasketplanUrl('showLeagueSchedule.do', {
      leagueHoldingId,
    })

    let allTeams: ClubTeamInLeague[]
    try {
      const xml = await fetchBasketplanXml(url)
      const parsed = parseLeagueSchedule(parseXml(xml))
      allTeams = parsed.teams
    } catch (err) {
      const code = err instanceof Error ? err.name : 'unknown'
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(
        `[listClubTeamsInLeague] fetch/parse failed [${code}]`,
        { leagueHoldingId, url, err: msg },
      )
      throw new HttpsError(
        'unavailable',
        `Basketplan unavailable: ${msg}`,
      )
    }

    const items = allTeams.filter((t) => t.clubId === clubId)

    logger.info('[listClubTeamsInLeague] ok', {
      leagueHoldingId,
      clubId,
      totalTeams: allTeams.length,
      filteredCount: items.length,
    })

    return {
      ok: true,
      leagueHoldingId,
      clubId,
      items,
    }
  },
)
