/**
 * `onTrialExpired`
 *
 * Scheduled function — daily 03:00 europe-west6. Balaie toutes les
 * `/registrations` en `status == 'trial_in_progress'` dont
 * `trialStartedAt <= now - 14 days` et fan-out deux notifs par registration :
 * une au coach (via `team.coachIds`) et une au parent (`submittedByUid`).
 *
 * **Aucune** bascule de status — c'est au coach de trancher entre `confirm`
 * (cotisation due) et `refuse`. Le scheduled est purement informatif.
 *
 * Idempotence intégrale via IDs déterministes :
 *   - `${registrationId}_trial_expired_coach_${coachMemberId}`
 *   - `${registrationId}_trial_expired_parent`
 *
 * Un re-run du cron (ou un nouveau run J+1) ne re-crée pas de doublons —
 * `set()` overwrite à l'identique. Tant que le coach ne fait pas transiter la
 * registration, le ping persiste — c'est le comportement souhaité (visible
 * dans la liste mobile coach jusqu'à action).
 *
 * Index Firestore requis (à ajouter dans `firestore.indexes.json` —
 * l'agent docs s'en charge) :
 *
 *     {
 *       collectionGroup: 'registrations',
 *       queryScope: 'COLLECTION',
 *       fields: [
 *         { fieldPath: 'status', order: 'ASCENDING' },
 *         { fieldPath: 'trialStartedAt', order: 'ASCENDING' },
 *       ],
 *     }
 *
 * Cap anti-runaway : 500 registrations max par run. Au-delà, on logge un
 * warning et on traitera le reste au run suivant — pas de bascule auto, donc
 * pas d'urgence.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { logger } from 'firebase-functions/v2'
import type {
  RegistrationData,
  TeamData,
} from '@club-app/shared-types'
import { Timestamp, col, db, serverTimestamp } from './_helpers'

/** Délai après lequel un essai est considéré "à terme". */
const TRIAL_EXPIRY_DAYS = 14

/** Cap de docs traités par run — protège un déploiement bug-introducing. */
const MAX_REGISTRATIONS_PER_RUN = 500

/** Calcule `now - days` en Timestamp Firestore (précision seconde). */
export function timestampDaysAgo(days: number): FirebaseFirestore.Timestamp {
  const now = Timestamp.now()
  return new Timestamp(now.seconds - days * 86_400, now.nanoseconds)
}

interface NotifWrite {
  id: string
  type: 'trial_expired_alert'
  title: string
  body: string
  recipientUid?: string
  recipientMemberId?: string
  payload: Record<string, unknown>
}

/**
 * Compose les notifs (coach par memberId + parent par uid) pour une
 * registration en trial expiré. Pure — exporté pour tests.
 *
 * Si `team` est `null` (lookup échoué) on n'émet que la notif parent, et on
 * logge côté caller — le coach pourra toujours être notifié au run suivant.
 */
export function composeTrialExpiredNotifs(args: {
  registrationId: string
  reg: RegistrationData
  team: TeamData | null
}): NotifWrite[] {
  const { registrationId, reg, team } = args
  const playerLabel = `${reg.player.firstName} ${reg.player.lastName}`
  const firstName = reg.player.firstName
  const out: NotifWrite[] = []

  // Coach notifs — une par coach memberId (multi-coachs possibles).
  for (const coachMemberId of team?.coachIds ?? []) {
    out.push({
      id: `${registrationId}_trial_expired_coach_${coachMemberId}`,
      type: 'trial_expired_alert',
      title:
        `L'essai de ${playerLabel} arrive à terme. À trancher : ` +
        `confirmer (cotisation due) ou refuser.`,
      body:
        `${playerLabel} est en essai depuis plus de ${TRIAL_EXPIRY_DAYS} jours. ` +
        `Aucune transition n'a été enregistrée.`,
      recipientMemberId: coachMemberId,
      payload: {
        registrationId,
        teamId: reg.teamId,
        playerName: playerLabel,
        trialStartedAt: reg.trialStartedAt ?? null,
      },
    })
  }

  // Notif parent (submittedByUid) — recipientUid déterministe (pas besoin
  // d'un suffixe parent_<uid> puisqu'il n'y en a qu'un par registration).
  out.push({
    id: `${registrationId}_trial_expired_parent`,
    type: 'trial_expired_alert',
    title: `L'essai de ${firstName} arrive à terme. Le club va décider de la suite.`,
    body:
      `L'essai de ${playerLabel} dure depuis plus de ${TRIAL_EXPIRY_DAYS} jours. ` +
      `Le coach a été informé.`,
    recipientUid: reg.submittedByUid,
    payload: {
      registrationId,
      teamId: reg.teamId,
      playerName: playerLabel,
      trialStartedAt: reg.trialStartedAt ?? null,
    },
  })

  return out
}

/**
 * Pose les notifs sur `/notifications` avec `set()` (idempotence via id
 * déterministe). Aggressivement défensif : un échec sur une notif n'annule
 * pas les autres.
 *
 * Exporté pour tests.
 */
export async function writeNotifs(notifs: readonly NotifWrite[]): Promise<void> {
  if (notifs.length === 0) return
  await Promise.all(
    notifs.map(async (n) => {
      try {
        const ref = db().collection('notifications').doc(n.id)
        const doc: Record<string, unknown> = {
          type: n.type,
          title: n.title,
          body: n.body,
          payload: n.payload,
          readBy: [],
          createdAt: serverTimestamp(),
        }
        if (n.recipientUid) doc.recipientUid = n.recipientUid
        if (n.recipientMemberId) doc.recipientMemberId = n.recipientMemberId
        await ref.set(doc)
      } catch (err) {
        logger.error('onTrialExpired: notif write failed', {
          notifId: n.id,
          err,
        })
      }
    }),
  )
}

/**
 * Cœur de la fonction — exposé pour test sans passer par le wrapper scheduler.
 * Lit la query, cap à `MAX_REGISTRATIONS_PER_RUN`, et fan-out les notifs.
 */
export async function processExpiredTrials(): Promise<{
  scanned: number
  fanoutCount: number
  cappedAtLimit: boolean
}> {
  const cutoff = timestampDaysAgo(TRIAL_EXPIRY_DAYS)
  // Filtres simples (status égalité + trialStartedAt range) — composite index
  // (status ASC, trialStartedAt ASC) requis. Sur petits volumes (< quelques
  // dizaines), on pourrait s'en passer (tri JS), mais ici on filtre sur une
  // *plage* — donc l'index composite est obligatoire.
  let snap: FirebaseFirestore.QuerySnapshot<RegistrationData>
  try {
    snap = (await col<RegistrationData>('registrations')
      .where('status', '==', 'trial_in_progress')
      .where('trialStartedAt', '<=', cutoff)
      .limit(MAX_REGISTRATIONS_PER_RUN + 1)  // +1 pour détecter cap atteint
      .get()) as FirebaseFirestore.QuerySnapshot<RegistrationData>
  } catch (err) {
    logger.error('onTrialExpired: registrations query failed — index missing?', {
      err,
    })
    return { scanned: 0, fanoutCount: 0, cappedAtLimit: false }
  }

  const cappedAtLimit = snap.size > MAX_REGISTRATIONS_PER_RUN
  if (cappedAtLimit) {
    logger.warn(
      'onTrialExpired: hit MAX_REGISTRATIONS_PER_RUN cap — remaining will be processed on next run',
      {
        cap: MAX_REGISTRATIONS_PER_RUN,
        scanned: snap.size,
      },
    )
  }
  // On garde au plus MAX_REGISTRATIONS_PER_RUN docs (le +1 n'est qu'un sentinel).
  const docs = snap.docs.slice(0, MAX_REGISTRATIONS_PER_RUN)

  let fanoutCount = 0
  for (const docSnap of docs) {
    const reg = docSnap.data()
    const registrationId = docSnap.id

    let team: TeamData | null = null
    try {
      const teamSnap = await db().doc(`teams/${reg.teamId}`).get()
      if (teamSnap.exists) {
        team = teamSnap.data() as TeamData
      } else {
        logger.warn('onTrialExpired: team not found — parent notif only', {
          registrationId,
          teamId: reg.teamId,
        })
      }
    } catch (err) {
      logger.warn('onTrialExpired: team lookup failed — parent notif only', {
        registrationId,
        teamId: reg.teamId,
        err,
      })
    }

    const notifs = composeTrialExpiredNotifs({ registrationId, reg, team })
    await writeNotifs(notifs)
    fanoutCount += notifs.length
  }

  return {
    scanned: docs.length,
    fanoutCount,
    cappedAtLimit,
  }
}

export const onTrialExpired = onSchedule(
  {
    schedule: '0 3 * * *',
    timeZone: 'Europe/Zurich',
  },
  async () => {
    logger.info('onTrialExpired: scheduled run starting')
    const result = await processExpiredTrials()
    logger.info('onTrialExpired: run complete', result)
  },
)
