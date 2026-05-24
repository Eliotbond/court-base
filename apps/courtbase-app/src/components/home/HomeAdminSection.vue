<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  Award,
  Calendar,
  ChevronRight,
  Info,
} from 'lucide-vue-next'

import CbMatchCard from '@/components/ui/CbMatchCard.vue'
import CbSectionHeader from '@/components/ui/CbSectionHeader.vue'
import {
  listAssignmentsForMatch,
  listOpenMatches,
  listRequests,
  type MockMatch,
} from '@/repositories/mock'

/**
 * Section Home — bloc admin.
 *
 * Rendue uniquement si `auth.isAdmin` (gate dans `Home.vue` — PR-M-C).
 *
 * Source data : **mock-only** pour MVP (`listRequests`, `listOpenMatches`).
 * À brancher Firestore dans une PR dédiée (cf. brief `menu-refactor.md`
 * § Data loading scope — `requestsStore.loadPending` +
 * `staffingStore.loadUpcoming`).
 *
 * Pas d'`onMounted` (la couche mock est synchrone). Quand on branchera
 * Firestore, ajouter un `onMounted` avec try/catch FirebaseError.
 */

const router = useRouter()

// ─── Derived ─────────────────────────────────────────────────────
const licenseRequestsCount = computed(
  () => listRequests({ kind: 'license', status: 'pending' }).length,
)
const paymentExceptionRequestsCount = computed(
  () => listRequests({ kind: 'payment_exception', status: 'pending' }).length,
)
const matchMoveRequestsCount = computed(
  () => listRequests({ kind: 'match_move', status: 'pending' }).length,
)

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

const adminOpenHomeMatches = computed<ReadonlyArray<MockMatch>>(() =>
  listOpenMatches()
    .filter((m) => m.kind === 'home')
    .filter((m) => isWithinNextSevenDays(m.date))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5),
)

// ─── Formatage ───────────────────────────────────────────────────
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

function initialsForMember(memberId: string): string {
  const fallback = memberId
    .replace(/^m-/, '')
    .split('-')
    .map((p) => p.charAt(0).toUpperCase())
    .join('')
    .slice(0, 2)
  return fallback || '??'
}

function officialsForMatch(matchId: string): string[] {
  return listAssignmentsForMatch(matchId).slice(0, 4).map((a) => initialsForMember(a.memberId))
}

function filledForMatch(match: MockMatch): number {
  return listAssignmentsForMatch(match.id).length
}

// ─── Navigation ──────────────────────────────────────────────────
function openRequests(kind?: 'license' | 'payment_exception' | 'match_move'): void {
  router.push(kind ? { name: 'requests', query: { kind } } : { name: 'requests' })
}
function openStaffing(): void {
  router.push({ name: 'staffing' })
}
function openBroadcast(): void {
  router.push({ name: 'broadcast' })
}
function openMatchDetail(matchId: string): void {
  router.push({ name: 'match-detail', params: { id: matchId } })
}
</script>

<template>
  <section class="home-section">
    <CbSectionHeader title="Admin" />

    <CbSectionHeader title="Demandes à traiter" />
    <div class="home-section__actions">
      <button
        type="button"
        class="home-section__action-btn home-section__action-btn--violet"
        @click="openRequests('license')"
      >
        <span class="home-section__action-icon home-section__action-icon--violet">
          <Award :size="18" />
        </span>
        <span class="home-section__action-body">
          <span class="home-section__action-title">
            {{ licenseRequestsCount }} demandes de licence
          </span>
          <span class="home-section__action-sub">à traiter</span>
        </span>
        <ChevronRight :size="18" />
      </button>

      <button
        type="button"
        class="home-section__action-btn home-section__action-btn--amber"
        @click="openRequests('payment_exception')"
      >
        <span class="home-section__action-icon home-section__action-icon--amber">
          <Info :size="18" />
        </span>
        <span class="home-section__action-body">
          <span class="home-section__action-title">
            {{ paymentExceptionRequestsCount }} exceptions cotisation
          </span>
          <span class="home-section__action-sub">à traiter</span>
        </span>
        <ChevronRight :size="18" />
      </button>

      <button
        type="button"
        class="home-section__action-btn home-section__action-btn--sky"
        @click="openRequests('match_move')"
      >
        <span class="home-section__action-icon home-section__action-icon--sky">
          <Calendar :size="18" />
        </span>
        <span class="home-section__action-body">
          <span class="home-section__action-title">
            {{ matchMoveRequestsCount }} déplacement de match
          </span>
          <span class="home-section__action-sub">à traiter</span>
        </span>
        <ChevronRight :size="18" />
      </button>
    </div>

    <CbSectionHeader title="Matchs à pourvoir (semaine)">
      <template #action>
        <a class="home-section__link" @click="openStaffing">Staffing</a>
      </template>
    </CbSectionHeader>

    <div class="home-section__matches">
      <CbMatchCard
        v-for="m in adminOpenHomeMatches"
        :key="m.id"
        :date="formatDate(m.date)"
        :time="m.startTime"
        :type="m.matchType"
        :opponent="m.opponent"
        :venue="m.venueLabel"
        :staffing="{ filled: filledForMatch(m), total: m.requiredOfficialsTotal }"
        :officials="officialsForMatch(m.id)"
        class="home-section__match-card"
        @click="openMatchDetail(m.id)"
      />
    </div>

    <div class="home-section__broadcast">
      <button class="cb-btn primary block" type="button" @click="openBroadcast">
        Envoyer une notification
      </button>
    </div>
  </section>
</template>

<style scoped>
.home-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.home-section__link {
  font-size: 12px;
  color: var(--emerald-700);
  font-weight: 600;
  cursor: pointer;
}
.home-section__actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.home-section__matches {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}
@media (min-width: 1024px) {
  .home-section__matches {
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
}
.home-section__match-card {
  cursor: pointer;
}
.home-section__broadcast {
  margin-top: 4px;
}
.home-section__action-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  border: 0;
  padding: 12px 14px;
  border-radius: 12px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}
.home-section__action-btn--amber {
  background: var(--amber-50);
  color: var(--amber-700);
  box-shadow: inset 0 0 0 1px var(--amber-200);
}
.home-section__action-btn--violet {
  background: var(--violet-50);
  color: var(--violet-700);
  box-shadow: inset 0 0 0 1px var(--violet-200);
}
.home-section__action-btn--sky {
  background: var(--sky-50);
  color: var(--sky-700);
  box-shadow: inset 0 0 0 1px var(--sky-200);
}
.home-section__action-icon {
  width: 34px;
  height: 34px;
  border-radius: 17px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.home-section__action-icon--amber {
  background: var(--amber-100);
}
.home-section__action-icon--violet {
  background: var(--violet-100);
}
.home-section__action-icon--sky {
  background: var(--sky-100);
}
.home-section__action-body {
  flex: 1;
  line-height: 1.2;
  display: flex;
  flex-direction: column;
}
.home-section__action-title {
  font-weight: 600;
  font-size: 14px;
}
.home-section__action-sub {
  font-size: 12px;
  opacity: 0.75;
  margin-top: 2px;
}
</style>
