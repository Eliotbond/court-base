import { FirebaseError } from 'firebase/app'
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  Timestamp as FirestoreTimestamp,
  updateDoc,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
  type UpdateData,
} from 'firebase/firestore'
import { db } from '@/services/firebase'
import type {
  Member,
  MemberContactData,
  MemberData,
  User,
} from '@club-app/shared-types'

/**
 * Repository Members — Firestore-backed.
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase
 * (cf. docs/frontend-desktop.md — architecture en couches). Lecture du doc
 * parent `/members/{memberId}` : admin / coach / official / self. Écriture :
 * admin uniquement (pas de writes côté client pour l'instant — pas de
 * `createMember` / `updateMember` exposé tant que la vue ne le demande pas).
 *
 * Champs dérivés portés sur `MemberRow` mais qui ne vivent PAS dans le doc :
 *  - `email` / `phone` : lus depuis `/members/{id}/private/contact`. Le scope
 *    de lecture est plus restrictif (admin / coach / self — official-only
 *    n'a PAS accès). Si la rule renvoie `permission-denied`, on dégrade
 *    proprement à `null` sans casser la liste.
 *  - `teamLabels` : join sur `/teams` (un seul `getDocs` pour bâtir une map
 *    `memberId → team names`). Pas de N+1.
 *  - `lastLoginAt` : pas joinable côté client (Firebase Auth, pas Firestore).
 *    Toujours `null` ici — nécessitera une callable Admin SDK pour exposer
 *    `lastSignInTime`.
 */

const MEMBERS = 'members'
const TEAMS = 'teams'
const USERS = 'users'
const CONTACT_DOC = 'contact'
const PRIVATE_SUBCOLL = 'private'

// ---------------------------------------------------------------------------
// Types exposés pour la vue Members
// ---------------------------------------------------------------------------

/**
 * Ligne enrichie pour la liste Members.
 *
 * Étend `Member` (schéma Firestore) avec quelques champs dérivés nécessaires
 * à l'affichage que le doc parent ne porte pas. Ces champs ne doivent PAS
 * être ajoutés à `packages/shared-types/src/member.ts` tant qu'ils ne sont
 * pas dans le schéma `docs/firebase.md`.
 */
export interface MemberRow extends Member {
  /** Lu depuis `/members/{id}/private/contact.email` ; `null` si inaccessible. */
  email: string | null
  /** Lu depuis `/members/{id}/private/contact.phone` ; `null` si inaccessible. */
  phone: string | null
  /** Dérivé : noms des équipes où le membre est coach ou joueur. */
  teamLabels: string[]
  // TODO(server): lit via Admin SDK lastSignInTime.
  lastLoginAt: Date | null
}

/**
 * Référence à une équipe avec rôle joué dans cette équipe (coach / player).
 * Utilisé par la page Member detail pour afficher les liens cliquables.
 */
export interface MemberTeamRef {
  id: string
  name: string
  role: 'coach' | 'player'
}

/**
 * Ligne enrichie pour la page Member detail. Étend `MemberRow` avec un
 * sur-ensemble de jointures résolues côté repo :
 *  - `teams` : équipes où le membre est coach ou joueur, avec rôle.
 *  - `linkedUser` : `/users/{linkedUserId}` (rôles auth, teamIds, photoURL).
 *    `null` si pas de compte lié OU si la lecture est refusée (rules).
 */
export interface MemberDetailRow extends MemberRow {
  teams: MemberTeamRef[]
  linkedUser: User | null
}

// ---------------------------------------------------------------------------
// Contact resolution — sub-doc /members/{id}/private/contact
//
// Lecture gated par rules (admin / coach / self). Si l'utilisateur courant
// n'a pas accès (typiquement official-only sur un autre membre), on attrape
// l'erreur `permission-denied` et on retourne `null` — le reste de la ligne
// reste affichable. Toute autre erreur Firebase est relancée.
// ---------------------------------------------------------------------------

interface ContactPair {
  email: string | null
  phone: string | null
}

const EMPTY_CONTACT: ContactPair = { email: null, phone: null }

async function readContact(memberId: string): Promise<ContactPair> {
  try {
    const snap = await getDoc(
      doc(db, MEMBERS, memberId, PRIVATE_SUBCOLL, CONTACT_DOC),
    )
    if (!snap.exists()) return EMPTY_CONTACT
    const data = snap.data() as Partial<MemberContactData>
    return {
      email: data.email ?? null,
      phone: data.phone ?? null,
    }
  } catch (err: unknown) {
    // Dégradation silencieuse uniquement sur permission-denied (rule rejette
    // le rôle courant, typiquement official-only). Toute autre erreur SDK
    // remonte — on ne veut pas masquer un bug réseau / config.
    if (err instanceof FirebaseError && err.code === 'permission-denied') {
      return EMPTY_CONTACT
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// Team labels — scan `/teams` une fois, build map memberId → team names.
//
// Pour `listMembers` : on charge `/teams` en un seul `getDocs`, puis on
// itère pour ranger chaque coach / joueur dans la map. Évite le N+1 que
// donnerait une query `where coachIds array-contains` par membre.
//
// Pour `getMemberById` : même scan (cas isolé, OK en attendant une query
// indexée). Si la liste de teams grossit fortement, on basculera sur deux
// queries `array-contains` ciblées.
// ---------------------------------------------------------------------------

async function buildTeamLabelsMap(): Promise<Map<string, string[]>> {
  const snap = await getDocs(collection(db, TEAMS))
  const map = new Map<string, string[]>()
  for (const d of snap.docs) {
    const data = d.data() as {
      name?: string
      coachIds?: string[]
      playerIds?: string[]
    }
    const name = data.name ?? d.id
    const memberIds = new Set<string>([
      ...(data.coachIds ?? []),
      ...(data.playerIds ?? []),
    ])
    for (const memberId of memberIds) {
      const existing = map.get(memberId)
      if (existing) existing.push(name)
      else map.set(memberId, [name])
    }
  }
  return map
}

// ---------------------------------------------------------------------------
// Snap → row
// ---------------------------------------------------------------------------

function snapToRow(
  snap: QueryDocumentSnapshot | DocumentSnapshot,
  contact: ContactPair,
  teamLabels: string[],
): MemberRow {
  const data = snap.data() as MemberData
  return {
    id: snap.id,
    ...data,
    email: contact.email,
    phone: contact.phone,
    teamLabels,
    // TODO(server): lit via Admin SDK lastSignInTime.
    lastLoginAt: null,
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Liste tous les membres du club triés par nom de famille. */
export async function listMembers(): Promise<MemberRow[]> {
  const snap = await getDocs(query(collection(db, MEMBERS), orderBy('lastName')))
  if (snap.empty) return []

  // Build la map team-labels en parallèle avec la lecture des contacts.
  const teamLabelsPromise = buildTeamLabelsMap()
  const contactsPromise = Promise.all(
    snap.docs.map((d) => readContact(d.id)),
  )

  const [teamLabelsMap, contacts] = await Promise.all([
    teamLabelsPromise,
    contactsPromise,
  ])

  return snap.docs.map((d, i) =>
    snapToRow(
      d,
      contacts[i] ?? EMPTY_CONTACT,
      teamLabelsMap.get(d.id) ?? [],
    ),
  )
}

/** Récupère un membre par son id (vue Members — sans linkedUser ni rôles team). */
export async function getMemberById(id: string): Promise<MemberRow | null> {
  const snap = await getDoc(doc(db, MEMBERS, id))
  if (!snap.exists()) return null
  const [contact, teamLabelsMap] = await Promise.all([
    readContact(id),
    buildTeamLabelsMap(),
  ])
  return snapToRow(snap, contact, teamLabelsMap.get(id) ?? [])
}

// ---------------------------------------------------------------------------
// Member detail — getMemberDetail (page /members/:id)
//
// Charge en parallèle :
//   - le doc parent /members/{id}
//   - le contact privé /members/{id}/private/contact (dégradation gracieuse)
//   - l'ensemble /teams (build une map memberId → MemberTeamRef[] avec rôle)
//   - le user lié /users/{linkedUserId} si présent (dégradation gracieuse)
// ---------------------------------------------------------------------------

async function buildTeamRefsMap(): Promise<Map<string, MemberTeamRef[]>> {
  const snap = await getDocs(collection(db, TEAMS))
  const map = new Map<string, MemberTeamRef[]>()
  for (const d of snap.docs) {
    const data = d.data() as {
      name?: string
      coachIds?: string[]
      playerIds?: string[]
    }
    const name = data.name ?? d.id
    for (const coachId of data.coachIds ?? []) {
      const existing = map.get(coachId)
      const ref: MemberTeamRef = { id: d.id, name, role: 'coach' }
      if (existing) existing.push(ref)
      else map.set(coachId, [ref])
    }
    for (const playerId of data.playerIds ?? []) {
      const existing = map.get(playerId)
      const ref: MemberTeamRef = { id: d.id, name, role: 'player' }
      if (existing) existing.push(ref)
      else map.set(playerId, [ref])
    }
  }
  return map
}

async function readLinkedUser(linkedUserId: string | null): Promise<User | null> {
  if (!linkedUserId) return null
  try {
    const snap = await getDoc(doc(db, USERS, linkedUserId))
    if (!snap.exists()) return null
    return { id: snap.id, ...(snap.data() as Omit<User, 'id'>) }
  } catch (err: unknown) {
    if (err instanceof FirebaseError && err.code === 'permission-denied') {
      return null
    }
    throw err
  }
}

/**
 * Récupère un membre enrichi pour la page détail.
 *
 * Retourne `null` si le doc parent n'existe pas. Les jointures sont
 * dégradées en silence (contact / linkedUser → `null`, teams → `[]`) sur
 * `permission-denied` pour préserver l'affichage partiel selon le rôle
 * du caller.
 */
export async function getMemberDetail(id: string): Promise<MemberDetailRow | null> {
  const snap = await getDoc(doc(db, MEMBERS, id))
  if (!snap.exists()) return null
  const data = snap.data() as MemberData

  const [contact, teamRefsMap, linkedUser] = await Promise.all([
    readContact(id),
    buildTeamRefsMap(),
    readLinkedUser(data.linkedUserId),
  ])

  const teams = teamRefsMap.get(id) ?? []
  const teamLabels = teams.map((t) => t.name)

  return {
    id: snap.id,
    ...data,
    email: contact.email,
    phone: contact.phone,
    teamLabels,
    teams,
    linkedUser,
    lastLoginAt: null,
  }
}

// ---------------------------------------------------------------------------
// Writes — admin only (rules : isRootAdmin || isAdmin).
//
// `createMember` crée le doc parent et, si fournis, écrit email/phone
// dans la sub-collection privée /members/{id}/private/contact.
// `updateMember` ne touche QUE le doc parent /members/{id}.
// `updateMemberContact` écrit dans la sub-collection privée
// /members/{id}/private/contact (rules : admin ou self).
// ---------------------------------------------------------------------------

/**
 * Payload de création d'un membre. `linkedUserId` n'est jamais fourni à la
 * création depuis l'admin — le link member↔user se fait via le flow
 * d'invitation (cf. docs/main.md "Admin invitation flow"). `duesStatus` est
 * initialisé à `'n/a'` : il sera basculé à `'pending_grace'` par la Function
 * `initiateDuesOnPlayerActivation` lorsque le membre sera ajouté au
 * `playerIds` d'une équipe.
 */
export interface CreateMemberInput {
  firstName: string
  lastName: string
  roles: string[]
  licenseNumber?: string
  officialLevel?: number | null
  licensed?: boolean
  active?: boolean
  email?: string
  phone?: string
}

/**
 * Crée un nouveau membre dans `/members`.
 *
 * Si `email` ou `phone` est fourni, écrit aussi `/members/{id}/private/contact`
 * (sub-collection privée — cf. rules). Les deux écritures ne sont pas dans une
 * transaction : si la seconde échoue (rare, rules ou réseau), le membre est
 * créé sans contact et l'admin pourra le compléter via l'édition.
 */
export async function createMember(input: CreateMemberInput): Promise<MemberRow> {
  const data: MemberData = {
    firstName: input.firstName,
    lastName: input.lastName,
    roles: input.roles,
    linkedUserId: null,
    licenseNumber: input.licenseNumber ?? '',
    officialLevel: input.officialLevel ?? null,
    licensed: input.licensed ?? false,
    duesStatus: 'n/a',
    duesStatusUpdatedAt: FirestoreTimestamp.now(),
    active: input.active ?? true,
  }
  const ref = await addDoc(collection(db, MEMBERS), data)

  if (input.email !== undefined || input.phone !== undefined) {
    await setDoc(
      doc(db, MEMBERS, ref.id, PRIVATE_SUBCOLL, CONTACT_DOC),
      {
        email: input.email ?? '',
        phone: input.phone ?? '',
      } satisfies MemberContactData,
    )
  }

  const created = await getMemberById(ref.id)
  if (!created) {
    throw new Error(`Failed to read member ${ref.id} just after creation`)
  }
  return created
}

/**
 * Champs autorisés pour `updateMember`. Pas de `duesStatus` /
 * `duesStatusUpdatedAt` ici : ces champs sont gérés par la Function
 * `syncMemberDuesStatus` à partir des `/dues`. Pas de `linkedUserId` non
 * plus pour le MVP (relink → flow dédié plus tard).
 */
export interface MemberPatch {
  firstName?: string
  lastName?: string
  roles?: string[]
  licenseNumber?: string
  officialLevel?: number | null
  licensed?: boolean
  active?: boolean
}

export async function updateMember(id: string, patch: MemberPatch): Promise<void> {
  // UpdateData préserve les types Firestore (FieldValue, Timestamp) que
  // l'on n'utilise pas ici mais qui restent valides pour l'SDK.
  const update: UpdateData<MemberData> = { ...patch }
  await updateDoc(doc(db, MEMBERS, id), update)
}

export interface MemberContactPatch {
  email?: string
  phone?: string
}

/**
 * Écrit /members/{id}/private/contact. `setDoc` avec `merge: true` car le
 * sub-doc peut ne pas exister (premier renseignement). Quand absent, on
 * initialise les deux champs avec `""` côté complement pour respecter le
 * schéma `MemberContactData` (champs requis dans le type).
 */
export async function updateMemberContact(
  id: string,
  patch: MemberContactPatch,
): Promise<void> {
  const update: Partial<MemberContactData> = {}
  if (patch.email !== undefined) update.email = patch.email
  if (patch.phone !== undefined) update.phone = patch.phone
  await setDoc(
    doc(db, MEMBERS, id, PRIVATE_SUBCOLL, CONTACT_DOC),
    update,
    { merge: true },
  )
}

/**
 * Marqueur d'archivage soft. Conserve l'historique (dues / attendance) et
 * désactive simplement l'affichage actif. Pas de cascade — ce sera traité
 * dans un chantier dédié (close dues, retire des teams, etc.).
 *
 * `serverTimestamp` n'est pas posé ici (le doc ne porte pas `archivedAt`).
 */
export async function archiveMember(id: string): Promise<void> {
  await updateDoc(doc(db, MEMBERS, id), { active: false })
}

/**
 * Symétrique d'`archiveMember`. Réactive un membre archivé.
 */
export async function reactivateMember(id: string): Promise<void> {
  await updateDoc(doc(db, MEMBERS, id), { active: true })
}
