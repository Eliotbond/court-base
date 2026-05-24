<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { FirebaseError } from 'firebase/app'
import {
  CalendarDays,
  ChevronRight,
  MapPin,
  Receipt,
} from 'lucide-vue-next'

import CbEmptyState from '@/components/ui/CbEmptyState.vue'
import CbPill from '@/components/ui/CbPill.vue'
import CbSectionHeader from '@/components/ui/CbSectionHeader.vue'
import { useBookingsStore, type BookingRow } from '@/stores/bookings'
import { useMyProfileStore } from '@/stores/myProfile'

/**
 * Section Home — bloc joueur (réécrite 2026-05-24, branchée Firestore partielle).
 *
 * Rendue uniquement si le user porte le rôle `player` (gate dans `Home.vue`).
 *
 * Source data :
 *  - **`useMyProfileStore`** (Firestore réel) : `member` + `teams` du joueur.
 *  - **`useBookingsStore`** (Firestore réel) : `bookingsForTeam(teamId)` pour
 *    chaque team du joueur, filtré côté JS pour les prochains événements à
 *    venir. Top 3 affichés.
 *  - **MOCK** : "Mes cotisations" (pas de store /dues côté courtbase-app).
 *  - **MOCK** : état de ma licence (pas encore exposé côté courtbase-app —
 *    la pill licence s'affiche depuis `member.licenseNumber` quand présent).
 *
 * Affichage :
 *  1. Prochains rendez-vous (max 3) — Firestore réel via bookings store.
 *  2. État licence (depuis member, pill emerald si licenseNumber présent).
 *  3. CTA Mes cotisations — MOCK.
 */

const router = useRouter()
const bookingsStore = useBookingsStore()
const myProfile = useMyProfileStore()

// ─── Mount : hydrate profile + bookings ──────────────────────────
onMounted(async () => {
  try {
    await Promise.all([
      myProfile.load(),
      bookingsStore.loadActiveContext(),
    ])
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[home.player] load failed [${code}]`, err)
  }
})

// ─── Derived ─────────────────────────────────────────────────────

const myTeamIds = computed<ReadonlyArray<string>>(() =>
  myProfile.teams.map((t) => t.id),
)

/** Prochains 3 événements à venir pour les équipes du joueur. */
const upcomingForMe = computed<ReadonlyArray<BookingRow>>(() => {
  if (myTeamIds.value.length === 0) return []
  const now = Date.now()
  const all: BookingRow[] = []
  for (const teamId of myTeamIds.value) {
    for (const b of bookingsStore.bookingsForTeam(teamId)) {
      if (b.startMs < now) continue
      if (b.status === 'cancelled') continue
      all.push(b)
    }
  }
  // Dédoublonner par id (un coach peut être dans plusieurs équipes — pas
  // notre cas joueur, mais defensive).
  const seen = new Set<string>()
  const dedup = all.filter((b) => {
    if (seen.has(b.id)) return false
    seen.add(b.id)
    return true
  })
  return dedup.sort((a, b) => a.startMs - b.startMs).slice(0, 3)
})

const hasLicense = computed(() => Boolean(myProfile.member?.licenseNumber))

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

function kindLabel(b: BookingRow): string {
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

function kindTone(b: BookingRow): 'sky' | 'emerald' | 'violet' | 'slate' {
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

function venueLabel(b: BookingRow): string {
  if (b.venueName && b.courtName) return `${b.venueName} · ${b.courtName}`
  if (b.venueName) return b.venueName
  return 'Salle à confirmer'
}

// ─── Navigation ──────────────────────────────────────────────────
function openAgenda(): void {
  // Le joueur arrive sur "Mon calendrier" (vue personnelle) plutôt que sur
  // l'Agenda club-wide (réservé aux coachs/admins).
  router.push({ name: 'my-calendar' })
}
function openProfile(): void {
  router.push({ name: 'profile-settings' })
}
</script>

<template>
  <section class="home-section">
    <CbSectionHeader title="Joueur" />

    <!-- ─── Prochains rendez-vous (Firestore) ──────────────────── -->
    <CbSectionHeader title="Mes prochains rendez-vous">
      <template #action>
        <a class="home-section__link" @click="openAgenda">Agenda</a>
      </template>
    </CbSectionHeader>

    <CbEmptyState
      v-if="upcomingForMe.length === 0"
      :icon="CalendarDays"
      title="Aucun rendez-vous à venir"
      body="Les entraînements et matchs de vos équipes apparaîtront ici."
    />

    <div
      v-for="b in upcomingForMe"
      :key="b.id"
      class="cb-card home-section__event"
      role="button"
      tabindex="0"
      @click="openAgenda"
      @keydown.enter.prevent="openAgenda"
    >
      <div class="home-section__event-row">
        <div class="home-section__event-main">
          <div class="home-section__event-when mono">
            {{ fmtDate(b.startMs) }} · {{ b.startTime }}
          </div>
          <div v-if="b.teamName" class="home-section__event-team">
            {{ b.teamName }}
          </div>
          <div
            v-if="b.opponentName"
            class="home-section__event-opp"
          >
            vs {{ b.opponentName }}
          </div>
          <div class="cb-sub home-section__event-venue">
            <MapPin :size="13" /> {{ venueLabel(b) }}
          </div>
        </div>
        <div class="home-section__event-pills">
          <CbPill :tone="kindTone(b)" dot>{{ kindLabel(b) }}</CbPill>
        </div>
      </div>
    </div>

    <!-- ─── État licence ──────────────────────────────────────── -->
    <div v-if="myProfile.member" class="home-section__license">
      <CbPill v-if="hasLicense" tone="emerald" dot>
        Licence active · {{ myProfile.member.licenseNumber }}
      </CbPill>
      <CbPill v-else tone="amber" dot>
        Licence non encore délivrée
      </CbPill>
    </div>

    <!-- ─── Mes cotisations — MOCK ────────────────────────────── -->
    <button
      type="button"
      class="home-section__action-btn home-section__action-btn--violet"
      @click="openProfile"
    >
      <span class="home-section__action-icon home-section__action-icon--violet">
        <Receipt :size="18" />
      </span>
      <span class="home-section__action-body">
        <span class="home-section__action-title">Mes cotisations</span>
        <span class="home-section__action-sub">
          <CbPill tone="amber" solid>MOCK</CbPill>
          à brancher
        </span>
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

.home-section__event {
  display: block;
  width: 100%;
  padding: 12px;
  border: 1px solid var(--border);
  cursor: pointer;
}
.home-section__event-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}
.home-section__event-main {
  flex: 1;
  min-width: 0;
}
.home-section__event-pills {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-end;
}
.home-section__event-when {
  font-weight: 700;
  font-size: 13px;
}
.home-section__event-team {
  font-weight: 600;
  margin-top: 2px;
}
.home-section__event-opp {
  font-weight: 500;
  margin-top: 2px;
}
.home-section__event-venue {
  margin-top: 4px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.home-section__license {
  padding: 4px 2px;
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
</style>
