<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import DatePicker from 'primevue/datepicker'
import Message from 'primevue/message'
import type { Account } from '@club-app/shared-types'
import type { CreateInvoiceInput } from '@/stores/invoices'

/**
 * Dialog de saisie manuelle d'une **nouvelle facture fournisseur**
 * (cf. docs/compta.md §5 — OCR différé, v1 = saisie manuelle).
 *
 * Émet `submit` avec le payload de création (`Omit<CreateInvoiceInput,
 * 'createdBy'>` — `createdBy` résolu côté store) + le fichier optionnel. La
 * page parente (`Invoices.vue`) relaie vers `invoicesStore.addInvoice`.
 */
const props = defineProps<{
  visible: boolean
  /** Comptes de nature `charge` actifs — alimentent le Select compte imputé. */
  expenseAccounts: Account[]
  /** Message d'erreur remonté par le store, affiché en pied de dialog. */
  errorMessage: string | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  submit: [
    payload: Omit<CreateInvoiceInput, 'createdBy'>,
    file: File | null,
  ]
}>()

/** Taille max d'un fichier de facture — aligné sur les rules Storage. */
const MAX_FILE_BYTES = 10 * 1024 * 1024

interface FormState {
  supplierName: string
  invoiceNumber: string
  issueDate: Date | null
  dueDate: Date | null
  amount: number | null
  expenseAccountId: string | null
  notes: string
}

const form = reactive<FormState>({
  supplierName: '',
  invoiceNumber: '',
  issueDate: new Date(),
  dueDate: null,
  amount: null,
  expenseAccountId: null,
  notes: '',
})

const file = ref<File | null>(null)
const fileError = ref<string | null>(null)

/** Réinitialise le formulaire à chaque (ré)ouverture du dialog. */
watch(
  () => props.visible,
  (open) => {
    if (!open) return
    form.supplierName = ''
    form.invoiceNumber = ''
    form.issueDate = new Date()
    form.dueDate = null
    form.amount = null
    form.expenseAccountId = null
    form.notes = ''
    file.value = null
    fileError.value = null
  },
  { immediate: true },
)

const canSubmit = computed(
  () =>
    form.supplierName.trim().length > 0 &&
    form.issueDate !== null &&
    form.amount !== null &&
    form.amount > 0 &&
    fileError.value === null,
)

function onFileChange(event: Event): void {
  fileError.value = null
  const input = event.target as HTMLInputElement
  const picked = input.files?.[0] ?? null
  if (!picked) {
    file.value = null
    return
  }
  const isPdf = picked.type === 'application/pdf'
  const isImage = picked.type.startsWith('image/')
  if (!isPdf && !isImage) {
    fileError.value = 'Format non supporté — PDF ou image uniquement.'
    file.value = null
    return
  }
  if (picked.size > MAX_FILE_BYTES) {
    fileError.value = 'Fichier trop volumineux (max 10 Mo).'
    file.value = null
    return
  }
  file.value = picked
}

function clearFile(): void {
  file.value = null
  fileError.value = null
}

function close(): void {
  emit('update:visible', false)
}

function onSubmit(): void {
  if (!canSubmit.value || form.issueDate === null || form.amount === null) {
    return
  }
  const invoiceNumber = form.invoiceNumber.trim()
  const notes = form.notes.trim()
  emit(
    'submit',
    {
      supplierName: form.supplierName.trim(),
      invoiceNumber: invoiceNumber.length > 0 ? invoiceNumber : null,
      issueDate: form.issueDate,
      dueDate: form.dueDate,
      amount: form.amount,
      currency: 'CHF',
      expenseAccountId: form.expenseAccountId,
      notes: notes.length > 0 ? notes : null,
    },
    file.value,
  )
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    header="Nouvelle facture"
    :style="{ width: '36rem' }"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1.5">
        <label class="text-[12px] font-medium text-surface-600">
          Fournisseur
        </label>
        <InputText
          v-model="form.supplierName"
          placeholder="Nom du fournisseur"
          class="w-full"
        />
      </div>

      <div class="flex gap-3">
        <div class="flex flex-col gap-1.5 flex-1">
          <label class="text-[12px] font-medium text-surface-600">
            N° de facture
          </label>
          <InputText
            v-model="form.invoiceNumber"
            placeholder="Optionnel"
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

      <div class="flex gap-3">
        <div class="flex flex-col gap-1.5 flex-1">
          <label class="text-[12px] font-medium text-surface-600">
            Date d'émission
          </label>
          <DatePicker
            v-model="form.issueDate"
            date-format="dd.mm.yy"
            show-icon
            class="w-full"
          />
        </div>
        <div class="flex flex-col gap-1.5 flex-1">
          <label class="text-[12px] font-medium text-surface-600">
            Échéance
          </label>
          <DatePicker
            v-model="form.dueDate"
            date-format="dd.mm.yy"
            show-icon
            show-button-bar
            placeholder="Optionnel"
            class="w-full"
          />
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-[12px] font-medium text-surface-600">
          Compte de charge imputé
        </label>
        <Select
          v-model="form.expenseAccountId"
          :options="expenseAccounts"
          option-label="name"
          option-value="id"
          placeholder="Optionnel — peut être défini à la comptabilisation"
          show-clear
          class="w-full"
        >
          <template #option="{ option }">
            <span class="font-mono text-[12px] text-surface-500 mr-2">
              {{ option.number }}
            </span>
            {{ option.name }}
          </template>
        </Select>
        <span
          v-if="expenseAccounts.length === 0"
          class="text-[11px] text-amber-600"
        >
          Aucun compte de charge — créez-en un dans la page Comptes.
        </span>
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-[12px] font-medium text-surface-600">
          Fichier (PDF / image)
        </label>
        <input
          type="file"
          accept="application/pdf,image/*"
          class="text-[12px]"
          @change="onFileChange"
        >
        <div
          v-if="file"
          class="flex items-center gap-2 text-[12px] text-surface-600"
        >
          <span class="truncate">{{ file.name }}</span>
          <Button
            label="Retirer"
            text
            size="small"
            severity="secondary"
            @click="clearFile"
          />
        </div>
        <span
          v-if="fileError"
          class="text-[11px] text-rose-600"
        >
          {{ fileError }}
        </span>
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-[12px] font-medium text-surface-600">Notes</label>
        <Textarea
          v-model="form.notes"
          rows="2"
          auto-resize
          placeholder="Optionnel"
          class="w-full"
        />
      </div>

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
        label="Créer"
        :disabled="!canSubmit"
        @click="onSubmit"
      />
    </template>
  </Dialog>
</template>
