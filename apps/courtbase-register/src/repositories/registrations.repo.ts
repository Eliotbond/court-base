import {
  FirestoreError,
  Timestamp as FirestoreTimestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import type {
  Registration,
  RegistrationActionLogEntry,
  RegistrationData,
  RegistrationFor,
  RegistrationPlayerIdentity,
  RegistrationRelationship,
  RegistrationStatus,
} from '@club-app/shared-types'
import { db } from '@/services/firebase'

/**
 * Repository Registrations — Firestore-backed (côté app courtbase-register).
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase
 * (cf. `apps/courtbase-register/CLAUDE.md` — architecture en couches).
 *
 * Permissions (cf. `firestore.rules` §registrations) :
 *  - **read** : auteur, tuteur d'un matched member, coach de la team, admin.
 *  - **create** : auteur uniquement, status forcé à `draft` ou `submitted`.
 *  - **update** : auteur uniquement, et **uniquement tant que `status == 'draft'`**.
 *    Toutes les transitions post-`submitted` passent par callables Admin SDK
 *    (`submitRegistration`, `refuseRegistration`, `cancelRegistration`).
 *
 * Conséquence : les fonctions `createDraft` / `updateDraft` écrivent
 * directement Firestore ; la soumission finale et l'annulation passent par
 * `services/cloudFunctions.ts`.
 */

const REGISTRATIONS = 'registrations'

// ---------------------------------------------------------------------------
// Snap → Registration
// ---------------------------------------------------------------------------

function snapToRegistration(
  snap: { id: string; data: () => unknown },
): Registration {
  const data = snap.data() as RegistrationData
  return { id: snap.id, ...data }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Liste les registrations soumises par un user (le caller doit être ce user
 * sauf admin/coach — sinon les rules rejettent). Ordonné `createdAt desc`.
 * Cap silencieux à 50 ; au-delà, paginer plus tard.
 *
 * Note : on évite volontairement un `orderBy('createdAt')` Firestore-side pour
 * ne pas dépendre d'un index composite (`submittedByUid ASC, createdAt DESC`)
 * qui peut être absent / en `CREATING` selon les environnements, et pour ne
 * pas exclure silencieusement les drafts dont `createdAt` est encore en pending
 * write (serverTimestamp non résolu). Le tri se fait en mémoire — volume
 * attendu < 10 par user, coût négligeable. Même pattern que `teams.repo.ts`.
 */
export async function listMyRegistrations(uid: string): Promise<Registration[]> {
  const snap = await getDocs(
    query(
      collection(db, REGISTRATIONS),
      where('submittedByUid', '==', uid),
    ),
  )
  const items = snap.docs.map(snapToRegistration)
  // Tri en mémoire `createdAt desc`. Fallback à 0 pour les docs dont
  // `createdAt` n'est pas encore résolu côté serveur (pending write juste
  // après `createDraft`) — ils remontent en bas, ce qui est OK puisque le
  // store réinsère manuellement le draft fraîchement créé en tête de `myList`.
  items.sort((a, b) => {
    const sa = a.createdAt?.seconds ?? 0
    const sb = b.createdAt?.seconds ?? 0
    return sb - sa
  })
  return items.slice(0, 50)
}

/** Récupère une registration par son id. Retourne `null` si le doc n'existe pas. */
export async function getRegistrationById(id: string): Promise<Registration | null> {
  try {
    const snap = await getDoc(doc(db, REGISTRATIONS, id))
    if (!snap.exists()) return null
    return snapToRegistration(snap)
  } catch (err) {
    if (err instanceof FirestoreError && err.code === 'permission-denied') {
      return null
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// Writes — drafts uniquement (toute autre transition passe par callable)
// ---------------------------------------------------------------------------

/**
 * Payload de création d'un draft. Champ par champ, pour rendre les
 * `null` explicites et éviter des objects partiels qui sauteraient le typecheck.
 *
 * Le caller fournit `birthDate` en `Date` JS — converti en Timestamp ici.
 */
export interface CreateDraftInput {
  submittedByUid: string
  registrationFor: RegistrationFor
  relationship: RegistrationRelationship | null
  relationshipOther: string | null
  /** Identité partielle autorisée : tous les champs optionnels au stade `draft`. */
  player: Partial<RegistrationPlayerIdentityInput>
  matchedMemberId: string | null
  teamId: string | null
}

/**
 * Variant "Date" + champs optionnels de `RegistrationPlayerIdentity` pour
 * accepter un wizard partiellement rempli au moment de l'autosave.
 */
export interface RegistrationPlayerIdentityInput {
  firstName: string
  lastName: string
  birthDate: Date
  gender: 'M' | 'F' | 'other' | null
  avs: string | null
  avsUnavailable: boolean
  phone: string | null
}

/**
 * Crée un nouveau draft. Toujours en `status: 'draft'` — la submission finale
 * passe par la callable `submitRegistration` (Admin SDK).
 *
 * Retourne le `Registration` complet (re-lecture après écriture pour récupérer
 * `createdAt` et `statusUpdatedAt` finalisés par le serveur).
 */
export async function createDraft(input: CreateDraftInput): Promise<Registration> {
  const initialAction: RegistrationActionLogEntry = {
    at: FirestoreTimestamp.now(),
    byUid: input.submittedByUid,
    action: 'created',
    previousStatus: null,
    newStatus: 'draft',
    note: null,
  }

  const playerBirthDate = input.player.birthDate
    ? FirestoreTimestamp.fromDate(input.player.birthDate)
    // Placeholder le temps du draft : `epoch` est facilement détectable côté
    // serveur comme "non rempli" si jamais soumis tel quel — mais la callable
    // submitRegistration rejette les drafts sans birthDate valide.
    : FirestoreTimestamp.fromDate(new Date(0))

  const data: RegistrationData = {
    submittedByUid: input.submittedByUid,
    registrationFor: input.registrationFor,
    relationship: input.relationship,
    relationshipOther: input.relationshipOther,
    player: {
      firstName: input.player.firstName ?? '',
      lastName: input.player.lastName ?? '',
      birthDate: playerBirthDate,
      gender: input.player.gender ?? null,
      avs: input.player.avs ?? null,
      avsUnavailable: input.player.avsUnavailable ?? false,
      phone: input.player.phone ?? null,
    },
    matchedMemberId: input.matchedMemberId,
    teamId: input.teamId ?? '',
    previouslyLicensed: false,
    previousClubName: null,
    previousClubAbroad: false,
    transferLetterStoragePath: null,
    foreignTransfer: false,
    status: 'draft',
    statusUpdatedAt: FirestoreTimestamp.now(),
    trialStartedAt: null,
    refusalReason: null,
    refusedByUid: null,
    actionLog: [initialAction],
    coachNotifiedAt: null,
    adminNotifiedAt: null,
    createdAt: FirestoreTimestamp.now(),
  }

  // `serverTimestamp()` n'est pas directement assignable au champ typé
  // Timestamp — Firestore résout côté serveur. On contourne via `setDoc` qui
  // accepte les sentinels via `any`-cast localisé.
  const docRef = await addDoc(collection(db, REGISTRATIONS), {
    ...data,
    statusUpdatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  })

  const created = await getRegistrationById(docRef.id)
  if (!created) {
    throw new Error(`Failed to read draft registration ${docRef.id} after create`)
  }
  return created
}

/**
 * Patch partiel d'un draft. Le caller (auteur) reste contraint par les rules :
 *  - `status` doit rester `'draft'`,
 *  - `submittedByUid` est immuable.
 * Si l'un de ces invariants est violé, Firestore rejette en `permission-denied`.
 */
export interface UpdateDraftInput {
  registrationFor?: RegistrationFor
  relationship?: RegistrationRelationship | null
  relationshipOther?: string | null
  player?: Partial<RegistrationPlayerIdentityInput>
  matchedMemberId?: string | null
  teamId?: string
  previouslyLicensed?: boolean
  previousClubName?: string | null
  previousClubAbroad?: boolean
  transferLetterStoragePath?: string | null
}

export async function updateDraft(
  registrationId: string,
  patch: UpdateDraftInput,
): Promise<void> {
  const update: Record<string, unknown> = {}

  if (patch.registrationFor !== undefined) update.registrationFor = patch.registrationFor
  if (patch.relationship !== undefined) update.relationship = patch.relationship
  if (patch.relationshipOther !== undefined) update.relationshipOther = patch.relationshipOther
  if (patch.matchedMemberId !== undefined) update.matchedMemberId = patch.matchedMemberId
  if (patch.teamId !== undefined) update.teamId = patch.teamId
  if (patch.previouslyLicensed !== undefined) update.previouslyLicensed = patch.previouslyLicensed
  if (patch.previousClubName !== undefined) update.previousClubName = patch.previousClubName
  if (patch.previousClubAbroad !== undefined) {
    update.previousClubAbroad = patch.previousClubAbroad
    // `foreignTransfer` est dérivé de `previousClubAbroad` au moment de la
    // soumission — au stade draft on garde les deux alignés pour l'UI.
    update.foreignTransfer = patch.previousClubAbroad
  }
  if (patch.transferLetterStoragePath !== undefined) {
    update.transferLetterStoragePath = patch.transferLetterStoragePath
  }

  if (patch.player !== undefined) {
    // Patch player champ par champ via dotted paths.
    const p = patch.player
    if (p.firstName !== undefined) update['player.firstName'] = p.firstName
    if (p.lastName !== undefined) update['player.lastName'] = p.lastName
    if (p.birthDate !== undefined) {
      update['player.birthDate'] = FirestoreTimestamp.fromDate(p.birthDate)
    }
    if (p.gender !== undefined) update['player.gender'] = p.gender
    if (p.avs !== undefined) update['player.avs'] = p.avs
    if (p.avsUnavailable !== undefined) update['player.avsUnavailable'] = p.avsUnavailable
    if (p.phone !== undefined) update['player.phone'] = p.phone
  }

  // Touche `statusUpdatedAt` à chaque autosave pour traçabilité.
  update.statusUpdatedAt = serverTimestamp()

  if (Object.keys(update).length <= 1) return  // seul `statusUpdatedAt` posé → no-op
  await updateDoc(doc(db, REGISTRATIONS, registrationId), update)
}

/**
 * Supprime un draft. Les rules Firestore restreignent à l'auteur + status
 * `'draft'` uniquement — pas de suppression possible sur une registration
 * soumise (le user passerait par la callable `cancelRegistration` qui set
 * status='cancelled' et conserve l'audit).
 */
export async function deleteDraft(registrationId: string): Promise<void> {
  await deleteDoc(doc(db, REGISTRATIONS, registrationId))
}

/**
 * Helper : ajoute une entrée `actionLog` à un draft (le wizard log les
 * étapes franchies). Le tableau est réécrit côté client — pas d'`arrayUnion`
 * pour préserver l'ordre temporel + autoriser des entries identiques.
 *
 * Toléré uniquement sur draft (rules). En production la majorité des entries
 * sont écrites côté server lors de la soumission.
 */
export async function appendActionLogToDraft(
  registrationId: string,
  entry: Omit<RegistrationActionLogEntry, 'at'>,
): Promise<void> {
  const snap = await getDoc(doc(db, REGISTRATIONS, registrationId))
  if (!snap.exists()) {
    throw new Error(`registration ${registrationId} not found`)
  }
  const reg = snap.data() as RegistrationData
  const next: RegistrationActionLogEntry = {
    at: FirestoreTimestamp.now(),
    byUid: entry.byUid,
    action: entry.action,
    previousStatus: entry.previousStatus ?? null,
    newStatus: entry.newStatus ?? null,
    note: entry.note ?? null,
  }
  await updateDoc(doc(db, REGISTRATIONS, registrationId), {
    actionLog: [...(reg.actionLog ?? []), next],
  })
}

// ---------------------------------------------------------------------------
// Aliases status helpers — exposés pour les stores / composants
// ---------------------------------------------------------------------------

/** True si le user peut encore modifier ou annuler sa propre registration. */
export function isPendingForUser(status: RegistrationStatus): boolean {
  return (
    status === 'draft' ||
    status === 'submitted' ||
    status === 'open_pending_trial' ||
    status === 'conditional_pending_review'
  )
}

/**
 * Statuts terminaux d'une registration : une fois dans l'un de ces états, la
 * registration est "close" et le user peut en démarrer une nouvelle pour la
 * même personne (réinscription après annulation / refus).
 *
 * Exhaustif vis-à-vis de `RegistrationStatus` — tout autre statut
 * (`draft`, `submitted`, `open_pending_trial`, `conditional_pending_review`,
 * `conditional_pending_trial`, `trial_in_progress`, `confirmed_pending_dues`,
 * `active`) est considéré "en cours" et donc bloquant.
 */
const TERMINAL_REGISTRATION_STATUSES: ReadonlySet<RegistrationStatus> = new Set<RegistrationStatus>([
  'cancelled',
  'refused',
])

/** True si le statut est terminal (`cancelled` ou `refused`). */
export function isTerminalRegistrationStatus(status: RegistrationStatus): boolean {
  return TERMINAL_REGISTRATION_STATUSES.has(status)
}

/**
 * True si la registration est une inscription "pour soi-même" (`self`) encore
 * en cours — c.-à-d. dont le statut n'est pas terminal. Une telle inscription
 * est bloquante : le user ne doit pas pouvoir en démarrer une seconde pour
 * lui-même tant que celle-ci n'est ni annulée ni refusée.
 */
export function isBlockingSelfRegistration(reg: Registration): boolean {
  return reg.registrationFor === 'self' && !isTerminalRegistrationStatus(reg.status)
}

/**
 * Re-écriture explicite d'une registration en `draft` (utilisé par les tests
 * locaux ou un futur "remettre en draft" si jamais. Non exposé pour l'UI
 * publique pour l'instant.).
 */
export async function debugForceDraft(registrationId: string): Promise<void> {
  await setDoc(
    doc(db, REGISTRATIONS, registrationId),
    { status: 'draft', statusUpdatedAt: serverTimestamp() },
    { merge: true },
  )
}
