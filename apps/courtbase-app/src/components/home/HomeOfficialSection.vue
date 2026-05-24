<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertTriangle,
  CalendarPlus,
  CheckCircle2,
  MapPin,
  XCircle,
} from 'lucide-vue-next'

import CbBanner from '@/components/ui/CbBanner.vue'
import CbMatchCard from '@/components/ui/CbMatchCard.vue'
import CbMatchTypeChip from '@/components/ui/CbMatchTypeChip.vue'
import CbPill from '@/components/ui/CbPill.vue'
import CbSectionHeader from '@/components/ui/CbSectionHeader.vue'
import {
  listAssignmentsForMatch,
  listMyAssignments,
  listOpenMatches,
  logMockAction,
  type MockMatch,
} from '@/repositories/mock'
import { useAuthStore } from '@/stores/auth'

/**
 * Section Home — bloc officiel.
 *
 * Rendue uniquement si `auth.isOfficial` (gate dans `Home.vue` — PR-M-C).
 *
 * Source data : **mock-only** pour MVP (matchs ouverts + mes assignations
 * lus depuis `MOCK_MATCHES` / `MOCK_ASSIGNMENTS`). À brancher Firestore
 * dans une PR dédiée `assignmentsStore.loadForOfficial(...)` (cf. brief
 * `menu-refactor.md` § Data loading scope).
 *
 * Banner "Pas de licence officiel active" affiché si
 * `!auth.hasActiveOfficialLicense`.
 *
 * Pas d'`onMounted` (la couche mock est synchrone). Quand on branchera
 * Firestore, ajouter un `onMounted` avec try/catch FirebaseError.
 */

const router = useRouter()
const auth = useAuthStore()

// ─── Derived ─────────────────────────────────────────────────────
const showNoLicenseBanner = computed(() => !auth.hasActiveOfficialLicense)

const openMatchesForLevel = computed<ReadonlyArray<MockMatch>>(() => {
  const base = listOpenMatches(auth.officialLevel)
  return [...base].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3)
})

const myAssignments = computed(() => {
  const memberId = auth.linkedMember?.id ?? ''
  if (!memberId) return []
  const allMatches = listOpenMatches()
  return listMyAssignments(memberId)
    .filter((a) => a.status === 'pending' || a.status === 'confirmed')
    .map((a) => ({ ...a, match: allMatches.find((m) => m.id === a.matchId) ?? null }))
    .sort((a, b) => (a.match?.date ?? '9999').localeCompare(b.match?.date ?? '9999'))
    .slice(0, 3)
})

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

// ─── Navigation / actions ────────────────────────────────────────
function openMatchDetail(matchId: string): void {
  router.push({ name: 'match-detail', params: { id: matchId } })
}
function openMatchesOpen(): void {
  router.push({ name: 'matches-open' })
}
function confirmAssignment(assignmentId: string): void {
  logMockAction('home.assignment-confirm', { assignmentId })
}
function declineAssignment(assignmentId: string): void {
  logMockAction('home.assignment-decline', { assignmentId })
}
function addToCalendar(assignmentId: string): void {
  logMockAction('home.assignment-add-to-calendar', { assignmentId })
}
</script>

<template>
  <section class="home-section">
    <CbSectionHeader title="Officiel" />

    <CbBanner v-if="showNoLicenseBanner" tone="amber" title="Pas de licence officiel active">
      <template #icon><AlertTriangle :size="18" /></template>
      L'auto-inscription est bloquée. Contactez votre admin pour la régulariser.
    </CbBanner>

    <!-- Matchs à pourvoir -->
    <CbSectionHeader title="Matchs à pourvoir">
      <template #action>
        <a class="home-section__link" @click="openMatchesOpen">Voir tous</a>
      </template>
    </CbSectionHeader>

    <div class="home-section__matches">
      <CbMatchCard
        v-for="m in openMatchesForLevel"
        :key="m.id"
        :date="formatDate(m.date)"
        :time="m.startTime"
        :type="m.matchType"
        :opponent="m.opponent"
        :venue="m.venueLabel"
        :away="m.kind === 'away'"
        :staffing="{ filled: filledForMatch(m), total: m.requiredOfficialsTotal }"
        :officials="officialsForMatch(m.id)"
        class="home-section__match-card"
        @click="openMatchDetail(m.id)"
      />
    </div>

    <!-- Mes assignations -->
    <CbSectionHeader title="Mes assignations à venir" />

    <div
      v-for="a in myAssignments"
      :key="a.id"
      class="cb-match home-section__assignment"
    >
      <div class="top">
        <div>
          <div class="date">
            {{ a.match ? formatDate(a.match.date) : '—' }}<span class="time">{{ a.match?.startTime ?? '—' }}</span>
          </div>
          <div class="vs home-section__assignment-vs">
            {{ a.match?.opponent ?? 'Match inconnu' }}
          </div>
          <div v-if="a.match" class="home-section__assignment-meta">
            <CbMatchTypeChip :type="a.match.matchType" />
          </div>
          <div class="venue home-section__assignment-venue">
            <MapPin :size="14" color="var(--slate-400)" />
            {{ a.match?.venueLabel ?? '—' }}
          </div>
        </div>
        <CbPill :tone="a.status === 'confirmed' ? 'emerald' : 'amber'" dot>
          {{ a.status === 'confirmed' ? 'Confirmé' : 'Pending' }}
        </CbPill>
      </div>

      <div
        v-if="a.status === 'pending'"
        class="home-section__assignment-actions"
      >
        <button class="cb-btn outline sm" type="button" @click="declineAssignment(a.id)">
          <XCircle :size="14" />
          Décliner
        </button>
        <button class="cb-btn primary sm" type="button" @click="confirmAssignment(a.id)">
          <CheckCircle2 :size="14" />
          Confirmer
        </button>
      </div>
      <div v-else class="home-section__assignment-cal">
        <button class="cb-btn ghost sm" type="button" @click="addToCalendar(a.id)">
          <CalendarPlus :size="14" />
          Ajouter au calendrier
        </button>
      </div>
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
.home-section__assignment {
  padding: 14px;
}
.home-section__assignment-vs {
  margin-top: 4px;
}
.home-section__assignment-meta {
  margin-top: 6px;
}
.home-section__assignment-venue {
  margin-top: 6px;
}
.home-section__assignment-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 8px;
}
.home-section__assignment-cal {
  display: flex;
  gap: 6px;
  padding: 12px 0 0;
  border-top: 1px solid var(--border);
}
</style>
