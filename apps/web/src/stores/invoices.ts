import { ref } from 'vue'
import { defineStore } from 'pinia'
import { FirebaseError } from 'firebase/app'
import {
  bookInvoice,
  createInvoice,
  listInvoices,
  markInvoicePaid,
  updateInvoice,
  uploadInvoiceFile,
  type CreateInvoiceInput,
} from '@/repositories/invoices.repo'
import { postEntry, type PostEntryInput } from '@/repositories/accountingEntries.repo'
import { useAuthStore } from '@/stores/auth'
import type { Invoice } from '@club-app/shared-types'

/**
 * Re-exporte le type d'input de création pour faciliter l'import côté
 * composants (un seul `from '@/stores/invoices'`).
 */
export type { CreateInvoiceInput }

/**
 * Payload d'une saisie manuelle de débit / écriture générique — l'UI fournit
 * tout sauf `createdBy` (résolu par le store via `useAuthStore`).
 */
export type ManualEntryInput = Omit<PostEntryInput, 'createdBy'>

/**
 * Source unique des données du module **Factures** `/invoices` (comptabilité —
 * cf. docs/compta.md §3/§5).
 *
 * Le store consomme uniquement le repository `invoices.repo` (et `postEntry`
 * pour les saisies manuelles) — les composants n'écrivent jamais directement
 * dans Firestore (cf. architecture en couches, `apps/web/CLAUDE.md`).
 * Try/catch enrichi avec le code `FirebaseError` pour éviter les erreurs
 * silencieuses (rules denied, index manquant, …).
 */
export const useInvoicesStore = defineStore('invoices', () => {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const invoices = ref<Invoice[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // ---------------------------------------------------------------------------
  // Helpers (privés)
  // ---------------------------------------------------------------------------

  /**
   * Remplace en place le row matching `id` par `next` ; insère en tête sinon.
   * Re-trie par `issueDate` descendante pour conserver l'ordre d'affichage.
   */
  function upsert(next: Invoice): void {
    const idx = invoices.value.findIndex((i) => i.id === next.id)
    let copy: Invoice[]
    if (idx === -1) {
      copy = [next, ...invoices.value]
    } else {
      copy = invoices.value.slice()
      copy[idx] = next
    }
    copy.sort((a, b) => (b.issueDate?.seconds ?? 0) - (a.issueDate?.seconds ?? 0))
    invoices.value = copy
  }

  /** uid courant via le store auth. `'unknown'` en fallback défensif. */
  function currentUid(): string {
    return useAuthStore().authSnap?.uid ?? 'unknown'
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /** Charge l'ensemble des factures. */
  async function loadInvoices(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      invoices.value = await listInvoices()
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`loadInvoices failed [${code}]`, err)
      error.value =
        err instanceof Error ? err.message : 'Erreur de chargement des factures'
    } finally {
      loading.value = false
    }
  }

  /**
   * Crée une facture (saisie manuelle). `createdBy` est résolu via le store
   * auth. Si `file` est fourni, l'upload Storage est enchaîné et le
   * `storagePath` persisté sur la facture. Recharge ensuite la liste pour
   * refléter le `createdAt` réel. Retourne l'id ou `null` en cas d'erreur.
   */
  async function addInvoice(
    input: Omit<CreateInvoiceInput, 'createdBy'>,
    file?: File | null,
  ): Promise<string | null> {
    error.value = null
    try {
      const id = await createInvoice({ ...input, createdBy: currentUid() })
      if (file) {
        const storagePath = await uploadInvoiceFile(id, file)
        await updateInvoice(id, { storagePath })
      }
      await loadInvoices()
      return id
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`addInvoice failed [${code}]`, err)
      error.value =
        err instanceof Error
          ? err.message
          : 'Erreur lors de la création de la facture'
      return null
    }
  }

  /**
   * Attache (ou remplace) le fichier d'une facture existante : upload Storage
   * puis persistance du `storagePath`. Upsert local sur le row mis à jour.
   */
  async function attachFile(invoiceId: string, file: File): Promise<boolean> {
    error.value = null
    try {
      const storagePath = await uploadInvoiceFile(invoiceId, file)
      await updateInvoice(invoiceId, { storagePath })
      const current = invoices.value.find((i) => i.id === invoiceId)
      if (current) upsert({ ...current, storagePath })
      return true
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`attachFile failed [${code}]`, err)
      error.value =
        err instanceof Error
          ? err.message
          : "Erreur lors de l'envoi du fichier de facture"
      return false
    }
  }

  /**
   * Comptabilise une facture (écriture débit charge / crédit Créditeurs).
   * Recharge la liste pour refléter `entryId` + `expenseAccountId`. Retourne
   * l'id de l'écriture créée ou `null` en cas d'erreur.
   */
  async function book(
    invoice: Invoice,
    expenseAccountId: string,
    creditorAccountId: string,
  ): Promise<string | null> {
    error.value = null
    try {
      const entryId = await bookInvoice(
        invoice,
        expenseAccountId,
        creditorAccountId,
        currentUid(),
      )
      await loadInvoices()
      return entryId
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`book failed [${code}]`, err)
      error.value =
        err instanceof Error
          ? err.message
          : 'Erreur lors de la comptabilisation de la facture'
      return null
    }
  }

  /**
   * Marque une facture payée (écriture débit Créditeurs / crédit trésorerie).
   * Recharge la liste pour refléter `status: 'paid'`.
   */
  async function markPaid(
    invoice: Invoice,
    treasuryAccountId: string,
    creditorAccountId: string,
  ): Promise<boolean> {
    error.value = null
    try {
      await markInvoicePaid(
        invoice,
        treasuryAccountId,
        creditorAccountId,
        currentUid(),
      )
      await loadInvoices()
      return true
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`markPaid failed [${code}]`, err)
      error.value =
        err instanceof Error
          ? err.message
          : 'Erreur lors du passage de la facture à payée'
      return false
    }
  }

  /**
   * Saisie manuelle d'un débit / écriture générique (hors facture). Délègue
   * directement à `postEntry` (moteur de partie double — agent B). `createdBy`
   * résolu via le store auth. Retourne l'id de l'écriture ou `null` en cas
   * d'erreur. N'affecte pas `invoices` (la collection `/invoices` n'est pas
   * concernée par une écriture `source: 'manual'`).
   */
  async function addManualEntry(input: ManualEntryInput): Promise<string | null> {
    error.value = null
    try {
      return await postEntry({ ...input, createdBy: currentUid() })
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`addManualEntry failed [${code}]`, err)
      error.value =
        err instanceof Error
          ? err.message
          : "Erreur lors de l'enregistrement de l'écriture manuelle"
      return null
    }
  }

  return {
    // state
    invoices,
    loading,
    error,
    // actions
    loadInvoices,
    addInvoice,
    attachFile,
    book,
    markPaid,
    addManualEntry,
  }
})
