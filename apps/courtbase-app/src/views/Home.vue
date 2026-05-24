<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import CbDesktopShell from '@/components/ui/CbDesktopShell.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import HomeAdminSection from '@/components/home/HomeAdminSection.vue'
import HomeCoachSection from '@/components/home/HomeCoachSection.vue'
import HomeEmpty from '@/components/home/HomeEmpty.vue'
import HomeOfficialSection from '@/components/home/HomeOfficialSection.vue'
import HomePlayerSection from '@/components/home/HomePlayerSection.vue'
import { useShellNav } from '@/composables/useShellNav'
import { useViewport } from '@/composables/useViewport'
import { useAuthStore } from '@/stores/auth'

/**
 * Home unifié (refactor PR-M-C, 2026-05-24). Coquille single-page :
 *
 * 1. Choisit le shell (Mobile vs Desktop) via `useViewport().isDesktop`.
 * 2. Lit `useShellNav()` (nouvelle API : `tabs`, `nav`, `primaryRoleLabel`).
 * 3. Empile les sections conditionnelles par rôle dans l'ordre canonique :
 *    Coach > Officiel > Admin > Joueur. Aucune section = `HomeEmpty`.
 *
 * Aucun fetch ici : chaque `Home*Section` est responsable du chargement
 * scopé à son rôle (cf. brief §"Data loading scope" et CLAUDE.md
 * §"Menu unifié single-page > Règle 'scope data per section'").
 *
 * Divergence d'API shells (mobile = `title/tabs`, desktop = `items/userRole`)
 * → on garde deux `v-if` séparés plutôt qu'un `<component :is>` qui aurait
 * imposé un wrapper de props artificiel.
 *
 * Source de vérité produit : `docs/courtbase-app/menu-refactor.md`.
 */

const auth = useAuthStore()
const router = useRouter()
const { isDesktop } = useViewport()
const { tabs, nav, notifItem, notifBadge, primaryRoleLabel } = useShellNav()

function goToNotifications(): void {
  void router.push({ name: 'notifications' })
}

const isPlayer = computed(() => auth.roles.includes('player'))
const hasAnyRole = computed(
  () => auth.isCoach || auth.isOfficial || auth.isAdmin || isPlayer.value,
)
</script>

<template>
  <CbDesktopShell
    v-if="isDesktop"
    :items="nav"
    :notif-item="notifItem"
    brand-name="BC Aigles"
    brand-sub="Saison 2025/26"
    club-initials="BCA"
    :user-name="auth.displayName"
    :user-role="primaryRoleLabel"
  >
    <div class="cb-home-main">
      <HomeEmpty v-if="!hasAnyRole" />
      <template v-else>
        <HomeCoachSection v-if="auth.isCoach" />
        <HomeOfficialSection v-if="auth.isOfficial" />
        <HomeAdminSection v-if="auth.isAdmin" />
        <HomePlayerSection v-if="isPlayer" />
      </template>
    </div>
  </CbDesktopShell>

  <CbMobileShell
    v-else
    title="Accueil"
    club="BCA"
    :tabs="tabs"
    :notif-badge="notifBadge ?? false"
    @notif-click="goToNotifications"
  >
    <div class="cb-home-main">
      <HomeEmpty v-if="!hasAnyRole" />
      <template v-else>
        <HomeCoachSection v-if="auth.isCoach" />
        <HomeOfficialSection v-if="auth.isOfficial" />
        <HomeAdminSection v-if="auth.isAdmin" />
        <HomePlayerSection v-if="isPlayer" />
      </template>
    </div>
  </CbMobileShell>
</template>

<style scoped>
.cb-home-main {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 16px;
}
</style>
