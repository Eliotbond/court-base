import { FirebaseError } from 'firebase/app'
import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
  type DocumentData,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
  type UpdateData,
} from 'firebase/firestore'
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { db, storage } from '@/services/firebase'
import { postEntry } from '@/repositories/accountingEntries.repo'
import type { Invoice, InvoiceData } from '@club-app/shared-types'

/**
 * Repository Comptabilité — collection `/invoices` (factures fournisseurs) +
 * upload des fichiers de facture dans Firebase Storage.
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase
 * (cf. docs/frontend-desktop.md — architecture en couches). Les writes
 * passent par `/invoices/{invoiceId}` (rules : isRootAdmin || isTreasurer —
 * cf. docs/compta.md §7).
 *
 * Toutes les écritures comptables liées aux factures (comptabilisation,
 * règlement) passent par `postEntry` du repo `accountingEntries.repo` — le
 * moteur de partie double n'est PAS réimplémenté ici (cf. docs/compta.md §5).
 *
 * Volumes faibles attendus → lecture par query simple + tri JS, pas d'index
 * composite (cf. règle 10 du `CLAUDE.md` racine).
 */

const INVOICES = 'invoices'

// ---------------------------------------------------------------------------
// Numéro du compte « Créditeurs (fournisseurs) » — cf. docs/compta.md §3
// ---------------------------------------------------------------------------

/**
 * Code comptable du compte « Créditeurs (fournisseurs) » (nature `passif`).
 * Crédité à la comptabilisation d'une facture, débité à son règlement.
 */
export const CREDITORS_ACCOUNT_NUMBER = '2000'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convertit un snapshot Firestore en `Invoice` typé. */
export function snapToInvoice(
  snap: QueryDocumentSnapshot | DocumentSnapshot,
): Invoice {
  const data = snap.data() as InvoiceData
  return { id: snap.id, ...data }
}

/**
 * Comparator d'affichage : `issueDate` descendante (facture la plus récente
 * en tête). Appliqué côté client — la collection reste petite.
 */
export function compareInvoices(a: Invoice, b: Invoice): number {
  const sa = a.issueDate?.seconds ?? 0
  const sb = b.issueDate?.seconds ?? 0
  return sb - sa
}

// ---------------------------------------------------------------------------
// Types d'input
// ---------------------------------------------------------------------------

/**
 * Input de création d'une facture (saisie manuelle — v1, OCR différé).
 *
 * Les champs dérivés / système sont posés côté repo : `status: 'to_pay'`,
 * `currency: 'CHF'` (si absent), `entryId: null`, `ocrStatus: 'none'`,
 * `ocrRawText: null`, `storagePath: null`, `createdAt: serverTimestamp()`.
 */
export interface CreateInvoiceInput {
  supplierName: string
  invoiceNumber: string | null
  /** Date d'émission — `Date` à la frontière repo, convertie en `Timestamp`. */
  issueDate: Date
  /** Date d'échéance — `null` si non renseignée. */
  dueDate: Date | null
  /** Montant total, CHF. */
  amount: number
  /** Code devise — `'CHF'` si omis. */
  currency?: string
  /** Compte de charge imputé. `null` tant que pas qualifié. */
  expenseAccountId: string | null
  notes: string | null
  /** uid du trésorier / rootAdmin ayant saisi la facture. */
  createdBy: string
}

/** Patch partiel sur `/invoices/{id}`. `Date` converti en `Timestamp`. */
export type InvoicePatch = Partial<{
  supplierName: string
  invoiceNumber: string | null
  issueDate: Date
  dueDate: Date | null
  amount: number
  currency: string
  storagePath: string | null
  status: InvoiceData['status']
  expenseAccountId: string | null
  entryId: string | null
  notes: string | null
}>

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Liste toutes les factures. Tri JS par `issueDate` descendante (pas d'index
 * composite).
 */
export async function listInvoices(): Promise<Invoice[]> {
  try {
    const snap = await getDocs(collection(db, INVOICES))
    if (snap.empty) return []
    return snap.docs.map(snapToInvoice).sort(compareInvoices)
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`listInvoices failed [${code}]`, err)
    throw err
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Crée une facture. Pose les champs système : `status: 'to_pay'`,
 * `currency: 'CHF'` par défaut, `entryId: null`, `ocrStatus: 'none'`,
 * `ocrRawText: null`, `storagePath: null`, `createdAt: serverTimestamp()`.
 * Retourne l'id du document créé.
 */
export async function createInvoice(input: CreateInvoiceInput): Promise<string> {
  try {
    const ref = await addDoc(collection(db, INVOICES), {
      supplierName: input.supplierName,
      invoiceNumber: input.invoiceNumber,
      issueDate: Timestamp.fromDate(input.issueDate),
      dueDate: input.dueDate ? Timestamp.fromDate(input.dueDate) : null,
      amount: input.amount,
      currency: input.currency ?? 'CHF',
      storagePath: null,
      status: 'to_pay',
      expenseAccountId: input.expenseAccountId,
      entryId: null,
      ocrStatus: 'none',
      ocrRawText: null,
      notes: input.notes,
      createdBy: input.createdBy,
      createdAt: serverTimestamp(),
    })
    return ref.id
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`createInvoice failed [${code}]`, err)
    throw err
  }
}

/**
 * Patch partiel sur `/invoices/{id}`. Les champs `Date` (`issueDate`,
 * `dueDate`) sont convertis en `Timestamp` à la frontière repo.
 */
export async function updateInvoice(
  id: string,
  patch: InvoicePatch,
): Promise<void> {
  const data: Record<string, unknown> = { ...patch }
  if (patch.issueDate instanceof Date) {
    data.issueDate = Timestamp.fromDate(patch.issueDate)
  }
  if (patch.dueDate instanceof Date) {
    data.dueDate = Timestamp.fromDate(patch.dueDate)
  }
  try {
    await updateDoc(doc(db, INVOICES, id), data as UpdateData<DocumentData>)
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`updateInvoice failed [${code}]`, err)
    throw err
  }
}

// ---------------------------------------------------------------------------
// Storage — fichier de facture
// ---------------------------------------------------------------------------

/**
 * Upload le fichier (PDF / image) d'une facture dans Firebase Storage et
 * retourne le **path** Storage (pas l'URL). L'appelant doit ensuite appeler
 * `updateInvoice(id, { storagePath })` pour persister le path.
 *
 * Path : `accounting/invoices/{invoiceId}/{timestamp}_{fileName}`. Le timestamp
 * en préfixe du nom évite la collision si la facture est re-uploadée (un
 * nouveau path force le rafraîchissement client — cache-busting).
 *
 * Validation côté UI (taille ≤ 10 MB, type PDF/image) — les rules Storage
 * redoublent en garde-fou (cf. docs/compta.md §7).
 */
export async function uploadInvoiceFile(
  invoiceId: string,
  file: File,
): Promise<string> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `accounting/invoices/${invoiceId}/${Date.now()}_${safeName}`
  const fileRef = storageRef(storage, path)
  try {
    await uploadBytes(fileRef, file, { contentType: file.type })
    // On lit l'URL pour valider l'upload, mais on retourne le path (le
    // schéma /invoices stocke un `storagePath`, pas une URL).
    await getDownloadURL(fileRef)
    return path
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`uploadInvoiceFile failed [${code}]`, err)
    throw err
  }
}

/**
 * Résout l'URL de download d'un fichier de facture à partir de son path
 * Storage. Utile pour l'aperçu / téléchargement depuis l'UI.
 */
export async function getInvoiceFileUrl(storagePath: string): Promise<string> {
  try {
    return await getDownloadURL(storageRef(storage, storagePath))
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`getInvoiceFileUrl failed [${code}]`, err)
    throw err
  }
}

// ---------------------------------------------------------------------------
// Comptabilisation / règlement — passe par postEntry (moteur partie double)
// ---------------------------------------------------------------------------

/**
 * Comptabilise une facture `to_pay` non encore comptabilisée (cf. docs/compta.md
 * §5). Génère une écriture en partie double via `postEntry` :
 *  - **Débit** du compte de charge imputé (`expenseAccountId`).
 *  - **Crédit** du compte « Créditeurs (fournisseurs) » (n° 2000, `passif`).
 *
 * Puis persiste sur la facture : `entryId` (référence l'écriture) et
 * `expenseAccountId` (compte de charge retenu). Retourne l'id de l'écriture.
 *
 * @param invoice            facture cible (doit être `status: 'to_pay'`,
 *                           `entryId: null` — la garde est portée par l'UI)
 * @param expenseAccountId   compte de charge à débiter
 * @param creditorAccountId  compte « Créditeurs » (n° 2000) à créditer
 * @param createdBy          uid du trésorier / rootAdmin
 */
export async function bookInvoice(
  invoice: Invoice,
  expenseAccountId: string,
  creditorAccountId: string,
  createdBy: string,
): Promise<string> {
  try {
    const entryId = await postEntry({
      date: new Date(),
      label: `Facture ${invoice.supplierName}${
        invoice.invoiceNumber ? ` — ${invoice.invoiceNumber}` : ''
      }`,
      reference: invoice.invoiceNumber,
      source: 'invoice',
      invoiceId: invoice.id,
      lines: [
        { accountId: expenseAccountId, debit: invoice.amount, credit: 0 },
        { accountId: creditorAccountId, debit: 0, credit: invoice.amount },
      ],
      createdBy,
    })
    await updateInvoice(invoice.id, { entryId, expenseAccountId })
    return entryId
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`bookInvoice failed [${code}]`, err)
    throw err
  }
}

/**
 * Marque une facture comme payée (cf. docs/compta.md §5). Génère l'écriture de
 * règlement via `postEntry` :
 *  - **Débit** du compte « Créditeurs (fournisseurs) ».
 *  - **Crédit** d'un compte de trésorerie (Caisse / Banque).
 *
 * Puis passe la facture à `status: 'paid'`.
 *
 * @param invoice            facture cible (typiquement déjà comptabilisée)
 * @param treasuryAccountId  compte de trésorerie à créditer
 * @param creditorAccountId  compte « Créditeurs » (n° 2000) à débiter
 * @param createdBy          uid du trésorier / rootAdmin
 */
export async function markInvoicePaid(
  invoice: Invoice,
  treasuryAccountId: string,
  creditorAccountId: string,
  createdBy: string,
): Promise<void> {
  try {
    await postEntry({
      date: new Date(),
      label: `Règlement facture ${invoice.supplierName}${
        invoice.invoiceNumber ? ` — ${invoice.invoiceNumber}` : ''
      }`,
      reference: invoice.invoiceNumber,
      source: 'invoice',
      invoiceId: invoice.id,
      lines: [
        { accountId: creditorAccountId, debit: invoice.amount, credit: 0 },
        { accountId: treasuryAccountId, debit: 0, credit: invoice.amount },
      ],
      createdBy,
    })
    await updateInvoice(invoice.id, { status: 'paid' })
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`markInvoicePaid failed [${code}]`, err)
    throw err
  }
}
