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
  IdCard,
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
import Pill from '@/components/ui/Pill.vue'
import { useMembersStore } from '@/stores/members'
import { useSettingsStore } from '@/stores/settings'
import { useAuthStore } from '@/stores/auth'
import { useCotisationsStore } from '@/stores/cotisations'

type NavItem = {
  to: string
  label: string
  icon: Component
  badge?: { text: string; variant: 'rose' | 'amber' | 'slate' }
  count?: string
}

const membersStore = useMembersStore()
const settingsStore = useSettingsStore()
const authStore = useAuthStore()
const cotisationsStore = useCotisationsStore()

// La route `/cotisations` est `ADMIN_ONLY` ; on ne charge le store que pour
// les rôles capables d'y accéder. `rootAdmin` bypasse également la rule
// `isAdminOrTreasurer` côté `firestore.rules`. Évite `permission-denied`
// inutile pour un coach connecté qui voit la sidebar mais pas l'entrée.
const canSeeCotisations = computed(
  () => authStore.rootAdmin || authStore.roles.includes('admin'),
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
    { to: '/license-requests', label: 'Demandes de licence', icon: ShieldCheck },
    { to: '/licenses', label: 'Licences', icon: BadgeCheck },
    { to: '/exceptions', label: 'Payment exceptions', icon: CircleHelp },
    { to: '/attendance', label: 'Attendance', icon: ClipboardCheck },
    { to: '/matches', label: 'Matches', icon: Trophy },
  ]
  return items
})

const details: NavItem[] = [
  { to: '/members/_preview', label: 'Member detail', icon: IdCard },
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

const accounting: NavItem[] = [
  { to: '/comptabilite', label: 'Comptabilité', icon: Wallet },
  { to: '/comptabilite/comptes', label: 'Plan comptable', icon: BookOpen },
  { to: '/comptabilite/credits', label: 'Crédits', icon: PlusCircle },
  { to: '/comptabilite/factures', label: 'Factures', icon: FileText },
  { to: '/comptabilite/journal', label: 'Journal', icon: ScrollText },
  { to: '/comptabilite/bilan', label: 'Bilan', icon: Scale },
  { to: '/comptabilite/resultat', label: 'Compte de résultat', icon: Calculator },
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
