import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getFunctions } from 'firebase/functions'

/**
 * Firebase init — un seul projet Firebase par instance d'app (modèle SAAS
 * one-project-per-client). `courtbase-app` partage le **même projet** que
 * `apps/web` et `apps/courtbase-register`. Config via Vite env vars
 * (`apps/courtbase-app/.env.local`, cf. `.env.example`).
 *
 * Note FCM Messaging : import dynamique (`getMessaging`) à faire **dans le
 * composable** qui demande le push, pas ici — `getMessaging()` lance
 * `isSupported()` async et n'est dispo que sur navigateurs compatibles.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseApp = initializeApp(firebaseConfig)
export const auth = getAuth(firebaseApp)
export const db = getFirestore(firebaseApp)
export const functions = getFunctions(firebaseApp, 'europe-west6')
