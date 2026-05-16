<script setup lang="ts">
import { computed } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import Message from 'primevue/message'
import { Trash2, TriangleAlert } from 'lucide-vue-next'
import type { Account } from '@club-app/shared-types'

/**
 * Dialog de confirmation de suppression d'un compte du plan comptable.
 *
 * Le bouton "Supprimer" est désactivé (avec une explication) si le compte est
 * `isDefault` ou s'il est référencé par au moins une écriture comptable. Le
 * garde-fou réel vit côté repo (`deleteAccount` throw) — l'UI ne fait que le
 * refléter pour éviter une action vouée à l'échec.
 */
const props = defineProps<{
  visible: boolean
  account: Account | null
  /** `true` si le compte est référencé par une écriture (calculé en amont). */
  isUsed: boolean
  /** Message d'erreur remonté par le store, le cas échéant. */
  errorMessage: string | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  confirm: []
}>()

/** Raison bloquant la suppression, ou `null` si la suppression est permise. */
const blockReason = computed<string | null>(() => {
  if (!props.account) return null
  if (props.account.isDefault) {
    return 'Compte par défaut : il ne peut pas être supprimé. Désactivez-le si vous ne souhaitez plus l’utiliser.'
  }
  if (props.isUsed) {
    return 'Ce compte est référencé par une ou plusieurs écritures comptables : il ne peut pas être supprimé.'
  }
  return null
})

const canDelete = computed(() => blockReason.value === null)

function close(): void {
  emit('update:visible', false)
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :draggable="false"
    :style="{ width: '32rem' }"
    @update:visible="emit('update:visible', $event)"
  >
    <template #header>
      <span class="flex items-center gap-2 text-rose-700 font-semibold">
        <TriangleAlert
          :size="16"
          :stroke-width="2"
        />
        Supprimer le compte
      </span>
    </template>

    <div
      v-if="account"
      class="space-y-3 pt-1 text-[13px]"
    >
      <p class="text-surface-700 leading-snug">
        Confirmez-vous la suppression du compte
        <strong>{{ account.number }} — {{ account.name }}</strong> ? Cette
        action est irréversible.
      </p>

      <Message
        v-if="blockReason"
        severity="warn"
        :closable="false"
      >
        {{ blockReason }}
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
      <span
        :title="blockReason ?? undefined"
        class="inline-block"
      >
        <Button
          label="Supprimer"
          severity="danger"
          :disabled="!canDelete"
          @click="emit('confirm')"
        >
          <template #icon>
            <Trash2
              :size="14"
              :stroke-width="2"
            />
          </template>
        </Button>
      </span>
    </template>
  </Dialog>
</template>
