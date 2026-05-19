import { FirebaseError } from 'firebase/app'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import type {
  NotificationData,
  NotificationTargetAudience,
  NotificationType,
} from '@club-app/shared-types'
import { db } from '@/services/firebase'

/**
 * Repository Notifications — Firestore-backed pour `/notifications`.
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase (cf.
 * apps/web/CLAUDE.md — architecture en couches). Consommée par le store
 * `stores/officialStaffing.ts` (action `sendNotification`).
 *
 * Les rules couvrent déjà `/notifications` (création réservée à l'admin —
 * aucune modif `firestore.rules` ici). Une notification n'est jamais éditée
 * ni supprimée côté web : seul `readBy` évolue côté officiel (hors scope de
 * ce repo).
 */

const NOTIFICATIONS = 'notifications'

/**
 * Input d'une création de notification. `createdAt` et `readBy` sont posés
 * par le repo (`serverTimestamp()` / `[]`) — l'appelant ne les fournit pas.
 */
export interface CreateNotificationInput {
  type: NotificationType
  title: string
  body: string
  targetAudience: NotificationTargetAudience
  /** Booking concerné — uniquement pour un match à domicile ; `null` sinon. */
  relatedBookingId: string | null
  /** Match concerné (`/matches/{id}`) — renseigné pour un match à l'extérieur. */
  relatedMatchId: string | null
  /** uid de l'admin émetteur. */
  sentBy: string
}

/**
 * Crée un document `/notifications`. `createdAt` est posé via
 * `serverTimestamp()`, `readBy` initialisé à `[]`.
 *
 * @returns l'id du document créé.
 * @throws relance toute `FirebaseError` après log enrichi (la rule
 *   `permission-denied` doit remonter à l'UI pour signaler un défaut de
 *   rôle).
 */
export async function createNotification(
  input: CreateNotificationInput,
): Promise<string> {
  try {
    const payload: Omit<NotificationData, 'createdAt'> & {
      createdAt: ReturnType<typeof serverTimestamp>
    } = {
      type: input.type,
      title: input.title,
      body: input.body,
      sentBy: input.sentBy,
      targetAudience: input.targetAudience,
      relatedBookingId: input.relatedBookingId,
      relatedMatchId: input.relatedMatchId,
      createdAt: serverTimestamp(),
      readBy: [],
      pushedAt: null,
    }
    const ref = await addDoc(collection(db, NOTIFICATIONS), payload)
    return ref.id
  } catch (err: unknown) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`createNotification failed [${code}]`, err)
    throw err
  }
}
