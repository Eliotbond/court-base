/**
 * Types pour la couche de données simulées (mock). À terme, ces types seront
 * remplacés par les types canoniques de `@club-app/shared-types` quand on
 * basculera sur les vraies repos Firestore. Pour la phase mock, on reste sur
 * un sous-ensemble explicite et auto-suffisant — pas d'import depuis
 * shared-types pour éviter d'avoir à mocker tout le schéma backend.
 */

import type { AppRole } from './roles'

// ───────────────────────────────────────────────────────────────
// Member
// ───────────────────────────────────────────────────────────────

export type DuesStatus = 'paid' | 'pending_grace' | 'issued' | 'overdue' | 'excluded' | 'excepted'
export type MemberStatus = 'active' | 'archived'
export type MemberGender = 'M' | 'F' | 'other' | 'na'

export interface MockMember {
  id: string
  firstName: string
  lastName: string
  birthDate: string // ISO yyyy-mm-dd
  gender: MemberGender
  /** Équipes auxquelles le joueur appartient (références `team.id`). */
  teamIds: string[]
  /** Statut cotisation saison courante. */
  duesStatus: DuesStatus
  /** N° de licence fédérale (à vie). null tant que jamais licencié. */
  licenseNumber: string | null
  /** Doc licence officiel active (dénormalisé). */
  officialLicense: { level: number; seasonId: string } | null
  /** Qualification officiel (réglée admin, indépendante de la licence). */
  officialLevel: number | null
  /** Tuteurs (uid Auth). Pertinent si mineur. */
  guardianUserIds: string[]
  /** Avatar tone (dérivé d'un hash du nom — fixé pour l'instant). */
  avatarTone?: 'emerald' | 'sky' | 'amber' | 'violet' | 'rose'
  active: boolean
  status: MemberStatus
  /** AVS, masqué dans l'UI sauf toggle "Voir". */
  avs?: string
}

export interface MockTeam {
  id: string
  name: string
  categoryName: string
  categoryAgeRange: string | null
  tagName: string | null
  tagColor?: 'emerald' | 'sky' | 'amber' | 'violet' | 'rose' | 'slate'
  /** Coachs (uid Auth). */
  coachIds: string[]
  /** Roster (member ids). */
  playerIds: string[]
  /** Status d'ouverture aux inscriptions (cf. /registrations). */
  registrationStatus: 'open' | 'conditional' | 'closed'
  /** Cotisation référencée. Affichage seul ici. */
  cotisationPrice: number
  /** Prochain training résumé (déjà formatté en FR pour l'affichage). */
  nextTraining?: string
  /**
   * Créneaux hebdomadaires préférés (pré-formatés FR pour l'affichage en
   * pills, ex `['Mardi 18:00–19:30', 'Jeudi 18:00–19:30']`). Optionnel.
   */
  preferredSlots?: string[]
  /** Nombre d'entraînements / semaine (utilisé dans l'onglet "Info"). */
  trainingsPerWeek?: number
}

// ───────────────────────────────────────────────────────────────
// Match / Booking / Assignment
// ───────────────────────────────────────────────────────────────

export type MatchKind = 'home' | 'away'
export type AssignmentStatus = 'pending' | 'confirmed' | 'declined'

export interface MockMatch {
  id: string
  kind: MatchKind
  /** Équipe à domicile (uid de la team du club). */
  teamId: string
  /** Type match (libellé court, ex "CSJC", "AFBB", "Amical"). */
  matchType: string
  /** Date ISO yyyy-mm-dd. */
  date: string
  /** Heure de début hh:mm. */
  startTime: string
  /** Durée en heures (typique : 3). */
  durationHours: number
  /** Nom de l'équipe adverse. */
  opponent: string
  /** Salle + court pour home. Adresse libre pour away. */
  venueLabel: string
  /** Officiels staffés (au moins partiel) — référence `MockAssignment.id`. */
  assignmentIds: string[]
  /** Capacité totale d'officiels requise. */
  requiredOfficialsTotal: number
  /** Slot par niveau, ex `{1: 1, 2: 2}` = 1 officiel niveau 1 + 2 de niveau 2. */
  requiredByLevel: Record<number, number>
}

export interface MockAssignment {
  id: string
  matchId: string
  /** Membre officiel. */
  memberId: string
  /** Niveau requis pour ce slot. */
  requiredLevel: number
  status: AssignmentStatus
  /** Posé par : 'self' (auto-inscription) ou 'admin'. */
  createdBy: 'self' | 'admin'
}

// ───────────────────────────────────────────────────────────────
// Registration
// ───────────────────────────────────────────────────────────────

export type RegistrationStatus =
  | 'submitted'
  | 'open_pending_trial'
  | 'conditional_pending_review'
  | 'trial_in_progress'
  | 'confirmed_pending_dues'
  | 'active'
  | 'refused'

export interface MockRegistration {
  id: string
  /** Player full info (souvent un mineur). */
  playerFirstName: string
  playerLastName: string
  playerBirthDate: string
  playerGender: MemberGender
  /** Personne ayant soumis la registration (parent / tuteur). */
  submitterName: string
  submitterRelationship: 'parent' | 'tutor' | 'sibling' | 'caritas' | 'other' | 'self'
  /** Équipe ciblée. */
  teamId: string
  status: RegistrationStatus
  /** Date de soumission formatée FR pour l'UI. */
  submittedAt: string
  previouslyLicensed: boolean
  previousClubName?: string
  previousClubAbroad?: boolean
  /** Document lettre de sortie uploadé ? */
  hasTransferLetter?: boolean
  /** Motif si refusé. */
  refusalReason?: string
}

// ───────────────────────────────────────────────────────────────
// Notification
// ───────────────────────────────────────────────────────────────

export type NotifType = 'match' | 'urgent' | 'officials_needed' | 'bell' | 'info' | 'check'

export interface MockNotification {
  id: string
  type: NotifType
  title: string
  extract: string
  /** Timestamp formaté FR pour l'UI (ex "il y a 2 h"). */
  time: string
  unread: boolean
  /** Deep-link cible (route name + params). */
  deepLink?: { name: string; params?: Record<string, string> }
}

// ───────────────────────────────────────────────────────────────
// Requests (3 types)
// ───────────────────────────────────────────────────────────────

export type RequestKind = 'license' | 'payment_exception' | 'match_move'
export type RequestStatus = 'pending' | 'approved' | 'rejected'

export interface MockRequest {
  id: string
  kind: RequestKind
  status: RequestStatus
  /** Coach demandeur (pour licence + payment_exception + match_move). */
  requesterName: string
  /** Membre concerné (pour licence + payment_exception). */
  memberName?: string
  /** Match concerné (pour match_move). */
  matchOpponent?: string
  /** Motif libre saisi par le coach. */
  motivation: string
  /** Date de soumission formatée FR. */
  submittedAt: string
}

// ───────────────────────────────────────────────────────────────
// Dues
// ───────────────────────────────────────────────────────────────

export interface MockDue {
  id: string
  memberId: string
  amount: number
  status: DuesStatus
  /** Date d'émission formatée FR. */
  issuedAt: string
  /** Date d'échéance formatée FR. */
  dueAt?: string
  /** Date paiement si payée, formatée FR. */
  paidAt?: string
}

// ───────────────────────────────────────────────────────────────
// Session (mock auth + linked member)
// ───────────────────────────────────────────────────────────────

export interface MockSession {
  uid: string
  displayName: string
  email: string
  phone: string
  /** Rôles cumulables. */
  roles: AppRole[]
  /** Member lié au compte. null pour staff pur (admin sans member). */
  linkedMemberId: string | null
  /** Vrai si le profil `/users/{uid}` est "complété" (phone + address). */
  profileCompleted: boolean
}

// Re-export AppRole pour faciliter les imports depuis `@/types/mock`.
export type { AppRole } from './roles'
