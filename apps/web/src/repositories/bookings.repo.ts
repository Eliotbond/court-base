import {
  Timestamp,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import type {
  Booking,
  BookingActionLogEntry,
  BookingCancelReason,
  BookingData,
  BookingStatus,
  Court,
  Season,
  SlotType,
  Team,
  Venue,
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
const SEASONS = 'seasons'
const VENUES = 'venues'
const COURTS = 'courts'
const TEAMS = 'teams'

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
    date: data.date,
    startTime: data.startTime,
    endTime: data.endTime,
    status: data.status,
    cancelReason: data.cancelReason,
    linkedBookingIds: data.linkedBookingIds ?? [],
    isCombinedCourtEvent: data.isCombinedCourtEvent,
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
// Bookings range — query principale du Season grid.
//
// Query :
//   `bookings where seasonId == seasonId
//      and date >= from and date <= to
//      orderBy date asc, startTime asc`
//
// Pas de filtre sur `status` ici : on veut afficher les `cancelled` et `freed`
// avec un traitement visuel distinct (struck / muted) — la vue gère le rendu.
// Les sub-collections `officialAssignments` / `attendance` ne sont PAS lues
// (cf. commentaire de tête). Les jointures team / venue / court sont
// résolues en parallèle après la query principale.
// ---------------------------------------------------------------------------

/**
 * Bookings d'une saison sur l'intervalle [from, to] (bornes incluses).
 *
 * Retourne `[]` si la saison n'a aucun booking sur la fenêtre (DB vierge,
 * semaine vide, saison non-générée). N'écrit jamais — read-only repo pour
 * le MVP de la vue.
 */
export async function listBookingsInRange(
  seasonId: string,
  from: Date,
  to: Date,
): Promise<BookingRow[]> {
  const q = query(
    collection(db, BOOKINGS),
    where('seasonId', '==', seasonId),
    where('date', '>=', Timestamp.fromDate(from)),
    where('date', '<=', Timestamp.fromDate(to)),
    orderBy('date', 'asc'),
    orderBy('startTime', 'asc'),
  )
  const snap = await getDocs(q)
  if (snap.empty) return []

  const bookings: Booking[] = snap.docs.map((d) =>
    mapBookingData(d.id, d.data() as BookingData),
  )

  // Ramasse les IDs uniques à joindre : teams + (venueId, courtId).
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

// ---------------------------------------------------------------------------
// Re-exports types — pour que les consumers n'importent que ce module.
// ---------------------------------------------------------------------------

export type {
  Booking,
  BookingActionLogEntry,
  BookingCancelReason,
  BookingStatus,
  SlotType,
}
