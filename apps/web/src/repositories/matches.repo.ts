import {
  Timestamp,
  addDoc,
  arrayUnion,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type UpdateData,
} from 'firebase/firestore'
import type {
  Booking,
  BookingActionLogEntry,
  BookingData,
  Court,
  Match,
  MatchData,
  MatchType,
  Team,
  Venue,
} from '@club-app/shared-types'
import { db } from '@/services/firebase'
import { freeConflictingTrainings } from '@/repositories/bookings.repo'

/**
 * Repository Matches — Firestore-backed pour l'écran `/matches`.
 *
 * Modèle de données (cf. `packages/shared-types/src/match.ts` et
 * `docs/firebase.md` section /matches) :
 *  - `/matches/{matchId}` est l'entité produit. Match HOME : `bookingId`
 *    pointe sur `/bookings/{bookingId}` (slotType `match_home`) ; le booking
 *    porte en retour `booking.matchId === match.id` (référence bidirec­
 *    tionnelle, mutée via `writeBatch` atomique). Match AWAY : `bookingId`
 *    est null — la date/heure/adresse sont stockées sur le match (pas de
 *    booking créé).
 *  - Les anciens bookings `match_away` (avec `venueId/courtId === ''`) ne
 *    sont plus créés par ce flow (cf. `Cleanup` § Étape 5 du chantier C).
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase pour les
 * docs `/matches` — la vue passe par `stores/matches.ts` qui appelle ici
 * (cf. docs/frontend-desktop.md — architecture en couches).
 *
 * Best-effort sur `freeConflictingTrainings` : si la libération échoue
 * après la création du match, le match reste en place (log console, pas de
 * rollback). Cohérent avec le comportement historique (les anciennes fonctions
 * `createMatchBooking` / `assignMatchToBooking` ont été retirées de
 * `bookings.repo.ts` — Chantier D, 2026-05-15).
 */

const MATCHES = 'matches'
const BOOKINGS = 'bookings'
const TEAMS = 'teams'
const MATCH_TYPES = 'matchTypes'
const VENUES = 'venues'
const COURTS = 'courts'

// ---------------------------------------------------------------------------
// Types exposés
// ---------------------------------------------------------------------------

/**
 * Match enrichi pour l'UI liste — joints lus côté repo (1 query par
 * collection référencée, pas N+1) :
 *  - `teamName` ← `/teams/{teamId}`.
 *  - `matchTypeName` / `matchTypeColor` ← `/matchTypes/{matchTypeId}`.
 *  - `venueName` / `courtName` (HOME uniquement) ← `/venues/{venueId}` +
 *    `collectionGroup('courts')`, résolus via le booking référencé.
 *
 * Les champs jointurés sont `null` si la référence est introuvable
 * (référentiel obsolète) ou non applicable (AWAY n'a ni venue ni court).
 */
export interface MatchRow extends Match {
  teamName: string | null
  matchTypeName: string | null
  matchTypeColor: string | null
  venueName: string | null
  courtName: string | null
}

// ---------------------------------------------------------------------------
// Snap → row helpers
// ---------------------------------------------------------------------------

function mapMatchData(id: string, data: MatchData): Match {
  return {
    id,
    bookingId: data.bookingId,
    kind: data.kind,
    teamId: data.teamId,
    matchTypeId: data.matchTypeId,
    opponentName: data.opponentName ?? null,
    awayAddress: data.awayAddress ?? null,
    date: data.date,
    startTime: data.startTime,
    endTime: data.endTime,
    status: data.status,
    notes: data.notes ?? null,
    createdAt: data.createdAt,
    createdBy: data.createdBy,
  }
}

function mapBookingData(id: string, data: BookingData): Booking {
  // Sous-ensemble du mapping fait dans bookings.repo.ts — duplication
  // mineure mais préférable à exporter un helper trop large depuis là-bas.
  // Si la liste de champs explose, refactorer en un mapper partagé.
  return {
    id,
    seasonId: data.seasonId,
    venueId: data.venueId,
    courtId: data.courtId,
    timeSlotId: data.timeSlotId,
    teamId: data.teamId,
    slotType: data.slotType,
    matchTypeId: data.matchTypeId,
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

/** `true` si `d` est au 00:00 local. */
function startOfLocalDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

// ---------------------------------------------------------------------------
// Joins — résolution des labels d'UI pour `MatchRow`.
// ---------------------------------------------------------------------------

interface JoinMaps {
  teamNames: Map<string, string>
  matchTypeNames: Map<string, string>
  matchTypeColors: Map<string, string>
  /** booking.id → booking (pour résoudre venue/court d'un match HOME). */
  bookings: Map<string, Booking>
  venueNames: Map<string, string>
  /** courtId → court name (collectionGroup, on ne joint pas par parent). */
  courtNames: Map<string, string>
}

async function loadJoinMaps(): Promise<JoinMaps> {
  const [teamsSnap, matchTypesSnap, venuesSnap, courtsSnap] = await Promise.all([
    getDocs(collection(db, TEAMS)),
    getDocs(collection(db, MATCH_TYPES)),
    getDocs(collection(db, VENUES)),
    getDocs(collectionGroup(db, COURTS)),
  ])

  const teamNames = new Map<string, string>()
  for (const d of teamsSnap.docs) {
    const data = d.data() as Team
    teamNames.set(d.id, data.name)
  }

  const matchTypeNames = new Map<string, string>()
  const matchTypeColors = new Map<string, string>()
  for (const d of matchTypesSnap.docs) {
    const data = d.data() as MatchType
    matchTypeNames.set(d.id, data.name)
    matchTypeColors.set(d.id, data.color)
  }

  const venueNames = new Map<string, string>()
  for (const d of venuesSnap.docs) {
    const data = d.data() as Venue
    venueNames.set(d.id, data.name)
  }

  const courtNames = new Map<string, string>()
  for (const d of courtsSnap.docs) {
    const data = d.data() as Court
    courtNames.set(d.id, data.name)
  }

  return {
    teamNames,
    matchTypeNames,
    matchTypeColors,
    bookings: new Map<string, Booking>(),
    venueNames,
    courtNames,
  }
}

/**
 * Charge en bloc tous les bookings référencés par les matchs HOME, et les
 * ajoute dans `maps.bookings`. Utilise des chunks `documentId in [...]` (max
 * 30 ids par query Firestore — limite SDK).
 */
async function fetchBookingsForMatches(
  maps: JoinMaps,
  matches: Match[],
): Promise<void> {
  const bookingIds = matches
    .map((m) => m.bookingId)
    .filter((id): id is string => id !== null)
  if (bookingIds.length === 0) return

  const CHUNK = 30
  for (let i = 0; i < bookingIds.length; i += CHUNK) {
    const slice = bookingIds.slice(i, i + CHUNK)
    const snap = await getDocs(
      query(collection(db, BOOKINGS), where('__name__', 'in', slice)),
    )
    for (const d of snap.docs) {
      maps.bookings.set(d.id, mapBookingData(d.id, d.data() as BookingData))
    }
  }
}

function enrichMatch(match: Match, maps: JoinMaps): MatchRow {
  const teamName = maps.teamNames.get(match.teamId) ?? null
  const matchTypeName = maps.matchTypeNames.get(match.matchTypeId) ?? null
  const matchTypeColor = maps.matchTypeColors.get(match.matchTypeId) ?? null

  let venueName: string | null = null
  let courtName: string | null = null
  if (match.kind === 'home' && match.bookingId !== null) {
    const booking = maps.bookings.get(match.bookingId)
    if (booking) {
      venueName = maps.venueNames.get(booking.venueId) ?? null
      courtName = maps.courtNames.get(booking.courtId) ?? null
    }
  }

  return {
    ...match,
    teamName,
    matchTypeName,
    matchTypeColor,
    venueName,
    courtName,
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Liste tous les matchs avec joints (équipe, type, venue/court pour HOME).
 * Tri client-side par `date` desc puis `startTime` asc (le plus récent en
 * premier — la vue `/matches` peut re-trier si besoin).
 *
 * Volume attendu : ordre de magnitude ~centaines de matchs par saison. Si
 * ça dépasse, paginer côté repo (today range + lazy older).
 */
export async function listAllMatches(): Promise<MatchRow[]> {
  const matchesSnap = await getDocs(collection(db, MATCHES))
  if (matchesSnap.empty) return []

  const matches = matchesSnap.docs.map((d) =>
    mapMatchData(d.id, d.data() as MatchData),
  )

  const maps = await loadJoinMaps()
  await fetchBookingsForMatches(maps, matches)

  const rows = matches.map((m) => enrichMatch(m, maps))
  rows.sort((a, b) => {
    if (a.date.seconds !== b.date.seconds) return b.date.seconds - a.date.seconds
    return a.startTime.localeCompare(b.startTime)
  })
  return rows
}

/** Lit un match par id avec joints. `null` si introuvable. */
export async function getMatchById(id: string): Promise<MatchRow | null> {
  const snap = await getDoc(doc(db, MATCHES, id))
  if (!snap.exists()) return null
  const match = mapMatchData(snap.id, snap.data() as MatchData)

  const maps = await loadJoinMaps()
  await fetchBookingsForMatches(maps, [match])
  return enrichMatch(match, maps)
}

/**
 * Lit le match associé à un booking (via /matches where bookingId == X
 * limit 1). Retourne null si aucun match — utile pour vérifier qu'un
 * booking `match_home` n'a pas déjà été rattaché à un match.
 */
export async function getMatchByBookingId(
  bookingId: string,
): Promise<Match | null> {
  const q = query(
    collection(db, MATCHES),
    where('bookingId', '==', bookingId),
    limit(1),
  )
  const snap = await getDocs(q)
  const first = snap.docs[0]
  if (!first) return null
  return mapMatchData(first.id, first.data() as MatchData)
}

// ---------------------------------------------------------------------------
// Mutations — HOME
// ---------------------------------------------------------------------------

export interface CreateHomeMatchInput {
  /** Booking match_home pending à rattacher. */
  bookingId: string
  teamId: string
  matchTypeId: string
  opponentName: string | null
  notes: string | null
  createdBy: string
}

/**
 * Crée un match HOME et le rattache atomiquement à un booking `match_home`
 * pending.
 *
 * Workflow :
 *  1. Lit le booking ; valide `slotType === 'match_home'`,
 *     `matchTypeId === null` (pending), `status === 'scheduled'`.
 *  2. Pré-alloue la ref `/matches` (id stable, retourné).
 *  3. `writeBatch` :
 *     - `batch.set(matchRef, matchData)` avec `bookingId = booking.id`,
 *       date/startTime/endTime/teamId dénormalisés depuis le booking.
 *     - `batch.update(bookingRef, { matchId, matchTypeId, opponentName,
 *       actionLog: arrayUnion(log) })`.
 *  4. `batch.commit()`.
 *  5. Best-effort `freeConflictingTrainings` avec `excludeBookingId =
 *     booking.id` (libère les trainings/reserves de l'équipe qui chevauchent).
 *
 * @returns `{ matchId, bookingId, freedBookingIds }`.
 */
export async function createHomeMatch(
  input: CreateHomeMatchInput,
): Promise<{ matchId: string; bookingId: string; freedBookingIds: string[] }> {
  const bookingRef = doc(db, BOOKINGS, input.bookingId)
  const bookingSnap = await getDoc(bookingRef)
  if (!bookingSnap.exists()) {
    throw new Error(`booking ${input.bookingId} not found`)
  }
  const booking = mapBookingData(bookingSnap.id, bookingSnap.data() as BookingData)

  if (booking.slotType !== 'match_home') {
    throw new Error('booking is not a match_home — cannot create home match')
  }
  if (booking.matchTypeId !== null || booking.matchId !== null) {
    throw new Error('booking already has a match assigned')
  }
  if (booking.status !== 'scheduled') {
    throw new Error('booking is not scheduled — cannot rattach a match')
  }

  const matchRef = doc(collection(db, MATCHES))
  const now = Timestamp.now()

  const matchData: MatchData = {
    bookingId: booking.id,
    kind: 'home',
    teamId: input.teamId,
    matchTypeId: input.matchTypeId,
    opponentName: input.opponentName,
    awayAddress: null,
    // Dénormalisation depuis le booking : permet de filtrer
    // `/matches where date >= X` sans join.
    date: booking.date,
    startTime: booking.startTime,
    endTime: booking.endTime,
    status: 'scheduled',
    notes: input.notes,
    createdAt: now,
    createdBy: input.createdBy,
  }

  const log: BookingActionLogEntry = {
    at: now,
    by: input.createdBy,
    action: 'match_assign',
    note: input.notes ?? input.opponentName ?? null,
  }
  const bookingUpdate: UpdateData<DocumentData> = {
    matchId: matchRef.id,
    matchTypeId: input.matchTypeId,
    opponentName: input.opponentName,
    teamId: input.teamId,
    actionLog: arrayUnion(log),
  }

  const batch = writeBatch(db)
  batch.set(matchRef, matchData)
  batch.update(bookingRef, bookingUpdate)
  await batch.commit()

  // Best-effort : libère les trainings/reserves conflictuels de l'équipe.
  // Si le call échoue après le batch, le match reste rattaché (log explicite).
  let freedBookingIds: string[] = []
  try {
    const bookingDate = new Date(booking.date.seconds * 1000)
    freedBookingIds = await freeConflictingTrainings({
      teamId: input.teamId,
      date: bookingDate,
      startTime: booking.startTime,
      endTime: booking.endTime,
      reason: 'match_home',
      editorUid: input.createdBy,
      excludeBookingId: booking.id,
    })
  } catch (err) {
    console.error(
      `createHomeMatch: match ${matchRef.id} créé mais freeConflictingTrainings a échoué — re-trigger manuel requis`,
      err,
    )
  }

  return { matchId: matchRef.id, bookingId: booking.id, freedBookingIds }
}

// ---------------------------------------------------------------------------
// Mutations — AWAY
// ---------------------------------------------------------------------------

export interface CreateAwayMatchInput {
  teamId: string
  matchTypeId: string
  opponentName: string
  awayAddress: string
  date: Date
  startTime: string
  endTime: string
  notes: string | null
  createdBy: string
}

/**
 * Crée un match AWAY (pas de booking associé). La date/heure/adresse sont
 * stockées directement sur `/matches/{matchId}`. Best-effort sur
 * `freeConflictingTrainings` pour libérer les trainings/reserves
 * conflictuels (l'équipe ne peut pas s'entraîner pendant un déplacement).
 *
 * @returns `{ matchId, freedBookingIds }`.
 */
export async function createAwayMatch(
  input: CreateAwayMatchInput,
): Promise<{ matchId: string; freedBookingIds: string[] }> {
  const now = Timestamp.now()
  const dayStart = startOfLocalDay(input.date)

  const matchData: MatchData = {
    bookingId: null,
    kind: 'away',
    teamId: input.teamId,
    matchTypeId: input.matchTypeId,
    opponentName: input.opponentName,
    awayAddress: input.awayAddress,
    date: Timestamp.fromDate(dayStart),
    startTime: input.startTime,
    endTime: input.endTime,
    status: 'scheduled',
    notes: input.notes,
    createdAt: now,
    createdBy: input.createdBy,
  }
  const ref = await addDoc(collection(db, MATCHES), matchData)

  let freedBookingIds: string[] = []
  try {
    freedBookingIds = await freeConflictingTrainings({
      teamId: input.teamId,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      reason: 'match_away',
      editorUid: input.createdBy,
    })
  } catch (err) {
    console.error(
      `createAwayMatch: match ${ref.id} créé mais freeConflictingTrainings a échoué — re-trigger manuel requis`,
      err,
    )
  }

  return { matchId: ref.id, freedBookingIds }
}

// ---------------------------------------------------------------------------
// Update / Delete
// ---------------------------------------------------------------------------

/**
 * Met à jour les champs éditables d'un match. Pour HOME, propage en plus
 * `matchTypeId` / `opponentName` sur le booking lié (writeBatch atomique)
 * pour garder la dénormalisation cohérente — c'est ce que le calendrier
 * Bookings affiche dans le tooltip d'un slot `match_home`.
 *
 * Pour AWAY, simple `updateDoc` — pas de booking à synchroniser.
 *
 * Limitation : ne met PAS à jour `date`/`startTime`/`endTime` sur le
 * booking lié si on les change ici. Pour HOME, l'admin doit changer le
 * créneau côté `/bookings` (qui propage en sens inverse via Chantier D —
 * pas encore implémenté). En attendant, conserver ces champs identiques
 * côté UI pour un match HOME.
 */
export async function updateMatch(
  matchId: string,
  patch: Partial<MatchData>,
): Promise<void> {
  const matchRef = doc(db, MATCHES, matchId)
  const matchSnap = await getDoc(matchRef)
  if (!matchSnap.exists()) {
    throw new Error(`match ${matchId} not found`)
  }
  const current = mapMatchData(matchSnap.id, matchSnap.data() as MatchData)

  // Filtre `bookingId` / `kind` / `createdAt` / `createdBy` — non éditables.
  const safePatch: Partial<MatchData> = {}
  if (patch.teamId !== undefined) safePatch.teamId = patch.teamId
  if (patch.matchTypeId !== undefined) safePatch.matchTypeId = patch.matchTypeId
  if (patch.opponentName !== undefined) safePatch.opponentName = patch.opponentName
  if (patch.awayAddress !== undefined) safePatch.awayAddress = patch.awayAddress
  if (patch.date !== undefined) safePatch.date = patch.date
  if (patch.startTime !== undefined) safePatch.startTime = patch.startTime
  if (patch.endTime !== undefined) safePatch.endTime = patch.endTime
  if (patch.status !== undefined) safePatch.status = patch.status
  if (patch.notes !== undefined) safePatch.notes = patch.notes

  if (Object.keys(safePatch).length === 0) return

  // Pour HOME : propage `matchTypeId` / `opponentName` (+ teamId si touché)
  // sur le booking lié via writeBatch atomique.
  if (current.kind === 'home' && current.bookingId !== null) {
    const bookingRef = doc(db, BOOKINGS, current.bookingId)
    const bookingUpdate: UpdateData<DocumentData> = {}
    if (safePatch.matchTypeId !== undefined) {
      bookingUpdate.matchTypeId = safePatch.matchTypeId
    }
    if (safePatch.opponentName !== undefined) {
      bookingUpdate.opponentName = safePatch.opponentName
    }
    if (safePatch.teamId !== undefined) {
      bookingUpdate.teamId = safePatch.teamId
    }

    if (Object.keys(bookingUpdate).length > 0) {
      const batch = writeBatch(db)
      batch.update(matchRef, safePatch as UpdateData<DocumentData>)
      batch.update(bookingRef, bookingUpdate)
      await batch.commit()
      return
    }
  }

  await updateDoc(matchRef, safePatch as UpdateData<DocumentData>)
}

/**
 * Supprime un match.
 *  - HOME : `writeBatch` qui delete `/matches/{matchId}` ET clear
 *    `matchId`/`matchTypeId`/`opponentName` sur le booking lié. Le booking
 *    redevient pending — l'admin peut le réutiliser pour un autre match ou
 *    le supprimer manuellement via `/bookings`.
 *  - AWAY : simple `deleteDoc` du match — pas de booking à toucher.
 *
 * Pas de log côté booking (l'actionLog du booking gardera trace du
 * `match_assign` précédent ; pas critique en MVP).
 */
export async function deleteMatch(matchId: string): Promise<void> {
  const matchRef = doc(db, MATCHES, matchId)
  const matchSnap = await getDoc(matchRef)
  if (!matchSnap.exists()) {
    throw new Error(`match ${matchId} not found`)
  }
  const match = mapMatchData(matchSnap.id, matchSnap.data() as MatchData)

  if (match.kind === 'home' && match.bookingId !== null) {
    const bookingRef = doc(db, BOOKINGS, match.bookingId)
    const batch = writeBatch(db)
    batch.delete(matchRef)
    batch.update(bookingRef, {
      matchId: null,
      matchTypeId: null,
      opponentName: null,
    })
    await batch.commit()
    return
  }

  await deleteDoc(matchRef)
}

// ---------------------------------------------------------------------------
// Re-exports types — pour que les consumers n'importent que ce module.
// ---------------------------------------------------------------------------

export type { Match, MatchData, MatchKind, MatchStatus } from '@club-app/shared-types'
