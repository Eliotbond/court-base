<script setup lang="ts">
/**
 * O2 — Mes assignations (officiel).
 *
 * Wiring Firestore réel via `useOfficialsStore` + `useBookingsStore` (cf.
 * `apps/courtbase-app/CLAUDE.md` § hybride mock+réel). La structure visuelle
 * (sections collapsibles, segmented "À venir / Passées", cards) reste la
 * transcription littérale du JSX `O2Mobile` / `O2Desktop` — seuls les
 * bindings data ont été branchés.
 *
 * Source unique : `officialsStore.myAssignments.{pending,confirmed,declined}`.
 * Le filtre temporel "À venir / Passées" s'applique côté JS sur la date du
 * parent (booking HOME ou match AWAY).
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertTriangle,
  Calendar,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  MoreVertical,
  XCircle,
} from 'lucide-vue-next'

import CbDesktopShell from '@/components/ui/CbDesktopShell.vue'
import CbEmptyState from '@/components/ui/CbEmptyState.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbPageHead from '@/components/ui/CbPageHead.vue'
import CbPill from '@/components/ui/CbPill.vue'
import CbSkel from '@/components/ui/CbSkel.vue'
import CbAssignmentActionDialog, {
  type CbAssignmentMatchSummary,
} from '@/components/dialogs/CbAssignmentActionDialog.vue'
import { useActiveSeason } from '@/composables/useSeason'
import { useShellNav } from '@/composables/useShellNav'
import { useViewport } from '@/composables/useViewport'
import { useAuthStore } from '@/stores/auth'
import { useBookingsStore } from '@/stores/bookings'
import { useOfficialsStore, type MyAssignmentEntry } from '@/stores/officials'
import type { Timestamp } from '@club-app/shared-types'

const router = useRouter()
const auth = useAuthStore()
const bookingsStore = useBookingsStore()
const officialsStore = useOfficialsStore()
const seasonStore = useActiveSeason()
const { isDesktop } = useViewport()
const { tabs, nav, primaryRoleLabel } = useShellNav()

// ───────────────────────────────────────────────────────────────
// Mount : hydrate bookings + officials context
// ───────────────────────────────────────────────────────────────

const localLoading = ref(true)

onMounted(async () => {
  try {
    await bookingsStore.loadActiveContext()
    // `useActiveSeason().load()` est cached + déduplique via `inFlight`.
    // Fallback `mock-season` quand pas de saison Firestore (mode mock pur).
    const resolvedSeasonId = (await seasonStore.load()) ?? 'mock-season'
    await officialsStore.loadOfficialContext(resolvedSeasonId)
  } catch (err) {
    // Erreurs déjà loggées + stockées côté stores ; ne pas propager.
    console.error('[MyAssignments] mount failed', err)
  } finally {
    localLoading.value = false
  }
})

const isLoading = computed(
  () => localLoading.value || officialsStore.loading || bookingsStore.loading,
)

// ───────────────────────────────────────────────────────────────
// Helpers data
// ───────────────────────────────────────────────────────────────

/** Coerce Timestamp Firestore (structurel ou SDK) en epoch ms. */
function tsToMs(ts: Timestamp | null | undefined): number {
  if (!ts) return 0
  const t = ts as { seconds?: number; toMillis?: () => number }
  if (typeof t.toMillis === 'function') return t.toMillis()
  if (typeof t.seconds === 'number') return t.seconds * 1000
  return 0
}

/** Epoch ms d'une entry — booking.startMs pour HOME, Timestamp.date pour AWAY. */
function entryStartMs(entry: MyAssignmentEntry): number {
  return entry.parent.kind === 'home'
    ? entry.parent.booking.startMs
    : tsToMs(entry.parent.match.date)
}

const DATE_FMT = new Intl.DateTimeFormat('fr-CH', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

function dateLabel(entry: MyAssignmentEntry): string {
  const ms = entryStartMs(entry)
  if (!ms) return ''
  const raw = DATE_FMT.format(new Date(ms))
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

function timeLabel(entry: MyAssignmentEntry): string {
  return entry.parent.kind === 'home'
    ? entry.parent.booking.startTime
    : entry.parent.match.startTime
}

function opponentLabel(entry: MyAssignmentEntry): string {
  const raw =
    entry.parent.kind === 'home'
      ? entry.parent.booking.opponentName
      : entry.parent.match.opponentName
  return raw ?? 'Adversaire à confirmer'
}

function venueLabel(entry: MyAssignmentEntry): string {
  if (entry.parent.kind === 'home') {
    const b = entry.parent.booking
    if (b.venueName && b.courtName) return `${b.venueName} · ${b.courtName}`
    return 'Salle non attribuée'
  }
  return entry.parent.match.awayAddress ?? 'Adresse à confirmer'
}

function matchTypeLabel(entry: MyAssignmentEntry): string {
  return entry.matchType?.name ?? '—'
}

function kindBadgeLabel(entry: MyAssignmentEntry): string {
  return entry.parent.kind === 'home' ? 'Domicile' : 'Extérieur'
}

function isPast(entry: MyAssignmentEntry): boolean {
  return entryStartMs(entry) < Date.now()
}

// ───────────────────────────────────────────────────────────────
// Buckets : sections × filtre À venir / Passées
// ───────────────────────────────────────────────────────────────

type TabKey = 'upcoming' | 'past'
const activeTab = ref<TabKey>('upcoming')

const pendingAll = computed<ReadonlyArray<MyAssignmentEntry>>(
  () => officialsStore.myAssignments.pending,
)
const confirmedAll = computed<ReadonlyArray<MyAssignmentEntry>>(
  () => officialsStore.myAssignments.confirmed,
)
const declinedAll = computed<ReadonlyArray<MyAssignmentEntry>>(
  () => officialsStore.myAssignments.declined,
)

function filterByTab(
  list: ReadonlyArray<MyAssignmentEntry>,
): ReadonlyArray<MyAssignmentEntry> {
  if (activeTab.value === 'upcoming') return list.filter((e) => !isPast(e))
  return list.filter((e) => isPast(e))
}

const pendingList = computed(() => filterByTab(pendingAll.value))
const confirmedList = computed(() => filterByTab(confirmedAll.value))
const declinedList = computed(() => filterByTab(declinedAll.value))

const upcomingCount = computed(
  () =>
    pendingAll.value.filter((e) => !isPast(e)).length +
    confirmedAll.value.filter((e) => !isPast(e)).length +
    declinedAll.value.filter((e) => !isPast(e)).length,
)
const pastCount = computed(
  () =>
    pendingAll.value.filter(isPast).length +
    confirmedAll.value.filter(isPast).length +
    declinedAll.value.filter(isPast).length,
)

const isEmpty = computed(
  () =>
    !isLoading.value &&
    pendingList.value.length === 0 &&
    confirmedList.value.length === 0 &&
    declinedList.value.length === 0,
)

// "Passées" : on n'affiche pas les 3 sections séparées mais une liste à plat
// (cohérent avec l'ancien JSX). On agrège ici toutes les entries passées.
const pastEntries = computed<ReadonlyArray<MyAssignmentEntry>>(() => {
  const out: MyAssignmentEntry[] = [
    ...pendingAll.value.filter(isPast),
    ...confirmedAll.value.filter(isPast),
    ...declinedAll.value.filter(isPast),
  ]
  out.sort((a, b) => entryStartMs(a) - entryStartMs(b))
  return out
})

// ───────────────────────────────────────────────────────────────
// Sections collapsibles (state local — fidélité 1:1 au JSX `O2Section`)
// ───────────────────────────────────────────────────────────────

const openPending = ref(true)
const openConfirmed = ref(true)
const openDeclined = ref(false)

// ───────────────────────────────────────────────────────────────
// Toast UX (même pattern que `LicenseRequestReview.vue`)
// ───────────────────────────────────────────────────────────────

interface ToastState {
  tone: 'emerald' | 'rose' | 'sky'
  message: string
  visible: boolean
}
const toast = ref<ToastState>({ tone: 'sky', message: '', visible: false })

function showToast(tone: ToastState['tone'], message: string): void {
  toast.value = { tone, message, visible: true }
  window.setTimeout(() => {
    toast.value = { ...toast.value, visible: false }
  }, 3500)
}

// ───────────────────────────────────────────────────────────────
// Action : confirmer
// ───────────────────────────────────────────────────────────────

const submittingId = ref<string | null>(null)

async function onConfirm(entry: MyAssignmentEntry): Promise<void> {
  if (submittingId.value) return
  submittingId.value = entry.assignment.id
  try {
    await officialsStore.respond({
      kind: entry.parent.kind,
      parentId:
        entry.parent.kind === 'home'
          ? entry.parent.booking.id
          : entry.parent.match.id,
      assignmentId: entry.assignment.id,
      status: 'confirmed',
    })
    showToast('emerald', 'Assignation confirmée')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[MyAssignments.confirm] failed', err)
    showToast('rose', `Échec : ${message}`)
  } finally {
    submittingId.value = null
  }
}

// ───────────────────────────────────────────────────────────────
// Action : décliner (via CbAssignmentActionDialog mode='decline')
// ───────────────────────────────────────────────────────────────

const declineDialogOpen = ref(false)
const declineTarget = ref<MyAssignmentEntry | null>(null)

const declineSummary = computed<CbAssignmentMatchSummary>(() => {
  const entry = declineTarget.value
  if (!entry) {
    return {
      dateLabel: '',
      time: '',
      opponent: '',
      venueLabel: '',
      type: '',
    }
  }
  return {
    dateLabel: dateLabel(entry),
    time: timeLabel(entry),
    opponent: opponentLabel(entry),
    venueLabel: venueLabel(entry),
    type: matchTypeLabel(entry),
  }
})

function openDecline(entry: MyAssignmentEntry): void {
  declineTarget.value = entry
  declineDialogOpen.value = true
}

async function submitDecline(): Promise<void> {
  const entry = declineTarget.value
  if (!entry || submittingId.value) return
  // NB : le textarea du dialog reste UX-only — la callable/rule n'accepte que
  // `[status, respondedAt]` (cf. brief). Le motif n'est PAS persisté côté store.
  submittingId.value = entry.assignment.id
  try {
    await officialsStore.respond({
      kind: entry.parent.kind,
      parentId:
        entry.parent.kind === 'home'
          ? entry.parent.booking.id
          : entry.parent.match.id,
      assignmentId: entry.assignment.id,
      status: 'declined',
    })
    declineDialogOpen.value = false
    declineTarget.value = null
    showToast('rose', 'Assignation refusée, admin notifié')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[MyAssignments.decline] failed', err)
    showToast('rose', `Échec : ${message}`)
  } finally {
    submittingId.value = null
  }
}

function cancelDecline(): void {
  declineDialogOpen.value = false
  declineTarget.value = null
}

// ───────────────────────────────────────────────────────────────
// Autres actions
// ───────────────────────────────────────────────────────────────

function onAddToCalendar(entry: MyAssignmentEntry): void {
  // TODO Phase 5 — exporter en .ics ou ajouter au calendrier natif via deep
  // link. Pas de spec backend MVP, on log uniquement pour l'instant.
  console.info('[MyAssignments] add to calendar (TBD)', entry.assignment.id)
}

function onReapply(entry: MyAssignmentEntry): void {
  // Re-postuler : l'inscription se fait sur la vue détail (match-detail).
  goToMatch(entry)
}

function onMore(entry: MyAssignmentEntry): void {
  // TODO — menu kebab pas spécifié MVP. Stub pour rester fidèle au JSX.
  console.info('[MyAssignments] kebab (TBD)', entry.assignment.id)
}

// ───────────────────────────────────────────────────────────────
// Navigation
// ───────────────────────────────────────────────────────────────

function goToMatch(entry: MyAssignmentEntry): void {
  const id =
    entry.parent.kind === 'home'
      ? entry.parent.booking.id
      : entry.parent.match.id
  router.push({ name: 'match-detail', params: { id } })
}

function goNotifications(): void {
  router.push({ name: 'notifications' })
}

function onTabSelect(i: number): void {
  if (i === 0) router.push({ name: 'matches-open' })
  else if (i === 2) router.push({ name: 'notifications' })
}

function onNavSelect(i: number): void {
  if (i === 0) router.push({ name: 'home' })
  else if (i === 1) router.push({ name: 'matches-open' })
  else if (i === 3) router.push({ name: 'notifications' })
}

// Sert pour de futures gates (officialLevel sous-titre desktop).
const officialLevelLabel = computed<string>(() => {
  const lvl = auth.officialLevel
  return lvl ? `Niveau ${lvl}` : 'Officiel'
})
</script>

<template>
  <!-- ─── O2Mobile (JSX lignes 71-125) ──────────────────────────── -->
  <CbMobileShell
    v-if="!isDesktop"
    title="Mes assignations"
    notif-badge
    :tabs="tabs"
    @notif-click="goNotifications"
    @tab-select="onTabSelect"
  >
    <!-- Segmented "À venir · N / Passées · N" -->
    <div style="display: flex; padding: 0 16px; background: var(--bg); gap: 16px; border-bottom: 1px solid var(--border)">
      <button
        type="button"
        :style="{
          border: 0,
          background: 'transparent',
          padding: '12px 0',
          fontFamily: 'inherit',
          fontSize: '13px',
          fontWeight: activeTab === 'upcoming' ? 600 : 500,
          color: activeTab === 'upcoming' ? 'var(--text)' : 'var(--text-subtle)',
          borderBottom: activeTab === 'upcoming' ? '2px solid var(--emerald-600)' : '2px solid transparent',
          marginBottom: '-1px',
          cursor: 'pointer',
        }"
        @click="activeTab = 'upcoming'"
      >
        À venir · {{ upcomingCount }}
      </button>
      <button
        type="button"
        :style="{
          border: 0,
          background: 'transparent',
          padding: '12px 0',
          fontFamily: 'inherit',
          fontSize: '13px',
          fontWeight: activeTab === 'past' ? 600 : 500,
          color: activeTab === 'past' ? 'var(--text)' : 'var(--text-subtle)',
          borderBottom: activeTab === 'past' ? '2px solid var(--emerald-600)' : '2px solid transparent',
          marginBottom: '-1px',
          cursor: 'pointer',
        }"
        @click="activeTab = 'past'"
      >
        Passées · {{ pastCount }}
      </button>
    </div>

    <!-- Loading : skeletons -->
    <div
      v-if="isLoading"
      style="flex: 1; overflow: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 12px"
    >
      <div v-for="i in 3" :key="i" class="cb-card" style="padding: 12px">
        <CbSkel w="40%" :h="14" />
        <div style="height: 8px" />
        <CbSkel w="65%" :h="14" />
        <div style="height: 8px" />
        <CbSkel w="80%" :h="12" />
      </div>
    </div>

    <!-- Empty state (toutes sections vides + pas de loading) -->
    <CbEmptyState
      v-else-if="isEmpty"
      :icon="Calendar"
      title="Aucune assignation"
      body="Inscrivez-vous sur un match à pourvoir pour commencer."
    />

    <!-- Onglet "À venir" : 3 sections collapsibles -->
    <div
      v-else-if="activeTab === 'upcoming'"
      style="flex: 1; overflow: auto; padding: 6px 0 16px"
    >
      <!-- O2Section "Pending" tone="amber" -->
      <div style="display: flex; flex-direction: column">
        <button
          type="button"
          :style="{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            border: 0,
            background: 'transparent',
            padding: '10px 16px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            textAlign: 'left',
            width: '100%',
          }"
          @click="openPending = !openPending"
        >
          <div style="display: flex; align-items: center; gap: 10px">
            <CbPill tone="amber" dot>Pending</CbPill>
            <span class="mono" style="font-size: 12px; font-weight: 600; color: var(--text-subtle)">{{ pendingList.length }}</span>
          </div>
          <component
            :is="openPending ? ChevronUp : ChevronDown"
            :size="16"
            color="var(--slate-400)"
          />
        </button>
        <div
          v-if="openPending"
          style="padding: 0 16px 6px; display: flex; flex-direction: column; gap: 10px"
        >
          <div
            v-for="entry in pendingList"
            :key="entry.assignment.id"
            class="cb-card"
            style="padding: 12px; cursor: pointer"
            @click="goToMatch(entry)"
          >
            <div style="display: flex; justify-content: space-between; gap: 10px; align-items: flex-start">
              <div style="flex: 1">
                <div class="mono" style="font-weight: 700; font-size: 13px">{{ dateLabel(entry) }} · {{ timeLabel(entry) }}</div>
                <div style="font-weight: 600; margin-top: 2px">{{ opponentLabel(entry) }}</div>
                <div v-if="entry.team?.name" class="cb-sub" style="margin-top: 2px">{{ entry.team.name }}</div>
                <div class="cb-sub" style="margin-top: 2px">{{ venueLabel(entry) }}</div>
              </div>
              <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end">
                <CbPill tone="violet">{{ matchTypeLabel(entry) }}</CbPill>
                <CbPill :tone="entry.parent.kind === 'home' ? 'emerald' : 'sky'">{{ kindBadgeLabel(entry) }}</CbPill>
              </div>
            </div>
            <div style="display: flex; gap: 6px; margin-top: 10px" @click.stop>
              <button
                type="button"
                class="cb-btn outline sm"
                style="flex: 1"
                :disabled="submittingId === entry.assignment.id"
                @click="openDecline(entry)"
              >
                <XCircle :size="14" /> Décliner
              </button>
              <button
                type="button"
                class="cb-btn primary sm"
                style="flex: 2"
                :disabled="submittingId === entry.assignment.id"
                @click="onConfirm(entry)"
              >
                <CheckCircle2 :size="14" /> Confirmer
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="cb-div" />

      <!-- O2Section "Confirmées" tone="emerald" -->
      <div style="display: flex; flex-direction: column">
        <button
          type="button"
          :style="{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            border: 0,
            background: 'transparent',
            padding: '10px 16px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            textAlign: 'left',
            width: '100%',
          }"
          @click="openConfirmed = !openConfirmed"
        >
          <div style="display: flex; align-items: center; gap: 10px">
            <CbPill tone="emerald" dot>Confirmées</CbPill>
            <span class="mono" style="font-size: 12px; font-weight: 600; color: var(--text-subtle)">{{ confirmedList.length }}</span>
          </div>
          <component
            :is="openConfirmed ? ChevronUp : ChevronDown"
            :size="16"
            color="var(--slate-400)"
          />
        </button>
        <div
          v-if="openConfirmed"
          style="padding: 0 16px 6px; display: flex; flex-direction: column; gap: 10px"
        >
          <div
            v-for="entry in confirmedList"
            :key="entry.assignment.id"
            class="cb-card"
            style="padding: 12px; cursor: pointer"
            @click="goToMatch(entry)"
          >
            <div style="display: flex; justify-content: space-between; gap: 10px; align-items: flex-start">
              <div style="flex: 1">
                <div class="mono" style="font-weight: 700; font-size: 13px">{{ dateLabel(entry) }} · {{ timeLabel(entry) }}</div>
                <div style="font-weight: 600; margin-top: 2px">{{ opponentLabel(entry) }}</div>
                <div v-if="entry.team?.name" class="cb-sub" style="margin-top: 2px">{{ entry.team.name }}</div>
                <div class="cb-sub" style="margin-top: 2px">{{ venueLabel(entry) }}</div>
              </div>
              <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end">
                <CbPill tone="violet">{{ matchTypeLabel(entry) }}</CbPill>
                <CbPill :tone="entry.parent.kind === 'home' ? 'emerald' : 'sky'">{{ kindBadgeLabel(entry) }}</CbPill>
              </div>
            </div>
            <div style="display: flex; gap: 6px; margin-top: 10px" @click.stop>
              <button
                type="button"
                class="cb-btn outline sm"
                style="flex: 1"
                @click="onAddToCalendar(entry)"
              >
                <CalendarPlus :size="14" /> Calendrier
              </button>
              <button
                class="cb-iconbtn"
                type="button"
                aria-label="Plus d'options"
                @click="onMore(entry)"
              >
                <MoreVertical :size="16" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="cb-div" />

      <!-- O2Section "Déclinées" tone="slate" -->
      <div style="display: flex; flex-direction: column">
        <button
          type="button"
          :style="{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            border: 0,
            background: 'transparent',
            padding: '10px 16px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            textAlign: 'left',
            width: '100%',
          }"
          @click="openDeclined = !openDeclined"
        >
          <div style="display: flex; align-items: center; gap: 10px">
            <CbPill tone="slate" dot>Déclinées</CbPill>
            <span class="mono" style="font-size: 12px; font-weight: 600; color: var(--text-subtle)">{{ declinedList.length }}</span>
          </div>
          <component
            :is="openDeclined ? ChevronUp : ChevronDown"
            :size="16"
            color="var(--slate-400)"
          />
        </button>
        <div
          v-if="openDeclined"
          style="padding: 0 16px 6px; display: flex; flex-direction: column; gap: 10px"
        >
          <div
            v-for="entry in declinedList"
            :key="entry.assignment.id"
            class="cb-card"
            style="padding: 12px; cursor: pointer"
            @click="goToMatch(entry)"
          >
            <div style="display: flex; justify-content: space-between; gap: 10px; align-items: flex-start">
              <div style="flex: 1">
                <div class="mono" style="font-weight: 700; font-size: 13px">{{ dateLabel(entry) }} · {{ timeLabel(entry) }}</div>
                <div style="font-weight: 600; margin-top: 2px">{{ opponentLabel(entry) }}</div>
                <div v-if="entry.team?.name" class="cb-sub" style="margin-top: 2px">{{ entry.team.name }}</div>
                <div class="cb-sub" style="margin-top: 2px">{{ venueLabel(entry) }}</div>
              </div>
              <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end">
                <CbPill tone="violet">{{ matchTypeLabel(entry) }}</CbPill>
                <CbPill :tone="entry.parent.kind === 'home' ? 'emerald' : 'sky'">{{ kindBadgeLabel(entry) }}</CbPill>
              </div>
            </div>
            <div style="display: flex; gap: 6px; margin-top: 10px" @click.stop>
              <button type="button" class="cb-btn ghost sm" @click="onReapply(entry)">
                Re-postuler
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Onglet "Passées" : liste à plat -->
    <div
      v-else
      style="flex: 1; overflow: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 10px"
    >
      <CbEmptyState
        v-if="pastEntries.length === 0"
        :icon="Calendar"
        title="Aucune assignation passée"
        body="L'historique de vos assignations apparaîtra ici."
      />
      <div
        v-for="entry in pastEntries"
        :key="entry.assignment.id"
        class="cb-card"
        style="padding: 12px; cursor: pointer"
        @click="goToMatch(entry)"
      >
        <div style="display: flex; justify-content: space-between; gap: 10px; align-items: flex-start">
          <div style="flex: 1">
            <div class="mono" style="font-weight: 700; font-size: 13px">{{ dateLabel(entry) }} · {{ timeLabel(entry) }}</div>
            <div style="font-weight: 600; margin-top: 2px">{{ opponentLabel(entry) }}</div>
            <div v-if="entry.team?.name" class="cb-sub" style="margin-top: 2px">{{ entry.team.name }}</div>
            <div class="cb-sub" style="margin-top: 2px">{{ venueLabel(entry) }}</div>
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end">
            <CbPill tone="violet">{{ matchTypeLabel(entry) }}</CbPill>
            <CbPill :tone="entry.parent.kind === 'home' ? 'emerald' : 'sky'">{{ kindBadgeLabel(entry) }}</CbPill>
          </div>
        </div>
      </div>
    </div>
  </CbMobileShell>

  <!-- ─── O2Desktop (JSX lignes 127-172) ────────────────────────── -->
  <CbDesktopShell
    v-else
    :items="nav"
    :user-role="primaryRoleLabel"
    @nav-select="onNavSelect"
  >
    <CbPageHead
      title="Mes assignations"
      :subtitle="`${officialLevelLabel} · ${upcomingCount} à venir · ${pastCount} passées`"
    >
      <template #actions>
        <div class="cb-segmented">
          <button :class="{ active: activeTab === 'upcoming' }" @click="activeTab = 'upcoming'">À venir</button>
          <button :class="{ active: activeTab === 'past' }" @click="activeTab = 'past'">Passées</button>
        </div>
      </template>
    </CbPageHead>

    <!-- Loading desktop -->
    <div
      v-if="isLoading"
      style="flex: 1; overflow: auto; padding: 24px; background: var(--bg-muted); display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; align-items: start"
    >
      <div v-for="col in 3" :key="col">
        <CbSkel w="40%" :h="16" />
        <div style="height: 12px" />
        <div v-for="i in 2" :key="i" class="cb-card" style="padding: 12px; margin-bottom: 12px">
          <CbSkel w="50%" :h="14" />
          <div style="height: 6px" />
          <CbSkel w="80%" :h="14" />
          <div style="height: 6px" />
          <CbSkel w="65%" :h="12" />
        </div>
      </div>
    </div>

    <!-- Empty -->
    <div
      v-else-if="isEmpty"
      style="flex: 1; overflow: auto; padding: 24px; background: var(--bg-muted)"
    >
      <CbEmptyState
        :icon="Calendar"
        title="Aucune assignation"
        body="Inscrivez-vous sur un match à pourvoir pour commencer."
      />
    </div>

    <!-- "À venir" : grid 3 colonnes -->
    <div
      v-else-if="activeTab === 'upcoming'"
      style="flex: 1; overflow: auto; padding: 24px; background: var(--bg-muted); display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; align-items: start"
    >
      <!-- Col Pending -->
      <div>
        <div style="display: flex; align-items: center; gap: 10px; padding: 0 4px 10px">
          <CbPill tone="amber" dot>Pending</CbPill>
          <span class="mono" style="font-size: 12px; color: var(--text-subtle); font-weight: 600">{{ pendingList.length }}</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px">
          <div
            v-for="entry in pendingList"
            :key="entry.assignment.id"
            class="cb-card"
            style="padding: 12px; cursor: pointer"
            @click="goToMatch(entry)"
          >
            <div style="display: flex; justify-content: space-between; gap: 10px; align-items: flex-start">
              <div style="flex: 1">
                <div class="mono" style="font-weight: 700; font-size: 13px">{{ dateLabel(entry) }} · {{ timeLabel(entry) }}</div>
                <div style="font-weight: 600; margin-top: 2px">{{ opponentLabel(entry) }}</div>
                <div v-if="entry.team?.name" class="cb-sub" style="margin-top: 2px">{{ entry.team.name }}</div>
                <div class="cb-sub" style="margin-top: 2px">{{ venueLabel(entry) }}</div>
              </div>
              <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end">
                <CbPill tone="violet">{{ matchTypeLabel(entry) }}</CbPill>
                <CbPill :tone="entry.parent.kind === 'home' ? 'emerald' : 'sky'">{{ kindBadgeLabel(entry) }}</CbPill>
              </div>
            </div>
            <div style="display: flex; gap: 6px; margin-top: 10px" @click.stop>
              <button
                type="button"
                class="cb-btn outline sm"
                style="flex: 1"
                :disabled="submittingId === entry.assignment.id"
                @click="openDecline(entry)"
              >
                Décliner
              </button>
              <button
                type="button"
                class="cb-btn primary sm"
                style="flex: 2"
                :disabled="submittingId === entry.assignment.id"
                @click="onConfirm(entry)"
              >
                Confirmer
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Col Confirmées -->
      <div>
        <div style="display: flex; align-items: center; gap: 10px; padding: 0 4px 10px">
          <CbPill tone="emerald" dot>Confirmées</CbPill>
          <span class="mono" style="font-size: 12px; color: var(--text-subtle); font-weight: 600">{{ confirmedList.length }}</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px">
          <div
            v-for="entry in confirmedList"
            :key="entry.assignment.id"
            class="cb-card"
            style="padding: 12px; cursor: pointer"
            @click="goToMatch(entry)"
          >
            <div style="display: flex; justify-content: space-between; gap: 10px; align-items: flex-start">
              <div style="flex: 1">
                <div class="mono" style="font-weight: 700; font-size: 13px">{{ dateLabel(entry) }} · {{ timeLabel(entry) }}</div>
                <div style="font-weight: 600; margin-top: 2px">{{ opponentLabel(entry) }}</div>
                <div v-if="entry.team?.name" class="cb-sub" style="margin-top: 2px">{{ entry.team.name }}</div>
                <div class="cb-sub" style="margin-top: 2px">{{ venueLabel(entry) }}</div>
              </div>
              <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end">
                <CbPill tone="violet">{{ matchTypeLabel(entry) }}</CbPill>
                <CbPill :tone="entry.parent.kind === 'home' ? 'emerald' : 'sky'">{{ kindBadgeLabel(entry) }}</CbPill>
              </div>
            </div>
            <div style="display: flex; gap: 6px; margin-top: 10px" @click.stop>
              <button type="button" class="cb-btn outline sm" style="flex: 1" @click="onAddToCalendar(entry)">
                <CalendarPlus :size="14" /> Ajouter au calendrier
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Col Déclinées -->
      <div>
        <div style="display: flex; align-items: center; gap: 10px; padding: 0 4px 10px">
          <CbPill tone="slate" dot>Déclinées</CbPill>
          <span class="mono" style="font-size: 12px; color: var(--text-subtle); font-weight: 600">{{ declinedList.length }}</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px">
          <div
            v-for="entry in declinedList"
            :key="entry.assignment.id"
            class="cb-card"
            style="padding: 12px; cursor: pointer"
            @click="goToMatch(entry)"
          >
            <div style="display: flex; justify-content: space-between; gap: 10px; align-items: flex-start">
              <div style="flex: 1">
                <div class="mono" style="font-weight: 700; font-size: 13px">{{ dateLabel(entry) }} · {{ timeLabel(entry) }}</div>
                <div style="font-weight: 600; margin-top: 2px">{{ opponentLabel(entry) }}</div>
                <div v-if="entry.team?.name" class="cb-sub" style="margin-top: 2px">{{ entry.team.name }}</div>
                <div class="cb-sub" style="margin-top: 2px">{{ venueLabel(entry) }}</div>
              </div>
              <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end">
                <CbPill tone="violet">{{ matchTypeLabel(entry) }}</CbPill>
                <CbPill :tone="entry.parent.kind === 'home' ? 'emerald' : 'sky'">{{ kindBadgeLabel(entry) }}</CbPill>
              </div>
            </div>
            <div style="display: flex; gap: 6px; margin-top: 10px" @click.stop>
              <button type="button" class="cb-btn ghost sm" @click="onReapply(entry)">Re-postuler</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- "Passées" desktop : liste à plat dans un container max-width -->
    <div
      v-else
      style="flex: 1; overflow: auto; padding: 24px; background: var(--bg-muted)"
    >
      <div
        style="max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 10px"
      >
        <CbEmptyState
          v-if="pastEntries.length === 0"
          :icon="Calendar"
          title="Aucune assignation passée"
          body="L'historique de vos assignations apparaîtra ici."
        />
        <div
          v-for="entry in pastEntries"
          :key="entry.assignment.id"
          class="cb-card"
          style="padding: 12px; cursor: pointer"
          @click="goToMatch(entry)"
        >
          <div style="display: flex; justify-content: space-between; gap: 10px; align-items: flex-start">
            <div style="flex: 1">
              <div class="mono" style="font-weight: 700; font-size: 13px">{{ dateLabel(entry) }} · {{ timeLabel(entry) }}</div>
              <div style="font-weight: 600; margin-top: 2px">{{ opponentLabel(entry) }}</div>
              <div v-if="entry.team?.name" class="cb-sub" style="margin-top: 2px">{{ entry.team.name }}</div>
              <div class="cb-sub" style="margin-top: 2px">{{ venueLabel(entry) }}</div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end">
              <CbPill tone="violet">{{ matchTypeLabel(entry) }}</CbPill>
              <CbPill :tone="entry.parent.kind === 'home' ? 'emerald' : 'sky'">{{ kindBadgeLabel(entry) }}</CbPill>
            </div>
          </div>
        </div>
      </div>
    </div>
  </CbDesktopShell>

  <!-- Dialog refus ─────────────────────────────────────────────── -->
  <CbAssignmentActionDialog
    v-model:visible="declineDialogOpen"
    mode="decline"
    :match-summary="declineSummary"
    :submitting="submittingId !== null"
    @submit="submitDecline"
    @cancel="cancelDecline"
  />

  <!-- Toast UX ─────────────────────────────────────────────────── -->
  <Teleport to="body">
    <Transition name="cb-toast">
      <div
        v-if="toast.visible"
        class="cb-o2-toast"
        :class="`tone-${toast.tone}`"
        role="status"
      >
        <component
          :is="toast.tone === 'rose' ? AlertTriangle : toast.tone === 'sky' ? Calendar : CheckCircle2"
          :size="16"
        />
        <span>{{ toast.message }}</span>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cb-o2-toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 10px 25px rgba(15, 23, 42, 0.18);
  z-index: 1100;
  max-width: calc(100vw - 32px);
}
.cb-o2-toast.tone-emerald {
  background: var(--emerald-500, #10b981);
  color: #fff;
}
.cb-o2-toast.tone-rose {
  background: var(--rose-500, #f43f5e);
  color: #fff;
}
.cb-o2-toast.tone-sky {
  background: var(--sky-500, #0ea5e9);
  color: #fff;
}
.cb-toast-enter-active,
.cb-toast-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}
.cb-toast-enter-from,
.cb-toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}
</style>
