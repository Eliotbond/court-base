import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { FirebaseError } from 'firebase/app'
import {
  createMatchType,
  deleteMatchType,
  listMatchTypes,
  updateMatchType,
  type MatchTypeInput,
} from '@/repositories/matchTypes.repo'
import type { MatchType } from '@club-app/shared-types'

/**
 * Re-exporte le type d'input du repo pour faciliter l'import côté composants
 * (un seul `from '@/stores/matchTypes'` au lieu de mixer store + repo).
 */
export type { MatchTypeInput }

/**
 * Source unique des données du référentiel `/matchTypes`.
 *
 * Le dialog de création de match (`MatchFormDialog.vue`) consomme
 * `activeMatchTypes` pour alimenter le picker "Type de match" ; la page
 * Settings (section Match types) consomme `matchTypes` pour le CRUD complet.
 *
 * Pattern aligné sur [[stores_categories]] / [[stores_licenseTypes]] : le
 * store consomme uniquement le repository (cf. architecture en couches dans
 * `apps/web/CLAUDE.md`). Try/catch enrichi avec le code `FirebaseError` pour
 * éviter les erreurs silencieuses (rules denied, index manquant, …).
 */
export const useMatchTypesStore = defineStore('matchTypes', () => {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const matchTypes = ref<MatchType[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // ---------------------------------------------------------------------------
  // Helpers (privés)
  // ---------------------------------------------------------------------------

  /**
   * Comparator stable identique au repo (tri par `name` localeCompare).
   * Dupliqué ici (et pas exporté du repo) pour préserver l'ordre après un
   * upsert local sans round-trip Firestore.
   */
  function compareMatchTypes(a: MatchType, b: MatchType): number {
    return a.name.localeCompare(b.name)
  }

  /**
   * Remplace en place le row matching `id` par `next` ; insère sinon. Re-trie
   * ensuite pour conserver l'ordre `name asc`. Pattern aligné sur
   * `stores/categories.ts`.
   */
  function upsert(next: MatchType): void {
    const idx = matchTypes.value.findIndex((m) => m.id === next.id)
    let copy: MatchType[]
    if (idx === -1) {
      copy = [next, ...matchTypes.value]
    } else {
      copy = matchTypes.value.slice()
      copy[idx] = next
    }
    copy.sort(compareMatchTypes)
    matchTypes.value = copy
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      matchTypes.value = await listMatchTypes()
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`loadMatchTypes failed [${code}]`, err)
      error.value =
        err instanceof Error
          ? err.message
          : 'Erreur de chargement des types de match'
    } finally {
      loading.value = false
    }
  }

  /**
   * Crée un type de match. Retourne l'id ou null en cas d'erreur (le message
   * est posé dans `error.value`). Upsert local pour que la liste reflète
   * immédiatement la création — pas besoin de `load()` global.
   */
  async function create(input: MatchTypeInput): Promise<string | null> {
    error.value = null
    try {
      const created = await createMatchType(input)
      upsert(created)
      return created.id
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`createMatchType failed [${code}]`, err)
      error.value =
        err instanceof Error
          ? err.message
          : 'Erreur lors de la création du type de match'
      return null
    }
  }

  /**
   * Patch partiel via `updateMatchType`. Upsert local sur le row retourné.
   * Retourne true si l'update a abouti, false sinon (message dans `error`).
   */
  async function update(
    id: string,
    patch: Partial<MatchTypeInput>,
  ): Promise<boolean> {
    error.value = null
    try {
      const next = await updateMatchType(id, patch)
      if (!next) return false
      upsert(next)
      return true
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`updateMatchType failed [${code}]`, err)
      error.value =
        err instanceof Error
          ? err.message
          : 'Erreur lors de la mise à jour du type de match'
      return false
    }
  }

  /**
   * Supprime un type de match. Le repo throw avec `'matchType in use …'` si
   * le type est référencé par au moins un booking — le message est alors
   * surfacé via `error.value`. Retire le row local uniquement si l'appel
   * réussit. Nommée `remove` car `delete` est un reserved keyword.
   */
  async function remove(id: string): Promise<boolean> {
    error.value = null
    try {
      await deleteMatchType(id)
      matchTypes.value = matchTypes.value.filter((m) => m.id !== id)
      return true
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`deleteMatchType failed [${code}]`, err)
      error.value =
        err instanceof Error
          ? err.message
          : 'Erreur lors de la suppression du type de match'
      return false
    }
  }

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  /**
   * Sous-ensemble des types actifs — utilisé par les pickers (création de
   * match). Tri stable côté repo (par `name`), on conserve l'ordre.
   */
  const activeMatchTypes = computed<MatchType[]>(() => {
    return matchTypes.value.filter((m) => m.active)
  })

  /** Map `id → MatchType` pour résolution O(1) (libellé, couleur). */
  const byId = computed<Map<string, MatchType>>(() => {
    const m = new Map<string, MatchType>()
    for (const mt of matchTypes.value) m.set(mt.id, mt)
    return m
  })

  return {
    // state
    matchTypes,
    loading,
    error,
    // derived
    activeMatchTypes,
    byId,
    // actions
    load,
    create,
    update,
    remove,
  }
})
