<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import DatePicker from 'primevue/datepicker'
import Select from 'primevue/select'
import Button from 'primevue/button'
import { useBookingsStore, type BookingPatch } from '@/stores/bookings'
import { useTeamsStore } from '@/stores/teams'
import type { Booking } from '@club-app/shared-types'

/**
 * Variante simplifiée du `BookingFormDialog` — n'expose que les champs
 * éditables d'un booking existant (date/time/court/team/title/notes).
 *
 * - Calcule un `patch` minimal (uniquement les champs modifiés) avant
 *   d'appeler `store.editBooking(id, scope, patch)`.
 * - Si `isPast === true` : date/startTime/endTime/courtId sont grisés —
 *   le repo skip de toute façon ces champs côté serveur pour les
 *   occurrences passées, mais on bloque l'UI pour éviter la confusion.
 * - `title` n'est sauvegardé que pour scope `all`/`future` (mis à jour
 *   sur `/bookingSeries.title` côté repo). Pour scope `occurrence`, on
 *   l'ignore et on note inline.
 */

type EditScope = 'occurrence' | 'future' | 'all'

interface CourtOption {
  id: string
  label: string
}

interface TeamOption {
  id: string | null
  label: string
}

const props = defineProps<{
  visible: boolean
  booking: Booking | null
  scope: EditScope
  isPast: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'saved'): void
}>()

const store = useBookingsStore()
const teamsStore = useTeamsStore()

// --- Form state ---
// Valeurs initiales calculées à l'ouverture du dialog ; on compare au submit
// pour ne renvoyer QUE les champs modifiés.
const formDate = ref<Date | null>(null)
const formStartTime = ref<string>('')
const formEndTime = ref<string>('')
const formCourtId = ref<string>('')
const formTeamId = ref<string | null>(null)
const formTitle = ref<string>('')
const formNotes = ref<string>('')

const submitting = ref(false)
const submitError = ref<string | null>(null)

// --- Initial snapshot — utilisé pour le diff dans buildPatch() ---
const initial = ref<{
  date: Date | null
  startTime: string
  endTime: string
  courtId: string
  teamId: string | null
  title: string
  notes: string
}>({
  date: null,
  startTime: '',
  endTime: '',
  courtId: '',
  teamId: null,
  title: '',
  notes: '',
})

watch(
  () => props.visible,
  (v) => {
    if (v && props.booking) {
      const b = props.booking
      // `b.date` est un Timestamp neutre (shared-types) — on lit `seconds`.
      const ts = b.date as unknown as { seconds: number; toDate?: () => Date }
      const d =
        typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts.seconds * 1000)
      formDate.value = d
      formStartTime.value = b.startTime
      formEndTime.value = b.endTime
      formCourtId.value = b.courtId
      formTeamId.value = b.teamId
      formTitle.value = ''
      formNotes.value = ''
      initial.value = {
        date: d,
        startTime: b.startTime,
        endTime: b.endTime,
        courtId: b.courtId,
        teamId: b.teamId,
        title: '',
        notes: '',
      }
      submitError.value = null
      // Charge la liste des équipes si vide (utilisé par le Select).
      if (teamsStore.teams.length === 0) {
        void teamsStore.load()
      }
    }
  },
)

// --- Court options : aplatit tous les courts de tous les venues ---
const courtOptions = computed<CourtOption[]>(() => {
  const opts: CourtOption[] = []
  for (const v of store.venues) {
    for (const c of v.courts) {
      opts.push({ id: c.id, label: `${v.name} · ${c.name}` })
    }
  }
  return opts
})

// --- Team options : null = "Aucune équipe" ---
const teamOptions = computed<TeamOption[]>(() => {
  const opts: TeamOption[] = [{ id: null, label: 'Aucune équipe' }]
  for (const t of teamsStore.teams) {
    opts.push({ id: t.id, label: t.name })
  }
  return opts
})

// --- Diff : ne renvoie que les champs modifiés ---
function buildPatch(): BookingPatch {
  const patch: BookingPatch = {}
  const init = initial.value
  if (formDate.value && init.date && formDate.value.getTime() !== init.date.getTime()) {
    patch.date = formDate.value
  }
  if (formStartTime.value !== init.startTime) patch.startTime = formStartTime.value
  if (formEndTime.value !== init.endTime) patch.endTime = formEndTime.value
  if (formCourtId.value !== init.courtId) patch.courtId = formCourtId.value
  if (formTeamId.value !== init.teamId) patch.teamId = formTeamId.value
  // `title` : seulement pour scope all/future (cf. repo : il met à jour /bookingSeries.title).
  if (props.scope !== 'occurrence' && formTitle.value !== init.title) {
    patch.title = formTitle.value
  }
  if (formNotes.value !== init.notes) patch.notes = formNotes.value || null
  return patch
}

const hasChanges = computed<boolean>(() => Object.keys(buildPatch()).length > 0)

function close(): void {
  if (submitting.value) return
  emit('update:visible', false)
}

async function submit(): Promise<void> {
  if (!props.booking) return
  const patch = buildPatch()
  if (Object.keys(patch).length === 0) {
    close()
    return
  }
  submitting.value = true
  submitError.value = null
  try {
    await store.editBooking(props.booking.id, props.scope, patch)
    emit('saved')
    emit('update:visible', false)
  } catch (e: unknown) {
    submitError.value =
      e instanceof Error ? e.message : 'Erreur de modification du booking'
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
    :style="{ width: '560px' }"
    header="Modifier la réservation"
    @update:visible="close"
  >
    <div
      v-if="booking"
      class="space-y-4 pt-1"
    >
      <!-- Date + horaires : grisés si isPast -->
      <div class="grid grid-cols-3 gap-3">
        <label class="block col-span-3">
          <span class="text-[12px] text-surface-600">Date</span>
          <DatePicker
            v-model="formDate"
            date-format="dd/mm/yy"
            class="mt-1 w-full"
            :disabled="isPast"
            show-icon
          />
        </label>

        <label class="block">
          <span class="text-[12px] text-surface-600">Début</span>
          <InputText
            v-model="formStartTime"
            class="mt-1 w-full"
            placeholder="HH:MM"
            :disabled="isPast"
          />
        </label>

        <label class="block">
          <span class="text-[12px] text-surface-600">Fin</span>
          <InputText
            v-model="formEndTime"
            class="mt-1 w-full"
            placeholder="HH:MM"
            :disabled="isPast"
          />
        </label>

        <label class="block">
          <span class="text-[12px] text-surface-600">Court</span>
          <Select
            v-model="formCourtId"
            :options="courtOptions"
            option-label="label"
            option-value="id"
            class="mt-1 w-full"
            :disabled="isPast"
          />
        </label>
      </div>

      <!-- Équipe -->
      <label class="block">
        <span class="text-[12px] text-surface-600">Équipe</span>
        <Select
          v-model="formTeamId"
          :options="teamOptions"
          option-label="label"
          option-value="id"
          class="mt-1 w-full"
          placeholder="Aucune équipe"
        />
      </label>

      <!-- Titre : visible mais désactivé pour scope=occurrence (note inline) -->
      <label class="block">
        <span class="text-[12px] text-surface-600">
          Titre
          <span
            v-if="scope === 'occurrence'"
            class="text-surface-400"
          >
            (ignoré pour une occurrence unique)
          </span>
        </span>
        <InputText
          v-model="formTitle"
          class="mt-1 w-full"
          placeholder="Titre de la série"
          :disabled="scope === 'occurrence'"
        />
      </label>

      <!-- Notes -->
      <label class="block">
        <span class="text-[12px] text-surface-600">Notes</span>
        <Textarea
          v-model="formNotes"
          class="mt-1 w-full"
          rows="3"
          auto-resize
        />
      </label>

      <!-- Erreur de soumission -->
      <p
        v-if="submitError"
        class="text-[12px] text-rose-600"
      >
        {{ submitError }}
      </p>
    </div>

    <template #footer>
      <Button
        label="Annuler"
        severity="secondary"
        text
        :disabled="submitting"
        @click="close"
      />
      <Button
        label="Enregistrer"
        severity="primary"
        :disabled="submitting || !hasChanges"
        :loading="submitting"
        @click="submit"
      />
    </template>
  </Dialog>
</template>
