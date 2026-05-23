/**
 * Store Teams — Mes équipes (coach).
 *
 * Source : Firestore réel via `@/repositories/teams.repo` quand le coach a
 * un `memberId` lié (`userDoc.memberId`). Fallback mock via
 * `@/repositories/mock.listTeamsForCoach` quand on est en mode dev sans
 * memberId réel (cohérent avec le pattern hybride mock décrit dans
 * `apps/courtbase-app/CLAUDE.md`).
 *
 * Expose des filtres reactifs (catégorie + sans coach + recherche) pour la
 * vue `MyTeams.vue`.
 *
 * Conventions :
 *   - `loadForCoach` est async ; affiche un `loading` pendant le fetch.
 *   - Pas de mutation locale des teams (read-only — les writes équipes
 *     restent admin desktop pour MVP).
 *   - Filtres composés en intersection ; search insensible casse + accents.
 */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import {
  listMembersByTeam,
  listTeamsForCoach as listTeamsForCoachMock,
  type MockTeam,
} from '@/repositories/mock'
import { listTeamsForCoach as listTeamsForCoachReal } from '@/repositories/teams.repo'

export type CoachStateFilter = 'all' | 'needsCoach'

export type TeamsSource = 'firestore' | 'mock'

/**
 * Normalise une chaîne pour comparaison insensible à la casse + sans accent.
 * Utilisé pour le filtre recherche par nom d'équipe.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

export const useTeamsStore = defineStore('teams', () => {
  // ─── State ──────────────────────────────────────────────────────
  const teams = ref<MockTeam[]>([])
  const search = ref('')
  const categoryFilter = ref<'all' | string>('all')
  const coachStateFilter = ref<CoachStateFilter>('all')
  const loading = ref(false)
  const error = ref<string | null>(null)
  const source = ref<TeamsSource>('mock')

  // ─── Actions ────────────────────────────────────────────────────
  /**
   * Charge les équipes coachées par le user courant.
   *
   * @param coachMemberId memberId du coach (depuis `auth.userDoc.memberId`).
   *   Si `null` / `undefined` → fallback mock (utile en dev sans backend).
   * @param coachUidForMock uid Auth ou mock à utiliser pour le fallback mock.
   */
  async function loadForCoach(
    coachMemberId: string | null | undefined,
    coachUidForMock: string,
  ): Promise<void> {
    error.value = null
    if (coachMemberId) {
      loading.value = true
      try {
        const data = await listTeamsForCoachReal(coachMemberId)
        teams.value = data
        source.value = 'firestore'
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[teams.store] loadForCoach (firestore) failed', err)
        error.value = message
        teams.value = []
        source.value = 'firestore'
      } finally {
        loading.value = false
      }
      return
    }
    // Fallback : pas de memberId réel → mode démo mock.
    teams.value = listTeamsForCoachMock(coachUidForMock)
    source.value = 'mock'
  }

  /** Charge depuis le mock uniquement (utile pour les tests / le showcase). */
  function loadForCoachMock(coachUid: string): void {
    teams.value = listTeamsForCoachMock(coachUid)
    source.value = 'mock'
    error.value = null
  }

  function setSearch(value: string): void {
    search.value = value
  }

  function setCategoryFilter(value: 'all' | string): void {
    categoryFilter.value = value
  }

  function setCoachStateFilter(value: CoachStateFilter): void {
    coachStateFilter.value = value
  }

  function resetFilters(): void {
    search.value = ''
    categoryFilter.value = 'all'
    coachStateFilter.value = 'all'
  }

  // ─── Getters ────────────────────────────────────────────────────

  /**
   * Compteurs utilitaires pour afficher les badges des chips (ex. nombre par
   * catégorie). Recalculé à chaque mutation de `teams`.
   */
  const counts = computed(() => {
    const byCategory = new Map<string, number>()
    let needsCoach = 0
    for (const t of teams.value) {
      const cat = t.categoryName
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1)
      if (t.coachIds.length === 0) needsCoach += 1
    }
    return {
      total: teams.value.length,
      byCategory,
      needsCoach,
    }
  })

  /** Catégories effectivement présentes dans l'effectif coaché. */
  const categories = computed<string[]>(() =>
    Array.from(counts.value.byCategory.keys()).sort((a, b) => a.localeCompare(b)),
  )

  /**
   * Intersection des 3 filtres :
   *   1. catégorie (`all` ou nom exact)
   *   2. besoin de coach (`all` ou équipes à 0 coach)
   *   3. recherche par nom (insensible casse + accents)
   */
  const filtered = computed<MockTeam[]>(() => {
    const q = normalize(search.value.trim())
    return teams.value.filter((t) => {
      if (categoryFilter.value !== 'all' && t.categoryName !== categoryFilter.value) {
        return false
      }
      if (coachStateFilter.value === 'needsCoach' && t.coachIds.length > 0) {
        return false
      }
      if (q && !normalize(t.name).includes(q)) return false
      return true
    })
  })

  /**
   * Compteurs effectifs (membres par équipe + nombre d'exclus). Pratique
   * pour les cards équipe enrichies de `MyTeams.vue` — évite que la vue
   * recompose la donnée à chaque render.
   *
   * Limite connue : utilise `listMembersByTeam` (mock). Quand on branchera
   * un repo members réel, basculer ici en lookup Firestore async.
   */
  const teamStats = computed<Map<string, { count: number; excluded: number }>>(() => {
    const map = new Map<string, { count: number; excluded: number }>()
    for (const t of teams.value) {
      // En mode firestore, on n'a pas encore le détail members → on tombe
      // sur `playerIds.length` pour `count` et 0 exclus (à enrichir quand
      // le store members existera).
      if (source.value === 'firestore') {
        map.set(t.id, { count: t.playerIds.length, excluded: 0 })
        continue
      }
      const members = listMembersByTeam(t.id)
      const excluded = members.filter((m) => m.duesStatus === 'excluded').length
      map.set(t.id, { count: members.length, excluded })
    }
    return map
  })

  return {
    // state
    teams,
    search,
    categoryFilter,
    coachStateFilter,
    loading,
    error,
    source,
    // getters
    counts,
    categories,
    filtered,
    teamStats,
    // actions
    loadForCoach,
    loadForCoachMock,
    setSearch,
    setCategoryFilter,
    setCoachStateFilter,
    resetFilters,
  }
})
