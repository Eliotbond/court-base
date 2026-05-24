import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  fetchActiveSeasonId,
  fetchOfficialsThresholds,
  listOfficialsWithMetrics,
  type OfficialLoadStatus,
  type OfficialMetricsRow,
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
/**
 * Filtre du tab "Officiels" — Tous vs Actifs cette saison.
 *
 * `active` filtre la liste sur les membres dont `member.officialLicense` cible
 * la saison courante (cf. `hasActiveOfficialLicenseThisSeason`). `all` n'applique
 * pas ce filtre — utile pour voir aussi les officiels qualifiés mais sans
 * licence active.
 */
export type OfficialsActiveFilter = 'active' | 'all'

export const useOfficialsStore = defineStore('officials', () => {
  const officials = ref<OfficialMetricsRow[]>([])
  const thresholds = ref<OfficialsThresholds>({ min: 3, max: 9, target: 6 })
  const activeSeasonId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const quickFilter = ref<OfficialsQuickFilter>('all')
  /** Par défaut "active" : on n'affiche que les officiels actifs cette saison. */
  const activeFilter = ref<OfficialsActiveFilter>('active')

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
      // listOfficialsWithMetrics enveloppe listOfficialsWithLoad et ajoute les
      // métriques de tracking (last-minute, remplacements, licence active).
      officials.value = await listOfficialsWithMetrics(seasonId)
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

  function setActiveFilter(value: OfficialsActiveFilter): void {
    activeFilter.value = value
  }

  // -------------------------------------------------------------------------
  // Officiels actifs (licence saison courante) — sous-ensemble.
  // -------------------------------------------------------------------------

  /**
   * Officiels actifs cette saison : `member.officialLicense.seasonId ===
   * activeSeasonId`. Calculé côté store (le repo dénormalise via le flag
   * `hasActiveOfficialLicenseThisSeason`).
   */
  const activeOfficials = computed<OfficialMetricsRow[]>(() =>
    officials.value.filter((o) => o.hasActiveOfficialLicenseThisSeason),
  )

  /** Liste effective d'après `activeFilter` ("all" vs "active"). */
  const visibleOfficials = computed<OfficialMetricsRow[]>(() =>
    activeFilter.value === 'active' ? activeOfficials.value : officials.value,
  )

  // -------------------------------------------------------------------------
  // Group by loadStatus — alimente les stat-cards + counts des chips.
  // -------------------------------------------------------------------------

  const officialsByLoadStatus = computed<Record<OfficialLoadStatus, OfficialMetricsRow[]>>(() => {
    const out: Record<OfficialLoadStatus, OfficialMetricsRow[]> = {
      low: [],
      ok: [],
      high: [],
      critical: [],
    }
    for (const o of visibleOfficials.value) {
      out[o.loadStatus].push(o)
    }
    return out
  })

  /** Counts par bucket — alignés sur l'ordre des chips (all en premier). */
  const counts = computed(() => {
    const g = officialsByLoadStatus.value
    return {
      all: visibleOfficials.value.length,
      low: g.low.length,
      ok: g.ok.length,
      high: g.high.length,
      critical: g.critical.length,
    }
  })

  /**
   * Agrégats pour stat-cards du tab "Officiels" : sommes sur la sélection
   * `visibleOfficials` (donc respecte le filtre actif/inactif).
   */
  const metricsSummary = computed(() => {
    let confirmed = 0
    let lastMinute = 0
    let replacements = 0
    for (const o of visibleOfficials.value) {
      confirmed += o.confirmedThisSeason
      lastMinute += o.lastMinuteThisSeason
      replacements += o.replacementsRequestedThisSeason
    }
    return {
      activeCount: activeOfficials.value.length,
      totalCount: officials.value.length,
      confirmedTotal: confirmed,
      lastMinuteTotal: lastMinute,
      replacementsTotal: replacements,
    }
  })

  // -------------------------------------------------------------------------
  // Filtered list — drive le DataTable.
  // -------------------------------------------------------------------------

  const filtered = computed<OfficialMetricsRow[]>(() => {
    const f = quickFilter.value
    if (f === 'all') return visibleOfficials.value
    return visibleOfficials.value.filter((o) => o.loadStatus === f)
  })

  return {
    // state
    officials,
    thresholds,
    activeSeasonId,
    loading,
    error,
    quickFilter,
    activeFilter,
    // derived
    activeOfficials,
    visibleOfficials,
    officialsByLoadStatus,
    counts,
    metricsSummary,
    filtered,
    // actions
    load,
    setQuickFilter,
    setActiveFilter,
  }
})

// Re-export le type enrichi pour les consumers (composants).
export type { OfficialMetricsRow } from '@/repositories/officials.repo'
// Re-export OfficialRow pour rétro-compat (consommé par des composants
// existants comme MatchAssignmentDrawer qui ne lisent que les counts).
export type { OfficialRow } from '@/repositories/officials.repo'
