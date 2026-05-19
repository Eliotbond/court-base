/**
 * Cloud Function — `fanoutNotification`.
 *
 * Trigger : Firestore `onDocumentCreated` sur `notifications/{notificationId}`.
 *
 * Rôle : quand une notification est créée (par l'admin depuis la page Officials
 * ou auto par `autoOfficialsNeededNotification` / `matchReminders`), résoudre
 * l'audience cible en un ensemble d'UIDs d'officiels, collecter leurs tokens
 * FCM, et pousser la notification sur tous les appareils via
 * `sendEachForMulticast`.
 *
 * Idempotence (les triggers Firestore peuvent re-livrer) :
 *   - Garde `pushedAt` : à l'entrée, si `notif.pushedAt != null` on return tout
 *     de suite — c'est soit un re-delivery, soit le re-trigger provoqué par
 *     notre propre `update({ pushedAt })` en fin de fonction.
 *   - `pushedAt` est posé MÊME quand zéro token n'a été trouvé : un re-delivery
 *     ultérieur ne re-scannera donc pas l'audience pour rien.
 *
 * Résolution d'audience (`targetAudience`) :
 *   - `all_officials`        → tous les officiels.
 *   - `assigned_officials`   → officiels assignés à l'événement lié
 *                              (`relatedBookingId` → /bookings/.../officialAssignments,
 *                               `relatedMatchId`   → /matches/.../officialAssignments)
 *                              avec `status in ['pending','confirmed']`.
 *   - `unassigned_officials` → tous les officiels MOINS les assignés.
 *   Si l'audience a besoin d'un événement lié mais ni `relatedBookingId` ni
 *   `relatedMatchId` n'est renseigné → fallback `all_officials`.
 *
 * Un officiel = membre avec `'official'` dans `roles`, OU `officialLevel != null`
 * (fallback). On mappe chaque membre → `linkedUserId` ; un officiel sans compte
 * Auth (`linkedUserId == null`) est silencieusement ignoré (compté + loggé).
 *
 * Nettoyage des tokens : les réponses FCM signalant
 * `messaging/registration-token-not-registered` ou `messaging/invalid-argument`
 * entraînent la suppression du doc `/users/{uid}/fcmTokens/{tokenId}`
 * correspondant (purge des tokens morts).
 */
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { getMessaging } from 'firebase-admin/messaging'
import type { MulticastMessage } from 'firebase-admin/messaging'

import { db, serverTimestamp } from './_helpers'
import { logger } from '../shared/logger'
import type {
  MemberData,
  NotificationData,
  NotificationTargetAudience,
  OfficialAssignmentData,
} from '@club-app/shared-types'

/** Statuts d'assignation qui "occupent" un slot (donc comptent comme assigné). */
const ASSIGNED_STATUSES: ReadonlyArray<OfficialAssignmentData['status']> = [
  'pending',
  'confirmed',
]

/** Limite FCM : `sendEachForMulticast` accepte au plus 500 tokens par appel. */
const FCM_MULTICAST_CHUNK = 500

/** Codes d'erreur FCM qui signifient "ce token est mort, supprime-le". */
const STALE_TOKEN_ERROR_CODES: ReadonlySet<string> = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-argument',
])

/**
 * Association `tokenString -> { uid, tokenDocId }`. Le doc id d'un token FCM
 * EST la chaîne du token (cf. `FcmTokenData`), donc `tokenDocId === token`,
 * mais on garde le champ explicite pour ne pas dépendre de cet invariant.
 */
interface TokenOwner {
  uid: string
  tokenDocId: string
}

/**
 * Découpe un tableau en sous-tableaux de taille `size` au plus.
 * Exporté pour test unitaire.
 */
export function chunk<T>(items: ReadonlyArray<T>, size: number): T[][] {
  if (size <= 0) {
    throw new Error('chunk: size must be > 0')
  }
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

/**
 * Liste tous les officiels et retourne l'ensemble de leurs UILs Auth.
 *
 * Officiel = membre avec `'official'` dans `roles`, OU `officialLevel != null`
 * (fallback : un officiel mal taggé mais ayant un niveau reste pris en compte).
 * Un membre sans `linkedUserId` est ignoré (pas de compte Auth → pas de push).
 *
 * Retourne aussi `memberIdToUid` pour que le chemin "assigned" puisse mapper
 * un `memberId` d'assignation → UID sans re-lire `/members`.
 */
async function resolveAllOfficials(): Promise<{
  uids: Set<string>
  memberIdToUid: Map<string, string>
  skippedNoAuthCount: number
}> {
  const uids = new Set<string>()
  const memberIdToUid = new Map<string, string>()
  let skippedNoAuthCount = 0

  // Query principale : rôle `official`.
  const byRoleSnap = await db()
    .collection('members')
    .where('roles', 'array-contains', 'official')
    .get()

  // Fallback : tout membre avec un `officialLevel` non nul. On scanne `/members`
  // une fois et on filtre en JS (le volume membres d'un club est modeste, et
  // Firestore ne sait pas requêter `officialLevel != null` proprement sans
  // exclure les docs sans le champ).
  const allMembersSnap = await db().collection('members').get()

  const seenMemberIds = new Set<string>()
  const consider = (memberId: string, data: MemberData): void => {
    if (seenMemberIds.has(memberId)) return
    seenMemberIds.add(memberId)
    const uid = data.linkedUserId
    if (uid == null) {
      skippedNoAuthCount += 1
      return
    }
    uids.add(uid)
    memberIdToUid.set(memberId, uid)
  }

  for (const docSnap of byRoleSnap.docs) {
    consider(docSnap.id, docSnap.data() as MemberData)
  }
  for (const docSnap of allMembersSnap.docs) {
    const data = docSnap.data() as MemberData
    const isOfficial =
      (Array.isArray(data.roles) && data.roles.includes('official')) ||
      data.officialLevel != null
    if (!isOfficial) continue
    consider(docSnap.id, data)
  }

  return { uids, memberIdToUid, skippedNoAuthCount }
}

/**
 * Lit la sous-collection `officialAssignments` d'un événement (booking ou
 * match) et retourne les `memberId` des assignations occupant un slot.
 */
async function readAssignedMemberIds(
  parentPath: string,
): Promise<Set<string>> {
  const snap = await db()
    .collection(`${parentPath}/officialAssignments`)
    .get()
  const memberIds = new Set<string>()
  for (const docSnap of snap.docs) {
    const data = docSnap.data() as OfficialAssignmentData
    if (ASSIGNED_STATUSES.includes(data.status)) {
      memberIds.add(data.memberId)
    }
  }
  return memberIds
}

/**
 * Résout `targetAudience` → ensemble d'UIDs d'officiels destinataires.
 * Exporté pour test unitaire.
 */
export async function resolveAudience(
  notif: Pick<
    NotificationData,
    'targetAudience' | 'relatedBookingId' | 'relatedMatchId'
  >,
): Promise<Set<string>> {
  const { uids: allUids, memberIdToUid, skippedNoAuthCount } =
    await resolveAllOfficials()

  if (skippedNoAuthCount > 0) {
    logger.info('fanoutNotification: officials skipped (no Auth account)', {
      skippedNoAuthCount,
    })
  }

  const needsEvent: ReadonlySet<NotificationTargetAudience> = new Set<
    NotificationTargetAudience
  >(['assigned_officials', 'unassigned_officials'])

  // Audience dépend d'un événement lié mais aucun n'est fourni → fallback all.
  let audience: NotificationTargetAudience = notif.targetAudience
  if (
    needsEvent.has(audience) &&
    notif.relatedBookingId == null &&
    notif.relatedMatchId == null
  ) {
    logger.warn(
      'fanoutNotification: audience needs an event but none linked, falling back to all_officials',
      { targetAudience: audience },
    )
    audience = 'all_officials'
  }

  if (audience === 'all_officials') {
    return allUids
  }

  // `assigned_officials` / `unassigned_officials` : on lit les assignations.
  const parentPath =
    notif.relatedBookingId != null
      ? `bookings/${notif.relatedBookingId}`
      : `matches/${notif.relatedMatchId}`
  const assignedMemberIds = await readAssignedMemberIds(parentPath)

  const assignedUids = new Set<string>()
  for (const memberId of assignedMemberIds) {
    const uid = memberIdToUid.get(memberId)
    if (uid != null) {
      assignedUids.add(uid)
    }
  }

  if (audience === 'assigned_officials') {
    return assignedUids
  }

  // `unassigned_officials` = tous les officiels MOINS les assignés.
  const unassigned = new Set<string>()
  for (const uid of allUids) {
    if (!assignedUids.has(uid)) {
      unassigned.add(uid)
    }
  }
  return unassigned
}

/**
 * Pour un ensemble d'UIDs, lit chaque sous-collection `/users/{uid}/fcmTokens`
 * et construit la map `tokenString -> { uid, tokenDocId }`. La map déduplique
 * naturellement un même token partagé entre plusieurs users (improbable, mais
 * la dernière écriture gagne).
 * Exporté pour test unitaire.
 */
export async function collectTokens(
  uids: ReadonlySet<string>,
): Promise<Map<string, TokenOwner>> {
  const tokenMap = new Map<string, TokenOwner>()
  for (const uid of uids) {
    const snap = await db().collection(`users/${uid}/fcmTokens`).get()
    for (const docSnap of snap.docs) {
      // Le doc id EST le token ; on ne fait pas confiance aveuglément au champ
      // `token` du payload — l'id est la source de vérité.
      const tokenString = docSnap.id
      tokenMap.set(tokenString, { uid, tokenDocId: docSnap.id })
    }
  }
  return tokenMap
}

/**
 * Construit le payload `MulticastMessage` pour un lot de tokens.
 * Les champs `data` sont des strings (contrainte FCM) — `null` devient `''`.
 * Exporté pour test unitaire.
 */
export function buildMulticastMessage(
  tokens: string[],
  notificationId: string,
  notif: Pick<
    NotificationData,
    'type' | 'title' | 'body' | 'relatedBookingId' | 'relatedMatchId'
  >,
): MulticastMessage {
  return {
    tokens,
    notification: {
      title: notif.title,
      body: notif.body,
    },
    data: {
      notificationId,
      type: notif.type,
      relatedBookingId: notif.relatedBookingId ?? '',
      relatedMatchId: notif.relatedMatchId ?? '',
    },
    android: {
      priority: 'high',
    },
    apns: {
      headers: {
        'apns-priority': '10',
      },
      payload: {
        aps: {
          sound: 'default',
        },
      },
    },
  }
}

/**
 * Envoie la notification à tous les tokens (par lots de 500) et supprime les
 * tokens signalés morts par FCM. Exporté pour test unitaire.
 *
 * Retourne le compte de succès / échecs / tokens purgés.
 */
export async function sendAndCleanup(
  tokenMap: Map<string, TokenOwner>,
  notificationId: string,
  notif: Pick<
    NotificationData,
    'type' | 'title' | 'body' | 'relatedBookingId' | 'relatedMatchId'
  >,
): Promise<{ successCount: number; failureCount: number; purged: number }> {
  const tokens = [...tokenMap.keys()]
  let successCount = 0
  let failureCount = 0
  const staleTokens: TokenOwner[] = []

  for (const batch of chunk(tokens, FCM_MULTICAST_CHUNK)) {
    const message = buildMulticastMessage(batch, notificationId, notif)
    const response = await getMessaging().sendEachForMulticast(message)
    successCount += response.successCount
    failureCount += response.failureCount

    response.responses.forEach((res, idx) => {
      if (res.success) return
      const code = res.error?.code
      if (code != null && STALE_TOKEN_ERROR_CODES.has(code)) {
        const owner = tokenMap.get(batch[idx])
        if (owner != null) {
          staleTokens.push(owner)
        }
      }
    })
  }

  // Purge des tokens morts — best-effort, séquentielle (volume très faible).
  for (const { uid, tokenDocId } of staleTokens) {
    try {
      await db().doc(`users/${uid}/fcmTokens/${tokenDocId}`).delete()
    } catch (err) {
      logger.warn('fanoutNotification: failed to delete stale token', {
        uid,
        tokenDocId,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { successCount, failureCount, purged: staleTokens.length }
}

/**
 * Cœur de la fonction — exposé pour test unitaire sans passer par le wrapper
 * `onDocumentCreated`. Idempotent : sort tôt si `pushedAt` est déjà posé.
 *
 * `markPushed` est le callback qui pose `pushedAt: serverTimestamp()` sur le
 * doc notification (en prod : `event.data.ref.update`).
 */
export async function processNotification(
  notificationId: string,
  notif: NotificationData,
  markPushed: () => Promise<void>,
): Promise<{ pushed: boolean; recipients: number; tokens: number }> {
  // 1. Garde d'idempotence.
  if (notif.pushedAt != null) {
    logger.info('fanoutNotification: already pushed, skipping (redelivery)', {
      notificationId,
    })
    return { pushed: false, recipients: 0, tokens: 0 }
  }

  // 2. Résolution de l'audience.
  const recipientUids = await resolveAudience(notif)

  // 3. Collecte des tokens FCM.
  const tokenMap = await collectTokens(recipientUids)

  // 4. Envoi (si au moins un token).
  if (tokenMap.size > 0) {
    const { successCount, failureCount, purged } = await sendAndCleanup(
      tokenMap,
      notificationId,
      notif,
    )
    logger.info('fanoutNotification: push sent', {
      notificationId,
      targetAudience: notif.targetAudience,
      recipients: recipientUids.size,
      tokens: tokenMap.size,
      successCount,
      failureCount,
      purged,
    })
  } else {
    logger.info('fanoutNotification: no FCM tokens for audience, nothing sent', {
      notificationId,
      targetAudience: notif.targetAudience,
      recipients: recipientUids.size,
    })
  }

  // 5. Pose `pushedAt` — même si zéro token, pour qu'un re-delivery ne
  //    re-scanne pas l'audience inutilement. Ce write re-déclenche le trigger,
  //    mais l'étape 1 attrape le re-run.
  await markPushed()

  return {
    pushed: true,
    recipients: recipientUids.size,
    tokens: tokenMap.size,
  }
}

export const fanoutNotification = onDocumentCreated(
  'notifications/{notificationId}',
  async (event) => {
    const notificationId = event.params.notificationId
    const snap = event.data
    if (!snap) {
      logger.warn('fanoutNotification: event has no document snapshot', {
        notificationId,
      })
      return
    }
    const notif = snap.data() as NotificationData

    await processNotification(notificationId, notif, async () => {
      await snap.ref.update({ pushedAt: serverTimestamp() })
    })
  },
)
