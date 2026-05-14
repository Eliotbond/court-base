import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  cancelDue as repoCancelDue,
  fetchActiveSeasonId,
  listDues,
  markDuePaid as repoMarkPaid,
  type DueRow,
  type MarkDuePaidPayload,
} from '@/repositories/dues.repo'
import type { DueStatus } from '@club-app/shared-types'

/**
 * Filtre statut pour les chips au-dessus du tableau. `all` désactive le
 * filtre — on affiche toutes les dues de la saison sélectionnée. Les autres
 * valeurs matchent 1:1 le `DueStatus` du schéma.
 */
export type DueStatusFilter = 'all' | DueStatus

/**
 * Stats agrégées affichées dans les 4 cards en haut d'écran. Les montants
 * sont en CHF (cf. `Due.amount` / `Due.paidAmount`).
 *
 * - `total` : nombre total de dues + somme `amount` (engagement annoncé).
 * - `paid` : compte + somme `paidAmount` sur les dues `status === 'paid'`.
 * - `pending` : compte des dues en attente (`pending_grace` ou `issued`).
 * - `overdue` : compte des dues `overdue`.
 *
 * Toutes ces stats portent sur la saison filtrée (ou toutes saisons si
 * `seasonFilter === null`), mais ne tiennent PAS compte du `statusFilter` —
 * elles agrègent toujours sur la saison entière pour offrir une vue stable
 * indépendamment du chip actif.
 */
export interface DuesStats {
  total: { count: number; amount: number }
  paid: { count: number; amount: number }
  pending: { count: number }
  overdue: { count: number }
}

/**
 * Source unique des données affichées sur l'écran Dues.
 *
 * Architecture en couches : la vue ne lit JAMAIS le repo directement, et le
 * repo est le SEUL à importer le SDK Firebase (cf. apps/web/CLAUDE.md).
 *
 * `load()` est paramétrée par `seasonFilter` (id de saison ou null = toutes).
 * Toute mutation (markPaid / cancel) recharge la liste pour réconcilier avec
 * le serveur — un updateDoc /dues côté client déclenche en cascade les
 * Functions `syncMemberDuesStatus` etc., donc la lecture suivante intègre
 * les effets transitifs.
 */
export const useDuesStore = defineStore('dues', () => {
  const dues = ref<DueRow[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  /** Saison Firestore active (au plus une, cf. docs/main.md). */
  const activeSeasonId = ref<string | null>(null)
  /** Filtre saison appliqué à la liste. `null` = toutes les saisons. */
  const seasonFilter = ref<string | null>(null)
  /** Filtre status (chip). */
  const statusFilter = ref<DueStatusFilter>('all')
  /** Id de la due en cours d'action (UI feedback ligne par ligne). */
  const pendingActionFor = ref<string | null>(null)

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  /**
   * Charge la liste pour la saison filtrée courante. À l'ouverture initiale,
   * résout la saison active si pas encore connue et l'utilise comme filtre
   * par défaut.
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
      dues.value = await listDues(seasonFilter.value)
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur de chargement des cotisations'
    } finally {
      loading.value = false
    }
  }

  // -------------------------------------------------------------------------
  // Filters
  // -------------------------------------------------------------------------

  function setSeasonFilter(seasonId: string | null): void {
    seasonFilter.value = seasonId
    // Reset le chip status pour éviter qu'un filtre minoritaire masque la
    // liste après changement de saison.
    statusFilter.value = 'all'
    void load()
  }

  function setStatusFilter(status: DueStatusFilter): void {
    statusFilter.value = status
  }

  const filteredDues = computed<DueRow[]>(() => {
    const f = statusFilter.value
    if (f === 'all') return dues.value
    return dues.value.filter((d) => d.status === f)
  })

  // -------------------------------------------------------------------------
  // Stats — agrégées sur la saison filtrée, indépendantes du chip status.
  // -------------------------------------------------------------------------

  const stats = computed<DuesStats>(() => {
    const list = dues.value
    const total = { count: 0, amount: 0 }
    const paid = { count: 0, amount: 0 }
    let pendingCount = 0
    let overdueCount = 0

    for (const d of list) {
      // `total` exclut les `cancelled` (engagement annulé, pas comptabilisé).
      if (d.status !== 'cancelled') {
        total.count += 1
        total.amount += d.amount
      }
      if (d.status === 'paid') {
        paid.count += 1
        paid.amount += d.paidAmount ?? 0
      }
      if (d.status === 'pending_grace' || d.status === 'issued') {
        pendingCount += 1
      }
      if (d.status === 'overdue') {
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

  // -------------------------------------------------------------------------
  // Mutations — markPaid / cancel.
  //
  // Après chaque mutation : `load()` pour intégrer les éventuels effets
  // transitifs des Functions (recompute member.duesStatus, etc.).
  // -------------------------------------------------------------------------

  async function markPaid(
    dueId: string,
    payload: MarkDuePaidPayload,
  ): Promise<void> {
    pendingActionFor.value = dueId
    error.value = null
    try {
      await repoMarkPaid(dueId, payload)
      await load()
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors du marquage du paiement'
      throw e
    } finally {
      pendingActionFor.value = null
    }
  }

  async function cancel(dueId: string, reason: string): Promise<void> {
    pendingActionFor.value = dueId
    error.value = null
    try {
      await repoCancelDue(dueId, reason)
      await load()
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : "Erreur lors de l'annulation"
      throw e
    } finally {
      pendingActionFor.value = null
    }
  }

  return {
    // state
    dues,
    loading,
    error,
    activeSeasonId,
    seasonFilter,
    statusFilter,
    pendingActionFor,
    // derived
    filteredDues,
    stats,
    // actions
    load,
    setSeasonFilter,
    setStatusFilter,
    markPaid,
    cancel,
  }
})
