/**
 * Helpers locaux aux Cloud Functions `registrations/`.
 *
 * Mirrors le pattern de `functions/src/majority/_helpers.ts` : un seul accès
 * Firestore mockable + utilitaires de calcul (âge, levenshtein, etc.).
 */
import * as admin from 'firebase-admin'
import type {
  CollectionReference,
  DocumentData,
  Firestore,
  Timestamp as AdminTimestamp,
} from 'firebase-admin/firestore'

export function db(): Firestore {
  return admin.firestore()
}

export function col<T = DocumentData>(path: string): CollectionReference<T> {
  return db().collection(path) as CollectionReference<T>
}

export const Timestamp = admin.firestore.Timestamp

export function serverTimestamp(): FirebaseFirestore.FieldValue {
  return admin.firestore.FieldValue.serverTimestamp()
}

/**
 * Distance de Levenshtein (≤ 16 chars en pratique pour les noms). Itératif
 * avec une matrice plate pour rester low-overhead — pas de récursion.
 *
 * Utilisé par `matchExistingMember` pour fuzzy-match (firstName + lastName)
 * quand l'AVS est inconnu. Seuil cible : ≤ 2 sur la somme des deux.
 */
export function levenshtein(a: string, b: string): number {
  const an = a.length
  const bn = b.length
  if (an === 0) return bn
  if (bn === 0) return an
  // Single-row DP, on garde une row précédente.
  const prev = new Array<number>(bn + 1)
  for (let j = 0; j <= bn; j++) prev[j] = j
  for (let i = 1; i <= an; i++) {
    let curPrev = prev[0]!
    prev[0] = i
    for (let j = 1; j <= bn; j++) {
      const tmp = prev[j]!
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      prev[j] = Math.min(
        prev[j]! + 1,           // suppression
        prev[j - 1]! + 1,       // insertion
        curPrev + cost,         // substitution
      )
      curPrev = tmp
    }
  }
  return prev[bn]!
}

/** Normalisation des noms pour fuzzy match : lowercase + trim + diacritiques. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
}

/**
 * Renvoie le Timestamp correspondant à `years` années avant `now`. Utilisé
 * pour les checks "déjà majeur" (becomeOwnerOfMyMember) et pour valider la
 * tranche d'âge sur une registration. Day-grained — précision suffisante.
 */
export function yearsAgo(now: AdminTimestamp, years: number): AdminTimestamp {
  const SECONDS_PER_YEAR = Math.round(365.25 * 86_400)
  return new admin.firestore.Timestamp(
    now.seconds - years * SECONDS_PER_YEAR,
    now.nanoseconds,
  )
}

/**
 * Crée un AVS normalisé (digits seulement, longueur 13). Retourne `null` si
 * la chaîne ne contient pas exactement 13 chiffres après nettoyage. Utilisé
 * pour le matching exact AVS et pour le checksum côté server.
 */
export function normalizeAvs(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  return digits.length === 13 ? digits : null
}
