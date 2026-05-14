<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  BadgeCheck,
  Check,
  FileText,
  Inbox,
  Wallet,
  X,
} from 'lucide-vue-next'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Textarea from 'primevue/textarea'
import {
  useMemberRequests,
  type UnifiedRequest,
} from '@/composables/useMemberRequests'
import type { MemberDetailRow } from '@/repositories/members.repo'
import type {
  PaymentExceptionRequest,
  Timestamp as NeutralTimestamp,
} from '@club-app/shared-types'

const props = defineProps<{
  memberId: string
  member: MemberDetailRow | null
  canEdit: boolean
}>()

const {
  licenseRequests,
  paymentExceptionRequests,
  unified,
  loading,
  saving,
  error,
  load,
  approveLicense,
  rejectLicense,
  approvePaymentException,
  rejectPaymentException,
} = useMemberRequests(props.memberId)

onMounted(load)

// Si le memberId change pendant que la vue est montée (navigation entre deux
// membres), on recharge. Cas peu probable car la route remonte le composant,
// mais on couvre.
watch(
  () => props.memberId,
  (next, prev) => {
    if (next !== prev) {
      void load()
    }
  },
)

// ---------------------------------------------------------------------------
// Compteurs par status
// ---------------------------------------------------------------------------
interface StatusCounts {
  pending: number
  approved: number
  rejected: number
}

function countByStatus<T extends { status: 'pending' | 'approved' | 'rejected' }>(
  rows: readonly T[],
): StatusCounts {
  const out: StatusCounts = { pending: 0, approved: 0, rejected: 0 }
  for (const r of rows) out[r.status]++
  return out
}

const licenseCounts = computed<StatusCounts>(() =>
  countByStatus(licenseRequests.value),
)
const paymentCounts = computed<StatusCounts>(() =>
  countByStatus(paymentExceptionRequests.value),
)

// ---------------------------------------------------------------------------
// Review dialog — saisie d'un commentaire optionnel avant approve/reject.
// ---------------------------------------------------------------------------
type ReviewAction = 'approve' | 'reject'

interface ReviewTarget {
  kind: 'license' | 'payment-exception'
  action: ReviewAction
  id: string
}

const isReviewOpen = ref(false)
const reviewTarget = ref<ReviewTarget | null>(null)
const reviewComment = ref('')

function openReview(target: ReviewTarget): void {
  reviewTarget.value = target
  reviewComment.value = ''
  isReviewOpen.value = true
}

const reviewDialogHeader = computed<string>(() => {
  if (!reviewTarget.value) return ''
  const kindLabel =
    reviewTarget.value.kind === 'license'
      ? 'la demande de licence'
      : "la demande d'exception cotisation"
  return reviewTarget.value.action === 'approve'
    ? `Approuver ${kindLabel}`
    : `Rejeter ${kindLabel}`
})

const submitLabel = computed<string>(() => {
  if (!reviewTarget.value) return 'Confirmer'
  return reviewTarget.value.action === 'approve' ? 'Approuver' : 'Rejeter'
})

async function submitReview(): Promise<void> {
  const target = reviewTarget.value
  if (!target) return
  const comment = reviewComment.value.trim() || undefined
  if (target.kind === 'license') {
    if (target.action === 'approve') await approveLicense(target.id, comment)
    else await rejectLicense(target.id, comment)
  } else {
    if (target.action === 'approve') await approvePaymentException(target.id, { adminComment: comment })
    else await rejectPaymentException(target.id, comment)
  }
  if (!error.value) {
    isReviewOpen.value = false
    reviewTarget.value = null
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
function neutralTsToDate(ts: NeutralTimestamp | null): Date | null {
  if (!ts) return null
  return new Date(ts.seconds * 1000 + Math.floor(ts.nanoseconds / 1_000_000))
}

function formatDate(date: Date | null): string {
  if (!date) return '—'
  return date.toLocaleDateString('fr-CH', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function formatDateTime(date: Date | null): string {
  if (!date) return '—'
  return `${date.toLocaleDateString('fr-CH', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })} ${date.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })}`
}

// ---------------------------------------------------------------------------
// Helpers d'accès typés à `data` selon `kind`. Le template utilise
// `asPaymentException` pour accéder à `reason` (champ spécifique aux
// exceptions). Pas de helper symétrique côté licence pour l'instant — la
// licence ne porte aucun champ extra par rapport à `data` commun.
// ---------------------------------------------------------------------------
function asPaymentException(item: UnifiedRequest): PaymentExceptionRequest {
  return item.data as PaymentExceptionRequest
}
</script>

<template>
  <div class="space-y-4">
    <!-- ============== Header — compteurs ============== -->
    <div class="grid gap-4 md:grid-cols-2">
      <div class="card p-5 space-y-3">
        <div class="flex items-center gap-2">
          <BadgeCheck
            :size="16"
            :stroke-width="2"
            class="text-violet-600"
          />
          <h2 class="text-[14px] font-semibold">
            Licence
          </h2>
        </div>
        <div class="flex flex-wrap gap-2 text-[12px]">
          <span class="inline-flex h-6 px-2 rounded bg-sky-100 text-sky-800 items-center">
            {{ licenseCounts.pending }} pending
          </span>
          <span class="inline-flex h-6 px-2 rounded bg-emerald-100 text-emerald-800 items-center">
            {{ licenseCounts.approved }} approuvées
          </span>
          <span class="inline-flex h-6 px-2 rounded bg-rose-100 text-rose-800 items-center">
            {{ licenseCounts.rejected }} rejetées
          </span>
        </div>
      </div>
      <div class="card p-5 space-y-3">
        <div class="flex items-center gap-2">
          <Wallet
            :size="16"
            :stroke-width="2"
            class="text-amber-600"
          />
          <h2 class="text-[14px] font-semibold">
            Exception cotisation
          </h2>
        </div>
        <div class="flex flex-wrap gap-2 text-[12px]">
          <span class="inline-flex h-6 px-2 rounded bg-sky-100 text-sky-800 items-center">
            {{ paymentCounts.pending }} pending
          </span>
          <span class="inline-flex h-6 px-2 rounded bg-emerald-100 text-emerald-800 items-center">
            {{ paymentCounts.approved }} approuvées
          </span>
          <span class="inline-flex h-6 px-2 rounded bg-rose-100 text-rose-800 items-center">
            {{ paymentCounts.rejected }} rejetées
          </span>
        </div>
      </div>
    </div>

    <!-- ============== Erreur ============== -->
    <div
      v-if="error"
      class="card p-4 bg-rose-50 border-rose-200 text-rose-800 text-[13px]"
    >
      {{ error }}
    </div>

    <!-- ============== Timeline unifiée ============== -->
    <div class="card p-5 space-y-3">
      <div class="flex items-center justify-between">
        <h2 class="text-[14px] font-semibold">
          Historique des demandes
        </h2>
        <span class="text-[12px] text-surface-500">
          {{ unified.length }} {{ unified.length > 1 ? 'demandes' : 'demande' }}
        </span>
      </div>

      <!-- Loading -->
      <div
        v-if="loading"
        class="text-center text-[13px] text-surface-500 py-6"
      >
        Chargement…
      </div>

      <!-- Empty -->
      <div
        v-else-if="unified.length === 0"
        class="flex flex-col items-center justify-center text-center text-surface-500 py-8 gap-2"
      >
        <Inbox
          :size="28"
          :stroke-width="1.5"
        />
        <p class="text-[13px]">
          Aucune demande pour ce membre.
        </p>
      </div>

      <!-- Lignes -->
      <ul
        v-else
        class="divide-y divide-surface-100"
      >
        <li
          v-for="item in unified"
          :key="`${item.kind}-${item.data.id}`"
          class="py-3 space-y-2"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-start gap-3 flex-1 min-w-0">
              <!-- Type pill -->
              <span
                v-if="item.kind === 'license'"
                class="inline-flex h-6 px-2 rounded text-[11px] font-medium bg-violet-100 text-violet-800 items-center gap-1 shrink-0"
              >
                <BadgeCheck
                  :size="11"
                  :stroke-width="2"
                />
                Licence
              </span>
              <span
                v-else
                class="inline-flex h-6 px-2 rounded text-[11px] font-medium bg-amber-100 text-amber-800 items-center gap-1 shrink-0"
              >
                <Wallet
                  :size="11"
                  :stroke-width="2"
                />
                Exception cotisation
              </span>

              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-[13px] font-medium">
                    {{ formatDate(item.createdAt) }}
                  </span>
                  <!-- Status pill -->
                  <span
                    v-if="item.data.status === 'pending'"
                    class="inline-flex h-5 px-1.5 rounded text-[11px] bg-sky-100 text-sky-800 items-center"
                  >
                    En attente
                  </span>
                  <span
                    v-else-if="item.data.status === 'approved'"
                    class="inline-flex h-5 px-1.5 rounded text-[11px] bg-emerald-100 text-emerald-800 items-center"
                  >
                    Approuvée
                  </span>
                  <span
                    v-else
                    class="inline-flex h-5 px-1.5 rounded text-[11px] bg-rose-100 text-rose-800 items-center"
                  >
                    Rejetée
                  </span>
                </div>

                <!-- Détails par type -->
                <div class="mt-1 text-[12px] text-surface-600 space-y-0.5">
                  <p>
                    <span class="text-surface-400">Demandée par</span>
                    <code class="font-mono text-[11px] ml-1">{{ item.data.requestedBy }}</code>
                    <span class="text-surface-400 ml-2">team</span>
                    <code class="font-mono text-[11px] ml-1">{{ item.data.teamId }}</code>
                  </p>
                  <!-- Raison (exception uniquement) -->
                  <p
                    v-if="item.kind === 'payment-exception'"
                    class="text-surface-700 italic"
                  >
                    <FileText
                      :size="11"
                      :stroke-width="2"
                      class="inline mr-1 -mt-0.5"
                    />
                    « {{ asPaymentException(item).reason }} »
                  </p>
                  <!-- Reviewed info -->
                  <p
                    v-if="item.data.status !== 'pending'"
                    class="text-surface-500"
                  >
                    <span class="text-surface-400">Décision par</span>
                    <code
                      v-if="item.data.reviewedBy"
                      class="font-mono text-[11px] ml-1"
                    >{{ item.data.reviewedBy }}</code>
                    <span
                      v-else
                      class="ml-1"
                    >—</span>
                    <span class="text-surface-400 ml-2">le</span>
                    <span class="ml-1">{{ formatDateTime(neutralTsToDate(item.data.reviewedAt)) }}</span>
                  </p>
                  <p
                    v-if="item.data.status !== 'pending' && item.data.adminComment"
                    class="text-surface-700"
                  >
                    <span class="text-surface-400">Commentaire :</span>
                    {{ item.data.adminComment }}
                  </p>
                </div>
              </div>
            </div>

            <!-- Actions admin (pending only) -->
            <div
              v-if="item.data.status === 'pending' && canEdit"
              class="flex items-center gap-2 shrink-0"
            >
              <Button
                size="small"
                severity="success"
                :disabled="saving"
                @click="openReview({ kind: item.kind, action: 'approve', id: item.data.id })"
              >
                <template #icon>
                  <Check
                    :size="14"
                    :stroke-width="2.5"
                  />
                </template>
                <span class="ml-1">Approuver</span>
              </Button>
              <Button
                size="small"
                severity="danger"
                text
                :disabled="saving"
                @click="openReview({ kind: item.kind, action: 'reject', id: item.data.id })"
              >
                <template #icon>
                  <X
                    :size="14"
                    :stroke-width="2.5"
                  />
                </template>
                <span class="ml-1">Rejeter</span>
              </Button>
            </div>
          </div>
        </li>
      </ul>
    </div>

    <!-- ============== Review dialog ============== -->
    <Dialog
      v-model:visible="isReviewOpen"
      modal
      :draggable="false"
      :style="{ width: '440px' }"
      :header="reviewDialogHeader"
    >
      <div class="space-y-3 pt-1">
        <p class="text-[12px] text-surface-600">
          Commentaire optionnel — visible par le coach demandeur.
        </p>
        <Textarea
          v-model="reviewComment"
          rows="4"
          class="w-full"
          placeholder="Précisez votre décision…"
        />
      </div>
      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="saving"
          @click="isReviewOpen = false"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="saving"
          @click="submitReview"
        >
          <template v-if="saving">
            Enregistrement…
          </template>
          <template v-else>
            {{ submitLabel }}
          </template>
        </button>
      </template>
    </Dialog>
  </div>
</template>
