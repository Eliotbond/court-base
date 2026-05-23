<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Plus,
} from 'lucide-vue-next'

import CbBottomBar from '@/components/ui/CbBottomBar.vue'
import CbDesktopShell from '@/components/ui/CbDesktopShell.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbPageHead from '@/components/ui/CbPageHead.vue'
import CbPill from '@/components/ui/CbPill.vue'
import { useShellNav } from '@/composables/useShellNav'
import { useViewport } from '@/composables/useViewport'
import {
  getTeam,
  listMatches,
  logMockAction,
  type MockMatch,
  type MockTeam,
} from '@/repositories/mock'
import { useAuthStore } from '@/stores/auth'

/**
 * CO5 — Planning d'équipe (coach).
 *
 * Transcription littérale du JSX `CO5Mobile` (308-348) et `CO5Desktop`
 * (350-396) du bundle design. Mobile : segmented "Semaine/Mois", day strip
 * 7 jours, liste verticale des bookings du jour sélectionné. Desktop :
 * grille 60px + 7 colonnes × heures (17:00 → 21:00) avec blocs positionnés
 * en absolute (training emerald, match domicile violet, match ext sky,
 * freed slate).
 *
 * **Date pivot** : `TODAY = 2025-10-15` (mercredi semaine 42). Constante
 * locale pour garantir un rendu déterministe — la grille tombe sur la
 * semaine du 13 au 19 octobre 2025, où vivent les matchs du mock.
 *
 * **Bookings** : le mock n'a pas de `listBookings`. Pour les trainings
 * hebdomadaires, on construit un tableau local `MOCK_BOOKINGS_INLINE` (cf.
 * pattern de l'ancienne version) ; les matchs viennent de `listMatches()`
 * filtrés par `teamId`.
 *
 * **Limitations** :
 * - Pas de vue mensuelle (option "Mois" désactivée — log only).
 * - Pas de gestion des conflits multi-équipes ni multi-courts.
 * - Pas de "now line" indicator sur la grille desktop.
 * - Le bouton "Réserver un créneau" log uniquement (`co5.ad-hoc-booking`).
 */

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { isDesktop } = useViewport()
const { coachTabs, coachNav } = useShellNav()

// ─── Param + team ────────────────────────────────────────────────
const teamId = computed<string>(() => {
  const p = route.params['teamId']
  return Array.isArray(p) ? (p[0] ?? '') : (p ?? '')
})

const team = computed<MockTeam | null>(() => (teamId.value ? getTeam(teamId.value) : null))

// ─── Date pivot ──────────────────────────────────────────────────
const TODAY = new Date('2025-10-15T00:00:00')

/** Retourne le lundi (00:00) de la semaine contenant `d`. */
function mondayOf(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  const dayMondayBased = (out.getDay() + 6) % 7
  out.setDate(out.getDate() - dayMondayBased)
  return out
}

const weekStart = ref<Date>(mondayOf(TODAY))

const weekDays = computed<Date[]>(() => {
  const arr: Date[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart.value)
    d.setDate(d.getDate() + i)
    arr.push(d)
  }
  return arr
})

function defaultSelectedDayIndex(): number {
  const t = new Date(TODAY)
  t.setHours(0, 0, 0, 0)
  const start = weekStart.value
  const diff = Math.round((t.getTime() - start.getTime()) / 86_400_000)
  return diff >= 0 && diff < 7 ? diff : 0
}

const selectedDayIndex = ref<number>(defaultSelectedDayIndex())

function prevWeek(): void {
  const next = new Date(weekStart.value)
  next.setDate(next.getDate() - 7)
  weekStart.value = next
  selectedDayIndex.value = 0
  logMockAction('co5.week-prev', { weekStart: next.toISOString().slice(0, 10) })
}

function nextWeek(): void {
  const next = new Date(weekStart.value)
  next.setDate(next.getDate() + 7)
  weekStart.value = next
  selectedDayIndex.value = 0
  logMockAction('co5.week-next', { weekStart: next.toISOString().slice(0, 10) })
}

function selectDay(i: number): void {
  selectedDayIndex.value = i
}

// ─── Format helpers FR ───────────────────────────────────────────
const DAY_LETTERS = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di']
const DAY_LABELS_LONG = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

function isoDay(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function getIsoWeek(d: Date): number {
  const target = new Date(d)
  target.setHours(0, 0, 0, 0)
  target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7))
  const firstThursday = new Date(target.getFullYear(), 0, 4)
  const diffDays = Math.round((target.getTime() - firstThursday.getTime()) / 86_400_000)
  return 1 + Math.floor((diffDays + ((firstThursday.getDay() + 6) % 7)) / 7)
}

/** "Sem. 42 · 13–19 oct." */
function weekLabel(): string {
  const start = weekStart.value
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const weekNumber = getIsoWeek(start)
  const monthStart = MONTHS_SHORT[start.getMonth()] ?? ''
  const monthEnd = MONTHS_SHORT[end.getMonth()] ?? ''
  if (start.getMonth() === end.getMonth()) {
    return `Sem. ${weekNumber} · ${start.getDate()}–${end.getDate()} ${monthEnd}`
  }
  return `Sem. ${weekNumber} · ${start.getDate()} ${monthStart} – ${end.getDate()} ${monthEnd}`
}

/** "Mercredi 15 oct." */
function longDayLabel(d: Date): string {
  const label = DAY_LABELS_LONG[(d.getDay() + 6) % 7] ?? ''
  const month = MONTHS_SHORT[d.getMonth()] ?? ''
  return `${label} ${d.getDate()} ${month}`
}

// ─── MOCK only — trainings hebdo (pas de listBookings côté repo) ─
//
// Tableau local — à remplacer par `listBookings(teamId, weekStart…weekEnd)`
// quand /bookings sera branché côté repo. On ne mute jamais ce tableau
// (cohérent avec la convention mock = lecture seule).
type BookingSlotType = 'training' | 'match_home' | 'match_away' | 'freed'

interface PlanningBooking {
  id: string
  date: string
  startTime: string
  endTime: string
  slotType: BookingSlotType
  venueLabel?: string
  opponent?: string
  awayAddress?: string
  matchType?: string
  matchId?: string
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

/** Génère les bookings non-match (trainings + freed) pour la semaine. */
function buildMockBookingsInline(teamRef: MockTeam, monday: Date): PlanningBooking[] {
  const venuePrimary = 'Aigues-Vertes · Court A'
  const MOCK_BOOKINGS_INLINE: PlanningBooking[] = [
    // Mercredi 18:00-20:00 — entraînement principal (cohérent JSX).
    {
      id: `mock-${teamRef.id}-wed-train`,
      date: isoDay(addDays(monday, 2)),
      startTime: '18:00',
      endTime: '20:00',
      slotType: 'training',
      venueLabel: venuePrimary,
    },
    // Mercredi 17:00-18:00 — créneau libéré (cohérent JSX).
    {
      id: `mock-${teamRef.id}-wed-freed`,
      date: isoDay(addDays(monday, 2)),
      startTime: '17:00',
      endTime: '18:00',
      slotType: 'freed',
      venueLabel: venuePrimary,
    },
    // Vendredi 18:00-19:30 — entraînement.
    {
      id: `mock-${teamRef.id}-fri-train`,
      date: isoDay(addDays(monday, 4)),
      startTime: '18:00',
      endTime: '19:30',
      slotType: 'training',
      venueLabel: 'Aigues-Vertes · Court B',
    },
  ]
  return MOCK_BOOKINGS_INLINE
}

/** Convertit un MockMatch en booking de planning. */
function matchToBooking(m: MockMatch): PlanningBooking {
  const endHour = computeEndTime(m.startTime, m.durationHours)
  if (m.kind === 'home') {
    return {
      id: `match-${m.id}`,
      date: m.date,
      startTime: m.startTime,
      endTime: endHour,
      slotType: 'match_home',
      opponent: m.opponent,
      venueLabel: m.venueLabel,
      matchType: m.matchType,
      matchId: m.id,
    }
  }
  return {
    id: `match-${m.id}`,
    date: m.date,
    startTime: m.startTime,
    endTime: endHour,
    slotType: 'match_away',
    opponent: m.opponent,
    awayAddress: m.venueLabel,
    matchType: m.matchType,
    matchId: m.id,
  }
}

function computeEndTime(start: string, durationHours: number): string {
  const [hRaw = '0', mRaw = '0'] = start.split(':')
  const h = Number(hRaw)
  const m = Number(mRaw)
  const totalMinutes = h * 60 + m + Math.round(durationHours * 60)
  const eh = Math.floor(totalMinutes / 60) % 24
  const em = totalMinutes % 60
  return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`
}

const weekBookings = computed<PlanningBooking[]>(() => {
  if (!team.value) return []
  const inlineMock = buildMockBookingsInline(team.value, weekStart.value)
  const start = weekStart.value
  const endExclusive = addDays(start, 7)
  const startIso = isoDay(start)
  const endIso = isoDay(endExclusive)

  const matches = listMatches()
    .filter((m) => m.teamId === team.value!.id)
    .filter((m) => m.date >= startIso && m.date < endIso)
    .map(matchToBooking)

  return [...inlineMock, ...matches]
})

/** Bookings pour le jour sélectionné, triés par heure. */
const selectedDayBookings = computed<PlanningBooking[]>(() => {
  const day = weekDays.value[selectedDayIndex.value]
  if (!day) return []
  const iso = isoDay(day)
  return weekBookings.value
    .filter((b) => b.date === iso)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
})

const selectedDayLabel = computed<string>(() => {
  const day = weekDays.value[selectedDayIndex.value]
  return day ? longDayLabel(day) : ''
})

// ─── Helpers UI booking ──────────────────────────────────────────
function bookingClass(b: PlanningBooking): string {
  switch (b.slotType) {
    case 'training':
      return 'cb-booking training'
    case 'match_home':
      return 'cb-booking match-home'
    case 'match_away':
      return 'cb-booking match-away'
    case 'freed':
      return 'cb-booking freed'
  }
}

function bookingTitle(b: PlanningBooking): string {
  const teamName = team.value?.name ?? ''
  switch (b.slotType) {
    case 'training':
      return `Entraînement ${teamName}`.trim()
    case 'match_home':
      return `${teamName} vs ${b.opponent ?? '—'}`.trim()
    case 'match_away':
      return `${teamName} vs ${b.opponent ?? '—'}`.trim()
    case 'freed':
      return 'Créneau libéré'
  }
}

function bookingSubtitle(b: PlanningBooking): string {
  if (b.slotType === 'match_home') {
    const base = b.venueLabel ?? ''
    return b.matchType ? `${base} · ${b.matchType}` : base
  }
  if (b.slotType === 'match_away') {
    const base = b.awayAddress ?? ''
    return b.matchType ? `${base} · ${b.matchType}` : base
  }
  return b.venueLabel ?? ''
}

function openBooking(b: PlanningBooking): void {
  if (b.slotType === 'training' || b.slotType === 'freed') {
    router.push({ name: 'training-attendance', params: { bookingId: b.id } })
    return
  }
  if ((b.slotType === 'match_home' || b.slotType === 'match_away') && b.matchId) {
    router.push({ name: 'match-detail', params: { id: b.matchId } })
    return
  }
  logMockAction('co5.booking-noop', { bookingId: b.id, slotType: b.slotType })
}

function openAdHocBooking(): void {
  logMockAction('co5.ad-hoc-booking', { teamId: teamId.value })
}

// ─── Vue Semaine / Mois (Mois désactivé) ─────────────────────────
type PlanningView = 'week' | 'month'
const planningView = ref<PlanningView>('week')

function setView(v: PlanningView): void {
  if (v === 'month') {
    logMockAction('co5.month-view-disabled')
    return
  }
  planningView.value = v
}

// ─── Grille desktop (heures du JSX : 17:00 → 21:00) ──────────────
const DESKTOP_HOURS: ReadonlyArray<string> = ['17:00', '18:00', '19:00', '20:00', '21:00']

function timeToMinutes(t: string): number {
  const [hRaw = '0', mRaw = '0'] = t.split(':')
  return Number(hRaw) * 60 + Number(mRaw)
}

/** Index de l'heure (ligne) où un booking commence — null si hors plage. */
function hourIndexForBooking(b: PlanningBooking): number | null {
  const first = DESKTOP_HOURS[0] ?? '17:00'
  const last = DESKTOP_HOURS[DESKTOP_HOURS.length - 1] ?? '21:00'
  const bStart = timeToMinutes(b.startTime)
  if (bStart < timeToMinutes(first) || bStart > timeToMinutes(last)) return null
  // Bucket sur l'heure pleine (le design n'a pas de précision sub-heure).
  return Math.max(0, Math.floor((bStart - timeToMinutes(first)) / 60))
}

interface DesktopCellBlock {
  booking: PlanningBooking
}

/** Retourne le bloc à rendre dans la cellule (dayIndex, hourIndex), ou null. */
function blockForCell(dayIndex: number, hourIndex: number): DesktopCellBlock | null {
  const day = weekDays.value[dayIndex]
  if (!day) return null
  const iso = isoDay(day)
  const found = weekBookings.value.find((b) => {
    if (b.date !== iso) return false
    return hourIndexForBooking(b) === hourIndex
  })
  return found ? { booking: found } : null
}

function blockBg(slotType: BookingSlotType): string {
  switch (slotType) {
    case 'training':
      return 'var(--emerald-50)'
    case 'match_home':
      return 'var(--violet-50)'
    case 'match_away':
      return 'var(--sky-50)'
    case 'freed':
      return 'var(--slate-50)'
  }
}

function blockAccent(slotType: BookingSlotType): string {
  switch (slotType) {
    case 'training':
      return 'var(--emerald-500)'
    case 'match_home':
      return 'var(--violet-500)'
    case 'match_away':
      return 'var(--sky-500)'
    case 'freed':
      return 'var(--slate-400)'
  }
}

function blockShortLabel(b: PlanningBooking): string {
  if (b.slotType === 'training') return 'Training'
  if (b.slotType === 'freed') return 'Libéré'
  return `vs ${b.opponent ?? '—'}`
}

function blockShortSubtitle(b: PlanningBooking): string {
  if (b.slotType === 'match_away') return 'Extérieur'
  if (b.slotType === 'match_home') return `${b.matchType ?? ''} · ${shortCourt(b.venueLabel ?? '')}`.trim().replace(/^·\s*/, '')
  return shortCourt(b.venueLabel ?? '')
}

/** "Aigues-Vertes · Court A" → "Court A" (le JSX affiche "Court A"). */
function shortCourt(label: string): string {
  const parts = label.split('·').map((s) => s.trim())
  return parts[parts.length - 1] ?? label
}

function isToday(d: Date): boolean {
  return isSameDay(d, TODAY)
}

// ─── Shell handlers ──────────────────────────────────────────────
function onTabSelect(index: number): void {
  if (index === 0) router.push({ name: 'team' })
  else if (index === 1) return // déjà sur planning
  else if (index === 2) router.push({ name: 'registrations' })
  else if (index === 3) router.push({ name: 'notifications' })
}

function onNavSelect(index: number): void {
  if (index === 0) router.push({ name: 'home' })
  else if (index === 1) router.push({ name: 'team' })
  else if (index === 2) return
  else if (index === 3) router.push({ name: 'registrations' })
  else if (index === 4) router.push({ name: 'notifications' })
}

function onBack(): void {
  if (team.value) {
    router.push({ name: 'team-roster', params: { teamId: team.value.id } })
  } else {
    router.push({ name: 'team' })
  }
}

function onNotifClick(): void {
  router.push({ name: 'notifications' })
}

const headerTitle = computed(() => (team.value ? `Planning ${team.value.name}` : 'Planning'))
const desktopTitle = computed(() => (team.value ? `Planning · ${team.value.name}` : 'Planning'))
const desktopSubtitle = computed(() => weekLabel())
</script>

<template>
  <!-- ─── Desktop ≥ 1024px ─────────────────────────────────────── -->
  <CbDesktopShell
    v-if="isDesktop"
    :items="coachNav"
    :active="2"
    brand-name="BC Aigles"
    brand-sub="Saison 2025/26"
    club-initials="BCA"
    :user-name="auth.displayName"
    user-role="Coach"
    @nav-select="onNavSelect"
  >
    <CbPageHead :title="desktopTitle" :subtitle="desktopSubtitle">
      <template #actions>
        <div class="cb-segmented">
          <button
            type="button"
            :class="{ active: planningView === 'week' }"
            @click="setView('week')"
          >
            Semaine
          </button>
          <button
            type="button"
            :class="{ active: planningView === 'month' }"
            :disabled="true"
            @click="setView('month')"
          >
            Mois
          </button>
        </div>
        <button class="cb-btn outline" type="button" aria-label="Semaine précédente" @click="prevWeek">
          <ChevronLeft :size="16" />
        </button>
        <button class="cb-btn outline" type="button" aria-label="Semaine suivante" @click="nextWeek">
          <ChevronRight :size="16" />
        </button>
        <button class="cb-btn primary" type="button" @click="openAdHocBooking">
          <Plus :size="16" />
          Réserver
        </button>
      </template>
    </CbPageHead>

    <div style="flex: 1; overflow: auto; padding: 24px; background: var(--bg-muted)">
      <div style="background: var(--bg); border-radius: 12px; border: 1px solid var(--border); overflow: hidden">
        <div style="display: grid; grid-template-columns: 60px repeat(7, 1fr)">
          <!-- Coin vide + en-tête 7 jours -->
          <div style="background: var(--bg-muted)" />
          <div
            v-for="(d, i) in weekDays"
            :key="`head-${i}`"
            :style="`padding: 10px 12px; border-left: 1px solid var(--border); border-bottom: 1px solid var(--border); font-size: 12px; font-weight: 600; color: var(--text); background: ${isToday(d) ? 'var(--emerald-50)' : 'var(--bg)'}`"
          >
            {{ DAY_LETTERS[i] }} {{ d.getDate() }}
          </div>

          <!-- Lignes : col heure (mono) + 7 cells -->
          <template v-for="(h, hi) in DESKTOP_HOURS" :key="`row-${hi}`">
            <div
              class="mono"
              style="padding: 10px 8px; font-size: 11px; color: var(--text-faint); text-align: right; border-bottom: 1px solid var(--border)"
            >
              {{ h }}
            </div>
            <div
              v-for="(d, di) in weekDays"
              :key="`cell-${hi}-${di}`"
              :style="`position: relative; height: 64px; border-left: 1px solid var(--border); border-bottom: 1px solid var(--border); background: ${isToday(d) ? 'rgba(16,185,129,0.03)' : 'var(--bg)'}`"
            >
              <div
                v-if="blockForCell(di, hi)"
                :style="`position: absolute; inset: 4px; background: ${blockBg(blockForCell(di, hi)!.booking.slotType)}; border-left: 3px solid ${blockAccent(blockForCell(di, hi)!.booking.slotType)}; border-radius: 6px; padding: 6px 8px; font-size: 11px; font-weight: 600; cursor: pointer; overflow: hidden`"
                role="button"
                tabindex="0"
                @click="openBooking(blockForCell(di, hi)!.booking)"
                @keyup.enter="openBooking(blockForCell(di, hi)!.booking)"
              >
                <div>{{ blockShortLabel(blockForCell(di, hi)!.booking) }}</div>
                <div style="color: var(--text-subtle); font-weight: 500">
                  {{ blockShortSubtitle(blockForCell(di, hi)!.booking) }}
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </CbDesktopShell>

  <!-- ─── Mobile < 1024px ──────────────────────────────────────── -->
  <CbMobileShell
    v-else
    :title="headerTitle"
    show-back
    :notif-badge="false"
    :tabs="coachTabs"
    :active-tab="1"
    @back="onBack"
    @notif-click="onNotifClick"
    @tab-select="onTabSelect"
  >
    <!-- Toolbar : segmented + week label -->
    <div style="padding: 10px 16px 0; background: var(--bg); display: flex; align-items: center; justify-content: space-between">
      <div class="cb-segmented">
        <button
          type="button"
          :class="{ active: planningView === 'week' }"
          @click="setView('week')"
        >
          Semaine
        </button>
        <button
          type="button"
          :class="{ active: planningView === 'month' }"
          :disabled="true"
          @click="setView('month')"
        >
          Mois
        </button>
      </div>
      <div style="font-size: 12px; font-weight: 500; color: var(--text-subtle); display: flex; align-items: center; gap: 6px">
        <button
          type="button"
          aria-label="Semaine précédente"
          style="background: transparent; border: 0; padding: 0; color: inherit; cursor: pointer; display: inline-flex"
          @click="prevWeek"
        >
          <ChevronLeft :size="14" />
        </button>
        {{ weekLabel() }}
        <button
          type="button"
          aria-label="Semaine suivante"
          style="background: transparent; border: 0; padding: 0; color: inherit; cursor: pointer; display: inline-flex"
          @click="nextWeek"
        >
          <ChevronRight :size="14" />
        </button>
      </div>
    </div>

    <!-- Day strip -->
    <div class="cb-daystrip">
      <button
        v-for="(d, i) in weekDays"
        :key="i"
        type="button"
        class="cb-day"
        :class="{ active: selectedDayIndex === i, today: isToday(d) }"
        @click="selectDay(i)"
      >
        <span>{{ DAY_LETTERS[i] }}</span>
        <span class="num">{{ d.getDate() }}</span>
      </button>
    </div>

    <!-- Liste bookings du jour sélectionné -->
    <div
      style="flex: 1; overflow: auto; padding: 12px 16px 100px; display: flex; flex-direction: column; gap: 10px; background: var(--bg-muted)"
    >
      <div class="cb-section-label" style="padding: 0 0 2px">{{ selectedDayLabel }}</div>

      <div
        v-if="selectedDayBookings.length === 0"
        style="padding: 24px 0; text-align: center; font-size: 13px; color: var(--text-subtle)"
      >
        Aucun créneau ce jour.
      </div>

      <div
        v-for="b in selectedDayBookings"
        v-else
        :key="b.id"
        :class="bookingClass(b)"
        style="cursor: pointer"
        role="button"
        tabindex="0"
        @click="openBooking(b)"
        @keyup.enter="openBooking(b)"
      >
        <div class="when">
          {{ b.startTime }}<span class="end">{{ b.endTime }}</span>
        </div>
        <div class="body">
          <div class="ttl" :style="b.slotType === 'freed' ? 'color: var(--text-muted)' : ''">
            {{ bookingTitle(b) }}
          </div>
          <div class="sub">{{ bookingSubtitle(b) }}</div>
          <div
            v-if="b.slotType === 'training'"
            style="margin-top: 6px"
          >
            <CbPill tone="emerald" dot>Training</CbPill>
          </div>
          <div
            v-else-if="b.slotType === 'match_home'"
            style="margin-top: 6px; display: flex; gap: 6px"
          >
            <CbPill tone="violet">Match domicile</CbPill>
            <CbPill tone="amber" dot>Officiels 2/3</CbPill>
          </div>
          <div
            v-else-if="b.slotType === 'match_away'"
            style="margin-top: 6px; display: flex; gap: 6px"
          >
            <CbPill tone="sky">Match extérieur</CbPill>
          </div>
        </div>
      </div>
    </div>

    <CbBottomBar>
      <button class="cb-btn primary block" type="button" @click="openAdHocBooking">
        <Plus :size="16" />
        Réserver un créneau
      </button>
    </CbBottomBar>
  </CbMobileShell>
</template>

<style scoped>
/* Segmented disabled (Mois) — pas couvert par tokens.css. */
.cb-segmented button[disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
