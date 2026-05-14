import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  getPublicTeamById,
  listEligibleTeams,
  type PublicTeam,
} from '@/repositories/teams.repo'

/**
 * Store Teams (vue publique) — alimente le TeamPicker du wizard.
 *
 * On garde un cache par `birthDate` (ISO YYYY-MM-DD) car la liste éligible
 * dépend de l'âge du joueur. Un même user qui inscrit successivement deux
 * enfants évite la double query.
 */
export const useTeamsStore = defineStore('teams', () => {
  const byBirthDate = ref<Map<string, PublicTeam[]>>(new Map())
  const byId = ref<Map<string, PublicTeam>>(new Map())
  const loading = ref(false)
  const error = ref<string | null>(null)

  function cacheKey(birthDate: Date): string {
    return birthDate.toISOString().slice(0, 10)
  }

  async function loadEligibleTeams(birthDate: Date): Promise<PublicTeam[]> {
    const key = cacheKey(birthDate)
    const cached = byBirthDate.value.get(key)
    if (cached) return cached

    loading.value = true
    error.value = null
    try {
      const list = await listEligibleTeams(birthDate)
      byBirthDate.value = new Map(byBirthDate.value).set(key, list)
      const nextById = new Map(byId.value)
      for (const t of list) nextById.set(t.id, t)
      byId.value = nextById
      return list
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      return []
    } finally {
      loading.value = false
    }
  }

  async function loadTeam(teamId: string): Promise<PublicTeam | null> {
    const cached = byId.value.get(teamId)
    if (cached) return cached
    const team = await getPublicTeamById(teamId)
    if (team) byId.value = new Map(byId.value).set(teamId, team)
    return team
  }

  function invalidate(): void {
    byBirthDate.value = new Map()
    byId.value = new Map()
  }

  const hasEligibleTeams = computed(() => byBirthDate.value.size > 0)

  return {
    byBirthDate,
    byId,
    loading,
    error,
    hasEligibleTeams,
    loadEligibleTeams,
    loadTeam,
    invalidate,
  }
})
