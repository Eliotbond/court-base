/**
 * Repository Bookings — Firestore-backed (courtbase-app, coach mobile).
 *
 * SEULE couche autorisée à importer le SDK Firebase pour les bookings (cf.
 * architecture en couches CLAUDE.md racine). Le repo couvre :
 *   - **Lecture** : tous les bookings d'une saison (optionnellement filtrés
 *     par `teamIds` côté JS quand > 10, sinon `where in`).
 *   - **Lecture annexes** : venues + courts actifs (join via collectionGroup
 *     `courts`), teams lite (pour denorm `teamName`).
 *   - **Mutation** : annulation d'un entraînement par le coach (`cancel_training`).
 *     Write client direct autorisé par les rules `/bookings` lignes 333-342 :
 *     `coach update affectedKeys.hasOnly([status, cancelReason, actionLog])`.
 *
 * Volontairement read-only + cancel-only (pas de create/series/edit) : la
 * coach app n'est pas un outil admin. Pour créer / éditer en bulk, passer
 * par `apps/web` (`/bookings`).
 *
 * Cf. `docs/firebase.md` § `/bookings`, `firestore.rules` lignes 333-372.
 */

import {
  Timestamp,
  arrayUnion,
  collection,
  collectionGroup,
  doc,
  documentId,
  getDocs,
  query,
  updateDoc,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { FirebaseError } from 'firebase/app'

import { db } from '@/services/firebase'

// ─── Constantes Firestore ────────────────────────────────────────────

const BOOKINGS = 'bookings'
const VENUES = 'venues'
const COURTS = 'courts'
const TEAMS = 'teams'
const CATEGORIES = 'categories'

/** Limite de la clause `in` Firestore. */
const IN_CHUNK = 10

// ─── Types publics ───────────────────────────────────────────────────

export type BookingStatus = 'scheduled' | 'cancelled' | 'freed'
export type BookingSlotType =
  | 'training'
  | 'match_home'
  | 'match_away'
  | 'reserve'
  | 'custom'
export type BookingCancelReason =
  | 'closure'
  | 'holiday'
  | 'manual'
  | 'series_edit'
  | 'match_home'
  | 'match_away'
  | 'coach_cancel'

/**
 * Row plate consommée par les vues coach. Tous les champs joints (venueName,
 * courtName, teamName) sont déjà résolus — pas besoin d'un autre store pour
 * afficher la carte. `startMs` / `endMs` sont en epoch ms local pour tri /
 * filtrage rapide sans recréer un `Date` à chaque comparaison.
 */
export interface BookingRow {
  id: string
  seasonId: string
  venueId: string
  venueName: string | null
  courtId: string
  courtName: string | null
  teamId: string | null
  teamName: string | null
  /** Libellé staff coach dénormalisé depuis la team (cf. `TeamLite.coachLabel`). */
  coachLabel: string | null
  slotType: BookingSlotType
  matchTypeId: string | null
  opponentName: string | null
  /** ISO `yyyy-mm-dd` local. */
  date: string
  /** epoch ms du début local — pratique pour tri/comparaison. */
  startMs: number
  /** epoch ms de fin local. */
  endMs: number
  startTime: string // "HH:MM"
  endTime: string // "HH:MM"
  status: BookingStatus
  cancelReason: BookingCancelReason | null
  seriesId: string | null
  isCombinedCourtEvent: boolean
}

export interface VenueWithCourtsLite {
  id: string
  name: string
  courts: Array<{ id: string; name: string; venueId: string }>
}

export interface TeamLite {
  id: string
  name: string
  categoryName: string | null
  /**
   * Libellé court du staff coach pour l'affichage en row/event. Format :
   *  - 1 coach   → "Mathieu Brun"
   *  - 2 coachs  → "Mathieu B., Pierre D."
   *  - 3+ coachs → "Mathieu B. +2"
   *  - aucun     → null
   * Dénormalisé via lookup `/members` au moment du fetch des teams.
   */
  coachLabel: string | null
}

// ─── Helpers — privés au repo ────────────────────────────────────────

/**
 * Le SDK Firestore expose `Timestamp.seconds`. On évite `toDate()` qui
 * recrée un `Date` côté serveur — on construit nous-même un `Date` local
 * pour pouvoir formatter `yyyy-mm-dd` sans timezone surprise.
 */
function tsToDate(ts: Timestamp): Date {
  return new Date(ts.seconds * 1000)
}

/** `yyyy-mm-dd` local (pas UTC). */
function tsToLocalIsoDate(ts: Timestamp): string {
  const d = tsToDate(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Combine la date stockée (Timestamp aligné 00:00 local côté écriture) et
 * une string "HH:MM" pour produire un epoch ms local. Permet à l'UI de
 * comparer / trier sans recréer un `Date` à chaque render.
 *
 * Robuste à un "HH:MM" malformé (fallback 00:00).
 */
function tsAndTimeToMs(ts: Timestamp, hhmm: string): number {
  const d = tsToDate(ts)
  const parts = hhmm.split(':')
  const hh = Number(parts[0] ?? '0')
  const mm = Number(parts[1] ?? '0')
  d.setHours(Number.isFinite(hh) ? hh : 0, Number.isFinite(mm) ? mm : 0, 0, 0)
  return d.getTime()
}

/**
 * Vérifie un code Firestore sans utiliser `instanceof FirestoreError` (non
 * fiable côté bundling Vite — cf. mémoire `firebase-error-instanceof-unreliable`
 * et CLAUDE.md règle 13).
 */
function isPermissionDenied(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'permission-denied'
  )
}

/**
 * Forme défensive du doc Firestore. Tout champ nullable est explicitement
 * normalisé : un doc legacy sans `cancelReason`/`opponentName` retombe sur
 * `null` propre côté UI.
 */
interface BookingFirestoreDoc {
  seasonId?: string
  venueId?: string
  courtId?: string
  teamId?: string | null
  slotType?: BookingSlotType
  matchTypeId?: string | null
  opponentName?: string | null
  date?: Timestamp
  startTime?: string
  endTime?: string
  status?: BookingStatus
  cancelReason?: BookingCancelReason | null
  seriesId?: string | null
  isCombinedCourtEvent?: boolean
}

function snapToBookingRow(
  snap: QueryDocumentSnapshot<DocumentData>,
  venueNames: Map<string, string>,
  courtNames: Map<string, string>,
  teamNames: Map<string, string>,
  coachLabels: Map<string, string>,
): BookingRow {
  const data = snap.data() as BookingFirestoreDoc
  const venueId = data.venueId ?? ''
  const courtId = data.courtId ?? ''
  const teamId = data.teamId ?? null
  const date = data.date
  const startTime = data.startTime ?? '00:00'
  const endTime = data.endTime ?? '00:00'

  return {
    id: snap.id,
    seasonId: data.seasonId ?? '',
    venueId,
    venueName: venueId ? (venueNames.get(venueId) ?? null) : null,
    courtId,
    courtName: courtId ? (courtNames.get(`${venueId}/${courtId}`) ?? null) : null,
    teamId,
    teamName: teamId ? (teamNames.get(teamId) ?? null) : null,
    coachLabel: teamId ? (coachLabels.get(teamId) ?? null) : null,
    slotType: data.slotType ?? 'custom',
    matchTypeId: data.matchTypeId ?? null,
    opponentName: data.opponentName ?? null,
    date: date ? tsToLocalIsoDate(date) : '',
    startMs: date ? tsAndTimeToMs(date, startTime) : 0,
    endMs: date ? tsAndTimeToMs(date, endTime) : 0,
    startTime,
    endTime,
    status: data.status ?? 'scheduled',
    cancelReason: data.cancelReason ?? null,
    seriesId: data.seriesId ?? null,
    isCombinedCourtEvent: data.isCombinedCourtEvent ?? false,
  }
}

function chunked<T>(arr: ReadonlyArray<T>, size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}

// ─── Joins léger pour la dénorm ─────────────────────────────────────

interface VenueDoc {
  name?: string
}

interface CourtDoc {
  name?: string
  active?: boolean
}

interface TeamDoc {
  name?: string
  categoryId?: string
  /** memberIds des coachs. Sert à dénormaliser `coachLabel` côté UI. */
  coachIds?: string[]
}

interface CategoryDoc {
  name?: string
}

/**
 * Charge venues + courts actifs en un seul aller-retour combiné.
 *
 * Stratégie :
 *  - 1 query `getDocs('/venues')` (référentiel, < 30 docs typiquement).
 *  - 1 query `collectionGroup('courts')` pour récupérer tous les courts en
 *    un seul fetch — bien plus rapide qu'un fetch par venue (N+1).
 *
 * Filtre les courts `active === false` côté JS (le doc legacy peut ne pas
 * porter `active` → on garde par défaut). Retourne les venues triées par
 * nom + leurs courts triés par nom (locale FR).
 */
export async function listVenuesWithCourtsLite(): Promise<VenueWithCourtsLite[]> {
  try {
    const [venuesSnap, courtsSnap] = await Promise.all([
      getDocs(collection(db, VENUES)),
      getDocs(collectionGroup(db, COURTS)),
    ])
    if (venuesSnap.empty) return []

    // Build venueId → courts[]
    const courtsByVenue = new Map<string, Array<{ id: string; name: string; venueId: string }>>()
    for (const d of courtsSnap.docs) {
      const parent = d.ref.parent.parent
      if (!parent) continue
      const data = d.data() as CourtDoc
      if (data.active === false) continue
      const venueId = parent.id
      const court = { id: d.id, name: data.name ?? '', venueId }
      const existing = courtsByVenue.get(venueId)
      if (existing) existing.push(court)
      else courtsByVenue.set(venueId, [court])
    }

    const out: VenueWithCourtsLite[] = venuesSnap.docs.map((vd) => {
      const data = vd.data() as VenueDoc
      const courts = (courtsByVenue.get(vd.id) ?? [])
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      return { id: vd.id, name: data.name ?? '', courts }
    })
    out.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    return out
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[bookings.repo] listVenuesWithCourtsLite failed [${code}]`, err)
    return []
  }
}

/**
 * Charge la liste des équipes par ids, chunké par 10 (limite Firestore `in`).
 * Joint le `categoryName` via lookup `/categories` (référentiel < 30 docs)
 * et le `coachLabel` via fetch bulk `/members` pour tous les coachIds
 * agrégés (un seul `listMembersByIds`, chunké aussi par 10 côté repo membre).
 *
 * Retourne `[]` si :
 *  - liste vide.
 *  - erreur Firestore (loguée, pas thrown — l'UI dégrade en `teamName: null`).
 */
export async function listTeamsLite(teamIds: readonly string[]): Promise<TeamLite[]> {
  if (teamIds.length === 0) return []
  const unique = Array.from(new Set(teamIds.filter((id) => Boolean(id))))
  if (unique.length === 0) return []
  try {
    const [categoriesSnap, ...chunks] = await Promise.all([
      getDocs(collection(db, CATEGORIES)),
      ...chunked(unique, IN_CHUNK).map((c) =>
        getDocs(query(collection(db, TEAMS), where(documentId(), 'in', c))),
      ),
    ])

    const categoryNames = new Map<string, string>()
    for (const d of categoriesSnap.docs) {
      const data = d.data() as CategoryDoc
      categoryNames.set(d.id, data.name ?? '')
    }

    // Stockage intermédiaire : team → { name, categoryName, coachIds }.
    interface TeamRaw {
      id: string
      name: string
      categoryName: string | null
      coachIds: string[]
    }
    const rawTeams: TeamRaw[] = []
    const allCoachIds = new Set<string>()
    for (const snap of chunks) {
      for (const d of snap.docs) {
        const data = d.data() as TeamDoc
        const coachIds = Array.isArray(data.coachIds) ? data.coachIds.filter((id) => typeof id === 'string' && id.length > 0) : []
        for (const cid of coachIds) allCoachIds.add(cid)
        rawTeams.push({
          id: d.id,
          name: data.name ?? '',
          categoryName: data.categoryId ? (categoryNames.get(data.categoryId) ?? null) : null,
          coachIds,
        })
      }
    }

    // Fetch bulk des coachs (un seul appel, chunké côté members.repo).
    const coachNameById = new Map<string, { firstName: string; lastName: string }>()
    if (allCoachIds.size > 0) {
      const { listMembersByIds } = await import('@/repositories/members.repo')
      const coachMembers = await listMembersByIds(Array.from(allCoachIds))
      for (const m of coachMembers) {
        coachNameById.set(m.id, { firstName: m.firstName, lastName: m.lastName })
      }
    }

    return rawTeams.map((rt) => ({
      id: rt.id,
      name: rt.name,
      categoryName: rt.categoryName,
      coachLabel: buildCoachLabel(rt.coachIds, coachNameById),
    }))
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[bookings.repo] listTeamsLite failed [${code}]`, err)
    return []
  }
}

/**
 * Construit un libellé compact du staff coach. Skip silencieusement les
 * coachIds dont le member n'a pas pu être résolu (suppression / privacy).
 */
function buildCoachLabel(
  coachIds: ReadonlyArray<string>,
  nameById: ReadonlyMap<string, { firstName: string; lastName: string }>,
): string | null {
  const resolved = coachIds
    .map((id) => nameById.get(id))
    .filter((n): n is { firstName: string; lastName: string } => Boolean(n))
  if (resolved.length === 0) return null
  if (resolved.length === 1) {
    const n = resolved[0]!
    return `${n.firstName} ${n.lastName}`.trim()
  }
  if (resolved.length === 2) {
    const a = resolved[0]!
    const b = resolved[1]!
    return `${a.firstName} ${a.lastName.charAt(0)}., ${b.firstName} ${b.lastName.charAt(0)}.`
  }
  const a = resolved[0]!
  return `${a.firstName} ${a.lastName.charAt(0)}. +${resolved.length - 1}`
}

// ─── Lecture principale ──────────────────────────────────────────────

export interface ListBookingsOptions {
  /**
   * Si fourni, filtre par teamId côté JS (le `where in` Firestore est limité
   * à 10 valeurs ; on évite la complexité chunkée ici car la volumétrie
   * attendue par saison est faible — quelques centaines de docs au max).
   *
   * Si non fourni, retourne tous les bookings de la saison.
   */
  teamIds?: readonly string[]
}

/**
 * Charge tous les bookings d'une saison. Source unique du store (cf. mémoire
 * `project_bookings_source_unique`) : un seul fetch hydrate à la fois la vue
 * calendrier, la vue "créneaux libres" et la liste "toutes les réservations".
 *
 * Stratégie :
 *  - 1 query `where seasonId == seasonId` (pas d'orderBy — tri JS).
 *  - Joins venues + courts + teams en parallèle (3 queries max).
 *  - Filtre `teamIds` côté JS si fourni (évite chunking + index composite).
 *
 * Retourne `[]` :
 *  - si `seasonId` vide.
 *  - si erreur Firestore (loguée).
 */
export async function listBookingsForSeason(
  seasonId: string,
  opts?: ListBookingsOptions,
): Promise<BookingRow[]> {
  if (!seasonId) return []
  try {
    const snap = await getDocs(
      query(collection(db, BOOKINGS), where('seasonId', '==', seasonId)),
    )
    if (snap.empty) return []

    // Filtre teamIds JS-side. Set pour lookup O(1) sur la grosse liste.
    const teamFilter = opts?.teamIds ? new Set(opts.teamIds.filter((id) => Boolean(id))) : null
    const filteredDocs = teamFilter
      ? snap.docs.filter((d) => {
          const t = (d.data() as BookingFirestoreDoc).teamId
          return t !== null && t !== undefined && teamFilter.has(t)
        })
      : snap.docs

    if (filteredDocs.length === 0) return []

    // Collecte des ids pour les joins en un seul fetch.
    const venueIds = new Set<string>()
    const courtPairs = new Map<string, { venueId: string; courtId: string }>()
    const teamIds = new Set<string>()
    for (const d of filteredDocs) {
      const data = d.data() as BookingFirestoreDoc
      if (data.venueId) venueIds.add(data.venueId)
      if (data.venueId && data.courtId) {
        const key = `${data.venueId}/${data.courtId}`
        if (!courtPairs.has(key)) {
          courtPairs.set(key, { venueId: data.venueId, courtId: data.courtId })
        }
      }
      if (data.teamId) teamIds.add(data.teamId)
    }

    // Pour les joins on réutilise `listVenuesWithCourtsLite` (référentiel) +
    // `listTeamsLite` chunké. Volontairement pas de fetch ciblé par doc :
    // les référentiels sont petits et déjà efficaces en bulk.
    const [venuesWithCourts, teams] = await Promise.all([
      listVenuesWithCourtsLite(),
      listTeamsLite(Array.from(teamIds)),
    ])
    const venueNames = new Map<string, string>()
    const courtNames = new Map<string, string>()
    for (const v of venuesWithCourts) {
      venueNames.set(v.id, v.name)
      for (const c of v.courts) {
        courtNames.set(`${v.id}/${c.id}`, c.name)
      }
    }
    const teamNames = new Map<string, string>()
    const coachLabels = new Map<string, string>()
    for (const t of teams) {
      teamNames.set(t.id, t.name)
      if (t.coachLabel) coachLabels.set(t.id, t.coachLabel)
    }

    const rows = filteredDocs.map((d) => snapToBookingRow(d, venueNames, courtNames, teamNames, coachLabels))
    // Tri stable par startMs ASC — utilisé par toutes les vues consommatrices.
    rows.sort((a, b) => a.startMs - b.startMs)
    return rows
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[bookings.repo] listBookingsForSeason failed [${code}]`, err)
    return []
  }
}

// ─── Mutation : annulation coach ─────────────────────────────────────

export interface CancelTrainingBookingInput {
  bookingId: string
  callerUid: string
  note?: string | null
}

export interface CancelTrainingBookingResult {
  ok: true
  status: 'freed'
}

/**
 * Annule un entraînement → passe `status` de `scheduled` à `freed` (le
 * créneau redevient libre pour la salle, sans suppression du doc).
 *
 * Écriture côté client direct — autorisée par `firestore.rules` lignes
 * 339-342 :
 *   `update if isCoachOfTeam(resource.data.teamId)
 *      && affectedKeys().hasOnly(['status', 'cancelReason', 'actionLog'])`
 *
 * **Whitelist stricte** : on ne touche QUE ces 3 champs. `arrayUnion` évite
 * un read-modify-write (immunise des races coach → coach).
 *
 * Erreurs :
 *  - `permission-denied` → throw avec message FR clair (coach non lié à la
 *    team du booking ou booking non trouvé).
 *  - autres erreurs Firebase → throw avec code dans le message.
 */
export async function cancelTrainingBooking(
  input: CancelTrainingBookingInput,
): Promise<CancelTrainingBookingResult> {
  if (!input.bookingId) throw new Error('cancelTrainingBooking: bookingId required')
  if (!input.callerUid) throw new Error('cancelTrainingBooking: callerUid required')

  try {
    await updateDoc(doc(db, BOOKINGS, input.bookingId), {
      status: 'freed' as BookingStatus,
      cancelReason: 'coach_cancel' as BookingCancelReason,
      actionLog: arrayUnion({
        at: Timestamp.now(),
        by: input.callerUid,
        action: 'coach_cancel',
        note: input.note ?? null,
      }),
    })
    return { ok: true, status: 'freed' }
  } catch (err) {
    if (isPermissionDenied(err)) {
      console.error('[bookings.repo] cancelTrainingBooking permission-denied', err)
      throw new Error(
        'Annulation refusée : vous devez être coach de cette équipe pour libérer ce créneau.',
      )
    }
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[bookings.repo] cancelTrainingBooking failed [${code}]`, err)
    throw new Error(`Erreur lors de l'annulation (${code}).`)
  }
}
