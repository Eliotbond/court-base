/**
 * Helpers locaux pour les Cloud Functions `notifications/`.
 *
 * Fins wrappers autour du Firebase Admin SDK pour garder les handlers testables
 * (le code de prod passe par ces symboles, que les tests unitaires mockent).
 * Le `db()` canonique vit dans `src/shared/` — on le ré-expose ici pour que les
 * callers restent découplés de la structure des modules SDK.
 */
import * as admin from 'firebase-admin'
import type { Firestore } from 'firebase-admin/firestore'

import { db as sharedDb } from '../shared/firestore'

/** Handle Firestore Admin (lazy). `initializeApp()` a lieu dans `src/index.ts`. */
export function db(): Firestore {
  return sharedDb()
}

/** Sentinel Firestore pour les timestamps posés côté serveur. */
export function serverTimestamp(): FirebaseFirestore.FieldValue {
  return admin.firestore.FieldValue.serverTimestamp()
}

/** Classe Firestore Timestamp (ré-export pour tests / typings). */
export const Timestamp = admin.firestore.Timestamp
