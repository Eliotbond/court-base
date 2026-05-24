<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Inbox } from 'lucide-vue-next'

import CbDesktopShell from '@/components/ui/CbDesktopShell.vue'
import CbEmptyState from '@/components/ui/CbEmptyState.vue'
import CbMatchCard from '@/components/ui/CbMatchCard.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbPageHead from '@/components/ui/CbPageHead.vue'
import { useShellNav } from '@/composables/useShellNav'
import { useViewport } from '@/composables/useViewport'
import {
  countUnread,
  getMember,
  listAssignmentsForMatch,
  listMatches,
  logMockAction,
  type MockMatch,
} from '@/repositories/mock'
import { useAuthStore } from '@/stores/auth'

/**
 * A1 — Staffing officiels (admin, cross-club).
 *
 * Vue d'override admin : liste tous les matchs du club, ratio staffing X/Y
 * dérivé de `listAssignmentsForMatch().length` vs `match.requiredOfficialsTotal`.
 *
 * Filtres chips :
 * - `open`   : staffing incomplet (default). Le compteur du chip reflète le
 *              nombre de matchs incomplets sur l'ensemble du club.
 * - `all`    : tous les matchs.
 * - `week`   : matchs dans les 7 jours à partir de la `TODAY` pivot mock.
 * - `month`  : matchs dans les 31 jours à partir de la `TODAY` pivot mock.
 *
 * Date pivot : le seed mock vit en oct./nov. 2025. Pour rendre tous les
 * matchs visibles dans le filtre "Cette semaine", on fige la date courante
 * sur `TODAY = 2025-10-15` (à supprimer quand on branchera Firestore — on
 * utilisera `new Date()`).
 *
 * Tap card → `staffing-detail` (A2).
 *
 * Limitations connues :
 * - Mutations désactivées (mock pur), pas de quick-action "Notifier" depuis
 *   la liste — tout passe par le détail (A2).
 * - Pas de filtre par type de match (CSJC / AFBB) — l'artboard desktop le
 *   prévoit mais le brief A1 § 5 ne le mentionne pas, donc différé.
 * - Pas de loading state (skeleton) ici : les données sont synchrones côté
 *   mock. À recâbler en `<CbSkel>` quand on passera sur des repos async.
 */

const router = useRouter()
const auth = useAuthStore()
const { isDesktop } = useViewport()
const { tabs, nav, primaryRoleLabel } = useShellNav()

/** Date pivot mock — cf. docstring. Toutes les comparaisons de fenêtre la
 * prennent comme "today". */
const TODAY = new Date(2025, 9, 15) // mois 0-indexé → octobre = 9

// ─── Filtres ──────────────────────────────────────────────────
type FilterKind = 'open' | 'all' | 'week' | 'month'

const filters: ReadonlyArray<{ id: FilterKind; label: string }> = [
  { id: 'open', label: 'À pourvoir' },
  { id: 'all', label: 'Tous les matchs' },
  { id: 'week', label: 'Cette semaine' },
  { id: 'month', label: 'Mois' },
]
const activeFilter = ref<FilterKind>('open')

function setFilter(id: FilterKind): void {
  if (activeFilter.value === id) return
  activeFilter.value = id
  logMockAction('staffing.filter-changed', { filter: id })
}

// ─── Helpers staffing ─────────────────────────────────────────
function filledFor(match: MockMatch): number {
  return listAssignmentsForMatch(match.id).length
}

function isComplete(match: MockMatch): boolean {
  return filledFor(match) >= match.requiredOfficialsTotal
}

// ─── Helpers fenêtre temporelle ───────────────────────────────
function parseIsoDate(iso: string): Date {
  const parts = iso.split('-')
  const y = Number(parts[0] ?? '1970')
  const m = Number(parts[1] ?? '1')
  const d = Number(parts[2] ?? '1')
  return new Date(y, m - 1, d)
}

function isWithinDays(iso: string, days: number): boolean {
  const target = parseIsoDate(iso)
  const horizon = new Date(TODAY)
  horizon.setDate(horizon.getDate() + days)
  return target >= TODAY && target <= horizon
}

// ─── Liste filtrée ────────────────────────────────────────────
const allMatches = computed<ReadonlyArray<MockMatch>>(() => listMatches())

const openCount = computed(() => allMatches.value.filter((m) => !isComplete(m)).length)

const visibleMatches = computed<ReadonlyArray<MockMatch>>(() => {
  return allMatches.value
    .filter((m) => {
      switch (activeFilter.value) {
        case 'open':
          return !isComplete(m)
        case 'week':
          return isWithinDays(m.date, 7)
        case 'month':
          return isWithinDays(m.date, 31)
        default:
          return true
      }
    })
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
})

// ─── Formatage date FR ───────────────────────────────────────
const dateFormatter = new Intl.DateTimeFormat('fr-CH', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

function formatDate(iso: string): string {
  const raw = dateFormatter.format(parseIsoDate(iso))
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

// ─── Initiales officiels (max 4) ─────────────────────────────
function initialsForMember(memberId: string): string {
  const member = getMember(memberId)
  if (!member) {
    // Officiels mock externes (`m-other-official-N`) — fallback initiales
    // depuis le slug.
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

// ─── Navigation ──────────────────────────────────────────────
function openStaffingDetail(matchId: string): void {
  router.push({ name: 'staffing-detail', params: { matchId } })
}

function onNotifClick(): void {
  router.push({ name: 'notifications' })
}

// ─── Shell (badge cloche header) ──────────────────────────────
const notifBadgeCount = computed(() => countUnread())

// ─── Sous-titre desktop ──────────────────────────────────────
const desktopSubtitle = computed(() => {
  const total = allMatches.value.length
  const open = openCount.value
  return `${open} match${open > 1 ? 's' : ''} à pourvoir / ${total} total`
})
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
  >
    <CbPageHead title="Staffing officiels" :subtitle="desktopSubtitle" />

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
        <span v-if="f.id === 'open'" style="margin-left: 4px; opacity: 0.7">· {{ openCount }}</span>
      </button>
    </div>

    <div class="staffing-desktop-grid">
      <CbEmptyState
        v-if="visibleMatches.length === 0"
        :icon="Inbox"
        title="Aucun match dans cette catégorie"
        body="Ajustez les filtres pour voir d'autres matchs du club."
      />
      <CbMatchCard
        v-for="m in visibleMatches"
        :key="m.id"
        :date="formatDate(m.date)"
        :time="m.startTime"
        :type="m.matchType"
        :opponent="m.opponent"
        :venue="m.venueLabel"
        :away="m.kind === 'away'"
        :staffing="{
          filled: filledFor(m),
          total: m.requiredOfficialsTotal,
          complete: isComplete(m),
        }"
        :officials="officialsForMatch(m.id)"
        style="cursor: pointer"
        @click="openStaffingDetail(m.id)"
      />
    </div>
  </CbDesktopShell>

  <!-- Mobile shell (< 1024px) ────────────────────────────────── -->
  <CbMobileShell
    v-else
    title="Staffing officiels"
    club="BCA"
    :notif-badge="notifBadgeCount > 0"
    :tabs="tabs"
    @notif-click="onNotifClick"
  >
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
        <span v-if="f.id === 'open'" style="margin-left: 4px; opacity: 0.7">· {{ openCount }}</span>
      </button>
    </div>

    <div v-if="visibleMatches.length === 0" style="padding: 24px 16px">
      <CbEmptyState
        :icon="Inbox"
        title="Aucun match dans cette catégorie"
        body="Ajustez les filtres pour voir d'autres matchs du club."
      />
    </div>

    <div v-else class="staffing-mobile-list">
      <CbMatchCard
        v-for="m in visibleMatches"
        :key="m.id"
        :date="formatDate(m.date)"
        :time="m.startTime"
        :type="m.matchType"
        :opponent="m.opponent"
        :venue="m.venueLabel"
        :away="m.kind === 'away'"
        :staffing="{
          filled: filledFor(m),
          total: m.requiredOfficialsTotal,
          complete: isComplete(m),
        }"
        :officials="officialsForMatch(m.id)"
        style="cursor: pointer"
        @click="openStaffingDetail(m.id)"
      />
    </div>
  </CbMobileShell>
</template>

<style scoped>
.staffing-mobile-list {
  padding: 12px 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.staffing-desktop-grid {
  padding: 20px 28px 32px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}
</style>
