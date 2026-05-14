<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AlertCircle, Info, Loader2, Mail } from 'lucide-vue-next'
import type { Timestamp } from '@club-app/shared-types'
import TeamCard from '@/components/wizard/TeamCard.vue'
import WizardLayout from '@/components/wizard/WizardLayout.vue'
import type { PublicTeam } from '@/repositories/teams.repo'
import { useRegistrationsStore } from '@/stores/registrations'
import { useTeamsStore } from '@/stores/teams'

const router = useRouter()
const registrations = useRegistrationsStore()
const teams = useTeamsStore()

const teamList = ref<PublicTeam[]>([])
const loaded = ref(false)
const error = ref<string | null>(null)
const submitting = ref(false)

const CONTACT_EMAIL = 'contact@marlybasket.ch'

/**
 * Convertit le `birthDate` du draft (typé `Timestamp` neutre depuis
 * `shared-types`) en `Date` JS.
 *
 * À l'exécution, Firestore renvoie une instance `FirestoreTimestamp` qui
 * expose `.toDate()` — mais le type compile-time ne le sait pas. On garde un
 * cast prudent : si la méthode existe on l'utilise, sinon fallback sur
 * `seconds * 1000` (path "objet plain", utile pour les tests / SSR).
 */
function toDate(ts: Timestamp): Date {
  const maybe = ts as unknown as { toDate?: () => Date; seconds: number }
  if (typeof maybe.toDate === 'function') {
    return maybe.toDate()
  }
  return new Date(maybe.seconds * 1000)
}

function isEpochZero(ts: Timestamp): boolean {
  const maybe = ts as unknown as { seconds: number }
  return !maybe || maybe.seconds === 0
}

const draft = computed(() => registrations.currentDraft)

const firstName = computed(() => draft.value?.player.firstName?.trim() || '')

const ageYears = computed<number | null>(() => {
  const bd = draft.value?.player.birthDate
  if (!bd) return null
  if (isEpochZero(bd)) return null
  const d = toDate(bd)
  const now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1
  return age
})

const showSkeleton = computed(() => !loaded.value || (teams.loading && teamList.value.length === 0))
const isEmpty = computed(() => loaded.value && !teams.loading && teamList.value.length === 0)

const subtitle = computed(() => {
  const n = teamList.value.length
  const name = firstName.value
  const age = ageYears.value
  const equipe = n > 1 ? `équipes correspondent` : `équipe correspond`
  const nameFrag = name ? ` de ${name}` : ''
  const ageFrag = age !== null ? ` (${age} ans)` : ''
  return `${n} ${equipe} à l'âge${nameFrag}${ageFrag}.`
})

onMounted(async () => {
  const current = draft.value
  if (!current) {
    await router.replace('/register/step-1')
    return
  }
  const bd = current.player.birthDate
  if (!bd || isEpochZero(bd)) {
    await router.replace('/register/step-1')
    return
  }
  try {
    const list = await teams.loadEligibleTeams(toDate(bd))
    teamList.value = list
  } catch (err) {
    error.value =
      err instanceof Error
        ? err.message
        : "Impossible de charger les équipes. Veuillez réessayer."
  } finally {
    loaded.value = true
  }
})

async function onPick(team: PublicTeam): Promise<void> {
  if (team.registrationStatus === 'closed') return
  if (submitting.value) return
  submitting.value = true
  error.value = null
  try {
    await registrations.patchDraft({ teamId: team.id })
    if (team.registrationStatus === 'open') {
      await router.push('/register/step-4-open')
    } else {
      await router.push('/register/step-4-conditional')
    }
  } catch (err) {
    error.value =
      err instanceof Error
        ? err.message
        : "Impossible d'enregistrer votre choix. Veuillez réessayer."
  } finally {
    submitting.value = false
  }
}

function goEditBirthDate(): Promise<void | unknown> {
  return router.push('/register/step-2')
}

const mailtoHref = computed(() => {
  const subject = encodeURIComponent("Demande d'inscription — équipe")
  return `mailto:${CONTACT_EMAIL}?subject=${subject}`
})
</script>

<template>
  <WizardLayout :current="3" title="Choix de l'équipe">
    <div v-if="error" class="banner banner-strong step3__error">
      <AlertCircle :size="16" class="banner-icon" />
      <span>{{ error }}</span>
    </div>

    <!-- LOADING -->
    <template v-if="showSkeleton">
      <div class="sk step3__sk-title" />
      <div class="sk step3__sk-sub" />
      <div class="sk step3__sk-banner" />

      <div class="card step3__sk-card">
        <div class="step3__sk-head">
          <div class="sk step3__sk-avatar" />
          <div class="step3__sk-headlines">
            <div class="sk step3__sk-line-lg" />
            <div class="sk step3__sk-line-sm" />
          </div>
        </div>
        <div class="step3__sk-chips">
          <div class="sk step3__sk-chip" />
          <div class="sk step3__sk-chip step3__sk-chip--w" />
          <div class="sk step3__sk-chip" />
        </div>
        <div class="step3__sk-cta-row">
          <div class="sk step3__sk-cta" />
        </div>
      </div>

      <div class="card step3__sk-card">
        <div class="step3__sk-head">
          <div class="sk step3__sk-avatar" />
          <div class="step3__sk-headlines">
            <div class="sk step3__sk-line-lg" />
            <div class="sk step3__sk-line-sm" />
          </div>
        </div>
        <div class="step3__sk-chips">
          <div class="sk step3__sk-chip step3__sk-chip--w" />
          <div class="sk step3__sk-chip" />
        </div>
      </div>

      <div class="step3__spinner-block">
        <Loader2 :size="24" class="step3__spinner" />
        <div class="step3__spinner-label">Recherche des équipes compatibles…</div>
      </div>
    </template>

    <!-- EMPTY -->
    <template v-else-if="isEmpty">
      <div class="step3__empty">
        <div class="step3__empty-illu" aria-hidden="true">
          <svg viewBox="0 0 180 120" fill="none" width="100%" height="100%">
            <rect
              x="14"
              y="12"
              width="152"
              height="80"
              rx="10"
              fill="#f8fafc"
              stroke="#e2e8f0"
              stroke-width="1.5"
            />
            <circle
              cx="90"
              cy="52"
              r="18"
              fill="#fff1f2"
              stroke="#fda4af"
              stroke-width="1.5"
            />
            <path
              d="M82 52h16M90 44v16"
              stroke="#be123c"
              stroke-width="2"
              stroke-linecap="round"
              transform="rotate(45 90 52)"
            />
            <rect x="48" y="80" width="84" height="4" rx="2" fill="#e2e8f0" />
          </svg>
        </div>
        <h2 class="step3__empty-title">Aucune équipe disponible</h2>
        <p class="step3__empty-desc">
          Aucune équipe ne correspond actuellement à l'âge du joueur.
          Contactez le club pour plus d'informations.
        </p>

        <div class="step3__empty-actions">
          <a class="btn btn-primary btn-block" :href="mailtoHref">
            <Mail :size="14" />
            Nous contacter
          </a>
          <button
            type="button"
            class="btn btn-secondary btn-block"
            @click="goEditBirthDate"
          >
            Modifier la date de naissance
          </button>
        </div>
      </div>
    </template>

    <!-- LISTE -->
    <template v-else>
      <h1 class="step3__title">Quelle équipe rejoindre ?</h1>
      <p class="step3__subtitle">{{ subtitle }}</p>

      <div v-if="teamList.length > 1" class="banner banner-info step3__banner">
        <Info :size="14" class="banner-icon" />
        <span>
          Plusieurs équipes existent pour cet âge — elles diffèrent par leur
          niveau de pratique. Lisez les descriptions ou contactez le coach
          avant de choisir.
        </span>
      </div>

      <TeamCard
        v-for="team in teamList"
        :key="team.id"
        :team="team"
        @pick="onPick"
      />

      <a class="btn btn-text step3__contact" :href="mailtoHref">
        <Mail :size="14" />
        Aucune ne convient ? Contacter le club
      </a>
    </template>
  </WizardLayout>
</template>

<style scoped>
.step3__error {
  margin-bottom: 16px;
}

/* ---- Titre + sous-titre ---- */
.step3__title {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.3;
  margin: 0;
  color: #0f172a;
}
.step3__subtitle {
  font-size: 12.5px;
  color: #64748b;
  margin: 4px 0 0 0;
}
.step3__banner {
  margin-top: 16px;
  align-items: flex-start;
}
.step3__contact {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 18px auto 0;
}

/* ---- Skeleton ---- */
.step3__sk-title {
  height: 24px;
  width: 75%;
  margin-bottom: 8px;
}
.step3__sk-sub {
  height: 14px;
  width: 50%;
}
.step3__sk-banner {
  height: 48px;
  margin-top: 16px;
}
.step3__sk-card {
  margin-top: 16px;
  padding: 16px;
}
.step3__sk-card + .step3__sk-card {
  margin-top: 12px;
}
.step3__sk-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.step3__sk-avatar {
  width: 40px;
  height: 40px;
  border-radius: 9999px;
  flex: none;
}
.step3__sk-headlines {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.step3__sk-line-lg {
  height: 16px;
  width: 66%;
}
.step3__sk-line-sm {
  height: 12px;
  width: 50%;
}
.step3__sk-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}
.step3__sk-chip {
  height: 24px;
  width: 80px;
}
.step3__sk-chip--w {
  width: 100px;
}
.step3__sk-cta-row {
  margin-top: 16px;
  display: flex;
  gap: 8px;
}
.step3__sk-cta {
  height: 32px;
  flex: 1;
}
.step3__spinner-block {
  margin-top: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.step3__spinner {
  color: #10b981;
  animation: step3-spin 0.9s linear infinite;
}
.step3__spinner-label {
  font-size: 12px;
  color: #64748b;
}
@keyframes step3-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ---- Empty ---- */
.step3__empty {
  text-align: center;
  padding-top: 24px;
}
.step3__empty-illu {
  width: 180px;
  height: 120px;
  margin: 0 auto;
}
.step3__empty-title {
  font-size: 16px;
  font-weight: 600;
  margin: 16px 0 0 0;
  color: #0f172a;
}
.step3__empty-desc {
  font-size: 12.5px;
  color: #64748b;
  line-height: 1.55;
  margin: 6px 16px 0 16px;
}
.step3__empty-actions {
  margin: 20px 4px 0 4px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
