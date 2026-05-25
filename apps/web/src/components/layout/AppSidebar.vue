<script setup lang="ts">
import {
  LayoutDashboard,
  Users,
  UsersRound,
  MapPin,
  CalendarRange,
  Calendar,
  Banknote,
  BadgeCheck,
  CircleHelp,
  ClipboardCheck,
  ClipboardList,
  Trophy,
  History,
  Settings,
  Dribbble,
  Wallet,
  BookOpen,
  PlusCircle,
  FileText,
  ScrollText,
  Scale,
  Calculator,
  ShieldCheck,
} from 'lucide-vue-next'
import { computed, onMounted, type Component } from 'vue'
import Tag from 'primevue/tag'
import Pill from '@/components/ui/Pill.vue'
import { useMembersStore } from '@/stores/members'
import { useSettingsStore } from '@/stores/settings'
import { useAuthStore } from '@/stores/auth'
import { useCotisationsStore } from '@/stores/cotisations'
import { useLicenseRequestsStore } from '@/stores/licenseRequests'

type NavItem = {
  to: string
  label: string
  icon: Component
  badge?: { text: string; variant: 'rose' | 'amber' | 'slate' }
  count?: string
  /**
   * `dev: true` ajoute un Tag PrimeVue `<Tag severity="warning">dev</Tag>`
   * à côté du label. Sert à marquer les sections pas encore prêtes pour la
   * mise en prod (Licences, Comptabilité, …) — UI déjà visible mais workflow
   * en cours de validation.
   */
  dev?: boolean
}

const membersStore = useMembersStore()
const settingsStore = useSettingsStore()
const authStore = useAuthStore()
const cotisationsStore = useCotisationsStore()
const licenseRequestsStore = useLicenseRequestsStore()

// La route `/cotisations` est `ADMIN_ONLY` ; on ne charge le store que pour
// les rôles capables d'y accéder. `rootAdmin` bypasse également la rule
// `isAdminOrTreasurer` côté `firestore.rules`. Évite `permission-denied`
// inutile pour un coach connecté qui voit la sidebar mais pas l'entrée.
const canSeeCotisations = computed(
  () => authStore.rootAdmin || authStore.roles.includes('admin'),
)

// La route `/license-requests` est gatée `LICENSES_ACCESS` =
// `admin | treasurer | secretary` (cf. `router/index.ts`) + bypass
// `rootAdmin`. On ne charge le store que pour ce périmètre, sinon
// `permission-denied` côté rules pour un coach connecté. Le coach gère ses
// propres demandes depuis `apps/courtbase-app`, pas depuis cette sidebar.
const canSeeLicenseRequests = computed(
  () =>
    authStore.rootAdmin ||
    authStore.roles.includes('admin') ||
    authStore.roles.includes('treasurer') ||
    authStore.roles.includes('secretary'),
)

onMounted(() => {
  // Sidebar globalement montée → charge la liste si pas encore en cache,
  // pour alimenter le count "actifs". Les autres vues (ex. /members) lisent
  // le même store, donc pas de double fetch.
  if (membersStore.members.length === 0 && !membersStore.loading) {
    void membersStore.load()
  }
  if (!settingsStore.config && !settingsStore.loading) {
    void settingsStore.load()
  }
  // Charge les cotisations pour alimenter le badge "en retard" de la
  // sidebar (cf. `cotisationsBadge` ci-dessous). La page `/cotisations`
  // lit le même store, donc pas de double fetch lors de la navigation.
  if (
    canSeeCotisations.value &&
    cotisationsStore.cotisations.length === 0 &&
    !cotisationsStore.loading
  ) {
    void cotisationsStore.load()
  }
  // Idem pour les demandes de licence — `load()` est idempotent (re-appel
  // = no-op si déjà chargé) et la page `/license-requests` lit le même
  // store : pas de double fetch lors de la navigation. Alimente le badge
  // `licenseRequestsBadge` (cf. ci-dessous).
  if (canSeeLicenseRequests.value && !licenseRequestsStore.loading) {
    void licenseRequestsStore.load()
  }
})

/**
 * Badge "Cotisations" — compte des cotisations `overdue` (les plus
 * actionnables pour l'admin / trésorier). Renvoie `null` quand le compte
 * vaut 0 pour éviter d'afficher un rond rouge inutile. Format `'99+'` au
 * delà de 99 pour préserver la lisibilité du Pill.
 */
const cotisationsBadge = computed<NavItem['badge'] | null>(() => {
  if (!canSeeCotisations.value) return null
  const count = cotisationsStore.stats.overdue.count
  if (count <= 0) return null
  return {
    text: count > 99 ? '99+' : String(count),
    variant: 'rose',
  }
})

/**
 * Badge "Demandes de licence" — compte des demandes pour lesquelles le
 * staff trésorier (treasurer / admin / secretary / rootAdmin) a une
 * action concrète à mener. Source : getter `pendingTreasurer` du store —
 * union canonique `coach_validated | parent_signed | form_confirmed |
 * sent_paid` (cf. `stores/licenseRequests.ts` §TREASURER_ACTIONABLE_STATUSES).
 *
 * Le badge ne reflète PAS le total des demandes en cours : les statuts
 * `pending_parent_docs`, `parent_docs_submitted`, `awaiting_parent_signature`
 * sont en attente côté parent ou coach — rien à traiter côté staff. La
 * page liste affiche bien la totalité, le badge reste sur le sous-set
 * actionnable pour ne pas crier au loup.
 *
 * Renvoie `null` quand le compte vaut 0 (pas de pastille inutile).
 * Variant `amber` aligné sur le ton "à traiter" des chips trésorier.
 */
const licenseRequestsBadge = computed<NavItem['badge'] | null>(() => {
  if (!canSeeLicenseRequests.value) return null
  const count = licenseRequestsStore.pendingTreasurer.length
  if (count <= 0) return null
  return {
    text: count > 99 ? '99+' : String(count),
    variant: 'amber',
  }
})

const clubLogo = computed(() => settingsStore.config?.logo ?? null)
const clubName = computed(() => settingsStore.config?.name ?? 'Courtbase')

const activeMembersCount = computed(() =>
  membersStore.members.length === 0 ? undefined : String(membersStore.counts.active),
)

const workspace = computed<NavItem[]>(() => [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/members', label: 'Members', icon: Users, count: activeMembersCount.value },
  { to: '/teams', label: 'Teams', icon: UsersRound },
  { to: '/venues', label: 'Venues & courts', icon: MapPin },
  { to: '/seasons', label: 'Seasons', icon: CalendarRange },
  { to: '/bookings', label: 'Bookings', icon: Calendar },
])

// Items "Operations" — `Cotisations` reçoit un badge réactif (`overdue`)
// piloté par `useCotisationsStore`. Les autres entrées n'ont pas (encore)
// de source live ; l'ancien badge `Payment exceptions: 2` était hardcoded
// et la vue elle-même est un placeholder — il a été retiré tant qu'il
// n'existe pas de store dédié à brancher.
const operations = computed<NavItem[]>(() => {
  const items: NavItem[] = [
    { to: '/registrations', label: 'Inscriptions', icon: ClipboardList },
    { to: '/officials', label: 'Officials', icon: UsersRound },
    {
      to: '/cotisations',
      label: 'Cotisations',
      icon: Banknote,
      ...(cotisationsBadge.value ? { badge: cotisationsBadge.value } : {}),
    },
    {
      to: '/license-requests',
      label: 'Demandes de licence',
      icon: ShieldCheck,
      ...(licenseRequestsBadge.value ? { badge: licenseRequestsBadge.value } : {}),
    },
    { to: '/licenses', label: 'Licences', icon: BadgeCheck, dev: true },
    { to: '/exceptions', label: 'Payment exceptions', icon: CircleHelp },
    { to: '/attendance', label: 'Attendance', icon: ClipboardCheck },
    { to: '/matches', label: 'Matches', icon: Trophy },
  ]
  return items
})

// Entrée "Member detail" retirée du menu — la fiche membre reste accessible
// via Members → ligne (route `/members/:id` toujours déclarée). L'entrée de
// nav vers `/members/_preview` n'avait de sens qu'en mode design preview.
const details: NavItem[] = [
  // { to: '/members/_preview', label: 'Member detail', icon: IdCard },
  { to: '/court-history', label: 'Court history', icon: History },
]

/**
 * Section Comptabilité — visible uniquement pour le trésorier (rôle
 * `treasurer`) ou le rootAdmin (claim Auth). L'admin standard est exclu du
 * module (cf. docs/compta.md §1). Le guard router applique la même règle.
 */
const canSeeAccounting = computed(
  () => authStore.rootAdmin || authStore.roles.includes('treasurer'),
)

// Toutes les pages Comptabilité sont marquées `dev: true` — le module est livré
// côté UI mais reste en cours de validation métier (cf. docs/compta.md). Le Tag
// "dev" à côté de chaque label permet au trésorier de naviguer en sachant que
// le workflow comptable n'est pas encore officiellement déployé.
const accounting: NavItem[] = [
  { to: '/comptabilite', label: 'Comptabilité', icon: Wallet, dev: true },
  { to: '/comptabilite/comptes', label: 'Plan comptable', icon: BookOpen, dev: true },
  { to: '/comptabilite/credits', label: 'Crédits', icon: PlusCircle, dev: true },
  { to: '/comptabilite/factures', label: 'Factures', icon: FileText, dev: true },
  { to: '/comptabilite/journal', label: 'Journal', icon: ScrollText, dev: true },
  { to: '/comptabilite/bilan', label: 'Bilan', icon: Scale, dev: true },
  { to: '/comptabilite/resultat', label: 'Compte de résultat', icon: Calculator, dev: true },
]

const setup: NavItem[] = [{ to: '/settings', label: 'Settings', icon: Settings }]
</script>

<template>
  <aside
    class="bg-white border-r border-surface-200 flex flex-col w-[240px] sticky top-0 h-screen shrink-0"
  >
    <div class="h-14 px-4 flex items-center gap-2 border-b border-surface-200">
      <img
        v-if="clubLogo"
        :src="clubLogo"
        :alt="clubName"
        class="w-7 h-7 rounded-md object-cover bg-white"
      />
      <div
        v-else
        class="w-7 h-7 rounded-md bg-emerald-600 flex items-center justify-center text-white"
      >
        <Dribbble
          :size="16"
          :stroke-width="2"
        />
      </div>
      <div class="flex flex-col leading-tight min-w-0">
        <span class="text-[13px] font-semibold tracking-tight truncate">{{ clubName }}</span>
        <span class="text-[10px] text-surface-500 font-mono">v0.4.1 · pilot</span>
      </div>
    </div>

   

    <nav class="px-2 py-2 flex-1 overflow-y-auto text-[13px]">
      <div
        class="px-2 py-2 text-[10px] uppercase tracking-wider text-surface-400 font-semibold"
      >
        Workspace
      </div>
      <RouterLink
        v-for="item in workspace"
        :key="item.to"
        :to="item.to"
        class="nav-item flex items-center gap-2.5 px-3 h-9 rounded-md text-surface-600 hover:bg-surface-50 relative"
        active-class="nav-item--active"
      >
        <component
          :is="item.icon"
          :size="16"
          :stroke-width="2"
        />
        <span>{{ item.label }}</span>
        <Tag
          v-if="item.dev"
          value="dev"
          severity="warning"
          class="!text-[10px] !py-0 !px-1.5 !leading-4"
        />
        <span
          v-if="item.count"
          class="ml-auto text-[11px] text-surface-400 num"
        >
          {{ item.count }}
        </span>
      </RouterLink>

      <div
        class="px-2 pt-4 pb-2 text-[10px] uppercase tracking-wider text-surface-400 font-semibold"
      >
        Operations
      </div>
      <RouterLink
        v-for="item in operations"
        :key="item.to"
        :to="item.to"
        class="nav-item flex items-center gap-2.5 px-3 h-9 rounded-md text-surface-600 hover:bg-surface-50 relative"
        active-class="nav-item--active"
      >
        <component
          :is="item.icon"
          :size="16"
          :stroke-width="2"
        />
        <span>{{ item.label }}</span>
        <Tag
          v-if="item.dev"
          value="dev"
          severity="warning"
          class="!text-[10px] !py-0 !px-1.5 !leading-4"
        />
        <Pill
          v-if="item.badge"
          :variant="item.badge.variant"
          class="ml-auto !text-[11px] num"
        >
          {{ item.badge.text }}
        </Pill>
      </RouterLink>

      <div
        class="px-2 pt-4 pb-2 text-[10px] uppercase tracking-wider text-surface-400 font-semibold"
      >
        Détails (preview)
      </div>
      <RouterLink
        v-for="item in details"
        :key="item.to"
        :to="item.to"
        class="nav-item flex items-center gap-2.5 px-3 h-9 rounded-md text-surface-600 hover:bg-surface-50 relative"
        active-class="nav-item--active"
      >
        <component
          :is="item.icon"
          :size="16"
          :stroke-width="2"
        />
        <span>{{ item.label }}</span>
      </RouterLink>

      <template v-if="canSeeAccounting">
        <div
          class="px-2 pt-4 pb-2 text-[10px] uppercase tracking-wider text-surface-400 font-semibold"
        >
          Comptabilité
        </div>
        <RouterLink
          v-for="item in accounting"
          :key="item.to"
          :to="item.to"
          class="nav-item flex items-center gap-2.5 px-3 h-9 rounded-md text-surface-600 hover:bg-surface-50 relative"
          active-class="nav-item--active"
        >
          <component
            :is="item.icon"
            :size="16"
            :stroke-width="2"
          />
          <span>{{ item.label }}</span>
          <Tag
            v-if="item.dev"
            value="dev"
            severity="warning"
            class="!text-[10px] !py-0 !px-1.5 !leading-4"
          />
        </RouterLink>
      </template>

      <div
        class="px-2 pt-4 pb-2 text-[10px] uppercase tracking-wider text-surface-400 font-semibold"
      >
        Setup
      </div>
      <RouterLink
        v-for="item in setup"
        :key="item.to"
        :to="item.to"
        class="nav-item flex items-center gap-2.5 px-3 h-9 rounded-md text-surface-600 hover:bg-surface-50 relative"
        active-class="nav-item--active"
      >
        <component
          :is="item.icon"
          :size="16"
          :stroke-width="2"
        />
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>

    <div
      class="border-t border-surface-200 px-3 py-2.5 flex items-center justify-between text-[11px] text-surface-500"
    >
      <div class="flex items-center gap-1.5">
        <span class="w-2 h-2 rounded-full bg-emerald-500" />
        <span>API healthy</span>
      </div>
      <a class="hover:text-surface-700 cursor-pointer">Support</a>
    </div>
  </aside>
</template>

<style scoped>
.nav-item--active {
  background: #ecfdf5;
  color: #047857;
  font-weight: 600;
}
.nav-item--active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  background: #10b981;
  border-radius: 0 3px 3px 0;
}
</style>
