<script setup lang="ts">
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import { TriangleAlert } from 'lucide-vue-next'
import type { SeriesSummary } from '@/stores/bookings'
import { formatDateShort } from '@/utils/dates'

/**
 * Dialog de confirmation pour la suppression d'une série de réservations.
 *
 * Sémantique de la suppression : on supprime le doc `/bookingSeries` ainsi
 * que tous les `/bookings` futurs `scheduled` rattachés. Les bookings
 * passés et déjà cancelled sont préservés dans l'historique.
 *
 * Le récap montre à l'utilisateur le nombre d'occurrences impactées
 * (à venir vs. passées) avant validation pour éviter les surprises.
 */

defineProps<{
  visible: boolean
  series: SeriesSummary | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'confirm'): void
}>()

/** Formatte un Timestamp neutre (shared-types) en `DD/MM/YYYY`. */
function formatTimestamp(ts: { seconds: number }): string {
  return formatDateShort(ts)
}

function close(): void {
  emit('update:visible', false)
}

function confirm(): void {
  emit('confirm')
  emit('update:visible', false)
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :draggable="false"
    :style="{ width: '480px' }"
    header="Supprimer la série"
    @update:visible="emit('update:visible', $event)"
  >
    <div
      v-if="series"
      class="space-y-4 pt-1"
    >
      <!-- Avertissement principal -->
      <div class="flex gap-3 p-3 rounded border border-amber-200 bg-amber-50">
        <TriangleAlert
          :size="18"
          :stroke-width="2"
          class="text-amber-600 shrink-0 mt-0.5"
        />
        <div class="text-[13px] text-amber-800 leading-snug">
          Cette action désactivera toutes les occurrences à venir de cette série,
          mais les réservations passées seront conservées dans l'historique.
        </div>
      </div>

      <!-- Récap série -->
      <div class="space-y-2">
        <div class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
          Série concernée
        </div>
        <div class="card p-3 space-y-1.5">
          <div class="text-[14px] font-semibold truncate">
            {{ series.series.title }}
          </div>
          <div class="text-[12px] text-surface-600">
            Du <span class="font-medium">{{ formatTimestamp(series.series.startDate) }}</span>
            au <span class="font-medium">{{ formatTimestamp(series.series.endDate) }}</span>
          </div>
          <div class="text-[12px] text-surface-600 num">
            {{ series.series.startTime }} – {{ series.series.endTime }}
          </div>
        </div>
      </div>

      <!-- Compteurs -->
      <div class="space-y-2">
        <div class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
          Impact
        </div>
        <ul class="text-[13px] space-y-1">
          <li class="flex items-center gap-2">
            <span class="inline-block w-2 h-2 rounded-full bg-rose-500" />
            <span>
              <span class="font-semibold">{{ series.upcomingCount }}</span>
              occurrence{{ series.upcomingCount > 1 ? 's' : '' }} à venir
              seront supprimées
            </span>
          </li>
          <li class="flex items-center gap-2">
            <span class="inline-block w-2 h-2 rounded-full bg-surface-400" />
            <span>
              <span class="font-semibold">{{ series.pastCount }}</span>
              occurrence{{ series.pastCount > 1 ? 's' : '' }} passée{{ series.pastCount > 1 ? 's' : '' }}
              seront conservées
            </span>
          </li>
        </ul>
      </div>
    </div>

    <template #footer>
      <Button
        label="Annuler"
        severity="secondary"
        text
        @click="close"
      />
      <Button
        label="Supprimer la série"
        severity="danger"
        @click="confirm"
      />
    </template>
  </Dialog>
</template>
