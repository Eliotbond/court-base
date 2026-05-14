<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  CheckCircle2,
  Home,
  Loader2,
  Mail,
  Plus,
} from 'lucide-vue-next'
import type { Registration, RegistrationStatus } from '@club-app/shared-types'
import { useRegistrationsStore } from '@/stores/registrations'
import { useTeamsStore } from '@/stores/teams'
import type { PublicTeam } from '@/repositories/teams.repo'

/**
 * Étape 8/8 — Confirmation terminale du wizard d'inscription.
 *
 * Cf. `docs/chantier-registrations.md` §4.11 & §15.3.
 * Vue terminale : pas de `WizardLayout`, pas de stepper, pas de bouton précédent.
 * On lit la registration via le store, on charge le nom de l'équipe, puis on
 * propose deux CTAs (retour home / nouvelle inscription).
 */

const route = useRoute()
const router = useRouter()
const registrationsStore = useRegistrationsStore()
const teamsStore = useTeamsStore()

const loading = ref(true)
const registration = ref<Registration | null>(null)
const team = ref<PublicTeam | null>(null)
const error = ref<string | null>(null)

const registrationId = String(route.params.registrationId ?? '')

onMounted(async () => {
  if (!registrationId) {
    error.value = 'Inscription introuvable.'
    loading.value = false
    return
  }

  try {
    const reg = await registrationsStore.loadRegistration(registrationId)
    if (reg === null) {
      error.value = 'Inscription introuvable.'
      return
    }
    registration.value = reg

    const t = await teamsStore.loadTeam(reg.teamId)
    team.value = t
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : 'Impossible de charger la confirmation.'
  } finally {
    loading.value = false
  }
})

function playerLabel(reg: Registration): string {
  if (reg.registrationFor === 'self') return 'vous-même'
  const first = reg.player.firstName?.trim() ?? ''
  return first || 'votre joueur'
}

function statusLabel(status: RegistrationStatus): string {
  switch (status) {
    case 'submitted':
      return 'Reçue'
    case 'open_pending_trial':
      return 'Acceptée — essai à organiser'
    case 'conditional_pending_review':
      return 'En attente de validation'
    case 'conditional_pending_trial':
      return 'Essai à organiser'
    case 'trial_in_progress':
      return 'Essai en cours'
    case 'confirmed_pending_dues':
      return 'Licence à compléter'
    case 'active':
      return 'Active'
    case 'refused':
      return 'Refusée'
    case 'cancelled':
      return 'Clôturée'
    case 'draft':
      return 'Brouillon'
    default:
      return 'Reçue'
  }
}

function referenceCode(reg: Registration): string {
  return `REG-${reg.id.slice(0, 8).toUpperCase()}`
}

function goHome(): void {
  void router.push('/home')
}

function newRegistration(): void {
  registrationsStore.clearDraft()
  void router.push('/register/step-1')
}
</script>

<template>
  <div class="m-app">
    <div class="m-content confirm-content">
      <!-- Loading -->
      <div
        v-if="loading"
        class="confirm-loading"
      >
        <Loader2
          :size="20"
          class="confirm-loading-icon"
        />
        <span>Chargement…</span>
      </div>

      <!-- Error / not found -->
      <template v-else-if="error || !registration">
        <div class="banner banner-strong">
          <span>{{ error ?? 'Inscription introuvable.' }}</span>
        </div>
        <div class="confirm-ctas">
          <button
            type="button"
            class="btn btn-secondary btn-block"
            @click="goHome"
          >
            <Home :size="14" /> Retour à l'accueil
          </button>
        </div>
      </template>

      <!-- Success -->
      <template v-else>
        <div class="confirm-icon">
          <CheckCircle2 :size="48" />
        </div>
        <h1 class="confirm-title">
          Inscription envoyée !
        </h1>
        <p class="confirm-sub">
          Votre demande pour {{ playerLabel(registration) }} a bien été reçue.
        </p>

        <div class="card recap-card">
          <div class="recap-row">
            <div class="recap-label">
              Joueur
            </div>
            <div class="recap-value">
              {{ registration.player.firstName }} {{ registration.player.lastName }}
            </div>
          </div>
          <div class="recap-row">
            <div class="recap-label">
              Équipe
            </div>
            <div class="recap-value">
              {{ team?.name ?? '—' }}
            </div>
          </div>
          <div class="recap-row">
            <div class="recap-label">
              Statut
            </div>
            <div class="recap-value">
              <span class="pill pill-sky">
                {{ statusLabel(registration.status) }}
              </span>
            </div>
          </div>
          <div class="recap-row recap-row--mono">
            <div class="recap-label">
              Référence
            </div>
            <div class="recap-value recap-value--mono">
              {{ referenceCode(registration) }}
            </div>
          </div>
        </div>

        <div class="banner banner-info confirm-banner">
          <Mail
            :size="14"
            class="banner-icon"
          />
          <span>
            Un email récapitulatif a été envoyé. Le coach sera notifié et vous
            contactera prochainement.
          </span>
        </div>

        <div class="confirm-ctas">
          <button
            type="button"
            class="btn btn-primary btn-block"
            @click="goHome"
          >
            <Home :size="14" /> Revenir à mes inscriptions
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-block"
            @click="newRegistration"
          >
            <Plus :size="14" /> Inscrire un autre joueur
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.confirm-content {
  padding: 32px 20px 40px;
}

.confirm-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 0;
  color: #64748b;
  font-size: 13px;
}
.confirm-loading-icon {
  animation: confirm-spin 1s linear infinite;
}
@keyframes confirm-spin {
  to {
    transform: rotate(360deg);
  }
}

.confirm-icon {
  width: 76px;
  height: 76px;
  border-radius: 999px;
  background: #ecfdf5;
  color: #10b981;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 8px auto 16px;
}

.confirm-title {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
  text-align: center;
  margin: 0;
  color: #0f172a;
}
.confirm-sub {
  font-size: 12.5px;
  color: #64748b;
  text-align: center;
  margin: 6px 0 24px;
  line-height: 1.55;
}

.recap-card {
  padding: 16px;
  margin: 0 0 16px 0;
}
.recap-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid #eef2f6;
}
.recap-row:first-child {
  padding-top: 4px;
}
.recap-row:last-child {
  border-bottom: none;
  padding-bottom: 4px;
}
.recap-label {
  font-size: 12px;
  color: #64748b;
}
.recap-value {
  font-size: 13px;
  font-weight: 500;
  color: #0f172a;
  text-align: right;
}
.recap-value--mono {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  color: #334155;
  letter-spacing: 0.02em;
}

.confirm-banner {
  margin-bottom: 24px;
  align-items: flex-start;
}

.confirm-ctas {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
</style>
