<script setup lang="ts">
/**
 * Étape 4b/8 — « Conditions d'intégration » (variante équipe sous-conditions).
 *
 * Affichée à `/register/step-4-conditional` quand l'équipe choisie à l'étape 3
 * a `registrationStatus === 'conditional'`. Si l'équipe est `open`, on bascule
 * sur la variante miroir `/register/step-4-open`.
 *
 * Cette étape ne soumet PAS la registration — la soumission au backend est
 * faite à l'étape 7 (`useRegistrationsStore().submit(...)`). On se contente
 * de présenter au parent les critères et la description du coach, puis on
 * avance dans le wizard.
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertTriangle,
  ArrowRight,
  BadgeAlert,
  Info,
} from 'lucide-vue-next'
import WizardLayout from '@/components/wizard/WizardLayout.vue'
import { useRegistrationsStore } from '@/stores/registrations'
import { useTeamsStore } from '@/stores/teams'
import type { PublicTeam } from '@/repositories/teams.repo'

const router = useRouter()
const registrationsStore = useRegistrationsStore()
const teamsStore = useTeamsStore()

const loading = ref(true)
const team = ref<PublicTeam | null>(null)
const loadFailed = ref(false)

const coachInitials = computed<string>(() => {
  const c = team.value?.headCoach
  if (!c) return ''
  const first = c.firstName?.charAt(0) ?? ''
  const last = c.lastName?.charAt(0) ?? ''
  return `${first}${last}`.toUpperCase() || '?'
})

const coachFullName = computed<string>(() => {
  const c = team.value?.headCoach
  if (!c) return ''
  return `${c.firstName} ${c.lastName}`.trim()
})

const subtitle = computed<string>(() => {
  if (!team.value) return ''
  const parts: string[] = []
  if (team.value.category?.name) parts.push(team.value.category.name)
  if (team.value.publicTagline) parts.push(team.value.publicTagline)
  return parts.join(' · ')
})

onMounted(async () => {
  const draft = registrationsStore.currentDraft
  if (!draft || !draft.teamId) {
    router.replace('/register/step-3')
    return
  }

  try {
    const loaded = await teamsStore.loadTeam(draft.teamId)
    if (!loaded) {
      loadFailed.value = true
      team.value = null
      return
    }
    // Variante miroir : si l'équipe n'est plus `conditional`, on bascule sur
    // la branche open. Cas typique : le coach a basculé `registrationStatus`
    // entre temps. On évite d'afficher des "critères" vides à un parent
    // qui passe en réalité par la branche manuel.
    if (loaded.registrationStatus !== 'conditional') {
      router.replace('/register/step-4-open')
      return
    }
    team.value = loaded
  } catch {
    loadFailed.value = true
    team.value = null
  } finally {
    loading.value = false
  }
})

function goBackToTeamPicker(): void {
  router.push('/register/step-3')
}

function goToNextStep(): void {
  // IMPORTANT : pas de submit ici. La submission finale est à l'étape 7.
  router.push('/register/step-5')
}
</script>

<template>
  <WizardLayout :current="4" title="Conditions d'intégration">
    <!-- État de chargement -->
    <template v-if="loading">
      <div class="space-y-3">
        <div class="sk h-5 w-32" />
        <div class="sk h-7 w-3/4" />
        <div class="sk h-24 w-full" />
        <div class="sk h-20 w-full" />
      </div>
    </template>

    <!-- Erreur de chargement -->
    <template v-else-if="loadFailed || !team">
      <div class="banner banner-strong">
        <AlertTriangle :size="16" />
        <div>
          <div class="font-medium">Impossible de charger l'équipe.</div>
          <div class="text-[12px] mt-1">
            Revenez à l'étape précédente et choisissez une équipe.
          </div>
        </div>
      </div>
      <button
        type="button"
        class="btn btn-secondary btn-sm mt-4"
        @click="goBackToTeamPicker"
      >
        Changer d'équipe
      </button>
    </template>

    <!-- Vue normale -->
    <template v-else>
      <span class="pill pill-amber">
        <BadgeAlert :size="12" />
        Sous conditions
      </span>
      <h1 class="text-[20px] font-semibold tracking-tight leading-snug mt-2">
        Conditions d'intégration — {{ team.name }}
      </h1>
      <div v-if="subtitle" class="text-[12.5px] text-slate-500 mt-1">
        {{ subtitle }}
      </div>

      <!-- Card coach -->
      <div v-if="team.headCoach" class="card mt-4 p-4">
        <div class="flex items-center gap-3">
          <div
            class="avatar ph-coach"
            style="width: 48px; height: 48px; font-size: 14px;"
          >
            {{ coachInitials }}
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-[14px] font-semibold">{{ coachFullName }}</div>
            <div class="text-[11.5px] text-slate-500">Coach</div>
          </div>
        </div>
      </div>

      <!-- Critères -->
      <template v-if="team.conditionalCriteria.length > 0">
        <div
          class="text-[11px] font-mono text-slate-500 tracking-wider mt-5 mb-2"
        >
          CRITÈRES
        </div>
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="c in team.conditionalCriteria"
            :key="c"
            class="chip"
            style="background:#fffbeb;border-color:#fde68a;color:#92400e;"
          >
            {{ c }}
          </span>
        </div>
      </template>

      <!-- Description du coach -->
      <div
        class="text-[11px] font-mono text-slate-500 tracking-wider mt-5 mb-2"
      >
        DESCRIPTION DU COACH
      </div>
      <div class="card p-4 leading-relaxed text-[13px] text-slate-700">
        <p
          v-if="team.conditionalDescription"
          style="white-space: pre-wrap;"
        >{{ team.conditionalDescription }}</p>
        <p v-else class="flex items-start gap-2 text-slate-500">
          <Info :size="14" class="mt-0.5 shrink-0" />
          <span>
            Le coach n'a pas encore détaillé les conditions. Contactez-le
            directement.
          </span>
        </p>
      </div>

      <!-- Avertissement candidature -->
      <div class="banner banner-warn mt-5">
        <AlertTriangle :size="14" />
        <span class="text-[12px] leading-relaxed">
          <strong>Votre candidature sera examinée par le coach.</strong>
          Vous serez contacté après réception de votre dossier complet.
        </span>
      </div>
    </template>

    <template #footer>
      <button
        type="button"
        class="btn btn-secondary"
        :disabled="loading"
        @click="goBackToTeamPicker"
      >
        Changer d'équipe
      </button>
      <button
        type="button"
        class="btn btn-primary flex-1"
        :disabled="loading || loadFailed || !team"
        @click="goToNextStep"
      >
        Soumettre ma candidature
        <ArrowRight :size="14" />
      </button>
    </template>
  </WizardLayout>
</template>
