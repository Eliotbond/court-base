<script setup lang="ts">
/**
 * Settings → Dues — vue dédiée extraite de `Settings.vue` (lignes 2680-2790
 * pour le template, 498-532 pour le script setup d'origine).
 *
 * Configure le cycle de vie des cotisations (`/config/club.duesConfig`) :
 * - `gracePeriodDays` : délai avant émission auto (`pending_grace` → `issued`)
 * - `paymentDueDays`  : délai après émission avant passage en `overdue`
 *
 * Le recalcul effectif est fait par les Cloud Functions au prochain tick
 * quotidien (~06:00). Cette vue ne fait qu'écrire la config.
 *
 * Architecture en couches : la vue lit/écrit via `useSettingsStore` — elle ne
 * touche jamais directement le repo ni Firestore.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { Check, CircleAlert } from 'lucide-vue-next'
import InputNumber from 'primevue/inputnumber'
import { FirebaseError } from 'firebase/app'
import { useSettingsStore } from '@/stores/settings'
import type { DuesConfig } from '@club-app/shared-types'

const store = useSettingsStore()

// ---------------------------------------------------------------------------
// Local form + validation. La source de vérité reste `store.config.duesConfig`
// — on `watch` pour resynchroniser quand le store charge / un autre onglet
// modifie la config.
// ---------------------------------------------------------------------------

const duesForm = ref<DuesConfig>({
  gracePeriodDays: 21,
  paymentDueDays: 14,
})
const duesErrors = ref<Partial<Record<keyof DuesConfig, string>>>({})

watch(
  () => store.config?.duesConfig,
  (cfg) => {
    if (cfg) duesForm.value = { ...cfg }
  },
  { immediate: true, deep: true },
)

onMounted(() => {
  // Idempotent : `store.load()` no-op si déjà en cache (loading geré dans le store).
  if (!store.config) {
    void store.load()
  }
})

function validateDues(): boolean {
  const errors: Partial<Record<keyof DuesConfig, string>> = {}
  if (duesForm.value.gracePeriodDays < 0) errors.gracePeriodDays = 'Min 0'
  if (duesForm.value.paymentDueDays <= 0) errors.paymentDueDays = 'Min 1'
  duesErrors.value = errors
  return Object.keys(errors).length === 0
}

async function saveDues(): Promise<void> {
  if (!validateDues()) return
  try {
    await store.saveDuesConfig({ ...duesForm.value })
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`saveDuesConfig failed [${code}]`, err)
    // Erreur déjà surfacée via `store.error` côté store (optimistic apply +
    // rollback). On ne re-throw pas : la bannière inline suffit.
  }
}

// ---------------------------------------------------------------------------
// Saving / saved banner helpers — alignés sur le pattern original.
// ---------------------------------------------------------------------------

const isSaving = computed<boolean>(() => store.savingSection === 'dues')
const isSaved = computed<boolean>(() => store.lastSaved === 'dues')
</script>

<template>
  <section class="space-y-5">
    <div>
      <h2 class="text-[16px] font-semibold">
        Dues — cycle de cotisation
      </h2>
      <p class="text-[13px] text-surface-500">
        Configuration du lifecycle automatique géré par les Cloud Functions
        (cf. <code class="font-mono text-[11px]">docs/main.md</code>).
      </p>
    </div>

    <div class="grid grid-cols-2 gap-6">
      <label class="block">
        <span class="text-[12px] text-surface-600">Grace period (jours)</span>
        <InputNumber
          v-model="duesForm.gracePeriodDays"
          :min="0"
          input-class="!w-full"
          class="mt-1 w-full"
          :invalid="!!duesErrors.gracePeriodDays"
        />
        <span class="text-[11px] text-surface-500 mt-1 block">
          Délai avant l'émission auto du due (`pending_grace` → `issued`).
        </span>
      </label>
      <label class="block">
        <span class="text-[12px] text-surface-600">Délai de paiement (jours)</span>
        <InputNumber
          v-model="duesForm.paymentDueDays"
          :min="1"
          input-class="!w-full"
          class="mt-1 w-full"
          :invalid="!!duesErrors.paymentDueDays"
        />
        <span class="text-[11px] text-surface-500 mt-1 block">
          Délai après émission avant passage en `overdue`.
        </span>
      </label>
    </div>

    <!-- Timeline preview -->
    <div class="pt-3 border-t border-surface-200">
      <h3 class="text-[14px] font-semibold">
        Aperçu — timeline cotisation
      </h3>
      <p class="text-[12px] text-surface-500">
        Grace {{ duesForm.gracePeriodDays }} j · échéance
        {{ duesForm.gracePeriodDays + duesForm.paymentDueDays }} j
      </p>
      <div class="mt-3 flex items-center text-[11px] font-mono">
        <div class="flex-1 flex items-center gap-2">
          <span class="w-3 h-3 rounded-full bg-slate-400" />
          <div class="flex-1 h-px bg-slate-200" />
        </div>
        <div class="flex-1 flex items-center gap-2">
          <span class="w-3 h-3 rounded-full bg-sky-500" />
          <div class="flex-1 h-px bg-slate-200" />
        </div>
        <div class="flex-1 flex items-center gap-2">
          <span class="w-3 h-3 rounded-full bg-rose-500" />
          <div class="flex-1" />
        </div>
      </div>
      <div class="mt-1 flex items-center text-[11px] text-surface-500">
        <span class="flex-1">J0 · activated</span>
        <span class="flex-1">J+{{ duesForm.gracePeriodDays }} · issued</span>
        <span class="flex-1">
          J+{{ duesForm.gracePeriodDays + duesForm.paymentDueDays }} · overdue
        </span>
      </div>
      <div class="mt-4 text-[11px] text-surface-500 flex items-center gap-1.5">
        <CircleAlert
          :size="12"
          :stroke-width="2"
        />
        Recalculé par les Functions au prochain tick (~06:00 quotidien).
      </div>
    </div>

    <div class="pt-4 border-t border-surface-200 flex items-center gap-2 justify-end">
      <span
        v-if="isSaved"
        class="text-[12px] text-emerald-700 flex items-center gap-1 mr-auto"
      >
        <Check
          :size="14"
          :stroke-width="2"
        />
        Cycle sauvegardé
      </span>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        :disabled="isSaving"
        @click="saveDues"
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
