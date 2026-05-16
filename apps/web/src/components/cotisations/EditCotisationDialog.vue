<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FirebaseError } from 'firebase/app'
import Dialog from 'primevue/dialog'
import DatePicker from 'primevue/datepicker'
import Select from 'primevue/select'
import Textarea from 'primevue/textarea'
import Button from 'primevue/button'
import Message from 'primevue/message'
import { Pencil } from 'lucide-vue-next'
import { updateCotisation } from '@/services/cloudFunctions'
import type { Cotisation, CotisationStatus } from '@club-app/shared-types'

/**
 * Dialog réutilisable "Modifier une cotisation".
 *
 * Réservé au comité (admin / treasurer / rootAdmin — garde réelle côté Cloud
 * Function `updateDue`). Permet d'éditer les **dates** (`activatedAt`,
 * `issuedAt`, `dueAt`), le **statut** et la **note**. **Pas** le montant.
 *
 * Le statut `'paid'` n'est PAS proposé : le passage à payé passe par le flux
 * dédié "Marquer comme payé" (`markCotisationPaid`).
 *
 * Autonome : appelle lui-même la callable `updateCotisation`. À la réussite,
 * émet `saved(cotisationId)` puis ferme (`update:visible = false`). Le parent
 * recharge la liste / la fiche sur `@saved`.
 *
 * Préremplissage : à chaque ouverture, le formulaire est réinitialisé depuis
 * la prop `cotisation` (`CotisationRow` étend `Cotisation` → compatible).
 */

const props = defineProps<{
  visible: boolean
  cotisation: Cotisation | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'saved', cotisationId: string): void
}>()

// ---------------------------------------------------------------------------
// Options de statut — les 5 statuts éditables (`paid` exclu : flux dédié).
// ---------------------------------------------------------------------------

interface StatusOption {
  value: Exclude<CotisationStatus, 'paid'>
  label: string
}

const STATUS_OPTIONS: readonly StatusOption[] = [
  { value: 'pending_grace', label: 'En grâce' },
  { value: 'issued', label: 'Émis' },
  { value: 'overdue', label: 'En retard' },
  { value: 'excepted', label: 'Excepté' },
  { value: 'cancelled', label: 'Annulé' },
]

// ---------------------------------------------------------------------------
// Form state — DatePicker travaille avec des `Date | null`.
// ---------------------------------------------------------------------------

interface EditForm {
  activatedAt: Date | null
  issuedAt: Date | null
  dueAt: Date | null
  status: Exclude<CotisationStatus, 'paid'>
  notes: string
}

const form = ref<EditForm>({
  activatedAt: null,
  issuedAt: null,
  dueAt: null,
  status: 'issued',
  notes: '',
})

const submitting = ref(false)
const errorMessage = ref<string | null>(null)

/**
 * Convertit un Firestore Timestamp (shape neutre `{ seconds, nanoseconds }`)
 * en `Date`. Retourne `null` pour les Timestamp absents.
 */
function tsToDate(
  ts: { seconds: number; nanoseconds: number } | null | undefined,
): Date | null {
  if (!ts) return null
  return new Date(ts.seconds * 1000 + Math.floor(ts.nanoseconds / 1_000_000))
}

/**
 * (Ré)initialise le formulaire depuis la prop `cotisation`. Si le statut
 * courant est `paid` (cotisation déjà payée), on retombe sur `issued` pour le
 * Select — l'option `paid` n'existe pas dans `STATUS_OPTIONS`.
 */
function resetForm(): void {
  const c = props.cotisation
  errorMessage.value = null
  submitting.value = false
  if (!c) {
    form.value = {
      activatedAt: null,
      issuedAt: null,
      dueAt: null,
      status: 'issued',
      notes: '',
    }
    return
  }
  form.value = {
    activatedAt: tsToDate(c.activatedAt),
    issuedAt: tsToDate(c.issuedAt),
    dueAt: tsToDate(c.dueAt),
    status: c.status === 'paid' ? 'issued' : c.status,
    notes: c.notes ?? '',
  }
}

watch(
  () => props.visible,
  (v) => {
    if (v) resetForm()
  },
)

// ---------------------------------------------------------------------------
// Validation — `activatedAt` est requis (non nullable côté serveur).
// ---------------------------------------------------------------------------

const canSubmit = computed<boolean>(
  () => !submitting.value && props.cotisation !== null && form.value.activatedAt !== null,
)

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

function close(): void {
  emit('update:visible', false)
}

function classifyError(err: unknown): string {
  if (err instanceof FirebaseError) {
    switch (err.code) {
      case 'permission-denied':
        return "Vous n'avez pas les droits pour modifier une cotisation."
      case 'not-found':
        return "Cette cotisation n'existe plus."
      case 'invalid-argument':
        return err.message || 'Données invalides — vérifiez les champs.'
      default:
        return 'Modification impossible, voir la console pour le détail.'
    }
  }
  return err instanceof Error
    ? err.message
    : 'Modification impossible, voir la console pour le détail.'
}

async function submit(): Promise<void> {
  const c = props.cotisation
  if (!c || !canSubmit.value) return
  submitting.value = true
  errorMessage.value = null
  try {
    // `activatedAt` est garanti non-null par `canSubmit`.
    await updateCotisation({
      cotisationId: c.id,
      activatedAt: form.value.activatedAt,
      // `null` explicite = effacer le champ côté serveur.
      issuedAt: form.value.issuedAt,
      dueAt: form.value.dueAt,
      status: form.value.status,
      notes: form.value.notes.trim().length > 0 ? form.value.notes.trim() : null,
    })
    emit('saved', c.id)
    close()
  } catch (err: unknown) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`updateCotisation failed [${code}]`, err)
    errorMessage.value = classifyError(err)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :draggable="false"
    :closable="!submitting"
    :close-on-escape="!submitting"
    :style="{ width: '480px' }"
    @update:visible="(v: boolean) => emit('update:visible', v)"
  >
    <template #header>
      <span class="flex items-center gap-2 font-semibold">
        <Pencil
          :size="16"
          :stroke-width="2"
        />
        Modifier la cotisation
      </span>
    </template>

    <div
      v-if="cotisation"
      class="space-y-3 pt-1 text-[13px]"
    >
      <p class="text-[12px] text-surface-500 leading-snug">
        Édition réservée au comité (trésorier / admin). Le montant n'est pas
        modifiable ici. Pour enregistrer un paiement, utilisez « Marquer comme
        payé ».
      </p>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-[12px] font-medium text-surface-700 mb-1">
            Date d'activation
          </label>
          <DatePicker
            v-model="form.activatedAt"
            date-format="dd.mm.yy"
            show-icon
            class="w-full"
            :disabled="submitting"
          />
        </div>
        <div>
          <label class="block text-[12px] font-medium text-surface-700 mb-1">
            Statut
          </label>
          <Select
            v-model="form.status"
            :options="[...STATUS_OPTIONS]"
            option-label="label"
            option-value="value"
            class="w-full"
            :disabled="submitting"
          />
        </div>
        <div>
          <label class="block text-[12px] font-medium text-surface-700 mb-1">
            Émise le
          </label>
          <DatePicker
            v-model="form.issuedAt"
            date-format="dd.mm.yy"
            show-icon
            show-button-bar
            class="w-full"
            :disabled="submitting"
          />
        </div>
        <div>
          <label class="block text-[12px] font-medium text-surface-700 mb-1">
            À payer le
          </label>
          <DatePicker
            v-model="form.dueAt"
            date-format="dd.mm.yy"
            show-icon
            show-button-bar
            class="w-full"
            :disabled="submitting"
          />
        </div>
      </div>

      <div>
        <label class="block text-[12px] font-medium text-surface-700 mb-1">
          Note (optionnel)
        </label>
        <Textarea
          v-model="form.notes"
          rows="2"
          class="w-full"
          placeholder="Référence, remarque, arrangement…"
          :disabled="submitting"
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
        severity="secondary"
        :disabled="submitting"
        @click="close"
      />
      <Button
        label="Enregistrer"
        :loading="submitting"
        :disabled="!canSubmit"
        @click="submit"
      />
    </template>
  </Dialog>
</template>
