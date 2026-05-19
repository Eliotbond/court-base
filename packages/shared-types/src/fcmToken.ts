import type { Timestamp } from './index'

/**
 * Document `/users/{uid}/fcmTokens/{tokenId}` — token de push FCM d'un appareil.
 * Voir docs/firebase.md (section /users/{uid}/fcmTokens).
 *
 * L'ID du document EST la chaîne du token FCM — ce qui donne une déduplication
 * naturelle : le client fait `setDoc(token, ...)` à chaque démarrage / refresh,
 * sans jamais créer de doublon.
 *
 * Un user peut avoir N appareils (téléphone + tablette) → une sous-collection
 * plutôt qu'un champ unique sur `/users`. La Function `fanoutNotification`
 * supprime le doc quand FCM signale le token invalide (purge des tokens morts).
 */
export interface FcmTokenData {
  /** La chaîne du token FCM (égale à l'ID du document — dénormalisée pour lecture). */
  token: string
  platform: 'ios' | 'android'
  createdAt: Timestamp
  /** Mis à jour à chaque ré-enregistrement du token (démarrage app / refresh). */
  lastSeenAt: Timestamp
}

export type FcmToken = FcmTokenData & { id: string }
