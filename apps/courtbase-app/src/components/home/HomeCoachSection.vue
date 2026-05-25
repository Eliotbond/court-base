<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { FirebaseError } from 'firebase/app'
import {
  CalendarDays,
  ChevronRight,
  Clipboard,
  FileCheck,
  MapPin,
} from 'lucide-vue-next'

import CbPill from '@/components/ui/CbPill.vue'
import CbSectionHeader from '@/components/ui/CbSectionHeader.vue'
import type { MockTeam } from '@/repositories/mock'
import { useAuthStore } from '@/stores/auth'
import { useBookingsStore, type BookingRow } from '@/stores/bookings'
import { useLicenseRequestsStore } from '@/stores/licenseRequests'
import { useRegistrationsStore } from '@/stores/registrations'
import { useTeamsStore } from '@/stores/teams'

/**
 * Section Home — bloc coach (Firestore réel via stores Pinia, fallback mock
 * pour le dev local).
 *
 * Rendue uniquement si `auth.isCoach` (gate dans `Home.vue` — PR-M-C).
 *
 * Source data :
 *  - `teamsStore.loadForCoach(...)` : équipes coachées.
 *  - `registrationsStore.load(teamIds)` : compte du bucket `actionable`
 *    (demandes + essais en cours).
 *  - `licenseRequestsStore.loadPendingReviewForCoach()` : demandes de licence
 *    en attente de validation coach.
 *  - `bookingsStore.loadActiveContext()` : prochain rendez-vous par équipe.
 *
 * Affichage :
 *  1. Cards par équipe (nom + catégorie + prochain rendez-vous).
 *  2. "À traiter" : inscriptions actionables + licences à valider.
 */

const router = useRouter()
const auth = useAuthStore()
const bookingsStore = useBookingsStore()
const teamsStore = useTeamsStore()
const licenseRequestsStore = useLicenseRequestsStore()
const registrationsStore = useRegistrationsStore()

// ─── Data fetch (idempotent) ─────────────────────────────────────
onMounted(async () => {
  try {
    if (teamsStore.teams.length === 0) {
      await teamsStore.loadForCoach(auth.userDoc?.memberId ?? null, auth.uid)
    }
    const teamIds = teamsStore.teams.map((t) => t.id)
    // Lance les trois fetchs en parallèle — ils sont indépendants.
    await Promise.all([
      bookingsStore.loadActiveContext(),
      registrationsStore.load(teamIds),
      licenseRequestsStore.loadPendingReviewForCoach(),
    ])
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[home.coach] load failed [${code}]`, err)
  }
})

// ─── Derived ─────────────────────────────────────────────────────
const coachTeams = computed<ReadonlyArray<MockTeam>>(() => teamsStore.teams)

/** Compte des registrations "actionables" (demandes + essais en cours). */
const registrationsToTreatCount = computed(
  () => registrationsStore.counts.actionable,
)

const licenseReviewsCount = computed(() => licenseRequestsStore.pendingReviewList.length)

// ─── Prochain rendez-vous par équipe (Firestore réel) ────────────

/** Prochain booking (training | match_home | match_away) à venir pour une équipe. */
function nextBookingForTeam(teamId: string): BookingRow | null {
  const now = Date.now()
  // bookingsForTeam filtre déjà par teamId — pas besoin de re-filtrer.
  const upcoming = bookingsStore
    .bookingsForTeam(teamId)
    .filter((b) => b.startMs >= now && b.status !== 'cancelled')
    .sort((a, b) => a.startMs - b.startMs)
  return upcoming[0] ?? null
}

const DATE_FMT = new Intl.DateTimeFormat('fr-CH', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

function fmtNextLabel(b: BookingRow | null): string {
  if (!b) return ''
  const raw = DATE_FMT.format(new Date(b.startMs))
  const label = raw.charAt(0).toUpperCase() + raw.slice(1)
  return `${label} · ${b.startTime}`
}

function nextKindLabel(b: BookingRow | null): string {
  if (!b) return ''
  switch (b.slotType) {
    case 'training':
      return 'Entraînement'
    case 'match_home':
      return 'Match domicile'
    case 'match_away':
      return 'Match extérieur'
    case 'reserve':
      return 'Réserve'
    case 'custom':
      return 'Autre'
    default:
      return ''
  }
}

function nextPillTone(b: BookingRow | null): 'sky' | 'emerald' | 'violet' | 'slate' {
  if (!b) return 'slate'
  switch (b.slotType) {
    case 'training':
      return 'sky'
    case 'match_home':
      return 'emerald'
    case 'match_away':
      return 'violet'
    default:
      return 'slate'
  }
}

// ─── Navigation ──────────────────────────────────────────────────
function openTeam(teamId: string): void {
  router.push({ name: 'team-roster', params: { teamId } })
}
function openTeams(): void {
  router.push({ name: 'team' })
}
function openRegistrations(): void {
  router.push({ name: 'registrations' })
}
function openLicenseReviews(): void {
  router.push({ name: 'license-reviews' })
}
</script>

<template>
  <section class="home-section">
    <CbSectionHeader title="Coach" />

    <!-- Mes équipes -->
    <CbSectionHeader title="Mes équipes">
      <template #action>
        <a class="home-section__link" @click="openTeams">Voir tout</a>
      </template>
    </CbSectionHeader>

    <div v-if="coachTeams.length > 0" class="home-section__teams">
      <button
        v-for="t in coachTeams"
        :key="t.id"
        type="button"
        class="home-section__team-btn"
        @click="openTeam(t.id)"
      >
        <div class="cb-card home-section__team-card">
          <div class="home-section__team-head">
            <div class="home-section__team-title">
              <div class="cb-h3">{{ t.name }}</div>
              <CbPill v-if="t.tagName" tone="slate">{{ t.tagName }}</CbPill>
            </div>
          </div>
          <div class="cb-sub home-section__team-sub">
            {{ t.playerIds.length }} joueurs
          </div>
          <div v-if="t.categoryName" class="home-section__team-cat">
            <CbPill tone="violet">{{ t.categoryName }}</CbPill>
          </div>

          <!-- Prochain rendez-vous (Firestore) ─────────────────── -->
          <template v-if="nextBookingForTeam(t.id)">
            <div class="home-section__team-next">
              <CbPill :tone="nextPillTone(nextBookingForTeam(t.id))" dot>
                {{ nextKindLabel(nextBookingForTeam(t.id)) }}
              </CbPill>
              <div class="home-section__team-next-when mono">
                {{ fmtNextLabel(nextBookingForTeam(t.id)) }}
              </div>
              <div
                v-if="nextBookingForTeam(t.id)?.opponentName"
                class="home-section__team-next-opp"
              >
                vs {{ nextBookingForTeam(t.id)?.opponentName }}
              </div>
              <div
                v-if="nextBookingForTeam(t.id)?.venueName"
                class="cb-sub home-section__team-next-venue"
              >
                <MapPin :size="12" /> {{ nextBookingForTeam(t.id)?.venueName }}
              </div>
            </div>
          </template>
        </div>
      </button>
    </div>

    <!-- À traiter -->
    <CbSectionHeader title="À traiter" />
    <div class="home-section__actions">
      <button
        v-if="registrationsToTreatCount > 0"
        type="button"
        class="home-section__action-btn home-section__action-btn--amber"
        @click="openRegistrations"
      >
        <span class="home-section__action-icon home-section__action-icon--amber">
          <Clipboard :size="18" />
        </span>
        <span class="home-section__action-body">
          <span class="home-section__action-title">
            {{ registrationsToTreatCount }} inscription{{ registrationsToTreatCount > 1 ? 's' : '' }} à valider
          </span>
          <span class="home-section__action-sub">demandes + essais en cours</span>
        </span>
        <ChevronRight :size="18" />
      </button>

      <button
        v-if="licenseReviewsCount > 0"
        type="button"
        class="home-section__action-btn home-section__action-btn--violet"
        @click="openLicenseReviews"
      >
        <span class="home-section__action-icon home-section__action-icon--violet">
          <FileCheck :size="18" />
        </span>
        <span class="home-section__action-body">
          <span class="home-section__action-title">
            {{ licenseReviewsCount }} demande{{ licenseReviewsCount > 1 ? 's' : '' }}
            de licence à valider
          </span>
          <span class="home-section__action-sub">documents soumis par les parents</span>
        </span>
        <ChevronRight :size="18" />
      </button>

      <!-- Empty state inline si aucune action ──────────────────── -->
      <div
        v-if="registrationsToTreatCount === 0 && licenseReviewsCount === 0"
        class="home-section__empty-inline"
      >
        <CalendarDays :size="14" />
        Aucune action en attente pour vos équipes.
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
.home-section__teams {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}
@media (min-width: 1024px) {
  .home-section__teams {
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
}
.home-section__team-btn {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  padding: 0;
  cursor: pointer;
  font-family: inherit;
}
.home-section__team-card {
  position: relative;
  padding: 14px;
}
.home-section__team-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: flex-start;
}
.home-section__team-title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.home-section__team-sub {
  margin-top: 4px;
}
.home-section__team-cat {
  margin-top: 8px;
}
.home-section__team-next {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.home-section__team-next-when {
  font-weight: 700;
  font-size: 13px;
}
.home-section__team-next-opp {
  font-weight: 600;
  font-size: 13px;
}
.home-section__team-next-venue {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.home-section__actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
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
.home-section__action-body {
  flex: 1;
  line-height: 1.2;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.home-section__action-title {
  font-weight: 600;
  font-size: 14px;
}
.home-section__action-sub {
  font-size: 12px;
  opacity: 0.75;
  margin-top: 2px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.home-section__empty-inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 12px;
  font-size: 13px;
  color: var(--text-subtle);
  border: 1px dashed var(--border);
  border-radius: 10px;
}
</style>
