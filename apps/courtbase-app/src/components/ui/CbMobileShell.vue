<script setup lang="ts">
import { ref } from 'vue'
import CbHeader from './CbHeader.vue'
import CbTabBar, { type CbTab } from './CbTabBar.vue'
import CbUserMenu from './CbUserMenu.vue'

/**
 * S1 — Mobile shell : header + body scrollable + (optionnel) tab bar bottom.
 * Pour les pages sans header (sign-in, splash), passer `:hide-header="true"`.
 * Pour les pages sans tab bar (wizard, dialog fullscreen), ne pas passer `tabs`.
 *
 * Le kebab du header ouvre un menu user (Mon profil + Se déconnecter) via
 * `CbUserMenu` — comportement par défaut centralisé pour éviter que chaque
 * vue ait à câbler `@more-click` séparément.
 */
defineProps<{
  title?: string
  club?: string
  showBack?: boolean
  /**
   * Badge cloche : `number > 0` → pastille avec compteur (cape à "9+"),
   * `true` → dot legacy, `false`/`0`/`null` → cloche nue. Voir CbHeader.
   */
  notifBadge?: boolean | number | null
  tabs?: ReadonlyArray<CbTab>
  activeTab?: number
  /** Body en surface "plain" (blanc) au lieu du slate-50 par défaut. */
  plainBody?: boolean
  hideHeader?: boolean
}>()

defineEmits<{
  back: []
  notifClick: []
  tabSelect: [index: number]
}>()

const menuOpen = ref(false)
</script>

<template>
  <div class="cb-mobile">
    <CbHeader
      v-if="!hideHeader && title !== undefined"
      :title="title"
      :club="club"
      :show-back="showBack"
      :notif-badge="notifBadge"
      @back="$emit('back')"
      @notif-click="$emit('notifClick')"
      @more-click="menuOpen = !menuOpen"
    />
    <CbUserMenu v-model:visible="menuOpen" anchor="top-right" />
    <div class="cb-mobile-body" :class="{ plain: plainBody }">
      <slot />
    </div>
    <CbTabBar
      v-if="tabs && tabs.length > 0"
      :tabs="tabs"
      :active="activeTab ?? 0"
      @select="(i) => $emit('tabSelect', i)"
    />
  </div>
</template>
