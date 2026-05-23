import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { getMember, getSession } from '@/repositories/mock'
import {
  NotAuthorizedError,
  getUserDoc,
  sendPasswordReset,
  signInWithApple as repoSignInWithApple,
  signInWithEmail as repoSignInWithEmail,
  signInWithGoogle as repoSignInWithGoogle,
  signOutUser,
  signUpWithEmail as repoSignUpWithEmail,
  subscribeAuthState,
  tryAcceptInvitationOrSignOut,
  type AuthSnapshot,
  type UserDoc,
} from '@/repositories/users.repo'
import type { AppRole } from '@/types/roles'

/**
 * Store auth — Firebase Auth **réel** avec deny-orphan + fallback mock
 * pour les données métier non encore branchées (linkedMember, etc.).
 *
 * Cycle de vie :
 *   1. `init()` (router beforeEach) → subscribe à `onAuthStateChanged`.
 *   2. Pour chaque snapshot non-null, on tente `getUserDoc(uid)`.
 *      - Si trouvé → roles depuis Firestore.
 *      - Si null → tente `acceptInvitation` ; si échec → signOut +
 *        `lastError = NotAuthorizedError`.
 *   3. Le router lit `isSignedIn` + `hasProfile` pour décider du redirect.
 *
 * Mode hybride mock (transitoire — Phase 1 du roadmap) : tant que les
 * vraies repos Firestore (members/teams/matches) ne sont pas branchées,
 * `linkedMember` et les rôles **fallback** sur `MOCK_SESSION` pour ne pas
 * casser les vues. Le badge `<CbMockBadge />` rappelle le mode mock.
 * Quand on branchera tout, on retirera le fallback.
 */
export const useAuthStore = defineStore('auth', () => {
  const authSnap = ref<AuthSnapshot | null>(null)
  const userDoc = ref<UserDoc | null>(null)

  /** True pendant le fetch initial (boot) — bloque le router. */
  const ready = ref(false)
  /** True pendant un fetch userDoc en cours (sign-in OAuth notamment). */
  const resolvingProfile = ref(false)
  /** True pendant une action de sign-in / sign-up. */
  const loading = ref(false)
  /** Dernière erreur de sign-in (deny-orphan / wrong-password / etc.). */
  const lastError = ref<string | null>(null)

  // ─── Promise rotative pour `runSignIn` ──────────────────────────
  // Idem pattern courtbase-register : on attend que `onAuthStateChanged`
  // ait notifié ET que `getUserDoc` ait résolu avant de rendre la main.

  let unsubscribe: (() => void) | null = null
  let readyResolve: (() => void) | null = null
  const readyPromise = new Promise<void>((resolve) => {
    readyResolve = resolve
  })
  let pendingResolvers: Array<() => void> = []

  function notifyAuthSettled(): void {
    const toResolve = pendingResolvers
    pendingResolvers = []
    for (const r of toResolve) r()
  }

  function waitForNextAuthSettled(): Promise<void> {
    return new Promise<void>((resolve) => {
      pendingResolvers.push(resolve)
    })
  }

  // ─── Getters dérivés ─────────────────────────────────────────────

  const isSignedIn = computed(() => authSnap.value !== null)
  const hasProfile = computed(() => userDoc.value !== null)

  /** Identité affichée — priorité userDoc > authSnap > fallback mock. */
  const displayName = computed(() => {
    return (
      userDoc.value?.displayName ??
      authSnap.value?.displayName ??
      getSession().displayName
    )
  })
  const email = computed(() => {
    return userDoc.value?.email ?? authSnap.value?.email ?? getSession().email
  })
  /** UID Firebase réel quand signed-in, sinon UID mock pour les repos mock. */
  const uid = computed(() => authSnap.value?.uid ?? getSession().uid)

  /**
   * Rôles du caller. Source : `/users/{uid}.roles` quand le doc existe,
   * sinon fallback sur `MOCK_SESSION.roles` (mode dev — permet de
   * traverser toutes les vues sans branche backend complète).
   */
  const roles = computed<AppRole[]>(() => {
    if (userDoc.value?.roles && userDoc.value.roles.length > 0) {
      return userDoc.value.roles
    }
    return getSession().roles
  })
  const isCoach = computed(() => roles.value.includes('coach'))
  const isOfficial = computed(() => roles.value.includes('official'))
  const isAdmin = computed(() => roles.value.includes('admin'))

  /**
   * Member lié — fallback mock pour l'instant (repos members pas branchées).
   * Quand on branchera Firestore, on ajoutera `linkedMemberId = userDoc.memberId`
   * et un fetch `/members/{id}`.
   */
  const linkedMember = computed(() => {
    // Quand on aura un vrai backend : `userDoc.value?.memberId ? getMemberReal(...) : null`
    const sessionMock = getSession()
    return sessionMock.linkedMemberId ? getMember(sessionMock.linkedMemberId) : null
  })

  const isMemberInactive = computed(() => linkedMember.value?.active === false)
  const officialLevel = computed(() => linkedMember.value?.officialLevel ?? null)
  const hasActiveOfficialLicense = computed(() => linkedMember.value?.officialLicense != null)

  /** Session "façade" pour compat avec les vues qui lisent `auth.session.xxx`. */
  const session = computed(() => ({
    uid: uid.value,
    displayName: displayName.value,
    email: email.value,
    phone: getSession().phone, // pas encore dans userDoc — fallback
    roles: roles.value,
    linkedMemberId: getSession().linkedMemberId,
    profileCompleted: hasProfile.value || getSession().profileCompleted,
  }))

  // ─── Init (router beforeEach) ────────────────────────────────────

  function init(): Promise<void> {
    if (unsubscribe) return readyPromise
    unsubscribe = subscribeAuthState(async (snap) => {
      authSnap.value = snap
      if (!snap) {
        userDoc.value = null
        if (!ready.value) {
          ready.value = true
          readyResolve?.()
        }
        notifyAuthSettled()
        return
      }

      // Snapshot signed-in — résoudre le userDoc.
      resolvingProfile.value = true
      try {
        let doc = await getUserDoc(snap.uid)
        if (!doc) {
          // Deny-orphan : tenter `acceptInvitation`.
          try {
            doc = await tryAcceptInvitationOrSignOut()
          } catch (err) {
            if (err instanceof NotAuthorizedError) {
              lastError.value = err.message
              // signOut déjà fait par le helper — `authSnap` repassera à null
              // sur la prochaine notification.
              return
            }
            throw err
          }
        }
        userDoc.value = doc
        lastError.value = null
      } catch (err) {
        console.error('[auth] failed to resolve user', err)
        userDoc.value = null
      } finally {
        resolvingProfile.value = false
        if (!ready.value) {
          ready.value = true
          readyResolve?.()
        }
        notifyAuthSettled()
      }
    })
    return readyPromise
  }

  // ─── Actions ──────────────────────────────────────────────────────

  async function runSignIn(action: () => Promise<void>): Promise<void> {
    loading.value = true
    lastError.value = null
    const settled = waitForNextAuthSettled()
    try {
      await action()
      // Attente bornée pour éviter de bloquer indéfiniment.
      await Promise.race([
        settled,
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ])
    } finally {
      loading.value = false
    }
  }

  async function signInWithEmailPassword(emailValue: string, passwordValue: string): Promise<void> {
    try {
      await runSignIn(() => repoSignInWithEmail(emailValue, passwordValue))
    } catch (err) {
      lastError.value = mapFirebaseAuthError(err)
      throw err
    }
  }

  async function signUpWithEmailPassword(
    emailValue: string,
    passwordValue: string,
    displayNameValue: string,
  ): Promise<void> {
    try {
      await runSignIn(() => repoSignUpWithEmail(emailValue, passwordValue, displayNameValue))
    } catch (err) {
      lastError.value = mapFirebaseAuthError(err)
      throw err
    }
  }

  async function signInWithGoogle(): Promise<void> {
    try {
      await runSignIn(() => repoSignInWithGoogle())
    } catch (err) {
      lastError.value = mapFirebaseAuthError(err)
      throw err
    }
  }

  async function signInWithApple(): Promise<void> {
    try {
      await runSignIn(() => repoSignInWithApple())
    } catch (err) {
      lastError.value = mapFirebaseAuthError(err)
      throw err
    }
  }

  async function requestPasswordReset(emailValue: string): Promise<void> {
    try {
      await sendPasswordReset(emailValue)
    } catch (err) {
      lastError.value = mapFirebaseAuthError(err)
      throw err
    }
  }

  async function signOut(): Promise<void> {
    await signOutUser()
  }

  function dismissError(): void {
    lastError.value = null
  }

  /** Override des rôles à des fins de dev. À NE PAS APPELER en prod. */
  function setRoles(_next: AppRole[]): void {
    // No-op : les rôles viennent du userDoc Firestore.
    // Conservé pour compat avec les anciennes vues qui appelaient setRoles.
  }

  return {
    // state
    authSnap,
    userDoc,
    session,
    linkedMember,
    ready,
    resolvingProfile,
    loading,
    lastError,
    // getters
    isSignedIn,
    hasProfile,
    isMemberInactive,
    roles,
    isCoach,
    isOfficial,
    isAdmin,
    displayName,
    email,
    uid,
    officialLevel,
    hasActiveOfficialLicense,
    // actions
    init,
    signInWithEmailPassword,
    signUpWithEmailPassword,
    signInWithGoogle,
    signInWithApple,
    requestPasswordReset,
    signOut,
    dismissError,
    setRoles,
  }
})

/**
 * Convertit un `FirebaseError` (ou autre) en message FR pour l'UI.
 * Cf. https://firebase.google.com/docs/auth/admin/errors
 */
function mapFirebaseAuthError(err: unknown): string {
  if (err instanceof NotAuthorizedError) {
    return 'Compte non autorisé. Demandez à un admin de votre club de vous inviter.'
  }
  const code = (err as { code?: string } | null)?.code ?? ''
  switch (code) {
    case 'auth/invalid-email':
      return "L'adresse email est invalide."
    case 'auth/user-disabled':
      return 'Ce compte a été désactivé.'
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Email ou mot de passe incorrect.'
    case 'auth/email-already-in-use':
      return 'Cet email est déjà utilisé.'
    case 'auth/weak-password':
      return 'Mot de passe trop faible (minimum 6 caractères).'
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return ''
    case 'auth/popup-blocked':
      return "La fenêtre de connexion a été bloquée par le navigateur. Autorisez les pop-ups et réessayez."
    case 'auth/network-request-failed':
      return 'Problème de connexion réseau. Réessayez.'
    default:
      return code ? `Erreur de connexion (${code}).` : 'Erreur de connexion. Réessayez.'
  }
}
