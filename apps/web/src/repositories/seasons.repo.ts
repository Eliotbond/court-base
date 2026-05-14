import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  Timestamp as FirestoreTimestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '@/services/firebase'
import type {
  Season,
  SeasonData,
  Timestamp,
  VenueData,
} from '@club-app/shared-types'

/**
 * Repository Seasons — Firestore-backed.
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase
 * (cf. docs/frontend-desktop.md — architecture en couches). Les writes
 * passent par `/seasons/{seasonId}` (rules : isAdmin || isRootAdmin).
 *
 * Voir docs/firebase.md (`/seasons/{seasonId}`) pour le schéma cible et
 * docs/main.md ("Season — draft → active → archived") pour le lifecycle.
 *
 * Champs dérivés portés sur `SeasonRow` mais qui ne vivent PAS dans le doc :
 *  - `teamsCount`  : count agrégé via `getCountFromServer` sur `/teams` filtré
 *    `activeSeasonIds array-contains id`. 1 read facturé par saison listée.
 *  - `bookingsCount` : idem sur `/bookings where seasonId == id`. 1 read.
 *  - `venueLabels` : join sur `/venues` (batched, 1 read collection à la
 *    liste — pas N+1).
 *
 * Conversion Timestamp ↔ Date à la frontière repo (Timestamp en storage).
 */

const SEASONS = 'seasons'
const TEAMS = 'teams'
const VENUES = 'venues'
const BOOKINGS = 'bookings'

// ---------------------------------------------------------------------------
// Types exposés
// ---------------------------------------------------------------------------

/**
 * Ligne enrichie pour la liste Seasons. Étend `Season` (schéma `/seasons/{id}`)
 * avec quelques champs dérivés nécessaires à l'affichage qui ne sont PAS
 * portés par le doc.
 *
 * Ne pas ajouter ces champs à `packages/shared-types/src/season.ts` — ce sont
 * des résultats de joins / aggregates côté repo.
 */
export interface SeasonRow extends Season {
  /** Dérivé via `/teams where activeSeasonIds array-contains id`. */
  teamsCount: number
  /** Dérivé via `/bookings where seasonId == id`. 0 en draft. */
  bookingsCount: number
  /** Libellés des venues actifs (join `/venues` sur `activeVenueIds`). */
  venueLabels: string[]
}

// ---------------------------------------------------------------------------
// Snapshot helpers privés
// ---------------------------------------------------------------------------

/**
 * Convertit un Firestore `Timestamp` (SDK class instance ou plain object) en
 * type neutre `{ seconds, nanoseconds }`. Tolère les deux formes pour rester
 * indépendant de la classe Firestore côté consumers.
 */
function tsToNeutral(value: unknown): Timestamp {
  if (value instanceof FirestoreTimestamp) {
    return { seconds: value.seconds, nanoseconds: value.nanoseconds }
  }
  // Plain object fallback (ex. doc data brute, hors classe Firestore).
  if (
    value &&
    typeof value === 'object' &&
    'seconds' in value &&
    'nanoseconds' in value
  ) {
    const v = value as { seconds: number; nanoseconds: number }
    return { seconds: v.seconds, nanoseconds: v.nanoseconds }
  }
  // Cas pathologique (champ manquant ou type inattendu) : on retombe sur 0.
  return { seconds: 0, nanoseconds: 0 }
}

/** Convertit un `Date` JS en Firestore `Timestamp`. */
function dateToTs(d: Date): FirestoreTimestamp {
  return FirestoreTimestamp.fromDate(d)
}

interface RawSeasonDoc {
  name: string
  startDate: unknown
  endDate: unknown
  status: SeasonData['status']
  activeVenueIds?: string[]
  closurePeriodIds?: string[]
  generatedAt?: unknown
}

/** Convertit un snapshot `/seasons/{id}` en `Season` neutre (sans enrichissement). */
function snapToSeason(snap: QueryDocumentSnapshot | DocumentSnapshot): Season {
  const data = snap.data() as RawSeasonDoc
  return {
    id: snap.id,
    name: data.name,
    startDate: tsToNeutral(data.startDate),
    endDate: tsToNeutral(data.endDate),
    status: data.status,
    activeVenueIds: data.activeVenueIds ?? [],
    closurePeriodIds: data.closurePeriodIds ?? [],
    generatedAt: data.generatedAt ? tsToNeutral(data.generatedAt) : null,
  }
}

// ---------------------------------------------------------------------------
// Lookups internes — venues map (1 collection read, partagé sur la liste).
// ---------------------------------------------------------------------------

/** Lit tous les venues et retourne une `Map<id, name>` pour résoudre `venueLabels`. */
async function readVenueNameMap(): Promise<Map<string, string>> {
  const snap = await getDocs(collection(db, VENUES))
  const map = new Map<string, string>()
  for (const d of snap.docs) {
    const data = d.data() as Pick<VenueData, 'name'>
    map.set(d.id, data.name)
  }
  return map
}

// ---------------------------------------------------------------------------
// Aggregates dérivés par-saison
// ---------------------------------------------------------------------------

/**
 * Compte les équipes inscrites à une saison.
 *
 * 1 read facturé via `getCountFromServer`. Le filtre `activeSeasonIds
 * array-contains seasonId` ne nécessite pas d'index composite (Firestore
 * supporte l'opérateur array-contains seul nativement).
 */
async function countTeamsForSeason(seasonId: string): Promise<number> {
  const snap = await getCountFromServer(
    query(
      collection(db, TEAMS),
      where('activeSeasonIds', 'array-contains', seasonId),
    ),
  )
  return snap.data().count
}

/**
 * Compte les bookings rattachés à une saison.
 *
 * 1 read facturé via `getCountFromServer`. L'index composite
 * `bookings (seasonId, status, date)` existe déjà mais n'est pas requis pour
 * un simple count sur `seasonId == X`.
 */
async function countBookingsForSeason(seasonId: string): Promise<number> {
  const snap = await getCountFromServer(
    query(collection(db, BOOKINGS), where('seasonId', '==', seasonId)),
  )
  return snap.data().count
}

/**
 * Enrichit un `Season` neutre en `SeasonRow` : ajoute teamsCount,
 * bookingsCount, venueLabels.
 */
async function enrichSeason(
  season: Season,
  venueMap: Map<string, string>,
): Promise<SeasonRow> {
  const [teamsCount, bookingsCount] = await Promise.all([
    countTeamsForSeason(season.id),
    countBookingsForSeason(season.id),
  ])
  const venueLabels = season.activeVenueIds
    .map((id) => venueMap.get(id))
    .filter((label): label is string => typeof label === 'string')
  return {
    ...season,
    teamsCount,
    bookingsCount,
    venueLabels,
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Liste toutes les saisons du club, triées par `startDate` desc.
 *
 * Pour chaque saison on calcule `teamsCount` et `bookingsCount` via deux
 * `getCountFromServer` (1 read facturé chacun). Soit `2 × N` reads où N est
 * le nombre de saisons (en pratique ≤ 10 saisons → ≤ 20 reads). À terme
 * (volume), dénormaliser ces counts dans le doc saison (write par triggers).
 */
export async function listSeasons(): Promise<SeasonRow[]> {
  const [seasonSnap, venueMap] = await Promise.all([
    getDocs(query(collection(db, SEASONS), orderBy('startDate', 'desc'))),
    readVenueNameMap(),
  ])
  if (seasonSnap.empty) return []
  const seasons = seasonSnap.docs.map(snapToSeason)
  return Promise.all(seasons.map((s) => enrichSeason(s, venueMap)))
}

/**
 * Récupère la saison active (au plus une), enrichie en `SeasonRow`. Renvoie
 * `null` si aucune saison n'est en statut `active`.
 *
 * Requête : `where status == 'active' limit 1`. Pas d'index composite requis.
 */
export async function getActiveSeason(): Promise<SeasonRow | null> {
  const q = query(
    collection(db, SEASONS),
    where('status', '==', 'active'),
    limit(1),
  )
  const snap = await getDocs(q)
  if (snap.empty) return null
  const season = snapToSeason(snap.docs[0]!)
  const venueMap = await readVenueNameMap()
  return enrichSeason(season, venueMap)
}

/** Récupère une saison par son id, enrichie en `SeasonRow`. */
export async function getSeasonById(seasonId: string): Promise<SeasonRow | null> {
  const snap = await getDoc(doc(db, SEASONS, seasonId))
  if (!snap.exists()) return null
  const season = snapToSeason(snap)
  const venueMap = await readVenueNameMap()
  return enrichSeason(season, venueMap)
}

// ---------------------------------------------------------------------------
// Writes — Activate / Archive / Duplicate
// ---------------------------------------------------------------------------

/**
 * Active une saison : passe `status` à `active` et pose `generatedAt`.
 *
 * Les bookings ne sont **PAS** générés automatiquement à l'activation — ils
 * sont ajoutés manuellement via le wizard de création (`/bookings`) une fois
 * la saison active. L'option "Jusqu'à la fin de la saison" du wizard
 * (`BookingFormDialog`) s'appuie justement sur la `endDate` de la saison
 * active pour ancrer la fin des séries.
 *
 * `generatedAt` reste posé à l'activation comme repère "saison ouverte aux
 * bookings depuis cette date" (utile pour l'audit / les statistiques).
 */
export async function activateSeason(seasonId: string): Promise<SeasonRow | null> {
  const ref = doc(db, SEASONS, seasonId)
  await updateDoc(ref, {
    status: 'active',
    generatedAt: FirestoreTimestamp.now(),
  })
  return getSeasonById(seasonId)
}

/** Archive une saison : `status` → `archived`. Reversible côté UI uniquement
 *  pour cas exceptionnels (pas d'undo automatique). */
export async function archiveSeason(seasonId: string): Promise<SeasonRow | null> {
  await updateDoc(doc(db, SEASONS, seasonId), { status: 'archived' })
  return getSeasonById(seasonId)
}

/**
 * Duplique une saison en `draft`. Reprend `activeVenueIds` + `closurePeriodIds`
 * et incrémente le nom d'un an (ex. "Saison 2025-26" → "Saison 2026-27").
 *
 * Ne propage PAS les équipes : `/teams.activeSeasonIds` doit être édité
 * séparément (ou via le wizard SeasonNewWizard sur la saison dupliquée).
 *
 * Les bookings ne sont jamais copiés — ils seront générés à l'activation.
 */
export async function duplicateSeason(seasonId: string): Promise<SeasonRow | null> {
  const src = await getDoc(doc(db, SEASONS, seasonId))
  if (!src.exists()) return null
  const source = snapToSeason(src)
  const nextStartYear =
    new Date(source.startDate.seconds * 1000).getFullYear() + 1
  // Garde la même longueur de saison que la source (delta seconds), ancrée
  // au 1er sept de l'année suivante.
  const newStart = new Date(nextStartYear, 8, 1, 0, 0, 0, 0)
  const newEnd = new Date(nextStartYear + 1, 5, 30, 23, 59, 0, 0)
  const ref = await addDoc(collection(db, SEASONS), {
    name: `Saison ${nextStartYear}-${(nextStartYear + 1) % 100}`,
    startDate: dateToTs(newStart),
    endDate: dateToTs(newEnd),
    status: 'draft',
    activeVenueIds: [...source.activeVenueIds],
    closurePeriodIds: [...source.closurePeriodIds],
    generatedAt: null,
  } satisfies DocumentData)
  return getSeasonById(ref.id)
}

// ---------------------------------------------------------------------------
// Create — wizard "Nouvelle saison" (B3)
// ---------------------------------------------------------------------------

export interface CreateSeasonInput {
  name: string
  startDate: Date
  endDate: Date
  /**
   * Ids d'équipes à inscrire dans la saison. Pour chacune, le repo fera un
   * `updateDoc('/teams/{id}', { activeSeasonIds: arrayUnion(seasonId) })`
   * dans un `writeBatch` atomique.
   */
  teamIds: string[]
  /** Ids de venues activés (= `activeVenueIds` du doc saison). */
  venueIds: string[]
  /**
   * Libellés des venues sélectionnés — utilisés pour la colonne Venues côté
   * UI sans nécessiter un nouveau read. Optionnel : le repo recalcule sinon.
   */
  venueLabels?: string[]
}

/**
 * Crée une nouvelle saison en `draft`.
 *
 * Séquence :
 *   1. `addDoc('/seasons')` avec `status: 'draft'`, `generatedAt: null`.
 *   2. Pour chaque `teamId`, `updateDoc('/teams/{id}', { activeSeasonIds:
 *      arrayUnion(seasonId) })` dans un `writeBatch` (atomique).
 *   3. Relit le doc enrichi pour renvoyer un `SeasonRow`.
 *
 * Le batch fait jusqu'à 500 writes par défaut (limite Firestore) — largement
 * suffisant pour des dizaines d'équipes en pratique.
 *
 * À terme : consolider en callable serveur `createSeason` pour atomicité
 * cross-collection + validation des refs venues/teams. v1 : OK côté client
 * car restreint aux admins par les rules.
 */
export async function createSeason(input: CreateSeasonInput): Promise<SeasonRow> {
  const seasonRef = await addDoc(collection(db, SEASONS), {
    name: input.name,
    startDate: dateToTs(input.startDate),
    endDate: dateToTs(input.endDate),
    status: 'draft',
    activeVenueIds: [...input.venueIds],
    closurePeriodIds: [],
    generatedAt: null,
  } satisfies DocumentData)

  if (input.teamIds.length > 0) {
    const batch = writeBatch(db)
    for (const teamId of input.teamIds) {
      batch.update(doc(db, TEAMS, teamId), {
        activeSeasonIds: arrayUnion(seasonRef.id),
      })
    }
    await batch.commit()
  }

  const created = await getSeasonById(seasonRef.id)
  if (!created) {
    throw new Error(
      `Failed to read season ${seasonRef.id} just after creation`,
    )
  }
  return created
}

