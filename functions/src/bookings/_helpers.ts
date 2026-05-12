/**
 * Helpers locaux pour le module `bookings/`.
 *
 * Volontairement local (pas dans `shared/`) — un parallel agent y travaille.
 * Une fois la stabilisation faite, ces helpers pourront être promus.
 *
 * Contient :
 *  - `db()`     : accès Firestore Admin (wrappé pour mocking).
 *  - Domain types locaux (Season, Court, TimeSlot, ClosurePeriod) qui
 *    miroir le schéma `docs/firebase.md`. Ces types vivent ici parce que
 *    `packages/shared-types/src/season.ts` et `venue.ts` sont encore des
 *    stubs vides (TODO du dépôt). Dès qu'ils seront remplis, on importera
 *    depuis `@club-app/shared-types`.
 *  - Pure helpers de génération de bookings, testables sans Firestore :
 *    `dateRangeForDayOfWeek`, `isInsideClosure`, `formatDateId`,
 *    `buildBookingDocs`.
 */
import * as admin from 'firebase-admin'
import type { SlotType } from '@club-app/shared-types'

/** Retourne l'instance Firestore Admin. Wrappé pour faciliter le mocking. */
export const db = (): FirebaseFirestore.Firestore => admin.firestore()

// ---------------------------------------------------------------------------
// Domain types (miroirs locaux du schéma docs/firebase.md).
// ---------------------------------------------------------------------------

export type SeasonStatus = 'draft' | 'active' | 'archived'

export interface SeasonDoc {
  name: string
  startDate: FirebaseFirestore.Timestamp
  endDate: FirebaseFirestore.Timestamp
  status: SeasonStatus
  activeVenueIds: string[]
  closurePeriodIds: string[]
  generatedAt: FirebaseFirestore.Timestamp | null
}

export interface CourtDoc {
  name: string
  courtSize: 'small' | 'normal' | 'large'
  isCombined: boolean
  combinedCourtIds: string[]
  sport: string
  active: boolean
}

export interface TimeSlotDoc {
  dayOfWeek: number
  startTime: string
  endTime: string
  label: string
  seasonId: string
  requiresFullCourt: boolean
  teamId: string | null
  slotType: SlotType
  customTypeName: string | null
  matchTypeId: string | null
  active: boolean
}

export interface ClosurePeriodDoc {
  name: string
  startDate: FirebaseFirestore.Timestamp
  endDate: FirebaseFirestore.Timestamp
  type: 'holiday' | 'custom'
  createdBy: string
}

/** Closure normalisée en `Date` (UTC midnight) pour les calculs. */
export interface ClosureRange {
  id: string
  startUtcMs: number
  endUtcMs: number
}

// ---------------------------------------------------------------------------
// Pure helpers — testables sans Firestore.
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Crée un `Date` à minuit UTC à partir d'une année/mois/jour. Évite les surprises DST.
 */
export function utcMidnight(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day, 0, 0, 0, 0))
}

/**
 * Tronque une date arbitraire au début du jour UTC.
 */
export function startOfUtcDay(d: Date): Date {
  return utcMidnight(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/**
 * Énumère toutes les dates entre `start` et `end` (inclus) dont le `getUTCDay()`
 * correspond à `dayOfWeek`. Les bornes sont alignées sur minuit UTC.
 *
 * `dayOfWeek` : 0 = Sunday, 1 = Monday, ..., 6 = Saturday — convention identique
 * à `Date.getUTCDay()` et à `TimeSlot.dayOfWeek` (docs/firebase.md).
 */
export function dateRangeForDayOfWeek(start: Date, end: Date, dayOfWeek: number): Date[] {
  if (dayOfWeek < 0 || dayOfWeek > 6 || !Number.isInteger(dayOfWeek)) {
    throw new Error(`Invalid dayOfWeek: ${dayOfWeek}`)
  }
  const startMs = startOfUtcDay(start).getTime()
  const endMs = startOfUtcDay(end).getTime()
  if (endMs < startMs) {
    return []
  }
  const dates: Date[] = []
  // Avance jusqu'au premier `dayOfWeek` ≥ start.
  const startDate = new Date(startMs)
  const startDow = startDate.getUTCDay()
  const offset = (dayOfWeek - startDow + 7) % 7
  let cursorMs = startMs + offset * MS_PER_DAY
  while (cursorMs <= endMs) {
    dates.push(new Date(cursorMs))
    cursorMs += 7 * MS_PER_DAY
  }
  return dates
}

/**
 * `true` si la date (UTC midnight) tombe dans l'intervalle `[start, end]` inclusif
 * d'au moins une closure.
 */
export function isInsideClosure(dateUtcMs: number, closures: readonly ClosureRange[]): boolean {
  for (const c of closures) {
    if (dateUtcMs >= c.startUtcMs && dateUtcMs <= c.endUtcMs) {
      return true
    }
  }
  return false
}

/**
 * Convertit un `ClosurePeriodDoc` en `ClosureRange` (UTC midnight) pour les comparaisons.
 */
export function closurePeriodToRange(id: string, doc: ClosurePeriodDoc): ClosureRange {
  return {
    id,
    startUtcMs: startOfUtcDay(doc.startDate.toDate()).getTime(),
    endUtcMs: startOfUtcDay(doc.endDate.toDate()).getTime(),
  }
}

/**
 * Format `YYYYMMDD` (UTC) pour les IDs déterministes de booking.
 */
export function formatDateId(d: Date): string {
  const utc = startOfUtcDay(d)
  const y = utc.getUTCFullYear().toString().padStart(4, '0')
  const m = (utc.getUTCMonth() + 1).toString().padStart(2, '0')
  const day = utc.getUTCDate().toString().padStart(2, '0')
  return `${y}${m}${day}`
}

/**
 * ID déterministe d'un booking : permet la ré-exécution idempotente du trigger
 * (un crash mid-génération sera rejoué sans dupliquer — la 2e exécution écrasera
 * silencieusement les mêmes ID avec `WriteBatch.set` qui est un upsert).
 *
 * Format : `${seasonId}_${courtId}_${timeSlotId}_${YYYYMMDD}`. Aucun caractère
 * interdit en Firestore (slashes/dots) n'est introduit.
 */
export function deterministicBookingId(params: {
  seasonId: string
  courtId: string
  timeSlotId: string
  date: Date
}): string {
  return `${params.seasonId}_${params.courtId}_${params.timeSlotId}_${formatDateId(params.date)}`
}

// ---------------------------------------------------------------------------
// Booking shape builder — pure, sans Firestore.
// ---------------------------------------------------------------------------

/**
 * Payload Firestore d'un booking. On utilise une forme locale (plutôt que
 * `BookingData` depuis `@club-app/shared-types`) parce que ce dernier type
 * référence un `Timestamp` neutre (`{ seconds, nanoseconds }`) — incompatible
 * structurellement avec `FirebaseFirestore.Timestamp` retourné par l'Admin SDK.
 * Les champs sont strictement alignés avec `docs/firebase.md` (section /bookings).
 */
export interface BookingFirestorePayload {
  seasonId: string
  venueId: string
  courtId: string
  timeSlotId: string
  teamId: string | null
  slotType: SlotType
  matchTypeId: string | null
  date: FirebaseFirestore.Timestamp
  startTime: string
  endTime: string
  status: 'scheduled'
  cancelReason: null
  linkedBookingIds: string[]
  isCombinedCourtEvent: boolean
  actionLog: never[]
}

export interface BuildBookingInput {
  seasonId: string
  venueId: string
  courtId: string
  timeSlotId: string
  teamId: string | null
  slotType: SlotType
  matchTypeId: string | null
  startTime: string
  endTime: string
  /** Date au midnight UTC. */
  date: Date
  /** Mirroré depuis `court.isCombined`. */
  isCombinedCourtEvent: boolean
}

/**
 * Construit le payload d'un booking. Sépare la création (sans Firestore) du
 * write — testable trivialement.
 *
 * Le champ `actionLog` est initialisé vide (append-only ensuite).
 */
export function buildBookingPayload(
  input: BuildBookingInput,
  dateTimestamp: FirebaseFirestore.Timestamp,
): BookingFirestorePayload {
  return {
    seasonId: input.seasonId,
    venueId: input.venueId,
    courtId: input.courtId,
    timeSlotId: input.timeSlotId,
    teamId: input.teamId,
    slotType: input.slotType,
    matchTypeId: input.matchTypeId,
    date: dateTimestamp,
    startTime: input.startTime,
    endTime: input.endTime,
    status: 'scheduled',
    cancelReason: null,
    linkedBookingIds: [],
    isCombinedCourtEvent: input.isCombinedCourtEvent,
    actionLog: [],
  }
}
