<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertCircle,
  ArrowRight,
  BadgeInfo,
  ChevronLeft,
  Hash,
  Info,
} from 'lucide-vue-next'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import WizardLayout from '@/components/wizard/WizardLayout.vue'
import MatchFoundDialog from '@/components/wizard/MatchFoundDialog.vue'
import { useRegistrationsStore } from '@/stores/registrations'

/**
 * Step 2/8 — Identité du joueur + numéro AVS.
 *
 * - Formulaire prénom/nom/date de naissance/genre + bloc AVS séparé.
 * - L'AVS est OBLIGATOIRE : un joueur sans AVS ne peut pas s'inscrire via le
 *   portail (cas asile / transfert étranger → traités hors portail par le
 *   club). Le bouton Continuer reste désactivé tant que l'AVS n'est pas valide.
 * - Persistance du brouillon via `useRegistrationsStore().patchDraft()`.
 * - Au passage à l'étape suivante (ou au blur de l'AVS), appelle
 *   `findMatches()` pour détecter un doublon par AVS exact. Si match → ouvre la
 *   modal `<MatchFoundDialog>`. Le user choisit de lier (-> step-3 avec
 *   `matchedMemberId`) ou de rejeter (la modal se ferme, on attend un
 *   nouveau clic Continuer pour confirmer la création d'un nouveau dossier).
 */

const router = useRouter()
const store = useRegistrationsStore()

// ---------------------------------------------------------------------------
// Local form state
// ---------------------------------------------------------------------------

type Gender = 'M' | 'F' | 'other' | null

const firstName = ref('')
const lastName = ref('')
/** ISO YYYY-MM-DD — directement liable à `<input type="date">`. */
const birthDate = ref('')
const gender = ref<Gender>(null)
const avs = ref('')

const error = ref<string | null>(null)
const submitting = ref(false)
const dialogOpen = ref(false)
/** Suit si l'utilisateur a déjà rejeté le match courant — empêche de relancer un findMatches inutile. */
const matchRejected = ref(false)

const genderOptions: Array<{ label: string; value: Gender }> = [
  { label: 'Masculin', value: 'M' },
  { label: 'Féminin', value: 'F' },
  { label: 'Autre', value: 'other' },
  { label: 'Préfère ne pas dire', value: null },
]

// ---------------------------------------------------------------------------
// Mount — restaure le draft ou redirige si état perdu
// ---------------------------------------------------------------------------

onMounted(() => {
  const draft = store.currentDraft
  if (!draft) {
    router.replace('/register/step-1')
    return
  }
  const p = draft.player
  if (p) {
    firstName.value = p.firstName ?? ''
    lastName.value = p.lastName ?? ''
    if (p.birthDate) {
      // `Timestamp` côté shared-types est un objet neutre `{ seconds, nanoseconds }`,
      // pas la classe Firebase SDK — on convertit à la main.
      const ms = p.birthDate.seconds * 1000 + Math.floor(p.birthDate.nanoseconds / 1e6)
      // Évite de proposer l'epoch placeholder écrit par createDraft quand
      // l'utilisateur n'a pas encore renseigné de date.
      if (ms > 0) {
        birthDate.value = isoFromDate(new Date(ms))
      }
    }
    gender.value = p.gender ?? null
    avs.value = p.avs ?? ''
  }
})

function isoFromDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const AVS_REGEX = /^756\.\d{4}\.\d{4}\.\d{2}$/

const avsIsValid = computed(() => AVS_REGEX.test(avs.value.trim()))
const avsShowError = computed(
  () => avs.value.trim() !== '' && !avsIsValid.value,
)

const canContinue = computed(() => {
  if (submitting.value) return false
  if (!firstName.value.trim()) return false
  if (!lastName.value.trim()) return false
  if (!birthDate.value) return false
  return avsIsValid.value
})

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

async function maybeRunMatch(): Promise<void> {
  if (matchRejected.value) return
  if (!avsIsValid.value) return
  try {
    const matches = await store.findMatches({ avs: avs.value.trim() })
    if (matches.length > 0) {
      dialogOpen.value = true
    }
  } catch (err) {
    // Le matching est best-effort sur le blur — on n'interrompt pas le user.
    // L'erreur sera resoulevée lors du clic Continuer si elle persiste.
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function onAvsBlur(): Promise<void> {
  if (!avsIsValid.value) return
  await maybeRunMatch()
}

// ---------------------------------------------------------------------------
// Persistence + nav
// ---------------------------------------------------------------------------

function buildPlayerPatch(): {
  firstName: string
  lastName: string
  birthDate: Date
  gender: Gender
  avs: string
  phone: null
} {
  return {
    firstName: firstName.value.trim(),
    lastName: lastName.value.trim(),
    birthDate: new Date(birthDate.value),
    gender: gender.value,
    avs: avs.value.trim(),
    phone: null,
  }
}

async function persistAndGoNext(matchedMemberId: string | null): Promise<void> {
  submitting.value = true
  error.value = null
  try {
    await store.patchDraft({
      player: buildPlayerPatch(),
      // Ne touche `matchedMemberId` que si on en a un explicitement à poser.
      ...(matchedMemberId !== null ? { matchedMemberId } : {}),
    })
    router.push('/register/step-3')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    submitting.value = false
  }
}

async function onContinue(): Promise<void> {
  if (!canContinue.value) return

  // Si l'AVS est valide et qu'aucun match n'a encore été rejeté, on tente
  // un dernier appel — au cas où l'utilisateur n'aurait pas blur le champ
  // AVS (cliquer Continuer doit suffire à déclencher le matching).
  if (!matchRejected.value && avsIsValid.value) {
    submitting.value = true
    error.value = null
    try {
      const matches = await store.findMatches({ avs: avs.value.trim() })
      if (matches.length > 0) {
        dialogOpen.value = true
        return
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      return
    } finally {
      submitting.value = false
    }
  }

  await persistAndGoNext(null)
}

async function onConfirmMatch(memberId: string): Promise<void> {
  dialogOpen.value = false
  await persistAndGoNext(memberId)
}

function onRejectMatch(): void {
  store.clearMatches()
  dialogOpen.value = false
  // Bloque un re-déclenchement automatique de findMatches sur ce set de
  // champs. L'utilisateur doit re-cliquer Continuer pour confirmer la
  // création d'un nouveau dossier.
  matchRejected.value = true
}

/**
 * Fermeture de la modal en mode bloqué : le dossier trouvé est déjà rattaché à
 * un autre compte (`linkedToOtherAccount`). On NE pose PAS `matchRejected` —
 * l'utilisateur reste à l'étape 2 et un nouveau clic Continuer relancera le
 * match, qui rebloquera. La seule issue est de corriger l'AVS ou de contacter
 * le club (cf. message de la modal). On ne crée surtout pas de nouveau dossier :
 * l'AVS étant unique, ce serait un doublon de la même personne.
 */
function onCloseBlockedMatch(): void {
  store.clearMatches()
  dialogOpen.value = false
}
</script>

<template>
  <WizardLayout :current="2" title="Identité du joueur">
    <div>
      <h1 class="text-[20px] font-semibold tracking-tight leading-snug">
        Qui est le joueur ?
      </h1>
      <p class="text-[12.5px] text-slate-500 mt-1">
        Tel que figurant sur sa carte d'identité.
      </p>

      <div v-if="error" class="banner banner-strong mt-4" role="alert">
        <AlertCircle :size="14" />
        <span>{{ error }}</span>
      </div>

      <!-- Identité -->
      <div class="card p-4 mt-5 space-y-4">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label" for="reg-firstname">Prénom</label>
            <InputText
              id="reg-firstname"
              v-model="firstName"
              class="input"
              autocomplete="given-name"
            />
          </div>
          <div>
            <label class="label" for="reg-lastname">Nom</label>
            <InputText
              id="reg-lastname"
              v-model="lastName"
              class="input"
              autocomplete="family-name"
            />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label" for="reg-birthdate">Date de naissance</label>
            <input
              id="reg-birthdate"
              v-model="birthDate"
              type="date"
              class="input"
              autocomplete="bday"
            />
          </div>
          <div>
            <label class="label" for="reg-gender">Genre</label>
            <Select
              id="reg-gender"
              v-model="gender"
              :options="genderOptions"
              option-label="label"
              option-value="value"
              placeholder="Sélectionner"
              class="w-full"
            />
          </div>
        </div>
      </div>

      <!-- AVS -->
      <div
        class="text-[11px] font-mono text-slate-500 tracking-wider mt-5 mb-2 flex items-center gap-1.5"
      >
        <BadgeInfo :size="14" />
        NUMÉRO AVS · OBLIGATOIRE
      </div>

      <div class="card p-4" style="border-color: #bae6fd; background: #f0f9ff;">
        <label class="label" for="reg-avs">Numéro AVS du joueur</label>
        <div class="input-wrap">
          <Hash :size="16" />
          <input
            id="reg-avs"
            v-model="avs"
            type="text"
            inputmode="numeric"
            placeholder="756.XXXX.XXXX.XX"
            class="input with-icon-left"
            :class="{ error: avsShowError }"
            style="background: white; letter-spacing: 0.04em; font-family: 'JetBrains Mono', ui-monospace, monospace;"
            @blur="onAvsBlur"
          />
        </div>
        <div
          v-if="avsShowError"
          class="helper-error flex items-center gap-1.5"
        >
          <AlertCircle :size="14" />
          <span>
            Format incorrect — attendu :
            <span class="font-mono">756.XXXX.XXXX.XX</span>
          </span>
        </div>

        <div class="banner banner-soft mt-3" style="background: white; border-color: #bae6fd;">
          <Info :size="14" style="color: #0369a1;" />
          <span class="text-[12px] leading-relaxed" style="color: #0c4a6e;">
            Le numéro AVS est obligatoire pour établir la licence fédérale et
            finaliser l'inscription. Si le joueur n'a pas encore d'AVS
            (procédure d'asile, transfert depuis l'étranger), contactez
            directement le club.
          </span>
        </div>
      </div>
    </div>

    <template #footer>
      <button
        type="button"
        class="btn btn-secondary"
        :disabled="submitting"
        aria-label="Précédent"
        @click="router.push('/register/step-1')"
      >
        <ChevronLeft :size="16" />
      </button>
      <button
        type="button"
        class="btn btn-primary flex-1"
        :disabled="!canContinue"
        @click="onContinue"
      >
        Continuer
        <ArrowRight :size="14" />
      </button>
    </template>
  </WizardLayout>

  <MatchFoundDialog
    :matches="store.matches"
    :visible="dialogOpen"
    @confirm="onConfirmMatch"
    @reject="onRejectMatch"
    @close="onCloseBlockedMatch"
  />
</template>
