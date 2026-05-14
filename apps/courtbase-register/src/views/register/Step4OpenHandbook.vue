<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertCircle,
  ArrowRight,
  Calendar,
  ChevronLeft,
  CircleCheck,
  Loader2,
} from 'lucide-vue-next'
import WizardLayout from '@/components/wizard/WizardLayout.vue'
import { useRegistrationsStore } from '@/stores/registrations'
import { useTeamsStore } from '@/stores/teams'
import type { PublicTeam } from '@/repositories/teams.repo'

/**
 * Step 4 (open) — Manuel d'inscription pour une équipe à inscription ouverte.
 *
 * Cas d'usage : à l'étape 3, le user a choisi une équipe dont
 * `registrationStatus === 'open'`. Cette vue affiche le mot du coach (manuel
 * d'inscription rédigé en libre) et une note sur les entraînements. Pas de
 * collecte de données — juste lecture / consentement implicite avant
 * Continuer vers l'étape 5 (contact).
 *
 * Edge cases gérés (cf. brief) :
 *   - draft null ou `teamId` absent          → redirect /register/step-3
 *   - team introuvable (404 ou rules)        → banner d'erreur + bouton retour
 *   - team avec status !== 'open' (cas rare) → redirect /register/step-4-conditional
 */

const router = useRouter()
const registrations = useRegistrationsStore()
const teams = useTeamsStore()

const team = ref<PublicTeam | null>(null)
const loading = ref(true)
const loadError = ref(false)

const coachInitials = computed<string>(() => {
  const c = team.value?.headCoach
  if (!c) return '?'
  const f = c.firstName?.[0] ?? ''
  const l = c.lastName?.[0] ?? ''
  const initials = `${f}${l}`.toUpperCase()
  return initials || '?'
})

const coachFullName = computed<string>(() => {
  const c = team.value?.headCoach
  if (!c) return ''
  return `${c.firstName} ${c.lastName}`.trim()
})

const teamSubtitle = computed<string>(() => {
  const t = team.value
  if (!t) return ''
  const parts: string[] = []
  if (t.category?.name) parts.push(t.category.name)
  if (t.publicTagline) parts.push(t.publicTagline)
  return parts.join(' · ')
})

onMounted(async () => {
  const draft = registrations.currentDraft
  if (!draft || !draft.teamId) {
    await router.replace('/register/step-3')
    return
  }

  loading.value = true
  loadError.value = false
  try {
    const loaded = await teams.loadTeam(draft.teamId)
    if (!loaded) {
      loadError.value = true
      team.value = null
      return
    }
    // Si l'utilisateur a sélectionné une équipe "conditional" mais s'est
    // retrouvé ici (deeplink, retour navigateur), on redirige.
    if (loaded.registrationStatus !== 'open') {
      await router.replace('/register/step-4-conditional')
      return
    }
    team.value = loaded
  } catch {
    loadError.value = true
    team.value = null
  } finally {
    loading.value = false
  }
})

function goBack(): void {
  void router.push('/register/step-3')
}

function goContinue(): void {
  void router.push('/register/step-5')
}
</script>

<template>
  <WizardLayout :current="4" title="Manuel d'inscription">
    <!-- Loading -->
    <div v-if="loading" class="step4o__loading" role="status">
      <Loader2 :size="18" class="step4o__spinner" />
      <span>Chargement de l'équipe…</span>
    </div>

    <!-- Erreur de chargement -->
    <template v-else-if="loadError">
      <div class="banner banner-strong step4o__error" role="alert">
        <AlertCircle :size="16" class="banner-icon" />
        <span>Impossible de charger l'équipe sélectionnée.</span>
      </div>
      <button type="button" class="btn btn-secondary btn-block" @click="goBack">
        <ChevronLeft :size="14" />
        Retourner au choix d'équipe
      </button>
    </template>

    <!-- Contenu nominal -->
    <template v-else-if="team">
      <span class="pill pill-emerald step4o__pill">
        <CircleCheck :size="12" />
        Équipe ouverte
      </span>

      <h1 class="step4o__title">Bienvenue dans l'équipe {{ team.name }}</h1>
      <p v-if="teamSubtitle" class="step4o__subtitle">{{ teamSubtitle }}</p>

      <!-- Coach card -->
      <div class="card step4o__coach">
        <div class="step4o__coach-row">
          <div class="avatar ph-coach step4o__avatar">{{ coachInitials }}</div>
          <div class="step4o__coach-body">
            <div class="step4o__coach-label">Coach</div>
            <div class="step4o__coach-name">
              {{ coachFullName || 'Coach à confirmer' }}
            </div>
          </div>
        </div>
      </div>

      <!-- Manuel -->
      <div class="step4o__label">MANUEL D'INSCRIPTION</div>
      <div class="card step4o__handbook">
        <p v-if="team.openHandbook" class="step4o__handbook-text">
          {{ team.openHandbook }}
        </p>
        <p v-else class="step4o__handbook-empty">
          Le coach n'a pas encore rédigé son manuel d'inscription. Contactez-le
          directement pour les modalités.
        </p>
      </div>

      <!-- Entraînements -->
      <div class="step4o__label">ENTRAÎNEMENTS</div>
      <div class="card step4o__schedule">
        <Calendar :size="14" class="step4o__schedule-icon" />
        <span>Les horaires d'entraînement seront communiqués par le coach.</span>
      </div>
    </template>

    <template #footer>
      <button
        type="button"
        class="btn btn-secondary"
        :disabled="loading"
        @click="goBack"
      >
        Changer d'équipe
      </button>
      <button
        type="button"
        class="btn btn-primary flex-1"
        :disabled="loading || loadError || !team"
        @click="goContinue"
      >
        Continuer
        <ArrowRight :size="14" />
      </button>
    </template>
  </WizardLayout>
</template>

<style scoped>
.step4o__loading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #64748b;
  font-size: 13px;
  padding: 24px 0;
}
.step4o__spinner {
  animation: step4o-spin 0.9s linear infinite;
}
@keyframes step4o-spin {
  to {
    transform: rotate(360deg);
  }
}
.step4o__error {
  margin-bottom: 16px;
}
.step4o__pill {
  margin-top: 4px;
}
.step4o__title {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.3;
  margin: 8px 0 0 0;
  color: #0f172a;
}
.step4o__subtitle {
  font-size: 12.5px;
  color: #64748b;
  margin: 4px 0 0 0;
  font-style: italic;
}
.step4o__coach {
  padding: 16px;
  margin-top: 16px;
}
.step4o__coach-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.step4o__avatar {
  width: 40px;
  height: 40px;
  font-size: 13px;
}
.step4o__coach-body {
  flex: 1;
  min-width: 0;
}
.step4o__coach-label {
  font-size: 11px;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.step4o__coach-name {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
  margin-top: 2px;
}
.step4o__label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: #64748b;
  letter-spacing: 0.05em;
  margin: 20px 0 8px 0;
}
.step4o__handbook {
  padding: 16px;
}
.step4o__handbook-text {
  font-size: 13px;
  line-height: 1.55;
  color: #334155;
  margin: 0;
  white-space: pre-wrap;
}
.step4o__handbook-empty {
  font-size: 13px;
  line-height: 1.55;
  color: #64748b;
  margin: 0;
  font-style: italic;
}
.step4o__schedule {
  padding: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
  color: #475569;
}
.step4o__schedule-icon {
  color: #047857;
  flex: none;
}
.flex-1 {
  flex: 1;
}
.btn-block {
  width: 100%;
}
</style>
