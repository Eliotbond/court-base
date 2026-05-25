<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Select from 'primevue/select'
import DatePicker from 'primevue/datepicker'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Checkbox from 'primevue/checkbox'
import RadioButton from 'primevue/radiobutton'
import type {
  MonthlyMode,
  RecurrenceFrequency,
  RecurrenceRule,
  SlotType,
} from '@club-app/shared-types'
import { useBookingsStore } from '@/stores/bookings'
import { useTeamsStore } from '@/stores/teams'
import { formatDateShort } from '@/utils/dates'

/**
 * Wizard de création d'une réservation manuelle — one-shot ou récurrente
 * (modèle Outlook). Consomme uniquement les stores Pinia (cf.
 * architecture en couches dans `apps/web/CLAUDE.md` : un composant n'appelle
 * jamais Firestore ni un repository directement).
 *
 * Décisions UX :
 *  - `teamId` : n'importe quelle équipe du club peut être assignée au
 *    créneau ; les options sont chargées via `useTeamsStore` à l'ouverture
 *    du dialog. "Aucune équipe" reste possible (réservation libre).
 *  - `slotType` : pas de `match_away` ici — un match extérieur n'est pas
 *    une réservation (il n'occupe aucune salle du club). Les types
 *    autorisés sont : training / match_home / reserve / custom.
 *  - Preview de série débouncée 300ms : recalcule à chaque changement de
 *    champ pertinent côté UI. Pas d'indicateur global — le store expose
 *    `loading`/`error` mais `previewSeries` ne les touche pas.
 *  - Le bouton "Créer" est désactivé si validation locale échoue OU si la
 *    preview remonte au moins un conflit (le store re-vérifie avant write).
 *  - Pas de prise en charge des combined courts en MVP manuel — le repo
 *    écrit `linkedBookingIds: []`, ce composant n'ajoute pas de UI dédiée.
 */

// ---------------------------------------------------------------------------
// Props / events
// ---------------------------------------------------------------------------

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'created'): void
}>()

const store = useBookingsStore()
const teamsStore = useTeamsStore()

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

interface BookingForm {
  // Section 1 — Lieu & horaires
  venueId: string | null
  courtId: string | null
  date: Date | null
  startTime: string
  endTime: string
  // Section 2 — Type & équipe
  slotType: SlotType
  teamId: string | null
  title: string
  notes: string
  // Section 3 — Récurrence
  isRecurring: boolean
  recurrenceFrequency: RecurrenceFrequency
  monthlyMode: MonthlyMode
  endDate: Date | null
  /**
   * Si `true` (et `isRecurring` aussi), `date` est dérivée d'un jour de la
   * semaine choisi par l'utilisateur — première occurrence de ce jour à
   * partir de `season.startDate`. L'utilisateur ne saisit pas une date,
   * juste un weekday (0=dim..6=sam, convention `Date.getDay()`).
   * Sans saison active, l'option reste masquée et `false`.
   */
  fromSeasonStart: boolean
  /** Jour de la semaine choisi quand `fromSeasonStart` est actif. */
  weekday: number | null
  /**
   * Si `true`, `endDate` est verrouillée sur la date de fin de la saison
   * active (lecture seule). L'utilisateur n'a pas à saisir manuellement —
   * c'est le cas par défaut quand on coche "Jusqu'à la fin de la saison".
   * Sans saison active, l'option est masquée et reste `false`.
   */
  untilSeasonEnd: boolean
}

interface BookingFormErrors {
  venueId: string | null
  courtId: string | null
  date: string | null
  startTime: string | null
  endTime: string | null
  title: string | null
  endDate: string | null
}

function makeEmptyForm(): BookingForm {
  return {
    venueId: null,
    courtId: null,
    date: null,
    startTime: '',
    endTime: '',
    slotType: 'custom',
    teamId: null,
    title: '',
    notes: '',
    isRecurring: false,
    recurrenceFrequency: 'weekly',
    monthlyMode: 'dayOfMonth',
    endDate: null,
    fromSeasonStart: false,
    weekday: null,
    untilSeasonEnd: false,
  }
}

function makeEmptyErrors(): BookingFormErrors {
  return {
    venueId: null,
    courtId: null,
    date: null,
    startTime: null,
    endTime: null,
    title: null,
    endDate: null,
  }
}

const form = reactive<BookingForm>(makeEmptyForm())
const errors = reactive<BookingFormErrors>(makeEmptyErrors())
const submitting = ref(false)
const submitError = ref<string | null>(null)

// ---------------------------------------------------------------------------
// Options dérivées du store
// ---------------------------------------------------------------------------

const venueOptions = computed(() =>
  store.venues.map((v) => ({ value: v.id, label: v.name })),
)

/** Courts du venue sélectionné. Vide si aucun venue choisi. */
const courtOptions = computed(() => {
  if (!form.venueId) return []
  const venue = store.venues.find((v) => v.id === form.venueId)
  if (!venue) return []
  return venue.courts.map((c) => ({ value: c.id, label: c.name }))
})

/**
 * Toutes les équipes actives du club. `null` = "Aucune équipe (libre)".
 * On ne filtre pas par catégorie/genre — toute équipe peut occuper
 * n'importe quel court côté UI ; les contraintes (catégorie, gender) sont
 * gérées plus haut au niveau de la planification.
 */
const teamOptions = computed<Array<{ value: string | null; label: string }>>(() => {
  const opts: Array<{ value: string | null; label: string }> = [
    { value: null, label: 'Aucune équipe (réservation libre)' },
  ]
  for (const t of teamsStore.teams) {
    if (!t.active) continue
    opts.push({ value: t.id, label: t.name })
  }
  return opts
})

// `match_away` exclu : un match extérieur n'occupe aucune salle du club,
// donc il ne donne pas lieu à une réservation. Voir le commentaire de tête.
const slotTypeOptions: ReadonlyArray<{ value: SlotType; label: string }> = [
  { value: 'training', label: 'Entraînement' },
  { value: 'match_home', label: 'Match à domicile' },
  { value: 'reserve', label: 'Réserve' },
  { value: 'custom', label: 'Personnalisé' },
]

const recurrenceFrequencyOptions: ReadonlyArray<{
  value: RecurrenceFrequency
  label: string
}> = [
  { value: 'weekly', label: 'Chaque semaine' },
  { value: 'monthly', label: 'Chaque mois' },
]

// Convention `Date.getDay()` : 0=dimanche, 1=lundi, …, 6=samedi.
// Affichage Lundi en premier (usage FR/CH).
const weekdayOptions: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: 'Lundi' },
  { value: 2, label: 'Mardi' },
  { value: 3, label: 'Mercredi' },
  { value: 4, label: 'Jeudi' },
  { value: 5, label: 'Vendredi' },
  { value: 6, label: 'Samedi' },
  { value: 0, label: 'Dimanche' },
]

// Quand le venue change, on reset le courtId (le court appartient au venue).
watch(
  () => form.venueId,
  (next, prev) => {
    if (next !== prev) form.courtId = null
  },
)

// ---------------------------------------------------------------------------
// "Jusqu'à la fin de la saison" — auto-fill endDate depuis la saison active
// ---------------------------------------------------------------------------

/**
 * Date de fin de la saison active sous forme de `Date` locale, ou `null` si
 * aucune saison active n'est chargée.
 *
 * Le `Timestamp` neutre exporté par `shared-types` n'expose pas `.toDate()` ;
 * on lit `seconds` (présent sur le Timestamp Firestore SDK aussi).
 */
const activeSeasonEndDate = computed<Date | null>(() => {
  const season = store.activeSeason
  if (!season) return null
  const ts = season.endDate as unknown as { seconds: number; toDate?: () => Date }
  if (typeof ts.toDate === 'function') return ts.toDate()
  return new Date(ts.seconds * 1000)
})

/**
 * Date de début de la saison active — borne minimale acceptée par le
 * DatePicker. La création d'un booking avant `season.startDate` est refusée
 * côté repo (`createManualBooking` / `createBookingSeries`).
 */
const activeSeasonStartDate = computed<Date | null>(() => {
  const season = store.activeSeason
  if (!season) return null
  const ts = season.startDate as unknown as { seconds: number; toDate?: () => Date }
  if (typeof ts.toDate === 'function') return ts.toDate()
  return new Date(ts.seconds * 1000)
})

const canUseSeasonEnd = computed<boolean>(() => activeSeasonEndDate.value !== null)
const canUseSeasonStart = computed<boolean>(() => activeSeasonStartDate.value !== null)

/**
 * Renvoie la date de la 1ère occurrence du `weekday` (0=dim..6=sam) à partir
 * (inclus) de `from`. Utilisé pour dériver `form.date` quand l'utilisateur
 * coche "Depuis le début de la saison" — au lieu de saisir une date, il
 * choisit un jour de la semaine et on calcule la première occurrence.
 */
function firstOccurrenceOnOrAfter(from: Date, weekday: number): Date {
  const d = new Date(from)
  d.setHours(0, 0, 0, 0)
  const diff = (weekday - d.getDay() + 7) % 7
  d.setDate(d.getDate() + diff)
  return d
}

/**
 * Quand on coche "Jusqu'à la fin de la saison" → recopie la date de fin de
 * saison dans `form.endDate`. Si la saison change ou si on décoche, on libère
 * la valeur (l'utilisateur reprend la main sur le DatePicker).
 *
 * On ne reset PAS `endDate` au moment du décocher (on laisse la dernière
 * valeur en place pour ne pas perdre la saisie si l'utilisateur retoggle).
 */
watch(
  [() => form.untilSeasonEnd, activeSeasonEndDate],
  ([useSeason, seasonEnd]) => {
    if (useSeason && seasonEnd) {
      // Copie défensive : pas de partage de référence avec le store.
      form.endDate = new Date(seasonEnd.getTime())
    }
  },
)

/**
 * Si la saison active disparaît (ou n'a jamais été chargée) alors que le
 * toggle est `true`, on relâche le toggle pour que l'UI ne montre pas un
 * état incohérent (case cochée mais aucune date appliquée).
 */
watch(canUseSeasonEnd, (canUse) => {
  if (!canUse && form.untilSeasonEnd) form.untilSeasonEnd = false
})

// ---------------------------------------------------------------------------
// "Depuis le début de la saison" — auto-fill date depuis weekday + season start
// ---------------------------------------------------------------------------
//
// Quand le toggle est actif (uniquement pour les réservations récurrentes),
// l'utilisateur ne pose pas une date mais un jour de la semaine. La date
// effective est la 1ère occurrence de ce jour à partir de `season.startDate`.

watch(
  [() => form.fromSeasonStart, () => form.weekday, activeSeasonStartDate],
  ([useSeasonStart, weekday, seasonStart]) => {
    if (!useSeasonStart || weekday === null || !seasonStart) return
    form.date = firstOccurrenceOnOrAfter(seasonStart, weekday)
  },
)

/**
 * Si la saison active disparaît OU si on désactive "récurrente" alors que
 * `fromSeasonStart` est `true`, on relâche le toggle (cohérence UI).
 */
watch([canUseSeasonStart, () => form.isRecurring], ([canUse, recurring]) => {
  if ((!canUse || !recurring) && form.fromSeasonStart) form.fromSeasonStart = false
})

// ---------------------------------------------------------------------------
// Labels dynamiques pour la section récurrence
// ---------------------------------------------------------------------------

const WEEKDAY_NAMES = [
  'dimanche',
  'lundi',
  'mardi',
  'mercredi',
  'jeudi',
  'vendredi',
  'samedi',
] as const

const ORDINAL_NAMES = ['1er', '2e', '3e', '4e', '5e'] as const

const monthlyDayOfMonthLabel = computed<string>(() => {
  if (!form.date) return 'Tous les jours X du mois'
  const day = form.date.getDate()
  return `Tous les ${day} du mois`
})

const monthlyNthWeekdayLabel = computed<string>(() => {
  if (!form.date) return 'Le Nème jour du mois'
  const weekday = WEEKDAY_NAMES[form.date.getDay()] ?? ''
  const nth = Math.floor((form.date.getDate() - 1) / 7)
  const ordinal = ORDINAL_NAMES[nth] ?? `${nth + 1}e`
  return `Le ${ordinal} ${weekday} du mois`
})

// ---------------------------------------------------------------------------
// Validation locale
// ---------------------------------------------------------------------------

/** "HH:MM" exactement (00-23 / 00-59). */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function isValidTime(s: string): boolean {
  return TIME_RE.test(s)
}

function validateForm(): boolean {
  errors.venueId = form.venueId ? null : 'Salle requise'
  errors.courtId = form.courtId ? null : 'Court requis'
  // Quand "Depuis le début de la saison" est actif, `date` est dérivée du
  // weekday — on valide le weekday plutôt que la date manuellement saisie.
  if (form.isRecurring && form.fromSeasonStart) {
    errors.date = form.weekday !== null && form.date ? null : 'Jour de la semaine requis'
  } else {
    errors.date = form.date ? null : 'Date requise'
  }
  if (!form.startTime) errors.startTime = 'Heure de début requise'
  else if (!isValidTime(form.startTime)) errors.startTime = 'Format HH:MM attendu'
  else errors.startTime = null
  if (!form.endTime) errors.endTime = 'Heure de fin requise'
  else if (!isValidTime(form.endTime)) errors.endTime = 'Format HH:MM attendu'
  else if (form.startTime && isValidTime(form.startTime) && form.endTime <= form.startTime)
    errors.endTime = 'Doit être après l\'heure de début'
  else errors.endTime = null
  errors.title = form.title.trim() ? null : 'Titre requis'
  if (form.isRecurring) {
    if (!form.endDate) errors.endDate = 'Date de fin requise'
    else if (form.date && form.endDate.getTime() < form.date.getTime())
      errors.endDate = 'Doit être après la date de début'
    else errors.endDate = null
  } else {
    errors.endDate = null
  }
  return (
    !errors.venueId &&
    !errors.courtId &&
    !errors.date &&
    !errors.startTime &&
    !errors.endTime &&
    !errors.title &&
    !errors.endDate
  )
}

const canSubmit = computed<boolean>(() => {
  // Validation non-destructive (pas d'écriture dans `errors`). On reproduit
  // les checks pour calculer la dispo du bouton "Créer" sans déclencher
  // l'affichage des erreurs (qui apparaît uniquement après submit).
  if (!form.venueId || !form.courtId || !form.date) return false
  if (form.isRecurring && form.fromSeasonStart && form.weekday === null) return false
  if (!isValidTime(form.startTime) || !isValidTime(form.endTime)) return false
  if (form.endTime <= form.startTime) return false
  if (!form.title.trim()) return false
  if (form.isRecurring) {
    if (!form.endDate) return false
    if (form.date && form.endDate.getTime() < form.date.getTime()) return false
  }
  if (previewResult.value && previewResult.value.conflicts.length > 0) return false
  // Si la série tombe entièrement sur des fermetures de salle, le backend
  // refusera la création (`all occurrences fall within venue closures`).
  // On bloque le bouton côté UI pour éviter un submit voué à l'échec.
  if (
    form.isRecurring &&
    previewResult.value &&
    previewResult.value.kept.length === 0 &&
    previewResult.value.closures.length > 0
  ) {
    return false
  }
  return true
})

// ---------------------------------------------------------------------------
// Preview série — debounce 300ms
// ---------------------------------------------------------------------------

interface PreviewClosure {
  name: string
  startDate: Date
  endDate: Date
  source: 'period' | 'custom'
  skippedDates: Date[]
}

interface PreviewResult {
  kept: Date[]
  skipped: Date[]
  conflicts: { date: Date }[]
  closures: PreviewClosure[]
}

const previewResult = ref<PreviewResult | null>(null)
const previewLoading = ref(false)
const previewError = ref<string | null>(null)
let previewDebounceHandle: ReturnType<typeof setTimeout> | null = null

/** Champs dont une modif doit déclencher un re-preview. */
const previewWatchedKey = computed<string>(() => {
  return [
    form.isRecurring ? '1' : '0',
    form.venueId ?? '',
    form.courtId ?? '',
    form.date ? form.date.getTime() : '',
    form.endDate ? form.endDate.getTime() : '',
    form.startTime,
    form.endTime,
    form.recurrenceFrequency,
    form.monthlyMode,
  ].join('|')
})

watch(previewWatchedKey, () => {
  scheduleSeriesPreview()
})

function scheduleSeriesPreview(): void {
  if (previewDebounceHandle !== null) {
    clearTimeout(previewDebounceHandle)
    previewDebounceHandle = null
  }
  // Reset preview si on n'est pas en mode récurrent (la section preview est
  // masquée, mais `canSubmit` lit `previewResult.value.conflicts` — on doit
  // s'assurer qu'aucun résultat stale ne bloque la création d'un one-shot).
  if (!form.isRecurring) {
    previewResult.value = null
    previewError.value = null
    previewLoading.value = false
    return
  }
  if (!canRunPreview()) {
    previewResult.value = null
    previewError.value = null
    previewLoading.value = false
    return
  }
  previewDebounceHandle = setTimeout(() => {
    void runSeriesPreview()
  }, 300)
}

function canRunPreview(): boolean {
  if (!form.venueId || !form.courtId || !form.date || !form.endDate) return false
  if (!isValidTime(form.startTime) || !isValidTime(form.endTime)) return false
  if (form.endTime <= form.startTime) return false
  if (form.endDate.getTime() < form.date.getTime()) return false
  return true
}

async function runSeriesPreview(): Promise<void> {
  if (!form.venueId || !form.courtId || !form.date || !form.endDate) return
  previewLoading.value = true
  previewError.value = null
  try {
    const rule = buildRecurrenceRule()
    const result = await store.previewSeries({
      venueId: form.venueId,
      courtId: form.courtId,
      startDate: form.date,
      endDate: form.endDate,
      startTime: form.startTime,
      endTime: form.endTime,
      teamId: form.teamId,
      slotType: form.slotType,
      // TODO: brancher quand l'écran Match types exposera un picker.
      matchTypeId: null,
      title: form.title.trim() || '—',
      notes: form.notes.trim() || null,
      recurrence: rule,
    })
    previewResult.value = result
  } catch (e: unknown) {
    previewResult.value = null
    previewError.value =
      e instanceof Error ? e.message : 'Erreur lors du calcul du preview'
  } finally {
    previewLoading.value = false
  }
}

function buildRecurrenceRule(): RecurrenceRule {
  if (!form.date) {
    // Ne devrait jamais arriver : on appelle après validation locale.
    throw new Error('date required to build recurrence rule')
  }
  if (form.recurrenceFrequency === 'weekly') {
    return {
      frequency: 'weekly',
      interval: 1,
      weekday: form.date.getDay(),
      monthlyMode: null,
    }
  }
  return {
    frequency: 'monthly',
    interval: 1,
    weekday: null,
    monthlyMode: form.monthlyMode,
  }
}

// ---------------------------------------------------------------------------
// Open / close
// ---------------------------------------------------------------------------

watch(
  () => props.visible,
  (next, prev) => {
    if (next && !prev) {
      // Reset à l'ouverture (chaque ouverture est un nouveau wizard).
      Object.assign(form, makeEmptyForm())
      Object.assign(errors, makeEmptyErrors())
      previewResult.value = null
      previewError.value = null
      previewLoading.value = false
      submitError.value = null
      // Charge la liste des équipes si absente (utilisée par le Select).
      if (teamsStore.teams.length === 0) {
        void teamsStore.load()
      }
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
  if (!form.venueId || !form.courtId || !form.date) return
  submitting.value = true
  submitError.value = null
  try {
    const title = form.title.trim()
    const notes = form.notes.trim() ? form.notes.trim() : null
    if (form.isRecurring) {
      if (!form.endDate) return
      await store.createSeries({
        venueId: form.venueId,
        courtId: form.courtId,
        startDate: form.date,
        endDate: form.endDate,
        startTime: form.startTime,
        endTime: form.endTime,
        teamId: form.teamId,
        slotType: form.slotType,
        matchTypeId: null,
        title,
        notes,
        recurrence: buildRecurrenceRule(),
      })
    } else {
      await store.createManualBooking({
        venueId: form.venueId,
        courtId: form.courtId,
        date: form.date,
        startTime: form.startTime,
        endTime: form.endTime,
        teamId: form.teamId,
        slotType: form.slotType,
        matchTypeId: null,
        title,
        notes,
      })
    }
    emit('created')
    close()
  } catch (e: unknown) {
    submitError.value =
      e instanceof Error ? e.message : 'Erreur lors de la création'
  } finally {
    submitting.value = false
  }
}

// ---------------------------------------------------------------------------
// Format helpers (preview) — délègue au helper central pour cohérence
// DD/MM/YYYY sur toute la page Bookings.
// ---------------------------------------------------------------------------

function formatDate(d: Date): string {
  return formatDateShort(d)
}

const MAX_CONFLICT_DATES_SHOWN = 5

const conflictsToShow = computed<Date[]>(() => {
  if (!previewResult.value) return []
  return previewResult.value.conflicts
    .slice(0, MAX_CONFLICT_DATES_SHOWN)
    .map((c) => c.date)
})

const conflictsExtra = computed<number>(() => {
  if (!previewResult.value) return 0
  return Math.max(
    0,
    previewResult.value.conflicts.length - MAX_CONFLICT_DATES_SHOWN,
  )
})

// ---------------------------------------------------------------------------
// Fermetures de salle — affichage inline dans la preview
// ---------------------------------------------------------------------------

const MAX_CLOSURES_SHOWN = 5

const closuresToShow = computed<PreviewClosure[]>(() => {
  if (!previewResult.value) return []
  return previewResult.value.closures.slice(0, MAX_CLOSURES_SHOWN)
})

const closuresExtra = computed<number>(() => {
  if (!previewResult.value) return 0
  return Math.max(
    0,
    previewResult.value.closures.length - MAX_CLOSURES_SHOWN,
  )
})

/**
 * `true` quand toutes les occurrences de la série tombent dans une (ou
 * plusieurs) fermeture de salle. Bloque la création côté UI et déclenche
 * l'affichage du message explicite dans la card de fermetures.
 */
const allOccurrencesClosed = computed<boolean>(() => {
  if (!previewResult.value) return false
  return (
    previewResult.value.kept.length === 0 &&
    previewResult.value.closures.length > 0
  )
})

function closureSourceLabel(source: 'period' | 'custom'): string {
  return source === 'period' ? 'Période partagée' : 'Spécifique salle'
}
</script>

<template>
  <Dialog
    :visible="props.visible"
    modal
    :draggable="false"
    :style="{ width: '560px' }"
    header="Nouvelle réservation"
    @update:visible="(v: boolean) => emit('update:visible', v)"
  >
    <div class="flex flex-col gap-5 pt-1">
      <!-- ================= Section 0 — Type de réservation ================ -->
      <!-- Choix récurrent vs one-shot en tête : oriente la suite du wizard.
           La config de récurrence apparaît juste en dessous, et le champ
           "Date" de "Lieu & horaires" devient disabled (dérivé d'ici). -->
      <section class="space-y-3">
        <label class="flex items-center gap-2 cursor-pointer select-none">
          <Checkbox
            v-model="form.isRecurring"
            input-id="booking-recurring-top"
            binary
          />
          <span class="text-[13px] font-medium">Réservation récurrente</span>
        </label>

        <div
          v-if="form.isRecurring"
          class="space-y-3 pl-1 border-l-2 border-surface-100 ml-1"
        >
          <label class="block pl-3">
            <span class="text-[12px] text-surface-600">Fréquence</span>
            <Select
              v-model="form.recurrenceFrequency"
              :options="[...recurrenceFrequencyOptions]"
              option-label="label"
              option-value="value"
              class="mt-1 w-full"
            />
          </label>

          <div
            v-if="form.recurrenceFrequency === 'monthly'"
            class="space-y-2 pl-3"
          >
            <span class="text-[12px] text-surface-600">Mode mensuel</span>
            <label class="flex items-start gap-2 cursor-pointer">
              <RadioButton
                v-model="form.monthlyMode"
                :value="'dayOfMonth'"
                input-id="monthly-day-of-month"
                class="mt-0.5"
              />
              <span class="text-[13px]">{{ monthlyDayOfMonthLabel }}</span>
            </label>
            <label class="flex items-start gap-2 cursor-pointer">
              <RadioButton
                v-model="form.monthlyMode"
                :value="'nthWeekday'"
                input-id="monthly-nth-weekday"
                class="mt-0.5"
              />
              <span class="text-[13px]">{{ monthlyNthWeekdayLabel }}</span>
            </label>
          </div>

          <label
            v-if="canUseSeasonStart"
            class="flex items-start gap-2 cursor-pointer pl-3"
          >
            <Checkbox
              v-model="form.fromSeasonStart"
              input-id="booking-from-season-start"
              binary
              class="mt-0.5"
            />
            <span class="text-[13px]">
              Depuis le début de la saison
              <span
                v-if="form.fromSeasonStart"
                class="text-surface-500"
              >
                ({{ formatDate(activeSeasonStartDate as Date) }})
              </span>
            </span>
          </label>

          <!-- Quand "Depuis le début de la saison" est actif : weekday picker.
               Sinon : DatePicker classique pour la 1ère occurrence. -->
          <label
            v-if="form.fromSeasonStart"
            class="block pl-3"
          >
            <span class="text-[12px] text-surface-600">
              Jour de la semaine <span class="text-rose-500">*</span>
            </span>
            <Select
              v-model="form.weekday"
              :options="[...weekdayOptions]"
              option-label="label"
              option-value="value"
              placeholder="Sélectionner un jour…"
              class="mt-1 w-full"
              :invalid="!!errors.date"
            />
            <span
              v-if="form.date"
              class="text-[11px] text-surface-500 mt-0.5 block"
            >
              Première occurrence : {{ formatDate(form.date) }}
            </span>
          </label>
          <label
            v-else
            class="block pl-3"
          >
            <span class="text-[12px] text-surface-600">
              Date de début <span class="text-rose-500">*</span>
            </span>
            <DatePicker
              v-model="form.date"
              class="mt-1 w-full"
              date-format="dd/mm/yy"
              placeholder="jj/mm/aaaa"
              :min-date="activeSeasonStartDate ?? undefined"
              :max-date="activeSeasonEndDate ?? undefined"
              :invalid="!!errors.date"
            />
          </label>

          <label
            v-if="canUseSeasonEnd"
            class="flex items-start gap-2 cursor-pointer pl-3"
          >
            <Checkbox
              v-model="form.untilSeasonEnd"
              input-id="booking-until-season-end"
              binary
              class="mt-0.5"
            />
            <span class="text-[13px]">
              Jusqu'à la fin de la saison
              <span
                v-if="form.untilSeasonEnd"
                class="text-surface-500"
              >
                ({{ formatDate(activeSeasonEndDate as Date) }})
              </span>
            </span>
          </label>

          <label class="block pl-3">
            <span class="text-[12px] text-surface-600">
              Date de fin <span class="text-rose-500">*</span>
              <span
                v-if="form.untilSeasonEnd"
                class="text-surface-400"
              >
                (saison active)
              </span>
            </span>
            <DatePicker
              v-model="form.endDate"
              class="mt-1 w-full"
              date-format="dd/mm/yy"
              placeholder="jj/mm/aaaa"
              :min-date="form.date ?? activeSeasonStartDate ?? undefined"
              :max-date="activeSeasonEndDate ?? undefined"
              :invalid="!!errors.endDate"
              :disabled="form.untilSeasonEnd"
            />
            <span
              v-if="errors.endDate"
              class="text-[11px] text-rose-600 mt-0.5 block"
            >
              {{ errors.endDate }}
            </span>
          </label>
        </div>
      </section>

      <!-- ================= Section 1 — Lieu & horaires =================== -->
      <section class="space-y-3">
        <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
          Lieu & horaires
        </h4>
        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-[12px] text-surface-600">Salle <span class="text-rose-500">*</span></span>
            <Select
              v-model="form.venueId"
              :options="venueOptions"
              option-label="label"
              option-value="value"
              placeholder="Sélectionner…"
              class="mt-1 w-full"
              :invalid="!!errors.venueId"
            />
            <span
              v-if="errors.venueId"
              class="text-[11px] text-rose-600 mt-0.5 block"
            >
              {{ errors.venueId }}
            </span>
          </label>
          <label class="block">
            <span class="text-[12px] text-surface-600">Court <span class="text-rose-500">*</span></span>
            <Select
              v-model="form.courtId"
              :options="courtOptions"
              option-label="label"
              option-value="value"
              :placeholder="form.venueId ? 'Sélectionner…' : 'Choisissez une salle'"
              class="mt-1 w-full"
              :disabled="!form.venueId"
              :invalid="!!errors.courtId"
            />
            <span
              v-if="errors.courtId"
              class="text-[11px] text-rose-600 mt-0.5 block"
            >
              {{ errors.courtId }}
            </span>
          </label>
        </div>

        <!-- Date — read-only quand la réservation est récurrente : la date
             effective est configurée dans la section "Récurrence" (au-dessus
             de "Lieu & horaires"), soit via "Date de début", soit dérivée du
             jour de la semaine choisi. Ce champ sert alors d'affichage. -->
        <label class="block">
          <span class="text-[12px] text-surface-600">
            Date <span class="text-rose-500">*</span>
            <span
              v-if="form.isRecurring"
              class="text-surface-400"
            >
              (définie par la récurrence)
            </span>
          </span>
          <DatePicker
            v-model="form.date"
            class="mt-1 w-full"
            date-format="dd/mm/yy"
            placeholder="jj/mm/aaaa"
            :min-date="activeSeasonStartDate ?? undefined"
            :max-date="activeSeasonEndDate ?? undefined"
            :disabled="form.isRecurring"
            :invalid="!!errors.date"
          />
          <span
            v-if="errors.date"
            class="text-[11px] text-rose-600 mt-0.5 block"
          >
            {{ errors.date }}
          </span>
        </label>

        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-[12px] text-surface-600">Heure de début <span class="text-rose-500">*</span></span>
            <InputText
              v-model="form.startTime"
              class="mt-1 w-full"
              placeholder="HH:MM"
              :invalid="!!errors.startTime"
            />
            <span
              v-if="errors.startTime"
              class="text-[11px] text-rose-600 mt-0.5 block"
            >
              {{ errors.startTime }}
            </span>
          </label>
          <label class="block">
            <span class="text-[12px] text-surface-600">Heure de fin <span class="text-rose-500">*</span></span>
            <InputText
              v-model="form.endTime"
              class="mt-1 w-full"
              placeholder="HH:MM"
              :invalid="!!errors.endTime"
            />
            <span
              v-if="errors.endTime"
              class="text-[11px] text-rose-600 mt-0.5 block"
            >
              {{ errors.endTime }}
            </span>
          </label>
        </div>
      </section>

      <!-- ================= Section 2 — Type & équipe =================== -->
      <section class="space-y-3">
        <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
          Type & équipe
        </h4>

        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-[12px] text-surface-600">Type de créneau</span>
            <Select
              v-model="form.slotType"
              :options="[...slotTypeOptions]"
              option-label="label"
              option-value="value"
              class="mt-1 w-full"
            />
          </label>
          <label class="block">
            <span class="text-[12px] text-surface-600">Équipe</span>
            <Select
              v-model="form.teamId"
              :options="teamOptions"
              option-label="label"
              option-value="value"
              placeholder="Aucune équipe (réservation libre)"
              class="mt-1 w-full"
              filter
              show-clear
            />
          </label>
        </div>

        <label class="block">
          <span class="text-[12px] text-surface-600">Titre <span class="text-rose-500">*</span></span>
          <InputText
            v-model="form.title"
            class="mt-1 w-full"
            placeholder="Ex. Entraînement U14"
            :invalid="!!errors.title"
          />
          <span
            v-if="errors.title"
            class="text-[11px] text-rose-600 mt-0.5 block"
          >
            {{ errors.title }}
          </span>
        </label>

        <label class="block">
          <span class="text-[12px] text-surface-600">Notes <span class="text-surface-400">(optionnel)</span></span>
          <Textarea
            v-model="form.notes"
            rows="2"
            class="mt-1 w-full"
            placeholder="Note libre…"
            auto-resize
          />
        </label>
      </section>

      <!-- ================= Section 4 — Preview =================== -->
      <section
        v-if="form.isRecurring"
        class="space-y-2"
      >
        <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
          Preview
        </h4>

        <div
          v-if="previewLoading"
          class="text-[12px] text-surface-500"
        >
          Calcul en cours…
        </div>

        <div
          v-else-if="previewError"
          class="text-[12px] text-rose-600"
        >
          {{ previewError }}
        </div>

        <div
          v-else-if="previewResult"
          class="space-y-2"
        >
          <div class="text-[13px] text-surface-700">
            <span class="font-semibold">{{ previewResult.kept.length }}</span>
            occurrence<span v-if="previewResult.kept.length > 1">s</span> créée<span v-if="previewResult.kept.length > 1">s</span>
            <span class="text-surface-400">·</span>
            <span class="font-semibold">{{ previewResult.skipped.length }}</span>
            skippée<span v-if="previewResult.skipped.length > 1">s</span> (fermeture)
            <span class="text-surface-400">·</span>
            <span
              class="font-semibold"
              :class="previewResult.conflicts.length > 0 ? 'text-rose-600' : ''"
            >
              {{ previewResult.conflicts.length }}
            </span>
            conflit<span v-if="previewResult.conflicts.length > 1">s</span>
          </div>

          <div
            v-if="previewResult.conflicts.length > 0"
            class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 space-y-1"
          >
            <div class="font-medium">
              Dates en conflit :
            </div>
            <ul class="list-disc list-inside space-y-0.5">
              <li
                v-for="(d, idx) in conflictsToShow"
                :key="idx"
              >
                {{ formatDate(d) }}
              </li>
              <li
                v-if="conflictsExtra > 0"
                class="text-rose-600"
              >
                +{{ conflictsExtra }} autre<span v-if="conflictsExtra > 1">s</span>
              </li>
            </ul>
          </div>

          <div
            v-if="previewResult.closures.length > 0"
            class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 space-y-2"
          >
            <div class="font-medium">
              Fermetures de la salle concernées
            </div>
            <div
              v-if="allOccurrencesClosed"
              class="text-[12px] text-amber-700"
            >
              Toutes les occurrences tombent pendant une fermeture — aucune réservation ne sera créée.
            </div>
            <ul class="space-y-1.5">
              <li
                v-for="(c, idx) in closuresToShow"
                :key="idx"
                class="space-y-0.5"
              >
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-semibold text-surface-800">{{ c.name }}</span>
                  <span class="rounded-full border border-amber-200 bg-white px-2 py-[1px] text-[11px] text-amber-700">
                    {{ closureSourceLabel(c.source) }}
                  </span>
                </div>
                <div class="text-[11px] text-surface-600">
                  du {{ formatDate(c.startDate) }} au {{ formatDate(c.endDate) }}
                  <span class="text-surface-400">·</span>
                  {{ c.skippedDates.length }} occurrence<span v-if="c.skippedDates.length > 1">s</span> skippée<span v-if="c.skippedDates.length > 1">s</span>
                </div>
              </li>
              <li
                v-if="closuresExtra > 0"
                class="text-[11px] text-amber-700"
              >
                +{{ closuresExtra }} autre<span v-if="closuresExtra > 1">s</span> fermeture<span v-if="closuresExtra > 1">s</span>
              </li>
            </ul>
          </div>
        </div>

        <div
          v-else
          class="text-[12px] text-surface-400"
        >
          Renseigner les champs ci-dessus pour voir le preview.
        </div>
      </section>

      <!-- ================= Erreur submit =================== -->
      <div
        v-if="submitError"
        class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700"
      >
        {{ submitError }}
      </div>
    </div>

    <template #footer>
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        :disabled="submitting"
        @click="close"
      >
        Annuler
      </button>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        :disabled="!canSubmit || submitting"
        @click="submit"
      >
        <template v-if="submitting">
          Création…
        </template>
        <template v-else>
          Créer
        </template>
      </button>
    </template>
  </Dialog>
</template>
