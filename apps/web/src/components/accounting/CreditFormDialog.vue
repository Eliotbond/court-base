<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import DatePicker from 'primevue/datepicker'
import Select from 'primevue/select'
import Message from 'primevue/message'
import { validateEntryBalance } from '@/repositories/accountingEntries.repo'
import type { Account } from '@club-app/shared-types'

/**
 * Dialog de saisie d'un crédit (cash, sponsoring, subvention J+S…) — module
 * Comptabilité, saisie simplifiée « un côté » (docs/compta.md §5).
 *
 * L'utilisateur renseigne le compte crédité, le montant, la date et un
 * compte de trésorerie en contrepartie. L'écriture finale (2 lignes
 * équilibrées) est construite côté repo (`postCredit`) ; ce dialog n'émet
 * qu'un payload de saisie. La page parente (`Credits.vue`) relaie au store.
 *
 * Préfixe `Credit` du nom de fichier : convention du périmètre Agent B pour
 * éviter les collisions avec les composants accounting des autres agents.
 */

/** Payload émis vers la page parente — relayé tel quel à `store.addCredit`. */
export interface CreditFormPayload {
  accountId: string
  treasuryAccountId: string
  amount: number
  date: Date
  label: string
  reference: string | null
}

const props = defineProps<{
  visible: boolean
  /** Comptes éligibles comme compte crédité (typiquement les `produit`). */
  accountOptions: Account[]
  /** Comptes de trésorerie éligibles comme contrepartie (Caisse / Banque). */
  treasuryOptions: Account[]
  /** Message d'erreur remonté par le store, affiché en pied de dialog. */
  errorMessage: string | null
  /** `true` pendant la soumission — désactive le bouton. */
  submitting: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  submit: [payload: CreditFormPayload]
}>()

interface FormState {
  date: Date
  label: string
  amount: number | null
  accountId: string | null
  treasuryAccountId: string | null
  reference: string
}

const form = reactive<FormState>({
  date: new Date(),
  label: '',
  amount: null,
  accountId: null,
  treasuryAccountId: null,
  reference: '',
})

/**
 * Erreur de validation locale (équilibre de l'écriture). Affichée en plus du
 * `errorMessage` serveur ; remise à null à chaque (ré)ouverture.
 */
const localError = computed<string | null>(() => {
  if (form.amount === null || form.amount <= 0) return null
  if (!form.accountId || !form.treasuryAccountId) return null
  try {
    validateEntryBalance([
      { accountId: form.treasuryAccountId, debit: form.amount, credit: 0 },
      { accountId: form.accountId, debit: 0, credit: form.amount },
    ])
    return null
  } catch (err) {
    return err instanceof Error ? err.message : 'Écriture invalide'
  }
})

/** Réinitialise le formulaire à chaque (ré)ouverture du dialog. */
watch(
  () => props.visible,
  (open) => {
    if (!open) return
    form.date = new Date()
    form.label = ''
    form.amount = null
    form.accountId = null
    // Pré-sélectionne le premier compte de trésorerie (défaut le plus courant).
    form.treasuryAccountId = props.treasuryOptions[0]?.id ?? null
    form.reference = ''
  },
  { immediate: true },
)

/** Options enrichies « numéro — nom » pour les Select. */
function accountLabel(a: Account): string {
  return `${a.number} — ${a.name}`
}

const canSubmit = computed<boolean>(
  () =>
    form.label.trim().length > 0 &&
    form.amount !== null &&
    form.amount > 0 &&
    form.accountId !== null &&
    form.treasuryAccountId !== null &&
    localError.value === null,
)

function close(): void {
  emit('update:visible', false)
}

function onSubmit(): void {
  if (!canSubmit.value || props.submitting) return
  const reference = form.reference.trim()
  emit('submit', {
    accountId: form.accountId as string,
    treasuryAccountId: form.treasuryAccountId as string,
    amount: form.amount as number,
    date: form.date,
    label: form.label.trim(),
    reference: reference.length > 0 ? reference : null,
  })
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    header="Nouveau crédit"
    :style="{ width: '34rem' }"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="flex flex-col gap-4">
      <div class="flex gap-3">
        <div class="flex flex-col gap-1.5 w-44">
          <label class="text-[12px] font-medium text-surface-600">Date</label>
          <DatePicker
            v-model="form.date"
            date-format="dd/mm/yy"
            show-icon
            class="w-full"
          />
        </div>
        <div class="flex flex-col gap-1.5 flex-1">
          <label class="text-[12px] font-medium text-surface-600">
            Montant (CHF)
          </label>
          <InputNumber
            v-model="form.amount"
            :min="0"
            :min-fraction-digits="2"
            :max-fraction-digits="2"
            mode="decimal"
            placeholder="0.00"
            class="w-full"
          />
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-[12px] font-medium text-surface-600">Libellé</label>
        <InputText
          v-model="form.label"
          placeholder="Sponsoring saison 2025/26"
          class="w-full"
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-[12px] font-medium text-surface-600">
          Compte crédité
        </label>
        <Select
          v-model="form.accountId"
          :options="accountOptions"
          :option-label="accountLabel"
          option-value="id"
          placeholder="Sélectionner un compte"
          filter
          class="w-full"
        />
        <span class="text-[11px] text-surface-500">
          Typiquement un compte de produit (Sponsoring, Subventions…).
        </span>
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-[12px] font-medium text-surface-600">
          Compte de trésorerie (contrepartie)
        </label>
        <Select
          v-model="form.treasuryAccountId"
          :options="treasuryOptions"
          :option-label="accountLabel"
          option-value="id"
          placeholder="Caisse / Banque"
          class="w-full"
        />
        <span class="text-[11px] text-surface-500">
          Compte débité automatiquement — l'argent y entre.
        </span>
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-[12px] font-medium text-surface-600">
          Référence
        </label>
        <InputText
          v-model="form.reference"
          placeholder="Optionnel — n° de pièce, libellé externe"
          class="w-full"
        />
      </div>

      <Message
        v-if="localError"
        severity="warn"
        :closable="false"
      >
        {{ localError }}
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
        :disabled="submitting"
        @click="close"
      />
      <Button
        label="Enregistrer"
        :disabled="!canSubmit || submitting"
        :loading="submitting"
        @click="onSubmit"
      />
    </template>
  </Dialog>
</template>
