/**
 * Local helpers for the `officials/` Cloud Functions.
 *
 * Thin wrappers around the Firebase Admin SDK to keep the handlers testable
 * (the production code paths go through these symbols, which the unit tests
 * mock). The canonical `db()` / `logger` lives in `src/shared/` — we re-export
 * them here so callers stay decoupled from the SDK module structure.
 */
import * as admin from 'firebase-admin'
import type {
  CollectionReference,
  DocumentData,
  Firestore,
  Query,
} from 'firebase-admin/firestore'

import { db as sharedDb } from '../shared/firestore'

/** Lazy Admin SDK Firestore handle. `initializeApp()` happens in `src/index.ts`. */
export function db(): Firestore {
  return sharedDb()
}

/** Convenience: typed collection ref. */
export function col<T = DocumentData>(path: string): CollectionReference<T> {
  return db().collection(path) as CollectionReference<T>
}

/** Convenience: typed sub-collection ref starting from a parent doc path. */
export function subcol<T = DocumentData>(
  parentPath: string,
  name: string,
): CollectionReference<T> {
  return db().collection(`${parentPath}/${name}`) as CollectionReference<T>
}

/** Firestore Timestamp class (re-export for tests / typings). */
export const Timestamp = admin.firestore.Timestamp

/** Firestore sentinel for server-set timestamps. */
export function serverTimestamp(): FirebaseFirestore.FieldValue {
  return admin.firestore.FieldValue.serverTimestamp()
}

/**
 * Build a Firestore Timestamp from a JS `Date`. Used in date-window queries
 * (so tests can deterministically inject a "now" without mocking the whole
 * Timestamp class).
 */
export function timestampFromDate(date: Date): FirebaseFirestore.Timestamp {
  return admin.firestore.Timestamp.fromDate(date)
}

/** Add N minutes to a Timestamp. */
export function addMinutesToTimestamp(
  ts: FirebaseFirestore.Timestamp,
  minutes: number,
): FirebaseFirestore.Timestamp {
  const seconds = ts.seconds + Math.round(minutes * 60)
  return new admin.firestore.Timestamp(seconds, ts.nanoseconds)
}

/** Add N hours to a Timestamp. */
export function addHoursToTimestamp(
  ts: FirebaseFirestore.Timestamp,
  hours: number,
): FirebaseFirestore.Timestamp {
  return addMinutesToTimestamp(ts, hours * 60)
}

/** Add N days to a Timestamp. */
export function addDaysToTimestamp(
  ts: FirebaseFirestore.Timestamp,
  days: number,
): FirebaseFirestore.Timestamp {
  return addMinutesToTimestamp(ts, days * 60 * 24)
}

/** Re-export the typed Query alias to keep imports minimal in handlers. */
export type AnyQuery<T = DocumentData> = Query<T>
