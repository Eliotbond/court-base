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
