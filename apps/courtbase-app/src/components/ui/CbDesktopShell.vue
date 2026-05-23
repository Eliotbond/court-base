<script setup lang="ts">
import CbSidebar, { type CbNavItem } from './CbSidebar.vue'

/**
 * S2 — Desktop shell : sidebar 240px + main content scrollable. À utiliser
 * uniquement sur viewports ≥1024px. En-dessous, l'app rend `CbMobileShell`.
 *
 * (La switch mobile/desktop sera gérée par un composable `useViewport` dans
 * une PR future. Pour l'instant chaque view choisit explicitement son shell.)
 */
defineProps<{
  items: ReadonlyArray<CbNavItem>
  active?: number
  brandName?: string
  brandSub?: string
  clubInitials?: string
  userName?: string
  userRole?: string
}>()

defineEmits<{ navSelect: [index: number] }>()
</script>

<template>
  <div class="cb-desktop">
    <CbSidebar
      :items="items"
      :active="active"
      :brand-name="brandName"
      :brand-sub="brandSub"
      :club-initials="clubInitials"
      :user-name="userName"
      :user-role="userRole"
      @select="(i) => $emit('navSelect', i)"
    />
    <main>
      <slot />
    </main>
  </div>
</template>
