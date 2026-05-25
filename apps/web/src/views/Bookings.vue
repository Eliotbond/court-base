<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  Ban,
  CalendarDays,
  Clock,
  History,
  Link2,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
} from 'lucide-vue-next'
import Button from 'primevue/button'
import Drawer from 'primevue/drawer'
import Select from 'primevue/select'
import Tabs from 'primevue/tabs'
import TabList from 'primevue/tablist'
import Tab from 'primevue/tab'
import TabPanels from 'primevue/tabpanels'
import TabPanel from 'primevue/tabpanel'
import VueCal, { type VueCalEvent, type VueCalSplit } from 'vue-cal'
import 'vue-cal/dist/vuecal.css'
// Locale FR — enregistrée par effet de bord auprès de vue-cal (labels jours /
// mois / "Aujourd'hui" / etc.). Sans cet import, le composant reste en
// anglais malgré la prop `locale="fr"`.
import 'vue-cal/dist/i18n/fr.es.js'
import { useBookingsStore } from '@/stores/bookings'
import { useTeamsStore } from '@/stores/teams'
import type { BookingRow } from '@/repositories/bookings.repo'
import type {
  BookingActionLogEntry,
  BookingCancelReason,
  SlotType,
} from '@club-app/shared-types'
import Pill from '@/components/ui/Pill.vue'
import BookingEditScopeDialog from '@/components/bookings/BookingEditScopeDialog.vue'
import BookingEditFormDialog from '@/components/bookings/BookingEditFormDialog.vue'
import BookingFormDialog from '@/components/bookings/BookingFormDialog.vue'
import BookingListPanel from '@/components/bookings/BookingListPanel.vue'
import { formatDateShort, formatDateTime } from '@/utils/dates'

const store = useBookingsStore()
const teamsStore = useTeamsStore()

// ---------------------------------------------------------------------------
// Onglets : planning (vue calendrier vue-cal) + list (toutes les réservations).
// ---------------------------------------------------------------------------

const activeTab = ref<'planning' | 'list'>('planning')

onMounted(async () => {
  // `loadActiveContext` charge saison + venues + tous les bookings/séries
  // de la saison en une seule passe. vue-cal consomme ensuite la même source.
  // Les équipes sont chargées en parallèle pour résoudre `coachLabels` lookup
  // (affiché dans le `content` de chaque event). Idempotent côté store.
  await Promise.all([store.loadActiveContext(), teamsStore.load()])
})

// Lookup teamId → premier coach (avec suffixe "+N" si plusieurs). Map
// reconstruit à chaque mutation du store teams ; coût négligeable (<200 docs).
const coachByTeamId = computed<Map<string, string>>(() => {
  const m = new Map<string, string>()
  for (const t of teamsStore.teams) {
    const labels = t.coachLabels
    if (labels.length === 0) continue
    const head = labels[0]!
    m.set(t.id, labels.length > 1 ? `${head} +${labels.length - 1}` : head)
  }
  return m
})

// ---------------------------------------------------------------------------
// vue-cal — configuration
// ---------------------------------------------------------------------------

/** Lundi 00:00 local de la semaine contenant `from` — pour l'init du picker. */
function startOfWeek(from: Date): Date {
  const d = new Date(from)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

const selectedDate = ref<Date>(new Date())
const activeView = ref<'day' | 'week' | 'month'>('week')

/** Heure d'ouverture du planning — 06:00 → 22:00, pas de 30 min. */
const TIME_FROM = 6 * 60
const TIME_TO = 22 * 60
const TIME_STEP = 30
const TIME_CELL_HEIGHT = 36

// Filtre période de la journée — même contrat que MatchBookingPicker. Passé
// à vue-cal via `time-from` / `time-to` pour zoomer la grille sur la plage
// concernée (matin / après-midi / soir / journée complète).
interface PeriodOption {
  value: 'all' | 'morning' | 'afternoon' | 'evening'
  label: string
  from: number
  to: number
}

const periodOptions: ReadonlyArray<PeriodOption> = [
  { value: 'all', label: 'Toute la journée', from: TIME_FROM, to: TIME_TO },
  { value: 'morning', label: 'Matin (06-12)', from: 6 * 60, to: 12 * 60 },
  { value: 'afternoon', label: 'Après-midi (12-16)', from: 12 * 60, to: 16 * 60 },
  { value: 'evening', label: 'Soir (16-22)', from: 16 * 60, to: 22 * 60 },
]

const periodFilter = ref<'all' | 'morning' | 'afternoon' | 'evening'>('all')

const currentTimeFrom = computed<number>(
  () => periodOptions.find((p) => p.value === periodFilter.value)?.from ?? TIME_FROM,
)
const currentTimeTo = computed<number>(
  () => periodOptions.find((p) => p.value === periodFilter.value)?.to ?? TIME_TO,
)

// ---------------------------------------------------------------------------
// Splits — un split par court (uniquement quand on est en mode "day").
//
// Le composite key venueId__courtId permet de dérouler tous les courts de tous
// les venues (filtrés) en colonnes. Les évènements portent le même composite
// dans leur `split` pour s'aligner sur la bonne colonne.
// ---------------------------------------------------------------------------

interface CourtSplit extends VueCalSplit {
  id: string
  label: string
  venueId: string
  courtId: string
}

const courtSplits = computed<CourtSplit[]>(() => {
  const out: CourtSplit[] = []
  const multiVenue = store.filteredVenues.length > 1
  for (const v of store.filteredVenues) {
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
// Events — map booking → VueCalEvent.
//
// `start` / `end` au format `YYYY-MM-DD HH:MM` (heure locale machine,
// cohérent avec la convention du repo : `Timestamp.fromDate(startOfLocalDay)`).
// On porte `bookingId` en plus pour permettre le lookup au clic.
// ---------------------------------------------------------------------------

interface BookingEvent extends VueCalEvent {
  bookingId: string
  split: string
  class: string
  start: string
  end: string
  title: string
  content: string
}

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

/**
 * Classe CSS de l'évènement — combine `slotType` + modifiers d'état
 * (`cancelled`, `freed`, `pending` quand match_home sans matchTypeId).
 * Mappé sur les variants tailwind définis dans le `<style scoped>`.
 */
function eventClass(b: BookingRow): string {
  const tokens: string[] = ['vc-booking']
  if (b.status === 'cancelled') tokens.push('vc-cancelled')
  if (b.status === 'freed') tokens.push('vc-freed')
  else if (b.slotType === 'match_home' && b.matchTypeId === null) {
    tokens.push('vc-match-pending')
  } else {
    tokens.push(`vc-${b.slotType.replace('_', '-')}`)
  }
  return tokens.join(' ')
}

/**
 * Compose le titre d'un event :
 *  - match_home + opponentName → "<teamName|Match> vs <opponentName>"
 *  - match_away + opponentName → "À <opponentName>"
 *  - fallback : teamName, sinon label du slotType.
 */
function eventTitle(b: BookingRow): string {
  const opponent = b.opponentName?.trim()
  if (b.slotType === 'match_home' && opponent) {
    return `${b.teamName ?? 'Match'} contre ${opponent}`
  }
  if (b.slotType === 'match_away' && opponent) {
    return `À ${opponent}`
  }
  return b.teamName ?? slotTypeLabel(b.slotType)
}

/**
 * Ligne secondaire (`content` vue-cal) — affiche le court + le coach quand
 * dispos. Important en vue 'week' où les splits par court n'existent pas :
 * c'est la seule façon de voir où le booking se passe. Séparateur ` · `
 * cohérent avec MatchBookingPicker.
 */
function eventContent(b: BookingRow): string {
  const parts: string[] = []
  if (b.courtName) parts.push(b.courtName)
  if (b.teamId) {
    const coach = coachByTeamId.value.get(b.teamId)
    if (coach) parts.push(coach)
  }
  return parts.join(' · ')
}

const calendarEvents = computed<BookingEvent[]>(() => {
  const events: BookingEvent[] = []
  for (const b of store.allBookings) {
    const dateMs = bookingDateMillis(b)
    const dateKey = formatLocalDateKey(new Date(dateMs))
    events.push({
      bookingId: b.id,
      split: `${b.venueId}__${b.courtId}`,
      class: eventClass(b),
      start: `${dateKey} ${b.startTime}`,
      end: `${dateKey} ${b.endTime}`,
      title: eventTitle(b),
      content: eventContent(b),
    })
  }
  return events
})

// ---------------------------------------------------------------------------
// Click handler — vue-cal émet l'event modifié (avec `_eid` interne) ; on
// retrouve le booking par `bookingId` qu'on a porté nous-mêmes.
// ---------------------------------------------------------------------------

function onEventClick(payload: unknown): void {
  // any: vue-cal renvoie un objet event dont la signature exacte change selon
  // la version ; on lit `bookingId` à travers une cast étroit.
  const evt = payload as { bookingId?: string } | null
  if (!evt?.bookingId) return
  selectedBookingId.value = evt.bookingId
}

// ---------------------------------------------------------------------------
// Navigation — boutons custom pour conserver l'identité visuelle (vue-cal a
// son propre title bar qu'on cache via `:hide-title-bar="true"`).
//
// Le label est construit en DD/MM/YYYY (cohérent avec le reste de la page —
// helper `formatDateShort`). Pour la vue mois, on reste sur un libellé
// "mois/AAAA" (un mois ne se résume pas en DD/MM/YYYY).
// ---------------------------------------------------------------------------

const monthYearFormatter = new Intl.DateTimeFormat('fr-CH', {
  month: 'long',
  year: 'numeric',
})

const dateLabel = computed<string>(() => {
  if (activeView.value === 'day') {
    return formatDateShort(selectedDate.value)
  }
  if (activeView.value === 'week') {
    const start = startOfWeek(selectedDate.value)
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    return `${formatDateShort(start)} → ${formatDateShort(end)}`
  }
  // Vue mois — on garde un libellé mois/AAAA, capitalisé.
  const raw = monthYearFormatter.format(selectedDate.value)
  return raw.charAt(0).toUpperCase() + raw.slice(1)
})

function shiftDate(deltaDays: number): void {
  const next = new Date(selectedDate.value)
  next.setDate(next.getDate() + deltaDays)
  selectedDate.value = next
}

function goPrevious(): void {
  if (activeView.value === 'day') shiftDate(-1)
  else if (activeView.value === 'week') shiftDate(-7)
  else {
    const next = new Date(selectedDate.value)
    next.setMonth(next.getMonth() - 1)
    selectedDate.value = next
  }
}

function goNext(): void {
  if (activeView.value === 'day') shiftDate(1)
  else if (activeView.value === 'week') shiftDate(7)
  else {
    const next = new Date(selectedDate.value)
    next.setMonth(next.getMonth() + 1)
    selectedDate.value = next
  }
}

function goToday(): void {
  selectedDate.value = new Date()
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
// View selector
// ---------------------------------------------------------------------------

interface ViewOption {
  value: 'day' | 'week' | 'month'
  label: string
}
const viewOptions: ReadonlyArray<ViewOption> = [
  { value: 'day', label: 'Jour' },
  { value: 'week', label: 'Semaine' },
  { value: 'month', label: 'Mois' },
]

// ---------------------------------------------------------------------------
// Drawer — sélection d'un booking.
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
  return store.allBookings.find((b) => b.id === id) ?? null
})

// ---------------------------------------------------------------------------
// Formatters — drawer.
// ---------------------------------------------------------------------------

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

function cancelReasonLabel(reason: BookingCancelReason | null): string {
  if (!reason) return ''
  const map: Record<BookingCancelReason, string> = {
    closure: 'Fermeture',
    holiday: 'Jour férié',
    manual: 'Annulation manuelle',
    series_edit: 'Modif. de série',
    match_home: 'Match home',
    match_away: 'Match away',
    coach_cancel: 'Annulé par coach',
  }
  return map[reason]
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

function formatLongDate(b: BookingRow): string {
  // Convention DD/MM/YYYY — cohérent avec le reste de la page.
  return formatDateShort(b.date as unknown as { seconds: number; toDate?: () => Date })
}

function formatActionLogTime(entry: BookingActionLogEntry): string {
  return formatDateTime(entry.at as unknown as { seconds: number; toDate?: () => Date })
}

function statusPill(b: BookingRow): {
  variant: 'emerald' | 'rose' | 'slate'
  label: string
} {
  if (b.status === 'scheduled') return { variant: 'emerald', label: 'Planifié' }
  if (b.status === 'cancelled') return { variant: 'rose', label: 'Annulé' }
  return { variant: 'slate', label: 'Libéré' }
}

// ---------------------------------------------------------------------------
// Création — dialog "+ Nouvelle réservation".
// ---------------------------------------------------------------------------

const showCreateDialog = ref<boolean>(false)

function openCreateDialog(): void {
  showCreateDialog.value = true
}

// ---------------------------------------------------------------------------
// Edit / Cancel / Delete — workflow scope dialog → action ou edit form.
// ---------------------------------------------------------------------------

const showScopeDialog = ref<boolean>(false)
const scopeIntent = ref<'edit' | 'cancel' | 'delete'>('edit')
const showEditFormDialog = ref<boolean>(false)
const editScope = ref<'occurrence' | 'future' | 'all'>('occurrence')

const isSelectedBookingPast = computed<boolean>(() => {
  if (!selectedBooking.value) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return bookingDateMillis(selectedBooking.value) < today.getTime()
})

const isSelectedBookingSeries = computed<boolean>(() => {
  return selectedBooking.value?.seriesId !== null && selectedBooking.value?.seriesId !== undefined
})

function openScopeDialog(intent: 'edit' | 'cancel' | 'delete'): void {
  scopeIntent.value = intent
  showScopeDialog.value = true
}

async function handleScopeConfirm(scope: 'occurrence' | 'future' | 'all'): Promise<void> {
  const booking = selectedBooking.value
  if (!booking) return
  const intent = scopeIntent.value
  if (intent === 'edit') {
    editScope.value = scope
    showEditFormDialog.value = true
    return
  }
  if (intent === 'cancel') {
    try {
      await store.editBooking(booking.id, scope, {
        status: 'cancelled',
        cancelReason: 'manual',
      })
      selectedBookingId.value = null
    } catch {
      // store.error gère l'affichage.
    }
    return
  }
  try {
    await store.deleteBooking(booking.id, scope)
    selectedBookingId.value = null
  } catch {
    // idem
  }
}

function handleEditSaved(): void {
  selectedBookingId.value = null
}
</script>

<template>
  <!--
    Layout responsive : la page occupe toute la hauteur disponible (viewport
    moins le header `h-14`). En mode "planning", le calendrier vue-cal
    s'étire pour occuper toute la place restante (flex-1, min-h-0) — la
    barre d'outils (sticky top) reste prioritaire en hauteur, le reste va
    au calendrier. Côté largeur : le conteneur fluide (w-full) laisse
    vue-cal prendre toute la largeur du `<main>` (calculée par le grid de
    l'AppLayout : `[240px_1fr]`). Sur écran 1280px+ : pleine largeur. Sur
    mobile (≤640px) : la grille reste utilisable, on cache les splits par
    court (cf. <style scoped>) et on impose un scroll horizontal léger.
  -->
  <section class="p-4 md:p-6 flex flex-col gap-4 h-[calc(100vh-3.5rem)] min-h-0">
    <Tabs
      v-model:value="activeTab"
      class="flex-1 min-h-0 flex flex-col"
      :pt="{ panels: { class: 'flex-1 min-h-0 flex flex-col p-0 pt-3' } }"
    >
      <TabList>
        <Tab value="planning">
          Planning
        </Tab>
        <Tab value="list">
          Toutes les réservations
        </Tab>
      </TabList>
      <TabPanels>
        <TabPanel
          value="planning"
          class="flex-1 min-h-0 flex flex-col"
        >
          <div class="flex-1 min-h-0 flex flex-col gap-4">
            <!-- Toolbar : nav + view switch + venue filter + create -->
            <div class="flex items-center gap-3 flex-wrap shrink-0">
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
                :model-value="activeView"
                :options="[...viewOptions]"
                option-label="label"
                option-value="value"
                size="small"
                class="!min-w-32"
                @update:model-value="(v: 'day' | 'week' | 'month') => (activeView = v)"
              />

              <Select
                v-if="activeView !== 'month'"
                v-model="periodFilter"
                :options="[...periodOptions]"
                option-label="label"
                option-value="value"
                size="small"
                class="!min-w-44"
                aria-label="Filtrer la plage horaire affichée"
              />

              <div class="ml-auto flex items-center gap-2">
                <Button
                  severity="primary"
                  size="small"
                  @click="openCreateDialog"
                >
                  <Plus
                    :size="14"
                    :stroke-width="2"
                  />
                  <span class="ml-1.5">Nouvelle réservation</span>
                </Button>
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

            <!-- Empty state — pas de saison active -->
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
                Activez une saison pour afficher le planning.
              </div>
              <RouterLink
                to="/seasons"
                class="btn btn-primary btn-sm mt-2"
              >
                Aller aux saisons
              </RouterLink>
            </div>

            <!-- Empty state — pas de venue -->
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
                Ajoutez au moins un venue avec des courts.
              </div>
            </div>

            <!-- Calendrier vue-cal — `flex-1 min-h-0` pour occuper toute la
                 place verticale restante. `bookings-vuecal-wrap` porte les
                 overrides CSS (largeur 100%, scroll horizontal mobile). -->
            <div
              v-else
              class="card overflow-hidden flex-1 min-h-0 bookings-vuecal-wrap"
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
                :disable-views="['years', 'year']"
                :events-on-month-view="'short'"
                locale="fr"
                :twelve-hour="false"
                style="height: 100%; width: 100%;"
                @event-click="onEventClick"
              />
            </div>

            <!-- Bannière erreur -->
            <div
              v-if="store.error || store.listError"
              class="card border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700 flex items-center gap-2"
            >
              <TriangleAlert
                :size="14"
                :stroke-width="2"
              />
              {{ store.error ?? store.listError }}
            </div>

            <!-- Drawer détail booking -->
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

                  <div class="flex-1 overflow-y-auto px-5 py-4 space-y-5 text-[13px]">
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
                        <span class="num font-medium">
                          {{ selectedBooking.startTime }} — {{ selectedBooking.endTime }}
                        </span>
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

                    <section class="space-y-2 pt-2 border-t border-surface-200">
                      <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
                        Actions
                      </h4>
                      <div class="flex flex-col gap-2">
                        <Button
                          severity="secondary"
                          size="small"
                          outlined
                          @click="openScopeDialog('edit')"
                        >
                          <Pencil
                            :size="14"
                            :stroke-width="2"
                          />
                          <span class="ml-1.5">Modifier</span>
                        </Button>
                        <Button
                          v-if="selectedBooking.status === 'scheduled'"
                          severity="warn"
                          size="small"
                          outlined
                          @click="openScopeDialog('cancel')"
                        >
                          <Ban
                            :size="14"
                            :stroke-width="2"
                          />
                          <span class="ml-1.5">Annuler ce créneau</span>
                        </Button>
                        <Button
                          severity="danger"
                          size="small"
                          outlined
                          @click="openScopeDialog('delete')"
                        >
                          <Trash2
                            :size="14"
                            :stroke-width="2"
                          />
                          <span class="ml-1.5">Supprimer</span>
                        </Button>
                      </div>
                    </section>
                  </div>
                </div>
              </template>
            </Drawer>
          </div>
        </TabPanel>
        <TabPanel
          value="list"
          class="flex-1 min-h-0 overflow-y-auto"
        >
          <!--
            `@create` ouvre le même dialog `BookingFormDialog` que le bouton
            "Nouvelle réservation" du panneau Planning — on évite de monter
            une seconde instance du dialog (réutilise `showCreateDialog`).
          -->
          <BookingListPanel @create="openCreateDialog" />
        </TabPanel>
      </TabPanels>
    </Tabs>

    <!--
      Dialogs partagés — montés au niveau racine (hors des TabPanels) pour
      rester disponibles quel que soit l'onglet actif (le PrimeVue Tabs
      détruit le contenu des panneaux inactifs par défaut).
    -->
    <BookingFormDialog v-model:visible="showCreateDialog" />

    <BookingEditScopeDialog
      v-model:visible="showScopeDialog"
      :intent="scopeIntent"
      :is-series="isSelectedBookingSeries"
      :is-past="isSelectedBookingPast"
      @confirm="handleScopeConfirm"
    />

    <BookingEditFormDialog
      v-model:visible="showEditFormDialog"
      :booking="selectedBooking"
      :scope="editScope"
      :is-past="isSelectedBookingPast"
      @saved="handleEditSaved"
    />
  </section>
</template>

<style scoped>
/*
 * vue-cal — overrides ciblés.
 *
 * On garde le CSS de base de vue-cal (importé dans le <script setup>) et on
 * override uniquement :
 *  - les couleurs d'évènements par type (mapping slotType → palette tailwind)
 *  - quelques détails de typographie pour matcher le reste de l'app
 *
 * Les sélecteurs sont `:deep()` car vue-cal génère ses propres classes hors
 * du scope Vue. On évite `!important` quand un poids plus élevé suffit.
 */

/*
 * Wrapper de vue-cal — width 100% pour absorber toute la largeur dispo
 * (la grille parente AppLayout impose déjà `1fr` sur la colonne main).
 * On gère également le scroll horizontal en mode "day" sur petit écran :
 * quand la grille split-days dépasse la largeur (beaucoup de courts), un
 * scroll horizontal apparaît plutôt que d'écraser les colonnes.
 */
.bookings-vuecal-wrap {
  width: 100%;
  display: flex;
  flex-direction: column;
}

.bookings-vuecal-wrap > :deep(.vuecal) {
  flex: 1 1 auto;
  min-height: 0;
}

/* Mode `day` avec splits : autorise un scroll horizontal interne plutôt que
   d'écraser les colonnes (utile quand il y a beaucoup de courts ou un
   viewport étroit). */
.bookings-vuecal-wrap :deep(.vuecal--day-view .vuecal__bg) {
  overflow-x: auto;
}

:deep(.vuecal) {
  font-size: 12px;
  font-family: inherit;
  width: 100%;
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
}

/*
 * Ligne secondaire ("court · coach") posée via `event.content`. Plus
 * discrète que le title pour préserver la hiérarchie visuelle.
 */
:deep(.vuecal__event-content) {
  font-size: 10.5px;
  font-weight: 400;
  opacity: 0.85;
  margin-top: 1px;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

:deep(.vuecal__event.vc-training) {
  background: rgb(239 246 255);
  border-color: rgb(191 219 254);
  color: rgb(29 78 216);
}

:deep(.vuecal__event.vc-match-home) {
  background: rgb(167 243 208);
  border-width: 2px;
  border-color: rgb(5 150 105);
  color: rgb(6 78 59);
  font-weight: 600;
  box-shadow: 0 1px 2px rgb(16 185 129 / 0.15);
}

:deep(.vuecal__event.vc-match-away) {
  background: rgb(245 243 255);
  border-color: rgb(196 181 253);
  color: rgb(91 33 182);
}

:deep(.vuecal__event.vc-match-pending) {
  background: rgb(255 247 237);
  border-color: rgb(253 186 116);
  color: rgb(154 52 18);
}

:deep(.vuecal__event.vc-reserve) {
  background: rgb(244 244 245);
  border-color: rgb(212 212 216);
  color: rgb(82 82 91);
}

:deep(.vuecal__event.vc-custom) {
  background: rgb(254 252 232);
  border-color: rgb(253 224 71);
  color: rgb(133 77 14);
}

:deep(.vuecal__event.vc-cancelled) {
  opacity: 0.5;
  text-decoration: line-through;
}

:deep(.vuecal__event.vc-freed) {
  background: rgb(250 250 250);
  border-color: rgb(212 212 216);
  border-style: dashed;
  color: rgb(113 113 122);
}

/* Splits header (courts) : libellé centré, sticky. */
:deep(.vuecal__split-days-headers .day-split-header) {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: rgb(82 82 91);
  padding: 6px 4px;
}

/* Heures de la grille. */
:deep(.vuecal__time-column .vuecal__time-cell-label) {
  font-size: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: rgb(161 161 170);
}

/* Cellule du jour en cours. */
:deep(.vuecal--day-view .vuecal__cell--today) {
  background: rgb(254 252 232 / 0.4);
}

/*
 * Mobile (≤ 640px) — desktop reste prioritaire (cf. tâche : "ok si
 * utilisable" sur mobile). On serre la densité visuelle (police plus
 * petite, padding réduit, labels splits compacts) et on rappelle le
 * scroll horizontal pour éviter l'overflow. La vue "day" reste
 * utilisable colonne par colonne via swipe.
 */
@media (max-width: 640px) {
  :deep(.vuecal) {
    font-size: 11px;
  }
  :deep(.vuecal__event) {
    padding: 2px 4px;
    border-radius: 4px;
  }
  :deep(.vuecal__event-content) {
    font-size: 9.5px;
  }
  :deep(.vuecal__split-days-headers .day-split-header) {
    font-size: 9.5px;
    padding: 4px 2px;
    letter-spacing: 0.02em;
  }
  :deep(.vuecal__time-column .vuecal__time-cell-label) {
    font-size: 9px;
  }
  /* Largeur minimale d'une colonne split en mobile pour rester lisible —
     déclenche le scroll horizontal si la grille dépasse. */
  :deep(.vuecal--day-view .vuecal__cell-split) {
    min-width: 110px;
  }
}
</style>
