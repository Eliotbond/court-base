<script setup lang="ts">
/**
 * Settings → Saison / Compétition → Closure periods.
 *
 * Référentiel `/closurePeriods` — périodes de fermeture réutilisables (vacances
 * scolaires, travaux, …). L'ajout à une saison `active` déclenche le trigger
 * Cloud Function `applyClosurePeriod` (cascading cancel des bookings inclus
 * dans l'intervalle). Vue extraite de `views/Settings.vue` (script 636-714 +
 * template 4103-4259).
 *
 * Architecture en couches : lecture/écriture via `useSettingsStore` — jamais
 * le repo directement (cf. `apps/web/CLAUDE.md`).
 */
import { computed, onMounted, ref } from 'vue'
import { CalendarX, Check, Plus, Trash2 } from 'lucide-vue-next'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import { useSettingsStore } from '@/stores/settings'
import Pill from '@/components/ui/Pill.vue'
import type { Timestamp } from '@club-app/shared-types'

const store = useSettingsStore()

// ---------------------------------------------------------------------------
// Lifecycle — load Settings si pas déjà chargé.
// ---------------------------------------------------------------------------

onMounted(() => {
  if (!store.config) {
    void store.load()
  }
})

// ---------------------------------------------------------------------------
// Closure draft state
// ---------------------------------------------------------------------------

interface ClosureDraft {
  name: string
  startDate: string
  endDate: string
  type: 'holiday' | 'custom'
}

const CLOSURE_TYPE_OPTIONS: readonly { value: 'holiday' | 'custom'; label: string }[] = [
  { value: 'holiday', label: 'Vacances scolaires' },
  { value: 'custom', label: 'Custom' },
] as const

const isAddingClosure = ref(false)
const closureDraft = ref<ClosureDraft>({
  name: '',
  startDate: '',
  endDate: '',
  type: 'holiday',
})
const closureError = ref<string | null>(null)

function startAddClosure(): void {
  isAddingClosure.value = true
  closureDraft.value = { name: '', startDate: '', endDate: '', type: 'holiday' }
  closureError.value = null
}

function cancelClosureAdd(): void {
  isAddingClosure.value = false
  closureError.value = null
}

function validateClosureDraft(): boolean {
  const { name, startDate, endDate } = closureDraft.value
  if (!name.trim()) {
    closureError.value = 'Nom requis'
    return false
  }
  if (!startDate || !endDate) {
    closureError.value = 'Dates de début et fin requises'
    return false
  }
  if (new Date(startDate) > new Date(endDate)) {
    closureError.value = 'La date de fin doit être ≥ date de début'
    return false
  }
  closureError.value = null
  return true
}

async function commitClosure(): Promise<void> {
  if (!validateClosureDraft()) return
  try {
    await store.addClosurePeriod({
      name: closureDraft.value.name.trim(),
      startDate: closureDraft.value.startDate,
      endDate: closureDraft.value.endDate,
      type: closureDraft.value.type,
    })
    cancelClosureAdd()
  } catch {
    /* surfaced via store.error */
  }
}

async function confirmDeleteClosure(id: string, name: string): Promise<void> {
  const ok = window.confirm(`Supprimer la closure period "${name}" ?`)
  if (!ok) return
  try {
    await store.removeClosurePeriod(id)
  } catch {
    /* surfaced via store.error */
  }
}

// ---------------------------------------------------------------------------
// Date helpers (formatter Intl, identique à Settings.vue ligne 2049-2102)
// ---------------------------------------------------------------------------

const dateFormatter = new Intl.DateTimeFormat('fr-CH', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

function tsToDate(t: Timestamp | null): Date | null {
  if (!t) return null
  return new Date(t.seconds * 1000)
}

function fmtDate(d: Date | null): string {
  if (!d) return '—'
  return dateFormatter.format(d)
}

function closureRange(start: Timestamp, end: Timestamp): string {
  const startDate = fmtDate(tsToDate(start))
  const endDate = fmtDate(tsToDate(end))
  return `${startDate} → ${endDate}`
}

// ---------------------------------------------------------------------------
// Per-section save indicators
// ---------------------------------------------------------------------------

const isSaving = computed<boolean>(() => store.savingSection === 'closurePeriods')
const isSaved = computed<boolean>(() => store.lastSaved === 'closurePeriods')
</script>

<template>
  <section class="p-6 space-y-6">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="text-[16px] font-semibold">
          Closure periods
        </h2>
        <p class="text-[13px] text-surface-500">
          Périodes de fermeture réutilisables entre saisons (vacances, travaux).
          L'ajout à une saison `active` déclenche `applyClosurePeriod` (cascading cancel).
        </p>
      </div>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        :disabled="isAddingClosure || isSaving"
        @click="startAddClosure"
      >
        <Plus
          :size="14"
          :stroke-width="2"
        />
        Ajouter une période
      </button>
    </div>

    <!-- Add form (inline) -->
    <div
      v-if="isAddingClosure"
      class="border border-emerald-200 bg-emerald-50/40 rounded-md p-3 space-y-3"
    >
      <div class="grid grid-cols-4 gap-3">
        <label class="block col-span-2">
          <span class="text-[12px] text-surface-600">Nom</span>
          <InputText
            v-model="closureDraft.name"
            class="mt-1 w-full"
            placeholder="Ex. Vacances de Pâques"
          />
        </label>
        <label class="block">
          <span class="text-[12px] text-surface-600">Début</span>
          <input
            v-model="closureDraft.startDate"
            type="date"
            class="input !pl-3 mt-1"
          >
        </label>
        <label class="block">
          <span class="text-[12px] text-surface-600">Fin</span>
          <input
            v-model="closureDraft.endDate"
            type="date"
            class="input !pl-3 mt-1"
          >
        </label>
      </div>
      <div class="flex items-center gap-3">
        <label class="block w-40">
          <span class="text-[12px] text-surface-600">Type</span>
          <Select
            v-model="closureDraft.type"
            :options="[...CLOSURE_TYPE_OPTIONS]"
            option-label="label"
            option-value="value"
            class="mt-1 w-full"
          />
        </label>
        <span
          v-if="closureError"
          class="text-[11px] text-rose-600"
        >
          {{ closureError }}
        </span>
        <div class="ml-auto flex items-center gap-2">
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            @click="cancelClosureAdd"
          >
            Annuler
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="isSaving"
            @click="commitClosure"
          >
            Créer
          </button>
        </div>
      </div>
    </div>

    <!-- List -->
    <div class="border border-surface-200 rounded-md divide-y divide-surface-200">
      <div
        v-for="period in store.closurePeriods"
        :key="period.id"
        class="flex items-center gap-3 px-3 h-12"
      >
        <CalendarX
          :size="14"
          :stroke-width="2"
          class="text-surface-400"
        />
        <span class="font-medium text-[13px]">{{ period.name }}</span>
        <Pill
          v-if="period.type === 'holiday'"
          variant="sky"
        >
          vacances
        </Pill>
        <Pill
          v-else
          variant="slate"
        >
          custom
        </Pill>
        <span class="text-[12px] text-surface-500 num ml-2">
          {{ closureRange(period.startDate, period.endDate) }}
        </span>
        <div class="ml-auto">
          <button
            type="button"
            class="btn btn-ghost btn-sm !text-rose-700"
            :disabled="isSaving"
            @click="confirmDeleteClosure(period.id, period.name)"
          >
            <Trash2
              :size="14"
              :stroke-width="2"
            />
          </button>
        </div>
      </div>

      <div
        v-if="store.closurePeriods.length === 0"
        class="px-3 py-6 text-center text-[12px] text-surface-500"
      >
        Aucune closure period configurée.
      </div>
    </div>

    <div
      v-if="isSaved"
      class="text-[12px] text-emerald-700 flex items-center gap-1"
    >
      <Check
        :size="14"
        :stroke-width="2"
      />
      Closure periods mises à jour
    </div>
  </section>
</template>
