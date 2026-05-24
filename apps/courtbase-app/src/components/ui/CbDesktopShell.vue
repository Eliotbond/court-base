<script setup lang="ts">
import CbSidebar, { type CbNavItem, type CbNavItemGroup } from './CbSidebar.vue'

/**
 * S2 — Desktop shell : sidebar 240px + main content scrollable. À utiliser
 * uniquement sur viewports ≥1024px. En-dessous, l'app rend `CbMobileShell`.
 *
 * (La switch mobile/desktop sera gérée par un composable `useViewport` dans
 * une PR future. Pour l'instant chaque view choisit explicitement son shell.)
 */
defineProps<{
  items: ReadonlyArray<CbNavItem> | ReadonlyArray<CbNavItemGroup>
  active?: number
  brandName?: string
  brandSub?: string
  clubInitials?: string
  userName?: string
  userRole?: string
  /**
   * Item Notifications transmis au footer de la sidebar (au-dessus du
   * userchip). Porte son badge non-lues réactif. Si absent, le footer ne
   * rend que le userchip — pas de bouton Notifs.
   */
  notifItem?: CbNavItem
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
      :notif-item="notifItem"
      @select="(i) => $emit('navSelect', i)"
    />
    <main>
      <slot />
    </main>
  </div>
</template>
