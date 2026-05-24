import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  assignCoach as repoAssignCoach,
  createTeam as repoCreate,
  duplicateTeam as repoDuplicate,
  getTeamById as repoGetTeamById,
  listTeams,
  removeCoach as repoRemoveCoach,
  setTeamActive as repoSetActive,
  updateTeam as repoUpdate,
  type CreateTeamInput,
  type TeamRow,
  type UpdateTeamInput,
} from '@/repositories/teams.repo'
import type {
  BasketplanCompetitionLink,
  TeamGender,
} from '@club-app/shared-types'

/**
 * Filtres rapides (chips) — aligné sur le design Mockups (screen 4).
 *
 * Axes filtrables côté UI :
 *  - `category`  : `'all'` ou un `categoryId` (référence vers
 *                  /categories/{id}). Le label affiché par le chip est résolu
 *                  côté vue via le store `useCategoriesStore` ; les chips
 *                  reflètent les catégories effectivement présentes dans
 *                  `teams`.
 *  - `gender`    : `all` | `M` | `F` | `mixed`
 *
 * `status` est binaire (active vs archived). `coachState` permet d'isoler
 * les équipes sans coach assigné — bug magnet typique en début de saison.
 */
export type TeamCategoryFilter = 'all' | string
export type TeamGenderFilter = 'all' | TeamGender
export type TeamStatusFilter = 'all' | 'active' | 'archived'
export type TeamCoachStateFilter = 'all' | 'needsCoach'

/**
 * Source unique des données affichées sur l'écran Teams.
 *
 * `load()` appelle le repo une fois ; la vue passe ensuite par `filtered`
 * qui dérive la liste affichée des filtres + recherche texte. Voir
 * docs/frontend-desktop.md (architecture en couches) : la vue ne lit
 * JAMAIS le repo directement.
 *
 * `selectedTeamId` pilote l'ouverture du drawer détail (cf. C3 — pas de
 * route `/teams/:id`, juste un overlay in-page).
 */
export const useTeamsStore = defineStore('teams', () => {
  const teams = ref<TeamRow[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  /** Filtre par catégorie (chips primaires — dynamique). */
  const categoryFilter = ref<TeamCategoryFilter>('all')
  /** Filtre par genre. */
  const genderFilter = ref<TeamGenderFilter>('all')
  /** Filtre actif/archivé. Par défaut on cache les archivées (`active`). */
  const statusFilter = ref<TeamStatusFilter>('active')
  /** Toggle "équipes sans coach". */
  const coachStateFilter = ref<TeamCoachStateFilter>('all')
  /** Texte saisi dans la search box (nom / coach / catégorie). */
  const search = ref('')

  /** Id de l'équipe sélectionnée pour le drawer détail. `null` = drawer fermé. */
  const selectedTeamId = ref<string | null>(null)

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      teams.value = await listTeams()
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur de chargement des équipes'
    } finally {
      loading.value = false
    }
  }

  function setCategoryFilter(value: TeamCategoryFilter): void {
    categoryFilter.value = value
  }

  function setGenderFilter(value: TeamGenderFilter): void {
    genderFilter.value = value
  }

  function setStatusFilter(value: TeamStatusFilter): void {
    statusFilter.value = value
  }

  function setCoachStateFilter(value: TeamCoachStateFilter): void {
    coachStateFilter.value = value
  }

  function setSearch(value: string): void {
    search.value = value
  }

  // -------------------------------------------------------------------------
  // Drawer detail — sélection in-page (pas de route /teams/:id).
  // -------------------------------------------------------------------------

  function openDrawer(teamId: string): void {
    selectedTeamId.value = teamId
  }

  function closeDrawer(): void {
    selectedTeamId.value = null
  }

  /** Équipe actuellement sélectionnée dans le drawer (ou null). */
  const selectedTeam = computed<TeamRow | null>(() => {
    const id = selectedTeamId.value
    if (id === null) return null
    return teams.value.find((t) => t.id === id) ?? null
  })

  /**
   * Bascule le flag `active` (archive/désarchive). Écrit `updateDoc` côté
   * Firestore puis upsert le row retourné — le drawer reste ouvert.
   */
  async function toggleArchive(teamId: string): Promise<void> {
    const target = teams.value.find((t) => t.id === teamId)
    if (!target) return
    error.value = null
    try {
      const row = await repoSetActive(teamId, !target.active)
      if (row) upsert(row)
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : "Erreur lors de l'archivage"
    }
  }

  /**
   * Remplace en place le row matching `id` par `next` ; insère en tête si
   * absent. Préserve l'ordre des autres rows. Pattern aligné sur
   * `seasons.ts` pour cohérence inter-stores.
   */
  function upsert(next: TeamRow): void {
    const idx = teams.value.findIndex((t) => t.id === next.id)
    if (idx === -1) {
      teams.value = [next, ...teams.value]
    } else {
      const copy = teams.value.slice()
      copy[idx] = next
      teams.value = copy
    }
  }

  /**
   * Crée une nouvelle équipe via le dialog "Nouvelle équipe". Insère le row
   * retourné en tête de la liste pour que l'utilisateur voie immédiatement
   * sa création — pas besoin d'un `load()` global.
   *
   * Retourne l'id de l'équipe créée (ou null en cas d'erreur).
   */
  async function create(input: CreateTeamInput): Promise<string | null> {
    error.value = null
    try {
      const row = await repoCreate(input)
      upsert(row)
      return row.id
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : "Erreur lors de la création de l'équipe"
      return null
    }
  }

  /**
   * Assigne un membre comme coach d'une équipe. Le row retourné par le repo
   * remplace l'existant via `upsert` — le drawer reflète immédiatement la
   * nouvelle liste de coachs et la pill "Coach à assigner" disparaît.
   */
  async function assignCoach(teamId: string, memberId: string): Promise<void> {
    error.value = null
    try {
      const row = await repoAssignCoach(teamId, memberId)
      if (row) upsert(row)
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : "Erreur lors de l'assignation du coach"
    }
  }

  /**
   * Retire un membre du staff coach d'une équipe. Symétrique à `assignCoach`.
   */
  async function removeCoach(teamId: string, memberId: string): Promise<void> {
    error.value = null
    try {
      const row = await repoRemoveCoach(teamId, memberId)
      if (row) upsert(row)
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors du retrait du coach'
    }
  }

  /**
   * Duplique une équipe existante via le menu d'action de la carte. La copie
   * est insérée en tête (via `upsert`) avec le suffixe " (copie)" et reste en
   * draft (active=false) — l'utilisateur la voit immédiatement en haut de la
   * liste, prête à être éditée depuis sa fiche détail.
   *
   * TODO(firestore): wire to callable duplicateTeam once the write path lands.
   */
  async function duplicate(teamId: string): Promise<string | null> {
    error.value = null
    try {
      const row = await repoDuplicate(teamId)
      if (!row) return null
      upsert(row)
      return row.id
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : "Erreur lors de la duplication de l'équipe"
      return null
    }
  }

  /**
   * Met à jour une équipe via le mode "Modifier" du drawer. Le row retourné
   * remplace l'existant via `upsert` — le drawer reflète les nouvelles valeurs
   * sans flicker. Retourne `true` si la mise à jour a abouti.
   */
  async function update(
    teamId: string,
    patch: UpdateTeamInput,
  ): Promise<boolean> {
    error.value = null
    try {
      const row = await repoUpdate(teamId, patch)
      if (!row) return false
      upsert(row)
      return true
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : "Erreur lors de la mise à jour de l'équipe"
      return false
    }
  }

  /**
   * Re-fetch une équipe et upsert le row local. Utile après une mutation
   * server-side dont on n'a pas le résultat enrichi (ex. liaison Basketplan
   * via callable qui ne renvoie que le link ajouté). Pattern aligné sur
   * `update` / `assignCoach` mais sans patch — on rafraîchit tout le row.
   */
  async function refreshTeam(teamId: string): Promise<void> {
    error.value = null
    try {
      const row = await repoGetTeamById(teamId)
      if (row) upsert(row)
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : "Erreur lors du rafraîchissement de l'équipe"
    }
  }

  // -------------------------------------------------------------------------
  // Basketplan links — patches locaux pour éviter un re-fetch sur chaque
  // mutation. Les écritures Firestore sont faites par les callables
  // (`linkTeamToBasketplan` / `unlinkTeamBasketplan` / `toggleTeamBasketplanLink`).
  // -------------------------------------------------------------------------

  /**
   * Ajoute un lien Basketplan au row local sans re-fetch. Le link complet
   * (avec ses caches) est fourni par la callable serveur. Pas d'écriture
   * Firestore ici — le doc est déjà à jour côté serveur.
   */
  function addBasketplanLinkLocal(
    teamId: string,
    link: BasketplanCompetitionLink,
  ): void {
    const team = teams.value.find((t) => t.id === teamId)
    if (!team) return
    const existing = team.basketplanLinks ?? []
    const next: TeamRow = {
      ...team,
      basketplanLinks: [...existing, link],
    }
    upsert(next)
  }

  /**
   * Retire un lien Basketplan du row local par `linkId`. Pas d'écriture
   * Firestore (le doc est déjà à jour côté serveur via la callable).
   */
  function removeBasketplanLinkLocal(teamId: string, linkId: string): void {
    const team = teams.value.find((t) => t.id === teamId)
    if (!team) return
    const existing = team.basketplanLinks ?? []
    const next: TeamRow = {
      ...team,
      basketplanLinks: existing.filter((l) => l.id !== linkId),
    }
    upsert(next)
  }

  /**
   * Toggle le flag `active` d'un lien Basketplan localement.
   */
  function toggleBasketplanLinkLocal(
    teamId: string,
    linkId: string,
    active: boolean,
  ): void {
    const team = teams.value.find((t) => t.id === teamId)
    if (!team) return
    const existing = team.basketplanLinks ?? []
    const next: TeamRow = {
      ...team,
      basketplanLinks: existing.map((l) =>
        l.id === linkId ? { ...l, active } : l,
      ),
    }
    upsert(next)
  }

  // -------------------------------------------------------------------------
  // Derived counts — utilisés pour les badges chips ("U16 · 3").
  // -------------------------------------------------------------------------

  /**
   * Comptes par catégorie (dynamiques), par genre, par statut, et "needs
   * coach". `all` = total scopé au filtre `status` courant.
   *
   * `byCategory` est une `Map<categoryId, count>` — la clé est l'id du doc
   * `/categories/{id}` (string). La résolution `id → libellé` se fait côté
   * vue via `useCategoriesStore.byId` (cf. `categoryChips`).
   */
  const counts = computed(() => {
    const all = teams.value
    const scoped = all.filter((t) => matchesStatusFilter(t, statusFilter.value))
    const byCategory = new Map<string, number>()
    for (const t of scoped) {
      // Défensif : un team sans categoryId ne devrait pas exister, mais on
      // saute pour ne pas polluer la Map avec une clé vide.
      if (!t.categoryId) continue
      byCategory.set(t.categoryId, (byCategory.get(t.categoryId) ?? 0) + 1)
    }
    return {
      all: scoped.length,
      byCategory,
      genderM: scoped.filter((t) => t.gender === 'M').length,
      genderF: scoped.filter((t) => t.gender === 'F').length,
      genderMixed: scoped.filter((t) => t.gender === 'mixed').length,
      needsCoach: scoped.filter((t) => t.coachIds.length === 0).length,
      // Pour le subtitle de la page :
      totalActive: all.filter((t) => t.active).length,
      totalArchived: all.filter((t) => !t.active).length,
      totalDuesIssued: all
        .filter((t) => t.active)
        .reduce((sum, t) => sum + (t.cotisation?.price ?? 0) * t.playerCount, 0),
    }
  })

  // -------------------------------------------------------------------------
  // Filtered list — category + gender + status + coachState + recherche texte.
  // -------------------------------------------------------------------------

  function matchesCategoryFilter(t: TeamRow, f: TeamCategoryFilter): boolean {
    if (f === 'all') return true
    return t.categoryId === f
  }

  function matchesGenderFilter(t: TeamRow, f: TeamGenderFilter): boolean {
    if (f === 'all') return true
    return t.gender === f
  }

  function matchesStatusFilter(t: TeamRow, f: TeamStatusFilter): boolean {
    if (f === 'all') return true
    if (f === 'active') return t.active
    return !t.active
  }

  function matchesCoachStateFilter(
    t: TeamRow,
    f: TeamCoachStateFilter,
  ): boolean {
    if (f === 'all') return true
    return t.coachIds.length === 0
  }

  function matchesSearch(t: TeamRow, q: string): boolean {
    if (!q) return true
    const needle = q.trim().toLowerCase()
    if (!needle) return true
    const haystack = [t.name, t.category?.name ?? '', ...t.coachLabels]
      .join(' ')
      .toLowerCase()
    return haystack.includes(needle)
  }

  const filtered = computed<TeamRow[]>(() => {
    const cat = categoryFilter.value
    const g = genderFilter.value
    const s = statusFilter.value
    const c = coachStateFilter.value
    const q = search.value
    return teams.value.filter(
      (t) =>
        matchesCategoryFilter(t, cat) &&
        matchesGenderFilter(t, g) &&
        matchesStatusFilter(t, s) &&
        matchesCoachStateFilter(t, c) &&
        matchesSearch(t, q),
    )
  })

  return {
    // state
    teams,
    loading,
    error,
    categoryFilter,
    genderFilter,
    statusFilter,
    coachStateFilter,
    search,
    selectedTeamId,
    // derived
    counts,
    filtered,
    selectedTeam,
    // actions
    load,
    setCategoryFilter,
    setGenderFilter,
    setStatusFilter,
    setCoachStateFilter,
    setSearch,
    openDrawer,
    closeDrawer,
    toggleArchive,
    create,
    update,
    duplicate,
    assignCoach,
    removeCoach,
    refreshTeam,
    addBasketplanLinkLocal,
    removeBasketplanLinkLocal,
    toggleBasketplanLinkLocal,
  }
})
