import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type Unsubscribe,
  type UserCredential,
} from 'firebase/auth'
import {
  collection,
  doc,
  endAt,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAt,
} from 'firebase/firestore'
import type { User, UserData } from '@club-app/shared-types'
import { auth, db } from '@/services/firebase'
import { acceptInvitation } from '@/services/cloudFunctions'

const USERS = 'users'

/**
 * Projection minimaliste d'un /users/{uid} suffisante pour les pickers et
 * jointures simples (ex. dialog "Manage Guardians"). Évite de transporter
 * `roles`, `teamIds`, `memberId`, etc. quand on n'en a pas besoin.
 */
export interface UserMini {
  uid: string
  email: string
  displayName: string
  photoURL: string
}

/**
 * Levée quand un compte Firebase Auth valide signe in mais n'a pas de
 * doc `/users/{uid}` correspondant. Le club provisionne ses users en amont :
 * un compte Auth orphelin n'est pas autorisé.
 */
export class NotAuthorizedError extends Error {
  readonly code = 'auth/not-authorized-for-club'
  constructor() {
    super('No /users doc for the signed-in account.')
    this.name = 'NotAuthorizedError'
  }
}

/**
 * Vue neutre de l'état Firebase Auth, exposée aux couches du dessus
 * pour éviter de laisser fuiter les types du SDK hors du repository.
 */
export interface AuthSnapshot {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
  /** Custom claim per-project — bypass de toutes les rules. */
  rootAdmin: boolean
}

export function subscribeAuthState(
  callback: (snapshot: AuthSnapshot | null) => void,
): Unsubscribe {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      callback(null)
      return
    }
    const token = await user.getIdTokenResult()
    callback({
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      rootAdmin: token.claims.rootAdmin === true,
    })
  })
}

export async function getUserDoc(uid: string): Promise<User | null> {
  const snap = await getDoc(doc(db, USERS, uid))
  if (!snap.exists()) return null
  return { id: snap.id, ...(snap.data() as UserData) }
}

/**
 * Projection légère de /users/{uid} → `UserMini`. Retourne `null` si le doc
 * n'existe pas (orphan ou uid invalide). Les erreurs Firebase remontent
 * (pas de dégradation silencieuse ici : si le caller a besoin de l'identité
 * d'un user, l'absence est différente d'une erreur réseau).
 */
export async function getUserMini(uid: string): Promise<UserMini | null> {
  const snap = await getDoc(doc(db, USERS, uid))
  if (!snap.exists()) return null
  const data = snap.data() as Partial<UserData>
  return {
    uid: snap.id,
    email: data.email ?? '',
    displayName: data.displayName ?? '',
    photoURL: data.photoURL ?? '',
  }
}

/**
 * Recherche start-with sur le champ `email` de `/users`. Utilisé par les
 * pickers (ex. "Manage Guardians" → choisir un user par email). Retourne
 * au plus 10 résultats triés alphabétiquement.
 *
 * Implémentation Firestore : `orderBy('email')` + `startAt(q)` + `endAt(q + '')`.
 * Le caractère `` est la borne haute Unicode classique pour les
 * range queries lexico.
 *
 * `query` vide → liste les 10 premiers users (utile pour amorcer une UI
 * de picker sans saisie).
 */
export async function searchUsersByEmail(searchQuery: string): Promise<UserMini[]> {
  const needle = searchQuery.trim().toLowerCase()
  const base = query(collection(db, USERS), orderBy('email'), limit(10))
  const q = needle.length === 0
    ? base
    : query(
        collection(db, USERS),
        orderBy('email'),
        startAt(needle),
        endAt(`${needle}`),
        limit(10),
      )
  const snap = await getDocs(q)
  return snap.docs.map((d) => {
    const data = d.data() as Partial<UserData>
    return {
      uid: d.id,
      email: data.email ?? '',
      displayName: data.displayName ?? '',
      photoURL: data.photoURL ?? '',
    }
  })
}

export function signInWithEmail(email: string, password: string): Promise<void> {
  return signInWithEmailAndPassword(auth, email, password).then(() => undefined)
}

/**
 * Vérifie qu'un user Firebase Auth a un doc /users/{uid} de provisioning.
 *
 * Si absent : on tente d'abord `acceptInvitation` (callable). Cette callable
 * cherche une invitation pending par email (`/invitations`) et crée le doc
 * /users/{uid} à partir d'elle. Si pas d'invitation, on sign out et on throw
 * NotAuthorizedError (deny-orphan : pas d'auto-create sans invitation).
 */
async function ensureProvisioned(cred: UserCredential): Promise<void> {
  let userDoc = await getUserDoc(cred.user.uid)
  if (userDoc) return

  try {
    await acceptInvitation()
  } catch {
    // Pas d'invitation OU callable indispo → orphan rejected.
    await signOut(auth)
    throw new NotAuthorizedError()
  }

  // Refresh le token pour que les éventuels nouveaux claims soient visibles
  // immédiatement, et re-fetch le doc qu'on vient de créer.
  await cred.user.getIdToken(true)
  userDoc = await getUserDoc(cred.user.uid)
  if (!userDoc) {
    await signOut(auth)
    throw new NotAuthorizedError()
  }
}

export async function signInWithGoogle(): Promise<void> {
  const provider = new GoogleAuthProvider()
  const cred = await signInWithPopup(auth, provider)
  await ensureProvisioned(cred)
}

export function signOutUser(): Promise<void> {
  return signOut(auth)
}
