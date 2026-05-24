/**
 * Store Bookings — Source unique des réservations pour la coach app.
 *
 * Hybride mock + Firestore réel (cf. pattern `apps/courtbase-app/CLAUDE.md`
 * + mémoire `courtbase_app_firestore_wiring`) :
 *  - **Firestore réel** quand `auth.userDoc.memberId` existe.
 *  - **Mock fallback** sinon — dérive `allBookings` depuis `MOCK_MATCHES`
 *    (la couche mock ne stocke pas de bookings ; on synthétise les rows
 *    nécessaires pour les vues consommatrices).
 *
 * **Source unique = saison complète DU CLUB** (cf. mémoire
 * `project_bookings_source_unique`). Le fetch ne filtre PLUS par
 * `teamIds` — on charge tous les bookings du club pour que la vue Agenda
 * puisse afficher en overlay "Tout le club" sans re-fetch.
 *
 * Un seul fetch hydrate à la fois :
 *  - le calendrier Agenda (mes équipes + overlay club entier).
 *  - le calendrier TeamPlanning (filtrage JS par équipe + plage).
 *  - la vue Liste de l'Agenda (filtre + tri client-side).
 *
 * La navigation calendrier (day/week/month) ne déclenche AUCUN re-fetch —
 * on consomme `allBookings` côté composant.
 *
 * Discriminer "mes events" vs "autres" : getters `myTeamIds` + `isMyBooking`.
 */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { useActiveSeason } from '@/composables/useSeason'
import { useAuthStore } from '@/stores/auth'
import { useTeamsStore } from '@/stores/teams'
import {
  cancelTrainingBooking,
  listBookingsForSeason,
  listVenuesWithCourtsLite,
  type BookingRow,
  type TeamLite,
  type VenueWithCourtsLite,
} from '@/repositories/bookings.repo'
import { logMockAction } from '@/repositories/mock'
import { MOCK_MATCHES } from '@/repositories/mock/seeds'
import type { MockMatch } from '@/types/mock'

export type BookingsSource = 'firestore' | 'mock'

// ─── Helpers ─────────────────────────────────────────────────────────

/** Construit un epoch ms local à partir d'un ISO `yyyy-mm-dd` + "HH:MM". */
function dateAndTimeToMs(dateIso: string, hhmm: string): number {
  const dateParts = dateIso.split('-')
  const timeParts = hhmm.split(':')
  const y = Number(dateParts[0] ?? '0')
  const m = Number(dateParts[1] ?? '1') - 1
  const d = Number(dateParts[2] ?? '0')
  const hh = Number(timeParts[0] ?? '0')
  const mm = Number(timeParts[1] ?? '0')
  return new Date(y, m, d, hh, mm, 0, 0).getTime()
}

/** Ajoute `hours` (peut être fractionnaire) à une "HH:MM" → "HH:MM". */
function addHoursToHHMM(hhmm: string, hours: number): string {
  const parts = hhmm.split(':')
  const hh = Number(parts[0] ?? '0')
  const mm = Number(parts[1] ?? '0')
  const totalMinutes = hh * 60 + mm + Math.round(hours * 60)
  const outH = Math.floor(totalMinutes / 60) % 24
  const outM = totalMinutes % 60
  return `${String(outH).padStart(2, '0')}:${String(outM).padStart(2, '0')}`
}

/**
 * Synthétise des `BookingRow` mock à partir de `MOCK_MATCHES`. Les
 * `MockMatch` n'ont pas la granularité d'un booking Firestore (`venueId`,
 * `courtId`, `seasonId`…) — on injecte des stubs lisibles côté UI pour ne
 * pas casser les filtres. Pas de mock pour les entraînements/freed (les
 * fixtures mock n'en exposent pas) — la vue "Créneaux libres" affichera
 * naturellement un empty-state.
 */
function mockBookingsFromMatches(matches: readonly MockMatch[]): BookingRow[] {
  return matches.map((m) => {
    const endTime = addHoursToHHMM(m.startTime, m.durationHours)
    const startMs = dateAndTimeToMs(m.date, m.startTime)
    const endMs = dateAndTimeToMs(m.date, endTime)
    return {
      id: `mock-${m.id}`,
      seasonId: 'mock-season',
      venueId: m.kind === 'home' ? 'mock-venue-home' : '',
      venueName: m.venueLabel,
      courtId: m.kind === 'home' ? 'mock-court-a' : '',
      courtName: m.venueLabel,
      teamId: m.teamId,
      teamName: null,
      coachLabel: null,
      slotType: m.kind === 'home' ? 'match_home' : 'match_away',
      matchTypeId: null,
      opponentName: m.opponent,
      date: m.date,
      startMs,
      endMs,
      startTime: m.startTime,
      endTime,
      status: 'scheduled',
      cancelReason: null,
      seriesId: null,
      isCombinedCourtEvent: false,
    }
  })
}

// ─── Store ────────────────────────────────────────────────────────────

export const useBookingsStore = defineStore('bookings', () => {
  // ─── State ──────────────────────────────────────────────────────

  /**
   * Source unique : tous les bookings de la saison active. Filtré par les
   * vues côté JS (semaine, équipe, statut). Ne contient JAMAIS de
   * doublons — `cancelTraining` mute l'entrée existante.
   */
  const allBookings = ref<BookingRow[]>([])

  /** Référentiel salle/courts pour la vue calendrier (splits). */
  const venues = ref<VenueWithCourtsLite[]>([])

  /**
   * Teams du coach (chargées via le store teams ; recopiées ici en `TeamLite`
   * pour avoir un point d'accès direct sans coupler les autres stores).
   */
  const teams = ref<TeamLite[]>([])

  /** True pendant le premier fetch (loadActiveContext). */
  const loading = ref(false)
  /** True pendant un `cancelTraining` in-flight. */
  const mutating = ref(false)
  const lastError = ref<string | null>(null)
  const source = ref<BookingsSource>('mock')

  /** Garde anti-double-fetch : `loadActiveContext` ne fetch qu'une fois. */
  let hydrated = false

  // ─── Mode discrimination ────────────────────────────────────────

  /**
   * Mode Firestore quand le coach a un memberId réel. Sinon mode mock
   * (cohérent avec `licenseRequests` / `teams`).
   */
  function isFirestoreMode(): boolean {
    const auth = useAuthStore()
    return Boolean(auth.userDoc?.memberId)
  }

  // ─── Actions ────────────────────────────────────────────────────

  /**
   * Premier chargement : saison active + venues + teams du coach + TOUS les
   * bookings de la saison (club entier). Idempotent — un second appel ne
   * refetch pas (réinvalider via `invalidate()`).
   *
   * Stratégie firestore : on charge les teams du coach via `useTeamsStore`
   * (sert au getter `isMyBooking`) puis on charge TOUTE la saison sans filtre
   * `teamIds` — la vue Agenda a besoin de l'overlay club entier sans re-fetch.
   *
   * Stratégie mock : on synthétise depuis `MOCK_MATCHES`. Pas d'erreur fatale.
   */
  async function loadActiveContext(): Promise<void> {
    if (hydrated) return
    loading.value = true
    lastError.value = null

    try {
      if (!isFirestoreMode()) {
        // ─── Mock path ────────────────────────────────────────────
        source.value = 'mock'
        allBookings.value = mockBookingsFromMatches(MOCK_MATCHES)
        venues.value = []
        teams.value = []
        hydrated = true
        return
      }

      // ─── Firestore path ───────────────────────────────────────
      source.value = 'firestore'
      const auth = useAuthStore()
      const teamsStore = useTeamsStore()
      const coachMemberId = auth.userDoc?.memberId ?? null

      // Charge la saison + les teams du coach en parallèle. Les teams
      // alimentent le getter `myTeamIds` pour discriminer "mes events" vs
      // overlay club entier côté UI — elles ne filtrent PLUS le fetch.
      const seasonStore = useActiveSeason()
      const [seasonId] = await Promise.all([
        seasonStore.seasonId.value ?? seasonStore.load(),
        teamsStore.loadForCoach(coachMemberId, auth.uid),
      ])
      if (!seasonId) {
        // Pas de saison active : on logue + UI dégrade en empty state.
        console.warn('[bookings.store] loadActiveContext: no active season')
        allBookings.value = []
        venues.value = []
        teams.value = []
        hydrated = true
        return
      }

      const coachTeams = teamsStore.teams

      // Lite copy des teams du coach pour le getter `myTeamIds` + accès local
      // (les vues peuvent joindre `teamName` sans rappeler `teamsStore`).
      // Note : `coachLabel` n'est pas calculé ici (le `teamsStore` ne le
      // dénormalise pas). C'est tolérable : ce `teams.value` sert au getter
      // `isMyBooking(b)` qui ne lit que `id`. Le `coachLabel` exposé côté
      // UI vient de `BookingRow.coachLabel` (renseigné par le repo bookings).
      const teamsLite: TeamLite[] = coachTeams.map((t) => ({
        id: t.id,
        name: t.name,
        categoryName: t.categoryName ?? null,
        coachLabel: null,
      }))
      teams.value = teamsLite

      // Fetch TOUS les bookings du club (pas de filtre teamIds) — la vue
      // Agenda permet d'overlay les events des autres équipes. Volumétrie
      // attendue : quelques centaines de docs / saison pour un club typique.
      const [venuesResult, bookingsResult] = await Promise.all([
        listVenuesWithCourtsLite(),
        listBookingsForSeason(seasonId),
      ])
      venues.value = venuesResult
      allBookings.value = bookingsResult
      hydrated = true
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err)
      console.error('[bookings.store] loadActiveContext failed', err)
      lastError.value = code
    } finally {
      loading.value = false
    }
  }

  /**
   * Annule un entraînement → status `freed`. En mode firestore : write
   * client direct via repo. En mode mock : `logMockAction` + mute l'entrée
   * dans `allBookings` pour démo immédiate.
   *
   * Met à jour `allBookings` post-success (clone array pour réactivité).
   *
   * @throws si le booking n'existe pas dans le cache ou si le repo throw.
   */
  async function cancelTraining(input: {
    bookingId: string
    note?: string | null
  }): Promise<void> {
    mutating.value = true
    lastError.value = null
    try {
      const target = allBookings.value.find((b) => b.id === input.bookingId)
      if (!target) {
        throw new Error('Réservation introuvable.')
      }

      if (!isFirestoreMode()) {
        // Mode mock : log + mute immédiate pour démo.
        logMockAction('co5.cancel-training', {
          bookingId: input.bookingId,
          note: input.note ?? null,
        })
      } else {
        const auth = useAuthStore()
        const uid = auth.authSnap?.uid ?? null
        if (!uid) throw new Error('Non authentifié.')
        await cancelTrainingBooking({
          bookingId: input.bookingId,
          callerUid: uid,
          note: input.note ?? null,
        })
      }

      // Update local — clone l'array pour la réactivité.
      const updated: BookingRow = {
        ...target,
        status: 'freed',
        cancelReason: 'coach_cancel',
      }
      allBookings.value = allBookings.value.map((b) =>
        b.id === updated.id ? updated : b,
      )
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err)
      lastError.value = code
      throw err
    } finally {
      mutating.value = false
    }
  }

  /**
   * Vide le cache et marque la prochaine `loadActiveContext` comme à
   * refetch. Appelé sur sign-out + sur un futur switch de saison admin.
   */
  function invalidate(): void {
    allBookings.value = []
    venues.value = []
    teams.value = []
    hydrated = false
    lastError.value = null
  }

  // ─── Getters ────────────────────────────────────────────────────

  /**
   * Liste des teamIds coachés par le user courant. Lue par la vue Agenda
   * pour discriminer "mes events" vs "autres équipes" en overlay.
   */
  const myTeamIds = computed<ReadonlyArray<string>>(() =>
    teams.value.map((t) => t.id),
  )

  /**
   * True si le booking appartient à une des teams du coach. Un booking
   * sans `teamId` (extrêmement rare — typiquement une réserve admin) est
   * considéré comme "autre".
   */
  function isMyBooking(b: Pick<BookingRow, 'teamId'>): boolean {
    if (!b.teamId) return false
    return myTeamIds.value.includes(b.teamId)
  }

  /** Bookings d'une équipe (alias filtre). */
  function bookingsForTeam(teamId: string): BookingRow[] {
    return allBookings.value.filter((b) => b.teamId === teamId)
  }

  /**
   * Bookings dans une plage epoch ms (startMs >= range.start && startMs < range.end).
   * Optionnellement filtré par équipe.
   *
   * Borne fin EXCLUSIVE — convention vue-cal (un event 18:00-19:30 est
   * affiché dans le jour qui contient `startMs`, pas `endMs - 1`).
   */
  function bookingsInRange(
    startMs: number,
    endMs: number,
    opts?: { teamId?: string },
  ): BookingRow[] {
    return allBookings.value.filter((b) => {
      if (b.startMs < startMs || b.startMs >= endMs) return false
      if (opts?.teamId && b.teamId !== opts.teamId) return false
      return true
    })
  }

  /**
   * Créneaux libres à venir (status `freed` + start dans le futur), triés
   * par startMs ASC. Consommé par la vue "Créneaux libres".
   */
  const freedUpcoming = computed<BookingRow[]>(() => {
    const now = Date.now()
    return allBookings.value
      .filter((b) => b.status === 'freed' && b.startMs >= now)
      .slice()
      .sort((a, b) => a.startMs - b.startMs)
  })

  return {
    // state
    allBookings,
    venues,
    teams,
    loading,
    mutating,
    lastError,
    source,
    // actions
    loadActiveContext,
    cancelTraining,
    invalidate,
    // getters
    myTeamIds,
    isMyBooking,
    bookingsForTeam,
    bookingsInRange,
    freedUpcoming,
  }
})

// Re-export types pour que les vues n'aient qu'un point d'entrée (le store).
export type { BookingRow, VenueWithCourtsLite, TeamLite }
