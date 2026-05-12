import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { User } from '@club-app/shared-types'
import {
  getUserDoc,
  signInWithApple as repoSignInWithApple,
  signInWithEmail,
  signInWithGoogle as repoSignInWithGoogle,
  signOutUser,
  subscribeAuthState,
  type AuthSnapshot,
} from '@/repositories/users.repo'

/**
 * Source unique pour l'état d'authentification.
 * - `authSnap` : info Firebase Auth + claim `rootAdmin`.
 * - `userDoc`  : mirror /users/{uid} (rôles, memberId, teamIds).
 *
 * `init()` est idempotent et renvoie une Promise résolue dès la première
 * notification de `onAuthStateChanged` (signé ou non). Le guard router
 * l'await pour ne jamais router avant que l'état initial soit connu.
 */
export const useAuthStore = defineStore('auth', () => {
  const authSnap = ref<AuthSnapshot | null>(null)
  const userDoc = ref<User | null>(null)
  const loading = ref(false)
  const ready = ref(false)

  let unsubscribe: (() => void) | null = null
  let readyResolve: (() => void) | null = null
  const readyPromise = new Promise<void>((resolve) => {
    readyResolve = resolve
  })

  const isSignedIn = computed(() => authSnap.value !== null)
  const rootAdmin = computed(() => authSnap.value?.rootAdmin ?? false)
  const roles = computed<string[]>(() => userDoc.value?.roles ?? [])

  function hasAccess(allowed: readonly string[] | undefined): boolean {
    if (!allowed || allowed.length === 0 || allowed.includes('*')) return true
    if (rootAdmin.value) return true
    if (!isSignedIn.value) return false
    return roles.value.some((r) => allowed.includes(r))
  }

  function init(): Promise<void> {
    if (unsubscribe) return readyPromise
    unsubscribe = subscribeAuthState(async (snap) => {
      authSnap.value = snap
      userDoc.value = snap ? await getUserDoc(snap.uid) : null
      if (!ready.value) {
        ready.value = true
        readyResolve?.()
      }
    })
    return readyPromise
  }

  async function signIn(email: string, password: string): Promise<void> {
    loading.value = true
    try {
      await signInWithEmail(email, password)
    } finally {
      loading.value = false
    }
  }

  async function signInWithGoogle(): Promise<void> {
    loading.value = true
    try {
      await repoSignInWithGoogle()
    } finally {
      loading.value = false
    }
  }

  async function signInWithApple(): Promise<void> {
    loading.value = true
    try {
      await repoSignInWithApple()
    } finally {
      loading.value = false
    }
  }

  async function signOut(): Promise<void> {
    await signOutUser()
  }

  return {
    authSnap,
    userDoc,
    loading,
    ready,
    isSignedIn,
    rootAdmin,
    roles,
    hasAccess,
    init,
    signIn,
    signInWithGoogle,
    signInWithApple,
    signOut,
  }
})
