<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Select from 'primevue/select'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import DatePicker from 'primevue/datepicker'
import RadioButton from 'primevue/radiobutton'
import Button from 'primevue/button'
import { useBookingsStore } from '@/stores/bookings'
import { useMatchesStore } from '@/stores/matches'
import { useTeamsStore } from '@/stores/teams'
import { useMatchTypesStore } from '@/stores/matchTypes'
import MatchBookingPicker from '@/components/matches/MatchBookingPicker.vue'
import type { MatchType } from '@club-app/shared-types'

/**
 * Dialog de création d'un match — Home (avec créneau) ou Away (adresse libre).
 *
 * Architecture en couches (cf. `apps/web/CLAUDE.md`) : le dialog consomme
 * uniquement les stores Pinia. Le repo `matches.repo` (via
 * `matchesStore.createHome` / `createAway`) gère la création atomique du
 * doc `/matches` (+ writeBatch sur le booking lié pour HOME) et la libération
 * automatique des trainings/reserves qui chevauchent le créneau (best-effort).
 *
 * Layout (refonte 2026-05-15)
 * ---------------------------
 * Dialog quasi-pleine fenêtre : 90vw × 90vh (cap à 1400px sur très grand
 * écran). Body en flex column qui remplit la hauteur :
 *  - header fixe (titre PrimeVue) ;
 *  - body splitté en 2 colonnes : panneau gauche fixe ~360px pour les
 *    champs (type, équipe, type de match, opponent, adresse si Away, notes),
 *    panneau droit qui prend le reste pour le picker calendrier (Home only) ;
 *  - footer fixe (Annuler / Créer).
 * En Away, le panneau droit disparaît et le panneau gauche prend toute la
 * largeur. Breakpoint mobile (`< lg`) : la grille passe en colonne unique.
 *
 * Décisions UX :
 *  - Home → le picker calendrier (`MatchBookingPicker`) fait office de
 *    sélecteur unique de venue/court/date/heure. Durée fixe 3h.
 *  - Away → pas de salle/court ; l'admin saisit adresse + date + heure début.
 *  - `opponentName` est optionnel pour Home (l'adversaire peut être inconnu
 *    au moment de réserver le créneau) mais obligatoire pour Away.
 *  - Erreurs : bannière inline rouge dans le dialog. Pas de ToastService
 *    global (cf. memory `project_tier1_decisions`).
 */

// ---------------------------------------------------------------------------
// Props / events
// ---------------------------------------------------------------------------

const props = defineProps<{
  visible: boolean
}>()

/**
 * Payload émis sur création.
 *  - HOME : `bookingId` est défini (booking lié au match).
 *  - AWAY : `bookingId` est absent (pas de booking côté away).
 */
interface MatchCreatedPayload {
  matchId: string
  bookingId?: string
  freedBookingIds: string[]
}

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'created', payload: MatchCreatedPayload): void
}>()

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

/**
 * `bookingsStore` reste utilisé pour `venues` (resolveSlotLabel — read-only,
 * en cache) et pour le picker enfant qui filtre les bookings match_home
 * pending. `matchesStore` est la cible des mutations.
 */
const bookingsStore = useBookingsStore()
const matchesStore = useMatchesStore()
const teamsStore = useTeamsStore()
const matchTypesStore = useMatchTypesStore()

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

type MatchKind = 'home' | 'away'

interface MatchForm {
  kind: MatchKind
  teamId: string | null
  matchTypeId: string | null
  opponentName: string
  // Away only
  date: Date | null
  startTime: string
  awayAddress: string
  // Common
  notes: string
}

interface MatchFormErrors {
  teamId: string | null
  matchTypeId: string | null
  opponentName: string | null
  slot: string | null
  date: string | null
  startTime: string | null
  awayAddress: string | null
}

interface SelectedSlot {
  /** Booking match_home pending qui sera "assigné" au submit. */
  bookingId: string
  venueId: string
  courtId: string
  date: Date
  startTime: string
  endTime: string
  /** teamId du booking pending si déjà fixé ; sinon null. */
  teamId: string | null
}

function makeEmptyForm(): MatchForm {
  return {
    kind: 'home',
    teamId: null,
    matchTypeId: null,
    opponentName: '',
    date: null,
    startTime: '19:00',
    awayAddress: '',
    notes: '',
  }
}

function makeEmptyErrors(): MatchFormErrors {
  return {
    teamId: null,
    matchTypeId: null,
    opponentName: null,
    slot: null,
    date: null,
    startTime: null,
    awayAddress: null,
  }
}

const form = reactive<MatchForm>(makeEmptyForm())
const errors = reactive<MatchFormErrors>(makeEmptyErrors())
const selectedSlot = ref<SelectedSlot | null>(null)
const submitting = ref(false)
const submitError = ref<string | null>(null)

// ---------------------------------------------------------------------------
// Constants & options
// ---------------------------------------------------------------------------

/** Durée fixe d'un match (côté UI — le repo accepte n'importe quel range). */
const MATCH_DURATION_HOURS = 3

/** Liste des créneaux d'heure de début pour Away — pas 30 min, 06:00 → 22:00. */
const startTimeOptions: ReadonlyArray<{ value: string; label: string }> = (() => {
  const out: Array<{ value: string; label: string }> = []
  for (let h = 6; h <= 22; h++) {
    for (const m of [0, 30] as const) {
      const hh = String(h).padStart(2, '0')
      const mm = String(m).padStart(2, '0')
      const value = `${hh}:${mm}`
      out.push({ value, label: value })
    }
  }
  return out
})()

const matchKindOptions: ReadonlyArray<{ value: MatchKind; label: string }> = [
  { value: 'home', label: 'À domicile' },
  { value: 'away', label: 'À l\'extérieur' },
]

const teamOptions = computed(() =>
  teamsStore.teams
    .filter((t) => t.active)
    .map((t) => ({ value: t.id, label: t.name })),
)

const matchTypeOptions = computed(() =>
  matchTypesStore.activeMatchTypes.map((m: MatchType) => ({
    value: m.id,
    label: m.name,
    color: m.color,
  })),
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** "HH:MM" exactement (00-23 / 00-59). */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function isValidTime(s: string): boolean {
  return TIME_RE.test(s)
}

/** Ajoute N heures à une string "HH:MM" et retourne "HH:MM" (clamp 23:59). */
function addHours(time: string, hours: number): string {
  if (!isValidTime(time)) return time
  const [hStr, mStr] = time.split(':')
  const h = Number(hStr)
  const m = Number(mStr)
  let total = h * 60 + m + hours * 60
  if (total >= 24 * 60) total = 23 * 60 + 59
  const hh = String(Math.floor(total / 60)).padStart(2, '0')
  const mm = String(total % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

const dateFormatter = new Intl.DateTimeFormat('fr-CH', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

function formatDate(d: Date): string {
  return dateFormatter.format(d)
}

/** Résolution venue/court depuis le store pour afficher le récap du slot. */
function resolveSlotLabel(slot: SelectedSlot): string {
  const venue = bookingsStore.venues.find((v) => v.id === slot.venueId)
  const venueName = venue?.name ?? '—'
  const court = venue?.courts.find((c) => c.id === slot.courtId)
  const courtName = court?.name ?? '—'
  return `${formatDate(slot.date)}, ${slot.startTime} → ${slot.endTime}, ${courtName}, ${venueName}`
}

// ---------------------------------------------------------------------------
// Picker handler
// ---------------------------------------------------------------------------

function handleSlotSelected(slot: SelectedSlot): void {
  selectedSlot.value = {
    bookingId: slot.bookingId,
    venueId: slot.venueId,
    courtId: slot.courtId,
    // Copie défensive — pas de partage de référence avec le picker.
    date: new Date(slot.date.getTime()),
    startTime: slot.startTime,
    endTime: slot.endTime,
    teamId: slot.teamId,
  }
  // Pré-remplit l'équipe depuis le booking pending si fixée d'avance — évite à
  // l'admin de re-saisir une info déjà connue. L'admin peut quand même changer
  // si besoin (le repo accepte un teamId différent).
  if (slot.teamId && !form.teamId) {
    form.teamId = slot.teamId
    errors.teamId = null
  }
  errors.slot = null
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateForm(): boolean {
  errors.teamId = form.teamId ? null : 'Équipe requise'
  errors.matchTypeId = form.matchTypeId ? null : 'Type de match requis'

  if (form.kind === 'home') {
    errors.slot = selectedSlot.value ? null : 'Créneau requis'
    errors.opponentName = null
    errors.date = null
    errors.startTime = null
    errors.awayAddress = null
  } else {
    errors.slot = null
    errors.opponentName = form.opponentName.trim()
      ? null
      : 'Nom de l\'équipe adverse requis'
    errors.date = form.date ? null : 'Date requise'
    if (!form.startTime) errors.startTime = 'Heure de début requise'
    else if (!isValidTime(form.startTime))
      errors.startTime = 'Format HH:MM attendu'
    else errors.startTime = null
    errors.awayAddress = form.awayAddress.trim() ? null : 'Adresse requise'
  }

  return (
    !errors.teamId &&
    !errors.matchTypeId &&
    !errors.opponentName &&
    !errors.slot &&
    !errors.date &&
    !errors.startTime &&
    !errors.awayAddress
  )
}

const canSubmit = computed<boolean>(() => {
  if (!form.teamId || !form.matchTypeId) return false
  if (form.kind === 'home') {
    return selectedSlot.value !== null
  }
  if (!form.date || !form.opponentName.trim()) return false
  if (!isValidTime(form.startTime)) return false
  if (!form.awayAddress.trim()) return false
  return true
})

// ---------------------------------------------------------------------------
// Open / close
// ---------------------------------------------------------------------------

watch(
  () => props.visible,
  (next, prev) => {
    if (next && !prev) {
      // Reset complet à l'ouverture.
      Object.assign(form, makeEmptyForm())
      Object.assign(errors, makeEmptyErrors())
      selectedSlot.value = null
      submitting.value = false
      submitError.value = null
      // Charge les dépendances si pas déjà en cache.
      if (teamsStore.teams.length === 0) {
        void teamsStore.load()
      }
      if (matchTypesStore.matchTypes.length === 0) {
        void matchTypesStore.load()
      }
      // Fallback : la page parente charge déjà `matches` au mount, mais on
      // garantit ici une source non vide pour les écrans où le dialog serait
      // ouvert sans /matches comme contexte (peu probable mais défensif).
      if (matchesStore.matches.length === 0) {
        void matchesStore.load()
      }
    }
  },
)

// Si l'utilisateur switch home→away après avoir choisi un slot, on libère
// le slot pour ne pas l'embarquer dans la création (et inversement pour la
// cohérence des erreurs).
watch(
  () => form.kind,
  (next) => {
    if (next === 'away') {
      selectedSlot.value = null
      errors.slot = null
    } else {
      errors.date = null
      errors.startTime = null
      errors.awayAddress = null
      errors.opponentName = null
    }
  },
)

function close(): void {
  emit('update:visible', false)
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

async function submit(): Promise<void> {
  if (!validateForm()) return
  if (!form.teamId || !form.matchTypeId) return
  submitting.value = true
  submitError.value = null
  try {
    const notes = form.notes.trim() ? form.notes.trim() : null
    const opponentName = form.opponentName.trim()
      ? form.opponentName.trim()
      : null

    let payload: MatchCreatedPayload

    if (form.kind === 'home') {
      const slot = selectedSlot.value
      if (!slot) return
      // Flow HOME : crée un doc `/matches` et lie le booking pending via
      // writeBatch atomique. Le créneau (venue/court/date/heures) reste
      // celui posé dans le booking — la dénormalisation est faite côté repo.
      const result = await matchesStore.createHome({
        bookingId: slot.bookingId,
        teamId: form.teamId,
        matchTypeId: form.matchTypeId,
        opponentName,
        notes,
      })
      payload = {
        matchId: result.matchId,
        bookingId: result.bookingId,
        freedBookingIds: result.freedBookingIds,
      }
    } else {
      if (!form.date) return
      const startTime = form.startTime
      const endTime = addHours(startTime, MATCH_DURATION_HOURS)
      // Flow AWAY : crée uniquement un doc `/matches` (pas de booking créé).
      // `opponentName` est requis côté UI Away — garde-fou TS sur la string.
      const result = await matchesStore.createAway({
        teamId: form.teamId,
        matchTypeId: form.matchTypeId,
        opponentName: opponentName ?? '',
        awayAddress: form.awayAddress.trim(),
        date: form.date,
        startTime,
        endTime,
        notes,
      })
      payload = {
        matchId: result.matchId,
        freedBookingIds: result.freedBookingIds,
      }
    }

    emit('created', payload)
    close()
  } catch (e: unknown) {
    submitError.value =
      e instanceof Error ? e.message : 'Erreur lors de la création du match'
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
    :style="{ width: '90vw', height: '90vh', maxWidth: '1400px' }"
    :content-style="{ padding: '0', display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: '0' }"
    header="Nouveau match"
    @update:visible="(v: boolean) => emit('update:visible', v)"
  >
    <!--
      Layout deux colonnes :
        - lg+ : panneau gauche fixe + panneau droit fluide (picker)
        - < lg : colonne unique, picker en dessous
      `min-h-0` indispensable pour que le picker (flex-1) puisse scroller
      en interne au lieu de pousser le footer hors écran.
    -->
    <div
      class="flex-1 min-h-0 grid gap-0 overflow-hidden"
      :class="form.kind === 'home'
        ? 'grid-cols-1 lg:grid-cols-[360px_1fr]'
        : 'grid-cols-1'"
    >
      <!-- ============== Panneau gauche : champs ============== -->
      <aside
        class="overflow-y-auto px-5 py-5 space-y-5 border-r border-surface-200 bg-surface-0"
      >
        <!-- Section 1 — Type -->
        <section class="space-y-2">
          <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
            Type
          </h4>
          <div class="flex items-center gap-6">
            <label
              v-for="opt in matchKindOptions"
              :key="opt.value"
              class="flex items-center gap-2 cursor-pointer select-none"
            >
              <RadioButton
                v-model="form.kind"
                :value="opt.value"
                :input-id="`match-kind-${opt.value}`"
              />
              <span class="text-[13px]">{{ opt.label }}</span>
            </label>
          </div>
        </section>

        <!-- Section 2 — Équipe + Type de match -->
        <section class="space-y-3">
          <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
            Équipe & compétition
          </h4>

          <label class="block">
            <span class="text-[12px] text-surface-600">
              Équipe locale <span class="text-rose-500">*</span>
            </span>
            <Select
              v-model="form.teamId"
              :options="teamOptions"
              option-label="label"
              option-value="value"
              placeholder="Sélectionner…"
              class="mt-1 w-full"
              filter
              :invalid="!!errors.teamId"
            />
            <span
              v-if="errors.teamId"
              class="text-[11px] text-rose-600 mt-0.5 block"
            >
              {{ errors.teamId }}
            </span>
          </label>

          <label class="block">
            <span class="text-[12px] text-surface-600">
              Type de match <span class="text-rose-500">*</span>
            </span>
            <Select
              v-model="form.matchTypeId"
              :options="matchTypeOptions"
              option-label="label"
              option-value="value"
              placeholder="Sélectionner…"
              class="mt-1 w-full"
              :invalid="!!errors.matchTypeId"
            >
              <template #option="{ option }">
                <div class="flex items-center gap-2">
                  <span
                    class="inline-block w-2.5 h-2.5 rounded-full"
                    :style="{ backgroundColor: option.color }"
                  />
                  <span>{{ option.label }}</span>
                </div>
              </template>
              <template #value="{ value, placeholder }">
                <template v-if="value">
                  <div class="flex items-center gap-2">
                    <span
                      class="inline-block w-2.5 h-2.5 rounded-full"
                      :style="{
                        backgroundColor:
                          matchTypeOptions.find((o) => o.value === value)?.color ??
                          '#999',
                      }"
                    />
                    <span>{{
                      matchTypeOptions.find((o) => o.value === value)?.label ?? value
                    }}</span>
                  </div>
                </template>
                <template v-else>
                  <span class="text-surface-400">{{ placeholder }}</span>
                </template>
              </template>
            </Select>
            <span
              v-if="errors.matchTypeId"
              class="text-[11px] text-rose-600 mt-0.5 block"
            >
              {{ errors.matchTypeId }}
            </span>
          </label>

          <label class="block">
            <span class="text-[12px] text-surface-600">
              Nom de l'équipe adverse
              <span
                v-if="form.kind === 'away'"
                class="text-rose-500"
              >*</span>
              <span
                v-else
                class="text-surface-400"
              >(optionnel)</span>
            </span>
            <InputText
              v-model="form.opponentName"
              class="mt-1 w-full"
              placeholder="Ex. BBC Bulle"
              :invalid="!!errors.opponentName"
            />
            <span
              v-if="errors.opponentName"
              class="text-[11px] text-rose-600 mt-0.5 block"
            >
              {{ errors.opponentName }}
            </span>
          </label>
        </section>

        <!-- Section Home — récap du slot sélectionné -->
        <section
          v-if="form.kind === 'home'"
          class="space-y-2"
        >
          <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
            Créneau
          </h4>
          <p class="text-[12px] text-surface-600">
            Cliquez sur un créneau <strong>Match home en attente</strong>
            (orange) dans le calendrier. L'assignation met à jour le booking
            existant — pas de nouveau créneau créé.
          </p>

          <div
            v-if="selectedSlot"
            class="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800"
          >
            <span class="font-medium">Sélectionné :</span>
            {{ resolveSlotLabel(selectedSlot) }}
          </div>
          <div
            v-else
            class="text-[12px] italic text-surface-500"
          >
            Aucun créneau sélectionné
          </div>

          <span
            v-if="errors.slot"
            class="text-[11px] text-rose-600 mt-0.5 block"
          >
            {{ errors.slot }}
          </span>
        </section>

        <!-- Section Away — adresse + horaires -->
        <section
          v-else
          class="space-y-3"
        >
          <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
            Lieu extérieur
          </h4>

          <div class="grid grid-cols-2 gap-3">
            <label class="block">
              <span class="text-[12px] text-surface-600">
                Date <span class="text-rose-500">*</span>
              </span>
              <DatePicker
                v-model="form.date"
                class="mt-1 w-full"
                date-format="dd/mm/yy"
                placeholder="jj/mm/aaaa"
                :invalid="!!errors.date"
              />
              <span
                v-if="errors.date"
                class="text-[11px] text-rose-600 mt-0.5 block"
              >
                {{ errors.date }}
              </span>
            </label>

            <label class="block">
              <span class="text-[12px] text-surface-600">
                Heure de début <span class="text-rose-500">*</span>
              </span>
              <Select
                v-model="form.startTime"
                :options="[...startTimeOptions]"
                option-label="label"
                option-value="value"
                class="mt-1 w-full"
                :invalid="!!errors.startTime"
              />
              <span
                v-if="errors.startTime"
                class="text-[11px] text-rose-600 mt-0.5 block"
              >
                {{ errors.startTime }}
              </span>
            </label>
          </div>

          <div class="flex items-center gap-2 text-[12px] text-surface-600">
            <span class="font-medium">Durée :</span>
            <span>{{ MATCH_DURATION_HOURS }} heures</span>
          </div>

          <label class="block">
            <span class="text-[12px] text-surface-600">
              Adresse <span class="text-rose-500">*</span>
            </span>
            <Textarea
              v-model="form.awayAddress"
              class="mt-1 w-full"
              rows="2"
              auto-resize
              placeholder="Salle de Bulle, Rue du Lac 12, 1630 Bulle"
              :invalid="!!errors.awayAddress"
            />
            <span
              v-if="errors.awayAddress"
              class="text-[11px] text-rose-600 mt-0.5 block"
            >
              {{ errors.awayAddress }}
            </span>
          </label>
        </section>

        <!-- Section Notes -->
        <section class="space-y-2">
          <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
            Notes
          </h4>
          <label class="block">
            <span class="text-[12px] text-surface-600">
              Notes <span class="text-surface-400">(optionnel)</span>
            </span>
            <Textarea
              v-model="form.notes"
              class="mt-1 w-full"
              rows="2"
              auto-resize
              placeholder="Note libre…"
            />
          </label>
        </section>

        <!-- Erreur submit -->
        <div
          v-if="submitError"
          class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700"
        >
          {{ submitError }}
        </div>
      </aside>

      <!-- ============== Panneau droit : picker (Home only) ============== -->
      <div
        v-if="form.kind === 'home'"
        class="overflow-hidden bg-surface-50 min-h-0 flex flex-col p-4"
      >
        <MatchBookingPicker
          :duration-hours="MATCH_DURATION_HOURS"
          :team-id="form.teamId"
          @select="handleSlotSelected"
        />
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
        :label="submitting ? 'Création…' : 'Créer'"
        :disabled="!canSubmit || submitting || matchesStore.loading"
        @click="submit"
      />
    </template>
  </Dialog>
</template>
