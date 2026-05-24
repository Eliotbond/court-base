import { FirebaseError } from 'firebase/app'
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { listAllLicenses } from '@/repositories/licenses.repo'
import type { License, LicenseRole, LicenseStatus } from '@club-app/shared-types'

/**
 * Filtre statut pour les chips au-dessus du tableau. `all` désactive le filtre.
 * Les autres valeurs matchent 1:1 le `LicenseStatus` du schéma.
 */
export type LicenseStatusFilter = 'all' | LicenseStatus

/**
 * Filtre rôle pour les chips. `all` désactive le filtre. Les autres valeurs
 * matchent 1:1 le `LicenseRole` du schéma.
 */
export type LicenseRoleFilter = 'all' | LicenseRole

/**
 * Liste canonique des statuts pour itérer (compteurs par statut). Garde
 * l'ordre d'affichage des chips (Pending → Active → Cancelled).
 */
const STATUSES: readonly LicenseStatus[] = ['pending', 'active', 'cancelled']

/**
 * Liste canonique des rôles pour itérer (compteurs par rôle). Aligné avec
 * l'enum `LicenseRole` du schéma.
 */
const ROLES: readonly LicenseRole[] = ['player', 'official', 'coach', 'referee']

/**
 * Normalise une chaîne pour la recherche : lowercase + strip d'accents
 * (NFD + suppression des marques combinantes). Évite la dépendance à un util
 * supplémentaire — pattern utilisé tel quel dans d'autres stores.
 */
function normalize(input: string): string {
  // U+0300 → U+036F = "Combining Diacritical Marks" block. NFD décompose
  // les caractères accentués en (base + marque combinante), `replace` retire
  // les marques.
  return input
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/**
 * Source unique des données affichées sur l'onglet **Licences émises** de la
 * page `/licenses` (apps/web — vue admin).
 *
 * Architecture en couches : la vue ne lit JAMAIS le repo directement, et le
 * repo est le SEUL à importer le SDK Firebase (cf. apps/web/CLAUDE.md).
 *
 * `load()` est paramétrée par `seasonFilter` (id de saison ou `null` = toutes).
 * Filtres UI combinables :
 *  - `seasonFilter` : `null` = toutes les saisons. Modifie la query Firestore.
 *  - `statusFilter` : chip `all | <LicenseStatus>`. JS-only.
 *  - `roleFilter` : chip `all | <LicenseRole>`. JS-only.
 *  - `search` : substring sur `licenseName` + `memberId` (accent-insensitive).
 *    JS-only. Les noms de membres sont résolus côté vue via `useMembersStore`
 *    (les licences ne dénormalisent pas le nom — `License` ne porte que
 *    `memberId`).
 *
 * Note : ce store coexiste avec `useLicensesStore` (`stores/licenses.ts`) qui
 * est scopé à UN membre (consommé par `OfficialTab`). Le présent store est la
 * vue centralisée admin — d'où le nom distinct `'licensesIndex'`.
 */
export const useLicensesIndexStore = defineStore('licensesIndex', () => {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const licenses = ref<License[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** `null` = toutes saisons. */
  const seasonFilter = ref<string | null>(null)
  const statusFilter = ref<LicenseStatusFilter>('all')
  const roleFilter = ref<LicenseRoleFilter>('all')
  const search = ref('')

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------

  /**
   * Charge les licences pour la saison actuellement filtrée. Catch enrichi
   * (cf. apps/web/CLAUDE.md §"Catch enrichi obligatoire") : log le code
   * `FirebaseError` et pose un message lisible dans `error`.
   */
  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      licenses.value = await listAllLicenses(seasonFilter.value ?? undefined)
    } catch (err: unknown) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`licensesIndex.load failed [${code}]`, err)
      error.value =
        err instanceof Error
          ? err.message
          : 'Erreur de chargement des licences'
    } finally {
      loading.value = false
    }
  }

  // ---------------------------------------------------------------------------
  // Filters (setters) — seasonFilter déclenche un reload (économise le filter
  // client en restreignant la query serveur-side).
  // ---------------------------------------------------------------------------

  function setSeasonFilter(value: string | null): void {
    seasonFilter.value = value
    void load()
  }

  function setStatusFilter(value: LicenseStatusFilter): void {
    statusFilter.value = value
  }

  function setRoleFilter(value: LicenseRoleFilter): void {
    roleFilter.value = value
  }

  function setSearch(value: string): void {
    search.value = value
  }

  /**
   * Remet les filtres JS-only (status, role, search) à leur valeur par défaut.
   * Ne touche PAS au `seasonFilter` — c'est un filtre structurel (l'écran
   * l'affiche via un Select dédié) et son reset relèverait d'une autre action
   * UX (évite aussi un reload Firestore non-désiré).
   */
  function resetFilters(): void {
    statusFilter.value = 'all'
    roleFilter.value = 'all'
    search.value = ''
  }

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  /**
   * Compteurs par statut, indépendants des autres filtres (statut, rôle,
   * search). Agrégés sur `licenses` (saison filtrée). Inclut `all` = total.
   */
  const countsByStatus = computed<Record<LicenseStatus, number> & { all: number }>(
    () => {
      const out = { all: 0, pending: 0, active: 0, cancelled: 0 } as Record<
        LicenseStatus,
        number
      > & { all: number }
      for (const l of licenses.value) {
        out.all += 1
        // `l.status` est typé `LicenseStatus` ; les 3 clés ci-dessus couvrent l'enum.
        out[l.status] += 1
      }
      return out
    },
  )

  /**
   * Compteurs par rôle, indépendants des autres filtres. Agrégés sur
   * `licenses` (saison filtrée). Inclut `all` = total.
   */
  const countsByRole = computed<Record<LicenseRole, number> & { all: number }>(
    () => {
      const out = {
        all: 0,
        player: 0,
        official: 0,
        coach: 0,
        referee: 0,
      } as Record<LicenseRole, number> & { all: number }
      for (const l of licenses.value) {
        out.all += 1
        out[l.role] += 1
      }
      return out
    },
  )

  /**
   * Liste filtrée par statut ∩ rôle ∩ search. La recherche est
   * accent-insensitive et matche sur `licenseName` (snapshot du nom du type)
   * et sur `memberId` (au cas où l'utilisateur colle un id depuis l'URL —
   * pour matcher sur le NOM du membre, la vue doit composer son propre filtre
   * via `useMembersStore`).
   */
  const filtered = computed<License[]>(() => {
    const status = statusFilter.value
    const role = roleFilter.value
    const needle = normalize(search.value.trim())
    return licenses.value.filter((l) => {
      if (status !== 'all' && l.status !== status) return false
      if (role !== 'all' && l.role !== role) return false
      if (needle.length > 0) {
        const hay = `${normalize(l.licenseName)} ${l.memberId.toLowerCase()}`
        if (!hay.includes(needle)) return false
      }
      return true
    })
  })

  return {
    // state
    licenses,
    loading,
    error,
    seasonFilter,
    statusFilter,
    roleFilter,
    search,
    // actions
    load,
    setSeasonFilter,
    setStatusFilter,
    setRoleFilter,
    setSearch,
    resetFilters,
    // derived
    countsByStatus,
    countsByRole,
    filtered,
    // exported constants — utiles à la vue pour les itérations de chips
    STATUSES,
    ROLES,
  }
})
