import { FirebaseError } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import {
  Timestamp,
  collection,
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
  Due,
  DueData,
  DuePaymentMethod,
  MemberData,
  TeamData,
} from '@club-app/shared-types'

/**
 * Repository Dues — Firestore-backed (collection `/dues/{dueId}`).
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
 *    Dues désactive les actions sur ces lignes.
 *
 * Champs dérivés portés sur `DueRow` pour le rendu DataTable (membre, équipe)
 * — ils ne vivent PAS dans le doc `/dues`. Ils sont résolus par jointures
 * one-shot sur `/members` et `/teams` (single `getDocs` par collection) pour
 * éviter le N+1.
 */

const DUES = 'dues'
const MEMBERS = 'members'
const TEAMS = 'teams'
const SEASONS = 'seasons'

// ---------------------------------------------------------------------------
// Types exposés pour la vue Dues
// ---------------------------------------------------------------------------

/**
 * Ligne enrichie pour la liste Dues.
 *
 * Étend `Due` (schéma Firestore) avec les champs dérivés nécessaires à
 * l'affichage :
 *  - `memberName` / `memberPhotoUrl` : join `/members/{memberId}`.
 *  - `teamName` : join `/teams/{teamId}`.
 *
 * Ces champs ne doivent PAS être ajoutés à `packages/shared-types/src/dues.ts`
 * tant qu'ils ne sont pas dans le schéma `docs/firebase.md`.
 */
export interface DueRow extends Due {
  memberName: string
  /** Pas de photo dans `/members` actuellement → toujours `null` (slot pour
   *  un futur champ ou un join `/users.photoURL`). */
  memberPhotoUrl: string | null
  teamName: string | null
}

// ---------------------------------------------------------------------------
// Lookups — scan `/members` et `/teams` une fois, build maps id → row.
//
// Pour `listDues` : on charge en parallèle membres + teams (single `getDocs`
// chacun) puis on enrichit chaque ligne. Évite le N+1 que donnerait un
// `getDoc(memberId)` par ligne dues.
// ---------------------------------------------------------------------------

interface MemberLite {
  name: string
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

async function buildTeamsMap(): Promise<Map<string, string>> {
  const snap = await getDocs(collection(db, TEAMS))
  const map = new Map<string, string>()
  for (const d of snap.docs) {
    const data = d.data() as Pick<TeamData, 'name'>
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
  teams: Map<string, string>,
): DueRow {
  const data = snap.data() as DueData
  const member = members.get(data.memberId)
  return {
    id: snap.id,
    ...data,
    memberName: member?.name ?? data.memberId,
    memberPhotoUrl: null,
    teamName: teams.get(data.teamId) ?? null,
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Renvoie l'id de la saison `active` (au plus une — cf. docs/main.md). `null`
 * si aucune saison active n'est provisionnée. Utilisé pour pré-sélectionner
 * le filtre saison à l'ouverture de l'écran Dues.
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
 * (`activatedAt` desc). Index Firestore présent sur
 * `(memberId, teamId, seasonId)` — la query `where memberId == id` reste
 * efficace (Firestore matche le préfixe).
 *
 * Rules `/dues` (cf. firestore.rules) :
 *   - admin / rootAdmin : lit tout.
 *   - coach : ne peut lire QUE les dues de ses teams (la rule force un check
 *     `teamId in userDoc().teamIds`). Une query non-filtrée `where memberId
 *     == ?` retournera `permission-denied` au coach.
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
export async function listMemberDues(memberId: string): Promise<Due[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, DUES),
        where('memberId', '==', memberId),
        orderBy('activatedAt', 'desc'),
      ),
    )
    return snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as DueData),
    }))
  } catch (err: unknown) {
    if (err instanceof FirebaseError && err.code === 'permission-denied') {
      return []
    }
    throw err
  }
}

/**
 * Liste les dues, optionnellement filtrées par saison (`seasonId === null`
 * = toutes saisons). Trie par `createdAt` desc côté Firestore.
 *
 * Empty Firestore → array vide, pas de throw. `permission-denied` est laissé
 * remonter vers le store (l'UI affichera un état d'erreur).
 */
export async function listDues(seasonId: string | null): Promise<DueRow[]> {
  const base = collection(db, DUES)
  const q = seasonId
    ? query(base, where('seasonId', '==', seasonId), orderBy('createdAt', 'desc'))
    : query(base, orderBy('createdAt', 'desc'))
  const snap = await getDocs(q)
  if (snap.empty) return []

  // Jointures en parallèle — un seul `getDocs` par collection.
  const [membersMap, teamsMap] = await Promise.all([
    buildMembersMap(),
    buildTeamsMap(),
  ])

  return snap.docs.map((d) => snapToRow(d, membersMap, teamsMap))
}

// ---------------------------------------------------------------------------
// Writes — admin uniquement (rules /dues admin write).
//
// `markDuePaid` : updateDoc atomique sur status + paidAt + paidAmount +
// paymentMethod + recordedBy + (optionnel) notes. La transition vers `paid`
// déclenchera côté serveur la Function `syncMemberDuesStatus` qui recompute
// `member.duesStatus` (source de vérité pour la pill membre).
//
// `cancelDue` : updateDoc sur status + notes (append reason). `cancelled`
// est terminal côté UI.
// ---------------------------------------------------------------------------

export interface MarkDuePaidPayload {
  paidAt: Date
  amount: number
  method: DuePaymentMethod
  note?: string
}

/**
 * Marque une cotisation comme payée. Pose tous les champs paid en un seul
 * `updateDoc` (atomique — Firestore garantit la cohérence). `recordedBy`
 * est résolu via `getAuth().currentUser`. Si l'utilisateur n'est pas
 * authentifié, on throw — `markDuePaid` n'a pas de sens sans uid.
 */
export async function markDuePaid(
  dueId: string,
  payload: MarkDuePaidPayload,
): Promise<void> {
  const uid = getAuth().currentUser?.uid ?? null
  if (!uid) {
    throw new Error('Utilisateur non authentifié.')
  }

  const update: UpdateData<DueData> = {
    status: 'paid',
    paidAt: Timestamp.fromDate(payload.paidAt),
    paidAmount: payload.amount,
    paymentMethod: payload.method,
    recordedBy: uid,
  }
  if (payload.note && payload.note.trim().length > 0) {
    update.notes = payload.note.trim()
  }

  await updateDoc(doc(db, DUES, dueId), update)
}

/**
 * Annule une cotisation. Pose `status: 'cancelled'` et concatène `reason`
 * dans `notes` (préserve la trace existante si présente). On lit le doc
 * pour préfixer proprement — coût marginal (1 getDoc) acceptable vu la
 * fréquence faible de cette action.
 *
 * Aucun rollback automatique : la Function `syncMemberDuesStatus` se
 * chargera de recomputer `member.duesStatus` à partir des autres dues du
 * membre (la saison n'est plus comptabilisée).
 */
export async function cancelDue(dueId: string, reason: string): Promise<void> {
  const trimmed = reason.trim()
  const ref = doc(db, DUES, dueId)
  const existing = await getDoc(ref)
  const existingNotes = existing.exists()
    ? ((existing.data() as Partial<DueData>).notes ?? null)
    : null

  const newNotes = existingNotes
    ? `${existingNotes}\n[Annulée — ${new Date().toISOString()}] ${trimmed}`
    : `[Annulée — ${new Date().toISOString()}] ${trimmed}`

  const update: UpdateData<DueData> = {
    status: 'cancelled',
    notes: newNotes,
    // Pas de `cancelledAt` au schéma (`docs/firebase.md`) — on n'ajoute pas
    // de champ non documenté. Si trace stricte requise plus tard, ajouter
    // un champ dédié dans shared-types + firebase.md + rules.
    recordedBy: getAuth().currentUser?.uid ?? null,
  }

  await updateDoc(ref, update)
}
