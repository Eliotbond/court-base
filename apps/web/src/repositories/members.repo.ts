import { FirebaseError } from 'firebase/app'
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  Timestamp as FirestoreTimestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
  type UpdateData,
} from 'firebase/firestore'
import { db } from '@/services/firebase'
import {
  deleteMember as deleteMemberCallable,
  type DeleteMemberOutput,
} from '@/services/cloudFunctions'
import type {
  CommsRecipient,
  Member,
  MemberCommsConfig,
  MemberContactData,
  MemberData,
  Timestamp,
  User,
  UserAddress,
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

/**
 * Âge légal de majorité (CH). On le déclare ici plutôt que dans un constants
 * partagé pour rester local au seul consumer actuel. Si une autre couche en
 * a besoin, le bouger dans `shared-types/src/member.ts` (note : pas de logique
 * dans shared-types — donc seulement la constante, pas la fonction).
 */
const MAJORITY_AGE_YEARS = 18

/**
 * Vrai si `birthDate` représente une date < (now - 18 ans). `null` est traité
 * comme majeur (cf. commentaire du type `MemberData.birthDate`).
 */
function isMinorDate(birthDate: Date | null, now: Date = new Date()): boolean {
  if (!birthDate) return false
  const cutoff = new Date(now)
  cutoff.setFullYear(cutoff.getFullYear() - MAJORITY_AGE_YEARS)
  return birthDate > cutoff
}

/**
 * Defaults `comms` dérivés de `birthDate` (cf. docs/firebase.md /members).
 *  - mineur : recipients = ['guardians'] (billing + general)
 *  - majeur / inconnu : recipients = ['member']
 * `majorityTransition` toujours `null` à la création.
 */
function defaultCommsForBirthDate(birthDate: Date | null): MemberCommsConfig {
  const recipient: CommsRecipient = isMinorDate(birthDate) ? 'guardians' : 'member'
  return {
    billingRecipients: [recipient],
    generalRecipients: [recipient],
    majorityTransition: null,
  }
}

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
 * Snapshot léger d'un tuteur `/users/{uid}` pour l'affichage en détail
 * (avatar + nom + email + coordonnées renseignées via app register).
 * Si la lecture est refusée (rules : autres users non lisibles selon le
 * caller), on tombe sur un placeholder portant `uid` et tous les autres
 * champs à `null` / chaîne vide.
 *
 * `phone`, `address` et `profileCompletedAt` sont alimentés par l'app
 * `apps/courtbase-register` lors de l'inscription d'un parent (cf.
 * `docs/chantier-registrations.md`). `profileCompletedAt === null` indique
 * un profil incomplet (compte créé mais formulaire register pas terminé).
 */
export interface GuardianRef {
  uid: string
  displayName: string
  email: string
  photoURL: string
  phone: string | null
  address: UserAddress | null
  profileCompletedAt: Timestamp | null
}

/**
 * Ligne enrichie pour la page Member detail. Étend `MemberRow` avec un
 * sur-ensemble de jointures résolues côté repo :
 *  - `teams` : équipes où le membre est coach ou joueur, avec rôle.
 *  - `linkedUser` : `/users/{linkedUserId}` (rôles auth, teamIds, photoURL).
 *    `null` si pas de compte lié OU si la lecture est refusée (rules).
 *  - `guardians` : résolution batchée de chaque uid dans `guardianUserIds`.
 *    Les uids non lisibles donnent un placeholder, pas une erreur.
 */
export interface MemberDetailRow extends MemberRow {
  teams: MemberTeamRef[]
  linkedUser: User | null
  guardians: GuardianRef[]
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
 * Résout chaque uid de `guardianUserIds` vers un `GuardianRef`. Fetch en
 * parallèle. Sur `permission-denied` ou doc absent → placeholder portant
 * uniquement l'uid (le caller affiche au moins l'avatar fallback).
 */
async function readGuardians(uids: readonly string[]): Promise<GuardianRef[]> {
  if (uids.length === 0) return []
  const snaps = await Promise.all(
    uids.map(async (uid) => {
      try {
        const snap = await getDoc(doc(db, USERS, uid))
        return { uid, snap }
      } catch (err: unknown) {
        if (err instanceof FirebaseError && err.code === 'permission-denied') {
          return { uid, snap: null }
        }
        throw err
      }
    }),
  )
  return snaps.map(({ uid, snap }) => {
    if (!snap || !snap.exists()) {
      return {
        uid,
        displayName: '',
        email: '',
        photoURL: '',
        phone: null,
        address: null,
        profileCompletedAt: null,
      }
    }
    const data = snap.data() as Partial<User>
    return {
      uid: snap.id,
      displayName: data.displayName ?? '',
      email: data.email ?? '',
      photoURL: data.photoURL ?? '',
      phone: data.phone ?? null,
      address: data.address ?? null,
      profileCompletedAt: data.profileCompletedAt ?? null,
    }
  })
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

  const [contact, teamRefsMap, linkedUser, guardians] = await Promise.all([
    readContact(id),
    buildTeamRefsMap(),
    readLinkedUser(data.linkedUserId),
    readGuardians(data.guardianUserIds ?? []),
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
    guardians,
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
 *
 * `birthDate` peut être absente : `null` est traité comme adulte côté
 * defaults `comms` (cf. `defaultCommsForBirthDate`). L'UI doit avertir
 * l'admin que cette info reste à compléter.
 *
 * `guardianUserIds` n'est pas fourni à la création : le lien tuteur ↔ pupille
 * passe toujours par `addGuardian` (atomicité avec `/users.roles`).
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
  /** `null` (ou absent) = inconnue. */
  birthDate?: Date | null
  /** N° AVS au format `756.XXXX.XXXX.XX`. `null` (ou absent) = inconnu. */
  avs?: string | null
}

/**
 * Crée un nouveau membre dans `/members`.
 *
 * Si `email` ou `phone` est fourni, écrit aussi `/members/{id}/private/contact`
 * (sub-collection privée — cf. rules). Les deux écritures ne sont pas dans une
 * transaction : si la seconde échoue (rare, rules ou réseau), le membre est
 * créé sans contact et l'admin pourra le compléter via l'édition.
 *
 * `comms` est dérivé de `birthDate` via `defaultCommsForBirthDate` :
 *  - mineur : `['guardians']` pour billing et general
 *  - majeur / inconnu : `['member']` pour les deux
 * `guardianUserIds` démarre toujours vide ; ajouter via `addGuardian`.
 */
export async function createMember(input: CreateMemberInput): Promise<MemberRow> {
  const birthDate = input.birthDate ?? null
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
    birthDate: birthDate ? FirestoreTimestamp.fromDate(birthDate) : null,
    guardianUserIds: [],
    comms: defaultCommsForBirthDate(birthDate),
    avs: input.avs ?? null,
    transferState: 'none',
    // Cycle de vie membre (cf. shared-types `MemberStatus`) : tout nouveau
    // membre démarre en `'active'`. La bascule vers `'archived'` (et les
    // métadonnées associées) est faite par une callable serveur dédiée
    // (refus registration, départ, etc.) — jamais ici.
    status: 'active',
    archivedAt: null,
    archivedReason: null,
    archivedByUid: null,
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
 * Patch partiel `comms`. Volontairement restrictif : on autorise `billingRecipients`
 * et `generalRecipients` à la modification fine ; `majorityTransition` reste
 * du ressort des Cloud Functions (`onMajorityReached`, callables
 * `respondGuardianConsent` / `respondMemberConsent`).
 */
export interface MemberCommsPatch {
  billingRecipients?: CommsRecipient[]
  generalRecipients?: CommsRecipient[]
}

/**
 * Champs autorisés pour `updateMember`. Pas de `duesStatus` /
 * `duesStatusUpdatedAt` ici : ces champs sont gérés par la Function
 * `syncMemberDuesStatus` à partir des `/dues`. Pas de `linkedUserId` non
 * plus : le relink member ↔ compte Auth passe désormais par la fonction
 * dédiée `setLinkedUser` (atomicité bidirectionnelle avec `/users.memberId`).
 *
 * `guardianUserIds` est volontairement absent : passer par `addGuardian` /
 * `removeGuardian` pour préserver la synchro avec `/users.roles`.
 */
export interface MemberPatch {
  firstName?: string
  lastName?: string
  roles?: string[]
  licenseNumber?: string
  officialLevel?: number | null
  licensed?: boolean
  active?: boolean
  /** `null` = effacer (membre dont on ne connaît pas la date). */
  birthDate?: Date | null
  /** `null` = effacer le n° AVS. Format attendu : `756.XXXX.XXXX.XX`. */
  avs?: string | null
  /** Patch partiel `comms` — pas `majorityTransition`. */
  comms?: MemberCommsPatch
}

/**
 * Champs internes Firestore que `updateMember` peut écrire en plus de ceux
 * du patch public. Utilisé pour étendre proprement le payload typé.
 */
type MemberInternalUpdate = UpdateData<MemberData> & {
  birthDate?: FirestoreTimestamp | null
  'comms.billingRecipients'?: CommsRecipient[]
  'comms.generalRecipients'?: CommsRecipient[]
}

export async function updateMember(id: string, patch: MemberPatch): Promise<void> {
  // On part du sous-ensemble "plat" du patch — birthDate et comms demandent
  // une conversion / des dotted paths, donc ils sont gérés à part.
  const { birthDate, comms, ...flat } = patch
  const update: MemberInternalUpdate = { ...flat }

  if (birthDate !== undefined) {
    update.birthDate = birthDate ? FirestoreTimestamp.fromDate(birthDate) : null

    // Si la birthDate change, ré-aligner les defaults `comms` UNIQUEMENT si
    // aucune transition de majorité n'est en cours (sinon les Cloud Functions
    // sont responsables). On lit le doc courant pour vérifier `majorityTransition`.
    const snap = await getDoc(doc(db, MEMBERS, id))
    if (snap.exists()) {
      const current = snap.data() as MemberData
      if (current.comms?.majorityTransition == null) {
        const defaults = defaultCommsForBirthDate(birthDate)
        // Patch caller n'a pas explicitement touché ces champs ? On les
        // ré-aligne. Si le caller a fourni un comms patch, on respecte ses
        // valeurs (priorité explicite > defaults).
        if (!comms || comms.billingRecipients === undefined) {
          update['comms.billingRecipients'] = defaults.billingRecipients
        }
        if (!comms || comms.generalRecipients === undefined) {
          update['comms.generalRecipients'] = defaults.generalRecipients
        }
      }
    }
  }

  if (comms) {
    if (comms.billingRecipients !== undefined) {
      update['comms.billingRecipients'] = comms.billingRecipients
    }
    if (comms.generalRecipients !== undefined) {
      update['comms.generalRecipients'] = comms.generalRecipients
    }
  }

  if (Object.keys(update).length === 0) return
  await updateDoc(doc(db, MEMBERS, id), update)
}

// ---------------------------------------------------------------------------
// Guardians — link / unlink user ↔ member.
//
// Source de vérité du lien : `/members/{memberId}.guardianUserIds`. En miroir,
// `/users/{uid}.roles` doit contenir `'parent'` ssi l'uid apparaît dans au
// moins un `guardianUserIds`. On maintient cet invariant côté client :
//   - addGuardian : batch atomique (member + user.roles arrayUnion 'parent').
//     `arrayUnion` est idempotent → pas de risque de double si déjà parent.
//   - removeGuardian : retire d'abord du membre, puis check s'il reste un autre
//     lien guardian quelque part ; sinon retire 'parent' de user.roles.
//     Non-atomique entre les deux étapes : fenêtre brève (<100ms) où l'uid
//     n'est plus guardian de personne mais conserve `'parent'`. Acceptable :
//     pas de fuite de droits réelle (rules: parent = lecture conditionnée à
//     `guardianUserIds`, donc inoffensive sans entrée).
// ---------------------------------------------------------------------------

/**
 * Lie un user comme tuteur d'un membre. Atomique sur les deux writes via
 * `writeBatch` : soit les deux passent, soit aucun.
 *
 * Idempotent : `arrayUnion` ignore les doublons. Appeler deux fois avec le
 * même couple (memberId, userId) est sans effet.
 */
export async function addGuardian(
  memberId: string,
  userId: string,
): Promise<void> {
  const batch = writeBatch(db)
  batch.update(doc(db, MEMBERS, memberId), {
    guardianUserIds: arrayUnion(userId),
  })
  batch.update(doc(db, USERS, userId), {
    roles: arrayUnion('parent'),
  })
  await batch.commit()
}

/**
 * Délie un user d'un membre. Deux étapes :
 *  1. `arrayRemove` sur `/members/{memberId}.guardianUserIds`.
 *  2. Query `where('guardianUserIds', 'array-contains', userId).limit(1)` —
 *     si vide, `arrayRemove('parent')` sur `/users/{userId}.roles`.
 *
 * Non-atomique entre les deux étapes (cf. note plus haut sur l'invariant).
 */
export async function removeGuardian(
  memberId: string,
  userId: string,
): Promise<void> {
  await updateDoc(doc(db, MEMBERS, memberId), {
    guardianUserIds: arrayRemove(userId),
  })
  const remaining = await getDocs(
    query(
      collection(db, MEMBERS),
      where('guardianUserIds', 'array-contains', userId),
      limit(1),
    ),
  )
  if (remaining.empty) {
    await updateDoc(doc(db, USERS, userId), {
      roles: arrayRemove('parent'),
    })
  }
}

// ---------------------------------------------------------------------------
// Link member ↔ user (compte Auth).
//
// Invariant bidirectionnel : `/members/{memberId}.linkedUserId === uid`
// SSI `/users/{uid}.memberId === memberId`. La fonction maintient cet
// invariant côté client via un `writeBatch` atomique (deux ou trois writes
// dans la même opération Firestore). Si un ancien lien existait (côté
// member ou côté user), il est nettoyé dans le même batch pour éviter les
// orphelins ("user pointing to nothing" / "member pointing to nothing").
// ---------------------------------------------------------------------------

/**
 * Lie (ou délie) un member à un compte Auth `/users/{uid}`.
 *
 * Invariant bidirectionnel : `/members/{memberId}.linkedUserId === uid`
 * SSI `/users/{uid}.memberId === memberId`. Implémenté via `writeBatch`
 * atomique :
 *  - `uid === null` → délie : `member.linkedUserId = null` + clear
 *    `users/{ancien}.memberId` si un lien existait côté member.
 *  - `uid` fourni → (re)lie : `member.linkedUserId = uid` +
 *    `user.memberId = memberId`, plus deux nettoyages d'orphelins le cas
 *    échéant (ancien linkedUserId du member, ancien memberId du user).
 *
 * Idempotent : si le couple (memberId, uid) est déjà cohérent, le batch
 * réécrit les mêmes valeurs sans effet observable. Aucune lecture ne pose
 * d'invariant fort — c'est le batch atomique qui garantit la cohérence
 * finale, même si plusieurs admins déclenchent un relink en parallèle (le
 * dernier write gagne, mais l'invariant bidirectionnel reste vrai côté
 * deux docs).
 */
export async function setLinkedUser(
  memberId: string,
  uid: string | null,
): Promise<void> {
  const memberRef = doc(db, MEMBERS, memberId)
  const memberSnap = await getDoc(memberRef)
  const previousLinkedUserId = memberSnap.exists()
    ? ((memberSnap.data() as MemberData).linkedUserId ?? null)
    : null

  const batch = writeBatch(db)

  if (uid === null) {
    batch.update(memberRef, { linkedUserId: null })
    if (previousLinkedUserId) {
      batch.update(doc(db, USERS, previousLinkedUserId), { memberId: null })
    }
    await batch.commit()
    return
  }

  const userRef = doc(db, USERS, uid)
  const userSnap = await getDoc(userRef)
  const previousMemberIdOfUser = userSnap.exists()
    ? ((userSnap.data() as Partial<User>).memberId ?? null)
    : null

  batch.update(memberRef, { linkedUserId: uid })
  batch.update(userRef, { memberId })

  // Si le member pointait vers un autre user → clear l'ancien user.memberId.
  if (previousLinkedUserId && previousLinkedUserId !== uid) {
    batch.update(doc(db, USERS, previousLinkedUserId), { memberId: null })
  }

  // Si le user pointait vers un autre member → clear l'ancien member.linkedUserId.
  if (previousMemberIdOfUser && previousMemberIdOfUser !== memberId) {
    batch.update(doc(db, MEMBERS, previousMemberIdOfUser), { linkedUserId: null })
  }

  await batch.commit()
}

/**
 * Liste les membres dont `uid` est tuteur (`array-contains` sur
 * `guardianUserIds`). Enrichit chaque ligne comme `listMembers` :
 *  - contact (dégradation `permission-denied` → null)
 *  - teamLabels (un seul scan `/teams`)
 *
 * Ordonné par `lastName`. Pas de limite côté repo : un user a typiquement
 * 1-3 pupilles, OK de tout retourner.
 */
export async function getMembersAsGuardian(uid: string): Promise<MemberRow[]> {
  const snap = await getDocs(
    query(
      collection(db, MEMBERS),
      where('guardianUserIds', 'array-contains', uid),
      orderBy('lastName'),
    ),
  )
  if (snap.empty) return []

  const teamLabelsPromise = buildTeamLabelsMap()
  const contactsPromise = Promise.all(snap.docs.map((d) => readContact(d.id)))

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

// ---------------------------------------------------------------------------
// Suppression DÉFINITIVE (correction d'erreur de création).
//
// Distinct de `archiveMember` : ici on appelle la Cloud Function `deleteMember`
// qui exécute en transaction côté serveur :
//   - delete physique de /members/{id} + sub-collections
//   - retrait du member des teams (coachIds / playerIds)
//   - clear du `matchedMemberId` sur les registrations historiques
//   - delete des /dues non payées
//
// Réservé aux admins (vérification côté Cloud Function). À utiliser uniquement
// pour corriger une erreur de création — pour une fin d'adhésion normale,
// préférer `archiveMember` qui conserve l'historique comptable.
// ---------------------------------------------------------------------------

/**
 * Supprime définitivement un membre via la callable serveur.
 *
 * @param memberId    Id du membre à supprimer.
 * @param confirmName Confirmation typée par l'admin (`"<firstName> <lastName>"`).
 *                    Le serveur fait la comparaison case-insensitive +
 *                    normalisation diacritiques.
 * @throws FirebaseError avec code parmi : `unauthenticated`, `permission-denied`,
 *  `not-found`, `invalid-argument`, `failed-precondition`. Le caller (store)
 *  peut adapter le message UI selon le code.
 */
export async function deleteMemberPermanently(
  memberId: string,
  confirmName: string,
): Promise<DeleteMemberOutput> {
  try {
    return await deleteMemberCallable({ memberId, confirmName })
  } catch (err: unknown) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[members.repo/deleteMemberPermanently] failed [${code}]`, err)
    throw err
  }
}
