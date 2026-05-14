import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { FirebaseError } from 'firebase/app'
import {
  cancelCotisation as repoCancelCotisation,
  fetchActiveSeasonId,
  listCotisations,
  type CotisationRow,
  type MarkCotisationPaidPayload,
} from '@/repositories/cotisations.repo'
import {
  markCotisationPaid as callableMarkCotisationPaid,
  type MarkCotisationPaymentMethod,
} from '@/services/cloudFunctions'
import type { CotisationStatus } from '@club-app/shared-types'

/**
 * Filtre statut pour les chips au-dessus du tableau. `all` désactive le
 * filtre — on affiche toutes les cotisations de la saison sélectionnée. Les
 * autres valeurs matchent 1:1 le `CotisationStatus` du schéma.
 */
export type CotisationStatusFilter = 'all' | CotisationStatus

/**
 * Stats agrégées affichées dans les 4 cards en haut d'écran. Les montants
 * sont en CHF (cf. `Cotisation.amount` / `Cotisation.paidAmount`).
 *
 * - `total` : nombre total de cotisations + somme `amount` (engagement annoncé).
 * - `paid` : compte + somme `paidAmount` sur les cotisations `status === 'paid'`.
 * - `pending` : compte des cotisations en attente (`pending_grace` ou `issued`).
 * - `overdue` : compte des cotisations `overdue`.
 *
 * Toutes ces stats portent sur la saison filtrée (ou toutes saisons si
 * `seasonFilter === null`), mais ne tiennent PAS compte du `statusFilter` —
 * elles agrègent toujours sur la saison entière pour offrir une vue stable
 * indépendamment du chip actif.
 */
export interface CotisationsStats {
  total: { count: number; amount: number }
  paid: { count: number; amount: number }
  pending: { count: number }
  overdue: { count: number }
}

/**
 * Une ligne du breakdown "Répartition par type de cotisation".
 *
 * Agrégé sur la liste courante (saison filtrée, indépendamment de
 * `statusFilter` / `searchQuery` / `typeFilter` pour donner une vue stable).
 * `typeName === null` regroupe les cotisations dont l'équipe n'a pas (ou plus)
 * de `cotisationId`, sous le libellé "Sans type" côté UI.
 */
export interface CotisationsBreakdownEntry {
  /** Identifiant logique stable pour `:key` Vue. */
  key: string
  /** Nom du type de cotisation, ou `null` pour les cotisations sans type. */
  typeName: string | null
  /** Nombre de cotisations (cancelled exclu). */
  count: number
  /** Somme `amount` (CHF). */
  duAmount: number
  /** Somme `paidAmount` sur les `paid` (CHF). */
  paidAmount: number
}

/**
 * Source unique des données affichées sur l'écran Cotisations.
 *
 * Architecture en couches : la vue ne lit JAMAIS le repo directement, et le
 * repo est le SEUL à importer le SDK Firebase (cf. apps/web/CLAUDE.md).
 *
 * `load()` est paramétrée par `seasonFilter` (id de saison ou null = toutes).
 * Toute mutation (markPaid / cancel) recharge la liste pour réconcilier avec
 * le serveur — un updateDoc /dues côté client déclenche en cascade les
 * Functions `syncMemberDuesStatus` etc., donc la lecture suivante intègre
 * les effets transitifs.
 *
 * Filtres UI (combinables) :
 *  - `seasonFilter` : `null` = toutes saisons. Modifie la query Firestore.
 *  - `statusFilter` : chip `all | <CotisationStatus>`. JS-only.
 *  - `searchQuery` : substring case-insensitive sur `memberName` OU
 *    `paymentReference` (référence de virement `DUE-XXXXXXXX`). JS-only.
 *  - `typeFilter` : `null` = tous les types, sinon nom du type (cf.
 *    `CotisationRow.cotisationTypeName`). JS-only.
 */
export const useCotisationsStore = defineStore('cotisations', () => {
  const cotisations = ref<CotisationRow[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  /** Saison Firestore active (au plus une, cf. docs/main.md). */
  const activeSeasonId = ref<string | null>(null)
  /** Filtre saison appliqué à la liste. `null` = toutes les saisons. */
  const seasonFilter = ref<string | null>(null)
  /** Filtre status (chip). */
  const statusFilter = ref<CotisationStatusFilter>('all')
  /** Filtre texte sur `memberName` (substring, case-insensitive). */
  const searchQuery = ref<string>('')
  /**
   * Filtre par nom de type de cotisation (cf. `CotisationRow.cotisationTypeName`).
   * `null` = pas de filtre. On filtre sur le **nom** plutôt que l'id parce que
   * `CotisationRow` n'expose pas l'id du type (résolu via `team.cotisationId`
   * côté repo, mais non porté sur le row pour limiter les champs dérivés).
   */
  const typeFilter = ref<string | null>(null)
  /** Id de la cotisation en cours d'action (UI feedback ligne par ligne). */
  const pendingActionFor = ref<string | null>(null)

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  /**
   * Charge la liste pour la saison filtrée courante. À l'ouverture initiale,
   * résout la saison active si pas encore connue et l'utilise comme filtre
   * par défaut.
   *
   * Catch enrichi (apps/web/CLAUDE.md §"Catch enrichi obligatoire") : log le
   * code `FirebaseError` pour faciliter le diagnostic (rules denied, index
   * manquant, etc.) sans casser silencieusement l'écran.
   */
  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      // Premier chargement : résout la saison active et pré-sélectionne.
      if (activeSeasonId.value === null && seasonFilter.value === null) {
        const active = await fetchActiveSeasonId()
        activeSeasonId.value = active
        seasonFilter.value = active
      }
      cotisations.value = await listCotisations(seasonFilter.value)
    } catch (err: unknown) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`cotisations.load failed [${code}]`, err)
      error.value =
        err instanceof Error ? err.message : 'Erreur de chargement des cotisations'
    } finally {
      loading.value = false
    }
  }

  // -------------------------------------------------------------------------
  // Filters
  // -------------------------------------------------------------------------

  function setSeasonFilter(seasonId: string | null): void {
    seasonFilter.value = seasonId
    // Reset les filtres dépendants pour éviter qu'un filtre minoritaire masque
    // la liste après changement de saison.
    statusFilter.value = 'all'
    searchQuery.value = ''
    typeFilter.value = null
    void load()
  }

  function setStatusFilter(status: CotisationStatusFilter): void {
    statusFilter.value = status
  }

  function setSearchQuery(query: string): void {
    searchQuery.value = query
  }

  function setTypeFilter(typeName: string | null): void {
    typeFilter.value = typeName
  }

  /**
   * Vrai si au moins un filtre non-default est actif (status, search ou
   * type). Le `seasonFilter` n'est PAS comptabilisé ici : c'est un filtre
   * structurel (l'écran l'affiche déjà via le Select dédié) et son reset
   * relèverait d'une autre action UX.
   */
  const hasActiveFilters = computed<boolean>(
    () =>
      statusFilter.value !== 'all' ||
      searchQuery.value.trim().length > 0 ||
      typeFilter.value !== null,
  )

  /**
   * Remet les filtres JS-only (status, search, type) à leur valeur par
   * défaut. Ne touche pas au `seasonFilter` — un reset complet impliquerait
   * un `load()` ce qui n'est pas l'intention ici.
   */
  function resetFilters(): void {
    statusFilter.value = 'all'
    searchQuery.value = ''
    typeFilter.value = null
  }

  const filteredCotisations = computed<CotisationRow[]>(() => {
    const status = statusFilter.value
    const search = searchQuery.value.trim().toLocaleLowerCase()
    const type = typeFilter.value
    return cotisations.value.filter((c) => {
      if (status !== 'all' && c.status !== status) return false
      if (type !== null && c.cotisationTypeName !== type) return false
      if (search.length > 0) {
        // Match nom du membre OU référence de paiement (`DUE-XXXXXXXX`).
        // La référence est typiquement collée depuis l'app banque côté
        // trésorier — comparaison case-insensitive pour tolérer une copie en
        // minuscule.
        const name = c.memberName.toLocaleLowerCase()
        const ref = (c.paymentReference ?? '').toLocaleLowerCase()
        if (!name.includes(search) && !ref.includes(search)) return false
      }
      return true
    })
  })

  // -------------------------------------------------------------------------
  // Stats — agrégées sur la saison filtrée, indépendantes des autres filtres.
  // -------------------------------------------------------------------------

  const stats = computed<CotisationsStats>(() => {
    const list = cotisations.value
    const total = { count: 0, amount: 0 }
    const paid = { count: 0, amount: 0 }
    let pendingCount = 0
    let overdueCount = 0

    for (const c of list) {
      // `total` exclut les `cancelled` (engagement annulé, pas comptabilisé).
      if (c.status !== 'cancelled') {
        total.count += 1
        total.amount += c.amount
      }
      if (c.status === 'paid') {
        paid.count += 1
        paid.amount += c.paidAmount ?? 0
      }
      if (c.status === 'pending_grace' || c.status === 'issued') {
        pendingCount += 1
      }
      if (c.status === 'overdue') {
        overdueCount += 1
      }
    }

    return {
      total,
      paid,
      pending: { count: pendingCount },
      overdue: { count: overdueCount },
    }
  })

  /**
   * Répartition par type de cotisation, agrégée sur la saison filtrée
   * (indépendant des autres filtres pour offrir une vue stable). Trie par
   * `duAmount desc` puis par `typeName asc`. Les `cancelled` sont exclus du
   * count et des sommes.
   */
  const breakdownByType = computed<CotisationsBreakdownEntry[]>(() => {
    const buckets = new Map<string, CotisationsBreakdownEntry>()
    for (const c of cotisations.value) {
      if (c.status === 'cancelled') continue
      // Clé interne : `__none__` pour les cotisations sans type — garantit un
      // bucket distinct du type littéral "" ou d'un type dont le nom serait
      // tombé à `null` côté repo (ex. type supprimé).
      const key = c.cotisationTypeName ?? '__none__'
      const existing = buckets.get(key)
      if (existing) {
        existing.count += 1
        existing.duAmount += c.amount
        if (c.status === 'paid') existing.paidAmount += c.paidAmount ?? 0
      } else {
        buckets.set(key, {
          key,
          typeName: c.cotisationTypeName,
          count: 1,
          duAmount: c.amount,
          paidAmount: c.status === 'paid' ? (c.paidAmount ?? 0) : 0,
        })
      }
    }
    return Array.from(buckets.values()).sort((a, b) => {
      if (b.duAmount !== a.duAmount) return b.duAmount - a.duAmount
      const an = a.typeName ?? ''
      const bn = b.typeName ?? ''
      return an.localeCompare(bn)
    })
  })

  /**
   * Liste des noms de types présents dans la saison filtrée. Sert à
   * alimenter le Select "Filtrer par type" sans dépendre du store
   * `cotisationTypes` (qui est plus large : tous les types du référentiel,
   * pas seulement ceux utilisés pour cette saison).
   */
  const typeNamesInUse = computed<string[]>(() => {
    const set = new Set<string>()
    for (const c of cotisations.value) {
      if (c.cotisationTypeName) set.add(c.cotisationTypeName)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  })

  // -------------------------------------------------------------------------
  // Mutations — markPaid / cancel.
  //
  // Après chaque mutation : `load()` pour intégrer les éventuels effets
  // transitifs des Functions (recompute member.duesStatus, etc.).
  // -------------------------------------------------------------------------

  /**
   * Marque une cotisation comme payée via la Cloud Function callable
   * `markDuePaid` (côté serveur — le wrapper TS côté client s'appelle
   * `markCotisationPaid`, cf. `services/cloudFunctions.ts`).
   *
   * Refactor 2026-05-14 : on ne fait plus l'updateDoc côté client. Le callable
   * gère :
   *   - validation `paymentMethod` (whitelist),
   *   - pose `recordedBy` côté serveur (anti-spoof),
   *   - recompute `member.duesStatus` atomiquement,
   *   - autorisation admin OU treasurer (rôle ajouté en parallèle par les
   *     subagents shared-types / functions).
   *
   * Type `MarkCotisationPaidPayload` réutilisé pour ne pas casser l'UX —
   * `method` est étendu côté callable à `'card'` aussi, mais ici on accepte
   * les valeurs d'origine (`'cash' | 'transfer' | 'other'`) plus `'card'` via
   * `MarkCotisationPaymentMethod`.
   */
  async function markPaid(
    cotisationId: string,
    payload: MarkCotisationPaidPayload,
  ): Promise<void> {
    pendingActionFor.value = cotisationId
    error.value = null
    try {
      await callableMarkCotisationPaid({
        cotisationId,
        paidAmount: payload.amount,
        paymentMethod: payload.method as MarkCotisationPaymentMethod,
        // Le callable accepte ISO string ou epoch ms — on passe ISO pour la
        // lisibilité côté logs serveur.
        paidAt: payload.paidAt.toISOString(),
        notes: payload.note && payload.note.trim().length > 0 ? payload.note.trim() : null,
      })
      await load()
    } catch (err: unknown) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`cotisations.markPaid failed [${code}]`, err)
      error.value =
        err instanceof Error ? err.message : 'Erreur lors du marquage du paiement'
      throw err
    } finally {
      pendingActionFor.value = null
    }
  }

  async function cancel(cotisationId: string, reason: string): Promise<void> {
    pendingActionFor.value = cotisationId
    error.value = null
    try {
      await repoCancelCotisation(cotisationId, reason)
      await load()
    } catch (err: unknown) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`cotisations.cancel failed [${code}]`, err)
      error.value =
        err instanceof Error ? err.message : "Erreur lors de l'annulation"
      throw err
    } finally {
      pendingActionFor.value = null
    }
  }

  return {
    // state
    cotisations,
    loading,
    error,
    activeSeasonId,
    seasonFilter,
    statusFilter,
    searchQuery,
    typeFilter,
    pendingActionFor,
    // derived
    filteredCotisations,
    stats,
    breakdownByType,
    typeNamesInUse,
    hasActiveFilters,
    // actions
    load,
    setSeasonFilter,
    setStatusFilter,
    setSearchQuery,
    setTypeFilter,
    resetFilters,
    markPaid,
    cancel,
  }
})
