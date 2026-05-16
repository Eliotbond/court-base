/**
 * Local type aliases for the `officials/` handlers.
 *
 * Pure re-export shim over `@club-app/shared-types` — keeps the handler
 * imports stable while the canonical Firestore schema lives in the shared
 * package (`notification.ts` is now a real type, plus the `/matches` types
 * needed for the away-match staffing scan).
 */
export type {
  BookingData,
  OfficialAssignmentData,
  OfficialAssignmentStatus,
} from '@club-app/shared-types'
export type { MatchTypeData, OfficialRequirement } from '@club-app/shared-types'
export type { MatchData, MatchKind, MatchStatus } from '@club-app/shared-types'
export type {
  NotificationData,
  NotificationType,
  NotificationTargetAudience,
} from '@club-app/shared-types'
