import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  fetchActiveSeasonId,
  fetchOfficialsThresholds,
  listOfficialsWithLoad,
  type OfficialLoadStatus,
  type OfficialRow,
  type OfficialsThresholds,
} from '@/repositories/officials.repo'

/**
 * Filtres rapides (chips) pour la vue Officials. `all` désactive les autres.
 * `low` / `ok` / `high` / `critical` filtrent par `loadStatus` (cf. repo).
 */
export type OfficialsQuickFilter = 'all' | OfficialLoadStatus

/**
 * Store Officials — source unique des données de l'écran `/officials`.
 *
 * `load()` charge en parallèle saison active + seuils + liste enrichie. La
 * vue passe par `filtered` (dérivé du `quickFilter` actif). Voir
 * docs/frontend-desktop.md (architecture en couches) : la vue n'appelle
 * JAMAIS le repo directement.
 */
export const useOfficialsStore = defineStore('officials', () => {
  const officials = ref<OfficialRow[]>([])
  const thresholds = ref<OfficialsThresholds>({ min: 3, max: 9, target: 6 })
  const activeSeasonId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const quickFilter = ref<OfficialsQuickFilter>('all')

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      // Saison + seuils en parallèle ; la liste dépend de la saison.
      const [seasonId, t] = await Promise.all([
        fetchActiveSeasonId(),
        fetchOfficialsThresholds(),
      ])
      activeSeasonId.value = seasonId
      thresholds.value = t
      officials.value = await listOfficialsWithLoad(seasonId)
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur de chargement des officials'
    } finally {
      loading.value = false
    }
  }

  function setQuickFilter(value: OfficialsQuickFilter): void {
    quickFilter.value = value
  }

  // -------------------------------------------------------------------------
  // Group by loadStatus — alimente les stat-cards + counts des chips.
  // -------------------------------------------------------------------------

  const officialsByLoadStatus = computed<Record<OfficialLoadStatus, OfficialRow[]>>(() => {
    const out: Record<OfficialLoadStatus, OfficialRow[]> = {
      low: [],
      ok: [],
      high: [],
      critical: [],
    }
    for (const o of officials.value) {
      out[o.loadStatus].push(o)
    }
    return out
  })

  /** Counts par bucket — alignés sur l'ordre des chips (all en premier). */
  const counts = computed(() => {
    const g = officialsByLoadStatus.value
    return {
      all: officials.value.length,
      low: g.low.length,
      ok: g.ok.length,
      high: g.high.length,
      critical: g.critical.length,
    }
  })

  // -------------------------------------------------------------------------
  // Filtered list — drive le DataTable.
  // -------------------------------------------------------------------------

  const filtered = computed<OfficialRow[]>(() => {
    const f = quickFilter.value
    if (f === 'all') return officials.value
    return officials.value.filter((o) => o.loadStatus === f)
  })

  return {
    // state
    officials,
    thresholds,
    activeSeasonId,
    loading,
    error,
    quickFilter,
    // derived
    officialsByLoadStatus,
    counts,
    filtered,
    // actions
    load,
    setQuickFilter,
  }
})
