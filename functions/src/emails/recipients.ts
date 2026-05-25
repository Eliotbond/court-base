/**
 * Résolution d'emails destinataires pour les workflows métier.
 *
 * Extrait pour partage entre `dues/_emailEnqueue.ts` (qui héberge la version
 * historique) et les futurs producteurs (`licenses/`, `registrations/`).
 *
 * Garde la même politique : suit `member.comms.billingRecipients` (`'member'`
 * et/ou `'guardians'`), lit les `user.email` correspondants, dédupe, ignore
 * silencieusement (warning) les comptes sans email.
 */
import { logger } from 'firebase-functions/v2'
import type { CommsRecipient, MemberData, UserData } from '@club-app/shared-types'
import { db } from './_db'

/**
 * Résout la liste d'emails à notifier pour un member donné, selon sa
 * politique `comms.billingRecipients`. Retourne une liste dédupliquée
 * (ordre stable : member d'abord, guardians ensuite).
 *
 * Renvoie un tableau vide si :
 *  - le member n'a aucun recipient configuré,
 *  - aucun des users référencés n'a d'email,
 *  - les users référencés n'existent pas.
 *
 * Le caller décide quoi faire (skip enqueue ? enqueue avec `to: null` pour
 * audit ?). Par convention courte des producteurs existants, on enqueue
 * quand même avec `to: null` (visible côté admin pour debug).
 */
export async function resolveBillingRecipients(
  member: MemberData,
): Promise<string[]> {
  return resolveByPolicy(
    member,
    member.comms?.billingRecipients ?? [],
  )
}

/**
 * Variante générique : résout selon une politique fournie explicitement
 * (utile pour `generalRecipients` ou des cas ad-hoc, ex. notif licence).
 */
export async function resolveRecipientsByPolicy(
  member: MemberData,
  policy: readonly CommsRecipient[],
): Promise<string[]> {
  return resolveByPolicy(member, policy)
}

async function resolveByPolicy(
  member: MemberData,
  recipients: readonly CommsRecipient[],
): Promise<string[]> {
  const uids: string[] = []
  if (recipients.includes('member') && member.linkedUserId) {
    uids.push(member.linkedUserId)
  }
  if (recipients.includes('guardians')) {
    for (const uid of member.guardianUserIds ?? []) {
      if (!uids.includes(uid)) uids.push(uid)
    }
  }
  if (uids.length === 0) return []

  const refs = uids.map((uid) => db().doc(`users/${uid}`))
  const snaps = await db().getAll(...refs)
  const emails: string[] = []
  for (let i = 0; i < snaps.length; i++) {
    const snap = snaps[i]
    const uid = uids[i]
    if (!snap.exists) {
      logger.warn('resolveRecipients: user doc missing', { uid })
      continue
    }
    const user = snap.data() as UserData
    const email = typeof user.email === 'string' && user.email.length > 0
      ? user.email
      : null
    if (!email) {
      logger.warn('resolveRecipients: user has no email', { uid })
      continue
    }
    if (!emails.includes(email)) emails.push(email)
  }
  return emails
}
