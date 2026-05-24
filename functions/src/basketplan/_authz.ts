/**
 * `_authz.ts` — gardes d'autorisation pour les callables Basketplan.
 *
 * Le module Basketplan a deux scopes possibles :
 *
 *   1. **admin / rootAdmin** : bypass complet. Concerne `testConnection`
 *      (debug global), `listClubTeamsInLeague` (lecture publique mais
 *      signed-in), et toutes les opérations de linkage.
 *   2. **coach-of-team** : un coach ne peut lier / délier / toggler que
 *      les compétitions de **ses** équipes. Source de vérité du scope =
 *      `user.teamIds` (cf. mémoire `project_teamids_canonical`).
 *
 * Helpers `assertAdminOnly` et `assertAdminOrCoachOfTeam` réutilisables
 * dans toutes les callables du dossier `basketplan/`. Pattern repris de
 * `matches/coachCreateAwayMatch.ts:142-155` (refacto out-of-scope — on
 * réimplémente ici pour rester self-contained dans le dossier basketplan).
 *
 * Convention de typage `CallerAuth` : on ne retient que ce dont on a besoin
 * pour l'authorization (`uid` + `token` avec claim `rootAdmin`). Compatible
 * directement avec `request.auth` d'un callable v2 (cf. members/_coachAuth.ts).
 */
import { HttpsError } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import type { UserData } from '@club-app/shared-types'

/**
 * Identité du caller telle que passée par un callable v2. `token` est typé
 * large pour accepter `DecodedIdToken` sans cast au call-site.
 */
export interface CallerAuth {
  uid: string
  token?: Record<string, unknown> | undefined
}

/** `true` si le caller porte le claim Auth `rootAdmin === true`. */
function isRootAdmin(auth: CallerAuth): boolean {
  return auth.token?.rootAdmin === true
}

/** `true` si le doc `/users` du caller porte le rôle `admin`. */
function hasAdminRole(user: UserData | undefined): boolean {
  return !!user && (user.roles ?? []).includes('admin')
}

/**
 * Charge le doc `/users/{uid}` du caller (Admin SDK). Lève
 * `permission-denied` si absent (un caller sans doc user ne peut avoir
 * aucun rôle applicatif).
 */
export async function loadCallerUser(uid: string): Promise<UserData> {
  const snap = await admin.firestore().doc(`users/${uid}`).get()
  if (!snap.exists) {
    throw new HttpsError('permission-denied', 'No /users doc for caller.')
  }
  return snap.data() as UserData
}

/**
 * Garde "admin uniquement" — utilisé pour `testBasketplanConnection`.
 *
 * Accepte :
 *   - claim Auth `rootAdmin === true`,
 *   - rôle `admin` sur `/users/{uid}.roles`.
 *
 * Sinon `permission-denied`.
 */
export function assertAdminOnly(auth: CallerAuth, user: UserData): void {
  if (isRootAdmin(auth)) return
  if (hasAdminRole(user)) return
  throw new HttpsError(
    'permission-denied',
    'Caller must be admin or rootAdmin.',
  )
}

/**
 * Garde principale : autorise le caller à agir sur la team `teamId`.
 *
 * Hiérarchie :
 *   - `rootAdmin` (claim) → bypass complet.
 *   - rôle `admin` → bypass complet.
 *   - rôle `coach` ET `teamId ∈ user.teamIds` → autorisé.
 *   - sinon → `permission-denied`.
 *
 * Note : pas de lookup `/teams/{teamId}.coachIds` ici (la source canonique
 * du scope coach côté serveur est `user.teamIds`, tenu en phase par les
 * rules — cf. mémoire `[[project_teamids_canonical]]`). Le caller doit
 * fournir le `user` chargé (typiquement via `loadCallerUser`) — évite la
 * double lecture si la callable a déjà besoin du user pour autre chose.
 */
export function assertAdminOrCoachOfTeam(
  auth: CallerAuth,
  teamId: string,
  user: UserData,
): void {
  if (isRootAdmin(auth)) return
  if (hasAdminRole(user)) return
  const roles = user.roles ?? []
  if (roles.includes('coach') && (user.teamIds ?? []).includes(teamId)) {
    return
  }
  throw new HttpsError(
    'permission-denied',
    'Caller must be admin or a coach of this team.',
  )
}
