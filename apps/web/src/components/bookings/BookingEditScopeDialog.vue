<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import RadioButton from 'primevue/radiobutton'
import Button from 'primevue/button'

/**
 * Petit dialog (modal, ~420px) qui demande à l'utilisateur quel scope
 * d'édition appliquer sur un booking : occurrence unique, occurrence +
 * suivantes, ou toute la série. Utilisé pour les actions edit / cancel /
 * delete.
 *
 * - Si `isSeries === false`, on cache les options multi-occurrences (le
 *   booking n'appartient à aucune série → seul `occurrence` a du sens).
 * - Si `isPast === true`, on affiche un message d'avertissement sous
 *   l'option `occurrence` indiquant que date/heure/court ne peuvent pas
 *   être modifiés pour une occurrence déjà passée.
 */

type EditScope = 'occurrence' | 'future' | 'all'
type Intent = 'edit' | 'cancel' | 'delete'

const props = defineProps<{
  visible: boolean
  intent: Intent
  isSeries: boolean
  isPast: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'confirm', scope: EditScope): void
}>()

// --- Local state ---
const selectedScope = ref<EditScope>('occurrence')

// Reset à l'ouverture pour ne pas garder la sélection précédente.
watch(
  () => props.visible,
  (v) => {
    if (v) selectedScope.value = 'occurrence'
  },
)

// --- Texts par intent ---
const title = computed<string>(() => {
  switch (props.intent) {
    case 'edit':
      return 'Modifier la réservation'
    case 'cancel':
      return 'Annuler la réservation'
    case 'delete':
    default:
      return 'Supprimer la réservation'
  }
})

const confirmLabel = computed<string>(() => {
  switch (props.intent) {
    case 'edit':
      return 'Confirmer'
    case 'cancel':
      return 'Annuler ce créneau'
    case 'delete':
    default:
      return 'Supprimer'
  }
})

/** Couleur du bouton "Confirmer" : danger pour cancel/delete, primary pour edit. */
const confirmSeverity = computed<'primary' | 'danger'>(() =>
  props.intent === 'edit' ? 'primary' : 'danger',
)

function close(): void {
  emit('update:visible', false)
}

function confirm(): void {
  emit('confirm', selectedScope.value)
  emit('update:visible', false)
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :draggable="false"
    :style="{ width: '420px' }"
    :header="title"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="space-y-2 pt-1">
      <!-- Option 1 : cette occurrence uniquement -->
      <label
        class="flex items-start gap-2 cursor-pointer p-3 border border-surface-200 rounded hover:bg-surface-50"
        :class="selectedScope === 'occurrence' ? 'bg-primary-50 border-primary-300' : ''"
      >
        <RadioButton
          v-model="selectedScope"
          value="occurrence"
          input-id="scope-occurrence"
          class="mt-0.5"
        />
        <div class="flex-1">
          <div class="text-[13px] font-medium">
            Cette occurrence uniquement
          </div>
          <div
            v-if="isPast"
            class="text-[11px] text-rose-600 mt-1"
          >
            Vous ne pouvez pas modifier la date, l'heure ou le court d'une occurrence passée.
          </div>
        </div>
      </label>

      <!-- Options série — seulement si le booking appartient à une série -->
      <template v-if="isSeries">
        <label
          class="flex items-start gap-2 cursor-pointer p-3 border border-surface-200 rounded hover:bg-surface-50"
          :class="selectedScope === 'future' ? 'bg-primary-50 border-primary-300' : ''"
        >
          <RadioButton
            v-model="selectedScope"
            value="future"
            input-id="scope-future"
            class="mt-0.5"
          />
          <div class="flex-1">
            <div class="text-[13px] font-medium">
              Cette occurrence et les suivantes
            </div>
          </div>
        </label>

        <label
          class="flex items-start gap-2 cursor-pointer p-3 border border-surface-200 rounded hover:bg-surface-50"
          :class="selectedScope === 'all' ? 'bg-primary-50 border-primary-300' : ''"
        >
          <RadioButton
            v-model="selectedScope"
            value="all"
            input-id="scope-all"
            class="mt-0.5"
          />
          <div class="flex-1">
            <div class="text-[13px] font-medium">
              Toute la série
            </div>
          </div>
        </label>
      </template>
    </div>

    <template #footer>
      <Button
        label="Annuler"
        severity="secondary"
        text
        @click="close"
      />
      <Button
        :label="confirmLabel"
        :severity="confirmSeverity"
        @click="confirm"
      />
    </template>
  </Dialog>
</template>
