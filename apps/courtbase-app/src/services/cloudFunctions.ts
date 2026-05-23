import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

/**
 * Wrappers typés autour des callables Firebase utilisées par
 * `courtbase-app`. Convention : un wrapper par callable, retour `Promise`
 * sur la `data` extraite.
 *
 * Cf. `docs/firebase.md` pour la liste des callables côté backend.
 */

// ─── acceptInvitation ─────────────────────────────────────────────
// Créé par l'admin via `/invitations`. Quand un user OAuth sign-in avec
// l'email d'une invitation pending, cette callable :
//   - lookup `/invitations` par email du caller
//   - crée `/users/{uid}` avec `roles` issus de l'invitation
//   - supprime le doc `/invitations/{id}`
// Cf. `docs/main.md` § Admin invitation flow.

export interface AcceptInvitationResult {
  /** Rôles posés sur `/users/{uid}` (peut être vide si l'invitation
   * n'en porte pas, mais en pratique au moins 1 rôle est garanti). */
  roles: string[]
}

export async function acceptInvitation(): Promise<AcceptInvitationResult> {
  const fn = httpsCallable<void, AcceptInvitationResult>(functions, 'acceptInvitation')
  const res = await fn()
  return res.data
}
