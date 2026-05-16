<script setup lang="ts">
import { computed } from 'vue'
import { CalendarRange, X } from 'lucide-vue-next'
import DatePicker from 'primevue/datepicker'
import Button from 'primevue/button'
import type { PeriodFilter } from '@/stores/accountingReports'

/**
 * Filtre de période réutilisable pour les 3 rapports comptables (Journal,
 * Bilan, Compte de résultat). Composant de présentation pur : il lit/écrit le
 * `PeriodFilter` via `v-model` — toute la logique de filtrage vit dans le
 * store `accountingReports` (cf. architecture en couches).
 */

const props = defineProps<{
  modelValue: PeriodFilter
}>()

const emit = defineEmits<{
  'update:modelValue': [value: PeriodFilter]
}>()

const from = computed<Date | null>({
  get: () => props.modelValue.from,
  set: (value) => emit('update:modelValue', { ...props.modelValue, from: value }),
})

const to = computed<Date | null>({
  get: () => props.modelValue.to,
  set: (value) => emit('update:modelValue', { ...props.modelValue, to: value }),
})

const hasFilter = computed<boolean>(
  () => props.modelValue.from !== null || props.modelValue.to !== null,
)

function reset(): void {
  emit('update:modelValue', { from: null, to: null })
}
</script>

<template>
  <div class="flex items-center gap-2 flex-wrap">
    <span
      class="inline-flex items-center gap-1.5 text-[12px] text-surface-500 font-medium"
    >
      <CalendarRange
        :size="14"
        :stroke-width="2"
      />
      Période
    </span>
    <DatePicker
      v-model="from"
      date-format="dd/mm/yy"
      placeholder="Du…"
      show-icon
      class="!h-9"
      aria-label="Date de début de la période"
      :max-date="to ?? undefined"
    />
    <span class="text-[12px] text-surface-400">→</span>
    <DatePicker
      v-model="to"
      date-format="dd/mm/yy"
      placeholder="Au…"
      show-icon
      class="!h-9"
      aria-label="Date de fin de la période"
      :min-date="from ?? undefined"
    />
    <Button
      v-if="hasFilter"
      severity="secondary"
      size="small"
      aria-label="Réinitialiser la période"
      @click="reset"
    >
      <template #icon>
        <X
          :size="14"
          :stroke-width="2"
        />
      </template>
      <span class="ml-1">Tout l'historique</span>
    </Button>
  </div>
</template>
