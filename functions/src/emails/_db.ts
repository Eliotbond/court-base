/**
 * Lazy Admin SDK Firestore handle pour le module `emails/`.
 *
 * Pattern reproduit depuis `dues/_helpers.ts` pour rester découplé d'autres
 * dossiers. `initializeApp()` happens dans `src/index.ts`.
 */
import * as admin from 'firebase-admin'
import type { Firestore } from 'firebase-admin/firestore'

export function db(): Firestore {
  return admin.firestore()
}

export const Timestamp = admin.firestore.Timestamp

export function serverTimestamp(): FirebaseFirestore.FieldValue {
  return admin.firestore.FieldValue.serverTimestamp()
}

export const FieldValue = admin.firestore.FieldValue
