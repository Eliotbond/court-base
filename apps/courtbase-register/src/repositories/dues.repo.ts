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
 * (`/members/{memberId}.linkedUserId == request.auth.uid`), aux tuteurs
 * (`/members/{memberId}.guardianUserIds` contient `request.auth.uid`) ET au
 * compte ayant soumis l'inscription d'origine
 * (`resource.data.get('registeredByUid', null) == request.auth.uid`).
 *
 * Stratégie de lecture côté register — UNION de deux critères :
 *  1. `where memberId in [...]`        → couvre les cotisations dont le user
 *     est membre lié / tuteur (le binding a pris).
 *  2. `where registeredByUid == uid`   → couvre le cas où le binding membre
 *     n'a PAS pris : inscription `for: 'self'` sur un member déjà lié à un
 *     autre compte. Le submitter reste alors l'`registeredByUid` de la
 *     cotisation sans devenir `linkedUserId` (cf. `docs/firebase.md` §dues).
 * Les deux jeux de résultats sont fusionnés et dédupliqués par `doc.id` avant
 * le filtre status + tri. Aucun index composite requis : `memberId in [...]`
 * et `registeredByUid == uid` sont chacun une égalité simple (cf. CLAUDE.md
 * racine §10).
 *
 * `registeredByUid` vaut `null` pour les cotisations legacy et les joueurs
 * ajoutés hors flux d'inscription — la query `== uid` ne les remonte jamais,
 * mais le critère `memberId in [...]` les couvre.
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
// Fetch unifié (union memberId-in + registeredByUid)
// ---------------------------------------------------------------------------

/**
 * Récupère TOUS les docs `/dues` accessibles au user signed-in, sans filtre
 * status — base commune des trois fonctions de liste publiques.
 *
 * Réalise l'UNION de deux critères de lecture (cf. doc de tête de fichier) :
 *  1. `where memberId in [chunk]` — chunks de 30 (limite Firestore `in`),
 *     exécutés en parallèle. Couvre les cotisations dont le user est membre
 *     lié / tuteur.
 *  2. `where registeredByUid == uid` — une égalité simple, couvre le cas où
 *     le binding membre n'a pas pris (inscription `for: 'self'`).
 *
 * Déduplication par `doc.id` : un doc peut satisfaire les deux critères à la
 * fois (user à la fois tuteur ET auteur de l'inscription) — on ne le compte
 * qu'une fois. Aucun index composite : chaque query est une égalité simple.
 *
 * `uid` peut être vide (`''`) — dans ce cas la query `registeredByUid` est
 * omise et seul le critère `memberId in [...]` s'applique (rétro-compat / appel
 * sans contexte auth). Si `memberIds` est vide ET `uid` est vide → aucune
 * query, retour `[]` (Firestore rejette `in []`).
 */
/**
 * Wrap une query Firestore et dégrade gracieusement les `permission-denied`
 * en `[]` + log warning. Toute autre erreur est re-thrown.
 *
 * Pourquoi : Firestore peut rejeter une LIST query entière en
 * `permission-denied` quand la rule fait des `get()` dynamiques qu'il ne
 * peut pas pré-valider statiquement (ex. notre rule `/dues` qui check
 * `get(/members/{resource.data.memberId}).data.linkedUserId == auth.uid`).
 * Sans dégradation par-query, un throw sur l'une coupe tout l'écran "Mes
 * factures" en bandeau d'erreur — alors qu'une autre query aurait pu
 * couvrir l'utilisateur (chaque critère rattrape un trou de l'autre).
 *
 * Le log warning permet de garder une trace pour diagnostic sans casser
 * l'UX. Si **toutes** les queries dégradent, le store voit `[]` et affiche
 * un empty-state ("Aucune facture") — pas idéal mais préférable au bandeau
 * rouge qui suggère un problème grave.
 */
/**
 * Check robuste pour `permission-denied`. Idem `members.repo.ts` :
 * `err instanceof FirestoreError` n'est pas fiable (bundling peut casser
 * l'instanceof). Le `.code` est le contrat stable de FirebaseError.
 */
function isPermissionDenied(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'permission-denied'
  )
}

async function tryQuery(
  label: string,
  exec: () => Promise<{ docs: { id: string; data: () => unknown }[] }>,
): Promise<DueRecord[]> {
  try {
    const snap = await exec()
    return snap.docs.map(snapToDue)
  } catch (err) {
    if (isPermissionDenied(err)) {
      console.warn(
        `[dues.repo] ${label} denied by rules — degrading to []`,
        err,
      )
      return []
    }
    throw err
  }
}

async function fetchAccessibleDues(
  memberIds: string[],
  uid: string,
): Promise<DueRecord[]> {
  // Dédoublonnage + chunk de 30 (limite Firestore `in`).
  const unique = Array.from(new Set(memberIds))
  const chunks: string[][] = []
  for (let i = 0; i < unique.length; i += 30) {
    chunks.push(unique.slice(i, i + 30))
  }

  // Chaque query est dégradée individuellement en `[]` sur `permission-denied`
  // (cf. `tryQuery` ci-dessus). Les deux critères (memberId-in + registeredByUid)
  // se complètent : un succès quelconque couvre l'utilisateur. Si TOUS échouent,
  // on retourne `[]` (le store affichera l'empty-state, pas le bandeau d'erreur).
  const memberQueries = chunks.map((chunk, i) =>
    tryQuery(`memberId-in[${i}]`, () =>
      getDocs(query(collection(db, DUES), where('memberId', 'in', chunk))),
    ),
  )

  const registeredByUidPromise: Promise<DueRecord[]> = uid
    ? tryQuery('registeredByUid', () =>
        getDocs(
          query(collection(db, DUES), where('registeredByUid', '==', uid)),
        ),
      )
    : Promise.resolve([])

  if (memberQueries.length === 0 && !uid) return []

  const [memberResults, registeredByUidDues] = await Promise.all([
    Promise.all(memberQueries),
    registeredByUidPromise,
  ])

  // Déduplication par doc.id (un doc peut matcher memberId-in ET
  // registeredByUid). Une Map garantit une seule occurrence par id.
  const byId = new Map<string, DueRecord>()
  for (const dues of memberResults) {
    for (const due of dues) {
      if (!byId.has(due.id)) byId.set(due.id, due)
    }
  }
  for (const due of registeredByUidDues) {
    if (!byId.has(due.id)) byId.set(due.id, due)
  }
  return Array.from(byId.values())
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Récupère les dues actifs (`pending_grace` / `issued` / `overdue`) accessibles
 * au user signed-in.
 *
 * Lecture en UNION (cf. `fetchAccessibleDues`) : `memberId in [...]` (membre
 * lié / tuteur) ∪ `registeredByUid == uid` (auteur de l'inscription). Pattern
 * simple query + tri JS (cf. CLAUDE.md racine §10) — aucun index composite.
 *
 * Filtre status + tri en mémoire après fusion dédupliquée.
 *
 * Tri : `dueAt asc` (les plus urgents en premier), avec fallback `createdAt`
 * pour les dues encore en `pending_grace` (pas encore de `dueAt`).
 *
 * @param memberIds members où le user est membre lié / tuteur.
 * @param uid       uid du user signed-in (pour la query `registeredByUid`).
 *                  Optionnel — `''` omet la query d'union.
 */
export async function listActiveDuesForMembers(
  memberIds: string[],
  uid = '',
): Promise<DueRecord[]> {
  const all = await fetchAccessibleDues(memberIds, uid)

  const items = all.filter((due) =>
    ACTIVE_COTISATION_STATUSES.includes(due.status),
  )

  // Tri en mémoire : dueAt asc (plus urgents en premier), fallback createdAt.
  items.sort((a, b) => {
    const da = a.dueAt?.seconds ?? a.createdAt?.seconds ?? 0
    const db_ = b.dueAt?.seconds ?? b.createdAt?.seconds ?? 0
    return da - db_
  })

  return items
}

/**
 * Récupère les dues payés (`status === 'paid'`) accessibles au user signed-in.
 *
 * Même pattern que `listActiveDuesForMembers` : UNION `memberId in [...]` ∪
 * `registeredByUid == uid` via `fetchAccessibleDues`, puis filtre status +
 * tri en mémoire.
 *
 * Utilisé pour afficher l'historique de paiement sur la home register et le
 * reçu sur `PaymentInstructions.vue`. Lecture autorisée par les rules au
 * membre lié, aux tuteurs et à l'auteur de l'inscription (cf. `firestore.rules`
 * §dues).
 *
 * Tri : `paidAt desc` (le plus récent en tête), fallback `createdAt` pour les
 * lignes legacy sans `paidAt` (cas pathologique mais on dégrade au lieu de
 * crasher).
 *
 * @param memberIds members où le user est membre lié / tuteur.
 * @param uid       uid du user signed-in. Optionnel — `''` omet la query d'union.
 */
export async function listPaidDuesForMembers(
  memberIds: string[],
  uid = '',
): Promise<DueRecord[]> {
  const all = await fetchAccessibleDues(memberIds, uid)

  const items = all.filter((due) =>
    PAID_COTISATION_STATUSES.includes(due.status),
  )

  // Tri paidAt desc (paiement le plus récent en premier), fallback createdAt.
  items.sort((a, b) => {
    const da = a.paidAt?.seconds ?? a.createdAt?.seconds ?? 0
    const db_ = b.paidAt?.seconds ?? b.createdAt?.seconds ?? 0
    return db_ - da
  })

  return items
}

/**
 * Récupère les dues "soldés" (`paid | cancelled | excepted`) accessibles au
 * user signed-in — destiné au panneau "Historique" côté parent.
 *
 * Même pattern que `listPaidDuesForMembers` : UNION `memberId in [...]` ∪
 * `registeredByUid == uid` via `fetchAccessibleDues`, puis filtre statuts +
 * tri en mémoire (évite un index composite).
 *
 * Tri desc par date la plus pertinente :
 *  - `paidAt` si dispo (dues `paid`)
 *  - sinon `dueAt` (dues `cancelled` / `excepted` qui avaient une échéance)
 *  - sinon `createdAt` (fallback défensif)
 * → le plus récent en tête.
 *
 * @param memberIds members où le user est membre lié / tuteur.
 * @param uid       uid du user signed-in. Optionnel — `''` omet la query d'union.
 */
export async function listSettledDuesForMembers(
  memberIds: string[],
  uid = '',
): Promise<DueRecord[]> {
  const all = await fetchAccessibleDues(memberIds, uid)

  const items = all.filter((due) =>
    SETTLED_COTISATION_STATUSES.includes(due.status),
  )

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

/**
 * Récupère un due par son id. Retourne `null` si le doc n'existe pas ou si
 * l'accès est refusé.
 *
 * Pas de changement lié à `registeredByUid` : la lecture single-doc est
 * autorisée par les rules dès que l'une des clauses `read` §dues est
 * satisfaite — membre lié, tuteur, OU `registeredByUid == auth.uid`. La
 * nouvelle clause couvre donc déjà le compte ayant soumis l'inscription.
 */
export async function getDue(dueId: string): Promise<DueRecord | null> {
  try {
    const snap = await getDoc(doc(db, DUES, dueId))
    if (!snap.exists()) return null
    return snapToDue(snap)
  } catch (err) {
    // `permission-denied` ici signifie : ce user n'a aucun droit de lecture
    // sur ce due (ni membre lié, ni tuteur, ni auteur de l'inscription, ni
    // admin). On dégrade en `null` plutôt que de
    // propager — la vue affichera "introuvable".
    if (isPermissionDenied(err)) return null
    throw err
  }
}
