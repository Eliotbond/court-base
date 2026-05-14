import { FirebaseError } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  updateDoc,
  where,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
  type UpdateData,
} from 'firebase/firestore'
import { db } from '@/services/firebase'
import type {
  Cotisation,
  CotisationData,
  CotisationPaymentMethod,
  MemberData,
  TeamData,
} from '@club-app/shared-types'

/**
 * Repository Cotisations — Firestore-backed (collection `/dues/{cotisationId}`).
 *
 * NB sémantique : on parle de **cotisations membres** (factures annuelles)
 * côté code, mais la string Firestore reste `'dues'` (pas de migration data).
 * Le référentiel des **types de cotisation** (templates de prix) est dans
 * `cotisationTypes.repo.ts` (collection Firestore `/cotisations`).
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase
 * (cf. docs/frontend-desktop.md — architecture en couches).
 *
 * Domaine (rappel cf. docs/main.md — lifecycle cotisation) :
 *  - Création par la Function `initiateDuesOnPlayerActivation` à J0 quand un
 *    joueur est ajouté à `team.playerIds` → status `pending_grace`.
 *  - Transition `pending_grace → issued` par `issueDuesScheduled` à
 *    J+gracePeriodDays. Pose `dueAt = issuedAt + paymentDueDays`.
 *  - Transition `issued → overdue` par `markOverdueScheduled` quand `dueAt`
 *    est dépassé.
 *  - Paiement : ADMIN UNIQUEMENT côté UI (rules `/dues` admin write). Coachs
 *    n'ont jamais d'écriture directe — ils peuvent ouvrir une
 *    `/paymentExceptionRequests` que l'admin valide.
 *  - `cancelled` et `excepted` sont des états terminaux côté UI : l'écran
 *    Cotisations désactive les actions sur ces lignes.
 *
 * Champs dérivés portés sur `CotisationRow` pour le rendu DataTable (membre,
 * équipe, type de cotisation) — ils ne vivent PAS dans le doc `/dues`. Ils
 * sont résolus par jointures one-shot sur `/members`, `/teams` et
 * `/cotisations` (single `getDocs` par collection) pour éviter le N+1.
 */

const DUES = 'dues'
const MEMBERS = 'members'
const TEAMS = 'teams'
const SEASONS = 'seasons'
const COTISATION_TYPES = 'cotisations'

// ---------------------------------------------------------------------------
// Types exposés pour la vue Cotisations
// ---------------------------------------------------------------------------

/**
 * Ligne enrichie pour la liste Cotisations.
 *
 * Étend `Cotisation` (schéma Firestore) avec les champs dérivés nécessaires à
 * l'affichage :
 *  - `memberName` / `memberPhotoUrl` : join `/members/{memberId}`.
 *  - `teamName` : join `/teams/{teamId}`.
 *  - `cotisationTypeName` : join `team.cotisationId` → `/cotisations/{id}.name`
 *    (référentiel des types de cotisation).
 *
 * Ces champs ne doivent PAS être ajoutés à
 * `packages/shared-types/src/cotisation.ts` tant qu'ils ne sont pas dans le
 * schéma `docs/firebase.md`.
 */
export interface CotisationRow extends Cotisation {
  memberName: string
  /** Pas de photo dans `/members` actuellement → toujours `null` (slot pour
   *  un futur champ ou un join `/users.photoURL`). */
  memberPhotoUrl: string | null
  teamName: string | null
  /**
   * Nom du type de cotisation (référentiel `/cotisations`) résolu via
   * `team.cotisationId`. `null` si la team n'existe plus, n'a pas de
   * `cotisationId`, ou si le type référencé a été supprimé.
   */
  cotisationTypeName: string | null
}

// ---------------------------------------------------------------------------
// Lookups — scan `/members`, `/teams` et `/cotisations` une fois,
// build maps id → row.
//
// Pour `listCotisations` : on charge en parallèle membres + teams +
// types de cotisation (single `getDocs` chacun) puis on enrichit chaque
// ligne. Évite le N+1 que donnerait un `getDoc(memberId)` par ligne.
// ---------------------------------------------------------------------------

interface MemberLite {
  name: string
}

interface TeamLite {
  name: string
  /** Référence vers `/cotisations/{id}` (référentiel des types). `null` si
   *  le champ est absent ou vide côté Firestore. */
  cotisationTypeId: string | null
}

async function buildMembersMap(): Promise<Map<string, MemberLite>> {
  const snap = await getDocs(collection(db, MEMBERS))
  const map = new Map<string, MemberLite>()
  for (const d of snap.docs) {
    const data = d.data() as Pick<MemberData, 'firstName' | 'lastName'>
    map.set(d.id, {
      name: `${data.firstName ?? ''} ${data.lastName ?? ''}`.trim() || d.id,
    })
  }
  return map
}

async function buildTeamsMap(): Promise<Map<string, TeamLite>> {
  const snap = await getDocs(collection(db, TEAMS))
  const map = new Map<string, TeamLite>()
  for (const d of snap.docs) {
    const data = d.data() as Pick<TeamData, 'name' | 'cotisationId'>
    map.set(d.id, {
      name: data.name ?? d.id,
      // Le champ Firestore garde son nom `cotisationId` ; on l'expose en
      // mémoire sous `cotisationTypeId` pour clarifier qu'il pointe vers le
      // référentiel des types (et non vers une facture membre).
      cotisationTypeId: data.cotisationId ?? null,
    })
  }
  return map
}

/**
 * Charge tous les types de cotisation (référentiel `/cotisations`) en une
 * fois et retourne une map `id → name`. Lookup utilisé par `listCotisations`
 * pour résoudre `cotisationTypeName` via `team.cotisationId`.
 */
async function buildCotisationTypesMap(): Promise<Map<string, string>> {
  const snap = await getDocs(collection(db, COTISATION_TYPES))
  const map = new Map<string, string>()
  for (const d of snap.docs) {
    const data = d.data() as { name?: string }
    map.set(d.id, data.name ?? d.id)
  }
  return map
}

// ---------------------------------------------------------------------------
// Snap → row
// ---------------------------------------------------------------------------

function snapToRow(
  snap: QueryDocumentSnapshot | DocumentSnapshot,
  members: Map<string, MemberLite>,
  teams: Map<string, TeamLite>,
  cotisationTypes: Map<string, string>,
): CotisationRow {
  const data = snap.data() as CotisationData
  const member = members.get(data.memberId)
  const team = teams.get(data.teamId) ?? null
  const cotisationTypeId = team?.cotisationTypeId ?? null
  const cotisationTypeName = cotisationTypeId
    ? (cotisationTypes.get(cotisationTypeId) ?? null)
    : null
  return {
    id: snap.id,
    ...data,
    memberName: member?.name ?? data.memberId,
    memberPhotoUrl: null,
    teamName: team?.name ?? null,
    cotisationTypeName,
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Renvoie l'id de la saison `active` (au plus une — cf. docs/main.md). `null`
 * si aucune saison active n'est provisionnée. Utilisé pour pré-sélectionner
 * le filtre saison à l'ouverture de l'écran Cotisations.
 *
 * Lecture `/seasons` gated par rules (admin / coach / official lisent toutes
 * les saisons). En cas de `permission-denied`, on retourne `null` pour ne
 * pas casser l'écran.
 */
export async function fetchActiveSeasonId(): Promise<string | null> {
  try {
    const snap = await getDocs(
      query(collection(db, SEASONS), where('status', '==', 'active'), limit(1)),
    )
    if (snap.empty) return null
    return snap.docs[0]?.id ?? null
  } catch (err: unknown) {
    if (err instanceof FirebaseError && err.code === 'permission-denied') {
      return null
    }
    // Toute autre erreur (réseau, config) reste silencieuse côté repo —
    // l'écran reste utilisable sans saison pré-sélectionnée.
    return null
  }
}

/**
 * Liste toutes les cotisations d'un membre, ordre antéchronologique
 * (`activatedAt` desc). Petit volume (< ~100 docs par membre) → simple query
 * `where memberId == id` + tri JS, pas d'index composite (cf. CLAUDE.md §10).
 *
 * Rules `/dues` (cf. firestore.rules) :
 *   - admin / rootAdmin : lit tout.
 *   - coach : ne peut lire QUE les cotisations de ses teams (la rule force un
 *     check `teamId in userDoc().teamIds`). Une query non-filtrée
 *     `where memberId == ?` retournera `permission-denied` au coach.
 *
 * Cette fonction est conçue pour la page Member detail qui n'est ouverte
 * qu'à admin/coach. Pour l'admin → renvoie tout. Pour le coach → la query
 * non-filtrée est refusée, on dégrade en `[]` (de toute façon le tab
 * "Cotisations" n'a pas de sens pour un coach hors de ses teams).
 *
 * TODO(coach-scope) : pour exposer la section au coach scoped à ses teams,
 * passer `coachTeamIds: string[]` en paramètre et splitter en queries `in`
 * (limite Firestore : 10 valeurs par chunk).
 *
 * Dégradation : `permission-denied` (FirebaseError) → `[]`. Toute autre
 * erreur Firebase remonte.
 */
export async function listMemberCotisations(
  memberId: string,
): Promise<Cotisation[]> {
  try {
    const snap = await getDocs(
      query(collection(db, DUES), where('memberId', '==', memberId)),
    )
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as CotisationData) }))
      .sort((a, b) => b.activatedAt.seconds - a.activatedAt.seconds)
  } catch (err: unknown) {
    if (err instanceof FirebaseError && err.code === 'permission-denied') {
      return []
    }
    throw err
  }
}

/**
 * Liste les cotisations, optionnellement filtrées par saison
 * (`seasonId === null` = toutes saisons). Trie par `createdAt` desc côté
 * Firestore. Enrichit chaque ligne avec memberName, teamName et
 * cotisationTypeName (via joins en parallèle).
 *
 * Empty Firestore → array vide, pas de throw. `permission-denied` est laissé
 * remonter vers le store (l'UI affichera un état d'erreur).
 */
export async function listCotisations(
  seasonId: string | null,
): Promise<CotisationRow[]> {
  const base = collection(db, DUES)
  const q = seasonId
    ? query(base, where('seasonId', '==', seasonId), orderBy('createdAt', 'desc'))
    : query(base, orderBy('createdAt', 'desc'))
  const snap = await getDocs(q)
  if (snap.empty) return []

  // Jointures en parallèle — un seul `getDocs` par collection.
  const [membersMap, teamsMap, cotisationTypesMap] = await Promise.all([
    buildMembersMap(),
    buildTeamsMap(),
    buildCotisationTypesMap(),
  ])

  return snap.docs.map((d) => snapToRow(d, membersMap, teamsMap, cotisationTypesMap))
}

// ---------------------------------------------------------------------------
// Writes — admin uniquement (rules /dues admin write).
//
// `markCotisationPaid` : updateDoc atomique sur status + paidAt + paidAmount +
// paymentMethod + recordedBy + (optionnel) notes. La transition vers `paid`
// déclenchera côté serveur la Function `syncMemberDuesStatus` qui recompute
// `member.duesStatus` (source de vérité pour la pill membre).
//
// `cancelCotisation` : updateDoc sur status + notes (append reason).
// `cancelled` est terminal côté UI.
// ---------------------------------------------------------------------------

export interface MarkCotisationPaidPayload {
  paidAt: Date
  amount: number
  /**
   * Méthode de paiement. Côté schéma Firestore `CotisationPaymentMethod`
   * reste `'cash' | 'transfer' | 'other'`, mais le callable serveur
   * `markDuePaid` accepte aussi `'card'`. On accepte donc un superset
   * (`string`) côté UI et on délègue la validation finale au callable.
   */
  method: CotisationPaymentMethod | 'card'
  note?: string
}

/**
 * @deprecated Le paiement passe désormais par la Cloud Function callable
 * `markDuePaid` (côté serveur, cf. `services/cloudFunctions.ts`
 * → `markCotisationPaid` wrapper TS). Ce write client direct est conservé
 * temporairement pour fallback / outils internes mais n'est plus câblé par
 * le store (`useCotisationsStore.markPaid` appelle le callable).
 *
 * Raison du switch : le callable valide rôles (admin / treasurer), pose
 * `recordedBy` côté serveur (anti-spoof), et recompute `member.duesStatus`
 * dans une seule transaction.
 *
 * À supprimer dès que le callable est confirmé en production.
 */
export async function markCotisationPaid(
  cotisationId: string,
  payload: MarkCotisationPaidPayload,
): Promise<void> {
  const uid = getAuth().currentUser?.uid ?? null
  if (!uid) {
    throw new Error('Utilisateur non authentifié.')
  }

  // Le schéma Firestore (`CotisationPaymentMethod`) ne connaît pas encore
  // `'card'` — on retombe sur `'other'` ici pour ne pas écrire une valeur
  // hors schéma. Le chemin canonique pour `card` est désormais le callable
  // serveur.
  const persistedMethod = payload.method === 'card' ? 'other' : payload.method

  const update: UpdateData<CotisationData> = {
    status: 'paid',
    paidAt: Timestamp.fromDate(payload.paidAt),
    paidAmount: payload.amount,
    paymentMethod: persistedMethod,
    recordedBy: uid,
  }
  if (payload.note && payload.note.trim().length > 0) {
    update.notes = payload.note.trim()
  }

  await updateDoc(doc(db, DUES, cotisationId), update)
}

/**
 * Annule une cotisation. Pose `status: 'cancelled'` et concatène `reason`
 * dans `notes` (préserve la trace existante si présente). On lit le doc
 * pour préfixer proprement — coût marginal (1 getDoc) acceptable vu la
 * fréquence faible de cette action.
 *
 * Aucun rollback automatique : la Function `syncMemberDuesStatus` se
 * chargera de recomputer `member.duesStatus` à partir des autres cotisations
 * du membre (la saison n'est plus comptabilisée).
 */
export async function cancelCotisation(
  cotisationId: string,
  reason: string,
): Promise<void> {
  const trimmed = reason.trim()
  const ref = doc(db, DUES, cotisationId)
  const existing = await getDoc(ref)
  const existingNotes = existing.exists()
    ? ((existing.data() as Partial<CotisationData>).notes ?? null)
    : null

  const newNotes = existingNotes
    ? `${existingNotes}\n[Annulée — ${new Date().toISOString()}] ${trimmed}`
    : `[Annulée — ${new Date().toISOString()}] ${trimmed}`

  const update: UpdateData<CotisationData> = {
    status: 'cancelled',
    notes: newNotes,
    // Pas de `cancelledAt` au schéma (`docs/firebase.md`) — on n'ajoute pas
    // de champ non documenté. Si trace stricte requise plus tard, ajouter
    // un champ dédié dans shared-types + firebase.md + rules.
    recordedBy: getAuth().currentUser?.uid ?? null,
  }

  try {
    await updateDoc(ref, update)
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`cancelCotisation failed [${code}]`, err)
    throw err
  }
}

/**
 * Suppression définitive d'une cotisation (`deleteDoc /dues/{id}`). Admin
 * uniquement côté rules. Destinée à la correction d'erreur de création — la
 * voie normale d'extinction est `cancelCotisation` (préserve la trace).
 *
 * Garde-fou métier : refuse la suppression si la cotisation est `paid` —
 * supprimer une cotisation payée fait perdre la trace comptable. L'admin doit
 * d'abord `cancelCotisation` (lequel garde la trace dans notes) si vraiment
 * nécessaire ; ou utiliser le flow `deleteMember` (callable serveur) qui
 * applique cette même règle au niveau du membre entier.
 *
 * Side-effect serveur : `syncMemberDuesStatus` est un trigger
 * `onDocumentWritten` → la suppression déclenche le recompute de
 * `member.duesStatus`. Aucun nettoyage manuel requis côté client.
 */
export async function deleteCotisation(cotisationId: string): Promise<void> {
  const ref = doc(db, DUES, cotisationId)
  let snap: DocumentSnapshot
  try {
    snap = await getDoc(ref)
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`deleteCotisation getDoc failed [${code}]`, err)
    throw err
  }
  if (!snap.exists()) {
    throw new Error('Cette cotisation n\'existe plus.')
  }
  const data = snap.data() as Partial<CotisationData>
  if (data.status === 'paid') {
    throw new Error(
      'Impossible de supprimer une cotisation payée — annulez-la d\'abord (la trace est préservée dans les notes).',
    )
  }
  try {
    await deleteDoc(ref)
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`deleteCotisation failed [${code}]`, err)
    throw err
  }
}
