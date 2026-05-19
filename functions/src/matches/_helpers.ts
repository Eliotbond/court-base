/**
 * Helpers locaux aux Cloud Functions `matches/`.
 *
 * Port server-side (Admin SDK) de la logique de `apps/web/src/repositories`
 * (`bookings.repo.ts` → `freeConflictingTrainings` / `timeRangesOverlap`).
 *
 * Différence critique avec le web : le serveur n'a pas de timezone navigateur.
 * Toute date de match (`/matches.date`) doit être ancrée en **UTC midnight**
 * — `autoOfficialsNeeded` et `matchReminders` interprètent `/matches.date`
 * comme une date UTC. Le repo web utilise `startOfLocalDay` (timezone du
 * navigateur) ; ici on utilise `utcMidnight()`.
 */
import * as admin from 'firebase-admin'
import type { DocumentData, Firestore } from 'firebase-admin/firestore'
import type {
  BookingActionLogEntry,
  BookingData,
} from '@club-app/shared-types'
import { logger } from '../shared/logger'

export function db(): Firestore {
  return admin.firestore()
}

export const Timestamp = admin.firestore.Timestamp

export function serverTimestamp(): FirebaseFirestore.FieldValue {
  return admin.firestore.FieldValue.serverTimestamp()
}

/** Nombre max d'écritures par batch Firestore (limite hard = 500). */
const MAX_OPS_PER_BATCH = 450

/**
 * Comparaison de deux strings "HH:MM" — `true` si `[startA, endA)` chevauche
 * `[startB, endB)`. Bornes : fin exclue (un slot 10:00-11:00 ne chevauche pas
 * un slot 11:00-12:00 commençant au même instant).
 *
 * Port direct de `bookings.repo.ts` — la comparaison lexicographique des
 * strings "HH:MM" zéro-paddées est correcte (ordre = ordre chronologique).
 */
export function timeRangesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
): boolean {
  return startA < endB && endA > startB
}

/**
 * Renvoie le `Timestamp` du minuit **UTC** du jour contenant `epochMillis`.
 *
 * Contrairement au repo web (`startOfLocalDay`), on ancre en UTC : une Cloud
 * Function n'a pas de TZ navigateur, et les triggers `autoOfficialsNeeded` /
 * `matchReminders` lisent `/matches.date` comme une date UTC. Stocker un
 * minuit "local serveur" (UTC sur GCP) revient au même ici, mais on est
 * explicite pour ne pas dépendre de l'env runtime.
 */
export function utcMidnight(epochMillis: number): FirebaseFirestore.Timestamp {
  const d = new Date(epochMillis)
  return Timestamp.fromDate(
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())),
  )
}

/**
 * Libère (`status: 'freed'`) les bookings `training` / `reserve` de l'équipe
 * `teamId` qui, le jour `dayStart`, chevauchent le créneau `[startTime,
 * endTime)`. Append-only sur `actionLog`.
 *
 * Port de `freeConflictingTrainings` (web). Query simple
 * `where teamId == X and date == dayStart` (petit volume : quelques bookings
 * par équipe par jour) + filtres JS — pas d'index composite requis.
 *
 * Idempotent : ré-appel = no-op (les bookings déjà `freed`/`cancelled` sont
 * exclus par le filtre `status === 'scheduled'`).
 *
 * @param dayStart minuit UTC du jour du match (cf. `utcMidnight`).
 * @returns liste des bookingIds libérés.
 */
export async function freeConflictingTrainings(args: {
  teamId: string
  /** Minuit UTC du jour — doit matcher le `Timestamp` stocké sur le booking. */
  dayStart: FirebaseFirestore.Timestamp
  startTime: string
  endTime: string
  reason: 'match_home' | 'match_away'
  editorUid: string
  /** Exclut un bookingId de la recherche (ex. le booking du match lui-même). */
  excludeBookingId?: string
}): Promise<string[]> {
  const firestore = db()
  const snap = await firestore
    .collection('bookings')
    .where('teamId', '==', args.teamId)
    .where('date', '==', args.dayStart)
    .get()

  if (snap.empty) return []

  const candidates = snap.docs
    .filter((d) => d.id !== args.excludeBookingId)
    .map((d) => ({ ref: d.ref, id: d.id, data: d.data() as BookingData }))
    .filter(({ data }) => data.status === 'scheduled')
    .filter(
      ({ data }) =>
        data.slotType === 'training' || data.slotType === 'reserve',
    )
    .filter(({ data }) =>
      timeRangesOverlap(
        args.startTime,
        args.endTime,
        data.startTime,
        data.endTime,
      ),
    )

  if (candidates.length === 0) return []

  const log: BookingActionLogEntry = {
    at: Timestamp.now(),
    by: args.editorUid,
    action: 'auto_free_on_match',
    note: args.reason,
  }

  let batch = firestore.batch()
  let ops = 0
  for (const { ref } of candidates) {
    batch.update(ref as FirebaseFirestore.DocumentReference<DocumentData>, {
      status: 'freed',
      cancelReason: args.reason,
      actionLog: admin.firestore.FieldValue.arrayUnion(log),
    })
    ops += 1
    if (ops >= MAX_OPS_PER_BATCH) {
      await batch.commit()
      batch = firestore.batch()
      ops = 0
    }
  }
  if (ops > 0) await batch.commit()

  logger.info('[freeConflictingTrainings] freed bookings', {
    teamId: args.teamId,
    reason: args.reason,
    count: candidates.length,
  })

  return candidates.map((c) => c.id)
}
