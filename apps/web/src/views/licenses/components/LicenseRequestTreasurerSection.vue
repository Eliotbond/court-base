<script setup lang="ts">
/**
 * Section "Workflow trésorier" — affichée dans la vue détail d'une demande
 * de licence (`/license-requests/:id`) pour les statuts `>= coach_validated`.
 *
 * Cf. brief : `docs/licenses/parent-completion-workflow.md` § "Phase trésorier".
 *
 * Architecture :
 *  - 5 étapes (`coach_validated → awaiting_parent_signature → parent_signed
 *    → form_confirmed → sent_paid → approved`).
 *  - Stepper visuel custom (5 dots/lignes avec libellés). Pas `PrimeVue Steps`
 *    car on a besoin d'afficher des cards d'action au-dessous de chaque étape
 *    active, ce que Steps ne permet pas naturellement.
 *  - Une seule card d'action visible à la fois — celle qui matche le
 *    `currentStep` dérivé du status. Pour les statuts terminaux (`approved` /
 *    `rejected`), banner d'état + récap des liens de docs.
 *  - Tous les uploads / callables passent par le store
 *    (`useLicenseRequestsStore`), jamais en direct.
 *
 * Gating (CRITIQUE) : ce composant n'est rendu par le parent QUE si le caller
 * est staff (`rootAdmin || admin || treasurer || secretary`). Aligné avec
 * les rôles de la route `/license-requests` et avec les callables backend
 * (`treasurerReviewLicenseDoc`, `validateLicenseRequest`,
 * `treasurerUploadSignableDoc`, etc.) qui acceptent tous le même set.
 *
 * Sécurité : try/catch dans les handlers ne fait que collecter les erreurs
 * (`bannerError`) ; le store fait déjà le catch enrichi `FirebaseError`.
 */
import { computed, ref, watch } from 'vue'
import { FirebaseError } from 'firebase/app'
import {
  CheckCircle2,
  Download,
  FileSignature,
  Inbox,
  Loader2,
  MailCheck,
  Receipt,
  ShieldCheck,
  TriangleAlert,
  XCircle,
} from 'lucide-vue-next'

import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'

import Pill from '@/components/ui/Pill.vue'
import { useLicenseRequestsStore } from '@/stores/licenseRequests'
import { getLicenseRequestFileDownloadUrl } from '@/repositories/licenseRequests.repo'
import type { LicenseRequest } from '@club-app/shared-types'

interface Props {
  request: LicenseRequest
}
const props = defineProps<Props>()

const store = useLicenseRequestsStore()

// ---------------------------------------------------------------------------
// Stepper — 5 étapes mappées au workflow trésorier.
// ---------------------------------------------------------------------------

type TreasurerStep = 1 | 2 | 3 | 4 | 5

interface StepDef {
  key: TreasurerStep
  label: string
  icon: typeof CheckCircle2
}

const STEPS: readonly StepDef[] = [
  { key: 1, label: 'Validé par le coach', icon: CheckCircle2 },
  { key: 2, label: 'Document à signer', icon: FileSignature },
  { key: 3, label: 'Document signé reçu', icon: Inbox },
  { key: 4, label: 'Envoyé + payé', icon: MailCheck },
  { key: 5, label: 'Licence approuvée', icon: ShieldCheck },
] as const

/**
 * Step "courant" — celle où une action est attendue. Pour les statuts
 * terminaux (`approved`/`rejected`), `currentStep` est positionné à 5 (la
 * dernière atteinte) pour afficher tout le stepper "fait" visuellement.
 */
const currentStep = computed<TreasurerStep>(() => {
  switch (props.request.status) {
    case 'coach_validated':
      return 2
    case 'awaiting_parent_signature':
      return 3
    case 'parent_signed':
      return 3
    case 'form_confirmed':
      return 4
    case 'sent_paid':
      return 5
    case 'approved':
    case 'rejected':
      return 5
    default:
      // Statuts antérieurs (pending_parent_docs, parent_docs_submitted,
      // pending legacy) : on n'affiche jamais cette section pour eux.
      return 1
  }
})

/**
 * Vrai si l'étape est "terminée" (donc visuellement validée dans le stepper).
 * On valide la step si l'on est passé strictement au-delà (`currentStep > k`)
 * — sauf cas particulier : sur `awaiting_parent_signature`, l'étape 2 (upload
 * du signable doc) est terminée mais l'étape 3 n'est pas encore active.
 */
function isStepDone(step: TreasurerStep): boolean {
  const s = props.request.status
  if (step === 1) return true // toujours fait dès qu'on rend cette section
  if (step === 2) {
    return s !== 'coach_validated' // upload signable doc fait
  }
  if (step === 3) {
    return (
      s === 'form_confirmed' || s === 'sent_paid' || s === 'approved'
    )
  }
  if (step === 4) {
    return s === 'sent_paid' || s === 'approved'
  }
  if (step === 5) {
    return s === 'approved'
  }
  return false
}

/** Vrai si l'étape est "active" — celle où on attend une action trésorier. */
function isStepActive(step: TreasurerStep): boolean {
  return currentStep.value === step && !isStepDone(step)
}

/**
 * Vrai si l'on doit montrer un état d'attente (pas d'action trésorier, on
 * attend le parent). Cas : status `awaiting_parent_signature` → step 3 montre
 * "en attente du parent".
 */
const isWaitingParent = computed<boolean>(
  () => props.request.status === 'awaiting_parent_signature',
)

// ---------------------------------------------------------------------------
// Terminal banners (approved / rejected)
// ---------------------------------------------------------------------------

const isApproved = computed(() => props.request.status === 'approved')
const isRejected = computed(() => props.request.status === 'rejected')

// ---------------------------------------------------------------------------
// Banners (erreurs + info inline). Pas de toast global (cf. décisions Tier 1).
// ---------------------------------------------------------------------------

const bannerError = ref<string | null>(null)
const bannerInfo = ref<string | null>(null)

function pushError(message: string): void {
  bannerError.value = message
  bannerInfo.value = null
}
function pushInfo(message: string): void {
  bannerInfo.value = message
  bannerError.value = null
}

// ---------------------------------------------------------------------------
// File pickers — état partagé par les deux actions (step 2 + step 4 proof).
// On utilise des `<input type="file">` cachés pilotés par boutons custom
// pour rester aligné sur les autres dialogs (pas de FileUpload PrimeVue qui
// embarque trop de styling/UX par défaut).
// ---------------------------------------------------------------------------

const MAX_BYTES = 5 * 1024 * 1024 // 5 Mo

const signableInput = ref<HTMLInputElement | null>(null)
const signableFile = ref<File | null>(null)
const isUploadingSignable = ref(false)

const proofInput = ref<HTMLInputElement | null>(null)
const proofFile = ref<File | null>(null)
const isMarkingSentPaid = ref(false)

function pickSignableFile(): void {
  bannerError.value = null
  signableInput.value?.click()
}
function onSignableSelected(ev: Event): void {
  const target = ev.target as HTMLInputElement
  const file = target.files?.[0] ?? null
  if (!file) {
    signableFile.value = null
    return
  }
  if (file.type !== 'application/pdf') {
    pushError('Le formulaire fédéral doit être un PDF.')
    target.value = ''
    return
  }
  if (file.size > MAX_BYTES) {
    pushError(
      `Fichier trop volumineux (${(file.size / (1024 * 1024)).toFixed(1)} Mo, max 5 Mo).`,
    )
    target.value = ''
    return
  }
  signableFile.value = file
}
function clearSignableFile(): void {
  signableFile.value = null
  if (signableInput.value) signableInput.value.value = ''
}

function pickProofFile(): void {
  bannerError.value = null
  proofInput.value?.click()
}
function onProofSelected(ev: Event): void {
  const target = ev.target as HTMLInputElement
  const file = target.files?.[0] ?? null
  if (!file) {
    proofFile.value = null
    return
  }
  const isPdf = file.type === 'application/pdf'
  const isImage = file.type.startsWith('image/')
  if (!isPdf && !isImage) {
    pushError('La preuve de paiement doit être un PDF ou une image.')
    target.value = ''
    return
  }
  if (file.size > MAX_BYTES) {
    pushError(
      `Fichier trop volumineux (${(file.size / (1024 * 1024)).toFixed(1)} Mo, max 5 Mo).`,
    )
    target.value = ''
    return
  }
  proofFile.value = file
}
function clearProofFile(): void {
  proofFile.value = null
  if (proofInput.value) proofInput.value.value = ''
}

// ---------------------------------------------------------------------------
// Step 2 — upload signable doc.
// ---------------------------------------------------------------------------

async function submitUploadSignable(): Promise<void> {
  if (!signableFile.value) {
    pushError('Sélectionnez un PDF avant de téléverser.')
    return
  }
  isUploadingSignable.value = true
  try {
    const res = await store.uploadSignableDoc(props.request.id, signableFile.value)
    if (res) {
      pushInfo('Document envoyé au parent, en attente de signature.')
      clearSignableFile()
    } else {
      pushError(`Échec de l'envoi (${store.error ?? 'erreur'}).`)
    }
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    pushError(`Échec de l'envoi (${code}).`)
  } finally {
    isUploadingSignable.value = false
  }
}

// ---------------------------------------------------------------------------
// Step 3 — confirm signed doc (parent_signed).
// ---------------------------------------------------------------------------

const signedNotes = ref('')
const signedNotesTrimmed = computed(() => signedNotes.value.trim())
const signedNotesTooLong = computed(() => signedNotesTrimmed.value.length > 500)
const isConfirmingSigned = ref(false)

async function submitConfirmSigned(): Promise<void> {
  if (signedNotesTooLong.value) {
    pushError('Notes trop longues (max 500 caractères).')
    return
  }
  isConfirmingSigned.value = true
  try {
    const res = await store.confirmSignedDoc(
      props.request.id,
      signedNotesTrimmed.value.length > 0 ? signedNotesTrimmed.value : null,
    )
    if (res) {
      pushInfo('Document validé, prêt pour envoi fédération.')
      signedNotes.value = ''
    } else {
      pushError(`Échec de la validation (${store.error ?? 'erreur'}).`)
    }
  } finally {
    isConfirmingSigned.value = false
  }
}

// ---------------------------------------------------------------------------
// Step 4 — mark sent + paid (form_confirmed → sent_paid).
//
// Permet aussi un re-upload de la preuve si on est déjà `sent_paid` mais que
// `paymentProofStoragePath` est `null` (workflow async — la preuve peut
// arriver après l'envoi du dossier fédéral).
// ---------------------------------------------------------------------------

const canMarkSentAndPaid = computed(
  () => props.request.status === 'form_confirmed',
)
const canReUploadProof = computed(
  () =>
    props.request.status === 'sent_paid' &&
    !props.request.paymentProofStoragePath,
)

async function submitMarkSentAndPaid(): Promise<void> {
  isMarkingSentPaid.value = true
  try {
    const res = await store.markSentAndPaid(props.request.id, proofFile.value)
    if (res) {
      pushInfo(
        'Licence créée et utilisable en match — en attente de confirmation fédération.',
      )
      clearProofFile()
    } else {
      pushError(`Échec (${store.error ?? 'erreur'}).`)
    }
  } finally {
    isMarkingSentPaid.value = false
  }
}

// ---------------------------------------------------------------------------
// Step 5 — finalize license (sent_paid → approved).
// ---------------------------------------------------------------------------

const licenseNumberInput = ref('')
const licenseNumberTrimmed = computed(() => licenseNumberInput.value.trim())
const canFinalize = computed(
  () =>
    props.request.status === 'sent_paid' &&
    licenseNumberTrimmed.value.length > 0 &&
    licenseNumberTrimmed.value.length <= 50,
)
const isFinalizing = ref(false)

async function submitFinalize(): Promise<void> {
  if (!canFinalize.value) return
  isFinalizing.value = true
  try {
    const res = await store.finalizeLicense(
      props.request.id,
      licenseNumberTrimmed.value,
    )
    if (res) {
      pushInfo(
        `Licence n° ${licenseNumberTrimmed.value} activée — le joueur est officiellement licencié.`,
      )
      licenseNumberInput.value = ''
    } else {
      pushError(`Échec de la finalisation (${store.error ?? 'erreur'}).`)
    }
  } finally {
    isFinalizing.value = false
  }
}

// ---------------------------------------------------------------------------
// Download URLs — résolus à la demande + cachés par storagePath.
// ---------------------------------------------------------------------------

const urlCache = ref<Map<string, string | null>>(new Map())
const urlLoading = ref<Set<string>>(new Set())

async function openDownload(storagePath: string | null): Promise<void> {
  if (!storagePath) return
  const cached = urlCache.value.get(storagePath)
  if (cached) {
    window.open(cached, '_blank', 'noopener')
    return
  }
  const next = new Set(urlLoading.value)
  next.add(storagePath)
  urlLoading.value = next
  try {
    const url = await getLicenseRequestFileDownloadUrl(storagePath)
    const updated = new Map(urlCache.value)
    updated.set(storagePath, url)
    urlCache.value = updated
    if (url) {
      window.open(url, '_blank', 'noopener')
    } else {
      pushError("Aperçu indisponible (vérifiez vos droits Storage).")
    }
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    pushError(`Aperçu indisponible (${code}).`)
  } finally {
    const updated = new Set(urlLoading.value)
    updated.delete(storagePath)
    urlLoading.value = updated
  }
}

function isUrlLoading(storagePath: string | null): boolean {
  return storagePath ? urlLoading.value.has(storagePath) : false
}

// ---------------------------------------------------------------------------
// Formatters.
// ---------------------------------------------------------------------------

const DATE_FMT = new Intl.DateTimeFormat('fr-CH', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function formatDate(
  ts: { seconds: number; nanoseconds: number } | null | undefined,
): string {
  if (!ts) return '—'
  const d = new Date(ts.seconds * 1000 + Math.floor(ts.nanoseconds / 1_000_000))
  return DATE_FMT.format(d)
}

function uidShort(uid: string | null | undefined): string {
  if (!uid) return '—'
  return uid.slice(0, 8)
}

// Reset notes / file pickers quand le request change (navigation détail).
watch(
  () => props.request.id,
  () => {
    bannerError.value = null
    bannerInfo.value = null
    signedNotes.value = ''
    licenseNumberInput.value = ''
    clearSignableFile()
    clearProofFile()
  },
)
</script>

<template>
  <section class="card p-5 space-y-4">
    <header class="flex items-center justify-between gap-3 flex-wrap">
      <h2 class="text-[14px] font-semibold tracking-tight flex items-center gap-2">
        <ShieldCheck
          :size="16"
          :stroke-width="2"
          class="text-violet-600"
        />
        Workflow trésorier
      </h2>
      <Pill
        v-if="isApproved"
        variant="emerald"
      >
        Licence active
      </Pill>
      <Pill
        v-else-if="isRejected"
        variant="rose"
      >
        Demande refusée
      </Pill>
      <Pill
        v-else
        variant="violet"
      >
        Étape {{ currentStep }}/5
      </Pill>
    </header>

    <!-- ===== Stepper visuel ===== -->
    <ol class="flex items-start gap-2 overflow-x-auto pb-1">
      <li
        v-for="(step, idx) in STEPS"
        :key="step.key"
        class="flex items-center gap-2 shrink-0"
      >
        <div
          class="flex flex-col items-center gap-1 min-w-[88px]"
          :class="[
            isStepDone(step.key)
              ? 'text-emerald-600'
              : isStepActive(step.key)
                ? 'text-violet-700'
                : 'text-surface-400',
          ]"
        >
          <span
            class="w-8 h-8 rounded-full border-2 inline-flex items-center justify-center"
            :class="[
              isStepDone(step.key)
                ? 'bg-emerald-50 border-emerald-500'
                : isStepActive(step.key)
                  ? 'bg-violet-50 border-violet-500'
                  : 'bg-surface-50 border-surface-200',
            ]"
          >
            <component
              :is="step.icon"
              :size="14"
              :stroke-width="2"
            />
          </span>
          <span class="text-[10.5px] text-center font-medium leading-tight">
            {{ step.label }}
          </span>
        </div>
        <div
          v-if="idx < STEPS.length - 1"
          class="w-6 h-px"
          :class="[
            isStepDone(step.key)
              ? 'bg-emerald-300'
              : 'bg-surface-200',
          ]"
        />
      </li>
    </ol>

    <!-- ===== Terminal banners ===== -->
    <div
      v-if="isApproved"
      class="card border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800 flex items-start gap-2"
    >
      <CheckCircle2
        :size="14"
        :stroke-width="2"
        class="mt-0.5 shrink-0"
      />
      <div class="space-y-0.5">
        <div class="font-semibold">
          Licence active — n° {{ props.request.licenseNumber ?? '—' }}
        </div>
        <div class="text-[11.5px]">
          Finalisée le {{ formatDate(props.request.licenseFinalizedAt) }}
          par {{ uidShort(props.request.licenseFinalizedByUid) }}.
        </div>
      </div>
    </div>
    <div
      v-else-if="isRejected"
      class="card border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800 flex items-start gap-2"
    >
      <TriangleAlert
        :size="14"
        :stroke-width="2"
        class="mt-0.5 shrink-0"
      />
      <div class="space-y-0.5">
        <div class="font-semibold">
          Demande refusée
        </div>
        <div
          v-if="props.request.adminComment"
          class="text-[11.5px]"
        >
          {{ props.request.adminComment }}
        </div>
      </div>
    </div>

    <!-- ===== Step 2 — Upload signable doc (coach_validated) ===== -->
    <div
      v-if="props.request.status === 'coach_validated'"
      class="card border-violet-200 bg-violet-50/40 p-4 space-y-3"
    >
      <div class="flex items-start gap-2">
        <FileSignature
          :size="16"
          :stroke-width="2"
          class="text-violet-600 mt-0.5 shrink-0"
        />
        <div class="space-y-1">
          <div class="text-[13px] font-semibold text-surface-800">
            Étape 2 — Préparer et téléverser le formulaire fédéral
          </div>
          <p class="text-[12px] text-surface-600">
            Préparez le formulaire fédéral pré-rempli, puis téléversez-le ici.
            Le parent recevra une notification pour le télécharger, signer, et
            le re-téléverser.
          </p>
        </div>
      </div>

      <input
        ref="signableInput"
        type="file"
        accept="application/pdf"
        class="hidden"
        @change="onSignableSelected"
      >

      <div class="flex items-center gap-2 flex-wrap">
        <Button
          size="small"
          severity="secondary"
          outlined
          :disabled="isUploadingSignable"
          @click="pickSignableFile"
        >
          {{ signableFile ? 'Changer de PDF' : 'Sélectionner un PDF' }}
        </Button>
        <span
          v-if="signableFile"
          class="text-[12px] text-surface-700 truncate max-w-[280px]"
        >
          {{ signableFile.name }}
          ({{ (signableFile.size / 1024).toFixed(0) }} ko)
        </span>
        <Button
          v-if="signableFile"
          size="small"
          severity="secondary"
          text
          :disabled="isUploadingSignable"
          @click="clearSignableFile"
        >
          Retirer
        </Button>
        <Button
          severity="success"
          size="small"
          :disabled="!signableFile || isUploadingSignable || store.actionPendingId !== null"
          aria-label="Téléverser et envoyer au parent"
          @click="submitUploadSignable"
        >
          <template #icon>
            <Loader2
              v-if="isUploadingSignable"
              :size="13"
              :stroke-width="2"
              class="animate-spin"
            />
          </template>
          <span :class="isUploadingSignable ? 'ml-1' : ''">
            Téléverser et envoyer au parent
          </span>
        </Button>
      </div>
    </div>

    <!-- ===== Step 3a — Waiting parent signature (awaiting_parent_signature) ===== -->
    <div
      v-if="isWaitingParent"
      class="card border-amber-200 bg-amber-50/40 p-4 space-y-3"
    >
      <div class="flex items-start gap-2">
        <Inbox
          :size="16"
          :stroke-width="2"
          class="text-amber-600 mt-0.5 shrink-0"
        />
        <div class="space-y-1">
          <div class="text-[13px] font-semibold text-surface-800">
            En attente du parent
          </div>
          <p class="text-[12px] text-surface-600">
            Le formulaire fédéral a été envoyé le
            {{ formatDate(props.request.signableDocUploadedAt) }}.
            Le parent doit le télécharger, signer, et le re-téléverser depuis
            l'app inscription.
          </p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <Button
          v-if="props.request.signableDocStoragePath"
          size="small"
          severity="secondary"
          outlined
          aria-label="Télécharger le formulaire envoyé"
          :loading="isUrlLoading(props.request.signableDocStoragePath)"
          @click="openDownload(props.request.signableDocStoragePath)"
        >
          <template #icon>
            <Download
              :size="13"
              :stroke-width="2"
            />
          </template>
          <span class="ml-1">Télécharger le formulaire envoyé</span>
        </Button>
      </div>
    </div>

    <!-- ===== Step 3b — Validate signed doc (parent_signed) ===== -->
    <div
      v-if="props.request.status === 'parent_signed'"
      class="card border-violet-200 bg-violet-50/40 p-4 space-y-3"
    >
      <div class="flex items-start gap-2">
        <Inbox
          :size="16"
          :stroke-width="2"
          class="text-violet-600 mt-0.5 shrink-0"
        />
        <div class="space-y-1 min-w-0">
          <div class="text-[13px] font-semibold text-surface-800">
            Étape 3 — Valider la conformité du document signé
          </div>
          <p class="text-[12px] text-surface-600">
            Le parent a re-téléversé le formulaire signé le
            {{ formatDate(props.request.signedDocUploadedAt) }}.
            Vérifiez la signature et la conformité avant de valider.
          </p>
        </div>
      </div>

      <div class="flex items-center gap-2 flex-wrap">
        <Button
          v-if="props.request.signedDocStoragePath"
          size="small"
          severity="secondary"
          outlined
          aria-label="Télécharger le document signé"
          :loading="isUrlLoading(props.request.signedDocStoragePath)"
          @click="openDownload(props.request.signedDocStoragePath)"
        >
          <template #icon>
            <Download
              :size="13"
              :stroke-width="2"
            />
          </template>
          <span class="ml-1">Télécharger le document signé</span>
        </Button>
      </div>

      <label class="block">
        <span class="text-[12px] text-surface-700">
          Notes (optionnel, max 500 caractères)
        </span>
        <Textarea
          v-model="signedNotes"
          class="mt-1 w-full"
          rows="3"
          :disabled="isConfirmingSigned"
          placeholder="Remarques internes (optionnel)"
        />
        <span
          class="text-[11px] num"
          :class="signedNotesTooLong ? 'text-rose-600' : 'text-surface-500'"
        >
          {{ signedNotesTrimmed.length }} / 500
        </span>
      </label>

      <div class="flex justify-end">
        <Button
          severity="success"
          size="small"
          :disabled="signedNotesTooLong || isConfirmingSigned || store.actionPendingId !== null"
          aria-label="Valider la conformité du document signé"
          @click="submitConfirmSigned"
        >
          <template #icon>
            <Loader2
              v-if="isConfirmingSigned"
              :size="13"
              :stroke-width="2"
              class="animate-spin"
            />
            <CheckCircle2
              v-else
              :size="13"
              :stroke-width="2"
            />
          </template>
          <span class="ml-1">Valider la conformité</span>
        </Button>
      </div>
    </div>

    <!-- ===== Step 4 — Mark sent + paid (form_confirmed → sent_paid) ===== -->
    <div
      v-if="canMarkSentAndPaid"
      class="card border-violet-200 bg-violet-50/40 p-4 space-y-3"
    >
      <div class="flex items-start gap-2">
        <MailCheck
          :size="16"
          :stroke-width="2"
          class="text-violet-600 mt-0.5 shrink-0"
        />
        <div class="space-y-1">
          <div class="text-[13px] font-semibold text-surface-800">
            Étape 4 — Marquer comme envoyé et payé
          </div>
          <p class="text-[12px] text-surface-600">
            Cochez quand vous avez envoyé le formulaire à Swiss Basketball et
            effectué le paiement. Une licence pending sera créée — le coach
            pourra l'utiliser en match dès maintenant. La preuve de paiement
            est optionnelle (peut être ajoutée plus tard).
          </p>
        </div>
      </div>

      <input
        ref="proofInput"
        type="file"
        accept="application/pdf,image/*"
        class="hidden"
        @change="onProofSelected"
      >

      <div class="flex items-center gap-2 flex-wrap">
        <Button
          size="small"
          severity="secondary"
          outlined
          :disabled="isMarkingSentPaid"
          @click="pickProofFile"
        >
          {{ proofFile ? 'Changer la preuve' : 'Sélectionner une preuve (optionnel)' }}
        </Button>
        <span
          v-if="proofFile"
          class="text-[12px] text-surface-700 truncate max-w-[260px]"
        >
          {{ proofFile.name }} ({{ (proofFile.size / 1024).toFixed(0) }} ko)
        </span>
        <Button
          v-if="proofFile"
          size="small"
          severity="secondary"
          text
          :disabled="isMarkingSentPaid"
          @click="clearProofFile"
        >
          Retirer
        </Button>
      </div>

      <div class="flex justify-end">
        <Button
          severity="success"
          size="small"
          :disabled="isMarkingSentPaid || store.actionPendingId !== null"
          aria-label="Marquer comme envoyé et payé"
          @click="submitMarkSentAndPaid"
        >
          <template #icon>
            <Loader2
              v-if="isMarkingSentPaid"
              :size="13"
              :stroke-width="2"
              class="animate-spin"
            />
          </template>
          <span :class="isMarkingSentPaid ? 'ml-1' : ''">
            Marquer comme envoyé et payé
          </span>
        </Button>
      </div>
    </div>

    <!-- ===== Step 4b — Re-upload payment proof (sent_paid + no proof yet) ===== -->
    <div
      v-if="canReUploadProof"
      class="card border-amber-200 bg-amber-50/40 p-4 space-y-3"
    >
      <div class="flex items-start gap-2">
        <Receipt
          :size="16"
          :stroke-width="2"
          class="text-amber-600 mt-0.5 shrink-0"
        />
        <div class="space-y-1">
          <div class="text-[13px] font-semibold text-surface-800">
            Ajouter une preuve de paiement (optionnel)
          </div>
          <p class="text-[12px] text-surface-600">
            La demande a été marquée envoyée + payée sans preuve attachée.
            Vous pouvez en ajouter une maintenant pour la traçabilité comptable.
          </p>
        </div>
      </div>

      <input
        ref="proofInput"
        type="file"
        accept="application/pdf,image/*"
        class="hidden"
        @change="onProofSelected"
      >

      <div class="flex items-center gap-2 flex-wrap">
        <Button
          size="small"
          severity="secondary"
          outlined
          :disabled="isMarkingSentPaid"
          @click="pickProofFile"
        >
          {{ proofFile ? 'Changer la preuve' : 'Sélectionner une preuve' }}
        </Button>
        <span
          v-if="proofFile"
          class="text-[12px] text-surface-700 truncate max-w-[260px]"
        >
          {{ proofFile.name }} ({{ (proofFile.size / 1024).toFixed(0) }} ko)
        </span>
        <Button
          size="small"
          severity="secondary"
          :disabled="!proofFile || isMarkingSentPaid || store.actionPendingId !== null"
          @click="submitMarkSentAndPaid"
        >
          <template #icon>
            <Loader2
              v-if="isMarkingSentPaid"
              :size="13"
              :stroke-width="2"
              class="animate-spin"
            />
          </template>
          <span :class="isMarkingSentPaid ? 'ml-1' : ''">
            Ajouter la preuve
          </span>
        </Button>
      </div>
    </div>

    <!-- ===== Step 5 — Finalize license (sent_paid → approved) ===== -->
    <div
      v-if="props.request.status === 'sent_paid'"
      class="card border-violet-200 bg-violet-50/40 p-4 space-y-3"
    >
      <div class="flex items-start gap-2">
        <ShieldCheck
          :size="16"
          :stroke-width="2"
          class="text-violet-600 mt-0.5 shrink-0"
        />
        <div class="space-y-1">
          <div class="text-[13px] font-semibold text-surface-800">
            Étape 5 — Saisir le numéro de licence fédérale
          </div>
          <p class="text-[12px] text-surface-600">
            Saisissez le numéro renvoyé par Swiss Basketball. La licence
            passera en statut <em>active</em>, l'écriture comptable de la charge
            sera postée et le joueur sera officiellement licencié.
          </p>
        </div>
      </div>

      <label class="block max-w-md">
        <span class="text-[12px] text-surface-700">
          Numéro de licence (max 50 caractères)
        </span>
        <InputText
          v-model="licenseNumberInput"
          class="mt-1 w-full"
          maxlength="50"
          :disabled="isFinalizing"
          placeholder="ex. SBL-2025-12345"
        />
      </label>

      <div class="flex justify-end">
        <Button
          severity="success"
          size="small"
          :disabled="!canFinalize || isFinalizing || store.actionPendingId !== null"
          aria-label="Finaliser la licence"
          @click="submitFinalize"
        >
          <template #icon>
            <Loader2
              v-if="isFinalizing"
              :size="13"
              :stroke-width="2"
              class="animate-spin"
            />
            <ShieldCheck
              v-else
              :size="13"
              :stroke-width="2"
            />
          </template>
          <span class="ml-1">Finaliser la licence</span>
        </Button>
      </div>
    </div>

    <!-- ===== Historique / téléchargements (toujours visible si docs présents) ===== -->
    <div
      v-if="
        props.request.signableDocStoragePath ||
          props.request.signedDocStoragePath ||
          props.request.paymentProofStoragePath
      "
      class="border-t border-surface-200 pt-3 space-y-2"
    >
      <div class="text-[11px] text-surface-500 uppercase tracking-wide">
        Documents trésorier
      </div>
      <ul class="space-y-1.5 text-[12.5px]">
        <li
          v-if="props.request.signableDocStoragePath"
          class="flex items-center justify-between gap-3 flex-wrap"
        >
          <div class="flex items-center gap-2 min-w-0">
            <FileSignature
              :size="13"
              :stroke-width="2"
              class="text-surface-500"
            />
            <span class="text-surface-700">Formulaire fédéral (envoyé)</span>
            <span class="text-surface-500 text-[11.5px]">
              {{ formatDate(props.request.signableDocUploadedAt) }}
            </span>
          </div>
          <Button
            size="small"
            severity="secondary"
            text
            :loading="isUrlLoading(props.request.signableDocStoragePath)"
            @click="openDownload(props.request.signableDocStoragePath)"
          >
            <template #icon>
              <Download
                :size="12"
                :stroke-width="2"
              />
            </template>
            <span class="ml-1">Télécharger</span>
          </Button>
        </li>
        <li
          v-if="props.request.signedDocStoragePath"
          class="flex items-center justify-between gap-3 flex-wrap"
        >
          <div class="flex items-center gap-2 min-w-0">
            <Inbox
              :size="13"
              :stroke-width="2"
              class="text-surface-500"
            />
            <span class="text-surface-700">Formulaire signé (parent)</span>
            <span class="text-surface-500 text-[11.5px]">
              {{ formatDate(props.request.signedDocUploadedAt) }}
            </span>
          </div>
          <Button
            size="small"
            severity="secondary"
            text
            :loading="isUrlLoading(props.request.signedDocStoragePath)"
            @click="openDownload(props.request.signedDocStoragePath)"
          >
            <template #icon>
              <Download
                :size="12"
                :stroke-width="2"
              />
            </template>
            <span class="ml-1">Télécharger</span>
          </Button>
        </li>
        <li
          v-if="props.request.paymentProofStoragePath"
          class="flex items-center justify-between gap-3 flex-wrap"
        >
          <div class="flex items-center gap-2 min-w-0">
            <Receipt
              :size="13"
              :stroke-width="2"
              class="text-surface-500"
            />
            <span class="text-surface-700">Preuve de paiement</span>
            <span class="text-surface-500 text-[11.5px]">
              {{ formatDate(props.request.paymentProofUploadedAt) }}
            </span>
          </div>
          <Button
            size="small"
            severity="secondary"
            text
            :loading="isUrlLoading(props.request.paymentProofStoragePath)"
            @click="openDownload(props.request.paymentProofStoragePath)"
          >
            <template #icon>
              <Download
                :size="12"
                :stroke-width="2"
              />
            </template>
            <span class="ml-1">Télécharger</span>
          </Button>
        </li>
      </ul>
      <div
        v-if="props.request.treasurerNotes"
        class="text-[12px] text-surface-600 bg-surface-50 border border-surface-200 rounded px-3 py-2"
      >
        <div class="text-[11px] text-surface-500 uppercase tracking-wide mb-0.5">
          Notes trésorier
        </div>
        {{ props.request.treasurerNotes }}
      </div>
    </div>

    <!-- ===== Banners inline ===== -->
    <div
      v-if="bannerError"
      class="card border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700 flex items-center gap-2"
    >
      <XCircle
        :size="14"
        :stroke-width="2"
      />
      {{ bannerError }}
    </div>
    <div
      v-if="bannerInfo"
      class="card border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-700 flex items-start gap-2"
    >
      <CheckCircle2
        :size="14"
        :stroke-width="2"
        class="mt-0.5 shrink-0"
      />
      {{ bannerInfo }}
    </div>
  </section>
</template>
