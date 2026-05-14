import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  fetchActiveSeason,
  listBookingsInRange,
  listVenuesWithCourts,
  type BookingRow,
  type VenueWithCourts,
} from '@/repositories/bookings.repo'
import type { Season } from '@club-app/shared-types'

/**
 * Source unique des données de l'écran Season grid (/bookings).
 *
 * Architecture :
 *   - `loadActiveContext()` charge la saison active + la structure venues/courts
 *     (header du grid) une seule fois. À appeler `onMounted`.
 *   - `loadWeek(weekStart)` recharge les bookings de la semaine pointée par
 *     `currentWeekStart`. Idempotent — peut être appelé après navigation.
 *
 * Granularité de la semaine : lundi 00:00 → dimanche 23:59:59.999 (locale
 * de la machine), pour matcher le `startOfWeek` utilisé par le Dashboard.
 *
 * Voir docs/frontend-desktop.md (architecture en couches) : la vue
 * consomme ce store via Pinia, jamais directement le repo Firebase.
 */
export const useBookingsStore = defineStore('bookings', () => {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const bookings = ref<BookingRow[]>([])
  const venues = ref<VenueWithCourts[]>([])
  const activeSeason = ref<Season | null>(null)
  /** Lundi 00:00 local de la semaine affichée. */
  const currentWeekStart = ref<Date>(startOfWeek(new Date()))
  /** Filtre venue (id) ; `null` = toutes. */
  const venueFilter = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // ---------------------------------------------------------------------------
  // Computed
  // ---------------------------------------------------------------------------

  const activeSeasonId = computed<string | null>(() => activeSeason.value?.id ?? null)

  /**
   * Map indexée pour O(1) lookup côté vue. Key court = courtId,
   * key slot = "HH:MM-HH:MM" (combinaison startTime+endTime).
   * Plusieurs bookings sur la même cellule sont possibles si la DB est
   * mal-formée — on garde le PREMIER (les autres pourront être détectés
   * comme conflit dans un chantier futur).
   */
  const bookingsByCourtAndSlot = computed<Map<string, Map<string, BookingRow>>>(() => {
    const m = new Map<string, Map<string, BookingRow>>()
    for (const b of bookings.value) {
      const inner = m.get(b.courtId) ?? new Map<string, BookingRow>()
      const slotKey = `${b.startTime}-${b.endTime}`
      if (!inner.has(slotKey)) inner.set(slotKey, b)
      m.set(b.courtId, inner)
    }
    return m
  })

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
   * Premier chargement : saison active + structure venues/courts. Pas de
   * bookings ici — la vue enchaîne avec `loadWeek()`.
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
  }

  /**
   * Charge les bookings de la semaine pointée. Si pas de saison active,
   * vide la liste et garde l'état stable (la vue affichera l'empty state).
   */
  async function loadWeek(weekStart: Date): Promise<void> {
    currentWeekStart.value = startOfWeek(weekStart)
    if (!activeSeason.value) {
      bookings.value = []
      return
    }
    loading.value = true
    error.value = null
    try {
      const from = currentWeekStart.value
      const to = endOfWeek(currentWeekStart.value)
      bookings.value = await listBookingsInRange(activeSeason.value.id, from, to)
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur de chargement des bookings'
    } finally {
      loading.value = false
    }
  }

  function goToPreviousWeek(): void {
    const next = new Date(currentWeekStart.value)
    next.setDate(next.getDate() - 7)
    void loadWeek(next)
  }

  function goToNextWeek(): void {
    const next = new Date(currentWeekStart.value)
    next.setDate(next.getDate() + 7)
    void loadWeek(next)
  }

  function goToToday(): void {
    void loadWeek(new Date())
  }

  function setVenueFilter(id: string | null): void {
    venueFilter.value = id
  }

  return {
    // state
    bookings,
    venues,
    activeSeason,
    activeSeasonId,
    currentWeekStart,
    venueFilter,
    loading,
    error,
    // computed
    bookingsByCourtAndSlot,
    weekLabel,
    filteredVenues,
    // actions
    loadActiveContext,
    loadWeek,
    goToPreviousWeek,
    goToNextWeek,
    goToToday,
    setVenueFilter,
  }
})

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

/** Dimanche 23:59:59 local de la semaine contenant `from`. */
function endOfWeek(from: Date): Date {
  const d = startOfWeek(from)
  d.setDate(d.getDate() + 6)
  d.setHours(23, 59, 59, 999)
  return d
}
