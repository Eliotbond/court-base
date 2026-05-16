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
} from 'lucide-vue-next'
import { computed, onMounted, type Component } from 'vue'
import Pill from '@/components/ui/Pill.vue'
import { useMembersStore } from '@/stores/members'
import { useSettingsStore } from '@/stores/settings'
import { useAuthStore } from '@/stores/auth'

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

const operations: NavItem[] = [
  { to: '/registrations', label: 'Inscriptions', icon: ClipboardList },
  { to: '/officials', label: 'Officials', icon: UsersRound },
  { to: '/cotisations', label: 'Cotisations', icon: Banknote, badge: { text: '7', variant: 'rose' } },
  {
    to: '/licenses',
    label: 'License requests',
    icon: BadgeCheck,
    badge: { text: '3', variant: 'amber' },
  },
  {
    to: '/exceptions',
    label: 'Payment exceptions',
    icon: CircleHelp,
    badge: { text: '2', variant: 'amber' },
  },
  { to: '/attendance', label: 'Attendance', icon: ClipboardCheck },
  { to: '/matches', label: 'Matches', icon: Trophy },
]

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
