<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { FirebaseError } from 'firebase/app'
import {
  AlertTriangle,
  BellRing,
  ChevronRight,
  Clipboard,
  FileCheck,
} from 'lucide-vue-next'

import CbPill from '@/components/ui/CbPill.vue'
import CbSectionHeader from '@/components/ui/CbSectionHeader.vue'
import {
  listMembersByTeam,
  listRegistrationsToTreat,
  type MockTeam,
} from '@/repositories/mock'
import { useAuthStore } from '@/stores/auth'
import { useLicenseRequestsStore } from '@/stores/licenseRequests'
import { useTeamsStore } from '@/stores/teams'

/**
 * Section Home — bloc coach.
 *
 * Rendue uniquement si `auth.isCoach` (gate dans `Home.vue` — PR-M-C). On
 * peut donc charger sans double-check.
 *
 * Source data (cohérent avec l'état hybride de l'app — cf. mémoire
 * `courtbase_app_firestore_wiring`) :
 *  - `teamsStore.loadForCoach(...)` : **Firestore réel** quand le user a
 *    `userDoc.memberId`, fallback **mock** sinon.
 *  - `licenseRequestsStore.loadPendingReviewForCoach()` : idem hybride
 *    (Firestore avec scope teamIds réels, sinon `MOCK_LICENSE_REQUESTS`).
 *  - `listRegistrationsToTreat()` + `listMembersByTeam(team.id)` :
 *    **mock-only** (pas encore branché Firestore — sera fait dans une PR
 *    dédiée registrations / members).
 *
 * Navigation interne via `router.push({ name })`. Pas d'event vers le parent.
 */

const router = useRouter()
const auth = useAuthStore()
const teamsStore = useTeamsStore()
const licenseRequestsStore = useLicenseRequestsStore()

// ─── Data fetch (idempotent) ─────────────────────────────────────
onMounted(async () => {
  try {
    if (teamsStore.teams.length === 0) {
      await teamsStore.loadForCoach(auth.userDoc?.memberId ?? null, auth.uid)
    }
    await licenseRequestsStore.loadPendingReviewForCoach()
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[home.coach] load failed [${code}]`, err)
  }
})

// ─── Derived ─────────────────────────────────────────────────────
const coachTeams = computed<ReadonlyArray<MockTeam>>(() => teamsStore.teams)

const registrationsToTreatCount = computed(() => listRegistrationsToTreat().length)

const excludedMembersCount = computed(() => {
  const seen = new Set<string>()
  for (const team of coachTeams.value) {
    for (const m of listMembersByTeam(team.id)) {
      if (m.duesStatus === 'excluded') seen.add(m.id)
    }
  }
  return seen.size
})

const licenseReviewsCount = computed(() => licenseRequestsStore.pendingReviewList.length)

function countExcludedInTeam(teamId: string): number {
  return listMembersByTeam(teamId).filter((m) => m.duesStatus === 'excluded').length
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
function openExcluded(): void {
  const first = coachTeams.value[0]
  router.push(first ? { name: 'team-roster', params: { teamId: first.id } } : { name: 'team' })
}
function openLicenseReviews(): void {
  router.push({ name: 'license-reviews' })
}
function openMyAssignments(): void {
  router.push({ name: 'my-assignments' })
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
            <CbPill v-if="countExcludedInTeam(t.id) > 0" tone="rose" dot>
              {{ countExcludedInTeam(t.id) }} exclus
            </CbPill>
          </div>
          <div class="cb-sub home-section__team-sub">
            {{ t.playerIds.length }} joueurs<span v-if="t.nextTraining">
              · prochain training {{ t.nextTraining }}</span>
          </div>
          <div v-if="t.categoryName" class="home-section__team-cat">
            <CbPill tone="violet">{{ t.categoryName }}</CbPill>
          </div>
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
            {{ registrationsToTreatCount }} inscriptions à valider
          </span>
          <span class="home-section__action-sub">à traiter</span>
        </span>
        <ChevronRight :size="18" />
      </button>

      <button
        v-if="excludedMembersCount > 0"
        type="button"
        class="home-section__action-btn home-section__action-btn--rose"
        @click="openExcluded"
      >
        <span class="home-section__action-icon home-section__action-icon--rose">
          <AlertTriangle :size="18" />
        </span>
        <span class="home-section__action-body">
          <span class="home-section__action-title">
            {{ excludedMembersCount }} exclusions à gérer
          </span>
          <span class="home-section__action-sub">à traiter</span>
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

      <button
        v-if="auth.isOfficial"
        type="button"
        class="home-section__action-btn home-section__action-btn--violet"
        @click="openMyAssignments"
      >
        <span class="home-section__action-icon home-section__action-icon--violet">
          <BellRing :size="18" />
        </span>
        <span class="home-section__action-body">
          <span class="home-section__action-title">Mes assignations</span>
          <span class="home-section__action-sub">à confirmer</span>
        </span>
        <ChevronRight :size="18" />
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
