<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { FirebaseError } from 'firebase/app'
import {
  Award,
  Calendar,
  ChevronRight,
  Info,
  MapPin,
  Megaphone,
  ShieldAlert,
} from 'lucide-vue-next'

import CbEmptyState from '@/components/ui/CbEmptyState.vue'
import CbMatchTypeChip from '@/components/ui/CbMatchTypeChip.vue'
import CbPill from '@/components/ui/CbPill.vue'
import CbSectionHeader from '@/components/ui/CbSectionHeader.vue'
import { useActiveSeason } from '@/composables/useSeason'
import { useBookingsStore } from '@/stores/bookings'
import { useOfficialsStore, type OpportunityEntry } from '@/stores/officials'
import { listRequests } from '@/repositories/mock'

/**
 * Section Home — bloc admin (réécrite 2026-05-24, branchée Firestore partielle).
 *
 * Rendue uniquement si `auth.isAdmin` (gate dans `Home.vue` — PR-M-C).
 *
 * Source data :
 *  - **`useOfficialsStore`** (Firestore réel) : `incompleteMatchesCount` —
 *    matchs HOME ou AWAY non staffés à venir (utilisé comme KPI + carte
 *    d'accès Staffing). Et `openOpportunitiesForLevel(1).filter(< 7j)` —
 *    matchs à pourvoir cette semaine (top 5).
 *  - **MOCK** (`listRequests`) : tous les types de "Demandes à traiter"
 *    (licence, payment_exception, match_move). Les workflows admin requests
 *    vivent côté `apps/web` pour MVP — pas de fetch côté courtbase-app.
 *
 * Affichage :
 *  1. KPI staffing court-terme + CTA staffing.
 *  2. Demandes à traiter (MOCK) — encore non branchées Firestore.
 *  3. Matchs à pourvoir cette semaine (Firestore via `useOfficialsStore`).
 *  4. CTA broadcast.
 */

const router = useRouter()
const bookingsStore = useBookingsStore()
const officialsStore = useOfficialsStore()
const seasonStore = useActiveSeason()

const loading = ref(true)

// ─── Mount : hydrate bookings + officials ────────────────────────
onMounted(async () => {
  try {
    await bookingsStore.loadActiveContext()
    const resolvedSeasonId = (await seasonStore.load()) ?? 'mock-season'
    await officialsStore.loadOfficialContext(resolvedSeasonId)
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[home.admin] load failed [${code}]`, err)
  } finally {
    loading.value = false
  }
})

// ─── Derived — Demandes (MOCK) ───────────────────────────────────
const licenseRequestsCount = computed(
  () => listRequests({ kind: 'license', status: 'pending' }).length,
)
const paymentExceptionRequestsCount = computed(
  () => listRequests({ kind: 'payment_exception', status: 'pending' }).length,
)
const matchMoveRequestsCount = computed(
  () => listRequests({ kind: 'match_move', status: 'pending' }).length,
)

// ─── Derived — Staffing (Firestore) ──────────────────────────────

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

const incompleteMatchesCount = computed(() => officialsStore.incompleteMatchesCount)

function opportunityStartMs(o: OpportunityEntry): number {
  const ts = o.date as { seconds?: number; toMillis?: () => number }
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (typeof ts.seconds === 'number') return ts.seconds * 1000
  return 0
}

/**
 * Pour l'admin, on agrège les opportunités sur **tous les niveaux** (1-3 pour
 * HOME et global pour AWAY). Le niveau n'a pas le même sens qu'un officiel
 * individuel — un admin veut voir TOUT ce qui manque, pas seulement son
 * niveau. On boucle de level=1 à level=5 (couvre les niveaux du club) et on
 * dédoublonne par `kind:parentId`.
 */
const allOpenOpportunities = computed<ReadonlyArray<OpportunityEntry>>(() => {
  const seen = new Set<string>()
  const out: OpportunityEntry[] = []
  for (const level of [1, 2, 3, 4, 5]) {
    for (const o of officialsStore.openOpportunitiesForLevel(level)) {
      const key = `${o.kind}:${o.parentId}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(o)
    }
  }
  return out.sort((a, b) => opportunityStartMs(a) - opportunityStartMs(b))
})

const upcomingWeekMatches = computed<ReadonlyArray<OpportunityEntry>>(() => {
  const start = Date.now()
  const cutoff = start + SEVEN_DAYS_MS
  return allOpenOpportunities.value
    .filter((o) => {
      const ms = opportunityStartMs(o)
      return ms >= start && ms <= cutoff
    })
    .slice(0, 5)
})

// ─── Formatage ───────────────────────────────────────────────────
const DATE_FMT = new Intl.DateTimeFormat('fr-CH', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

function fmtDate(ms: number): string {
  if (!ms) return '—'
  const raw = DATE_FMT.format(new Date(ms))
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

function oppOpponent(o: OpportunityEntry): string {
  return o.opponentName ?? 'Adversaire à confirmer'
}

function oppVenue(o: OpportunityEntry): string {
  return o.location ?? (o.kind === 'home' ? 'Salle non attribuée' : 'Adresse à confirmer')
}

function oppSlotsLabel(o: OpportunityEntry): string {
  return o.openSlots > 1 ? `${o.openSlots} slots` : '1 slot'
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
function openMatchDetail(parentId: string): void {
  router.push({ name: 'match-detail', params: { id: parentId } })
}
</script>

<template>
  <section class="home-section">
    <CbSectionHeader title="Admin" />

    <!-- ─── KPI : Staffing court-terme (Firestore) ─────────────── -->
    <button
      v-if="incompleteMatchesCount > 0"
      type="button"
      class="home-section__action-btn home-section__action-btn--rose"
      @click="openStaffing"
    >
      <span class="home-section__action-icon home-section__action-icon--rose">
        <ShieldAlert :size="18" />
      </span>
      <span class="home-section__action-body">
        <span class="home-section__action-title">
          {{ incompleteMatchesCount }} match{{ incompleteMatchesCount > 1 ? 's' : '' }} à staffer
        </span>
        <span class="home-section__action-sub">officiels manquants ou salle non attribuée</span>
      </span>
      <ChevronRight :size="18" />
    </button>

    <!-- ─── Demandes à traiter (MOCK) ──────────────────────────── -->
    <CbSectionHeader title="Demandes à traiter">
      <template #action>
        <CbPill tone="amber" solid>MOCK</CbPill>
      </template>
    </CbSectionHeader>

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
            {{ licenseRequestsCount }} demande{{ licenseRequestsCount > 1 ? 's' : '' }} de licence
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
            {{ paymentExceptionRequestsCount }} exception{{ paymentExceptionRequestsCount > 1 ? 's' : '' }} cotisation
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
            {{ matchMoveRequestsCount }} déplacement{{ matchMoveRequestsCount > 1 ? 's' : '' }} de match
          </span>
          <span class="home-section__action-sub">à traiter</span>
        </span>
        <ChevronRight :size="18" />
      </button>
    </div>

    <!-- ─── Matchs à pourvoir cette semaine (Firestore) ────────── -->
    <CbSectionHeader title="Matchs à pourvoir (semaine)">
      <template #action>
        <a class="home-section__link" @click="openStaffing">Staffing</a>
      </template>
    </CbSectionHeader>

    <CbEmptyState
      v-if="!loading && upcomingWeekMatches.length === 0"
      :icon="Calendar"
      title="Aucun match à staffer cette semaine"
      body="Tout est sous contrôle. Les prochains matchs apparaîtront ici dès qu'un slot s'ouvre."
    />

    <div v-else class="home-section__matches">
      <button
        v-for="o in upcomingWeekMatches"
        :key="`adm-${o.kind}-${o.parentId}`"
        type="button"
        class="cb-card home-section__match-card"
        @click="openMatchDetail(o.parentId)"
      >
        <div class="home-section__match-row">
          <div class="home-section__match-main">
            <div class="home-section__match-when mono">
              {{ fmtDate(opportunityStartMs(o)) }} · {{ o.startTime }}
            </div>
            <div class="home-section__match-opp">vs {{ oppOpponent(o) }}</div>
            <div v-if="o.team?.name" class="cb-sub">{{ o.team.name }}</div>
            <div class="cb-sub home-section__match-venue">
              <MapPin :size="12" /> {{ oppVenue(o) }}
            </div>
          </div>
          <div class="home-section__match-pills">
            <CbPill tone="rose" solid>{{ oppSlotsLabel(o) }}</CbPill>
            <CbPill
              :tone="o.kind === 'home' ? 'emerald' : 'sky'"
              solid
            >
              {{ o.kind === 'home' ? 'Domicile' : 'Extérieur' }}
            </CbPill>
            <CbMatchTypeChip v-if="o.matchType" :type="o.matchType.name" />
          </div>
        </div>
      </button>
    </div>

    <!-- ─── CTA broadcast ──────────────────────────────────────── -->
    <div class="home-section__broadcast">
      <button class="cb-btn primary block" type="button" @click="openBroadcast">
        <Megaphone :size="16" />
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
  display: block;
  width: 100%;
  text-align: left;
  font-family: inherit;
  cursor: pointer;
  padding: 12px;
  border: 1px solid var(--border);
}
.home-section__match-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}
.home-section__match-main {
  flex: 1;
  min-width: 0;
}
.home-section__match-pills {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-end;
  flex-shrink: 0;
}
.home-section__match-when {
  font-weight: 700;
  font-size: 13px;
}
.home-section__match-opp {
  font-weight: 600;
  margin-top: 2px;
}
.home-section__match-venue {
  margin-top: 2px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
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
.home-section__action-btn--rose {
  background: var(--rose-50);
  color: var(--rose-700);
  box-shadow: inset 0 0 0 1px var(--rose-200);
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
.home-section__action-icon--rose {
  background: var(--rose-100);
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
