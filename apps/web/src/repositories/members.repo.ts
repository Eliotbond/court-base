import { FirebaseError } from 'firebase/app'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '@/services/firebase'
import type { Member, MemberContactData, MemberData } from '@club-app/shared-types'

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

/** Récupère un membre par son id (pour la future page détail). */
export async function getMemberById(id: string): Promise<MemberRow | null> {
  const snap = await getDoc(doc(db, MEMBERS, id))
  if (!snap.exists()) return null
  const [contact, teamLabelsMap] = await Promise.all([
    readContact(id),
    buildTeamLabelsMap(),
  ])
  return snapToRow(snap, contact, teamLabelsMap.get(id) ?? [])
}

// Writes (createMember / updateMember) volontairement absents : la vue
// Members ne consomme que des reads pour l'instant. Les ajouter ici quand
// le besoin se présente, en miroir de `teams.repo.ts`.
