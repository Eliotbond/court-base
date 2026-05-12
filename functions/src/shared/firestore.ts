/**
 * Firestore Admin SDK accessor.
 *
 * Centralise l'accès au client Firestore Admin pour que le reste du code n'importe
 * jamais `firebase-admin` directement et reste testable (mockable via vitest).
 *
 * NOTE: `admin.initializeApp()` est appelé dans `src/index.ts`. Ce module suppose
 * que l'init a déjà eu lieu (toujours vrai en runtime Cloud Functions).
 */
import * as admin from 'firebase-admin'

/** Retourne l'instance Firestore Admin. Wrappé pour faciliter le mocking en test. */
export const db = (): FirebaseFirestore.Firestore => admin.firestore()
