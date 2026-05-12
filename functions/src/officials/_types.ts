/**
 * Local type aliases for the `officials/` handlers.
 *
 * Re-exports the booking/matchType types from `@club-app/shared-types` and
 * defines `NotificationData` locally — `packages/shared-types/src/notification.ts`
 * is currently a placeholder (`export {}`) and we don't want to touch it from
 * this directory (paths-disjoint constraint). The shape mirrors the
 * `/notifications` schema documented in `docs/firebase.md`.
 *
 * Once shared-types ships a real notification type this file becomes a pure
 * re-export shim.
 */
import type { Timestamp } from '@club-app/shared-types'

export type {
  BookingData,
  OfficialAssignmentData,
  OfficialAssignmentStatus,
} from '@club-app/shared-types'
export type { MatchTypeData, OfficialRequirement } from '@club-app/shared-types'

export type NotificationType =
  | 'new_match'
  | 'officials_needed'
  | 'urgent'
  | 'match_reminder'

export type NotificationTargetAudience =
  | 'all_officials'
  | 'unassigned_officials'
  | 'assigned_officials'

export interface NotificationData {
  type: NotificationType
  title: string
  body: string
  /** Sender uid, or `null` when the notification is auto-generated. */
  sentBy: string | null
  targetAudience: NotificationTargetAudience
  relatedBookingId: string | null
  createdAt: Timestamp
  /** uids of users who have marked the notification as read. */
  readBy: string[]
}
