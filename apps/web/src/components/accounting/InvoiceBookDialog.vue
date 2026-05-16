<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import Select from 'primevue/select'
import Message from 'primevue/message'
import type { Account, Invoice } from '@club-app/shared-types'

/**
 * Dialog de choix de compte pour les deux transitions comptables d'une
 * facture (cf. docs/compta.md §5) :
 *
 *  - `mode: 'book'` — comptabilisation : on choisit le **compte de charge**
 *    imputé. La contrepartie (compte « Créditeurs ») est résolue côté page.
 *  - `mode: 'pay'`  — règlement : on choisit le **compte de trésorerie**
 *    crédité. La contrepartie (compte « Créditeurs ») est résolue côté page.
 *
 * Émet `confirm` avec l'id du compte choisi — la page parente relaie vers
 * `invoicesStore.book` / `invoicesStore.markPaid`.
 */
const props = defineProps<{
  visible: boolean
  mode: 'book' | 'pay'
  /** Facture cible — affichée en récap dans le dialog. */
  invoice: Invoice | null
  /**
   * Comptes proposés au Select : comptes de `charge` en mode `book`,
   * comptes de trésorerie en mode `pay`.
   */
  accountOptions: Account[]
  /** Message d'erreur remonté par le store, affiché en pied de dialog. */
  errorMessage: string | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  confirm: [accountId: string]
}>()

const selectedAccountId = ref<string | null>(null)

/** Pré-sélectionne le compte de charge déjà imputé en mode `book`. */
watch(
  () => props.visible,
  (open) => {
    if (!open) {
      selectedAccountId.value = null
      return
    }
    selectedAccountId.value =
      props.mode === 'book' ? (props.invoice?.expenseAccountId ?? null) : null
  },
  { immediate: true },
)

const title = computed(() =>
  props.mode === 'book' ? 'Comptabiliser la facture' : 'Marquer la facture payée',
)

const accountLabel = computed(() =>
  props.mode === 'book' ? 'Compte de charge imputé' : 'Compte de trésorerie',
)

const hint = computed(() =>
  props.mode === 'book'
    ? 'Écriture : débit du compte de charge, crédit du compte « Créditeurs (fournisseurs) ».'
    : 'Écriture : débit du compte « Créditeurs (fournisseurs) », crédit du compte de trésorerie.',
)

const amountLabel = computed(() => {
  const amount = props.invoice?.amount ?? 0
  return new Intl.NumberFormat('fr-CH', {
    style: 'currency',
    currency: props.invoice?.currency ?? 'CHF',
  }).format(amount)
})

const canConfirm = computed(() => selectedAccountId.value !== null)

function close(): void {
  emit('update:visible', false)
}

function onConfirm(): void {
  if (selectedAccountId.value === null) return
  emit('confirm', selectedAccountId.value)
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="title"
    :style="{ width: '30rem' }"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="flex flex-col gap-4">
      <div
        v-if="invoice"
        class="rounded bg-surface-50 p-3 text-[13px]"
      >
        <div class="font-medium text-surface-700">
          {{ invoice.supplierName }}
        </div>
        <div class="text-surface-500">
          <span v-if="invoice.invoiceNumber">{{ invoice.invoiceNumber }} · </span>
          {{ amountLabel }}
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-[12px] font-medium text-surface-600">
          {{ accountLabel }}
        </label>
        <Select
          v-model="selectedAccountId"
          :options="accountOptions"
          option-label="name"
          option-value="id"
          placeholder="Choisir un compte"
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
          v-if="accountOptions.length === 0"
          class="text-[11px] text-amber-600"
        >
          Aucun compte disponible — créez-en un dans la page Comptes.
        </span>
      </div>

      <p class="text-[11px] text-surface-500">
        {{ hint }}
      </p>

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
        :label="mode === 'book' ? 'Comptabiliser' : 'Marquer payée'"
        :disabled="!canConfirm"
        @click="onConfirm"
      />
    </template>
  </Dialog>
</template>
