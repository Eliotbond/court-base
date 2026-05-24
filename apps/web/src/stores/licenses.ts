import { FirebaseError } from 'firebase/app'
import { ref } from 'vue'
import { defineStore } from 'pinia'
import {
  createLicense as repoCreateLicense,
  deleteLicense as repoDeleteLicense,
  listMemberLicenses,
  type CreateLicenseInput,
} from '@/repositories/licenses.repo'
import { confirmLicense as confirmLicenseCallable } from '@/services/cloudFunctions'
import type { License } from '@club-app/shared-types'

export type { CreateLicenseInput }

/**
 * Store des licences `/licenses` d'UN membre (page Member detail).
 *
 * Le store est scopé au membre couramment affiché : `load(memberId)` charge
 * ses licences, les mutations (`create` / `confirm`) re-synchronisent la liste
 * locale. La transition `pending → active` passe par la callable serveur
 * `confirmLicense` (poste l'écriture comptable + dénormalise
 * `member.officialLicense` / `coachLicense`) — d'où le reload après confirm
 * pour réconcilier l'état.
 *
 * Pattern composition API aligné sur `cotisations` / `seasons`, try/catch
 * enrichi `FirebaseError` (cf. `apps/web/CLAUDE.md` "Catch enrichi").
 */
export const useLicensesStore = defineStore('licenses', () => {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const licenses = ref<License[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** Membre couramment chargé (garde anti-stale-load). */
  const loadedMemberId = ref<string | null>(null)
  /** Une mutation (création) est en cours. */
  const creating = ref(false)
  /** Id de la licence sur laquelle une confirmation est en cours. */
  const confirmingId = ref<string | null>(null)
  /** Id de la licence sur laquelle une suppression est en cours. */
  const removingId = ref<string | null>(null)

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function load(memberId: string): Promise<void> {
    loading.value = true
    error.value = null
    loadedMemberId.value = memberId
    try {
      const rows = await listMemberLicenses(memberId)
      // Garde anti-race : ignore le résultat si la vue a navigué entre-temps.
      if (loadedMemberId.value !== memberId) return
      licenses.value = rows
    } catch (e: unknown) {
      if (loadedMemberId.value !== memberId) return
      const code = e instanceof FirebaseError ? e.code : 'unknown'
      console.error(`[licenses store/load] failed [${code}]`, e)
      error.value =
        e instanceof Error ? e.message : 'Erreur de chargement des licences'
    } finally {
      if (loadedMemberId.value === memberId) loading.value = false
    }
  }

  /** Vide le store (au démontage de la vue détail). */
  function reset(): void {
    licenses.value = []
    loadedMemberId.value = null
    error.value = null
    loading.value = false
    creating.value = false
    confirmingId.value = null
    removingId.value = null
  }

  /**
   * Crée une licence `pending` pour le membre. Insère le row retourné en
   * tête de liste. Retourne l'id créé, ou `null` sur erreur.
   */
  async function create(input: CreateLicenseInput): Promise<string | null> {
    error.value = null
    creating.value = true
    try {
      const created = await repoCreateLicense(input)
      licenses.value = [created, ...licenses.value]
      return created.id
    } catch (e: unknown) {
      const code = e instanceof FirebaseError ? e.code : 'unknown'
      console.error(`[licenses store/create] failed [${code}]`, e)
      error.value =
        e instanceof Error ? e.message : 'Erreur lors de la création de la licence'
      return null
    } finally {
      creating.value = false
    }
  }

  /**
   * Confirme une licence `pending` via la callable serveur `confirmLicense`.
   * Le serveur poste l'écriture comptable de la charge et dénormalise
   * `member.officialLicense` / `coachLicense` — on recharge la liste après
   * succès pour refléter `status: 'active'`. Retourne `true` sur succès.
   */
  async function confirm(licenseId: string): Promise<boolean> {
    error.value = null
    confirmingId.value = licenseId
    try {
      await confirmLicenseCallable({ licenseId })
      if (loadedMemberId.value) await load(loadedMemberId.value)
      return true
    } catch (e: unknown) {
      const code = e instanceof FirebaseError ? e.code : 'unknown'
      console.error(`[licenses store/confirm] failed [${code}]`, e)
      error.value =
        e instanceof Error ? e.message : 'Erreur lors de la confirmation de la licence'
      return false
    } finally {
      confirmingId.value = null
    }
  }

  /**
   * Supprime une licence `pending` (jamais activée pour la saison). Retire
   * la ligne du cache local sur succès. Retourne `true` sur succès.
   * Les licences `active` / `cancelled` ne peuvent PAS être supprimées —
   * voir `deleteLicense` du repo pour la garde de status.
   */
  async function remove(licenseId: string): Promise<boolean> {
    error.value = null
    removingId.value = licenseId
    try {
      await repoDeleteLicense(licenseId)
      licenses.value = licenses.value.filter((l) => l.id !== licenseId)
      return true
    } catch (e: unknown) {
      const code = e instanceof FirebaseError ? e.code : 'unknown'
      console.error(`[licenses store/remove] failed [${code}]`, e)
      error.value =
        e instanceof Error ? e.message : 'Erreur lors de la suppression de la licence'
      return false
    } finally {
      removingId.value = null
    }
  }

  return {
    // state
    licenses,
    loading,
    error,
    creating,
    confirmingId,
    removingId,
    // actions
    load,
    reset,
    create,
    confirm,
    remove,
  }
})
