<script setup lang="ts">
/**
 * OfficialAssignmentsCalendar — tab "Calendrier" de la vue `MyAssignments`
 * (officiel). Rendu **interne** uniquement : pas de shell, pas de header
 * — la vue parente (`MyAssignments.vue`) gère `CbMobileShell` /
 * `CbDesktopShell`, la barre d'onglets et le mount des stores (en
 * particulier `loadOfficialContext`).
 *
 * Contenu :
 *  - Toolbar : segmented "Vue" (Jour / Semaine / Mois, default Semaine),
 *    segmented "Plage horaire" (Matin / Soir / Journée, default Soir),
 *    nav prev / Aujourd'hui / next, label période sous la toolbar.
 *  - Grille `vue-cal` v4 (mêmes options qu'`Agenda.vue` coach), connectée
 *    à 2 sources du store officials :
 *      - **Mes assignations** (pending / confirmed / declined, futur uniquement)
 *      - **Opportunités ouvertes** au niveau de l'officiel
 *    Déduplication : si je suis déjà assigné sur un match, la version
 *    "mon assignation" l'emporte (pas de doublon "opportunité").
 *  - Empty state via `CbEmptyState` si pas d'events au total.
 *
 * Click sur un event → émet `@event-click` avec `{ parentId, kind }`. Le
 * parent gère la navigation (typiquement vers `match-detail`).
 *
 * Pattern de référence : `apps/courtbase-app/src/views/coach/Agenda.vue`
 * (tab Calendrier — toolbar + navigation + grille vue-cal).
 */

import { computed, ref } from 'vue'
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-vue-next'
import VueCal, { type VueCalEvent } from 'vue-cal'
import 'vue-cal/dist/vuecal.css'

import CbEmptyState from '@/components/ui/CbEmptyState.vue'
import { useAuthStore } from '@/stores/auth'
import {
  useOfficialsStore,
  type MyAssignmentEntry,
  type OpportunityEntry,
} from '@/stores/officials'

// ─── Emits ─────────────────────────────────────────────────────────

const emit = defineEmits<{
  (
    e: 'event-click',
    payload: { parentId: string; kind: 'home' | 'away' },
  ): void
}>()

// ─── Stores ────────────────────────────────────────────────────────

const auth = useAuthStore()
const officialsStore = useOfficialsStore()

// Niveau de l'officiel — fallback 1 si non renseigné (pattern aligné
// sur les autres vues officiel ; sera affiné quand le linkedMember sera
// systématiquement résolu).
const officialLevel = computed(() => auth.officialLevel ?? 1)

// ─── State : vue / plage / date ────────────────────────────────────

type CalView = 'day' | 'week' | 'month'
type TimeRange = 'morning' | 'evening' | 'fullday'

const activeView = ref<CalView>('week')
const timeRange = ref<TimeRange>('evening')
const selectedDate = ref<Date>(new Date())

const TIME_RANGES: Record<TimeRange, { from: number; to: number; label: string }> = {
  morning: { from: 6 * 60, to: 12 * 60, label: 'Matin' },
  evening: { from: 17 * 60, to: 22 * 60, label: 'Soir' },
  fullday: { from: 6 * 60, to: 24 * 60, label: 'Journée' },
}

const timeFrom = computed(() => TIME_RANGES[timeRange.value].from)
const timeTo = computed(() => TIME_RANGES[timeRange.value].to)

const TIME_STEP = 30
const TIME_CELL_HEIGHT = 28

function setView(v: CalView): void {
  activeView.value = v
}

function setTimeRange(r: TimeRange): void {
  timeRange.value = r
}

// ─── Helpers ───────────────────────────────────────────────────────

/** Coerce un Timestamp Firestore (structurel ou SDK) en epoch ms. */
function tsToMs(
  ts: { seconds?: number; toMillis?: () => number } | null | undefined,
): number {
  if (!ts) return 0
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (typeof ts.seconds === 'number') return ts.seconds * 1000
  return 0
}

/** Epoch ms du début d'une assignation (booking.startMs HOME / match.date AWAY). */
function entryStartMs(e: MyAssignmentEntry): number {
  return e.parent.kind === 'home'
    ? e.parent.booking.startMs
    : tsToMs(e.parent.match.date)
}

/**
 * Construit le Date `end` d'une assignation. Stratégie :
 *  - on prend `startMs` comme ancre (jour/mois/année garantis cohérents),
 *  - on parse `endTime` en `"HH:mm"` puis on remet ces heures/minutes sur
 *    le Date ancre,
 *  - si parsing échoue ou que `end <= start`, fallback +90 min (durée
 *    standard d'un match basket).
 */
function entryEndMs(e: MyAssignmentEntry): number {
  const startMs = entryStartMs(e)
  const endTime =
    e.parent.kind === 'home' ? e.parent.booking.endTime : e.parent.match.endTime
  return computeEndMs(startMs, endTime)
}

function opportunityStartMs(o: OpportunityEntry): number {
  return tsToMs(o.date)
}

function opportunityEndMs(o: OpportunityEntry): number {
  return computeEndMs(opportunityStartMs(o), o.endTime)
}

function computeEndMs(startMs: number, endTime: string | null | undefined): number {
  if (!startMs) return 0
  const fallback = startMs + 90 * 60 * 1000
  if (!endTime) return fallback
  const match = /^(\d{1,2}):(\d{2})$/.exec(endTime)
  if (!match) return fallback
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallback
  const d = new Date(startMs)
  d.setHours(hours, minutes, 0, 0)
  const endMs = d.getTime()
  return endMs > startMs ? endMs : fallback
}

/** True si l'event commence dans le futur (>= now). */
function isFutureEntry(e: MyAssignmentEntry): boolean {
  return entryStartMs(e) >= Date.now()
}

function isFutureOpportunity(o: OpportunityEntry): boolean {
  return opportunityStartMs(o) >= Date.now()
}

// ─── Sources : assignations + opportunités ─────────────────────────

/** Toutes mes assignations futures (pending + confirmed + declined). */
const myFutureAssignments = computed<ReadonlyArray<MyAssignmentEntry>>(() => {
  const m = officialsStore.myAssignments
  return [...m.pending, ...m.confirmed, ...m.declined].filter(isFutureEntry)
})

/** Opportunités ouvertes au niveau de l'officiel (déjà filtrées futur côté store). */
const opportunities = computed<ReadonlyArray<OpportunityEntry>>(() =>
  officialsStore.openOpportunitiesForLevel(officialLevel.value),
)

// ─── Type interne événement calendrier ─────────────────────────────

interface CalEvent extends VueCalEvent {
  start: Date
  end: Date
  title: string
  class: string
  parentId: string
  kind: 'home' | 'away'
}

const URGENT_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000

function buildAssignmentEvent(e: MyAssignmentEntry): CalEvent {
  const opponent =
    (e.parent.kind === 'home'
      ? e.parent.booking.opponentName
      : e.parent.match.opponentName) ?? 'Adversaire à confirmer'
  let cssClass: string
  let label: string
  switch (e.assignment.status) {
    case 'pending':
      cssClass = 'oa-evt-pending'
      label = `⏳ ${opponent}`
      break
    case 'confirmed':
      cssClass = 'oa-evt-confirmed'
      label = `✓ ${opponent}`
      break
    case 'declined':
      cssClass = 'oa-evt-declined'
      label = `× ${opponent}`
      break
  }
  const startMs = entryStartMs(e)
  const endMs = entryEndMs(e)
  return {
    start: new Date(startMs),
    end: new Date(endMs),
    title: label,
    class: cssClass,
    parentId: e.parent.kind === 'home' ? e.parent.booking.id : e.parent.match.id,
    kind: e.parent.kind,
  }
}

function buildOpportunityEvent(o: OpportunityEntry, now: number): CalEvent {
  const opponent = o.opponentName ?? 'Adversaire à confirmer'
  const startMs = opportunityStartMs(o)
  const endMs = opportunityEndMs(o)
  const isUrgent = startMs - now <= URGENT_THRESHOLD_MS
  const classes = isUrgent ? 'oa-evt-needed oa-evt-urgent' : 'oa-evt-needed'
  const label = isUrgent ? `⚠️ ${opponent}` : opponent
  return {
    start: new Date(startMs),
    end: new Date(endMs),
    title: label,
    class: classes,
    parentId: o.parentId,
    kind: o.kind,
  }
}

/**
 * Événements affichés : déduplique opportunités vs assignations par couple
 * `${kind}:${parentId}`. Si je suis déjà assigné sur un match (n'importe
 * quel status), on garde la version "mon assignation" — sinon le coach
 * verrait deux events superposés (une assignation pending + une
 * opportunité ouverte si je ne suis pas sur tous les slots).
 */
const displayedEvents = computed<CalEvent[]>(() => {
  const now = Date.now()
  const out: CalEvent[] = []
  const seen = new Set<string>()

  for (const e of myFutureAssignments.value) {
    const pid =
      e.parent.kind === 'home' ? e.parent.booking.id : e.parent.match.id
    const key = `${e.parent.kind}:${pid}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(buildAssignmentEvent(e))
  }

  for (const o of opportunities.value) {
    if (!isFutureOpportunity(o)) continue
    const key = `${o.kind}:${o.parentId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(buildOpportunityEvent(o, now))
  }

  return out
})

// ─── Click handlers ────────────────────────────────────────────────

function onEventClick(payload: unknown): void {
  const evt = payload as { parentId?: string; kind?: 'home' | 'away' } | null
  if (!evt?.parentId || (evt.kind !== 'home' && evt.kind !== 'away')) return
  emit('event-click', { parentId: evt.parentId, kind: evt.kind })
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
  month: 'short',
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

// ─── Empty state ───────────────────────────────────────────────────

const hasEvents = computed(() => displayedEvents.value.length > 0)
</script>

<template>
  <div class="oa-cal">
    <!-- ─── Toolbar ─────────────────────────────────────────────── -->
    <div class="oa-toolbar">
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

      <div class="cb-segmented">
        <button
          type="button"
          :class="{ active: timeRange === 'morning' }"
          @click="setTimeRange('morning')"
        >
          Matin
        </button>
        <button
          type="button"
          :class="{ active: timeRange === 'evening' }"
          @click="setTimeRange('evening')"
        >
          Soir
        </button>
        <button
          type="button"
          :class="{ active: timeRange === 'fullday' }"
          @click="setTimeRange('fullday')"
        >
          Journée
        </button>
      </div>

      <div class="oa-nav">
        <button
          type="button"
          class="cb-iconbtn sm"
          aria-label="Précédent"
          @click="goPrevious"
        >
          <ChevronLeft :size="16" />
        </button>
        <button type="button" class="oa-today-btn" @click="goToday">
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

    <div class="oa-period-label">{{ periodLabel }}</div>

    <!-- ─── Grille calendrier ──────────────────────────────────── -->
    <div class="cb-card oa-card">
      <CbEmptyState
        v-if="!hasEvents"
        :icon="Calendar"
        title="Aucun match à votre niveau"
        body="Inscrivez-vous sur un match à pourvoir pour commencer."
      />
      <VueCal
        v-else
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
  </div>
</template>

<style scoped>
.oa-cal {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px 20px;
}

.oa-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.oa-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.oa-today-btn {
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
.oa-today-btn:hover {
  background: var(--slate-50);
}

.oa-period-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-subtle);
  text-transform: capitalize;
  padding: 2px 2px 4px;
}

.oa-card {
  padding: 0;
  overflow: hidden;
  height: calc(100vh - 320px);
  min-height: 400px;
  display: flex;
  flex-direction: column;
}

/* ─── Segmented "sm" — variante compacte ─────────────────────── */
.cb-segmented.sm button {
  font-size: 11px;
  padding: 3px 8px;
}

.cb-iconbtn.sm {
  width: 28px;
  height: 28px;
}

/* ─── vue-cal base + events officiel ─────────────────────────── */
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

:deep(.vuecal__event-title) {
  white-space: pre-line;
  font-weight: 600;
}

/* Pending — amber */
:deep(.vuecal__event.oa-evt-pending) {
  background: var(--amber-50);
  border-left: 3px solid var(--amber-500);
  color: var(--amber-700);
}

/* Confirmed — emerald */
:deep(.vuecal__event.oa-evt-confirmed) {
  background: var(--emerald-50);
  border-left: 3px solid var(--emerald-500);
  color: var(--emerald-700);
}

/* Declined — slate barré */
:deep(.vuecal__event.oa-evt-declined) {
  background: var(--slate-100);
  border-left: 3px solid var(--slate-400);
  color: var(--slate-700);
  text-decoration: line-through;
  opacity: 0.7;
}

/* À pourvoir — sky (couleur "découverte / opportunité") */
:deep(.vuecal__event.oa-evt-needed) {
  background: var(--sky-50);
  border-left: 3px solid var(--sky-500);
  color: var(--sky-700);
}

/* Urgence (< 3 jours) — rose prominent, écrase la base "needed". */
:deep(.vuecal__event.oa-evt-needed.oa-evt-urgent) {
  background: var(--rose-100, var(--rose-50));
  border: 3px solid var(--rose-600, var(--rose-500));
  border-left: 3px solid var(--rose-600, var(--rose-500));
  color: var(--rose-700);
  font-weight: 700;
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
</style>
