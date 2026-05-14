/**
 * Local helpers for the `majority/` Cloud Functions.
 *
 * Mirrors the pattern used in `functions/src/dues/_helpers.ts` so the file
 * stays trivially mockable (single `db()` import to stub) without depending
 * on a particular `shared/` contract.
 */
import * as admin from 'firebase-admin'
import type {
  CollectionReference,
  DocumentData,
  Firestore,
  Timestamp as AdminTimestamp,
} from 'firebase-admin/firestore'

/** Lazy Admin SDK Firestore handle. `initializeApp()` happens in `src/index.ts`. */
export function db(): Firestore {
  return admin.firestore()
}

/** Convenience: typed collection ref. */
export function col<T = DocumentData>(path: string): CollectionReference<T> {
  return db().collection(path) as CollectionReference<T>
}

/** Firestore Timestamp class (re-export for tests / typings). */
export const Timestamp = admin.firestore.Timestamp

/** Firestore sentinel for server-set timestamps. */
export function serverTimestamp(): FirebaseFirestore.FieldValue {
  return admin.firestore.FieldValue.serverTimestamp()
}

/**
 * Compute the Timestamp representing "18 years ago" from a given reference
 * Timestamp. Used by `onMajorityReached` to filter members whose `birthDate`
 * is on or before this threshold (i.e., already 18+).
 *
 * NOTE: We use raw `seconds - 18 * 365.25 * 86400` arithmetic. This matches
 * the day-grained granularity used elsewhere in the codebase (see
 * `dues/_helpers.addDaysToTimestamp`) and is acceptable for a daily-run
 * scheduled job: any precision drift around DST / leap seconds resolves
 * itself within at most one day, which the next run picks up.
 */
export function eighteenYearsAgo(now: AdminTimestamp): AdminTimestamp {
  const SECONDS_PER_YEAR = Math.round(365.25 * 86_400)
  return new admin.firestore.Timestamp(
    now.seconds - 18 * SECONDS_PER_YEAR,
    now.nanoseconds,
  )
}

/** Maximum docs per Firestore WriteBatch (hard SDK limit). */
export const MAX_BATCH_WRITES = 500
