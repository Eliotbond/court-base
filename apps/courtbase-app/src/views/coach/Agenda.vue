<script setup lang="ts">
/**
 * Agenda — vue unifiée coach (remplace AllBookings + FreeSlots).
 *
 * 2 tabs :
 *  - Calendrier (default) — vue-cal v4, vue Semaine par défaut sur la plage
 *    soir 17h-22h. Toggles : "Mes équipes / Tout le club" (overlay opacité
 *    0.45 pour les autres équipes), "Soir / Toute la journée", "Afficher
 *    créneaux libres". Click sur un training scheduled "à moi" → dialog
 *    cancel ; click sur un event d'une autre équipe → no-op.
 *  - Liste — reprend AllBookings (filtres temps/équipe/type, lignes denses).
 *
 * Source unique : `useBookingsStore.allBookings` (saison entière du club,
 * 0 re-fetch). Discriminer "mes events" via `isMyBooking` / `myTeamIds`.
 *
 * Mobile-first via `CbMobileShell` + bascule `CbDesktopShell` ≥1024px.
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertTriangle,
  Ban,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Info,
  X,
} from 'lucide-vue-next'
import VueCal, { type VueCalEvent } from 'vue-cal'
import 'vue-cal/dist/vuecal.css'

import CbDesktopShell from '@/components/ui/CbDesktopShell.vue'
import CbEmptyState from '@/components/ui/CbEmptyState.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbPageHead from '@/components/ui/CbPageHead.vue'
import CbPill from '@/components/ui/CbPill.vue'
import { useShellNav } from '@/composables/useShellNav'
import { useViewport } from '@/composables/useViewport'
import { useAuthStore } from '@/stores/auth'
import { useBookingsStore, type BookingRow } from '@/stores/bookings'
import {
  BOOKING_CLASS,
  BOOKING_LABELS,
  BOOKING_PILL_TONE,
  visualKindOf,
  type BookingVisualKind,
} from '@/utils/bookingColors'

const router = useRouter()
const auth = useAuthStore()
const bookingsStore = useBookingsStore()
const { isDesktop } = useViewport()
const { tabs, nav, primaryRoleLabel } = useShellNav()

// ─── State tab principal ─────────────────────────────────────────────

type ActiveTab = 'calendar' | 'list'
const activeTab = ref<ActiveTab>('calendar')

function setActiveTab(tab: ActiveTab): void {
  activeTab.value = tab
}

// ─── Calendrier : state ──────────────────────────────────────────────

type CalView = 'day' | 'week' | 'month'
const activeView = ref<CalView>('week')
const selectedDate = ref<Date>(new Date())

// Toggles UX par défaut (cf. brief)
const showOtherTeams = ref(false)
const showFreed = ref(true)
const eveningOnly = ref(true)

/** Plage horaire : soir compact (17-22) ou journée pratique (6-24). */
const TIME_FROM_EVENING = 17 * 60
const TIME_TO_EVENING = 22 * 60
const TIME_FROM_FULL = 6 * 60
const TIME_TO_FULL = 24 * 60
const TIME_STEP = 30
const TIME_CELL_HEIGHT = 28

const timeFrom = computed(() => (eveningOnly.value ? TIME_FROM_EVENING : TIME_FROM_FULL))
const timeTo = computed(() => (eveningOnly.value ? TIME_TO_EVENING : TIME_TO_FULL))

// ─── Event mapping ───────────────────────────────────────────────────

interface AgendaEvent extends VueCalEvent {
  bookingId: string
  start: Date
  end: Date
  title: string
  class: string
}

/**
 * Sous-libellé "lieu" — format `Grand Pré : Salle 1`. Tronque proprement
 * quand l'une des deux moitiés manque.
 */
function venueCourtLabel(b: BookingRow): string | null {
  if (b.venueName && b.courtName && b.venueName !== b.courtName) {
    return `${b.venueName} : ${b.courtName}`
  }
  return b.venueName ?? b.courtName ?? null
}

/**
 * Titre multi-ligne d'un event de calendrier. La 1re ligne porte l'info
 * principale (équipe / match), la 2e le lieu, la 3e le coach. vue-cal
 * affiche le `\n` car on autorise `white-space: pre-line` côté style scoped.
 */
function bookingShortLabel(b: BookingRow): string {
  const kind = visualKindOf(b)
  const lines: string[] = []

  if (kind === 'match-home') {
    const opp = b.opponentName?.trim()
    lines.push(opp ? `${b.teamName ?? 'Match'} vs ${opp}` : (b.teamName ?? 'Match domicile'))
  } else if (kind === 'match-away') {
    const opp = b.opponentName?.trim()
    lines.push(opp ? `À ${opp}` : 'Match extérieur')
  } else if (kind === 'freed') {
    lines.push(b.teamName ? `Libéré · ${b.teamName}` : 'Créneau libre')
  } else {
    lines.push(b.teamName ? `${BOOKING_LABELS[kind]} · ${b.teamName}` : BOOKING_LABELS[kind])
  }

  const venueCourt = venueCourtLabel(b)
  if (venueCourt) lines.push(venueCourt)

  if (b.coachLabel) lines.push(b.coachLabel)

  return lines.join('\n')
}

/**
 * Liste des events affichés au calendrier — combine les 3 toggles :
 *  - mes events toujours visibles ;
 *  - overlay autres équipes si `showOtherTeams` (classe `cb-bk-other`
 *    posée en plus pour l'opacité réduite) ;
 *  - freed inclus uniquement si `showFreed`.
 */
const displayedEvents = computed<AgendaEvent[]>(() => {
  const result: AgendaEvent[] = []
  for (const b of bookingsStore.allBookings) {
    const kind = visualKindOf(b)
    if (kind === 'freed' && !showFreed.value) continue
    const mine = bookingsStore.isMyBooking(b)
    if (!mine && !showOtherTeams.value) continue
    const classes = BOOKING_CLASS[kind] + (!mine ? ' cb-bk-other' : '')
    result.push({
      bookingId: b.id,
      start: new Date(b.startMs),
      end: new Date(b.endMs),
      title: bookingShortLabel(b),
      class: classes,
    })
  }
  return result
})

// ─── Click handlers calendrier ───────────────────────────────────────

function onEventClick(payload: unknown): void {
  const evt = payload as { bookingId?: string } | null
  if (!evt?.bookingId) return
  const booking = bookingsStore.allBookings.find((b) => b.id === evt.bookingId)
  if (!booking) return
  // Seul mes trainings scheduled proposent l'annulation. Les autres
  // (matchs, autres équipes, freed, cancelled) → no-op silencieux.
  if (
    booking.slotType === 'training' &&
    booking.status === 'scheduled' &&
    bookingsStore.isMyBooking(booking)
  ) {
    openCancelDialog(booking)
  }
}

function onCellClick(payload: unknown): void {
  if (activeView.value !== 'month') return
  const date = payload instanceof Date ? payload : null
  if (!date) return
  selectedDate.value = date
  activeView.value = 'day'
}

// ─── Navigation période / label ─────────────────────────────────────

function startOfWeek(from: Date): Date {
  const d = new Date(from)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

const dayLongFormatter = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})
const dayShortFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
})
const yearFormatter = new Intl.DateTimeFormat('fr-FR', { year: 'numeric' })
const monthFormatter = new Intl.DateTimeFormat('fr-FR', {
  month: 'long',
  year: 'numeric',
})

const periodLabel = computed<string>(() => {
  if (activeView.value === 'day') {
    const raw = dayLongFormatter.format(selectedDate.value)
    return raw.charAt(0).toUpperCase() + raw.slice(1)
  }
  if (activeView.value === 'week') {
    const start = startOfWeek(selectedDate.value)
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    return `${dayShortFormatter.format(start)} – ${dayShortFormatter.format(end)} ${yearFormatter.format(end)}`
  }
  const raw = monthFormatter.format(selectedDate.value)
  return raw.charAt(0).toUpperCase() + raw.slice(1)
})

function shiftDays(deltaDays: number): void {
  const next = new Date(selectedDate.value)
  next.setDate(next.getDate() + deltaDays)
  selectedDate.value = next
}

function goPrevious(): void {
  if (activeView.value === 'day') shiftDays(-1)
  else if (activeView.value === 'week') shiftDays(-7)
  else {
    const next = new Date(selectedDate.value)
    next.setMonth(next.getMonth() - 1)
    selectedDate.value = next
  }
}

function goNext(): void {
  if (activeView.value === 'day') shiftDays(1)
  else if (activeView.value === 'week') shiftDays(7)
  else {
    const next = new Date(selectedDate.value)
    next.setMonth(next.getMonth() + 1)
    selectedDate.value = next
  }
}

function goToday(): void {
  selectedDate.value = new Date()
}

function setView(v: CalView): void {
  activeView.value = v
}

// ─── Dialog annulation ──────────────────────────────────────────────

const cancelDialogOpen = ref(false)
const cancelTarget = ref<BookingRow | null>(null)
const cancelNote = ref('')
const cancelSubmitting = ref(false)
const cancelError = ref('')

function openCancelDialog(b: BookingRow): void {
  cancelTarget.value = b
  cancelNote.value = ''
  cancelError.value = ''
  cancelDialogOpen.value = true
}

function closeCancelDialog(): void {
  cancelDialogOpen.value = false
  cancelTarget.value = null
  cancelNote.value = ''
  cancelError.value = ''
}

const cancelDateLabel = computed<string>(() => {
  const b = cancelTarget.value
  if (!b) return ''
  const raw = dayLongFormatter.format(new Date(b.startMs))
  return raw.charAt(0).toUpperCase() + raw.slice(1)
})

const cancelLocationLabel = computed<string>(() => {
  const b = cancelTarget.value
  if (!b) return ''
  return venueCourtLabel(b) ?? '—'
})

const cancelCoachLabel = computed<string | null>(() =>
  cancelTarget.value?.coachLabel ?? null,
)

async function submitCancel(): Promise<void> {
  const b = cancelTarget.value
  if (!b) return
  const note = cancelNote.value.trim()
  if (note.length > 200) {
    cancelError.value = 'Note trop longue (200 caractères max).'
    return
  }
  cancelSubmitting.value = true
  cancelError.value = ''
  try {
    await bookingsStore.cancelTraining({
      bookingId: b.id,
      note: note ? note : null,
    })
    closeCancelDialog()
    showToast('Créneau libéré. Disponible pour les autres coachs.', 'emerald')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    cancelError.value = message
    showToast(message, 'rose')
  } finally {
    cancelSubmitting.value = false
  }
}

// ─── Toast ──────────────────────────────────────────────────────────

const toastMessage = ref<string>('')
const toastTone = ref<'emerald' | 'amber' | 'rose'>('emerald')
const toastVisible = ref(false)
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(message: string, tone: 'emerald' | 'amber' | 'rose' = 'emerald'): void {
  toastMessage.value = message
  toastTone.value = tone
  toastVisible.value = true
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastVisible.value = false
  }, 3000)
}

function dismissToast(): void {
  toastVisible.value = false
  if (toastTimer) {
    clearTimeout(toastTimer)
    toastTimer = null
  }
}

// ─── Liste : filtres ────────────────────────────────────────────────

type TimeFilter = 'upcoming' | 'past' | 'all'

const TIME_FILTERS: ReadonlyArray<{ id: TimeFilter; label: string }> = [
  { id: 'upcoming', label: 'À venir' },
  { id: 'past', label: 'Passé' },
  { id: 'all', label: 'Tout' },
]

const ALL_KINDS: ReadonlyArray<BookingVisualKind> = [
  'training',
  'match-home',
  'match-away',
  'freed',
  'cancelled',
  'reserve',
  'custom',
]

const activeTimeFilter = ref<TimeFilter>('upcoming')
const selectedTeamId = ref<string>('')
const selectedKinds = ref<Set<BookingVisualKind>>(new Set())

function toggleKind(k: BookingVisualKind): void {
  const next = new Set(selectedKinds.value)
  if (next.has(k)) next.delete(k)
  else next.add(k)
  selectedKinds.value = next
}

function isKindActive(k: BookingVisualKind): boolean {
  return selectedKinds.value.has(k)
}

function setTimeFilter(id: TimeFilter): void {
  activeTimeFilter.value = id
}

function clearFilters(): void {
  selectedTeamId.value = ''
  selectedKinds.value = new Set()
  activeTimeFilter.value = 'upcoming'
}

const allTeams = computed(() => bookingsStore.teams)

const filteredBookings = computed<BookingRow[]>(() => {
  const now = Date.now()
  let arr = bookingsStore.allBookings as readonly BookingRow[]

  if (selectedTeamId.value) {
    const id = selectedTeamId.value
    arr = arr.filter((b) => b.teamId === id)
  }

  if (selectedKinds.value.size > 0) {
    const set = selectedKinds.value
    arr = arr.filter((b) => set.has(visualKindOf(b)))
  }

  if (activeTimeFilter.value === 'upcoming') {
    arr = arr.filter((b) => b.startMs >= now)
  } else if (activeTimeFilter.value === 'past') {
    arr = arr.filter((b) => b.startMs < now)
  }

  return arr.slice().sort((a, b) =>
    activeTimeFilter.value === 'past' ? b.startMs - a.startMs : a.startMs - b.startMs,
  )
})

const hasActiveFilters = computed(
  () =>
    activeTimeFilter.value !== 'upcoming' ||
    selectedTeamId.value !== '' ||
    selectedKinds.value.size > 0,
)

// ─── Helpers liste (date badge, kind labels, styles) ────────────────

const TODAY_MS = (() => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
})()
const TOMORROW_MS = TODAY_MS + 24 * 60 * 60 * 1000

function dateBadge(iso: string): string {
  if (!iso) return ''
  const parts = iso.split('-')
  const y = Number(parts[0] ?? '0')
  const m = Number(parts[1] ?? '1') - 1
  const day = Number(parts[2] ?? '0')
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(day)) return iso
  const d = new Date(y, m, day, 0, 0, 0, 0)
  const t = d.getTime()
  if (t === TODAY_MS) return "Aujourd'hui"
  if (t === TOMORROW_MS) return 'Demain'
  return d.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  })
}

function kindLabel(b: BookingRow): string {
  return BOOKING_LABELS[visualKindOf(b)]
}

function kindTone(b: BookingRow) {
  return BOOKING_PILL_TONE[visualKindOf(b)]
}

function bookingTitle(b: BookingRow): string {
  return b.teamName ?? 'Équipe —'
}

function opponentLine(b: BookingRow): string | null {
  if (!b.opponentName) return null
  if (b.slotType === 'match_home') return `vs ${b.opponentName}`
  if (b.slotType === 'match_away') return `@ ${b.opponentName}`
  return b.opponentName
}

function locationLine(b: BookingRow): string {
  return venueCourtLabel(b) ?? ''
}

function timeLine(b: BookingRow): string {
  return `${b.startTime}–${b.endTime}`
}

function kindBorderColor(b: BookingRow): string {
  switch (visualKindOf(b)) {
    case 'training':
      return 'var(--emerald-500, #10b981)'
    case 'match-home':
      return 'var(--violet-500, #8b5cf6)'
    case 'match-away':
      return 'var(--sky-500, #0ea5e9)'
    case 'reserve':
      return 'var(--slate-400, #94a3b8)'
    case 'custom':
      return 'var(--amber-500, #f59e0b)'
    case 'freed':
      return 'var(--slate-400, #94a3b8)'
    case 'cancelled':
      return 'var(--rose-400, #fb7185)'
  }
}

function rowStyle(b: BookingRow): Record<string, string> {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '12px 12px 12px 12px',
    cursor: b.teamId ? 'pointer' : 'default',
    borderLeft: `4px solid ${kindBorderColor(b)}`,
    opacity: visualKindOf(b) === 'cancelled' ? '0.75' : '1',
  }
}

function onRowClick(b: BookingRow): void {
  if (!b.teamId) return
  router
    .push({ name: 'planning', params: { teamId: b.teamId } })
    .catch((err) => {
      console.warn('[agenda.row] navigation failed', err)
    })
}

// ─── Hydratation ────────────────────────────────────────────────────

onMounted(() => {
  void bookingsStore.loadActiveContext()
})

// ─── Shell user info ────────────────────────────────────────────────

const userDisplayName = computed(() => auth.displayName)
</script>

<template>
  <!-- ─── Desktop ≥1024 ─────────────────────────────────────────── -->
  <CbDesktopShell
    v-if="isDesktop"
    :items="nav"
    brand-name="BC Aigles"
    brand-sub="Saison 2025/26"
    club-initials="BCA"
    :user-name="userDisplayName"
    :user-role="primaryRoleLabel"
  >
    <CbPageHead title="Agenda" :subtitle="periodLabel">
      <template #actions>
        <div class="cb-segmented">
          <button
            type="button"
            :class="{ active: activeTab === 'calendar' }"
            @click="setActiveTab('calendar')"
          >
            Calendrier
          </button>
          <button
            type="button"
            :class="{ active: activeTab === 'list' }"
            @click="setActiveTab('list')"
          >
            Liste
          </button>
        </div>
      </template>
    </CbPageHead>

    <!-- ─── Tab Calendrier ────────────────────────────────────── -->
    <template v-if="activeTab === 'calendar'">
      <div class="agenda-toolbar agenda-toolbar-desktop">
        <div class="cb-segmented">
          <button
            type="button"
            :class="{ active: activeView === 'day' }"
            @click="setView('day')"
          >
            Jour
          </button>
          <button
            type="button"
            :class="{ active: activeView === 'week' }"
            @click="setView('week')"
          >
            Semaine
          </button>
          <button
            type="button"
            :class="{ active: activeView === 'month' }"
            @click="setView('month')"
          >
            Mois
          </button>
        </div>

        <div class="agenda-nav">
          <button
            type="button"
            class="cb-btn outline sm"
            aria-label="Précédent"
            @click="goPrevious"
          >
            <ChevronLeft :size="16" />
          </button>
          <button type="button" class="cb-btn outline sm" @click="goToday">
            Aujourd'hui
          </button>
          <button
            type="button"
            class="cb-btn outline sm"
            aria-label="Suivant"
            @click="goNext"
          >
            <ChevronRight :size="16" />
          </button>
        </div>

        <div class="agenda-toggles">
          <div class="cb-segmented sm">
            <button
              type="button"
              :class="{ active: !showOtherTeams }"
              @click="showOtherTeams = false"
            >
              Mes équipes
            </button>
            <button
              type="button"
              :class="{ active: showOtherTeams }"
              @click="showOtherTeams = true"
            >
              Tout le club
            </button>
          </div>
          <div class="cb-segmented sm">
            <button
              type="button"
              :class="{ active: eveningOnly }"
              @click="eveningOnly = true"
            >
              Soir
            </button>
            <button
              type="button"
              :class="{ active: !eveningOnly }"
              @click="eveningOnly = false"
            >
              Journée
            </button>
          </div>
          <label class="agenda-check">
            <input v-model="showFreed" type="checkbox" />
            <span>Créneaux libres</span>
          </label>
        </div>
      </div>

      <div class="agenda-desktop-body">
        <div class="agenda-card">
          <VueCal
            v-model:active-view="activeView"
            v-model:selected-date="selectedDate"
            :events="displayedEvents"
            :time-from="timeFrom"
            :time-to="timeTo"
            :time-step="TIME_STEP"
            :time-cell-height="TIME_CELL_HEIGHT"
            :hide-title-bar="true"
            :hide-view-selector="true"
            :hide-weekends="false"
            :disable-views="['years', 'year']"
            :events-on-month-view="'short'"
            locale="fr"
            :twelve-hour="false"
            @event-click="onEventClick"
            @cell-click="onCellClick"
          />
        </div>

        <div v-if="bookingsStore.lastError" class="agenda-error">
          <AlertTriangle :size="14" />
          {{ bookingsStore.lastError }}
        </div>
      </div>
    </template>

    <!-- ─── Tab Liste ─────────────────────────────────────────── -->
    <template v-else>
      <div class="ab-toolbar">
        <div class="cb-segmented">
          <button
            v-for="f in TIME_FILTERS"
            :key="f.id"
            type="button"
            :class="{ active: activeTimeFilter === f.id }"
            @click="setTimeFilter(f.id)"
          >
            {{ f.label }}
          </button>
        </div>

        <select
          v-model="selectedTeamId"
          class="cb-input ab-team-select"
          aria-label="Filtrer par équipe"
        >
          <option value="">Toutes les équipes</option>
          <option v-for="t in allTeams" :key="t.id" :value="t.id">
            {{ t.name }}{{ t.categoryName ? ` · ${t.categoryName}` : '' }}
          </option>
        </select>

        <div class="ab-kindrow">
          <button
            v-for="k in ALL_KINDS"
            :key="k"
            type="button"
            class="cb-chip"
            :class="{ active: isKindActive(k) }"
            @click="toggleKind(k)"
          >
            {{ BOOKING_LABELS[k] }}
          </button>
        </div>

        <button
          v-if="hasActiveFilters"
          class="cb-btn ghost sm"
          type="button"
          @click="clearFilters"
        >
          Réinitialiser
        </button>
      </div>

      <div class="ab-list ab-list-desktop">
        <CbEmptyState
          v-if="bookingsStore.loading && filteredBookings.length === 0"
          :icon="CalendarDays"
          title="Chargement…"
          body="Récupération des réservations de la saison."
        />
        <CbEmptyState
          v-else-if="filteredBookings.length === 0"
          :icon="CalendarDays"
          title="Aucune réservation"
          body="Aucune réservation ne correspond aux filtres actuels."
        />

        <div
          v-for="b in filteredBookings"
          :key="b.id"
          class="cb-card ab-row"
          :style="rowStyle(b)"
          role="button"
          tabindex="0"
          @click="onRowClick(b)"
          @keyup.enter="onRowClick(b)"
        >
          <div class="ab-row-head">
            <CbPill :tone="kindTone(b)" dot>{{ kindLabel(b) }}</CbPill>
            <span class="ab-row-date">{{ dateBadge(b.date) }}</span>
          </div>
          <div class="ab-row-body">
            <div class="ab-row-title">
              {{ bookingTitle(b) }}
              <span v-if="opponentLine(b)" class="ab-row-opp">{{ opponentLine(b) }}</span>
            </div>
            <div class="cb-sub">
              {{ timeLine(b) }}{{ locationLine(b) ? ' · ' + locationLine(b) : '' }}
            </div>
            <div v-if="b.coachLabel" class="cb-sub ab-row-coach">
              Coach {{ b.coachLabel }}
            </div>
            <div
              v-if="b.status === 'cancelled' && b.cancelReason"
              class="cb-sub ab-row-reason"
            >
              Motif : {{ b.cancelReason }}
            </div>
          </div>
        </div>
      </div>
    </template>
  </CbDesktopShell>

  <!-- ─── Mobile <1024 ──────────────────────────────────────────── -->
  <CbMobileShell
    v-else
    title="Agenda"
    :tabs="tabs"
  >
    <div class="agenda-tabs-mobile">
      <div class="cb-segmented agenda-segmented-full">
        <button
          type="button"
          :class="{ active: activeTab === 'calendar' }"
          @click="setActiveTab('calendar')"
        >
          Calendrier
        </button>
        <button
          type="button"
          :class="{ active: activeTab === 'list' }"
          @click="setActiveTab('list')"
        >
          Liste
        </button>
      </div>
    </div>

    <!-- ─── Tab Calendrier mobile ─────────────────────────────── -->
    <template v-if="activeTab === 'calendar'">
      <div class="agenda-toolbar-mobile">
        <div class="cb-segmented">
          <button
            type="button"
            :class="{ active: activeView === 'day' }"
            @click="setView('day')"
          >
            Jour
          </button>
          <button
            type="button"
            :class="{ active: activeView === 'week' }"
            @click="setView('week')"
          >
            Semaine
          </button>
          <button
            type="button"
            :class="{ active: activeView === 'month' }"
            @click="setView('month')"
          >
            Mois
          </button>
        </div>

        <div class="agenda-nav">
          <button
            type="button"
            class="cb-iconbtn sm"
            aria-label="Précédent"
            @click="goPrevious"
          >
            <ChevronLeft :size="16" />
          </button>
          <button type="button" class="agenda-today-btn" @click="goToday">
            Aujourd'hui
          </button>
          <button
            type="button"
            class="cb-iconbtn sm"
            aria-label="Suivant"
            @click="goNext"
          >
            <ChevronRight :size="16" />
          </button>
        </div>
      </div>

      <div class="agenda-mobile-toggles">
        <div class="cb-segmented sm">
          <button
            type="button"
            :class="{ active: !showOtherTeams }"
            @click="showOtherTeams = false"
          >
            Mes équipes
          </button>
          <button
            type="button"
            :class="{ active: showOtherTeams }"
            @click="showOtherTeams = true"
          >
            Tout le club
          </button>
        </div>
        <div class="cb-segmented sm">
          <button
            type="button"
            :class="{ active: eveningOnly }"
            @click="eveningOnly = true"
          >
            Soir
          </button>
          <button
            type="button"
            :class="{ active: !eveningOnly }"
            @click="eveningOnly = false"
          >
            Journée
          </button>
        </div>
        <label class="agenda-check">
          <input v-model="showFreed" type="checkbox" />
          <span>Créneaux libres</span>
        </label>
      </div>

      <div class="agenda-period-label">{{ periodLabel }}</div>

      <div class="agenda-mobile-body">
        <VueCal
          v-model:active-view="activeView"
          v-model:selected-date="selectedDate"
          :events="displayedEvents"
          :time-from="timeFrom"
          :time-to="timeTo"
          :time-step="TIME_STEP"
          :time-cell-height="TIME_CELL_HEIGHT"
          :hide-title-bar="true"
          :hide-view-selector="true"
          :hide-weekends="false"
          :disable-views="['years', 'year']"
          :events-on-month-view="'short'"
          locale="fr"
          :twelve-hour="false"
          @event-click="onEventClick"
          @cell-click="onCellClick"
        />
      </div>

      <div v-if="bookingsStore.lastError" class="agenda-error">
        <AlertTriangle :size="14" />
        {{ bookingsStore.lastError }}
      </div>
    </template>

    <!-- ─── Tab Liste mobile ──────────────────────────────────── -->
    <template v-else>
      <div class="ab-mobile-filters">
        <div class="cb-segmented agenda-segmented-full">
          <button
            v-for="f in TIME_FILTERS"
            :key="f.id"
            type="button"
            :class="{ active: activeTimeFilter === f.id }"
            @click="setTimeFilter(f.id)"
          >
            {{ f.label }}
          </button>
        </div>

        <select
          v-model="selectedTeamId"
          class="cb-input"
          aria-label="Filtrer par équipe"
        >
          <option value="">Toutes les équipes</option>
          <option v-for="t in allTeams" :key="t.id" :value="t.id">
            {{ t.name }}{{ t.categoryName ? ` · ${t.categoryName}` : '' }}
          </option>
        </select>
      </div>

      <div class="cb-chiprow ab-chiprow">
        <button
          v-for="k in ALL_KINDS"
          :key="k"
          type="button"
          class="cb-chip"
          :class="{ active: isKindActive(k) }"
          @click="toggleKind(k)"
        >
          {{ BOOKING_LABELS[k] }}
        </button>
      </div>

      <div class="ab-list">
        <CbEmptyState
          v-if="bookingsStore.loading && filteredBookings.length === 0"
          :icon="CalendarDays"
          title="Chargement…"
          body="Récupération des réservations de la saison."
        />
        <CbEmptyState
          v-else-if="filteredBookings.length === 0"
          :icon="CalendarDays"
          title="Aucune réservation"
          body="Aucune réservation ne correspond aux filtres actuels."
        >
          <template #actions>
            <button
              v-if="hasActiveFilters"
              class="cb-btn outline sm"
              type="button"
              @click="clearFilters"
            >
              Réinitialiser les filtres
            </button>
          </template>
        </CbEmptyState>

        <div
          v-for="b in filteredBookings"
          :key="b.id"
          class="cb-card ab-row"
          :style="rowStyle(b)"
          role="button"
          tabindex="0"
          @click="onRowClick(b)"
          @keyup.enter="onRowClick(b)"
        >
          <div class="ab-row-head">
            <CbPill :tone="kindTone(b)" dot>{{ kindLabel(b) }}</CbPill>
            <span class="ab-row-date">{{ dateBadge(b.date) }}</span>
          </div>
          <div class="ab-row-body">
            <div class="ab-row-title">
              {{ bookingTitle(b) }}
              <span v-if="opponentLine(b)" class="ab-row-opp">{{ opponentLine(b) }}</span>
            </div>
            <div class="cb-sub">
              {{ timeLine(b) }}{{ locationLine(b) ? ' · ' + locationLine(b) : '' }}
            </div>
            <div v-if="b.coachLabel" class="cb-sub ab-row-coach">
              Coach {{ b.coachLabel }}
            </div>
            <div
              v-if="b.status === 'cancelled' && b.cancelReason"
              class="cb-sub ab-row-reason"
            >
              Motif : {{ b.cancelReason }}
            </div>
          </div>
        </div>
      </div>
    </template>
  </CbMobileShell>

  <!-- ─── Dialog annulation ───────────────────────────────────── -->
  <Teleport to="body">
    <div
      v-if="cancelDialogOpen && cancelTarget"
      class="planning-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Annulation entraînement"
      @click.self="closeCancelDialog"
    >
      <div class="planning-dialog">
        <div class="planning-dialog-head">
          <h2 class="cb-h2">Annuler l'entraînement</h2>
          <button
            type="button"
            class="cb-iconbtn"
            aria-label="Fermer"
            @click="closeCancelDialog"
          >
            <X :size="18" />
          </button>
        </div>
        <div class="planning-dialog-body">
          <p class="planning-dialog-summary">
            {{ cancelDateLabel }}<br />
            <strong>{{ cancelTarget.startTime }} – {{ cancelTarget.endTime }}</strong>
            <span v-if="cancelLocationLabel"> · {{ cancelLocationLabel }}</span>
            <span v-if="cancelCoachLabel" class="planning-dialog-coach">
              · Coach {{ cancelCoachLabel }}
            </span>
          </p>

          <div class="planning-info-banner">
            <Info :size="16" />
            <span>
              Le créneau sera libéré et visible des autres coachs comme
              disponible.
            </span>
          </div>

          <label class="planning-dialog-label" for="agenda-cancel-note">
            Note (optionnel, 200 caractères max)
          </label>
          <textarea
            id="agenda-cancel-note"
            v-model="cancelNote"
            class="planning-textarea"
            rows="3"
            maxlength="200"
            placeholder="Ex. salle indisponible — match juniors"
            :aria-invalid="cancelError ? 'true' : 'false'"
          />
          <p v-if="cancelError" class="planning-error-text">{{ cancelError }}</p>
        </div>
        <div class="planning-dialog-actions">
          <button
            type="button"
            class="cb-btn ghost"
            :disabled="cancelSubmitting"
            @click="closeCancelDialog"
          >
            Annuler
          </button>
          <button
            type="button"
            class="cb-btn danger"
            :disabled="cancelSubmitting"
            @click="submitCancel"
          >
            <Ban :size="16" />
            {{ cancelSubmitting ? 'Libération…' : 'Libérer le créneau' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ─── Toast ───────────────────────────────────────────────── -->
  <Teleport to="body">
    <div
      v-if="toastVisible"
      class="cb-toast"
      :class="toastTone"
      role="status"
      aria-live="polite"
      @click="dismissToast"
    >
      <CheckCircle2 v-if="toastTone === 'emerald'" :size="18" />
      <AlertTriangle v-else-if="toastTone === 'amber'" :size="18" />
      <X v-else :size="18" />
      <span style="flex: 1">{{ toastMessage }}</span>
    </div>
  </Teleport>
</template>

<style scoped>
/* ─── Layout shells ───────────────────────────────────────────── */
.agenda-desktop-body {
  flex: 1;
  overflow: auto;
  padding: 16px 28px 20px;
  background: var(--bg-muted);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.agenda-card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  height: calc(100vh - 260px);
  min-height: 460px;
}

.agenda-mobile-body {
  flex: 1;
  background: var(--bg);
  border-top: 1px solid var(--border);
  /* Viewport - header 56 - tabbar 64 - top filters block (~ 220) */
  height: calc(100vh - 56px - 64px - 240px);
  min-height: 300px;
}

.agenda-tabs-mobile {
  padding: 8px 16px 0;
  background: var(--bg);
}

.agenda-segmented-full {
  width: 100%;
  display: flex;
}
.agenda-segmented-full button {
  flex: 1;
  text-align: center;
}

.agenda-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  padding: 12px 28px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}

.agenda-toolbar-desktop .agenda-toggles {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.agenda-toolbar-mobile {
  padding: 10px 16px 0;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.agenda-mobile-toggles {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 16px 4px;
  background: var(--bg);
}

.agenda-period-label {
  padding: 6px 16px;
  background: var(--bg);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-subtle);
}

.agenda-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.agenda-today-btn {
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
}
.agenda-today-btn:hover {
  background: var(--slate-50);
}

.agenda-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-subtle);
  cursor: pointer;
  user-select: none;
}
.agenda-check input {
  accent-color: var(--emerald-500);
}

.cb-iconbtn.sm {
  width: 28px;
  height: 28px;
}

.agenda-error {
  margin: 8px 16px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--rose-200);
  background: var(--rose-50);
  color: var(--rose-700);
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

/* ─── vue-cal overrides ───────────────────────────────────────
   Les classes `.cb-bk-*` vivent dans tokens.css. La classe modifier
   `.cb-bk-other` est posée en plus quand l'event n'appartient pas au
   coach — opacité réduite pour rester scan-friendly.
*/
:deep(.vuecal) {
  font-size: 12px;
  font-family: inherit;
  height: 100%;
}

:deep(.vuecal__title-bar) {
  display: none;
}

:deep(.vuecal__event) {
  border-radius: 6px;
  padding: 4px 6px;
  font-weight: 500;
  background-clip: padding-box;
  overflow: hidden;
  font-size: 11px;
  line-height: 1.25;
}

/* Le titre vue-cal contient des `\n` (équipe, salle, coach sur lignes
   séparées) — `pre-line` honore les sauts sans les espaces superflus. */
:deep(.vuecal__event-title) {
  white-space: pre-line;
  font-weight: 600;
}
:deep(.vuecal__event-title-edit) {
  white-space: pre-line;
}

:deep(.vuecal__event.cb-bk-training) {
  background: var(--emerald-50);
  border-left: 3px solid var(--emerald-500);
  color: var(--emerald-700);
}
:deep(.vuecal__event.cb-bk-match-home) {
  background: var(--violet-50);
  border-left: 3px solid var(--violet-500);
  color: var(--violet-700);
}
:deep(.vuecal__event.cb-bk-match-away) {
  background: var(--sky-50);
  border-left: 3px solid var(--sky-500);
  color: var(--sky-700);
}
:deep(.vuecal__event.cb-bk-reserve) {
  background: var(--slate-100);
  border-left: 3px solid var(--slate-400);
  color: var(--slate-700);
}
:deep(.vuecal__event.cb-bk-custom) {
  background: var(--amber-50);
  border-left: 3px solid var(--amber-500);
  color: var(--amber-700);
}
:deep(.vuecal__event.cb-bk-freed) {
  background: var(--slate-100);
  border-left: 3px dashed var(--slate-400);
  color: var(--text-muted);
}
:deep(.vuecal__event.cb-bk-cancelled) {
  background: var(--rose-50);
  border-left: 3px solid var(--rose-300);
  color: var(--rose-700);
  text-decoration: line-through;
  opacity: 0.6;
}

/* Overlay "autres équipes" : opacité réduite pour scanner ses propres
   events en priorité. Cumulable avec n'importe quelle classe `.cb-bk-*`. */
:deep(.vuecal__event.cb-bk-other) {
  opacity: 0.45;
  cursor: default;
}
:deep(.vuecal__event.cb-bk-other.cb-bk-cancelled) {
  /* On évite de cumuler les deux opacités (0.6 × 0.45 = invisible). */
  opacity: 0.3;
}

:deep(.vuecal__cell-events-count) {
  background: var(--emerald-500);
}

:deep(.vuecal__time-column .vuecal__time-cell-label) {
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--text-faint);
}

:deep(.vuecal--day-view .vuecal__cell--today),
:deep(.vuecal--week-view .vuecal__cell--today) {
  background: rgba(16, 185, 129, 0.03);
}

/* ─── Segmented "sm" — variante compacte pour les toggles ─────── */
.cb-segmented.sm button {
  font-size: 11px;
  padding: 3px 8px;
}

/* ─── Liste (tab Liste, reprend AllBookings) ─────────────────── */
.ab-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  padding: 16px 28px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.ab-team-select {
  max-width: 280px;
  flex: 0 1 240px;
}
.ab-kindrow {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex: 1 1 100%;
}

.ab-mobile-filters {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 16px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 5;
}
.ab-chiprow {
  position: sticky;
  top: 0;
  z-index: 4;
}

.ab-list {
  flex: 1;
  overflow: auto;
  padding: 12px 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ab-list-desktop {
  padding: 20px 28px 32px;
  max-width: 880px;
  margin: 0 auto;
  width: 100%;
}

.ab-row-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.ab-row-date {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 500;
  white-space: nowrap;
  text-transform: capitalize;
}
.ab-row-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ab-row-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.ab-row-opp {
  margin-left: 6px;
  font-weight: 400;
  color: var(--text-muted);
}
.ab-row-reason {
  font-style: italic;
}

/* ─── Dialog annulation ─────────────────────────────────────────── */
.planning-dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 1000;
}

.planning-dialog {
  background: var(--bg);
  border-radius: 16px;
  box-shadow: var(--shadow-lg, 0 20px 40px rgba(0, 0, 0, 0.18));
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.planning-dialog-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border);
}

.planning-dialog-body {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.planning-dialog-summary {
  font-size: 13px;
  line-height: 1.55;
  color: var(--text);
}

.planning-info-banner {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--sky-50);
  color: var(--sky-700);
  font-size: 12px;
  line-height: 1.45;
}

.planning-dialog-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-subtle);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.planning-textarea {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  font: inherit;
  font-size: 13px;
  resize: vertical;
  background: var(--bg);
  color: var(--text);
  outline: none;
}
.planning-textarea:focus {
  border-color: var(--emerald-500);
  box-shadow: 0 0 0 3px var(--emerald-100, rgba(16, 185, 129, 0.15));
}
.planning-textarea[aria-invalid='true'] {
  border-color: var(--rose-500);
}

.planning-error-text {
  color: var(--rose-600);
  font-size: 12px;
}

.planning-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 18px 18px;
  border-top: 1px solid var(--border);
  background: var(--slate-50, var(--bg));
}
</style>
