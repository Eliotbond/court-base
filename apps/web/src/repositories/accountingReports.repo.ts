import {
  collection,
  getDocs,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '@/services/firebase'
import type {
  Account,
  AccountData,
  AccountingEntry,
  AccountingEntryData,
} from '@club-app/shared-types'

/**
 * Repository Comptabilité — RAPPORTS (Journal, Bilan, Compte de résultat).
 *
 * Couche autonome en lecture : ce repo lit directement les collections
 * `/accounts` et `/accountingEntries` plutôt que de réutiliser
 * `accounts.repo` — on évite ainsi tout couplage avec les autres modules de
 * la comptabilité (plan comptable, saisie, factures).
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase
 * (cf. docs/frontend-desktop.md — architecture en couches). Lecture seule :
 * les rapports n'écrivent jamais. Rules : `isRootAdmin() || isTreasurer()`
 * (cf. docs/compta.md §7).
 *
 * Volumes faibles attendus (un plan comptable = quelques dizaines de comptes ;
 * le journal reste petit, cf. docs/compta.md §4) → lecture par query simple +
 * tri JS, pas d'index composite (cf. règle 10 du `CLAUDE.md` racine).
 */

const ACCOUNTS = 'accounts'
const ACCOUNTING_ENTRIES = 'accountingEntries'

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/** Convertit un snapshot Firestore en `Account` typé. */
function snapToAccount(
  snap: QueryDocumentSnapshot | DocumentSnapshot,
): Account {
  const data = snap.data() as AccountData
  return { id: snap.id, ...data }
}

/** Convertit un snapshot Firestore en `AccountingEntry` typé. */
function snapToEntry(
  snap: QueryDocumentSnapshot | DocumentSnapshot,
): AccountingEntry {
  const data = snap.data() as AccountingEntryData
  return { id: snap.id, ...data }
}

/** Secondes d'un Timestamp (shape neutre `{ seconds, nanoseconds }`). */
function entrySeconds(entry: AccountingEntry): number {
  return entry.date?.seconds ?? 0
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Liste tous les comptes du plan comptable. Tri JS par `displayOrder` puis
 * `number` (pas d'index composite).
 */
export async function loadAccounts(): Promise<Account[]> {
  const snap = await getDocs(collection(db, ACCOUNTS))
  if (snap.empty) return []
  return snap.docs.map(snapToAccount).sort((a, b) => {
    if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder
    return a.number.localeCompare(b.number)
  })
}

/**
 * Liste toutes les écritures du journal `/accountingEntries`. Tri JS par
 * `date` ascendant (pas d'index composite — volume faible, cf. docs/compta.md
 * §4). Le tri d'affichage final (desc) est appliqué côté store.
 */
export async function loadEntries(): Promise<AccountingEntry[]> {
  const snap = await getDocs(collection(db, ACCOUNTING_ENTRIES))
  if (snap.empty) return []
  return snap.docs
    .map(snapToEntry)
    .sort((a, b) => entrySeconds(a) - entrySeconds(b))
}
