import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  countTeamsUsingCotisationType,
  createCotisationType,
  deleteCotisationType,
  listCotisationTypes,
  updateCotisationType,
  type CreateCotisationTypeInput,
  type UpdateCotisationTypeInput,
} from '@/repositories/cotisationTypes.repo'
import type { CotisationType } from '@club-app/shared-types'

/**
 * Re-exporte les types d'input du repo pour faciliter l'import côté composants
 * (un seul `from '@/stores/cotisationTypes'` au lieu de mixer store + repo).
 */
export type { CreateCotisationTypeInput, UpdateCotisationTypeInput }

/**
 * Source unique des données du référentiel **types de cotisation** (collection
 * Firestore `/cotisations`, conservée sous ce nom de string pour éviter une
 * migration data — voir `cotisationTypes.repo.ts`).
 *
 * Voir `docs/firebase.md` (`/cotisations/{cotisationTypeId}`) et `docs/main.md`
 * (section "Cotisations") pour le schéma et le lifecycle (rename/reprice
 * propagés, archive vs suppression). Le store consomme uniquement le
 * repository `cotisationTypes.repo` — les composants n'écrivent jamais
 * directement dans Firestore (cf. `docs/frontend-desktop.md`, architecture en
 * couches).
 *
 * `cotisationTypes` accueille indifféremment le résultat de `load()` (tous les
 * types, archivés inclus — vue Settings) et `loadActive()` (sous-ensemble
 * actif — pickers Teams). Le filtre archivé vs actif reste du ressort de l'UI
 * (computed `activeCotisationTypes`).
 */
export const useCotisationTypesStore = defineStore('cotisationTypes', () => {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const cotisationTypes = ref<CotisationType[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  /**
   * Cache du résultat de `countTeamsUsingCotisationType(id)` — alimenté à
   * l'ouverture du dialog "Supprimer" pour griser le bouton si le type de
   * cotisation est référencé.
   */
  const lastUsageCount = ref<Record<string, number>>({})

  // ---------------------------------------------------------------------------
  // Helpers (privés)
  // ---------------------------------------------------------------------------

  /**
   * Comparator stable identique à `cotisationTypes.repo.compareCotisationTypes` :
   * `displayOrder asc` puis `name asc`. Dupliqué ici pour préserver l'ordre
   * après un upsert local.
   */
  function compareCotisationTypes(a: CotisationType, b: CotisationType): number {
    if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder
    return a.name.localeCompare(b.name)
  }

  /**
   * Remplace en place le row matching `id` par `next` ; insère sinon, puis
   * re-trie. Pattern aligné sur `stores/tags.ts`.
   */
  function upsert(next: CotisationType): void {
    const idx = cotisationTypes.value.findIndex((c) => c.id === next.id)
    let copy: CotisationType[]
    if (idx === -1) {
      copy = [next, ...cotisationTypes.value]
    } else {
      copy = cotisationTypes.value.slice()
      copy[idx] = next
    }
    copy.sort(compareCotisationTypes)
    cotisationTypes.value = copy
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * Charge tous les types de cotisation (actifs + archivés) — utilisé par la
   * section Settings. Les pickers Teams appellent `loadActive()` à la place.
   */
  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      cotisationTypes.value = await listCotisationTypes()
    } catch (e: unknown) {
      error.value =
        e instanceof Error
          ? e.message
          : 'Erreur de chargement des types de cotisation'
    } finally {
      loading.value = false
    }
  }

  /**
   * Charge uniquement les types de cotisation actifs — utilisé par les pickers
   * (création / édition d'équipe).
   */
  async function loadActive(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      cotisationTypes.value = await listCotisationTypes({ activeOnly: true })
    } catch (e: unknown) {
      error.value =
        e instanceof Error
          ? e.message
          : 'Erreur de chargement des types de cotisation actifs'
    } finally {
      loading.value = false
    }
  }

  /**
   * Crée un type de cotisation. Retourne l'id ou null en cas d'erreur (le
   * message est posé dans `error.value`). Upsert local pour que la liste
   * reflète immédiatement la création.
   */
  async function create(
    input: CreateCotisationTypeInput,
  ): Promise<string | null> {
    error.value = null
    try {
      const created = await createCotisationType(input)
      upsert(created)
      return created.id
    } catch (e: unknown) {
      error.value =
        e instanceof Error
          ? e.message
          : 'Erreur lors de la création du type de cotisation'
      return null
    }
  }

  /**
   * Patch partiel via `updateCotisationType`. Upsert local sur le row retourné.
   */
  async function update(
    id: string,
    patch: UpdateCotisationTypeInput,
  ): Promise<boolean> {
    error.value = null
    try {
      const next = await updateCotisationType(id, patch)
      if (!next) return false
      upsert(next)
      return true
    } catch (e: unknown) {
      error.value =
        e instanceof Error
          ? e.message
          : 'Erreur lors de la mise à jour du type de cotisation'
      return false
    }
  }

  /** Helper : flip `active=false`. */
  async function archive(id: string): Promise<void> {
    await update(id, { active: false })
  }

  /** Helper : flip `active=true`. */
  async function unarchive(id: string): Promise<void> {
    await update(id, { active: true })
  }

  /**
   * Supprime un type de cotisation. Le repo throw si le type est référencé
   * par au moins une équipe — le message est surfacé via `error.value`.
   */
  async function remove(id: string): Promise<boolean> {
    error.value = null
    try {
      await deleteCotisationType(id)
      cotisationTypes.value = cotisationTypes.value.filter((c) => c.id !== id)
      const next = { ...lastUsageCount.value }
      delete next[id]
      lastUsageCount.value = next
      return true
    } catch (e: unknown) {
      error.value =
        e instanceof Error
          ? e.message
          : 'Erreur lors de la suppression du type de cotisation'
      return false
    }
  }

  /**
   * Rafraîchit le compteur d'usage pour `id`. Appelé juste avant l'ouverture
   * du dialog "Supprimer".
   */
  async function refreshUsageCount(id: string): Promise<number> {
    const count = await countTeamsUsingCotisationType(id)
    lastUsageCount.value = { ...lastUsageCount.value, [id]: count }
    return count
  }

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  /**
   * Sous-ensemble des types de cotisation actifs, déjà trié — utilisé par les
   * pickers.
   */
  const activeCotisationTypes = computed<CotisationType[]>(() => {
    return cotisationTypes.value
      .filter((c) => c.active)
      .slice()
      .sort(compareCotisationTypes)
  })

  /** Map `id → CotisationType` pour résolution O(1). */
  const byId = computed<Map<string, CotisationType>>(() => {
    const m = new Map<string, CotisationType>()
    for (const c of cotisationTypes.value) m.set(c.id, c)
    return m
  })

  return {
    // state
    cotisationTypes,
    loading,
    error,
    lastUsageCount,
    // derived
    activeCotisationTypes,
    byId,
    // actions
    load,
    loadActive,
    create,
    update,
    archive,
    unarchive,
    remove,
    refreshUsageCount,
  }
})
