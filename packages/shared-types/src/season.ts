import type { Timestamp } from './index'

/**
 * Document `/seasons/{seasonId}` — saison sportive du club.
 * Voir docs/firebase.md (section /seasons/{seasonId}).
 *
 * Lifecycle (voir docs/main.md) :
 *   `draft` → `active` → `archived`
 *
 * - Une saison reste en `draft` tant que l'admin n'a pas confirmé l'activation
 *   via le dry-run. L'activation déclenche la Function `generateSeasonBookings`
 *   qui hydrate `/bookings` à partir des `timeSlots` (hors closure periods).
 * - `archived` est terminal : la saison est lisible mais plus modifiable.
 * - `activeVenueIds` restreint la génération aux venues sélectionnés (un club
 *   peut tourner sur un sous-ensemble de ses venues pour une saison donnée).
 * - `closurePeriodIds` référence `/closurePeriods/{periodId}` (cross-saisons).
 * - `generatedAt` est null tant que la saison est en `draft` ; il est posé par
 *   `generateSeasonBookings` quand les bookings sont créés.
 */
export type SeasonStatus = 'draft' | 'active' | 'archived'

export interface SeasonData {
  /** Libellé humain. Ex. "2025-2026" ou "Saison 2025-26". */
  name: string
  startDate: Timestamp
  endDate: Timestamp
  status: SeasonStatus
  /** Venues sélectionnés pour cette saison (refs /venues). */
  activeVenueIds: string[]
  /** Closure periods appliquées à cette saison (refs /closurePeriods). */
  closurePeriodIds: string[]
  /** Posé par `generateSeasonBookings` au passage en `active` ; null en draft. */
  generatedAt: Timestamp | null
}

export type Season = SeasonData & { id: string }
