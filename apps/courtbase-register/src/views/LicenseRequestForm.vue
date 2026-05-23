<script setup lang="ts">
/**
 * `LicenseRequestForm` — vue parent du workflow "compléter ma demande de
 * licence" (mock-only).
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
 *  - Persistance : chaque saisie est patchée via `patchRequest` →
 *    sessionStorage immédiat (pas de bouton "enregistrer" intermédiaire).
 *
 * Submit final : `submitRequest()` bascule status + toast → redirect Home.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  FileSignature,
  Hash,
  Info,
  ShieldCheck,
  Sparkles,
} from 'lucide-vue-next'
import type { Member } from '@club-app/shared-types'
import { useLicenseRequestsStore } from '@/stores/licenseRequests'
import { getLinkedMember } from '@/repositories/members.repo'
import { COUNTRIES, countryName } from '@/constants/countries'
import PassportUpload, {
  type PassportUploadValue,
} from '@/components/license-request/PassportUpload.vue'
import ForeignTransferBanner from '@/components/license-request/ForeignTransferBanner.vue'
import DocumentUploadTile, {
  type UploadState,
} from '@/components/wizard/DocumentUploadTile.vue'

const route = useRoute()
const router = useRouter()
const store = useLicenseRequestsStore()

const requestId = computed(() => String(route.params.requestId ?? ''))

const loading = ref(true)
const notFound = ref(false)
const member = ref<Member | null>(null)

// =============================================================================
// State formulaire — initialisé depuis la request, persisté à chaque modif.
// =============================================================================

const avsInput = ref<string>('')
const idFront = ref<PassportUploadValue>({ kind: 'empty' })
const idBack = ref<PassportUploadValue>({ kind: 'empty' })
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
  // La section est toujours "OK" car le défaut "non licencié" est valide.
  // Si l'utilisateur dit oui : exiger nom de club + pays.
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

const canSubmit = computed(
  () =>
    !alreadySubmitted.value &&
    !submitting.value &&
    avsValid.value &&
    idDone.value &&
    historyDone.value &&
    foreignDone.value &&
    certifiedDone.value,
)

// =============================================================================
// Hydratation : remplit le state local depuis la request + member.
// =============================================================================

function hydrateFromRequest(): void {
  const r = request.value
  if (!r) return
  // AVS : si une saisie était persistée dans parentNotes JSON, on la lit.
  // Cas générique : on ne pré-remplit pas — l'AVS est saisi à la volée.

  // Uploaded docs → state local (le blob URL peut être perdu après refresh).
  const front = r.uploadedDocs.id_front
  if (front) {
    idFront.value = {
      kind: 'uploaded',
      file: {
        fileName: front.fileName,
        sizeBytes: front.sizeBytes,
        blobUrl: front.url,
        mimeType: 'image/*',
      },
    }
  }
  const back = r.uploadedDocs.id_back
  if (back) {
    idBack.value = {
      kind: 'uploaded',
      file: {
        fileName: back.fileName,
        sizeBytes: back.sizeBytes,
        blobUrl: back.url,
        mimeType: 'image/*',
      },
    }
  }
  const transfer = r.uploadedDocs.transfer_letter_swiss
  if (transfer) {
    transferLetter.value = {
      kind: 'uploaded',
      fileName: transfer.fileName,
      size: transfer.sizeBytes,
      storagePath: transfer.url,
    }
  }

  // Contexte étranger pré-chargé depuis la fixture.
  if (r.foreignPlayerContext) {
    previouslyLicensed.value = true
    previousCountry.value = r.foreignPlayerContext.previousCountry
    hasCompetition.value = r.foreignPlayerContext.hadCompetition
  }
}

// =============================================================================
// Persistance — patche la request à chaque modif significative.
// =============================================================================

function persistUploadedDocs(): void {
  const r = request.value
  if (!r) return
  const uploadedDocs: typeof r.uploadedDocs = { ...r.uploadedDocs }

  uploadedDocs.id_front =
    idFront.value.kind === 'uploaded'
      ? {
          url: idFront.value.file.blobUrl,
          fileName: idFront.value.file.fileName,
          sizeBytes: idFront.value.file.sizeBytes,
          uploadedAt: Date.now(),
        }
      : null

  uploadedDocs.id_back =
    idBack.value.kind === 'uploaded'
      ? {
          url: idBack.value.file.blobUrl,
          fileName: idBack.value.file.fileName,
          sizeBytes: idBack.value.file.sizeBytes,
          uploadedAt: Date.now(),
        }
      : null

  if (showSwissTransferSection.value && transferLetter.value.kind === 'uploaded') {
    uploadedDocs.transfer_letter_swiss = {
      url: transferLetter.value.storagePath,
      fileName: transferLetter.value.fileName,
      sizeBytes: transferLetter.value.size,
      uploadedAt: Date.now(),
    }
  } else {
    uploadedDocs.transfer_letter_swiss = null
  }

  store.patchRequest(r.id, { uploadedDocs })
}

function persistForeignContext(): void {
  const r = request.value
  if (!r) return
  if (showForeignTransferSection.value) {
    store.patchRequest(r.id, {
      foreignPlayerContext: {
        previousCountry: previousCountry.value,
        hadCompetition: hasCompetition.value,
        isMinor: isMinor.value,
        ...(foreignLevel.value ? { level: foreignLevel.value } : {}),
      },
    })
  }
}

// Watch les uploads + contexte étranger pour persister à la volée.
watch([idFront, idBack, transferLetter], persistUploadedDocs, { deep: true })
watch(
  [previouslyLicensed, previousCountry, hasCompetition],
  persistForeignContext,
  { deep: true },
)

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
})

// =============================================================================
// Actions
// =============================================================================

function goBack(): void {
  void router.push({ name: 'home' })
}

async function onSubmit(): Promise<void> {
  if (!canSubmit.value || !request.value) return
  submitting.value = true
  try {
    // Sécurité : on persiste une dernière fois avant submit.
    persistUploadedDocs()
    persistForeignContext()
    await store.submitRequest(request.value.id)
    justSubmitted.value = true
    // Petite latence pour laisser le toast lisible.
    window.setTimeout(() => {
      void router.push({ name: 'home' })
    }, 2000)
  } catch (err) {
    console.error('[LicenseRequestForm] submitRequest failed', err)
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
  if (!r) return ''
  return dateFmt.format(new Date(r.createdAt))
}

function memberFullName(): string {
  if (member.value) return `${member.value.firstName} ${member.value.lastName}`
  const r = request.value
  if (!r) return ''
  return `${r.denorm.memberFirstName} ${r.denorm.memberLastName}`
}

// Handlers DocumentUploadTile pour transfer letter (Suisse).
function onTransferPick(file: File): void {
  // Validation rapide identique à PassportUpload.
  if (file.size > 10 * 1024 * 1024) {
    transferLetter.value = {
      kind: 'refused',
      reason: 'Fichier trop volumineux (max 10 Mo).',
    }
    return
  }
  const blobUrl = URL.createObjectURL(file)
  transferLetter.value = {
    kind: 'uploaded',
    fileName: file.name,
    size: file.size,
    storagePath: blobUrl,
  }
}
function onTransferRemove(): void {
  if (transferLetter.value.kind === 'uploaded') {
    try {
      URL.revokeObjectURL(transferLetter.value.storagePath)
    } catch {
      /* noop */
    }
  }
  transferLetter.value = { kind: 'empty' }
}
function onTransferRetry(): void {
  transferLetter.value = { kind: 'empty' }
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

      <!-- Déjà soumise -->
      <div v-else-if="alreadySubmitted" class="banner banner-success lrf__submitted">
        <CheckCircle2 :size="16" class="banner-icon" />
        <div>
          <div class="lrf__submitted-title">Demande déjà transmise</div>
          <p class="lrf__submitted-desc">
            Vos documents sont en cours de validation par l'administration du
            club. Vous recevrez un message dès qu'ils auront été vérifiés.
          </p>
        </div>
      </div>

      <!-- Formulaire -->
      <template v-else-if="request">
        <!-- Intro doux -->
        <p class="lrf__intro">
          Quelques informations sont nécessaires pour finaliser la licence
          fédérale de {{ request.denorm.memberFirstName }}. Comptez environ 5 minutes.
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
              <span class="lrf__id-value">{{ request.denorm.teamName }}</span>
            </div>
            <div class="lrf__id-row">
              <span class="lrf__id-label">Demandé le</span>
              <span class="lrf__id-value">{{ formatCreatedAt() }}</span>
            </div>
            <div class="lrf__id-row">
              <span class="lrf__id-label">Statut</span>
              <span class="pill pill-amber">À compléter</span>
            </div>
          </div>
        </section>

        <!-- Section 2 — AVS (conditionnelle) -->
        <section v-if="avsRequired || memberAvs" class="card lrf__card">
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
        </section>

        <!-- Section 3 — Pièce d'identité (recto/verso) -->
        <section class="card lrf__card">
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
            <PassportUpload
              v-model="idFront"
              label="Recto"
              side="front"
            />
            <PassportUpload
              v-model="idBack"
              label="Verso"
              side="back"
            />
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
        <section v-if="showSwissTransferSection" class="card lrf__card">
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
    <div v-if="request && !alreadySubmitted" class="m-bottom lrf__bottom">
      <button
        type="button"
        class="btn btn-primary btn-block"
        :disabled="!canSubmit"
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

.lrf__notfound,
.lrf__submitted {
  margin-top: 4px;
  align-items: flex-start;
}
.lrf__notfound-title,
.lrf__submitted-title {
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.4;
}
.lrf__notfound-desc,
.lrf__submitted-desc {
  font-size: 12px;
  margin: 4px 0 0;
  line-height: 1.55;
}
</style>
