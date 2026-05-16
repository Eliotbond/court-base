<script setup lang="ts">
/**
 * MatchBookingPicker — picker calendrier pour sélectionner un créneau match.
 *
 * Philosophie d'affichage (V4 2026-05-15)
 * ---------------------------------------
 * Le picker affiche **uniquement** les bookings existants de type `match_home`
 * **sans lien vers un match** (`matchId === null`, `status === 'scheduled'`) —
 * ce sont les créneaux pré-réservés pour matchs à domicile que l'admin a posés
 * via `/bookings` mais qui n'ont pas encore de doc `/matches` rattaché.
 *
 * `matchId` est le champ de lien canonique (relation bidirectionnelle avec
 * `MatchData.bookingId`, cf. `createHomeMatch` / `deleteMatch`). On filtre
 * dessus plutôt que sur `matchTypeId` : les deux sont posés ensemble à la
 * création du match, mais `matchId` est la référence d'autorité.
 *
 * Cliquer sur un de ces "match_home pending" sélectionne le booking : le
 * dialog parent appelle ensuite `matchesStore.createHome({ bookingId, ... })`
 * qui crée un doc `/matches` et lie le booking via writeBatch atomique
 * (`booking.matchId` / `matchTypeId` / `opponentName` propagés en miroir).
 *
 * Tout le reste (training, reserve, match déjà assigné, custom, cancelled,
 * freed) est masqué.
 *
 * Workflow attendu côté admin :
 *  1. Sur `/bookings`, créer des bookings `match_home` (typiquement 3h)
 *     soit avec `teamId` déjà fixé, soit ouverts. Ils apparaissent comme
 *     "pending" tant qu'aucun `matchTypeId` n'est attaché.
 *  2. Sur `/matches`, cliquer sur un pending pour fixer les détails du match
 *     (type, adversaire). Le créneau est "consommé".
 *
 * Vue par défaut
 * --------------
 * `activeView: 'week'`. Toggle day/week disponible. En 'week' pas de
 * `:split-days` (vue-cal v4) — le court vit dans le `title` de l'event.
 *
 * Émission
 * --------
 * `@select` avec `{ bookingId, venueId, courtId, date, startTime, endTime,
 * teamId }` sur clic sur un match_home pending. `teamId` peut être `null`
 * si le booking pending n'avait pas d'équipe pré-fixée.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { CalendarDays, MapPin } from 'lucide-vue-next'
import Button from 'primevue/button'
import Select from 'primevue/select'
import VueCal, { type VueCalEvent, type VueCalSplit } from 'vue-cal'
import 'vue-cal/dist/vuecal.css'
import { useBookingsStore } from '@/stores/bookings'
import type { BookingRow } from '@/repositories/bookings.repo'

// ---------------------------------------------------------------------------
// Props / Emits — contrat documenté dans le brief.
// ---------------------------------------------------------------------------

interface Props {
  /**
   * Présent dans le contrat pour stabilité (le dialog parent le passe encore).
   * Non utilisé dans cette V2 : la durée du créneau est celle du booking
   * `reserve` choisi, pas une valeur fixe imposée par le picker.
   */
  durationHours?: number
  /**
   * teamId présélectionné (pour future feature filtre). Non utilisé en MVP,
   * accepté quand même pour stabilité du contrat.
   */
  teamId?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  durationHours: 3,
  teamId: null,
})

interface SelectedSlot {
  /** Booking match_home pending sélectionné — l'assign update ce doc. */
  bookingId: string
  venueId: string
  courtId: string
  date: Date
  startTime: string
  endTime: string
  /** teamId du booking pending si fixé d'avance, `null` sinon. */
  teamId: string | null
}

interface Emits {
  (e: 'select', slot: SelectedSlot): void
}

const emit = defineEmits<Emits>()

// Lectures défensives pour silencer le warning de prop non-utilisée — on
// garde ces props dans le contrat pour stabilité future / parent existant.
void props.teamId
void props.durationHours

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const store = useBookingsStore()

onMounted(async () => {
  // Si le store a déjà chargé la saison (ex. depuis `/bookings`), on ne
  // re-fetch pas. Sinon premier appel : `loadActiveContext` tire saison +
  // venues + tous les bookings.
  if (store.allBookings.length === 0) {
    await store.loadActiveContext()
  }
  // Scroll initial à 17:00 après le premier render — la grille vue-cal est
  // alors montée dans le DOM.
  await nextTick()
  scrollToHour(17)
})

// ---------------------------------------------------------------------------
// vue-cal — configuration
// ---------------------------------------------------------------------------

const selectedDate = ref<Date>(startOfLocalDay(new Date()))
const activeView = ref<'day' | 'week'>('week')
const TIME_FROM = 6 * 60
const TIME_TO = 22 * 60
const TIME_STEP = 30
const TIME_CELL_HEIGHT = 36

/** Ref racine pour pouvoir scroller la grille programmatiquement. */
const calendarWrapper = ref<HTMLElement | null>(null)

/**
 * Scrolle la grille vue-cal à l'heure souhaitée. Pas de prop publique
 * `scrollTo` dans vue-cal v4 — on attaque le `.vuecal__bg` directement.
 * Si la lib change son markup, ce scroll devient no-op (et l'utilisateur
 * voit la grille à 06:00) — pas bloquant pour le MVP.
 */
function scrollToHour(hour: number): void {
  const wrap = calendarWrapper.value
  if (!wrap) return
  // Cible le conteneur scrollable interne de vue-cal.
  const grid = wrap.querySelector<HTMLElement>('.vuecal__bg')
  if (!grid) return
  const minutesFromTop = hour * 60 - currentTimeFrom.value
  const cellsFromTop = minutesFromTop / TIME_STEP
  grid.scrollTop = cellsFromTop * TIME_CELL_HEIGHT
}

// ---------------------------------------------------------------------------
// Splits — un par court, composite key `venueId__courtId`. Utilisé
// **uniquement en mode 'day'** (vue-cal v4 ne supporte pas les splits en
// 'week').
// ---------------------------------------------------------------------------

interface CourtSplit extends VueCalSplit {
  id: string
  label: string
  venueId: string
  courtId: string
}

const venueFilter = ref<string | null>(null)

const visibleVenues = computed(() => {
  if (venueFilter.value === null) return store.venues
  return store.venues.filter((v) => v.id === venueFilter.value)
})

const courtSplits = computed<CourtSplit[]>(() => {
  const out: CourtSplit[] = []
  const multiVenue = visibleVenues.value.length > 1
  for (const v of visibleVenues.value) {
    for (const c of v.courts) {
      out.push({
        id: `${v.id}__${c.id}`,
        label: multiVenue ? `${v.name} · ${c.name}` : c.name,
        venueId: v.id,
        courtId: c.id,
      })
    }
  }
  return out
})

// ---------------------------------------------------------------------------
// Helpers temps / dates
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function bookingDateMillis(b: BookingRow): number {
  // any: le Timestamp neutre de shared-types n'expose pas `.toDate()` ; on
  // lit `seconds` qui existe sur les deux représentations.
  const ts = b.date as unknown as { seconds: number; toDate?: () => Date }
  if (typeof ts.toDate === 'function') return ts.toDate().getTime()
  return ts.seconds * 1000
}

function formatLocalDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function startOfLocalDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

/** Lundi 00:00 local de la semaine contenant `from`. */
function startOfWeek(from: Date): Date {
  const d = new Date(from)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

// ---------------------------------------------------------------------------
// Bornes temporelles de la fenêtre considérée (pour borner le rendu).
// - day → [selectedDate, selectedDate]
// - week → [startOfWeek, +6 jours]
// ---------------------------------------------------------------------------

const windowStartDate = computed<Date>(() => {
  if (activeView.value === 'day') return startOfLocalDay(selectedDate.value)
  return startOfWeek(selectedDate.value)
})

const windowEndDate = computed<Date>(() => {
  if (activeView.value === 'day') return startOfLocalDay(selectedDate.value)
  const start = startOfWeek(selectedDate.value)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return end
})

// ---------------------------------------------------------------------------
// Events — uniquement les bookings `reserve` (status scheduled) du périmètre.
// ---------------------------------------------------------------------------

interface PickerEvent extends VueCalEvent {
  class: string
  start: string
  end: string
  title: string
  pendingBookingId: string
  pendingTeamId: string | null
}

/** Court label pour affichage dans les titles (week mode notamment). */
function courtLabel(venueId: string, courtId: string): string {
  const venue = store.venues.find((v) => v.id === venueId)
  const court = venue?.courts.find((c) => c.id === courtId)
  const multiVenue = visibleVenues.value.length > 1
  if (!venue || !court) return 'Court ?'
  return multiVenue ? `${venue.name} · ${court.name}` : court.name
}

/** teamName si dispo (court résumé pour le title). */
function teamShortLabel(teamId: string | null): string | null {
  if (!teamId) return null
  const team = store.allBookings.find((b) => b.teamId === teamId && b.teamName)
  return team?.teamName ?? null
}

const pendingMatchEvents = computed<PickerEvent[]>(() => {
  const venueIds = new Set(visibleVenues.value.map((v) => v.id))
  const winStartMs = startOfLocalDay(windowStartDate.value).getTime()
  const winEndMs = startOfLocalDay(windowEndDate.value).getTime()
  const out: PickerEvent[] = []
  for (const b of store.allBookings) {
    if (b.slotType !== 'match_home') continue
    // Lien canonique : un booking déjà rattaché à un /matches porte `matchId`.
    if (b.matchId !== null) continue
    if (b.status !== 'scheduled') continue
    if (!venueIds.has(b.venueId)) continue
    const bDayMs = startOfLocalDay(new Date(bookingDateMillis(b))).getTime()
    if (bDayMs < winStartMs || bDayMs > winEndMs) continue
    const dateKey = formatLocalDateKey(new Date(bookingDateMillis(b)))
    const labelCourt = courtLabel(b.venueId, b.courtId)
    const teamLabel = teamShortLabel(b.teamId)
    const title = teamLabel
      ? `Match · ${teamLabel} · ${labelCourt}`
      : `Match (à attribuer) · ${labelCourt}`
    out.push({
      class: 'vc-match-pending',
      start: `${dateKey} ${b.startTime}`,
      end: `${dateKey} ${b.endTime}`,
      title,
      split: `${b.venueId}__${b.courtId}`,
      pendingBookingId: b.id,
      pendingTeamId: b.teamId,
    })
  }
  return out
})

const calendarEvents = computed<PickerEvent[]>(() => pendingMatchEvents.value)

// ---------------------------------------------------------------------------
// Click handler — sur match_home pending uniquement.
// ---------------------------------------------------------------------------

const tentativeSlot = ref<SelectedSlot | null>(null)

function emitSlot(slot: SelectedSlot): void {
  tentativeSlot.value = slot
  emit('select', slot)
}

function onEventClick(payload: unknown): void {
  // any: vue-cal renvoie l'event modifié (avec `_eid`, `_customId`…), on lit
  // nos champs custom via cast étroit.
  const evt = payload as {
    pendingBookingId?: string
    pendingTeamId?: string | null
  } | null
  if (!evt?.pendingBookingId) return
  const booking = store.allBookings.find((b) => b.id === evt.pendingBookingId)
  if (!booking) return
  emitSlot({
    bookingId: booking.id,
    venueId: booking.venueId,
    courtId: booking.courtId,
    date: startOfLocalDay(new Date(bookingDateMillis(booking))),
    startTime: booking.startTime,
    endTime: booking.endTime,
    teamId: booking.teamId,
  })
}

// ---------------------------------------------------------------------------
// Toolbar — navigation + filtre période + filtre venue + view switch.
// ---------------------------------------------------------------------------

const longDateFormatter = new Intl.DateTimeFormat('fr-CH', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

const dateLabel = computed<string>(() => {
  if (activeView.value === 'day') {
    const raw = longDateFormatter.format(selectedDate.value)
    return raw.charAt(0).toUpperCase() + raw.slice(1)
  }
  const start = startOfWeek(selectedDate.value)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const fmt = new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long' })
  const yearFmt = new Intl.DateTimeFormat('fr-CH', { year: 'numeric' })
  return `${fmt.format(start)} → ${fmt.format(end)} ${yearFmt.format(end)}`
})

function shiftDate(deltaDays: number): void {
  const next = new Date(selectedDate.value)
  next.setDate(next.getDate() + deltaDays)
  selectedDate.value = startOfLocalDay(next)
  tentativeSlot.value = null
}

function goPrevious(): void {
  if (activeView.value === 'day') shiftDate(-1)
  else shiftDate(-7)
}

function goNext(): void {
  if (activeView.value === 'day') shiftDate(1)
  else shiftDate(7)
}

function goToday(): void {
  selectedDate.value = startOfLocalDay(new Date())
  tentativeSlot.value = null
}

// Filtre période de la journée — passe `time-from` / `time-to` à vue-cal
// **et** borne `computeFreeWindows`.
interface PeriodOption {
  value: 'all' | 'morning' | 'afternoon' | 'evening'
  label: string
  from: number
  to: number
}

const periodOptions: ReadonlyArray<PeriodOption> = [
  { value: 'all', label: 'Toute la journée', from: 6 * 60, to: 22 * 60 },
  { value: 'morning', label: 'Matin (06-12)', from: 6 * 60, to: 12 * 60 },
  { value: 'afternoon', label: 'Après-midi (12-16)', from: 12 * 60, to: 16 * 60 },
  { value: 'evening', label: 'Soir (16-22)', from: 16 * 60, to: 22 * 60 },
]

const periodFilter = ref<'all' | 'morning' | 'afternoon' | 'evening'>('evening')

/** Bascule rapide vers la vue journée complète (bouton de toolbar). */
function showWholeDay(): void {
  periodFilter.value = 'all'
}

const currentTimeFrom = computed<number>(() => {
  return (
    periodOptions.find((p) => p.value === periodFilter.value)?.from ?? TIME_FROM
  )
})

const currentTimeTo = computed<number>(() => {
  return (
    periodOptions.find((p) => p.value === periodFilter.value)?.to ?? TIME_TO
  )
})

// Venue filter options.
interface VenueOption {
  id: string | null
  label: string
}

const venueOptions = computed<VenueOption[]>(() => {
  const all: VenueOption = { id: null, label: 'Tous les venues' }
  const list = store.venues.map<VenueOption>((v) => ({ id: v.id, label: v.name }))
  return [all, ...list]
})

// View switch
interface ViewOption {
  value: 'day' | 'week'
  label: string
}
const viewOptions: ReadonlyArray<ViewOption> = [
  { value: 'day', label: 'Jour' },
  { value: 'week', label: 'Semaine' },
]

// Reset la sélection si l'utilisateur change un filtre.
watch([periodFilter, venueFilter, selectedDate, activeView], () => {
  // Pas de reset de tentativeSlot ici — on conserve la sélection tant que
  // le user ne change pas explicitement (ou clique sur un autre event).
})
</script>

<template>
  <section class="space-y-3 p-4 bg-surface-50 rounded-lg h-full flex flex-col">
    <!-- Toolbar : navigation + view + période + venue -->
    <div class="flex items-center gap-3 flex-wrap">
      <div class="flex items-center gap-1.5">
        <Button
          severity="secondary"
          size="small"
          outlined
          aria-label="Précédent"
          @click="goPrevious"
        >
          &lt;
        </Button>
        <Button
          severity="secondary"
          size="small"
          outlined
          @click="goToday"
        >
          Aujourd'hui
        </Button>
        <Button
          severity="secondary"
          size="small"
          outlined
          aria-label="Suivant"
          @click="goNext"
        >
          &gt;
        </Button>
      </div>

      <div class="flex items-center gap-2 text-[13px] text-surface-600">
        <CalendarDays
          :size="14"
          :stroke-width="2"
          class="text-surface-500"
        />
        <span class="font-medium text-surface-900">{{ dateLabel }}</span>
      </div>

      <Select
        v-model="activeView"
        :options="[...viewOptions]"
        option-label="label"
        option-value="value"
        size="small"
        class="!min-w-28"
      />

      <Select
        v-model="periodFilter"
        :options="[...periodOptions]"
        option-label="label"
        option-value="value"
        size="small"
        class="!min-w-44"
      />

      <!-- Bascule rapide : passe la période sur "Toute la journée" en un clic. -->
      <Button
        severity="secondary"
        size="small"
        :outlined="periodFilter !== 'all'"
        aria-label="Voir toute la journée"
        @click="showWholeDay"
      >
        <CalendarDays
          :size="14"
          :stroke-width="2"
        />
        <span class="ml-1">Toute la journée</span>
      </Button>

      <div
        v-if="store.venues.length > 1"
        class="ml-auto flex items-center gap-2"
      >
        <MapPin
          :size="14"
          :stroke-width="2"
          class="text-surface-500"
        />
        <Select
          v-model="venueFilter"
          :options="venueOptions"
          option-label="label"
          option-value="id"
          placeholder="Tous les venues"
          size="small"
          class="!min-w-44"
        />
      </div>
    </div>

    <!-- Calendrier -->
    <div
      v-if="courtSplits.length > 0"
      ref="calendarWrapper"
      class="card overflow-hidden flex-1 min-h-0"
    >
      <VueCal
        v-model:selected-date="selectedDate"
        v-model:active-view="activeView"
        :events="calendarEvents"
        :split-days="activeView === 'day' ? courtSplits : []"
        :sticky-split-labels="activeView === 'day'"
        :time-from="currentTimeFrom"
        :time-to="currentTimeTo"
        :time-step="TIME_STEP"
        :time-cell-height="TIME_CELL_HEIGHT"
        :hide-title-bar="true"
        :hide-view-selector="true"
        :disable-views="['years', 'year', 'month']"
        locale="fr"
        :twelve-hour="false"
        @event-click="onEventClick"
      />
    </div>

    <!-- Empty state : pas de venue/court à afficher -->
    <div
      v-else
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
        Aucun court disponible
      </div>
      <div class="text-[12px] text-surface-500 max-w-md">
        Vérifie qu'un venue avec courts est configuré et qu'une saison est active.
      </div>
    </div>

    <!-- Empty state : aucun match_home pending dans le périmètre visible -->
    <div
      v-if="courtSplits.length > 0 && calendarEvents.length === 0"
      class="card border-surface-200 bg-surface-50 px-4 py-3 text-[13px] text-surface-600 flex items-start gap-2"
    >
      <CalendarDays
        :size="14"
        :stroke-width="2"
        class="mt-0.5 text-surface-500 shrink-0"
      />
      <span>
        Aucun créneau match à domicile en attente dans cette
        {{ activeView === 'day' ? 'journée' : 'semaine' }}.
        Crée un booking de type <strong>Match home</strong> depuis <strong>/bookings</strong>
        (sans type de match assigné) pour le rendre sélectionnable ici.
      </span>
    </div>

    <!-- Récap du créneau sélectionné -->
    <div
      v-if="tentativeSlot"
      class="card border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800 flex items-center gap-2"
    >
      <CalendarDays
        :size="14"
        :stroke-width="2"
      />
      Créneau sélectionné — {{ tentativeSlot.startTime }} → {{ tentativeSlot.endTime }}.
    </div>
  </section>
</template>

<style scoped>
/*
 * Couleur spécifique au picker :
 *  - `vc-match-pending` (orange) : booking match_home pending (sans
 *    matchTypeId), cliquable — l'assign update le booking en place.
 *
 * Pas de classes pour `training`, `reserve`, `match` déjà assigné, `custom`,
 * `cancelled`, `freed` : ces events ne sont JAMAIS rendus dans ce picker.
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
  border-width: 1px;
  border-style: solid;
  padding: 4px 6px;
  font-weight: 500;
  color: inherit;
  background-clip: padding-box;
  overflow: hidden;
  cursor: pointer;
}

:deep(.vuecal__event.vc-match-pending) {
  background: rgb(255 247 237); /* orange-50 */
  border-color: rgb(253 186 116); /* orange-300 */
  color: rgb(154 52 18); /* orange-800 */
}

:deep(.vuecal__event.vc-match-pending:hover) {
  background: rgb(254 215 170); /* orange-200 */
}

:deep(.vuecal__split-days-headers .day-split-header) {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: rgb(82 82 91);
  padding: 6px 4px;
}

:deep(.vuecal__time-column .vuecal__time-cell-label) {
  font-size: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: rgb(161 161 170);
}

:deep(.vuecal--day-view .vuecal__cell--today),
:deep(.vuecal--week-view .vuecal__cell--today) {
  background: rgb(254 252 232 / 0.4);
}
</style>
