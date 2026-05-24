<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  Info,
  Loader2,
  Send,
} from 'lucide-vue-next'
import type { Registration } from '@club-app/shared-types'
import WizardLayout from '@/components/wizard/WizardLayout.vue'
import { useRegistrationsStore } from '@/stores/registrations'

/**
 * Étape 7/8 — Récap + soumission finale.
 *
 * Cette page ne collecte aucun document : les pièces de licence (passeport,
 * lettre de sortie, AVS, contexte joueur étranger) sont collectées par le
 * parent au moment où le coach déclenche la création de la licence (vue
 * `LicenseRequestForm.vue`, cf. `docs/licenses/parent-completion-workflow.md`).
 *
 * Ici on se contente d'un récap (équipe, identité joueur, statut après
 * soumission) et d'un bouton "Envoyer mon inscription" qui appelle la
 * callable `submitRegistration` via le store.
 */

const router = useRouter()
const registrations = useRegistrationsStore()

const currentDraft = computed<Registration | null>(() => registrations.currentDraft)

const submitting = ref(false)
const error = ref<string | null>(null)

onMounted(() => {
  // Garde-fou : sans draft ou sans équipe choisie, on ne peut pas soumettre.
  const draft = currentDraft.value
  if (
    draft === null ||
    draft.teamId === null ||
    draft.teamId === undefined ||
    draft.teamId === ''
  ) {
    void router.replace('/register/step-1')
  }
})

const playerName = computed<string>(() => {
  const d = currentDraft.value
  if (d === null) return ''
  return `${d.player.firstName ?? ''} ${d.player.lastName ?? ''}`.trim()
})

const previouslyLicensed = computed<boolean>(
  () => currentDraft.value?.previouslyLicensed === true,
)

/**
 * Convertit une valeur Timestamp Firestore (sérialisée côté client comme
 * `{ seconds, nanoseconds }`) ou Date en chaîne ISO `YYYY-MM-DD`.
 */
function timestampToIso(
  ts: { seconds: number; nanoseconds: number } | { toDate: () => Date } | unknown,
): string {
  if (
    ts !== null &&
    typeof ts === 'object' &&
    'toDate' in ts &&
    typeof (ts as { toDate: () => Date }).toDate === 'function'
  ) {
    return (ts as { toDate: () => Date }).toDate().toISOString().slice(0, 10)
  }
  if (ts !== null && typeof ts === 'object' && 'seconds' in ts) {
    return new Date((ts as { seconds: number }).seconds * 1000).toISOString().slice(0, 10)
  }
  throw new Error('Invalid birthDate')
}

async function onSubmit(): Promise<void> {
  if (submitting.value) return
  const draft = currentDraft.value
  if (draft === null) {
    error.value = "Brouillon introuvable. Veuillez recommencer l'inscription."
    return
  }

  submitting.value = true
  error.value = null

  try {
    const payload = {
      registrationFor: draft.registrationFor,
      relationship: draft.relationship,
      relationshipOther: draft.relationshipOther,
      player: {
        firstName: draft.player.firstName,
        lastName: draft.player.lastName,
        birthDate: timestampToIso(draft.player.birthDate),
        gender: draft.player.gender,
        avs: draft.player.avs,
        phone: draft.player.phone,
      },
      matchedMemberId: draft.matchedMemberId,
      teamId: draft.teamId,
      previouslyLicensed: draft.previouslyLicensed,
      previousClubName: draft.previousClubName,
      previousClubAbroad: draft.previousClubAbroad,
      // `transferLetterStoragePath` toujours null à la soumission : les
      // documents de licence sont collectés plus tard via
      // `LicenseRequestForm.vue` (workflow parent post-inscription).
      transferLetterStoragePath: null,
    }

    const result = await registrations.submit(payload)
    await router.replace({ name: 'wiz-done', params: { registrationId: result.id } })
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Échec de l'envoi. Réessayez."
    submitting.value = false
  }
}

function onBack(): void {
  if (submitting.value) return
  void router.push('/register/step-5')
}
</script>

<template>
  <WizardLayout :current="6" title="Récap & envoi">
    <div v-if="error" class="banner banner-strong step7__error">
      <AlertCircle :size="14" class="banner-icon" />
      <span>{{ error }}</span>
    </div>

    <h1 class="step7__title">Vous êtes prêt(e) à envoyer votre inscription</h1>
    <p class="step7__subtitle">
      Le coach va recevoir votre demande et planifiera un essai. Vous serez
      ensuite invité(e) à compléter les documents nécessaires à la licence
      fédérale — uniquement après confirmation par le coach.
    </p>

    <div class="step7__section">
      <div class="step7__label">RÉCAPITULATIF</div>

      <div class="card-flat p-3 step7__summary">
        <div class="step7__summary-row">
          <span class="step7__summary-key">Joueur</span>
          <span class="step7__summary-value">{{ playerName }}</span>
        </div>
        <div v-if="previouslyLicensed" class="step7__summary-row">
          <span class="step7__summary-key">Ancien club</span>
          <span class="step7__summary-value">
            {{ currentDraft?.previousClubName ?? '—' }}
            <small v-if="currentDraft?.previousClubAbroad" class="step7__summary-note">
              · à l'étranger
            </small>
          </span>
        </div>
      </div>
    </div>

    <div class="step7__section">
      <div class="step7__label">ET ENSUITE ?</div>

      <ul class="step7__steps">
        <li class="step7__step">
          <CheckCircle2 :size="14" class="step7__step-icon" />
          <span>Le coach planifie un essai (généralement sous 7 jours).</span>
        </li>
        <li class="step7__step">
          <CheckCircle2 :size="14" class="step7__step-icon" />
          <span>Après confirmation, la cotisation vous est envoyée par email.</span>
        </li>
        <li class="step7__step">
          <CheckCircle2 :size="14" class="step7__step-icon" />
          <span>
            Au moment où le coach demande la licence, vous compléterez votre
            dossier (pièce d'identité, AVS si manquant, lettre de sortie le
            cas échéant) depuis votre espace.
          </span>
        </li>
      </ul>
    </div>

    <div class="banner banner-info step7__note">
      <Info :size="14" />
      <span>
        Vous n'avez aucun document à fournir maintenant — uniquement à la
        création de la licence.
      </span>
    </div>

    <template #footer>
      <button
        type="button"
        class="btn btn-secondary"
        :disabled="submitting"
        @click="onBack"
      >
        <ChevronLeft :size="14" />
        Précédent
      </button>
      <button
        type="button"
        class="btn btn-primary flex-1"
        :disabled="submitting"
        @click="onSubmit"
      >
        <template v-if="submitting">
          <Loader2 :size="14" class="animate-spin" />
          Envoi en cours…
        </template>
        <template v-else>
          <Send :size="14" />
          Envoyer mon inscription
        </template>
      </button>
    </template>
  </WizardLayout>
</template>

<style scoped>
.step7__error {
  margin-bottom: 16px;
}
.step7__title {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.3;
  margin: 0;
  color: #0f172a;
}
.step7__subtitle {
  font-size: 13px;
  color: #475569;
  margin: 6px 0 0 0;
  line-height: 1.55;
}
.step7__section {
  margin-top: 22px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.step7__label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  color: #64748b;
  letter-spacing: 0.06em;
  margin-bottom: 2px;
}
.p-3 {
  padding: 12px;
}
.step7__summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.step7__summary-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  font-size: 13px;
}
.step7__summary-key {
  color: #64748b;
  flex: none;
}
.step7__summary-value {
  color: #0f172a;
  font-weight: 600;
  text-align: right;
}
.step7__summary-note {
  color: #64748b;
  font-weight: 400;
}
.step7__steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.step7__step {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  color: #334155;
  line-height: 1.5;
}
.step7__step-icon {
  color: #047857;
  margin-top: 3px;
  flex: none;
}
.step7__note {
  margin-top: 18px;
}
.flex-1 {
  flex: 1;
}
.animate-spin {
  animation: step7-spin 0.9s linear infinite;
}
@keyframes step7-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
