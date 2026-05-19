/**
 * `_coachAuth` — garde d'autorisation partagée entre les callables coach
 * scope-member (`coachUpdateMember`, `coachDeactivateMember`, etc.).
 *
 * Un coach a un périmètre restreint : il ne peut agir que sur les membres des
 * équipes qu'il encadre. La source de vérité du scope coach est
 * `user.teamIds` (cf. mémoire `project_teamids_canonical`), tenu en phase
 * avec `team.coachIds` côté rules. Le lien membre ↔ équipe se lit via
 * `team.playerIds` (`array-contains`).
 *
 * Hiérarchie d'accès :
 *  - `rootAdmin` (claim Auth `token.rootAdmin === true`) → bypass complet.
 *  - rôle `admin` (sur `/users/{uid}`) → bypass complet (l'admin a la web app
 *    pour tout, ces callables coach lui restent ouvertes par simplicité).
 *  - rôle `coach` → autorisé uniquement si **au moins une** des équipes qui
 *    listent `memberId` dans `playerIds` est dans `user.teamIds`.
 *  - sinon → `permission-denied`.
 */
import { HttpsError } from 'firebase-functions/v2/https'
import type { UserData } from '@club-app/shared-types'
import { db } from '../registrations/_helpers'

/**
 * Identité du caller telle que fournie par `request.auth` d'un callable v2.
 * On ne retient que ce qui sert à l'autorisation. `token` est typé large
 * (`Record<string, unknown>`) pour accepter directement le `DecodedIdToken`
 * de `request.auth.token` sans cast au call-site.
 */
export interface CallerAuth {
  uid: string
  token?: Record<string, unknown> | undefined
}

/** `true` si le caller porte le claim Auth `rootAdmin`. */
function isRootAdmin(auth: CallerAuth): boolean {
  return auth.token?.rootAdmin === true
}

/** `true` si le doc `/users` du caller porte le rôle `admin`. */
function hasAdminRole(user: UserData | undefined): boolean {
  return !!user && (user.roles ?? []).includes('admin')
}

/**
 * Charge le doc `/users/{uid}` du caller. Lève `permission-denied` si absent
 * (un caller sans doc user ne peut avoir aucun rôle applicatif).
 */
export async function loadCallerUser(uid: string): Promise<UserData> {
  const snap = await db().doc(`users/${uid}`).get()
  if (!snap.exists) {
    throw new HttpsError('permission-denied', 'No /users doc for caller.')
  }
  return snap.data() as UserData
}

/**
 * Autorise le caller à agir sur `teamId` :
 *  - rootAdmin / admin → toujours.
 *  - coach → uniquement si `teamId ∈ user.teamIds`.
 * Sinon `permission-denied`.
 */
export function assertCoachOrAdminOfTeam(
  auth: CallerAuth,
  teamId: string,
  user: UserData,
): void {
  if (isRootAdmin(auth)) return
  if (hasAdminRole(user)) return
  if ((user.teamIds ?? []).includes(teamId)) return
  throw new HttpsError(
    'permission-denied',
    'Caller must be admin or a coach of this team.',
  )
}

/**
 * Garde principale : autorise le caller à agir sur `/members/{memberId}`.
 *
 * - rootAdmin / admin → bypass.
 * - coach → autorisé si l'intersection {équipes contenant le member} ∩
 *   {`user.teamIds`} est non vide.
 *
 * Lève `permission-denied` sinon. Le caller passe son `CallerAuth` (uid +
 * token) ; le `/users` doc est rechargé ici pour rester self-contained — les
 * callables peuvent passer un `userData` déjà chargé pour éviter une lecture
 * en double.
 */
export async function assertCoachOrAdminOfMember(
  auth: CallerAuth,
  memberId: string,
  userData?: UserData,
): Promise<void> {
  const user = userData ?? (await loadCallerUser(auth.uid))

  // Fast-path : rootAdmin / admin → aucune query nécessaire.
  if (isRootAdmin(auth)) return
  if (hasAdminRole(user)) return

  // Coach : on cherche les équipes qui listent ce member comme joueur.
  const teamsSnap = await db()
    .collection('teams')
    .where('playerIds', 'array-contains', memberId)
    .get()
  const memberTeamIds = teamsSnap.docs.map((d) => d.id)
  const coachTeamIds = new Set(user.teamIds ?? [])
  const hasOverlap = memberTeamIds.some((id) => coachTeamIds.has(id))
  if (hasOverlap) return

  throw new HttpsError(
    'permission-denied',
    'Caller must be admin or a coach of one of this member’s teams.',
  )
}
