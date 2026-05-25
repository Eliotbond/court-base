import { watch } from 'vue'
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

import { useAuthStore } from '@/stores/auth'
import { useClubStore } from '@/stores/club'
import { isAllowed } from './allowlist'

/**
 * Router complet de `courtbase-app` — 24 routes nommées couvrant le brief
 * design (C1-C6 + CO1-CO10 + O1-O4 + A1-A4).
 *
 * Les vues correspondantes sont implémentées progressivement (cf. roadmap
 * `docs/courtbase-app.md`). Tant qu'une vue n'existe pas, le lazy import
 * 404 — c'est attendu.
 *
 * Guards mock — utilisent le store auth basé sur `MOCK_SESSION` :
 * 1. Si `requiresAuth: true` (défaut) et pas signed-in → redirect `sign-in`.
 * 2. Si `requiresProfile: true` (défaut) et profil incomplet → `profile-setup`.
 * 3. Si membre lié inactif → blocker `member-inactive`.
 * 4. Allowlist par rôle : la route doit être autorisée par au moins un rôle
 *    du caller, sauf `publicWithinAuth: true`.
 */
declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    requiresProfile?: boolean
    /** Bypass de l'allowlist par rôle (profil, notifications, design system). */
    publicWithinAuth?: boolean
  }
}

const routes: RouteRecordRaw[] = [
  // ─── Pages neutres ───────────────────────────────────────────
  {
    path: '/sign-in',
    name: 'sign-in',
    component: () => import('@/views/SignIn.vue'),
    meta: { requiresAuth: false },
  },
  {
    path: '/profile-setup',
    name: 'profile-setup',
    component: () => import('@/views/ProfileSetup.vue'),
    meta: { requiresAuth: true, requiresProfile: false, publicWithinAuth: true },
  },
  {
    path: '/member-inactive',
    name: 'member-inactive',
    component: () => import('@/views/MemberInactiveBlocker.vue'),
    meta: { requiresAuth: true, publicWithinAuth: true },
  },

  // ─── Showcase design system (toujours accessible) ────────────
  {
    path: '/_design',
    name: 'design-system',
    component: () => import('@/views/DesignSystem.vue'),
    meta: { requiresAuth: false },
  },

  // ─── Common (C3, C4, C5) ─────────────────────────────────────
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/Home.vue'),
  },
  {
    // Alpha 2026-05-25 : la route est conservée pour ne pas casser les
    // lazy imports / liens internes, mais elle n'est listée dans **aucun**
    // rôle de `allowlist.ts`. Le `publicWithinAuth` a été retiré pour
    // qu'elle retombe sous l'allowlist standard → redirige vers `home`
    // pour tous les rôles tant que les notifs ne sont pas branchées
    // (FCM web push prévu en Phase 5).
    path: '/notifications',
    name: 'notifications',
    component: () => import('@/views/common/Notifications.vue'),
  },
  {
    path: '/profile',
    name: 'profile-settings',
    component: () => import('@/views/common/ProfileSettings.vue'),
    meta: { publicWithinAuth: true },
  },
  {
    path: '/my-calendar',
    name: 'my-calendar',
    component: () => import('@/views/common/MyCalendar.vue'),
  },

  // ─── Coach (CO1-CO10) ────────────────────────────────────────
  {
    path: '/teams',
    name: 'team',
    component: () => import('@/views/coach/MyTeams.vue'),
  },
  {
    path: '/teams/:teamId',
    name: 'team-roster',
    component: () => import('@/views/coach/TeamRoster.vue'),
  },
  {
    path: '/members/:memberId',
    name: 'member',
    component: () => import('@/views/coach/MemberDetail.vue'),
  },
  {
    path: '/members/:memberId/edit',
    name: 'member-edit',
    component: () => import('@/views/coach/MemberForm.vue'),
    props: (route) => ({ memberId: route.params['memberId'] }),
  },
  {
    path: '/members/new',
    name: 'member-new',
    component: () => import('@/views/coach/MemberForm.vue'),
    props: () => ({ memberId: null }),
  },
  {
    path: '/teams/:teamId/planning',
    name: 'planning',
    component: () => import('@/views/coach/TeamPlanning.vue'),
  },
  {
    path: '/agenda',
    name: 'agenda',
    component: () => import('@/views/coach/Agenda.vue'),
  },
  {
    path: '/bookings/:bookingId/attendance',
    name: 'training-attendance',
    component: () => import('@/views/coach/TrainingAttendance.vue'),
  },
  {
    path: '/teams/:teamId/away-match/new',
    name: 'away-match-create',
    component: () => import('@/views/coach/AwayMatchCreate.vue'),
  },
  {
    path: '/registrations',
    name: 'registrations',
    component: () => import('@/views/coach/Registrations.vue'),
  },
  {
    path: '/registrations/:id',
    name: 'registration-detail',
    component: () => import('@/views/coach/RegistrationDetail.vue'),
  },
  {
    path: '/matches/:id/move-request',
    name: 'match-request-create',
    component: () => import('@/views/coach/MatchMoveRequest.vue'),
  },
  {
    path: '/license-reviews',
    name: 'license-reviews',
    component: () => import('@/views/coach/LicenseRequestsToReview.vue'),
  },
  {
    path: '/license-reviews/:requestId',
    name: 'license-request-review',
    component: () => import('@/views/coach/LicenseRequestReview.vue'),
  },

  // ─── Officiel (O1-O4) ────────────────────────────────────────
  {
    path: '/matches/open',
    name: 'matches-open',
    component: () => import('@/views/official/OpenMatches.vue'),
  },
  {
    path: '/assignments',
    name: 'my-assignments',
    component: () => import('@/views/official/MyAssignments.vue'),
  },
  {
    path: '/matches/:id',
    name: 'match-detail',
    component: () => import('@/views/official/MatchDetail.vue'),
  },

  // ─── Admin (A1-A4) ───────────────────────────────────────────
  {
    path: '/staffing',
    name: 'staffing',
    component: () => import('@/views/admin/Staffing.vue'),
  },
  {
    path: '/staffing/:matchId',
    name: 'staffing-detail',
    component: () => import('@/views/admin/StaffingDetail.vue'),
  },
  {
    path: '/requests',
    name: 'requests',
    component: () => import('@/views/admin/Requests.vue'),
  },
  {
    path: '/requests/:id',
    name: 'request-detail',
    component: () => import('@/views/admin/RequestDetail.vue'),
  },
  {
    path: '/broadcast',
    name: 'broadcast',
    component: () => import('@/views/admin/Broadcast.vue'),
  },

  // ─── 404 ─────────────────────────────────────────────────────
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFound.vue'),
    meta: { requiresAuth: false },
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

/**
 * Attend que le store ait fini de résoudre `/users/{uid}` après un OAuth.
 * Évite un guard stale qui redirigerait vers sign-in alors que le userDoc
 * est en cours de chargement.
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
  const publicWithinAuth = to.meta.publicWithinAuth ?? false

  // 1. Routes publiques : si déjà signed-in (et hasProfile), rediriger vers /.
  if (!requiresAuth) {
    if (to.name === 'sign-in' && auth.isSignedIn && auth.hasProfile) {
      return { path: '/' }
    }
    return true
  }

  // 2. Pas signed-in → sign-in.
  if (!auth.isSignedIn) {
    return { name: 'sign-in', query: { redirect: to.fullPath } }
  }

  // 3. Profil incomplet → setup.
  if (requiresProfile && !auth.hasProfile) {
    return { name: 'profile-setup' }
  }

  // Branding du shell — chargement fire-and-forget de `/config/club` + saison
  // active dès qu'on a un user signed-in avec profil. Idempotent (no-op
  // après le premier appel). Pas d'`await` : on ne bloque pas le routing —
  // les computed du sidebar/header se mettront à jour quand le store résout.
  void useClubStore().load()

  // 4. Membre lié inactif → blocker (sauf si on est déjà dessus).
  if (auth.isMemberInactive && to.name !== 'member-inactive') {
    return { name: 'member-inactive' }
  }

  // 5. Allowlist par rôle (skip pour routes neutres).
  if (publicWithinAuth) return true

  const routeName = typeof to.name === 'string' ? to.name : ''
  // Allowlist : on utilise les rôles **effectifs** (strict + dérivés des
  // licences actives) — cohérent avec ce que la sidebar / tab bar affichent
  // via `isCoach` / `isOfficial`. Sans ça : section officiel visible mais
  // tous les liens refoulés vers home si `roles` strict ne contient pas
  // `'official'`. Les Firestore Rules restent l'autorité sur les écritures.
  if (routeName && !isAllowed(routeName, auth.effectiveRoles)) {
    return { name: 'home' }
  }

  return true
})
