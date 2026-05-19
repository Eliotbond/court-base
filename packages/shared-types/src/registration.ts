import type { Timestamp } from './index'

/**
 * Document `/registrations/{registrationId}` — demande d'inscription self-service
 * créée via l'app `apps/courtbase-register`.
 * Voir `docs/chantier-registrations.md` §7.1 pour le détail produit.
 *
 * Les transitions de status post-`submitted` passent par callables (refuseRegistration,
 * onRegistrationStatusChanged, etc.) — pas de write client.
 */

export type RegistrationStatus =
  | 'draft'
  | 'submitted'
  | 'open_pending_trial'
  | 'conditional_pending_review'
  | 'conditional_pending_trial'
  | 'trial_in_progress'
  | 'confirmed_pending_dues'
  | 'active'
  | 'refused'
  | 'cancelled'

export type RegistrationFor = 'self' | 'dependent'

export type RegistrationRelationship =
  | 'parent'
  | 'legal_guardian'
  | 'sibling'
  | 'caritas'
  | 'other'

export type RegistrationActionType =
  | 'created'
  | 'submitted'
  | 'status_changed'
  | 'team_changed'
  | 'refused'
  | 'document_uploaded'

export interface RegistrationActionLogEntry {
  at: Timestamp
  byUid: string
  action: RegistrationActionType
  previousStatus: RegistrationStatus | null
  newStatus: RegistrationStatus | null
  note: string | null
}

/**
 * Identité du joueur soumise via l'app register. Transmise telle quelle au moment
 * de la registration ; un `/members/{id}` n'est créé qu'à l'acceptation par le coach
 * (sauf si `matchedMemberId` lie à un member existant).
 */
export interface RegistrationPlayerIdentity {
  firstName: string
  lastName: string
  birthDate: Timestamp
  gender: 'M' | 'F' | 'other' | null
  /**
   * AVS au format 756.XXXX.XXXX.XX. `null` uniquement au stade `draft` (champ
   * pas encore rempli) — la callable `submitRegistration` rejette toute
   * soumission sans AVS valide : un joueur sans AVS ne peut pas s'inscrire via
   * le portail (cas asile / transfert étranger → traités hors portail).
   */
  avs: string | null
  /** Téléphone direct du joueur (recommandé, pas obligatoire). */
  phone: string | null
}

export interface RegistrationData {
  /** UID de l'auteur de la registration (créateur du compte register). */
  submittedByUid: string
  /** Type d'inscription : pour soi-même (majeur) ou pour un dépendant. */
  registrationFor: RegistrationFor
  /** Lien de parenté ou rôle, `null` si `registrationFor === 'self'`. */
  relationship: RegistrationRelationship | null
  /** Texte libre si `relationship === 'other'`, sinon `null`. */
  relationshipOther: string | null

  player: RegistrationPlayerIdentity

  /**
   * Lien à un `/members/{id}` existant, rattaché par match AVS exact confirmé
   * par l'utilisateur dans le wizard.
   * `null` = nouveau dossier qui sera créé à l'acceptation par le coach.
   */
  matchedMemberId: string | null

  /** ID de l'équipe choisie. */
  teamId: string

  // Historique sportif
  previouslyLicensed: boolean
  previousClubName: string | null
  previousClubAbroad: boolean
  /** Storage path de la lettre de sortie, `null` si pas uploadée. */
  transferLetterStoragePath: string | null
  /** Flag transverse, peut coexister avec n'importe quel `status`. */
  foreignTransfer: boolean

  // Lifecycle
  status: RegistrationStatus
  statusUpdatedAt: Timestamp
  trialStartedAt: Timestamp | null
  refusalReason: string | null
  refusedByUid: string | null

  /** Append-only log des transitions / actions. */
  actionLog: RegistrationActionLogEntry[]

  // Tracking notifs
  coachNotifiedAt: Timestamp | null
  adminNotifiedAt: Timestamp | null

  createdAt: Timestamp
}

export type Registration = RegistrationData & { id: string }

/**
 * Document `/teams/{teamId}/refusalLogs/{logId}` — audit des refus d'inscriptions
 * par les coachs. Écrit uniquement par la callable `refuseRegistration` (Admin SDK).
 * Lecture admin uniquement (audit anti-abus).
 */
export interface RefusalLogData {
  registrationId: string
  /** Dénormalisé pour faciliter le debug / l'audit. */
  playerName: string
  /** Motif libre, obligatoire (validation callable). */
  reason: string
  refusedAt: Timestamp
  /** UID du coach qui refuse. */
  refusedByUid: string
}

export type RefusalLog = RefusalLogData & { id: string }
