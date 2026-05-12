import {
  GoogleAuthProvider,
  OAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type Unsubscribe,
  type UserCredential,
} from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import type { User, UserData } from '@club-app/shared-types'
import { auth, db } from '@/services/firebase'

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
  const snap = await getDoc(doc(db, 'users', uid))
  if (!snap.exists()) return null
  return { id: snap.id, ...(snap.data() as UserData) }
}

export function signInWithEmail(email: string, password: string): Promise<void> {
  return signInWithEmailAndPassword(auth, email, password).then(() => undefined)
}

/**
 * Vérifie qu'un user Firebase Auth a un doc /users/{uid} de provisioning.
 * Sinon : sign out + throw NotAuthorizedError (pour ne pas laisser un compte
 * Auth orphelin attaché au projet).
 */
async function ensureProvisioned(cred: UserCredential): Promise<void> {
  const userDoc = await getUserDoc(cred.user.uid)
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

export async function signInWithApple(): Promise<void> {
  const provider = new OAuthProvider('apple.com')
  provider.addScope('email')
  provider.addScope('name')
  const cred = await signInWithPopup(auth, provider)
  await ensureProvisioned(cred)
}

export function signOutUser(): Promise<void> {
  return signOut(auth)
}
