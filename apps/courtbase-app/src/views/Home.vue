<script setup lang="ts">
import { computed } from 'vue'

import CbDesktopShell from '@/components/ui/CbDesktopShell.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
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
 *    Coach > Officiel > Joueur. Aucune section = `HomeEmpty`.
 *
 * **Alpha 2026-05-25** : la section admin (`HomeAdminSection`) et la cloche
 * notifications sont désactivées en attendant les phases ultérieures
 * (broadcast / staffing finalisés + FCM web push Phase 5). Le composant
 * `HomeAdminSection.vue` reste dans le repo — seul son rendu est retiré ici.
 *
 * Aucun fetch ici : chaque `Home*Section` est responsable du chargement
 * scopé à son rôle (cf. brief §"Data loading scope" et CLAUDE.md
 * §"Menu unifié single-page > Règle 'scope data per section'").
 *
 * Source de vérité produit : `docs/courtbase-app/menu-refactor.md`.
 */

const auth = useAuthStore()
const { isDesktop } = useViewport()
const { tabs, nav, primaryRoleLabel } = useShellNav()

const isPlayer = computed(() => auth.roles.includes('player'))
const hasAnyRole = computed(
  () => auth.isCoach || auth.isOfficial || isPlayer.value,
)
</script>

<template>
  <CbDesktopShell
    v-if="isDesktop"
    :items="nav"
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
        <HomePlayerSection v-if="isPlayer" />
      </template>
    </div>
  </CbDesktopShell>

  <CbMobileShell
    v-else
    title="Accueil"
    club="BCA"
    :tabs="tabs"
  >
    <div class="cb-home-main">
      <HomeEmpty v-if="!hasAnyRole" />
      <template v-else>
        <HomeCoachSection v-if="auth.isCoach" />
        <HomeOfficialSection v-if="auth.isOfficial" />
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
