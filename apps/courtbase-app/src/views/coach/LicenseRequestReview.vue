<script setup lang="ts">
/**
 * Vue coach — Détail "Validation des documents" (PR2 UI).
 *
 * Pour une demande `/licenseRequests/{id}` en `status: parent_docs_submitted` :
 *  - Affiche le récap joueur / équipe / date.
 *  - Pour chaque `requiredDocs[kind]` : card avec méta fichier, aperçu (lien
 *    download Storage), état coachReview, boutons Valider / Refuser.
 *  - Dialog motif refus (textarea ≥5 / ≤500).
 *  - Quand TOUS les docs sont validés via la callable, la demande passe en
 *    `coach_validated` côté serveur → toast info + retour à la liste.
 *
 * Architecture en couches : aucune dépendance directe à Firestore — le store
 * gère le call callable et l'optimistic update.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  CreditCard,
  Eye,
  FileText,
  Globe2,
  Info,
  X,
} from 'lucide-vue-next'

import CbBanner from '@/components/ui/CbBanner.vue'
import CbBottomBar from '@/components/ui/CbBottomBar.vue'
import CbEmptyState from '@/components/ui/CbEmptyState.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbPill from '@/components/ui/CbPill.vue'
import { countryName } from '@/constants/countries'
import { useAuthStore } from '@/stores/auth'
import { useLicenseRequestsStore } from '@/stores/licenseRequests'
import { getLicenseDocDownloadUrl } from '@/repositories/licenseRequests.repo'
import { getMember as getMemberReal } from '@/repositories/members.repo'
import type { MockMember } from '@/types/mock'
import type {
  ForeignPlayerContext,
  LicenseDocKind,
  LicenseRequest,
  UploadedDocRef,
} from '@club-app/shared-types'
import { Camera } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const licenseRequestsStore = useLicenseRequestsStore()

void auth // évite unused — sert pour de futures gates rôle/notifs.

// ─── Param + chargement ──────────────────────────────────────────
const requestId = computed<string>(() => {
  const raw = route.params['requestId']
  return Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
})

const request = ref<LicenseRequest | null>(null)
const loadingRequest = ref(true)
const lastErrorBanner = ref<string | null>(null)

// ─── Member lié (pour gate photo licence, cf. license-photo.md) ──
const member = ref<MockMember | null>(null)

async function reloadRequest(): Promise<void> {
  if (!requestId.value) {
    request.value = null
    member.value = null
    loadingRequest.value = false
    return
  }
  loadingRequest.value = true
  try {
    request.value = await licenseRequestsStore.getPendingReview(requestId.value)
    // Charge le member lié en parallèle pour évaluer le gate photo licence.
    const lr = request.value
    if (lr?.memberId) {
      member.value = await getMemberReal(lr.memberId)
    } else {
      member.value = null
    }
  } catch (err) {
    console.error('[license-request-review] load failed', err)
    request.value = null
    member.value = null
  } finally {
    loadingRequest.value = false
  }
}

onMounted(reloadRequest)
watch(() => requestId.value, reloadRequest)

// ─── Gate photo licence (cf. docs/members/license-photo.md) ──────
//
// Règle : tant que `member.photoStoragePath == null`, le coach ne peut
// pas valider les documents (le serveur rejettera la transition
// `coach_validated`). On désactive TOUS les "Valider" — plus simple à
// raisonner que de calculer le "dernier validation". Les refus restent
// possibles (un coach peut renvoyer un doc même sans photo).
const photoMissing = computed<boolean>(() => {
  if (!member.value) return false // pas encore chargé — laisser l'UI activée
  return !member.value.photoStoragePath
})

const PHOTO_TOOLTIP = 'Photo membre requise'

function goToMemberDetail(): void {
  const m = member.value
  if (!m) return
  void router.push({ name: 'member', params: { memberId: m.id } })
}

// ─── Helpers UI ──────────────────────────────────────────────────
const DOC_LABELS: Record<LicenseDocKind, string> = {
  id_front: "Carte d'identité (recto)",
  id_back: "Carte d'identité (verso)",
  avs: 'Numéro AVS',
  transfer_letter_swiss: 'Lettre de sortie du club précédent',
}

function memberFullName(lr: LicenseRequest): string {
  if (lr.denorm) return `${lr.denorm.memberFirstName} ${lr.denorm.memberLastName}`
  return 'Joueur'
}

function teamLabel(lr: LicenseRequest): string {
  return lr.denorm?.teamName ?? 'Équipe inconnue'
}

function tsToMs(ts: unknown): number {
  if (!ts) return 0
  const t = ts as { seconds?: number; toMillis?: () => number }
  if (typeof t.toMillis === 'function') return t.toMillis()
  if (typeof t.seconds === 'number') return t.seconds * 1000
  return 0
}

const DATE_FMT_FULL = new Intl.DateTimeFormat('fr-CH', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

const DATE_FMT_SHORT = new Intl.DateTimeFormat('fr-CH', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function formatLongDate(ms: number): string {
  if (!ms) return '—'
  return DATE_FMT_FULL.format(new Date(ms))
}

function formatShortDateTime(ms: number): string {
  if (!ms) return '—'
  return DATE_FMT_SHORT.format(new Date(ms))
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} o`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(0)} ko`
  return `${(kb / 1024).toFixed(2)} Mo`
}

// ─── Documents requis (ordre stable de `requiredDocs`) ───────────
interface DocEntry {
  kind: LicenseDocKind
  label: string
  doc: UploadedDocRef | null
}

const docEntries = computed<DocEntry[]>(() => {
  if (!request.value) return []
  return request.value.requiredDocs.map((kind) => ({
    kind,
    label: DOC_LABELS[kind] ?? kind,
    doc: request.value!.uploadedDocs[kind] ?? null,
  }))
})

const acceptedCount = computed<number>(() => {
  return docEntries.value.filter((e) => e.doc?.coachReview?.decision === 'accepted').length
})

const totalDocsCount = computed<number>(() => docEntries.value.length)

const allAccepted = computed<boolean>(
  () => totalDocsCount.value > 0 && acceptedCount.value === totalDocsCount.value,
)

/**
 * "Terminal" côté coach = la demande a quitté le périmètre du coach et ne
 * peut plus être actionnée ici. `pending_parent_docs` n'est PAS terminal :
 * c'est le statut après un (ou plusieurs) refus dans la même session — le
 * coach doit pouvoir continuer à refuser d'autres documents avant de quitter
 * la page (le backend `coachReviewLicenseDoc` accepte les refus enchaînés
 * en `pending_parent_docs` depuis le fix 2026-05-24, mais pas les accepts).
 */
const isTerminal = computed<boolean>(() => {
  if (!request.value) return false
  const s = request.value.status
  return s !== 'parent_docs_submitted' && s !== 'pending_parent_docs'
})

/**
 * `true` lorsque la demande est déjà retournée au parent (au moins un refus
 * a basculé le statut). Les boutons "Valider" sont alors désactivés (le
 * serveur refusera l'accept), mais les "Refuser" restent actifs pour
 * permettre d'enchaîner les refus sur les autres documents.
 */
const isReturnedToParent = computed<boolean>(() => {
  return request.value?.status === 'pending_parent_docs'
})

const ACCEPT_DISABLED_RETURNED_TOOLTIP =
  'Demande déjà retournée au parent — validation impossible tant qu\'il n\'a pas re-uploadé.'

// ─── Aperçu doc (download URL Storage) ──────────────────────────
const downloadUrlByKind = ref<Map<string, string | null>>(new Map())
const downloadLoadingByKind = ref<Set<string>>(new Set())

async function resolveDownloadUrl(entry: DocEntry): Promise<void> {
  if (!entry.doc) return
  if (downloadUrlByKind.value.has(entry.kind)) return
  if (downloadLoadingByKind.value.has(entry.kind)) return
  downloadLoadingByKind.value.add(entry.kind)
  try {
    const url = await getLicenseDocDownloadUrl(entry.doc.storagePath)
    downloadUrlByKind.value.set(entry.kind, url)
    downloadUrlByKind.value = new Map(downloadUrlByKind.value)
  } finally {
    downloadLoadingByKind.value.delete(entry.kind)
  }
}

// Lazy resolve à chaque chargement de la demande.
watch(docEntries, async (entries) => {
  for (const e of entries) await resolveDownloadUrl(e)
}, { immediate: true })

function downloadUrlFor(kind: LicenseDocKind): string | null {
  return downloadUrlByKind.value.get(kind) ?? null
}

function previewDisabled(entry: DocEntry): boolean {
  if (!entry.doc) return true
  if (!entry.doc.storagePath) return true
  if (entry.doc.storagePath.startsWith('mock://')) return true
  return downloadUrlFor(entry.kind) === null
}

function previewLabel(entry: DocEntry): string {
  if (!entry.doc) return 'Aucun fichier'
  if (entry.doc.storagePath.startsWith('mock://')) return 'Aperçu non disponible (mock)'
  if (downloadLoadingByKind.value.has(entry.kind)) return 'Aperçu…'
  if (downloadUrlFor(entry.kind) === null) return 'Aperçu indisponible'
  return 'Aperçu du fichier'
}

// ─── Infos soumises par le parent (AVS + contexte étranger) ─────
const parentSubmittedAvs = computed<string | null>(
  () => request.value?.parentSubmittedAvs ?? null,
)

const foreignContext = computed<ForeignPlayerContext | null>(
  () => request.value?.foreignPlayerContext ?? null,
)

const hasParentInfo = computed<boolean>(
  () => parentSubmittedAvs.value !== null || foreignContext.value !== null,
)

const FOREIGN_LEVEL_LABELS: Record<NonNullable<ForeignPlayerContext['level']>, string> = {
  LNA: 'LNA (1ʳᵉ division)',
  LNB: 'LNB (2ᵉ division)',
  regional: 'Régional / Espoirs',
}

function foreignLevelLabel(level: ForeignPlayerContext['level'] | undefined): string {
  if (!level) return 'Non renseigné'
  return FOREIGN_LEVEL_LABELS[level]
}

function competitionLabel(value: boolean | null): string {
  if (value === null) return 'Non renseigné'
  return value ? 'Oui' : 'Non'
}

function minorLabel(value: boolean): string {
  return value ? 'Oui (mineur au moment du transfert)' : 'Non (majeur au moment du transfert)'
}

// ─── Toast UI ────────────────────────────────────────────────────
interface ToastState {
  tone: 'emerald' | 'rose' | 'sky'
  message: string
  visible: boolean
}

const toast = ref<ToastState>({ tone: 'sky', message: '', visible: false })

function showToast(tone: ToastState['tone'], message: string): void {
  toast.value = { tone, message, visible: true }
  window.setTimeout(() => {
    toast.value = { ...toast.value, visible: false }
  }, 3500)
}

// ─── Action accept ───────────────────────────────────────────────
const pendingKind = ref<LicenseDocKind | null>(null)

async function onAccept(kind: LicenseDocKind): Promise<void> {
  if (!request.value || pendingKind.value) return
  pendingKind.value = kind
  lastErrorBanner.value = null
  try {
    const result = await licenseRequestsStore.reviewDoc({
      requestId: request.value.id,
      kind,
      decision: 'accept',
    })
    // Re-lit la demande (source de vérité : le store) — l'optimistic update
    // a déjà patché le cache, mais on s'assure que `request.value` pointe
    // bien sur le snapshot mis à jour.
    request.value = await licenseRequestsStore.getPendingReview(request.value.id)

    if (result.allCoachAccepted && result.newStatus === 'coach_validated') {
      showToast('sky', 'Demande validée et transmise au trésorier')
      // Petit délai pour laisser le toast visible avant de quitter.
      window.setTimeout(() => {
        void router.push({ name: 'license-reviews' })
      }, 1500)
      return
    }
    showToast('emerald', `${DOC_LABELS[kind]} — validé`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    lastErrorBanner.value = `Échec de la validation : ${message}`
    showToast('rose', 'Échec de la validation. Réessayez.')
    console.error('[license-request-review.accept] failed', err)
  } finally {
    pendingKind.value = null
  }
}

// ─── Action refuse (dialog motif) ────────────────────────────────
const refuseOpen = ref(false)
const refuseKind = ref<LicenseDocKind | null>(null)
const refuseReason = ref('')
const refuseError = ref('')
const REFUSE_MIN = 5
const REFUSE_MAX = 500

function openRefuse(kind: LicenseDocKind): void {
  refuseKind.value = kind
  refuseReason.value = ''
  refuseError.value = ''
  refuseOpen.value = true
}

function closeRefuse(): void {
  refuseOpen.value = false
  refuseKind.value = null
}

async function submitRefuse(): Promise<void> {
  if (!request.value || !refuseKind.value) return
  const trimmed = refuseReason.value.trim()
  if (trimmed.length < REFUSE_MIN) {
    refuseError.value = `Motif trop court (${REFUSE_MIN} caractères minimum).`
    return
  }
  if (trimmed.length > REFUSE_MAX) {
    refuseError.value = `Motif trop long (${REFUSE_MAX} caractères maximum).`
    return
  }
  const kind = refuseKind.value
  pendingKind.value = kind
  try {
    await licenseRequestsStore.reviewDoc({
      requestId: request.value.id,
      kind,
      decision: 'refuse',
      refusalReason: trimmed,
    })
    request.value = await licenseRequestsStore.getPendingReview(request.value.id)
    showToast('rose', `${DOC_LABELS[kind]} — refusé, parent notifié`)
    closeRefuse()
    // Pas de redirection auto : si le coach voit d'autres docs problématiques,
    // il doit pouvoir continuer à les refuser dans la même session avant de
    // quitter via le CTA "Retour à la liste" en bas de page. Le statut bascule
    // en `pending_parent_docs` côté serveur, mais la callable accepte les
    // refus enchaînés depuis le fix 2026-05-24.
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    refuseError.value = `Échec du refus : ${message}`
    console.error('[license-request-review.refuse] failed', err)
  } finally {
    pendingKind.value = null
  }
}

// ─── Navigation ──────────────────────────────────────────────────
function goBack(): void {
  if (window.history.length > 1) {
    router.back()
  } else {
    void router.push({ name: 'license-reviews' })
  }
}

// ─── État doc pour render ───────────────────────────────────────
function reviewedAtLabel(doc: UploadedDocRef): string {
  if (!doc.coachReview) return ''
  return formatShortDateTime(tsToMs(doc.coachReview.at))
}

function summaryLabel(): string {
  if (totalDocsCount.value === 0) return ''
  return `${acceptedCount.value} / ${totalDocsCount.value} document${
    totalDocsCount.value > 1 ? 's' : ''
  } validé${acceptedCount.value > 1 ? 's' : ''}`
}
</script>

<template>
  <!-- Empty state : requestId absent ou demande introuvable ────── -->
  <CbMobileShell
    v-if="!loadingRequest && !request"
    title="Demande introuvable"
    show-back
    @back="goBack"
  >
    <div class="cb-page">
      <CbEmptyState
        :icon="FileText"
        title="Demande introuvable"
        body="Cette demande n'existe pas, ou elle a déjà été traitée."
      >
        <template #actions>
          <button type="button" class="cb-btn primary sm" @click="goBack">
            <ArrowLeft :size="16" /> Retour
          </button>
        </template>
      </CbEmptyState>
    </div>
  </CbMobileShell>

  <!-- ─── Vue principale ─────────────────────────────────────── -->
  <CbMobileShell
    v-else-if="request"
    title="Validation des documents"
    show-back
    @back="goBack"
  >
    <div class="cb-page">
      <!-- En-tête joueur -->
      <div>
        <div class="cb-h2">{{ memberFullName(request) }}</div>
        <div class="cb-sub" style="margin-top: 2px">
          {{ teamLabel(request) }} · créée le {{ formatLongDate(tsToMs(request.createdAt)) }}
        </div>
      </div>

      <!-- Banner status post-action terminal (coach_validated…) -->
      <CbBanner
        v-if="isTerminal"
        tone="sky"
        title="Demande transmise au trésorier"
      >
        <template #icon><CheckCircle2 :size="18" /></template>
        Tous les documents ont été validés. Le trésorier prend le relais.
      </CbBanner>

      <!-- Banner "retournée au parent" — visible tant que d'autres refus sont
           possibles dans la même session (le statut a basculé après le 1er
           refus, mais le coach peut continuer à refuser les autres docs). -->
      <CbBanner
        v-else-if="isReturnedToParent"
        tone="amber"
        title="Demande retournée au parent"
      >
        <template #icon><CircleAlert :size="18" /></template>
        Au moins un document a été refusé — le parent a été notifié pour
        re-téléverser. Vous pouvez encore refuser d'autres documents avant
        de quitter cette page. La validation est gelée jusqu'au re-upload.
      </CbBanner>

      <!-- Banner erreur callable -->
      <CbBanner v-if="lastErrorBanner" tone="rose" title="Erreur">
        <template #icon><AlertTriangle :size="18" /></template>
        {{ lastErrorBanner }}
      </CbBanner>

      <!-- Banner photo licence manquante (cf. docs/members/license-photo.md) -->
      <CbBanner
        v-if="photoMissing"
        tone="rose"
        title="Photo licence manquante"
      >
        <template #icon><Camera :size="18" /></template>
        <p style="margin: 0 0 8px">
          La photo licence du joueur est obligatoire avant de pouvoir valider
          les documents. Téléversez-la depuis sa fiche membre, puis revenez ici.
        </p>
        <button
          type="button"
          class="cb-btn outline sm"
          @click="goToMemberDetail"
        >
          <Camera :size="14" /> Ouvrir la fiche membre
        </button>
      </CbBanner>

      <!-- Banner FIBA — transfert international -->
      <CbBanner
        v-if="foreignContext"
        tone="amber"
        title="Transfert international — procédure FIBA"
      >
        <template #icon><Globe2 :size="18" /></template>
        Ce joueur vient d'un club hors-CH. Une procédure
        <strong>Letter of Clearance (FIBA / MAP)</strong> sera nécessaire côté
        admin. Vérifiez le contexte ci-dessous, validez les pièces : l'admin
        prendra le relais sur la procédure fédérale.
      </CbBanner>

      <!-- Informations soumises par le parent ─────────────────── -->
      <template v-if="hasParentInfo">
        <div class="cb-section-label" style="padding: 8px 0 4px">
          Informations soumises par le parent
        </div>

        <!-- AVS texte (saisi quand `avs` est dans `requiredDocs`) -->
        <div
          v-if="parentSubmittedAvs"
          class="cb-card cb-lrr-info-card"
          style="padding: 14px; display: flex; flex-direction: column; gap: 6px"
        >
          <div class="cb-lrr-info-head">
            <CreditCard :size="14" />
            <span>Numéro AVS</span>
          </div>
          <div class="cb-lrr-info-value cb-lrr-mono">
            {{ parentSubmittedAvs }}
          </div>
          <p class="cb-sub" style="margin: 0">
            Saisi directement par le parent. L'admin pourra synchroniser cette
            valeur sur la fiche membre après validation.
          </p>
        </div>

        <!-- Contexte joueur étranger -->
        <div
          v-if="foreignContext"
          class="cb-card cb-lrr-info-card"
          style="padding: 14px; display: flex; flex-direction: column; gap: 10px"
        >
          <div class="cb-lrr-info-head">
            <Globe2 :size="14" />
            <span>Contexte joueur étranger</span>
          </div>
          <dl class="cb-lrr-kv">
            <div>
              <dt>Pays de l'ancien club</dt>
              <dd>
                {{ countryName(foreignContext.previousCountry) || '—' }}
                <span class="cb-sub" style="margin-left: 6px">
                  ({{ foreignContext.previousCountry }})
                </span>
              </dd>
            </div>
            <div>
              <dt>Compétitions officielles à l'étranger</dt>
              <dd>{{ competitionLabel(foreignContext.hadCompetition) }}</dd>
            </div>
            <div>
              <dt>Mineur</dt>
              <dd>{{ minorLabel(foreignContext.isMinor) }}</dd>
            </div>
            <div>
              <dt>Niveau de l'ancien club</dt>
              <dd>{{ foreignLevelLabel(foreignContext.level) }}</dd>
            </div>
          </dl>
        </div>
      </template>

      <!-- Liste des docs -->
      <div class="cb-section-label" style="padding: 8px 0 4px">Documents à valider</div>
      <div
        v-for="entry in docEntries"
        :key="entry.kind"
        class="cb-card"
        style="padding: 14px; display: flex; flex-direction: column; gap: 10px"
      >
        <!-- Title + status pill -->
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px">
          <div style="flex: 1; min-width: 0">
            <div style="font-weight: 600; font-size: 14px">{{ entry.label }}</div>
            <div v-if="entry.doc" class="cb-sub" style="margin-top: 2px">
              {{ entry.doc.fileName }} · {{ formatFileSize(entry.doc.sizeBytes) }}
              <template v-if="tsToMs(entry.doc.uploadedAt)">
                · uploadé le {{ formatShortDateTime(tsToMs(entry.doc.uploadedAt)) }}
              </template>
            </div>
            <div v-else class="cb-sub" style="margin-top: 2px">
              Aucun fichier — le parent n'a pas (encore) téléversé ce document.
            </div>
          </div>

          <CbPill
            v-if="entry.doc?.coachReview?.decision === 'accepted'"
            tone="emerald"
            dot
          >Validé</CbPill>
          <CbPill
            v-else-if="entry.doc?.coachReview?.decision === 'refused'"
            tone="rose"
            dot
          >Refusé</CbPill>
          <CbPill v-else tone="amber" dot>Non revu</CbPill>
        </div>

        <!-- Aperçu fichier -->
        <div v-if="entry.doc" style="display: flex; align-items: center; gap: 8px">
          <a
            v-if="!previewDisabled(entry)"
            class="cb-btn outline sm"
            :href="downloadUrlFor(entry.kind) ?? '#'"
            target="_blank"
            rel="noopener noreferrer"
            style="display: inline-flex; align-items: center; gap: 6px"
          >
            <Eye :size="14" />
            {{ previewLabel(entry) }}
          </a>
          <button
            v-else
            type="button"
            class="cb-btn outline sm"
            disabled
            style="display: inline-flex; align-items: center; gap: 6px; opacity: 0.55"
            :title="previewLabel(entry)"
          >
            <Eye :size="14" />
            {{ previewLabel(entry) }}
          </button>
        </div>

        <!-- État reviewé -->
        <div
          v-if="entry.doc?.coachReview?.decision === 'refused'"
          class="cb-lrr-refusal"
          role="status"
        >
          <div class="cb-lrr-refusal-head">
            <CircleAlert :size="14" />
            <span>Refusé · {{ reviewedAtLabel(entry.doc) }}</span>
          </div>
          <div v-if="entry.doc.coachReview.refusalReason" class="cb-lrr-refusal-reason">
            {{ entry.doc.coachReview.refusalReason }}
          </div>
        </div>

        <!-- Actions -->
        <div v-if="entry.doc && !isTerminal" style="display: flex; gap: 8px">
          <template v-if="entry.doc.coachReview?.decision === 'accepted'">
            <CbPill tone="emerald">
              Validé · {{ reviewedAtLabel(entry.doc) }}
            </CbPill>
          </template>
          <template v-else-if="entry.doc.coachReview?.decision === 'refused'">
            <button
              type="button"
              class="cb-btn outline sm"
              style="flex: 1"
              :disabled="pendingKind !== null"
              @click="openRefuse(entry.kind)"
            >
              Re-réviser (refuser)
            </button>
            <button
              type="button"
              class="cb-btn primary sm"
              style="flex: 1"
              :disabled="pendingKind !== null || photoMissing || isReturnedToParent"
              :title="
                isReturnedToParent
                  ? ACCEPT_DISABLED_RETURNED_TOOLTIP
                  : photoMissing
                    ? PHOTO_TOOLTIP
                    : undefined
              "
              @click="onAccept(entry.kind)"
            >
              <CheckCircle2 :size="14" /> Re-réviser (valider)
            </button>
          </template>
          <template v-else>
            <button
              type="button"
              class="cb-btn outline danger sm"
              style="flex: 1"
              :disabled="pendingKind !== null"
              @click="openRefuse(entry.kind)"
            >
              <X :size="14" /> Refuser
            </button>
            <button
              type="button"
              class="cb-btn primary sm"
              style="flex: 1"
              :disabled="pendingKind !== null || photoMissing || isReturnedToParent"
              :title="
                isReturnedToParent
                  ? ACCEPT_DISABLED_RETURNED_TOOLTIP
                  : photoMissing
                    ? PHOTO_TOOLTIP
                    : undefined
              "
              @click="onAccept(entry.kind)"
            >
              <CheckCircle2 :size="14" /> Valider
            </button>
          </template>
        </div>
      </div>

      <!-- Info pour le coach -->
      <CbBanner tone="sky">
        <template #icon><Info :size="18" /></template>
        Quand tous les documents seront validés, la demande sera automatiquement
        transmise au trésorier pour traitement final.
      </CbBanner>
    </div>

    <!-- BottomBar récap -->
    <CbBottomBar v-if="!isTerminal && totalDocsCount > 0">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%">
        <CbPill :tone="allAccepted ? 'emerald' : isReturnedToParent ? 'rose' : 'amber'" :dot="!allAccepted">
          {{ summaryLabel() }}
        </CbPill>
        <!-- Demande retournée au parent → CTA explicite "Retour à la liste"
             (les autres refus sont optionnels, le coach quitte quand il a fini). -->
        <button
          v-if="isReturnedToParent"
          type="button"
          class="cb-btn primary"
          @click="goBack"
        >
          <ArrowLeft :size="16" />
          Retour à la liste
        </button>
        <button
          v-else
          type="button"
          class="cb-btn primary"
          :disabled="!allAccepted || photoMissing"
          :title="
            photoMissing
              ? PHOTO_TOOLTIP
              : allAccepted
                ? 'Validation automatique côté serveur'
                : 'Valider tous les documents ci-dessus'
          "
        >
          <CheckCircle2 :size="16" />
          Demande validée
        </button>
      </div>
    </CbBottomBar>
  </CbMobileShell>

  <!-- Loading shell vide tant que `loadingRequest` ─────────────── -->
  <CbMobileShell v-else title="Validation des documents" show-back @back="goBack">
    <div class="cb-page">
      <div class="cb-skel" style="height: 60px; border-radius: 12px"></div>
      <div class="cb-skel" style="height: 120px; border-radius: 12px"></div>
      <div class="cb-skel" style="height: 120px; border-radius: 12px"></div>
    </div>
  </CbMobileShell>

  <!-- Dialog motif refus (Teleport body) ───────────────────────── -->
  <Teleport to="body">
    <div
      v-if="refuseOpen"
      class="cb-lrr-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Refuser un document"
      @click.self="closeRefuse"
    >
      <div class="cb-lrr-dialog">
        <div class="cb-lrr-dialog-head">
          <h2 class="cb-h2">
            Refuser
            <template v-if="refuseKind"> — {{ DOC_LABELS[refuseKind] }}</template>
          </h2>
          <button
            type="button"
            class="cb-iconbtn"
            aria-label="Fermer"
            @click="closeRefuse"
          >
            <X :size="18" />
          </button>
        </div>
        <div class="cb-lrr-dialog-body">
          <p class="cb-sub" style="margin-bottom: 12px">
            Indiquez précisément ce qui pose problème. Le parent recevra ce
            motif et devra re-téléverser le document.
          </p>
          <label class="cb-lrr-dialog-label" for="cb-lrr-refuse-reason">
            Motif (obligatoire — {{ REFUSE_MIN }} à {{ REFUSE_MAX }} caractères)
          </label>
          <textarea
            id="cb-lrr-refuse-reason"
            v-model="refuseReason"
            class="cb-lrr-textarea"
            rows="4"
            :maxlength="REFUSE_MAX"
            placeholder="Ex. La photo est floue, le numéro AVS n'est pas lisible. Merci de réuploader."
            :aria-invalid="refuseError ? 'true' : 'false'"
          />
          <div class="cb-lrr-counter">{{ refuseReason.length }} / {{ REFUSE_MAX }}</div>
          <p v-if="refuseError" class="cb-lrr-error">{{ refuseError }}</p>
        </div>
        <div class="cb-lrr-dialog-actions">
          <button type="button" class="cb-btn ghost" :disabled="pendingKind !== null" @click="closeRefuse">
            Annuler
          </button>
          <button
            type="button"
            class="cb-btn danger"
            :disabled="pendingKind !== null"
            @click="submitRefuse"
          >
            <X :size="16" /> Confirmer le refus
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Toast UX ─────────────────────────────────────────────────── -->
  <Teleport to="body">
    <Transition name="cb-toast">
      <div
        v-if="toast.visible"
        class="cb-lrr-toast"
        :class="`tone-${toast.tone}`"
        role="status"
      >
        <component
          :is="toast.tone === 'rose' ? AlertTriangle : toast.tone === 'sky' ? Info : CheckCircle2"
          :size="16"
        />
        <span>{{ toast.message }}</span>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cb-lrr-refusal {
  background: var(--rose-50, rgba(244, 63, 94, 0.08));
  border: 1px solid var(--rose-200, rgba(244, 63, 94, 0.25));
  border-radius: 10px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--rose-700, #be123c);
  font-size: 12px;
}
.cb-lrr-refusal-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}
.cb-lrr-refusal-reason {
  line-height: 1.45;
  color: var(--text);
}

/* Cards "Informations soumises par le parent" */
.cb-lrr-info-card {
  border-left: 3px solid var(--sky-500, #0ea5e9);
}
.cb-lrr-info-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-subtle);
}
.cb-lrr-info-value {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}
.cb-lrr-mono {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  letter-spacing: 0.02em;
}
.cb-lrr-kv {
  margin: 0;
  display: grid;
  gap: 6px;
}
.cb-lrr-kv > div {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  gap: 10px;
  align-items: baseline;
}
.cb-lrr-kv dt {
  font-size: 12px;
  color: var(--text-subtle);
}
.cb-lrr-kv dd {
  margin: 0;
  font-size: 13px;
  color: var(--text);
  font-weight: 500;
}
@media (max-width: 420px) {
  .cb-lrr-kv > div {
    grid-template-columns: 1fr;
    gap: 2px;
  }
}

/* Dialog motif refus */
.cb-lrr-dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 1000;
}
.cb-lrr-dialog {
  background: var(--bg);
  border-radius: 16px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.18);
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.cb-lrr-dialog-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border);
}
.cb-lrr-dialog-body {
  padding: 18px;
}
.cb-lrr-dialog-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-subtle);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.cb-lrr-textarea {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  font: inherit;
  font-size: 13px;
  resize: vertical;
  background: var(--bg);
  color: var(--text);
  outline: none;
}
.cb-lrr-textarea:focus {
  border-color: var(--emerald-500, var(--slate-700));
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
}
.cb-lrr-textarea[aria-invalid='true'] {
  border-color: var(--rose-500);
}
.cb-lrr-counter {
  text-align: right;
  font-size: 11px;
  color: var(--text-subtle);
  margin-top: 4px;
}
.cb-lrr-error {
  color: var(--rose-600);
  font-size: 12px;
  margin-top: 6px;
}
.cb-lrr-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 18px 18px;
  border-top: 1px solid var(--border);
  background: var(--slate-50, var(--bg));
}

/* Toast UX */
.cb-lrr-toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 10px 25px rgba(15, 23, 42, 0.18);
  z-index: 1100;
  max-width: calc(100vw - 32px);
}
.cb-lrr-toast.tone-emerald {
  background: var(--emerald-500, #10b981);
  color: #fff;
}
.cb-lrr-toast.tone-rose {
  background: var(--rose-500, #f43f5e);
  color: #fff;
}
.cb-lrr-toast.tone-sky {
  background: var(--sky-500, #0ea5e9);
  color: #fff;
}
.cb-toast-enter-active,
.cb-toast-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}
.cb-toast-enter-from,
.cb-toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}
</style>
