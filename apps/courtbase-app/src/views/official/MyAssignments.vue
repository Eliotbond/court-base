<script setup lang="ts">
/**
 * O2 — Mes assignations (officiel).
 *
 * Transcription quasi-littérale du JSX `screens/official.jsx` (O2Mobile lignes
 * 71-125 + O2Desktop lignes 127-172). Helpers JSX `O2Section` et
 * `MiniAssignmentCard` ont été inlinés ici (équivalents Vue avec les mêmes
 * `style="..."` et `class="..."` qu'en JSX).
 *
 * Mock only — `logMockAction(...)` pour tous les CTAs, pas de mutation.
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
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
import { useShellNav } from '@/composables/useShellNav'
import { useViewport } from '@/composables/useViewport'
import {
  getMatch,
  getTeam,
  listMyAssignments,
  logMockAction,
  type MockAssignment,
  type MockMatch,
} from '@/repositories/mock'
import { useAuthStore } from '@/stores/auth'

// ───────────────────────────────────────────────────────────────
// État `empty` (toggle const en haut du script, conforme au brief)
// ───────────────────────────────────────────────────────────────

const MOCK_EMPTY = false
const empty = MOCK_EMPTY

const router = useRouter()
const auth = useAuthStore()
const { isDesktop } = useViewport()
const { officialTabs, officialNav } = useShellNav()

// ───────────────────────────────────────────────────────────────
// Source de vérité : assignations du user connecté
// ───────────────────────────────────────────────────────────────

/**
 * MOCK only — on étoffe les assignations seed avec 2 entrées locales pour
 * pouvoir rendre les 3 sections de la maquette (Pending + Déclinées).
 */
const LOCAL_MOCK_EXTRA: MockAssignment[] = [
  {
    id: 'a-local-pending',
    matchId: 'match-amical-devils',
    memberId: 'm-mathieu',
    requiredLevel: 2,
    status: 'pending',
    createdBy: 'admin',
  },
  {
    id: 'a-local-declined',
    matchId: 'match-csjc-meyrin',
    memberId: 'm-mathieu',
    requiredLevel: 2,
    status: 'declined',
    createdBy: 'self',
  },
]

const memberId = computed(() => auth.linkedMember?.id ?? auth.uid ?? null)

const myAssignments = computed<MockAssignment[]>(() => {
  if (empty) return []
  if (!memberId.value) return []
  return [...listMyAssignments(memberId.value), ...LOCAL_MOCK_EXTRA]
})

// ───────────────────────────────────────────────────────────────
// Enrichissement : on joint chaque assignment au match correspondant
// ───────────────────────────────────────────────────────────────

interface AssignmentView {
  assignment: MockAssignment
  match: MockMatch
  dateLabel: string
  homeTeamName: string | null
  isPast: boolean
}

const TODAY_MOCK = new Date('2025-10-23')
const WEEKDAY_LABELS = ['Di', 'Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa']
const MONTH_LABELS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

function formatDateLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const day = WEEKDAY_LABELS[d.getDay()] ?? ''
  const month = MONTH_LABELS[d.getMonth()] ?? ''
  return `${day} ${d.getDate()} ${month}`
}

const assignmentViews = computed<AssignmentView[]>(() => {
  const out: AssignmentView[] = []
  for (const a of myAssignments.value) {
    const m = getMatch(a.matchId)
    if (!m) continue
    const team = getTeam(m.teamId)
    out.push({
      assignment: a,
      match: m,
      dateLabel: formatDateLabel(m.date),
      homeTeamName: team?.name ?? null,
      isPast: new Date(m.date) < TODAY_MOCK,
    })
  }
  return out.sort((a, b) => a.match.date.localeCompare(b.match.date))
})

const upcoming = computed(() => assignmentViews.value.filter((v) => !v.isPast))
const past = computed(() => assignmentViews.value.filter((v) => v.isPast))

const pendingList = computed(() => upcoming.value.filter((v) => v.assignment.status === 'pending'))
const confirmedList = computed(() => upcoming.value.filter((v) => v.assignment.status === 'confirmed'))
const declinedList = computed(() => upcoming.value.filter((v) => v.assignment.status === 'declined'))

const upcomingCount = computed(() => upcoming.value.length)
const pastCount = computed(() => past.value.length)

// ───────────────────────────────────────────────────────────────
// Onglets À venir / Passées (state local, mock)
// ───────────────────────────────────────────────────────────────

type TabKey = 'upcoming' | 'past'
const activeTab = ref<TabKey>('upcoming')

// ───────────────────────────────────────────────────────────────
// Sections collapsibles (state local — fidélité 1:1 au JSX `O2Section`)
// ───────────────────────────────────────────────────────────────

const openPending = ref(true)
const openConfirmed = ref(true)
const openDeclined = ref(false)

// ───────────────────────────────────────────────────────────────
// Handlers (Phase 1 wiring TBD — log only)
// ───────────────────────────────────────────────────────────────

function goToMatch(assignmentId: string, matchId: string): void {
  logMockAction('o2.openMatch', { assignmentId, matchId })
  router.push({ name: 'match-detail', params: { id: matchId } })
}

function onConfirm(assignmentId: string): void {
  logMockAction('o2.confirm', { assignmentId })
}

function onDecline(assignmentId: string): void {
  logMockAction('o2.decline', { assignmentId })
}

function onAddToCalendar(assignmentId: string): void {
  logMockAction('o2.addToCalendar', { assignmentId })
}

function onReapply(assignmentId: string): void {
  logMockAction('o2.reapply', { assignmentId })
}

function onMore(assignmentId: string): void {
  logMockAction('o2.more', { assignmentId })
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
</script>

<template>
  <!-- ─── O2Mobile (JSX lignes 71-125) ──────────────────────────── -->
  <CbMobileShell
    v-if="!isDesktop"
    title="Mes assignations"
    notif-badge
    :tabs="officialTabs"
    :active-tab="1"
    @notif-click="goNotifications"
    @tab-select="onTabSelect"
  >
    <!-- Segmented "À venir · 4 / Passées · 18" (JSX 73-83) -->
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

    <!-- Empty state (JSX 84-85) -->
    <CbEmptyState
      v-if="empty"
      :icon="Calendar"
      title="Aucune assignation"
      body="Inscrivez-vous sur un match à pourvoir pour commencer."
    />

    <!-- Sections (JSX 87-122) -->
    <div
      v-else-if="activeTab === 'upcoming'"
      style="flex: 1; overflow: auto; padding: 6px 0 16px"
    >
      <!-- O2Section "Pending" tone="amber" count="1" -->
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
          <!-- MiniAssignmentCard (JSX 89-96) -->
          <div
            v-for="v in pendingList"
            :key="v.assignment.id"
            class="cb-card"
            style="padding: 12px; cursor: pointer"
            @click="goToMatch(v.assignment.id, v.match.id)"
          >
            <div style="display: flex; justify-content: space-between; gap: 10px; align-items: flex-start">
              <div style="flex: 1">
                <div class="mono" style="font-weight: 700; font-size: 13px">{{ v.dateLabel }} · {{ v.match.startTime }}</div>
                <div style="font-weight: 600; margin-top: 2px">{{ v.match.opponent }}</div>
                <div class="cb-sub" style="margin-top: 2px">{{ v.match.venueLabel }}</div>
              </div>
              <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end">
                <CbPill tone="violet">{{ v.match.matchType }}</CbPill>
              </div>
            </div>
            <div style="display: flex; gap: 6px; margin-top: 10px" @click.stop>
              <button
                class="cb-btn outline sm"
                style="flex: 1"
                @click="onDecline(v.assignment.id)"
              >
                <XCircle :size="14" /> Décliner
              </button>
              <button
                class="cb-btn primary sm"
                style="flex: 2"
                @click="onConfirm(v.assignment.id)"
              >
                <CheckCircle2 :size="14" /> Confirmer
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="cb-div" />

      <!-- O2Section "Confirmées" tone="emerald" count="2" -->
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
            v-for="v in confirmedList"
            :key="v.assignment.id"
            class="cb-card"
            style="padding: 12px; cursor: pointer"
            @click="goToMatch(v.assignment.id, v.match.id)"
          >
            <div style="display: flex; justify-content: space-between; gap: 10px; align-items: flex-start">
              <div style="flex: 1">
                <div class="mono" style="font-weight: 700; font-size: 13px">{{ v.dateLabel }} · {{ v.match.startTime }}</div>
                <div style="font-weight: 600; margin-top: 2px">{{ v.match.opponent }}</div>
                <div class="cb-sub" style="margin-top: 2px">{{ v.match.venueLabel }}</div>
              </div>
              <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end">
                <CbPill tone="violet">{{ v.match.matchType }}</CbPill>
              </div>
            </div>
            <div style="display: flex; gap: 6px; margin-top: 10px" @click.stop>
              <button
                class="cb-btn outline sm"
                style="flex: 1"
                @click="onAddToCalendar(v.assignment.id)"
              >
                <CalendarPlus :size="14" /> Calendrier
              </button>
              <button
                class="cb-iconbtn"
                type="button"
                aria-label="Plus d'options"
                @click="onMore(v.assignment.id)"
              >
                <MoreVertical :size="16" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="cb-div" />

      <!-- O2Section "Déclinées" tone="slate" count="1" defaultOpen={false} -->
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
            v-for="v in declinedList"
            :key="v.assignment.id"
            class="cb-card"
            style="padding: 12px; cursor: pointer"
            @click="goToMatch(v.assignment.id, v.match.id)"
          >
            <div style="display: flex; justify-content: space-between; gap: 10px; align-items: flex-start">
              <div style="flex: 1">
                <div class="mono" style="font-weight: 700; font-size: 13px">{{ v.dateLabel }} · {{ v.match.startTime }}</div>
                <div style="font-weight: 600; margin-top: 2px">{{ v.match.opponent }}</div>
                <div class="cb-sub" style="margin-top: 2px">{{ v.match.venueLabel }}</div>
              </div>
              <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end">
                <CbPill tone="violet">{{ v.match.matchType }}</CbPill>
              </div>
            </div>
            <div style="display: flex; gap: 6px; margin-top: 10px" @click.stop>
              <button class="cb-btn ghost sm" @click="onReapply(v.assignment.id)">
                Re-postuler
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Onglet "Passées" (hors JSX d'origine, mais cohérent avec le segmented) -->
    <div
      v-else
      style="flex: 1; overflow: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 10px"
    >
      <div
        v-for="v in past"
        :key="v.assignment.id"
        class="cb-card"
        style="padding: 12px; cursor: pointer"
        @click="goToMatch(v.assignment.id, v.match.id)"
      >
        <div style="display: flex; justify-content: space-between; gap: 10px; align-items: flex-start">
          <div style="flex: 1">
            <div class="mono" style="font-weight: 700; font-size: 13px">{{ v.dateLabel }} · {{ v.match.startTime }}</div>
            <div style="font-weight: 600; margin-top: 2px">{{ v.match.opponent }}</div>
            <div class="cb-sub" style="margin-top: 2px">{{ v.match.venueLabel }}</div>
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end">
            <CbPill tone="violet">{{ v.match.matchType }}</CbPill>
          </div>
        </div>
      </div>
    </div>
  </CbMobileShell>

  <!-- ─── O2Desktop (JSX lignes 127-172) ────────────────────────── -->
  <CbDesktopShell
    v-else
    :items="officialNav"
    :active="2"
    @nav-select="onNavSelect"
  >
    <CbPageHead
      title="Mes assignations"
      subtitle="Niveau 2 · 4 à venir · 18 passées"
    >
      <template #actions>
        <div class="cb-segmented">
          <button :class="{ active: activeTab === 'upcoming' }" @click="activeTab = 'upcoming'">À venir</button>
          <button :class="{ active: activeTab === 'past' }" @click="activeTab = 'past'">Passées</button>
        </div>
      </template>
    </CbPageHead>

    <div
      style="flex: 1; overflow: auto; padding: 24px; background: var(--bg-muted); display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; align-items: start"
    >
      <!-- Col Pending (JSX 135-146) -->
      <div>
        <div style="display: flex; align-items: center; gap: 10px; padding: 0 4px 10px">
          <CbPill tone="amber" dot>Pending</CbPill>
          <span class="mono" style="font-size: 12px; color: var(--text-subtle); font-weight: 600">{{ pendingList.length }}</span>
        </div>
        <div
          v-for="v in pendingList"
          :key="v.assignment.id"
          class="cb-card"
          style="padding: 12px; cursor: pointer"
          @click="goToMatch(v.assignment.id, v.match.id)"
        >
          <div style="display: flex; justify-content: space-between; gap: 10px; align-items: flex-start">
            <div style="flex: 1">
              <div class="mono" style="font-weight: 700; font-size: 13px">{{ v.dateLabel }} · {{ v.match.startTime }}</div>
              <div style="font-weight: 600; margin-top: 2px">{{ v.match.opponent }}</div>
              <div class="cb-sub" style="margin-top: 2px">{{ v.match.venueLabel }}</div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end">
              <CbPill tone="violet">{{ v.match.matchType }}</CbPill>
            </div>
          </div>
          <div style="display: flex; gap: 6px; margin-top: 10px" @click.stop>
            <button class="cb-btn outline sm" style="flex: 1" @click="onDecline(v.assignment.id)">Décliner</button>
            <button class="cb-btn primary sm" style="flex: 2" @click="onConfirm(v.assignment.id)">Confirmer</button>
          </div>
        </div>
      </div>

      <!-- Col Confirmées (JSX 147-160) -->
      <div>
        <div style="display: flex; align-items: center; gap: 10px; padding: 0 4px 10px">
          <CbPill tone="emerald" dot>Confirmées</CbPill>
          <span class="mono" style="font-size: 12px; color: var(--text-subtle); font-weight: 600">{{ confirmedList.length }}</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px">
          <div
            v-for="v in confirmedList"
            :key="v.assignment.id"
            class="cb-card"
            style="padding: 12px; cursor: pointer"
            @click="goToMatch(v.assignment.id, v.match.id)"
          >
            <div style="display: flex; justify-content: space-between; gap: 10px; align-items: flex-start">
              <div style="flex: 1">
                <div class="mono" style="font-weight: 700; font-size: 13px">{{ v.dateLabel }} · {{ v.match.startTime }}</div>
                <div style="font-weight: 600; margin-top: 2px">{{ v.match.opponent }}</div>
                <div class="cb-sub" style="margin-top: 2px">{{ v.match.venueLabel }}</div>
              </div>
              <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end">
                <CbPill tone="violet">{{ v.match.matchType }}</CbPill>
              </div>
            </div>
            <div style="display: flex; gap: 6px; margin-top: 10px" @click.stop>
              <button class="cb-btn outline sm" style="flex: 1" @click="onAddToCalendar(v.assignment.id)">
                <CalendarPlus :size="14" /> Ajouter au calendrier
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Col Déclinées (JSX 161-169) -->
      <div>
        <div style="display: flex; align-items: center; gap: 10px; padding: 0 4px 10px">
          <CbPill tone="slate" dot>Déclinées</CbPill>
          <span class="mono" style="font-size: 12px; color: var(--text-subtle); font-weight: 600">{{ declinedList.length }}</span>
        </div>
        <div
          v-for="v in declinedList"
          :key="v.assignment.id"
          class="cb-card"
          style="padding: 12px; cursor: pointer"
          @click="goToMatch(v.assignment.id, v.match.id)"
        >
          <div style="display: flex; justify-content: space-between; gap: 10px; align-items: flex-start">
            <div style="flex: 1">
              <div class="mono" style="font-weight: 700; font-size: 13px">{{ v.dateLabel }} · {{ v.match.startTime }}</div>
              <div style="font-weight: 600; margin-top: 2px">{{ v.match.opponent }}</div>
              <div class="cb-sub" style="margin-top: 2px">{{ v.match.venueLabel }}</div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end">
              <CbPill tone="violet">{{ v.match.matchType }}</CbPill>
            </div>
          </div>
          <div style="display: flex; gap: 6px; margin-top: 10px" @click.stop>
            <button class="cb-btn ghost sm" @click="onReapply(v.assignment.id)">Re-postuler</button>
          </div>
        </div>
      </div>
    </div>
  </CbDesktopShell>
</template>
