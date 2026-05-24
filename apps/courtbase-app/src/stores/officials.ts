/**
 * Store Officials — source unique pour les vues officiel (OpenMatches,
 * MyAssignments, MatchDetail).
 *
 * Hybride mock + Firestore réel — même pattern que `bookings.ts` /
 * `licenseRequests.ts`. La discrimination passe par `auth.userDoc.memberId` :
 *  - **Firestore** quand un memberId réel est posé : fetch matchs AWAY +
 *    matchTypes + assignations sub-collections (HOME via bookings store +
 *    AWAY via matches local) en parallèle.
 *  - **Mock** sinon : dérive depuis `MOCK_MATCHES` et synthétise un staff
 *    vide (les vues officiel doivent juste rendre les cards "ouvert").
 *
 * **Source unique = saison entière**. Les vues ne re-fetch JAMAIS — elles
 * consomment `myAssignments`, `incompleteMatchesCount`,
 * `openOpportunitiesForLevel(level)` etc.
 *
 * Cf. `apps/courtbase-app/CLAUDE.md` (Convention vues consommatrices :
 * `loadOfficialContext` au mount, idempotent).
 */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  Timestamp as FsTimestamp,
  collection,
  getDocs,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { FirebaseError } from 'firebase/app'

import type {
  Match,
  MatchType,
  MatchTypeData,
  OfficialAssignment,
  Timestamp,
} from '@club-app/shared-types'

/**
 * `FsTimestamp` (SDK class) est utilisé runtime pour `fromMillis()` ; le
 * type structurel `Timestamp` de shared-types est utilisé partout pour les
 * annotations afin de rester compatible avec les docs sérialisés (`{
 * seconds, nanoseconds }`).
 */

import { db } from '@/services/firebase'
import { useActiveSeason } from '@/composables/useSeason'
import { useAuthStore } from '@/stores/auth'
import { useBookingsStore } from '@/stores/bookings'
import { useTeamsStore } from '@/stores/teams'
import { listMatchesForSeason } from '@/repositories/matches.repo'
import {
  listAssignmentsForBooking,
  listAssignmentsForMatch,
  respondToBookingAssignment,
  respondToMatchAssignment,
  selfRegisterForBooking,
  selfRegisterForMatch,
} from '@/repositories/officials.repo'
import type { BookingRow } from '@/repositories/bookings.repo'
import { logMockAction } from '@/repositories/mock'
import type { MockTeam } from '@/types/mock'

// ─── Types publics ───────────────────────────────────────────────────

export type OfficialsSource = 'firestore' | 'mock'

/**
 * Entry retournée par le getter `myAssignments`. La forme évite que les vues
 * recroisent manuellement bookings / matchs / teams — tout est résolu.
 */
export interface MyAssignmentEntry {
  assignment: OfficialAssignment
  parent:
    | { kind: 'home'; booking: BookingRow }
    | { kind: 'away'; match: Match }
  matchType: MatchType | null
  /** Team du club (côté local du match). `null` si team inconnue. */
  team: MockTeam | null
}

/**
 * Entry retournée par `openOpportunitiesForLevel(level)`. Inclut le calcul
 * du nombre de slots ouverts pour ce niveau (HOME) ou globalement (AWAY).
 */
export interface OpportunityEntry {
  kind: 'home' | 'away'
  /** bookingId si HOME, matchId si AWAY. */
  parentId: string
  matchType: MatchType | null
  team: MockTeam | null
  date: Timestamp
  startTime: string
  endTime: string
  opponentName: string | null
  /** HOME : venueId + courtId résolus en libellé (`venueName · courtName`,
   *  ou `Salle non attribuée` si le booking HOME n'a pas de salle). AWAY :
   *  `awayAddress`. `null` si totalement inconnu. */
  location: string | null
  /** Slots ouverts (HOME = du level demandé, AWAY = global). */
  openSlots: number
}

// ─── Helpers privés ──────────────────────────────────────────────────

/**
 * Coerce un Timestamp Firestore (ou structurel) en epoch ms.
 */
function tsToMs(ts: { seconds?: number; toMillis?: () => number } | null | undefined): number {
  if (!ts) return 0
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (typeof ts.seconds === 'number') return ts.seconds * 1000
  return 0
}

/**
 * Vérifie un code Firestore sans `instanceof FirestoreError` (cf. CLAUDE.md
 * règle 13).
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
 * Tente de charger tous les `/matchTypes` du club. Référentiel < 30 docs.
 * Retourne `[]` sur erreur (loguée). Inline ici plutôt que dans un repo
 * séparé — un seul call-site, pas de réutilisation prévue.
 */
async function loadMatchTypes(): Promise<MatchType[]> {
  try {
    const snap = await getDocs(collection(db, 'matchTypes'))
    return snap.docs.map((d: QueryDocumentSnapshot<DocumentData>) => {
      const data = d.data() as Partial<MatchTypeData>
      return {
        id: d.id,
        name: data.name ?? '',
        requiredCourtSize: data.requiredCourtSize ?? 'normal',
        homeOfficialRequirements: Array.isArray(data.homeOfficialRequirements)
          ? data.homeOfficialRequirements
          : [],
        awayOfficialCount:
          typeof data.awayOfficialCount === 'number' ? data.awayOfficialCount : 0,
        color: data.color ?? '#64748b',
        active: data.active ?? true,
        createdAt: data.createdAt ?? FsTimestamp.fromMillis(0),
      }
    })
  } catch (err) {
    if (isPermissionDenied(err)) {
      console.warn('[officials.store] loadMatchTypes permission-denied')
      return []
    }
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[officials.store] loadMatchTypes failed [${code}]`, err)
    return []
  }
}

/**
 * Calcule, pour une exigence HOME `homeOfficialRequirements`, le nombre de
 * slots ouverts pour un `level` donné. Logique :
 *
 *  - Trouve le requirement avec `level === level`. S'il n'existe pas → 0.
 *  - Sinon : `count - (assignments où officialLevel === level && status !=
 *    'declined')`. Clampé à 0.
 *
 * Les `declined` libèrent le slot (cohérent avec la logique côté apps/web).
 */
function openHomeSlotsForLevel(
  requirements: ReadonlyArray<{ level: number; count: number }>,
  assignments: ReadonlyArray<OfficialAssignment>,
  level: number,
): number {
  const req = requirements.find((r) => r.level === level)
  if (!req) return 0
  const taken = assignments.filter(
    (a) => a.officialLevel === level && a.status !== 'declined',
  ).length
  return Math.max(0, req.count - taken)
}

/**
 * Calcule le nombre de slots ouverts pour un match AWAY (pas de niveau —
 * un compte global `awayOfficialCount`).
 */
function openAwaySlots(
  awayOfficialCount: number,
  assignments: ReadonlyArray<OfficialAssignment>,
): number {
  const taken = assignments.filter((a) => a.status !== 'declined').length
  return Math.max(0, awayOfficialCount - taken)
}

/**
 * True si la date du match est dans le futur (>= maintenant local).
 * Compare via `tsToMs` pour rester robuste à un `Timestamp` mock ou réel.
 */
function isFuture(date: Timestamp | null | undefined): boolean {
  return tsToMs(date) >= Date.now()
}

/** True si le booking est dans le futur (utilise `startMs`). */
function isFutureBooking(b: BookingRow): boolean {
  return b.startMs >= Date.now()
}

/**
 * True si l'adversaire est **confirmé** (non vide). Les matchs "à confirmer"
 * (opponent null / undefined / string vide) ne sont jamais proposés aux
 * officiels — ils ne savent pas contre qui ils joueraient et la fédération
 * n'a pas encore validé le match. Règle produit (Eliot 2026-05-24) : "il ne
 * faut lister que les /matches avec adversaire confirmé".
 */
function hasConfirmedOpponent(name: string | null | undefined): boolean {
  return typeof name === 'string' && name.trim().length > 0
}

// ─── Store ───────────────────────────────────────────────────────────

export const useOfficialsStore = defineStore('officials', () => {
  // ─── State ──────────────────────────────────────────────────────

  /** Matchs AWAY de la saison (HOME = via bookings store `slotType ===
   *  'match_home'`). */
  const awayMatches = ref<Match[]>([])

  /** Référentiel matchTypes du club (lookup id → type). */
  const matchTypesById = ref<Map<string, MatchType>>(new Map())

  /** Cache assignations par bookingId HOME. */
  const homeAssignmentsByBookingId = ref<Map<string, OfficialAssignment[]>>(new Map())
  /** Cache assignations par matchId AWAY. */
  const awayAssignmentsByMatchId = ref<Map<string, OfficialAssignment[]>>(new Map())

  const loading = ref(false)
  const lastError = ref<string | null>(null)
  const source = ref<OfficialsSource>('mock')
  const lastLoadedSeasonId = ref<string | null>(null)

  /** Garde anti-double-fetch (clé : seasonId). */
  let hydrated = false

  // ─── Mode discrimination ────────────────────────────────────────

  function isFirestoreMode(): boolean {
    const auth = useAuthStore()
    return Boolean(auth.userDoc?.memberId)
  }

  // ─── Actions ────────────────────────────────────────────────────

  /**
   * Idempotent — re-load uniquement si `seasonId` change ou si pas encore
   * hydraté. Charge en parallèle :
   *  - matchs AWAY de la saison via `matches.repo`.
   *  - `/matchTypes` du club.
   *  - bookings store `loadActiveContext()` (assure que `allBookings` est
   *    peuplé pour le filtrage HOME `slotType === 'match_home'`).
   *  - assignations sub-collections pour CHAQUE booking HOME (N+1 — accepté
   *    pour quelques dizaines de matchs par saison, cf. CLAUDE.md §10) ET
   *    pour chaque match AWAY.
   *
   * Mode mock : remplit `awayMatches` depuis `MOCK_MATCHES` (kind=away) et
   * laisse les caches d'assignations vides — les vues officiel rendent
   * naturellement "opportunités ouvertes / mes assignations vides".
   */
  async function loadOfficialContext(seasonId: string): Promise<void> {
    if (hydrated && lastLoadedSeasonId.value === seasonId) return
    loading.value = true
    lastError.value = null

    try {
      if (!isFirestoreMode()) {
        // ─── Mock path ────────────────────────────────────────────
        source.value = 'mock'
        awayMatches.value = (await listMatchesForSeason('mock-season', { kind: 'away' })) // synthèse depuis MOCK_MATCHES
        matchTypesById.value = new Map()
        homeAssignmentsByBookingId.value = new Map()
        awayAssignmentsByMatchId.value = new Map()
        lastLoadedSeasonId.value = seasonId
        hydrated = true
        return
      }

      // ─── Firestore path ───────────────────────────────────────
      source.value = 'firestore'

      // Charge le contexte bookings AVANT — on en a besoin pour filtrer les
      // bookings HOME et fetch leurs sub-collections.
      const bookingsStore = useBookingsStore()
      await bookingsStore.loadActiveContext()

      const [awayResult, matchTypesResult] = await Promise.all([
        listMatchesForSeason(seasonId, { kind: 'away' }),
        loadMatchTypes(),
      ])
      awayMatches.value = awayResult
      const mtMap = new Map<string, MatchType>()
      for (const mt of matchTypesResult) mtMap.set(mt.id, mt)
      matchTypesById.value = mtMap

      // Fetch des sub-collections en parallèle.
      const homeBookings = bookingsStore.allBookings.filter(
        (b: BookingRow) => b.slotType === 'match_home',
      )
      const [homeAssignsResults, awayAssignsResults] = await Promise.all([
        Promise.all(
          homeBookings.map(async (b) => [b.id, await listAssignmentsForBooking(b.id)] as const),
        ),
        Promise.all(
          awayResult.map(async (m) => [m.id, await listAssignmentsForMatch(m.id)] as const),
        ),
      ])
      const homeMap = new Map<string, OfficialAssignment[]>()
      for (const [bookingId, assigns] of homeAssignsResults) homeMap.set(bookingId, assigns)
      homeAssignmentsByBookingId.value = homeMap

      const awayMap = new Map<string, OfficialAssignment[]>()
      for (const [matchId, assigns] of awayAssignsResults) awayMap.set(matchId, assigns)
      awayAssignmentsByMatchId.value = awayMap

      lastLoadedSeasonId.value = seasonId
      hydrated = true
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err)
      console.error('[officials.store] loadOfficialContext failed', err)
      lastError.value = code
    } finally {
      loading.value = false
    }
  }

  /**
   * Self-register du caller sur un match. Optimistic update : on insère un
   * assignment "fake" dans le cache local, puis on appelle le repo. Si le
   * repo throw → revert.
   *
   * NB : l'ID local optimistique vaut `memberId` (cohérent avec l'ID
   * déterministe utilisé serveur-side). Au refetch, le doc serveur écrasera
   * l'entrée avec les bonnes valeurs (notamment `assignedAt` serverTimestamp).
   */
  async function selfRegister(input: {
    kind: 'home' | 'away'
    parentId: string
    memberId: string
    officialLevel: number
    byUid: string
  }): Promise<void> {
    // Optimistic patch — fake Timestamp local.
    const optimistic: OfficialAssignment = {
      id: input.memberId,
      memberId: input.memberId,
      officialLevel: input.officialLevel,
      status: 'pending',
      assignedAt: FsTimestamp.fromMillis(Date.now()),
      assignedBy: input.byUid,
      respondedAt: null,
    }
    const cacheRef =
      input.kind === 'home' ? homeAssignmentsByBookingId : awayAssignmentsByMatchId
    const previous = cacheRef.value.get(input.parentId) ?? []
    // Si le membre était déjà dans le cache, on remplace ; sinon on ajoute.
    const nextList = previous.some((a) => a.id === optimistic.id)
      ? previous.map((a) => (a.id === optimistic.id ? optimistic : a))
      : [...previous, optimistic]
    cacheRef.value.set(input.parentId, nextList)
    cacheRef.value = new Map(cacheRef.value)

    try {
      if (!isFirestoreMode()) {
        logMockAction('officials.selfRegister', input)
        return
      }
      if (input.kind === 'home') {
        await selfRegisterForBooking({
          bookingId: input.parentId,
          memberId: input.memberId,
          officialLevel: input.officialLevel,
          byUid: input.byUid,
        })
      } else {
        await selfRegisterForMatch({
          matchId: input.parentId,
          memberId: input.memberId,
          officialLevel: input.officialLevel,
          byUid: input.byUid,
        })
      }
    } catch (err) {
      // Revert optimistic.
      cacheRef.value.set(input.parentId, previous)
      cacheRef.value = new Map(cacheRef.value)
      const code = err instanceof Error ? err.message : String(err)
      lastError.value = code
      throw err
    }
  }

  /**
   * Confirme / décline une assignation existante. Optimistic update sur
   * `status` + `respondedAt`. Revert si throw.
   */
  async function respond(input: {
    kind: 'home' | 'away'
    parentId: string
    assignmentId: string
    status: 'confirmed' | 'declined'
  }): Promise<void> {
    const cacheRef =
      input.kind === 'home' ? homeAssignmentsByBookingId : awayAssignmentsByMatchId
    const previous = cacheRef.value.get(input.parentId) ?? []
    const next = previous.map((a) =>
      a.id === input.assignmentId
        ? {
            ...a,
            status: input.status,
            respondedAt: FsTimestamp.fromMillis(Date.now()),
          }
        : a,
    )
    cacheRef.value.set(input.parentId, next)
    cacheRef.value = new Map(cacheRef.value)

    try {
      if (!isFirestoreMode()) {
        logMockAction('officials.respond', input)
        return
      }
      if (input.kind === 'home') {
        await respondToBookingAssignment({
          bookingId: input.parentId,
          assignmentId: input.assignmentId,
          status: input.status,
        })
      } else {
        await respondToMatchAssignment({
          matchId: input.parentId,
          assignmentId: input.assignmentId,
          status: input.status,
        })
      }
    } catch (err) {
      cacheRef.value.set(input.parentId, previous)
      cacheRef.value = new Map(cacheRef.value)
      const code = err instanceof Error ? err.message : String(err)
      lastError.value = code
      throw err
    }
  }

  /** Reset cache (déconnexion / switch saison admin). */
  function reset(): void {
    awayMatches.value = []
    matchTypesById.value = new Map()
    homeAssignmentsByBookingId.value = new Map()
    awayAssignmentsByMatchId.value = new Map()
    lastLoadedSeasonId.value = null
    lastError.value = null
    hydrated = false
  }

  // ─── Getters ────────────────────────────────────────────────────

  /**
   * MyAssignments — croise tous les assignments dont `memberId ===
   * auth.userDoc.memberId` avec leur parent (booking ou match). Regroupé par
   * status. Renvoie des objets stables — les vues peuvent diffuser sans
   * dégrader la réactivité.
   */
  const myAssignments = computed<{
    pending: ReadonlyArray<MyAssignmentEntry>
    confirmed: ReadonlyArray<MyAssignmentEntry>
    declined: ReadonlyArray<MyAssignmentEntry>
  }>(() => {
    const auth = useAuthStore()
    const memberId = auth.userDoc?.memberId ?? null
    if (!memberId) {
      return { pending: [], confirmed: [], declined: [] }
    }
    const bookingsStore = useBookingsStore()
    const teamsStore = useTeamsStore()
    const teamById = new Map<string, MockTeam>()
    for (const t of teamsStore.teams) teamById.set(t.id, t)

    const buckets: {
      pending: MyAssignmentEntry[]
      confirmed: MyAssignmentEntry[]
      declined: MyAssignmentEntry[]
    } = { pending: [], confirmed: [], declined: [] }

    // HOME
    for (const [bookingId, assigns] of homeAssignmentsByBookingId.value.entries()) {
      const mine = assigns.find((a) => a.memberId === memberId)
      if (!mine) continue
      const booking = bookingsStore.allBookings.find((b) => b.id === bookingId)
      if (!booking) continue
      const entry: MyAssignmentEntry = {
        assignment: mine,
        parent: { kind: 'home', booking },
        matchType: booking.matchTypeId
          ? (matchTypesById.value.get(booking.matchTypeId) ?? null)
          : null,
        team: booking.teamId ? (teamById.get(booking.teamId) ?? null) : null,
      }
      buckets[mine.status].push(entry)
    }

    // AWAY
    for (const [matchId, assigns] of awayAssignmentsByMatchId.value.entries()) {
      const mine = assigns.find((a) => a.memberId === memberId)
      if (!mine) continue
      const match = awayMatches.value.find((m) => m.id === matchId)
      if (!match) continue
      const entry: MyAssignmentEntry = {
        assignment: mine,
        parent: { kind: 'away', match },
        matchType: matchTypesById.value.get(match.matchTypeId) ?? null,
        team: teamById.get(match.teamId) ?? null,
      }
      buckets[mine.status].push(entry)
    }

    // Tri stable par date du parent ASC.
    const sortByDateAsc = (a: MyAssignmentEntry, b: MyAssignmentEntry): number => {
      const ams =
        a.parent.kind === 'home' ? a.parent.booking.startMs : tsToMs(a.parent.match.date)
      const bms =
        b.parent.kind === 'home' ? b.parent.booking.startMs : tsToMs(b.parent.match.date)
      return ams - bms
    }
    buckets.pending.sort(sortByDateAsc)
    buckets.confirmed.sort(sortByDateAsc)
    buckets.declined.sort(sortByDateAsc)

    return buckets
  })

  /**
   * Compte les matchs **incomplets** (futurs uniquement) : staffing pas
   * complet (HOME ou AWAY) OU (HOME && pas de salle attribuée, i.e.
   * `venueId === ''` ou `courtId === ''`). Sert au badge sidebar
   * `OpenMatches` + filtre par défaut.
   */
  const incompleteMatchesCount = computed<number>(() => {
    const bookingsStore = useBookingsStore()
    let count = 0
    for (const booking of bookingsStore.allBookings) {
      if (booking.slotType !== 'match_home') continue
      if (!isFutureBooking(booking)) continue
      if (!hasConfirmedOpponent(booking.opponentName)) continue
      const mt = booking.matchTypeId
        ? matchTypesById.value.get(booking.matchTypeId)
        : null
      const requirements = mt?.homeOfficialRequirements ?? []
      const assigns = homeAssignmentsByBookingId.value.get(booking.id) ?? []
      const requiredTotal = requirements.reduce((s, r) => s + r.count, 0)
      const taken = assigns.filter((a) => a.status !== 'declined').length
      const staffingIncomplete = taken < requiredTotal
      const noVenue = !booking.venueId || !booking.courtId
      if (staffingIncomplete || noVenue) count += 1
    }
    for (const match of awayMatches.value) {
      if (!isFuture(match.date)) continue
      if (!hasConfirmedOpponent(match.opponentName)) continue
      const mt = matchTypesById.value.get(match.matchTypeId)
      const required = mt?.awayOfficialCount ?? 0
      const assigns = awayAssignmentsByMatchId.value.get(match.id) ?? []
      const taken = assigns.filter((a) => a.status !== 'declined').length
      if (taken < required) count += 1
    }
    return count
  })

  /**
   * Opportunités ouvertes pour le niveau du caller. Exclut les matchs
   * passés.
   *
   *  - HOME : ouvre si `homeOfficialRequirements` contient le `level`
   *    demandé ET qu'il reste un slot non-pris pour ce level.
   *  - AWAY : ouvre si `awayOfficialCount > 0` ET qu'il reste un slot
   *    global non-pris (le niveau de l'officiel n'est pas filtré côté AWAY
   *    — cf. `matchType.awayOfficialCount` `number`).
   */
  function openOpportunitiesForLevel(level: number): ReadonlyArray<OpportunityEntry> {
    const bookingsStore = useBookingsStore()
    const teamsStore = useTeamsStore()
    const teamById = new Map<string, MockTeam>()
    for (const t of teamsStore.teams) teamById.set(t.id, t)

    const out: OpportunityEntry[] = []

    // HOME
    for (const booking of bookingsStore.allBookings) {
      if (booking.slotType !== 'match_home') continue
      if (!isFutureBooking(booking)) continue
      if (!hasConfirmedOpponent(booking.opponentName)) continue
      const mt = booking.matchTypeId
        ? (matchTypesById.value.get(booking.matchTypeId) ?? null)
        : null
      const requirements = mt?.homeOfficialRequirements ?? []
      const assigns = homeAssignmentsByBookingId.value.get(booking.id) ?? []
      const openSlots = openHomeSlotsForLevel(requirements, assigns, level)
      if (openSlots <= 0) continue
      const location =
        booking.venueName && booking.courtName
          ? `${booking.venueName} · ${booking.courtName}`
          : 'Salle non attribuée'
      out.push({
        kind: 'home',
        parentId: booking.id,
        matchType: mt,
        team: booking.teamId ? (teamById.get(booking.teamId) ?? null) : null,
        date: FsTimestamp.fromMillis(booking.startMs),
        startTime: booking.startTime,
        endTime: booking.endTime,
        opponentName: booking.opponentName,
        location,
        openSlots,
      })
    }

    // AWAY
    for (const match of awayMatches.value) {
      if (!isFuture(match.date)) continue
      if (!hasConfirmedOpponent(match.opponentName)) continue
      const mt = matchTypesById.value.get(match.matchTypeId) ?? null
      const assigns = awayAssignmentsByMatchId.value.get(match.id) ?? []
      const openSlots = openAwaySlots(mt?.awayOfficialCount ?? 0, assigns)
      if (openSlots <= 0) continue
      out.push({
        kind: 'away',
        parentId: match.id,
        matchType: mt,
        team: teamById.get(match.teamId) ?? null,
        date: match.date,
        startTime: match.startTime,
        endTime: match.endTime,
        opponentName: match.opponentName,
        location: match.awayAddress,
        openSlots,
      })
    }

    out.sort((a, b) => tsToMs(a.date) - tsToMs(b.date))
    return out
  }

  return {
    // state
    awayMatches,
    matchTypesById,
    homeAssignmentsByBookingId,
    awayAssignmentsByMatchId,
    loading,
    lastError,
    source,
    lastLoadedSeasonId,
    // actions
    loadOfficialContext,
    selfRegister,
    respond,
    reset,
    // getters
    myAssignments,
    incompleteMatchesCount,
    openOpportunitiesForLevel,
  }
})

// Re-exports pour que les vues n'aient qu'un point d'entrée (le store).
export type { OfficialAssignment, Match, MatchType }

// Marque `useActiveSeason` comme dépendance optionnelle utilisée par les vues
// (pour qu'elles puissent appeler `loadOfficialContext(seasonId)` avec un
// seasonId résolu). Pas d'auto-load ici — choix volontaire pour rester
// compatible avec le mode mock (pas de saison Firestore).
export { useActiveSeason }
