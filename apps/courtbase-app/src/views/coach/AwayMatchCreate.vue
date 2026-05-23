<script setup lang="ts">
/**
 * CO7 — Création d'un match à l'extérieur (coach).
 *
 * Transcription quasi-littérale du JSX `CO7Mobile` (coach.jsx L471-495).
 *
 * Mock-only — `logMockAction('co7.create-away-match', payload)` puis
 * `router.back()`. Aucune mutation persistante.
 *
 * Banner amber conflit trainings : si la date saisie tombe sur un jour
 * d'entraînement canonique (mardi / mercredi / vendredi), on annonce qu'un
 * training sera libéré automatiquement.
 */
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bell,
  Calendar,
  Clock,
  Info,
  MapPin,
  Users,
} from 'lucide-vue-next'

import CbBanner from '@/components/ui/CbBanner.vue'
import CbBottomBar from '@/components/ui/CbBottomBar.vue'
import CbDesktopShell from '@/components/ui/CbDesktopShell.vue'
import CbEmptyState from '@/components/ui/CbEmptyState.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbPill from '@/components/ui/CbPill.vue'

import { useAuthStore } from '@/stores/auth'
import { useShellNav } from '@/composables/useShellNav'
import { getTeam, logMockAction, type MockTeam } from '@/repositories/mock'

// ────────────────────────────────────────────────────────────────
// Auth + routing
// ────────────────────────────────────────────────────────────────
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
void auth // référencé pour cohérence avec les autres vues coach

const { coachNav } = useShellNav()

const teamId = computed<string>(() => {
  const raw = route.params['teamId']
  return Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
})

const team = computed<MockTeam | null>(() =>
  teamId.value ? getTeam(teamId.value) : null,
)

const teamLabel = computed(() => team.value?.name ?? '')

// ────────────────────────────────────────────────────────────────
// Form state — 4 options de match type en dur (cf. brief)
// ────────────────────────────────────────────────────────────────
const MATCH_TYPES = ['CSJC', 'AFBB', 'Amical', 'Coupe'] as const

const matchDate = ref<string>('')
const matchTime = ref<string>('')
const opponent = ref<string>('')
const address = ref<string>('')
const matchType = ref<string>(MATCH_TYPES[0])

const ADDRESS_MIN = 10

const canSubmit = computed(
  () =>
    matchDate.value.length > 0 &&
    matchTime.value.length > 0 &&
    opponent.value.trim().length > 0 &&
    address.value.trim().length >= ADDRESS_MIN &&
    matchType.value.length > 0,
)

// ────────────────────────────────────────────────────────────────
// Banner conflit training (mock — mardi/mercredi/vendredi)
// ────────────────────────────────────────────────────────────────
const TRAINING_DAYS = new Set<number>([2, 3, 5])

function parseIso(iso: string): Date | null {
  const parts = iso.split('-').map((p) => Number(p))
  const y = parts[0]
  const m = parts[1]
  const d = parts[2]
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

const conflictedTraining = computed<{ date: string; time: string } | null>(() => {
  const date = parseIso(matchDate.value)
  if (!date) return null
  if (!TRAINING_DAYS.has(date.getDay())) return null
  if (matchTime.value.length === 0) return null
  return { date: matchDate.value, time: matchTime.value }
})

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

function onCancel(): void {
  onBack()
}

function onSubmit(): void {
  if (!team.value || !canSubmit.value) return
  logMockAction('co7.create-away-match', {
    teamId: team.value.id,
    date: matchDate.value,
    time: matchTime.value,
    opponent: opponent.value.trim(),
    address: address.value.trim(),
    matchType: matchType.value,
  })
  onBack()
}
</script>

<template>
  <!-- ─── Cas erreur : équipe introuvable ────────────────────── -->
  <CbMobileShell
    v-if="!team"
    title="Match à l'extérieur"
    show-back
    @back="onBack"
  >
    <div class="cb-page">
      <CbEmptyState
        :icon="Info"
        title="Équipe introuvable"
        body="Cette équipe n'existe pas ou n'est plus disponible. Vous ne pouvez pas créer de match pour elle."
      >
        <template #actions>
          <button type="button" class="cb-btn primary sm" @click="onBack">
            <ArrowLeft :size="16" /> Retour
          </button>
        </template>
      </CbEmptyState>
    </div>
  </CbMobileShell>

  <!-- ─── Mobile (transcription JSX CO7Mobile) ───────────────── -->
  <CbMobileShell
    v-else
    class="co7-mobile"
    title="Match à l'extérieur"
    show-back
    @back="onBack"
  >
    <div class="cb-page">
      <div>
        <div class="cb-h2">Nouveau match extérieur</div>
        <div class="cb-sub" style="margin-top: 2px">{{ teamLabel }}</div>
      </div>

      <div class="cb-field">
        <label>Date</label>
        <input v-model="matchDate" type="date" class="cb-input" />
      </div>
      <div class="cb-field">
        <label>Heure de début</label>
        <input v-model="matchTime" type="time" class="cb-input" />
      </div>
      <div class="cb-field">
        <label>Équipe adverse</label>
        <input
          v-model="opponent"
          class="cb-input"
          placeholder="Lausanne Sport U16M"
        />
      </div>
      <div class="cb-field">
        <label>Adresse du gymnase</label>
        <textarea
          v-model="address"
          class="cb-input"
          rows="3"
          placeholder="Salle Bellerive&#10;Av. de Provence 80&#10;1007 Lausanne"
        />
      </div>
      <div class="cb-field">
        <label>Type de match</label>
        <select v-model="matchType" class="cb-input">
          <option v-for="opt in MATCH_TYPES" :key="opt" :value="opt">
            {{ opt }}
          </option>
        </select>
      </div>

      <CbBanner
        v-if="conflictedTraining"
        tone="amber"
        title="Conflit avec un training"
      >
        <template #icon><AlertTriangle :size="18" /></template>
        L'entraînement
        <span class="mono">{{ conflictedTraining.date }} {{ conflictedTraining.time }}</span>
        sera libéré automatiquement.
      </CbBanner>
    </div>

    <CbBottomBar>
      <button
        type="button"
        class="cb-btn outline"
        style="flex: 1"
        @click="onCancel"
      >
        Annuler
      </button>
      <button
        type="button"
        class="cb-btn primary"
        style="flex: 2"
        :disabled="!canSubmit"
        @click="onSubmit"
      >
        Créer le match
        <ArrowRight :size="16" />
      </button>
    </CbBottomBar>
  </CbMobileShell>

  <!-- ─── Desktop (≥1024 px) — même contenu, layout centré ───── -->
  <CbDesktopShell v-if="team" :items="coachNav" :active="1" class="co7-desktop">
    <div class="co7-desktop-body">
      <div class="cb-card co7-desktop-card">
        <div style="display: flex; align-items: center; gap: 8px">
          <button type="button" class="cb-btn ghost sm" @click="onBack">
            <ArrowLeft :size="16" /> Retour
          </button>
          <CbPill tone="emerald" dot>Extérieur</CbPill>
          <Bell :size="14" style="color: var(--slate-400); margin-left: auto" />
        </div>

        <div>
          <div class="cb-h2">Nouveau match extérieur</div>
          <div class="cb-sub" style="margin-top: 2px">{{ teamLabel }}</div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
          <div class="cb-field">
            <label>
              <Calendar :size="12" style="vertical-align: -1px; margin-right: 4px" />Date
            </label>
            <input v-model="matchDate" type="date" class="cb-input" />
          </div>
          <div class="cb-field">
            <label>
              <Clock :size="12" style="vertical-align: -1px; margin-right: 4px" />Heure de début
            </label>
            <input v-model="matchTime" type="time" class="cb-input" />
          </div>
        </div>

        <div class="cb-field">
          <label>
            <Users :size="12" style="vertical-align: -1px; margin-right: 4px" />Équipe adverse
          </label>
          <input
            v-model="opponent"
            class="cb-input"
            placeholder="Lausanne Sport U16M"
          />
        </div>

        <div class="cb-field">
          <label>
            <MapPin :size="12" style="vertical-align: -1px; margin-right: 4px" />Adresse du gymnase
          </label>
          <textarea
            v-model="address"
            class="cb-input"
            rows="3"
            placeholder="Salle Bellerive&#10;Av. de Provence 80&#10;1007 Lausanne"
          />
        </div>

        <div class="cb-field">
          <label>Type de match</label>
          <select v-model="matchType" class="cb-input">
            <option v-for="opt in MATCH_TYPES" :key="opt" :value="opt">
              {{ opt }}
            </option>
          </select>
        </div>

        <CbBanner
          v-if="conflictedTraining"
          tone="amber"
          title="Conflit avec un training"
        >
          <template #icon><AlertTriangle :size="18" /></template>
          L'entraînement
          <span class="mono">{{ conflictedTraining.date }} {{ conflictedTraining.time }}</span>
          sera libéré automatiquement.
        </CbBanner>

        <div class="co7-desktop-actions">
          <button type="button" class="cb-btn outline" @click="onCancel">
            Annuler
          </button>
          <button
            type="button"
            class="cb-btn primary"
            :disabled="!canSubmit"
            @click="onSubmit"
          >
            Créer le match
            <ArrowRight :size="16" />
          </button>
        </div>
      </div>
    </div>
  </CbDesktopShell>

  <!-- ─── Desktop : équipe introuvable ───────────────────────── -->
  <CbDesktopShell v-else :items="coachNav" :active="1" class="co7-desktop">
    <div class="co7-desktop-body">
      <div class="cb-card co7-desktop-card">
        <CbEmptyState
          :icon="Info"
          title="Équipe introuvable"
          body="Cette équipe n'existe pas ou n'est plus disponible. Vous ne pouvez pas créer de match pour elle."
        >
          <template #actions>
            <button type="button" class="cb-btn primary sm" @click="onBack">
              <ArrowLeft :size="16" /> Retour
            </button>
          </template>
        </CbEmptyState>
      </div>
    </div>
  </CbDesktopShell>
</template>

<style scoped>
.co7-mobile { display: flex; }
.co7-desktop { display: none; }
@media (min-width: 1024px) {
  .co7-mobile { display: none; }
  .co7-desktop { display: flex; }
}

.co7-desktop-body {
  flex: 1;
  overflow: auto;
  padding: 28px;
  background: var(--bg-muted);
  display: flex;
  justify-content: center;
}
.co7-desktop-card {
  width: 100%;
  max-width: 640px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.co7-desktop-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}
</style>
