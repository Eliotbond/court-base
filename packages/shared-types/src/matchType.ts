import type { Timestamp } from './index'

/**
 * Document `/matchTypes/{matchTypeId}` — type de compétition.
 * Voir docs/firebase.md (section /matchTypes).
 *
 * Définit les besoins officiels (`homeOfficialRequirements`) et la taille
 * de court requise. Le DataTable du Dashboard utilise `name` + `color`.
 */
export type CourtSize = 'small' | 'normal' | 'large'

export interface OfficialRequirement {
  level: number
  count: number
}

export interface MatchTypeData {
  name: string
  requiredCourtSize: CourtSize
  homeOfficialRequirements: OfficialRequirement[]
  awayOfficialCount: number
  /** Couleur d'affichage (chip, badge). Hex. */
  color: string
  active: boolean
  createdAt: Timestamp
}

export type MatchType = MatchTypeData & { id: string }
