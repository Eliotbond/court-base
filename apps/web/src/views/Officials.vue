<script setup lang="ts">
import { ref } from 'vue'
import OfficialsMatchesTab from '@/components/officials/OfficialsMatchesTab.vue'
import OfficialsRentabilityTab from '@/components/officials/OfficialsRentabilityTab.vue'

/**
 * Page `/officials` — coquille à onglets.
 *
 * Deux onglets : "Assignations" (orchestration du staffing des matchs, par
 * défaut) et "Officiels" (tableau de bord rentabilité). Aucune logique
 * métier ici — tout vit dans les composants d'onglet (cf. apps/web/CLAUDE.md
 * — architecture en couches).
 */

type TabId = 'matches' | 'rentability'

interface TabDef {
  id: TabId
  label: string
}

const TABS: readonly TabDef[] = [
  { id: 'matches', label: 'Assignations' },
  { id: 'rentability', label: 'Officiels' },
] as const

const activeTab = ref<TabId>('matches')
</script>

<template>
  <section class="p-6 space-y-4">
    <!-- ================= Page heading =================== -->
    <div>
      <h1 class="text-[22px] font-semibold tracking-tight">
        Officials
      </h1>
      <p class="text-[13px] text-surface-500 mt-0.5">
        Staffing des matchs (domicile et extérieur) et rentabilité des officiels.
      </p>
    </div>

    <!-- ================= Tab bar =================== -->
    <div
      class="flex items-center gap-1 border-b border-surface-200"
      role="tablist"
    >
      <button
        v-for="tab in TABS"
        :key="tab.id"
        type="button"
        role="tab"
        :aria-selected="activeTab === tab.id"
        class="px-3 h-9 text-[13px] font-medium border-b-2 -mb-px transition-colors"
        :class="
          activeTab === tab.id
            ? 'border-emerald-500 text-emerald-700'
            : 'border-transparent text-surface-500 hover:text-surface-700'
        "
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- ================= Tab panels =================== -->
    <OfficialsMatchesTab v-show="activeTab === 'matches'" />
    <OfficialsRentabilityTab v-show="activeTab === 'rentability'" />
  </section>
</template>
