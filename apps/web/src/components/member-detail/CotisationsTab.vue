<script setup lang="ts">
import { computed, onMounted, ref, toRef, watch } from 'vue'
import {
  AlertCircle,
  Banknote,
  CheckCircle2,
  Coins,
  Hourglass,
  Inbox,
  Loader2,
  Trash2,
  TriangleAlert,
  XCircle,
} from 'lucide-vue-next'
import Dialog from 'primevue/dialog'
import InputNumber from 'primevue/inputnumber'
import InputSwitch from 'primevue/inputswitch'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import DatePicker from 'primevue/datepicker'
import Pill from '@/components/ui/Pill.vue'
import { useMemberCotisations } from '@/composables/useMemberCotisations'
import { useAuthStore } from '@/stores/auth'
import { markCotisationPaid } from '@/repositories/cotisations.repo'
import type { MemberDetailRow } from '@/repositories/members.repo'
import type {
  Cotisation,
  CotisationPaymentMethod,
  CotisationStatus,
  Timestamp,
} from '@club-app/shared-types'

const props = defineProps<{
  memberId: string
  member: MemberDetailRow | null
  canEdit: boolean
}>()

const auth = useAuthStore()

// ---------------------------------------------------------------------------
// Data — useMemberCotisations wrap le repo. memberId est passé en Ref pour
// reload si la route change (cf. /members/:id → /members/:other-id sans
// démontage).
// ---------------------------------------------------------------------------
const memberIdRef = toRef(props, 'memberId')
const {
  cotisations,
  loading,
  error,
  pendingActionFor,
  load,
  bySeasonId,
  totals,
  cancel: cancelCotisation,
  remove: deleteCotisation,
} = useMemberCotisations(memberIdRef)

onMounted(() => {
  void load()
})

// ---------------------------------------------------------------------------
// Currency / date helpers.
// ---------------------------------------------------------------------------
const chf = new Intl.NumberFormat('fr-CH', {
  style: 'currency',
  currency: 'CHF',
  maximumFractionDigits: 0,
})
function formatCHF(n: number): string {
  return chf.format(n)
}
function formatDate(ts: Timestamp | null): string {
  if (!ts) return '—'
  return new Date(ts.seconds * 1000).toLocaleDateString('fr-CH')
}

// ---------------------------------------------------------------------------
// Status pill — variantes alignées sur Members.vue / MemberDetail.vue.
// ---------------------------------------------------------------------------
type PillVariant = 'emerald' | 'sky' | 'amber' | 'rose' | 'slate'
interface CotisationPillDef {
  variant: PillVariant
  label: string
  strike: boolean
}

function statusPill(status: CotisationStatus): CotisationPillDef {
  switch (status) {
    case 'paid':
      return { variant: 'emerald', label: 'Payé', strike: false }
    case 'pending_grace':
      return { variant: 'slate', label: 'Grace period', strike: false }
    case 'issued':
      return { variant: 'sky', label: 'Issued', strike: false }
    case 'overdue':
      return { variant: 'rose', label: 'Overdue', strike: false }
    case 'excepted':
      return { variant: 'amber', label: 'Exception', strike: false }
    case 'cancelled':
    default:
      return { variant: 'slate', label: 'Cancelled', strike: true }
  }
}

// ---------------------------------------------------------------------------
// Mark-paid dialog.
//
// Visible si canEdit ET status ∈ {issued, overdue, excepted}. Le bouton est
// masqué pour les autres états (paid → déjà OK ; cancelled → terminal).
//
// Exception comité (rootAdmin / treasurer) : `pending_grace` est aussi
// marquable pour eux — cas in-extremis où le comité veut valider tôt un
// paiement pour débloquer une licence avant la fin de la grace period. Un
// admin standard ne voit pas le bouton sur pending_grace (il attend la
// transition `issued` automatique).
// ---------------------------------------------------------------------------
const PAYABLE_STATUSES: readonly CotisationStatus[] = [
  'issued',
  'overdue',
  'excepted',
]

function canMarkPaid(status: CotisationStatus): boolean {
  if (!props.canEdit) return false
  if (PAYABLE_STATUSES.includes(status)) return true
  // canAdjustAmount = rootAdmin || treasurer — réutilisé comme "isCommittee"
  // pour la dérogation pending_grace (même périmètre comité).
  if (status === 'pending_grace' && canAdjustAmount.value) return true
  return false
}

interface PayForm {
  amount: number
  method: CotisationPaymentMethod
  date: Date
  notes: string
}

const PAYMENT_METHODS: { label: string; value: CotisationPaymentMethod }[] = [
  { label: 'Cash', value: 'cash' },
  { label: 'Virement', value: 'transfer' },
  { label: 'Autre', value: 'other' },
]

const isDialogOpen = ref(false)
const dialogCotisation = ref<Cotisation | null>(null)
const payForm = ref<PayForm>({
  amount: 0,
  method: 'transfer',
  date: new Date(),
  notes: '',
})
const submitting = ref(false)
const submitError = ref<string | null>(null)

// Toggle "Cotisation payée intégralement" — ON par défaut. Le champ montant
// n'apparaît que si OFF (arrangement in extremis). Le switch n'est exposé qu'au
// comité (rootAdmin OU rôle `treasurer`) ; un admin standard est verrouillé sur
// le montant complet et ne peut pas négocier de montant partiel via cette UI.
// La même règle est répliquée côté callable `markDuePaid` (cf.
// `functions/src/dues/markDuePaid.ts` — défense en profondeur).
const isFullPayment = ref(true)
const canAdjustAmount = computed(
  () => auth.rootAdmin || auth.roles.includes('treasurer'),
)

watch(isFullPayment, (full) => {
  const cotisation = dialogCotisation.value
  if (full && cotisation) {
    payForm.value.amount = cotisation.amount
  }
})

function openPayDialog(cotisation: Cotisation): void {
  if (!canMarkPaid(cotisation.status)) return
  dialogCotisation.value = cotisation
  isFullPayment.value = true
  payForm.value = {
    amount: cotisation.amount,
    method: 'transfer',
    date: new Date(),
    notes: '',
  }
  submitError.value = null
  isDialogOpen.value = true
}

function closeDialog(): void {
  if (submitting.value) return
  isDialogOpen.value = false
  dialogCotisation.value = null
}

async function submitPayment(): Promise<void> {
  const cotisation = dialogCotisation.value
  if (!cotisation) return
  const form = payForm.value

  // Garde : l'uid est nécessaire pour `recordedBy`. Le repo lit déjà
  // `getAuth().currentUser?.uid` mais on vérifie ici aussi pour donner un
  // message d'erreur clair côté UI plutôt qu'un throw cryptique.
  const uid = auth.authSnap?.uid
  if (!uid) {
    submitError.value = 'Session expirée — reconnecte-toi pour enregistrer un paiement.'
    return
  }
  // Défense en profondeur : seul rootAdmin peut entrer un montant partiel.
  // Même si l'admin standard ne voit pas le switch, on force le montant total
  // côté soumission.
  const effectiveFullPayment = isFullPayment.value || !canAdjustAmount.value
  const amount = effectiveFullPayment ? cotisation.amount : form.amount
  if (!amount || amount <= 0) {
    submitError.value = 'Le montant doit être supérieur à zéro.'
    return
  }
  if (!effectiveFullPayment && amount > cotisation.amount) {
    submitError.value = `Le montant ne peut pas dépasser ${formatCHF(cotisation.amount)}.`
    return
  }

  submitting.value = true
  submitError.value = null
  try {
    await markCotisationPaid(cotisation.id, {
      amount,
      method: form.method,
      paidAt: form.date,
      note: form.notes.trim() || undefined,
    })
    isDialogOpen.value = false
    dialogCotisation.value = null
    await load()
  } catch (e: unknown) {
    submitError.value =
      e instanceof Error
        ? e.message
        : "Erreur lors de l'enregistrement du paiement."
  } finally {
    submitting.value = false
  }
}

// ---------------------------------------------------------------------------
// Cancel — passe la cotisation en `status: 'cancelled'` avec un motif (append
// dans `notes`). Réservé aux statuts non-terminaux et non-payés (perd
// l'historique de paiement sinon).
// ---------------------------------------------------------------------------
const CANCELLABLE_STATUSES: readonly CotisationStatus[] = [
  'pending_grace',
  'issued',
  'overdue',
  'excepted',
]

function canCancel(status: CotisationStatus): boolean {
  return props.canEdit && CANCELLABLE_STATUSES.includes(status)
}

const isCancelDialogOpen = ref(false)
const cancelTarget = ref<Cotisation | null>(null)
const cancelReason = ref('')
const cancelSubmitting = ref(false)
const cancelError = ref<string | null>(null)

function openCancelDialog(cotisation: Cotisation): void {
  if (!canCancel(cotisation.status)) return
  cancelTarget.value = cotisation
  cancelReason.value = ''
  cancelError.value = null
  isCancelDialogOpen.value = true
}

function closeCancelDialog(): void {
  if (cancelSubmitting.value) return
  isCancelDialogOpen.value = false
  cancelTarget.value = null
}

async function submitCancel(): Promise<void> {
  const cotisation = cancelTarget.value
  if (!cotisation) return
  const reason = cancelReason.value.trim()
  if (reason.length < 3) {
    cancelError.value = 'Indique un motif (3 caractères minimum).'
    return
  }
  if (reason.length > 500) {
    cancelError.value = 'Motif trop long (max 500 caractères).'
    return
  }
  cancelSubmitting.value = true
  cancelError.value = null
  try {
    await cancelCotisation(cotisation.id, reason)
    isCancelDialogOpen.value = false
    cancelTarget.value = null
  } catch (e: unknown) {
    cancelError.value =
      e instanceof Error ? e.message : "Erreur lors de l'annulation de la cotisation."
  } finally {
    cancelSubmitting.value = false
  }
}

// ---------------------------------------------------------------------------
// Delete — suppression définitive (deleteDoc). Mêmes garde-fous UX que
// `DeleteMemberDialog` : type-to-confirm. Refusé serveur-side si la cotisation
// est `paid` (cf. `deleteCotisation` repo).
// ---------------------------------------------------------------------------

function canDelete(status: CotisationStatus): boolean {
  // Tous les statuts sauf `paid` (interdiction métier — la trace comptable
  // doit être préservée). Le repo refuse `paid` aussi en filet serveur.
  return props.canEdit && status !== 'paid'
}

const DELETE_CONFIRM_TOKEN = 'SUPPRIMER'

const isDeleteDialogOpen = ref(false)
const deleteTarget = ref<Cotisation | null>(null)
const deleteConfirmInput = ref('')
const deleteSubmitting = ref(false)
const deleteError = ref<string | null>(null)

const canSubmitDelete = computed<boolean>(() => {
  if (deleteSubmitting.value) return false
  return deleteConfirmInput.value.trim().toUpperCase() === DELETE_CONFIRM_TOKEN
})

function openDeleteDialog(cotisation: Cotisation): void {
  if (!canDelete(cotisation.status)) return
  deleteTarget.value = cotisation
  deleteConfirmInput.value = ''
  deleteError.value = null
  isDeleteDialogOpen.value = true
}

function closeDeleteDialog(): void {
  if (deleteSubmitting.value) return
  isDeleteDialogOpen.value = false
  deleteTarget.value = null
}

async function submitDelete(): Promise<void> {
  if (!canSubmitDelete.value) return
  const cotisation = deleteTarget.value
  if (!cotisation) return
  deleteSubmitting.value = true
  deleteError.value = null
  try {
    await deleteCotisation(cotisation.id)
    isDeleteDialogOpen.value = false
    deleteTarget.value = null
  } catch (e: unknown) {
    deleteError.value =
      e instanceof Error ? e.message : 'Erreur lors de la suppression de la cotisation.'
  } finally {
    deleteSubmitting.value = false
  }
}

// ---------------------------------------------------------------------------
// Empty state — explique d'où viennent les cotisations (Function).
// ---------------------------------------------------------------------------
const isEmpty = computed(
  () => !loading.value && !error.value && cotisations.value.length === 0,
)
</script>

<template>
  <!-- ============== Loading state (initial) ============== -->
  <div
    v-if="loading && cotisations.length === 0"
    class="card p-8 flex items-center justify-center gap-2 text-[13px] text-surface-500"
    aria-busy="true"
  >
    <Loader2
      :size="14"
      :stroke-width="2"
      class="animate-spin"
    />
    Chargement des cotisations…
  </div>

  <!-- ============== Error state ============== -->
  <div
    v-else-if="error"
    class="card border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700 flex items-start gap-2"
  >
    <AlertCircle
      :size="14"
      :stroke-width="2"
      class="mt-0.5"
    />
    <div>
      <div class="font-medium">
        Impossible de charger les cotisations
      </div>
      <div class="text-[12px] mt-0.5">
        {{ error }}
      </div>
    </div>
  </div>

  <!-- ============== Empty state ============== -->
  <div
    v-else-if="isEmpty"
    class="card p-10 flex flex-col items-center text-center gap-3"
  >
    <span
      class="w-10 h-10 rounded-full bg-surface-100 inline-flex items-center justify-center text-surface-500"
    >
      <Inbox
        :size="18"
        :stroke-width="2"
      />
    </span>
    <div class="text-[14px] font-semibold">
      Aucune cotisation enregistrée pour ce membre.
    </div>
    <p class="text-[12px] text-surface-500 max-w-md">
      Les cotisations sont créées automatiquement quand le membre est ajouté à
      une équipe (cf. Function
      <code class="font-mono text-[11px]">initiateDuesOnPlayerActivation</code>).
    </p>
  </div>

  <!-- ============== Content ============== -->
  <div
    v-else
    class="space-y-4"
  >
    <!-- =========== Summary cards =========== -->
    <div class="grid gap-3 md:grid-cols-3">
      <!-- Paid -->
      <div class="card p-4 space-y-1">
        <div class="flex items-center gap-2 text-[12px] text-surface-500">
          <CheckCircle2
            :size="13"
            :stroke-width="2"
            class="text-emerald-600"
          />
          <span>Versé</span>
        </div>
        <div class="text-[18px] font-semibold text-surface-900 num">
          {{ formatCHF(totals.paid.amount) }}
        </div>
        <div class="text-[11px] text-surface-500 num">
          {{ totals.paid.count }} cotisation{{ totals.paid.count > 1 ? 's' : '' }}
        </div>
      </div>
      <!-- Due (issued / pending_grace / excepted) -->
      <div class="card p-4 space-y-1">
        <div class="flex items-center gap-2 text-[12px] text-surface-500">
          <Hourglass
            :size="13"
            :stroke-width="2"
            class="text-sky-600"
          />
          <span>Dû</span>
        </div>
        <div class="text-[18px] font-semibold text-surface-900 num">
          {{ formatCHF(totals.due.amount) }}
        </div>
        <div class="text-[11px] text-surface-500 num">
          {{ totals.due.count }} en attente
        </div>
      </div>
      <!-- Overdue -->
      <div
        class="card p-4 space-y-1"
        :class="totals.overdue.count > 0 ? 'border-rose-200 bg-rose-50/40' : ''"
      >
        <div class="flex items-center gap-2 text-[12px] text-surface-500">
          <AlertCircle
            :size="13"
            :stroke-width="2"
            class="text-rose-600"
          />
          <span>En retard</span>
        </div>
        <div
          class="text-[18px] font-semibold num"
          :class="totals.overdue.count > 0 ? 'text-rose-700' : 'text-surface-900'"
        >
          {{ formatCHF(totals.overdue.amount) }}
        </div>
        <div
          class="text-[11px] num"
          :class="totals.overdue.count > 0 ? 'text-rose-600' : 'text-surface-500'"
        >
          {{ totals.overdue.count }} en retard
        </div>
      </div>
    </div>

    <!-- =========== Timeline par saison =========== -->
    <div
      v-for="group in bySeasonId"
      :key="group.seasonId"
      class="card p-5 space-y-3"
    >
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-[14px] font-semibold flex items-center gap-2">
          <Coins
            :size="14"
            :stroke-width="2"
            class="text-surface-500"
          />
          Saison
          <span class="font-mono text-[12px] text-surface-600">{{ group.seasonId }}</span>
        </h3>
        <span class="text-[11px] text-surface-500 num">
          {{ group.cotisations.length }} ligne{{ group.cotisations.length > 1 ? 's' : '' }}
        </span>
      </div>

      <ul class="divide-y divide-surface-200/70">
        <li
          v-for="cotisation in group.cotisations"
          :key="cotisation.id"
          class="py-3 flex items-start gap-4 flex-wrap"
        >
          <!-- Team + montant -->
          <div class="flex-1 min-w-0 space-y-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-[13px] font-medium">
                Équipe
                <span class="font-mono text-[12px] text-surface-600">{{ cotisation.teamId }}</span>
              </span>
              <Pill
                :variant="statusPill(cotisation.status).variant"
                :strike="statusPill(cotisation.status).strike"
              >
                {{ statusPill(cotisation.status).label }}
              </Pill>
            </div>
            <div class="flex items-center gap-4 flex-wrap text-[11px] text-surface-500">
              <span>
                Activée le
                <span class="num text-surface-700">{{ formatDate(cotisation.activatedAt) }}</span>
              </span>
              <span>
                Émise le
                <span class="num text-surface-700">{{ formatDate(cotisation.issuedAt) }}</span>
              </span>
              <span>
                Échéance
                <span class="num text-surface-700">{{ formatDate(cotisation.dueAt) }}</span>
              </span>
              <span v-if="cotisation.paidAt">
                Payée le
                <span class="num text-emerald-700">{{ formatDate(cotisation.paidAt) }}</span>
              </span>
            </div>
            <div
              v-if="cotisation.notes"
              class="text-[11px] text-surface-500 italic whitespace-pre-line"
            >
              {{ cotisation.notes }}
            </div>
          </div>

          <!-- Montant + action -->
          <div class="flex items-center gap-3 shrink-0">
            <div class="text-right">
              <div class="text-[14px] font-semibold num">
                {{ formatCHF(cotisation.amount) }}
              </div>
              <div
                v-if="cotisation.status === 'paid' && cotisation.paidAmount !== null && cotisation.paidAmount !== cotisation.amount"
                class="text-[11px] text-emerald-700 num"
              >
                versé : {{ formatCHF(cotisation.paidAmount) }}
              </div>
            </div>
            <div class="flex items-center gap-1.5 flex-wrap justify-end">
              <button
                v-if="canMarkPaid(cotisation.status)"
                type="button"
                class="btn btn-secondary btn-sm"
                :disabled="pendingActionFor === cotisation.id"
                @click="openPayDialog(cotisation)"
              >
                <Banknote
                  :size="13"
                  :stroke-width="2"
                />
                Marquer payé
              </button>
              <button
                v-if="canCancel(cotisation.status)"
                type="button"
                class="btn btn-secondary btn-sm !text-amber-700 hover:!bg-amber-50"
                :disabled="pendingActionFor === cotisation.id"
                @click="openCancelDialog(cotisation)"
              >
                <XCircle
                  :size="13"
                  :stroke-width="2"
                />
                Annuler
              </button>
              <button
                v-if="canDelete(cotisation.status)"
                type="button"
                class="btn btn-secondary btn-sm !text-rose-700 hover:!bg-rose-50"
                :disabled="pendingActionFor === cotisation.id"
                @click="openDeleteDialog(cotisation)"
              >
                <Trash2
                  :size="13"
                  :stroke-width="2"
                />
                Supprimer
              </button>
            </div>
          </div>
        </li>
      </ul>
    </div>
  </div>

  <!-- ============== Mark-paid Dialog ============== -->
  <Dialog
    v-model:visible="isDialogOpen"
    modal
    :draggable="false"
    :closable="!submitting"
    :style="{ width: '480px' }"
    header="Enregistrer un paiement"
  >
    <div
      v-if="dialogCotisation"
      class="space-y-3 pt-1"
    >
      <p class="text-[12px] text-surface-500">
        Cotisation de
        <strong class="text-surface-700">
          {{ member ? `${member.firstName} ${member.lastName}` : memberId }}
        </strong>
        pour la saison
        <span class="font-mono">{{ dialogCotisation.seasonId }}</span>.
      </p>

      <!-- Toggle "Cotisation payée intégralement" — ne s'affiche qu'au rootAdmin.
           Quand OFF, le champ montant apparaît (arrangement in extremis). -->
      <div
        v-if="canAdjustAmount"
        class="rounded border border-surface-200 bg-surface-50 px-3 py-2 flex items-center justify-between gap-3"
      >
        <div class="min-w-0">
          <div class="text-[13px] font-medium text-surface-800">
            Cotisation payée intégralement
          </div>
          <div class="text-[11px] text-surface-500">
            <template v-if="isFullPayment">
              Montant complet : <span class="num">{{ formatCHF(dialogCotisation.amount) }}</span>
            </template>
            <template v-else>
              Arrangement — saisis un montant partiel ci-dessous.
            </template>
          </div>
        </div>
        <InputSwitch v-model="isFullPayment" />
      </div>

      <label
        v-if="!isFullPayment && canAdjustAmount"
        class="block"
      >
        <span class="text-[12px] text-surface-600">Montant versé (CHF)</span>
        <InputNumber
          v-model="payForm.amount"
          mode="currency"
          currency="CHF"
          locale="fr-CH"
          :min="0"
          :max="dialogCotisation.amount"
          :max-fraction-digits="0"
          class="mt-1 w-full"
          input-class="w-full"
        />
        <span class="block mt-1 text-[11px] text-amber-700">
          Arrangement — montant dû : {{ formatCHF(dialogCotisation.amount) }}.
        </span>
      </label>

      <label class="block">
        <span class="text-[12px] text-surface-600">Méthode</span>
        <Select
          v-model="payForm.method"
          :options="PAYMENT_METHODS"
          option-label="label"
          option-value="value"
          class="mt-1 w-full"
        />
      </label>

      <label class="block">
        <span class="text-[12px] text-surface-600">Date du paiement</span>
        <DatePicker
          v-model="payForm.date"
          date-format="dd.mm.yy"
          show-icon
          class="mt-1 w-full"
        />
      </label>

      <label class="block">
        <span class="text-[12px] text-surface-600">Notes (optionnel)</span>
        <Textarea
          v-model="payForm.notes"
          rows="2"
          auto-resize
          class="mt-1 w-full"
          placeholder="Référence virement, remarque…"
        />
      </label>

      <p
        v-if="submitError"
        class="text-[12px] text-rose-600"
      >
        {{ submitError }}
      </p>
    </div>
    <template #footer>
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        :disabled="submitting"
        @click="closeDialog"
      >
        Annuler
      </button>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        :disabled="submitting"
        @click="submitPayment"
      >
        <template v-if="submitting">
          Enregistrement…
        </template>
        <template v-else-if="!isFullPayment && canAdjustAmount">
          Enregistrer l'arrangement
        </template>
        <template v-else>
          Marquer payée
        </template>
      </button>
    </template>
  </Dialog>

  <!-- ============== Cancel Dialog ============== -->
  <Dialog
    v-model:visible="isCancelDialogOpen"
    modal
    :draggable="false"
    :closable="!cancelSubmitting"
    :close-on-escape="!cancelSubmitting"
    :style="{ width: '480px' }"
  >
    <template #header>
      <span class="flex items-center gap-2 text-amber-700 font-semibold">
        <XCircle
          :size="16"
          :stroke-width="2"
        />
        Annuler la cotisation
      </span>
    </template>
    <div
      v-if="cancelTarget"
      class="space-y-3 pt-1 text-[13px]"
    >
      <div
        class="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 flex items-start gap-2"
      >
        <TriangleAlert
          :size="14"
          :stroke-width="2"
          class="mt-0.5 shrink-0"
        />
        <p class="text-[12px] leading-snug">
          La cotisation passera en statut <strong>Cancelled</strong> et ne sera
          plus comptabilisée. Le motif sera ajouté aux notes pour conserver la
          trace. Réversible côté admin uniquement (modif Firestore directe).
        </p>
      </div>

      <div class="rounded border border-surface-200 bg-surface-50 px-3 py-2 text-[12px] text-surface-700 space-y-0.5">
        <div>
          Montant : <strong class="num">{{ formatCHF(cancelTarget.amount) }}</strong>
        </div>
        <div>
          Saison : <span class="font-mono">{{ cancelTarget.seasonId }}</span>
        </div>
        <div>
          Statut actuel :
          <Pill
            :variant="statusPill(cancelTarget.status).variant"
            :strike="statusPill(cancelTarget.status).strike"
          >
            {{ statusPill(cancelTarget.status).label }}
          </Pill>
        </div>
      </div>

      <label class="block">
        <span class="text-[12px] text-surface-700">
          Motif de l'annulation <span class="text-rose-600">*</span>
        </span>
        <Textarea
          v-model="cancelReason"
          rows="3"
          auto-resize
          class="mt-1 w-full"
          placeholder="Ex. erreur de saisie, joueur parti…"
          :disabled="cancelSubmitting"
          :invalid="!!cancelError"
        />
      </label>

      <Message
        v-if="cancelError"
        severity="error"
        :closable="false"
      >
        {{ cancelError }}
      </Message>
    </div>
    <template #footer>
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        :disabled="cancelSubmitting"
        @click="closeCancelDialog"
      >
        Retour
      </button>
      <button
        type="button"
        class="btn btn-primary btn-sm !bg-amber-600 hover:!bg-amber-700 disabled:!bg-amber-300"
        :disabled="cancelSubmitting"
        @click="submitCancel"
      >
        <template v-if="cancelSubmitting">
          Annulation…
        </template>
        <template v-else>
          Annuler la cotisation
        </template>
      </button>
    </template>
  </Dialog>

  <!-- ============== Delete Dialog ============== -->
  <Dialog
    v-model:visible="isDeleteDialogOpen"
    modal
    :draggable="false"
    :closable="!deleteSubmitting"
    :close-on-escape="!deleteSubmitting"
    :style="{ width: '520px' }"
  >
    <template #header>
      <span class="flex items-center gap-2 text-rose-700 font-semibold">
        <TriangleAlert
          :size="16"
          :stroke-width="2"
        />
        Suppression définitive
      </span>
    </template>
    <div
      v-if="deleteTarget"
      class="space-y-3 pt-1 text-[13px]"
    >
      <div
        class="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 flex items-start gap-2"
      >
        <TriangleAlert
          :size="14"
          :stroke-width="2"
          class="mt-0.5 shrink-0"
        />
        <p class="text-[12px] leading-snug">
          Cette action est destinée à corriger une
          <strong>erreur de création</strong>. Pour clôturer proprement une
          cotisation, utilisez plutôt <strong>Annuler</strong> — la trace est
          conservée.
        </p>
      </div>

      <div class="rounded border border-surface-200 bg-surface-50 px-3 py-2 text-[12px] text-surface-700 space-y-0.5">
        <div>
          Montant : <strong class="num">{{ formatCHF(deleteTarget.amount) }}</strong>
        </div>
        <div>
          Saison : <span class="font-mono">{{ deleteTarget.seasonId }}</span>
        </div>
        <div>
          Statut actuel :
          <Pill
            :variant="statusPill(deleteTarget.status).variant"
            :strike="statusPill(deleteTarget.status).strike"
          >
            {{ statusPill(deleteTarget.status).label }}
          </Pill>
        </div>
        <div class="text-rose-700 pt-1">
          <strong>Action irréversible.</strong>
        </div>
      </div>

      <label class="block">
        <span class="text-[12px] text-surface-700">
          Tapez <code class="font-mono text-rose-700">{{ DELETE_CONFIRM_TOKEN }}</code>
          pour confirmer
        </span>
        <InputText
          v-model="deleteConfirmInput"
          class="mt-1 w-full"
          :placeholder="DELETE_CONFIRM_TOKEN"
          :disabled="deleteSubmitting"
          autocomplete="off"
          @keyup.enter="submitDelete"
        />
      </label>

      <Message
        v-if="deleteError"
        severity="error"
        :closable="false"
      >
        {{ deleteError }}
      </Message>
    </div>
    <template #footer>
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        :disabled="deleteSubmitting"
        @click="closeDeleteDialog"
      >
        Retour
      </button>
      <button
        type="button"
        class="btn btn-primary btn-sm !bg-rose-600 hover:!bg-rose-700 disabled:!bg-rose-300"
        :disabled="!canSubmitDelete"
        @click="submitDelete"
      >
        <Trash2
          :size="13"
          :stroke-width="2"
        />
        <template v-if="deleteSubmitting">
          Suppression…
        </template>
        <template v-else>
          Supprimer définitivement
        </template>
      </button>
    </template>
  </Dialog>
</template>
