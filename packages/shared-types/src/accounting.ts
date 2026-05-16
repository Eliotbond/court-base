import type { Timestamp } from './index'

/**
 * Module **Comptabilité** — comptabilité en partie double du club.
 * Voir docs/compta.md (source de vérité produit) + docs/firebase.md
 * (sections `/accounts`, `/accountingEntries`, `/invoices`).
 *
 * Accès : rôle `treasurer` + claim `rootAdmin` UNIQUEMENT. L'`admin`
 * standard est exclu de ces collections (cf. `firestore.rules`).
 */

// ============================================================================
// /accounts/{accountId} — plan comptable
// ============================================================================

/**
 * Nature comptable d'un compte. Détermine le sens du solde :
 *  - `actif` / `charge`  → solde = Σ débit − Σ crédit
 *  - `passif` / `produit` → solde = Σ crédit − Σ débit
 */
export type AccountNature = 'actif' | 'passif' | 'charge' | 'produit'

export interface AccountData {
  /** Code comptable, unique (ex. "3000"). */
  number: string
  name: string
  nature: AccountNature
  /**
   * `true` = compte de trésorerie (Caisse / Banque). Utilisable comme
   * contrepartie automatique dans la saisie simplifiée (UI « un côté »).
   */
  isTreasury: boolean
  description: string | null
  /** `true` = compte seedé par défaut — protégé en suppression. */
  isDefault: boolean
  active: boolean
  /** Tri stable dans le plan comptable et les pickers. */
  displayOrder: number
  createdAt: Timestamp
}

export interface Account extends AccountData {
  id: string
}

// ============================================================================
// /accountingEntries/{entryId} — journal (écritures en partie double)
// ============================================================================

/**
 * Origine d'une écriture comptable :
 *  - `credit`  → saisie d'un crédit (cash, sponsoring, subvention J+S…)
 *  - `invoice` → écriture liée à une facture fournisseur (`/invoices`)
 *  - `manual`  → saisie manuelle générique (2 comptes libres)
 */
export type EntrySource = 'credit' | 'invoice' | 'manual'

/**
 * Une ligne d'écriture impute un montant à un compte, soit au débit soit
 * au crédit. Exactement un des deux montants est `> 0`, l'autre vaut `0`.
 */
export interface AccountingEntryLine {
  accountId: string
  /** Montant au débit, `>= 0`. */
  debit: number
  /** Montant au crédit, `>= 0`. */
  credit: number
}

export interface AccountingEntryData {
  date: Timestamp
  label: string
  /** Référence libre (n° de pièce, libellé externe…). */
  reference: string | null
  source: EntrySource
  /** Ref vers `/invoices/{invoiceId}` si `source === 'invoice'`, `null` sinon. */
  invoiceId: string | null
  /**
   * Lignes de l'écriture : au moins 2, équilibrées (`Σ debit === Σ credit`).
   */
  lines: AccountingEntryLine[]
  /** `true` si cette écriture a été contre-passée (annulée). */
  reversed: boolean
  /**
   * Si cette écriture EST une contre-passation, référence l'écriture
   * d'origine annulée. `null` pour une écriture normale.
   */
  reversalOfEntryId: string | null
  /** uid du trésorier / rootAdmin ayant créé l'écriture. */
  createdBy: string
  createdAt: Timestamp
}

export interface AccountingEntry extends AccountingEntryData {
  id: string
}

// ============================================================================
// /invoices/{invoiceId} — factures fournisseurs
// ============================================================================

export type InvoiceStatus = 'to_pay' | 'paid' | 'cancelled'

/**
 * État OCR de la facture. Réservé : OCR différé en v1 (saisie manuelle).
 * Tous les champs `ocr*` restent inertes (`ocrStatus: 'none'`) en v1.
 */
export type OcrStatus = 'none' | 'pending' | 'done' | 'failed'

export interface InvoiceData {
  supplierName: string
  invoiceNumber: string | null
  issueDate: Timestamp
  dueDate: Timestamp | null
  /** Montant total, CHF. */
  amount: number
  /** Code devise — `'CHF'` par défaut. */
  currency: string
  /** Path du fichier uploadé dans Storage (`accounting/invoices/...`). */
  storagePath: string | null
  status: InvoiceStatus
  /** Compte de charge imputé. `null` tant que pas qualifié. */
  expenseAccountId: string | null
  /** Écriture comptable liée. `null` tant que la facture n'est pas comptabilisée. */
  entryId: string | null
  /** `'none'` en v1 (OCR différé). */
  ocrStatus: OcrStatus
  /** Texte brut extrait par l'OCR. `null` en v1. */
  ocrRawText: string | null
  notes: string | null
  /** uid du trésorier / rootAdmin ayant saisi la facture. */
  createdBy: string
  createdAt: Timestamp
}

export interface Invoice extends InvoiceData {
  id: string
}
