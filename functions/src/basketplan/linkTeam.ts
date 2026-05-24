/**
 * `linkTeamToBasketplan` — callable admin OR coach-of-team.
 *
 * Crée un nouveau `BasketplanCompetitionLink` sur `/teams/{teamId}.basketplanLinks`.
 *
 * Pour remplir les caches d'affichage (`federationCode`, `leagueHoldingName`,
 * `season`, `teamNameInLeague`), la callable re-fetch côté serveur :
 *   1. `findAllLeagueHoldings.do?federationId=X` → résout `leagueHoldingName`
 *      + `federationCode` + `season`.
 *   2. `showLeagueSchedule.do?leagueHoldingId=Y` → résout `teamNameInLeague`
 *      (via `parseLeagueSchedule.teams` filtré par `teamIdInLeague`).
 *
 * Garde-fous :
 *   - Refuse si la team a déjà un lien identique (même federationId +
 *     leagueHoldingId + teamIdInLeague) — `already-exists`.
 *   - Refuse si `teamIdInLeague` n'apparait pas dans le schedule de la ligue
 *     (signal d'un mauvais id côté UI) — `failed-precondition`.
 *
 * Auth : admin OU coach de la team (cf. `assertAdminOrCoachOfTeam`).
 *
 * Input wire : `{ teamId: string; federationId: number; leagueHoldingId:
 * number; teamIdInLeague: number }`.
 *
 * Effet : `update` sur `/teams/{teamId}` avec `arrayUnion(linkObject)`.
 * `id` = `crypto.randomUUID()`. `addedAt` = `serverTimestamp`.
 * `addedBy` = `request.auth.uid`.
 *
 * Retour : `{ ok: true, linkId, link }`.
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import { randomUUID } from 'crypto'
import { logger } from '../shared/logger'
import type {
  BasketplanCompetitionLink,
  TeamData,
} from '@club-app/shared-types'
import {
  buildBasketplanUrl,
  fetchBasketplanXml,
  parseXml,
} from './_client'
import {
  parseLeagueHoldings,
  parseLeagueSchedule,
  type LeagueHolding,
} from './_parsers'
import {
  assertAdminOrCoachOfTeam,
  loadCallerUser,
} from './_authz'

interface LinkTeamInput {
  teamId: unknown
  federationId: unknown
  leagueHoldingId: unknown
  teamIdInLeague: unknown
}

export interface LinkTeamOutput {
  ok: true
  linkId: string
  link: BasketplanCompetitionLink
}

interface ParsedInput {
  teamId: string
  federationId: number
  leagueHoldingId: number
  teamIdInLeague: number
}

function parseInput(data: LinkTeamInput): ParsedInput {
  const d = data ?? ({} as LinkTeamInput)
  if (typeof d.teamId !== 'string' || d.teamId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'teamId is required')
  }
  if (typeof d.federationId !== 'number' || !Number.isFinite(d.federationId) || d.federationId <= 0) {
    throw new HttpsError('invalid-argument', 'federationId must be a positive number')
  }
  if (
    typeof d.leagueHoldingId !== 'number' ||
    !Number.isFinite(d.leagueHoldingId) ||
    d.leagueHoldingId <= 0
  ) {
    throw new HttpsError('invalid-argument', 'leagueHoldingId must be a positive number')
  }
  if (
    typeof d.teamIdInLeague !== 'number' ||
    !Number.isFinite(d.teamIdInLeague) ||
    d.teamIdInLeague <= 0
  ) {
    throw new HttpsError('invalid-argument', 'teamIdInLeague must be a positive number')
  }
  return {
    teamId: d.teamId.trim(),
    federationId: d.federationId,
    leagueHoldingId: d.leagueHoldingId,
    teamIdInLeague: d.teamIdInLeague,
  }
}

/**
 * Résout `leagueHoldingName`, `federationCode`, `season` via
 * `findAllLeagueHoldings.do`. Throw `not-found` si pas trouvé.
 */
async function resolveLeagueHolding(
  federationId: number,
  leagueHoldingId: number,
): Promise<LeagueHolding> {
  const url = buildBasketplanUrl('findAllLeagueHoldings.do', { federationId })
  let items: LeagueHolding[]
  try {
    const xml = await fetchBasketplanXml(url)
    items = parseLeagueHoldings(parseXml(xml))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new HttpsError('unavailable', `Basketplan unavailable (leagueHoldings): ${msg}`)
  }
  const match = items.find((h) => h.id === leagueHoldingId)
  if (!match) {
    throw new HttpsError(
      'not-found',
      `leagueHoldingId=${leagueHoldingId} not found in federationId=${federationId}`,
    )
  }
  return match
}

/**
 * Résout `teamNameInLeague` via `showLeagueSchedule.do`. Throw
 * `failed-precondition` si pas trouvé (mauvais id côté UI).
 */
async function resolveTeamName(
  leagueHoldingId: number,
  teamIdInLeague: number,
): Promise<string> {
  const url = buildBasketplanUrl('showLeagueSchedule.do', { leagueHoldingId })
  let teams
  try {
    const xml = await fetchBasketplanXml(url)
    teams = parseLeagueSchedule(parseXml(xml)).teams
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new HttpsError('unavailable', `Basketplan unavailable (schedule): ${msg}`)
  }
  const team = teams.find((t) => t.id === teamIdInLeague)
  if (!team) {
    throw new HttpsError(
      'failed-precondition',
      `teamIdInLeague=${teamIdInLeague} not found in leagueHoldingId=${leagueHoldingId}`,
    )
  }
  return team.name
}

export const linkTeamToBasketplan = onCall(
  async (
    request: CallableRequest<LinkTeamInput>,
  ): Promise<LinkTeamOutput> => {
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        '[linkTeamToBasketplan] Must be signed in.',
      )
    }
    const callerUid = request.auth.uid
    const input = parseInput(request.data)

    const user = await loadCallerUser(callerUid)
    assertAdminOrCoachOfTeam(request.auth, input.teamId, user)

    const firestore = admin.firestore()

    // Pré-check team existence.
    const teamRef = firestore.doc(`teams/${input.teamId}`)
    const teamSnap = await teamRef.get()
    if (!teamSnap.exists) {
      throw new HttpsError(
        'not-found',
        `[linkTeamToBasketplan] team ${input.teamId} not found`,
      )
    }
    const team = teamSnap.data() as TeamData
    const existing = team.basketplanLinks ?? []

    // Dédup : refuse si déjà lié à la même compétition + équipe.
    const dupe = existing.find(
      (l) =>
        l.federationId === input.federationId &&
        l.leagueHoldingId === input.leagueHoldingId &&
        l.teamIdInLeague === input.teamIdInLeague,
    )
    if (dupe) {
      throw new HttpsError(
        'already-exists',
        `Team ${input.teamId} is already linked to this competition (linkId=${dupe.id}).`,
      )
    }

    // Résolution caches via re-fetch (sécurise les libellés côté serveur,
    // évite que l'UI fournisse un `leagueHoldingName` arbitraire).
    const holding = await resolveLeagueHolding(
      input.federationId,
      input.leagueHoldingId,
    )
    const teamNameInLeague = await resolveTeamName(
      input.leagueHoldingId,
      input.teamIdInLeague,
    )

    const linkId = randomUUID()
    const link: BasketplanCompetitionLink = {
      id: linkId,
      federationId: input.federationId,
      federationCode: holding.federationCode,
      leagueHoldingId: input.leagueHoldingId,
      leagueHoldingName: holding.name,
      season: holding.season,
      teamIdInLeague: input.teamIdInLeague,
      teamNameInLeague,
      active: true,
      // serverTimestamp() au write — typed as Timestamp à la lecture (cf.
      // pattern coachCreateAwayMatch).
      addedAt: admin.firestore.FieldValue.serverTimestamp() as unknown as BasketplanCompetitionLink['addedAt'],
      addedBy: callerUid,
    }

    try {
      await teamRef.update({
        basketplanLinks: admin.firestore.FieldValue.arrayUnion(link),
      })
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: unknown }).code)
          : 'unknown'
      logger.error(`[linkTeamToBasketplan] update failed [${code}]`, {
        err,
        teamId: input.teamId,
        linkId,
      })
      throw new HttpsError('internal', '[linkTeamToBasketplan] team update failed')
    }

    logger.info('[linkTeamToBasketplan] ok', {
      teamId: input.teamId,
      linkId,
      federationId: input.federationId,
      leagueHoldingId: input.leagueHoldingId,
      teamIdInLeague: input.teamIdInLeague,
      callerUid,
    })

    return { ok: true, linkId, link }
  },
)
