import type { Timestamp } from './index'

/**
 * Document `/bookings/{bookingId}` — instance concrète d'un slot à une date.
 * Voir docs/firebase.md (section /bookings).
 *
 * Append-only sur `actionLog`. Jamais supprimé : cancel = `status: "cancelled"`.
 * Sub-collections : `officialAssignments/` (sur `match_home`), `attendance/`.
 */
export type SlotType = 'training' | 'match_home' | 'match_away' | 'reserve' | 'custom'

export type BookingStatus = 'scheduled' | 'cancelled' | 'freed'

export type BookingCancelReason =
  | 'closure'
  | 'holiday'
  | 'manual'
  | 'series_edit'
  | 'match_home'
  | 'match_away'
  | 'coach_cancel'

export interface BookingActionLogEntry {
  at: Timestamp
  /** uid */
  by: string
  action: string
  note: string | null
}

export interface BookingData {
  seasonId: string
  venueId: string
  courtId: string
  timeSlotId: string
  teamId: string | null
  /** Mirroré depuis le slot à la génération. */
  slotType: SlotType
  matchTypeId: string | null
  /**
   * Référence au doc `/matches/{matchId}` si ce booking est rattaché à un
   * match home (relation bidirectionnelle avec `MatchData.bookingId`). `null`
   * sinon (training, reserve, custom, ou booking `match_home` pending pas
   * encore rattaché à un match). Cf. `repositories/matches.repo.ts`
   * (`createHomeMatch` / `deleteMatch` mutent ce champ via `writeBatch`
   * atomique).
   */
  matchId: string | null
  /**
   * Nom de l'équipe adverse (compétition externe). Pertinent uniquement quand
   * `slotType in ['match_home', 'match_away']`. `null` pour `training`,
   * `reserve`, `custom` (et également `null` pour les anciens bookings match
   * créés avant l'introduction du champ).
   */
  opponentName: string | null
  /**
   * Adresse libre du lieu de match à l'extérieur (rue + ville). Pertinent
   * **uniquement** quand `slotType === 'match_away'`. `null` sinon (y compris
   * pour `match_home`, où le lieu est dérivé de `venueId` + `courtId`).
   */
  awayAddress: string | null
  date: Timestamp
  /** "HH:MM" */
  startTime: string
  /** "HH:MM" */
  endTime: string
  status: BookingStatus
  cancelReason: BookingCancelReason | null
  /** Courts combinés : autres bookings linkés. */
  linkedBookingIds: string[]
  isCombinedCourtEvent: boolean
  /** Ref à `/bookingSeries/{seriesId}` ; `null` pour booking auto-généré par `generateSeasonBookings` ou booking manuel one-shot. */
  seriesId: string | null
  /** Date d'origine prévue par la série (utile si l'occurrence a été déplacée via override) ; `null` si pas membre d'une série. */
  originalDate: Timestamp | null
  /** `true` si créé manuellement (one-shot ou série), `false` si généré par Cloud Function. */
  isManual: boolean
  actionLog: BookingActionLogEntry[]
}

export type Booking = BookingData & { id: string }

/**
 * Document `/bookings/{bookingId}/officialAssignments/{assignmentId}`.
 * Voir docs/firebase.md (section officialAssignments).
 */
export type OfficialAssignmentStatus = 'pending' | 'confirmed' | 'declined'

export interface OfficialAssignmentData {
  memberId: string
  /** Niveau au moment de l'assignation (snapshot). */
  officialLevel: number
  status: OfficialAssignmentStatus
  assignedAt: Timestamp
  /** uid */
  assignedBy: string
  respondedAt: Timestamp | null
}

export type OfficialAssignment = OfficialAssignmentData & { id: string }
