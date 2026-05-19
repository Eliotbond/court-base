import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
  type DocumentData,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
  type UpdateData,
} from 'firebase/firestore'
import { db } from '@/services/firebase'
import type { Account, AccountData } from '@club-app/shared-types'

/**
 * Repository Comptabilité — collection `/accounts` (plan comptable).
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase
 * (cf. docs/frontend-desktop.md — architecture en couches). Les writes
 * passent par `/accounts/{accountId}` (rules : isRootAdmin || isTreasurer —
 * cf. docs/compta.md §7).
 *
 * Volumes faibles attendus (un plan comptable = quelques dizaines de comptes)
 * → lecture par query simple + tri JS, pas d'index composite (cf. règle 10 du
 * `CLAUDE.md` racine + docs/compta.md §4).
 */

const ACCOUNTS = 'accounts'
const ACCOUNTING_ENTRIES = 'accountingEntries'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convertit un snapshot Firestore en `Account` typé. */
export function snapToAccount(
  snap: QueryDocumentSnapshot | DocumentSnapshot,
): Account {
  const data = snap.data() as AccountData
  return { id: snap.id, ...data }
}

/**
 * Comparator stable pour l'affichage : `displayOrder asc`, puis `number asc`.
 * Appliqué côté client — la collection reste petite (plan comptable).
 */
export function compareAccounts(a: Account, b: Account): number {
  if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder
  return a.number.localeCompare(b.number)
}

// ---------------------------------------------------------------------------
// Comptes par défaut — cf. docs/compta.md §3
// ---------------------------------------------------------------------------

/** Définition d'un compte par défaut (hors champs dérivés / timestamp). */
interface DefaultAccountSeed {
  number: string
  name: string
  nature: AccountData['nature']
  isTreasury: boolean
}

/**
 * Les comptes par défaut du plan comptable (docs/compta.md §3). L'ordre du
 * tableau dicte le `displayOrder` (index × 10).
 *
 * Le compte « Licences fédérales » est résolu **par son nom** côté callable
 * serveur `confirmLicense` (qui y poste la charge à la confirmation d'une
 * licence) — le libellé exact doit être préservé.
 */
const DEFAULT_ACCOUNTS: readonly DefaultAccountSeed[] = [
  { number: '1000', name: 'Caisse', nature: 'actif', isTreasury: true },
  { number: '1020', name: 'Banque', nature: 'actif', isTreasury: true },
  { number: '1100', name: 'Débiteurs cotisations', nature: 'actif', isTreasury: false },
  { number: '2000', name: 'Créditeurs (fournisseurs)', nature: 'passif', isTreasury: false },
  { number: '3000', name: 'Cotisations des membres', nature: 'produit', isTreasury: false },
  { number: '3200', name: 'Sponsoring', nature: 'produit', isTreasury: false },
  { number: '3400', name: 'Subventions J+S', nature: 'produit', isTreasury: false },
  { number: '4000', name: 'Frais de matériel', nature: 'charge', isTreasury: false },
  { number: '4200', name: "Frais d'arbitrage", nature: 'charge', isTreasury: false },
  { number: '4300', name: 'Licences fédérales', nature: 'charge', isTreasury: false },
  { number: '6500', name: 'Frais administratifs', nature: 'charge', isTreasury: false },
]

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Liste tous les comptes du plan comptable. Tri JS par `displayOrder` puis
 * `number` (pas d'index composite).
 */
export async function listAccounts(): Promise<Account[]> {
  const snap = await getDocs(collection(db, ACCOUNTS))
  if (snap.empty) return []
  return snap.docs.map(snapToAccount).sort(compareAccounts)
}

/**
 * Indique si un compte est référencé par au moins une ligne d'écriture du
 * journal (`/accountingEntries`). Lecture complète + test JS — volume faible,
 * pas d'index. Exposé séparément pour permettre au store / à l'UI de décider
 * (griser le bouton "Supprimer").
 */
export async function isAccountUsed(id: string): Promise<boolean> {
  const snap = await getDocs(collection(db, ACCOUNTING_ENTRIES))
  return snap.docs.some((d) => {
    const data = d.data() as { lines?: { accountId: string }[] }
    return (data.lines ?? []).some((l) => l.accountId === id)
  })
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Crée un compte. `createdAt` est posé en `serverTimestamp()`. Retourne l'id
 * du document créé.
 */
export async function createAccount(
  data: Omit<AccountData, 'createdAt'>,
): Promise<string> {
  const ref = await addDoc(collection(db, ACCOUNTS), {
    ...data,
    createdAt: serverTimestamp(),
  })
  return ref.id
}

/** Patch partiel sur `/accounts/{id}`. */
export async function updateAccount(
  id: string,
  patch: Partial<AccountData>,
): Promise<void> {
  await updateDoc(doc(db, ACCOUNTS, id), patch as UpdateData<DocumentData>)
}

/**
 * Supprime un compte. Garde-fou (cf. docs/compta.md §3) :
 *  - refuse si le compte est `isDefault` (les comptes seedés sont protégés —
 *    on les désactive via `active: false`, on ne les supprime pas) ;
 *  - refuse si le compte est référencé par au moins une écriture du journal.
 */
export async function deleteAccount(id: string): Promise<void> {
  const snap = await getDocs(collection(db, ACCOUNTS))
  const target = snap.docs.find((d) => d.id === id)
  if (target && (target.data() as AccountData).isDefault) {
    throw new Error(
      'Compte par défaut — désactivez-le plutôt que de le supprimer.',
    )
  }
  if (await isAccountUsed(id)) {
    throw new Error(
      'Compte référencé par une écriture comptable — il ne peut pas être supprimé.',
    )
  }
  await deleteDoc(doc(db, ACCOUNTS, id))
}

/**
 * Crée les comptes par défaut du plan comptable (docs/compta.md §3).
 * Idempotent : ne fait rien si la collection contient déjà des comptes.
 */
export async function seedDefaultAccounts(): Promise<void> {
  const existing = await getDocs(collection(db, ACCOUNTS))
  if (!existing.empty) return
  await Promise.all(
    DEFAULT_ACCOUNTS.map((seed, index) =>
      addDoc(collection(db, ACCOUNTS), {
        number: seed.number,
        name: seed.name,
        nature: seed.nature,
        isTreasury: seed.isTreasury,
        description: null,
        isDefault: true,
        active: true,
        displayOrder: index * 10,
        createdAt: serverTimestamp(),
      }),
    ),
  )
}
