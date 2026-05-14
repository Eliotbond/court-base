import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { FirebaseError } from 'firebase/app'
import {
  createBookingSeries as repoCreateBookingSeries,
  createManualBooking as repoCreateManualBooking,
  deleteBooking as repoDeleteBooking,
  deleteBookingSeries as repoDeleteBookingSeries,
  detectBookingConflicts,
  editBooking as repoEditBooking,
  expandRecurrence,
  fetchActiveSeason,
  filterDatesByVenueClosures,
  hardDeleteBooking as repoHardDeleteBooking,
  listAllBookingsForSeason,
  listAllSeriesForSeason,
  listVenuesWithCourts,
  type AppliedClosure,
  type BookingPatch,
  type BookingRow,
  type EditScope,
  type SeriesSummary,
  type VenueWithCourts,
} from '@/repositories/bookings.repo'
import type {
  MonthlyMode,
  RecurrenceFrequency,
  RecurrenceRule,
  Season,
  SlotType,
} from '@club-app/shared-types'
import { useAuthStore } from '@/stores/auth'

/**
 * Source unique des données de l'écran Season grid (/bookings).
 *
 * Stratégie de chargement : on tire **tous** les bookings de la saison
 * active en une seule query (`loadAllBookingsAndSeries`) — la grille
 * Planning filtre ensuite côté JS par jour sélectionné. Avantages :
 *  - Pas de re-fetch lors de la navigation semaine ⇒ instant.
 *  - Un booking nouvellement créé apparaît immédiatement, quelle que soit
 *    la semaine affichée (plus de bug "ma série est invisible").
 *
 * Volumétrie attendue < ~1000 docs/saison (cf. doc du repo).
 *
 * Voir docs/frontend-desktop.md (architecture en couches) : la vue
 * consomme ce store via Pinia, jamais directement le repo Firebase.
 */
export const useBookingsStore = defineStore('bookings', () => {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const venues = ref<VenueWithCourts[]>([])
  const activeSeason = ref<Season | null>(null)
  /** Lundi 00:00 local de la semaine affichée (filtre client-side). */
  const currentWeekStart = ref<Date>(startOfWeek(new Date()))
  /** Filtre venue (id) ; `null` = toutes. */
  const venueFilter = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Source unique : tous les bookings + séries de la saison active.
  // Alimente la grille Planning (filtrage JS par semaine/jour) ET le panneau
  // Liste. Chargé via `loadAllBookingsAndSeries()` à `loadActiveContext()` puis
  // re-chargé après chaque mutation.
  const allBookings = ref<BookingRow[]>([])
  const allSeries = ref<SeriesSummary[]>([])
  const listLoading = ref(false)
  const listError = ref<string | null>(null)

  // ---------------------------------------------------------------------------
  // Computed
  // ---------------------------------------------------------------------------

  const activeSeasonId = computed<string | null>(() => activeSeason.value?.id ?? null)

  /** Libellé de la semaine "Semaine du 12 mai 2025". */
  const weekLabel = computed<string>(() => {
    const start = currentWeekStart.value
    const fmt = new Intl.DateTimeFormat('fr-CH', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    return `Semaine du ${fmt.format(start)}`
  })

  /** Venues filtrés (utilisé par la vue pour construire l'en-tête du grid). */
  const filteredVenues = computed<VenueWithCourts[]>(() => {
    if (venueFilter.value === null) return venues.value
    return venues.value.filter((v) => v.id === venueFilter.value)
  })

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * Premier chargement : saison active + structure venues/courts + tous les
   * bookings/séries de la saison. Une seule passe : la grille Planning et
   * le panneau Liste partagent ensuite la même source `allBookings`.
   */
  async function loadActiveContext(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const [season, venuesResult] = await Promise.all([
        fetchActiveSeason(),
        listVenuesWithCourts(),
      ])
      activeSeason.value = season
      venues.value = venuesResult
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur de chargement du contexte saison'
    } finally {
      loading.value = false
    }
    // `loadAllBookingsAndSeries` gère ses propres erreurs via `listError`.
    if (activeSeason.value) {
      await loadAllBookingsAndSeries()
    }
  }

  /**
   * Navigation semaine purement client-side : on déplace juste le pointeur
   * `currentWeekStart`. La vue re-calcule son filtrage par jour. Pas de
   * re-fetch Firestore — `allBookings` reste valable.
   */
  function goToPreviousWeek(): void {
    const next = new Date(currentWeekStart.value)
    next.setDate(next.getDate() - 7)
    currentWeekStart.value = startOfWeek(next)
  }

  function goToNextWeek(): void {
    const next = new Date(currentWeekStart.value)
    next.setDate(next.getDate() + 7)
    currentWeekStart.value = startOfWeek(next)
  }

  function goToToday(): void {
    currentWeekStart.value = startOfWeek(new Date())
  }

  function setVenueFilter(id: string | null): void {
    venueFilter.value = id
  }

  // ---------------------------------------------------------------------------
  // Manual bookings — CRUD + preview wizard
  // ---------------------------------------------------------------------------
  //
  // Pattern d'erreur :
  //   - `loading.value = true` puis `try/finally`.
  //   - `error.value = e.message` côté store pour bannière globale éventuelle.
  //   - Re-throw au caller : le dialog UI fait sa propre validation
  //     contextuelle (afficher les conflits, déclencher des toasts, etc.).
  //   - Pré-conditions : uid + seasonId → throw AVANT tout appel repo.
  // Après chaque mutation : `loadAllBookingsAndSeries()` recharge la source
  // unique (bookings + séries) — la grille Planning et le panneau Liste se
  // mettent à jour automatiquement.

  /** Récupère le uid courant ou throw `'not authenticated'` si absent. */
  function requireUid(): string {
    const auth = useAuthStore()
    const uid = auth.authSnap?.uid ?? null
    if (!uid) throw new Error('not authenticated')
    return uid
  }

  /** Récupère l'id de saison active ou throw `'no active season'`. */
  function requireSeasonId(): string {
    const id = activeSeason.value?.id ?? null
    if (!id) throw new Error('no active season')
    return id
  }

  /**
   * Récupère la date de début de la saison active (borne min des bookings).
   * Le `Timestamp` neutre exporté par shared-types n'expose pas `.toDate()` ;
   * on lit `seconds` (présent sur le Timestamp Firestore SDK aussi).
   */
  function requireSeasonStartDate(): Date {
    const season = activeSeason.value
    if (!season) throw new Error('no active season')
    const ts = season.startDate as unknown as { seconds: number; toDate?: () => Date }
    if (typeof ts.toDate === 'function') return ts.toDate()
    return new Date(ts.seconds * 1000)
  }

  /** Form input du dialog one-shot. */
  interface ManualBookingForm {
    venueId: string
    courtId: string
    date: Date
    startTime: string
    endTime: string
    teamId: string | null
    slotType: SlotType
    matchTypeId: string | null
    title: string
    notes: string | null
  }

  /**
   * Form input du dialog série.
   *
   * NOTE — pas de `considerClosures` : les séries respectent toujours les
   * fermetures de salle (cf. `createBookingSeries` côté repo). Le bypass
   * volontaire reste possible pour les bookings one-shot manuels via
   * `createManualBooking`.
   */
  interface SeriesForm {
    venueId: string
    courtId: string
    startDate: Date
    endDate: Date
    startTime: string
    endTime: string
    teamId: string | null
    slotType: SlotType
    matchTypeId: string | null
    title: string
    notes: string | null
    recurrence: RecurrenceRule
  }

  /**
   * Crée un booking one-shot manuel.
   * Re-throw au caller pour permettre l'affichage local de l'erreur.
   */
  async function createManualBooking(form: ManualBookingForm): Promise<void> {
    const createdBy = requireUid()
    const seasonId = requireSeasonId()
    const seasonStartDate = requireSeasonStartDate()
    loading.value = true
    error.value = null
    try {
      await repoCreateManualBooking({
        seasonId,
        seasonStartDate,
        venueId: form.venueId,
        courtId: form.courtId,
        date: form.date,
        startTime: form.startTime,
        endTime: form.endTime,
        teamId: form.teamId,
        slotType: form.slotType,
        matchTypeId: form.matchTypeId,
        title: form.title,
        notes: form.notes,
        createdBy,
      })
      await loadAllBookingsAndSeries()
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur de création du booking'
      throw e
    } finally {
      loading.value = false
    }
  }

  /**
   * Crée une série + N bookings. Pré-valide via `previewSeries` —
   * si des conflits subsistent, throw avant write.
   */
  async function createSeries(form: SeriesForm): Promise<void> {
    const createdBy = requireUid()
    const seasonId = requireSeasonId()
    const seasonStartDate = requireSeasonStartDate()
    loading.value = true
    error.value = null
    try {
      const preview = await previewSeriesInternal(form)
      if (preview.conflicts.length > 0) {
        throw new Error(
          `series has ${preview.conflicts.length} conflicting occurrence(s)`,
        )
      }
      await repoCreateBookingSeries({
        seasonId,
        seasonStartDate,
        venueId: form.venueId,
        courtId: form.courtId,
        teamId: form.teamId,
        slotType: form.slotType,
        matchTypeId: form.matchTypeId,
        startDate: form.startDate,
        endDate: form.endDate,
        startTime: form.startTime,
        endTime: form.endTime,
        recurrence: form.recurrence,
        title: form.title,
        notes: form.notes,
        createdBy,
      })
      await loadAllBookingsAndSeries()
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur de création de la série'
      throw e
    } finally {
      loading.value = false
    }
  }

  /**
   * Résultat d'un preview de série — exposé tel quel à l'UI.
   *
   * - `kept` : dates retenues après filtrage closures + détection conflits.
   * - `skipped` : dates supprimées par les fermetures du venue.
   * - `conflicts` : dates retirées pour cause de conflit booking existant.
   * - `closures` : fermetures concrètes qui ont causé au moins un skip,
   *   avec leur nom, leurs bornes, leur source (`period` | `custom`) et la
   *   liste des dates qu'elles couvrent. Permet à l'UI d'afficher "Skippé :
   *   3 dates (vacances de Noël, journée portes ouvertes)".
   */
  interface SeriesPreviewResult {
    kept: Date[]
    skipped: Date[]
    conflicts: { date: Date }[]
    closures: AppliedClosure[]
  }

  /**
   * Implémentation interne du preview — réutilisée par `createSeries` pour
   * pré-valider AVANT write sans toucher au state global `loading`/`error`.
   *
   * Applique systématiquement le filtrage closures (cohérent avec
   * `createBookingSeries` qui ne propose plus de bypass).
   */
  async function previewSeriesInternal(form: SeriesForm): Promise<SeriesPreviewResult> {
    const expanded = expandRecurrence(form.recurrence, form.startDate, form.endDate)
    let kept = expanded
    let skipped: Date[] = []
    let closures: AppliedClosure[] = []
    if (expanded.length > 0) {
      const filtered = await filterDatesByVenueClosures(form.venueId, expanded)
      kept = filtered.kept
      skipped = filtered.skipped
      closures = filtered.closures
    }
    if (kept.length === 0) {
      return { kept: [], skipped, conflicts: [], closures }
    }
    const conflictsRaw = await detectBookingConflicts(
      form.courtId,
      kept,
      form.startTime,
      form.endTime,
    )
    const conflictDates = new Set(
      conflictsRaw.map((c) => c.date.getTime()),
    )
    const conflicts = conflictsRaw.map((c) => ({ date: c.date }))
    const finalKept = kept.filter((d) => !conflictDates.has(d.getTime()))
    return { kept: finalKept, skipped, conflicts, closures }
  }

  /**
   * Preview live pour le wizard de création de série. Ne déclenche pas
   * `loading`/`error` au state global — le dialog peut afficher un
   * indicateur local au besoin. Re-throw les erreurs.
   */
  async function previewSeries(form: SeriesForm): Promise<SeriesPreviewResult> {
    // Pré-conditions (pas d'écriture, mais on garde un comportement cohérent).
    requireSeasonId()
    return previewSeriesInternal(form)
  }

  /**
   * Édite un booking. Recharge la semaine après succès.
   * Pour scope 'future'/'all', le repo skip les bookings passés sur les
   * champs date/time/courtId (cf. `bookings.repo.ts → editBooking`).
   */
  async function editBooking(
    bookingId: string,
    scope: EditScope,
    patch: BookingPatch,
  ): Promise<void> {
    const editorUid = requireUid()
    loading.value = true
    error.value = null
    try {
      await repoEditBooking(bookingId, scope, patch, editorUid)
      await loadAllBookingsAndSeries()
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur de modification du booking'
      throw e
    } finally {
      loading.value = false
    }
  }

  /**
   * Annule (cancel) ou supprime un booking selon le scope (cf. repo).
   * Recharge la semaine après succès.
   */
  async function deleteBooking(
    bookingId: string,
    scope: EditScope,
  ): Promise<void> {
    const editorUid = requireUid()
    loading.value = true
    error.value = null
    try {
      await repoDeleteBooking(bookingId, scope, editorUid)
      await loadAllBookingsAndSeries()
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur de suppression du booking'
      throw e
    } finally {
      loading.value = false
    }
  }

  // ---------------------------------------------------------------------------
  // Panneau "Liste" : toutes les réservations + toutes les séries d'une saison.
  // ---------------------------------------------------------------------------

  /**
   * Charge en parallèle `allBookings` (saison complète) et `allSeries`
   * (résumés avec compteurs). Si pas de saison active, vide les listes et
   * return sans erreur. State séparé (`listLoading` / `listError`) pour ne
   * pas interférer avec la grille hebdo.
   */
  async function loadAllBookingsAndSeries(): Promise<void> {
    if (activeSeason.value === null) {
      allBookings.value = []
      allSeries.value = []
      return
    }
    const seasonId = activeSeason.value.id
    listLoading.value = true
    listError.value = null
    try {
      const [bookingsResult, seriesResult] = await Promise.all([
        listAllBookingsForSeason(seasonId),
        listAllSeriesForSeason(seasonId),
      ])
      allBookings.value = bookingsResult
      allSeries.value = seriesResult
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`loadAllBookingsAndSeries failed [${code}]`, err)
      listError.value =
        err instanceof Error
          ? err.message
          : 'Erreur de chargement de la liste des réservations'
    } finally {
      listLoading.value = false
    }
  }

  /**
   * Supprime une série entière (`/bookingSeries/{id}` + tous les bookings
   * futurs scheduled). Préserve les bookings passés et déjà cancelled.
   * Recharge ensuite la liste complète + la grille hebdo (qui peut contenir
   * des occurrences supprimées).
   *
   * Retourne `{ deletedFuture, keptPast }` pour permettre à l'UI d'afficher
   * un toast / log explicite.
   */
  async function deleteSeries(
    seriesId: string,
  ): Promise<{ deletedFuture: number; keptPast: number }> {
    const editorUid = requireUid()
    listLoading.value = true
    listError.value = null
    try {
      const result = await repoDeleteBookingSeries(seriesId, editorUid)
      await loadAllBookingsAndSeries()
      return result
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`deleteSeries failed [${code}]`, err)
      listError.value =
        err instanceof Error ? err.message : 'Erreur de suppression de la série'
      throw err
    } finally {
      listLoading.value = false
    }
  }

  /**
   * Supprime physiquement un booking (sans soft cancel, sans garde "past").
   * À utiliser depuis le panneau "Liste" pour un cleanup propre.
   * Recharge la liste complète + la grille hebdo.
   */
  async function hardDeleteBookingAction(bookingId: string): Promise<void> {
    listLoading.value = true
    listError.value = null
    try {
      await repoHardDeleteBooking(bookingId)
      await loadAllBookingsAndSeries()
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`hardDeleteBookingAction failed [${code}]`, err)
      listError.value =
        err instanceof Error
          ? err.message
          : 'Erreur de suppression du booking'
      throw err
    } finally {
      listLoading.value = false
    }
  }

  return {
    // state
    venues,
    activeSeason,
    activeSeasonId,
    currentWeekStart,
    venueFilter,
    loading,
    error,
    // state — source unique
    allBookings,
    allSeries,
    listLoading,
    listError,
    // computed
    weekLabel,
    filteredVenues,
    // actions
    loadActiveContext,
    goToPreviousWeek,
    goToNextWeek,
    goToToday,
    setVenueFilter,
    // manual bookings
    createManualBooking,
    createSeries,
    previewSeries,
    editBooking,
    deleteBooking,
    // panneau "Liste"
    loadAllBookingsAndSeries,
    deleteSeries,
    hardDeleteBookingAction,
  }
})

// ---------------------------------------------------------------------------
// Re-exports types — pour que les composants UI n'aient qu'un point d'entrée
// (le store) sans dépendance directe au repo ni à `@club-app/shared-types`.
// ---------------------------------------------------------------------------

export type {
  AppliedClosure,
  BookingPatch,
  EditScope,
  MonthlyMode,
  RecurrenceFrequency,
  RecurrenceRule,
  SeriesSummary,
}

// ---------------------------------------------------------------------------
// Date helpers — alignés sur la convention du Dashboard (semaine lundi→dimanche).
// ---------------------------------------------------------------------------

/** Lundi 00:00 local de la semaine contenant `from`. */
function startOfWeek(from: Date): Date {
  const d = new Date(from)
  const day = d.getDay() // 0 = dimanche
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}
