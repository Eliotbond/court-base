import type { Timestamp } from './index'

/**
 * Document `/dues/{dueId}` — cotisation joueur/saison/team.
 * Voir docs/firebase.md (section /dues) + main.md (lifecycle).
 *
 * Lifecycle : `pending_grace` (J0) → `issued` (J+gracePeriodDays) →
 * `overdue` (J+gracePeriodDays+paymentDueDays). Payment manuel par admin.
 * Géré par Functions (`initiateDuesOnPlayerActivation`, `issueDuesScheduled`,
 * `markOverdueScheduled`, `syncMemberDuesStatus`).
 */
export type DueStatus =
  | 'pending_grace'
  | 'issued'
  | 'paid'
  | 'overdue'
  | 'excepted'
  | 'cancelled'

export type DuePaymentMethod = 'cash' | 'transfer' | 'other'

export interface DueData {
  memberId: string
  teamId: string
  seasonId: string
  /** Copié de team.duesAmount à la création. */
  amount: number
  /** J0 (joueur ajouté à team.playerIds). */
  activatedAt: Timestamp
  /**
   * Posé à la création par `initiateDuesOnPlayerActivation` :
   * `issuedAt = activatedAt + gracePeriodDays`. La transition
   * `pending_grace → issued` ne modifie PAS `issuedAt` — elle ne change
   * que `status` et pose `dueAt`. Le type reste `| null` pour tolérer les
   * lignes legacy / corrompues (cf. garde défensive dans `issueDuesScheduled`).
   */
  issuedAt: Timestamp | null
  /** `dueAt = issuedAt + paymentDueDays`. Posé par `issueDuesScheduled` à la transition `pending_grace → issued`. Null tant que `pending_grace`. */
  dueAt: Timestamp | null
  status: DueStatus
  paidAt: Timestamp | null
  paidAmount: number | null
  paymentMethod: DuePaymentMethod | null
  /** uid admin qui a recorded le paiement. */
  recordedBy: string | null
  exceptionRequestId: string | null
  notes: string | null
  createdAt: Timestamp
}

export type Due = DueData & { id: string }

/**
 * Document `/paymentExceptionRequests/{requestId}` — coach demande override
 * d'exclusion. Voir docs/firebase.md + main.md (flow exception).
 */
export type PaymentExceptionStatus = 'pending' | 'approved' | 'rejected'

export interface PaymentExceptionRequestData {
  dueId: string
  memberId: string
  teamId: string
  /** uid du coach. */
  requestedBy: string
  reason: string
  status: PaymentExceptionStatus
  reviewedBy: string | null
  reviewedAt: Timestamp | null
  adminComment: string | null
  newIssuedAt: Timestamp | null
  newDueAt: Timestamp | null
  createdAt: Timestamp
}

export type PaymentExceptionRequest = PaymentExceptionRequestData & { id: string }
