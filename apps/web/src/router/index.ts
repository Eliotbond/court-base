import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

/**
 * Routes — chaque route déclare `meta.allowedRoles` (allowlist).
 * Le guard global laisse passer si `rootAdmin: true` (claim) OU si
 * `user.roles ∩ meta.allowedRoles ≠ ∅`.
 *
 * Voir docs/frontend-desktop.md et docs/firebase.md.
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/Home.vue'),
    meta: { allowedRoles: ['admin', 'coach', 'official'] },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/auth/Login.vue'),
    meta: { allowedRoles: ['*'] }, // public
  },
  {
    path: '/forbidden',
    name: 'forbidden',
    component: () => import('@/views/Forbidden.vue'),
    meta: { allowedRoles: ['*'] },
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

// Guard d'allowlist — à implémenter quand l'auth store sera prêt.
router.beforeEach((to, _from, next) => {
  const allowed = to.meta.allowedRoles as string[] | undefined
  if (!allowed || allowed.includes('*')) {
    return next()
  }
  // TODO: brancher sur useAuthStore() :
  // - si rootAdmin (claim) → next()
  // - sinon, intersection user.roles ∩ allowed
  // - sinon, redirect '/login' ou '/forbidden'
  return next()
})
