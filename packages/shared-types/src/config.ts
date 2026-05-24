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

/**
 * Configuration de l'intégration Basketplan (Swiss Basketball / ORCA
 * Systems). Vit sous `/config/club.basketplan` — singleton par projet
 * (un projet Firebase = un club). `undefined` ou `enabled: false` =
 * intégration désactivée (le scheduler de sync no-op, les callables de
 * mapping restent disponibles pour préparer la migration).
 *
 * Voir `docs/basketplan-integration.md` § 4.3 pour la spec et § 5 pour les
 * services qui consomment ces champs. La fédération par défaut sert au
 * dropdown initial de la cascade de mapping et au ping `testConnection`.
 *
 * Cycle de vie :
 *  - `clubId` / `defaultFederationId` : saisis par l'admin via Settings →
 *    Intégrations → Basketplan.
 *  - `lastSyncAt` / `lastSyncError` : mis à jour par le scheduler nocturne
 *    (PR 2). `null` jusqu'à la première sync réussie / échouée.
 *
 * Sécurité : même frontière que le reste de `/config/club` (write
 * `admin` + `rootAdmin` uniquement, cf. `firestore.rules`).
 */
export interface BasketplanIntegrationConfig {
  /** Id Basketplan du club court-base (ex. 60 pour Marly). */
  clubId: number
  /**
   * Fédération principale du club (ex. 9 = AFBB). Sert de défaut au
   * dropdown du dialog de linkage et de cible au ping `testConnection`.
   * Une équipe peut être liée à des compétitions d'autres fédérations.
   */
  defaultFederationId: number
  /** Toggle global — `false` => scheduler no-op, UI reste accessible. */
  enabled: boolean
  /** Timestamp du dernier sync (réussi ou non). `null` tant qu'aucun run. */
  lastSyncAt?: Timestamp | null
  /** Message d'erreur en clair du dernier ping/sync KO. `null` si OK. */
  lastSyncError?: string | null
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
  /**
   * Intégration Basketplan (Swiss Basketball). `undefined` = jamais
   * configuré (intégration off par défaut sur un nouveau projet).
   * Voir `BasketplanIntegrationConfig` ci-dessus.
   */
  basketplan?: BasketplanIntegrationConfig
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
  /** Patch partiel de l'intégration Basketplan — voir `BasketplanIntegrationConfig`. */
  basketplan?: BasketplanIntegrationConfig
}

// ---------------------------------------------------------------------------
// Types adjacents lus / écrits par l'écran Settings — collections séparées
// dans Firestore mais regroupées ici parce qu'on n'ouvre pas de nouveau
// fichier de types tant que les autres screens ne le nécessitent pas.
//
// `RoleData` / `Role` ont migré vers `role.ts` (cf. provisioning de la vraie
// collection `/roles`) — `index.ts` les ré-exporte depuis là.
// ---------------------------------------------------------------------------

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
