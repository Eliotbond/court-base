<script setup lang="ts">
/**
 * Settings → Saison / Compétition → Officials — rentabilité.
 *
 * Vue extraite de l'ancien `views/Settings.vue` (section `officials`,
 * lignes 459-497 du script + 2556-2679 du template). Édite le bloc
 * `/config/club.officialsConfig` consommé par le widget rentabilité du
 * Dashboard (couleurs des badges officiels selon le nombre de matchs).
 *
 * Architecture en couches : la vue lit/écrit via `useSettingsStore` —
 * jamais le repo directement (cf. `apps/web/CLAUDE.md`).
 */
import { computed, onMounted, ref, watch } from 'vue'
import { Check } from 'lucide-vue-next'
import InputNumber from 'primevue/inputnumber'
import { useSettingsStore } from '@/stores/settings'
import type { OfficialsConfig } from '@club-app/shared-types'

const store = useSettingsStore()

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Form local — initialisé sur defaults raisonnables puis synchronisé avec
 * `store.config.officialsConfig` via watcher dès que `load()` a résolu.
 */
const officialsForm = ref<OfficialsConfig>({
  licenseFee: 140,
  thresholdGreen: 6,
  thresholdOrange: 3,
})
const officialsErrors = ref<Partial<Record<keyof OfficialsConfig, string>>>({})

watch(
  () => store.config?.officialsConfig,
  (cfg) => {
    if (cfg) officialsForm.value = { ...cfg }
  },
  { immediate: true, deep: true },
)

// ---------------------------------------------------------------------------
// Lifecycle — load Settings si pas déjà chargé (évite re-fetch si on revient
// depuis une autre sous-vue Settings).
// ---------------------------------------------------------------------------

onMounted(() => {
  if (!store.config) {
    void store.load()
  }
})

// ---------------------------------------------------------------------------
// Validation & save
// ---------------------------------------------------------------------------

function validateOfficials(): boolean {
  const errors: Partial<Record<keyof OfficialsConfig, string>> = {}
  if (officialsForm.value.licenseFee <= 0) errors.licenseFee = 'Montant > 0'
  if (officialsForm.value.thresholdOrange < 1) errors.thresholdOrange = 'Min 1'
  if (officialsForm.value.thresholdGreen <= officialsForm.value.thresholdOrange) {
    errors.thresholdGreen = 'Doit être > seuil orange'
  }
  officialsErrors.value = errors
  return Object.keys(errors).length === 0
}

async function saveOfficials(): Promise<void> {
  if (!validateOfficials()) return
  try {
    await store.saveOfficialsConfig({ ...officialsForm.value })
  } catch {
    /* error surfaced via store.error — le pattern catch enrichi vit dans le store. */
  }
}

// ---------------------------------------------------------------------------
// Helpers d'état UI (per-section save indicators) — mirroir de Settings.vue.
// ---------------------------------------------------------------------------

const isSaving = computed<boolean>(() => store.savingSection === 'officials')
const isSaved = computed<boolean>(() => store.lastSaved === 'officials')

/** Borne haute de la fenêtre "orange" (>= thresholdOrange et < thresholdGreen). */
const orangeUpperBound = computed<number>(() => {
  return Math.max(
    officialsForm.value.thresholdGreen - 1,
    officialsForm.value.thresholdOrange,
  )
})
</script>

<template>
  <section class="p-6 space-y-6">
    <div>
      <h2 class="text-[16px] font-semibold">
        Officials — rentabilité
      </h2>
      <p class="text-[13px] text-surface-500">
        Seuils utilisés pour le widget rentabilité du Dashboard. Modifiables à
        la volée — recalcul client-side.
      </p>
    </div>

    <div class="grid grid-cols-3 gap-6">
      <label class="block">
        <span class="text-[12px] text-surface-600">Coût licence (CHF)</span>
        <InputNumber
          v-model="officialsForm.licenseFee"
          :min="0"
          :max-fraction-digits="0"
          input-class="!w-full"
          class="mt-1 w-full"
          :invalid="!!officialsErrors.licenseFee"
        />
        <span
          v-if="officialsErrors.licenseFee"
          class="text-[11px] text-rose-600 mt-1 block"
        >
          {{ officialsErrors.licenseFee }}
        </span>
      </label>
      <label class="block">
        <span class="text-[12px] text-surface-600">Seuil orange</span>
        <InputNumber
          v-model="officialsForm.thresholdOrange"
          :min="1"
          input-class="!w-full"
          class="mt-1 w-full"
          :invalid="!!officialsErrors.thresholdOrange"
        />
        <span class="text-[11px] text-surface-500 mt-1 block">
          Matches/saison &lt; ce seuil → rouge
        </span>
      </label>
      <label class="block">
        <span class="text-[12px] text-surface-600">Seuil vert</span>
        <InputNumber
          v-model="officialsForm.thresholdGreen"
          :min="2"
          input-class="!w-full"
          class="mt-1 w-full"
          :invalid="!!officialsErrors.thresholdGreen"
        />
        <span
          v-if="officialsErrors.thresholdGreen"
          class="text-[11px] text-rose-600 mt-1 block"
        >
          {{ officialsErrors.thresholdGreen }}
        </span>
        <span
          v-else
          class="text-[11px] text-surface-500 mt-1 block"
        >
          Matches/saison ≥ ce seuil → vert
        </span>
      </label>
    </div>

    <!-- Légende live preview -->
    <div class="border border-surface-200 rounded-md p-4 bg-surface-50/40">
      <div
        class="text-[11px] uppercase tracking-wider text-surface-400 font-semibold mb-2"
      >
        Aperçu — légende couleur
      </div>
      <div class="flex items-center gap-4 text-[12px]">
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded-full bg-rose-500" />
          <span>&lt; {{ officialsForm.thresholdOrange }} matchs / saison</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded-full bg-amber-500" />
          <span>
            {{ officialsForm.thresholdOrange }}–{{ orangeUpperBound }} matchs
          </span>
        </div>
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded-full bg-emerald-500" />
          <span>≥ {{ officialsForm.thresholdGreen }} matchs / saison</span>
        </div>
        <div class="ml-auto text-surface-500 num">
          Licence CHF {{ officialsForm.licenseFee }}.–
        </div>
      </div>
    </div>

    <div
      class="pt-4 border-t border-surface-200 flex items-center gap-2 justify-end"
    >
      <span
        v-if="isSaved"
        class="text-[12px] text-emerald-700 flex items-center gap-1 mr-auto"
      >
        <Check
          :size="14"
          :stroke-width="2"
        />
        Seuils sauvegardés
      </span>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        :disabled="isSaving"
        @click="saveOfficials"
      >
        <template v-if="isSaving">
          Sauvegarde…
        </template>
        <template v-else>
          Sauvegarder
        </template>
      </button>
    </div>
  </section>
</template>
