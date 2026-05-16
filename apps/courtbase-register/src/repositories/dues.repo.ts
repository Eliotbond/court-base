import {
  FirestoreError,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore'
import type { Cotisation, CotisationData, CotisationStatus } from '@club-app/shared-types'
import { db } from '@/services/firebase'

/**
 * Repository Cotisations — Firestore-backed (côté app courtbase-register).
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase
 * (cf. `apps/courtbase-register/CLAUDE.md` — architecture en couches).
 *
 * NB. La collection Firestore garde le nom **legacy** `dues` (pas de migration
 * data prévue). Seul le namespace TypeScript bascule en `Cotisation*` pour
 * refléter la terminologie métier FR.
 *
 * Lecture only — les écritures sur `/dues` sont admin-only (rules + callables
 * `markDuePaid` / `cancelDue`). L'app register n'a besoin que de :
 *  - lister les cotisations actives (non-payées, non-cancelled) liées aux
 *    membres du user signed-in (les memberIds proviennent de ses registrations),
 *  - lire une cotisation par id pour afficher l'écran d'instructions de
 *    paiement.
 *
 * Permissions (cf. `firestore.rules` §dues) : `read` autorisé au membre lié
 * (`/members/{memberId}.linkedUserId == request.auth.uid`) et aux tuteurs
 * (`/members/{memberId}.guardianUserIds` contient `request.auth.uid`). La
 * query client filtre `where memberId in [...]` — Firestore vérifie la rule
 * par doc retourné.
 */

const DUES = 'dues'

/**
 * Statuts considérés comme "actifs" — i.e. cotisations qui appellent une
 * action de paiement. Exclut `paid`, `cancelled`, `excepted`.
 */
const ACTIVE_COTISATION_STATUSES: CotisationStatus[] = [
  'pending_grace',
  'issued',
  'overdue',
]

/**
 * Statuts considérés comme "réglés / historique payant" — affichés côté
 * register comme reçu ou badge sur la registration. Exclut `cancelled` et
 * `excepted` (pas de paiement effectif). Pour l'instant un seul statut, mais
 * la liste est gardée pour symétrie avec `ACTIVE_COTISATION_STATUSES` et
 * extension future éventuelle.
 */
const PAID_COTISATION_STATUSES: CotisationStatus[] = ['paid']

/**
 * Statuts considérés comme "soldés / clôturés" — toutes les cotisations dont
 * le cycle de paiement est terminé, qu'elles aient été réglées, annulées ou
 * dispensées. Regroupe :
 *  - `paid`     : paiement effectif reçu
 *  - `cancelled`: cotisation annulée (ex. départ joueur)
 *  - `excepted` : dispense accordée par le comité
 *
 * Utilisé par `listSettledDuesForMembers` pour alimenter le panneau
 * "Historique" côté parent dans `apps/courtbase-register`.
 */
const SETTLED_COTISATION_STATUSES: CotisationStatus[] = [
  'paid',
  'cancelled',
  'excepted',
]

/**
 * Alias historique conservé pour ne pas casser les consumers du store
 * (`PaymentInstructions.vue`, `Home.vue`). Pointe vers `Cotisation` de
 * `@club-app/shared-types`.
 */
export type DueRecord = Cotisation

// ---------------------------------------------------------------------------
// Snap → DueRecord
// ---------------------------------------------------------------------------

function snapToDue(snap: { id: string; data: () => unknown }): DueRecord {
  const data = snap.data() as CotisationData
  return { id: snap.id, ...data }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Récupère les dues actifs (`pending_grace` / `issued` / `overdue`) liés à
 * une liste de memberIds.
 *
 * Pattern simple query + tri JS (cf. CLAUDE.md racine point 10) : on évite un
 * index composite `(memberId IN, status IN, dueAt DESC)` au profit d'un filtre
 * côté serveur sur `memberId in [...]` puis d'un filtre status + tri en mémoire.
 *
 * Limites Firestore :
 *  - `where in [...]` : max 30 valeurs. Si `memberIds.length > 30`, on
 *    chunke en plusieurs queries parallèles.
 *  - Tableau vide → on shortcut sans query (Firestore rejette `in []`).
 *
 * Tri : `dueAt asc` (les plus urgents en premier), avec fallback `createdAt`
 * pour les dues encore en `pending_grace` (pas encore de `dueAt`).
 */
export async function listActiveDuesForMembers(
  memberIds: string[],
): Promise<DueRecord[]> {
  if (memberIds.length === 0) return []

  // Dédoublonnage + chunk de 30 (limite Firestore `in`).
  const unique = Array.from(new Set(memberIds))
  const chunks: string[][] = []
  for (let i = 0; i < unique.length; i += 30) {
    chunks.push(unique.slice(i, i + 30))
  }

  const snaps = await Promise.all(
    chunks.map((chunk) =>
      getDocs(query(collection(db, DUES), where('memberId', 'in', chunk))),
    ),
  )

  const items: DueRecord[] = []
  for (const snap of snaps) {
    for (const d of snap.docs) {
      const due = snapToDue(d)
      if (ACTIVE_COTISATION_STATUSES.includes(due.status)) {
        items.push(due)
      }
    }
  }

  // Tri en mémoire : dueAt asc (plus urgents en premier), fallback createdAt.
  items.sort((a, b) => {
    const da = a.dueAt?.seconds ?? a.createdAt?.seconds ?? 0
    const db_ = b.dueAt?.seconds ?? b.createdAt?.seconds ?? 0
    return da - db_
  })

  return items
}

/**
 * Récupère les dues payés (`status === 'paid'`) liés à une liste de memberIds.
 *
 * Même pattern que `listActiveDuesForMembers` :
 *  - Chunk de 30 sur `memberId in [...]` (limite Firestore).
 *  - Filtre status côté client.
 *  - Tri en mémoire : `paidAt desc` (le plus récent en tête), fallback
 *    `createdAt` pour les lignes legacy sans `paidAt` (cas pathologique mais
 *    on dégrade au lieu de crasher).
 *
 * Utilisé pour afficher l'historique de paiement sur la home register et le
 * reçu sur `PaymentInstructions.vue`. Lecture autorisée par les rules au
 * membre lié + tuteurs (cf. `firestore.rules` §dues).
 */
export async function listPaidDuesForMembers(
  memberIds: string[],
): Promise<DueRecord[]> {
  if (memberIds.length === 0) return []

  const unique = Array.from(new Set(memberIds))
  const chunks: string[][] = []
  for (let i = 0; i < unique.length; i += 30) {
    chunks.push(unique.slice(i, i + 30))
  }

  const snaps = await Promise.all(
    chunks.map((chunk) =>
      getDocs(query(collection(db, DUES), where('memberId', 'in', chunk))),
    ),
  )

  const items: DueRecord[] = []
  for (const snap of snaps) {
    for (const d of snap.docs) {
      const due = snapToDue(d)
      if (PAID_COTISATION_STATUSES.includes(due.status)) {
        items.push(due)
      }
    }
  }

  // Tri paidAt desc (paiement le plus récent en premier), fallback createdAt.
  items.sort((a, b) => {
    const da = a.paidAt?.seconds ?? a.createdAt?.seconds ?? 0
    const db_ = b.paidAt?.seconds ?? b.createdAt?.seconds ?? 0
    return db_ - da
  })

  return items
}

/**
 * Récupère les dues "soldés" (`paid | cancelled | excepted`) liés à une liste
 * de memberIds — destiné au panneau "Historique" côté parent.
 *
 * Même pattern que `listPaidDuesForMembers` :
 *  - Chunk de 30 sur `memberId in [...]` (limite Firestore `in`).
 *  - Filtre statuts côté client (évite un index composite).
 *  - Catch défensif `FirestoreError` rethrown pour les cas non-`permission-denied`
 *    (index manquant, réseau) — le store loggue le code d'erreur.
 *
 * Tri desc par date la plus pertinente :
 *  - `paidAt` si dispo (dues `paid`)
 *  - sinon `dueAt` (dues `cancelled` / `excepted` qui avaient une échéance)
 *  - sinon `createdAt` (fallback défensif)
 * → le plus récent en tête.
 */
export async function listSettledDuesForMembers(
  memberIds: string[],
): Promise<DueRecord[]> {
  if (memberIds.length === 0) return []

  const unique = Array.from(new Set(memberIds))
  const chunks: string[][] = []
  for (let i = 0; i < unique.length; i += 30) {
    chunks.push(unique.slice(i, i + 30))
  }

  const snaps = await Promise.all(
    chunks.map((chunk) =>
      getDocs(query(collection(db, DUES), where('memberId', 'in', chunk))),
    ),
  )

  const items: DueRecord[] = []
  for (const snap of snaps) {
    for (const d of snap.docs) {
      const due = snapToDue(d)
      if (SETTLED_COTISATION_STATUSES.includes(due.status)) {
        items.push(due)
      }
    }
  }

  // Tri desc : paidAt > dueAt > createdAt (plus récent en tête).
  items.sort((a, b) => {
    const da = a.paidAt?.seconds ?? a.dueAt?.seconds ?? a.createdAt?.seconds ?? 0
    const db_ = b.paidAt?.seconds ?? b.dueAt?.seconds ?? b.createdAt?.seconds ?? 0
    return db_ - da
  })

  return items
}

/**
 * Tri "date de la cotisation" décroissant (plus récente en tête).
 *
 * « Date de la cotisation » = `createdAt` (toujours présent sur les docs
 * créés par `initiateDuesOnPlayerActivation`), avec fallback défensif
 * `dueAt` puis `paidAt` pour les éventuelles lignes legacy / corrompues.
 *
 * Exporté pour être réutilisé par le store (`allMyDuesSorted`) qui fusionne
 * les listes actives + soldées en une seule liste unifiée — la couche store
 * ne réimplémente pas la logique de tri.
 */
export function sortDuesByCotisationDateDesc(items: DueRecord[]): DueRecord[] {
  const cotisationSeconds = (d: DueRecord): number =>
    d.createdAt?.seconds ?? d.dueAt?.seconds ?? d.paidAt?.seconds ?? 0
  return [...items].sort((a, b) => cotisationSeconds(b) - cotisationSeconds(a))
}

/** Récupère un due par son id. Retourne `null` si le doc n'existe pas ou si l'accès est refusé (le user n'est pas tuteur du member concerné). */
export async function getDue(dueId: string): Promise<DueRecord | null> {
  try {
    const snap = await getDoc(doc(db, DUES, dueId))
    if (!snap.exists()) return null
    return snapToDue(snap)
  } catch (err) {
    // `permission-denied` ici signifie : ce user n'a pas accès à ce due (pas
    // tuteur du member, pas admin). On dégrade en `null` plutôt que de
    // propager — la vue affichera "introuvable".
    if (err instanceof FirestoreError && err.code === 'permission-denied') {
      return null
    }
    throw err
  }
}
