/**
 * `syncUserRolesFromMember`
 *
 * Trigger Firestore : à chaque écriture sur `/members/{memberId}`, propage les
 * rôles du membre (`member.roles`) vers le compte Auth lié
 * (`/users/{linkedUserId}.roles`). Les rôles du membre **définissent** les
 * rôles Auth — `/users.roles` est intégralement dérivé du membre lié.
 *
 * Règles de sync :
 *  - Membre lié à un user (`linkedUserId != null`) → `/users/{uid}.roles` est
 *    **écrasé** par `member.roles` (copie verbatim, tous les rôles).
 *  - Si le membre est délié (ou supprimé, ou relié à un autre user) → l'ancien
 *    user voit ses `roles` remis à `[]` (plus de membre source → plus de rôles).
 *  - `/users.roles` étant admin-only-write côté `firestore.rules`, ce trigger
 *    Admin SDK est le canal de mise à jour.
 *
 * ⚠️ « Sync écrase tout » : un rôle posé hors-membre sur `/users.roles` (ex.
 * `parent` ajouté par `submitRegistration`) est écrasé au prochain write du
 * membre lié. Pour qu'un user conserve `parent`, ce rôle doit figurer sur son
 * `member.roles`.
 *
 * Idempotent : aucune écriture si les `roles` cibles sont déjà à jour. Écrire
 * `/users` ne re-déclenche pas ce trigger (`/members`), donc pas de boucle.
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions/v2'
import type { MemberData } from '@club-app/shared-types'
import { db } from '../registrations/_helpers'

/** Compare deux listes de rôles indépendamment de l'ordre. */
function sameRoles(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const setB = new Set(b)
  return a.every((r) => setB.has(r))
}

/**
 * Écrase `/users/{uid}.roles` avec `roles`. No-op si le doc user n'existe pas
 * (un membre peut être lié à un uid dont le doc `/users` a disparu) ou si les
 * rôles sont déjà identiques.
 */
async function applyRolesToUser(uid: string, roles: string[]): Promise<void> {
  const userRef = db().doc(`users/${uid}`)
  const snap = await userRef.get()
  if (!snap.exists) {
    logger.warn('[syncUserRolesFromMember] linked user doc missing — skipped', {
      uid,
    })
    return
  }
  const current = (snap.data()?.roles as string[] | undefined) ?? []
  if (sameRoles(current, roles)) return
  await userRef.update({ roles })
  logger.info('[syncUserRolesFromMember] user roles synced', { uid, roles })
}

export const syncUserRolesFromMember = onDocumentWritten(
  'members/{memberId}',
  async (event) => {
    const before = event.data?.before
    const after = event.data?.after

    const beforeData = before?.exists ? (before.data() as MemberData) : null
    const afterData = after?.exists ? (after.data() as MemberData) : null

    const beforeUid = beforeData?.linkedUserId ?? null
    const afterUid = afterData?.linkedUserId ?? null
    const beforeRoles = beforeData?.roles ?? []
    const afterRoles = afterData?.roles ?? []

    // Rien de pertinent n'a changé (ni lien, ni rôles) → court-circuit.
    if (beforeUid === afterUid && sameRoles(beforeRoles, afterRoles)) {
      return
    }

    // L'ancien user n'est plus lié à ce membre (délien / relien / suppression)
    // → il perd les rôles dérivés de ce membre.
    if (beforeUid && beforeUid !== afterUid) {
      await applyRolesToUser(beforeUid, [])
    }

    // Le user actuellement lié reçoit les rôles du membre (verbatim).
    if (afterUid) {
      await applyRolesToUser(afterUid, afterRoles)
    }
  },
)
