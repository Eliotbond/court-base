/**
 * `scheduledBasketplanSync` — cron quotidien (`0 3 * * *` Europe/Zurich).
 *
 * Sync nocturne de toutes les équipes ayant des `basketplanLinks` actifs
 * dans le projet. Tourne en Admin SDK (pas de scope coach — le cron a tous
 * les droits sur Firestore).
 *
 * Algo :
 *
 *   1. Lit `/config/club` — si `basketplan.enabled !== true`, log et return.
 *   2. Liste toutes les `/teams` (Firestore ne supporte pas `where('basketplanLinks', '!=', null)`
 *      directement — on filtre JS).
 *   3. Pour chaque team avec au moins un link actif :
 *      - Pour chaque link actif : try/catch indépendant via `syncOneLink`
 *        (réutilisé depuis `syncForTeam.ts`).
 *      - `setTimeout(100ms)` entre fetchs (rate-limit défensif).
 *      - Update `team.basketplanSyncedAt`.
 *   4. Update `/config/club.basketplan.lastSyncAt = serverTimestamp()`.
 *      - Si aucune erreur globale : `lastSyncError: null`.
 *      - Sinon : `lastSyncError = <message agrégé>`.
 *   5. Log structuré final (counts cumulés).
 *
 * Idempotence : entièrement fournie par `applyGame` (cf. `_sync.ts`). Si le
 * cron rejoue (relance manuelle, déploiement), aucun doc n'est dupliqué —
 * les `gameNumber` agissent comme clés d'idempotence.
 *
 * Région : europe-west6 (Zurich) — cohérent avec le `timeZone` cron.
 *
 * Note opérationnelle : sur un projet à plusieurs dizaines de teams, ce cron
 * peut prendre quelques minutes (1 fetch HTTP par link, ~1s par fetch +
 * 100ms pause). Le timeout par défaut d'`onSchedule` (540s) est largement
 * suffisant. Si on dépasse un jour, splitter en buckets (modulo 4 → 4 crons
 * horaires).
 */
import { onSchedule } from 'firebase-functions/v2/scheduler'
import * as admin from 'firebase-admin'
import { logger } from '../shared/logger'
import type {
  BasketplanCompetitionLink,
  ClubConfigData,
  TeamData,
} from '@club-app/shared-types'
import { syncOneLink, type PerLinkSyncResult } from './syncForTeam'

interface TeamWithLinks {
  id: string
  name: string
  links: BasketplanCompetitionLink[]
}

/** Pause `ms` ms — rate-limit défensif. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Charge toutes les teams ayant au moins un link actif (lit toute la
 * collection puis filtre JS — petit volume, OK pour MVP).
 */
async function loadTeamsWithActiveLinks(): Promise<TeamWithLinks[]> {
  const firestore = admin.firestore()
  const snap = await firestore.collection('teams').get()
  const out: TeamWithLinks[] = []
  for (const doc of snap.docs) {
    const data = doc.data() as TeamData
    const activeLinks = (data.basketplanLinks ?? []).filter((l) => l.active)
    if (activeLinks.length > 0) {
      out.push({
        id: doc.id,
        name: data.name,
        links: activeLinks,
      })
    }
  }
  return out
}

/**
 * Exposé pour test unitaire (driving sans `onSchedule`).
 *
 * Retourne un agrégat global pour le log. Les écritures de timestamp
 * (`team.basketplanSyncedAt`, `config.club.basketplan.lastSyncAt`) sont
 * faites ici — l'`onSchedule` ne fait qu'invoquer cette fonction.
 */
export async function runScheduledBasketplanSync(): Promise<{
  teamsProcessed: number
  linksProcessed: number
  totalCreated: number
  totalPatched: number
  totalLinked: number
  totalSkipped: number
  totalErrors: number
  linkLevelErrors: number
  disabled: boolean
}> {
  const firestore = admin.firestore()

  // 1. Check enabled.
  const configRef = firestore.doc('config/club')
  const configSnap = await configRef.get()
  if (!configSnap.exists) {
    logger.info('[scheduledBasketplanSync] no /config/club doc — skip')
    return {
      teamsProcessed: 0,
      linksProcessed: 0,
      totalCreated: 0,
      totalPatched: 0,
      totalLinked: 0,
      totalSkipped: 0,
      totalErrors: 0,
      linkLevelErrors: 0,
      disabled: true,
    }
  }
  const config = configSnap.data() as ClubConfigData
  if (!config.basketplan?.enabled) {
    logger.info('[scheduledBasketplanSync] disabled — skip', {
      enabled: config.basketplan?.enabled ?? null,
    })
    return {
      teamsProcessed: 0,
      linksProcessed: 0,
      totalCreated: 0,
      totalPatched: 0,
      totalLinked: 0,
      totalSkipped: 0,
      totalErrors: 0,
      linkLevelErrors: 0,
      disabled: true,
    }
  }

  // 2. Charge les teams.
  const teams = await loadTeamsWithActiveLinks()
  if (teams.length === 0) {
    logger.info('[scheduledBasketplanSync] no team with active links')
    // Update lastSyncAt quand même — le sync a tourné même s'il n'a rien à faire.
    try {
      await configRef.update({
        'basketplan.lastSyncAt': admin.firestore.FieldValue.serverTimestamp(),
        'basketplan.lastSyncError': null,
      })
    } catch (err) {
      logger.error('[scheduledBasketplanSync] config update failed (no teams)', {
        err,
      })
    }
    return {
      teamsProcessed: 0,
      linksProcessed: 0,
      totalCreated: 0,
      totalPatched: 0,
      totalLinked: 0,
      totalSkipped: 0,
      totalErrors: 0,
      linkLevelErrors: 0,
      disabled: false,
    }
  }

  // 3. Boucle teams → links.
  let totalCreated = 0
  let totalPatched = 0
  let totalLinked = 0
  let totalSkipped = 0
  let totalErrors = 0
  let linkLevelErrors = 0
  let linksProcessed = 0
  const errorMessages: string[] = []
  let isFirstFetch = true

  for (const team of teams) {
    const perLink: PerLinkSyncResult[] = []
    for (const link of team.links) {
      if (!isFirstFetch) await sleep(100)
      isFirstFetch = false
      const res = await syncOneLink({ id: team.id, name: team.name }, link)
      perLink.push(res)
      linksProcessed += 1
      totalCreated += res.created
      totalPatched += res.patched
      totalLinked += res.linked
      totalSkipped += res.skipped
      totalErrors += res.errors
      if (res.error) {
        linkLevelErrors += 1
        errorMessages.push(`[${team.id}/${link.id}] ${res.error}`)
      }
    }

    // Update team timestamp (best-effort — un fail ici ne casse pas la suite).
    try {
      await firestore.doc(`teams/${team.id}`).update({
        basketplanSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    } catch (err) {
      logger.error('[scheduledBasketplanSync] team timestamp update failed', {
        err,
        teamId: team.id,
      })
    }
  }

  // 4. Update config global.
  try {
    // Agrège un message d'erreur lisible (max 500 chars pour rester safe).
    const aggregatedError =
      errorMessages.length > 0 ? errorMessages.join(' | ').slice(0, 500) : null
    await configRef.update({
      'basketplan.lastSyncAt': admin.firestore.FieldValue.serverTimestamp(),
      'basketplan.lastSyncError': aggregatedError,
    })
  } catch (err) {
    logger.error('[scheduledBasketplanSync] config update failed', { err })
  }

  // 5. Log final.
  logger.info('[scheduledBasketplanSync] done', {
    teamsProcessed: teams.length,
    linksProcessed,
    totalCreated,
    totalPatched,
    totalLinked,
    totalSkipped,
    totalErrors,
    linkLevelErrors,
  })

  return {
    teamsProcessed: teams.length,
    linksProcessed,
    totalCreated,
    totalPatched,
    totalLinked,
    totalSkipped,
    totalErrors,
    linkLevelErrors,
    disabled: false,
  }
}

export const scheduledBasketplanSync = onSchedule(
  {
    schedule: '0 3 * * *',
    timeZone: 'Europe/Zurich',
    region: 'europe-west6',
  },
  async () => {
    try {
      await runScheduledBasketplanSync()
    } catch (err) {
      // Capture globale ultime — si une erreur non gérée remonte, on l'écrit
      // dans `config.basketplan.lastSyncError` pour visibilité Settings.
      const message = err instanceof Error ? err.message : String(err)
      logger.error('[scheduledBasketplanSync] uncaught error', { err })
      try {
        await admin.firestore().doc('config/club').update({
          'basketplan.lastSyncAt': admin.firestore.FieldValue.serverTimestamp(),
          'basketplan.lastSyncError': `Uncaught: ${message}`.slice(0, 500),
        })
      } catch (innerErr) {
        logger.error(
          '[scheduledBasketplanSync] failed to persist uncaught error',
          { innerErr },
        )
      }
      // Re-throw pour que le scheduler considère l'invocation comme failed.
      throw err
    }
  },
)
