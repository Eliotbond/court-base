/**
 * Store Registrations — Inscriptions (coach).
 *
 * Source hybride : Firestore réel via `@/repositories/registrations.repo`
 * quand l'utilisateur a des équipes Firestore chargées (via `useTeamsStore`).
 * Fallback mock via `@/repositories/mock` quand on est en mode démo.
 *
 * Convention : toutes les transitions de status passent par les callables
 * (`markTrialInProgress`, `confirmRegistration`, `refuseRegistration`). Pas
 * de mutation locale du state — au retour de la callable, on recharge
 * depuis la source pour rester aligné serveur.
 *
 * Filtres : 4 buckets sémantiques (cf. `@/utils/registrationBuckets`) +
 * "Toutes" pour voir tout.
 */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { FirebaseError } from 'firebase/app'

import {
  listRegistrations as listRegistrationsMock,
  logMockAction,
} from '@/repositories/mock'
import { listRegistrationsForTeams as listRegistrationsForTeamsReal } from '@/repositories/registrations.repo'
import {
  confirmRegistration as callConfirmRegistration,
  markTrialInProgress as callMarkTrialInProgress,
  refuseRegistration as callRefuseRegistration,
} from '@/services/cloudFunctions'
import type { MockRegistration, RegistrationBucket } from '@/types/mock'
import { bucketFor } from '@/utils/registrationBuckets'

export type RegistrationsSource = 'firestore' | 'mock'

/**
 * Quick-filter : 4 buckets sémantiques + "actionable" (demande + essai
 * combinés = tout ce qui demande une action coach) + "all" pour tout voir.
 * `actionable` est le défaut : c'est la vue de travail du coach.
 */
export type RegistrationsFilter = RegistrationBucket | 'actionable' | 'all'

export const useRegistrationsStore = defineStore('registrations', () => {
  // ─── State ────────────────────────────────────────────────────
  const items = ref<MockRegistration[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const source = ref<RegistrationsSource>('mock')
  const filter = ref<RegistrationsFilter>('actionable')
  const mutating = ref<string | null>(null) // registrationId en cours de mutation

  // ─── Actions ──────────────────────────────────────────────────
  /**
   * Charge les registrations.
   *
   * @param teamIds  Ids des équipes du coach (depuis `useTeamsStore.teams`).
   *                 Si non vide → frappe Firestore.
   * @param fallbackToMock  Si true et `teamIds.length === 0` → fallback mock.
   */
  async function load(
    teamIds: readonly string[],
    fallbackToMock = true,
  ): Promise<void> {
    error.value = null
    if (teamIds.length > 0) {
      loading.value = true
      try {
        items.value = await listRegistrationsForTeamsReal(teamIds)
        source.value = 'firestore'
      } catch (err) {
        const code = err instanceof FirebaseError ? err.code : 'unknown'
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[registrations.store] load failed [${code}]`, err)
        error.value = message
        items.value = []
        source.value = 'firestore'
      } finally {
        loading.value = false
      }
      return
    }
    if (fallbackToMock) {
      items.value = listRegistrationsMock()
      source.value = 'mock'
      return
    }
    items.value = []
    source.value = 'firestore'
  }

  function setFilter(f: RegistrationsFilter): void {
    if (filter.value === f) return
    filter.value = f
  }

  /** Démarre l'essai (callable réelle si source firestore, log-only sinon). */
  async function markTrial(registrationId: string): Promise<void> {
    mutating.value = registrationId
    error.value = null
    try {
      if (source.value === 'firestore') {
        await callMarkTrialInProgress({ registrationId })
        // Reload — le status vient du serveur (idempotent).
        await reload()
      } else {
        logMockAction('registrations.markTrial', { registrationId })
        // Mock : on patch in-memory pour démontrer l'état suivant.
        patchLocal(registrationId, { status: 'trial_in_progress' })
      }
    } catch (err) {
      handleError(err, 'markTrial')
      throw err
    } finally {
      mutating.value = null
    }
  }

  /** Confirme l'intégration. */
  async function confirm(registrationId: string): Promise<void> {
    mutating.value = registrationId
    error.value = null
    try {
      if (source.value === 'firestore') {
        await callConfirmRegistration({ registrationId })
        await reload()
      } else {
        logMockAction('registrations.confirm', { registrationId })
        patchLocal(registrationId, { status: 'confirmed_pending_dues' })
      }
    } catch (err) {
      handleError(err, 'confirm')
      throw err
    } finally {
      mutating.value = null
    }
  }

  /** Refuse. `reason` ≥ 5 chars (validation serveur). */
  async function refuse(registrationId: string, reason: string): Promise<void> {
    mutating.value = registrationId
    error.value = null
    try {
      if (source.value === 'firestore') {
        await callRefuseRegistration({ registrationId, reason })
        await reload()
      } else {
        logMockAction('registrations.refuse', { registrationId, reason })
        patchLocal(registrationId, { status: 'refused', refusalReason: reason })
      }
    } catch (err) {
      handleError(err, 'refuse')
      throw err
    } finally {
      mutating.value = null
    }
  }

  /**
   * Reload depuis la même source que le dernier `load` — utilisé après une
   * mutation callable. En mode mock on relit la liste mock (rappel : le mock
   * est immuable, donc le patch local appliqué dans markTrial/confirm/refuse
   * disparaîtra ; c'est volontaire).
   */
  async function reload(): Promise<void> {
    if (source.value === 'firestore') {
      // On a perdu la trace des teamIds initiaux — la vue rappellera load()
      // après la mutation si nécessaire. En attendant, on re-frappe avec les
      // teams uniques des items courants (best-effort).
      const teamIds = Array.from(new Set(items.value.map((r) => r.teamId)))
      if (teamIds.length > 0) {
        items.value = await listRegistrationsForTeamsReal(teamIds)
      }
    }
  }

  function patchLocal(registrationId: string, patch: Partial<MockRegistration>): void {
    items.value = items.value.map((r) => (r.id === registrationId ? { ...r, ...patch } : r))
  }

  function handleError(err: unknown, action: string): void {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[registrations.store] ${action} failed [${code}]`, err)
    error.value = `${action} (${code}): ${message}`
  }

  // ─── Getters ──────────────────────────────────────────────────
  /** Comptes par bucket — pour les chips de filtre. */
  const counts = computed<Record<RegistrationsFilter, number>>(() => {
    const acc: Record<RegistrationsFilter, number> = {
      all: items.value.length,
      actionable: 0,
      demande: 0,
      essai: 0,
      confirmed: 0,
      terminal: 0,
    }
    for (const r of items.value) {
      const b = bucketFor(r.status)
      acc[b] += 1
      if (b === 'demande' || b === 'essai') acc.actionable += 1
    }
    return acc
  })

  /** Liste filtrée selon le bucket courant. */
  const filtered = computed<MockRegistration[]>(() => {
    if (filter.value === 'all') return items.value
    if (filter.value === 'actionable') {
      return items.value.filter((r) => {
        const b = bucketFor(r.status)
        return b === 'demande' || b === 'essai'
      })
    }
    return items.value.filter((r) => bucketFor(r.status) === filter.value)
  })

  return {
    // state
    items,
    loading,
    error,
    source,
    filter,
    mutating,
    // getters
    counts,
    filtered,
    // actions
    load,
    setFilter,
    markTrial,
    confirm,
    refuse,
  }
})
