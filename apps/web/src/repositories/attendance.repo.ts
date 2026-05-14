import { FirebaseError } from 'firebase/app'
import {
  Timestamp,
  collection,
  collectionGroup,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore'
import type {
  Booking,
  BookingData,
  Cotisation,
  CotisationStatus,
  Member,
  MemberData,
  Season,
  Team,
} from '@club-app/shared-types'
import { auth, db } from '@/services/firebase'

/**
 * Repository Attendance — Firestore-backed.
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase
 * (cf. docs/frontend-desktop.md — architecture en couches). Le repo
 * encapsule les jointures nécessaires à l'écran `/attendance` :
 *
 *   1. Picker — liste les bookings "pointables" (today ±7j) pour proposer
 *      un choix au coach/admin quand aucun `bookingId` n'est en query.
 *   2. Header — résout team name + court label pour un booking donné.
 *   3. Lines — pour chaque joueur de la team du booking, agrège :
 *      - identité (members)
 *      - dues status sur la saison active (pour pill + détection d'exclusion)
 *      - record d'attendance existant (pour pré-remplir les radios)
 *   4. Save — écrit `/bookings/{id}/attendance/{memberId}` en `writeBatch`.
 *
 * Lecture des bookings ad-hoc autorisée ici (cf. brief Attendance) : un autre
 * agent owne `bookings.repo.ts`, je touche pas son fichier mais je peux lire
 * les bookings dont j'ai besoin pour le pointage.
 *
 * Convention d'ID :
 *   `/bookings/{bookingId}/attendance/{memberId}` — l'id du sous-doc est
 *   l'uid du membre, ce qui rend les saves idempotents (re-save = merge).
 */

const BOOKINGS = 'bookings'
const TEAMS = 'teams'
const MEMBERS = 'members'
const DUES = 'dues'
const SEASONS = 'seasons'
const VENUES = 'venues'
const COURTS = 'courts'
const ATTENDANCE_SUB = 'attendance'

// Firestore `in` query — limite v9 SDK = 30 valeurs.
const IN_CHUNK = 30
// Horizon picker : ±7 jours autour de today.
const PICKER_HORIZON_DAYS = 7
// Cap dur sur les bookings affichés dans le picker.
const PICKER_HARD_LIMIT = 50

// ---------------------------------------------------------------------------
// Types exposés
// ---------------------------------------------------------------------------

/** Ligne du picker "Choisir un créneau à pointer". */
export interface BookingPickerRow {
  id: string
  date: Date
  startTime: string
  endTime: string
  teamId: string
  teamName: string
  slotType: string
  courtId: string
  courtName: string
}

/**
 * Status cotisation exposés côté ligne d'attendance. On expose le union
 * complet `CotisationStatus` (incl. `cancelled`) — la vue mappe vers une pill
 * / décide si la ligne doit être grisée. `pending_grace` reste affiché
 * (joueur en période de grâce, OK pour s'entraîner). `null` = pas de
 * cotisation record.
 */
export type AttendanceCotisationStatus = CotisationStatus | null

/** Ligne d'attendance pour un joueur d'une équipe pointée. */
export interface AttendanceLineRow {
  memberId: string
  firstName: string
  lastName: string
  /** Pas encore wiré (Storage non posé). `null` jusqu'au chantier media. */
  photoUrl: string | null
  duesStatus: AttendanceCotisationStatus
  /**
   * Vrai si le joueur est "exclu" pour la saison active.
   *
   * Interprétation : on traite `status === 'cancelled'` comme la marque
   * d'exclusion (cf. brief Attendance — pas de champ dédié pour l'instant,
   * `cancelled` est le terminal qui couvre l'exclusion administrative).
   * Une `cancelled` due rend la ligne grisée et empêche le pointage côté UI.
   *
   * Note: le main.md décrit aussi un état `member.duesStatus = 'excluded'`
   * post-overdue, mais celui-ci vit sur `/members` (sync via Function) et
   * n'influence pas la rule métier de pointage MVP : le coach pointe
   * absent/excusé, c'est tout. La seule contrainte UI dure ici est la
   * cancelled-dues = vraie exclusion administrative.
   */
  isExcluded: boolean
  /** Status pré-existant si déjà pointé (sinon `null`). */
  existingStatus: 'present' | 'absent' | 'excused' | null
  /** Note libre pré-existante (`null` = pas de note). */
  existingNote: string | null
}

/** Payload envoyé à `saveAttendanceBatch`. */
export interface AttendanceWritePayload {
  memberId: string
  status: 'present' | 'absent' | 'excused'
  note: string | null
}

/** Résumé booking pour l'en-tête de l'écran. */
export interface BookingHeader {
  booking: Booking
  teamName: string
  courtName: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function chunkArray<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}

function tsToDate(value: Timestamp): Date {
  return value.toDate()
}

/**
 * Re-throw les erreurs Firebase en distinguant `permission-denied` pour
 * un message clair côté store/vue. Autres erreurs : remontent telles quelles.
 */
function rethrowFriendly(err: unknown, context: string): never {
  if (err instanceof FirebaseError && err.code === 'permission-denied') {
    throw new Error(
      `Accès refusé (${context}) — votre rôle ne permet pas cette opération.`,
    )
  }
  throw err instanceof Error ? err : new Error(`Erreur inconnue (${context})`)
}

/** Charge `/seasons` active (status == 'active'). `null` si aucune. */
async function getActiveSeason(): Promise<Season | null> {
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

/** Batch-load `/members/{id}` via `documentId() in chunk`. */
async function loadMembersByIds(ids: readonly string[]): Promise<Map<string, Member>> {
  const out = new Map<string, Member>()
  const unique = Array.from(new Set(ids.filter((id) => id.length > 0)))
  if (unique.length === 0) return out
  for (const chunk of chunkArray(unique, IN_CHUNK)) {
    const q = query(collection(db, MEMBERS), where(documentId(), 'in', chunk))
    const snap = await getDocs(q)
    for (const d of snap.docs) {
      out.set(d.id, { id: d.id, ...(d.data() as MemberData) })
    }
  }
  return out
}

/** Batch-load `/teams/{id}`. */
async function loadTeamsByIds(ids: readonly string[]): Promise<Map<string, Team>> {
  const out = new Map<string, Team>()
  const unique = Array.from(new Set(ids.filter((id) => id.length > 0)))
  if (unique.length === 0) return out
  for (const chunk of chunkArray(unique, IN_CHUNK)) {
    const q = query(collection(db, TEAMS), where(documentId(), 'in', chunk))
    const snap = await getDocs(q)
    for (const d of snap.docs) {
      out.set(d.id, { id: d.id, ...(d.data() as Omit<Team, 'id'>) })
    }
  }
  return out
}

/**
 * Résout libellé court "Venue · Court" pour une paire venueId/courtId.
 * Renvoie "—" si l'un ou les deux docs sont absents.
 */
async function loadCourtLabel(venueId: string, courtId: string): Promise<string> {
  if (!venueId || !courtId) return '—'
  try {
    const [venueSnap, courtSnap] = await Promise.all([
      getDoc(doc(db, VENUES, venueId)),
      getDoc(doc(db, VENUES, venueId, COURTS, courtId)),
    ])
    const venueName = venueSnap.exists()
      ? ((venueSnap.data() as { name?: string }).name ?? '')
      : ''
    const courtName = courtSnap.exists()
      ? ((courtSnap.data() as { name?: string }).name ?? '')
      : ''
    if (!venueName && !courtName) return '—'
    if (!venueName) return courtName
    if (!courtName) return venueName
    return `${venueName} · ${courtName}`
  } catch {
    return '—'
  }
}

/**
 * Charge les cotisations actives sur saison `seasonId` pour la team `teamId`,
 * restreintes aux memberIds passés. Retourne une map memberId → Cotisation
 * (la plus récente si plusieurs — cas pathologique, on prend le 1er
 * rencontré).
 *
 * Chunké par 30 sur `memberId` (limite `in`). Filtre seasonId/teamId côté
 * server pour limiter le payload.
 */
async function loadDuesByMember(
  memberIds: readonly string[],
  teamId: string,
  seasonId: string,
): Promise<Map<string, Cotisation>> {
  const out = new Map<string, Cotisation>()
  const unique = Array.from(new Set(memberIds.filter((id) => id.length > 0)))
  if (unique.length === 0 || !teamId || !seasonId) return out
  for (const chunk of chunkArray(unique, IN_CHUNK)) {
    const q = query(
      collection(db, DUES),
      where('memberId', 'in', chunk),
      where('teamId', '==', teamId),
      where('seasonId', '==', seasonId),
    )
    const snap = await getDocs(q)
    for (const d of snap.docs) {
      const data = d.data() as Omit<Cotisation, 'id'>
      // On garde la 1re occurrence rencontrée — schéma main.md = 1 cotisation / member / saison / team.
      if (!out.has(data.memberId)) {
        out.set(data.memberId, { id: d.id, ...data })
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Picker — listRecentBookingsForPicker
// ---------------------------------------------------------------------------

/**
 * Bookings "pointables" autour de `now` (±7j). Filtre : `status == 'scheduled'`
 * et `teamId != null`. Trié par date asc puis startTime asc.
 *
 * Note: Firestore n'autorise pas `where('teamId', '!=', null)` combiné avec
 * un orderBy autre — on filtre côté client après la query date+status.
 */
export async function listRecentBookingsForPicker(
  now: Date,
): Promise<BookingPickerRow[]> {
  try {
    const from = new Date(now)
    from.setDate(from.getDate() - PICKER_HORIZON_DAYS)
    from.setHours(0, 0, 0, 0)
    const to = new Date(now)
    to.setDate(to.getDate() + PICKER_HORIZON_DAYS)
    to.setHours(23, 59, 59, 999)

    const q = query(
      collection(db, BOOKINGS),
      where('status', '==', 'scheduled'),
      where('date', '>=', Timestamp.fromDate(from)),
      where('date', '<=', Timestamp.fromDate(to)),
    )
    const snap = await getDocs(q)
    if (snap.empty) return []

    type Raw = {
      id: string
      teamId: string | null
      venueId: string
      courtId: string
      slotType: string
      date: Timestamp
      startTime: string
      endTime: string
    }
    const raws: Raw[] = snap.docs
      .map((d) => {
        const data = d.data() as Omit<Raw, 'id'>
        return { id: d.id, ...data }
      })
      // Côté client : on garde uniquement les bookings rattachés à une team.
      .filter((r) => r.teamId !== null && r.teamId.length > 0)
      .slice(0, PICKER_HARD_LIMIT)

    // Charge teams + courts en parallèle pour les libellés.
    const teamIds = raws.map((r) => r.teamId).filter((id): id is string => !!id)
    const courtKeys = Array.from(
      new Set(raws.map((r) => `${r.venueId}__${r.courtId}`)),
    )
    const courtLabelPromises = courtKeys.map(async (key) => {
      const [venueId, courtId] = key.split('__')
      const label = await loadCourtLabel(venueId ?? '', courtId ?? '')
      return [key, label] as const
    })
    const [teams, courtEntries] = await Promise.all([
      loadTeamsByIds(teamIds),
      Promise.all(courtLabelPromises),
    ])
    const courtLabels = new Map(courtEntries)

    const rows: BookingPickerRow[] = raws.map((r) => {
      const teamId = r.teamId ?? ''
      const team = teamId ? teams.get(teamId) : undefined
      const courtKey = `${r.venueId}__${r.courtId}`
      return {
        id: r.id,
        date: tsToDate(r.date),
        startTime: r.startTime,
        endTime: r.endTime,
        teamId,
        teamName: team?.name ?? '—',
        slotType: r.slotType,
        courtId: r.courtId,
        courtName: courtLabels.get(courtKey) ?? '—',
      }
    })

    // Tri client-side : date asc puis startTime asc.
    rows.sort((a, b) => {
      const da = a.date.getTime()
      const db_ = b.date.getTime()
      if (da !== db_) return da - db_
      return a.startTime.localeCompare(b.startTime)
    })

    return rows
  } catch (err: unknown) {
    rethrowFriendly(err, 'liste des créneaux')
  }
}

// ---------------------------------------------------------------------------
// Header — fetchBookingHeader
// ---------------------------------------------------------------------------

/**
 * Charge un booking + ses libellés team / court. `null` si le booking
 * n'existe pas.
 */
export async function fetchBookingHeader(
  bookingId: string,
): Promise<BookingHeader | null> {
  if (!bookingId) return null
  try {
    const snap = await getDoc(doc(db, BOOKINGS, bookingId))
    if (!snap.exists()) return null
    const data = snap.data() as BookingData
    const booking: Booking = { id: snap.id, ...data }

    const [teamSnap, courtName] = await Promise.all([
      data.teamId
        ? getDoc(doc(db, TEAMS, data.teamId))
        : Promise.resolve(null),
      loadCourtLabel(data.venueId, data.courtId),
    ])
    let teamName = '—'
    if (teamSnap && teamSnap.exists()) {
      teamName = (teamSnap.data() as { name?: string }).name ?? '—'
    }
    return { booking, teamName, courtName }
  } catch (err: unknown) {
    rethrowFriendly(err, 'détails du créneau')
  }
}

// ---------------------------------------------------------------------------
// Lines — loadAttendanceLines
// ---------------------------------------------------------------------------

/**
 * Charge les lignes d'attendance pour le booking donné. Jointures :
 *   1. /bookings/{id} → teamId
 *   2. /teams/{teamId} → playerIds[]
 *   3. /members where documentId in playerIds (chunk 30)
 *   4. /dues where memberId in chunk & teamId == X & seasonId == active
 *   5. /bookings/{id}/attendance — pré-remplissage radios
 *
 * Retourne `[]` si pas de team rattachée, ou pas de joueurs, ou booking
 * inexistant. Ne throw que sur erreurs SDK réelles.
 */
export async function loadAttendanceLines(
  bookingId: string,
): Promise<AttendanceLineRow[]> {
  if (!bookingId) return []
  try {
    // 1) Booking.
    const bookingSnap = await getDoc(doc(db, BOOKINGS, bookingId))
    if (!bookingSnap.exists()) return []
    const bookingData = bookingSnap.data() as BookingData
    const teamId = bookingData.teamId
    if (!teamId) return []

    // 2) Team → playerIds.
    const teamSnap = await getDoc(doc(db, TEAMS, teamId))
    if (!teamSnap.exists()) return []
    const teamData = teamSnap.data() as Omit<Team, 'id'>
    const playerIds = teamData.playerIds ?? []
    if (playerIds.length === 0) return []

    // 3-5) Members + dues (saison active) + attendance existante — en //.
    const activeSeasonPromise = getActiveSeason()
    const membersPromise = loadMembersByIds(playerIds)
    const attendancePromise = getDocs(
      collection(db, BOOKINGS, bookingId, ATTENDANCE_SUB),
    )

    const [members, attendanceSnap, activeSeason] = await Promise.all([
      membersPromise,
      attendancePromise,
      activeSeasonPromise,
    ])

    // Cotisations : nécessite la saison active pour scoper le query.
    const cotisations = activeSeason
      ? await loadDuesByMember(playerIds, teamId, activeSeason.id)
      : new Map<string, Cotisation>()

    // Map existing attendance par memberId (= attendanceId par convention).
    type ExistingAttendance = {
      status: 'present' | 'absent' | 'excused'
      note: string | null
    }
    const existing = new Map<string, ExistingAttendance>()
    for (const d of attendanceSnap.docs) {
      const data = d.data() as {
        memberId?: string
        status?: 'present' | 'absent' | 'excused'
        note?: string | null
      }
      // Convention id == memberId, mais on lit `memberId` dans le doc en
      // fallback pour tolérer un legacy où l'id serait random.
      const key = data.memberId ?? d.id
      if (!key) continue
      existing.set(key, {
        status: data.status ?? 'present',
        note: data.note ?? null,
      })
    }

    // Compose lignes — ordonne sur (lastName, firstName).
    const rows: AttendanceLineRow[] = playerIds.map((memberId) => {
      const m = members.get(memberId)
      const cotisation = cotisations.get(memberId) ?? null
      const ex = existing.get(memberId) ?? null
      const isExcluded = cotisation?.status === 'cancelled'
      return {
        memberId,
        firstName: m?.firstName ?? '—',
        lastName: m?.lastName ?? '—',
        // TODO(media): wire photoUrl quand Storage upload landera.
        photoUrl: null,
        duesStatus: cotisation?.status ?? null,
        isExcluded,
        existingStatus: ex?.status ?? null,
        existingNote: ex?.note ?? null,
      }
    })
    rows.sort((a, b) => {
      const last = a.lastName.localeCompare(b.lastName, 'fr')
      if (last !== 0) return last
      return a.firstName.localeCompare(b.firstName, 'fr')
    })
    return rows
  } catch (err: unknown) {
    rethrowFriendly(err, 'lignes de présence')
  }
}

// ---------------------------------------------------------------------------
// Save — saveAttendanceBatch
// ---------------------------------------------------------------------------

/**
 * Écrit les `attendance/{memberId}` du booking en `writeBatch`.
 *
 * - `setDoc({ merge: true })` semantics via `batch.set(ref, payload, { merge: true })` :
 *   re-saves idempotents, conserve les champs non touchés (ex. note posée
 *   précédemment et non re-saisie).
 * - `recordedBy` = uid Auth courant. Throw si l'utilisateur n'est pas signé.
 * - `recordedAt` = serverTimestamp (cohérent cross-device).
 *
 * Ne valide pas les rôles côté client : c'est le boulot des Firestore rules
 * (cf. firestore.rules — `isCoachOfBooking || isAdmin || isRootAdmin`). En
 * cas de refus, le store reçoit l'erreur traduite par `rethrowFriendly`.
 */
export async function saveAttendanceBatch(
  bookingId: string,
  lines: readonly AttendanceWritePayload[],
): Promise<void> {
  if (!bookingId) throw new Error('bookingId requis')
  if (lines.length === 0) return

  const currentUid = auth.currentUser?.uid
  if (!currentUid) {
    throw new Error('Utilisateur non authentifié — re-signez avant de sauvegarder.')
  }

  try {
    const batch = writeBatch(db)
    for (const line of lines) {
      const ref = doc(db, BOOKINGS, bookingId, ATTENDANCE_SUB, line.memberId)
      batch.set(
        ref,
        {
          bookingId,
          memberId: line.memberId,
          status: line.status,
          note: line.note,
          recordedBy: currentUid,
          recordedAt: serverTimestamp(),
        },
        { merge: true },
      )
    }
    await batch.commit()
  } catch (err: unknown) {
    rethrowFriendly(err, 'enregistrement des présences')
  }
}

// ---------------------------------------------------------------------------
// Member detail — listMemberAttendance
//
// Lecture cross-bookings des présences d'un membre, pour le tab "Présences"
// de la page /members/:id. Utilise `collectionGroup('attendance')` pour scanner
// toutes les sous-collections `attendance` sous /bookings. Pour chaque entry,
// résout le booking parent (date / heures / teamId / slotType) et le nom de
// l'équipe associée.
//
// INDEX REQUIS (à ajouter dans firestore.indexes.json, déploiement séparé) :
//   {
//     "collectionGroup": "attendance",
//     "queryScope": "COLLECTION_GROUP",
//     "fields": [
//       { "fieldPath": "memberId", "order": "ASCENDING" },
//       { "fieldPath": "recordedAt", "order": "DESCENDING" }
//     ]
//   }
//
// Sans cet index, la query throw `failed-precondition` — on remonte une
// erreur étiquetée `MISSING_INDEX` au composable (qui affiche un banner)
// au lieu de casser la page. Sur `permission-denied`, on dégrade à `[]`
// silencieusement.
// ---------------------------------------------------------------------------

export type AttendanceStatus = 'present' | 'absent' | 'excused'

/**
 * Entrée d'attendance enrichie pour la vue "Présences" d'un membre.
 *
 * Les champs `bookingDate`, `bookingStartTime`, `bookingEndTime`, `teamId`,
 * `slotType` viennent du doc parent `/bookings/{bookingId}` (résolu côté repo
 * via un getDoc par booking unique). Le champ `teamName` vient d'un scan
 * one-shot de `/teams`.
 *
 * `null` sur les champs joints = booking parent / team introuvable
 * (booking supprimé, team archivée, ou permission-denied sur le doc parent).
 */
export interface AttendanceEntry {
  id: string
  bookingId: string
  memberId: string
  status: AttendanceStatus
  recordedBy: string
  recordedAt: Date
  note: string | null
  // Joints depuis /bookings/{bookingId} :
  bookingDate: Date | null
  bookingStartTime: string | null
  bookingEndTime: string | null
  teamId: string | null
  teamName: string | null
  slotType: string | null
}

/** Sentinelle utilisée par le composable pour détecter l'index manquant. */
export const ATTENDANCE_MISSING_INDEX_TAG = 'MISSING_INDEX'

/**
 * Liste les `limit` (par défaut 200) dernières présences d'un membre,
 * tous bookings confondus, triées par `recordedAt` desc.
 *
 * Dégradation gracieuse :
 *  - `permission-denied` → `[]` (rare ici puisque caller = admin/coach/self
 *    sur ses propres présences ; on ne casse pas la page).
 *  - `failed-precondition` (index manquant) → throw `Error` portant le tag
 *    `MISSING_INDEX` (le composable l'utilise pour afficher un banner).
 *  - Autre `FirebaseError` → re-throw (vraie erreur à remonter).
 */
export async function listMemberAttendance(
  memberId: string,
  opts?: { limit?: number },
): Promise<AttendanceEntry[]> {
  if (!memberId) return []
  const max = opts?.limit ?? 200

  let snap
  try {
    snap = await getDocs(
      query(
        collectionGroup(db, ATTENDANCE_SUB),
        where('memberId', '==', memberId),
        orderBy('recordedAt', 'desc'),
        limit(max),
      ),
    )
  } catch (err: unknown) {
    if (err instanceof FirebaseError) {
      if (err.code === 'permission-denied') {
        return []
      }
      if (err.code === 'failed-precondition') {
        // L'index collectionGroup `attendance` (memberId asc, recordedAt desc)
        // n'est pas encore déployé. On annonce le motif via une exception
        // taggée pour que le composable puisse afficher un banner dédié.
        console.warn(
          '[attendance.repo] listMemberAttendance: index collectionGroup ' +
            "'attendance' manquant. Ajouter l'index dans firestore.indexes.json " +
            "puis `firebase deploy --only firestore:indexes`. Détail: " +
            err.message,
        )
        throw new Error(
          `${ATTENDANCE_MISSING_INDEX_TAG}: index Firestore manquant pour ` +
            "collectionGroup 'attendance'.",
        )
      }
    }
    throw err
  }

  if (snap.empty) return []

  type RawEntry = {
    docId: string
    bookingId: string
    memberId: string
    status: AttendanceStatus
    recordedBy: string
    recordedAt: Date
    note: string | null
  }
  const raws: RawEntry[] = []
  for (const d of snap.docs) {
    const data = d.data() as {
      bookingId?: string
      memberId?: string
      status?: AttendanceStatus
      recordedBy?: string
      recordedAt?: Timestamp
      note?: string | null
    }
    // Le bookingId peut être dérivé du chemin parent si le champ dénormalisé
    // est absent (legacy). `d.ref.parent.parent` pointe vers /bookings/{id}.
    const parentBookingId = d.ref.parent.parent?.id ?? ''
    const bookingId = data.bookingId ?? parentBookingId
    if (!bookingId) continue
    raws.push({
      docId: d.id,
      bookingId,
      memberId: data.memberId ?? memberId,
      status: data.status ?? 'present',
      recordedBy: data.recordedBy ?? '',
      recordedAt: data.recordedAt ? tsToDate(data.recordedAt) : new Date(0),
      note: data.note ?? null,
    })
  }

  // Résolution des bookings parents : un getDoc par booking unique, en //.
  const uniqueBookingIds = Array.from(new Set(raws.map((r) => r.bookingId)))
  const bookingPromise = Promise.all(
    uniqueBookingIds.map(async (id) => {
      try {
        const bs = await getDoc(doc(db, BOOKINGS, id))
        if (!bs.exists()) return [id, null] as const
        const bd = bs.data() as BookingData
        return [id, bd] as const
      } catch (err: unknown) {
        // permission-denied ponctuel → on dégrade ce booking en `null`.
        if (err instanceof FirebaseError && err.code === 'permission-denied') {
          return [id, null] as const
        }
        throw err
      }
    }),
  )

  // Build map team name une fois (scan léger sur /teams).
  const teamLabelsPromise = (async (): Promise<Map<string, string>> => {
    const map = new Map<string, string>()
    try {
      const teamsSnap = await getDocs(collection(db, TEAMS))
      for (const t of teamsSnap.docs) {
        const td = t.data() as { name?: string }
        map.set(t.id, td.name ?? t.id)
      }
    } catch (err: unknown) {
      // Dégradation silencieuse — les libellés team seront `null` mais la
      // liste s'affiche quand même.
      if (!(err instanceof FirebaseError && err.code === 'permission-denied')) {
        throw err
      }
    }
    return map
  })()

  const [bookingEntries, teamLabels] = await Promise.all([
    bookingPromise,
    teamLabelsPromise,
  ])
  const bookings = new Map<string, BookingData | null>(bookingEntries)

  return raws.map((r): AttendanceEntry => {
    const b = bookings.get(r.bookingId) ?? null
    const teamId = b?.teamId ?? null
    return {
      id: r.docId,
      bookingId: r.bookingId,
      memberId: r.memberId,
      status: r.status,
      recordedBy: r.recordedBy,
      recordedAt: r.recordedAt,
      note: r.note,
      // Cast: BookingData.date est le Timestamp neutre de shared-types
      // (sans méthodes), mais le SDK Firestore retourne toujours un
      // Timestamp instance à la lecture. Sûr ici.
      bookingDate: b?.date ? tsToDate(b.date as Timestamp) : null,
      bookingStartTime: b?.startTime ?? null,
      bookingEndTime: b?.endTime ?? null,
      teamId,
      teamName: teamId ? (teamLabels.get(teamId) ?? null) : null,
      slotType: b?.slotType ?? null,
    }
  })
}
