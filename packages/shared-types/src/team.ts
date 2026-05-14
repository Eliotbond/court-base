import type { Timestamp } from './index'
import type { TeamTagRef } from './tag'

/**
 * Document `/teams/{teamId}` — équipe du club.
 * Voir docs/firebase.md (section /teams/{teamId}).
 *
 * Les teams persistent cross-saisons via `activeSeasonIds[]`. La cotisation
 * de l'équipe est référencée via `cotisationId` (cf. /cotisations).
 *
 * Note: pour l'instant seuls les champs nécessaires au Dashboard sont
 * exposés strictement (`id`, `name`, `categoryId`). Les autres seront ajoutés
 * au fil du dev des écrans Teams / Season planning assistant.
 *
 * `categoryId` est une référence vers `/categories/{categoryId}` (référentiel
 * éditable par l'admin). Le libellé et la tranche d'âge sont résolus à la
 * lecture côté repo — pas de dénormalisation.
 */
export type TeamGender = 'M' | 'F' | 'mixed'

export type TeamRegistrationStatus = 'open' | 'conditional' | 'closed'

export interface TeamSchedulingPreferredDay {
  dayOfWeek: number
  priority: number
}

export interface TeamCoachAvailability {
  coachMemberId: string
  unavailableDays: number[]
  unavailableSlots: string[]
}

export interface TeamSchedulingConstraints {
  preferredDays: TeamSchedulingPreferredDay[]
  /** "HH:MM" */
  maxStartTime: string
  minHoursBetweenSlots: number
  trainingsPerWeek: number
  anticipatedMatches: number
  coachAvailability: TeamCoachAvailability[]
}

export interface TeamData {
  /** Ex. "U20F" */
  name: string
  /** Référence vers `/categories/{categoryId}`. */
  categoryId: string
  gender: TeamGender
  /** memberIds des coachs (cumulable avec /users.teamIds côté coach scope). */
  coachIds: string[]
  /** memberIds des joueurs. */
  playerIds: string[]
  activeSeasonIds: string[]
  /**
   * Référence vers `/cotisations/{id}` — montant et description résolus à la
   * lecture (pas dénormalisé). Cf. docs/main.md → 'Cotisations'.
   */
  cotisationId: string
  schedulingConstraints: TeamSchedulingConstraints
  /**
   * Tags attachés à l'équipe (référence + flag d'affichage par-équipe).
   * Cf. /tags référentiel et docs/main.md ("Tags d'équipes").
   */
  tags: TeamTagRef[]
  /**
   * Statut d'ouverture aux nouvelles inscriptions (saison courante).
   * Affiché publiquement dans l'app register (TeamPicker §4.5 du brief).
   */
  registrationStatus: TeamRegistrationStatus
  /**
   * Manuel d'inscription affiché en branche "équipe ouverte" (markdown court).
   * Écrit par le coach ou l'admin depuis l'app web.
   */
  openHandbook: string
  /**
   * Description des conditions affichée en branche "équipe sous conditions"
   * (markdown court).
   */
  conditionalDescription: string
  /**
   * Liste de critères tagués pour les équipes sous conditions (chips d'affichage).
   */
  conditionalCriteria: string[]
  /**
   * Accroche courte affichée sur la fiche publique de l'équipe (app register).
   * `null` = pas d'accroche, on affiche le nom de l'équipe seul.
   */
  publicTagline: string | null
  /**
   * memberId du coach affiché comme "head coach" sur la fiche publique
   * (quand `coachIds` en contient plusieurs). `null` = premier de la liste utilisé.
   */
  publicHeadCoachMemberId: string | null
  active: boolean
  createdAt: Timestamp
}

export type Team = TeamData & { id: string }
