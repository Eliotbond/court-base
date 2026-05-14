import type { Timestamp } from './index'

/**
 * **Cotisation membre** (facture annuelle) stockée dans
 * `/dues/{cotisationId}`. La collection Firestore garde le nom `dues`
 * (legacy — pas de migration data prévue) ; seul le namespace TypeScript
 * est renommé `Cotisation` pour refléter la terminologie métier FR.
 *
 * Voir docs/firebase.md (section `/dues`) + docs/main.md (lifecycle).
 *
 * Lifecycle : `pending_grace` (J0) → `issued` (J+gracePeriodDays) →
 * `overdue` (J+gracePeriodDays+paymentDueDays). Paiement manuel par admin.
 * Géré par Functions (`initiateDuesOnPlayerActivation`, `issueDuesScheduled`,
 * `markOverdueScheduled`, `syncMemberDuesStatus`).
 */
export type CotisationStatus =
  | 'pending_grace'
  | 'issued'
  | 'paid'
  | 'overdue'
  | 'excepted'
  | 'cancelled'

export type CotisationPaymentMethod = 'cash' | 'transfer' | 'other'

export interface CotisationData {
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
  status: CotisationStatus
  paidAt: Timestamp | null
  paidAmount: number | null
  paymentMethod: CotisationPaymentMethod | null
  /** uid admin qui a recorded le paiement. */
  recordedBy: string | null
  exceptionRequestId: string | null
  notes: string | null
  /**
   * Référence de virement déterministe (ex. `"DUE-{shortDueId}"`), affichée
   * dans l'email de demande de paiement et attendue dans le champ
   * "référence" du virement bancaire. Posée à la création de la cotisation
   * par `initiateDuesOnPlayerActivation`. `null` pour les lignes legacy
   * antérieures au chantier cotisation/email.
   */
  paymentReference: string | null
  /**
   * Marqueur d'idempotence pour l'email "à payer". Non-null ⇒ un mail
   * `dues_payment_request` a déjà été écrit dans `/pendingEmails` pour cette
   * cotisation — on ne re-déclenche pas. Posé par la fonction qui produit
   * l'email (à l'émission `issued` ou immédiatement à la création si la
   * cotisation naît déjà `issued` car `gracePeriodDays === 0`).
   */
  emailedAt: Timestamp | null
  createdAt: Timestamp
}

export type Cotisation = CotisationData & { id: string }

/**
 * Document `/paymentExceptionRequests/{requestId}` — coach demande override
 * d'exclusion. Voir docs/firebase.md + main.md (flow exception).
 */
export type PaymentExceptionStatus = 'pending' | 'approved' | 'rejected'

export interface PaymentExceptionRequestData {
  /**
   * Référence vers la cotisation visée. Nom du champ Firestore conservé
   * (`dueId`) pour ne pas casser la collection `/paymentExceptionRequests`
   * existante — la migration TypeScript-only ne touche pas le schéma data.
   */
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
