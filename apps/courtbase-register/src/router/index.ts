import { watch } from 'vue'
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

/**
 * Routes de l'app `courtbase-register`.
 *
 * Guards :
 * - `meta.requiresAuth: false` → page publique (landing, signin). Si déjà
 *   signed-in, on redirige vers `/home` (ou `/profile` si pas encore complété).
 * - `meta.requiresAuth: true` + `meta.requiresProfile: false` → besoin d'être
 *   signed-in, peu importe si `/users/{uid}` existe (cas du ProfileSetup).
 * - `meta.requiresAuth: true` + `meta.requiresProfile: true` (défaut) →
 *   signed-in **et** `/users/{uid}` existe.
 */
declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    requiresProfile?: boolean
    wizardStep?: number
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'landing',
    component: () => import('@/views/Landing.vue'),
    meta: { requiresAuth: false },
  },
  {
    path: '/signin',
    name: 'signin',
    component: () => import('@/views/SignIn.vue'),
    meta: { requiresAuth: false },
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('@/views/ProfileSetup.vue'),
    meta: { requiresAuth: true, requiresProfile: false },
  },
  {
    path: '/home',
    name: 'home',
    component: () => import('@/views/Home.vue'),
    meta: { requiresAuth: true, requiresProfile: true },
  },
  // Wizard d'inscription (Phase C).
  {
    path: '/register',
    redirect: '/register/step-1',
  },
  {
    path: '/register/step-1',
    name: 'wiz-step-1',
    component: () => import('@/views/register/Step1Whoami.vue'),
    meta: { requiresAuth: true, requiresProfile: true, wizardStep: 1 },
  },
  {
    path: '/register/step-2',
    name: 'wiz-step-2',
    component: () => import('@/views/register/Step2Identity.vue'),
    meta: { requiresAuth: true, requiresProfile: true, wizardStep: 2 },
  },
  {
    path: '/register/step-3',
    name: 'wiz-step-3',
    component: () => import('@/views/register/Step3TeamPicker.vue'),
    meta: { requiresAuth: true, requiresProfile: true, wizardStep: 3 },
  },
  {
    path: '/register/step-4-open',
    name: 'wiz-step-4-open',
    component: () => import('@/views/register/Step4OpenHandbook.vue'),
    meta: { requiresAuth: true, requiresProfile: true, wizardStep: 4 },
  },
  {
    path: '/register/step-4-conditional',
    name: 'wiz-step-4-conditional',
    component: () => import('@/views/register/Step4ConditionalConditions.vue'),
    meta: { requiresAuth: true, requiresProfile: true, wizardStep: 4 },
  },
  {
    path: '/register/step-5',
    name: 'wiz-step-5',
    component: () => import('@/views/register/Step5Contact.vue'),
    meta: { requiresAuth: true, requiresProfile: true, wizardStep: 5 },
  },
  {
    path: '/register/step-6',
    name: 'wiz-step-6',
    component: () => import('@/views/register/Step6TransferLetter.vue'),
    meta: { requiresAuth: true, requiresProfile: true, wizardStep: 6 },
  },
  {
    path: '/register/step-7',
    name: 'wiz-step-7',
    component: () => import('@/views/register/Step7LicenseInfo.vue'),
    meta: { requiresAuth: true, requiresProfile: true, wizardStep: 7 },
  },
  {
    path: '/register/confirmation/:registrationId',
    name: 'wiz-done',
    component: () => import('@/views/register/Step8Confirmation.vue'),
    meta: { requiresAuth: true, requiresProfile: true, wizardStep: 8 },
  },
  // Paiement cotisation (Phase E) — instructions de virement bancaire.
  {
    path: '/payment/:dueId',
    name: 'payment-instructions',
    component: () => import('@/views/PaymentInstructions.vue'),
    meta: { requiresAuth: true, requiresProfile: true },
  },
  // Facture cotisation (Phase E) — document type facture, lecture seule,
  // accessible à tout moment quel que soit le statut de paiement.
  {
    path: '/facture/:dueId',
    name: 'facture',
    component: () => import('@/views/Facture.vue'),
    meta: { requiresAuth: true, requiresProfile: true },
  },
  // Liste de toutes les factures du parent — courantes ET passées (Phase E).
  {
    path: '/factures',
    name: 'factures',
    component: () => import('@/views/Factures.vue'),
    meta: { requiresAuth: true, requiresProfile: true },
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: { name: 'landing' },
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

/**
 * Attend que le store ait fini de résoudre `/users/{uid}` (fetch userDoc en
 * cours). Évite un guard stale qui redirigerait vers /profile alors que le
 * userDoc est en train d'être chargé après un sign-in OAuth.
 */
function waitForProfileResolution(auth: ReturnType<typeof useAuthStore>): Promise<void> {
  if (!auth.resolvingProfile) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const stop = watch(
      () => auth.resolvingProfile,
      (resolving) => {
        if (!resolving) {
          stop()
          resolve()
        }
      },
    )
  })
}

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await auth.init()
  await waitForProfileResolution(auth)

  const requiresAuth = to.meta.requiresAuth ?? true
  const requiresProfile = to.meta.requiresProfile ?? true

  // Routes publiques : si déjà signed-in, rediriger.
  if (!requiresAuth) {
    if (auth.isSignedIn) {
      return auth.hasProfile ? { name: 'home' } : { name: 'profile' }
    }
    return true
  }

  // Routes auth-only : besoin d'être signed-in.
  if (!auth.isSignedIn) {
    return { name: 'signin', query: { redirect: to.fullPath } }
  }

  // Routes profile-only : besoin d'avoir `/users/{uid}`.
  if (requiresProfile && !auth.hasProfile) {
    return { name: 'profile' }
  }

  // Cas spécial : un user qui a déjà un profil n'a rien à faire sur `/profile`.
  if (to.name === 'profile' && auth.hasProfile) {
    return { name: 'home' }
  }

  return true
})
