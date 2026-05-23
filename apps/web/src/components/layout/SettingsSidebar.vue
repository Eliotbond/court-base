<script setup lang="ts">
import {
  Building2,
  Users,
  Layers,
  Tag as TagIcon,
  Banknote,
  Tags,
  Siren,
  Trophy,
  CalendarX,
  BadgeCheck,
} from 'lucide-vue-next'
import type { Component } from 'vue'

interface NavItem {
  to: string
  label: string
  icon: Component
}

interface NavGroup {
  label: string
  items: readonly NavItem[]
}

/**
 * Sidebar verticale dédiée au module Settings. S'imbrique à côté de
 * l'`AppSidebar` global (deux sidebars de 240px côte à côte). Pas de logo en
 * haut (déjà dans AppSidebar). Les groupes ci-dessous reflètent les sections
 * de l'ancienne page Settings monolithique (NAV_GROUPS de Settings.vue),
 * adaptées en routes nestées sous `/settings/*`.
 */
const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'Club',
    items: [
      { to: '/settings/club', label: 'Club info', icon: Building2 },
      { to: '/settings/admin-team', label: 'Admin team', icon: Users },
    ],
  },
  {
    label: 'Équipes',
    items: [
      { to: '/settings/categories', label: 'Catégories', icon: Layers },
      { to: '/settings/tags', label: 'Tags', icon: TagIcon },
      { to: '/settings/cotisations', label: 'Types de cotisation', icon: Banknote },
    ],
  },
  {
    label: 'Membres',
    items: [{ to: '/settings/roles', label: 'Member roles', icon: Tags }],
  },
  {
    label: 'Saison / Compétition',
    items: [
      { to: '/settings/officials', label: 'Officials', icon: Siren },
      { to: '/settings/match-types', label: 'Match types', icon: Trophy },
      { to: '/settings/closure-periods', label: 'Closure periods', icon: CalendarX },
    ],
  },
  {
    label: 'Licences',
    items: [{ to: '/settings/license-types', label: 'Types de licence', icon: BadgeCheck }],
  },
  {
    label: 'Finances',
    items: [{ to: '/settings/dues', label: 'Dues config', icon: Banknote }],
  },
] as const
</script>

<template>
  <aside
    class="bg-white border-r border-surface-200 flex flex-col w-[240px] sticky top-0 h-screen shrink-0 overflow-y-auto"
  >
    <div class="h-14 px-4 flex items-center border-b border-surface-200">
      <span class="text-[13px] font-semibold tracking-tight">Paramètres</span>
    </div>

    <nav class="px-2 py-2 flex-1 overflow-y-auto text-[13px]">
      <template
        v-for="(group, groupIdx) in NAV_GROUPS"
        :key="group.label"
      >
        <div
          class="px-2 py-2 text-[10px] uppercase tracking-wider text-surface-400 font-semibold"
          :class="groupIdx === 0 ? '' : 'pt-4'"
        >
          {{ group.label }}
        </div>
        <RouterLink
          v-for="item in group.items"
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
    </nav>
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
