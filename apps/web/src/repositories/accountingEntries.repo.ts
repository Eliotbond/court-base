import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDocs,
  serverTimestamp,
  writeBatch,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '@/services/firebase'
import type {
  AccountingEntry,
  AccountingEntryData,
  AccountingEntryLine,
  EntrySource,
} from '@club-app/shared-types'

/**
 * Repository Comptabilité — collection `/accountingEntries` (journal des
 * écritures en partie double).
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase
 * (cf. docs/frontend-desktop.md — architecture en couches). Le store
 * `stores/accountingEntries.ts` consomme uniquement ce module ; les vues ne
 * touchent jamais Firestore directement.
 *
 * MOTEUR d'écritures (partie double — docs/compta.md §2) :
 *  - une écriture porte `lines: AccountingEntryLine[]` (≥ 2 lignes) ;
 *  - chaque ligne impute un montant à un compte, soit au débit soit au crédit
 *    (exactement un des deux > 0, l'autre = 0, aucun négatif) ;
 *  - l'écriture est équilibrée : `Σ debit === Σ credit`.
 *
 * Append-only (docs/compta.md §2, §7 — `allow delete: if false`) : aucune
 * écriture n'est jamais supprimée. L'annulation passe par `reverseEntry` qui
 * crée une contre-passation et marque l'écriture d'origine `reversed: true`.
 *
 * Volumes faibles attendus (quelques centaines d'écritures par exercice) →
 * lecture par query simple + tri JS, pas d'index composite (cf. règle 10 du
 * `CLAUDE.md` racine + docs/compta.md §4).
 */

const ACCOUNTING_ENTRIES = 'accountingEntries'

/**
 * Tolérance d'arrondi (CHF) pour la comparaison `Σ debit === Σ credit`.
 * Absorbe les erreurs de représentation flottante sur des montants au
 * centime ; un déséquilibre réel est toujours supérieur.
 */
const BALANCE_EPSILON = 0.005

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convertit un snapshot Firestore en `AccountingEntry` typé. */
export function snapToEntry(
  snap: QueryDocumentSnapshot | DocumentSnapshot,
): AccountingEntry {
  const data = snap.data() as AccountingEntryData
  return { id: snap.id, ...data }
}

// ---------------------------------------------------------------------------
// Validation — invariant de la partie double (exporté pour réutilisation UI)
// ---------------------------------------------------------------------------

/**
 * Valide l'invariant de la partie double sur un jeu de lignes. Throw une
 * `Error` au message explicite (destinée à être surfacée côté UI) si :
 *  - il y a moins de 2 lignes ;
 *  - une ligne porte un montant négatif (`debit` ou `credit` < 0) ;
 *  - une ligne a `debit` ET `credit` > 0, ou les deux à 0 (exactement un
 *    des deux doit être strictement positif) ;
 *  - l'écriture n'est pas équilibrée : `Σ debit !== Σ credit` (au-delà de la
 *    tolérance d'arrondi `BALANCE_EPSILON`).
 *
 * Exporté pour que l'UI puisse valider avant soumission (feedback immédiat)
 * en plus du contrôle systématique fait par `postEntry`.
 */
export function validateEntryBalance(lines: AccountingEntryLine[]): void {
  if (lines.length < 2) {
    throw new Error(
      'Une écriture comptable doit comporter au moins 2 lignes.',
    )
  }

  let totalDebit = 0
  let totalCredit = 0

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const position = i + 1
    if (line.debit < 0 || line.credit < 0) {
      throw new Error(
        `Ligne ${position} : les montants débit / crédit ne peuvent pas être négatifs.`,
      )
    }
    const debitPositive = line.debit > 0
    const creditPositive = line.credit > 0
    if (debitPositive && creditPositive) {
      throw new Error(
        `Ligne ${position} : une ligne ne peut pas avoir à la fois un débit et un crédit.`,
      )
    }
    if (!debitPositive && !creditPositive) {
      throw new Error(
        `Ligne ${position} : une ligne doit avoir un débit OU un crédit strictement positif.`,
      )
    }
    totalDebit += line.debit
    totalCredit += line.credit
  }

  if (Math.abs(totalDebit - totalCredit) > BALANCE_EPSILON) {
    throw new Error(
      `Écriture déséquilibrée : Σ débit (${totalDebit.toFixed(2)}) ≠ Σ crédit (${totalCredit.toFixed(2)}).`,
    )
  }
}

// ---------------------------------------------------------------------------
// Types d'input
// ---------------------------------------------------------------------------

/**
 * Payload de création d'une écriture comptable générique. `date` est une
 * `Date` JS à la frontière du repo — convertie en `Timestamp` au storage
 * (cf. apps/web/CLAUDE.md). Les champs `reversed`, `reversalOfEntryId` et
 * `createdAt` sont posés par le repo et n'apparaissent pas ici.
 */
export interface PostEntryInput {
  date: Date
  label: string
  reference?: string | null
  source: EntrySource
  invoiceId?: string | null
  lines: AccountingEntryLine[]
  createdBy: string
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Liste toutes les écritures du journal. Tri JS par `date` décroissante
 * (écriture la plus récente en tête) — pas d'index composite.
 */
export async function listEntries(): Promise<AccountingEntry[]> {
  const snap = await getDocs(collection(db, ACCOUNTING_ENTRIES))
  if (snap.empty) return []
  return snap.docs.map(snapToEntry).sort((a, b) => {
    const da = a.date?.seconds ?? 0
    const dbDate = b.date?.seconds ?? 0
    return dbDate - da
  })
}

// ---------------------------------------------------------------------------
// Writes — moteur
// ---------------------------------------------------------------------------

/**
 * Crée une écriture comptable. Valide l'invariant de la partie double via
 * `validateEntryBalance` AVANT toute écriture Firestore — un input
 * déséquilibré throw et ne crée rien.
 *
 * Champs posés par le repo :
 *  - `reversed: false`, `reversalOfEntryId: null` (écriture normale) ;
 *  - `date` converti `Date → Timestamp` ;
 *  - `createdAt: serverTimestamp()`.
 *
 * Retourne l'id du document créé.
 *
 * SIGNATURE STABLE — consommée par d'autres modules de la comptabilité
 * (factures fournisseurs, saisie manuelle). Ne pas modifier sans coordination.
 */
export async function postEntry(input: PostEntryInput): Promise<string> {
  validateEntryBalance(input.lines)
  const ref = await addDoc(collection(db, ACCOUNTING_ENTRIES), {
    date: Timestamp.fromDate(input.date),
    label: input.label,
    reference: input.reference ?? null,
    source: input.source,
    invoiceId: input.invoiceId ?? null,
    lines: input.lines,
    reversed: false,
    reversalOfEntryId: null,
    createdBy: input.createdBy,
    createdAt: serverTimestamp(),
  })
  return ref.id
}

/**
 * Saisie simplifiée d'un crédit (cash, sponsoring, subvention J+S…) — UI
 * « un côté » (docs/compta.md §5). L'utilisateur indique un compte crédité et
 * un montant ; la contrepartie est automatiquement le compte de trésorerie.
 *
 * Écriture résultante (2 lignes, `source: 'credit'`) :
 *  - ligne 1 — `treasuryAccountId` au **débit** (la trésorerie est un compte
 *    d'actif : elle augmente → débit) ;
 *  - ligne 2 — `accountId` au **crédit** (le compte produit/actif crédité
 *    augmente → crédit).
 *
 * Délègue à `postEntry` (donc validation de l'équilibre incluse).
 * Retourne l'id de l'écriture créée.
 */
export async function postCredit(input: {
  accountId: string
  treasuryAccountId: string
  amount: number
  date: Date
  label: string
  reference?: string | null
  createdBy: string
}): Promise<string> {
  const lines: AccountingEntryLine[] = [
    { accountId: input.treasuryAccountId, debit: input.amount, credit: 0 },
    { accountId: input.accountId, debit: 0, credit: input.amount },
  ]
  return postEntry({
    date: input.date,
    label: input.label,
    reference: input.reference ?? null,
    source: 'credit',
    invoiceId: null,
    lines,
    createdBy: input.createdBy,
  })
}

/**
 * Annule une écriture par **contre-passation** (docs/compta.md §2) :
 *  - crée une nouvelle écriture dont chaque ligne inverse débit ↔ crédit de
 *    l'écriture d'origine ;
 *  - la contre-passation porte `reversalOfEntryId` = id de l'écriture
 *    d'origine, conserve la même `source`, et un `label` préfixé
 *    « Annulation — » ;
 *  - l'écriture d'origine est marquée `reversed: true`.
 *
 * Les deux opérations sont atomiques (`writeBatch`). Le solde net des deux
 * écritures est nul. Retourne l'id de la contre-passation.
 *
 * Throw si l'écriture d'origine est introuvable ou déjà contre-passée.
 */
export async function reverseEntry(
  entryId: string,
  createdBy: string,
): Promise<string> {
  const originRef = doc(db, ACCOUNTING_ENTRIES, entryId)
  // Lecture via getDocs sur la collection : on évite un getDoc isolé pour
  // rester aligné sur le pattern du module (collection-scan, volumes faibles).
  const snap = await getDocs(collection(db, ACCOUNTING_ENTRIES))
  const originSnap = snap.docs.find((d) => d.id === entryId)
  if (!originSnap) {
    throw new Error("Écriture introuvable — impossible de l'annuler.")
  }
  const origin = originSnap.data() as AccountingEntryData
  if (origin.reversed) {
    throw new Error('Cette écriture a déjà été annulée.')
  }

  // Lignes inversées : un débit devient crédit et inversement.
  const reversedLines: AccountingEntryLine[] = origin.lines.map((line) => ({
    accountId: line.accountId,
    debit: line.credit,
    credit: line.debit,
  }))
  // Garde-fou : l'inversion d'une écriture équilibrée reste équilibrée, mais
  // on revalide pour ne jamais écrire une écriture invalide dans le journal.
  validateEntryBalance(reversedLines)

  const batch = writeBatch(db)
  const reversalRef = doc(collection(db, ACCOUNTING_ENTRIES))
  batch.set(reversalRef, {
    date: origin.date,
    label: `Annulation — ${origin.label}`,
    reference: origin.reference ?? null,
    source: origin.source,
    invoiceId: origin.invoiceId ?? null,
    lines: reversedLines,
    reversed: false,
    reversalOfEntryId: entryId,
    createdBy,
    createdAt: serverTimestamp(),
  })
  batch.update(originRef, { reversed: true })
  await batch.commit()
  return reversalRef.id
}
