import {
  Timestamp,
  addDoc,
  arrayUnion,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type UpdateData,
  type WriteBatch,
} from 'firebase/firestore'
import { FirebaseError } from 'firebase/app'
import type {
  Booking,
  BookingActionLogEntry,
  BookingCancelReason,
  BookingData,
  BookingSeries,
  BookingSeriesData,
  BookingStatus,
  ClosurePeriod,
  Court,
  RecurrenceRule,
  Season,
  SlotType,
  Team,
  Venue,
  VenueCustomClosure,
} from '@club-app/shared-types'
import { db } from '@/services/firebase'

/**
 * Repository Bookings — Firestore-backed pour l'écran "Season grid" (/bookings).
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase
 * (cf. docs/frontend-desktop.md — architecture en couches). La vue passe par
 * le store `stores/bookings.ts` qui appelle uniquement ce module.
 *
 * Champs dérivés portés sur `BookingRow` mais qui ne vivent PAS dans le doc
 * `/bookings/{bookingId}` (joints côté repo via map lookups) :
 *  - `venueName` / `courtName` : `/venues/{venueId}` + collection-group `courts`.
 *  - `teamName` : `/teams/{teamId}`.
 *
 * Les sub-collections `officialAssignments/` et `attendance/` ne sont PAS
 * lues ici — la vue est read-only et n'affiche que le doc parent. Si
 * l'écran évolue pour afficher les assignations, on chargera à la demande
 * dans le drawer (lazy) plutôt qu'en bulk dans la query principale.
 */

const BOOKINGS = 'bookings'
const BOOKING_SERIES = 'bookingSeries'
const CLOSURE_PERIODS = 'closurePeriods'
const SEASONS = 'seasons'
const VENUES = 'venues'
const COURTS = 'courts'
const TEAMS = 'teams'

/** Firestore WriteBatch hard limit (operations per batch). */
const BATCH_MAX_OPS = 500

// ---------------------------------------------------------------------------
// Types exposés
// ---------------------------------------------------------------------------

export interface BookingRow extends Booking {
  /** Libellé venue résolu via join `/venues/{venueId}`. `null` si introuvable. */
  venueName: string | null
  /** Libellé court résolu via join `/venues/{venueId}/courts/{courtId}`. */
  courtName: string | null
  /** Libellé équipe résolu via join `/teams/{teamId}` ; `null` si pas de teamId. */
  teamName: string | null
}

export interface VenueWithCourts {
  id: string
  name: string
  /** Liste des courts actifs du venue, triés par nom. */
  courts: Court[]
}

// ---------------------------------------------------------------------------
// Snap → row helpers
// ---------------------------------------------------------------------------

function mapBookingData(id: string, data: BookingData): Booking {
  return {
    id,
    seasonId: data.seasonId,
    venueId: data.venueId,
    courtId: data.courtId,
    timeSlotId: data.timeSlotId,
    teamId: data.teamId,
    slotType: data.slotType,
    matchTypeId: data.matchTypeId,
    // Bookings créés avant l'extraction de /matches (Chantier C, 2026-05-15)
    // n'ont pas ce champ → fallback null.
    matchId: data.matchId ?? null,
    opponentName: data.opponentName ?? null,
    awayAddress: data.awayAddress ?? null,
    date: data.date,
    startTime: data.startTime,
    endTime: data.endTime,
    status: data.status,
    cancelReason: data.cancelReason,
    linkedBookingIds: data.linkedBookingIds ?? [],
    isCombinedCourtEvent: data.isCombinedCourtEvent ?? false,
    seriesId: data.seriesId ?? null,
    originalDate: data.originalDate ?? null,
    isManual: data.isManual ?? false,
    actionLog: data.actionLog ?? [],
  }
}

// ---------------------------------------------------------------------------
// Active season — query où status == "active", limit 1.
// ---------------------------------------------------------------------------

/** ID de la saison active du club, ou `null` si aucune. */
export async function fetchActiveSeasonId(): Promise<string | null> {
  const q = query(
    collection(db, SEASONS),
    where('status', '==', 'active'),
    limit(1),
  )
  const snap = await getDocs(q)
  const first = snap.docs[0]
  if (!first) return null
  return first.id
}

/**
 * Charge la saison active complète. Utile pour le header (label) et pour
 * connaître l'intervalle global de la saison. `null` si aucune.
 */
export async function fetchActiveSeason(): Promise<Season | null> {
  const q = query(
    collection(db, SEASONS),
    where('status', '==', 'active'),
    limit(1),
  )
  const snap = await getDocs(q)
  const first = snap.docs[0]
  if (!first) return null
  return { id: first.id, ...(first.data() as Omit<Season, 'id'>) }
}

// ---------------------------------------------------------------------------
// Venues + courts — structure du header (colonnes) du grid.
//
// Stratégie : un `getDocs('/venues')` + une `collectionGroup('courts')` pour
// éviter le N+1 (un getDocs par venue). On rattache ensuite chaque court à
// son venue parent via `ref.parent.parent.id`. Les courts inactifs sont
// filtrés (un court désactivé ne doit pas apparaître dans le planning).
// ---------------------------------------------------------------------------

/** Venues + leurs courts actifs. Vide si Firestore n'a aucun venue. */
export async function listVenuesWithCourts(): Promise<VenueWithCourts[]> {
  const [venuesSnap, courtsSnap] = await Promise.all([
    getDocs(collection(db, VENUES)),
    getDocs(collectionGroup(db, COURTS)),
  ])

  if (venuesSnap.empty) return []

  // Map venueId → Court[] (uniquement courts actifs).
  const courtsByVenue = new Map<string, Court[]>()
  for (const d of courtsSnap.docs) {
    const parent = d.ref.parent.parent
    if (!parent) continue
    const data = d.data() as Omit<Court, 'id'>
    if (data.active === false) continue
    const venueId = parent.id
    const court: Court = { id: d.id, ...data }
    const existing = courtsByVenue.get(venueId)
    if (existing) existing.push(court)
    else courtsByVenue.set(venueId, [court])
  }

  const result: VenueWithCourts[] = venuesSnap.docs.map((vd) => {
    const venue: Venue = { id: vd.id, ...(vd.data() as Omit<Venue, 'id'>) }
    const courts = (courtsByVenue.get(vd.id) ?? []).slice().sort((a, b) =>
      a.name.localeCompare(b.name, 'fr'),
    )
    return { id: venue.id, name: venue.name, courts }
  })

  // Tri stable : venues par nom (FR locale).
  result.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  return result
}

// ---------------------------------------------------------------------------
// Joins — un seul `getDocs` par collection puis lookup map.
//
// On charge l'intégralité de `/teams` et `/venues` plutôt qu'un `where in`
// par lots de 10 : ces deux collections sont bornées (~30 teams, < 10
// venues côté typique). Si une instance dépasse, on basculera sur des
// chunks `where(documentId(), 'in', …)`.
// ---------------------------------------------------------------------------

async function loadTeamNames(ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (ids.length === 0) return out
  const snap = await getDocs(collection(db, TEAMS))
  const needed = new Set(ids)
  for (const d of snap.docs) {
    if (!needed.has(d.id)) continue
    const data = d.data() as Pick<Team, 'name'>
    out.set(d.id, data.name)
  }
  return out
}

async function loadVenueNames(ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (ids.length === 0) return out
  const snap = await getDocs(collection(db, VENUES))
  const needed = new Set(ids)
  for (const d of snap.docs) {
    if (!needed.has(d.id)) continue
    const data = d.data() as Pick<Venue, 'name'>
    out.set(d.id, data.name)
  }
  return out
}

async function loadCourtNames(
  pairs: readonly { venueId: string; courtId: string }[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (pairs.length === 0) return out
  // Lecture parallèle par court (chemin direct, pas de query).
  await Promise.all(
    pairs.map(async ({ venueId, courtId }) => {
      const snap = await getDoc(doc(db, VENUES, venueId, COURTS, courtId))
      if (snap.exists()) {
        const data = snap.data() as Pick<Court, 'name'>
        out.set(`${venueId}/${courtId}`, data.name)
      }
    }),
  )
  return out
}

// ===========================================================================
// Manual bookings — one-shot + recurring series (Outlook-style)
// ===========================================================================
//
// Toute la logique d'expansion / validation / écriture vit ici (architecture
// en couches : seul ce module touche le SDK Firestore).
//
// Décisions de design :
//  - Timezone : tout est en **heure locale machine**. Les dates passées en
//    paramètre sont normalisées au 00:00 local via `startOfLocalDay()` avant
//    écriture (et stockées en `Timestamp.fromDate(d)` qui encode l'epoch UTC).
//  - WriteBatch : chunké par paquets de 500 ops max (limite Firestore dure).
//  - Idempotence (limitation MVP) : si `createBookingSeries` plante au milieu
//    d'un commit batch, le doc /bookingSeries reste mais une partie des
//    bookings peuvent manquer. À reprendre côté admin (relancer la série).
//  - Garde-fou dates passées : aucune modif date/time/courtId sur une
//    occurrence dont `date < startOfToday()` ; les autres champs (notes,
//    teamId, status) restent applicables.
//  - Combined courts : non supportés sur les bookings manuels (MVP).
//    `linkedBookingIds: []` et `isCombinedCourtEvent: false`.

// ---------------------------------------------------------------------------
// Date helpers — purement locaux (heure machine).
// ---------------------------------------------------------------------------

/** Renvoie une copie de `d` au 00:00:00.000 local. */
function startOfLocalDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

/** Renvoie le 00:00:00.000 local d'aujourd'hui. */
function startOfToday(): Date {
  return startOfLocalDay(new Date())
}

/** `true` si `d` est strictement avant aujourd'hui (00:00 local). */
function isBeforeToday(d: Date): boolean {
  return startOfLocalDay(d).getTime() < startOfToday().getTime()
}

/**
 * Comparaison de deux strings "HH:MM" — `true` si `[startA, endA)` chevauche
 * `[startB, endB)`. Bornes : fin exclue (un slot 10:00-11:00 ne chevauche pas
 * un slot 11:00-12:00 commençant au même instant).
 */
function timeRangesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
): boolean {
  return startA < endB && endA > startB
}

/** `true` si deux `Date` représentent le même jour local (Y/M/D). */
function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

// ---------------------------------------------------------------------------
// expandRecurrence — pure function (top-level export, testable sans Firestore)
// ---------------------------------------------------------------------------

/**
 * Étend une règle de récurrence en liste de dates locales (00:00 local).
 * - `frequency 'weekly'` : émet une date par semaine sur le weekday spécifié,
 *   en partant du premier weekday >= startDate, jusqu'à endDate inclus.
 * - `frequency 'monthly'` :
 *   - `monthlyMode 'dayOfMonth'` : émet la même quantième chaque mois
 *     (skippe les mois où la date n'existe pas — ex: 31 en février).
 *   - `monthlyMode 'nthWeekday'` : extrait nth + weekday depuis `startDate`
 *     (ex: si startDate = 3e mardi de mars, émet le 3e mardi de chaque mois).
 *     Skippe les mois où le Nth weekday n'existe pas (rare, ex: 5e lundi).
 * - `interval` ignoré au MVP (toujours 1) ; le champ est propagé sur la série.
 */
export function expandRecurrence(
  rule: RecurrenceRule,
  startDate: Date,
  endDate: Date,
): Date[] {
  const start = startOfLocalDay(startDate)
  const end = startOfLocalDay(endDate)
  if (end.getTime() < start.getTime()) return []

  const result: Date[] = []

  if (rule.frequency === 'weekly') {
    // weekday peut être fourni par la règle ; à défaut, on prend celui du start.
    const targetWeekday = rule.weekday ?? start.getDay()
    // Premier jour >= start dont getDay() === targetWeekday.
    const cursor = new Date(start)
    const delta = (targetWeekday - cursor.getDay() + 7) % 7
    cursor.setDate(cursor.getDate() + delta)
    while (cursor.getTime() <= end.getTime()) {
      result.push(new Date(cursor))
      cursor.setDate(cursor.getDate() + 7)
    }
    return result
  }

  // monthly
  const mode = rule.monthlyMode ?? 'dayOfMonth'
  if (mode === 'dayOfMonth') {
    const targetDay = start.getDate()
    // Itère mois par mois depuis le mois du start jusqu'au mois du end.
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
    while (cursor.getTime() <= end.getTime()) {
      // Construit la date candidate avec targetDay.
      const candidate = new Date(cursor.getFullYear(), cursor.getMonth(), targetDay)
      // Skippe si le mois n'a pas ce quantième (ex: 31 février → bascule en mars).
      if (
        candidate.getMonth() === cursor.getMonth() &&
        candidate.getTime() >= start.getTime() &&
        candidate.getTime() <= end.getTime()
      ) {
        result.push(candidate)
      }
      cursor.setMonth(cursor.getMonth() + 1)
    }
    return result
  }

  // mode === 'nthWeekday'
  // Détermine nth (1..5) + weekday depuis le start.
  const weekday = start.getDay()
  const nth = Math.floor((start.getDate() - 1) / 7) + 1
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
  while (cursor.getTime() <= end.getTime()) {
    // Trouve le 1er weekday >= 1 du mois.
    const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const firstWeekdayOffset = (weekday - firstOfMonth.getDay() + 7) % 7
    const dayOfMonth = 1 + firstWeekdayOffset + (nth - 1) * 7
    const candidate = new Date(cursor.getFullYear(), cursor.getMonth(), dayOfMonth)
    if (
      candidate.getMonth() === cursor.getMonth() &&
      candidate.getTime() >= start.getTime() &&
      candidate.getTime() <= end.getTime()
    ) {
      result.push(candidate)
    }
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return result
}

// ---------------------------------------------------------------------------
// Closures — lecture venue + closurePeriods référencés.
// ---------------------------------------------------------------------------

/**
 * Représentation interne d'une fenêtre de fermeture applicable à un venue.
 * `startMs`/`endMs` portent les bornes en epoch ms (alignées sur la journée
 * locale, inclusives) ; `name` et `source` permettent à l'UI d'afficher la
 * fermeture concrète qui a causé un skip.
 */
interface ClosureWindowWithMeta {
  /** Inclusif (00:00 local). */
  startMs: number
  /** Inclusif (23:59:59.999 local). */
  endMs: number
  /** Libellé humain (depuis `customClosure.name` ou `closurePeriod.name`). */
  name: string
  /** `'period'` = `/closurePeriods` ; `'custom'` = inline `venue.customClosures`. */
  source: 'period' | 'custom'
}

/** Étend une période [start, end] (inclusive) vers un span en ms (bornes journalières). */
function toClosureWindow(
  startTs: { seconds: number },
  endTs: { seconds: number },
  name: string,
  source: 'period' | 'custom',
): ClosureWindowWithMeta {
  // On utilise epoch ms direct depuis les Timestamps stockés. La comparaison
  // se fait au niveau date locale en utilisant le getTime() de Date locale.
  const startMs = startOfLocalDay(new Date(startTs.seconds * 1000)).getTime()
  const endLocal = new Date(endTs.seconds * 1000)
  // Inclusive : fin de la journée locale = 23:59:59.999.
  endLocal.setHours(23, 59, 59, 999)
  return { startMs, endMs: endLocal.getTime(), name, source }
}

/**
 * Charge toutes les fenêtres de closure applicables à un venue donné.
 * Combine `venue.closurePeriodIds` (lookup dans `/closurePeriods`) et
 * `venue.customClosures` (inline). Chaque fenêtre porte `name` + `source`
 * pour permettre à l'UI d'identifier la fermeture concrète.
 *
 * `where(documentId(), 'in', ...)` est limité à 30 ids/chunk côté Firestore
 * — on chunke défensivement.
 */
async function loadClosureWindowsForVenue(venueId: string): Promise<ClosureWindowWithMeta[]> {
  try {
    const venueSnap = await getDoc(doc(db, VENUES, venueId))
    if (!venueSnap.exists()) return []
    const venueData = venueSnap.data() as {
      closurePeriodIds?: string[]
      customClosures?: VenueCustomClosure[]
    }
    const closurePeriodIds: string[] = venueData.closurePeriodIds ?? []
    const customClosures: VenueCustomClosure[] = venueData.customClosures ?? []

    const windows: ClosureWindowWithMeta[] = []

    // Inline custom closures.
    for (const cc of customClosures) {
      windows.push(toClosureWindow(cc.startDate, cc.endDate, cc.name, 'custom'))
    }

    // Top-level /closurePeriods (chunké à 30, limite Firestore `in`).
    if (closurePeriodIds.length > 0) {
      const chunks: string[][] = []
      for (let i = 0; i < closurePeriodIds.length; i += 30) {
        chunks.push(closurePeriodIds.slice(i, i + 30))
      }
      await Promise.all(
        chunks.map(async (ids) => {
          const snap = await getDocs(
            query(collection(db, CLOSURE_PERIODS), where(documentId(), 'in', ids)),
          )
          for (const d of snap.docs) {
            const data = d.data() as Pick<ClosurePeriod, 'name' | 'startDate' | 'endDate'>
            windows.push(toClosureWindow(data.startDate, data.endDate, data.name, 'period'))
          }
        }),
      )
    }

    return windows
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`loadClosureWindowsForVenue failed [${code}]`, err)
    throw err
  }
}

/**
 * Type public retourné par `loadVenueClosures` — exposé pour l'UI/le store qui
 * veulent lister les fermetures concrètes d'un venue sans réimplémenter le
 * merge `venue.customClosures` + `/closurePeriods`.
 */
export interface VenueClosure {
  name: string
  /** 00:00 local (Date JS). */
  startDate: Date
  /** Fin de journée locale (Date JS). */
  endDate: Date
  source: 'period' | 'custom'
}

/**
 * Charge la liste consolidée des fermetures applicables à un venue (mix de
 * `venue.customClosures` et `/closurePeriods` référencés par
 * `venue.closurePeriodIds`). Dates retournées en `Date` JS, pratiques pour
 * l'UI. Ne fait aucun filtrage — c'est `filterDatesByVenueClosures` qui
 * détermine quelles fermetures ont effectivement skipper une occurrence.
 */
export async function loadVenueClosures(venueId: string): Promise<VenueClosure[]> {
  const windows = await loadClosureWindowsForVenue(venueId)
  return windows.map((w) => ({
    name: w.name,
    startDate: new Date(w.startMs),
    endDate: new Date(w.endMs),
    source: w.source,
  }))
}

/**
 * Fermeture qui a causé au moins un skip dans `filterDatesByVenueClosures`.
 * Inclut la liste des dates de l'input couvertes par cette fenêtre — si
 * plusieurs fermetures se chevauchent sur une même date, chacune apparaît
 * avec cette date dans son `skippedDates`.
 */
export interface AppliedClosure extends VenueClosure {
  skippedDates: Date[]
}

/**
 * Filtre des dates : retire celles qui tombent pendant une closure du venue.
 * Une date est en closure si elle intersecte au moins une période :
 *   - `/closurePeriods/{id}` référencée par `venue.closurePeriodIds`
 *   - une `customClosure` inline du venue
 * Bornes inclusives (startDate <= date <= endDate).
 *
 * Retourne en plus `closures` : la liste des fermetures qui ont effectivement
 * causé au moins un skip sur les dates d'input (utile pour l'UI qui veut
 * lister les fermetures concrètes). Une fermeture qui ne couvre aucune date
 * d'input n'apparaît PAS — on n'expose que les fermetures "actives" sur la
 * période. Si plusieurs fermetures couvrent la même date, chacune est listée.
 */
export async function filterDatesByVenueClosures(
  venueId: string,
  dates: Date[],
): Promise<{
  kept: Date[]
  skipped: Date[]
  closures: AppliedClosure[]
}> {
  if (dates.length === 0) return { kept: [], skipped: [], closures: [] }
  const windows = await loadClosureWindowsForVenue(venueId)
  if (windows.length === 0) return { kept: [...dates], skipped: [], closures: [] }

  const kept: Date[] = []
  const skipped: Date[] = []
  // Accumule par fenêtre les dates qui y tombent. Aligné sur l'index `windows`
  // pour rester O(n*m) simple et préserver l'ordre.
  const perWindowSkipped: Date[][] = windows.map(() => [])

  for (const d of dates) {
    const ms = startOfLocalDay(d).getTime()
    let inAny = false
    for (let i = 0; i < windows.length; i += 1) {
      const w = windows[i]!
      if (ms >= w.startMs && ms <= w.endMs) {
        perWindowSkipped[i]!.push(d)
        inAny = true
      }
    }
    if (inAny) skipped.push(d)
    else kept.push(d)
  }

  const closures: AppliedClosure[] = []
  for (let i = 0; i < windows.length; i += 1) {
    const skippedDates = perWindowSkipped[i]!
    if (skippedDates.length === 0) continue
    const w = windows[i]!
    closures.push({
      name: w.name,
      startDate: new Date(w.startMs),
      endDate: new Date(w.endMs),
      source: w.source,
      skippedDates,
    })
  }

  return { kept, skipped, closures }
}

// ---------------------------------------------------------------------------
// detectBookingConflicts — re-utilise la query par court + date range.
// ---------------------------------------------------------------------------

/**
 * Détecte les conflits de booking pour un court donné, pour une liste de
 * dates et un créneau horaire. Un conflit = un booking `scheduled` (pas
 * cancelled/freed) qui chevauche (start < otherEnd && end > otherStart) sur
 * la même date + même court.
 * Retourne les dates en conflit + le booking conflictuel pour chacune.
 */
export async function detectBookingConflicts(
  courtId: string,
  dates: Date[],
  startTime: string,
  endTime: string,
  /** Ignore ces bookingIds (utile lors d'un edit de série). */
  excludeBookingIds?: readonly string[],
): Promise<Array<{ date: Date; conflictWith: Booking }>> {
  if (dates.length === 0) return []

  // Borne min/max pour ne tirer qu'une query par court.
  const sorted = [...dates].map(startOfLocalDay).sort((a, b) => a.getTime() - b.getTime())
  const minDate = sorted[0]
  const maxDate = sorted[sorted.length - 1]
  if (!minDate || !maxDate) return []

  const q = query(
    collection(db, BOOKINGS),
    where('courtId', '==', courtId),
    where('date', '>=', Timestamp.fromDate(minDate)),
    where('date', '<=', Timestamp.fromDate(maxDate)),
  )
  const snap = await getDocs(q)
  if (snap.empty) return []

  const exclude = new Set(excludeBookingIds ?? [])
  const candidates: Booking[] = snap.docs
    .filter((d) => !exclude.has(d.id))
    .map((d) => mapBookingData(d.id, d.data() as BookingData))
    // Seuls les bookings scheduled comptent comme conflit.
    .filter((b) => b.status === 'scheduled')

  const conflicts: Array<{ date: Date; conflictWith: Booking }> = []
  for (const target of dates) {
    const targetLocal = startOfLocalDay(target)
    for (const c of candidates) {
      const bookingDate = new Date(c.date.seconds * 1000)
      if (!sameLocalDay(bookingDate, targetLocal)) continue
      if (timeRangesOverlap(startTime, endTime, c.startTime, c.endTime)) {
        conflicts.push({ date: target, conflictWith: c })
        break // Un seul conflit suffit par date.
      }
    }
  }
  return conflicts
}

// ---------------------------------------------------------------------------
// Inputs CRUD manuels
// ---------------------------------------------------------------------------

export interface ManualBookingInput {
  seasonId: string
  /** Date de début de la saison active — borne minimale autorisée pour `date`. */
  seasonStartDate: Date
  venueId: string
  courtId: string
  /** jour (heure ignorée — normalisée au 00:00 local). */
  date: Date
  startTime: string
  endTime: string
  teamId: string | null
  /** typique `'custom'` ou `'reserve'`. */
  slotType: SlotType
  matchTypeId: string | null
  /** Nom de l'équipe adverse — uniquement pertinent pour `match_home`/`match_away`. */
  opponentName?: string | null
  /** Adresse extérieure — uniquement pertinent pour `match_away`. */
  awayAddress?: string | null
  title: string
  notes: string | null
  /** uid de l'admin. */
  createdBy: string
}

export interface BookingSeriesInput {
  seasonId: string
  /** Date de début de la saison active — borne minimale autorisée pour `startDate`. */
  seasonStartDate: Date
  venueId: string
  courtId: string
  teamId: string | null
  slotType: SlotType
  matchTypeId: string | null
  startDate: Date
  endDate: Date
  startTime: string
  endTime: string
  recurrence: RecurrenceRule
  title: string
  notes: string | null
  createdBy: string
}

export type EditScope = 'occurrence' | 'future' | 'all'

export interface BookingPatch {
  /** Optionnel — si fourni, valide qu'on n'écrit pas dans le passé. */
  date?: Date
  startTime?: string
  endTime?: string
  courtId?: string
  teamId?: string | null
  /** Mis à jour sur `/bookingSeries.title` pour scope `'all'`/`'future'`. */
  title?: string
  notes?: string | null
  status?: BookingStatus
  cancelReason?: BookingCancelReason | null
  /** Nom de l'équipe adverse (match_home / match_away). */
  opponentName?: string | null
  /** Adresse extérieure (match_away). */
  awayAddress?: string | null
  /**
   * Référence au doc `/matches/{matchId}` rattaché à ce booking (match_home
   * uniquement). Set par `createHomeMatch` ou clear (`null`) par `deleteMatch`
   * via writeBatch atomique côté `matches.repo.ts`. Pas censé être édité
   * directement par l'UI — utilisé pour atteindre l'API `BookingPatch`
   * standard depuis les helpers de matches.
   */
  matchId?: string | null
  /**
   * Référence à un type de match. Champ existant sur `BookingData` —
   * l'expose ici (en plus de `opponentName`) pour permettre à
   * `matches.repo.ts` (`deleteMatch`) de remettre le booking en état
   * "pending" via writeBatch (clear `matchTypeId`/`opponentName`/`matchId`).
   */
  matchTypeId?: string | null
}

// ---------------------------------------------------------------------------
// createManualBooking — one-shot
// ---------------------------------------------------------------------------

/**
 * Construit le payload BookingData pour un booking manuel one-shot ou une
 * occurrence d'une série. Mutualisé entre `createManualBooking` et
 * `createBookingSeries`.
 *
 * `title` et `notes` sont passés via le `actionLog` initial (note du premier
 * entry) ; le doc Firestore ne porte pas de champ `title` aujourd'hui — c'est
 * la série qui le porte. Pour un one-shot manuel, on stocke le titre dans
 * `actionLog[0].note` pour le récupérer côté admin.
 *
 * TODO: si on veut afficher le titre dans le grid sans rejoindre la série,
 * ajouter un champ `title?` au schéma /bookings.
 */
function buildManualBookingData(args: {
  seasonId: string
  venueId: string
  courtId: string
  date: Date
  startTime: string
  endTime: string
  teamId: string | null
  slotType: SlotType
  matchTypeId: string | null
  opponentName?: string | null
  awayAddress?: string | null
  title: string
  notes: string | null
  createdBy: string
  seriesId: string | null
  /** Pour une occurrence de série, la date prévue à la création (égale à `date` au moment du create). */
  originalDate: Date | null
}): BookingData {
  const at = Timestamp.now()
  const logEntry: BookingActionLogEntry = {
    at,
    by: args.createdBy,
    action: 'manual_create',
    note: args.notes ?? args.title ?? null,
  }
  return {
    seasonId: args.seasonId,
    venueId: args.venueId,
    courtId: args.courtId,
    // Booking manuel n'est rattaché à aucun timeSlot récurrent : on stocke ''.
    timeSlotId: '',
    teamId: args.teamId,
    slotType: args.slotType,
    matchTypeId: args.matchTypeId,
    // Initialisé à null à la création — un booking `match_home` est d'abord
    // pending puis rattaché à un /matches via `createHomeMatch` (qui set ce
    // champ via writeBatch atomique). Cf. `matches.repo.ts`.
    matchId: null,
    opponentName: args.opponentName ?? null,
    awayAddress: args.awayAddress ?? null,
    date: Timestamp.fromDate(startOfLocalDay(args.date)),
    startTime: args.startTime,
    endTime: args.endTime,
    status: 'scheduled',
    cancelReason: null,
    linkedBookingIds: [],
    isCombinedCourtEvent: false,
    seriesId: args.seriesId,
    originalDate:
      args.originalDate === null ? null : Timestamp.fromDate(startOfLocalDay(args.originalDate)),
    isManual: true,
    actionLog: [logEntry],
  }
}

/** Crée un `/bookings` one-shot manuel (`seriesId=null`, `isManual=true`). Retourne l'id. */
export async function createManualBooking(input: ManualBookingInput): Promise<string> {
  const seasonStart = startOfLocalDay(input.seasonStartDate)
  if (startOfLocalDay(input.date).getTime() < seasonStart.getTime()) {
    throw new Error('cannot create booking before season start')
  }
  // Validation conflit (court+date+time, hors cancelled/freed).
  const conflicts = await detectBookingConflicts(
    input.courtId,
    [input.date],
    input.startTime,
    input.endTime,
  )
  if (conflicts.length > 0) {
    throw new Error(
      `booking conflict on ${conflicts[0]!.date.toISOString()} with ${conflicts[0]!.conflictWith.id}`,
    )
  }

  const data = buildManualBookingData({
    seasonId: input.seasonId,
    venueId: input.venueId,
    courtId: input.courtId,
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    teamId: input.teamId,
    slotType: input.slotType,
    matchTypeId: input.matchTypeId,
    opponentName: input.opponentName ?? null,
    awayAddress: input.awayAddress ?? null,
    title: input.title,
    notes: input.notes,
    createdBy: input.createdBy,
    seriesId: null,
    originalDate: null,
  })
  const ref = await addDoc(collection(db, BOOKINGS), data)
  return ref.id
}

// ---------------------------------------------------------------------------
// createBookingSeries — série Outlook-like
// ---------------------------------------------------------------------------

/** Découpe `ops` en chunks de 500 et commit séquentiellement. */
async function commitBatched(
  ops: Array<(batch: WriteBatch) => void>,
): Promise<void> {
  for (let i = 0; i < ops.length; i += BATCH_MAX_OPS) {
    const slice = ops.slice(i, i + BATCH_MAX_OPS)
    const batch = writeBatch(db)
    for (const op of slice) op(batch)
    await batch.commit()
  }
}

/**
 * Crée 1 doc `/bookingSeries` + N docs `/bookings` (un par occurrence retenue).
 * - Expand les dates via `expandRecurrence`.
 * - **Applique toujours** `filterDatesByVenueClosures` : les séries
 *   récurrentes respectent obligatoirement les fermetures de salle (pas de
 *   bypass possible). Le doc /bookingSeries écrit porte `considerClosures: true`.
 *   Le bypass volontaire reste exposé pour les bookings one-shot manuels via
 *   `createManualBooking` — comportement inchangé.
 * - Si une date est en conflit (`detectBookingConflicts`), THROW avant tout
 *   write (validation côté repo). L'appelant doit avoir pré-validé.
 * - WriteBatch chunké par 500 ops max (limite Firestore).
 *
 * Limitation MVP (idempotence) : si la séquence de commits batchés plante
 * au milieu, le doc /bookingSeries existe déjà et certains /bookings sont
 * créés. La reprise n'est pas automatique — l'admin doit supprimer la série
 * partielle puis relancer.
 */
export async function createBookingSeries(
  input: BookingSeriesInput,
): Promise<{ seriesId: string; bookingIds: string[] }> {
  // 1. Validation dates start/end.
  const start = startOfLocalDay(input.startDate)
  const end = startOfLocalDay(input.endDate)
  if (end.getTime() < start.getTime()) {
    throw new Error('endDate must be >= startDate')
  }
  const seasonStart = startOfLocalDay(input.seasonStartDate)
  if (start.getTime() < seasonStart.getTime()) {
    throw new Error('cannot create series before season start')
  }

  // 2. Expand récurrence.
  const expanded = expandRecurrence(input.recurrence, start, end)
  if (expanded.length === 0) {
    throw new Error('recurrence rule yields no dates')
  }

  // 3. Filtre closures — toujours appliqué (les séries respectent les
  // fermetures de salle, pas de bypass volontaire côté série).
  const { kept } = await filterDatesByVenueClosures(input.venueId, expanded)
  if (kept.length === 0) {
    throw new Error('all occurrences fall within venue closures')
  }

  // 4. Détection conflits — throw si au moins un.
  const conflicts = await detectBookingConflicts(
    input.courtId,
    kept,
    input.startTime,
    input.endTime,
  )
  if (conflicts.length > 0) {
    throw new Error(
      `series has ${conflicts.length} conflicting occurrence(s); first on ${conflicts[0]!.date.toISOString()}`,
    )
  }

  // 5. Crée le doc /bookingSeries d'abord (id stable pour les bookings).
  // `considerClosures: true` toujours pour les nouvelles séries (les docs
  // historiques peuvent porter `false` mais le code ne lit plus ce flag).
  const seriesData: BookingSeriesData = {
    seasonId: input.seasonId,
    venueId: input.venueId,
    courtId: input.courtId,
    teamId: input.teamId,
    slotType: input.slotType,
    matchTypeId: input.matchTypeId,
    startDate: Timestamp.fromDate(start),
    endDate: Timestamp.fromDate(end),
    startTime: input.startTime,
    endTime: input.endTime,
    recurrence: input.recurrence,
    considerClosures: true,
    title: input.title,
    notes: input.notes,
    createdBy: input.createdBy,
    // serverTimestamp() retourne une FieldValue ; le doc lui assignera un
    // Timestamp côté serveur. À la lecture suivante, sera un Timestamp.
    // any: serverTimestamp() ne match pas le type Timestamp côté shared-types
    // (le cast est local et borné à l'écriture initiale).
    createdAt: serverTimestamp() as unknown as BookingSeriesData['createdAt'],
  }
  const seriesRef = await addDoc(collection(db, BOOKING_SERIES), seriesData)
  const seriesId = seriesRef.id

  // 6. Batch les bookings (pré-allocation des IDs pour pouvoir les retourner).
  const bookingsCol = collection(db, BOOKINGS)
  const bookingRefs = kept.map(() => doc(bookingsCol))
  const ops: Array<(batch: WriteBatch) => void> = kept.map((d, i) => {
    const data = buildManualBookingData({
      seasonId: input.seasonId,
      venueId: input.venueId,
      courtId: input.courtId,
      date: d,
      startTime: input.startTime,
      endTime: input.endTime,
      teamId: input.teamId,
      slotType: input.slotType,
      matchTypeId: input.matchTypeId,
      title: input.title,
      notes: input.notes,
      createdBy: input.createdBy,
      seriesId,
      originalDate: d,
    })
    const ref = bookingRefs[i]!
    return (batch) => batch.set(ref, data)
  })
  await commitBatched(ops)

  return { seriesId, bookingIds: bookingRefs.map((r) => r.id) }
}

// ---------------------------------------------------------------------------
// editBooking — scope occurrence | future | all
// ---------------------------------------------------------------------------

/** Champs du patch impactés par la garde "pas de modif dans le passé". */
const PAST_GUARDED_FIELDS: ReadonlyArray<keyof BookingPatch> = [
  'date',
  'startTime',
  'endTime',
  'courtId',
]

/**
 * Sépare le patch en deux : ce qui touche les champs date/time/court (interdit
 * pour les bookings passés) et ce qui reste applicable (notes/teamId/status…).
 */
function splitPatch(patch: BookingPatch): {
  guarded: BookingPatch
  safe: BookingPatch
} {
  const guarded: BookingPatch = {}
  const safe: BookingPatch = {}
  for (const k of Object.keys(patch) as Array<keyof BookingPatch>) {
    if (PAST_GUARDED_FIELDS.includes(k)) {
      // any: indexation dynamique sur un type union ; le cast est strict côté call site.
      ;(guarded as Record<string, unknown>)[k] = patch[k]
    } else {
      ;(safe as Record<string, unknown>)[k] = patch[k]
    }
  }
  return { guarded, safe }
}

/**
 * Convertit un `BookingPatch` en `UpdateData` Firestore (Timestamp + actionLog).
 * `editorUid` + `scope` permettent de tracer la modif dans l'actionLog (append-only).
 */
function patchToUpdate(
  patch: BookingPatch,
  editorUid: string,
  scope: EditScope,
): UpdateData<DocumentData> {
  const update: UpdateData<DocumentData> = {}
  if (patch.date !== undefined) {
    update.date = Timestamp.fromDate(startOfLocalDay(patch.date))
  }
  if (patch.startTime !== undefined) update.startTime = patch.startTime
  if (patch.endTime !== undefined) update.endTime = patch.endTime
  if (patch.courtId !== undefined) update.courtId = patch.courtId
  if (patch.teamId !== undefined) update.teamId = patch.teamId
  if (patch.notes !== undefined) {
    // Pas de champ `notes` au schéma /bookings — on l'écrit comme log entry.
    // Le rendu admin lit la dernière entry note=… si besoin.
  }
  if (patch.status !== undefined) update.status = patch.status
  if (patch.cancelReason !== undefined) update.cancelReason = patch.cancelReason
  if (patch.opponentName !== undefined) update.opponentName = patch.opponentName
  if (patch.awayAddress !== undefined) update.awayAddress = patch.awayAddress
  if (patch.matchId !== undefined) update.matchId = patch.matchId
  if (patch.matchTypeId !== undefined) update.matchTypeId = patch.matchTypeId

  const log: BookingActionLogEntry = {
    at: Timestamp.now(),
    by: editorUid,
    action: 'manual_edit',
    note: scope,
  }
  update.actionLog = arrayUnion(log)
  return update
}

/**
 * Édite un booking selon le scope.
 * - `'occurrence'` : update du seul `/bookings/{id}`. Le booking devient un
 *   "override" — sa `date` diverge potentiellement de `originalDate`.
 * - `'future'` : update tous les `/bookings` de la même série dont
 *   `date >= booking.date`, ET update `/bookingSeries` (réécrit `startDate`
 *   à la date courante du booking pivot).
 *   Au MVP : pas de split en deux séries — on update en place.
 * - `'all'` : update tous les `/bookings` de la même série + `/bookingSeries`.
 *
 * Garde-fou : refuse de modifier date/startTime/endTime/courtId sur un
 * booking dont `date < startOfToday()` (throw pour scope `'occurrence'`,
 * silencieusement skip pour scope `'future'`/`'all'`). Les autres champs
 * (notes/teamId/status) restent appliqués.
 *
 * Conflit : avant tout write, re-détecte les conflits (si date/time/court
 * changent) et throw si conflit. Exclut les bookings de la propre série.
 *
 * Audit : ajoute une entrée actionLog sur chaque booking modifié
 * (`action: 'manual_edit'`, `by: editorUid`, `note: scope`).
 */
export async function editBooking(
  bookingId: string,
  scope: EditScope,
  patch: BookingPatch,
  editorUid: string,
): Promise<void> {
  const bookingSnap = await getDoc(doc(db, BOOKINGS, bookingId))
  if (!bookingSnap.exists()) {
    throw new Error(`booking ${bookingId} not found`)
  }
  const pivot = mapBookingData(bookingSnap.id, bookingSnap.data() as BookingData)
  const pivotDate = new Date(pivot.date.seconds * 1000)

  const { guarded, safe } = splitPatch(patch)
  const hasGuardedChanges = Object.keys(guarded).length > 0

  if (scope === 'occurrence') {
    if (isBeforeToday(pivotDate) && hasGuardedChanges) {
      throw new Error('cannot modify past occurrence')
    }
    // Conflit check si on touche date/time/court.
    if (hasGuardedChanges) {
      const targetCourtId = guarded.courtId ?? pivot.courtId
      const targetDate = guarded.date ?? pivotDate
      const targetStart = guarded.startTime ?? pivot.startTime
      const targetEnd = guarded.endTime ?? pivot.endTime
      const conflicts = await detectBookingConflicts(
        targetCourtId,
        [targetDate],
        targetStart,
        targetEnd,
        [bookingId],
      )
      if (conflicts.length > 0) {
        throw new Error(`edit conflict with booking ${conflicts[0]!.conflictWith.id}`)
      }
    }
    const update = patchToUpdate(patch, editorUid, scope)
    await updateDoc(doc(db, BOOKINGS, bookingId), update)
    return
  }

  // scope 'future' | 'all' — pivot doit appartenir à une série pour qu'on
  // puisse propager. Sinon, on update juste le pivot (cas one-shot).
  if (pivot.seriesId === null) {
    if (isBeforeToday(pivotDate) && hasGuardedChanges) {
      throw new Error('cannot modify past occurrence')
    }
    await updateDoc(doc(db, BOOKINGS, bookingId), patchToUpdate(patch, editorUid, scope))
    return
  }

  // Charge tous les bookings de la série.
  const seriesBookingsSnap = await getDocs(
    query(collection(db, BOOKINGS), where('seriesId', '==', pivot.seriesId)),
  )
  const seriesBookings = seriesBookingsSnap.docs.map((d) =>
    mapBookingData(d.id, d.data() as BookingData),
  )

  // Sélectionne les targets selon scope.
  const targets =
    scope === 'all'
      ? seriesBookings
      : seriesBookings.filter(
          (b) => new Date(b.date.seconds * 1000).getTime() >= pivotDate.getTime(),
        )

  // Conflict pre-check si on touche court/time (pas date — chaque booking garde sa date).
  // Pour scope future/all, on ne change PAS la date du booking individuel (sinon ça
  // perd tout son sens) — on ignore patch.date pour ce scope.
  const touchedCourtOrTime =
    guarded.courtId !== undefined ||
    guarded.startTime !== undefined ||
    guarded.endTime !== undefined
  if (touchedCourtOrTime) {
    const futureTargets = targets.filter(
      (b) => !isBeforeToday(new Date(b.date.seconds * 1000)),
    )
    const excludeIds = seriesBookings.map((b) => b.id)
    // Détecte conflits pour chaque target (dates différentes).
    for (const t of futureTargets) {
      const targetCourtId = guarded.courtId ?? t.courtId
      const targetStart = guarded.startTime ?? t.startTime
      const targetEnd = guarded.endTime ?? t.endTime
      const conflicts = await detectBookingConflicts(
        targetCourtId,
        [new Date(t.date.seconds * 1000)],
        targetStart,
        targetEnd,
        excludeIds,
      )
      if (conflicts.length > 0) {
        throw new Error(
          `edit conflict on ${new Date(t.date.seconds * 1000).toISOString()} with ${conflicts[0]!.conflictWith.id}`,
        )
      }
    }
  }

  // Apply en batch (chunké).
  const ops: Array<(batch: WriteBatch) => void> = []
  for (const t of targets) {
    const targetDate = new Date(t.date.seconds * 1000)
    const isPast = isBeforeToday(targetDate)
    // Pour scope future/all : on n'écrit pas `date` (patch.date ignoré).
    const effectivePatch: BookingPatch = isPast
      ? safe // Past booking : seulement les champs safe.
      : { ...guarded, ...safe, date: undefined } // Future booking : tout sauf date.
    if (Object.keys(effectivePatch).filter((k) => (effectivePatch as Record<string, unknown>)[k] !== undefined).length === 0) {
      continue
    }
    const update = patchToUpdate(effectivePatch, editorUid, scope)
    const ref = doc(db, BOOKINGS, t.id)
    ops.push((batch) => batch.update(ref, update))
  }

  // Update /bookingSeries : title + notes + (pour future) startDate = pivotDate.
  const seriesUpdate: UpdateData<DocumentData> = {}
  if (patch.title !== undefined) seriesUpdate.title = patch.title
  if (patch.notes !== undefined) seriesUpdate.notes = patch.notes
  if (scope === 'future') {
    seriesUpdate.startDate = Timestamp.fromDate(startOfLocalDay(pivotDate))
  }
  if (Object.keys(seriesUpdate).length > 0) {
    const seriesRef = doc(db, BOOKING_SERIES, pivot.seriesId)
    ops.push((batch) => batch.update(seriesRef, seriesUpdate))
  }

  await commitBatched(ops)
}

// ---------------------------------------------------------------------------
// deleteBooking — cancel propre (status='cancelled') + delete série si vide
// ---------------------------------------------------------------------------

/**
 * Supprime / annule selon scope.
 * - One-shot manuel ou occurrence : si `scope='occurrence'`, cancel le booking
 *   (`status='cancelled'`, `cancelReason='manual'`, actionLog).
 *   Si le booking n'est rattaché à aucune série et qu'on demande `'all'`,
 *   delete physique acceptable (booking + série inexistante).
 * - Série : si `scope='future'` ou `'all'`, cancel les bookings concernés
 *   avec `cancelReason='series_edit'` + delete `/bookingSeries` si scope='all'
 *   et que tous les bookings restants sont cancelled.
 * Refuse de modifier les bookings passés (idem `editBooking`).
 */
export async function deleteBooking(
  bookingId: string,
  scope: EditScope,
  editorUid: string,
): Promise<void> {
  const snap = await getDoc(doc(db, BOOKINGS, bookingId))
  if (!snap.exists()) {
    throw new Error(`booking ${bookingId} not found`)
  }
  const pivot = mapBookingData(snap.id, snap.data() as BookingData)
  const pivotDate = new Date(pivot.date.seconds * 1000)

  // Cas one-shot ou scope=occurrence : cancel le seul booking.
  if (scope === 'occurrence' || pivot.seriesId === null) {
    if (isBeforeToday(pivotDate)) {
      throw new Error('cannot modify past occurrence')
    }
    const log: BookingActionLogEntry = {
      at: Timestamp.now(),
      by: editorUid,
      action: 'manual_cancel',
      note: scope,
    }
    // One-shot avec scope 'all' → delete physique (le doc n'est pas archivé).
    if (scope === 'all' && pivot.seriesId === null) {
      await deleteDoc(doc(db, BOOKINGS, bookingId))
      return
    }
    await updateDoc(doc(db, BOOKINGS, bookingId), {
      status: 'cancelled' as BookingStatus,
      cancelReason: 'manual' as BookingCancelReason,
      actionLog: arrayUnion(log),
    })
    return
  }

  // Scope future / all sur une série.
  const seriesId = pivot.seriesId
  const seriesBookingsSnap = await getDocs(
    query(collection(db, BOOKINGS), where('seriesId', '==', seriesId)),
  )
  const seriesBookings = seriesBookingsSnap.docs.map((d) =>
    mapBookingData(d.id, d.data() as BookingData),
  )

  const targets =
    scope === 'all'
      ? seriesBookings
      : seriesBookings.filter(
          (b) => new Date(b.date.seconds * 1000).getTime() >= pivotDate.getTime(),
        )

  const log: BookingActionLogEntry = {
    at: Timestamp.now(),
    by: editorUid,
    action: 'manual_cancel',
    note: scope,
  }

  const ops: Array<(batch: WriteBatch) => void> = []
  for (const t of targets) {
    const targetDate = new Date(t.date.seconds * 1000)
    if (isBeforeToday(targetDate)) {
      // On NE touche pas aux bookings passés (garde-fou).
      continue
    }
    if (t.status === 'cancelled') continue
    const ref = doc(db, BOOKINGS, t.id)
    ops.push((batch) =>
      batch.update(ref, {
        status: 'cancelled' as BookingStatus,
        cancelReason: 'series_edit' as BookingCancelReason,
        actionLog: arrayUnion(log),
      }),
    )
  }

  await commitBatched(ops)

  // Delete /bookingSeries si scope='all' et que tous les bookings sont cancelled.
  if (scope === 'all') {
    // Relit l'état après cancel pour vérifier.
    const refreshedSnap = await getDocs(
      query(collection(db, BOOKINGS), where('seriesId', '==', seriesId)),
    )
    const allCancelled = refreshedSnap.docs.every((d) => {
      const data = d.data() as BookingData
      return data.status === 'cancelled'
    })
    if (allCancelled) {
      await deleteDoc(doc(db, BOOKING_SERIES, seriesId))
    }
  }
}

// ---------------------------------------------------------------------------
// listAllBookingsForSeason — toutes les réservations d'une saison
// ---------------------------------------------------------------------------

/**
 * Charge **tous** les bookings d'une saison, toutes dates confondues (passé
 * inclus). Source unique pour la vue /bookings — la grille Planning filtre
 * client-side par jour, le panneau Liste consomme la même array.
 *
 * Stratégie : single query `where('seasonId', '==', seasonId)`, tri JS au
 * retour. Pas d'`orderBy` Firestore (évite la dépendance à un index
 * composite). Volumétrie attendue < ~1000 docs par saison — acceptable côté
 * client.
 */
export async function listAllBookingsForSeason(
  seasonId: string,
): Promise<BookingRow[]> {
  const q = query(
    collection(db, BOOKINGS),
    where('seasonId', '==', seasonId),
  )
  const snap = await getDocs(q)
  if (snap.empty) return []

  const bookings: Booking[] = snap.docs.map((d) =>
    mapBookingData(d.id, d.data() as BookingData),
  )

  // Tri JS par date ASC, startTime ASC — équivalent à l'orderBy Firestore
  // mais sans dépendance à l'index composite.
  bookings.sort((a, b) => {
    const da = a.date.seconds - b.date.seconds
    if (da !== 0) return da
    return a.startTime.localeCompare(b.startTime)
  })

  // Joins teams / venues / courts (lecture parallèle, lookup map).
  const teamIds = new Set<string>()
  const venueIds = new Set<string>()
  const courtPairs = new Map<string, { venueId: string; courtId: string }>()
  for (const b of bookings) {
    if (b.teamId) teamIds.add(b.teamId)
    if (b.venueId) venueIds.add(b.venueId)
    if (b.venueId && b.courtId) {
      const key = `${b.venueId}/${b.courtId}`
      if (!courtPairs.has(key)) {
        courtPairs.set(key, { venueId: b.venueId, courtId: b.courtId })
      }
    }
  }

  const [teamNames, venueNames, courtNames] = await Promise.all([
    loadTeamNames(Array.from(teamIds)),
    loadVenueNames(Array.from(venueIds)),
    loadCourtNames(Array.from(courtPairs.values())),
  ])

  return bookings.map((b) => ({
    ...b,
    teamName: b.teamId ? (teamNames.get(b.teamId) ?? null) : null,
    venueName: venueNames.get(b.venueId) ?? null,
    courtName: courtNames.get(`${b.venueId}/${b.courtId}`) ?? null,
  }))
}

// ---------------------------------------------------------------------------
// listAllSeriesForSeason — toutes les séries d'une saison + counts
// ---------------------------------------------------------------------------

/** Résumé d'une série incluant ses compteurs de bookings passé / futur. */
export interface SeriesSummary {
  /** Doc Firestore `/bookingSeries/{id}`. */
  series: BookingSeries
  /** Nombre total de bookings liés à cette série (toutes dates, tous statuses). */
  totalCount: number
  /** Bookings avec date < aujourd'hui (00:00 local) — non touchés par la delete. */
  pastCount: number
  /** Bookings avec date >= aujourd'hui ET status === 'scheduled'. */
  upcomingCount: number
}

/**
 * Charge toutes les séries d'une saison + compteurs (totalCount / pastCount /
 * upcomingCount). Une query sur `/bookingSeries` puis une query par série sur
 * `/bookings` (parallélisée via `Promise.all`).
 *
 * Volumétrie attendue : < 100 séries par saison — pas de pagination.
 */
export async function listAllSeriesForSeason(
  seasonId: string,
): Promise<SeriesSummary[]> {
  const seriesSnap = await getDocs(
    query(collection(db, BOOKING_SERIES), where('seasonId', '==', seasonId)),
  )
  if (seriesSnap.empty) return []

  const todayMs = startOfToday().getTime()

  const summaries: SeriesSummary[] = await Promise.all(
    seriesSnap.docs.map(async (sd) => {
      const series: BookingSeries = {
        id: sd.id,
        ...(sd.data() as BookingSeriesData),
      }
      const bookingsSnap = await getDocs(
        query(collection(db, BOOKINGS), where('seriesId', '==', sd.id)),
      )
      let pastCount = 0
      let upcomingCount = 0
      for (const bd of bookingsSnap.docs) {
        const data = bd.data() as BookingData
        const dateMs = data.date.seconds * 1000
        const localMs = startOfLocalDay(new Date(dateMs)).getTime()
        if (localMs < todayMs) {
          pastCount += 1
        } else if (data.status === 'scheduled') {
          upcomingCount += 1
        }
      }
      return {
        series,
        totalCount: bookingsSnap.size,
        pastCount,
        upcomingCount,
      }
    }),
  )

  return summaries
}

// ---------------------------------------------------------------------------
// deleteBookingSeries — purge série + bookings futurs (préserve historique)
// ---------------------------------------------------------------------------

/**
 * Supprime physiquement une série `/bookingSeries/{seriesId}` ainsi que tous
 * ses bookings **futurs scheduled** (date >= aujourd'hui ET status='scheduled').
 * Les bookings passés et les bookings déjà cancelled ne sont PAS touchés —
 * l'historique reste accessible (analytics, audits, présences enregistrées).
 *
 * Diffère de `deleteBooking(id, 'all')` :
 *   - `deleteBooking` cancel (soft) les bookings futurs en gardant le statut
 *     'cancelled' visible dans le grid.
 *   - `deleteBookingSeries` delete **physiquement** les futurs : ils
 *     disparaissent totalement (utile quand l'admin veut un cleanup
 *     profond sans pollution visuelle).
 *
 * `editorUid` n'est PAS écrit (pas d'actionLog en delete physique) mais
 * conservé dans la signature pour homogénéité avec `deleteBooking`.
 *
 * Throw `'series not found'` si le doc `/bookingSeries/{seriesId}` n'existe pas.
 */
export async function deleteBookingSeries(
  seriesId: string,
  editorUid: string,
): Promise<{ deletedFuture: number; keptPast: number }> {
  // editorUid : cohérence de signature avec `deleteBooking` — non utilisé
  // dans cette implémentation (pas d'actionLog en delete physique).
  // Le `void` empêche les warnings TS/ESLint sans cast ni disable directive.
  void editorUid
  const seriesRef = doc(db, BOOKING_SERIES, seriesId)
  const seriesSnap = await getDoc(seriesRef)
  if (!seriesSnap.exists()) {
    throw new Error('series not found')
  }

  const bookingsSnap = await getDocs(
    query(collection(db, BOOKINGS), where('seriesId', '==', seriesId)),
  )

  let deletedFuture = 0
  let keptPast = 0
  const ops: Array<(batch: WriteBatch) => void> = []

  for (const bd of bookingsSnap.docs) {
    const data = bd.data() as BookingData
    const dateMs = data.date.seconds * 1000
    const isFuture = !isBeforeToday(new Date(dateMs))
    if (isFuture && data.status === 'scheduled') {
      const ref = doc(db, BOOKINGS, bd.id)
      ops.push((batch) => batch.delete(ref))
      deletedFuture += 1
    } else {
      keptPast += 1
    }
  }

  // Delete final du doc série inclus dans le batch — atomicité partielle (par
  // chunk de 500). Si seriesRef.delete tient dans le dernier chunk, OK ;
  // sinon on l'ajoute en dernier op pour qu'il finisse dans le dernier batch.
  ops.push((batch) => batch.delete(seriesRef))

  await commitBatched(ops)

  return { deletedFuture, keptPast }
}

// ---------------------------------------------------------------------------
// hardDeleteBooking — delete physique d'un seul booking (sans cancel)
// ---------------------------------------------------------------------------

/**
 * Supprime physiquement un booking. Aucun filtre / garde / actionLog :
 * c'est l'outil radical du panneau "Liste" du UI bookings.
 *
 * Différence vs `deleteBooking` :
 *   - `deleteBooking` cancel (soft) ET respecte les scopes / garde les
 *     bookings passés.
 *   - `hardDeleteBooking` supprime sans condition (peut écraser un booking
 *     passé — l'appelant doit savoir ce qu'il fait).
 *
 * Throw `'booking not found'` si le doc n'existe pas.
 */
export async function hardDeleteBooking(bookingId: string): Promise<void> {
  const ref = doc(db, BOOKINGS, bookingId)
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    throw new Error('booking not found')
  }
  await deleteDoc(ref)
}

// ---------------------------------------------------------------------------
// getBookingSeries — read joint
// ---------------------------------------------------------------------------

/** Lit le doc `/bookingSeries` + tous ses bookings associés. */
export async function getBookingSeries(
  seriesId: string,
): Promise<{ series: BookingSeries; bookings: Booking[] } | null> {
  const [seriesSnap, bookingsSnap] = await Promise.all([
    getDoc(doc(db, BOOKING_SERIES, seriesId)),
    getDocs(query(collection(db, BOOKINGS), where('seriesId', '==', seriesId))),
  ])
  if (!seriesSnap.exists()) return null
  const series: BookingSeries = {
    id: seriesSnap.id,
    ...(seriesSnap.data() as BookingSeriesData),
  }
  const bookings = bookingsSnap.docs.map((d) =>
    mapBookingData(d.id, d.data() as BookingData),
  )
  return { series, bookings }
}

// ===========================================================================
// Match bookings — one-shot match_home / match_away + auto-free conflits
// ===========================================================================
//
// Un match EST un booking (slotType: 'match_home' | 'match_away'). On garde le
// même schéma /bookings ; les deux champs `opponentName` / `awayAddress` sont
// les seuls champs match-spécifiques. La spec produit (2026-05-15) impose que
// la création d'un match libère automatiquement (status='freed') tout
// entraînement de la même équipe qui chevauche.

/**
 * Libère (`status='freed'`, `cancelReason='match_home'|'match_away'`) tous les
 * bookings `slotType in ['training', 'reserve']` et `status='scheduled'` de
 * l'équipe `teamId` qui chevauchent la date + créneau passé.
 *
 * Logique métier : quand on crée un match (home OU away) pour une équipe X,
 * tout entraînement de X qui tomberait au même moment devient "libre" (le
 * créneau libéré reste réservable par un autre). Cf. spec produit 2026-05-15.
 *
 * Idempotent : ré-appel = no-op (skip les bookings déjà freed/cancelled, ils
 * sont filtrés via `status === 'scheduled'`).
 *
 * @returns liste des bookingIds libérés (utile pour log/UI).
 */
export async function freeConflictingTrainings(args: {
  teamId: string
  date: Date
  startTime: string
  endTime: string
  reason: 'match_home' | 'match_away'
  editorUid: string
  /** Exclut un bookingId de la recherche (utile si on vient de créer le match lui-même). */
  excludeBookingId?: string
}): Promise<string[]> {
  const dayStart = startOfLocalDay(args.date)
  const q = query(
    collection(db, BOOKINGS),
    where('teamId', '==', args.teamId),
    where('date', '==', Timestamp.fromDate(dayStart)),
  )
  const snap = await getDocs(q)
  if (snap.empty) return []

  const candidates = snap.docs
    .filter((d) => d.id !== args.excludeBookingId)
    .map((d) => ({ id: d.id, data: d.data() as BookingData }))
    .filter(({ data }) => data.status === 'scheduled')
    .filter(({ data }) => data.slotType === 'training' || data.slotType === 'reserve')
    .filter(({ data }) =>
      timeRangesOverlap(args.startTime, args.endTime, data.startTime, data.endTime),
    )

  if (candidates.length === 0) return []

  const log: BookingActionLogEntry = {
    at: Timestamp.now(),
    by: args.editorUid,
    action: 'auto_free_on_match',
    note: args.reason,
  }

  const ops: Array<(batch: WriteBatch) => void> = candidates.map(({ id }) => {
    const ref = doc(db, BOOKINGS, id)
    return (batch) =>
      batch.update(ref, {
        status: 'freed' as BookingStatus,
        cancelReason: args.reason as BookingCancelReason,
        actionLog: arrayUnion(log),
      })
  })
  await commitBatched(ops)

  return candidates.map((c) => c.id)
}

// ---------------------------------------------------------------------------
// Note (2026-05-15) : `createMatchBooking` et `assignMatchToBooking` ont été
// retirés au profit de `matches.repo.ts` → `createHomeMatch` / `createAwayMatch`
// (collection racine `/matches` avec writeBatch atomique sur le booking lié
// pour HOME). Voir Chantier C + D.
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Re-exports types — pour que les consumers n'importent que ce module.
// ---------------------------------------------------------------------------

export type {
  Booking,
  BookingActionLogEntry,
  BookingCancelReason,
  BookingSeries,
  BookingStatus,
  RecurrenceRule,
  SlotType,
}
