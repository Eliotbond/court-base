<script setup lang="ts">
/**
 * Settings → Informations du club.
 *
 * Cette vue regroupe deux cards :
 *   1. Identité du club (nom, code court, adresse, contact, logo)
 *   2. Infos bancaires (IBAN, BIC, titulaire, instructions)
 *
 * Architecture : aucune lecture/écriture Firestore directe — tout passe par
 * `useSettingsStore` (cf. `docs/frontend-desktop.md` §architecture en couches).
 */

import { onMounted, ref, watch } from 'vue'
import { Banknote, Building2, Check, Dribbble } from 'lucide-vue-next'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import { useSettingsStore } from '@/stores/settings'
import {
  BANKING_FIELD_LIMITS,
  formatIbanForDisplay,
  normalizeBic,
  normalizeIban,
  validateBic,
  validateIban,
} from '@/utils/banking'
import type { ClubAddress } from '@club-app/shared-types'

const store = useSettingsStore()

// L'utilisateur peut atterrir directement sur /settings/club via URL — on
// déclenche le load() au mount (idempotent côté store : `load()` rebatche les
// lectures, mais sur ce projet c'est ok ; le scaffold partagé peut aussi
// précharger).
onMounted(() => {
  void store.load()
})

// ---------------------------------------------------------------------------
// General — local form state hydrated from store. Watcher pour syncer après
// load() async.
// ---------------------------------------------------------------------------

interface GeneralForm {
  name: string
  shortCode: string
  addressLine: string
  contactEmail: string
  contactPhone: string
}

const generalForm = ref<GeneralForm>({
  name: '',
  shortCode: '',
  addressLine: '',
  contactEmail: '',
  contactPhone: '',
})

const generalErrors = ref<Partial<Record<keyof GeneralForm, string>>>({})

/** Reconstruit l'address line "Av. de la Forêt 12, 1010 Lausanne" depuis ClubAddress. */
function addressLineFrom(addr: ClubAddress | null): string {
  if (!addr) return ''
  const parts: string[] = []
  if (addr.street) parts.push(addr.street)
  const cityPart = [addr.zip, addr.city].filter(Boolean).join(' ')
  if (cityPart) parts.push(cityPart)
  return parts.join(', ')
}

/**
 * Parse "Street, ZIP City" → `ClubAddress`. Fallback : street = input entier
 * si format inattendu. `country` est conservé tel quel depuis le snapshot
 * existant (l'écran ne l'expose pas dans v1).
 */
function parseAddressLine(line: string, existing: ClubAddress | null): ClubAddress {
  const country = existing?.country ?? 'CH'
  const trimmed = line.trim()
  if (!trimmed) {
    return { street: '', city: '', zip: '', country }
  }
  const [streetPart, cityPart] = trimmed.split(',').map((s) => s.trim())
  if (!cityPart) {
    return { street: streetPart, city: '', zip: '', country }
  }
  const match = cityPart.match(/^(\d{4,5})\s+(.+)$/)
  if (match) {
    return { street: streetPart, zip: match[1], city: match[2], country }
  }
  return { street: streetPart, city: cityPart, zip: '', country }
}

watch(
  () => store.config,
  (config) => {
    if (config) {
      generalForm.value = {
        name: config.name,
        shortCode: config.shortCode,
        addressLine: addressLineFrom(config.address),
        contactEmail: config.contact.email,
        contactPhone: config.contact.phone,
      }
    }
  },
  { immediate: true, deep: true },
)

function validateGeneral(): boolean {
  const errors: Partial<Record<keyof GeneralForm, string>> = {}
  if (!generalForm.value.name.trim()) errors.name = 'Le nom du club est requis'
  if (!generalForm.value.shortCode.trim()) {
    errors.shortCode = 'Code court requis'
  } else if (!/^[a-z0-9-]+$/.test(generalForm.value.shortCode)) {
    errors.shortCode = 'Lowercase, chiffres, tirets uniquement'
  }
  if (
    generalForm.value.contactEmail.trim() &&
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(generalForm.value.contactEmail)
  ) {
    errors.contactEmail = 'Email invalide'
  }
  generalErrors.value = errors
  return Object.keys(errors).length === 0
}

async function saveGeneral(): Promise<void> {
  if (!validateGeneral()) return
  if (!store.config) return
  const addr = parseAddressLine(generalForm.value.addressLine, store.config.address)
  try {
    await store.saveClubInfo({
      name: generalForm.value.name.trim(),
      shortCode: generalForm.value.shortCode.trim(),
      address: addr,
      contact: {
        email: generalForm.value.contactEmail.trim(),
        phone: generalForm.value.contactPhone.trim(),
      },
    })
  } catch {
    /* error surfaced via store.error */
  }
}

function resetGeneral(): void {
  if (store.config) {
    generalForm.value = {
      name: store.config.name,
      shortCode: store.config.shortCode,
      addressLine: addressLineFrom(store.config.address),
      contactEmail: store.config.contact.email,
      contactPhone: store.config.contact.phone,
    }
    generalErrors.value = {}
  }
}

// ---------------------------------------------------------------------------
// Logo upload — file input caché, déclenché par le bouton "Remplacer".
//
// Validation locale : type image + taille < 2 MB (aligné avec storage.rules).
// Le store gère l'upload + le patch /config/club.logo + le cleanup ancien.
// ---------------------------------------------------------------------------

const logoInputRef = ref<HTMLInputElement | null>(null)
const logoUploading = ref(false)
const logoError = ref<string | null>(null)

const LOGO_MAX_BYTES = 2 * 1024 * 1024
const LOGO_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']

function triggerLogoPicker(): void {
  logoError.value = null
  logoInputRef.value?.click()
}

async function onLogoSelected(e: Event): Promise<void> {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0] ?? null
  // Reset le input pour permettre un re-pick du même fichier après une erreur.
  target.value = ''
  if (!file) return
  if (!LOGO_ACCEPTED_TYPES.includes(file.type)) {
    logoError.value = 'Format non supporté (PNG, JPG, SVG ou WebP attendu).'
    return
  }
  if (file.size > LOGO_MAX_BYTES) {
    logoError.value = 'Fichier trop volumineux (max 2 MB).'
    return
  }
  logoUploading.value = true
  try {
    await store.setLogo(file)
  } catch {
    logoError.value = store.error ?? "Erreur lors de l'upload."
  } finally {
    logoUploading.value = false
  }
}

async function removeLogo(): Promise<void> {
  logoError.value = null
  logoUploading.value = true
  try {
    await store.removeLogo()
  } catch {
    logoError.value = store.error ?? 'Erreur lors de la suppression.'
  } finally {
    logoUploading.value = false
  }
}

// ---------------------------------------------------------------------------
// Banking info — local form synced from `/config/club.banking`.
//
// Tous les champs sont optionnels (`null` côté schéma) ; on les manipule en
// string vide côté UI pour les InputText, puis on normalise au save :
//   - chaîne trimée non-vide → string
//   - chaîne trimée vide     → null
// Le bouton "Sauvegarder" persiste l'objet complet (ou `null` si tous les
// champs sont vides — pour permettre de "reset" la section).
// ---------------------------------------------------------------------------

interface BankingForm {
  iban: string
  bic: string
  bankName: string
  accountHolder: string
  paymentInstructions: string
}

const bankingForm = ref<BankingForm>({
  iban: '',
  bic: '',
  bankName: '',
  accountHolder: '',
  paymentInstructions: '',
})
const bankingErrors = ref<Partial<Record<keyof BankingForm, string>>>({})

watch(
  () => store.config?.banking,
  (banking) => {
    bankingForm.value = {
      // Affichage IBAN avec groupes de 4 (la forme canonique est sans espaces
      // côté base — cf. `normalizeIban` au save).
      iban: banking?.iban ? formatIbanForDisplay(banking.iban) : '',
      bic: banking?.bic ?? '',
      bankName: banking?.bankName ?? '',
      accountHolder: banking?.accountHolder ?? '',
      paymentInstructions: banking?.paymentInstructions ?? '',
    }
  },
  { immediate: true, deep: true },
)

/**
 * Validation du formulaire banking. Politique :
 *  - Tous les champs vides → OK (reset complet, persiste `banking: null`).
 *  - Dès qu'un champ est rempli, on impose le **minimum vital pour un virement** :
 *    IBAN valide + titulaire du compte (sinon le parent ne peut pas payer côté
 *    register, cf. `useClubStore.hasUsableBanking` dans `apps/courtbase-register`).
 *  - L'IBAN est validé strictement (format + longueur pays + mod-97).
 *  - Le BIC est validé strictement s'il est renseigné (format ISO 9362).
 *  - Les champs libres (bankName, accountHolder, paymentInstructions) sont
 *    bornés en longueur pour bloquer les paste accidentels.
 */
function validateBanking(): boolean {
  const errors: Partial<Record<keyof BankingForm, string>> = {}
  const f = bankingForm.value
  const allEmpty =
    !f.iban.trim() &&
    !f.bic.trim() &&
    !f.bankName.trim() &&
    !f.accountHolder.trim() &&
    !f.paymentInstructions.trim()
  if (allEmpty) {
    bankingErrors.value = {}
    return true
  }

  // IBAN — requis dès qu'un champ est rempli, validation stricte.
  const ibanErr = validateIban(f.iban)
  if (ibanErr) errors.iban = ibanErr

  // Titulaire — requis pour qu'un virement soit possible.
  if (!f.accountHolder.trim()) {
    errors.accountHolder = 'Titulaire du compte requis'
  } else if (f.accountHolder.trim().length > BANKING_FIELD_LIMITS.accountHolder) {
    errors.accountHolder = `Maximum ${BANKING_FIELD_LIMITS.accountHolder} caractères`
  }

  // BIC — optionnel mais strict si renseigné.
  const bicErr = validateBic(f.bic)
  if (bicErr) errors.bic = bicErr

  // bankName — borne uniquement.
  if (f.bankName.trim().length > BANKING_FIELD_LIMITS.bankName) {
    errors.bankName = `Maximum ${BANKING_FIELD_LIMITS.bankName} caractères`
  }

  // paymentInstructions — borne uniquement.
  if (f.paymentInstructions.trim().length > BANKING_FIELD_LIMITS.paymentInstructions) {
    errors.paymentInstructions = `Maximum ${BANKING_FIELD_LIMITS.paymentInstructions} caractères`
  }

  bankingErrors.value = errors
  return Object.keys(errors).length === 0
}

async function saveBanking(): Promise<void> {
  if (!validateBanking()) return
  const f = bankingForm.value
  const trim = (s: string): string | null => {
    const t = s.trim()
    return t.length === 0 ? null : t
  }
  // Normalisation : IBAN/BIC stockés en forme canonique (uppercase, sans
  // espaces) — la couche présentation reformate à l'affichage.
  const ibanCanon = trim(f.iban)
  const bicCanon = trim(f.bic)
  const banking = {
    iban: ibanCanon ? normalizeIban(ibanCanon) : null,
    bic: bicCanon ? normalizeBic(bicCanon) : null,
    bankName: trim(f.bankName),
    accountHolder: trim(f.accountHolder),
    paymentInstructions: trim(f.paymentInstructions),
  }
  const isAllNull =
    banking.iban === null &&
    banking.bic === null &&
    banking.bankName === null &&
    banking.accountHolder === null &&
    banking.paymentInstructions === null
  try {
    await store.saveBanking(isAllNull ? null : banking)
    // Re-sync du form sur la valeur normalisée (sans cela, l'utilisateur
    // verrait toujours sa saisie minuscule + espacée alors qu'on a persisté
    // la canonique).
    if (banking.iban) bankingForm.value.iban = formatIbanForDisplay(banking.iban)
    if (banking.bic) bankingForm.value.bic = banking.bic
  } catch {
    /* error surfaced via store.error */
  }
}

function resetBanking(): void {
  const banking = store.config?.banking
  bankingForm.value = {
    iban: banking?.iban ? formatIbanForDisplay(banking.iban) : '',
    bic: banking?.bic ?? '',
    bankName: banking?.bankName ?? '',
    accountHolder: banking?.accountHolder ?? '',
    paymentInstructions: banking?.paymentInstructions ?? '',
  }
  bankingErrors.value = {}
}

// ---------------------------------------------------------------------------
// Saved banner helpers (per-section) — version locale puisque la vue n'a que
// deux sections (`general` et `banking`).
// ---------------------------------------------------------------------------

function isSavingThis(section: 'general' | 'banking'): boolean {
  return store.savingSection === section
}

function isSavedThis(section: 'general' | 'banking'): boolean {
  return store.lastSaved === section
}
</script>

<template>
  <section class="p-6 space-y-6">
    <!-- ================= Page heading =================== -->
    <div class="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-[22px] font-semibold tracking-tight">
          Informations du club
        </h1>
        <p class="text-[13px] text-surface-500 mt-0.5">
          Identité du club et coordonnées bancaires.
        </p>
      </div>
    </div>

    <!-- ============ Card: Identité club (general) ============ -->
    <div class="card p-5 space-y-6">
      <div class="flex items-start gap-3">
        <span
          class="w-9 h-9 rounded-md bg-sky-50 text-sky-700 flex items-center justify-center shrink-0"
        >
          <Building2
            :size="16"
            :stroke-width="2"
          />
        </span>
        <div class="flex-1 min-w-0">
          <h2 class="text-[16px] font-semibold">
            Configuration générale
          </h2>
          <p class="text-[13px] text-surface-500">
            Identité du club, logo et coordonnées de contact.
          </p>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-6">
        <label class="block">
          <span class="text-[12px] text-surface-600">Nom du club</span>
          <InputText
            v-model="generalForm.name"
            class="mt-1 w-full"
            :invalid="!!generalErrors.name"
          />
          <span
            v-if="generalErrors.name"
            class="text-[11px] text-rose-600 mt-1 block"
          >
            {{ generalErrors.name }}
          </span>
        </label>
        <label class="block">
          <span class="text-[12px] text-surface-600">Code court (URL)</span>
          <InputText
            v-model="generalForm.shortCode"
            class="mt-1 w-full font-mono"
            :invalid="!!generalErrors.shortCode"
          />
          <span
            v-if="generalErrors.shortCode"
            class="text-[11px] text-rose-600 mt-1 block"
          >
            {{ generalErrors.shortCode }}
          </span>
        </label>
        <label class="block col-span-2">
          <span class="text-[12px] text-surface-600">Adresse principale</span>
          <InputText
            v-model="generalForm.addressLine"
            class="mt-1 w-full"
            placeholder="Av. de la Forêt 12, 1010 Lausanne"
          />
        </label>
        <label class="block">
          <span class="text-[12px] text-surface-600">Email contact</span>
          <InputText
            v-model="generalForm.contactEmail"
            class="mt-1 w-full"
            :invalid="!!generalErrors.contactEmail"
          />
          <span
            v-if="generalErrors.contactEmail"
            class="text-[11px] text-rose-600 mt-1 block"
          >
            {{ generalErrors.contactEmail }}
          </span>
        </label>
        <label class="block">
          <span class="text-[12px] text-surface-600">Téléphone</span>
          <InputText
            v-model="generalForm.contactPhone"
            class="mt-1 w-full"
          />
        </label>
      </div>

      <!-- Logo upload -->
      <div
        class="border border-surface-200 rounded-md p-4 bg-surface-50/40 flex items-center gap-4"
      >
        <div
          class="w-14 h-14 rounded-md overflow-hidden flex items-center justify-center bg-surface-100"
          :class="{ 'bg-emerald-600 text-white': !store.config?.logo }"
        >
          <img
            v-if="store.config?.logo"
            :src="store.config.logo"
            alt="Logo du club"
            class="w-full h-full object-contain"
          >
          <Dribbble
            v-else
            :size="28"
            :stroke-width="2"
          />
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-medium text-[14px]">
            Logo du club
          </div>
          <div class="text-[12px] text-surface-500">
            PNG, JPG, SVG ou WebP · max 2 MB · 512×512 recommandé
          </div>
          <div
            v-if="logoError"
            class="text-[11px] text-rose-600 mt-1"
          >
            {{ logoError }}
          </div>
        </div>
        <input
          ref="logoInputRef"
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp"
          class="hidden"
          @change="onLogoSelected"
        >
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="logoUploading"
          @click="triggerLogoPicker"
        >
          <template v-if="logoUploading">
            Envoi…
          </template>
          <template v-else>
            {{ store.config?.logo ? 'Remplacer' : 'Téléverser' }}
          </template>
        </button>
        <button
          v-if="store.config?.logo"
          type="button"
          class="btn btn-ghost btn-sm !text-rose-700"
          :disabled="logoUploading"
          @click="removeLogo"
        >
          Supprimer
        </button>
      </div>

      <!-- Footer actions -->
      <div
        class="pt-4 border-t border-surface-200 flex items-center gap-2 justify-end"
      >
        <span
          v-if="isSavedThis('general')"
          class="text-[12px] text-emerald-700 flex items-center gap-1 mr-auto"
        >
          <Check
            :size="14"
            :stroke-width="2"
          />
          Modifications enregistrées
        </span>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="isSavingThis('general')"
          @click="resetGeneral"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="isSavingThis('general')"
          @click="saveGeneral"
        >
          <template v-if="isSavingThis('general')">
            Sauvegarde…
          </template>
          <template v-else>
            Sauvegarder
          </template>
        </button>
      </div>
    </div>

    <!-- ============ Card: BANKING INFO (Infos bancaires) ============ -->
    <div class="card p-5 space-y-4">
      <div class="flex items-start gap-3">
        <span
          class="w-9 h-9 rounded-md bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0"
        >
          <Banknote
            :size="16"
            :stroke-width="2"
          />
        </span>
        <div class="flex-1 min-w-0">
          <h2 class="text-[16px] font-semibold">
            Infos bancaires
          </h2>
          <p class="text-[13px] text-surface-500">
            Coordonnées bancaires utilisées pour les emails de demande
            de paiement (cotisations) et l'écran de paiement côté inscription.
            Tant que l'IBAN n'est pas saisi, ces messages omettront la
            section "comment payer".
          </p>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <label class="block col-span-2">
          <span class="text-[12px] text-surface-600">IBAN</span>
          <InputText
            v-model="bankingForm.iban"
            class="mt-1 w-full font-mono"
            placeholder="CH00 0000 0000 0000 0000 0"
            :invalid="!!bankingErrors.iban"
          />
          <span
            v-if="bankingErrors.iban"
            class="text-[11px] text-rose-600 mt-1 block"
          >
            {{ bankingErrors.iban }}
          </span>
        </label>

        <label class="block">
          <span class="text-[12px] text-surface-600">BIC / SWIFT</span>
          <InputText
            v-model="bankingForm.bic"
            class="mt-1 w-full font-mono"
            placeholder="UBSWCHZH80A"
            :invalid="!!bankingErrors.bic"
          />
          <span
            v-if="bankingErrors.bic"
            class="text-[11px] text-rose-600 mt-1 block"
          >
            {{ bankingErrors.bic }}
          </span>
        </label>

        <label class="block">
          <span class="text-[12px] text-surface-600">Nom de la banque</span>
          <InputText
            v-model="bankingForm.bankName"
            class="mt-1 w-full"
            placeholder="UBS Switzerland AG"
            :invalid="!!bankingErrors.bankName"
          />
          <span
            v-if="bankingErrors.bankName"
            class="text-[11px] text-rose-600 mt-1 block"
          >
            {{ bankingErrors.bankName }}
          </span>
        </label>

        <label class="block col-span-2">
          <span class="text-[12px] text-surface-600">
            Titulaire du compte
            <span class="text-rose-600">*</span>
          </span>
          <InputText
            v-model="bankingForm.accountHolder"
            class="mt-1 w-full"
            placeholder="Nom de l'association"
            :invalid="!!bankingErrors.accountHolder"
          />
          <span
            v-if="bankingErrors.accountHolder"
            class="text-[11px] text-rose-600 mt-1 block"
          >
            {{ bankingErrors.accountHolder }}
          </span>
        </label>

        <label class="block col-span-2">
          <span class="text-[12px] text-surface-600">Instructions de paiement</span>
          <Textarea
            v-model="bankingForm.paymentInstructions"
            class="mt-1 w-full"
            rows="3"
            placeholder="Indiquer le prénom et le nom du joueur en référence du virement."
            :invalid="!!bankingErrors.paymentInstructions"
          />
          <span
            v-if="bankingErrors.paymentInstructions"
            class="text-[11px] text-rose-600 mt-1 block"
          >
            {{ bankingErrors.paymentInstructions }}
          </span>
          <span
            v-else
            class="text-[11px] text-surface-500 mt-1 block"
          >
            Texte libre concaténé après l'IBAN dans les emails / écran
            paiement.
          </span>
        </label>
      </div>

      <!-- Footer actions banking -->
      <div
        class="pt-4 border-t border-surface-200 flex items-center gap-2 justify-end"
      >
        <span
          v-if="isSavedThis('banking')"
          class="text-[12px] text-emerald-700 flex items-center gap-1 mr-auto"
        >
          <Check
            :size="14"
            :stroke-width="2"
          />
          Infos bancaires enregistrées
        </span>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="isSavingThis('banking')"
          @click="resetBanking"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="isSavingThis('banking')"
          @click="saveBanking"
        >
          <template v-if="isSavingThis('banking')">
            Sauvegarde…
          </template>
          <template v-else>
            Sauvegarder
          </template>
        </button>
      </div>
    </div>
  </section>
</template>
