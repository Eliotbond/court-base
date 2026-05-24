/**
 * `unlinkTeamBasketplan` — callable admin OR coach-of-team.
 *
 * Retire un lien Basketplan de `/teams/{teamId}.basketplanLinks`.
 *
 * Auth : admin OU coach de la team.
 *
 * Input wire : `{ teamId: string; linkId: string }`.
 *
 * Effet : lit le doc team, filtre `basketplanLinks` pour exclure `linkId`,
 * `update` avec la liste filtrée. Si le lien n'existe pas → `not-found`.
 * Idempotence : pas garantie (un re-call renverra `not-found`) — c'est
 * voulu pour signaler les bugs UI.
 *
 * Note : pas de cleanup transverse (matches déjà sync gardent leur
 * `externalGameNumber` — c'est intentionnel, on ne perd pas l'historique
 * après un délink). Le sync futur (PR 2) ne re-touchera plus ces matchs.
 *
 * Retour : `{ ok: true, linkId, remainingCount }`.
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import { logger } from '../shared/logger'
import type { TeamData } from '@club-app/shared-types'
import {
  assertAdminOrCoachOfTeam,
  loadCallerUser,
} from './_authz'

interface UnlinkTeamInput {
  teamId: unknown
  linkId: unknown
}

export interface UnlinkTeamOutput {
  ok: true
  linkId: string
  remainingCount: number
}

function parseInput(data: UnlinkTeamInput): { teamId: string; linkId: string } {
  const d = data ?? ({} as UnlinkTeamInput)
  if (typeof d.teamId !== 'string' || d.teamId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'teamId is required')
  }
  if (typeof d.linkId !== 'string' || d.linkId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'linkId is required')
  }
  return { teamId: d.teamId.trim(), linkId: d.linkId.trim() }
}

export const unlinkTeamBasketplan = onCall(
  async (
    request: CallableRequest<UnlinkTeamInput>,
  ): Promise<UnlinkTeamOutput> => {
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        '[unlinkTeamBasketplan] Must be signed in.',
      )
    }
    const { teamId, linkId } = parseInput(request.data)
    const user = await loadCallerUser(request.auth.uid)
    assertAdminOrCoachOfTeam(request.auth, teamId, user)

    const teamRef = admin.firestore().doc(`teams/${teamId}`)
    const teamSnap = await teamRef.get()
    if (!teamSnap.exists) {
      throw new HttpsError(
        'not-found',
        `[unlinkTeamBasketplan] team ${teamId} not found`,
      )
    }

    const team = teamSnap.data() as TeamData
    const links = team.basketplanLinks ?? []
    const target = links.find((l) => l.id === linkId)
    if (!target) {
      throw new HttpsError(
        'not-found',
        `[unlinkTeamBasketplan] linkId ${linkId} not found on team ${teamId}`,
      )
    }
    const next = links.filter((l) => l.id !== linkId)

    try {
      await teamRef.update({ basketplanLinks: next })
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: unknown }).code)
          : 'unknown'
      logger.error(`[unlinkTeamBasketplan] update failed [${code}]`, {
        err,
        teamId,
        linkId,
      })
      throw new HttpsError('internal', '[unlinkTeamBasketplan] team update failed')
    }

    logger.info('[unlinkTeamBasketplan] ok', {
      teamId,
      linkId,
      remainingCount: next.length,
      callerUid: request.auth.uid,
    })

    return { ok: true, linkId, remainingCount: next.length }
  },
)
