import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  where,
  type Timestamp as FirestoreTimestamp,
} from 'firebase/firestore'
import { auth, db } from '@/services/firebase'
import { listRootAdminUids } from '@/services/cloudFunctions'
import type {
  ClosurePeriod,
  ClubConfig,
  ClubConfigData,
  ClubContact,
  DuesConfig,
  Invitation,
  InvitationData,
  OfficialsConfig,
  Role,
  SubscriptionInfo,
  UserData,
} from '@club-app/shared-types'

/**
 * Repository Settings — lit/écrit la config du club + ressources adjacentes
 * affichées dans l'écran Settings (`/roles`, `/closurePeriods`, subscription,
 * admin team).
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase. Pour
 * l'instant, `/config/club` (singleton), `/roles/*` et `/closurePeriods/*`
 * ne sont pas encore provisionnées de manière exploitable côté client, donc
 * on renvoie des données mockées. Chaque retour est annoté d'un
 * `TODO(firestore)` indiquant la query réelle qui le remplacera.
 *
 * Voir docs/firebase.md (`/config/club`, `/roles`, `/closurePeriods`,
 * `/users`) pour le schéma cible et docs/frontend-desktop.md pour la règle
 * de couches.
 */

const MOCK_DELAY_MS = 100

function delay<T>(value: T, ms: number = MOCK_DELAY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

function ts(date: Date): { seconds: number; nanoseconds: number } {
  return { seconds: Math.floor(date.getTime() / 1000), nanoseconds: 0 }
}

// ---------------------------------------------------------------------------
// Patch types — input partial pour les mutations section-par-section
// ---------------------------------------------------------------------------

/**
 * Sous-ensemble de `ClubConfig` éditable depuis Settings.
 *
 * `createdAt` / `createdBy` sont write-once (à la création du projet) et
 * `id` est immuable, donc absents du patch.
 *
 * `shortCode` et `contact` sont désormais dans `/config/club` (cf.
 * `docs/firebase.md`) — édités côté General avec le reste.
 */
export type ClubConfigPatch = Partial<
  Pick<
    ClubConfigData,
    | 'name'
    | 'shortCode'
    | 'logo'
    | 'address'
    | 'contact'
    | 'officialsConfig'
    | 'duesConfig'
  >
>

/** Input pour créer/éditer un rôle custom. `id`/`createdAt` posés côté repo. */
export interface RoleInput {
  name: string
  color: string
}

/** Input pour créer une closure period. */
export interface ClosurePeriodInput {
  name: string
  /** ISO date "YYYY-MM-DD" — le repo convertit en Timestamp à l'écriture. */
  startDate: string
  endDate: string
  type: 'holiday' | 'custom'
}

/**
 * Une ligne "Admin team" pour la section Settings → Admin team.
 *
 * Source réelle : un user dans `/users/{uid}` dont `roles` contient `'admin'`
 * (cf. `docs/firebase.md`). On expose ici une vue dénormalisée incluant le
 * flag `isRootAdmin` (dérivé du custom claim Auth, pas du doc Firestore) —
 * c'est la résolution côté repo qui consolidera ces deux sources.
 */
export interface ClubAdmin {
  /** uid Auth (= id du doc `/users/{uid}`). */
  id: string
  displayName: string
  email: string
  /**
   * `true` si le user porte le custom claim `rootAdmin: true`. Ce flag n'est
   * pas dans `/users/{uid}` — il vient du token ID Firebase. Le repo le
   * résoudra via Admin SDK côté Function ou via un getter callable.
   */
  isRootAdmin: boolean
  /** ISO timestamp d'ajout — utilisé pour tri + affichage UI. */
  addedAt: { seconds: number; nanoseconds: number }
}

/** Input pour inviter un nouvel admin. v1 : email seul, le reste à l'acceptation. */
export interface AdminInviteInput {
  email: string
}

// ---------------------------------------------------------------------------
// Mocks — sources des données affichées sur Settings
// ---------------------------------------------------------------------------

/**
 * In-memory store des mocks. Les mutations (`updateClubConfig`, etc.) mutent
 * cette structure pour simuler de la persistance pendant la session, ce qui
 * permet à la vue de valider visuellement les sauvegardes.
 *
 * TODO(firestore): supprimer entièrement quand les collections seront wired.
 */
interface SettingsState {
  config: ClubConfig
  roles: Role[]
  closurePeriods: ClosurePeriod[]
  subscription: SubscriptionInfo
}

const STATE: SettingsState = {
  config: {
    id: 'club',
    name: 'BC Lausanne-Sud',
    shortCode: 'bcls',
    logo: null,
    address: {
      street: 'Av. de la Forêt 12',
      city: 'Lausanne',
      zip: '1010',
      country: 'CH',
    },
    contact: {
      email: 'contact@bcls.ch',
      phone: '+41 21 555 24 24',
    },
    officialsConfig: {
      licenseFee: 140,
      thresholdGreen: 6,
      thresholdOrange: 3,
    },
    duesConfig: {
      gracePeriodDays: 21,
      paymentDueDays: 14,
    },
    createdAt: ts(new Date('2024-08-15T10:00:00Z')),
    createdBy: 'mock-uid-bootstrap',
  },

  roles: [
    {
      id: 'player',
      name: 'Player',
      type: 'system',
      color: '#dbeafe',
      createdAt: ts(new Date('2024-08-15')),
    },
    {
      id: 'coach',
      name: 'Coach',
      type: 'system',
      color: '#fee2e2',
      createdAt: ts(new Date('2024-08-15')),
    },
    {
      id: 'official',
      name: 'Officiel',
      type: 'system',
      color: '#dcfce7',
      createdAt: ts(new Date('2024-08-15')),
    },
    {
      id: 'referee',
      name: 'Référé',
      type: 'system',
      color: '#ede9fe',
      createdAt: ts(new Date('2024-08-15')),
    },
    {
      id: 'comite',
      name: 'Comité',
      type: 'custom',
      color: '#fef3c7',
      createdAt: ts(new Date('2024-09-02')),
    },
    {
      id: 'tresorier',
      name: 'Trésorier',
      type: 'custom',
      color: '#fce7f3',
      createdAt: ts(new Date('2024-09-02')),
    },
  ],

  closurePeriods: [
    {
      id: 'mock-cp-1',
      name: 'Vacances de Noël',
      startDate: ts(new Date('2025-12-22T00:00:00Z')),
      endDate: ts(new Date('2026-01-04T23:59:59Z')),
      type: 'holiday',
      createdBy: 'mock-uid-bootstrap',
    },
    {
      id: 'mock-cp-2',
      name: 'Vacances de février',
      startDate: ts(new Date('2026-02-16T00:00:00Z')),
      endDate: ts(new Date('2026-02-22T23:59:59Z')),
      type: 'holiday',
      createdBy: 'mock-uid-bootstrap',
    },
    {
      id: 'mock-cp-3',
      name: 'Travaux salle Forêt',
      startDate: ts(new Date('2026-04-13T00:00:00Z')),
      endDate: ts(new Date('2026-04-17T23:59:59Z')),
      type: 'custom',
      createdBy: 'mock-uid-bootstrap',
    },
  ],

  subscription: {
    status: 'paid',
    planLabel: 'Club · CHF 590 / an',
    renewsAt: ts(new Date('2026-08-31')),
    memberCap: 250,
    memberCount: 142,
  },
}

/** Snapshot helper to avoid leaking the mutable store reference into callers. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// ---------------------------------------------------------------------------
// Public API — Club config
// ---------------------------------------------------------------------------

/**
 * Lit le doc singleton `/config/club`.
 *
 * TODO(firestore): remplacer par
 *   `doc('/config/club').get()` puis cast vers `ClubConfig`.
 */
export async function getClubConfig(): Promise<ClubConfig> {
  // TODO(firestore): replace with real /config/club read.
  return delay(clone(STATE.config))
}

/**
 * Patch le doc singleton `/config/club`. Optimistic — la vue update son
 * cache local immédiatement et appelle ce repo en background.
 *
 * `shortCode` et `contact` font partie du même doc (cf. `docs/firebase.md`),
 * édités d'un coup depuis Settings → General.
 *
 * TODO(firestore): remplacer par
 *   `doc('/config/club').update(patch)` (admin-only, cf. firestore.rules).
 *   Garder un merge profond sur `address` / `contact` / `officialsConfig` /
 *   `duesConfig` pour ne pas écraser les champs non-touchés.
 */
export async function updateClubConfig(patch: ClubConfigPatch): Promise<void> {
  // TODO(firestore): replace with real /config/club update.
  if (patch.name !== undefined) STATE.config.name = patch.name
  if (patch.shortCode !== undefined) STATE.config.shortCode = patch.shortCode
  if (patch.logo !== undefined) STATE.config.logo = patch.logo
  if (patch.address !== undefined) STATE.config.address = patch.address
  if (patch.contact !== undefined) {
    STATE.config.contact = { ...STATE.config.contact, ...patch.contact }
  }
  if (patch.officialsConfig !== undefined) {
    STATE.config.officialsConfig = {
      ...STATE.config.officialsConfig,
      ...patch.officialsConfig,
    }
  }
  if (patch.duesConfig !== undefined) {
    STATE.config.duesConfig = { ...STATE.config.duesConfig, ...patch.duesConfig }
  }
  return delay(undefined)
}

// ---------------------------------------------------------------------------
// Public API — Subscription
// ---------------------------------------------------------------------------

/**
 * Lit l'info abonnement courante. Cette donnée vit côté control-plane
 * (`/registry/clients/{clientId}.subscription`) et le web app y accède via
 * une callable read-only sur le projet éditeur.
 *
 * TODO(firestore/control-plane): remplacer par
 *   `httpsCallable(functions, 'getClientSubscription')()` sur le projet
 *   éditeur. Le caller doit être authentifié sur le projet client (l'identité
 *   est résolue côté Function).
 */
export async function getSubscriptionInfo(): Promise<SubscriptionInfo> {
  // TODO(control-plane): replace with callable when /registry is wired.
  return delay(clone(STATE.subscription))
}

// ---------------------------------------------------------------------------
// Public API — Roles
// ---------------------------------------------------------------------------

/**
 * Liste tous les rôles (system + custom). Triés : system d'abord, puis
 * custom alphabétique.
 *
 * TODO(firestore): remplacer par
 *   `collection('/roles').orderBy('type').orderBy('name').get()`.
 */
export async function listRoles(): Promise<Role[]> {
  // TODO(firestore): replace when /roles is provisioned.
  return delay(clone(STATE.roles))
}

/**
 * Crée un rôle custom. Les rôles `system` ne sont jamais créables via UI.
 *
 * TODO(firestore): remplacer par
 *   `collection('/roles').add({ ...input, type: 'custom', createdAt: serverTimestamp() })`.
 */
export async function createRole(input: RoleInput): Promise<Role> {
  // TODO(firestore): replace when /roles is provisioned.
  const id = `custom-${Date.now()}-${Math.floor(Math.random() * 1000)}`
  const role: Role = {
    id,
    name: input.name,
    type: 'custom',
    color: input.color,
    createdAt: ts(new Date()),
  }
  STATE.roles.push(role)
  return delay(clone(role))
}

/**
 * Met à jour un rôle (custom uniquement — refusé sur system côté UI et côté
 * rules). On autorise name + color.
 *
 * TODO(firestore): remplacer par
 *   `doc('/roles/{id}').update({ name, color })` après check `type == 'custom'`.
 */
export async function updateRole(id: string, patch: RoleInput): Promise<void> {
  // TODO(firestore): replace when /roles is provisioned.
  const role = STATE.roles.find((r) => r.id === id)
  if (!role) throw new Error(`Rôle introuvable: ${id}`)
  if (role.type === 'system') throw new Error('Les rôles système ne sont pas éditables')
  role.name = patch.name
  role.color = patch.color
  return delay(undefined)
}

/**
 * Supprime un rôle custom. Refus côté UI + côté rules pour les `system`.
 *
 * TODO(firestore): remplacer par `doc('/roles/{id}').delete()` (admin-only).
 *   Penser à scanner les `/members.roles[]` qui référencent ce role pour
 *   décider du comportement (refus si used / cascade reset).
 */
export async function deleteRole(id: string): Promise<void> {
  // TODO(firestore): replace when /roles is provisioned.
  const idx = STATE.roles.findIndex((r) => r.id === id)
  if (idx === -1) throw new Error(`Rôle introuvable: ${id}`)
  if (STATE.roles[idx].type === 'system') {
    throw new Error('Les rôles système ne sont pas supprimables')
  }
  STATE.roles.splice(idx, 1)
  return delay(undefined)
}

// ---------------------------------------------------------------------------
// Public API — Closure periods
// ---------------------------------------------------------------------------

/**
 * Liste les closure periods (réutilisables cross-saisons). Triées par
 * `startDate` ascendante.
 *
 * TODO(firestore): remplacer par
 *   `collection('/closurePeriods').orderBy('startDate').get()`.
 */
export async function listClosurePeriods(): Promise<ClosurePeriod[]> {
  // TODO(firestore): replace when /closurePeriods is provisioned.
  return delay(clone(STATE.closurePeriods))
}

/**
 * Crée une closure period.
 *
 * TODO(firestore): remplacer par
 *   `collection('/closurePeriods').add({ ...input, startDate: Timestamp.fromDate(new Date(input.startDate)), endDate: ... , createdBy: auth.currentUser.uid })`.
 */
export async function createClosurePeriod(
  input: ClosurePeriodInput,
): Promise<ClosurePeriod> {
  // TODO(firestore): replace when /closurePeriods is provisioned.
  const id = `cp-${Date.now()}-${Math.floor(Math.random() * 1000)}`
  const period: ClosurePeriod = {
    id,
    name: input.name,
    startDate: ts(new Date(input.startDate)),
    endDate: ts(new Date(input.endDate)),
    type: input.type,
    createdBy: 'mock-uid-current',
  }
  STATE.closurePeriods.push(period)
  STATE.closurePeriods.sort((a, b) => a.startDate.seconds - b.startDate.seconds)
  return delay(clone(period))
}

/**
 * Supprime une closure period.
 *
 * TODO(firestore): remplacer par `doc('/closurePeriods/{id}').delete()`.
 *   Penser à invalider les saisons actives qui référencent cette period :
 *   `seasons where closurePeriodIds array-contains id` — au choix : refus
 *   ou cascade-uncancel des bookings cancellés pour cette period.
 */
export async function deleteClosurePeriod(id: string): Promise<void> {
  // TODO(firestore): replace when /closurePeriods is provisioned.
  const idx = STATE.closurePeriods.findIndex((p) => p.id === id)
  if (idx === -1) throw new Error(`Closure period introuvable: ${id}`)
  STATE.closurePeriods.splice(idx, 1)
  return delay(undefined)
}

// ---------------------------------------------------------------------------
// Public API — Admin team
// ---------------------------------------------------------------------------

/**
 * Liste les admins du club. Source :
 * - Firestore `/users` filtré par `roles array-contains 'admin'` — renvoie le
 *   rootAdmin (qui porte aussi `'admin'` dans `roles[]` par convention bootstrap)
 *   + tous les admins ajoutés par la suite.
 * - Callable `listRootAdminUids` (Admin SDK) pour résoudre le badge
 *   `isRootAdmin` sur chaque ligne : le claim vit côté Firebase Auth, pas dans
 *   Firestore, donc le client ne peut pas lire celui des autres users
 *   directement.
 *
 * Tri : rootAdmin d'abord, puis par date de création descendante.
 */
export async function listAdmins(): Promise<ClubAdmin[]> {
  const adminQuery = query(
    collection(db, 'users'),
    where('roles', 'array-contains', 'admin'),
  )

  const [snap, rootAdminResult] = await Promise.all([
    getDocs(adminQuery),
    listRootAdminUids().catch((err: unknown) => {
      // Si la callable n'est pas (encore) déployée ou refuse l'appelant, on
      // n'empêche pas l'affichage de la liste — on perd juste le badge
      // rootAdmin. Logué pour debug.
      console.warn('listRootAdminUids failed, falling back without claims:', err)
      return { uids: [] as string[] }
    }),
  ])

  const rootAdminSet = new Set(rootAdminResult.uids)

  const admins: ClubAdmin[] = snap.docs.map((d) => {
    const data = d.data() as UserData
    const createdAt = data.createdAt as unknown as FirestoreTimestamp | undefined
    return {
      id: d.id,
      displayName: data.displayName || data.email || d.id,
      email: data.email ?? '',
      isRootAdmin: rootAdminSet.has(d.id),
      addedAt: {
        seconds: createdAt?.seconds ?? 0,
        nanoseconds: createdAt?.nanoseconds ?? 0,
      },
    }
  })

  admins.sort((a, b) => {
    if (a.isRootAdmin !== b.isRootAdmin) return a.isRootAdmin ? -1 : 1
    return b.addedAt.seconds - a.addedAt.seconds
  })

  return admins
}

/**
 * Crée une invitation admin dans `/invitations`. L'invité doit ensuite
 * signer in avec OAuth (Google/Apple) avec cet email — le flow auth
 * (`users.repo.ts`) appellera `acceptInvitation` (callable) qui créera
 * `/users/{uid}` à partir de l'invitation. MVP : pas d'email envoyé, l'admin
 * partage l'info manuellement.
 *
 * Email lowercased à l'écriture pour matcher la lookup de `acceptInvitation`.
 */
export async function inviteAdmin(input: AdminInviteInput): Promise<Invitation> {
  const callerUid = auth.currentUser?.uid
  if (!callerUid) {
    throw new Error('Vous devez être connecté pour inviter un admin')
  }
  const invitedByName =
    auth.currentUser?.displayName ?? auth.currentUser?.email ?? callerUid

  const data: Omit<InvitationData, 'createdAt'> & {
    createdAt: ReturnType<typeof serverTimestamp>
  } = {
    email: input.email.trim().toLowerCase(),
    role: 'admin',
    invitedBy: callerUid,
    invitedByName,
    createdAt: serverTimestamp(),
  }
  const ref = await addDoc(collection(db, 'invitations'), data)
  return {
    id: ref.id,
    email: data.email,
    role: data.role,
    invitedBy: data.invitedBy,
    invitedByName,
    // Approximation : le serverTimestamp() vient d'être posé. Pour une vraie
    // valeur, il faudrait re-getDoc — pas nécessaire ici (l'UI affiche
    // "à l'instant" tant que `lastSaved` est actif).
    createdAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
  }
}

/**
 * Liste les invitations en attente (pas encore acceptées). Triées par date
 * de création descendante.
 */
export async function listInvitations(): Promise<Invitation[]> {
  const q = query(collection(db, 'invitations'), orderBy('createdAt', 'desc'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => {
    const data = d.data() as InvitationData
    const createdAt = data.createdAt as unknown as FirestoreTimestamp | undefined
    return {
      id: d.id,
      email: data.email,
      role: data.role,
      invitedBy: data.invitedBy,
      invitedByName: data.invitedByName,
      createdAt: {
        seconds: createdAt?.seconds ?? 0,
        nanoseconds: createdAt?.nanoseconds ?? 0,
      },
    }
  })
}

/**
 * Annule une invitation pending. L'invité ne pourra plus signer in via
 * `acceptInvitation` (qui retournera `not-found`).
 */
export async function cancelInvitation(id: string): Promise<void> {
  await deleteDoc(doc(db, 'invitations', id))
}

/**
 * Retire le rôle admin d'un user. v1 : stub mock — pas d'écriture côté repo.
 *
 * TODO(security): refus self-demote / last-admin via callable.
 *   - La règle Firestore admin-only sur `/users.roles` est insuffisante : il
 *     faut une callable qui (a) refuse si caller == target (sauf rootAdmin
 *     révoque un autre rootAdmin via flow séparé), (b) refuse si target est
 *     le dernier admin du club (count `where roles array-contains admin`).
 *   - Côté UI, on désactive aussi le bouton pour `isRootAdmin: true`.
 */
export async function removeAdmin(uid: string): Promise<void> {
  // TODO(actions/security): wire when /invitations + callable functions are ready.
  void uid
  return delay(undefined)
}

// ---------------------------------------------------------------------------
// Helpers re-exposed for caller convenience (typing only)
// ---------------------------------------------------------------------------

export type { OfficialsConfig, DuesConfig, ClubContact }
