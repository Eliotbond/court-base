<script setup lang="ts">
/**
 * `LicenseRequestForm` — vue parent du workflow "compléter ma demande de
 * licence" (Firestore réel).
 *
 * Pattern : page longue scrollable (pas un wizard), sections en cards style
 * `Account.vue`. Chaque section porte une mini-checklist (✓ vert si remplie,
 * cercle slate sinon) en haut à droite. Le bouton "Envoyer" en bas devient
 * actif quand toutes les sections obligatoires sont vertes.
 *
 * Données :
 *  - Source unique : `useLicenseRequestsStore().currentRequest`.
 *  - Member lié : récupéré via `members.repo#getLinkedMember` (lecture
 *    Firestore réelle, parce qu'il faut le `avs` actuel pour décider si la
 *    section AVS est nécessaire). Si le member n'est pas accessible, on
 *    dégrade : on demande l'AVS au parent (cas worst-case sans crash).
 *  - Persistance : chaque saisie/upload patche directement Firestore via le
 *    store (pas de bouton "enregistrer" intermédiaire). L'upload Storage
 *    précède le write Firestore — en cas d'échec on bascule la tile en
 *    `refused` avec le code d'erreur.
 *
 * Submit final : `submitRequest()` bascule status `pending_parent_docs →
 * parent_docs_submitted` + redirige Home après toast.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { FirebaseError } from 'firebase/app'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  Download,
  FileSignature,
  Hash,
  Info,
  ShieldCheck,
  Sparkles,
} from 'lucide-vue-next'
import type {
  ForeignPlayerContext,
  LicenseDocKind,
  Member,
} from '@club-app/shared-types'
import { useAuthStore } from '@/stores/auth'
import { useLicenseRequestsStore } from '@/stores/licenseRequests'
import { getLinkedMember } from '@/repositories/members.repo'
import { COUNTRIES, countryName } from '@/constants/countries'
import { licenseDocLabel } from '@/constants/licenseDocLabels'
import PassportUpload from '@/components/license-request/PassportUpload.vue'
import ForeignTransferBanner from '@/components/license-request/ForeignTransferBanner.vue'
import DocStatusBanner from '@/components/license-request/DocStatusBanner.vue'
import DocumentUploadTile, {
  type UploadState,
} from '@/components/wizard/DocumentUploadTile.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const store = useLicenseRequestsStore()

const requestId = computed(() => String(route.params.requestId ?? ''))

const loading = ref(true)
const notFound = ref(false)
const member = ref<Member | null>(null)

// =============================================================================
// State formulaire — initialisé depuis la request, persisté à chaque modif.
// =============================================================================

const avsInput = ref<string>('')
const idFront = ref<UploadState>({ kind: 'empty' })
const idBack = ref<UploadState>({ kind: 'empty' })
const previouslyLicensed = ref<boolean>(false)
const previousClubName = ref<string>('')
const previousCountry = ref<string>('CH')
const transferLetter = ref<UploadState>({ kind: 'empty' })
const hasCompetition = ref<boolean | null>(null)
const certified = ref<boolean>(false)
const submitting = ref(false)
const justSubmitted = ref(false)

// =============================================================================
// Dérivés
// =============================================================================

const request = computed(() => store.currentRequest)

/** Décide si l'AVS est demandé : member sans AVS OU `avs` listé dans requiredDocs. */
const avsRequired = computed(() => {
  const r = request.value
  if (r?.requiredDocs.includes('avs')) return true
  return !member.value?.avs
})

const memberAvs = computed(() => member.value?.avs ?? null)

const isInternational = computed(() => previousCountry.value !== 'CH')

const isMinor = computed(() => {
  const r = request.value
  if (r?.foreignPlayerContext) return r.foreignPlayerContext.isMinor
  const dob = member.value?.birthDate
  if (!dob) return false
  const ageMs = Date.now() - dob.seconds * 1000
  return ageMs < 18 * 365.25 * 24 * 3600 * 1000
})

const showSwissTransferSection = computed(
  () => previouslyLicensed.value && !isInternational.value,
)
const showForeignTransferSection = computed(
  () => previouslyLicensed.value && isInternational.value,
)

const foreignLevel = computed(
  () => request.value?.foreignPlayerContext?.level,
)

// =============================================================================
// Validations par section (pour mini-checklist + bouton submit).
// =============================================================================

const AVS_REGEX = /^756\.\d{4}\.\d{4}\.\d{2}$/

const avsValid = computed(() => {
  if (!avsRequired.value) return true
  if (memberAvs.value) return true
  return AVS_REGEX.test(avsInput.value.trim())
})

const idFrontDone = computed(() => idFront.value.kind === 'uploaded')
const idBackDone = computed(() => idBack.value.kind === 'uploaded')
const idDone = computed(() => idFrontDone.value && idBackDone.value)

const historyDone = computed(() => {
  if (!previouslyLicensed.value) return true
  return previousClubName.value.trim().length > 0 && Boolean(previousCountry.value)
})

const foreignDone = computed(() => {
  if (!showForeignTransferSection.value) return true
  return hasCompetition.value !== null
})

const certifiedDone = computed(() => certified.value)

const alreadySubmitted = computed(
  () => request.value?.status === 'parent_docs_submitted',
)

/**
 * `true` si la demande est en phase signature parent (trésorier a uploadé le
 * PDF à signer). Le parent télécharge, signe, et re-uploade. `parent_signed`
 * est inclus pour afficher le résumé "document signé envoyé" sans repasser
 * en formulaire d'édition.
 */
const isAwaitingSignature = computed(() => {
  const s = request.value?.status
  return s === 'awaiting_parent_signature' || s === 'parent_signed'
})

/**
 * `true` si la demande est dans un état où le parent n'a plus à interagir
 * avec le formulaire (post-submit, ou décision avancée coach/trésorier).
 * Cache le formulaire d'édition + le bouton submit en bas. Refus de coach
 * /trésorier sont gérés à part (`hasRefused`) car ils renvoient en
 * `pending_parent_docs`. La phase signature (`awaiting_parent_signature` /
 * `parent_signed`) est gérée à part via `isAwaitingSignature` car elle
 * requiert une action parent (download + re-upload).
 */
const isReadOnlyStatus = computed(() => {
  const s = request.value?.status
  return (
    s === 'parent_docs_submitted' ||
    s === 'coach_validated' ||
    s === 'form_confirmed' ||
    s === 'sent_paid' ||
    s === 'approved' ||
    s === 'rejected'
  )
})

// =============================================================================
// État global de review (PR2/PR3 — affichage refus + blocage submit).
// =============================================================================

/**
 * Liste les `LicenseDocKind` actuellement en `refused` côté coach OU
 * trésorier sur la demande en cours. Quand le parent re-uploade un doc, le
 * store reset `coachReview` + `treasurerReview` à `null` → l'entrée
 * disparaît de cette liste automatiquement.
 */
const refusedKinds = computed<LicenseDocKind[]>(() => {
  const r = request.value
  if (!r) return []
  return store.refusedDocsKinds(r.id)
})

const hasRefused = computed(() => refusedKinds.value.length > 0)

/** Sections groupées par doc kind — utilisé pour le scroll-to et l'aria-label. */
const refusedLabels = computed(() =>
  refusedKinds.value.map((k) => licenseDocLabel(k)),
)

type GlobalBanner = {
  kind: 'info' | 'success' | 'warn' | 'strong'
  title: string
  desc: string
  showAdminComment?: boolean
}

/**
 * Banner global posé en haut de la vue, dérivé du status de la request
 * (croisé avec l'agrégation des refus per-doc). Si des docs sont refusés —
 * peu importe le status global — on affiche la version "attention" pour
 * driver l'œil du parent vers ce qu'il a à faire.
 */
const globalBanner = computed<GlobalBanner | null>(() => {
  const r = request.value
  if (!r) return null

  if (hasRefused.value) {
    return {
      kind: 'strong',
      title: 'Des documents nécessitent votre attention',
      desc:
        refusedLabels.value.length === 1
          ? `« ${refusedLabels.value[0]} » a été refusé. Voir le détail plus bas et téléverser à nouveau.`
          : `${refusedLabels.value.length} documents ont été refusés. Voir le détail plus bas et les téléverser à nouveau.`,
    }
  }

  switch (r.status) {
    case 'pending_parent_docs':
    case 'pending':
      return {
        kind: 'info',
        title: 'Compléter votre demande',
        desc: 'Veuillez compléter les documents demandés ci-dessous puis envoyer la demande.',
      }
    case 'parent_docs_submitted':
      return {
        kind: 'success',
        title: 'Documents transmis',
        desc: 'Vos documents ont été transmis. Le coach va les examiner.',
      }
    case 'coach_validated':
      return {
        kind: 'success',
        title: 'Documents validés par le coach',
        desc: 'En attente de validation du trésorier du club.',
      }
    case 'awaiting_parent_signature':
      return {
        kind: 'info',
        title: 'Document de licence à signer',
        desc: 'Le trésorier a préparé votre document. Téléchargez-le, signez-le puis renvoyez la version signée.',
      }
    case 'parent_signed':
      return {
        kind: 'success',
        title: 'Document signé reçu',
        desc: 'Le trésorier va finaliser votre licence sous peu.',
      }
    case 'form_confirmed':
    case 'sent_paid':
      return {
        kind: 'info',
        title: 'Finalisation en cours',
        desc: 'Votre demande est en cours de traitement administratif par le club et la fédération.',
      }
    case 'approved':
      return {
        kind: 'success',
        title: 'Demande approuvée',
        desc: 'La licence sera émise après confirmation par la fédération.',
      }
    case 'rejected':
      return {
        kind: 'strong',
        title: 'Demande refusée',
        desc:
          r.adminComment?.trim()
            ? r.adminComment.trim()
            : 'La demande a été refusée. Contactez le club pour plus d\'informations.',
        showAdminComment: false,
      }
    default:
      return null
  }
})

const canSubmit = computed(
  () =>
    !alreadySubmitted.value &&
    !submitting.value &&
    !hasRefused.value &&
    avsValid.value &&
    idDone.value &&
    historyDone.value &&
    foreignDone.value &&
    certifiedDone.value,
)

/** Tooltip affiché sur le bouton submit selon le frein. */
const submitDisabledReason = computed<string | null>(() => {
  if (alreadySubmitted.value) return null
  if (hasRefused.value) {
    return 'Re-téléversez d\'abord les documents refusés ci-dessus.'
  }
  if (!certifiedDone.value) return 'Cochez la certification en bas pour continuer.'
  if (!idDone.value) return 'Téléversez le recto et le verso de la pièce d\'identité.'
  if (!avsValid.value) return 'Saisissez un numéro AVS valide (756.XXXX.XXXX.XX).'
  if (!historyDone.value) return 'Complétez l\'historique sportif (club + pays).'
  if (!foreignDone.value)
    return 'Indiquez si le joueur a participé à des compétitions à l\'étranger.'
  return null
})

// =============================================================================
// Hydratation : remplit le state local depuis la request + member.
// =============================================================================

function uploadStateFromRef(
  ref: { fileName: string; sizeBytes: number; storagePath: string } | null | undefined,
): UploadState {
  if (!ref) return { kind: 'empty' }
  return {
    kind: 'uploaded',
    fileName: ref.fileName,
    size: ref.sizeBytes,
    storagePath: ref.storagePath,
  }
}

function hydrateFromRequest(): void {
  const r = request.value
  if (!r) return

  // Documents uploadés.
  idFront.value = uploadStateFromRef(r.uploadedDocs.id_front ?? null)
  idBack.value = uploadStateFromRef(r.uploadedDocs.id_back ?? null)
  transferLetter.value = uploadStateFromRef(
    r.uploadedDocs.transfer_letter_swiss ?? null,
  )

  // AVS saisi précédemment.
  if (r.parentSubmittedAvs) {
    avsInput.value = r.parentSubmittedAvs
  }

  // Contexte étranger pré-chargé (posé soit par le coach à la création,
  // soit par le parent à une visite précédente).
  if (r.foreignPlayerContext) {
    previouslyLicensed.value = true
    previousCountry.value = r.foreignPlayerContext.previousCountry
    hasCompetition.value = r.foreignPlayerContext.hadCompetition
  }
}

// =============================================================================
// Persistance — patche Firestore au fil des saisies.
// =============================================================================

/** Debounce manuel pour l'input AVS (évite un write par frappe). */
let avsDebounceTimer: number | null = null

function scheduleAvsPersist(): void {
  if (!request.value) return
  if (avsDebounceTimer !== null) window.clearTimeout(avsDebounceTimer)
  avsDebounceTimer = window.setTimeout(() => {
    void persistAvs()
    avsDebounceTimer = null
  }, 500)
}

async function persistAvs(): Promise<void> {
  const r = request.value
  if (!r) return
  const value = avsInput.value.trim()
  // On ne pousse que si valide OU si on clear. Sinon : laisser le state local.
  if (value === '' || AVS_REGEX.test(value)) {
    try {
      await store.setParentAvs(r.id, value === '' ? null : value)
    } catch {
      // Erreur déjà loggée par le store.
    }
  }
}

async function persistForeignContext(): Promise<void> {
  const r = request.value
  if (!r) return
  if (!showForeignTransferSection.value) {
    // L'utilisateur a retiré le toggle ou changé pour la Suisse :
    // on nettoie le contexte étranger.
    if (r.foreignPlayerContext) {
      try {
        await store.setForeignContext(r.id, null)
      } catch {
        /* déjà loggé */
      }
    }
    return
  }
  const ctx: ForeignPlayerContext = {
    previousCountry: previousCountry.value,
    hadCompetition: hasCompetition.value,
    isMinor: isMinor.value,
    ...(foreignLevel.value ? { level: foreignLevel.value } : {}),
  }
  try {
    await store.setForeignContext(r.id, ctx)
  } catch {
    /* déjà loggé */
  }
}

// Watch AVS — debounce 500 ms.
watch(avsInput, scheduleAvsPersist)

// Watch contexte étranger — write immédiat à chaque changement résolu.
watch(
  [previouslyLicensed, previousCountry, hasCompetition],
  () => {
    void persistForeignContext()
  },
)

// =============================================================================
// Upload handlers — Storage réel via le store.
// =============================================================================

async function uploadFor(
  kind: 'id_front' | 'id_back' | 'transfer_letter_swiss',
  file: File,
  target: typeof idFront,
): Promise<void> {
  const r = request.value
  const uid = auth.authSnap?.uid
  if (!r || !uid) return
  target.value = { kind: 'uploading', fileName: file.name, progress: 50 }
  try {
    await store.uploadDoc({ requestId: r.id, kind, file, uid })
    // Le store met à jour `currentRequest` — on relit le ref depuis là pour
    // garder une seule source de vérité (storagePath / sizeBytes).
    const updated = request.value?.uploadedDocs[kind]
    target.value = uploadStateFromRef(updated ?? null)
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    target.value = {
      kind: 'refused',
      reason: `Échec de l'upload (${code}). Réessayez ou contactez le club.`,
    }
  }
}

async function removeUploadFor(
  kind: 'id_front' | 'id_back' | 'transfer_letter_swiss',
  target: typeof idFront,
): Promise<void> {
  const r = request.value
  if (!r) return
  try {
    await store.removeUploadedDoc(r.id, kind)
  } catch {
    /* déjà loggé */
  }
  target.value = { kind: 'empty' }
}

function onIdFrontPick(file: File): void {
  void uploadFor('id_front', file, idFront)
}
function onIdFrontRemove(): void {
  void removeUploadFor('id_front', idFront)
}
function onIdBackPick(file: File): void {
  void uploadFor('id_back', file, idBack)
}
function onIdBackRemove(): void {
  void removeUploadFor('id_back', idBack)
}

function onTransferPick(file: File): void {
  if (file.size > 10 * 1024 * 1024) {
    transferLetter.value = {
      kind: 'refused',
      reason: 'Fichier trop volumineux (max 10 Mo).',
    }
    return
  }
  void uploadFor('transfer_letter_swiss', file, transferLetter)
}
function onTransferRemove(): void {
  void removeUploadFor('transfer_letter_swiss', transferLetter)
}
function onTransferRetry(): void {
  transferLetter.value = { kind: 'empty' }
}

// =============================================================================
// Phase trésorier — download du PDF à signer + upload du PDF signé.
// =============================================================================

const signedUploadState = ref<UploadState>({ kind: 'empty' })
const downloadingSignable = ref(false)

/** True si le parent a déjà uploadé le PDF signé (status `parent_signed`). */
const signedDocUploaded = computed(() => {
  const r = request.value
  return Boolean(r?.signedDocStoragePath)
})

async function onDownloadSignable(): Promise<void> {
  const r = request.value
  if (!r?.signableDocStoragePath) return
  downloadingSignable.value = true
  try {
    const url = await store.resolveStorageUrl(r.signableDocStoragePath)
    window.open(url, '_blank', 'noopener')
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[LicenseRequestForm] download signable failed [${code}]`, err)
  } finally {
    downloadingSignable.value = false
  }
}

async function onSignedPick(file: File): Promise<void> {
  const r = request.value
  const uid = auth.authSnap?.uid
  if (!r || !uid) return
  if (file.size > 10 * 1024 * 1024) {
    signedUploadState.value = {
      kind: 'refused',
      reason: 'Fichier trop volumineux (max 10 Mo).',
    }
    return
  }
  signedUploadState.value = {
    kind: 'uploading',
    fileName: file.name,
    progress: 50,
  }
  try {
    await store.uploadSignedDoc({ requestId: r.id, file, uid })
    // Le store met à jour `currentRequest` — on bascule la tile en uploaded.
    const path = request.value?.signedDocStoragePath ?? ''
    signedUploadState.value = {
      kind: 'uploaded',
      fileName: file.name,
      size: file.size,
      storagePath: path,
    }
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    signedUploadState.value = {
      kind: 'refused',
      reason: `Échec de l'upload (${code}). Réessayez ou contactez le club.`,
    }
  }
}

function onSignedRetry(): void {
  signedUploadState.value = { kind: 'empty' }
}

// =============================================================================
// Lifecycle
// =============================================================================

onMounted(async () => {
  loading.value = true
  notFound.value = false
  try {
    const r = await store.loadRequest(requestId.value)
    if (!r) {
      notFound.value = true
      return
    }
    // Charger le member en parallèle — best-effort (peut échouer si rules).
    try {
      member.value = await getLinkedMember(r.memberId)
    } catch (err) {
      console.warn('[LicenseRequestForm] getLinkedMember failed', err)
      member.value = null
    }
    hydrateFromRequest()
  } finally {
    loading.value = false
  }
  // Si on revient sur une demande avec des refus, on focus l'œil dessus.
  await nextTick()
  if (hasRefused.value) scrollToFirstRefused()
})

// =============================================================================
// Actions
// =============================================================================

function goBack(): void {
  void router.push({ name: 'home' })
}

// Refs vers les sections qu'on peut vouloir scroller (cas refus).
const idSectionEl = ref<HTMLElement | null>(null)
const avsSectionEl = ref<HTMLElement | null>(null)
const transferSectionEl = ref<HTMLElement | null>(null)

/**
 * Scroll vers la section concernée par le 1er doc refusé. Appelé au mount
 * si la demande revient en `pending_parent_docs` avec un doc refusé : le
 * parent est posé directement à hauteur du problème.
 */
function scrollToFirstRefused(): void {
  const first = refusedKinds.value[0]
  if (!first) return
  const target =
    first === 'avs'
      ? avsSectionEl.value
      : first === 'transfer_letter_swiss'
        ? transferSectionEl.value
        : idSectionEl.value
  if (!target) return
  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

async function onSubmit(): Promise<void> {
  if (!canSubmit.value || !request.value) return
  submitting.value = true
  try {
    // Dernière persistance avant submit (couvre un AVS resté dans le debounce).
    if (avsDebounceTimer !== null) {
      window.clearTimeout(avsDebounceTimer)
      avsDebounceTimer = null
    }
    await persistAvs()
    await persistForeignContext()
    await store.submitRequest(request.value.id)
    justSubmitted.value = true
    window.setTimeout(() => {
      void router.push({ name: 'home' })
    }, 2000)
  } catch (err) {
    console.error('[LicenseRequestForm] submit failed', err)
  } finally {
    submitting.value = false
  }
}

// =============================================================================
// Formatters
// =============================================================================

const dateFmt = new Intl.DateTimeFormat('fr-CH', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

function formatDob(): string {
  const dob = member.value?.birthDate
  if (!dob) return '—'
  return dateFmt.format(new Date(dob.seconds * 1000))
}

function formatCreatedAt(): string {
  const r = request.value
  if (!r?.createdAt?.seconds) return ''
  return dateFmt.format(new Date(r.createdAt.seconds * 1000))
}

function memberFullName(): string {
  if (member.value) return `${member.value.firstName} ${member.value.lastName}`
  const r = request.value
  if (!r) return ''
  if (r.denorm) return `${r.denorm.memberFirstName} ${r.denorm.memberLastName}`
  return 'Joueur'
}

function teamLabel(): string {
  return request.value?.denorm?.teamName ?? '—'
}
</script>

<template>
  <div class="m-app">
    <!-- Header sticky -->
    <div class="m-header">
      <button
        type="button"
        class="btn btn-ghost btn-sm lrf__back"
        aria-label="Retour"
        @click="goBack"
      >
        <ArrowLeft :size="16" />
      </button>
      <div class="lrf__head-text">
        <div class="lrf__head-title">Compléter ma demande de licence</div>
        <div class="lrf__head-sub">
          {{ memberFullName() }}
        </div>
      </div>
    </div>

    <div class="m-content">
      <!-- Loading -->
      <div v-if="loading" class="lrf__loading">
        <div class="sk lrf__skeleton" />
        <div class="sk lrf__skeleton" />
      </div>

      <!-- 404 -->
      <div v-else-if="notFound" class="banner banner-strong lrf__notfound">
        <AlertTriangle :size="16" class="banner-icon" />
        <div>
          <div class="lrf__notfound-title">Demande introuvable</div>
          <p class="lrf__notfound-desc">
            Cette demande de licence n'existe pas ou n'est plus accessible.
          </p>
        </div>
      </div>

      <!-- Phase signature parent — télécharger + uploader le PDF signé -->
      <div v-else-if="isAwaitingSignature && request" class="lrf__sign">
        <div
          class="banner lrf__global-banner"
          :class="{
            'banner-info': !signedDocUploaded,
            'banner-success': signedDocUploaded,
          }"
        >
          <CheckCircle2
            v-if="signedDocUploaded"
            :size="16"
            class="banner-icon"
          />
          <Info v-else :size="16" class="banner-icon" />
          <div class="lrf__global-banner-body">
            <div class="lrf__global-banner-title">
              {{
                signedDocUploaded
                  ? 'Document signé envoyé'
                  : 'Document de licence à signer'
              }}
            </div>
            <p class="lrf__global-banner-desc">
              {{
                signedDocUploaded
                  ? 'Le trésorier va finaliser votre licence sous peu. Vous serez prévenu(e) dès qu\'elle sera émise.'
                  : 'Le trésorier a préparé votre document de licence. Téléchargez-le, signez-le, puis renvoyez la version signée.'
              }}
            </p>
          </div>
        </div>

        <!-- Étape 1 — télécharger -->
        <section class="card lrf__card">
          <header class="lrf__card-head">
            <div class="lrf__card-title">
              <Download :size="14" class="lrf__card-title-ic" />
              1. Télécharger le document
            </div>
            <CheckCircle2
              v-if="request.signableDocStoragePath"
              :size="16"
              class="lrf__check lrf__check--done"
            />
            <Circle v-else :size="16" class="lrf__check" />
          </header>
          <p class="lrf__helper-top">
            Téléchargez le PDF, imprimez-le, signez-le à la main puis scannez
            ou prenez une photo de la version signée.
          </p>
          <button
            type="button"
            class="btn btn-secondary btn-block"
            :disabled="!request.signableDocStoragePath || downloadingSignable"
            @click="onDownloadSignable"
          >
            <Download :size="16" />
            {{
              downloadingSignable
                ? 'Préparation…'
                : request.signableDocStoragePath
                  ? 'Télécharger le document à signer'
                  : 'Document non disponible'
            }}
          </button>
        </section>

        <!-- Étape 2 — re-uploader signé -->
        <section class="card lrf__card">
          <header class="lrf__card-head">
            <div class="lrf__card-title">
              <FileSignature :size="14" class="lrf__card-title-ic" />
              2. Renvoyer la version signée
            </div>
            <CheckCircle2
              v-if="signedDocUploaded"
              :size="16"
              class="lrf__check lrf__check--done"
            />
            <Circle v-else :size="16" class="lrf__check" />
          </header>
          <p class="lrf__helper-top">
            PDF, JPG ou PNG · Max 10 Mo. Vous pouvez prendre une photo de la
            page signée directement avec votre téléphone.
          </p>
          <DocumentUploadTile
            class="lrf__tile"
            label="Document signé"
            helper="Téléversez le PDF signé ou prenez une photo de la page signée."
            :file="signedUploadState"
            accept=".pdf,image/png,image/jpeg"
            @pick="onSignedPick"
            @retry="onSignedRetry"
          />
        </section>
      </div>

      <!-- Statut terminal ou en cours côté staff (pas d'édition possible) -->
      <div v-else-if="isReadOnlyStatus && request" class="lrf__readonly">
        <div
          class="banner lrf__readonly-banner"
          :class="{
            'banner-success':
              request.status === 'parent_docs_submitted' ||
              request.status === 'coach_validated' ||
              request.status === 'approved',
            'banner-info':
              request.status === 'form_confirmed' ||
              request.status === 'sent_paid',
            'banner-strong': request.status === 'rejected',
          }"
        >
          <CheckCircle2
            v-if="
              request.status === 'parent_docs_submitted' ||
              request.status === 'coach_validated' ||
              request.status === 'approved'
            "
            :size="16"
            class="banner-icon"
          />
          <Info
            v-else-if="
              request.status === 'form_confirmed' ||
              request.status === 'sent_paid'
            "
            :size="16"
            class="banner-icon"
          />
          <AlertTriangle v-else :size="16" class="banner-icon" />
          <div>
            <div class="lrf__readonly-title">
              {{
                request.status === 'parent_docs_submitted'
                  ? 'Demande transmise'
                  : request.status === 'coach_validated'
                    ? 'Documents validés par le coach'
                    : request.status === 'form_confirmed'
                      ? 'Document signé validé'
                      : request.status === 'sent_paid'
                        ? 'Demande envoyée à la fédération'
                        : request.status === 'approved'
                          ? 'Demande approuvée'
                          : 'Demande refusée'
              }}
            </div>
            <p class="lrf__readonly-desc">
              {{
                request.status === 'parent_docs_submitted'
                  ? "Vos documents sont en cours de validation par le coach. Vous recevrez un message dès qu'ils auront été vérifiés."
                  : request.status === 'coach_validated'
                    ? 'Le coach a validé vos documents. Le trésorier du club va maintenant les revoir avant émission de la licence.'
                    : request.status === 'form_confirmed'
                      ? "Votre document signé a été validé. Le trésorier prépare l'envoi à la fédération."
                      : request.status === 'sent_paid'
                        ? 'La demande a été transmise à la fédération. La licence sera émise dès confirmation.'
                        : request.status === 'approved'
                          ? 'Votre demande a été approuvée. La licence sera émise après confirmation par la fédération.'
                          : request.adminComment?.trim() ||
                            "La demande a été refusée. Contactez le club pour plus d'informations."
              }}
            </p>
          </div>
        </div>
      </div>

      <!-- Formulaire -->
      <template v-else-if="request">
        <!-- Banner global de statut (refus prioritaires) -->
        <div
          v-if="globalBanner"
          class="banner lrf__global-banner"
          :class="{
            'banner-info': globalBanner.kind === 'info',
            'banner-success': globalBanner.kind === 'success',
            'banner-warn': globalBanner.kind === 'warn',
            'banner-strong': globalBanner.kind === 'strong',
          }"
        >
          <CheckCircle2
            v-if="globalBanner.kind === 'success'"
            :size="16"
            class="banner-icon"
          />
          <AlertTriangle
            v-else-if="globalBanner.kind === 'strong' || globalBanner.kind === 'warn'"
            :size="16"
            class="banner-icon"
          />
          <Info v-else :size="16" class="banner-icon" />
          <div class="lrf__global-banner-body">
            <div class="lrf__global-banner-title">{{ globalBanner.title }}</div>
            <p class="lrf__global-banner-desc">{{ globalBanner.desc }}</p>
            <button
              v-if="hasRefused"
              type="button"
              class="btn btn-secondary btn-xs lrf__global-banner-cta"
              @click="scrollToFirstRefused"
            >
              Voir le premier document à corriger
            </button>
          </div>
        </div>

        <!-- Intro doux -->
        <p class="lrf__intro">
          Quelques informations sont nécessaires pour finaliser la licence
          fédérale de {{ request.denorm?.memberFirstName ?? 'votre joueur' }}.
          Comptez environ 5 minutes.
        </p>

        <!-- Section 1 — Identité joueur (read-only) -->
        <section class="card lrf__card">
          <header class="lrf__card-head">
            <div class="lrf__card-title">
              <Sparkles :size="14" class="lrf__card-title-ic" />
              Identité du joueur
            </div>
            <CheckCircle2 :size="16" class="lrf__check lrf__check--done" />
          </header>
          <div class="lrf__id-grid">
            <div class="lrf__id-row">
              <span class="lrf__id-label">Nom</span>
              <span class="lrf__id-value">{{ memberFullName() }}</span>
            </div>
            <div class="lrf__id-row">
              <span class="lrf__id-label">Date de naissance</span>
              <span class="lrf__id-value">{{ formatDob() }}</span>
            </div>
            <div class="lrf__id-row">
              <span class="lrf__id-label">Équipe</span>
              <span class="lrf__id-value">{{ teamLabel() }}</span>
            </div>
            <div class="lrf__id-row">
              <span class="lrf__id-label">Demandé le</span>
              <span class="lrf__id-value">{{ formatCreatedAt() }}</span>
            </div>
            <div class="lrf__id-row">
              <span class="lrf__id-label">Statut</span>
              <span
                class="pill"
                :class="{
                  'pill-rose': hasRefused,
                  'pill-amber':
                    !hasRefused && request.status === 'pending_parent_docs',
                  'pill-sky':
                    !hasRefused && request.status === 'parent_docs_submitted',
                  'pill-emerald':
                    !hasRefused &&
                    (request.status === 'coach_validated' ||
                      request.status === 'approved'),
                  'pill-slate': request.status === 'rejected',
                }"
              >
                {{
                  hasRefused
                    ? 'À corriger'
                    : request.status === 'pending_parent_docs'
                      ? 'À compléter'
                      : request.status === 'parent_docs_submitted'
                        ? 'En cours de validation'
                        : request.status === 'coach_validated'
                          ? 'Validé par le coach'
                          : request.status === 'approved'
                            ? 'Approuvée'
                            : request.status === 'rejected'
                              ? 'Refusée'
                              : 'À compléter'
                }}
              </span>
            </div>
          </div>
        </section>

        <!-- Section 2 — AVS (conditionnelle) -->
        <section
          v-if="avsRequired || memberAvs"
          ref="avsSectionEl"
          class="card lrf__card"
        >
          <header class="lrf__card-head">
            <div class="lrf__card-title">
              <Hash :size="14" class="lrf__card-title-ic" />
              Numéro AVS
            </div>
            <CheckCircle2
              v-if="avsValid"
              :size="16"
              class="lrf__check lrf__check--done"
            />
            <Circle v-else :size="16" class="lrf__check" />
          </header>
          <div v-if="memberAvs" class="lrf__avs-locked">
            <CheckCircle2 :size="14" />
            <span>AVS : <strong>{{ memberAvs }}</strong> (déjà renseigné)</span>
          </div>
          <template v-else>
            <label for="lrf-avs" class="label">Numéro AVS</label>
            <div class="input-wrap">
              <Hash class="input-icon" />
              <input
                id="lrf-avs"
                v-model="avsInput"
                type="text"
                class="input with-icon-left"
                placeholder="756.1234.5678.90"
                :class="{ error: avsInput.length > 0 && !avsValid }"
                inputmode="numeric"
                autocomplete="off"
              />
            </div>
            <p
              v-if="avsInput.length > 0 && !avsValid"
              class="helper-error"
            >
              Format attendu : <code>756.XXXX.XXXX.XX</code>.
            </p>
            <p v-else class="helper">
              Le numéro AVS figure sur votre carte d'assurance maladie suisse.
            </p>
          </template>
          <DocStatusBanner
            :doc-ref="request.uploadedDocs.avs ?? null"
            kind="avs"
          />
        </section>

        <!-- Section 3 — Pièce d'identité (recto/verso) -->
        <section ref="idSectionEl" class="card lrf__card">
          <header class="lrf__card-head">
            <div class="lrf__card-title">
              <ShieldCheck :size="14" class="lrf__card-title-ic" />
              Pièce d'identité
            </div>
            <CheckCircle2
              v-if="idDone"
              :size="16"
              class="lrf__check lrf__check--done"
            />
            <Circle v-else :size="16" class="lrf__check" />
          </header>
          <p class="lrf__helper-top">
            <strong>Passeport OU carte d'identité officielle uniquement.</strong>
            Le permis de conduire et le permis de séjour ne sont pas acceptés
            par Swiss Basketball.
          </p>
          <div class="lrf__id-uploads">
            <div class="lrf__id-upload-col">
              <PassportUpload
                v-model="idFront"
                label="Recto"
                side="front"
                @pick="onIdFrontPick"
                @remove="onIdFrontRemove"
              />
              <DocStatusBanner
                :doc-ref="request.uploadedDocs.id_front ?? null"
                kind="id_front"
              />
            </div>
            <div class="lrf__id-upload-col">
              <PassportUpload
                v-model="idBack"
                label="Verso"
                side="back"
                @pick="onIdBackPick"
                @remove="onIdBackRemove"
              />
              <DocStatusBanner
                :doc-ref="request.uploadedDocs.id_back ?? null"
                kind="id_back"
              />
            </div>
          </div>
        </section>

        <!-- Section 4 — Historique sportif -->
        <section class="card lrf__card">
          <header class="lrf__card-head">
            <div class="lrf__card-title">
              <Info :size="14" class="lrf__card-title-ic" />
              Historique sportif
            </div>
            <CheckCircle2
              v-if="historyDone"
              :size="16"
              class="lrf__check lrf__check--done"
            />
            <Circle v-else :size="16" class="lrf__check" />
          </header>
          <button
            type="button"
            class="lrf__toggle-row"
            :aria-pressed="previouslyLicensed"
            @click="previouslyLicensed = !previouslyLicensed"
          >
            <span class="lrf__toggle-label">
              Le joueur a déjà été licencié dans un autre club
            </span>
            <span class="toggle" :class="{ on: previouslyLicensed }" />
          </button>

          <div v-if="previouslyLicensed" class="lrf__history-fields">
            <div>
              <label for="lrf-prev-club" class="label">
                Nom du club précédent
              </label>
              <input
                id="lrf-prev-club"
                v-model="previousClubName"
                type="text"
                class="input"
                placeholder="Ex. BBC Bulle"
              />
            </div>
            <div>
              <label for="lrf-prev-country" class="label">Pays</label>
              <select
                id="lrf-prev-country"
                v-model="previousCountry"
                class="input"
              >
                <option v-for="c in COUNTRIES" :key="c.code" :value="c.code">
                  {{ c.name }}
                </option>
              </select>
              <p v-if="previousCountry !== 'CH'" class="helper">
                Pays détecté : <strong>{{ countryName(previousCountry) }}</strong>.
                Procédure FIBA gérée par le club (voir ci-dessous).
              </p>
            </div>
          </div>
        </section>

        <!-- Section 5 — Transfert national (Suisse) -->
        <section
          v-if="showSwissTransferSection"
          ref="transferSectionEl"
          class="card lrf__card"
        >
          <header class="lrf__card-head">
            <div class="lrf__card-title">
              <FileSignature :size="14" class="lrf__card-title-ic" />
              Lettre de sortie (transfert national)
            </div>
            <span class="pill pill-slate">Optionnel</span>
          </header>
          <div class="banner banner-warn lrf__warn">
            <AlertTriangle :size="14" class="banner-icon" />
            <div>
              <strong>Lettre de sortie requise</strong> — votre ancien club
              suisse doit la fournir. Vous pouvez l'uploader maintenant ou plus
              tard ; la licence ne sera validée qu'à réception de cette pièce.
            </div>
          </div>
          <DocumentUploadTile
            class="lrf__tile"
            label="Lettre de sortie (PDF ou image)"
            helper="Formats : PDF, JPG, PNG · Max 10 Mo."
            :file="transferLetter"
            accept=".pdf,image/png,image/jpeg"
            @pick="onTransferPick"
            @remove="onTransferRemove"
            @retry="onTransferRetry"
          />
          <DocStatusBanner
            :doc-ref="request.uploadedDocs.transfer_letter_swiss ?? null"
            kind="transfer_letter_swiss"
          />
        </section>

        <!-- Section 6 — Transfert international -->
        <section v-if="showForeignTransferSection" class="card lrf__card">
          <header class="lrf__card-head">
            <div class="lrf__card-title">
              <FileSignature :size="14" class="lrf__card-title-ic" />
              Transfert international
            </div>
            <CheckCircle2
              v-if="foreignDone"
              :size="16"
              class="lrf__check lrf__check--done"
            />
            <Circle v-else :size="16" class="lrf__check" />
          </header>

          <ForeignTransferBanner
            :has-competition="hasCompetition"
            :is-minor="isMinor"
            :level="foreignLevel"
          />

          <div class="lrf__competition-block">
            <div class="label">
              Le joueur a-t-il participé à des compétitions officielles à l'étranger ?
            </div>
            <div class="lrf__competition-choices">
              <button
                type="button"
                class="radio-card"
                :class="{ selected: hasCompetition === true }"
                @click="hasCompetition = true"
              >
                <span class="radio-dot" />
                <span>Oui</span>
              </button>
              <button
                type="button"
                class="radio-card"
                :class="{ selected: hasCompetition === false }"
                @click="hasCompetition = false"
              >
                <span class="radio-dot" />
                <span>Non</span>
              </button>
            </div>
            <p v-if="hasCompetition === null" class="helper">
              Sélectionnez pour permettre au club d'instruire votre dossier.
            </p>
          </div>
        </section>

        <!-- Section 7 — Certification & envoi -->
        <section class="card lrf__card">
          <header class="lrf__card-head">
            <div class="lrf__card-title">
              <ShieldCheck :size="14" class="lrf__card-title-ic" />
              Certification
            </div>
            <CheckCircle2
              v-if="certifiedDone"
              :size="16"
              class="lrf__check lrf__check--done"
            />
            <Circle v-else :size="16" class="lrf__check" />
          </header>
          <label class="lrf__certify-row">
            <input v-model="certified" type="checkbox" class="lrf__certify-cb" />
            <span class="lrf__certify-text">
              Je certifie que les informations fournies sont exactes et
              complètes. Toute omission, notamment d'une licence étrangère
              antérieure même en jeunesse, peut entraîner une amende FIBA
              imputée au club.
            </span>
          </label>
        </section>

        <!-- Toast inline post-submit -->
        <div v-if="justSubmitted" class="banner banner-success lrf__toast">
          <CheckCircle2 :size="16" class="banner-icon" />
          <span>
            Documents envoyés. L'administration validera dans les prochains jours.
          </span>
        </div>
      </template>
    </div>

    <!-- Bottom bar — bouton submit -->
    <div
      v-if="request && !isReadOnlyStatus && !isAwaitingSignature"
      class="m-bottom lrf__bottom"
    >
      <p
        v-if="submitDisabledReason"
        class="lrf__bottom-reason"
        role="status"
      >
        {{ submitDisabledReason }}
      </p>
      <button
        type="button"
        class="btn btn-primary btn-block"
        :disabled="!canSubmit"
        :title="submitDisabledReason ?? ''"
        :aria-disabled="!canSubmit"
        @click="onSubmit"
      >
        <ShieldCheck :size="16" />
        {{ submitting ? 'Envoi…' : 'Envoyer ma demande' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.lrf__back {
  height: 32px;
  width: 32px;
  padding: 0;
  border-radius: 8px;
}
.lrf__head-text {
  line-height: 1.2;
  flex: 1;
  min-width: 0;
}
.lrf__head-title {
  font-size: 13.5px;
  font-weight: 600;
  color: #0f172a;
}
.lrf__head-sub {
  font-size: 11.5px;
  color: #64748b;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lrf__loading {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.lrf__skeleton {
  height: 120px;
  border-radius: 12px;
}

.lrf__intro {
  font-size: 13px;
  color: #475569;
  margin: 4px 0 12px;
  line-height: 1.55;
}

.lrf__card {
  padding: 16px;
  margin-bottom: 14px;
}
.lrf__card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}
.lrf__card-title {
  font-size: 13.5px;
  font-weight: 600;
  color: #0f172a;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.lrf__card-title-ic {
  color: #64748b;
}
.lrf__check {
  color: #cbd5e1;
}
.lrf__check--done {
  color: #10b981;
}

.lrf__id-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.lrf__id-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}
.lrf__id-label {
  color: #64748b;
}
.lrf__id-value {
  color: #0f172a;
  font-weight: 500;
  text-align: right;
}

.lrf__avs-locked {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #ecfdf5;
  color: #047857;
  border: 1px solid #a7f3d0;
  font-size: 13px;
}

.lrf__helper-top {
  font-size: 12.5px;
  color: #475569;
  margin: 0 0 12px 0;
  line-height: 1.55;
}
.lrf__id-uploads {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
@media (max-width: 360px) {
  .lrf__id-uploads {
    grid-template-columns: 1fr;
  }
}
.lrf__id-upload-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.lrf__toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0;
  background: transparent;
  border: none;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
}
.lrf__toggle-label {
  font-size: 13px;
  color: #0f172a;
  flex: 1;
  margin-right: 12px;
}
.lrf__history-fields {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.lrf__warn {
  margin-bottom: 12px;
}
.lrf__tile {
  margin-top: 4px;
}

.lrf__competition-block {
  margin-top: 14px;
}
.lrf__competition-choices {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 8px;
}

.lrf__certify-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
}
.lrf__certify-cb {
  margin-top: 3px;
  width: 18px;
  height: 18px;
  accent-color: #10b981;
  flex: none;
}
.lrf__certify-text {
  font-size: 12.5px;
  color: #334155;
  line-height: 1.55;
}

.lrf__toast {
  margin-top: 16px;
}

.lrf__bottom {
  display: block;
}
.lrf__bottom-reason {
  margin: 0 0 8px;
  font-size: 11.5px;
  color: #be123c;
  line-height: 1.45;
  text-align: center;
}

.lrf__global-banner {
  margin-bottom: 12px;
  align-items: flex-start;
}
.lrf__global-banner-body {
  flex: 1;
  min-width: 0;
}
.lrf__global-banner-title {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
}
.lrf__global-banner-desc {
  font-size: 12px;
  margin: 4px 0 0;
  line-height: 1.55;
}
.lrf__global-banner-cta {
  margin-top: 8px;
}

.lrf__notfound,
.lrf__readonly-banner {
  margin-top: 4px;
  align-items: flex-start;
}
.lrf__notfound-title,
.lrf__readonly-title {
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.4;
}
.lrf__notfound-desc,
.lrf__readonly-desc {
  font-size: 12px;
  margin: 4px 0 0;
  line-height: 1.55;
}
.lrf__readonly {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.lrf__sign {
  display: flex;
  flex-direction: column;
  gap: 0;
}
</style>
