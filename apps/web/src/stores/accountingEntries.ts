import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { FirebaseError } from 'firebase/app'
import {
  listEntries,
  postCredit,
  postEntry,
  reverseEntry,
  type PostEntryInput,
} from '@/repositories/accountingEntries.repo'
import { useAuthStore } from '@/stores/auth'
import type { AccountingEntry } from '@club-app/shared-types'

/**
 * Source unique des données du journal comptable `/accountingEntries`
 * (module Comptabilité — cf. docs/compta.md).
 *
 * Architecture en couches (apps/web/CLAUDE.md) : le store consomme uniquement
 * le repository `accountingEntries.repo` ; les composants n'écrivent jamais
 * directement dans Firestore. Try/catch enrichi avec le code `FirebaseError`
 * pour éviter les erreurs silencieuses (rules denied, index manquant, …).
 *
 * Le `createdBy` des écritures est résolu ici à partir du `uid` du caller
 * (via `useAuthStore`) — jamais saisi côté UI (anti-spoof côté client ; la
 * garde réelle est portée par `firestore.rules`).
 *
 * Append-only : aucune action de suppression. L'annulation d'une écriture
 * passe par `reverse` (contre-passation).
 */
export const useAccountingEntriesStore = defineStore('accountingEntries', () => {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const entries = ref<AccountingEntry[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // ---------------------------------------------------------------------------
  // Helpers (privés)
  // ---------------------------------------------------------------------------

  /**
   * Résout le `uid` du trésorier / rootAdmin connecté. Throw si personne
   * n'est signé — une écriture comptable ne peut pas être anonyme.
   */
  function requireUid(): string {
    const auth = useAuthStore()
    const uid = auth.authSnap?.uid
    if (!uid) {
      throw new Error('Vous devez être connecté pour enregistrer une écriture.')
    }
    return uid
  }

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------

  /** Charge l'ensemble du journal (tri date décroissante côté repo). */
  async function loadEntries(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      entries.value = await listEntries()
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`accountingEntries.loadEntries failed [${code}]`, err)
      error.value =
        err instanceof Error ? err.message : 'Erreur de chargement du journal'
    } finally {
      loading.value = false
    }
  }

  // ---------------------------------------------------------------------------
  // Mutations — chaque action recharge le journal pour réconcilier avec le
  // serveur (`createdAt` serverTimestamp, ordre, etc.).
  // ---------------------------------------------------------------------------

  /**
   * Enregistre un crédit (saisie simplifiée — docs/compta.md §5). `createdBy`
   * est résolu côté store. Retourne l'id de l'écriture ou `null` en cas
   * d'erreur (message dans `error.value`).
   */
  async function addCredit(input: {
    accountId: string
    treasuryAccountId: string
    amount: number
    date: Date
    label: string
    reference?: string | null
  }): Promise<string | null> {
    error.value = null
    try {
      const id = await postCredit({ ...input, createdBy: requireUid() })
      await loadEntries()
      return id
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`accountingEntries.addCredit failed [${code}]`, err)
      error.value =
        err instanceof Error
          ? err.message
          : "Erreur lors de l'enregistrement du crédit"
      return null
    }
  }

  /**
   * Enregistre une écriture générique (saisie manuelle, facture…).
   * `createdBy` est résolu côté store — le caller passe le reste de l'input.
   * Retourne l'id de l'écriture ou `null` en cas d'erreur.
   */
  async function addEntry(
    input: Omit<PostEntryInput, 'createdBy'>,
  ): Promise<string | null> {
    error.value = null
    try {
      const id = await postEntry({ ...input, createdBy: requireUid() })
      await loadEntries()
      return id
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`accountingEntries.addEntry failed [${code}]`, err)
      error.value =
        err instanceof Error
          ? err.message
          : "Erreur lors de l'enregistrement de l'écriture"
      return null
    }
  }

  /**
   * Annule une écriture par contre-passation (docs/compta.md §2). Retourne
   * l'id de la contre-passation ou `null` en cas d'erreur.
   */
  async function reverse(entryId: string): Promise<string | null> {
    error.value = null
    try {
      const id = await reverseEntry(entryId, requireUid())
      await loadEntries()
      return id
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`accountingEntries.reverse failed [${code}]`, err)
      error.value =
        err instanceof Error
          ? err.message
          : "Erreur lors de l'annulation de l'écriture"
      return null
    }
  }

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  /** Écritures de saisie de crédit uniquement (`source === 'credit'`). */
  const creditEntries = computed<AccountingEntry[]>(() =>
    entries.value.filter((e) => e.source === 'credit'),
  )

  return {
    // state
    entries,
    loading,
    error,
    // derived
    creditEntries,
    // actions
    loadEntries,
    addCredit,
    addEntry,
    reverse,
  }
})
