import type { Timestamp } from './index'

/**
 * Document `/users/{uid}` — mirror du compte Firebase Auth.
 * Voir docs/firebase.md (section /users/{uid}).
 *
 * Un user appartient à un seul projet (pas de clubMemberships[]).
 * `roles` pilote l'accès app (allowlist guards). Pour la classification
 * club-interne, voir `member.roles`. La capacité official dérive de
 * `member.officialLevel`, pas de `user.roles`.
 */
export interface UserData {
  email: string
  displayName: string
  photoURL: string
  /** "admin" | "coach" — futur: "player", "official" */
  roles: string[]
  /** Lien vers /members si user = membre du club */
  memberId: string | null
  /** Scope coach */
  teamIds: string[]
  createdAt: Timestamp
}

export type User = UserData & { id: string }
