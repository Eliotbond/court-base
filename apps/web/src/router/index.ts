import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

/**
 * Routes — chaque route déclare `meta.allowedRoles` (allowlist).
 * Le guard global laisse passer si `rootAdmin: true` (claim) OU si
 * `user.roles ∩ meta.allowedRoles ≠ ∅`. `'*'` = route publique.
 *
 * Voir docs/frontend-desktop.md et docs/firebase.md.
 */
const placeholder = () => import('@/views/PlaceholderView.vue')

const ADMIN_COACH: readonly string[] = ['admin', 'coach']
const ADMIN_ONLY: readonly string[] = ['admin']
const ALL_AUTHED: readonly string[] = ['admin', 'coach', 'official']

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/auth/Login.vue'),
    meta: { allowedRoles: ['*'] },
  },
  {
    path: '/forbidden',
    name: 'forbidden',
    component: () => import('@/views/Forbidden.vue'),
    meta: { allowedRoles: ['*'] },
  },
  {
    path: '/',
    component: () => import('@/components/layout/AppLayout.vue'),
    meta: { allowedRoles: ALL_AUTHED },
    children: [
      { path: '', redirect: { name: 'dashboard' } },
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('@/views/Dashboard.vue'),
        meta: { title: 'Dashboard', subtitle: "Vue d'ensemble du club", allowedRoles: ALL_AUTHED },
      },
      {
        path: 'members',
        name: 'members',
        component: () => import('@/views/Members.vue'),
        meta: { title: 'Members', allowedRoles: ADMIN_COACH },
      },
      {
        path: 'members/:id',
        name: 'member-detail',
        component: () => import('@/views/MemberDetail.vue'),
        meta: { title: 'Member detail', allowedRoles: ADMIN_COACH },
      },
      {
        path: 'teams',
        name: 'teams',
        component: () => import('@/views/Teams.vue'),
        meta: { title: 'Teams', allowedRoles: ADMIN_COACH },
      },
      {
        path: 'venues',
        name: 'venues',
        component: () => import('@/views/Venues.vue'),
        meta: { title: 'Venues & courts', allowedRoles: ADMIN_ONLY },
      },
      {
        path: 'seasons',
        name: 'seasons',
        component: () => import('@/views/Seasons.vue'),
        meta: { title: 'Seasons', allowedRoles: ADMIN_ONLY },
      },
      {
        path: 'seasons/new',
        name: 'season-new',
        component: () => import('@/views/SeasonNewWizard.vue'),
        meta: { title: 'Nouvelle saison', allowedRoles: ADMIN_ONLY },
      },
      {
        path: 'seasons/:id/activate',
        name: 'season-activate',
        component: () => import('@/views/SeasonActivate.vue'),
        meta: { title: 'Activer la saison', allowedRoles: ADMIN_ONLY },
      },
      {
        path: 'bookings',
        name: 'bookings',
        component: () => import('@/views/Bookings.vue'),
        meta: { title: 'Bookings', allowedRoles: ALL_AUTHED },
      },
      {
        path: 'officials',
        name: 'officials',
        component: () => import('@/views/Officials.vue'),
        meta: { title: 'Officials', allowedRoles: ADMIN_ONLY },
      },
      {
        path: 'dues',
        name: 'dues',
        component: () => import('@/views/Dues.vue'),
        meta: { title: 'Dues', allowedRoles: ADMIN_ONLY },
      },
      {
        path: 'licenses',
        name: 'licenses',
        component: placeholder,
        meta: { title: 'License requests', allowedRoles: ADMIN_ONLY },
      },
      {
        path: 'exceptions',
        name: 'exceptions',
        component: placeholder,
        meta: { title: 'Payment exceptions', allowedRoles: ADMIN_ONLY },
      },
      {
        path: 'attendance',
        name: 'attendance',
        component: () => import('@/views/Attendance.vue'),
        meta: { title: 'Attendance', allowedRoles: ADMIN_COACH },
      },
      {
        path: 'match-types',
        name: 'match-types',
        component: placeholder,
        meta: { title: 'Match types', allowedRoles: ADMIN_ONLY },
      },
      {
        path: 'court-history',
        name: 'court-history',
        component: placeholder,
        meta: { title: 'Court history', allowedRoles: ADMIN_ONLY },
      },
      {
        path: 'settings',
        name: 'settings',
        component: () => import('@/views/Settings.vue'),
        meta: { title: 'Settings', allowedRoles: ADMIN_ONLY },
      },
    ],
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await auth.init()

  const allowed = to.meta.allowedRoles as string[] | undefined
  const isPublic = !allowed || allowed.includes('*')

  if (isPublic) return true

  if (!auth.isSignedIn) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  if (auth.hasAccess(allowed)) return true

  return { name: 'forbidden' }
})
