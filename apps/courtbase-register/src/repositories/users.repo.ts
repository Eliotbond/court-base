import {
  GoogleAuthProvider,
  OAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile as updateAuthProfile,
  type Unsubscribe,
} from 'firebase/auth'
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import type { User, UserAddress, UserData } from '@club-app/shared-types'
import { auth, db } from '@/services/firebase'

const USERS = 'users'

/**
 * État Auth exposé aux couches du dessus — découple le SDK Firebase.
 */
export interface AuthSnapshot {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
}

export function subscribeAuthState(
  callback: (snapshot: AuthSnapshot | null) => void,
): Unsubscribe {
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      callback(null)
      return
    }
    callback({
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
    })
  })
}

export async function getUserDoc(uid: string): Promise<User | null> {
  const snap = await getDoc(doc(db, USERS, uid))
  if (!snap.exists()) return null
  return { id: snap.id, ...(snap.data() as UserData) }
}

/**
 * Sign-in / sign-up email-password.
 *
 * Contrairement à l'app web (deny-orphan), on **autorise** ici les comptes
 * sans `/users/{uid}` — le router redirigera vers `/profile` pour compléter.
 */
export async function signInWithEmail(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth, email, password)
}

export async function signUpWithEmail(
  email: string,
  password: string,
  displayName: string,
): Promise<void> {
  const cred = await createUserWithEmailAndPassword(auth, email, password)
  if (displayName.trim()) {
    await updateAuthProfile(cred.user, { displayName: displayName.trim() })
  }
}

export function sendPasswordReset(email: string): Promise<void> {
  return sendPasswordResetEmail(auth, email)
}

export async function signInWithGoogle(): Promise<void> {
  const provider = new GoogleAuthProvider()
  await signInWithPopup(auth, provider)
}

export async function signInWithApple(): Promise<void> {
  const provider = new OAuthProvider('apple.com')
  provider.addScope('email')
  provider.addScope('name')
  await signInWithPopup(auth, provider)
}

export function signOutUser(): Promise<void> {
  return signOut(auth)
}

/**
 * Données saisies dans `ProfileSetup.vue` pour provisionner `/users/{uid}`.
 *
 * `roles: []` au départ — `'parent'` sera ajouté par la callable
 * `submitRegistration` la première fois que ce user soumet une inscription
 * "pour un enfant". Pas de rôle pour les self-registrations majeures.
 */
export interface ProfileInput {
  displayName: string
  email: string
  phone: string
  address: UserAddress
  photoURL: string
}

/**
 * Crée ou met à jour `/users/{uid}` à partir des infos de profil.
 * Idempotent : si le doc existe, fait un `merge` au lieu d'écraser.
 */
export async function upsertUserProfile(uid: string, input: ProfileInput): Promise<void> {
  const ref = doc(db, USERS, uid)
  const existing = await getDoc(ref)
  if (existing.exists()) {
    await updateDoc(ref, {
      displayName: input.displayName,
      email: input.email,
      phone: input.phone,
      address: input.address,
      photoURL: input.photoURL,
      profileCompletedAt: serverTimestamp(),
    })
    return
  }
  await setDoc(ref, {
    displayName: input.displayName,
    email: input.email,
    photoURL: input.photoURL,
    roles: [],
    memberId: null,
    teamIds: [],
    phone: input.phone,
    address: input.address,
    linkedMemberId: null,
    createdAt: serverTimestamp(),
    profileCompletedAt: serverTimestamp(),
  })
}
