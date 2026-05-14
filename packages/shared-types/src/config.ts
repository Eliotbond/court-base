import type { Timestamp } from './index'

/**
 * Document `/config/club` — singleton (un projet = un club).
 * Voir docs/firebase.md (section /config/club).
 *
 * Le projet *est* le club. Ce doc ne porte que la config + identité.
 */

/** Seuils de rentabilité officials (matches/saison). Calcul client-side. */
export interface OfficialsConfig {
  /** Coût licence officiel en CHF (défaut 140). */
  licenseFee: number
  /** Matches/saison à partir duquel l'officiel est "rentable" (vert). */
  thresholdGreen: number
  /** Borne basse du warning (orange). `< thresholdOrange` = rouge. */
  thresholdOrange: number
}

/** Config dues — grace period et délai de paiement. */
export interface DuesConfig {
  /** Jours avant l'émission auto du due (`pending_grace` → `issued`). */
  gracePeriodDays: number
  /** Jours après émission avant le passage en `overdue`. */
  paymentDueDays: number
}

export interface ClubAddress {
  street: string
  city: string
  zip: string
  country: string
}

/**
 * Contact principal du club — affiché dans l'app (Settings → General, écrans
 * publics, etc.). Vit dans `/config/club` (même cadence de modification que
 * l'identité club, même frontière de sécurité admin-only).
 */
export interface ClubContact {
  email: string
  phone: string
}

/**
 * Coordonnées bancaires du club — utilisées pour générer les emails de
 * demande de paiement (cotisations) et l'écran "Payer" côté
 * `apps/courtbase-register`. Tous les champs sont `null` tant que l'admin
 * n'a pas saisi l'info dans Settings → Cotisations / Banque.
 *
 * Sécurité : write admin-only (même frontière que le reste de `/config/club`).
 * Le contenu est diffusé en clair dans les emails de demande de paiement —
 * pas de PII tierce ici, c'est l'IBAN du club.
 */
export interface BankingInfo {
  iban: string | null
  bic: string | null
  bankName: string | null
  accountHolder: string | null
  /**
   * Texte libre affiché dans l'email/écran de paiement (ex. "Indiquer nom +
   * prénom joueur en référence"). Concaténé après l'IBAN par les templates.
   */
  paymentInstructions: string | null
}

export interface ClubConfigData {
  name: string
  /**
   * Slug court (`'bcls'`) — utilisé pour URLs, share codes, deep-links mobile.
   * Lowercase + chiffres + tirets uniquement (validé côté UI).
   */
  shortCode: string
  logo: string | null
  address: ClubAddress | null
  contact: ClubContact
  /**
   * Coordonnées bancaires (RIB/IBAN du club). `null` tant que pas saisi —
   * dans ce cas les emails de demande de paiement omettent la section
   * "comment payer" et l'UI register affiche un message d'attente.
   */
  banking: BankingInfo | null
  officialsConfig: OfficialsConfig
  duesConfig: DuesConfig
  createdAt: Timestamp
  /** uid du créateur (rootAdmin du provisioning). */
  createdBy: string
}

export type ClubConfig = ClubConfigData & { id: string }

/**
 * Payload accepté par `settings.repo.upsertClubConfig` côté web — tous les
 * champs sont optionnels (merge partiel sur le doc singleton via `setDoc({
 * merge: true })`). Voir `config_club_upsert_pattern` (mémoire).
 *
 * Garde ce type **synchrone** avec `ClubConfigData` : tout nouveau champ
 * éditable depuis Settings doit apparaître ici aussi.
 */
export interface ClubConfigPatch {
  name?: string
  shortCode?: string
  logo?: string | null
  address?: ClubAddress | null
  contact?: ClubContact
  banking?: BankingInfo | null
  officialsConfig?: OfficialsConfig
  duesConfig?: DuesConfig
}

// ---------------------------------------------------------------------------
// Types adjacents lus / écrits par l'écran Settings — collections séparées
// dans Firestore mais regroupées ici parce que `role.ts` est vide et qu'on
// n'ouvre pas de nouveau fichier de types tant que les autres screens ne le
// nécessitent pas (cf. consigne agent Settings).
//
// Quand `role.ts` sera implémenté (ou `closurePeriod.ts` créé) ces types
// migreront — pour l'instant ils vivent ici, `index.ts` les ré-exporte déjà
// via `export * from './config'`.
// ---------------------------------------------------------------------------

/** Document `/roles/{roleId}` — voir docs/firebase.md section /roles. */
export type RoleType = 'system' | 'custom'

export interface RoleData {
  /** Nom affiché (ex. "Comité"). */
  name: string
  /** `system` = `player|official|coach|referee` (non-supprimables). */
  type: RoleType
  /** Couleur hex pour le badge UI (palette tokens design). */
  color: string
  createdAt: Timestamp
}

export type Role = RoleData & { id: string }

/** Document `/closurePeriods/{periodId}` — voir docs/firebase.md. */
export type ClosurePeriodType = 'holiday' | 'custom'

export interface ClosurePeriodData {
  name: string
  startDate: Timestamp
  endDate: Timestamp
  type: ClosurePeriodType
  createdBy: string
}

export type ClosurePeriod = ClosurePeriodData & { id: string }

/**
 * Statut d'abonnement SaaS — affiché sur le Settings (carte "Abonnement").
 *
 * NB : pas (encore) dans `/config/club` côté Firestore — vit dans le
 * control-plane (`/registry/clients/{clientId}.subscription`). Le web app
 * lit ces infos via une callable read-only ; on les expose ici parce que
 * l'écran les affiche.
 */
export type SubscriptionStatus = 'paid' | 'free_tier' | 'trial' | 'past_due'

export interface SubscriptionInfo {
  status: SubscriptionStatus
  /** Libellé du plan ("Club · CHF 590 / an"). */
  planLabel: string
  /** Date de renouvellement (timestamp neutre, formatté côté UI). */
  renewsAt: Timestamp | null
  /** Quota inclus dans le plan (nombre de membres). */
  memberCap: number
  /** Compteur courant côté client (calculé côté repo). */
  memberCount: number
}
