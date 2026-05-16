<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AlertCircle, ArrowRight, ChevronLeft, Loader2, User, Users } from 'lucide-vue-next'
import type { RegistrationRelationship } from '@club-app/shared-types'
import WizardLayout from '@/components/wizard/WizardLayout.vue'
import RelationshipPicker from '@/components/wizard/RelationshipPicker.vue'
import { useAuthStore } from '@/stores/auth'
import { useRegistrationsStore } from '@/stores/registrations'

type RegistrationFor = 'self' | 'dependent'

const router = useRouter()
const auth = useAuthStore()
const registrations = useRegistrationsStore()

const registrationFor = ref<RegistrationFor | null>(null)
const relationship = ref<RegistrationRelationship | null>(null)
const relationshipOther = ref<string | null>(null)

const submitting = ref(false)
const error = ref<string | null>(null)

/**
 * True si le user a déjà une inscription "pour soi-même" en cours (statut non
 * terminal). Dans ce cas l'option "self" est désactivée — il ne peut pas
 * démarrer une seconde inscription pour lui-même.
 */
const selfBlocked = computed(() => registrations.hasActiveSelfRegistration)

/**
 * Le user peut atterrir sur Step1 sans passer par Home (lien direct, refresh).
 * On s'assure que `myList` est chargé pour que `hasActiveSelfRegistration` soit
 * fiable. Si la liste est déjà peuplée (venant de Home), on ne re-fetch pas.
 */
onMounted(async () => {
  const uid = auth.authSnap?.uid
  if (!uid) return
  if (registrations.myList.length > 0) return
  await registrations.loadMyRegistrations(uid)
})

function pick(value: RegistrationFor) {
  if (registrationFor.value === value) return
  if (value === 'self' && selfBlocked.value) return
  registrationFor.value = value
  if (value === 'self') {
    relationship.value = null
    relationshipOther.value = null
  }
}

const canContinue = computed(() => {
  if (registrationFor.value === null) return false
  if (registrationFor.value === 'dependent') {
    if (relationship.value === null) return false
    if (relationship.value === 'other') {
      const other = relationshipOther.value
      if (other === null || other.trim() === '') return false
    }
  }
  return true
})

async function onContinue() {
  if (!canContinue.value || submitting.value) return
  const uid = auth.authSnap?.uid
  if (!uid) {
    await router.push('/signin')
    return
  }

  const target = registrationFor.value
  if (target === null) return

  submitting.value = true
  error.value = null
  try {
    await registrations.startDraft({
      submittedByUid: uid,
      registrationFor: target,
      relationship: target === 'dependent' ? relationship.value : null,
      relationshipOther:
        target === 'dependent' && relationship.value === 'other'
          ? relationshipOther.value
          : null,
      player: {},
      matchedMemberId: null,
      teamId: null,
    })
    await router.push('/register/step-2')
  } catch (err) {
    error.value =
      err instanceof Error
        ? err.message
        : "Une erreur est survenue. Veuillez réessayer."
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <WizardLayout :current="1" title="Pour qui ?">
    <div v-if="error" class="banner banner-strong step1__error">
      <AlertCircle :size="16" class="banner-icon" />
      <span>{{ error }}</span>
    </div>

    <h1 class="step1__title">Pour qui inscrivez-vous aujourd'hui ?</h1>
    <p class="step1__subtitle">
      Vous pourrez ajouter d'autres inscriptions plus tard depuis votre espace.
    </p>

    <div class="step1__choices">
      <button
        type="button"
        class="choice-card step1__card"
        :class="{
          selected: registrationFor === 'self',
          'step1__card--disabled': selfBlocked,
        }"
        :aria-pressed="registrationFor === 'self'"
        :disabled="selfBlocked"
        @click="pick('self')"
      >
        <div class="step1__card-row">
          <div class="ic step1__ic step1__ic--amber">
            <User :size="20" />
          </div>
          <div class="step1__card-body">
            <div class="step1__card-title">Pour moi-même</div>
            <div class="step1__card-desc">Je suis le joueur ou la joueuse.</div>
          </div>
          <div
            class="step1__radio"
            :class="{ 'step1__radio--on': registrationFor === 'self' }"
          >
            <div v-if="registrationFor === 'self'" class="step1__radio-dot" />
          </div>
        </div>

        <div v-if="selfBlocked" class="step1__blocked">
          <AlertCircle :size="14" class="step1__blocked-icon" />
          <span>
            Vous avez déjà une inscription en cours pour vous-même. Vous pourrez
            en démarrer une nouvelle une fois celle-ci terminée ou annulée.
          </span>
        </div>
      </button>

      <button
        type="button"
        class="choice-card step1__card"
        :class="{ selected: registrationFor === 'dependent' }"
        :aria-pressed="registrationFor === 'dependent'"
        @click="pick('dependent')"
      >
        <div class="step1__card-row">
          <div class="ic step1__ic step1__ic--emerald">
            <Users :size="20" />
          </div>
          <div class="step1__card-body">
            <div class="step1__card-title">Pour un enfant ou un pupille</div>
            <div class="step1__card-desc">J'inscris quelqu'un dont je suis responsable.</div>
          </div>
          <div
            class="step1__radio"
            :class="{ 'step1__radio--on': registrationFor === 'dependent' }"
          >
            <div v-if="registrationFor === 'dependent'" class="step1__radio-dot" />
          </div>
        </div>

        <div v-if="registrationFor === 'dependent'" class="step1__rel" @click.stop>
          <RelationshipPicker
            v-model:relationship="relationship"
            v-model:relationshipOther="relationshipOther"
          />
        </div>
      </button>
    </div>

    <template #footer>
      <button
        type="button"
        class="btn btn-secondary"
        disabled
        title="Étape 1 — pas d'étape précédente"
      >
        <ChevronLeft :size="14" />
        Précédent
      </button>
      <button
        type="button"
        class="btn btn-primary flex-1"
        :disabled="!canContinue || submitting"
        @click="onContinue"
      >
        <template v-if="submitting">
          <Loader2 :size="14" class="step1__spinner" />
          Enregistrement…
        </template>
        <template v-else>
          Continuer
          <ArrowRight :size="14" />
        </template>
      </button>
    </template>
  </WizardLayout>
</template>

<style scoped>
.step1__error {
  margin-bottom: 16px;
}
.step1__title {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.3;
  margin: 0;
  color: #0f172a;
}
.step1__subtitle {
  font-size: 12.5px;
  color: #64748b;
  margin: 4px 0 0 0;
}
.step1__choices {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 20px;
}
.step1__card {
  width: 100%;
  text-align: left;
  font-family: inherit;
}
.step1__card--disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.step1__blocked {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  border-top: 1px solid #fde68a;
  padding-top: 12px;
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.4;
  color: #92400e;
}
.step1__blocked-icon {
  flex: none;
  margin-top: 1px;
}
.step1__card-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}
.step1__ic {
  width: 44px;
  height: 44px;
  border-radius: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.step1__ic--amber {
  background: #fef3c7;
  color: #92400e;
}
.step1__ic--emerald {
  background: #d1fae5;
  color: #047857;
}
.step1__card-body {
  flex: 1;
  min-width: 0;
}
.step1__card-title {
  font-size: 14.5px;
  font-weight: 600;
  color: #0f172a;
}
.step1__card-desc {
  font-size: 12px;
  color: #64748b;
  margin-top: 2px;
}
.step1__radio {
  width: 20px;
  height: 20px;
  border-radius: 999px;
  border: 1.5px solid #cbd5e1;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
}
.step1__radio--on {
  border-color: #10b981;
}
.step1__radio-dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: #10b981;
}
.step1__rel {
  border-top: 1px solid #a7f3d0;
  padding-top: 16px;
  margin-top: 12px;
  cursor: default;
}
.step1__spinner {
  animation: step1-spin 0.9s linear infinite;
}
@keyframes step1-spin {
  to {
    transform: rotate(360deg);
  }
}
.flex-1 {
  flex: 1;
}
</style>
