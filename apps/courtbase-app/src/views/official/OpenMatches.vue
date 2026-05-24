<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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
import { useActiveSeason } from '@/composables/useSeason'
import { useShellNav } from '@/composables/useShellNav'
import { useViewport } from '@/composables/useViewport'
import { useAuthStore } from '@/stores/auth'
import { useBookingsStore } from '@/stores/bookings'
import { useOfficialsStore, type OpportunityEntry } from '@/stores/officials'
import { useTeamsStore } from '@/stores/teams'
import type { MockTeam } from '@/types/mock'
import type { Match, MatchType, Timestamp } from '@club-app/shared-types'
import { Timestamp as FsTimestamp } from 'firebase/firestore'

/**
 * O1 — Matchs à pourvoir (officiel).
 *
 * Wiring Firestore réel via `useOfficialsStore` + `useBookingsStore` (cf.
 * `apps/courtbase-app/CLAUDE.md` § hybride mock+réel). La structure visuelle
 * (cards / banner / chips / shells) reste la transcription littérale du JSX
 * `O1Mobile` — seuls les bindings data ont été branchés.
 *
 * Filtre par défaut = opportunités ouvertes (HOME où il manque un slot du
 * niveau du caller OU AWAY non staffé OU HOME sans salle) via
 * `openOpportunitiesForLevel(level)`. Toggle "Tous" via la chip `all` :
 * inclut tous les matchs FUTURS, même complets.
 */

const router = useRouter()
const auth = useAuthStore()
const bookingsStore = useBookingsStore()
const officialsStore = useOfficialsStore()
const teamsStore = useTeamsStore()
const seasonStore = useActiveSeason()
const { isDesktop } = useViewport()
const { tabs, nav, primaryRoleLabel } = useShellNav()

// ─── Mount : hydrate bookings + officials context ─────────────
const localLoading = ref(true)

onMounted(async () => {
  try {
    await bookingsStore.loadActiveContext()
    // `useActiveSeason().load()` est cached + déduplique via `inFlight`.
    const resolvedSeasonId = (await seasonStore.load()) ?? 'mock-season'
    await officialsStore.loadOfficialContext(resolvedSeasonId)
  } catch (err) {
    // Erreurs déjà loggées + stockées côté stores ; ne pas propager.
    console.error('[OpenMatches] mount failed', err)
  } finally {
    localLoading.value = false
  }
})

// ─── Licence officiel (gate auto-inscription) ────────────────
const showNoLicenseBanner = computed(() => !auth.hasActiveOfficialLicense)

// ─── Filtres chips ────────────────────────────────────────────
// 4 modes : Tous (= toutes opportunités OPEN, défaut), Domicile (HOME OPEN),
// Extérieur (AWAY OPEN), "Tous matchs" inclut aussi les complets futurs.
type FilterKind = 'all' | 'home' | 'away' | 'allMatches'
const filters: ReadonlyArray<{ id: FilterKind; label: string }> = [
  { id: 'all', label: 'Ouverts' },
  { id: 'home', label: 'Domicile' },
  { id: 'away', label: 'Extérieur' },
  { id: 'allMatches', label: 'Tous' },
]
const activeFilter = ref<FilterKind>('all')

function setFilter(id: FilterKind): void {
  if (activeFilter.value === id) return
  activeFilter.value = id
}

// ─── Liste affichée ───────────────────────────────────────────

/** Helpers pour normaliser un Timestamp → epoch ms. */
function tsToMs(ts: Timestamp | null | undefined): number {
  if (!ts) return 0
  const t = ts as { seconds?: number; toMillis?: () => number }
  if (typeof t.toMillis === 'function') return t.toMillis()
  if (typeof t.seconds === 'number') return t.seconds * 1000
  return 0
}

const officialLevel = computed<number>(() => auth.officialLevel ?? 1)

/** Opportunités ouvertes pour le niveau du caller (filtre par défaut). */
const openOpportunities = computed<ReadonlyArray<OpportunityEntry>>(() => {
  return officialsStore.openOpportunitiesForLevel(officialLevel.value)
})

/**
 * Liste "Tous matchs futurs" — inclut les matchs déjà complets et ceux sans
 * slot pour le niveau du caller. Agrégation directe (HOME via bookings store +
 * AWAY via officials store) pour rester sur le même type `OpportunityEntry`
 * que la liste par défaut, avec `openSlots: 0` pour les complets.
 */
const allFutureMatches = computed<ReadonlyArray<OpportunityEntry>>(() => {
  const now = Date.now()
  const teamById = new Map<string, MockTeam>()
  for (const t of teamsStore.teams) teamById.set(t.id, t)

  const out: OpportunityEntry[] = []

  // HOME : tous les bookings `match_home` futurs.
  for (const booking of bookingsStore.allBookings) {
    if (booking.slotType !== 'match_home') continue
    if (booking.startMs < now) continue
    const mt: MatchType | null = booking.matchTypeId
      ? (officialsStore.matchTypesById.get(booking.matchTypeId) ?? null)
      : null
    const requirements = mt?.homeOfficialRequirements ?? []
    const req = requirements.find((r) => r.level === officialLevel.value)
    const assigns = officialsStore.homeAssignmentsByBookingId.get(booking.id) ?? []
    const takenAtLevel = assigns.filter(
      (a) => a.officialLevel === officialLevel.value && a.status !== 'declined',
    ).length
    const openSlots = req ? Math.max(0, req.count - takenAtLevel) : 0
    const location =
      booking.venueName && booking.courtName
        ? `${booking.venueName} · ${booking.courtName}`
        : 'Salle non attribuée'
    out.push({
      kind: 'home',
      parentId: booking.id,
      matchType: mt,
      team: booking.teamId ? (teamById.get(booking.teamId) ?? null) : null,
      date: FsTimestamp.fromMillis(booking.startMs),
      startTime: booking.startTime,
      endTime: booking.endTime,
      opponentName: booking.opponentName,
      location,
      openSlots,
    })
  }

  // AWAY : tous les matchs `kind === 'away'` futurs.
  for (const match of officialsStore.awayMatches as ReadonlyArray<Match>) {
    if (tsToMs(match.date) < now) continue
    const mt: MatchType | null =
      officialsStore.matchTypesById.get(match.matchTypeId) ?? null
    const required = mt?.awayOfficialCount ?? 0
    const assigns = officialsStore.awayAssignmentsByMatchId.get(match.id) ?? []
    const taken = assigns.filter((a) => a.status !== 'declined').length
    const openSlots = Math.max(0, required - taken)
    out.push({
      kind: 'away',
      parentId: match.id,
      matchType: mt,
      team: teamById.get(match.teamId) ?? null,
      date: match.date,
      startTime: match.startTime,
      endTime: match.endTime,
      opponentName: match.opponentName,
      location: match.awayAddress,
      openSlots,
    })
  }

  out.sort((a, b) => tsToMs(a.date) - tsToMs(b.date))
  return out
})

/** Liste finale après application du filtre actif. */
const displayedList = computed<ReadonlyArray<OpportunityEntry>>(() => {
  const base =
    activeFilter.value === 'allMatches' ? allFutureMatches.value : openOpportunities.value
  if (activeFilter.value === 'home') {
    return base.filter((o) => o.kind === 'home')
  }
  if (activeFilter.value === 'away') {
    return base.filter((o) => o.kind === 'away')
  }
  return base
})

// ─── Loading / empty flags ────────────────────────────────────
const isLoading = computed(
  () =>
    localLoading.value ||
    officialsStore.loading ||
    bookingsStore.loading,
)

// ─── Formatage date FR ───────────────────────────────────────
const dateFormatter = new Intl.DateTimeFormat('fr-CH', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

function formatDate(ts: Timestamp): string {
  const ms = tsToMs(ts)
  if (!ms) return ''
  const raw = dateFormatter.format(new Date(ms))
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

// ─── Helpers card binding ────────────────────────────────────

function opponentLabel(entry: OpportunityEntry): string {
  return entry.opponentName ?? 'Adversaire à confirmer'
}

function venueLabel(entry: OpportunityEntry): string {
  return entry.location ?? (entry.kind === 'away' ? 'Adresse à confirmer' : 'Salle non attribuée')
}

function matchTypeLabel(entry: OpportunityEntry): string {
  return entry.matchType?.name ?? '—'
}

/** Initiales (2 lettres) des officiels déjà inscrits — max 4 affichés. */
function initialsFromMemberId(memberId: string): string {
  return (
    memberId
      .replace(/^m-/, '')
      .split('-')
      .map((p) => p.charAt(0).toUpperCase())
      .join('')
      .slice(0, 2) || '??'
  )
}

function officialsForEntry(entry: OpportunityEntry): string[] {
  const assigns =
    entry.kind === 'home'
      ? officialsStore.homeAssignmentsByBookingId.get(entry.parentId)
      : officialsStore.awayAssignmentsByMatchId.get(entry.parentId)
  if (!assigns) return []
  return assigns
    .filter((a) => a.status !== 'declined')
    .slice(0, 4)
    .map((a) => initialsFromMemberId(a.memberId))
}

/** Staffing pour la pill — total + filled selon HOME (level uniquement) ou AWAY. */
function staffingForEntry(
  entry: OpportunityEntry,
): { filled: number; total: number; complete: boolean } {
  if (entry.kind === 'home') {
    const req = entry.matchType?.homeOfficialRequirements?.find(
      (r) => r.level === officialLevel.value,
    )
    const total = req?.count ?? 0
    const filled = total - entry.openSlots
    return { filled: Math.max(0, filled), total, complete: entry.openSlots === 0 && total > 0 }
  }
  const total = entry.matchType?.awayOfficialCount ?? 0
  const filled = total - entry.openSlots
  return { filled: Math.max(0, filled), total, complete: entry.openSlots === 0 && total > 0 }
}

// ─── Navigation ──────────────────────────────────────────────
function openMatchDetail(parentId: string): void {
  router.push({ name: 'match-detail', params: { id: parentId } })
}

// ─── Shells ──────────────────────────────────────────────────
const notifBadgeCount = computed(() => 0) // notifs non encore branchées (Phase 5)

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
    :items="nav"
    brand-name="BC Aigles"
    brand-sub="Saison 2025/26"
    club-initials="BCA"
    :user-name="auth.displayName"
    :user-role="primaryRoleLabel"
    @nav-select="onNavSelect"
  >
    <CbPageHead
      title="Matchs à pourvoir"
      :subtitle="`${displayedList.length} match${displayedList.length > 1 ? 's' : ''} disponible${displayedList.length > 1 ? 's' : ''} à votre niveau`"
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

    <div v-if="isLoading" class="om-desktop-grid">
      <CbSkel :h="140" />
      <CbSkel :h="140" />
      <CbSkel :h="140" />
    </div>

    <div v-else class="om-desktop-grid">
      <CbEmptyState
        v-if="displayedList.length === 0"
        :icon="BellRing"
        title="Aucun match à pourvoir"
        body="Les prochains matchs apparaîtront ici dès que le club les publiera."
      />
      <CbMatchCard
        v-for="entry in displayedList"
        :key="`${entry.kind}-${entry.parentId}`"
        :date="formatDate(entry.date)"
        :time="entry.startTime"
        :type="matchTypeLabel(entry)"
        :opponent="opponentLabel(entry)"
        :venue="venueLabel(entry)"
        :away="entry.kind === 'away'"
        :staffing="staffingForEntry(entry)"
        :officials="officialsForEntry(entry)"
        style="cursor: pointer"
        @click="openMatchDetail(entry.parentId)"
      />
    </div>
  </CbDesktopShell>

  <!-- Mobile shell (< 1024px) — transcription littérale du JSX O1Mobile ── -->
  <CbMobileShell
    v-else
    title="Matchs à pourvoir"
    club="BCA"
    :notif-badge="notifBadgeCount > 0"
    :tabs="tabs"
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
        v-if="isLoading"
        style="padding: 12px 16px; display: flex; flex-direction: column; gap: 10px"
      >
        <CbSkel :h="120" />
        <CbSkel :h="120" />
        <CbSkel :h="120" />
      </div>

      <CbEmptyState
        v-if="!isLoading && displayedList.length === 0"
        :icon="BellRing"
        title="Aucun match à pourvoir"
        body="Les prochains matchs apparaîtront ici dès que le club les publiera."
      />

      <div
        v-if="!isLoading && displayedList.length > 0"
        style="padding: 12px 16px; display: flex; flex-direction: column; gap: 12px"
      >
        <CbMatchCard
          v-for="entry in displayedList"
          :key="`${entry.kind}-${entry.parentId}`"
          :date="formatDate(entry.date)"
          :time="entry.startTime"
          :type="matchTypeLabel(entry)"
          :opponent="opponentLabel(entry)"
          :venue="venueLabel(entry)"
          :away="entry.kind === 'away'"
          :staffing="staffingForEntry(entry)"
          :officials="officialsForEntry(entry)"
          style="cursor: pointer"
          @click="openMatchDetail(entry.parentId)"
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
