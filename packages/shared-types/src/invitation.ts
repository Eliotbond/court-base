import type { Timestamp } from './index'

/**
 * Document `/invitations/{inviteId}` — pending invitation pour rejoindre le
 * club avec un rôle donné.
 *
 * Flow :
 * 1. Un admin crée un doc avec `email` + `role`. Pas d'email envoyé pour le
 *    MVP — l'admin partage manuellement l'info avec l'invité.
 * 2. L'invité signe in via OAuth (Google/Apple) avec l'email indiqué.
 * 3. Le flow auth client appelle `acceptInvitation` (callable) qui crée
 *    `/users/{uid}` à partir de l'invitation puis supprime le doc.
 *
 * Voir docs/firebase.md (`/invitations/{inviteId}`) et le flow dény-orphan
 * dans `apps/web/src/repositories/users.repo.ts`.
 */
export interface InvitationData {
  /** Email lowercased — c'est par ça qu'on lookup côté `acceptInvitation`. */
  email: string
  /** Rôle accordé à l'acceptation. MVP : `'admin'`. */
  role: string
  /** uid de l'admin qui a invité. */
  invitedBy: string
  /** Nom de l'inviteur — dénormalisé pour affichage UI sans 2e lookup. */
  invitedByName: string
  createdAt: Timestamp
}

export type Invitation = InvitationData & { id: string }
