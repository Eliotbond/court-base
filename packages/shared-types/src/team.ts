import type { Timestamp } from './index'
import type { TeamTagRef } from './tag'

/**
 * Document `/teams/{teamId}` — équipe du club.
 * Voir docs/firebase.md (section /teams/{teamId}).
 *
 * Les teams persistent cross-saisons via `activeSeasonIds[]`. Le montant des
 * cotisations est par-équipe (`duesAmount`, CHF/joueur/an).
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
  /** Cotisation annuelle CHF/joueur. */
  duesAmount: number
  schedulingConstraints: TeamSchedulingConstraints
  /**
   * Tags attachés à l'équipe (référence + flag d'affichage par-équipe).
   * Cf. /tags référentiel et docs/main.md ("Tags d'équipes").
   */
  tags: TeamTagRef[]
  active: boolean
  createdAt: Timestamp
}

export type Team = TeamData & { id: string }
