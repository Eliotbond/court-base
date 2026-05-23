<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertTriangle,
  BellRing,
} from 'lucide-vue-next'

import CbBanner from '@/components/ui/CbBanner.vue'
import CbDesktopShell from '@/components/ui/CbDesktopShell.vue'
import CbEmptyState from '@/components/ui/CbEmptyState.vue'
import CbMatchCard from '@/components/ui/CbMatchCard.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbPageHead from '@/components/ui/CbPageHead.vue'
import CbSkel from '@/components/ui/CbSkel.vue'
import { useShellNav } from '@/composables/useShellNav'
import { useViewport } from '@/composables/useViewport'
import {
  countUnread,
  getMember,
  listAssignmentsForMatch,
  listOpenMatches,
  logMockAction,
  type MockMatch,
} from '@/repositories/mock'
import { useAuthStore } from '@/stores/auth'

/**
 * O1 — Matchs à pourvoir (officiel).
 *
 * Transcription quasi-littérale du JSX `O1Mobile` (cf.
 * `screens/official.jsx` lignes 3-37). Mobile = `CbMobileShell`. Desktop
 * (≥1024px) reprend le pattern `CbDesktopShell` + `CbPageHead` + grille
 * auto-fill 300px de `CbMatchCard`.
 *
 * 3 variants côté JSX (toggle dev via const ci-dessous) :
 * - `MOCK_NO_LICENSE` : bannière amber "Pas de licence officiel active"
 * - `MOCK_EMPTY` : empty state
 * - `MOCK_LOADING` : skeleton
 */
const MOCK_NO_LICENSE = false
const MOCK_EMPTY = false
const MOCK_LOADING = false

const router = useRouter()
const auth = useAuthStore()
const { isDesktop } = useViewport()
const { officialTabs, officialNav } = useShellNav()

// ─── Licence officiel (gate auto-inscription) ────────────────
const showNoLicenseBanner = computed(
  () => MOCK_NO_LICENSE || !auth.hasActiveOfficialLicense,
)

// ─── Filtres chips ────────────────────────────────────────────
type FilterKind = 'all' | 'home' | 'away' | 'week'
const filters: ReadonlyArray<{ id: FilterKind; label: string }> = [
  { id: 'all', label: 'Tous' },
  { id: 'home', label: 'Domicile' },
  { id: 'away', label: 'Extérieur' },
  { id: 'week', label: 'Cette semaine' },
]
const activeFilter = ref<FilterKind>('all')

function setFilter(id: FilterKind): void {
  if (activeFilter.value === id) return
  activeFilter.value = id
  logMockAction('open-matches.filter-changed', { filter: id })
}

// ─── Liste filtrée ───────────────────────────────────────────
function isWithinNextSevenDays(isoDate: string): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const horizon = new Date(today)
  horizon.setDate(horizon.getDate() + 7)
  const parts = isoDate.split('-')
  const y = Number(parts[0] ?? '1970')
  const m = Number(parts[1] ?? '1')
  const d = Number(parts[2] ?? '1')
  const target = new Date(y, m - 1, d)
  return target >= today && target <= horizon
}

const openMatches = computed<ReadonlyArray<MockMatch>>(() => {
  if (MOCK_EMPTY) return []
  const base = listOpenMatches(auth.officialLevel)
  return [...base]
    .filter((m) => {
      switch (activeFilter.value) {
        case 'home':
          return m.kind === 'home'
        case 'away':
          return m.kind === 'away'
        case 'week':
          return isWithinNextSevenDays(m.date)
        default:
          return true
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date))
})

// ─── Formatage date FR ───────────────────────────────────────
const dateFormatter = new Intl.DateTimeFormat('fr-CH', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

function formatDate(isoDate: string): string {
  const parts = isoDate.split('-')
  const y = Number(parts[0] ?? '1970')
  const m = Number(parts[1] ?? '1')
  const d = Number(parts[2] ?? '1')
  const raw = dateFormatter.format(new Date(y, m - 1, d))
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

// ─── Officiels déjà inscrits (initiales 2 lettres, max 4) ────
function initialsForMember(memberId: string): string {
  const member = getMember(memberId)
  if (!member) {
    return (
      memberId
        .replace(/^m-/, '')
        .split('-')
        .map((p) => p.charAt(0).toUpperCase())
        .join('')
        .slice(0, 2) || '??'
    )
  }
  const first = member.firstName.charAt(0).toUpperCase()
  const last = member.lastName.charAt(0).toUpperCase()
  return `${first}${last}`
}

function officialsForMatch(matchId: string): string[] {
  return listAssignmentsForMatch(matchId)
    .slice(0, 4)
    .map((a) => initialsForMember(a.memberId))
}

function filledAtLevel(match: MockMatch): number {
  return listAssignmentsForMatch(match.id).length
}

// ─── Navigation ──────────────────────────────────────────────
function openMatchDetail(matchId: string): void {
  router.push({ name: 'match-detail', params: { id: matchId } })
}

// ─── Shells ──────────────────────────────────────────────────
const notifBadgeCount = computed(() => countUnread())

function onTabSelect(index: number): void {
  if (index === 0) return // on est déjà ici
  if (index === 1) router.push({ name: 'my-assignments' })
  if (index === 2) router.push({ name: 'notifications' })
}

function onNavSelect(index: number): void {
  if (index === 0) router.push({ name: 'home' })
  if (index === 1) return // courant
  if (index === 2) router.push({ name: 'my-assignments' })
  if (index === 3) router.push({ name: 'notifications' })
}

function onNotifClick(): void {
  router.push({ name: 'notifications' })
}
</script>

<template>
  <!-- Desktop shell (≥1024px) ────────────────────────────────── -->
  <CbDesktopShell
    v-if="isDesktop"
    :items="officialNav"
    :active="1"
    brand-name="BC Aigles"
    brand-sub="Saison 2025/26"
    club-initials="BCA"
    :user-name="auth.displayName"
    user-role="Officiel"
    @nav-select="onNavSelect"
  >
    <CbPageHead
      title="Matchs à pourvoir"
      :subtitle="`${openMatches.length} match${openMatches.length > 1 ? 's' : ''} disponible${openMatches.length > 1 ? 's' : ''} à votre niveau`"
    />

    <CbBanner v-if="showNoLicenseBanner" tone="amber" title="Pas de licence officiel active">
      <template #icon><AlertTriangle :size="18" /></template>
      L'auto-inscription est bloquée. Contactez votre admin.
    </CbBanner>

    <div class="cb-chiprow" style="border-top: 0">
      <button
        v-for="f in filters"
        :key="f.id"
        class="cb-chip"
        :class="{ active: activeFilter === f.id }"
        type="button"
        @click="setFilter(f.id)"
      >
        {{ f.label }}
      </button>
    </div>

    <div class="om-desktop-grid">
      <CbEmptyState
        v-if="!MOCK_LOADING && openMatches.length === 0"
        :icon="BellRing"
        title="Aucun match à pourvoir"
        body="Les prochains matchs apparaîtront ici dès que le club les publiera."
      />
      <CbMatchCard
        v-for="m in openMatches"
        :key="m.id"
        :date="formatDate(m.date)"
        :time="m.startTime"
        :type="m.matchType"
        :opponent="m.opponent"
        :venue="m.venueLabel"
        :away="m.kind === 'away'"
        :staffing="{ filled: filledAtLevel(m), total: m.requiredOfficialsTotal }"
        :officials="officialsForMatch(m.id)"
        style="cursor: pointer"
        @click="openMatchDetail(m.id)"
      />
    </div>
  </CbDesktopShell>

  <!-- Mobile shell (< 1024px) — transcription littérale du JSX O1Mobile ── -->
  <CbMobileShell
    v-else
    title="Matchs à pourvoir"
    club="BCA"
    :notif-badge="notifBadgeCount > 0"
    :tabs="officialTabs"
    :active-tab="0"
    @notif-click="onNotifClick"
    @tab-select="onTabSelect"
  >
    <div style="height: 100%; overflow: auto">
      <CbBanner v-if="showNoLicenseBanner" tone="amber" title="Pas de licence officiel active">
        <template #icon><AlertTriangle :size="18" /></template>
        L'auto-inscription est bloquée. Contactez votre admin.
      </CbBanner>

      <div class="cb-chiprow">
        <button
          v-for="f in filters"
          :key="f.id"
          class="cb-chip"
          :class="{ active: activeFilter === f.id }"
          type="button"
          @click="setFilter(f.id)"
        >
          {{ f.label }}
        </button>
      </div>

      <div
        v-if="MOCK_LOADING"
        style="padding: 12px 16px; display: flex; flex-direction: column; gap: 10px"
      >
        <CbSkel :h="120" />
        <CbSkel :h="120" />
        <CbSkel :h="120" />
      </div>

      <CbEmptyState
        v-if="!MOCK_LOADING && openMatches.length === 0"
        :icon="BellRing"
        title="Aucun match à pourvoir"
        body="Les prochains matchs apparaîtront ici dès que le club les publiera."
      />

      <div
        v-if="!MOCK_LOADING && openMatches.length > 0"
        style="padding: 12px 16px; display: flex; flex-direction: column; gap: 12px"
      >
        <CbMatchCard
          v-for="m in openMatches"
          :key="m.id"
          :date="formatDate(m.date)"
          :time="m.startTime"
          :type="m.matchType"
          :opponent="m.opponent"
          :venue="m.venueLabel"
          :away="m.kind === 'away'"
          :staffing="{ filled: filledAtLevel(m), total: m.requiredOfficialsTotal }"
          :officials="officialsForMatch(m.id)"
          style="cursor: pointer"
          @click="openMatchDetail(m.id)"
        />
      </div>
    </div>
  </CbMobileShell>
</template>

<style scoped>
.om-desktop-grid {
  padding: 20px 28px 32px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}
</style>
