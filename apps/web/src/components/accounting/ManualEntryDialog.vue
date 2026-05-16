<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import DatePicker from 'primevue/datepicker'
import Message from 'primevue/message'
import type { Account } from '@club-app/shared-types'
import type { ManualEntryInput } from '@/stores/invoices'

/**
 * Dialog de **saisie manuelle d'un débit / écriture générique** (hors facture
 * et hors saisie de crédit — cf. docs/compta.md §5).
 *
 * L'utilisateur choisit librement un compte au débit et un compte au crédit
 * pour un même montant : l'écriture résultante est équilibrée à 2 lignes
 * (`Σ debit === Σ credit`). Émet `submit` avec un `ManualEntryInput`
 * (`source: 'manual'`) — la page parente relaie vers
 * `invoicesStore.addManualEntry`.
 */
const props = defineProps<{
  visible: boolean
  /** Comptes actifs — alimentent les deux Select (débit / crédit). */
  accounts: Account[]
  /** Message d'erreur remonté par le store, affiché en pied de dialog. */
  errorMessage: string | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  submit: [payload: ManualEntryInput]
}>()

interface FormState {
  date: Date | null
  label: string
  amount: number | null
  debitAccountId: string | null
  creditAccountId: string | null
  reference: string
}

const form = reactive<FormState>({
  date: new Date(),
  label: '',
  amount: null,
  debitAccountId: null,
  creditAccountId: null,
  reference: '',
})

/** Réinitialise le formulaire à chaque (ré)ouverture. */
watch(
  () => props.visible,
  (open) => {
    if (!open) return
    form.date = new Date()
    form.label = ''
    form.amount = null
    form.debitAccountId = null
    form.creditAccountId = null
    form.reference = ''
  },
  { immediate: true },
)

/** Les deux comptes doivent être distincts (une écriture à 2 lignes). */
const sameAccount = computed(
  () =>
    form.debitAccountId !== null &&
    form.debitAccountId === form.creditAccountId,
)

const canSubmit = computed(
  () =>
    form.date !== null &&
    form.label.trim().length > 0 &&
    form.amount !== null &&
    form.amount > 0 &&
    form.debitAccountId !== null &&
    form.creditAccountId !== null &&
    !sameAccount.value,
)

function close(): void {
  emit('update:visible', false)
}

function onSubmit(): void {
  if (
    !canSubmit.value ||
    form.date === null ||
    form.amount === null ||
    form.debitAccountId === null ||
    form.creditAccountId === null
  ) {
    return
  }
  const reference = form.reference.trim()
  emit('submit', {
    date: form.date,
    label: form.label.trim(),
    reference: reference.length > 0 ? reference : null,
    source: 'manual',
    invoiceId: null,
    lines: [
      { accountId: form.debitAccountId, debit: form.amount, credit: 0 },
      { accountId: form.creditAccountId, debit: 0, credit: form.amount },
    ],
  })
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    header="Saisie manuelle (débit)"
    :style="{ width: '34rem' }"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="flex flex-col gap-4">
      <p class="text-[12px] text-surface-500">
        Écriture générique à deux comptes. Le montant est débité du premier
        compte et crédité du second — l'écriture reste équilibrée.
      </p>

      <div class="flex gap-3">
        <div class="flex flex-col gap-1.5 flex-1">
          <label class="text-[12px] font-medium text-surface-600">Date</label>
          <DatePicker
            v-model="form.date"
            date-format="dd.mm.yy"
            show-icon
            class="w-full"
          />
        </div>
        <div class="flex flex-col gap-1.5 w-40">
          <label class="text-[12px] font-medium text-surface-600">
            Montant (CHF)
          </label>
          <InputNumber
            v-model="form.amount"
            mode="currency"
            currency="CHF"
            locale="fr-CH"
            :min="0"
            class="w-full"
          />
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-[12px] font-medium text-surface-600">Libellé</label>
        <InputText
          v-model="form.label"
          placeholder="Description de l'écriture"
          class="w-full"
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-[12px] font-medium text-surface-600">
          Compte débité
        </label>
        <Select
          v-model="form.debitAccountId"
          :options="accounts"
          option-label="name"
          option-value="id"
          placeholder="Choisir un compte"
          filter
          class="w-full"
        >
          <template #option="{ option }">
            <span class="font-mono text-[12px] text-surface-500 mr-2">
              {{ option.number }}
            </span>
            {{ option.name }}
          </template>
        </Select>
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-[12px] font-medium text-surface-600">
          Compte crédité
        </label>
        <Select
          v-model="form.creditAccountId"
          :options="accounts"
          option-label="name"
          option-value="id"
          placeholder="Choisir un compte"
          filter
          class="w-full"
        >
          <template #option="{ option }">
            <span class="font-mono text-[12px] text-surface-500 mr-2">
              {{ option.number }}
            </span>
            {{ option.name }}
          </template>
        </Select>
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-[12px] font-medium text-surface-600">
          Référence
        </label>
        <InputText
          v-model="form.reference"
          placeholder="Optionnel — n° de pièce"
          class="w-full"
        />
      </div>

      <Message
        v-if="sameAccount"
        severity="warn"
        :closable="false"
      >
        Le compte débité et le compte crédité doivent être différents.
      </Message>

      <Message
        v-if="errorMessage"
        severity="error"
        :closable="false"
      >
        {{ errorMessage }}
      </Message>
    </div>

    <template #footer>
      <Button
        label="Annuler"
        text
        severity="secondary"
        @click="close"
      />
      <Button
        label="Enregistrer l'écriture"
        :disabled="!canSubmit"
        @click="onSubmit"
      />
    </template>
  </Dialog>
</template>
