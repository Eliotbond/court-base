import { FirebaseError } from 'firebase/app'
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  type Timestamp as FirestoreTimestamp,
} from 'firebase/firestore'
import { db } from '@/services/firebase'
import type {
  ClubConfig,
  OfficialAssignment,
  OfficialAssignmentData,
  OfficialAssignmentStatus,
  OfficialsConfig,
} from '@club-app/shared-types'

/**
 * Repository OfficialAssignments — Firestore-backed.
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase
 * (cf. apps/web/CLAUDE.md — architecture en couches). Consommée par
 * `composables/useMemberOfficialAssignments.ts` puis par
 * `components/member-detail/OfficialTab.vue`.
 *
 * ## Pourquoi un repo dédié plutôt que d'étendre `officials.repo.ts`
 *
 * `officials.repo.ts` agrège des compteurs cross-officiels pour la liste
 * Officials (page `/officials`). Ici on est sur la perspective inverse :
 * **un seul officiel**, on veut toutes ses assignations enrichies (date,
 * équipe, slot). Les patterns d'accès et les jointures sont différents —
 * d'où le split.
 *
 * ## Index Firestore requis (à ajouter dans une PR séparée — NE PAS toucher
 * `firestore.indexes.json` ici, cf. consigne agent)
 *
 * ```json
 * {
 *   "collectionGroup": "officialAssignments",
 *   "queryScope": "COLLECTION_GROUP",
 *   "fields": [
 *     { "fieldPath": "memberId", "order": "ASCENDING" },
 *     { "fieldPath": "assignedAt", "order": "DESCENDING" }
 *   ]
 * }
 * ```
 *
 * Tant que cet index n'existe pas, on requête sans `orderBy` (Firestore
 * autorise un `where ==` sans index composite) et on trie côté JS. Si la
 * query renvoie `failed-precondition` (au cas où Firestore ajouterait un
 * jour une exigence d'index sur le simple `where`), on dégrade en `[]`.
 *
 * ## Dégradation gracieuse
 *
 * Sur `permission-denied` (rule rejette le caller — théoriquement impossible
 * puisque tous les signed-in lisent, mais on couvre) → `[]`. Sur
 * `failed-precondition` (index manquant) → log warn + `[]`. Toute autre
 * erreur SDK est relancée.
 */

const BOOKINGS = 'bookings'
const TEAMS = 'teams'
const CONFIG_COLL = 'config'
const CONFIG_DOC = 'club'

// ---------------------------------------------------------------------------
// Types exposés pour le tab Officiel de la page Member detail
// ---------------------------------------------------------------------------

/**
 * Ligne enrichie d'une assignation pour la vue Member detail → Officiel.
 *
 * Étend `OfficialAssignment` (schéma Firestore) avec :
 *  - `bookingId` : dérivé du parent path (sub-collection `/bookings/{id}/...`).
 *  - Snapshots du booking parent (date / slot / team / season / matchType) —
 *    chargés en un seul batch déduppé.
 *  - `teamName` : join sur `/teams` via un scan unique (pas de N+1).
 */
export interface OfficialAssignmentRow extends OfficialAssignment {
  bookingId: string
  bookingDate: Date | null
  bookingStartTime: string | null
  bookingEndTime: string | null
  teamId: string | null
  teamName: string | null
  seasonId: string | null
  matchTypeId: string | null
}

/** Défauts alignés sur docs/main.md (section Officials — rentabilité). */
export const DEFAULT_OFFICIALS_CONFIG: OfficialsConfig = {
  licenseFee: 140,
  thresholdGreen: 6,
  thresholdOrange: 3,
}

// ---------------------------------------------------------------------------
// Lecture config — `/config/club.officialsConfig`
// ---------------------------------------------------------------------------

/**
 * Lit `/config/club.officialsConfig` et retombe sur les défauts si :
 *  - le doc n'existe pas
 *  - le champ `officialsConfig` est absent
 *  - la rule rejette la lecture (`permission-denied`)
 *
 * Le merge `{...DEFAULT, ...partial}` garantit qu'un champ manquant dans
 * Firestore ne casse pas la vue.
 */
export async function getOfficialsConfig(): Promise<OfficialsConfig> {
  try {
    const snap = await getDoc(doc(db, CONFIG_COLL, CONFIG_DOC))
    if (!snap.exists()) return DEFAULT_OFFICIALS_CONFIG
    const data = snap.data() as Partial<ClubConfig>
    return { ...DEFAULT_OFFICIALS_CONFIG, ...(data.officialsConfig ?? {}) }
  } catch (err: unknown) {
    if (err instanceof FirebaseError && err.code === 'permission-denied') {
      return DEFAULT_OFFICIALS_CONFIG
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tsToDate(ts: FirestoreTimestamp | undefined | null): Date | null {
  if (!ts) return null
  // SDK Firestore: Timestamp expose `.toDate()`. On caste défensivement au cas
  // où on reçoit un objet brut depuis un autre code path.
  if (typeof (ts as FirestoreTimestamp).toDate === 'function') {
    return (ts as FirestoreTimestamp).toDate()
  }
  const seconds = (ts as { seconds?: number }).seconds
  return typeof seconds === 'number' ? new Date(seconds * 1000) : null
}

interface BookingSnapshot {
  date: Date | null
  startTime: string | null
  endTime: string | null
  teamId: string | null
  seasonId: string | null
  matchTypeId: string | null
}

const EMPTY_BOOKING_SNAPSHOT: BookingSnapshot = {
  date: null,
  startTime: null,
  endTime: null,
  teamId: null,
  seasonId: null,
  matchTypeId: null,
}

/**
 * Batch-charge les bookings parents (un getDoc par bookingId unique, en
 * parallèle via `Promise.all`). Dégradation silencieuse sur
 * `permission-denied` — on rendra `EMPTY_BOOKING_SNAPSHOT` pour le booking
 * concerné, l'assignation reste affichable sans son contexte parent.
 *
 * NB : on n'utilise PAS `where(documentId(), 'in', chunk)` ici parce qu'on
 * a besoin de pouvoir distinguer les bookings inaccessibles (rule deny) des
 * bookings inexistants — `getDoc` individuel donne accès à l'erreur typée
 * et garde la sémantique "manquant ≠ refusé".
 */
async function loadBookingsByIds(
  bookingIds: string[],
): Promise<Map<string, BookingSnapshot>> {
  const map = new Map<string, BookingSnapshot>()
  if (bookingIds.length === 0) return map

  const results = await Promise.all(
    bookingIds.map(async (id): Promise<[string, BookingSnapshot]> => {
      try {
        const snap = await getDoc(doc(db, BOOKINGS, id))
        if (!snap.exists()) return [id, EMPTY_BOOKING_SNAPSHOT]
        const data = snap.data() as {
          date?: FirestoreTimestamp
          startTime?: string
          endTime?: string
          teamId?: string | null
          seasonId?: string
          matchTypeId?: string | null
        }
        return [
          id,
          {
            date: tsToDate(data.date ?? null),
            startTime: data.startTime ?? null,
            endTime: data.endTime ?? null,
            teamId: data.teamId ?? null,
            seasonId: data.seasonId ?? null,
            matchTypeId: data.matchTypeId ?? null,
          },
        ]
      } catch (err: unknown) {
        if (err instanceof FirebaseError && err.code === 'permission-denied') {
          return [id, EMPTY_BOOKING_SNAPSHOT]
        }
        throw err
      }
    }),
  )

  for (const [id, snapshot] of results) {
    map.set(id, snapshot)
  }
  return map
}

/** Scan `/teams` une fois → map teamId → name. */
async function loadTeamNames(): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  try {
    const snap = await getDocs(collection(db, TEAMS))
    for (const d of snap.docs) {
      const data = d.data() as { name?: string }
      map.set(d.id, data.name ?? d.id)
    }
  } catch (err: unknown) {
    if (err instanceof FirebaseError && err.code === 'permission-denied') {
      return map
    }
    throw err
  }
  return map
}

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

/**
 * Liste toutes les assignations d'un membre, enrichies avec le contexte du
 * booking parent et le nom de l'équipe. Triées du plus récent au plus ancien
 * (par `assignedAt` desc, fallback `bookingDate` desc).
 *
 * Stratégie :
 *  1. `collectionGroup('officialAssignments') where memberId == ...` — pas
 *     d'`orderBy` côté serveur tant qu'il n'y a pas l'index composite.
 *  2. Pour chaque assignation, le `bookingId` vient du parent du parent du
 *     ref (`/bookings/{bookingId}/officialAssignments/{assId}`).
 *  3. Charge les bookings parents en parallèle (déduppés via Set).
 *  4. Scan `/teams` une fois pour résoudre les noms.
 *  5. Tri JS final.
 *
 * @param memberId  id du membre cible (`/members/{memberId}`).
 */
export async function listMemberOfficialAssignments(
  memberId: string,
): Promise<OfficialAssignmentRow[]> {
  // 1) Query collectionGroup. Pas de `orderBy` ici — l'index composite n'est
  //    pas garanti déployé (cf. comment en tête de fichier).
  const assignmentDocs: Array<{
    id: string
    bookingId: string
    data: OfficialAssignmentData
  }> = []
  try {
    const q = query(
      collectionGroup(db, 'officialAssignments'),
      where('memberId', '==', memberId),
    )
    const snap = await getDocs(q)
    for (const d of snap.docs) {
      const parent = d.ref.parent.parent
      if (!parent) continue // sécurité — un doc collectionGroup a toujours un parent ici
      assignmentDocs.push({
        id: d.id,
        bookingId: parent.id,
        data: d.data() as OfficialAssignmentData,
      })
    }
  } catch (err: unknown) {
    if (err instanceof FirebaseError) {
      if (err.code === 'permission-denied') {
        return []
      }
      if (err.code === 'failed-precondition') {
        // Index composite manquant — visible en console pour debug, mais on
        // ne crashe pas la vue. À résoudre via la PR qui ajoute l'index dans
        // `firestore.indexes.json` (cf. commentaire en tête).
        console.warn(
          '[officialAssignments.repo] collectionGroup query failed (likely missing index):',
          err.message,
        )
        return []
      }
    }
    throw err
  }
  if (assignmentDocs.length === 0) return []

  // 2) Charger en parallèle les bookings parents (déduppés) et la map des teams.
  const uniqueBookingIds = Array.from(
    new Set(assignmentDocs.map((a) => a.bookingId)),
  )
  const [bookingMap, teamMap] = await Promise.all([
    loadBookingsByIds(uniqueBookingIds),
    loadTeamNames(),
  ])

  // 3) Composer les rows.
  const rows: OfficialAssignmentRow[] = assignmentDocs.map((a) => {
    const booking = bookingMap.get(a.bookingId) ?? EMPTY_BOOKING_SNAPSHOT
    const teamId = booking.teamId
    const teamName = teamId ? teamMap.get(teamId) ?? null : null
    return {
      id: a.id,
      bookingId: a.bookingId,
      ...a.data,
      bookingDate: booking.date,
      bookingStartTime: booking.startTime,
      bookingEndTime: booking.endTime,
      teamId,
      teamName,
      seasonId: booking.seasonId,
      matchTypeId: booking.matchTypeId,
    }
  })

  // 4) Tri JS desc — preference `assignedAt`, fallback `bookingDate`.
  rows.sort((a, b) => {
    const aTs = (a.assignedAt as FirestoreTimestamp | undefined)?.seconds ?? 0
    const bTs = (b.assignedAt as FirestoreTimestamp | undefined)?.seconds ?? 0
    if (aTs !== bTs) return bTs - aTs
    const aDate = a.bookingDate?.getTime() ?? 0
    const bDate = b.bookingDate?.getTime() ?? 0
    return bDate - aDate
  })

  return rows
}

// Re-export pour permettre au composable / au composant de ne pas importer
// directement depuis `@club-app/shared-types`.
export type { OfficialAssignmentStatus, OfficialsConfig }
