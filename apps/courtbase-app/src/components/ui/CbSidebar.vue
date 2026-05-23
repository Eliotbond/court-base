<script setup lang="ts">
import { computed, ref, type FunctionalComponent } from 'vue'
import { MoreVertical } from 'lucide-vue-next'

import CbUserMenu from './CbUserMenu.vue'

/**
 * S2 (partie sidebar) — Sidebar desktop ≥1024px. Logo + brand en haut, items
 * de nav, userchip en bas. L'allowlist (`router/allowlist.ts`) détermine
 * quels items afficher selon les rôles du user.
 *
 * Le userchip est cliquable : ouvre un menu déroulant (Mon profil + Se
 * déconnecter) via `CbUserMenu`.
 */
export interface CbNavItem {
  icon: FunctionalComponent
  label: string
  /** Nom de la route Vue Router (pour <RouterLink>). */
  to?: string
  badge?: number | null
}

const props = defineProps<{
  items: ReadonlyArray<CbNavItem>
  /** Index de l'item actif. */
  active?: number
  brandName?: string
  brandSub?: string
  clubInitials?: string
  userName?: string
  userRole?: string
}>()

defineEmits<{ select: [index: number] }>()

const userInitials = computed(() =>
  (props.userName ?? '')
    .split(' ')
    .filter(Boolean)
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase(),
)

const menuOpen = ref(false)
</script>

<template>
  <aside class="cb-sidebar">
    <div class="brand">
      <div class="cb-logo">{{ clubInitials ?? 'CB' }}</div>
      <div>
        <div class="name">{{ brandName ?? 'Courtbase' }}</div>
        <div class="sub">{{ brandSub ?? '' }}</div>
      </div>
    </div>
    <div style="display: flex; flex-direction: column; gap: 2px">
      <button
        v-for="(it, i) in items"
        :key="i"
        type="button"
        class="cb-navitem"
        :class="{ active: active === i }"
        @click="$emit('select', i)"
      >
        <component
          :is="it.icon"
          :size="18"
          :stroke-width="active === i ? 2 : 1.7"
        />
        <span>{{ it.label }}</span>
        <span v-if="it.badge" class="nav-badge">{{ it.badge }}</span>
      </button>
    </div>
    <div class="cb-sidebar-bottom" style="position: relative">
      <button
        type="button"
        class="cb-userchip"
        style="width: 100%; border: 0; font-family: inherit; text-align: left"
        @click="menuOpen = !menuOpen"
      >
        <span class="cb-avatar sm">{{ userInitials || '?' }}</span>
        <div style="flex: 1; min-width: 0">
          <div class="name" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
            {{ userName ?? '' }}
          </div>
          <div class="role">{{ userRole ?? '' }}</div>
        </div>
        <MoreVertical :size="16" />
      </button>
      <CbUserMenu v-model:visible="menuOpen" anchor="bottom-left" />
    </div>
  </aside>
</template>
