<script setup lang="ts">
/**
 * CO5 — Planning d'équipe (coach), version `vue-cal` v4.
 *
 * Réécriture complète : remplace l'ancienne grille mock manuelle par une vraie
 * vue calendrier `vue-cal` (MIT). 3 modes — Jour / Semaine / Mois — branchés
 * sur `useBookingsStore.bookingsForTeam(teamId)` (source unique saison entière,
 * 0 re-fetch à la navigation).
 *
 * Spec produit :
 *  - Vue Jour : plage 00:00→24:00, 30 min de pas (l'utilisateur veut voir
 *    toute la journée comme `apps/web`).
 *  - Vue Semaine : 7 colonnes, mêmes heures.
 *  - Vue Mois : cellule cliquable → drill-down sur Jour.
 *  - Clic sur un entraînement `scheduled` → dialog confirm → `cancelTraining`.
 *  - Couleurs via `.cb-bk-*` (mapping `visualKindOf`).
 *  - Toast emerald sur succès, rose sur erreur (pattern `MemberDetail.vue`).
 *
 * Architecture en couches : composant → composables/store. Aucune import
 * `firebase/*` ici — tout passe par `useBookingsStore`.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Info,
  X,
} from 'lucide-vue-next'
import VueCal, { type VueCalEvent } from 'vue-cal'
import 'vue-cal/dist/vuecal.css'

import CbDesktopShell from '@/components/ui/CbDesktopShell.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbPageHead from '@/components/ui/CbPageHead.vue'
import { useShellNav } from '@/composables/useShellNav'
import { useViewport } from '@/composables/useViewport'
import { useAuthStore } from '@/stores/auth'
import { useBookingsStore } from '@/stores/bookings'
import { useTeamsStore } from '@/stores/teams'
import type { BookingRow } from '@/repositories/bookings.repo'
import { BOOKING_CLASS, BOOKING_LABELS, visualKindOf } from '@/utils/bookingColors'

// ─── Routing / stores ────────────────────────────────────────────────

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const bookingsStore = useBookingsStore()
const teamsStore = useTeamsStore()
const { isDesktop } = useViewport()
const { tabs, nav, primaryRoleLabel } = useShellNav()

const teamId = computed<string>(() => {
  const raw = route.params['teamId']
  return Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
})

const team = computed(() => {
  const fromTeamsStore = teamsStore.teams.find((t) => t.id === teamId.value)
  if (fromTeamsStore) return fromTeamsStore
  // Fallback : `useBookingsStore.teams` (TeamLite) recopie la liste en mode
  // firestore — utile si la vue est ouverte sans passer par MyTeams.
  return bookingsStore.teams.find((t) => t.id === teamId.value) ?? null
})

const headerTitle = computed(() =>
  team.value ? `${team.value.name} · Planning` : 'Planning',
)

const desktopTitle = computed(() =>
  team.value ? `Planning · ${team.value.name}` : 'Planning',
)

// ─── Vue-cal config ──────────────────────────────────────────────────

type CalView = 'day' | 'week' | 'month'
const activeView = ref<CalView>('week')
const selectedDate = ref<Date>(new Date())

/** Plage horaire complète — l'utilisateur veut voir toute la journée. */
const TIME_FROM = 0
const TIME_TO = 24 * 60
const TIME_STEP = 30
const TIME_CELL_HEIGHT = 28

// ─── Events — map `BookingRow` → `VueCalEvent` ───────────────────────

interface PlanningEvent extends VueCalEvent {
  bookingId: string
  start: Date
  end: Date
  title: string
  class: string
}

/**
 * Titre court pour la pastille événement. Le label "Match vs X" est privilégié
 * pour les matches ; "Entraînement" / "Libéré" / "Annulé" pour les autres.
 */
function bookingShortLabel(b: BookingRow): string {
  const kind = visualKindOf(b)
  if (kind === 'match-home') {
    const opp = b.opponentName?.trim()
    return opp ? `${b.teamName ?? 'Match'} vs ${opp}` : (b.teamName ?? 'Match domicile')
  }
  if (kind === 'match-away') {
    const opp = b.opponentName?.trim()
    return opp ? `À ${opp}` : "Match extérieur"
  }
  return BOOKING_LABELS[kind]
}

const events = computed<PlanningEvent[]>(() =>
  bookingsStore.bookingsForTeam(teamId.value).map((b) => ({
    bookingId: b.id,
    start: new Date(b.startMs),
    end: new Date(b.endMs),
    title: bookingShortLabel(b),
    class: BOOKING_CLASS[visualKindOf(b)],
  })),
)

// ─── Click handler — drill-down mois → jour OU dialog annulation ────

/**
 * vue-cal émet l'event modifié (avec `_eid` interne). On retrouve le booking
 * via la prop `bookingId` qu'on a portée nous-mêmes.
 */
function onEventClick(payload: unknown): void {
  const evt = payload as { bookingId?: string } | null
  if (!evt?.bookingId) return
  const booking = bookingsStore.allBookings.find((b) => b.id === evt.bookingId)
  if (!booking) return
  // Seuls les entraînements `scheduled` proposent l'annulation. Pour les autres
  // (matchs, freed, cancelled) → no-op (on pourrait afficher un détail plus
  // tard si le produit le demande, mais hors scope ici).
  if (booking.slotType === 'training' && booking.status === 'scheduled') {
    openCancelDialog(booking)
  }
}

/**
 * Drill-down depuis la vue Mois : un clic sur une cellule jour bascule en vue
 * Jour positionnée sur la date cliquée. vue-cal expose ces infos via l'event
 * `cell-click` (date payload). Sur les autres vues, no-op.
 */
function onCellClick(payload: unknown): void {
  if (activeView.value !== 'month') return
  const date = payload instanceof Date ? payload : null
  if (!date) return
  selectedDate.value = date
  activeView.value = 'day'
}

// ─── Navigation / label de période ──────────────────────────────────

/** Lundi 00:00 local de la semaine contenant `from`. */
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

// ─── Dialog d'annulation ─────────────────────────────────────────────

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
  if (b.venueName && b.courtName) return `${b.venueName} · ${b.courtName}`
  return b.courtName ?? b.venueName ?? '—'
})

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

// ─── Toast (pattern MemberDetail.vue, auto-hide 3s) ──────────────────

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

// ─── Hydratation ─────────────────────────────────────────────────────

onMounted(() => {
  void bookingsStore.loadActiveContext()
})

// Si le store charge le contexte alors que la vue est déjà montée, le label
// titre se met à jour automatiquement (computed `team`).
watch(
  () => bookingsStore.loading,
  () => {
    /* no-op — réactif via computed */
  },
)

// ─── Shell handlers ──────────────────────────────────────────────────

function onBack(): void {
  if (team.value) {
    void router.push({ name: 'team-roster', params: { teamId: team.value.id } })
    return
  }
  void router.push({ name: 'team' })
}

function onTabSelect(index: number): void {
  if (index === 0) void router.push({ name: 'team' })
  else if (index === 1) {
    /* déjà sur planning */
  } else if (index === 2) void router.push({ name: 'registrations' })
}

function onNavSelect(index: number): void {
  if (index === 0) void router.push({ name: 'home' })
  else if (index === 1) void router.push({ name: 'team' })
  else if (index === 2) {
    /* déjà sur planning */
  } else if (index === 3) void router.push({ name: 'registrations' })
}

// auth est utilisé pour le label desktop user (CbDesktopShell)
const userDisplayName = computed(() => auth.displayName)
</script>

<template>
  <!-- ─── Desktop ≥ 1024px ────────────────────────────────────── -->
  <CbDesktopShell
    v-if="isDesktop"
    :items="nav"
    brand-name="BC Aigles"
    brand-sub="Saison 2025/26"
    club-initials="BCA"
    :user-name="userDisplayName"
    :user-role="primaryRoleLabel"
    @nav-select="onNavSelect"
  >
    <CbPageHead :title="desktopTitle" :subtitle="periodLabel">
      <template #actions>
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
        <button
          type="button"
          class="cb-btn outline"
          aria-label="Précédent"
          @click="goPrevious"
        >
          <ChevronLeft :size="16" />
        </button>
        <button type="button" class="cb-btn outline" @click="goToday">
          Aujourd'hui
        </button>
        <button
          type="button"
          class="cb-btn outline"
          aria-label="Suivant"
          @click="goNext"
        >
          <ChevronRight :size="16" />
        </button>
      </template>
    </CbPageHead>

    <div class="planning-desktop-body">
      <div class="planning-card">
        <VueCal
          v-model:active-view="activeView"
          v-model:selected-date="selectedDate"
          :events="events"
          :time-from="TIME_FROM"
          :time-to="TIME_TO"
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

      <div v-if="bookingsStore.lastError" class="planning-error">
        <AlertTriangle :size="14" />
        {{ bookingsStore.lastError }}
      </div>
    </div>
  </CbDesktopShell>

  <!-- ─── Mobile < 1024px ─────────────────────────────────────── -->
  <CbMobileShell
    v-else
    :title="headerTitle"
    show-back
    :tabs="tabs"
    @back="onBack"
    @tab-select="onTabSelect"
  >
    <!-- Toolbar : segmented + nav + label période -->
    <div class="planning-toolbar">
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

      <div class="planning-nav">
        <button
          type="button"
          class="cb-iconbtn sm"
          aria-label="Précédent"
          @click="goPrevious"
        >
          <ChevronLeft :size="16" />
        </button>
        <button type="button" class="planning-today-btn" @click="goToday">
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

    <div class="planning-period-label">{{ periodLabel }}</div>

    <div class="planning-mobile-body">
      <VueCal
        v-model:active-view="activeView"
        v-model:selected-date="selectedDate"
        :events="events"
        :time-from="TIME_FROM"
        :time-to="TIME_TO"
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

    <div v-if="bookingsStore.lastError" class="planning-error">
      <AlertTriangle :size="14" />
      {{ bookingsStore.lastError }}
    </div>
  </CbMobileShell>

  <!-- ─── Dialog : annulation entraînement ────────────────────── -->
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
          </p>

          <div class="planning-info-banner">
            <Info :size="16" />
            <span>
              Le créneau sera libéré et visible des autres coachs comme
              disponible.
            </span>
          </div>

          <label class="planning-dialog-label" for="planning-cancel-note">
            Note (optionnel, 200 caractères max)
          </label>
          <textarea
            id="planning-cancel-note"
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

  <!-- ─── Toast ──────────────────────────────────────────────────── -->
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
/* ─── Layout shells ────────────────────────────────────────────── */
.planning-desktop-body {
  flex: 1;
  overflow: auto;
  padding: 20px 28px;
  background: var(--bg-muted);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.planning-card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  height: calc(100vh - 180px);
  min-height: 480px;
}

.planning-mobile-body {
  flex: 1;
  background: var(--bg);
  border-top: 1px solid var(--border);
  /* Hauteur du body mobile : viewport - header 56 - tabbar 64 - toolbar/label ~ 88. */
  height: calc(100vh - 56px - 64px - 96px);
  min-height: 320px;
}

.planning-toolbar {
  padding: 10px 16px 0;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.planning-period-label {
  padding: 8px 16px 6px;
  background: var(--bg);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-subtle);
}

.planning-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.planning-today-btn {
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
.planning-today-btn:hover {
  background: var(--slate-50);
}

.cb-iconbtn.sm {
  width: 28px;
  height: 28px;
}

.planning-error {
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

/* ─── vue-cal overrides ─────────────────────────────────────────
   Les classes `.cb-bk-*` vivent dans tokens.css. vue-cal les pose sur
   `.vuecal__event` — on ne ré-écrit que les ajustements de typo / sizing
   ici. La palette reste centralisée dans tokens.css.
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
}

/* Force-renforce les classes `.cb-bk-*` posées via vue-cal (le sélecteur
   composite garantit la spécificité sans `!important`). */
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

/* Headers (jour / semaine / mois) plus discrets. */
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
