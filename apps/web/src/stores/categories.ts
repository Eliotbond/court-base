import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  countTeamsUsingCategory,
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
  type CreateCategoryInput,
  type UpdateCategoryInput,
} from '@/repositories/categories.repo'
import type { Category } from '@club-app/shared-types'

/**
 * Re-exporte les types d'input du repo pour faciliter l'import côté composants
 * (un seul `from '@/stores/categories'` au lieu de mixer store + repo).
 */
export type { CreateCategoryInput, UpdateCategoryInput }

/**
 * Source unique des données du référentiel `/categories`.
 *
 * Voir `docs/firebase.md` (`/categories/{categoryId}`) et `docs/main.md`
 * (section "Catégories d'équipes") pour le schéma et le lifecycle (rename
 * propagé, archive vs suppression). Le store consomme uniquement le
 * repository `categories.repo` — les composants n'écrivent jamais
 * directement dans Firestore (cf. `docs/frontend-desktop.md`, architecture
 * en couches).
 *
 * `categories` accueille indifféremment le résultat de `load()` (toutes les
 * catégories, archivées incluses — vue Settings) et `loadActive()`
 * (sous-ensemble actif — pickers Teams). Le filtre archivée vs active reste
 * du ressort de l'UI (computed `activeCategories`) — la liste est
 * volontairement plate pour rester triviale à upserter.
 */
export const useCategoriesStore = defineStore('categories', () => {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const categories = ref<Category[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  /**
   * Cache du résultat de `countTeamsUsingCategory(id)` — alimenté à
   * l'ouverture du dialog "Supprimer" pour griser le bouton si la catégorie
   * est référencée. Volontairement non-réactif au-delà de l'écriture
   * ponctuelle : pas de TTL, le cache est rafraîchi manuellement avant
   * chaque action destructive.
   */
  const lastUsageCount = ref<Record<string, number>>({})

  // ---------------------------------------------------------------------------
  // Helpers (privés)
  // ---------------------------------------------------------------------------

  /**
   * Comparator stable identique à `categories.repo.compareCategories` :
   * `displayOrder asc`, puis `minAge asc nulls last`, puis `name asc`.
   * Dupliqué ici (et pas exporté du repo) pour préserver l'ordre après un
   * upsert local — la réponse Firestore arrive déjà triée mais l'insertion
   * en place doit re-trier la liste pour conserver l'ordre attendu par
   * l'UI.
   */
  function compareCategories(a: Category, b: Category): number {
    if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder
    const aMin = a.minAge
    const bMin = b.minAge
    if (aMin === null && bMin !== null) return 1
    if (aMin !== null && bMin === null) return -1
    if (aMin !== null && bMin !== null && aMin !== bMin) return aMin - bMin
    return a.name.localeCompare(b.name)
  }

  /**
   * Remplace en place le row matching `id` par `next` ; insère sinon. Re-trie
   * ensuite pour conserver l'ordre `displayOrder asc, minAge asc nulls last,
   * name asc`. Pattern aligné sur `stores/teams.ts` (mais avec re-tri car
   * l'ordre des catégories est sémantique, pas chronologique).
   */
  function upsert(next: Category): void {
    const idx = categories.value.findIndex((c) => c.id === next.id)
    let copy: Category[]
    if (idx === -1) {
      copy = [next, ...categories.value]
    } else {
      copy = categories.value.slice()
      copy[idx] = next
    }
    copy.sort(compareCategories)
    categories.value = copy
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * Charge toutes les catégories (actives + archivées) — utilisé par la
   * section Settings où l'admin doit pouvoir voir et désarchiver. Les
   * pickers Teams appellent `loadActive()` à la place.
   */
  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      categories.value = await listCategories()
    } catch (e: unknown) {
      error.value =
        e instanceof Error
          ? e.message
          : 'Erreur de chargement des catégories'
    } finally {
      loading.value = false
    }
  }

  /**
   * Charge uniquement les catégories actives — utilisé par les pickers
   * (création/édition d'équipe). Alimente le même `categories` ref ; les
   * archivées ne sont alors plus dans le store, mais ce mode n'est pas
   * supposé cohabiter avec l'écran Settings (qui lui appelle `load()`).
   */
  async function loadActive(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      categories.value = await listCategories({ activeOnly: true })
    } catch (e: unknown) {
      error.value =
        e instanceof Error
          ? e.message
          : 'Erreur de chargement des catégories actives'
    } finally {
      loading.value = false
    }
  }

  /**
   * Crée une catégorie. Retourne l'id ou null en cas d'erreur (le message
   * est posé dans `error.value`). Upsert local pour que la liste reflète
   * immédiatement la création — pas besoin de `load()` global.
   */
  async function create(
    input: CreateCategoryInput,
  ): Promise<string | null> {
    error.value = null
    try {
      const created = await createCategory(input)
      upsert(created)
      return created.id
    } catch (e: unknown) {
      error.value =
        e instanceof Error
          ? e.message
          : 'Erreur lors de la création de la catégorie'
      return null
    }
  }

  /**
   * Patch partiel via `updateCategory`. Upsert local sur le row retourné.
   * Retourne true si l'update a abouti, false sinon (message dans `error`).
   */
  async function update(
    id: string,
    patch: UpdateCategoryInput,
  ): Promise<boolean> {
    error.value = null
    try {
      const next = await updateCategory(id, patch)
      if (!next) return false
      upsert(next)
      return true
    } catch (e: unknown) {
      error.value =
        e instanceof Error
          ? e.message
          : 'Erreur lors de la mise à jour de la catégorie'
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
   * Supprime une catégorie. Le repo throw si la catégorie est référencée
   * par au moins une équipe — le message ("Catégorie utilisée…") est alors
   * surfacé via `error.value`. Retire le row local uniquement si l'appel
   * réussit.
   */
  async function remove(id: string): Promise<boolean> {
    error.value = null
    try {
      await deleteCategory(id)
      categories.value = categories.value.filter((c) => c.id !== id)
      // Best-effort cleanup du cache d'usage.
      const next = { ...lastUsageCount.value }
      delete next[id]
      lastUsageCount.value = next
      return true
    } catch (e: unknown) {
      error.value =
        e instanceof Error
          ? e.message
          : 'Erreur lors de la suppression de la catégorie'
      return false
    }
  }

  /**
   * Rafraîchit le compteur d'usage cache pour `id`. Appelé par l'UI Settings
   * juste avant l'ouverture du dialog "Supprimer" pour décider si on autorise
   * la suppression (count === 0) ou si on propose l'archive à la place.
   * Retourne le count pour permettre à l'appelant de brancher la logique
   * inline sans devoir re-watcher le ref.
   */
  async function refreshUsageCount(id: string): Promise<number> {
    const count = await countTeamsUsingCategory(id)
    lastUsageCount.value = { ...lastUsageCount.value, [id]: count }
    return count
  }

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  /**
   * Sous-ensemble des catégories actives, déjà trié — utilisé par les
   * pickers (Teams, SeasonNewWizard) qui n'ont pas à voir les archivées.
   */
  const activeCategories = computed<Category[]>(() => {
    return categories.value
      .filter((c) => c.active)
      .slice()
      .sort(compareCategories)
  })

  /**
   * Map `id → Category` pour résolution O(1) — utilisé par `teams.repo` /
   * `stores/teams` pour matérialiser `TeamRow.category` à partir d'un
   * `categoryId`.
   */
  const byId = computed<Map<string, Category>>(() => {
    const m = new Map<string, Category>()
    for (const c of categories.value) m.set(c.id, c)
    return m
  })

  return {
    // state
    categories,
    loading,
    error,
    lastUsageCount,
    // derived
    activeCategories,
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
