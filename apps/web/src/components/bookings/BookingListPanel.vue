<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import {
  Calendar,
  Plus,
  RefreshCw,
  Repeat,
  Trash2,
  TriangleAlert,
} from 'lucide-vue-next'
import Pill from '@/components/ui/Pill.vue'
import { useBookingsStore, type SeriesSummary } from '@/stores/bookings'
import type { BookingRow } from '@/repositories/bookings.repo'
import type { BookingStatus, RecurrenceRule, SlotType } from '@club-app/shared-types'
import DeleteSeriesConfirmDialog from './DeleteSeriesConfirmDialog.vue'
import { formatDateShort } from '@/utils/dates'

/**
 * `create` est émis quand l'utilisateur clique sur "Nouvelle réservation".
 * Le parent (`Bookings.vue`) ouvre alors le `BookingFormDialog` partagé —
 * on évite de monter une seconde instance du dialog dans ce composant.
 */
const emit = defineEmits<{
  (e: 'create'): void
}>()

/**
 * Panneau "Liste" de l'écran /bookings — affiche toutes les réservations
 * (séries récurrentes + one-shots) de la saison active avec actions de
 * suppression.
 *
 * Couches : le panneau passe exclusivement par le store Pinia
 * (`useBookingsStore`) ; aucune lecture/écriture Firestore directe ici.
 *
 * Le store charge les données via `loadAllBookingsAndSeries()` — déclenché
 * à `onMounted` (ne se charge donc que lorsque le TabPanel "Liste" est
 * effectivement monté).
 */

const store = useBookingsStore()

// ---------------------------------------------------------------------------
// Initial load + refresh
// ---------------------------------------------------------------------------

onMounted(async () => {
  // Le store gère ses propres erreurs (catch + listError). Pas besoin de
  // try/catch local — on lit `listError` réactivement plus bas.
  await store.loadAllBookingsAndSeries()
})

async function refresh(): Promise<void> {
  await store.loadAllBookingsAndSeries()
}

// ---------------------------------------------------------------------------
// Local error banner — utilisée pour les erreurs de suppression que le store
// remonte via `listError`. Bandeau persistant tant que l'utilisateur ne
// déclenche pas une nouvelle action ou un refresh.
// ---------------------------------------------------------------------------

const localError = ref<string | null>(null)

/** Affiche `msg` 5 secondes puis efface. */
function flashError(msg: string): void {
  localError.value = msg
  window.setTimeout(() => {
    if (localError.value === msg) localError.value = null
  }, 5000)
}

// ---------------------------------------------------------------------------
// One-shots — filtre les bookings sans seriesId.
// Tri DESC sur la date (les plus récents d'abord).
// ---------------------------------------------------------------------------

const oneShotBookings = computed<BookingRow[]>(() => {
  return store.allBookings
    .filter((b: BookingRow) => b.seriesId === null)
    .slice()
    .sort((a: BookingRow, b: BookingRow) => b.date.seconds - a.date.seconds)
})

// ---------------------------------------------------------------------------
// Séries — tri ASC sur la startDate (chronologique).
// ---------------------------------------------------------------------------

const sortedSeries = computed<SeriesSummary[]>(() => {
  return store.allSeries.slice().sort(
    (a: SeriesSummary, b: SeriesSummary) =>
      a.series.startDate.seconds - b.series.startDate.seconds,
  )
})

// ---------------------------------------------------------------------------
// Formatters — délègue au helper central `formatDateShort` (DD/MM/YYYY fr-CH).
// ---------------------------------------------------------------------------

function formatBookingDate(b: BookingRow): string {
  return formatDateShort(b.date as unknown as { seconds: number })
}

function formatTimestamp(ts: { seconds: number }): string {
  return formatDateShort(ts)
}

// ---------------------------------------------------------------------------
// Récurrence → libellé humain (court).
// ---------------------------------------------------------------------------

const WEEKDAY_LABELS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

function nthLabel(n: number): string {
  if (n === 1) return '1er'
  return `${n}e`
}

function recurrenceLabel(series: SeriesSummary): string {
  const rule: RecurrenceRule = series.series.recurrence
  if (rule.frequency === 'weekly') {
    if (rule.weekday !== null) {
      const wd = WEEKDAY_LABELS[rule.weekday] ?? ''
      return `Chaque semaine — ${wd}`
    }
    return 'Chaque semaine'
  }
  // monthly
  if (rule.monthlyMode === 'dayOfMonth') {
    // Quantième tiré du jour de startDate.
    const day = new Date(series.series.startDate.seconds * 1000).getDate()
    return `Chaque mois — le ${day}`
  }
  if (rule.monthlyMode === 'nthWeekday') {
    const d = new Date(series.series.startDate.seconds * 1000)
    const nth = Math.floor((d.getDate() - 1) / 7) + 1
    const wd = WEEKDAY_LABELS[d.getDay()] ?? ''
    return `Chaque mois — ${nthLabel(nth)} ${wd}`
  }
  return 'Récurrent'
}

// ---------------------------------------------------------------------------
// Status pill — copie locale du helper de Bookings.vue (pas exporté).
// ---------------------------------------------------------------------------

function statusVariant(status: BookingStatus): 'emerald' | 'rose' | 'slate' {
  if (status === 'scheduled') return 'emerald'
  if (status === 'cancelled') return 'rose'
  return 'slate'
}

function statusLabel(status: BookingStatus): string {
  if (status === 'scheduled') return 'Planifié'
  if (status === 'cancelled') return 'Annulé'
  return 'Libéré'
}

/**
 * Libellé FR d'un `SlotType`. Utilisé en fallback dans le tableau quand
 * `teamName` est nul (sinon le code interne `training` / `match_home` /
 * etc. fuiterait à l'écran).
 */
function slotTypeLabel(t: SlotType): string {
  switch (t) {
    case 'training':
      return 'Entraînement'
    case 'match_home':
      return 'Match à domicile'
    case 'match_away':
      return 'Match à l\'extérieur'
    case 'reserve':
      return 'Réserve'
    case 'custom':
    default:
      return 'Personnalisé'
  }
}

// ---------------------------------------------------------------------------
// Delete one-shot — dialog simple inline.
// ---------------------------------------------------------------------------

const showDeleteBookingDialog = ref<boolean>(false)
const bookingToDelete = ref<BookingRow | null>(null)

function askDeleteBooking(b: BookingRow): void {
  bookingToDelete.value = b
  showDeleteBookingDialog.value = true
}

async function confirmDeleteBooking(): Promise<void> {
  const b = bookingToDelete.value
  if (!b) return
  showDeleteBookingDialog.value = false
  try {
    await store.hardDeleteBookingAction(b.id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur de suppression'
    flashError(msg)
  } finally {
    bookingToDelete.value = null
  }
}

function cancelDeleteBooking(): void {
  showDeleteBookingDialog.value = false
  bookingToDelete.value = null
}

// ---------------------------------------------------------------------------
// Delete series — dialog dédié avec récap impact.
// ---------------------------------------------------------------------------

const showDeleteSeriesDialog = ref<boolean>(false)
const seriesToDelete = ref<SeriesSummary | null>(null)

function askDeleteSeries(s: SeriesSummary): void {
  seriesToDelete.value = s
  showDeleteSeriesDialog.value = true
}

async function confirmDeleteSeries(): Promise<void> {
  const s = seriesToDelete.value
  if (!s) return
  try {
    await store.deleteSeries(s.series.id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur de suppression de la série'
    flashError(msg)
  } finally {
    seriesToDelete.value = null
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header : titre + actions (nouvelle réservation + rafraîchir) -->
    <div class="flex items-center justify-between gap-2 flex-wrap">
      <div>
        <h2 class="text-[15px] font-semibold">
          Toutes les réservations
        </h2>
        <div class="text-[12px] text-surface-500">
          Saison active — séries récurrentes et réservations individuelles.
        </div>
      </div>
      <div class="flex items-center gap-2">
        <Button
          severity="primary"
          size="small"
          aria-label="Nouvelle réservation"
          @click="emit('create')"
        >
          <Plus
            :size="14"
            :stroke-width="2"
          />
          <span class="ml-1.5">Nouvelle réservation</span>
        </Button>
        <Button
          severity="secondary"
          size="small"
          outlined
          :disabled="store.listLoading"
          @click="refresh"
        >
          <RefreshCw
            :size="14"
            :stroke-width="2"
          />
          <span class="ml-1.5">Rafraîchir</span>
        </Button>
      </div>
    </div>

    <!-- Error banner — listError (store) ou localError (post-action) -->
    <div
      v-if="store.listError || localError"
      class="card border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700 flex items-center gap-2"
    >
      <TriangleAlert
        :size="14"
        :stroke-width="2"
      />
      {{ store.listError ?? localError }}
    </div>

    <!-- ============ Séries récurrentes ============ -->
    <section class="space-y-2">
      <h3 class="text-[13px] font-semibold flex items-center gap-1.5">
        <Repeat
          :size="14"
          :stroke-width="2"
          class="text-surface-500"
        />
        Séries récurrentes
        <span class="text-[12px] font-normal text-surface-500">
          ({{ sortedSeries.length }})
        </span>
      </h3>
      <div class="card overflow-hidden">
        <DataTable
          :value="sortedSeries"
          :loading="store.listLoading"
          data-key="series.id"
          striped-rows
          size="small"
          :pt="{ table: { class: 'text-[13px]' } }"
        >
          <template #empty>
            <div class="text-center py-6 text-[13px] text-surface-500">
              Aucune série récurrente.
            </div>
          </template>

          <Column
            header="Type"
            :style="{ width: '110px' }"
          >
            <template #body>
              <Pill variant="violet">
                <Repeat
                  :size="11"
                  :stroke-width="2"
                />
                Récurrent
              </Pill>
            </template>
          </Column>

          <Column header="Titre">
            <template #body="{ data }: { data: SeriesSummary }">
              <div class="font-medium truncate">
                {{ data.series.title }}
              </div>
            </template>
          </Column>

          <Column header="Venue · Court">
            <template #body="{ data }: { data: SeriesSummary }">
              <div class="text-[12px] text-surface-600 font-mono truncate">
                {{ data.series.venueId }} / {{ data.series.courtId }}
              </div>
            </template>
          </Column>

          <Column header="Plage">
            <template #body="{ data }: { data: SeriesSummary }">
              <div class="text-[12px] flex items-center gap-1.5">
                <Calendar
                  :size="12"
                  :stroke-width="2"
                  class="text-surface-400"
                />
                <span>
                  {{ formatTimestamp(data.series.startDate) }}
                  →
                  {{ formatTimestamp(data.series.endDate) }}
                </span>
              </div>
              <div class="text-[11px] num text-surface-500 mt-0.5">
                {{ data.series.startTime }} – {{ data.series.endTime }}
              </div>
            </template>
          </Column>

          <Column header="Récurrence">
            <template #body="{ data }: { data: SeriesSummary }">
              <span class="text-[12px]">{{ recurrenceLabel(data) }}</span>
            </template>
          </Column>

          <Column header="Occurrences">
            <template #body="{ data }: { data: SeriesSummary }">
              <div class="text-[12px]">
                <span class="font-semibold">{{ data.upcomingCount }}</span>
                <span class="text-surface-500"> à venir</span>
                <span class="text-surface-400"> · </span>
                <span class="font-semibold">{{ data.pastCount }}</span>
                <span class="text-surface-500"> passées</span>
              </div>
            </template>
          </Column>

          <Column
            header="Actions"
            :style="{ width: '120px' }"
          >
            <template #body="{ data }: { data: SeriesSummary }">
              <Button
                severity="danger"
                size="small"
                outlined
                aria-label="Supprimer la série"
                @click="askDeleteSeries(data)"
              >
                <Trash2
                  :size="13"
                  :stroke-width="2"
                />
                <span class="ml-1.5">Supprimer</span>
              </Button>
            </template>
          </Column>
        </DataTable>
      </div>
    </section>

    <!-- ============ Réservations individuelles ============ -->
    <section class="space-y-2">
      <h3 class="text-[13px] font-semibold flex items-center gap-1.5">
        <Calendar
          :size="14"
          :stroke-width="2"
          class="text-surface-500"
        />
        Réservations individuelles
        <span class="text-[12px] font-normal text-surface-500">
          ({{ oneShotBookings.length }})
        </span>
      </h3>
      <div class="card overflow-hidden">
        <DataTable
          :value="oneShotBookings"
          :loading="store.listLoading"
          data-key="id"
          striped-rows
          size="small"
          paginator
          :rows="20"
          :rows-per-page-options="[10, 20, 50, 100]"
          :pt="{ table: { class: 'text-[13px]' } }"
        >
          <template #empty>
            <div class="text-center py-6 text-[13px] text-surface-500">
              Aucune réservation individuelle.
            </div>
          </template>

          <Column
            header="Date"
            :style="{ width: '120px' }"
          >
            <template #body="{ data }: { data: BookingRow }">
              <span class="text-[12px] num">{{ formatBookingDate(data) }}</span>
            </template>
          </Column>

          <Column
            header="Heure"
            :style="{ width: '130px' }"
          >
            <template #body="{ data }: { data: BookingRow }">
              <span class="num text-[12px]">{{ data.startTime }} – {{ data.endTime }}</span>
            </template>
          </Column>

          <Column header="Titre / Équipe">
            <template #body="{ data }: { data: BookingRow }">
              <div class="font-medium truncate">
                {{ data.teamName ?? slotTypeLabel(data.slotType) }}
              </div>
            </template>
          </Column>

          <Column header="Venue · Court">
            <template #body="{ data }: { data: BookingRow }">
              <div class="text-[12px] text-surface-600 truncate">
                {{ data.venueName ?? data.venueId }}
                <span class="text-surface-400">·</span>
                {{ data.courtName ?? data.courtId }}
              </div>
            </template>
          </Column>

          <Column
            header="Statut"
            :style="{ width: '110px' }"
          >
            <template #body="{ data }: { data: BookingRow }">
              <Pill :variant="statusVariant(data.status)">
                {{ statusLabel(data.status) }}
              </Pill>
            </template>
          </Column>

          <Column
            header="Actions"
            :style="{ width: '120px' }"
          >
            <template #body="{ data }: { data: BookingRow }">
              <Button
                severity="danger"
                size="small"
                outlined
                aria-label="Supprimer la réservation"
                @click="askDeleteBooking(data)"
              >
                <Trash2
                  :size="13"
                  :stroke-width="2"
                />
                <span class="ml-1.5">Supprimer</span>
              </Button>
            </template>
          </Column>
        </DataTable>
      </div>
    </section>

    <!-- ============ Confirmation : suppression d'un one-shot ============ -->
    <Dialog
      v-model:visible="showDeleteBookingDialog"
      modal
      :draggable="false"
      :style="{ width: '420px' }"
      header="Supprimer la réservation"
    >
      <div class="space-y-3 pt-1">
        <p class="text-[13px] text-surface-700">
          Confirmez-vous la suppression de cette réservation&nbsp;?
          Cette action est irréversible.
        </p>
        <div
          v-if="bookingToDelete"
          class="card p-3 space-y-1 text-[12px]"
        >
          <div class="font-medium">
            {{ bookingToDelete.teamName ?? slotTypeLabel(bookingToDelete.slotType) }}
          </div>
          <div class="text-surface-600 num">
            {{ formatBookingDate(bookingToDelete) }}
            · {{ bookingToDelete.startTime }} – {{ bookingToDelete.endTime }}
          </div>
          <div class="text-surface-500">
            {{ bookingToDelete.venueName ?? bookingToDelete.venueId }}
            · {{ bookingToDelete.courtName ?? bookingToDelete.courtId }}
          </div>
        </div>
      </div>
      <template #footer>
        <Button
          label="Annuler"
          severity="secondary"
          text
          @click="cancelDeleteBooking"
        />
        <Button
          label="Supprimer"
          severity="danger"
          @click="confirmDeleteBooking"
        />
      </template>
    </Dialog>

    <!-- ============ Confirmation : suppression de série ============ -->
    <DeleteSeriesConfirmDialog
      v-model:visible="showDeleteSeriesDialog"
      :series="seriesToDelete"
      @confirm="confirmDeleteSeries"
    />
  </div>
</template>
