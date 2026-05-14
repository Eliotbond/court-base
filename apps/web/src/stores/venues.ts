import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { ComputedRef } from 'vue'
import type { Court } from '@club-app/shared-types'
import {
  listVenues,
  listAllCourts,
  listCourts as repoListCourts,
  createVenue as repoCreateVenue,
  updateVenue as repoUpdateVenue,
  deleteVenue as repoDeleteVenue,
  createCourt as repoCreateCourt,
  updateCourt as repoUpdateCourt,
  deleteCourt as repoDeleteCourt,
  setCourtActive as repoSetCourtActive,
  addCustomClosure as repoAddClosure,
  removeCustomClosure as repoRemoveClosure,
  type CreateVenueInput,
  type UpdateVenueInput,
  type CreateCourtInput,
  type UpdateCourtInput,
  type CustomClosureInput,
  type VenueRow,
} from '@/repositories/venues.repo'

/**
 * Store Pinia — Salles & terrains.
 *
 * Responsabilités :
 *  - Charger et exposer la liste des `VenueRow` (salle + compteurs courts).
 *  - Maintenir la carte `courtsByVenue` (venueId → Court[]) en cohérence avec
 *    les `courtCount` / `activeCourtCount` portés par chaque `VenueRow`.
 *  - Piloter la sélection master/detail (`selectedVenueId`) sans routing.
 *  - Exposer les actions CRUD pour les salles et les terrains — toutes en
 *    try/catch, toutes délèguent au repository `venues.repo.ts`.
 *
 * Pattern d'utilisation dans une vue :
 * ```ts
 * const store = useVenuesStore()
 * onMounted(() => store.load())
 * ```
 *
 * La vue ne lit jamais Firebase directement — elle passe toujours par ce store.
 */
export const useVenuesStore = defineStore('venues', () => {
  // ---------------------------------------------------------------------------
  // État
  // ---------------------------------------------------------------------------

  /** Liste des salles avec compteurs courts pré-calculés. */
  const venues = ref<VenueRow[]>([])

  /**
   * Terrains regroupés par salle. Clé = venueId. Initialisé lors de `load()`
   * via `listAllCourts()` pour éviter N+1. Re-fetchable par salle via
   * `refreshCourts(venueId)`.
   */
  const courtsByVenue = ref<Map<string, Court[]>>(new Map())

  /** Vrai pendant les opérations asynchrones de chargement initial. */
  const loading = ref(false)

  /** Dernier message d'erreur (en français). `null` = aucune erreur. */
  const error = ref<string | null>(null)

  /** Texte saisi dans la barre de recherche (filtré sur nom + adresse). */
  const search = ref('')

  /** Id de la salle sélectionnée dans le panneau de détail. `null` = fermé. */
  const selectedVenueId = ref<string | null>(null)

  // ---------------------------------------------------------------------------
  // Computed
  // ---------------------------------------------------------------------------

  /**
   * Liste filtrée par la recherche texte (nom ou adresse, insensible à la
   * casse, locale française). Si `search` est vide, retourne `venues` directement
   * sans copie inutile.
   */
  const filtered: ComputedRef<VenueRow[]> = computed<VenueRow[]>(() => {
    const q = search.value.trim().toLowerCase()
    if (!q) return venues.value
    return venues.value.filter((v) => {
      const haystack = [v.name, v.address].join(' ').toLocaleLowerCase('fr')
      return haystack.includes(q)
    })
  })

  /**
   * Salle actuellement sélectionnée, ou `null` si `selectedVenueId` ne pointe
   * plus sur un id présent dans `venues` (ex. suppression en cours de session).
   */
  const selectedVenue: ComputedRef<VenueRow | null> = computed<VenueRow | null>(() => {
    const id = selectedVenueId.value
    if (id === null) return null
    return venues.value.find((v) => v.id === id) ?? null
  })

  /**
   * Terrains de la salle sélectionnée. Tableau vide si aucune salle
   * sélectionnée ou si la salle n'a pas encore de terrains chargés.
   */
  const selectedCourts: ComputedRef<Court[]> = computed<Court[]>(() => {
    const id = selectedVenueId.value
    if (id === null) return []
    return courtsByVenue.value.get(id) ?? []
  })

  /**
   * Totaux globaux : nombre de salles, nombre total de terrains et nombre de
   * terrains actifs. Calculés en lisant `courtsByVenue` (source unique de
   * vérité pour les terrains) — pas les compteurs portés par `VenueRow` qui
   * pourraient être légèrement décalés.
   */
  const totals: ComputedRef<{ venues: number; courts: number; activeCourts: number }> =
    computed(() => {
      let courts = 0
      let activeCourts = 0
      for (const list of courtsByVenue.value.values()) {
        courts += list.length
        activeCourts += list.filter((c) => c.active).length
      }
      return { venues: venues.value.length, courts, activeCourts }
    })

  // ---------------------------------------------------------------------------
  // Helpers internes
  // ---------------------------------------------------------------------------

  /**
   * Insère ou remplace un `VenueRow` dans `venues` en préservant l'ordre des
   * autres éléments. Un row absent est inséré en tête.
   */
  function upsertVenue(next: VenueRow): void {
    const idx = venues.value.findIndex((v) => v.id === next.id)
    if (idx === -1) {
      venues.value = [next, ...venues.value]
    } else {
      const copy = venues.value.slice()
      copy[idx] = next
      venues.value = copy
    }
  }

  /**
   * Insère ou remplace un terrain dans `courtsByVenue[venueId]`. Si la clé
   * n'existe pas encore, crée un tableau avec le seul terrain.
   */
  function upsertCourt(venueId: string, next: Court): void {
    const existing = courtsByVenue.value.get(venueId) ?? []
    const idx = existing.findIndex((c) => c.id === next.id)
    const updated =
      idx === -1 ? [...existing, next] : existing.map((c, i) => (i === idx ? next : c))
    // Remplace la Map entière pour déclencher la réactivité Vue 3.
    const next_map = new Map(courtsByVenue.value)
    next_map.set(venueId, updated)
    courtsByVenue.value = next_map
  }

  /**
   * Retire un terrain du tableau en mémoire pour `venueId`. Ne fait rien si le
   * terrain n'est pas trouvé.
   */
  function removeCourtFromState(venueId: string, courtId: string): void {
    const existing = courtsByVenue.value.get(venueId)
    if (!existing) return
    const next_map = new Map(courtsByVenue.value)
    next_map.set(
      venueId,
      existing.filter((c) => c.id !== courtId),
    )
    courtsByVenue.value = next_map
  }

  /**
   * Recalcule `courtCount` et `activeCourtCount` d'une salle en relisant le
   * Map `courtsByVenue`. Appelée après toute mutation de terrain pour garder
   * les compteurs cohérents avec la vérité locale.
   */
  function recomputeVenueCourtCounts(venueId: string): void {
    const idx = venues.value.findIndex((v) => v.id === venueId)
    if (idx === -1) return
    const courts = courtsByVenue.value.get(venueId) ?? []
    const copy = venues.value.slice()
    copy[idx] = {
      ...copy[idx],
      courtCount: courts.length,
      activeCourtCount: courts.filter((c) => c.active).length,
    }
    venues.value = copy
  }

  // ---------------------------------------------------------------------------
  // Actions — chargement
  // ---------------------------------------------------------------------------

  /**
   * Charge la liste des salles et l'ensemble des terrains en parallèle.
   * Re-calculcule les compteurs à partir du Map pour garantir la cohérence,
   * même si le backend retourne des chiffres différents.
   */
  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const [venueList, allCourts] = await Promise.all([listVenues(), listAllCourts()])
      courtsByVenue.value = allCourts
      // Recalcule courtCount/activeCourtCount depuis la source locale.
      venues.value = venueList.map((v) => {
        const courts = allCourts.get(v.id) ?? []
        return {
          ...v,
          courtCount: courts.length,
          activeCourtCount: courts.filter((c) => c.active).length,
        }
      })
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur de chargement des salles et terrains'
    } finally {
      loading.value = false
    }
  }

  // ---------------------------------------------------------------------------
  // Actions — navigation / filtres
  // ---------------------------------------------------------------------------

  /** Met à jour le filtre de recherche texte. */
  function setSearch(value: string): void {
    search.value = value
  }

  /**
   * Sélectionne une salle pour le panneau de détail. Passer `null` ferme le
   * panneau.
   */
  function selectVenue(id: string | null): void {
    selectedVenueId.value = id
  }

  /**
   * Re-fetche les terrains d'une salle précise depuis le repository, puis met
   * à jour le Map et les compteurs de la salle. Utile après une modification
   * faite depuis un autre onglet ou pour forcer la fraîcheur des données.
   */
  async function refreshCourts(venueId: string): Promise<void> {
    error.value = null
    try {
      const courts = await repoListCourts(venueId)
      const next_map = new Map(courtsByVenue.value)
      next_map.set(venueId, courts)
      courtsByVenue.value = next_map
      recomputeVenueCourtCounts(venueId)
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors du rechargement des terrains'
    }
  }

  // ---------------------------------------------------------------------------
  // Actions — CRUD salles
  // ---------------------------------------------------------------------------

  /**
   * Crée une nouvelle salle. Insère le row retourné en tête de `venues` et
   * sélectionne automatiquement la nouvelle salle dans le panneau de détail.
   * Retourne l'id de la salle créée, ou `null` en cas d'erreur.
   */
  async function createVenue(input: CreateVenueInput): Promise<string | null> {
    error.value = null
    try {
      const row = await repoCreateVenue(input)
      upsertVenue(row)
      // Initialise une entrée vide dans la Map pour éviter undefined au premier accès.
      const next_map = new Map(courtsByVenue.value)
      if (!next_map.has(row.id)) next_map.set(row.id, [])
      courtsByVenue.value = next_map
      selectedVenueId.value = row.id
      return row.id
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors de la création de la salle'
      return null
    }
  }

  /**
   * Met à jour les données d'une salle (nom, adresse, coordonnées). Remplace
   * le row en mémoire via `upsertVenue`. Retourne `true` si la mise à jour a
   * abouti.
   */
  async function updateVenue(id: string, patch: UpdateVenueInput): Promise<boolean> {
    error.value = null
    try {
      const row = await repoUpdateVenue(id, patch)
      if (!row) return false
      upsertVenue(row)
      return true
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors de la mise à jour de la salle'
      return false
    }
  }

  /**
   * Supprime une salle et tous ses terrains. Retire la salle de `venues`, purge
   * son entrée dans `courtsByVenue`, et désélectionne si c'était la salle
   * active. Retourne `true` si la suppression a abouti.
   */
  async function deleteVenue(id: string): Promise<boolean> {
    error.value = null
    try {
      await repoDeleteVenue(id)
      venues.value = venues.value.filter((v) => v.id !== id)
      const next_map = new Map(courtsByVenue.value)
      next_map.delete(id)
      courtsByVenue.value = next_map
      if (selectedVenueId.value === id) selectedVenueId.value = null
      return true
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors de la suppression de la salle'
      return false
    }
  }

  // ---------------------------------------------------------------------------
  // Actions — CRUD terrains
  // ---------------------------------------------------------------------------

  /**
   * Crée un terrain dans une salle. Ajoute le terrain au Map local puis
   * recalcule les compteurs de la salle parente. Retourne l'id du terrain créé,
   * ou `null` en cas d'erreur.
   */
  async function createCourt(
    venueId: string,
    input: CreateCourtInput,
  ): Promise<string | null> {
    error.value = null
    try {
      const court = await repoCreateCourt(venueId, input)
      upsertCourt(venueId, court)
      recomputeVenueCourtCounts(venueId)
      return court.id
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors de la création du terrain'
      return null
    }
  }

  /**
   * Met à jour les propriétés d'un terrain. Le terrain modifié remplace
   * l'existant dans le Map via `upsertCourt`. Retourne `true` si la mise à
   * jour a abouti.
   */
  async function updateCourt(
    venueId: string,
    courtId: string,
    patch: UpdateCourtInput,
  ): Promise<boolean> {
    error.value = null
    try {
      const court = await repoUpdateCourt(venueId, courtId, patch)
      if (!court) return false
      upsertCourt(venueId, court)
      recomputeVenueCourtCounts(venueId)
      return true
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors de la mise à jour du terrain'
      return false
    }
  }

  /**
   * Supprime un terrain. Retire le terrain du Map local et recalcule les
   * compteurs de la salle parente. Retourne `true` si la suppression a abouti.
   */
  async function deleteCourt(venueId: string, courtId: string): Promise<boolean> {
    error.value = null
    try {
      await repoDeleteCourt(venueId, courtId)
      removeCourtFromState(venueId, courtId)
      recomputeVenueCourtCounts(venueId)
      return true
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors de la suppression du terrain'
      return false
    }
  }

  /**
   * Bascule le flag `active` d'un terrain (activation / désactivation). Lit
   * l'état courant depuis le Map local pour déterminer le prochain état.
   * Met à jour le terrain via le repository puis recalcule les compteurs.
   */
  async function toggleCourtActive(venueId: string, courtId: string): Promise<void> {
    const courts = courtsByVenue.value.get(venueId) ?? []
    const target = courts.find((c) => c.id === courtId)
    if (!target) return
    error.value = null
    try {
      const court = await repoSetCourtActive(venueId, courtId, !target.active)
      if (!court) return
      upsertCourt(venueId, court)
      recomputeVenueCourtCounts(venueId)
    } catch (e: unknown) {
      error.value =
        e instanceof Error
          ? e.message
          : "Erreur lors du changement d'état du terrain"
    }
  }

  // ---------------------------------------------------------------------------
  // Actions — fermetures exceptionnelles
  // ---------------------------------------------------------------------------

  /**
   * Ajoute une fermeture exceptionnelle à une salle. Le `VenueRow` retourné
   * par le repository (avec la liste de fermetures mise à jour) remplace
   * l'existant via `upsertVenue`. Retourne `true` si l'ajout a abouti.
   */
  async function addCustomClosure(
    venueId: string,
    closure: CustomClosureInput,
  ): Promise<boolean> {
    error.value = null
    try {
      const row = await repoAddClosure(venueId, closure)
      if (!row) return false
      upsertVenue(row)
      return true
    } catch (e: unknown) {
      error.value =
        e instanceof Error
          ? e.message
          : "Erreur lors de l'ajout de la fermeture exceptionnelle"
      return false
    }
  }

  /**
   * Retire une fermeture exceptionnelle d'une salle par index dans le tableau
   * `customClosures`. Le `VenueRow` retourné remplace l'existant via
   * `upsertVenue`. Retourne `true` si la suppression a abouti.
   */
  async function removeCustomClosure(venueId: string, index: number): Promise<boolean> {
    error.value = null
    try {
      const row = await repoRemoveClosure(venueId, index)
      if (!row) return false
      upsertVenue(row)
      return true
    } catch (e: unknown) {
      error.value =
        e instanceof Error
          ? e.message
          : 'Erreur lors de la suppression de la fermeture exceptionnelle'
      return false
    }
  }

  // ---------------------------------------------------------------------------
  // Interface publique
  // ---------------------------------------------------------------------------

  return {
    // state
    venues,
    courtsByVenue,
    loading,
    error,
    search,
    selectedVenueId,
    // computed
    filtered,
    selectedVenue,
    selectedCourts,
    totals,
    // actions — navigation / filtres
    setSearch,
    selectVenue,
    refreshCourts,
    // actions — CRUD salles
    load,
    createVenue,
    updateVenue,
    deleteVenue,
    // actions — CRUD terrains
    createCourt,
    updateCourt,
    deleteCourt,
    toggleCourtActive,
    // actions — fermetures exceptionnelles
    addCustomClosure,
    removeCustomClosure,
  }
})
