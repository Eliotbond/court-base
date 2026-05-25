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
/**
 * Accès aux fiches membres — admin, coach, et `secretary` (rôle staff). Le
 * secrétaire a besoin d'atteindre la fiche membre pour confirmer les licences
 * fédérales (callable `confirmLicense`). Cf. `apps/web/CLAUDE.md` § Licences.
 */
const MEMBERS_ACCESS: readonly string[] = ['admin', 'coach', 'secretary']
/**
 * Module Comptabilité — accès réservé au trésorier (`treasurer`). Le rootAdmin
 * est laissé passer globalement par le guard (court-circuit claim), pas besoin
 * de l'ajouter ici. L'admin standard est exclu (cf. docs/compta.md §1).
 */
const TREASURER_ONLY: readonly string[] = ['treasurer']
/**
 * Accès aux licences (page `/licenses` — onglets demandes + émises). Élargi
 * au-delà de l'admin pour permettre au trésorier (validation comptable) et
 * au secrétaire (suivi administratif) d'utiliser la vue centralisée sans
 * passer par les fiches membres une par une. Coach exclu : il a sa propre
 * vue dans courtbase-app (cf. `project_licenses_coach_launch`).
 */
const LICENSES_ACCESS: readonly string[] = ['admin', 'treasurer', 'secretary']

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
        // Page en construction — la vue Dashboard.vue existe mais reste hors prod
        // tant que le contenu n'est pas finalisé. Route conservée pour ne pas casser
        // la redirection par défaut `/` → `/dashboard`.
        path: 'dashboard',
        name: 'dashboard',
        component: placeholder,
        meta: { title: 'Dashboard', subtitle: "Vue d'ensemble du club", allowedRoles: ALL_AUTHED },
      },
      {
        path: 'members',
        name: 'members',
        component: () => import('@/views/Members.vue'),
        meta: { title: 'Membres', allowedRoles: MEMBERS_ACCESS },
      },
      {
        path: 'members/:id',
        name: 'member-detail',
        component: () => import('@/views/MemberDetail.vue'),
        meta: { title: 'Fiche membre', allowedRoles: MEMBERS_ACCESS },
      },
      {
        path: 'teams',
        name: 'teams',
        component: () => import('@/views/Teams.vue'),
        meta: { title: 'Équipes', allowedRoles: ADMIN_COACH },
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
        path: 'bookings',
        name: 'bookings',
        component: () => import('@/views/Bookings.vue'),
        meta: { title: 'Bookings', allowedRoles: ALL_AUTHED },
      },
      {
        path: 'registrations',
        name: 'registrations',
        component: () => import('@/views/Inscriptions.vue'),
        meta: { title: 'Inscriptions', allowedRoles: ADMIN_COACH },
      },
      {
        path: 'officials',
        name: 'officials',
        component: () => import('@/views/Officials.vue'),
        meta: { title: 'Officiels', allowedRoles: ADMIN_ONLY },
      },
      {
        path: 'cotisations',
        name: 'cotisations',
        component: () => import('@/views/Cotisations.vue'),
        meta: { title: 'Cotisations', allowedRoles: ADMIN_ONLY },
      },
      {
        path: 'licenses',
        name: 'licenses',
        component: () => import('@/views/Licenses.vue'),
        meta: { title: 'Licences', allowedRoles: LICENSES_ACCESS },
      },
      {
        path: 'license-requests',
        name: 'license-requests',
        component: () => import('@/views/licenses/LicenseRequests.vue'),
        meta: { title: 'Demandes de licence', allowedRoles: LICENSES_ACCESS },
      },
      {
        path: 'license-requests/:id',
        name: 'license-request-detail',
        component: () => import('@/views/licenses/LicenseRequestReview.vue'),
        meta: { title: 'Review demande de licence', allowedRoles: LICENSES_ACCESS },
      },
      {
        path: 'exceptions',
        name: 'exceptions',
        component: placeholder,
        meta: { title: 'Exceptions de paiement', allowedRoles: ADMIN_ONLY },
      },
      {
        // Page en construction — la vue Attendance.vue existe mais reste hors prod.
        path: 'attendance',
        name: 'attendance',
        component: placeholder,
        meta: { title: 'Présences', allowedRoles: ADMIN_COACH },
      },
      {
        path: 'matches',
        name: 'matches',
        component: () => import('@/views/Matches.vue'),
        meta: { title: 'Matchs', allowedRoles: ADMIN_COACH },
      },
      {
        path: 'court-history',
        name: 'court-history',
        component: placeholder,
        meta: { title: 'Historique des terrains', allowedRoles: ADMIN_ONLY },
      },
      {
        path: 'settings',
        component: () => import('@/components/layout/SettingsLayout.vue'),
        meta: { title: 'Settings', allowedRoles: ADMIN_ONLY },
        children: [
          { path: '', redirect: { name: 'settings-club' } },
          {
            path: 'club',
            name: 'settings-club',
            component: () => import('@/views/settings/Club.vue'),
            meta: { title: 'Infos du club', allowedRoles: ADMIN_ONLY },
          },
          {
            path: 'admin-team',
            name: 'settings-admin-team',
            component: () => import('@/views/settings/AdminTeam.vue'),
            meta: { title: 'Équipe admin', allowedRoles: ADMIN_ONLY },
          },
          {
            path: 'categories',
            name: 'settings-categories',
            component: () => import('@/views/settings/Categories.vue'),
            meta: { title: 'Catégories', allowedRoles: ADMIN_ONLY },
          },
          {
            path: 'tags',
            name: 'settings-tags',
            component: () => import('@/views/settings/Tags.vue'),
            meta: { title: 'Tags', allowedRoles: ADMIN_ONLY },
          },
          {
            path: 'cotisations',
            name: 'settings-cotisations',
            component: () => import('@/views/settings/Cotisations.vue'),
            meta: { title: 'Types de cotisation', allowedRoles: ADMIN_ONLY },
          },
          {
            path: 'roles',
            name: 'settings-roles',
            component: () => import('@/views/settings/Roles.vue'),
            meta: { title: 'Rôles membres', allowedRoles: ADMIN_ONLY },
          },
          {
            path: 'officials',
            name: 'settings-officials',
            component: () => import('@/views/settings/Officials.vue'),
            meta: { title: 'Officiels', allowedRoles: ADMIN_ONLY },
          },
          {
            path: 'match-types',
            name: 'settings-match-types',
            component: () => import('@/views/settings/MatchTypes.vue'),
            meta: { title: 'Types de match', allowedRoles: ADMIN_ONLY },
          },
          {
            path: 'closure-periods',
            name: 'settings-closure-periods',
            component: () => import('@/views/settings/ClosurePeriods.vue'),
            meta: { title: 'Périodes de fermeture', allowedRoles: ADMIN_ONLY },
          },
          {
            path: 'license-types',
            name: 'settings-license-types',
            component: () => import('@/views/settings/LicenseTypes.vue'),
            meta: { title: 'Types de licence', allowedRoles: ADMIN_ONLY },
          },
          {
            path: 'dues',
            name: 'settings-dues',
            component: () => import('@/views/settings/Dues.vue'),
            meta: { title: 'Configuration cotisations', allowedRoles: ADMIN_ONLY },
          },
          {
            path: 'integrations/basketplan',
            name: 'settings-integrations-basketplan',
            component: () => import('@/views/settings/IntegrationsBasketplan.vue'),
            meta: { title: 'Basketplan', allowedRoles: ADMIN_ONLY },
          },
        ],
      },
      // --- Module Comptabilité (treasurer + rootAdmin) -----------------------
      {
        path: 'comptabilite',
        name: 'accounting-home',
        component: () => import('@/views/accounting/AccountingHome.vue'),
        meta: { title: 'Comptabilité', allowedRoles: TREASURER_ONLY },
      },
      {
        path: 'comptabilite/comptes',
        name: 'accounting-accounts',
        component: () => import('@/views/accounting/Accounts.vue'),
        meta: { title: 'Plan comptable', allowedRoles: TREASURER_ONLY },
      },
      {
        path: 'comptabilite/credits',
        name: 'accounting-credits',
        component: () => import('@/views/accounting/Credits.vue'),
        meta: { title: 'Crédits', allowedRoles: TREASURER_ONLY },
      },
      {
        path: 'comptabilite/factures',
        name: 'accounting-invoices',
        component: () => import('@/views/accounting/Invoices.vue'),
        meta: { title: 'Factures', allowedRoles: TREASURER_ONLY },
      },
      {
        path: 'comptabilite/journal',
        name: 'accounting-journal',
        component: () => import('@/views/accounting/Journal.vue'),
        meta: { title: 'Journal', allowedRoles: TREASURER_ONLY },
      },
      {
        path: 'comptabilite/bilan',
        name: 'accounting-balance-sheet',
        component: () => import('@/views/accounting/Bilan.vue'),
        meta: { title: 'Bilan', allowedRoles: TREASURER_ONLY },
      },
      {
        path: 'comptabilite/resultat',
        name: 'accounting-income-statement',
        component: () => import('@/views/accounting/IncomeStatement.vue'),
        meta: { title: 'Compte de résultat', allowedRoles: TREASURER_ONLY },
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
