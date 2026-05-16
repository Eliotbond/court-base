<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import InputSwitch from 'primevue/inputswitch'
import Message from 'primevue/message'
import type { Account, AccountData, AccountNature } from '@club-app/shared-types'

/**
 * Dialog unifié de création / édition d'un compte du plan comptable.
 *
 * Mode déduit de la prop `account` : `null` → création, sinon édition. Émet
 * `submit` avec un payload `Omit<AccountData, 'createdAt'>` — la page parente
 * (`Accounts.vue`) relaie vers le store. Les champs `isDefault` ne sont pas
 * éditables ici (posé à `false` en création, conservé tel quel en édition).
 */
const props = defineProps<{
  visible: boolean
  account: Account | null
  /** Message d'erreur remonté par le store, affiché en pied de dialog. */
  errorMessage: string | null
}>()

/**
 * Payload émis par le dialog : tous les champs d'un compte SAUF `createdAt`
 * (server timestamp) et `displayOrder` (calculé par la page parente — position
 * en queue de liste pour une création, conservé tel quel pour une édition).
 */
export type AccountFormPayload = Omit<AccountData, 'createdAt' | 'displayOrder'>

const emit = defineEmits<{
  'update:visible': [value: boolean]
  submit: [payload: AccountFormPayload]
}>()

interface NatureOption {
  value: AccountNature
  label: string
}

const NATURE_OPTIONS: NatureOption[] = [
  { value: 'actif', label: 'Actif' },
  { value: 'passif', label: 'Passif' },
  { value: 'charge', label: 'Charge' },
  { value: 'produit', label: 'Produit' },
]

interface FormState {
  number: string
  name: string
  nature: AccountNature
  isTreasury: boolean
  description: string
  active: boolean
}

const form = reactive<FormState>({
  number: '',
  name: '',
  nature: 'actif',
  isTreasury: false,
  description: '',
  active: true,
})

const isEdit = computed(() => props.account !== null)
const title = computed(() =>
  isEdit.value ? 'Modifier le compte' : 'Nouveau compte',
)

/** Réinitialise le formulaire à chaque (ré)ouverture du dialog. */
watch(
  () => props.visible,
  (open) => {
    if (!open) return
    const a = props.account
    form.number = a?.number ?? ''
    form.name = a?.name ?? ''
    form.nature = a?.nature ?? 'actif'
    form.isTreasury = a?.isTreasury ?? false
    form.description = a?.description ?? ''
    form.active = a?.active ?? true
  },
  { immediate: true },
)

const canSubmit = computed(
  () => form.number.trim().length > 0 && form.name.trim().length > 0,
)

function close(): void {
  emit('update:visible', false)
}

function onSubmit(): void {
  if (!canSubmit.value) return
  const description = form.description.trim()
  emit('submit', {
    number: form.number.trim(),
    name: form.name.trim(),
    nature: form.nature,
    isTreasury: form.isTreasury,
    description: description.length > 0 ? description : null,
    // Un compte créé manuellement n'est jamais `isDefault` ; en édition on
    // conserve la valeur d'origine du compte.
    isDefault: props.account?.isDefault ?? false,
    active: form.active,
  })
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="title"
    :style="{ width: '32rem' }"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="flex flex-col gap-4">
      <div class="flex gap-3">
        <div class="flex flex-col gap-1.5 w-32">
          <label class="text-[12px] font-medium text-surface-600">Numéro</label>
          <InputText
            v-model="form.number"
            placeholder="3000"
            class="w-full"
          />
        </div>
        <div class="flex flex-col gap-1.5 flex-1">
          <label class="text-[12px] font-medium text-surface-600">Nom</label>
          <InputText
            v-model="form.name"
            placeholder="Cotisations des membres"
            class="w-full"
          />
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-[12px] font-medium text-surface-600">Nature</label>
        <Select
          v-model="form.nature"
          :options="NATURE_OPTIONS"
          option-label="label"
          option-value="value"
          class="w-full"
        />
      </div>

      <div class="flex items-center justify-between">
        <div class="flex flex-col">
          <span class="text-[13px] font-medium text-surface-700">
            Compte de trésorerie
          </span>
          <span class="text-[11px] text-surface-500">
            Caisse / Banque — utilisable comme contrepartie automatique.
          </span>
        </div>
        <InputSwitch v-model="form.isTreasury" />
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-[12px] font-medium text-surface-600">
          Description
        </label>
        <Textarea
          v-model="form.description"
          rows="2"
          auto-resize
          placeholder="Optionnel"
          class="w-full"
        />
      </div>

      <div class="flex items-center justify-between">
        <span class="text-[13px] font-medium text-surface-700">Actif</span>
        <InputSwitch v-model="form.active" />
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
        :label="isEdit ? 'Enregistrer' : 'Créer'"
        :disabled="!canSubmit"
        @click="onSubmit"
      />
    </template>
  </Dialog>
</template>
