<script setup lang="ts">
import { computed, onMounted, ref, toRef } from 'vue'
import {
  AlertCircle,
  Banknote,
  CheckCircle2,
  Coins,
  Hourglass,
  Inbox,
  Loader2,
} from 'lucide-vue-next'
import Dialog from 'primevue/dialog'
import InputNumber from 'primevue/inputnumber'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import DatePicker from 'primevue/datepicker'
import Pill from '@/components/ui/Pill.vue'
import { useMemberDues } from '@/composables/useMemberDues'
import { useAuthStore } from '@/stores/auth'
import { markDuePaid } from '@/repositories/dues.repo'
import type { MemberDetailRow } from '@/repositories/members.repo'
import type { Due, DuePaymentMethod, DueStatus, Timestamp } from '@club-app/shared-types'

const props = defineProps<{
  memberId: string
  member: MemberDetailRow | null
  canEdit: boolean
}>()

const auth = useAuthStore()

// ---------------------------------------------------------------------------
// Data — useMemberDues wrap le repo. memberId est passé en Ref pour reload si
// la route change (cf. /members/:id → /members/:other-id sans démontage).
// ---------------------------------------------------------------------------
const memberIdRef = toRef(props, 'memberId')
const { dues, loading, error, load, bySeasonId, totals } = useMemberDues(memberIdRef)

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
interface DuePillDef {
  variant: PillVariant
  label: string
  strike: boolean
}

function statusPill(status: DueStatus): DuePillDef {
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
// masqué pour les autres états (paid → déjà OK ; cancelled → terminal ;
// pending_grace → trop tôt, l'admin attend la transition `issued`).
// ---------------------------------------------------------------------------
const PAYABLE_STATUSES: readonly DueStatus[] = ['issued', 'overdue', 'excepted']

function canMarkPaid(status: DueStatus): boolean {
  return props.canEdit && PAYABLE_STATUSES.includes(status)
}

interface PayForm {
  amount: number
  method: DuePaymentMethod
  date: Date
  notes: string
}

const PAYMENT_METHODS: { label: string; value: DuePaymentMethod }[] = [
  { label: 'Cash', value: 'cash' },
  { label: 'Virement', value: 'transfer' },
  { label: 'Autre', value: 'other' },
]

const isDialogOpen = ref(false)
const dialogDue = ref<Due | null>(null)
const payForm = ref<PayForm>({
  amount: 0,
  method: 'transfer',
  date: new Date(),
  notes: '',
})
const submitting = ref(false)
const submitError = ref<string | null>(null)

function openPayDialog(due: Due): void {
  if (!canMarkPaid(due.status)) return
  dialogDue.value = due
  payForm.value = {
    amount: due.amount,
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
  dialogDue.value = null
}

async function submitPayment(): Promise<void> {
  const due = dialogDue.value
  if (!due) return
  const form = payForm.value

  // Garde : l'uid est nécessaire pour `recordedBy`. Le repo lit déjà
  // `getAuth().currentUser?.uid` mais on vérifie ici aussi pour donner un
  // message d'erreur clair côté UI plutôt qu'un throw cryptique.
  const uid = auth.authSnap?.uid
  if (!uid) {
    submitError.value = 'Session expirée — reconnecte-toi pour enregistrer un paiement.'
    return
  }
  if (!form.amount || form.amount <= 0) {
    submitError.value = 'Le montant doit être supérieur à zéro.'
    return
  }

  submitting.value = true
  submitError.value = null
  try {
    await markDuePaid(due.id, {
      amount: form.amount,
      method: form.method,
      paidAt: form.date,
      note: form.notes.trim() || undefined,
    })
    isDialogOpen.value = false
    dialogDue.value = null
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
// Empty state — explique d'où viennent les dues (Function).
// ---------------------------------------------------------------------------
const isEmpty = computed(() => !loading.value && !error.value && dues.value.length === 0)
</script>

<template>
  <!-- ============== Loading state (initial) ============== -->
  <div
    v-if="loading && dues.length === 0"
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
          {{ group.dues.length }} ligne{{ group.dues.length > 1 ? 's' : '' }}
        </span>
      </div>

      <ul class="divide-y divide-surface-200/70">
        <li
          v-for="due in group.dues"
          :key="due.id"
          class="py-3 flex items-start gap-4 flex-wrap"
        >
          <!-- Team + montant -->
          <div class="flex-1 min-w-0 space-y-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-[13px] font-medium">
                Équipe
                <span class="font-mono text-[12px] text-surface-600">{{ due.teamId }}</span>
              </span>
              <Pill
                :variant="statusPill(due.status).variant"
                :strike="statusPill(due.status).strike"
              >
                {{ statusPill(due.status).label }}
              </Pill>
            </div>
            <div class="flex items-center gap-4 flex-wrap text-[11px] text-surface-500">
              <span>
                Activée le
                <span class="num text-surface-700">{{ formatDate(due.activatedAt) }}</span>
              </span>
              <span>
                Émise le
                <span class="num text-surface-700">{{ formatDate(due.issuedAt) }}</span>
              </span>
              <span>
                Échéance
                <span class="num text-surface-700">{{ formatDate(due.dueAt) }}</span>
              </span>
              <span v-if="due.paidAt">
                Payée le
                <span class="num text-emerald-700">{{ formatDate(due.paidAt) }}</span>
              </span>
            </div>
            <div
              v-if="due.notes"
              class="text-[11px] text-surface-500 italic whitespace-pre-line"
            >
              {{ due.notes }}
            </div>
          </div>

          <!-- Montant + action -->
          <div class="flex items-center gap-3 shrink-0">
            <div class="text-right">
              <div class="text-[14px] font-semibold num">
                {{ formatCHF(due.amount) }}
              </div>
              <div
                v-if="due.status === 'paid' && due.paidAmount !== null && due.paidAmount !== due.amount"
                class="text-[11px] text-emerald-700 num"
              >
                versé : {{ formatCHF(due.paidAmount) }}
              </div>
            </div>
            <button
              v-if="canMarkPaid(due.status)"
              type="button"
              class="btn btn-secondary btn-sm"
              @click="openPayDialog(due)"
            >
              <Banknote
                :size="13"
                :stroke-width="2"
              />
              Marquer payé
            </button>
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
      v-if="dialogDue"
      class="space-y-3 pt-1"
    >
      <p class="text-[12px] text-surface-500">
        Cotisation de
        <strong class="text-surface-700">
          {{ member ? `${member.firstName} ${member.lastName}` : memberId }}
        </strong>
        pour la saison
        <span class="font-mono">{{ dialogDue.seasonId }}</span>.
      </p>

      <label class="block">
        <span class="text-[12px] text-surface-600">Montant (CHF)</span>
        <InputNumber
          v-model="payForm.amount"
          mode="currency"
          currency="CHF"
          locale="fr-CH"
          :min="0"
          :max-fraction-digits="0"
          class="mt-1 w-full"
          input-class="w-full"
        />
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
        <template v-else>
          Enregistrer
        </template>
      </button>
    </template>
  </Dialog>
</template>
