/**
 * `onRegistrationStatusChanged`
 *
 * Firestore trigger `onDocumentUpdated('/registrations/{registrationId}')`.
 * Réagit aux **changements de status** d'une registration en fan-outant des
 * documents `/notifications/{id}` (id déterministe → idempotent).
 *
 * Le trigger est strictement réactif :
 *   - return silently si `event.data.before` n'existe pas (création — c'est
 *     `submitRegistration` qui pose les notifs initiales),
 *   - return silently si `before.status === after.status` (toute autre
 *     modification : actionLog append, etc.),
 *   - return silently si `after` n'existe pas (suppression — pas de notifs).
 *
 * Schéma des notifs produites — on suit le pattern utilisé par
 * `submitRegistration.ts` / `refuseRegistration.ts` (champs `type`,
 * `recipientUid` | `recipientMemberId` | `recipientRole`, `payload`,
 * `readBy`, `createdAt`, `title`, `body`). Ce schéma diffère du strict
 * `NotificationData` (qui décrit les notifs officials avec
 * `targetAudience`), mais c'est le canal historique des registrations.
 *
 * Idempotence : `notificationId` déterministe `${registrationId}_${eventKey}`
 * pour les notifs broadcast et `${registrationId}_${eventKey}_${target}` pour
 * les notifs par destinataire. Un re-trigger sur le même status change ne
 * crée pas de doublon — `set()` overwrite à l'identique.
 *
 * Side-effects métier :
 *   - `confirmed_pending_dues` : la transition vers `member.duesStatus =
 *     'pending_grace'` est gérée par `initiateDuesOnPlayerActivation` (le
 *     trigger team.playerIds → /dues) puis ré-aligned par `syncMemberDuesStatus`.
 *     On ne touche **pas** au member ici — éviter une race avec ces deux
 *     triggers (worst-status-wins recompute).
 *
 * Le push FCM / email est porté par d'autres triggers (fanoutNotification +
 * worker `/pendingEmails`). Cette function se contente de créer les docs.
 */
import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions/v2'
import type {
  RegistrationData,
  RegistrationStatus,
  TeamData,
} from '@club-app/shared-types'
import { db, serverTimestamp } from './_helpers'

interface NotifWrite {
  /** ID déterministe — composante "événement" déjà préfixée par registrationId. */
  id: string
  type: string
  title: string
  body: string
  /** Au moins un des trois recipient* est posé. */
  recipientUid?: string
  recipientMemberId?: string
  recipientRole?: 'admin'
  payload: Record<string, unknown>
}

/** Résout le type d'événement initial selon la branche team (open / conditional). */
function initialNotifType(
  status: RegistrationStatus,
): 'new_registration_open' | 'new_registration_conditional' | null {
  if (status === 'open_pending_trial' || status === 'submitted') {
    return 'new_registration_open'
  }
  if (status === 'conditional_pending_review') {
    return 'new_registration_conditional'
  }
  return null
}

/**
 * Compose les notifs à émettre pour une transition donnée. Retourne une liste
 * vide si la transition ne déclenche aucun fan-out (cas par défaut — on ne
 * panique pas sur les statuts intermédiaires non listés dans la matrice).
 *
 * `playerLabel` = "FirstName LastName" pré-formaté pour les titres FR.
 *
 * Exporté pour test unitaire.
 */
export function composeNotifications(args: {
  registrationId: string
  before: RegistrationData
  after: RegistrationData
  team: TeamData | null
  teamName: string | null
}): NotifWrite[] {
  const { registrationId, before, after, team, teamName } = args
  const out: NotifWrite[] = []
  const playerLabel = `${after.player.firstName} ${after.player.lastName}`
  const firstName = after.player.firstName
  const teamLabel = teamName ?? after.teamId
  const submitterUid = after.submittedByUid

  switch (after.status) {
    case 'submitted':
    case 'open_pending_trial':
    case 'conditional_pending_review': {
      // Fan-out coach + admin — sécurité : on n'émet ce groupe que si on
      // arrive d'un état pré-soumission (un changement vers submitted ne devrait
      // pas être déclenché par le trigger update — le doc est créé en
      // submitted directement — mais on couvre le cas où un draft repassé en
      // submitted update le doc plutôt que de le recréer).
      const type = initialNotifType(after.status)
      if (!type) break
      const title = `Nouvelle inscription : ${playerLabel} dans ${teamLabel}`
      const body = `${playerLabel} a soumis une demande d'inscription.`
      const coachIds = team?.coachIds ?? []
      for (const coachMemberId of coachIds) {
        out.push({
          id: `${registrationId}_status_${after.status}_coach_${coachMemberId}`,
          type,
          title,
          body,
          recipientMemberId: coachMemberId,
          payload: {
            registrationId,
            teamId: after.teamId,
            playerName: playerLabel,
            previousStatus: before.status,
          },
        })
      }
      out.push({
        id: `${registrationId}_status_${after.status}_admin`,
        type,
        title,
        body,
        recipientRole: 'admin',
        payload: {
          registrationId,
          teamId: after.teamId,
          playerName: playerLabel,
          previousStatus: before.status,
        },
      })
      break
    }

    case 'conditional_pending_trial': {
      const title = `Votre inscription a été acceptée. Le coach vous contactera pour l'essai.`
      const body = `Le coach de ${teamLabel} a accepté la demande pour ${playerLabel}.`
      out.push({
        id: `${registrationId}_status_conditional_pending_trial_${submitterUid}`,
        type: 'registration_accepted',
        title,
        body,
        recipientUid: submitterUid,
        payload: {
          registrationId,
          teamId: after.teamId,
          playerName: playerLabel,
        },
      })
      break
    }

    case 'trial_in_progress': {
      // ISO de `trialStartedAt` pour information (pas exposé dans le title).
      // Le `dueDate` exact (J+14) est calculé côté UI à partir de trialStartedAt.
      const title = `L'essai de ${firstName} démarre. Cotisation à payer avant la fin de l'essai.`
      const body = `L'essai de ${playerLabel} a démarré dans ${teamLabel}.`
      out.push({
        id: `${registrationId}_status_trial_in_progress_${submitterUid}`,
        type: 'trial_started',
        title,
        body,
        recipientUid: submitterUid,
        payload: {
          registrationId,
          teamId: after.teamId,
          playerName: playerLabel,
          trialStartedAt: after.trialStartedAt ?? null,
        },
      })
      // Notif coach(s) — recipientMemberId (les coachs n'ont pas tous un uid
      // résolu côté trigger ; on suit le canal mobile coach via memberId).
      for (const coachMemberId of team?.coachIds ?? []) {
        out.push({
          id: `${registrationId}_status_trial_in_progress_coach_${coachMemberId}`,
          type: 'trial_started',
          title,
          body,
          recipientMemberId: coachMemberId,
          payload: {
            registrationId,
            teamId: after.teamId,
            playerName: playerLabel,
            trialStartedAt: after.trialStartedAt ?? null,
          },
        })
      }
      break
    }

    case 'confirmed_pending_dues': {
      const title = `Le coach a validé l'inscription. Réglez la cotisation pour finaliser.`
      const body = `${playerLabel} est confirmé dans ${teamLabel}. La cotisation va vous être envoyée.`
      out.push({
        id: `${registrationId}_status_confirmed_pending_dues_${submitterUid}`,
        type: 'registration_confirmed',
        title,
        body,
        recipientUid: submitterUid,
        payload: {
          registrationId,
          teamId: after.teamId,
          playerName: playerLabel,
          matchedMemberId: after.matchedMemberId,
        },
      })
      break
    }

    case 'active': {
      const title = `Inscription finalisée. Bienvenue !`
      const body = `${playerLabel} est officiellement inscrit dans ${teamLabel}.`
      out.push({
        id: `${registrationId}_status_active_${submitterUid}`,
        type: 'registration_active',
        title,
        body,
        recipientUid: submitterUid,
        payload: {
          registrationId,
          teamId: after.teamId,
          playerName: playerLabel,
          matchedMemberId: after.matchedMemberId,
        },
      })
      break
    }

    case 'refused': {
      const reason = after.refusalReason ?? '—'
      const title = `Votre inscription a été refusée. Motif : ${reason}`
      const body = `Le coach de ${teamLabel} a refusé l'inscription de ${playerLabel}.`
      // Note : `refuseRegistration.ts` pose déjà une notif refused avec un id
      // déterministe DIFFÉRENT (`${registrationId}_refused_${submittedByUid}`).
      // Ici l'id est `..._status_refused_${submittedByUid}` : pas de collision,
      // mais le user verra potentiellement deux entrées. C'est acceptable v1 —
      // un cleanup futur pourra unifier (les deux ont un schéma compatible et
      // un même `recipientUid`). On préserve l'idempotence de ce trigger
      // indépendamment de l'autre canal.
      out.push({
        id: `${registrationId}_status_refused_${submitterUid}`,
        type: 'registration_refused',
        title,
        body,
        recipientUid: submitterUid,
        payload: {
          registrationId,
          teamId: after.teamId,
          playerName: playerLabel,
          reason: after.refusalReason ?? null,
        },
      })
      break
    }

    case 'cancelled': {
      const title = `Inscription annulée.`
      const body = `L'inscription de ${playerLabel} dans ${teamLabel} a été annulée.`
      // Notif au submitter (l'auteur en a probablement été à l'origine, mais on
      // confirme — utile si annulation déclenchée par admin).
      out.push({
        id: `${registrationId}_status_cancelled_${submitterUid}`,
        type: 'registration_cancelled',
        title,
        body,
        recipientUid: submitterUid,
        payload: {
          registrationId,
          teamId: after.teamId,
          playerName: playerLabel,
          previousStatus: before.status,
        },
      })
      // Si l'annulation provient d'un coach / admin (changement initié hors
      // submitter), informer aussi coach + admin pour qu'ils voient la trace.
      // On ne sait pas qui a déclenché à coup sûr côté trigger (pas de auth
      // context), donc on fan-out par défaut — idempotence + faible volume.
      for (const coachMemberId of team?.coachIds ?? []) {
        out.push({
          id: `${registrationId}_status_cancelled_coach_${coachMemberId}`,
          type: 'registration_cancelled',
          title,
          body,
          recipientMemberId: coachMemberId,
          payload: {
            registrationId,
            teamId: after.teamId,
            playerName: playerLabel,
            previousStatus: before.status,
          },
        })
      }
      out.push({
        id: `${registrationId}_status_cancelled_admin`,
        type: 'registration_cancelled',
        title,
        body,
        recipientRole: 'admin',
        payload: {
          registrationId,
          teamId: after.teamId,
          playerName: playerLabel,
          previousStatus: before.status,
        },
      })
      break
    }

    default: {
      // Statuts intermédiaires non listés dans la matrice (`draft`, …) — no-op.
      break
    }
  }

  return out
}

export const onRegistrationStatusChanged = onDocumentUpdated(
  'registrations/{registrationId}',
  async (event) => {
    const registrationId = event.params.registrationId
    const change = event.data
    if (!change) {
      logger.warn('onRegistrationStatusChanged: missing event.data, skipping', {
        registrationId,
      })
      return
    }
    // Création : `before.exists === false` → c'est `submitRegistration` qui
    // fan-out les notifs initiales. Skip silencieux.
    if (!change.before.exists || !change.after.exists) return

    const before = change.before.data() as RegistrationData
    const after = change.after.data() as RegistrationData

    // Garde principale : ne réagir QUE sur changement de status.
    if (before.status === after.status) return

    let team: TeamData | null = null
    let teamName: string | null = null
    try {
      const teamSnap = await db().doc(`teams/${after.teamId}`).get()
      if (teamSnap.exists) {
        team = teamSnap.data() as TeamData
        teamName = typeof team.name === 'string' ? team.name : null
      }
    } catch (err) {
      logger.warn(
        'onRegistrationStatusChanged: team lookup failed — fan-out continues with teamId fallback',
        { registrationId, teamId: after.teamId, err },
      )
    }

    const notifs = composeNotifications({
      registrationId,
      before,
      after,
      team,
      teamName,
    })

    if (notifs.length === 0) {
      logger.info('onRegistrationStatusChanged: no fan-out for this transition', {
        registrationId,
        from: before.status,
        to: after.status,
      })
      return
    }

    logger.info('onRegistrationStatusChanged: fan-out notifications', {
      registrationId,
      from: before.status,
      to: after.status,
      count: notifs.length,
    })

    // Écritures parallélisées — chaque set() est idempotent (id déterministe).
    await Promise.all(
      notifs.map(async (n) => {
        try {
          const ref = db().collection('notifications').doc(n.id)
          // Construction du payload final — on n'écrit que les champs
          // recipient* effectivement posés (Firestore admet `undefined` mais on
          // préfère un doc propre).
          const doc: Record<string, unknown> = {
            type: n.type,
            title: n.title,
            body: n.body,
            payload: n.payload,
            readBy: [],
            createdAt: serverTimestamp(),
            // `pushedAt` reste absent ici — `fanoutNotification` ne traite pas
            // les notifs de ce schéma (il filtre sur `targetAudience`).
          }
          if (n.recipientUid) doc.recipientUid = n.recipientUid
          if (n.recipientMemberId) doc.recipientMemberId = n.recipientMemberId
          if (n.recipientRole) doc.recipientRole = n.recipientRole
          await ref.set(doc)
        } catch (err) {
          logger.error(
            'onRegistrationStatusChanged: notif write failed',
            { registrationId, notifId: n.id, err },
          )
          // Continue avec les autres — un échec isolé ne bloque pas le batch.
        }
      }),
    )
  },
)
