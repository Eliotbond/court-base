<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  History,
  Link2,
  Locate,
  MapPin,
  TriangleAlert,
} from 'lucide-vue-next'
import Button from 'primevue/button'
import Drawer from 'primevue/drawer'
import Select from 'primevue/select'
import { useBookingsStore } from '@/stores/bookings'
import type { BookingRow } from '@/repositories/bookings.repo'
import type {
  BookingActionLogEntry,
  BookingCancelReason,
  SlotType,
} from '@club-app/shared-types'
import Pill from '@/components/ui/Pill.vue'
import SlotCell from '@/components/ui/SlotCell.vue'

const store = useBookingsStore()

onMounted(async () => {
  await store.loadActiveContext()
  if (store.activeSeasonId) {
    await store.loadWeek(store.currentWeekStart)
  }
})

// ---------------------------------------------------------------------------
// Time slot rows — 06:00..22:00 par tranches de 30 min.
//
// La grille affiche un slot par 30 min ; une cellule de booking peut
// occuper plusieurs lignes consécutives (rowSpan = durée / 30) — calculé
// par `cellFor`. On indexe les bookings par `courtId` + `"HH:MM-HH:MM"`
// dans le store.
// ---------------------------------------------------------------------------

const SLOT_STEP_MINUTES = 30
const SLOT_START_HOUR = 6
const SLOT_END_HOUR = 22

interface TimeRow {
  /** "HH:MM" début. */
  start: string
  /** Minutes depuis 00:00. */
  startMinutes: number
}

const timeRows = computed<TimeRow[]>(() => {
  const rows: TimeRow[] = []
  for (let h = SLOT_START_HOUR; h < SLOT_END_HOUR; h += 1) {
    for (let m = 0; m < 60; m += SLOT_STEP_MINUTES) {
      const start = `${pad2(h)}:${pad2(m)}`
      rows.push({ start, startMinutes: h * 60 + m })
    }
  }
  return rows
})

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function timeToMinutes(hhmm: string): number {
  const parts = hhmm.split(':')
  if (parts.length !== 2) return 0
  const h = Number(parts[0])
  const m = Number(parts[1])
  if (Number.isNaN(h) || Number.isNaN(m)) return 0
  return h * 60 + m
}

// ---------------------------------------------------------------------------
// Day grouping — colonnes du grid : (court, dayOfWeek).
//
// Le mockup montre une vue hebdomadaire ; chaque court est subdivisé en 7
// jours. Pour la lisibilité MVP, on garde un layout simplifié : une seule
// "journée par court" affichée à la fois, sélectionnée via le picker de
// jour. Évite un grid à 50+ colonnes sur écran 1280px.
// ---------------------------------------------------------------------------

interface DayTab {
  /** 0 = lundi, …, 6 = dimanche (offset depuis `currentWeekStart`). */
  offset: number
  /** Libellé court "Lun 12". */
  label: string
  /** Date 00:00 local du jour. */
  date: Date
}

const dayTabs = computed<DayTab[]>(() => {
  const tabs: DayTab[] = []
  const dayFormatter = new Intl.DateTimeFormat('fr-CH', {
    weekday: 'short',
    day: '2-digit',
  })
  for (let i = 0; i < 7; i += 1) {
    const date = new Date(store.currentWeekStart)
    date.setDate(date.getDate() + i)
    const raw = dayFormatter.format(date)
    const pretty = raw.charAt(0).toUpperCase() + raw.slice(1)
    tabs.push({ offset: i, label: pretty, date })
  }
  return tabs
})

const selectedDayOffset = ref<number>(currentDayOffsetFromMonday())

function currentDayOffsetFromMonday(): number {
  const today = new Date()
  const day = today.getDay() // 0 = dimanche
  return day === 0 ? 6 : day - 1
}

function selectDay(offset: number): void {
  selectedDayOffset.value = offset
}

const selectedDate = computed<Date>(() => {
  const d = new Date(store.currentWeekStart)
  d.setDate(d.getDate() + selectedDayOffset.value)
  return d
})

/** Bookings du jour sélectionné (filtrés par venue si filtre actif). */
const dayBookings = computed<BookingRow[]>(() => {
  const target = selectedDate.value
  const targetTs = startOfDay(target).getTime()
  const targetTsEnd = endOfDay(target).getTime()
  const venueId = store.venueFilter
  return store.bookings.filter((b) => {
    const t = bookingDateMillis(b)
    if (t < targetTs || t > targetTsEnd) return false
    if (venueId && b.venueId !== venueId) return false
    return true
  })
})

function bookingDateMillis(b: BookingRow): number {
  // Le Timestamp de shared-types est neutre ({seconds, nanoseconds}) mais
  // Firestore renvoie un vrai Timestamp avec `.toDate()`. On utilise la
  // valeur `seconds` qui existe sur les deux représentations.
  // any: le type neutre exporté par shared-types n'exposant pas `toDate`,
  // on lit `seconds` directement (présent sur le Timestamp Firestore SDK aussi).
  const ts = b.date as unknown as { seconds: number; toDate?: () => Date }
  if (typeof ts.toDate === 'function') return ts.toDate().getTime()
  return ts.seconds * 1000
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function endOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

// ---------------------------------------------------------------------------
// Per-(court, time-row) lookup — pour chaque (court, time-row) on demande
// si un booking commence à ce slot. La cellule porte alors `rowSpan` =
// durée / 30 min. Les rangées suivantes sont marquées "occupées" pour ne
// pas re-rendre une cellule vide par-dessus.
// ---------------------------------------------------------------------------

interface CellInfo {
  booking: BookingRow | null
  /** Nombre de rangées que la cellule occupe (1 si vide ou < 30 min). */
  rowSpan: number
  /** Si `true`, la cellule est couverte par une cellule au-dessus → ne pas afficher. */
  covered: boolean
}

/**
 * Renvoie un tableau [court][rowIndex] → CellInfo, précalculé pour éviter
 * un recompute par cellule pendant le rendu.
 */
const cellMatrix = computed<Map<string, CellInfo[]>>(() => {
  const matrix = new Map<string, CellInfo[]>()
  const rows = timeRows.value
  for (const venue of store.filteredVenues) {
    for (const court of venue.courts) {
      const courtCells: CellInfo[] = rows.map(() => ({
        booking: null,
        rowSpan: 1,
        covered: false,
      }))
      // Sélectionne les bookings du court pour le jour affiché.
      const courtBookings = dayBookings.value.filter((b) => b.courtId === court.id)
      for (const b of courtBookings) {
        const startMin = timeToMinutes(b.startTime)
        const endMin = timeToMinutes(b.endTime)
        const rowIdx = rows.findIndex((r) => r.startMinutes === startMin)
        if (rowIdx < 0) continue
        const span = Math.max(1, Math.round((endMin - startMin) / SLOT_STEP_MINUTES))
        courtCells[rowIdx] = { booking: b, rowSpan: span, covered: false }
        for (let i = 1; i < span && rowIdx + i < courtCells.length; i += 1) {
          courtCells[rowIdx + i] = { booking: null, rowSpan: 1, covered: true }
        }
      }
      matrix.set(court.id, courtCells)
    }
  }
  return matrix
})

// ---------------------------------------------------------------------------
// Slot kind mapping — la cellule cancelled/freed est traitée à part par la
// vue (overlay muted/struck), donc on map juste le `slotType` pour les
// scheduled. `SlotCell` accepte 'training' | 'match_home' | 'match_away'
// | 'reserve' | 'custom' | 'empty'.
// ---------------------------------------------------------------------------

function cellKind(b: BookingRow | null): SlotType | 'empty' {
  if (!b) return 'empty'
  return b.slotType
}

function cancelReasonLabel(reason: BookingCancelReason | null): string {
  if (!reason) return ''
  const map: Record<BookingCancelReason, string> = {
    closure: 'Fermeture',
    holiday: 'Jour férié',
    manual: 'Annulation manuelle',
    match_home: 'Match home',
    match_away: 'Match away',
    coach_cancel: 'Annulé par coach',
  }
  return map[reason]
}

function slotTypeLabel(t: SlotType): string {
  switch (t) {
    case 'training':
      return 'Training'
    case 'match_home':
      return 'Match home'
    case 'match_away':
      return 'Match away'
    case 'reserve':
      return 'Reserve'
    case 'custom':
    default:
      return 'Custom'
  }
}

function slotTypePillVariant(
  t: SlotType,
): 'emerald' | 'violet' | 'sky' | 'slate' | 'amber' {
  switch (t) {
    case 'match_home':
      return 'emerald'
    case 'match_away':
      return 'violet'
    case 'training':
      return 'sky'
    case 'reserve':
      return 'slate'
    case 'custom':
    default:
      return 'amber'
  }
}

// ---------------------------------------------------------------------------
// Venue filter — options du Select.
// ---------------------------------------------------------------------------

interface VenueOption {
  id: string | null
  label: string
}

const venueOptions = computed<VenueOption[]>(() => {
  const all: VenueOption = { id: null, label: 'Tous les venues' }
  const list = store.venues.map<VenueOption>((v) => ({ id: v.id, label: v.name }))
  return [all, ...list]
})

// ---------------------------------------------------------------------------
// Drawer — sélection d'une cellule de booking.
// ---------------------------------------------------------------------------

const selectedBookingId = ref<string | null>(null)

const drawerOpen = computed<boolean>({
  get: () => selectedBookingId.value !== null,
  set: (v: boolean) => {
    if (!v) selectedBookingId.value = null
  },
})

const selectedBooking = computed<BookingRow | null>(() => {
  const id = selectedBookingId.value
  if (!id) return null
  return store.bookings.find((b) => b.id === id) ?? null
})

function openBooking(b: BookingRow): void {
  selectedBookingId.value = b.id
}

// ---------------------------------------------------------------------------
// Formatters — date drawer.
// ---------------------------------------------------------------------------

const longDateFormatter = new Intl.DateTimeFormat('fr-CH', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

function formatLongDate(b: BookingRow): string {
  const ms = bookingDateMillis(b)
  const raw = longDateFormatter.format(new Date(ms))
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

function formatActionLogTime(entry: BookingActionLogEntry): string {
  // any: même contrainte que `bookingDateMillis` — l'alias `Timestamp` du
  // package shared-types n'expose pas `.toDate()` ; on lit `seconds`.
  const ts = entry.at as unknown as { seconds: number; toDate?: () => Date }
  const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts.seconds * 1000)
  const fmt = new Intl.DateTimeFormat('fr-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  return fmt.format(d)
}

// ---------------------------------------------------------------------------
// Status pill helper for drawer.
// ---------------------------------------------------------------------------

function statusPill(b: BookingRow): {
  variant: 'emerald' | 'rose' | 'slate'
  label: string
} {
  if (b.status === 'scheduled') return { variant: 'emerald', label: 'Planifié' }
  if (b.status === 'cancelled') return { variant: 'rose', label: 'Annulé' }
  return { variant: 'slate', label: 'Libéré' }
}

// Nombre total de colonnes de courts affichés (somme sur venues filtrés).
const columnsCount = computed<number>(() => {
  let n = 0
  for (const v of store.filteredVenues) n += v.courts.length
  return Math.max(n, 1)
})
</script>

<template>
  <section class="p-6 space-y-4">
    <!-- ================= Toolbar : week nav + venue filter =================== -->
    <div class="flex items-center gap-3 flex-wrap">
      <div class="flex items-center gap-1.5">
        <Button
          severity="secondary"
          size="small"
          outlined
          aria-label="Semaine précédente"
          @click="store.goToPreviousWeek"
        >
          <ChevronLeft
            :size="14"
            :stroke-width="2"
          />
        </Button>
        <Button
          severity="secondary"
          size="small"
          outlined
          @click="store.goToToday"
        >
          <Locate
            :size="14"
            :stroke-width="2"
          />
          <span class="ml-1.5">Aujourd'hui</span>
        </Button>
        <Button
          severity="secondary"
          size="small"
          outlined
          aria-label="Semaine suivante"
          @click="store.goToNextWeek"
        >
          <ChevronRight
            :size="14"
            :stroke-width="2"
          />
        </Button>
      </div>

      <div class="flex items-center gap-2 text-[13px] text-surface-600">
        <CalendarDays
          :size="14"
          :stroke-width="2"
          class="text-surface-500"
        />
        <span class="font-medium text-surface-900">{{ store.weekLabel }}</span>
      </div>

      <div class="ml-auto flex items-center gap-2">
        <MapPin
          v-if="store.venues.length > 1"
          :size="14"
          :stroke-width="2"
          class="text-surface-500"
        />
        <Select
          v-if="store.venues.length > 1"
          :model-value="store.venueFilter"
          :options="venueOptions"
          option-label="label"
          option-value="id"
          placeholder="Tous les venues"
          size="small"
          class="!min-w-44"
          @update:model-value="store.setVenueFilter($event)"
        />
      </div>
    </div>

    <!-- ================= Day picker — tabs 7 jours =================== -->
    <div
      class="flex items-center gap-1.5 flex-wrap"
      role="tablist"
      aria-label="Jour de la semaine"
    >
      <button
        v-for="tab in dayTabs"
        :key="tab.offset"
        type="button"
        role="tab"
        :aria-selected="selectedDayOffset === tab.offset"
        class="px-3 h-8 rounded-md2 text-[12px] font-medium border transition-colors"
        :class="
          selectedDayOffset === tab.offset
            ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
            : 'bg-white border-surface-200 text-surface-700 hover:bg-surface-50'
        "
        @click="selectDay(tab.offset)"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- ================= Empty state — pas de saison active =================== -->
    <div
      v-if="!store.loading && !store.activeSeasonId"
      class="card p-10 text-center flex flex-col items-center gap-2"
    >
      <span
        class="w-10 h-10 rounded-full bg-surface-100 inline-flex items-center justify-center text-surface-500"
      >
        <CalendarDays
          :size="18"
          :stroke-width="2"
        />
      </span>
      <div class="text-[14px] font-semibold">
        Aucune saison active
      </div>
      <div class="text-[12px] text-surface-500 max-w-md">
        Activez une saison pour générer les bookings et les afficher dans le planning hebdomadaire.
      </div>
      <RouterLink
        to="/seasons"
        class="btn btn-primary btn-sm mt-2"
      >
        Aller aux saisons
      </RouterLink>
    </div>

    <!-- ================= Empty state — saison active mais aucun venue =================== -->
    <div
      v-else-if="!store.loading && store.activeSeasonId && store.venues.length === 0"
      class="card p-10 text-center flex flex-col items-center gap-2"
    >
      <span
        class="w-10 h-10 rounded-full bg-surface-100 inline-flex items-center justify-center text-surface-500"
      >
        <MapPin
          :size="18"
          :stroke-width="2"
        />
      </span>
      <div class="text-[14px] font-semibold">
        Aucun venue configuré
      </div>
      <div class="text-[12px] text-surface-500 max-w-md">
        Ajoutez au moins un venue avec des courts depuis les paramètres pour afficher le planning.
      </div>
    </div>

    <!-- ================= Loading skeleton =================== -->
    <div
      v-else-if="store.loading && store.bookings.length === 0"
      class="card p-4 overflow-hidden"
      aria-busy="true"
    >
      <div class="grid grid-cols-[64px_repeat(4,minmax(140px,1fr))] gap-2">
        <div
          v-for="i in 60"
          :key="`skel-${i}`"
          class="h-9 bg-surface-100 animate-pulse rounded-md2"
        />
      </div>
    </div>

    <!-- ================= Grid =================== -->
    <div
      v-else
      class="card overflow-auto"
    >
      <div
        class="grid"
        :style="{
          gridTemplateColumns: `64px repeat(${columnsCount}, minmax(140px, 1fr))`,
        }"
      >
        <!-- Header row : empty corner + (venue · court) labels -->
        <div
          class="sticky top-0 left-0 z-30 bg-surface-50 border-b border-r border-surface-200 h-12 flex items-center justify-center text-[11px] text-surface-500"
        >
          <Clock
            :size="14"
            :stroke-width="2"
          />
        </div>
        <template
          v-for="venue in store.filteredVenues"
          :key="venue.id"
        >
          <div
            v-for="court in venue.courts"
            :key="`hdr-${venue.id}-${court.id}`"
            class="sticky top-0 z-20 bg-surface-50 border-b border-surface-200 h-12 px-3 flex flex-col justify-center"
          >
            <div class="text-[10px] uppercase tracking-wide text-surface-400 truncate">
              {{ venue.name }}
            </div>
            <div class="text-[12px] font-semibold truncate">
              {{ court.name }}
            </div>
          </div>
        </template>

        <!-- Body rows : time label + cellules par court -->
        <template
          v-for="(row, rowIndex) in timeRows"
          :key="`row-${row.start}`"
        >
          <!-- Sticky first column : libellé horaire -->
          <div
            class="sticky left-0 z-10 bg-white border-r border-surface-100 h-9 flex items-start justify-end pr-2 pt-0.5 text-[10px] font-mono text-surface-400"
            :class="row.start.endsWith(':00') ? 'border-t border-surface-200' : ''"
          >
            <span v-if="row.start.endsWith(':00')">{{ row.start }}</span>
          </div>

          <!-- Cellules courts -->
          <template
            v-for="venue in store.filteredVenues"
            :key="`body-${row.start}-${venue.id}`"
          >
            <div
              v-for="court in venue.courts"
              :key="`cell-${row.start}-${venue.id}-${court.id}`"
              class="h-9 border-surface-100 p-0.5"
              :class="[
                row.start.endsWith(':00') ? 'border-t border-surface-200' : 'border-t border-dashed',
                cellMatrix.get(court.id)?.[rowIndex]?.covered ? 'border-t-0' : '',
              ]"
              :style="{
                gridRow: `span ${cellMatrix.get(court.id)?.[rowIndex]?.rowSpan ?? 1}`,
              }"
            >
              <template v-if="!cellMatrix.get(court.id)?.[rowIndex]?.covered">
                <div
                  v-if="!cellMatrix.get(court.id)?.[rowIndex]?.booking"
                  class="h-full w-full"
                />
                <SlotCell
                  v-else
                  :kind="cellKind(cellMatrix.get(court.id)?.[rowIndex]?.booking ?? null)"
                  class="h-full"
                  :class="
                    cellMatrix.get(court.id)?.[rowIndex]?.booking?.status === 'cancelled'
                      ? 'opacity-50 line-through'
                      : cellMatrix.get(court.id)?.[rowIndex]?.booking?.status === 'freed'
                        ? 'opacity-70 italic'
                        : ''
                  "
                  @click="
                    openBooking(
                      cellMatrix.get(court.id)?.[rowIndex]?.booking as BookingRow,
                    )
                  "
                >
                  <div class="flex flex-col gap-0.5">
                    <div class="font-semibold truncate">
                      {{
                        cellMatrix.get(court.id)?.[rowIndex]?.booking?.teamName
                          ?? slotTypeLabel(cellKind(cellMatrix.get(court.id)?.[rowIndex]?.booking ?? null) as SlotType)
                      }}
                    </div>
                    <div class="num text-[10px] opacity-80">
                      {{ cellMatrix.get(court.id)?.[rowIndex]?.booking?.startTime }}–{{ cellMatrix.get(court.id)?.[rowIndex]?.booking?.endTime }}
                    </div>
                  </div>
                </SlotCell>
              </template>
            </div>
          </template>
        </template>
      </div>
    </div>

    <!-- ================= Error banner =================== -->
    <div
      v-if="store.error"
      class="card border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700 flex items-center gap-2"
    >
      <TriangleAlert
        :size="14"
        :stroke-width="2"
      />
      {{ store.error }}
    </div>

    <!-- ================= Drawer : détail booking =================== -->
    <Drawer
      v-model:visible="drawerOpen"
      position="right"
      :show-close-icon="true"
      :pt="{ root: { style: 'width: 480px; max-width: 100vw;' } }"
      aria-label="Détail du booking"
    >
      <template #container="{ closeCallback }">
        <div
          v-if="selectedBooking"
          class="flex flex-col h-full"
        >
          <!-- Header -->
          <header class="flex items-start justify-between gap-3 px-5 py-4 border-b border-surface-200">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap mb-1">
                <Pill :variant="slotTypePillVariant(selectedBooking.slotType)">
                  {{ slotTypeLabel(selectedBooking.slotType) }}
                </Pill>
                <Pill :variant="statusPill(selectedBooking).variant">
                  {{ statusPill(selectedBooking).label }}
                </Pill>
                <Pill
                  v-if="selectedBooking.isCombinedCourtEvent"
                  variant="amber"
                >
                  <Link2
                    :size="11"
                    :stroke-width="2"
                  />
                  Courts combinés
                </Pill>
              </div>
              <div class="text-[15px] font-semibold truncate">
                {{ selectedBooking.teamName ?? slotTypeLabel(selectedBooking.slotType) }}
              </div>
              <div class="text-[12px] text-surface-500">
                {{ formatLongDate(selectedBooking) }}
              </div>
            </div>
            <button
              type="button"
              class="btn btn-ghost btn-sm !px-1.5 text-surface-500"
              aria-label="Fermer"
              @click="closeCallback"
            >
              <span aria-hidden="true">×</span>
            </button>
          </header>

          <!-- Body -->
          <div class="flex-1 overflow-y-auto px-5 py-4 space-y-5 text-[13px]">
            <!-- Date + time block -->
            <section class="space-y-2">
              <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
                Créneau
              </h4>
              <div class="flex items-center gap-2 text-[13px]">
                <Clock
                  :size="14"
                  :stroke-width="2"
                  class="text-surface-500"
                />
                <span class="num font-medium">{{ selectedBooking.startTime }} — {{ selectedBooking.endTime }}</span>
              </div>
              <div class="flex items-center gap-2 text-[13px]">
                <MapPin
                  :size="14"
                  :stroke-width="2"
                  class="text-surface-500"
                />
                <span>
                  {{ selectedBooking.venueName ?? '—' }}
                  <template v-if="selectedBooking.courtName">
                    · {{ selectedBooking.courtName }}
                  </template>
                </span>
              </div>
            </section>

            <!-- Cancel reason — si annulé -->
            <section
              v-if="selectedBooking.status === 'cancelled' && selectedBooking.cancelReason"
              class="card border-rose-200 bg-rose-50 px-3 py-2"
            >
              <div class="text-[11px] uppercase tracking-wide text-rose-500 font-semibold">
                Raison de l'annulation
              </div>
              <div class="text-[13px] text-rose-700 mt-0.5">
                {{ cancelReasonLabel(selectedBooking.cancelReason) }}
              </div>
            </section>

            <!-- Linked bookings — courts combinés -->
            <section
              v-if="selectedBooking.linkedBookingIds.length > 0"
              class="space-y-2"
            >
              <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold flex items-center gap-1.5">
                <Link2
                  :size="12"
                  :stroke-width="2"
                />
                Bookings liés ({{ selectedBooking.linkedBookingIds.length }})
              </h4>
              <ul class="text-[12px] text-surface-600 space-y-1">
                <li
                  v-for="lid in selectedBooking.linkedBookingIds"
                  :key="lid"
                  class="font-mono text-[11px] truncate"
                >
                  {{ lid }}
                </li>
              </ul>
            </section>

            <!-- Action log -->
            <section class="space-y-2">
              <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold flex items-center gap-1.5">
                <History
                  :size="12"
                  :stroke-width="2"
                />
                Historique
              </h4>
              <div
                v-if="selectedBooking.actionLog.length === 0"
                class="text-[12px] text-surface-500"
              >
                Aucune action enregistrée pour ce booking.
              </div>
              <ol
                v-else
                class="space-y-2 border-l border-surface-200 pl-3"
              >
                <li
                  v-for="(entry, idx) in selectedBooking.actionLog"
                  :key="`log-${idx}`"
                  class="relative"
                >
                  <span
                    class="absolute -left-[7px] top-1 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white"
                    aria-hidden="true"
                  />
                  <div class="text-[12px]">
                    <span class="font-medium">{{ entry.action }}</span>
                    <span class="text-surface-500"> · {{ entry.by }}</span>
                  </div>
                  <div class="text-[11px] font-mono text-surface-400">
                    {{ formatActionLogTime(entry) }}
                  </div>
                  <div
                    v-if="entry.note"
                    class="text-[12px] text-surface-600 mt-0.5"
                  >
                    {{ entry.note }}
                  </div>
                </li>
              </ol>
            </section>
          </div>
        </div>
      </template>
    </Drawer>
  </section>
</template>
