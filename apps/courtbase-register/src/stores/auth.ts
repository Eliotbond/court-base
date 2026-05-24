import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { User } from '@club-app/shared-types'
import {
  getUserDoc,
  sendPasswordReset,
  signInWithEmail,
  signInWithGoogle as repoSignInWithGoogle,
  signOutUser,
  signUpWithEmail,
  subscribeAuthState,
  upsertUserProfile,
  type AuthSnapshot,
  type ProfileInput,
} from '@/repositories/users.repo'

/**
 * Source unique pour l'état d'authentification de l'app `courtbase-register`.
 *
 * Différences avec l'app web :
 * - **Pas de deny-orphan** : un compte Firebase Auth sans `/users/{uid}` est
 *   un état attendu — le router le redirigera vers `/profile`.
 * - `init()` est idempotent et résout dès la première notification de
 *   `onAuthStateChanged` (signé ou non), userDoc chargé.
 *
 * Contrainte timing : `signInWithPopup` (OAuth) résout AVANT que
 * `onAuthStateChanged` n'ait notifié le store. Les actions `signIn*` attendent
 * donc explicitement la prochaine résolution complète de l'état (authSnap +
 * userDoc fetchés) avant de rendre la main au caller — ça évite que
 * `redirectAfterAuth` parte avec un `hasProfile` stale (race condition →
 * redirection erronée vers /profile alors que le user a déjà un doc).
 */
export const useAuthStore = defineStore('auth', () => {
  const authSnap = ref<AuthSnapshot | null>(null)
  const userDoc = ref<User | null>(null)
  const loading = ref(false)
  const ready = ref(false)
  // True pendant un fetch userDoc en cours (sign-in OAuth notamment).
  // Le router guard l'attend avant de décider entre /home et /profile.
  const resolvingProfile = ref(false)

  let unsubscribe: (() => void) | null = null
  let readyResolve: (() => void) | null = null
  const readyPromise = new Promise<void>((resolve) => {
    readyResolve = resolve
  })

  // Promesse rotative qui résout à la prochaine notification complète
  // (`authSnap` ET `userDoc` mis à jour) de `onAuthStateChanged`. Renouvelée
  // après chaque résolution. Utilisée par les actions de sign-in pour attendre
  // que le state soit cohérent avant de rendre la main.
  let pendingResolvers: Array<() => void> = []
  function notifyAuthSettled() {
    const toResolve = pendingResolvers
    pendingResolvers = []
    for (const r of toResolve) r()
  }
  function waitForNextAuthSettled(): Promise<void> {
    return new Promise<void>((resolve) => {
      pendingResolvers.push(resolve)
    })
  }

  const isSignedIn = computed(() => authSnap.value !== null)
  const hasProfile = computed(() => userDoc.value !== null)

  function init(): Promise<void> {
    if (unsubscribe) return readyPromise
    unsubscribe = subscribeAuthState(async (snap) => {
      authSnap.value = snap
      if (snap) {
        resolvingProfile.value = true
        try {
          userDoc.value = await getUserDoc(snap.uid)
        } catch (err) {
          // Permission-denied ou autre erreur réseau : on log, on garde
          // userDoc null. Le router renverra alors vers /profile (cas légitime
          // si le doc n'existe pas) — mais on a au moins une trace côté
          // console pour debug.
          // eslint-disable-next-line no-console
          console.error('[auth] failed to fetch /users/{uid}', err)
          userDoc.value = null
        } finally {
          resolvingProfile.value = false
        }
      } else {
        userDoc.value = null
      }
      if (!ready.value) {
        ready.value = true
        readyResolve?.()
      }
      notifyAuthSettled()
    })
    return readyPromise
  }

  async function refreshUserDoc(): Promise<void> {
    if (!authSnap.value) {
      userDoc.value = null
      return
    }
    resolvingProfile.value = true
    try {
      userDoc.value = await getUserDoc(authSnap.value.uid)
    } finally {
      resolvingProfile.value = false
    }
  }

  /**
   * Helper interne : exécute une action de sign-in (email/oauth) puis attend
   * que `onAuthStateChanged` ait notifié le store ET que le userDoc associé
   * ait fini d'être fetché. Garantit qu'au retour de cette fonction,
   * `hasProfile` reflète l'état réel côté Firestore — pas de race.
   */
  async function runSignIn(action: () => Promise<void>): Promise<void> {
    loading.value = true
    const settled = waitForNextAuthSettled()
    try {
      await action()
      // Attente bornée pour éviter de bloquer indéfiniment si pour une raison
      // exotique `onAuthStateChanged` ne se déclenche pas (ex. l'auth state
      // courant est déjà identique). 5s est largement au-dessus du délai
      // observé en pratique (typiquement < 200ms).
      await Promise.race([
        settled,
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ])
    } finally {
      loading.value = false
    }
  }

  async function signIn(email: string, password: string): Promise<void> {
    await runSignIn(() => signInWithEmail(email, password))
  }

  async function signUp(email: string, password: string, displayName: string): Promise<void> {
    await runSignIn(() => signUpWithEmail(email, password, displayName))
  }

  async function signInWithGoogle(): Promise<void> {
    await runSignIn(() => repoSignInWithGoogle())
  }

  async function signOut(): Promise<void> {
    await signOutUser()
    userDoc.value = null
  }

  async function resetPassword(email: string): Promise<void> {
    await sendPasswordReset(email)
  }

  async function saveProfile(input: ProfileInput): Promise<void> {
    if (!authSnap.value) {
      throw new Error('Not signed in')
    }
    loading.value = true
    try {
      await upsertUserProfile(authSnap.value.uid, input)
      await refreshUserDoc()
    } finally {
      loading.value = false
    }
  }

  return {
    authSnap,
    userDoc,
    loading,
    ready,
    resolvingProfile,
    isSignedIn,
    hasProfile,
    init,
    signIn,
    signUp,
    signInWithGoogle,
    signOut,
    resetPassword,
    saveProfile,
    refreshUserDoc,
  }
})
