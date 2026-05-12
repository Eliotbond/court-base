import type { Timestamp } from './index'

/**
 * Document `/teams/{teamId}` — équipe du club.
 * Voir docs/firebase.md (section /teams/{teamId}).
 *
 * Les teams persistent cross-saisons via `activeSeasonIds[]`. Le montant des
 * cotisations est par-équipe (`duesAmount`, CHF/joueur/an).
 *
 * Note: pour l'instant seuls les champs nécessaires au Dashboard sont
 * exposés strictement (`id`, `name`, `category`). Les autres seront ajoutés
 * au fil du dev des écrans Teams / Season planning assistant.
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
  category: string
  gender: TeamGender
  /** memberIds des coachs (cumulable avec /users.teamIds côté coach scope). */
  coachIds: string[]
  /** memberIds des joueurs. */
  playerIds: string[]
  activeSeasonIds: string[]
  /** Cotisation annuelle CHF/joueur. */
  duesAmount: number
  schedulingConstraints: TeamSchedulingConstraints
  active: boolean
  createdAt: Timestamp
}

export type Team = TeamData & { id: string }
