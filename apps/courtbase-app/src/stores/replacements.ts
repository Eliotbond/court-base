/**
 * Store Replacements — Demandes de remplacement entre officiels.
 *
 * Hybride mock + Firestore réel (cf. pattern `apps/courtbase-app/CLAUDE.md`).
 * Pour un member donné, charge en parallèle :
 *   - **incoming** : demandes reçues (`targetMemberId == memberId`).
 *   - **outgoing** : demandes sortantes (`requesterMemberId == memberId`).
 *
 * Idempotent : `load(memberId)` ne re-fetch que si le memberId change ou
 * si le store n'a pas encore été hydraté. Après une mutation (accept /
 * decline / cancel / create), on refetch pour rester synchronisé — pas
 * de patch in-place (plus simple à raisonner, volume très faible).
 */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import type { ReplacementRequest } from '@club-app/shared-types'

import {
  acceptReplacementRequest,
  cancelReplacementRequest,
  createReplacementRequest,
  declineReplacementRequest,
  listIncomingReplacementRequests,
  listOutgoingReplacementRequests,
  type CreateReplacementRequestInput,
} from '@/repositories/replacements.repo'

export const useReplacementsStore = defineStore('replacements', () => {
  // ─── State ──────────────────────────────────────────────────────
  const incoming = ref<ReplacementRequest[]>([])
  const outgoing = ref<ReplacementRequest[]>([])
  const loading = ref(false)
  const lastError = ref<string | null>(null)

  /** Garde anti-double-fetch (clé : memberId). */
  let hydrated = false
  let hydratedMemberId: string | null = null

  // ─── Actions ────────────────────────────────────────────────────

  /**
   * Charge incoming + outgoing en parallèle. Idempotent : ne re-fetch que
   * si `memberId` change. Pour forcer un refresh, utiliser `refresh()`.
   */
  async function load(memberId: string): Promise<void> {
    if (!memberId) return
    if (hydrated && hydratedMemberId === memberId) return
    loading.value = true
    lastError.value = null
    try {
      const [incomingResult, outgoingResult] = await Promise.all([
        listIncomingReplacementRequests(memberId),
        listOutgoingReplacementRequests(memberId),
      ])
      incoming.value = incomingResult
      outgoing.value = outgoingResult
      hydrated = true
      hydratedMemberId = memberId
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[replacements.store] load failed', err)
      lastError.value = msg
    } finally {
      loading.value = false
    }
  }

  /**
   * Force un refetch (incoming + outgoing) pour le memberId actuellement
   * hydraté. Utilisé après une mutation pour resynchroniser.
   */
  async function refresh(): Promise<void> {
    if (!hydratedMemberId) return
    const memberId = hydratedMemberId
    hydrated = false
    await load(memberId)
  }

  async function createRequest(input: CreateReplacementRequestInput): Promise<void> {
    try {
      await createReplacementRequest(input)
      await refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      lastError.value = msg
      throw err
    }
  }

  async function acceptRequest(id: string): Promise<void> {
    try {
      await acceptReplacementRequest(id)
      await refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      lastError.value = msg
      throw err
    }
  }

  async function declineRequest(id: string, reason: string | null): Promise<void> {
    try {
      await declineReplacementRequest(id, reason)
      await refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      lastError.value = msg
      throw err
    }
  }

  async function cancelRequest(id: string): Promise<void> {
    try {
      await cancelReplacementRequest(id)
      await refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      lastError.value = msg
      throw err
    }
  }

  /** Reset complet (déconnexion, switch user). */
  function reset(): void {
    incoming.value = []
    outgoing.value = []
    lastError.value = null
    hydrated = false
    hydratedMemberId = null
  }

  // ─── Getters ────────────────────────────────────────────────────

  const incomingPending = computed<ReplacementRequest[]>(() =>
    incoming.value.filter((r) => r.status === 'pending'),
  )
  const outgoingPending = computed<ReplacementRequest[]>(() =>
    outgoing.value.filter((r) => r.status === 'pending'),
  )

  return {
    // state
    incoming,
    outgoing,
    loading,
    lastError,
    // actions
    load,
    refresh,
    createRequest,
    acceptRequest,
    declineRequest,
    cancelRequest,
    reset,
    // getters
    incomingPending,
    outgoingPending,
  }
})
