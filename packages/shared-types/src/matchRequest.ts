import type { Timestamp } from './index'

/**
 * Document `/matchRequests/{requestId}` — voir docs/firebase.md.
 *
 * Sert exclusivement à déplacer un `match_home` existant (validation admin).
 * Les coachs ne créent jamais de `matchRequest` pour une réservation ad-hoc.
 */
export type MatchRequestType = 'move_home'

export type MatchRequestStatus = 'pending' | 'approved' | 'rejected'

export interface MatchRequestData {
  /** Booking `match_home` à déplacer. */
  bookingId: string
  /** uid coach qui soumet la requête. */
  requestedBy: string
  requestType: MatchRequestType
  proposedDate: Timestamp | null
  proposedSlotId: string | null
  reason: string | null
  status: MatchRequestStatus
  /** uid admin qui review (null tant que pending). */
  reviewedBy: string | null
  reviewedAt: Timestamp | null
  adminComment: string | null
  createdAt: Timestamp
}

export type MatchRequest = MatchRequestData & { id: string }
