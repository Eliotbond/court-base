import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  activateSeason as repoActivate,
  archiveSeason as repoArchive,
  createSeason as repoCreate,
  duplicateSeason as repoDuplicate,
  listSeasons,
  type CreateSeasonInput,
  type SeasonRow,
} from '@/repositories/seasons.repo'
import type { SeasonStatus } from '@club-app/shared-types'

/**
 * Filtres rapides (chips) — alignés sur le lifecycle Season de docs/main.md.
 * - `all` : toutes les saisons
 * - `draft` : brouillons (futures saisons à activer)
 * - `active` : saison courante (au plus une, mais on garde le filtre pour la
 *   cohérence du pattern Members)
 * - `archived` : saisons passées (read-only côté UI)
 */
export type SeasonQuickFilter = 'all' | SeasonStatus

/**
 * Source unique des données affichées sur l'écran Seasons.
 *
 * `load()` appelle le repo une fois ; la vue passe ensuite par `filtered`
 * qui dérive la liste affichée du `quickFilter` actif + de la recherche
 * texte. Les mutations (activate / archive / duplicate) appliquent une
 * update optimiste — le repo retourne le row complet pour réconcilier.
 *
 * Voir docs/frontend-desktop.md (architecture en couches) : la vue ne lit
 * JAMAIS le repo directement.
 */
export const useSeasonsStore = defineStore('seasons', () => {
  const seasons = ref<SeasonRow[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  /** Chip filter actif. */
  const quickFilter = ref<SeasonQuickFilter>('all')
  /** Texte saisi dans la search box (nom de saison). */
  const search = ref('')
  /** Id de la saison sur laquelle une action est en cours (UI feedback). */
  const pendingActionFor = ref<string | null>(null)

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      seasons.value = await listSeasons()
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur de chargement des saisons'
    } finally {
      loading.value = false
    }
  }

  function setQuickFilter(value: SeasonQuickFilter): void {
    quickFilter.value = value
  }

  function setSearch(value: string): void {
    search.value = value
  }

  // -------------------------------------------------------------------------
  // Mutations — optimistic, rebasculées sur la valeur du repo après résolution.
  // -------------------------------------------------------------------------

  /**
   * Remplace en place le row matching `id` par `next` ; insère si absent.
   * Préserve l'ordre.
   */
  function upsert(next: SeasonRow): void {
    const idx = seasons.value.findIndex((s) => s.id === next.id)
    if (idx === -1) {
      seasons.value = [next, ...seasons.value]
    } else {
      const copy = seasons.value.slice()
      copy[idx] = next
      seasons.value = copy
    }
  }

  async function activate(seasonId: string): Promise<void> {
    pendingActionFor.value = seasonId
    try {
      const row = await repoActivate(seasonId)
      if (row) upsert(row)
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : "Erreur lors de l'activation"
    } finally {
      pendingActionFor.value = null
    }
  }

  async function archive(seasonId: string): Promise<void> {
    pendingActionFor.value = seasonId
    try {
      const row = await repoArchive(seasonId)
      if (row) upsert(row)
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : "Erreur lors de l'archivage"
    } finally {
      pendingActionFor.value = null
    }
  }

  async function duplicate(seasonId: string): Promise<void> {
    pendingActionFor.value = seasonId
    try {
      const row = await repoDuplicate(seasonId)
      if (row) upsert(row)
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors de la duplication'
    } finally {
      pendingActionFor.value = null
    }
  }

  /**
   * Crée une nouvelle saison (B3 — wizard `Nouvelle saison`). On insère
   * immédiatement le row retourné dans le state pour que la liste reflète la
   * nouveauté sans nécessiter un `load()` global. Retourne l'id pour
   * permettre à la vue de router vers la page détail / dry-run.
   */
  async function create(input: CreateSeasonInput): Promise<string | null> {
    error.value = null
    try {
      const row = await repoCreate(input)
      upsert(row)
      return row.id
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors de la création'
      return null
    }
  }

  /** Récupère le row local par id (pour les vues qui consomment le store). */
  function getById(seasonId: string): SeasonRow | null {
    return seasons.value.find((s) => s.id === seasonId) ?? null
  }

  // -------------------------------------------------------------------------
  // Derived counts — pour les badges des chips ("All 6 · draft 3 · active 1…").
  // -------------------------------------------------------------------------

  const counts = computed(() => {
    const list = seasons.value
    return {
      all: list.length,
      draft: list.filter((s) => s.status === 'draft').length,
      active: list.filter((s) => s.status === 'active').length,
      archived: list.filter((s) => s.status === 'archived').length,
    }
  })

  /** Saison active (au plus une — `null` si aucune). */
  const activeSeason = computed<SeasonRow | null>(
    () => seasons.value.find((s) => s.status === 'active') ?? null,
  )

  // -------------------------------------------------------------------------
  // Filtered list — chip + recherche texte.
  // -------------------------------------------------------------------------

  function matchesQuickFilter(s: SeasonRow, f: SeasonQuickFilter): boolean {
    if (f === 'all') return true
    return s.status === f
  }

  function matchesSearch(s: SeasonRow, q: string): boolean {
    if (!q) return true
    const needle = q.trim().toLowerCase()
    if (!needle) return true
    const haystack = [s.name, ...s.venueLabels].join(' ').toLowerCase()
    return haystack.includes(needle)
  }

  const filtered = computed<SeasonRow[]>(() => {
    const f = quickFilter.value
    const q = search.value
    return seasons.value.filter(
      (s) => matchesQuickFilter(s, f) && matchesSearch(s, q),
    )
  })

  return {
    // state
    seasons,
    loading,
    error,
    quickFilter,
    search,
    pendingActionFor,
    // derived
    counts,
    activeSeason,
    filtered,
    // actions
    load,
    setQuickFilter,
    setSearch,
    activate,
    archive,
    duplicate,
    create,
    getById,
  }
})
