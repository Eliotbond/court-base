/**
 * `syncBasketplanForTeam` — callable : déclenchement à la demande du sync
 * Basketplan pour une équipe donnée.
 *
 * Usage :
 *   - Bouton "Synchroniser maintenant" dans Settings → Basketplan (admin)
 *     ou dans la fiche équipe (admin OR coach-of-team).
 *   - Diagnostic / debug : un coach peut re-lancer la sync de sa team sans
 *     attendre le cron nocturne.
 *
 * Auth : signed-in + (admin OR coach-of-team). Helper
 * `assertAdminOrCoachOfTeam` (cf. `_authz.ts`).
 *
 * Input wire : `{ teamId: string }`.
 *
 * Effet :
 *   1. Charge la team court-base — refuse si `basketplanLinks` vide.
 *   2. Pour chaque link **actif** (try/catch indépendant — un link KO ne
 *      casse pas les autres) :
 *      a. `fetchBasketplanXml(buildBasketplanUrl('showLeagueSchedule.do', { leagueHoldingId }))`
 *      b. `parseLeagueSchedule` → filter games de notre team
 *         (`homeTeamId === link.teamIdInLeague || guestTeamId === ...`).
 *      c. Pour chaque game → `applyGame` (cf. `_sync.ts`).
 *      d. `setTimeout(100ms)` entre fetchs (rate-limit défensif Basketplan).
 *   3. Update `team.basketplanSyncedAt = serverTimestamp()`.
 *   4. Retour : `{ ok: true, summary: { perLink: [...] } }`.
 *
 * **Cette callable ne touche pas à `config.club.basketplan.lastSyncAt`** —
 * ce champ est réservé au cron nocturne (cf. `scheduledSync.ts`) qui agrège
 * sur toutes les teams. Une sync à la demande sur une seule team n'est pas
 * représentative du "dernier sync global du club".
 *
 * Region : europe-west6 (héritée du `setGlobalOptions` dans `src/index.ts`).
 *
 * Note deploy : nouvelle Function v2 → après le premier deploy, ajouter le
 * binding IAM `allUsers/run.invoker` (cf. `functions/CLAUDE.md` §"Après deploy").
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
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
import { parseLeagueSchedule, type Game } from './_parsers'
import {
  assertAdminOrCoachOfTeam,
  loadCallerUser,
} from './_authz'
import {
  applyGame,
  emptySyncActionsSummary,
  tallyAction,
  type SyncActionsSummary,
} from './_sync'

interface SyncForTeamInput {
  teamId: unknown
}

export interface PerLinkSyncResult extends SyncActionsSummary {
  linkId: string
  leagueHoldingId: number
  leagueHoldingName: string
  /** Message d'erreur si le link a complètement échoué (sinon `null`). */
  error: string | null
}

export interface SyncForTeamOutput {
  ok: true
  teamId: string
  summary: {
    perLink: PerLinkSyncResult[]
  }
}

function parseInput(data: SyncForTeamInput): { teamId: string } {
  const d = data ?? ({} as SyncForTeamInput)
  if (typeof d.teamId !== 'string' || d.teamId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'teamId is required')
  }
  return { teamId: d.teamId.trim() }
}

/** Pause `ms` millisecondes — rate-limit défensif entre fetchs Basketplan. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Synchronise un seul `BasketplanCompetitionLink` (réutilisé par le cron).
 *
 * Try/catch global : si tout le lien échoue (Basketplan down, parse KO),
 * on capture et on retourne un `PerLinkSyncResult` avec `error != null`.
 *
 * Exporté pour réutilisation par `scheduledSync.ts`.
 */
export async function syncOneLink(
  team: { id: string; name: string },
  link: BasketplanCompetitionLink,
): Promise<PerLinkSyncResult> {
  const summary = emptySyncActionsSummary()
  const base: Omit<PerLinkSyncResult, keyof SyncActionsSummary | 'error'> = {
    linkId: link.id,
    leagueHoldingId: link.leagueHoldingId,
    leagueHoldingName: link.leagueHoldingName,
  }

  try {
    const url = buildBasketplanUrl('showLeagueSchedule.do', {
      leagueHoldingId: link.leagueHoldingId,
    })
    const xml = await fetchBasketplanXml(url)
    const { games } = parseLeagueSchedule(parseXml(xml))
    const myGames: Game[] = games.filter(
      (g) =>
        g.homeTeam.id === link.teamIdInLeague ||
        g.guestTeam.id === link.teamIdInLeague,
    )

    for (const g of myGames) {
      try {
        const res = await applyGame(team, link, g)
        tallyAction(summary, res)
      } catch (err) {
        summary.errors += 1
        const code =
          err && typeof err === 'object' && 'code' in err
            ? String((err as { code: unknown }).code)
            : 'unknown'
        logger.error(`[syncOneLink] applyGame failed [${code}]`, {
          err,
          teamId: team.id,
          linkId: link.id,
          gameNumber: g.gameNumber,
        })
      }
    }

    return { ...base, ...summary, error: null }
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code: unknown }).code)
        : 'unknown'
    const message = err instanceof Error ? err.message : String(err)
    logger.error(`[syncOneLink] link failed [${code}]`, {
      err,
      teamId: team.id,
      linkId: link.id,
      leagueHoldingId: link.leagueHoldingId,
    })
    return { ...base, ...summary, error: `[${code}] ${message}` }
  }
}

export const syncBasketplanForTeam = onCall(
  async (
    request: CallableRequest<SyncForTeamInput>,
  ): Promise<SyncForTeamOutput> => {
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        '[syncBasketplanForTeam] Must be signed in.',
      )
    }
    const callerUid = request.auth.uid
    const { teamId } = parseInput(request.data)

    const user = await loadCallerUser(callerUid)
    assertAdminOrCoachOfTeam(request.auth, teamId, user)

    const firestore = admin.firestore()
    const teamRef = firestore.doc(`teams/${teamId}`)
    const teamSnap = await teamRef.get()
    if (!teamSnap.exists) {
      throw new HttpsError(
        'not-found',
        `[syncBasketplanForTeam] team ${teamId} not found`,
      )
    }
    const team = teamSnap.data() as TeamData
    const links = (team.basketplanLinks ?? []).filter((l) => l.active)
    if (links.length === 0) {
      // Pas une erreur — la team n'a juste pas de lien actif. On renvoie
      // un summary vide pour que l'UI puisse afficher "rien à synchroniser".
      logger.info('[syncBasketplanForTeam] no active links', { teamId })
      return {
        ok: true,
        teamId,
        summary: { perLink: [] },
      }
    }

    const perLink: PerLinkSyncResult[] = []
    for (let i = 0; i < links.length; i += 1) {
      const link = links[i]
      // Rate-limit défensif : pause 100ms entre fetchs (sauf avant le 1er).
      if (i > 0) await sleep(100)
      const res = await syncOneLink({ id: teamId, name: team.name }, link)
      perLink.push(res)
    }

    // Update team.basketplanSyncedAt (best-effort — un échec ici ne casse
    // pas le retour summary au caller).
    try {
      await teamRef.update({
        basketplanSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    } catch (err) {
      logger.error('[syncBasketplanForTeam] team timestamp update failed', {
        err,
        teamId,
      })
    }

    const totalErrors = perLink.reduce((sum, l) => sum + l.errors, 0)
    const totalLinkErrors = perLink.filter((l) => l.error != null).length
    logger.info('[syncBasketplanForTeam] done', {
      teamId,
      callerUid,
      links: perLink.length,
      totalErrors,
      totalLinkErrors,
    })

    return {
      ok: true,
      teamId,
      summary: { perLink },
    }
  },
)
