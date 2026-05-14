import type { Timestamp } from './index'

/**
 * Énumération canonique des rôles applicatifs portés par `/users.roles`.
 *
 * Rôles **additifs** et cumulables (cf. mémoire `project_roles_additifs`) :
 * un même user peut être `admin + coach`, `coach + official`, `treasurer +
 * admin`, etc. Les guards UI / rules utilisent `hasRole(x)` plutôt qu'un
 * mode exclusif.
 *
 * - `admin` : full read/write app (sauf `/_meta/schema`).
 * - `coach` : read members, scope team via `user.teamIds`.
 * - `official` : auto-inscription assignations, read limités.
 * - `parent` : tuteur légal, accès aux pupilles via `member.guardianUserIds`.
 * - `treasurer` : gestion paiements (marquer `dues` comme `paid`,
 *   consulter toute la collection `/dues` sans scope team). Pas de droit
 *   admin général.
 *
 * `UserData.roles` reste typé `string[]` (extensibilité custom roles) — cette
 * union sert de référence canonique pour la doc, les guards et la validation.
 */
export type UserRole =
  | 'admin'
  | 'coach'
  | 'official'
  | 'parent'
  | 'treasurer'

/**
 * Document `/users/{uid}` — mirror du compte Firebase Auth.
 * Voir docs/firebase.md (section /users/{uid}).
 *
 * Un user appartient à un seul projet (pas de clubMemberships[]).
 * `roles` pilote l'accès app (allowlist guards). Pour la classification
 * club-interne, voir `member.roles`. La capacité official dérive de
 * `member.officialLevel`, pas de `user.roles`.
 *
 * Les champs `phone`, `address` et `profileCompletedAt` sont remplis par
 * l'app `courtbase-register` lors du flow de création de profil (§4.2 du
 * brief inscriptions). Ils restent `null` pour les comptes admin/coach créés
 * via invitation qui n'ont jamais utilisé l'app register.
 */
export interface UserData {
  email: string
  displayName: string
  photoURL: string
  /**
   * Liste de rôles additifs. Valeurs canoniques : voir `UserRole`. Reste
   * typé `string[]` pour permettre les rôles custom futurs.
   */
  roles: string[]
  /** Lien vers /members si user = membre du club */
  memberId: string | null
  /** Scope coach */
  teamIds: string[]
  /** Téléphone du user (saisi via app register, optionnel ailleurs). */
  phone: string | null
  /** Adresse postale (saisie via app register). */
  address: UserAddress | null
  /** Timestamp de complétion du profil register (null = profil incomplet). */
  profileCompletedAt: Timestamp | null
  createdAt: Timestamp
}

/**
 * Adresse postale d'un user. ISO 3166-1 alpha-2 pour le pays.
 * Utilisé principalement pour les inscriptions via app register.
 */
export interface UserAddress {
  street: string
  zip: string
  city: string
  /** ISO 3166-1 alpha-2 (ex. "CH", "FR"). */
  country: string
}

export type User = UserData & { id: string }
