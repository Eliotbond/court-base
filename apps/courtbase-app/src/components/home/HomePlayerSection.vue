<script setup lang="ts">
import { useRouter } from 'vue-router'
import { CalendarDays, ChevronRight, Receipt } from 'lucide-vue-next'

import CbEmptyState from '@/components/ui/CbEmptyState.vue'
import CbSectionHeader from '@/components/ui/CbSectionHeader.vue'

/**
 * Section Home — bloc joueur.
 *
 * Rendue uniquement si le user porte le rôle `player`
 * (gate dans `Home.vue` — PR-M-C, via `auth.roles.includes('player')`).
 *
 * MVP — pas de data réelle branchée :
 *  - Pas de route `player-matches` dans `router/index.ts` (cf. brief
 *    `menu-refactor.md` § Routing — peut être ajoutée plus tard).
 *  - Pas de store `myMatchesStore` (à créer dans une PR dédiée).
 *
 * Pour cette PR, on rend deux raccourcis vers l'agenda (où le joueur
 * verra les bookings + matches de ses équipes — déjà filtré par le store
 * `bookings`) et un placeholder pour les cotisations. Le `CbEmptyState`
 * sert de fallback "À venir" pour signaler que la section est WIP.
 */

const router = useRouter()

function openAgenda(): void {
  router.push({ name: 'agenda' })
}
function openProfile(): void {
  router.push({ name: 'profile-settings' })
}
</script>

<template>
  <section class="home-section">
    <CbSectionHeader title="Joueur" />

    <div class="home-section__actions">
      <button
        type="button"
        class="home-section__action-btn home-section__action-btn--sky"
        @click="openAgenda"
      >
        <span class="home-section__action-icon home-section__action-icon--sky">
          <CalendarDays :size="18" />
        </span>
        <span class="home-section__action-body">
          <span class="home-section__action-title">Mes prochains matchs</span>
          <span class="home-section__action-sub">consulter l'agenda</span>
        </span>
        <ChevronRight :size="18" />
      </button>

      <button
        type="button"
        class="home-section__action-btn home-section__action-btn--violet"
        @click="openProfile"
      >
        <span class="home-section__action-icon home-section__action-icon--violet">
          <Receipt :size="18" />
        </span>
        <span class="home-section__action-body">
          <span class="home-section__action-title">Mes cotisations</span>
          <span class="home-section__action-sub">à venir</span>
        </span>
        <ChevronRight :size="18" />
      </button>
    </div>

    <CbEmptyState
      :icon="CalendarDays"
      title="Vue joueur en cours de construction"
      body="Les widgets matchs et cotisations seront branchés bientôt. En attendant, consultez votre agenda."
    />
  </section>
</template>

<style scoped>
.home-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.home-section__actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.home-section__action-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  border: 0;
  padding: 12px 14px;
  border-radius: 12px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}
.home-section__action-btn--violet {
  background: var(--violet-50);
  color: var(--violet-700);
  box-shadow: inset 0 0 0 1px var(--violet-200);
}
.home-section__action-btn--sky {
  background: var(--sky-50);
  color: var(--sky-700);
  box-shadow: inset 0 0 0 1px var(--sky-200);
}
.home-section__action-icon {
  width: 34px;
  height: 34px;
  border-radius: 17px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.home-section__action-icon--violet {
  background: var(--violet-100);
}
.home-section__action-icon--sky {
  background: var(--sky-100);
}
.home-section__action-body {
  flex: 1;
  line-height: 1.2;
  display: flex;
  flex-direction: column;
}
.home-section__action-title {
  font-weight: 600;
  font-size: 14px;
}
.home-section__action-sub {
  font-size: 12px;
  opacity: 0.75;
  margin-top: 2px;
}
</style>
