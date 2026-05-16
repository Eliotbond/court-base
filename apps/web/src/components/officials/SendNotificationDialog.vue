<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { TriangleAlert } from 'lucide-vue-next'
import Dialog from 'primevue/dialog'
import Select from 'primevue/select'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Button from 'primevue/button'
import { useOfficialStaffingStore } from '@/stores/officialStaffing'
import type { NotificationTargetAudience, NotificationType } from '@club-app/shared-types'

/**
 * Dialog d'envoi d'une notification aux officiels — écran Officials admin.
 *
 * Architecture en couches (cf. `apps/web/CLAUDE.md`) : la mutation passe par
 * `useOfficialStaffingStore().sendNotification` (le store injecte le `sentBy`
 * et wrappe le try/catch). Le composant lit `store.error`.
 */

const props = withDefaults(
  defineProps<{
    visible: boolean
    /** Booking lié — match à domicile. `null` pour un match à l'extérieur. */
    relatedBookingId: string | null
    /** Match lié (`/matches/{id}`) — renseigné pour un match à l'extérieur. */
    relatedMatchId: string | null
    defaultType?: NotificationType
  }>(),
  { defaultType: 'officials_needed' },
)

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
}>()

const store = useOfficialStaffingStore()

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const typeOptions: ReadonlyArray<{ value: NotificationType; label: string }> = [
  { value: 'officials_needed', label: 'Recherche d\'officiels' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'new_match', label: 'Nouveau match' },
  { value: 'match_reminder', label: 'Rappel de match' },
]

const audienceOptions: ReadonlyArray<{
  value: NotificationTargetAudience
  label: string
}> = [
  { value: 'all_officials', label: 'Tous les officiels' },
  { value: 'unassigned_officials', label: 'Officiels non assignés' },
  { value: 'assigned_officials', label: 'Officiels assignés' },
]

// ---------------------------------------------------------------------------
// Pré-remplissage par type — titre + corps sensés.
// ---------------------------------------------------------------------------

interface NotificationDefaults {
  title: string
  body: string
}

function defaultsForType(type: NotificationType): NotificationDefaults {
  switch (type) {
    case 'urgent':
      return {
        title: 'Action urgente requise',
        body: 'Un match a besoin d\'officiels rapidement. Merci de consulter vos assignations et de confirmer votre disponibilité dès que possible.',
      }
    case 'new_match':
      return {
        title: 'Nouveau match à couvrir',
        body: 'Un nouveau match à domicile a été planifié. Si vous êtes disponible pour l\'arbitrer, faites-le savoir au comité.',
      }
    case 'match_reminder':
      return {
        title: 'Rappel : match à venir',
        body: 'Pour rappel, vous êtes assigné(e) à un match prochainement. Merci de confirmer votre présence.',
      }
    case 'officials_needed':
    default:
      return {
        title: 'Officiels recherchés',
        body: 'Il manque des officiels pour un ou plusieurs matchs à domicile. Merci de vous manifester si vous êtes disponible.',
      }
  }
}

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

interface NotificationForm {
  type: NotificationType
  targetAudience: NotificationTargetAudience
  title: string
  body: string
}

function makeEmptyForm(): NotificationForm {
  const type = props.defaultType
  const d = defaultsForType(type)
  return {
    type,
    targetAudience: 'all_officials',
    title: d.title,
    body: d.body,
  }
}

const form = reactive<NotificationForm>(makeEmptyForm())
const submitting = ref(false)
const submitError = ref<string | null>(null)
/** Vrai si l'utilisateur a édité manuellement titre/corps — bloque l'auto-fill. */
const titleTouched = ref(false)
const bodyTouched = ref(false)

const titleError = computed<string | null>(() =>
  form.title.trim() ? null : 'Titre requis',
)
const bodyError = computed<string | null>(() =>
  form.body.trim() ? null : 'Message requis',
)
const showErrors = ref(false)

const canSubmit = computed<boolean>(
  () => !!form.title.trim() && !!form.body.trim(),
)

// ---------------------------------------------------------------------------
// Auto-fill du titre/corps quand le type change (si pas édité manuellement).
// ---------------------------------------------------------------------------

watch(
  () => form.type,
  (type) => {
    const d = defaultsForType(type)
    if (!titleTouched.value) form.title = d.title
    if (!bodyTouched.value) form.body = d.body
  },
)

// ---------------------------------------------------------------------------
// Reset à l'ouverture
// ---------------------------------------------------------------------------

watch(
  () => props.visible,
  (next, prev) => {
    if (next && !prev) {
      Object.assign(form, makeEmptyForm())
      submitting.value = false
      submitError.value = null
      showErrors.value = false
      titleTouched.value = false
      bodyTouched.value = false
      store.error = null
    }
  },
)

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function close(): void {
  emit('update:visible', false)
}

async function submit(): Promise<void> {
  showErrors.value = true
  if (!canSubmit.value) return
  submitting.value = true
  submitError.value = null
  try {
    await store.sendNotification({
      type: form.type,
      title: form.title.trim(),
      body: form.body.trim(),
      targetAudience: form.targetAudience,
      relatedBookingId: props.relatedBookingId,
      relatedMatchId: props.relatedMatchId,
    })
    close()
  } catch (e: unknown) {
    submitError.value =
      e instanceof Error
        ? e.message
        : 'Erreur lors de l\'envoi de la notification'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Dialog
    :visible="props.visible"
    modal
    :draggable="false"
    :style="{ width: '460px' }"
    header="Envoyer une notification"
    @update:visible="(v: boolean) => emit('update:visible', v)"
  >
    <div class="space-y-4 pt-1">
      <p class="text-[12px] text-surface-500">
        La notification sera poussée vers les officiels concernés selon
        l'audience sélectionnée.
      </p>

      <!-- Type -->
      <label class="block">
        <span class="text-[12px] text-surface-600">
          Type <span class="text-rose-500">*</span>
        </span>
        <Select
          v-model="form.type"
          :options="[...typeOptions]"
          option-label="label"
          option-value="value"
          class="mt-1 w-full"
        />
      </label>

      <!-- Audience -->
      <label class="block">
        <span class="text-[12px] text-surface-600">
          Audience <span class="text-rose-500">*</span>
        </span>
        <Select
          v-model="form.targetAudience"
          :options="[...audienceOptions]"
          option-label="label"
          option-value="value"
          class="mt-1 w-full"
        />
      </label>

      <!-- Titre -->
      <label class="block">
        <span class="text-[12px] text-surface-600">
          Titre <span class="text-rose-500">*</span>
        </span>
        <InputText
          v-model="form.title"
          class="mt-1 w-full"
          placeholder="Titre de la notification"
          :invalid="showErrors && !!titleError"
          @input="titleTouched = true"
        />
        <span
          v-if="showErrors && titleError"
          class="text-[11px] text-rose-600 mt-0.5 block"
        >
          {{ titleError }}
        </span>
      </label>

      <!-- Corps -->
      <label class="block">
        <span class="text-[12px] text-surface-600">
          Message <span class="text-rose-500">*</span>
        </span>
        <Textarea
          v-model="form.body"
          class="mt-1 w-full"
          rows="4"
          auto-resize
          placeholder="Contenu du message…"
          :invalid="showErrors && !!bodyError"
          @input="bodyTouched = true"
        />
        <span
          v-if="showErrors && bodyError"
          class="text-[11px] text-rose-600 mt-0.5 block"
        >
          {{ bodyError }}
        </span>
      </label>

      <!-- Erreur submit / store -->
      <div
        v-if="submitError || store.error"
        class="card border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 flex items-start gap-2"
      >
        <TriangleAlert
          :size="14"
          :stroke-width="2"
          class="mt-0.5 shrink-0"
        />
        <span>{{ submitError ?? store.error }}</span>
      </div>
    </div>

    <template #footer>
      <Button
        label="Annuler"
        severity="secondary"
        outlined
        :disabled="submitting"
        @click="close"
      />
      <Button
        :label="submitting ? 'Envoi…' : 'Envoyer'"
        :disabled="!canSubmit || submitting"
        @click="submit"
      />
    </template>
  </Dialog>
</template>
