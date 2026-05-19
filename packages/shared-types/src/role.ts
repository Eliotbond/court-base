import type { Timestamp } from './index'

/**
 * Document `/roles/{roleId}` — référentiel des rôles du club.
 * Voir docs/firebase.md (section `/roles`).
 *
 * Provisionné comme une vraie collection Firestore (cf. `roles.repo.ts` côté
 * `apps/web` qui en gère le CRUD + le seed). Lu par l'app club (web/mobile),
 * jamais par `apps/courtbase-register`.
 */

export type RoleType = 'system' | 'custom'

export interface RoleData {
  /** Nom affiché (ex. "Comité"). */
  name: string
  /**
   * `system` = les 6 rôles canoniques `admin|treasurer|secretary|coach|
   * official|player` — non-supprimables, leurs `id` correspondent aux clés
   * `/users.roles`. `custom` = rôles club additionnels (Comité, Arbitre…),
   * supprimables.
   */
  type: RoleType
  /** Couleur hex pour le badge UI (palette tokens design). */
  color: string
  createdAt: Timestamp
}

export type Role = RoleData & { id: string }

/**
 * Les 6 rôles système canoniques — leur `id` Firestore EST la clé portée par
 * `/users.roles` et `/members.roles`. Non-supprimables (garde UI + rules).
 *
 * L'ordre du tableau dicte l'ordre d'affichage par défaut côté Settings.
 */
export const SYSTEM_ROLE_IDS = [
  'admin',
  'treasurer',
  'secretary',
  'coach',
  'official',
  'player',
] as const

export type SystemRoleId = (typeof SYSTEM_ROLE_IDS)[number]

/**
 * Définition de seed d'un rôle (hors `createdAt`, posé en `serverTimestamp()`
 * à l'écriture). Partagé entre la liste système et les customs amorcés.
 */
export interface RoleSeed {
  /** Doc id Firestore. Pour les rôles système = la clé canonique. */
  id: string
  name: string
  type: RoleType
  color: string
}

/**
 * Seed des 6 rôles système — source de vérité pour l'amorçage de `/roles`
 * sur un projet vierge. Les `id` sont les clés canoniques `/users.roles`.
 */
export const SYSTEM_ROLE_SEEDS: readonly RoleSeed[] = [
  { id: 'admin', name: 'Admin', type: 'system', color: '#fde68a' },
  { id: 'treasurer', name: 'Trésorier', type: 'system', color: '#fce7f3' },
  { id: 'secretary', name: 'Secrétaire', type: 'system', color: '#cffafe' },
  { id: 'coach', name: 'Coach', type: 'system', color: '#fef3c7' },
  { id: 'official', name: 'Officiel', type: 'system', color: '#dcfce7' },
  { id: 'player', name: 'Joueur', type: 'system', color: '#dbeafe' },
]

/**
 * Seed des rôles custom amorcés par défaut sur un projet vierge (optionnels —
 * l'admin peut les supprimer/éditer ensuite). Ids stables pour rester
 * idempotents au re-seed.
 */
export const DEFAULT_CUSTOM_ROLE_SEEDS: readonly RoleSeed[] = [
  { id: 'referee', name: 'Arbitre', type: 'custom', color: '#ede9fe' },
  { id: 'comite', name: 'Comité', type: 'custom', color: '#f1f5f9' },
]
