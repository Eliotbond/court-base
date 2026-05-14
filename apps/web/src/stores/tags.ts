import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  countTeamsUsingTag,
  createTag,
  deleteTag,
  listTags,
  updateTag,
  type CreateTagInput,
  type UpdateTagInput,
} from '@/repositories/tags.repo'
import type { Tag } from '@club-app/shared-types'

/**
 * Re-exporte les types d'input du repo pour faciliter l'import côté composants
 * (un seul `from '@/stores/tags'` au lieu de mixer store + repo).
 */
export type { CreateTagInput, UpdateTagInput }

/**
 * Source unique des données du référentiel `/tags`.
 *
 * Voir `docs/firebase.md` (`/tags/{tagId}`) et `docs/main.md` (section
 * "Tags d'équipes") pour le schéma et le lifecycle (rename/recolor propagés,
 * archive vs suppression). Le store consomme uniquement le repository
 * `tags.repo` — les composants n'écrivent jamais directement dans Firestore
 * (cf. `docs/frontend-desktop.md`, architecture en couches).
 *
 * `tags` accueille indifféremment le résultat de `load()` (tous les tags,
 * archivés inclus — vue Settings) et `loadActive()` (sous-ensemble actif —
 * pickers Teams). Le filtre archivé vs actif reste du ressort de l'UI
 * (computed `activeTags`).
 */
export const useTagsStore = defineStore('tags', () => {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const tags = ref<Tag[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  /**
   * Cache du résultat de `countTeamsUsingTag(id)` — alimenté à l'ouverture du
   * dialog "Supprimer" pour griser le bouton si le tag est référencé.
   */
  const lastUsageCount = ref<Record<string, number>>({})

  // ---------------------------------------------------------------------------
  // Helpers (privés)
  // ---------------------------------------------------------------------------

  /**
   * Comparator stable identique à `tags.repo.compareTags` : `displayOrder asc`
   * puis `name asc`. Dupliqué ici pour préserver l'ordre après un upsert local.
   */
  function compareTags(a: Tag, b: Tag): number {
    if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder
    return a.name.localeCompare(b.name)
  }

  /**
   * Remplace en place le row matching `id` par `next` ; insère sinon, puis
   * re-trie. Pattern aligné sur `stores/categories.ts`.
   */
  function upsert(next: Tag): void {
    const idx = tags.value.findIndex((t) => t.id === next.id)
    let copy: Tag[]
    if (idx === -1) {
      copy = [next, ...tags.value]
    } else {
      copy = tags.value.slice()
      copy[idx] = next
    }
    copy.sort(compareTags)
    tags.value = copy
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * Charge tous les tags (actifs + archivés) — utilisé par la section
   * Settings. Les pickers Teams appellent `loadActive()` à la place.
   */
  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      tags.value = await listTags()
    } catch (e: unknown) {
      error.value =
        e instanceof Error
          ? e.message
          : 'Erreur de chargement des tags'
    } finally {
      loading.value = false
    }
  }

  /**
   * Charge uniquement les tags actifs — utilisé par les pickers (création /
   * édition d'équipe).
   */
  async function loadActive(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      tags.value = await listTags({ activeOnly: true })
    } catch (e: unknown) {
      error.value =
        e instanceof Error
          ? e.message
          : 'Erreur de chargement des tags actifs'
    } finally {
      loading.value = false
    }
  }

  /**
   * Crée un tag. Retourne l'id ou null en cas d'erreur (le message est posé
   * dans `error.value`). Upsert local pour que la liste reflète immédiatement
   * la création.
   */
  async function create(input: CreateTagInput): Promise<string | null> {
    error.value = null
    try {
      const created = await createTag(input)
      upsert(created)
      return created.id
    } catch (e: unknown) {
      error.value =
        e instanceof Error
          ? e.message
          : 'Erreur lors de la création du tag'
      return null
    }
  }

  /**
   * Patch partiel via `updateTag`. Upsert local sur le row retourné.
   */
  async function update(
    id: string,
    patch: UpdateTagInput,
  ): Promise<boolean> {
    error.value = null
    try {
      const next = await updateTag(id, patch)
      if (!next) return false
      upsert(next)
      return true
    } catch (e: unknown) {
      error.value =
        e instanceof Error
          ? e.message
          : 'Erreur lors de la mise à jour du tag'
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
   * Supprime un tag. Le repo throw si le tag est référencé par au moins une
   * équipe — le message est surfacé via `error.value`.
   */
  async function remove(id: string): Promise<boolean> {
    error.value = null
    try {
      await deleteTag(id)
      tags.value = tags.value.filter((t) => t.id !== id)
      const next = { ...lastUsageCount.value }
      delete next[id]
      lastUsageCount.value = next
      return true
    } catch (e: unknown) {
      error.value =
        e instanceof Error
          ? e.message
          : 'Erreur lors de la suppression du tag'
      return false
    }
  }

  /**
   * Rafraîchit le compteur d'usage pour `id`. Appelé juste avant l'ouverture
   * du dialog "Supprimer".
   */
  async function refreshUsageCount(id: string): Promise<number> {
    const count = await countTeamsUsingTag(id)
    lastUsageCount.value = { ...lastUsageCount.value, [id]: count }
    return count
  }

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  /** Sous-ensemble des tags actifs, déjà trié — utilisé par les pickers. */
  const activeTags = computed<Tag[]>(() => {
    return tags.value.filter((t) => t.active).slice().sort(compareTags)
  })

  /** Map `id → Tag` pour résolution O(1). */
  const byId = computed<Map<string, Tag>>(() => {
    const m = new Map<string, Tag>()
    for (const t of tags.value) m.set(t.id, t)
    return m
  })

  return {
    // state
    tags,
    loading,
    error,
    lastUsageCount,
    // derived
    activeTags,
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
