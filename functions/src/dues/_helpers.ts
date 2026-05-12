/**
 * Local helpers for the `dues/` Cloud Functions.
 *
 * NOTE: We intentionally do NOT depend on `functions/src/shared/` — that
 * directory is owned by a parallel agent. Keep this file self-contained.
 *
 * If/when `shared/` exposes a stable `db()` / logger contract, swap these
 * out in a separate refactor PR.
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
 * Add `days` (calendar days) to a Firestore Timestamp and return a new
 * Timestamp. Used to compute `issuedAt` and `dueAt` derivation deterministically
 * from `activatedAt` / `issuedAt`.
 *
 * NOTE: this uses raw `seconds + days * 86400` arithmetic. It does NOT account
 * for DST boundaries — acceptable here because dues lifecycle is day-grained
 * and the comparison is against `Timestamp.now()` (UTC seconds).
 */
export function addDaysToTimestamp(ts: AdminTimestamp, days: number): AdminTimestamp {
  const seconds = ts.seconds + Math.round(days * 86_400)
  return new admin.firestore.Timestamp(seconds, ts.nanoseconds)
}

/** Maximum docs per Firestore WriteBatch (hard SDK limit). */
export const MAX_BATCH_WRITES = 500

/**
 * Worst-status-wins mapping from a list of `due.status` to the corresponding
 * `member.duesStatus`. Pure function — easy to unit-test.
 *
 * Rules (from docs/main.md "Dues & exclusion"):
 *   - any 'overdue'        -> 'excluded'
 *   - else any 'excepted'  -> 'excepted'
 *   - else any 'issued'    -> 'due'
 *   - else any 'pending_grace' -> 'pending_grace'
 *   - else if at least one due exists and all are paid/cancelled -> 'ok'
 *   - else (no dues at all) -> 'n/a'
 */
import type { DueStatus, DuesStatus } from '@club-app/shared-types'

export function computeMemberDuesStatus(dueStatuses: readonly DueStatus[]): DuesStatus {
  if (dueStatuses.length === 0) return 'n/a'
  if (dueStatuses.includes('overdue')) return 'excluded'
  if (dueStatuses.includes('excepted')) return 'excepted'
  if (dueStatuses.includes('issued')) return 'due'
  if (dueStatuses.includes('pending_grace')) return 'pending_grace'
  // At this point every status is 'paid' or 'cancelled'.
  return 'ok'
}
