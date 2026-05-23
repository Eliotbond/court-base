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
import { doc, getDoc, type DocumentData } from 'firebase/firestore'
import { FirebaseError } from 'firebase/app'

import { auth, db } from '@/services/firebase'
import { acceptInvitation } from '@/services/cloudFunctions'
import type { AppRole } from '@/types/roles'

/**
 * Repository auth pour `courtbase-app`.
 *
 * Pattern **deny-orphan** (comme `apps/web`, contrairement à `courtbase-register`) :
 *   - Un user signed-in OAuth sans `/users/{uid}` tente automatiquement
 *     `acceptInvitation` (callable Admin SDK).
 *   - Si une invitation pending matche son email → doc `/users/{uid}` créé
 *     serveur-side avec les rôles de l'invitation → forceRefresh du token,
 *     retour au flow normal.
 *   - Sinon → `signOutUser()` + throw `NotAuthorizedError` → la UI affiche
 *     l'erreur "Compte non autorisé".
 *
 * Cf. `docs/main.md` § "Admin invitation flow".
 */

const USERS = 'users'

/**
 * Erreur dédiée pour le cas deny-orphan — permet au store / à la vue de
 * la distinguer d'une erreur réseau ou d'une erreur Firebase classique.
 */
export class NotAuthorizedError extends Error {
  constructor(message = 'Compte non autorisé') {
    super(message)
    this.name = 'NotAuthorizedError'
  }
}

/**
 * État Auth exposé aux couches du dessus — découple le SDK Firebase.
 */
export interface AuthSnapshot {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
}

/**
 * Doc `/users/{uid}` — sous-ensemble utilisé par cette app. Étendu via
 * `@club-app/shared-types` quand on aura plus de besoins.
 */
export interface UserDoc {
  id: string
  email: string | null
  displayName: string | null
  photoURL: string | null
  roles: AppRole[]
  memberId?: string | null
  profileCompletedAt?: unknown
  phone?: string | null
  address?: unknown
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

export async function getUserDoc(uid: string): Promise<UserDoc | null> {
  try {
    const snap = await getDoc(doc(db, USERS, uid))
    if (!snap.exists()) return null
    const data = snap.data() as DocumentData
    return {
      id: snap.id,
      email: (data['email'] as string | null) ?? null,
      displayName: (data['displayName'] as string | null) ?? null,
      photoURL: (data['photoURL'] as string | null) ?? null,
      roles: Array.isArray(data['roles']) ? (data['roles'] as AppRole[]) : [],
      memberId: (data['memberId'] as string | null) ?? null,
      profileCompletedAt: data['profileCompletedAt'],
      phone: (data['phone'] as string | null) ?? null,
      address: data['address'],
    }
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[users.repo] getUserDoc failed [${code}]`, err)
    return null
  }
}

// ─── Sign-in actions ─────────────────────────────────────────────

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

// ─── Deny-orphan resolver ────────────────────────────────────────

/**
 * Résout la situation d'un user signed-in sans `/users/{uid}` :
 *  1. Tente `acceptInvitation` callable côté serveur.
 *  2. Si OK → force-refresh du token + recharge userDoc.
 *  3. Si callable throw `not-found` (ou n'importe quel échec) → signOut +
 *     throw `NotAuthorizedError`.
 *
 * À appeler **après** que `getUserDoc(uid)` a retourné `null` ET que
 * l'authSnap reste valide.
 */
export async function tryAcceptInvitationOrSignOut(): Promise<UserDoc> {
  try {
    await acceptInvitation()
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.warn(`[users.repo] acceptInvitation rejected [${code}] — signing out`, err)
    await signOutUser()
    throw new NotAuthorizedError()
  }

  // Force-refresh du token côté Auth pour récupérer les claims éventuels
  // posés par la callable (ex: rootAdmin). Puis on recharge le doc.
  const user = auth.currentUser
  if (!user) {
    throw new NotAuthorizedError('Session perdue après acceptInvitation')
  }
  await user.getIdToken(true)
  const doc = await getUserDoc(user.uid)
  if (!doc) {
    // Cas exotique : la callable a réussi mais le doc n'est pas lisible.
    await signOutUser()
    throw new NotAuthorizedError('Profil introuvable après acceptInvitation')
  }
  return doc
}
