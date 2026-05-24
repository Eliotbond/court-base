/**
 * `toggleTeamBasketplanLink` — callable admin OR coach-of-team.
 *
 * Active / désactive un lien Basketplan sans le supprimer. Le scheduler
 * de sync (PR 2) ignore les liens `active: false` — utile pour mettre en
 * pause une compétition (ex. fin de saison) sans perdre l'historique.
 *
 * Auth : admin OU coach de la team.
 *
 * Input wire : `{ teamId: string; linkId: string; active: boolean }`.
 *
 * Idempotent : si `link.active === active`, on no-op (mais retourne ok).
 *
 * Retour : `{ ok: true, linkId, active, changed }`.
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import { logger } from '../shared/logger'
import type { TeamData } from '@club-app/shared-types'
import {
  assertAdminOrCoachOfTeam,
  loadCallerUser,
} from './_authz'

interface ToggleLinkInput {
  teamId: unknown
  linkId: unknown
  active: unknown
}

export interface ToggleLinkOutput {
  ok: true
  linkId: string
  active: boolean
  /** `false` si le lien était déjà dans l'état demandé (no-op). */
  changed: boolean
}

function parseInput(data: ToggleLinkInput): {
  teamId: string
  linkId: string
  active: boolean
} {
  const d = data ?? ({} as ToggleLinkInput)
  if (typeof d.teamId !== 'string' || d.teamId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'teamId is required')
  }
  if (typeof d.linkId !== 'string' || d.linkId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'linkId is required')
  }
  if (typeof d.active !== 'boolean') {
    throw new HttpsError('invalid-argument', 'active must be a boolean')
  }
  return { teamId: d.teamId.trim(), linkId: d.linkId.trim(), active: d.active }
}

export const toggleTeamBasketplanLink = onCall(
  async (
    request: CallableRequest<ToggleLinkInput>,
  ): Promise<ToggleLinkOutput> => {
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        '[toggleTeamBasketplanLink] Must be signed in.',
      )
    }
    const { teamId, linkId, active } = parseInput(request.data)
    const user = await loadCallerUser(request.auth.uid)
    assertAdminOrCoachOfTeam(request.auth, teamId, user)

    const teamRef = admin.firestore().doc(`teams/${teamId}`)
    const teamSnap = await teamRef.get()
    if (!teamSnap.exists) {
      throw new HttpsError(
        'not-found',
        `[toggleTeamBasketplanLink] team ${teamId} not found`,
      )
    }

    const team = teamSnap.data() as TeamData
    const links = team.basketplanLinks ?? []
    const targetIdx = links.findIndex((l) => l.id === linkId)
    if (targetIdx === -1) {
      throw new HttpsError(
        'not-found',
        `[toggleTeamBasketplanLink] linkId ${linkId} not found on team ${teamId}`,
      )
    }

    if (links[targetIdx].active === active) {
      // No-op idempotent.
      logger.info('[toggleTeamBasketplanLink] no-op (already in state)', {
        teamId,
        linkId,
        active,
      })
      return { ok: true, linkId, active, changed: false }
    }

    const next = links.map((l, i) =>
      i === targetIdx ? { ...l, active } : l,
    )

    try {
      await teamRef.update({ basketplanLinks: next })
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: unknown }).code)
          : 'unknown'
      logger.error(`[toggleTeamBasketplanLink] update failed [${code}]`, {
        err,
        teamId,
        linkId,
      })
      throw new HttpsError('internal', '[toggleTeamBasketplanLink] team update failed')
    }

    logger.info('[toggleTeamBasketplanLink] ok', {
      teamId,
      linkId,
      active,
      callerUid: request.auth.uid,
    })

    return { ok: true, linkId, active, changed: true }
  },
)
