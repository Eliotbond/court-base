<script setup lang="ts">
/**
 * Page `/license-requests/:id` — review détaillée d'une demande de licence
 * par le trésorier/admin/secrétaire (PR3 workflow demande de licence parent).
 *
 * Trois sections :
 *   1. Info — méta de la demande (membre, équipe, coach, dates, status,
 *      commentaire admin éventuel sur les terminales `approved`/`rejected`).
 *   2. Documents — un bloc par `requiredDocs[kind]`. Pour chaque doc :
 *      métadonnées, aperçu Storage (signed URL), status coach (chip), status
 *      trésorier (chip + boutons Valider/Refuser tant que pas validé).
 *   3. Footer actions — boutons globaux "Refuser la demande" (danger) /
 *      "Approuver la demande" (success, disabled tant que pas tous
 *      `treasurerReview.accepted`). Approve crée une `/licenses/{id}` pending
 *      via la callable serveur ; sur succès toast info "Licence créée — utilisez
 *      confirmLicense pour finaliser le paiement".
 *
 * Pas de filtres custom. La vue agit sur la demande visée par `:id`.
 *
 * Routing : `meta.allowedRoles: ['admin','treasurer','secretary']` —
 * rootAdmin bypass. La rule Firestore renforce côté server.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { FirebaseError } from 'firebase/app'
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Loader2,
  ShieldCheck,
  TriangleAlert,
  User as UserIcon,
  XCircle,
} from 'lucide-vue-next'

import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Textarea from 'primevue/textarea'

import Pill from '@/components/ui/Pill.vue'
import LicenseRequestTreasurerSection from '@/views/licenses/components/LicenseRequestTreasurerSection.vue'
import { useAuthStore } from '@/stores/auth'
import { useLicenseRequestsStore } from '@/stores/licenseRequests'
import { getLicenseDocumentUrl } from '@/repositories/licenseRequests.repo'
import {
  getMemberById,
  getMemberPhotoDownloadUrl,
  type MemberRow,
} from '@/repositories/members.repo'
import type {
  DocReviewDecision,
  LicenseDocKind,
  LicenseRequest,
  LicenseRequestStatus,
  UploadedDocRef,
} from '@club-app/shared-types'

const route = useRoute()
const router = useRouter()
const store = useLicenseRequestsStore()
const auth = useAuthStore()

// ---------------------------------------------------------------------------
// Charge la demande visée. On force `loadOne` au mount (et sur changement
// d'id) — la liste n'est pas forcément déjà chargée si l'utilisateur arrive
// en direct sur la route.
// ---------------------------------------------------------------------------

const requestId = computed<string>(() => {
  const raw = route.params['id']
  return Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
})

const isLoading = ref<boolean>(false)
const notFound = ref<boolean>(false)

async function loadRequest(id: string): Promise<void> {
  if (!id) {
    notFound.value = true
    return
  }
  isLoading.value = true
  notFound.value = false
  try {
    const req = await store.loadOne(id)
    if (!req) notFound.value = true
  } finally {
    isLoading.value = false
  }
}

onMounted(() => {
  void loadRequest(requestId.value)
})

watch(requestId, (next) => {
  void loadRequest(next)
})

const request = computed<LicenseRequest | null>(
  () => store.byId.get(requestId.value) ?? null,
)

// ---------------------------------------------------------------------------
// Gating workflow trésorier — la section "Workflow trésorier" est visible
// pour tout le staff capable de traiter ces demandes : rootAdmin / admin /
// treasurer / secretary. Aligné sur les rôles de la route `/license-requests`
// (`['admin','treasurer','secretary']` + bypass rootAdmin) et sur les
// callables backend (`treasurerReviewLicenseDoc`, `validateLicenseRequest`).
// Pour un caller non-staff (parent qui aurait une URL directe), on garde un
// placeholder grisé en filet de sécurité.
// ---------------------------------------------------------------------------
const isTreasurerCaller = computed<boolean>(() => {
  if (auth.rootAdmin) return true
  const roles = auth.roles
  return (
    roles.includes('treasurer') ||
    roles.includes('admin') ||
    roles.includes('secretary')
  )
})

/**
 * Statuts pour lesquels la section trésorier est pertinente. Couvre tout le
 * pipeline (du coach_validated initial jusqu'aux terminaux). Pour les
 * statuts antérieurs (`pending_parent_docs`, `parent_docs_submitted`, legacy
 * `pending`), on ne montre pas la section (workflow trésorier pas encore
 * atteint).
 */
const TREASURER_RELEVANT_STATUSES: readonly LicenseRequestStatus[] = [
  'coach_validated',
  'awaiting_parent_signature',
  'parent_signed',
  'form_confirmed',
  'sent_paid',
  'approved',
  'rejected',
] as const

const showTreasurerSection = computed<boolean>(() => {
  const s = request.value?.status
  if (!s) return false
  return TREASURER_RELEVANT_STATUSES.includes(s)
})

// ---------------------------------------------------------------------------
// Member lookup pour la thumbnail photo licence (cf.
// `docs/members/license-photo.md` §Affichage apps/web). Si pas de photo
// uploadée → placeholder gris + helper text "Aucune photo licence — uploader
// via fiche membre". Le bouton "Ouvrir la fiche membre" route vers la fiche.
//
// Lecture via repo direct — pattern aligné sur `getLicenseDocumentUrl` déjà
// utilisé dans cette vue. Catch enrichi `FirebaseError` (cf. CLAUDE.md).
// ---------------------------------------------------------------------------

const member = ref<MemberRow | null>(null)
const isMemberLoading = ref<boolean>(false)
const memberPhotoUrl = ref<string | null>(null)

async function loadMemberForRequest(req: LicenseRequest | null): Promise<void> {
  if (!req?.memberId) {
    member.value = null
    memberPhotoUrl.value = null
    return
  }
  isMemberLoading.value = true
  try {
    const m = await getMemberById(req.memberId)
    member.value = m
    if (m?.photoStoragePath) {
      try {
        const url = await getMemberPhotoDownloadUrl(m.photoStoragePath)
        const v = m.photoUpdatedAt?.seconds ?? Date.now()
        memberPhotoUrl.value = url.includes('?')
          ? `${url}&v=${v}`
          : `${url}?v=${v}`
      } catch (err) {
        const code = err instanceof FirebaseError ? err.code : 'unknown'
        console.error(
          `[LicenseRequestReview.loadMemberPhoto] failed [${code}]`,
          err,
        )
        memberPhotoUrl.value = null
      }
    } else {
      memberPhotoUrl.value = null
    }
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(
      `[LicenseRequestReview.loadMemberForRequest] failed [${code}]`,
      err,
    )
    member.value = null
    memberPhotoUrl.value = null
  } finally {
    isMemberLoading.value = false
  }
}

// Recharge le member dès qu'on a la demande (ou qu'elle change).
watch(
  request,
  (next) => {
    void loadMemberForRequest(next)
  },
  { immediate: true },
)

function goToMember(): void {
  if (!member.value) return
  void router.push({
    name: 'member-detail',
    params: { id: member.value.id },
  })
}

// ---------------------------------------------------------------------------
// Status pill — aligné sur la liste.
// ---------------------------------------------------------------------------

type PillVariant = 'emerald' | 'sky' | 'amber' | 'rose' | 'slate' | 'violet'

function statusPill(status: LicenseRequestStatus): { variant: PillVariant; label: string } {
  switch (status) {
    case 'pending_parent_docs':
      return { variant: 'amber', label: 'En attente parent' }
    case 'parent_docs_submitted':
      return { variant: 'sky', label: 'Docs reçus' }
    case 'coach_validated':
      return { variant: 'violet', label: 'Validé coach' }
    // Phase trésorier (PR3-trésorier, 2026-05-24)
    case 'awaiting_parent_signature':
      return { variant: 'amber', label: 'Att. signature parent' }
    case 'parent_signed':
      return { variant: 'sky', label: 'Doc signé reçu' }
    case 'form_confirmed':
      return { variant: 'violet', label: 'Forme confirmée' }
    case 'sent_paid':
      return { variant: 'violet', label: 'Envoyé + payé' }
    case 'approved':
      return { variant: 'emerald', label: 'Approuvée' }
    case 'rejected':
      return { variant: 'rose', label: 'Refusée' }
    case 'pending':
      return { variant: 'slate', label: 'En attente' }
    default: {
      const _exhaust: never = status
      return { variant: 'slate', label: String(_exhaust) }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers formatters / labels.
// ---------------------------------------------------------------------------

const DATE_FMT = new Intl.DateTimeFormat('fr-CH', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function tsToDate(ts: { seconds: number; nanoseconds: number } | null | undefined): Date | null {
  if (!ts) return null
  return new Date(ts.seconds * 1000 + Math.floor(ts.nanoseconds / 1_000_000))
}

function formatDate(ts: { seconds: number; nanoseconds: number } | null | undefined): string {
  const d = tsToDate(ts)
  return d ? DATE_FMT.format(d) : '—'
}

function memberName(req: LicenseRequest): string {
  const d = req.denorm
  if (!d) return 'Joueur sans denorm'
  const first = (d.memberFirstName ?? '').trim()
  const last = (d.memberLastName ?? '').trim()
  const full = [first, last].filter((s) => s.length > 0).join(' ')
  return full.length > 0 ? full : 'Joueur sans denorm'
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 o'
  const units = ['o', 'ko', 'Mo', 'Go']
  let i = 0
  let v = bytes
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`
}

const DOC_KIND_LABEL: Record<LicenseDocKind, string> = {
  id_front: "Pièce d'identité — recto",
  id_back: "Pièce d'identité — verso",
  avs: 'Numéro AVS',
  transfer_letter_swiss: 'Lettre de sortie (club suisse)',
}

function kindLabel(kind: LicenseDocKind): string {
  return DOC_KIND_LABEL[kind]
}

// ---------------------------------------------------------------------------
// Aperçu Storage — résolution paresseuse + cache par storagePath.
// ---------------------------------------------------------------------------

const docUrlCache = ref<Map<string, string>>(new Map())
const docUrlLoading = ref<Set<string>>(new Set())

async function openDocumentPreview(docRef: UploadedDocRef): Promise<void> {
  const path = docRef.storagePath
  const cached = docUrlCache.value.get(path)
  if (cached) {
    window.open(cached, '_blank', 'noopener')
    return
  }
  const next = new Set(docUrlLoading.value)
  next.add(path)
  docUrlLoading.value = next
  try {
    const url = await getLicenseDocumentUrl(path)
    const updated = new Map(docUrlCache.value)
    updated.set(path, url)
    docUrlCache.value = updated
    window.open(url, '_blank', 'noopener')
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`openDocumentPreview failed [${code}] path=${path}`, err)
    bannerError.value = `Aperçu indisponible (${code}). Vérifiez vos droits Storage.`
  } finally {
    const updated = new Set(docUrlLoading.value)
    updated.delete(path)
    docUrlLoading.value = updated
  }
}

function isDocLoading(docRef: UploadedDocRef): boolean {
  return docUrlLoading.value.has(docRef.storagePath)
}

// ---------------------------------------------------------------------------
// Treasurer review actions — accept direct, refuse via dialog raison.
// ---------------------------------------------------------------------------

const bannerError = ref<string | null>(null)
const bannerInfo = ref<string | null>(null)

const refuseDocDialogOpen = ref(false)
const refuseDocKind = ref<LicenseDocKind | null>(null)
const refuseDocReason = ref('')

function openRefuseDocDialog(kind: LicenseDocKind): void {
  refuseDocKind.value = kind
  refuseDocReason.value = ''
  refuseDocDialogOpen.value = true
}

function closeRefuseDocDialog(): void {
  if (store.actionPendingId !== null) return
  refuseDocDialogOpen.value = false
  refuseDocKind.value = null
  refuseDocReason.value = ''
}

const refuseDocReasonTrimmed = computed(() => refuseDocReason.value.trim())
const refuseDocCanSubmit = computed<boolean>(
  () =>
    store.actionPendingId === null &&
    refuseDocReasonTrimmed.value.length >= 5 &&
    refuseDocReasonTrimmed.value.length <= 500,
)

async function acceptDoc(kind: LicenseDocKind): Promise<void> {
  if (!request.value || store.actionPendingId !== null) return
  bannerError.value = null
  bannerInfo.value = null
  const res = await store.treasurerReview({
    requestId: request.value.id,
    kind,
    decision: 'accept',
  })
  if (!res) {
    bannerError.value = `Échec de la validation du document (${store.error ?? 'erreur'}).`
  }
}

async function submitRefuseDoc(): Promise<void> {
  if (!request.value || !refuseDocKind.value || !refuseDocCanSubmit.value) return
  bannerError.value = null
  bannerInfo.value = null
  const res = await store.treasurerReview({
    requestId: request.value.id,
    kind: refuseDocKind.value,
    decision: 'refuse',
    refusalReason: refuseDocReasonTrimmed.value,
  })
  if (res) {
    bannerInfo.value =
      "Document refusé. La demande est repassée en attente parent (le coach devra revalider après re-upload). Vous pouvez continuer à refuser d'autres documents avant de quitter cette page."
    refuseDocDialogOpen.value = false
    refuseDocKind.value = null
    refuseDocReason.value = ''
  } else {
    bannerError.value = `Échec du refus (${store.error ?? 'erreur'}).`
  }
}

// ---------------------------------------------------------------------------
// Decision finale — approve / reject via dialog confirmation + comment.
// ---------------------------------------------------------------------------

const approveDialogOpen = ref(false)
const rejectDialogOpen = ref(false)
const decisionComment = ref('')
const lastCreatedLicenseId = ref<string | null>(null)

function openApproveDialog(): void {
  decisionComment.value = ''
  approveDialogOpen.value = true
}

function closeApproveDialog(): void {
  if (store.actionPendingId !== null) return
  approveDialogOpen.value = false
  decisionComment.value = ''
}

function openRejectDialog(): void {
  decisionComment.value = ''
  rejectDialogOpen.value = true
}

function closeRejectDialog(): void {
  if (store.actionPendingId !== null) return
  rejectDialogOpen.value = false
  decisionComment.value = ''
}

const decisionCommentTrimmed = computed(() => decisionComment.value.trim())
const decisionCommentTooLong = computed(() => decisionCommentTrimmed.value.length > 500)

async function submitApprove(): Promise<void> {
  if (!request.value || decisionCommentTooLong.value || store.actionPendingId !== null) return
  bannerError.value = null
  bannerInfo.value = null
  const res = await store.validate({
    requestId: request.value.id,
    decision: 'approve',
    ...(decisionCommentTrimmed.value.length > 0
      ? { comment: decisionCommentTrimmed.value }
      : {}),
  })
  if (res) {
    lastCreatedLicenseId.value = res.licenseId
    bannerInfo.value = res.licenseId
      ? `Licence créée (id: ${res.licenseId}) en statut "pending". Utilisez « Confirmer » depuis la fiche membre pour finaliser le paiement.`
      : 'Demande approuvée.'
    approveDialogOpen.value = false
    decisionComment.value = ''
  } else {
    bannerError.value = `Échec de l'approbation (${store.error ?? 'erreur'}).`
  }
}

async function submitReject(): Promise<void> {
  if (!request.value || decisionCommentTooLong.value || store.actionPendingId !== null) return
  bannerError.value = null
  bannerInfo.value = null
  const res = await store.validate({
    requestId: request.value.id,
    decision: 'reject',
    ...(decisionCommentTrimmed.value.length > 0
      ? { comment: decisionCommentTrimmed.value }
      : {}),
  })
  if (res) {
    bannerInfo.value = 'Demande refusée. La demande est désormais terminale.'
    rejectDialogOpen.value = false
    decisionComment.value = ''
  } else {
    bannerError.value = `Échec du refus (${store.error ?? 'erreur'}).`
  }
}

// ---------------------------------------------------------------------------
// Derived state — gating UI.
// ---------------------------------------------------------------------------

function reviewerName(_decision: DocReviewDecision): string {
  // On n'a pas accès au /users du reviewer côté client sans un fetch dédié.
  // Le uid suffit pour l'audit ; UI compact = on n'expose pas le uid brut.
  return 'Trésorerie'
}

const allTreasurerAccepted = computed<boolean>(() => {
  const req = request.value
  if (!req) return false
  return req.requiredDocs.every((kind) => {
    const docRef = req.uploadedDocs[kind]
    return docRef?.treasurerReview?.decision === 'accepted'
  })
})

const treasurerAcceptedCount = computed<number>(() => {
  const req = request.value
  if (!req) return 0
  return req.requiredDocs.filter((kind) => {
    const docRef = req.uploadedDocs[kind]
    return docRef?.treasurerReview?.decision === 'accepted'
  }).length
})

const requiredCount = computed<number>(() => request.value?.requiredDocs.length ?? 0)

const isTerminal = computed<boolean>(() => {
  const s = request.value?.status
  return s === 'approved' || s === 'rejected'
})

const isActionable = computed<boolean>(() => request.value?.status === 'coach_validated')

// Valider un doc : court-circuit coach autorisé. Le trésorier peut valider
// un doc dès qu'il est uploadé (`parent_docs_submitted`), sans attendre la
// review coach (cas vécu : coach absent, doc évident, urgence saisonnière).
// Reste possible aussi en `pending_parent_docs` (un refus antérieur a fait
// basculer la demande mais d'autres docs uploadés restent valides). Backend
// `treasurerReviewLicenseDoc` aligné sur ces 3 statuts pour `accept`.
const canAcceptDoc = computed<boolean>(() => {
  const s = request.value?.status
  return (
    s === 'parent_docs_submitted' ||
    s === 'coach_validated' ||
    s === 'pending_parent_docs'
  )
})

// Refuser un doc reste possible aussi quand un refus antérieur a déjà fait
// basculer la demande en `pending_parent_docs` — le trésorier doit pouvoir
// enchaîner plusieurs refus sur des docs différents avant de quitter la
// page (backend `treasurerReviewLicenseDoc` accepte les refus enchaînés
// depuis le fix 2026-05-24).
const canRefuseDoc = computed<boolean>(() => {
  const s = request.value?.status
  return s === 'coach_validated' || s === 'pending_parent_docs'
})

// Reject est plus souple qu'approve : le trésorier peut refuser dès que les
// docs parent sont arrivés (`parent_docs_submitted`), sans attendre la
// validation coach. Le coach reste un pré-filtre qui soulage le trésorier,
// mais il n'est pas bloquant pour un refus motivé (doc faux, info erronée).
const canReject = computed<boolean>(() => {
  const s = request.value?.status
  return s === 'parent_docs_submitted' || s === 'coach_validated'
})

// Approve : bypass coach autorisé — visible dès qu'il y a quelque chose à
// valider (`parent_docs_submitted | coach_validated | pending_parent_docs`)
// ET que le trésorier a validé chaque doc. Le vrai gate est
// `allTreasurerAccepted` ; le statut sert juste à exclure les terminaux et
// les états de phase trésorier post-décision. Backend
// `validateLicenseRequest.approve` aligné sur ce set.
const canApprove = computed<boolean>(() => {
  const s = request.value?.status
  const statusOk =
    s === 'parent_docs_submitted' ||
    s === 'coach_validated' ||
    s === 'pending_parent_docs'
  return statusOk && allTreasurerAccepted.value
})

function goBack(): void {
  void router.push({ name: 'license-requests' })
}
</script>

<template>
  <section class="p-6 space-y-4 max-w-5xl">
    <header>
      <!-- `w-fit` + `whitespace-nowrap` : empêche le PrimeVue Button de se
           comporter en block 100% (cas vécu sur le screenshot : libellé
           "Retour aux demandes" qui wrappait en "Retour aux mand[…]es"). -->
      <Button
        size="small"
        severity="secondary"
        text
        aria-label="Retour à la liste"
        class="!w-fit whitespace-nowrap"
        @click="goBack"
      >
        <template #icon>
          <ArrowLeft
            :size="14"
            :stroke-width="2"
          />
        </template>
        <span class="ml-1">Retour aux demandes</span>
      </Button>
    </header>

    <!-- Loading -->
    <div
      v-if="isLoading && !request"
      class="card px-4 py-10 text-center text-[12px] text-surface-500"
      aria-busy="true"
    >
      Chargement de la demande…
    </div>

    <!-- Not found -->
    <div
      v-else-if="notFound || !request"
      class="card border-amber-200 bg-amber-50 px-4 py-6 text-[13px] text-amber-800 flex items-start gap-2"
    >
      <TriangleAlert
        :size="16"
        :stroke-width="2"
        class="mt-0.5 shrink-0"
      />
      <div class="space-y-1">
        <div class="font-semibold">
          Demande introuvable.
        </div>
        <p class="text-[12px]">
          La demande de licence n'existe pas, a été supprimée, ou vous n'avez
          pas les droits pour y accéder.
        </p>
      </div>
    </div>

    <template v-else>
      <!-- ====================== INFO CARD =======================
           Layout :
             [thumbnail 80x80]  [bloc texte vertical: nom / meta / helper]   [pill status]
                                  └─ bouton "Ouvrir la fiche membre" en dessous (full row)

           Choix :
             - thumbnail + bloc texte sont sur la même rangée avec `items-center`
               (le bouton "Ouvrir la fiche membre" n'est plus dans cette rangée :
                il passe sur sa propre ligne avec `mt-3`, plus de chevauchement).
             - Le Pill status est en `self-start` pour rester en haut à droite,
               même si le bloc texte s'allonge.
             - `min-w-0` partout où il y a un enfant `truncate` ou `flex-1` pour
               permettre le shrink correct (sinon les conteneurs flex peuvent
               imposer une largeur minimale qui pousse le Pill hors écran).
      -->
      <div class="card p-5 space-y-3">
        <div class="flex items-start justify-between gap-3 flex-wrap">
          <div class="flex items-center gap-3 min-w-0 flex-1">
            <!-- Thumbnail photo licence — cf. docs/members/license-photo.md.
                 Si pas de photo : placeholder gris + helper text invitant à
                 uploader via la fiche membre. -->
            <div
              class="relative w-20 h-20 rounded-lg overflow-hidden border border-surface-200 bg-surface-50 shrink-0"
              aria-label="Photo licence du membre"
            >
              <template v-if="memberPhotoUrl">
                <img
                  :src="memberPhotoUrl"
                  alt="Photo licence du membre"
                  class="w-full h-full object-cover"
                >
              </template>
              <template v-else>
                <div
                  class="flex items-center justify-center w-full h-full text-surface-400"
                >
                  <ImageIcon
                    :size="22"
                    :stroke-width="1.5"
                  />
                </div>
              </template>
              <div
                v-if="isMemberLoading"
                class="absolute inset-0 flex items-center justify-center bg-white/70"
                aria-busy="true"
              >
                <Loader2
                  :size="16"
                  :stroke-width="2"
                  class="animate-spin text-surface-600"
                />
              </div>
            </div>

            <div class="space-y-1 min-w-0 flex-1">
              <h1 class="text-[17px] font-semibold tracking-tight truncate">
                {{ memberName(request) }}
              </h1>
              <div class="text-[12px] text-surface-500">
                Demande créée le {{ formatDate(request.createdAt) }}
              </div>
              <div
                v-if="member && !member.photoStoragePath"
                class="text-[11.5px] text-amber-700"
              >
                Aucune photo licence — uploader via fiche membre.
              </div>
            </div>
          </div>
          <Pill
            :variant="statusPill(request.status).variant"
            class="self-start"
          >
            {{ statusPill(request.status).label }}
          </Pill>
        </div>

        <!-- Bouton fiche membre — sorti de la rangée thumbnail/textes pour
             éviter le chevauchement vu sur le screenshot. `w-fit` +
             `whitespace-nowrap` empêchent le wrap des libellés (cas vécu :
             "Ouvrir la fiche memb[re]" tronqué). -->
        <div
          v-if="member"
          class="pt-1"
        >
          <Button
            size="small"
            severity="secondary"
            outlined
            aria-label="Ouvrir la fiche membre"
            class="!w-fit whitespace-nowrap"
            @click="goToMember"
          >
            <template #icon>
              <UserIcon
                :size="13"
                :stroke-width="2"
              />
            </template>
            <span class="ml-1">Ouvrir la fiche membre</span>
          </Button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-[12.5px]">
          <div>
            <div class="text-surface-500 text-[11px] uppercase tracking-wide">
              Équipe
            </div>
            <div class="text-surface-800">
              {{ request.denorm?.teamName ?? '—' }}
            </div>
          </div>
          <div>
            <div class="text-surface-500 text-[11px] uppercase tracking-wide">
              Coach
            </div>
            <div class="text-surface-800">
              {{ request.denorm?.coachName ?? '—' }}
            </div>
          </div>
          <div>
            <div class="text-surface-500 text-[11px] uppercase tracking-wide">
              Validé coach
            </div>
            <div class="text-surface-800">
              {{ formatDate(request.coachValidatedAt) }}
            </div>
          </div>
          <div>
            <div class="text-surface-500 text-[11px] uppercase tracking-wide">
              Décision finale
            </div>
            <div class="text-surface-800">
              {{ formatDate(request.reviewedAt) }}
            </div>
          </div>
        </div>

        <div
          v-if="isTerminal && request.adminComment"
          class="card bg-surface-50 border-surface-200 px-3 py-2 text-[12.5px] text-surface-700"
        >
          <div class="text-surface-500 text-[11px] uppercase tracking-wide mb-1">
            Commentaire admin
          </div>
          {{ request.adminComment }}
        </div>
      </div>

      <!-- ====================== DOCUMENTS ======================= -->
      <div class="card p-5 space-y-4">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <h2 class="text-[14px] font-semibold tracking-tight">
            Documents requis
          </h2>
          <div class="text-[12px] text-surface-500">
            {{ treasurerAcceptedCount }}/{{ requiredCount }} validés trésorier
          </div>
        </div>

        <div
          v-if="request.requiredDocs.length === 0"
          class="text-[12px] text-surface-500"
        >
          Aucun document requis pour cette demande.
        </div>

        <ul
          v-else
          class="space-y-3"
        >
          <li
            v-for="kind in request.requiredDocs"
            :key="kind"
            class="border border-surface-200 rounded-lg p-3 space-y-3"
          >
            <div class="flex items-start justify-between gap-3 flex-wrap">
              <div class="flex items-start gap-2 min-w-0">
                <FileText
                  :size="16"
                  :stroke-width="2"
                  class="mt-0.5 text-surface-500 shrink-0"
                />
                <div class="min-w-0">
                  <div class="font-medium text-[13px]">
                    {{ kindLabel(kind) }}
                  </div>
                  <template v-if="request.uploadedDocs[kind]">
                    <div class="text-[11.5px] text-surface-500 truncate">
                      {{ request.uploadedDocs[kind]!.fileName }}
                      ·
                      {{ formatBytes(request.uploadedDocs[kind]!.sizeBytes) }}
                      ·
                      {{ formatDate(request.uploadedDocs[kind]!.uploadedAt) }}
                    </div>
                  </template>
                  <template v-else-if="kind === 'avs' && request.parentSubmittedAvs">
                    <div class="text-[11.5px] text-surface-500 font-mono">
                      AVS saisi : {{ request.parentSubmittedAvs }}
                    </div>
                  </template>
                  <template v-else>
                    <div class="text-[11.5px] text-amber-700">
                      Non uploadé
                    </div>
                  </template>
                </div>
              </div>

              <div
                v-if="request.uploadedDocs[kind]"
                class="shrink-0"
              >
                <Button
                  size="small"
                  severity="secondary"
                  outlined
                  aria-label="Ouvrir le document dans un nouvel onglet"
                  :loading="isDocLoading(request.uploadedDocs[kind]!)"
                  @click="openDocumentPreview(request.uploadedDocs[kind]!)"
                >
                  <template #icon>
                    <ExternalLink
                      v-if="!isDocLoading(request.uploadedDocs[kind]!)"
                      :size="13"
                      :stroke-width="2"
                    />
                    <Loader2
                      v-else
                      :size="13"
                      :stroke-width="2"
                      class="animate-spin"
                    />
                  </template>
                  <span class="ml-1">Aperçu</span>
                </Button>
              </div>
            </div>

            <!-- Status row (coach + treasurer) -->
            <div class="flex items-center gap-2 flex-wrap text-[12px]">
              <span class="text-surface-500 mr-1">Coach :</span>
              <template v-if="request.uploadedDocs[kind]?.coachReview">
                <Pill
                  v-if="request.uploadedDocs[kind]!.coachReview!.decision === 'accepted'"
                  variant="emerald"
                >
                  Validé
                </Pill>
                <Pill
                  v-else
                  variant="rose"
                >
                  Refusé
                </Pill>
                <span
                  v-if="request.uploadedDocs[kind]!.coachReview!.refusalReason"
                  class="text-rose-700"
                >
                  {{ request.uploadedDocs[kind]!.coachReview!.refusalReason }}
                </span>
              </template>
              <Pill
                v-else
                variant="slate"
              >
                En attente
              </Pill>

              <span class="text-surface-500 mx-1">·</span>

              <span class="text-surface-500 mr-1">Trésorier :</span>
              <template v-if="request.uploadedDocs[kind]?.treasurerReview">
                <Pill
                  v-if="request.uploadedDocs[kind]!.treasurerReview!.decision === 'accepted'"
                  variant="emerald"
                >
                  Validé
                </Pill>
                <Pill
                  v-else
                  variant="rose"
                >
                  Refusé
                </Pill>
                <span
                  v-if="request.uploadedDocs[kind]!.treasurerReview!.refusalReason"
                  class="text-rose-700"
                >
                  {{ request.uploadedDocs[kind]!.treasurerReview!.refusalReason }}
                </span>
                <span class="text-surface-500">
                  ({{ reviewerName(request.uploadedDocs[kind]!.treasurerReview!) }})
                </span>
              </template>
              <Pill
                v-else
                variant="slate"
              >
                À valider
              </Pill>
            </div>

            <!-- Treasurer action buttons.
                 - Valider : court-circuit coach autorisé — visible en
                   `parent_docs_submitted | coach_validated |
                   pending_parent_docs` (backend
                   `treasurerReviewLicenseDoc.accept` aligné).
                 - Refuser : visible en `coach_validated | pending_parent_docs`
                   pour permettre d'enchaîner plusieurs refus dans la même
                   session (backend accepte ces refus en cascade depuis
                   2026-05-24). Pas exposé en `parent_docs_submitted` —
                   pour refuser à ce stade, utiliser "Refuser la demande". -->
            <div
              v-if="
                canAcceptDoc &&
                  request.uploadedDocs[kind] &&
                  !request.uploadedDocs[kind]!.treasurerReview
              "
              class="flex items-center gap-2 pt-1"
            >
              <Button
                size="small"
                severity="success"
                aria-label="Valider ce document"
                :disabled="store.actionPendingId !== null"
                @click="acceptDoc(kind)"
              >
                <template #icon>
                  <CheckCircle2
                    :size="13"
                    :stroke-width="2"
                  />
                </template>
                <span class="ml-1">Valider</span>
              </Button>
              <Button
                v-if="canRefuseDoc"
                size="small"
                severity="danger"
                outlined
                aria-label="Refuser ce document"
                :disabled="store.actionPendingId !== null"
                @click="openRefuseDocDialog(kind)"
              >
                <template #icon>
                  <XCircle
                    :size="13"
                    :stroke-width="2"
                  />
                </template>
                <span class="ml-1">Refuser</span>
              </Button>
            </div>
          </li>
        </ul>
      </div>

      <!-- ====================== WORKFLOW TRÉSORIER ======================= -->
      <template v-if="showTreasurerSection">
        <LicenseRequestTreasurerSection
          v-if="isTreasurerCaller"
          :request="request"
        />
        <div
          v-else
          class="card border-surface-200 bg-surface-50 px-4 py-4 text-[12.5px] text-surface-500 flex items-start gap-2"
          aria-label="Section trésorier — accès réservé"
        >
          <ShieldCheck
            :size="14"
            :stroke-width="2"
            class="mt-0.5 shrink-0"
          />
          <div class="space-y-0.5">
            <div class="font-semibold text-surface-700">
              Workflow trésorier — accès staff uniquement
            </div>
            <p>
              Cette section est réservée aux utilisateurs ayant un rôle staff
              (<em>admin</em>, <em>trésorier</em>, <em>secrétaire</em> ou
              <em>rootAdmin</em>). Contactez un responsable du club pour
              traiter la suite de cette demande.
            </p>
          </div>
        </div>
      </template>

      <!-- ====================== FOOTER ACTIONS ======================= -->
      <div class="card p-5 space-y-3">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div class="text-[12.5px] text-surface-600 flex items-center gap-2">
            <ShieldCheck
              :size="14"
              :stroke-width="2"
              class="text-surface-500"
            />
            <span v-if="isTerminal">
              Décision finale prise. Plus d'action possible.
            </span>
            <span v-else-if="!canReject">
              En attente des documents du parent. Aucune action trésorier
              possible tant que la demande n'est pas en
              <em>Docs reçus</em>.
            </span>
            <span v-else-if="canApprove">
              Tous les documents sont validés trésorier — vous pouvez approuver.
            </span>
            <span v-else-if="isActionable">
              Validez chaque document avant de pouvoir approuver la demande.
              Un refus motivé reste possible à tout moment.
            </span>
            <span v-else>
              Vous pouvez valider chaque document sans attendre le coach,
              ou refuser la demande directement (doc faux / info erronée).
              Une fois tous les documents validés trésorier, vous pouvez
              approuver la demande sans attendre la validation coach.
            </span>
          </div>

          <div class="flex items-center gap-2">
            <Button
              severity="danger"
              :disabled="!canReject || store.actionPendingId !== null"
              aria-label="Refuser la demande"
              @click="openRejectDialog"
            >
              Refuser la demande
            </Button>
            <Button
              severity="success"
              :disabled="!canApprove || store.actionPendingId !== null"
              aria-label="Approuver la demande"
              @click="openApproveDialog"
            >
              Approuver la demande
            </Button>
          </div>
        </div>
      </div>

      <!-- ====================== BANNERS ======================= -->
      <div
        v-if="bannerError"
        class="card border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700 flex items-center gap-2"
      >
        <TriangleAlert
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
        <div class="space-y-1">
          <div>{{ bannerInfo }}</div>
          <div
            v-if="lastCreatedLicenseId"
            class="text-[11.5px] text-emerald-600 font-mono"
          >
            license id : {{ lastCreatedLicenseId }}
          </div>
        </div>
      </div>
    </template>

    <!-- ====================== DIALOG : refuser un doc ======================= -->
    <Dialog
      v-model:visible="refuseDocDialogOpen"
      modal
      :draggable="false"
      :closable="store.actionPendingId === null"
      :close-on-escape="store.actionPendingId === null"
      :style="{ width: '480px' }"
    >
      <template #header>
        <span class="flex items-center gap-2 text-rose-700 font-semibold">
          <XCircle
            :size="16"
            :stroke-width="2"
          />
          Refuser le document
        </span>
      </template>

      <div
        v-if="refuseDocKind"
        class="space-y-3 pt-1 text-[13px]"
      >
        <div class="text-surface-700">
          <strong>{{ kindLabel(refuseDocKind) }}</strong>
        </div>
        <p class="text-[12px] text-surface-600">
          La demande repassera en attente parent. Le coach devra revalider après
          re-upload.
        </p>
        <label class="block">
          <span class="text-[12px] text-surface-700">
            Motif du refus (5 à 500 caractères)
          </span>
          <Textarea
            v-model="refuseDocReason"
            class="mt-1 w-full"
            rows="4"
            :disabled="store.actionPendingId !== null"
            placeholder="Expliquez ce qui doit être corrigé"
          />
          <span class="text-[11px] text-surface-500 num">
            {{ refuseDocReasonTrimmed.length }} / 500
          </span>
        </label>
      </div>

      <template #footer>
        <Button
          severity="secondary"
          :disabled="store.actionPendingId !== null"
          @click="closeRefuseDocDialog"
        >
          Retour
        </Button>
        <Button
          severity="danger"
          :disabled="!refuseDocCanSubmit"
          @click="submitRefuseDoc"
        >
          Refuser le document
        </Button>
      </template>
    </Dialog>

    <!-- ====================== DIALOG : refuser la demande ======================= -->
    <Dialog
      v-model:visible="rejectDialogOpen"
      modal
      :draggable="false"
      :closable="store.actionPendingId === null"
      :close-on-escape="store.actionPendingId === null"
      :style="{ width: '480px' }"
    >
      <template #header>
        <span class="flex items-center gap-2 text-rose-700 font-semibold">
          <XCircle
            :size="16"
            :stroke-width="2"
          />
          Refuser la demande
        </span>
      </template>

      <div class="space-y-3 pt-1 text-[13px]">
        <p class="text-surface-700">
          La demande sera marquée comme <strong>refusée</strong>. Aucune licence
          ne sera créée. Cette action est terminale.
        </p>
        <label class="block">
          <span class="text-[12px] text-surface-700">
            Commentaire (optionnel — visible dans l'historique)
          </span>
          <Textarea
            v-model="decisionComment"
            class="mt-1 w-full"
            rows="3"
            :disabled="store.actionPendingId !== null"
            placeholder="Précision pour l'audit"
          />
          <span
            class="text-[11px] num"
            :class="decisionCommentTooLong ? 'text-rose-600' : 'text-surface-500'"
          >
            {{ decisionCommentTrimmed.length }} / 500
          </span>
        </label>
      </div>

      <template #footer>
        <Button
          severity="secondary"
          :disabled="store.actionPendingId !== null"
          @click="closeRejectDialog"
        >
          Retour
        </Button>
        <Button
          severity="danger"
          :disabled="store.actionPendingId !== null || decisionCommentTooLong"
          @click="submitReject"
        >
          Refuser la demande
        </Button>
      </template>
    </Dialog>

    <!-- ====================== DIALOG : approuver la demande ======================= -->
    <Dialog
      v-model:visible="approveDialogOpen"
      modal
      :draggable="false"
      :closable="store.actionPendingId === null"
      :close-on-escape="store.actionPendingId === null"
      :style="{ width: '520px' }"
    >
      <template #header>
        <span class="flex items-center gap-2 text-emerald-700 font-semibold">
          <CheckCircle2
            :size="16"
            :stroke-width="2"
          />
          Approuver la demande
        </span>
      </template>

      <div class="space-y-3 pt-1 text-[13px]">
        <div class="card bg-emerald-50 border-emerald-200 px-3 py-2 text-[12px] text-emerald-800">
          Une licence <strong>pending</strong> sera créée. Le paiement à la
          fédération (charge comptable + transition <em>active</em>) reste à
          faire depuis la fiche membre via <strong>« Confirmer la licence »</strong>.
        </div>
        <label class="block">
          <span class="text-[12px] text-surface-700">
            Commentaire (optionnel — visible dans l'historique)
          </span>
          <Textarea
            v-model="decisionComment"
            class="mt-1 w-full"
            rows="3"
            :disabled="store.actionPendingId !== null"
            placeholder="Précision pour l'audit"
          />
          <span
            class="text-[11px] num"
            :class="decisionCommentTooLong ? 'text-rose-600' : 'text-surface-500'"
          >
            {{ decisionCommentTrimmed.length }} / 500
          </span>
        </label>
      </div>

      <template #footer>
        <Button
          severity="secondary"
          :disabled="store.actionPendingId !== null"
          @click="closeApproveDialog"
        >
          Retour
        </Button>
        <Button
          severity="success"
          :disabled="store.actionPendingId !== null || decisionCommentTooLong"
          @click="submitApprove"
        >
          Approuver la demande
        </Button>
      </template>
    </Dialog>
  </section>
</template>
