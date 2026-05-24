<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronRight,
  MapPin,
  X as XIcon,
} from 'lucide-vue-next'

import CbBanner from '@/components/ui/CbBanner.vue'
import CbEmptyState from '@/components/ui/CbEmptyState.vue'
import CbMatchTypeChip from '@/components/ui/CbMatchTypeChip.vue'
import CbPill from '@/components/ui/CbPill.vue'
import CbSectionHeader from '@/components/ui/CbSectionHeader.vue'
import { useActiveSeason } from '@/composables/useSeason'
import { useAuthStore } from '@/stores/auth'
import { useBookingsStore } from '@/stores/bookings'
import {
  useOfficialsStore,
  type MyAssignmentEntry,
  type OpportunityEntry,
} from '@/stores/officials'
import { useReplacementsStore } from '@/stores/replacements'

/**
 * Section Home — bloc officiel (réécrite 2026-05-24, branchée Firestore).
 *
 * Rendue uniquement si `auth.isOfficial` (gate dans `Home.vue` — PR-M-C).
 *
 * Source data : **Firestore réel** via `useOfficialsStore` (+ bookings store
 * pour les BookingRow HOME + replacements store pour les demandes reçues).
 * Mode mock en fallback (cohérent avec le pattern hybride apps/courtbase-app
 * — cf. mémoire `courtbase_app_firestore_wiring`).
 *
 * Affichage (du plus urgent au plus contextuel) :
 *  1. Banner amber "Pas de licence officiel active" si applicable.
 *  2. URGENT — opportunités à moins de 3 jours, à mon niveau (encadré rose).
 *  3. Mes prochaines assignations (pending + confirmed, top 3, actions inline).
 *  4. Matchs à pourvoir cette semaine (à mon niveau, top 3).
 *  5. Demandes de remplacement reçues en attente — CTA vers "Mes assignations".
 *
 * Pas de duplication d'actions vers `/assignments` ou `/matches/open` — un
 * simple "Voir tout" sur chaque header. Les vrais workflows (confirm/decline)
 * vivent sur les vues dédiées, ici on a seulement Accept/Decline rapides sur
 * les pending les plus proches.
 */

const router = useRouter()
const auth = useAuthStore()
const bookingsStore = useBookingsStore()
const officialsStore = useOfficialsStore()
const replacementsStore = useReplacementsStore()
const seasonStore = useActiveSeason()

const loading = ref(true)
const submittingId = ref<string | null>(null)

// ─── Mount : hydrate officials + replacements ─────────────────────
onMounted(async () => {
  try {
    await bookingsStore.loadActiveContext()
    const resolvedSeasonId = (await seasonStore.load()) ?? 'mock-season'
    await officialsStore.loadOfficialContext(resolvedSeasonId)
    const memberId = auth.userDoc?.memberId
    if (memberId) {
      await replacementsStore.load(memberId)
    }
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code)
      : 'unknown'
    console.error(`[home.official] load failed [${code}]`, err)
  } finally {
    loading.value = false
  }
})

// ─── Derived ─────────────────────────────────────────────────────

const showNoLicenseBanner = computed(() => !auth.hasActiveOfficialLicense)
const officialLevel = computed<number>(() => auth.officialLevel ?? 1)

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

function tsToMs(
  ts: { seconds?: number; toMillis?: () => number } | null | undefined,
): number {
  if (!ts) return 0
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (typeof ts.seconds === 'number') return ts.seconds * 1000
  return 0
}

function entryStartMs(e: MyAssignmentEntry): number {
  return e.parent.kind === 'home'
    ? e.parent.booking.startMs
    : tsToMs(e.parent.match.date)
}

function opportunityStartMs(o: OpportunityEntry): number {
  return tsToMs(o.date)
}

/** Mes prochaines assignations (pending + confirmed, top 3). */
const myUpcoming = computed<ReadonlyArray<MyAssignmentEntry>>(() => {
  const cutoff = Date.now()
  return [
    ...officialsStore.myAssignments.pending,
    ...officialsStore.myAssignments.confirmed,
  ]
    .filter((e) => entryStartMs(e) >= cutoff)
    .sort((a, b) => entryStartMs(a) - entryStartMs(b))
    .slice(0, 3)
})

/** Index des `kind:parentId` où je suis déjà assigné. */
const myParentIds = computed<Set<string>>(() => {
  const set = new Set<string>()
  for (const list of [
    officialsStore.myAssignments.pending,
    officialsStore.myAssignments.confirmed,
    officialsStore.myAssignments.declined,
  ]) {
    for (const e of list) {
      const id =
        e.parent.kind === 'home' ? e.parent.booking.id : e.parent.match.id
      set.add(`${e.parent.kind}:${id}`)
    }
  }
  return set
})

/** Opportunités URGENT à mon niveau (< 3 jours, hors mes engagements). */
const urgentOpportunities = computed<ReadonlyArray<OpportunityEntry>>(() => {
  const start = Date.now()
  const cutoff = start + THREE_DAYS_MS
  return officialsStore
    .openOpportunitiesForLevel(officialLevel.value)
    .filter((o) => {
      const ms = opportunityStartMs(o)
      if (ms < start || ms > cutoff) return false
      return !myParentIds.value.has(`${o.kind}:${o.parentId}`)
    })
    .slice()
    .sort((a, b) => opportunityStartMs(a) - opportunityStartMs(b))
})

/** Opportunités semaine (3-7 jours, hors URGENT + mes engagements, top 3). */
const weekOpportunities = computed<ReadonlyArray<OpportunityEntry>>(() => {
  const urgentSet = new Set(
    urgentOpportunities.value.map((o) => `${o.kind}:${o.parentId}`),
  )
  const start = Date.now()
  const cutoff = start + SEVEN_DAYS_MS
  return officialsStore
    .openOpportunitiesForLevel(officialLevel.value)
    .filter((o) => {
      const ms = opportunityStartMs(o)
      if (ms < start || ms > cutoff) return false
      const key = `${o.kind}:${o.parentId}`
      if (urgentSet.has(key)) return false
      if (myParentIds.value.has(key)) return false
      return true
    })
    .slice()
    .sort((a, b) => opportunityStartMs(a) - opportunityStartMs(b))
    .slice(0, 3)
})

const incomingReplacementsCount = computed(
  () => replacementsStore.incomingPending.length,
)

// ─── Formatage ────────────────────────────────────────────────────
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

function asgOpponent(e: MyAssignmentEntry): string {
  const raw =
    e.parent.kind === 'home'
      ? e.parent.booking.opponentName
      : e.parent.match.opponentName
  return raw ?? 'Adversaire à confirmer'
}

function asgTime(e: MyAssignmentEntry): string {
  return e.parent.kind === 'home'
    ? e.parent.booking.startTime
    : e.parent.match.startTime
}

function asgVenue(e: MyAssignmentEntry): string {
  if (e.parent.kind === 'home') {
    const b = e.parent.booking
    if (b.venueName && b.courtName) return `${b.venueName} · ${b.courtName}`
    return 'Salle non attribuée'
  }
  return e.parent.match.awayAddress ?? 'Adresse à confirmer'
}

function asgParentId(e: MyAssignmentEntry): string {
  return e.parent.kind === 'home' ? e.parent.booking.id : e.parent.match.id
}

function oppOpponent(o: OpportunityEntry): string {
  return o.opponentName ?? 'Adversaire à confirmer'
}

function oppVenue(o: OpportunityEntry): string {
  return o.location ?? (o.kind === 'home' ? 'Salle non attribuée' : 'Adresse à confirmer')
}

function oppSlotsLabel(o: OpportunityEntry): string {
  return o.openSlots > 1 ? `${o.openSlots} slots manquants` : '1 slot manquant'
}

// ─── Navigation / actions ────────────────────────────────────────
function openMatchesOpen(): void {
  router.push({ name: 'matches-open' })
}
function openMyAssignments(): void {
  router.push({ name: 'my-assignments' })
}
function openMatchDetail(parentId: string): void {
  router.push({ name: 'match-detail', params: { id: parentId } })
}

async function confirmAssignment(e: MyAssignmentEntry): Promise<void> {
  if (submittingId.value !== null) return
  submittingId.value = e.assignment.id
  try {
    await officialsStore.respond({
      kind: e.parent.kind,
      parentId: asgParentId(e),
      assignmentId: e.assignment.id,
      status: 'confirmed',
    })
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code)
      : 'unknown'
    console.error(`[home.official] confirm failed [${code}]`, err)
  } finally {
    submittingId.value = null
  }
}

async function declineAssignment(e: MyAssignmentEntry): Promise<void> {
  if (submittingId.value !== null) return
  submittingId.value = e.assignment.id
  try {
    await officialsStore.respond({
      kind: e.parent.kind,
      parentId: asgParentId(e),
      assignmentId: e.assignment.id,
      status: 'declined',
    })
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code)
      : 'unknown'
    console.error(`[home.official] decline failed [${code}]`, err)
  } finally {
    submittingId.value = null
  }
}
</script>

<template>
  <section class="home-section">
    <CbSectionHeader title="Officiel" />

    <CbBanner v-if="showNoLicenseBanner" tone="amber" title="Pas de licence officiel active">
      <template #icon><AlertTriangle :size="18" /></template>
      L'auto-inscription est bloquée. Contactez votre admin pour la régulariser.
    </CbBanner>

    <!-- ─── URGENT — opportunités à mon niveau à < 3 jours ───────── -->
    <section
      v-if="urgentOpportunities.length > 0"
      class="home-section__urgent"
    >
      <div class="home-section__urgent-header">
        <AlertTriangle :size="16" class="home-section__urgent-icon" />
        <h3 class="home-section__urgent-title">
          URGENT — {{ urgentOpportunities.length }} match{{ urgentOpportunities.length > 1 ? 's' : '' }} sous 3 jours
        </h3>
      </div>
      <button
        v-for="o in urgentOpportunities"
        :key="`urg-${o.kind}-${o.parentId}`"
        type="button"
        class="cb-card home-section__urgent-card"
        @click="openMatchDetail(o.parentId)"
      >
        <div class="home-section__card-row">
          <div class="home-section__card-main">
            <div class="home-section__card-when mono">
              {{ fmtDate(opportunityStartMs(o)) }} · {{ o.startTime }}
            </div>
            <div class="home-section__card-opp">vs {{ oppOpponent(o) }}</div>
            <div v-if="o.team?.name" class="cb-sub">{{ o.team.name }}</div>
            <div class="cb-sub home-section__card-venue">
              <MapPin :size="13" /> {{ oppVenue(o) }}
            </div>
          </div>
          <div class="home-section__card-pills">
            <CbPill tone="rose" solid>{{ oppSlotsLabel(o) }}</CbPill>
            <CbMatchTypeChip v-if="o.matchType" :type="o.matchType.name" />
          </div>
        </div>
      </button>
    </section>

    <!-- ─── Mes prochaines assignations ──────────────────────────── -->
    <CbSectionHeader title="Mes prochaines assignations">
      <template #action>
        <a class="home-section__link" @click="openMyAssignments">Voir tout</a>
      </template>
    </CbSectionHeader>

    <CbEmptyState
      v-if="!loading && myUpcoming.length === 0"
      :icon="CalendarDays"
      title="Aucune assignation à venir"
      body="Inscrivez-vous sur un match à pourvoir pour commencer."
    />

    <div
      v-for="e in myUpcoming"
      :key="`asg-${e.assignment.id}`"
      class="cb-card home-section__assignment"
      role="button"
      tabindex="0"
      @click="openMatchDetail(asgParentId(e))"
      @keydown.enter.prevent="openMatchDetail(asgParentId(e))"
    >
      <div class="home-section__card-row">
        <div class="home-section__card-main">
          <div class="home-section__card-when mono">
            {{ fmtDate(entryStartMs(e)) }} · {{ asgTime(e) }}
          </div>
          <div class="home-section__card-opp">vs {{ asgOpponent(e) }}</div>
          <div v-if="e.team?.name" class="cb-sub">{{ e.team.name }}</div>
          <div class="cb-sub home-section__card-venue">
            <MapPin :size="13" /> {{ asgVenue(e) }}
          </div>
        </div>
        <div class="home-section__card-pills">
          <CbPill
            :tone="e.assignment.status === 'pending' ? 'amber' : 'emerald'"
            dot
          >
            {{ e.assignment.status === 'pending' ? 'En attente' : 'Confirmé' }}
          </CbPill>
          <CbPill
            :tone="e.parent.kind === 'home' ? 'emerald' : 'sky'"
            solid
          >
            {{ e.parent.kind === 'home' ? 'Domicile' : 'Extérieur' }}
          </CbPill>
        </div>
      </div>

      <!-- Actions inline si pending ─────────────────────────────── -->
      <div
        v-if="e.assignment.status === 'pending'"
        class="home-section__actions-row"
        @click.stop
      >
        <button
          type="button"
          class="cb-btn outline danger sm"
          :disabled="submittingId === e.assignment.id"
          @click.stop="declineAssignment(e)"
        >
          <XIcon :size="14" />
          Décliner
        </button>
        <button
          type="button"
          class="cb-btn primary sm"
          :disabled="submittingId === e.assignment.id"
          @click.stop="confirmAssignment(e)"
        >
          <Check :size="14" />
          Confirmer
        </button>
      </div>
    </div>

    <!-- ─── Matchs à pourvoir cette semaine ──────────────────────── -->
    <CbSectionHeader title="Matchs à pourvoir cette semaine">
      <template #action>
        <a class="home-section__link" @click="openMatchesOpen">Voir tous</a>
      </template>
    </CbSectionHeader>

    <p
      v-if="!loading && weekOpportunities.length === 0"
      class="home-section__empty-inline"
    >
      Aucun match à pourvoir cette semaine.
    </p>

    <button
      v-for="o in weekOpportunities"
      :key="`wk-${o.kind}-${o.parentId}`"
      type="button"
      class="cb-card home-section__week-card"
      @click="openMatchDetail(o.parentId)"
    >
      <div class="home-section__card-row">
        <div class="home-section__card-main">
          <div class="home-section__card-when mono">
            {{ fmtDate(opportunityStartMs(o)) }} · {{ o.startTime }}
          </div>
          <div class="home-section__card-opp">vs {{ oppOpponent(o) }}</div>
          <div v-if="o.team?.name" class="cb-sub">{{ o.team.name }}</div>
          <div class="cb-sub home-section__card-venue">
            <MapPin :size="13" /> {{ oppVenue(o) }}
          </div>
        </div>
        <div class="home-section__card-pills">
          <CbPill tone="rose" dot>{{ oppSlotsLabel(o) }}</CbPill>
          <CbMatchTypeChip v-if="o.matchType" :type="o.matchType.name" />
        </div>
      </div>
    </button>

    <!-- ─── Demandes de remplacement reçues ──────────────────────── -->
    <button
      v-if="incomingReplacementsCount > 0"
      type="button"
      class="home-section__action-btn home-section__action-btn--violet"
      @click="openMyAssignments"
    >
      <span class="home-section__action-icon home-section__action-icon--violet">
        <AlertTriangle :size="18" />
      </span>
      <span class="home-section__action-body">
        <span class="home-section__action-title">
          {{ incomingReplacementsCount }} demande{{ incomingReplacementsCount > 1 ? 's' : '' }} de remplacement
        </span>
        <span class="home-section__action-sub">à examiner</span>
      </span>
      <ChevronRight :size="18" />
    </button>
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

/* ─── URGENT ─────────────────────────────────────────────────── */
.home-section__urgent {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px 14px;
  border-radius: 12px;
  border: 1px solid var(--rose-200, #fecdd3);
  background: rgba(244, 63, 94, 0.04);
}
.home-section__urgent-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.home-section__urgent-icon {
  color: var(--rose-600, #e11d48);
}
.home-section__urgent-title {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--rose-700, #be123c);
}
.home-section__urgent-card {
  display: block;
  width: 100%;
  text-align: left;
  font-family: inherit;
  cursor: pointer;
  padding: 12px;
  border: 2px solid var(--rose-500, #f43f5e);
  background: var(--rose-50, #fff1f2);
  box-shadow: 0 4px 14px rgba(244, 63, 94, 0.18);
}

/* ─── Assignations + Semaine cards ───────────────────────────── */
.home-section__assignment,
.home-section__week-card {
  display: block;
  width: 100%;
  text-align: left;
  font-family: inherit;
  cursor: pointer;
  padding: 12px;
  border: 1px solid var(--border);
}

.home-section__card-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}
.home-section__card-main {
  flex: 1;
  min-width: 0;
}
.home-section__card-pills {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-end;
  flex-shrink: 0;
}
.home-section__card-when {
  font-weight: 700;
  font-size: 13px;
}
.home-section__card-opp {
  font-weight: 600;
  margin-top: 2px;
}
.home-section__card-venue {
  margin-top: 2px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.home-section__actions-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

.home-section__empty-inline {
  margin: 6px 4px 4px;
  font-size: 13px;
  color: var(--text-subtle);
}

/* ─── Action button — replacements ────────────────────────── */
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
.home-section__action-btn--violet {
  background: var(--violet-50);
  color: var(--violet-700);
  box-shadow: inset 0 0 0 1px var(--violet-200);
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
.home-section__action-icon--violet {
  background: var(--violet-100);
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
