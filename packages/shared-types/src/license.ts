import type { Timestamp } from './index'

/**
 * Document `/licenseRequests/{requestId}` — coach (mobile) demande licence
 * pour un joueur. Voir docs/firebase.md + main.md (license requests).
 *
 * Approval → `member.licensed = true` (procédure fédérale réelle hors-bande).
 */
export type LicenseRequestStatus = 'pending' | 'approved' | 'rejected'

export interface LicenseRequestData {
  memberId: string
  teamId: string
  /** uid coach mobile. */
  requestedBy: string
  status: LicenseRequestStatus
  reviewedBy: string | null
  reviewedAt: Timestamp | null
  adminComment: string | null
  createdAt: Timestamp
}

export type LicenseRequest = LicenseRequestData & { id: string }
