<script setup lang="ts">
/**
 * CO10 — Demande de déplacement d'un match (coach).
 *
 * Transcription quasi-littérale du JSX `CO10Mobile`
 * (`/tmp/courtbase-app-design/courtbase-app/project/screens/coach.jsx`,
 * lignes 612-657).
 *
 * - Le coach propose une nouvelle date, une heure et un court préféré, avec
 *   une motivation (min 20 caractères).
 * - Submit → `logMockAction('co10.match-move-request', …)` puis `router.back()`.
 * - 3 courts mockés en dur (repris littéralement du JSX).
 * - Si `getMatch(id)` retourne null → `CbEmptyState`.
 */
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, CircleHelp, Send } from 'lucide-vue-next'

import CbBottomBar from '@/components/ui/CbBottomBar.vue'
import CbEmptyState from '@/components/ui/CbEmptyState.vue'
import CbMatchTypeChip from '@/components/ui/CbMatchTypeChip.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'

import { getMatch, getTeam, logMockAction, type MockMatch } from '@/repositories/mock'

// ────────────────────────────────────────────────────────────────
// Routing — id match
// ────────────────────────────────────────────────────────────────

const route = useRoute()
const router = useRouter()

const matchId = computed<string>(() => {
  const raw = route.params['id']
  return Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
})

const match = computed<MockMatch | null>(() =>
  matchId.value ? getMatch(matchId.value) : null,
)

const team = computed(() => (match.value ? getTeam(match.value.teamId) : null))

// ────────────────────────────────────────────────────────────────
// Mock — 3 courts en dur, repris littéralement du JSX (ligne 645).
// ────────────────────────────────────────────────────────────────

const COURT_OPTIONS: ReadonlyArray<string> = [
  'Aigues-Vertes · Court A',
  'Aigues-Vertes · Court B',
  'Pierre-Plates · Court A',
]

// ────────────────────────────────────────────────────────────────
// Form state
// ────────────────────────────────────────────────────────────────

const newDate = ref<string>('')
const newTime = ref<string>('')
const court = ref<string>(COURT_OPTIONS[0] ?? '')
const motivation = ref<string>('')

const MOTIVATION_MIN = 20

const canSubmit = computed(
  () =>
    newDate.value.length > 0 &&
    newTime.value.length > 0 &&
    motivation.value.trim().length >= MOTIVATION_MIN,
)

// ────────────────────────────────────────────────────────────────
// Affichage du match actuel
// ────────────────────────────────────────────────────────────────

const FR_WEEKDAYS = ['Di', 'Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa']
const FR_MONTHS = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
]

function formatDateLongFr(iso: string): string {
  const parts = iso.split('-').map((p) => Number(p))
  const y = parts[0] ?? 1970
  const m = parts[1] ?? 1
  const d = parts[2] ?? 1
  const date = new Date(y, m - 1, d)
  const wd = FR_WEEKDAYS[date.getDay()] ?? '?'
  const mo = FR_MONTHS[m - 1] ?? '?'
  return `${wd} ${d} ${mo}`
}

const currentDateLabel = computed(() =>
  match.value ? formatDateLongFr(match.value.date) : '',
)
const currentTimeLabel = computed(() => match.value?.startTime ?? '')

const teamLabel = computed(() => team.value?.name ?? '')
const oppositionLabel = computed(() =>
  match.value ? `${teamLabel.value} vs ${match.value.opponent}` : '',
)

// ────────────────────────────────────────────────────────────────
// Actions — mock-only
// ────────────────────────────────────────────────────────────────

function onBack(): void {
  if (window.history.length > 1) {
    router.back()
  } else {
    void router.push({ name: 'home' })
  }
}

function onSubmit(): void {
  if (!match.value || !canSubmit.value) return
  logMockAction('co10.match-move-request', {
    matchId: match.value.id,
    newDate: newDate.value,
    newTime: newTime.value,
    court: court.value,
    motivation: motivation.value.trim(),
  })
  onBack()
}
</script>

<template>
  <!-- ─── Cas erreur : match introuvable ─────────────────────── -->
  <CbMobileShell
    v-if="!match"
    title="Déplacer le match"
    show-back
    @back="onBack"
  >
    <div class="cb-page">
      <CbEmptyState
        :icon="CircleHelp"
        title="Match introuvable"
        body="Ce match n'existe pas ou n'est plus disponible. Vous ne pouvez plus demander son déplacement."
      >
        <template #actions>
          <button type="button" class="cb-btn primary sm" @click="onBack">
            <ArrowLeft :size="16" /> Retour
          </button>
        </template>
      </CbEmptyState>
    </div>
  </CbMobileShell>

  <!-- ─── Mobile (transcription JSX CO10Mobile) ──────────────── -->
  <CbMobileShell
    v-else
    title="Déplacer le match"
    show-back
    @back="onBack"
  >
    <div class="cb-mobile-body plain">
      <div class="cb-page">
        <div>
          <div class="cb-h2">Demande de déplacement</div>
          <div class="cb-sub" style="margin-top: 4px">
            L'admin examinera votre demande. La proposition reste indicative.
          </div>
        </div>

        <div class="cb-section-label" style="padding: 0">Match actuel</div>
        <div class="cb-card" style="padding: 14px">
          <div
            style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px"
          >
            <div>
              <div class="mono" style="font-weight: 600">
                {{ currentDateLabel }} · {{ currentTimeLabel }}
              </div>
              <div style="margin-top: 4px">{{ oppositionLabel }}</div>
              <div class="cb-sub" style="margin-top: 2px">
                {{ match.venueLabel }}
              </div>
            </div>
            <CbMatchTypeChip :type="match.matchType" />
          </div>
        </div>

        <div class="cb-section-label" style="padding: 0">Proposition</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px">
          <div class="cb-field">
            <label for="co10-new-date">Nouvelle date</label>
            <input
              id="co10-new-date"
              v-model="newDate"
              type="date"
              class="cb-input"
            />
          </div>
          <div class="cb-field">
            <label for="co10-new-time">Heure</label>
            <input
              id="co10-new-time"
              v-model="newTime"
              type="time"
              class="cb-input"
            />
          </div>
        </div>
        <div class="cb-field">
          <label for="co10-court">Court préféré</label>
          <select id="co10-court" v-model="court" class="cb-input">
            <option v-for="opt in COURT_OPTIONS" :key="opt" :value="opt">
              {{ opt }}
            </option>
          </select>
        </div>
        <div class="cb-field">
          <label for="co10-motivation">Motivation</label>
          <textarea
            id="co10-motivation"
            v-model="motivation"
            class="cb-input"
            rows="4"
            placeholder="3 joueurs en sélection cantonale le 25.10. Préférerais reporter au samedi suivant."
          />
        </div>
      </div>
    </div>
    <CbBottomBar>
      <button type="button" class="cb-btn outline" style="flex: 1" @click="onBack">
        Annuler
      </button>
      <button
        type="button"
        class="cb-btn primary"
        style="flex: 2"
        :disabled="!canSubmit"
        @click="onSubmit"
      >
        <Send :size="16" /> Envoyer la demande
      </button>
    </CbBottomBar>
  </CbMobileShell>
</template>
