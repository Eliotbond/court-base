import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getFunctions } from 'firebase/functions'

/**
 * Firebase init — un seul projet par instance d'app (cf. modèle SAAS one-project-per-client).
 * Configuré via Vite env vars (`apps/web/.env.local` en dev).
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

// Functions runtime région-épinglée. Doit matcher `setGlobalOptions({ region: 'europe-west6' })`
// dans `functions/src/index.ts`. Sans cette région, le SDK appelle un endpoint us-central1
// qui n'existe pas → erreur "functions/internal" cryptique.
export const functions = getFunctions(firebaseApp, 'europe-west6')
