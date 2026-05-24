import { FirebaseError } from 'firebase/app'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Timestamp as FirestoreTimestamp,
} from 'firebase/firestore'
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from 'firebase/storage'
import { auth, db, storage } from '@/services/firebase'
import { listRootAdminUids } from '@/services/cloudFunctions'
import type {
  BankingInfo,
  ClosurePeriod,
  ClubConfig,
  ClubConfigData,
  ClubContact,
  DuesConfig,
  Invitation,
  InvitationData,
  OfficialsConfig,
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
    | 'banking'
    | 'officialsConfig'
    | 'duesConfig'
    | 'basketplan'
  >
>

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
  /**
   * Rôles `/users/{uid}.roles` (admin, coach, official, treasurer, parent…).
   * `admin` est toujours présent (listAdmins filtre dessus) mais on expose la
   * liste complète pour la gestion par checkboxes côté UI.
   */
  roles: string[]
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
    banking: null,
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
 * Lit le doc singleton `/config/club`. Fallback sur le mock si le doc n'existe
 * pas encore (projet vierge avant `runMigrations`) — l'écran Settings reste
 * affichable et l'admin peut amorcer la config.
 */
export async function getClubConfig(): Promise<ClubConfig> {
  try {
    const snap = await getDoc(doc(db, 'config', 'club'))
    if (snap.exists()) {
      return { id: snap.id, ...(snap.data() as Omit<ClubConfig, 'id'>) }
    }
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`getClubConfig failed [${code}]`, err)
    throw err
  }
  // Doc absent : fallback mock pour permettre l'amorçage UI sur projet neuf.
  return clone(STATE.config)
}

/**
 * Patch le doc singleton `/config/club`. Admin-only côté rules.
 *
 * Utilise `setDoc(..., { merge: true })` plutôt que `updateDoc` pour gérer
 * l'amorçage : sur un projet vierge, le doc `/config/club` peut ne pas
 * exister (pas créé par migration) — `updateDoc` planterait avec
 * `not-found`, tandis que `setDoc` upsert proprement. Le merge profond
 * Firestore préserve les sous-champs non-touchés (ex. un patch
 * `contact.email` n'écrase pas `contact.phone`).
 *
 * Si le doc n'existe pas encore, on seed d'abord la baseline complète
 * (mock defaults + `createdAt` server-side + `createdBy` = uid courant)
 * avant d'appliquer le patch, sinon le doc resterait amputé des champs
 * required (le caller `getClubConfig` lit ensuite un doc incomplet et
 * l'UI casse à `store.config.contact.email`).
 */
export async function updateClubConfig(patch: ClubConfigPatch): Promise<void> {
  if (Object.keys(patch).length === 0) return
  const ref = doc(db, 'config', 'club')
  try {
    const snap = await getDoc(ref)
    if (!snap.exists()) {
      const uid = auth.currentUser?.uid ?? 'unknown'
      const baseline: Omit<ClubConfigData, 'createdAt'> & { createdAt: unknown } = {
        name: STATE.config.name,
        shortCode: STATE.config.shortCode,
        logo: null,
        address: STATE.config.address,
        contact: { ...STATE.config.contact },
        // banking est `null` sur projet vierge — l'admin saisira l'IBAN
        // via Settings → Club info → Infos bancaires. Tant que ce champ
        // est `null`, les emails de demande de paiement omettent la
        // section "comment payer" (cf. shared-types/config.ts).
        banking: null,
        officialsConfig: { ...STATE.config.officialsConfig },
        duesConfig: { ...STATE.config.duesConfig },
        createdAt: serverTimestamp(),
        createdBy: uid,
      }
      await setDoc(ref, baseline)
    }
    await setDoc(ref, patch, { merge: true })
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`updateClubConfig failed [${code}]`, err)
    throw err
  }
}

// ---------------------------------------------------------------------------
// Public API — Club logo (Firebase Storage)
// ---------------------------------------------------------------------------

/**
 * Upload le logo du club dans Firebase Storage et retourne l'URL publique
 * de download. L'appelant doit ensuite appeler `updateClubConfig({ logo })`
 * pour persister cette URL dans `/config/club.logo`.
 *
 * Path : `club/logo/<timestamp>.<ext>`. Le timestamp évite la collision avec
 * d'éventuels résidus d'un précédent logo (Firebase ne garantit pas la
 * suppression atomique côté CDN — un nouveau path force le rafraîchissement
 * client).
 *
 * Validation côté UI (taille / type) — les rules Storage redoublent (`< 2MB`,
 * `image/*`) en garde-fou.
 */
export async function uploadClubLogo(file: File): Promise<string> {
  const ext = inferImageExt(file)
  const path = `club/logo/logo_${Date.now()}${ext}`
  const fileRef = storageRef(storage, path)
  try {
    await uploadBytes(fileRef, file, { contentType: file.type })
    return await getDownloadURL(fileRef)
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`uploadClubLogo failed [${code}]`, err)
    throw err
  }
}

/**
 * Supprime un fichier de logo dans Storage à partir de son URL de download.
 * Tolérant : `not-found` est ignoré (le fichier a peut-être déjà été nettoyé).
 *
 * L'appelant doit ensuite mettre à jour `/config/club.logo` à `null`.
 */
export async function deleteClubLogoByUrl(downloadUrl: string): Promise<void> {
  const path = pathFromDownloadUrl(downloadUrl)
  if (!path) return // URL externe ou format inattendu — on ne touche à rien.
  const fileRef = storageRef(storage, path)
  try {
    await deleteObject(fileRef)
  } catch (err) {
    if (err instanceof FirebaseError && err.code === 'storage/object-not-found') {
      return
    }
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`deleteClubLogoByUrl failed [${code}]`, err)
    throw err
  }
}

/** `image/png` → `.png`, fallback sur l'extension du nom de fichier. */
function inferImageExt(file: File): string {
  if (file.type === 'image/png') return '.png'
  if (file.type === 'image/jpeg') return '.jpg'
  if (file.type === 'image/svg+xml') return '.svg'
  if (file.type === 'image/webp') return '.webp'
  const lastDot = file.name.lastIndexOf('.')
  if (lastDot >= 0) return file.name.slice(lastDot).toLowerCase()
  return ''
}

/**
 * Extrait le path Storage (`club/logo/...`) à partir d'une download URL
 * Firebase. Format attendu :
 * `https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<encoded-path>?alt=...`
 * Renvoie `null` si l'URL ne matche pas (ex. logo hébergé ailleurs).
 */
function pathFromDownloadUrl(url: string): string | null {
  const match = /\/o\/([^?]+)/.exec(url)
  if (!match || !match[1]) return null
  return decodeURIComponent(match[1])
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
// Public API — Roles : déplacé vers `repositories/roles.repo.ts` (vraie
// collection Firestore `/roles`). Voir aussi docs/firebase.md (`/roles`).
// ---------------------------------------------------------------------------

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
      roles: Array.isArray(data.roles) ? [...data.roles] : [],
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

/**
 * Met à jour le tableau `/users/{uid}.roles`. Utilisé pour gérer les rôles
 * cumulables côté Admin team (admin / coach / official / treasurer).
 *
 * Sécurité : write `/users.roles` est admin-only côté rules — un caller non
 * admin recevra `permission-denied` (la callable côté serveur reste future
 * pour valider last-admin / self-demote ; voir `removeAdmin` TODO).
 *
 * Le tableau est **remplacé intégralement** ; les rôles métier portés par
 * `/members.roles` ne sont pas touchés (ils vivent dans une autre collection).
 *
 * @param uid     uid du user à modifier
 * @param roles   nouvelle liste complète des rôles app (allowlist guards)
 */
export async function updateUserRoles(uid: string, roles: string[]): Promise<void> {
  // Dédupe + ordre stable (cosmétique, et évite les doublons silencieux).
  const unique = Array.from(new Set(roles))
  try {
    await updateDoc(doc(db, 'users', uid), { roles: unique })
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`updateUserRoles failed [${code}]`, err)
    throw err
  }
}

// ---------------------------------------------------------------------------
// Helpers re-exposed for caller convenience (typing only)
// ---------------------------------------------------------------------------

export type { BankingInfo, OfficialsConfig, DuesConfig, ClubContact }
