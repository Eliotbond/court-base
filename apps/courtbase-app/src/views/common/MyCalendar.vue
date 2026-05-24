<script setup lang="ts">
/**
 * Mon Calendrier — vue personnelle multi-rôle (commune à player / coach /
 * official / admin).
 *
 * Agrège dans un seul calendrier :
 *  - Les bookings des équipes auxquelles le caller appartient en tant que
 *    **joueur** (via `myProfile.teams`).
 *  - Les bookings des équipes **coachées** par le caller (via
 *    `bookingsStore.myTeamIds`).
 *  - Les **assignations d'officiel** (pending + confirmed) — HOME via le
 *    booking parent dans `bookingsStore.allBookings`, AWAY via le match doc
 *    de `officialsStore.awayMatches`.
 *
 * Dédup par identifiant unique (un booking présent à la fois en "ma team
 * joueur" et "ma team coachée" est mergé — la source la plus spécifique
 * gagne dans l'ordre : official > coach > player).
 *
 * Aucune mutation depuis cette vue (pas de cancel ni d'inscription) — c'est
 * une vue de **lecture**. Les actions vivent dans les vues dédiées (Agenda
 * coach pour cancel training, MyAssignments officiel pour respond).
 *
 * Mobile-first via `CbMobileShell` + bascule `CbDesktopShell` ≥ 1024px.
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertTriangle,
  CalendarCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Info,
  MapPin,
  Users,
  Shield,
  X,
} from 'lucide-vue-next'
import VueCal, { type VueCalEvent } from 'vue-cal'
import 'vue-cal/dist/vuecal.css'

import CbDesktopShell from '@/components/ui/CbDesktopShell.vue'
import CbEmptyState from '@/components/ui/CbEmptyState.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbPageHead from '@/components/ui/CbPageHead.vue'
import CbPill from '@/components/ui/CbPill.vue'
import { useActiveSeason } from '@/composables/useSeason'
import { useShellNav } from '@/composables/useShellNav'
import { useViewport } from '@/composables/useViewport'
import { useAuthStore } from '@/stores/auth'
import { useBookingsStore, type BookingRow } from '@/stores/bookings'
import { useMyProfileStore } from '@/stores/myProfile'
import {
  useOfficialsStore,
  type MyAssignmentEntry,
} from '@/stores/officials'
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
const myProfile = useMyProfileStore()
const officialsStore = useOfficialsStore()
const seasonStore = useActiveSeason()
const { isDesktop } = useViewport()
const { tabs, nav, primaryRoleLabel } = useShellNav()

// ─── Mount ─────────────────────────────────────────────────────────

const localLoading = ref(true)

onMounted(async () => {
  try {
    // Bookings (saison entière du club) + myProfile en parallèle. Les
    // appels sont idempotents — pas de re-fetch si déjà hydraté.
    await Promise.all([
      bookingsStore.loadActiveContext(),
      myProfile.load(),
    ])
    // Officials a besoin d'un seasonId. On le charge à la fin (en mock,
    // resolvedSeasonId = 'mock-season' — l'appel devient un no-op
    // synthétique côté store).
    const resolvedSeasonId = (await seasonStore.load()) ?? 'mock-season'
    await officialsStore.loadOfficialContext(resolvedSeasonId)
  } catch (err) {
    console.error('[MyCalendar] mount failed', err)
  } finally {
    localLoading.value = false
  }
})

// ─── Sources / filtres ─────────────────────────────────────────────

type SourceKind = 'player' | 'coach' | 'official'

const SOURCE_LABEL: Record<SourceKind, string> = {
  player: 'Mes équipes',
  coach: 'Équipes coachées',
  official: 'Assignations officiel',
}

const SOURCE_TONE: Record<SourceKind, 'emerald' | 'violet' | 'amber'> = {
  player: 'emerald',
  coach: 'violet',
  official: 'amber',
}

/**
 * Un item de calendrier — abstraction unifiée d'un booking ou d'un match
 * AWAY. La `source` indique pourquoi l'item est visible (joueur/coach/
 * officiel) ; le `visualKind` reste piloté par le type d'événement (training,
 * match-home, match-away) pour conserver la palette cohérente.
 */
interface CalendarItem {
  /** Clé unique vue-cal — `<sourcePriority>:<entityId>` pour autoriser la
   *  dédup sans collision (cf. `aggregated`). */
  key: string
  source: SourceKind
  startMs: number
  endMs: number
  date: string // 'YYYY-MM-DD' pour le badge liste
  startTime: string
  endTime: string
  visualKind: BookingVisualKind
  /** Première ligne (équipe / match). */
  title: string
  teamName: string | null
  opponentName: string | null
  venueLabel: string | null
  coachLabel: string | null
  cancelReason: string | null
  /** Référence vers le booking parent (HOME/training) si applicable. */
  bookingId: string | null
  /** Référence vers le match AWAY si applicable (officiel uniquement). */
  matchId: string | null
  /** Pour les assignations officiel : status pending/confirmed/declined. */
  officialStatus?: 'pending' | 'confirmed' | 'declined'
}

const activeSources = ref<Set<SourceKind>>(
  new Set<SourceKind>(['player', 'coach', 'official']),
)

function toggleSource(s: SourceKind): void {
  const next = new Set(activeSources.value)
  if (next.has(s)) next.delete(s)
  else next.add(s)
  activeSources.value = next
}

function isSourceActive(s: SourceKind): boolean {
  return activeSources.value.has(s)
}

// ─── Helpers d'extraction ──────────────────────────────────────────

/** Lit un epoch ms à partir d'un Timestamp Firestore ou structurel. */
function tsToMs(ts: { seconds?: number; toMillis?: () => number } | null | undefined): number {
  if (!ts) return 0
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (typeof ts.seconds === 'number') return ts.seconds * 1000
  return 0
}

/** Ajoute "HH:MM" à un epoch ms (date 00h) → epoch ms. */
function addHhmmToDateMs(dateMs: number, hhmm: string): number {
  const parts = hhmm.split(':')
  const hh = Number(parts[0] ?? '0')
  const mm = Number(parts[1] ?? '0')
  const d = new Date(dateMs)
  d.setHours(hh, mm, 0, 0)
  return d.getTime()
}

/** "YYYY-MM-DD" depuis un epoch ms (local). */
function isoFromMs(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function venueLabelFromBooking(b: BookingRow): string | null {
  if (b.venueName && b.courtName && b.venueName !== b.courtName) {
    return `${b.venueName} : ${b.courtName}`
  }
  return b.venueName ?? b.courtName ?? null
}

function titleForBooking(b: BookingRow): string {
  const kind = visualKindOf(b)
  if (kind === 'match-home') {
    const opp = b.opponentName?.trim()
    return opp ? `${b.teamName ?? 'Match'} vs ${opp}` : (b.teamName ?? 'Match domicile')
  }
  if (kind === 'match-away') {
    const opp = b.opponentName?.trim()
    return opp ? `${b.teamName ?? 'Match'} à ${opp}` : (b.teamName ?? 'Match extérieur')
  }
  return b.teamName ? `${BOOKING_LABELS[kind]} · ${b.teamName}` : BOOKING_LABELS[kind]
}

function itemFromBooking(b: BookingRow, source: SourceKind): CalendarItem {
  return {
    key: `${source}:b:${b.id}`,
    source,
    startMs: b.startMs,
    endMs: b.endMs,
    date: b.date || isoFromMs(b.startMs),
    startTime: b.startTime,
    endTime: b.endTime,
    visualKind: visualKindOf(b),
    title: titleForBooking(b),
    teamName: b.teamName,
    opponentName: b.opponentName,
    venueLabel: venueLabelFromBooking(b),
    coachLabel: b.coachLabel,
    cancelReason: b.cancelReason,
    bookingId: b.id,
    matchId: null,
  }
}

function itemFromAwayAssignment(entry: MyAssignmentEntry): CalendarItem | null {
  if (entry.parent.kind !== 'away') return null
  const m = entry.parent.match
  const dateMs = tsToMs(m.date)
  if (!dateMs) return null
  const startMs = addHhmmToDateMs(dateMs, m.startTime)
  const endMs = addHhmmToDateMs(dateMs, m.endTime)
  const teamName = entry.team?.name ?? null
  const opp = m.opponentName?.trim() || null
  const title = opp
    ? `${teamName ?? 'Match'} à ${opp}`
    : (teamName ?? 'Match extérieur')
  return {
    key: `official:m:${m.id}`,
    source: 'official',
    startMs,
    endMs,
    date: isoFromMs(startMs),
    startTime: m.startTime,
    endTime: m.endTime,
    visualKind: 'match-away',
    title,
    teamName,
    opponentName: opp,
    venueLabel: m.awayAddress,
    coachLabel: null,
    cancelReason: null,
    bookingId: null,
    matchId: m.id,
    officialStatus: entry.assignment.status,
  }
}

// ─── Agrégation ───────────────────────────────────────────────────

/**
 * Fusionne les 3 sources en une map dédupliquée par entité (booking.id ou
 * `away:matchId`). Ordre de priorité quand le même item apparaît dans
 * plusieurs sources : `official > coach > player` — l'item garde la source
 * la plus "spécifique" pour le badge.
 */
const aggregated = computed<CalendarItem[]>(() => {
  const byEntity = new Map<string, CalendarItem>()

  // 1. Player — bookings des équipes auxquelles le caller appartient.
  const playerTeamIds = new Set(myProfile.teams.map((t) => t.id))
  for (const b of bookingsStore.allBookings) {
    if (!b.teamId || !playerTeamIds.has(b.teamId)) continue
    const item = itemFromBooking(b, 'player')
    byEntity.set(`b:${b.id}`, item)
  }

  // 2. Coach — bookings des équipes coachées (peut chevaucher player).
  for (const b of bookingsStore.allBookings) {
    if (!bookingsStore.isMyBooking(b)) continue
    const existing = byEntity.get(`b:${b.id}`)
    if (existing && existing.source === 'official') continue // official prime
    byEntity.set(`b:${b.id}`, itemFromBooking(b, 'coach'))
  }

  // 3. Official — assignations HOME (booking) + AWAY (match).
  //    Pending + confirmed (les declined ne polluent pas le calendrier).
  for (const list of [
    officialsStore.myAssignments.confirmed,
    officialsStore.myAssignments.pending,
  ]) {
    for (const entry of list) {
      if (entry.parent.kind === 'home') {
        const b = entry.parent.booking
        const item = itemFromBooking(b, 'official')
        item.officialStatus = entry.assignment.status
        byEntity.set(`b:${b.id}`, item)
      } else {
        const item = itemFromAwayAssignment(entry)
        if (item) byEntity.set(`m:${entry.parent.match.id}`, item)
      }
    }
  }

  return [...byEntity.values()]
})

const visibleItems = computed<CalendarItem[]>(() =>
  aggregated.value.filter((i) => activeSources.value.has(i.source)),
)

// ─── Tabs Calendrier / Liste ──────────────────────────────────────

type ActiveTab = 'calendar' | 'list'
const activeTab = ref<ActiveTab>('calendar')
function setActiveTab(t: ActiveTab): void {
  activeTab.value = t
}

// ─── Calendrier : state vue-cal ───────────────────────────────────

type CalView = 'day' | 'week' | 'month'
const activeView = ref<CalView>('week')
const selectedDate = ref<Date>(new Date())

const eveningOnly = ref(true)
const TIME_FROM_EVENING = 17 * 60
const TIME_TO_EVENING = 22 * 60
const TIME_FROM_FULL = 6 * 60
const TIME_TO_FULL = 24 * 60
const TIME_STEP = 30
const TIME_CELL_HEIGHT = 28

const timeFrom = computed(() => (eveningOnly.value ? TIME_FROM_EVENING : TIME_FROM_FULL))
const timeTo = computed(() => (eveningOnly.value ? TIME_TO_EVENING : TIME_TO_FULL))

interface AgendaEvent extends VueCalEvent {
  itemKey: string
  start: Date
  end: Date
  title: string
  class: string
}

/** Map les CalendarItem visibles en events vue-cal. */
const displayedEvents = computed<AgendaEvent[]>(() =>
  visibleItems.value.map((i) => {
    const sourceClass = `cb-mc-src-${i.source}`
    const dimmed =
      i.source === 'official' && i.officialStatus === 'pending' ? ' cb-mc-pending' : ''
    return {
      itemKey: i.key,
      start: new Date(i.startMs),
      end: new Date(i.endMs),
      title: buildCalendarLabel(i),
      class: `${BOOKING_CLASS[i.visualKind]} ${sourceClass}${dimmed}`,
    }
  }),
)

function buildCalendarLabel(i: CalendarItem): string {
  const lines: string[] = [i.title]
  if (i.venueLabel) lines.push(i.venueLabel)
  if (i.source === 'official') {
    lines.push(i.officialStatus === 'pending' ? 'Officiel · à confirmer' : 'Officiel')
  } else if (i.source === 'coach' && i.coachLabel) {
    lines.push(`Coach ${i.coachLabel}`)
  }
  return lines.join('\n')
}

// ─── Navigation période ───────────────────────────────────────────

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

// ─── Click → dialog détail ────────────────────────────────────────

const detailOpen = ref(false)
const detailItem = ref<CalendarItem | null>(null)

function openDetailByKey(key: string): void {
  const found = visibleItems.value.find((i) => i.key === key)
  if (!found) return
  detailItem.value = found
  detailOpen.value = true
}

function closeDetail(): void {
  detailOpen.value = false
  detailItem.value = null
}

function onEventClick(payload: unknown): void {
  const evt = payload as { itemKey?: string } | null
  if (!evt?.itemKey) return
  openDetailByKey(evt.itemKey)
}

function onCellClick(payload: unknown): void {
  if (activeView.value !== 'month') return
  const date = payload instanceof Date ? payload : null
  if (!date) return
  selectedDate.value = date
  activeView.value = 'day'
}

const detailDateLabel = computed<string>(() => {
  const i = detailItem.value
  if (!i) return ''
  const raw = dayLongFormatter.format(new Date(i.startMs))
  return raw.charAt(0).toUpperCase() + raw.slice(1)
})

function goToItemDetail(): void {
  const i = detailItem.value
  if (!i) return
  closeDetail()
  // Officiel : si c'est une assignation, on route vers la vue match-detail
  // (qui sert HOME + AWAY).
  if (i.source === 'official') {
    if (i.matchId) {
      router.push({ name: 'match-detail', params: { id: i.matchId } })
      return
    }
    if (i.bookingId) {
      router.push({ name: 'match-detail', params: { id: i.bookingId } })
      return
    }
  }
  // Coach : on route vers le planning de l'équipe pour les actions (cancel,
  // attendance, etc.). Le router rabattra en `home` si l'allowlist refuse
  // (non-coach), donc on ne navigue que si le caller est coach.
  if (i.source === 'coach' && auth.isCoach && i.bookingId) {
    // On a besoin du teamId — on relit le booking depuis le store.
    const b = bookingsStore.allBookings.find((x) => x.id === i.bookingId)
    if (b?.teamId) {
      router.push({ name: 'planning', params: { teamId: b.teamId } })
      return
    }
  }
  // Joueur : pas de page détail dédiée — on ferme juste le dialog.
}

// ─── Liste : filtrage / tri ───────────────────────────────────────

type TimeFilter = 'upcoming' | 'past' | 'all'

const TIME_FILTERS: ReadonlyArray<{ id: TimeFilter; label: string }> = [
  { id: 'upcoming', label: 'À venir' },
  { id: 'past', label: 'Passé' },
  { id: 'all', label: 'Tout' },
]

const activeTimeFilter = ref<TimeFilter>('upcoming')

function setTimeFilter(id: TimeFilter): void {
  activeTimeFilter.value = id
}

const filteredItems = computed<CalendarItem[]>(() => {
  const now = Date.now()
  let arr = visibleItems.value
  if (activeTimeFilter.value === 'upcoming') {
    arr = arr.filter((i) => i.startMs >= now)
  } else if (activeTimeFilter.value === 'past') {
    arr = arr.filter((i) => i.startMs < now)
  }
  return arr.slice().sort((a, b) =>
    activeTimeFilter.value === 'past' ? b.startMs - a.startMs : a.startMs - b.startMs,
  )
})

// ─── Helpers liste (date badge) ──────────────────────────────────

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

function kindBorderColor(i: CalendarItem): string {
  switch (i.visualKind) {
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

function rowStyle(i: CalendarItem): Record<string, string> {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '12px',
    cursor: 'pointer',
    borderLeft: `4px solid ${kindBorderColor(i)}`,
    opacity: i.visualKind === 'cancelled' ? '0.75' : '1',
  }
}

function onRowClick(i: CalendarItem): void {
  openDetailByKey(i.key)
}

const isLoading = computed(
  () => localLoading.value || bookingsStore.loading || officialsStore.loading,
)

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
    <CbPageHead title="Mon Calendrier" :subtitle="periodLabel">
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
      <div class="mc-toolbar mc-toolbar-desktop">
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

        <div class="mc-nav">
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

        <div class="mc-toggles">
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
        </div>
      </div>

      <div class="mc-sources">
        <button
          v-for="s in ['player', 'coach', 'official'] as SourceKind[]"
          :key="s"
          type="button"
          class="cb-chip"
          :class="{ active: isSourceActive(s) }"
          @click="toggleSource(s)"
        >
          <span class="mc-chip-dot" :class="`mc-chip-dot--${s}`" />
          {{ SOURCE_LABEL[s] }}
        </button>
      </div>

      <div class="mc-desktop-body">
        <div class="mc-card">
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

        <div v-if="bookingsStore.lastError" class="mc-error">
          <AlertTriangle :size="14" />
          {{ bookingsStore.lastError }}
        </div>
      </div>
    </template>

    <!-- ─── Tab Liste ─────────────────────────────────────────── -->
    <template v-else>
      <div class="mc-list-toolbar">
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

        <div class="mc-sources">
          <button
            v-for="s in ['player', 'coach', 'official'] as SourceKind[]"
            :key="s"
            type="button"
            class="cb-chip"
            :class="{ active: isSourceActive(s) }"
            @click="toggleSource(s)"
          >
            <span class="mc-chip-dot" :class="`mc-chip-dot--${s}`" />
            {{ SOURCE_LABEL[s] }}
          </button>
        </div>
      </div>

      <div class="mc-list mc-list-desktop">
        <CbEmptyState
          v-if="isLoading && filteredItems.length === 0"
          :icon="CalendarDays"
          title="Chargement…"
          body="Récupération de vos événements."
        />
        <CbEmptyState
          v-else-if="filteredItems.length === 0"
          :icon="CalendarCheck"
          title="Aucun événement"
          body="Vos entraînements, matchs et assignations apparaîtront ici."
        />

        <div
          v-for="i in filteredItems"
          :key="i.key"
          class="cb-card mc-row"
          :style="rowStyle(i)"
          role="button"
          tabindex="0"
          @click="onRowClick(i)"
          @keyup.enter="onRowClick(i)"
        >
          <div class="mc-row-head">
            <CbPill :tone="BOOKING_PILL_TONE[i.visualKind]" dot>
              {{ BOOKING_LABELS[i.visualKind] }}
            </CbPill>
            <CbPill :tone="SOURCE_TONE[i.source]" solid>
              {{ SOURCE_LABEL[i.source] }}
            </CbPill>
            <span class="mc-row-date">{{ dateBadge(i.date) }}</span>
          </div>
          <div class="mc-row-body">
            <div class="mc-row-title">{{ i.title }}</div>
            <div class="cb-sub">
              {{ i.startTime }}–{{ i.endTime }}{{
                i.venueLabel ? ' · ' + i.venueLabel : ''
              }}
            </div>
            <div v-if="i.coachLabel" class="cb-sub">Coach {{ i.coachLabel }}</div>
            <div
              v-if="i.source === 'official' && i.officialStatus === 'pending'"
              class="cb-sub mc-row-pending"
            >
              <Shield :size="13" /> Réponse attendue
            </div>
            <div v-if="i.cancelReason" class="cb-sub mc-row-reason">
              Motif : {{ i.cancelReason }}
            </div>
          </div>
        </div>
      </div>
    </template>
  </CbDesktopShell>

  <!-- ─── Mobile <1024 ──────────────────────────────────────────── -->
  <CbMobileShell
    v-else
    title="Mon Calendrier"
    :tabs="tabs"
    @notif-click="router.push({ name: 'notifications' })"
  >
    <div class="mc-tabs-mobile">
      <div class="cb-segmented mc-segmented-full">
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
      <div class="mc-toolbar-mobile">
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

        <div class="mc-nav">
          <button
            type="button"
            class="cb-iconbtn sm"
            aria-label="Précédent"
            @click="goPrevious"
          >
            <ChevronLeft :size="16" />
          </button>
          <button type="button" class="mc-today-btn" @click="goToday">
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

      <div class="mc-toggles-mobile">
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
      </div>

      <div class="mc-sources mc-sources-mobile">
        <button
          v-for="s in ['player', 'coach', 'official'] as SourceKind[]"
          :key="s"
          type="button"
          class="cb-chip"
          :class="{ active: isSourceActive(s) }"
          @click="toggleSource(s)"
        >
          <span class="mc-chip-dot" :class="`mc-chip-dot--${s}`" />
          {{ SOURCE_LABEL[s] }}
        </button>
      </div>

      <div class="mc-period-label">{{ periodLabel }}</div>

      <div class="mc-mobile-body">
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

      <div v-if="bookingsStore.lastError" class="mc-error">
        <AlertTriangle :size="14" />
        {{ bookingsStore.lastError }}
      </div>
    </template>

    <!-- ─── Tab Liste mobile ──────────────────────────────────── -->
    <template v-else>
      <div class="mc-mobile-filters">
        <div class="cb-segmented mc-segmented-full">
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
      </div>

      <div class="mc-sources mc-sources-mobile">
        <button
          v-for="s in ['player', 'coach', 'official'] as SourceKind[]"
          :key="s"
          type="button"
          class="cb-chip"
          :class="{ active: isSourceActive(s) }"
          @click="toggleSource(s)"
        >
          <span class="mc-chip-dot" :class="`mc-chip-dot--${s}`" />
          {{ SOURCE_LABEL[s] }}
        </button>
      </div>

      <div class="mc-list">
        <CbEmptyState
          v-if="isLoading && filteredItems.length === 0"
          :icon="CalendarDays"
          title="Chargement…"
          body="Récupération de vos événements."
        />
        <CbEmptyState
          v-else-if="filteredItems.length === 0"
          :icon="CalendarCheck"
          title="Aucun événement"
          body="Vos entraînements, matchs et assignations apparaîtront ici."
        />

        <div
          v-for="i in filteredItems"
          :key="i.key"
          class="cb-card mc-row"
          :style="rowStyle(i)"
          role="button"
          tabindex="0"
          @click="onRowClick(i)"
          @keyup.enter="onRowClick(i)"
        >
          <div class="mc-row-head">
            <CbPill :tone="BOOKING_PILL_TONE[i.visualKind]" dot>
              {{ BOOKING_LABELS[i.visualKind] }}
            </CbPill>
            <CbPill :tone="SOURCE_TONE[i.source]" solid>
              {{ SOURCE_LABEL[i.source] }}
            </CbPill>
            <span class="mc-row-date">{{ dateBadge(i.date) }}</span>
          </div>
          <div class="mc-row-body">
            <div class="mc-row-title">{{ i.title }}</div>
            <div class="cb-sub">
              {{ i.startTime }}–{{ i.endTime }}{{
                i.venueLabel ? ' · ' + i.venueLabel : ''
              }}
            </div>
            <div v-if="i.coachLabel" class="cb-sub">Coach {{ i.coachLabel }}</div>
            <div
              v-if="i.source === 'official' && i.officialStatus === 'pending'"
              class="cb-sub mc-row-pending"
            >
              <Shield :size="13" /> Réponse attendue
            </div>
            <div v-if="i.cancelReason" class="cb-sub mc-row-reason">
              Motif : {{ i.cancelReason }}
            </div>
          </div>
        </div>
      </div>
    </template>
  </CbMobileShell>

  <!-- ─── Dialog détail ────────────────────────────────────────── -->
  <Teleport to="body">
    <div
      v-if="detailOpen && detailItem"
      class="mc-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Détail événement"
      @click.self="closeDetail"
    >
      <div class="mc-dialog">
        <div class="mc-dialog-head">
          <div class="mc-dialog-title">
            <CbPill :tone="BOOKING_PILL_TONE[detailItem.visualKind]" dot>
              {{ BOOKING_LABELS[detailItem.visualKind] }}
            </CbPill>
            <CbPill :tone="SOURCE_TONE[detailItem.source]" solid>
              {{ SOURCE_LABEL[detailItem.source] }}
            </CbPill>
          </div>
          <button
            type="button"
            class="cb-iconbtn"
            aria-label="Fermer"
            @click="closeDetail"
          >
            <X :size="18" />
          </button>
        </div>
        <div class="mc-dialog-body">
          <h2 class="cb-h2 mc-dialog-eventtitle">{{ detailItem.title }}</h2>
          <p class="mc-dialog-summary">
            {{ detailDateLabel }}<br />
            <strong>{{ detailItem.startTime }} – {{ detailItem.endTime }}</strong>
          </p>

          <div v-if="detailItem.venueLabel" class="mc-dialog-meta">
            <MapPin :size="16" />
            <span>{{ detailItem.venueLabel }}</span>
          </div>
          <div v-if="detailItem.teamName" class="mc-dialog-meta">
            <Users :size="16" />
            <span>{{ detailItem.teamName }}</span>
          </div>
          <div
            v-if="detailItem.source === 'official' && detailItem.officialStatus === 'pending'"
            class="mc-dialog-banner"
          >
            <Info :size="16" />
            <span>
              Cette assignation est en attente de votre réponse — ouvrez le
              détail pour confirmer ou décliner.
            </span>
          </div>
          <div v-if="detailItem.cancelReason" class="mc-dialog-banner mc-dialog-banner-warn">
            <AlertTriangle :size="16" />
            <span>Annulation : {{ detailItem.cancelReason }}</span>
          </div>
        </div>
        <div class="mc-dialog-actions">
          <button type="button" class="cb-btn ghost" @click="closeDetail">
            Fermer
          </button>
          <button
            v-if="
              detailItem.source === 'official' ||
              (detailItem.source === 'coach' && auth.isCoach)
            "
            type="button"
            class="cb-btn"
            @click="goToItemDetail"
          >
            Voir détail
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ─── Layout shells ───────────────────────────────────────────── */
.mc-desktop-body {
  flex: 1;
  overflow: auto;
  padding: 16px 28px 20px;
  background: var(--bg-muted);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mc-card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  height: calc(100vh - 300px);
  min-height: 460px;
}

.mc-mobile-body {
  flex: 1;
  background: var(--bg);
  border-top: 1px solid var(--border);
  height: calc(100vh - 56px - 64px - 280px);
  min-height: 300px;
}

.mc-tabs-mobile {
  padding: 8px 16px 0;
  background: var(--bg);
}

.mc-segmented-full {
  width: 100%;
  display: flex;
}
.mc-segmented-full button {
  flex: 1;
  text-align: center;
}

.mc-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  padding: 12px 28px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}

.mc-toolbar-desktop .mc-toggles {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.mc-toolbar-mobile {
  padding: 10px 16px 0;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.mc-toggles-mobile {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 6px 16px 0;
  background: var(--bg);
}

.mc-period-label {
  padding: 6px 16px;
  background: var(--bg);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-subtle);
}

.mc-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.mc-today-btn {
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
.mc-today-btn:hover {
  background: var(--slate-50);
}

.cb-iconbtn.sm {
  width: 28px;
  height: 28px;
}

.mc-error {
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

/* ─── Sources chips ─────────────────────────────────────────────── */
.mc-sources {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 28px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.mc-sources-mobile {
  padding: 10px 16px;
}
.mc-chip-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: middle;
}
.mc-chip-dot--player {
  background: var(--emerald-500, #10b981);
}
.mc-chip-dot--coach {
  background: var(--violet-500, #8b5cf6);
}
.mc-chip-dot--official {
  background: var(--amber-500, #f59e0b);
}

/* ─── vue-cal overrides — reprennent la palette `.cb-bk-*` de
   tokens.css. On ajoute un liseré accent à droite selon la source
   pour signaler "ce créneau est dans mon calendrier en tant que X". */
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
  position: relative;
}
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

/* Bandeau accent droite par source — superposé sur les classes `.cb-bk-*`. */
:deep(.vuecal__event.cb-mc-src-player::after) {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 3px;
  background: var(--emerald-500, #10b981);
}
:deep(.vuecal__event.cb-mc-src-coach::after) {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 3px;
  background: var(--violet-500, #8b5cf6);
}
:deep(.vuecal__event.cb-mc-src-official::after) {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 3px;
  background: var(--amber-500, #f59e0b);
}
:deep(.vuecal__event.cb-mc-pending) {
  opacity: 0.7;
  border-style: dashed;
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

.cb-segmented.sm button {
  font-size: 11px;
  padding: 3px 8px;
}

/* ─── Liste ─────────────────────────────────────────────────────── */
.mc-list-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  padding: 16px 28px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.mc-list-toolbar .mc-sources {
  padding: 0;
  border-bottom: 0;
  background: transparent;
}

.mc-mobile-filters {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 16px 0;
  background: var(--bg);
}

.mc-list {
  flex: 1;
  overflow: auto;
  padding: 12px 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mc-list-desktop {
  padding: 20px 28px 32px;
  max-width: 880px;
  margin: 0 auto;
  width: 100%;
}

.mc-row-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.mc-row-date {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 500;
  white-space: nowrap;
  text-transform: capitalize;
}
.mc-row-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mc-row-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.mc-row-pending {
  color: var(--amber-700);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.mc-row-reason {
  font-style: italic;
}

/* ─── Dialog détail ─────────────────────────────────────────────── */
.mc-dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 1000;
}
.mc-dialog {
  background: var(--bg);
  border-radius: 16px;
  box-shadow: var(--shadow-lg, 0 20px 40px rgba(0, 0, 0, 0.18));
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.mc-dialog-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  gap: 12px;
}
.mc-dialog-title {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.mc-dialog-body {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.mc-dialog-eventtitle {
  margin: 0;
}
.mc-dialog-summary {
  font-size: 13px;
  line-height: 1.55;
  color: var(--text);
  margin: 0;
}
.mc-dialog-meta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-subtle);
  font-size: 13px;
}
.mc-dialog-banner {
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
.mc-dialog-banner-warn {
  background: var(--amber-50);
  color: var(--amber-700);
}
.mc-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 18px 18px;
  border-top: 1px solid var(--border);
  background: var(--slate-50, var(--bg));
}
</style>
