<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertCircle,
  ArrowRight,
  ChevronLeft,
  Globe,
  Info,
  Phone,
} from 'lucide-vue-next'
import InputText from 'primevue/inputtext'
import WizardLayout from '@/components/wizard/WizardLayout.vue'
import { useRegistrationsStore } from '@/stores/registrations'

/**
 * Step 5/8 — Contact + historique sportif.
 *
 * - Téléphone du joueur (optionnel, surtout pour les mineurs).
 * - Toggle "déjà licencié ailleurs" → sub-form (nom du club + à l'étranger).
 * - Routing conditionnel :
 *     • previouslyLicensed → step-6 (lettre de sortie),
 *     • sinon                → step-7 (info licence, on saute la lettre).
 *
 * Persiste via `useRegistrationsStore().patchDraft()` :
 *  - `player.phone` (root nullé si vide),
 *  - `previouslyLicensed`,
 *  - `previousClubName` (nullé si toggle off),
 *  - `previousClubAbroad` (false si toggle parent off).
 */

const router = useRouter()
const store = useRegistrationsStore()

// ---------------------------------------------------------------------------
// Local form state
// ---------------------------------------------------------------------------

const phone = ref('')
const previouslyLicensed = ref(false)
const previousClubName = ref('')
const previousClubAbroad = ref(false)

const submitting = ref(false)
const error = ref<string | null>(null)

// ---------------------------------------------------------------------------
// Mount — restaure le draft ou redirige si état perdu
// ---------------------------------------------------------------------------

onMounted(() => {
  const draft = store.currentDraft
  if (!draft) {
    router.replace('/register/step-1')
    return
  }
  phone.value = draft.player?.phone ?? ''
  previouslyLicensed.value = draft.previouslyLicensed ?? false
  previousClubName.value = draft.previousClubName ?? ''
  previousClubAbroad.value = draft.previousClubAbroad ?? false
})

// ---------------------------------------------------------------------------
// Persistence + nav
// ---------------------------------------------------------------------------

async function onContinue(): Promise<void> {
  if (submitting.value) return
  submitting.value = true
  error.value = null
  try {
    const trimmedPhone = phone.value.trim()
    const trimmedClub = previousClubName.value.trim()
    await store.patchDraft({
      player: { phone: trimmedPhone === '' ? null : trimmedPhone },
      previouslyLicensed: previouslyLicensed.value,
      previousClubName: previouslyLicensed.value
        ? trimmedClub === ''
          ? null
          : trimmedClub
        : null,
      previousClubAbroad: previouslyLicensed.value
        ? previousClubAbroad.value
        : false,
    })
    if (previouslyLicensed.value) {
      router.push('/register/step-6')
    } else {
      router.push('/register/step-7')
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    submitting.value = false
  }
}

function onBack(): void {
  router.back()
}
</script>

<template>
  <WizardLayout :current="5" title="Contact & historique">
    <div>
      <h1 class="text-[20px] font-semibold tracking-tight leading-snug">
        Coordonnées & historique
      </h1>
      <p class="text-[12.5px] text-slate-500 mt-1">
        Quelques informations pour faciliter la suite.
      </p>

      <div v-if="error" class="banner banner-strong mt-4" role="alert">
        <AlertCircle :size="14" />
        <span>{{ error }}</span>
      </div>

      <!-- Téléphone -->
      <div class="card p-4 mt-5">
        <label class="label" for="reg-phone">Téléphone du joueur</label>
        <div class="input-wrap">
          <Phone :size="16" />
          <InputText
            id="reg-phone"
            v-model="phone"
            type="tel"
            inputmode="tel"
            autocomplete="tel"
            placeholder="+41 79 XXX XX XX"
            class="input with-icon-left"
          />
        </div>
        <div class="helper">
          Le téléphone direct du joueur est utile pour les communications
          d'équipe (rappels matches, plannings). Si le joueur est mineur, vous
          pouvez laisser vide.
        </div>
      </div>

      <!-- Historique sportif -->
      <div class="card p-4 mt-4">
        <div class="flex items-start gap-3">
          <button
            type="button"
            class="toggle"
            :class="{ on: previouslyLicensed }"
            aria-label="Déjà licencié dans un autre club"
            style="margin-top: 2px"
            @click="previouslyLicensed = !previouslyLicensed"
          />
          <div class="flex-1">
            <div class="text-[13.5px] font-semibold text-slate-900">
              Le joueur a-t-il déjà été licencié dans un autre club ?
            </div>
            <div class="text-[12px] text-slate-500 mt-0.5">
              Active la procédure de transfert et la demande de lettre de
              sortie.
            </div>
          </div>
        </div>

        <div
          v-if="previouslyLicensed"
          class="border-t border-slate-100 mt-4 pt-4 space-y-4"
        >
          <div>
            <label class="label" for="reg-previous-club">
              Nom du club précédent
            </label>
            <InputText
              id="reg-previous-club"
              v-model="previousClubName"
              class="input"
              placeholder="Marly Basket, BBC Vevey…"
              autocomplete="organization"
            />
          </div>

          <div class="flex items-start gap-3">
            <button
              type="button"
              class="toggle"
              :class="{ on: previousClubAbroad }"
              aria-label="Club précédent à l'étranger"
              style="margin-top: 2px"
              @click="previousClubAbroad = !previousClubAbroad"
            />
            <div class="flex-1">
              <div class="text-[13px] font-medium text-slate-900">
                Ce club est-il à l'étranger ?
              </div>
              <div class="text-[11.5px] text-slate-500 mt-0.5">
                Activera une procédure de transfert international.
              </div>
            </div>
          </div>

          <div v-if="previousClubAbroad" class="banner banner-info">
            <Globe :size="14" />
            <span>
              Un transfert international nécessite une procédure spécifique —
              un admin du club vous contactera après votre inscription.
            </span>
          </div>
        </div>
      </div>

      <div class="helper mt-4 flex items-start gap-1.5">
        <Info :size="14" class="flex-none mt-0.5" />
        <span>
          Ces informations restent modifiables tant que l'inscription n'est
          pas soumise.
        </span>
      </div>
    </div>

    <template #footer>
      <button
        type="button"
        class="btn btn-secondary"
        :disabled="submitting"
        aria-label="Précédent"
        @click="onBack"
      >
        <ChevronLeft :size="16" />
      </button>
      <button
        type="button"
        class="btn btn-primary flex-1"
        :disabled="submitting"
        @click="onContinue"
      >
        Continuer
        <ArrowRight :size="14" />
      </button>
    </template>
  </WizardLayout>
</template>
