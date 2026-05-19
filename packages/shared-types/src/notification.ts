import type { Timestamp } from './index'

/**
 * Document `/notifications/{notificationId}` — notification poussée vers les
 * officiels (besoin d'arbitres, nouveau match, rappel, urgence).
 * Voir docs/firebase.md (section /notifications).
 *
 * Créées par l'admin depuis la page Officials (ou auto par une Cloud Function
 * — d'où `sentBy: null`). `readBy` est append-only : chaque officiel y ajoute
 * son uid à la lecture.
 */
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
  /** uid de l'admin émetteur ; `null` si générée automatiquement. */
  sentBy: string | null
  targetAudience: NotificationTargetAudience
  /**
   * Booking concerné — uniquement pour un match À DOMICILE (le booking porte
   * le créneau). `null` pour un match à l'extérieur ou hors-match.
   */
  relatedBookingId: string | null
  /**
   * Match concerné (`/matches/{id}`). Renseigné pour les notifications liées
   * à un match — notamment les matchs À L'EXTÉRIEUR, qui n'ont pas de booking
   * (`relatedBookingId` reste `null`). `null` si non rattachée à un match.
   */
  relatedMatchId: string | null
  createdAt: Timestamp
  /** uids des officiels qui ont lu la notification. */
  readBy: string[]
  /**
   * Posé par la Function `fanoutNotification` après l'envoi du push FCM.
   * Sert de garde d'idempotence : un re-delivery du trigger Firestore voit
   * `pushedAt != null` et skip l'envoi (pas de double push). `null` tant que
   * le fan-out n'a pas tourné.
   */
  pushedAt: Timestamp | null
}

export type Notification = NotificationData & { id: string }
