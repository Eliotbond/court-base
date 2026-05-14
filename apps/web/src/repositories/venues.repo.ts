import {
  addDoc,
  arrayUnion,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  GeoPoint as FirestoreGeoPoint,
  orderBy,
  query,
  Timestamp as FirestoreTimestamp,
  updateDoc,
  type DocumentData,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
  type UpdateData,
} from 'firebase/firestore'
import { db } from '@/services/firebase'
import type { Court, CourtData, CourtSize, GeoPoint, Venue, VenueCustomClosure, VenueData } from '@club-app/shared-types'

/**
 * Repository Venues — Firestore-backed.
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase
 * (cf. docs/frontend-desktop.md — architecture en couches). Les writes
 * passent par `/venues/{venueId}` et `/venues/{venueId}/courts/{courtId}`
 * (rules : isAdmin || isRootAdmin).
 *
 * Collections gérées :
 *  - `/venues/{venueId}` : lieu physique (salle, gymnase…) avec coordonnées
 *    et fermetures ponctuelles.
 *  - `/venues/{venueId}/courts/{courtId}` : court individuel au sein du venue.
 *
 * Hors scope : `/venues/{venueId}/courts/{courtId}/timeSlots` — gérés par
 * l'écran Seasons.
 *
 * Conversion de types :
 *  - `GeoPoint` Firestore → objet neutre `{ latitude, longitude }` à la lecture.
 *  - `Timestamp` Firestore ↔ `Date` à la frontière du repo (Timestamp.fromDate()
 *    à l'écriture, objet neutre `{ seconds, nanoseconds }` à la lecture).
 */

const VENUES = 'venues'
const COURTS = 'courts'

// ---------------------------------------------------------------------------
// Types exposés pour les vues Venues / Courts
// ---------------------------------------------------------------------------

/**
 * Ligne enrichie pour la liste Venues. Étend `Venue` (schéma `/venues/{venueId}`)
 * avec les compteurs de courts calculés via `listAllCourts()` (pas de N+1).
 */
export interface VenueRow extends Venue {
  /** Nombre total de courts rattachés au venue (actifs + inactifs). */
  courtCount: number
  /** Nombre de courts dont `active === true`. */
  activeCourtCount: number
}

// ---------------------------------------------------------------------------
// Interfaces d'input — Writes
// ---------------------------------------------------------------------------

/** Payload de création d'un venue. Les coordonnées sont séparées en lat/lng
 *  pour éviter d'exposer `FirestoreGeoPoint` hors du repo. */
export interface CreateVenueInput {
  name: string
  address: string
  latitude: number
  longitude: number
}

/** Patch partiel pour la mise à jour d'un venue. */
export interface UpdateVenueInput {
  name?: string
  address?: string
  latitude?: number
  longitude?: number
}

/** Payload de création d'un court au sein d'un venue. */
export interface CreateCourtInput {
  name: string
  courtSize: CourtSize
  isCombined: boolean
  combinedCourtIds: string[]
  sport: string
}

/** Patch partiel pour la mise à jour d'un court. */
export interface UpdateCourtInput {
  name?: string
  courtSize?: CourtSize
  isCombined?: boolean
  combinedCourtIds?: string[]
  sport?: string
  active?: boolean
}

/** Fermeture ponctuelle propre au venue. Input utilise `Date` ; le repo
 *  convertit vers `Timestamp` Firestore à l'écriture. */
export interface CustomClosureInput {
  name: string
  startDate: Date
  endDate: Date
}

// ---------------------------------------------------------------------------
// Snapshot helpers privés
// ---------------------------------------------------------------------------

/**
 * Convertit un `DocumentSnapshot` Firestore en `Venue` neutre.
 * Le `GeoPoint` Firestore est aplati en `{ latitude, longitude }`.
 * Les `Timestamp` Firestore des `customClosures` sont conservés tels quels
 * (type neutre `{ seconds, nanoseconds }` — compatible avec `Timestamp` shared-types).
 */
function snapToVenue(snap: QueryDocumentSnapshot | DocumentSnapshot): Venue {
  const data = snap.data() as VenueData & {
    coordinates: { latitude: number; longitude: number }
  }
  // GeoPoint Firestore expose `.latitude` / `.longitude` nativement.
  const coordinates: GeoPoint = {
    latitude: data.coordinates?.latitude ?? 0,
    longitude: data.coordinates?.longitude ?? 0,
  }
  return {
    id: snap.id,
    name: data.name,
    address: data.address,
    coordinates,
    closurePeriodIds: data.closurePeriodIds ?? [],
    customClosures: (data.customClosures ?? []) as VenueCustomClosure[],
  }
}

/**
 * Convertit un `DocumentSnapshot` Firestore en `Court` neutre.
 */
function snapToCourt(snap: QueryDocumentSnapshot | DocumentSnapshot): Court {
  const data = snap.data() as CourtData
  return {
    id: snap.id,
    name: data.name,
    courtSize: data.courtSize,
    isCombined: data.isCombined ?? false,
    combinedCourtIds: data.combinedCourtIds ?? [],
    sport: data.sport,
    active: data.active ?? true,
  }
}

// ---------------------------------------------------------------------------
// Courts helpers internes
// ---------------------------------------------------------------------------

/**
 * Lit tous les courts de tous les venues via `collectionGroup('courts')`.
 * 1 seule lecture Firestore — utilisée par `listVenues()` pour éviter le N+1.
 * Retourne une `Map<venueId, Court[]>`.
 *
 * Si le parent d'un snapshot est null (incohérence Firestore), le court est
 * ignoré défensivement.
 */
export async function listAllCourts(): Promise<Map<string, Court[]>> {
  const snap = await getDocs(collectionGroup(db, COURTS))
  const map = new Map<string, Court[]>()
  for (const d of snap.docs) {
    // La path d'un doc de sous-collection est : venues/{venueId}/courts/{courtId}
    // `d.ref.parent` = CollectionRef(courts), `.parent` = DocumentRef(venue)
    const venueRef = d.ref.parent.parent
    if (venueRef === null) {
      // Cas pathologique : court sans venue parent — on skip défensivement.
      continue
    }
    const venueId = venueRef.id
    const court = snapToCourt(d)
    const existing = map.get(venueId)
    if (existing) {
      existing.push(court)
    } else {
      map.set(venueId, [court])
    }
  }
  return map
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Liste tous les venues du club triés par nom.
 * Enrichit chaque venue avec `courtCount` et `activeCourtCount` via un seul
 * `collectionGroup('courts')` — pas de N+1.
 */
export async function listVenues(): Promise<VenueRow[]> {
  const [venueSnap, allCourtsMap] = await Promise.all([
    getDocs(query(collection(db, VENUES), orderBy('name'))),
    listAllCourts(),
  ])
  if (venueSnap.empty) return []
  return venueSnap.docs.map((d) => {
    const venue = snapToVenue(d)
    const courts = allCourtsMap.get(d.id) ?? []
    return {
      ...venue,
      courtCount: courts.length,
      activeCourtCount: courts.filter((c) => c.active).length,
    }
  })
}

/**
 * Récupère un venue par son id avec les compteurs de courts.
 * Retourne `null` si le doc n'existe pas.
 */
export async function getVenueById(id: string): Promise<VenueRow | null> {
  const [venueSnap, courtsSnap] = await Promise.all([
    getDoc(doc(db, VENUES, id)),
    getDocs(collection(db, VENUES, id, COURTS)),
  ])
  if (!venueSnap.exists()) return null
  const venue = snapToVenue(venueSnap)
  const courts = courtsSnap.docs.map(snapToCourt)
  return {
    ...venue,
    courtCount: courts.length,
    activeCourtCount: courts.filter((c) => c.active).length,
  }
}

// ---------------------------------------------------------------------------
// Writes — Venues
// ---------------------------------------------------------------------------

/**
 * Crée un nouveau venue. `closurePeriodIds` et `customClosures` sont initialisés
 * vides. Les coordonnées sont stockées comme `GeoPoint` Firestore natif.
 *
 * Pas de `createdAt` : non présent dans le schéma `/venues/{venueId}`.
 */
export async function createVenue(input: CreateVenueInput): Promise<VenueRow> {
  const ref = await addDoc(collection(db, VENUES), {
    name: input.name,
    address: input.address,
    coordinates: new FirestoreGeoPoint(input.latitude, input.longitude),
    closurePeriodIds: [],
    customClosures: [],
  })
  const created = await getVenueById(ref.id)
  if (!created) {
    throw new Error(`Failed to read venue ${ref.id} just after creation`)
  }
  return created
}

/**
 * Met à jour un venue avec un patch partiel.
 *
 * Si `latitude` ou `longitude` est fourni, la valeur actuelle du GeoPoint est
 * relue depuis Firestore afin de reconstruire le point complet (Firestore ne
 * supporte pas les partial updates sur GeoPoint).
 *
 * Retourne `null` si le venue n'existe pas.
 */
export async function updateVenue(
  id: string,
  patch: UpdateVenueInput,
): Promise<VenueRow | null> {
  const update: UpdateData<DocumentData> = {}
  if (patch.name !== undefined) update.name = patch.name
  if (patch.address !== undefined) update.address = patch.address

  if (patch.latitude !== undefined || patch.longitude !== undefined) {
    // Relire le doc courant pour obtenir les valeurs manquantes du GeoPoint.
    const current = await getDoc(doc(db, VENUES, id))
    if (!current.exists()) return null
    const currentData = current.data() as VenueData & {
      coordinates: { latitude: number; longitude: number }
    }
    const lat = patch.latitude ?? currentData.coordinates?.latitude ?? 0
    const lng = patch.longitude ?? currentData.coordinates?.longitude ?? 0
    update.coordinates = new FirestoreGeoPoint(lat, lng)
  }

  if (Object.keys(update).length === 0) return getVenueById(id)
  await updateDoc(doc(db, VENUES, id), update)
  return getVenueById(id)
}

/**
 * Supprime le document `/venues/{venueId}`.
 *
 * ATTENTION : les sous-collections `/courts` (et éventuellement `/timeSlots`)
 * ne sont PAS supprimées — elles deviennent orphelines. Pour un nettoyage
 * complet, une Cloud Function trigger `onDocumentDeleted` devrait cascader
 * la suppression. MVP : on accepte ce comportement.
 */
export async function deleteVenue(id: string): Promise<void> {
  await deleteDoc(doc(db, VENUES, id))
}

// ---------------------------------------------------------------------------
// Reads — Courts
// ---------------------------------------------------------------------------

/** Liste tous les courts d'un venue, sans tri imposé. */
export async function listCourts(venueId: string): Promise<Court[]> {
  const snap = await getDocs(collection(db, VENUES, venueId, COURTS))
  return snap.docs.map(snapToCourt)
}

/** Récupère un court par son id. Retourne `null` si le doc n'existe pas. */
export async function getCourtById(
  venueId: string,
  courtId: string,
): Promise<Court | null> {
  const snap = await getDoc(doc(db, VENUES, venueId, COURTS, courtId))
  if (!snap.exists()) return null
  return snapToCourt(snap)
}

// ---------------------------------------------------------------------------
// Writes — Courts
// ---------------------------------------------------------------------------

/**
 * Crée un nouveau court au sein d'un venue. `active` est `true` par défaut.
 */
export async function createCourt(
  venueId: string,
  input: CreateCourtInput,
): Promise<Court> {
  const ref = await addDoc(collection(db, VENUES, venueId, COURTS), {
    name: input.name,
    courtSize: input.courtSize,
    isCombined: input.isCombined,
    combinedCourtIds: input.combinedCourtIds,
    sport: input.sport,
    active: true,
  })
  const created = await getCourtById(venueId, ref.id)
  if (!created) {
    throw new Error(`Failed to read court ${ref.id} just after creation`)
  }
  return created
}

/**
 * Met à jour un court avec un patch partiel.
 * Retourne `null` si le court n'existe pas.
 */
export async function updateCourt(
  venueId: string,
  courtId: string,
  patch: UpdateCourtInput,
): Promise<Court | null> {
  const update: UpdateData<DocumentData> = {}
  if (patch.name !== undefined) update.name = patch.name
  if (patch.courtSize !== undefined) update.courtSize = patch.courtSize
  if (patch.isCombined !== undefined) update.isCombined = patch.isCombined
  if (patch.combinedCourtIds !== undefined) update.combinedCourtIds = patch.combinedCourtIds
  if (patch.sport !== undefined) update.sport = patch.sport
  if (patch.active !== undefined) update.active = patch.active

  if (Object.keys(update).length === 0) return getCourtById(venueId, courtId)
  await updateDoc(doc(db, VENUES, venueId, COURTS, courtId), update)
  return getCourtById(venueId, courtId)
}

/** Supprime un court. N'affecte pas les sous-collections ni les bookings liés. */
export async function deleteCourt(venueId: string, courtId: string): Promise<void> {
  await deleteDoc(doc(db, VENUES, venueId, COURTS, courtId))
}

/**
 * Bascule le flag `active` d'un court (archive / réactive).
 * Retourne `null` si le court n'existe pas.
 */
export async function setCourtActive(
  venueId: string,
  courtId: string,
  active: boolean,
): Promise<Court | null> {
  await updateDoc(doc(db, VENUES, venueId, COURTS, courtId), { active })
  return getCourtById(venueId, courtId)
}

// ---------------------------------------------------------------------------
// Writes — Custom closures
// ---------------------------------------------------------------------------

/**
 * Ajoute une fermeture ponctuelle au venue via `arrayUnion`.
 * Les `Date` sont converties en `Timestamp` Firestore à l'écriture.
 *
 * NOTE : `arrayUnion` ne déduplique pas les objets identiques (comparaison
 * par valeur stricte côté Firestore). L'admin est responsable d'éviter les
 * doublons — comportement documenté et accepté pour le MVP.
 *
 * Retourne `null` si le venue n'existe pas.
 */
export async function addCustomClosure(
  venueId: string,
  closure: CustomClosureInput,
): Promise<VenueRow | null> {
  const ref = doc(db, VENUES, venueId)
  const current = await getDoc(ref)
  if (!current.exists()) return null
  await updateDoc(ref, {
    customClosures: arrayUnion({
      name: closure.name,
      startDate: FirestoreTimestamp.fromDate(closure.startDate),
      endDate: FirestoreTimestamp.fromDate(closure.endDate),
    }),
  })
  return getVenueById(venueId)
}

/**
 * Retire la fermeture ponctuelle à l'index donné.
 *
 * Firestore ne supporte pas de `removeAt(index)` — on relit le tableau,
 * on retire l'élément, puis on réécrit l'array complet.
 *
 * Retourne `null` si le venue n'existe pas ou si l'index est hors bornes.
 */
export async function removeCustomClosure(
  venueId: string,
  index: number,
): Promise<VenueRow | null> {
  const ref = doc(db, VENUES, venueId)
  const current = await getDoc(ref)
  if (!current.exists()) return null
  const data = current.data() as VenueData
  const closures = data.customClosures ?? []
  if (index < 0 || index >= closures.length) return null
  const updated = [...closures.slice(0, index), ...closures.slice(index + 1)]
  await updateDoc(ref, { customClosures: updated })
  return getVenueById(venueId)
}
