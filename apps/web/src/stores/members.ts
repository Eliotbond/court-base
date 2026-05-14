import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  createMember as repoCreateMember,
  listMembers,
  type CreateMemberInput,
  type MemberRow,
} from '@/repositories/members.repo'

/**
 * Filtres rapides (chips) — alignés sur le design Mockups (screen 2).
 * `all` désactive tous les autres ; un seul chip de rôle/statut à la fois.
 */
export type MemberQuickFilter =
  | 'all'
  | 'players'
  | 'officials'
  | 'coachs'
  | 'comite'
  | 'unlicensed'
  | 'duesOverdue'

/**
 * Source unique des données affichées sur l'écran Members.
 *
 * `load()` appelle le repo une fois ; la vue passe ensuite par `filtered`
 * qui dérive la liste affichée du `quickFilter` actif + de la recherche
 * texte. Voir docs/frontend-desktop.md (architecture en couches) : la vue
 * ne lit JAMAIS le repo directement.
 */
export const useMembersStore = defineStore('members', () => {
  const members = ref<MemberRow[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  /** Chip filter actif. */
  const quickFilter = ref<MemberQuickFilter>('all')
  /** Texte saisi dans la search box (nom / email / téléphone). */
  const search = ref('')

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      members.value = await listMembers()
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur de chargement des membres'
    } finally {
      loading.value = false
    }
  }

  function setQuickFilter(value: MemberQuickFilter): void {
    quickFilter.value = value
  }

  function setSearch(value: string): void {
    search.value = value
  }

  /**
   * Crée un membre via le repository et l'insère dans `members` en préservant
   * le tri par `lastName` (ordre du `listMembers`). Retourne l'id du nouveau
   * membre, ou `null` en cas d'erreur (le message est posé dans `error`).
   */
  async function createMember(input: CreateMemberInput): Promise<string | null> {
    error.value = null
    try {
      const row = await repoCreateMember(input)
      // Insertion triée par lastName (locale française) pour rester cohérent
      // avec l'ordre du `listMembers`. Stable + simple : O(n) acceptable
      // pour quelques centaines de membres.
      const next = [...members.value, row].sort((a, b) =>
        a.lastName.localeCompare(b.lastName, 'fr'),
      )
      members.value = next
      return row.id
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors de la création du membre'
      return null
    }
  }

  // -------------------------------------------------------------------------
  // Derived counts (used pour les badges des chips, ex. "All 142").
  // -------------------------------------------------------------------------

  const counts = computed(() => {
    const list = members.value
    return {
      all: list.length,
      players: list.filter((m) => m.roles.includes('player')).length,
      officials: list.filter((m) => m.roles.includes('official')).length,
      coachs: list.filter((m) => m.roles.includes('coach')).length,
      comite: list.filter((m) => m.roles.includes('comite')).length,
      unlicensed: list.filter((m) => !m.licensed).length,
      duesOverdue: list.filter((m) => m.duesStatus === 'overdue' || m.duesStatus === 'excluded').length,
    }
  })

  // -------------------------------------------------------------------------
  // Filtered list — chip + recherche texte.
  // -------------------------------------------------------------------------

  function matchesQuickFilter(m: MemberRow, f: MemberQuickFilter): boolean {
    switch (f) {
      case 'all':
        return true
      case 'players':
        return m.roles.includes('player')
      case 'officials':
        return m.roles.includes('official')
      case 'coachs':
        return m.roles.includes('coach')
      case 'comite':
        return m.roles.includes('comite')
      case 'unlicensed':
        return !m.licensed
      case 'duesOverdue':
        // `excluded` est un downstream prolongé d'`overdue` (cf. docs/main.md
        // lifecycle dues) — inclure les deux dans le filtre "Cotisation en retard".
        return m.duesStatus === 'overdue' || m.duesStatus === 'excluded'
      default:
        return true
    }
  }

  function matchesSearch(m: MemberRow, q: string): boolean {
    if (!q) return true
    const needle = q.trim().toLowerCase()
    if (!needle) return true
    const haystack = [
      m.firstName,
      m.lastName,
      `${m.firstName} ${m.lastName}`,
      m.email ?? '',
      m.phone ?? '',
      m.licenseNumber,
      ...m.teamLabels,
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(needle)
  }

  const filtered = computed<MemberRow[]>(() => {
    const f = quickFilter.value
    const q = search.value
    return members.value.filter(
      (m) => matchesQuickFilter(m, f) && matchesSearch(m, q),
    )
  })

  return {
    // state
    members,
    loading,
    error,
    quickFilter,
    search,
    // derived
    counts,
    filtered,
    // actions
    load,
    setQuickFilter,
    setSearch,
    createMember,
  }
})
