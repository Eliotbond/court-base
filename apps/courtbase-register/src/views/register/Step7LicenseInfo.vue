<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  CircleDot,
  FileCheck,
  FileText,
  IdCard,
  Loader2,
  Send,
} from 'lucide-vue-next'
import type { Registration } from '@club-app/shared-types'
import WizardLayout from '@/components/wizard/WizardLayout.vue'
import { useRegistrationsStore } from '@/stores/registrations'

/**
 * Étape 7/8 — Récap des pièces à fournir + soumission finale.
 *
 * Cette page ne collecte rien : elle informe l'utilisateur des documents
 * qu'il devra fournir une fois l'intégration validée par le coach, puis
 * déclenche l'appel à la callable `submitRegistration` via le store.
 *
 * Tout est lu depuis `currentDraft` (déjà persisté côté Firestore par les
 * étapes 1-6) ; si le draft est introuvable, on retombe sur l'étape 1.
 */

const router = useRouter()
const registrations = useRegistrationsStore()

const currentDraft = computed<Registration | null>(() => registrations.currentDraft)

const submitting = ref(false)
const error = ref<string | null>(null)

onMounted(() => {
  // Garde-fou : sans draft ou sans équipe choisie, on ne peut pas soumettre.
  const draft = currentDraft.value
  if (draft === null || draft.teamId === null || draft.teamId === undefined || draft.teamId === '') {
    void router.replace('/register/step-1')
  }
})

const previouslyLicensed = computed<boolean>(() => currentDraft.value?.previouslyLicensed === true)
const transferUploaded = computed<boolean>(() =>
  currentDraft.value?.transferLetterStoragePath !== null &&
  currentDraft.value?.transferLetterStoragePath !== undefined,
)

const backTo = computed<string>(() =>
  previouslyLicensed.value ? '/register/step-6' : '/register/step-5',
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
      transferLetterStoragePath: draft.transferLetterStoragePath,
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
  void router.push(backTo.value)
}
</script>

<template>
  <WizardLayout :current="7" title="Avant de terminer">
    <div v-if="error" class="banner banner-strong step7__error">
      <AlertCircle :size="14" class="banner-icon" />
      <span>{{ error }}</span>
    </div>

    <h1 class="step7__title">Avant de valider votre inscription</h1>
    <p class="step7__subtitle">
      Voici les pièces qu'il vous sera demandé de fournir pour la licence fédérale,
      une fois l'intégration validée par le coach.
    </p>

    <div class="step7__section">
      <div class="step7__label">DOCUMENTS REQUIS</div>

      <div class="card-flat p-3 step7__doc">
        <div class="step7__doc-icon">
          <IdCard :size="16" />
        </div>
        <div class="step7__doc-body">
          <div class="step7__doc-title">Carte d'identité ou passeport (recto + verso)</div>
          <div class="step7__doc-sub">
            Lisible, en entier.
            <strong>Le permis de conduire et le permis de séjour ne sont pas acceptés.</strong>
          </div>
        </div>
      </div>

      <div class="card-flat p-3 step7__doc">
        <div class="step7__doc-icon">
          <FileText :size="16" />
        </div>
        <div class="step7__doc-body">
          <div class="step7__doc-title">Formulaire de demande de licence</div>
          <div class="step7__doc-sub">
            Pré-rempli et à signer (numérique ou imprimé/scanné).
          </div>
        </div>
      </div>

      <div class="card-flat p-3 step7__doc">
        <div class="step7__doc-icon">
          <FileCheck :size="16" />
        </div>
        <div class="step7__doc-body">
          <div class="step7__doc-title">Lettre de sortie de l'ancien club</div>
          <div v-if="!previouslyLicensed" class="step7__doc-sub step7__doc-sub--muted">
            Non requise pour cette inscription.
          </div>
          <div v-else-if="transferUploaded" class="step7__doc-sub step7__doc-sub--ok">
            <CheckCircle2 :size="12" />
            Document déjà uploadé
          </div>
          <div v-else class="step7__doc-sub step7__doc-sub--warn">
            À uploader plus tard.
          </div>
        </div>
      </div>
    </div>

    <div class="step7__section">
      <div class="step7__label">CONDITIONS DE DÉLIVRANCE</div>
      <ul class="step7__conditions">
        <li class="step7__cond">
          <CircleDot :size="12" class="step7__cond-icon" />
          <span>Validation de l'intégration à l'équipe par le coach</span>
        </li>
        <li class="step7__cond">
          <CircleDot :size="12" class="step7__cond-icon" />
          <span>Paiement de la cotisation</span>
        </li>
        <li class="step7__cond">
          <CircleDot :size="12" class="step7__cond-icon" />
          <span>Réception de tous les documents requis</span>
        </li>
      </ul>
    </div>

    <p class="step7__final">
      La décision d'établir une licence appartient au coach et à l'administration du club.
    </p>

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
          Soumettre mon inscription
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
  font-size: 12.5px;
  color: #64748b;
  margin: 6px 0 0 0;
  line-height: 1.5;
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
.step7__doc {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.step7__doc-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: #f1f5f9;
  color: #475569;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.step7__doc-body {
  flex: 1;
  min-width: 0;
}
.step7__doc-title {
  font-size: 13.5px;
  font-weight: 600;
  color: #0f172a;
  line-height: 1.35;
}
.step7__doc-sub {
  font-size: 12px;
  color: #64748b;
  margin-top: 3px;
  line-height: 1.45;
}
.step7__doc-sub strong {
  color: #0f172a;
  font-weight: 600;
}
.step7__doc-sub--muted {
  color: #94a3b8;
}
.step7__doc-sub--ok {
  color: #047857;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.step7__doc-sub--warn {
  color: #b45309;
}
.step7__conditions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.step7__cond {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  color: #334155;
  line-height: 1.45;
}
.step7__cond-icon {
  color: #10b981;
  margin-top: 4px;
  flex: none;
}
.step7__final {
  margin-top: 22px;
  font-size: 12.5px;
  font-style: italic;
  color: #64748b;
  line-height: 1.5;
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
