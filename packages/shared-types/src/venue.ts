import type { GeoPoint, Timestamp } from './index'
import type { CourtSize } from './matchType'

/**
 * Document `/venues/{venueId}` — un lieu physique du club (salle, gymnase, etc.).
 * Voir docs/firebase.md (section /venues).
 *
 * - `closurePeriodIds` référence les `/closurePeriods/{periodId}` (closures
 *   partagés cross-saisons). Utilisé par `applyClosurePeriod` pour cascader.
 * - `customClosures` sont des fermetures ponctuelles propres au venue (travaux,
 *   événement privé). Elles ne sont pas réutilisables — vivent inline ici.
 * - `coordinates` permet d'afficher le venue sur la carte (mobile + web).
 */
export interface VenueCustomClosure {
  name: string
  startDate: Timestamp
  endDate: Timestamp
}

export interface VenueData {
  /** Libellé humain. Ex. "Salle des Marronniers". */
  name: string
  /** Adresse libre (ligne unique). Pas de structure forte pour l'instant. */
  address: string
  coordinates: GeoPoint
  /** Refs vers /closurePeriods (cross-saisons). */
  closurePeriodIds: string[]
  /** Fermetures ponctuelles propres au venue. */
  customClosures: VenueCustomClosure[]
}

export type Venue = VenueData & { id: string }

/**
 * Document `/venues/{venueId}/courts/{courtId}` — un court physique au sein d'un venue.
 * Voir docs/firebase.md (section /venues/{venueId}/courts).
 *
 * - `courtSize` est plat (pas de hiérarchie) — un match `match_home` requérant
 *   `large` n'est pas planifiable sur un `normal` ou `small`.
 * - `isCombined` + `combinedCourtIds` modélisent les terrains qui peuvent
 *   accueillir un match nécessitant plusieurs courts adjacents. La génération
 *   de booking remplit `linkedBookingIds` en conséquence (cf. booking.ts).
 */
export interface CourtData {
  name: string
  courtSize: CourtSize
  isCombined: boolean
  /** Si `isCombined`, IDs des autres courts couverts par cet "event court". */
  combinedCourtIds: string[]
  sport: string
  active: boolean
}

export type Court = CourtData & { id: string }

/**
 * Document `/venues/{venueId}/courts/{courtId}/timeSlots/{slotId}` — créneau
 * récurrent hebdomadaire défini sur un court, pour une saison donnée.
 * Voir docs/firebase.md (section /venues/.../timeSlots).
 *
 * - `dayOfWeek` suit la convention `Date.getUTCDay()` : 0 = dimanche … 6 = samedi.
 * - `startTime` / `endTime` au format `"HH:MM"` (24h, zero-padded).
 * - `seasonId` rattache le slot à une saison — la génération de bookings
 *   itère par saison et n'utilise que les slots de cette saison.
 * - `teamId` est requis pour les slots non-`reserve` (training/match_*).
 * - `matchTypeId` est requis si `slotType` ∈ {`match_home`, `match_away`}.
 * - `customTypeName` est utilisé uniquement quand `slotType === 'custom'`.
 */
export interface TimeSlotData {
  /** 0 = dimanche, 1 = lundi, …, 6 = samedi. */
  dayOfWeek: number
  /** "HH:MM" (24h). */
  startTime: string
  /** "HH:MM" (24h). */
  endTime: string
  label: string
  seasonId: string
  requiresFullCourt: boolean
  teamId: string | null
  slotType: 'training' | 'match_home' | 'match_away' | 'reserve' | 'custom'
  customTypeName: string | null
  /** Requis si `slotType` ∈ {match_home, match_away}. */
  matchTypeId: string | null
  active: boolean
}

export type TimeSlot = TimeSlotData & { id: string }
