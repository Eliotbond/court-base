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
  Tags,
  IdCard,
  Trophy,
  History,
  Settings,
  ChevronsUpDown,
  Dribbble,
} from 'lucide-vue-next'
import type { Component } from 'vue'
import Pill from '@/components/ui/Pill.vue'

type NavItem = {
  to: string
  label: string
  icon: Component
  badge?: { text: string; variant: 'rose' | 'amber' | 'slate' }
  count?: string
}

const workspace: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/members', label: 'Members', icon: Users, count: '142' },
  { to: '/teams', label: 'Teams', icon: UsersRound },
  { to: '/venues', label: 'Venues & courts', icon: MapPin },
  { to: '/seasons', label: 'Seasons', icon: CalendarRange },
  { to: '/bookings', label: 'Bookings', icon: Calendar },
]

const operations: NavItem[] = [
  { to: '/officials', label: 'Officials', icon: UsersRound },
  { to: '/dues', label: 'Dues', icon: Banknote, badge: { text: '7', variant: 'rose' } },
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
  { to: '/match-types', label: 'Match types', icon: Tags },
]

const details: NavItem[] = [
  { to: '/members/_preview', label: 'Member detail', icon: IdCard },
  { to: '/matches/_preview', label: 'Match home detail', icon: Trophy },
  { to: '/court-history', label: 'Court history', icon: History },
]

const setup: NavItem[] = [{ to: '/settings', label: 'Settings', icon: Settings }]
</script>

<template>
  <aside
    class="bg-white border-r border-surface-200 flex flex-col w-[240px] sticky top-0 h-screen shrink-0"
  >
    <div class="h-14 px-4 flex items-center gap-2 border-b border-surface-200">
      <div
        class="w-7 h-7 rounded-md bg-emerald-600 flex items-center justify-center text-white"
      >
        <Dribbble
          :size="16"
          :stroke-width="2"
        />
      </div>
      <div class="flex flex-col leading-tight">
        <span class="text-[13px] font-semibold tracking-tight">Courtbase</span>
        <span class="text-[10px] text-surface-500 font-mono">v0.4.1 · pilot</span>
      </div>
    </div>

    <button
      class="mx-3 mt-3 mb-1 flex items-center gap-2 px-2 h-9 rounded-md hover:bg-surface-50 text-left"
    >
      <div
        class="w-6 h-6 rounded bg-surface-900 text-white flex items-center justify-center text-[10px] font-bold"
      >
        BC
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-[12px] font-medium truncate">
          BC Lausanne-Sud
        </div>
        <div class="text-[10px] text-surface-500 truncate">
          Saison 2025-26
        </div>
      </div>
      <ChevronsUpDown
        :size="16"
        class="text-surface-400"
        :stroke-width="2"
      />
    </button>

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
