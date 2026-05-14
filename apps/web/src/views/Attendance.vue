<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  MapPin,
  Save,
  TriangleAlert,
  UserCheck,
  Users,
  XCircle,
} from 'lucide-vue-next'
import InputText from 'primevue/inputtext'
import { useAttendanceStore } from '@/stores/attendance'
import type {
  AttendanceCotisationStatus,
  AttendanceLineRow,
  BookingPickerRow,
} from '@/repositories/attendance.repo'
import Avatar from '@/components/ui/Avatar.vue'
import Pill from '@/components/ui/Pill.vue'

/**
 * Vue Attendance — pointage des présences pour un booking.
 *
 * Deux modes selon `route.query.bookingId` :
 *  - absent → picker des créneaux pointables (today ±7j).
 *  - posé   → header booking + table des joueurs avec radios + save.
 *
 * Cf. brief Attendance + docs/main.md (section Attendance).
 */

const route = useRoute()
const router = useRouter()
const store = useAttendanceStore()

// ---------------------------------------------------------------------------
// Mode resolution + chargement
// ---------------------------------------------------------------------------

const bookingId = computed<string | null>(() => {
  const raw = route.query.bookingId
  if (typeof raw === 'string' && raw.length > 0) return raw
  return null
})

const mode = computed<'picker' | 'booking'>(() =>
  bookingId.value ? 'booking' : 'picker',
)

onMounted(() => {
  if (bookingId.value) {
    void store.loadBooking(bookingId.value)
  } else {
    void store.loadPicker()
  }
})

watch(bookingId, (next, prev) => {
  if (next === prev) return
  if (next) {
    void store.loadBooking(next)
  } else {
    store.resetBooking()
    void store.loadPicker()
  }
})

function pickBooking(row: BookingPickerRow): void {
  void router.push({ name: 'attendance', query: { bookingId: row.id } })
}

function backToPicker(): void {
  void router.push({ name: 'attendance' })
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const DATE_FMT = new Intl.DateTimeFormat('fr-CH', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
})

function formatDate(d: Date): string {
  return DATE_FMT.format(d)
}

/**
 * Convertit le Timestamp neutre de shared-types en Date. La lecture
 * Firestore renvoie en réalité un Timestamp SDK (qui a `.toDate()`) ; le
 * type shared-types n'expose pas la méthode pour rester découplé du SDK.
 */
function bookingDate(ts: { seconds: number; nanoseconds: number }): Date {
  return new Date(ts.seconds * 1000 + Math.floor(ts.nanoseconds / 1e6))
}

/** Libellé court de slot type — affiché en pill. */
function slotTypeLabel(slotType: string): string {
  switch (slotType) {
    case 'training':
      return 'Entraînement'
    case 'match_home':
      return 'Match à domicile'
    case 'match_away':
      return "Match à l'extérieur"
    case 'reserve':
      return 'Réserve'
    case 'custom':
      return 'Spécial'
    default:
      return slotType
  }
}

function slotTypePillVariant(
  slotType: string,
): 'emerald' | 'sky' | 'amber' | 'rose' | 'slate' | 'violet' {
  switch (slotType) {
    case 'training':
      return 'emerald'
    case 'match_home':
      return 'sky'
    case 'match_away':
      return 'violet'
    case 'reserve':
      return 'amber'
    default:
      return 'slate'
  }
}

// ---------------------------------------------------------------------------
// Cotisation pill — variant + label par CotisationStatus (cohérent avec
// Members.vue).
// ---------------------------------------------------------------------------

type PillVariant = 'emerald' | 'sky' | 'amber' | 'rose' | 'slate' | 'violet'

interface DuesPillDef {
  variant: PillVariant
  label: string
  strike: boolean
}

function duesPill(status: AttendanceCotisationStatus): DuesPillDef | null {
  if (!status) return null
  switch (status) {
    case 'paid':
      return { variant: 'emerald', label: 'Payée', strike: false }
    case 'pending_grace':
      return { variant: 'slate', label: 'Grâce', strike: false }
    case 'issued':
      return { variant: 'sky', label: 'Émise', strike: false }
    case 'overdue':
      return { variant: 'rose', label: 'Retard', strike: false }
    case 'excepted':
      return { variant: 'amber', label: 'Exception', strike: false }
    case 'cancelled':
      return { variant: 'rose', label: 'Exclu', strike: true }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Helpers ligne — status courant, classe de la ligne (bordure colorée)
// ---------------------------------------------------------------------------

type AttendanceStatus = 'present' | 'absent' | 'excused'

function statusFor(line: AttendanceLineRow): AttendanceStatus | null {
  return store.effectiveStatusFor(line)
}

function noteFor(line: AttendanceLineRow): string {
  return store.effectiveNoteFor(line) ?? ''
}

/**
 * Classe CSS de la bordure gauche selon le status courant. Donne un
 * feedback visuel immédiat à la sélection radio.
 */
function rowBorderClass(line: AttendanceLineRow): string {
  if (line.isExcluded) return 'border-l-4 border-l-surface-300'
  const s = statusFor(line)
  if (s === 'present') return 'border-l-4 border-l-emerald-500'
  if (s === 'absent') return 'border-l-4 border-l-rose-500'
  if (s === 'excused') return 'border-l-4 border-l-amber-500'
  return 'border-l-4 border-l-transparent'
}

function fullName(line: AttendanceLineRow): string {
  return `${line.firstName} ${line.lastName}`.trim()
}

// ---------------------------------------------------------------------------
// Save flow — banner success après commit. Pas de toast global pour éviter
// d'avoir à wirer ToastService dans main.ts (cf. décision UI).
// ---------------------------------------------------------------------------

const successBannerVisible = ref(false)
let successTimer: ReturnType<typeof setTimeout> | null = null

const saveSuccess = computed<boolean>(() => {
  // Le banner se déclenche manuellement (cf. onSave). On stocke via ref locale.
  return successBannerVisible.value
})

async function onSave(): Promise<void> {
  try {
    await store.save()
    successBannerVisible.value = true
    if (successTimer) clearTimeout(successTimer)
    successTimer = setTimeout(() => {
      successBannerVisible.value = false
    }, 3000)
  } catch {
    // Erreur déjà capturée dans `store.error` — le banner d'erreur
    // s'affiche depuis le template.
  }
}

// ---------------------------------------------------------------------------
// Bouton Save — label dynamique avec count.
// ---------------------------------------------------------------------------

const saveLabel = computed<string>(() => {
  const n = store.changesCount
  if (n === 0) return 'Enregistrer'
  if (n === 1) return 'Enregistrer (1 modification)'
  return `Enregistrer (${n} modifications)`
})

const saveDisabled = computed<boolean>(
  () => store.saving || store.changesCount === 0,
)
</script>

<template>
  <section class="p-6 space-y-4">
    <!-- ================= Page heading =================== -->
    <div class="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <div class="flex items-center gap-2 text-[12px] text-surface-500">
          <button
            v-if="mode === 'booking'"
            type="button"
            class="hover:text-surface-700 inline-flex items-center gap-1"
            @click="backToPicker"
          >
            Attendance
            <ChevronRight :size="12" />
          </button>
        </div>
        <h1 class="text-[22px] font-semibold tracking-tight">
          {{ mode === 'picker' ? 'Attendance' : 'Pointage' }}
        </h1>
        <p
          v-if="mode === 'picker'"
          class="text-[13px] text-surface-500 mt-0.5"
        >
          Choisir un créneau à pointer
        </p>
      </div>
    </div>

    <!-- ================= Banner success ================= -->
    <div
      v-if="saveSuccess"
      class="card p-3 flex items-center gap-2 border-emerald-200 bg-emerald-50"
    >
      <CheckCircle2
        :size="16"
        class="text-emerald-600"
      />
      <span class="text-[13px] text-emerald-800">
        Présences enregistrées
      </span>
    </div>

    <!-- ================= Banner error =================== -->
    <div
      v-if="store.error"
      class="card p-3 flex items-center gap-2 border-rose-200 bg-rose-50"
    >
      <TriangleAlert
        :size="16"
        class="text-rose-600"
      />
      <span class="text-[13px] text-rose-800">
        {{ store.error }}
      </span>
    </div>

    <!-- ================= Loading skeleton =============== -->
    <div
      v-if="store.loading"
      class="card p-6 space-y-3"
    >
      <div class="h-4 w-1/3 bg-surface-100 rounded animate-pulse" />
      <div class="h-4 w-2/3 bg-surface-100 rounded animate-pulse" />
      <div class="h-4 w-1/2 bg-surface-100 rounded animate-pulse" />
    </div>

    <!-- ================= MODE PICKER ==================== -->
    <template v-if="!store.loading && mode === 'picker'">
      <div
        v-if="store.pickerRows.length === 0 && !store.error"
        class="card p-6 text-center text-[13px] text-surface-500"
      >
        <Calendar
          :size="24"
          class="mx-auto mb-2 text-surface-400"
        />
        Aucun créneau à pointer dans la fenêtre J±7.
      </div>

      <div
        v-else
        class="card divide-y divide-surface-100"
      >
        <button
          v-for="row in store.pickerRows"
          :key="row.id"
          type="button"
          class="w-full flex items-center gap-4 p-4 hover:bg-surface-50 text-left"
          @click="pickBooking(row)"
        >
          <div class="w-24 shrink-0">
            <div class="text-[13px] font-medium text-surface-900">
              {{ formatDate(row.date) }}
            </div>
            <div class="text-[12px] text-surface-500 num inline-flex items-center gap-1">
              <Clock :size="11" />
              {{ row.startTime }}–{{ row.endTime }}
            </div>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-[14px] font-medium text-surface-900 truncate">
                {{ row.teamName }}
              </span>
              <Pill :variant="slotTypePillVariant(row.slotType)">
                {{ slotTypeLabel(row.slotType) }}
              </Pill>
            </div>
            <div class="text-[12px] text-surface-500 mt-0.5 inline-flex items-center gap-1">
              <MapPin :size="11" />
              {{ row.courtName }}
            </div>
          </div>
          <ChevronRight
            :size="16"
            class="text-surface-400 shrink-0"
          />
        </button>
      </div>
    </template>

    <!-- ================= MODE BOOKING =================== -->
    <template v-if="!store.loading && mode === 'booking'">
      <!-- Header booking summary -->
      <div
        v-if="store.bookingHeader"
        class="card p-4"
      >
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div class="space-y-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-[17px] font-semibold text-surface-900">
                {{ store.bookingHeader.teamName }}
              </span>
              <Pill :variant="slotTypePillVariant(store.bookingHeader.booking.slotType)">
                {{ slotTypeLabel(store.bookingHeader.booking.slotType) }}
              </Pill>
            </div>
            <div class="flex items-center gap-3 text-[12px] text-surface-500">
              <span class="inline-flex items-center gap-1">
                <Calendar :size="12" />
                {{ formatDate(bookingDate(store.bookingHeader.booking.date)) }}
              </span>
              <span class="inline-flex items-center gap-1 num">
                <Clock :size="12" />
                {{ store.bookingHeader.booking.startTime }}–{{ store.bookingHeader.booking.endTime }}
              </span>
              <span class="inline-flex items-center gap-1">
                <MapPin :size="12" />
                {{ store.bookingHeader.courtName }}
              </span>
            </div>
          </div>
          <div class="flex items-center gap-3 text-[12px] text-surface-500">
            <span class="inline-flex items-center gap-1">
              <UserCheck
                :size="12"
                class="text-emerald-600"
              />
              {{ store.stats.countPresent }} présents
            </span>
            <span class="inline-flex items-center gap-1">
              <XCircle
                :size="12"
                class="text-rose-600"
              />
              {{ store.stats.countAbsent }} absents
            </span>
            <span class="inline-flex items-center gap-1">
              <TriangleAlert
                :size="12"
                class="text-amber-600"
              />
              {{ store.stats.countExcused }} excusés
            </span>
            <span class="text-surface-400">·</span>
            <span class="num">
              {{ store.stats.countPending }} en attente
            </span>
          </div>
        </div>
      </div>

      <!-- Empty state : booking sans team -->
      <div
        v-else-if="!store.error"
        class="card p-6 text-center text-[13px] text-surface-500"
      >
        Créneau introuvable ou supprimé.
      </div>

      <template v-if="store.bookingHeader && !store.bookingHeader.booking.teamId">
        <div class="card p-6 text-center text-[13px] text-surface-500">
          <Users
            :size="24"
            class="mx-auto mb-2 text-surface-400"
          />
          Pas d'équipe associée, rien à pointer.
        </div>
      </template>

      <template v-else-if="store.bookingHeader && store.bookingHeader.booking.teamId">
        <!-- Toolbar : bulk actions -->
        <div class="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            :disabled="store.attendanceLines.length === 0"
            @click="store.setAllPresent()"
          >
            <UserCheck :size="12" />
            Tous présents
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            :disabled="store.attendanceLines.length === 0"
            @click="store.setAllAbsent()"
          >
            <XCircle :size="12" />
            Tous absents
          </button>
          <div class="ml-auto text-[12px] text-surface-500">
            {{ store.attendanceLines.length }} joueurs
          </div>
        </div>

        <!-- Table des lignes -->
        <div
          v-if="store.attendanceLines.length === 0"
          class="card p-6 text-center text-[13px] text-surface-500"
        >
          <Users
            :size="24"
            class="mx-auto mb-2 text-surface-400"
          />
          Cette équipe n'a pas de joueurs actifs.
        </div>

        <div
          v-else
          class="card divide-y divide-surface-100 pb-20"
        >
          <div
            v-for="line in store.attendanceLines"
            :key="line.memberId"
            class="flex items-center gap-4 p-3 transition-colors"
            :class="[
              rowBorderClass(line),
              line.isExcluded ? 'opacity-60 bg-surface-50' : 'bg-white',
            ]"
          >
            <!-- Identity -->
            <Avatar
              :name="fullName(line)"
              :size="32"
            />
            <div class="flex-1 min-w-0">
              <div class="text-[13px] font-medium text-surface-900 truncate">
                {{ fullName(line) }}
              </div>
              <div class="flex items-center gap-1.5 mt-0.5">
                <Pill
                  v-if="line.isExcluded"
                  variant="rose"
                >
                  Exclu
                </Pill>
                <Pill
                  v-else-if="duesPill(line.duesStatus)"
                  :variant="duesPill(line.duesStatus)!.variant"
                  :strike="duesPill(line.duesStatus)!.strike"
                >
                  {{ duesPill(line.duesStatus)!.label }}
                </Pill>
                <span
                  v-else
                  class="text-[11px] text-surface-400"
                >—</span>
              </div>
            </div>

            <!-- Radios 3-way -->
            <div
              class="flex items-center gap-1"
              :aria-disabled="line.isExcluded"
            >
              <label
                v-for="opt in (['present', 'absent', 'excused'] as const)"
                :key="opt"
                class="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md2 cursor-pointer border text-[12px] transition-colors"
                :class="{
                  'border-emerald-500 bg-emerald-50 text-emerald-800': statusFor(line) === opt && opt === 'present',
                  'border-rose-500 bg-rose-50 text-rose-800': statusFor(line) === opt && opt === 'absent',
                  'border-amber-500 bg-amber-50 text-amber-800': statusFor(line) === opt && opt === 'excused',
                  'border-surface-200 bg-white text-surface-700 hover:bg-surface-50': statusFor(line) !== opt && !line.isExcluded,
                  'cursor-not-allowed opacity-60': line.isExcluded,
                }"
              >
                <input
                  type="radio"
                  :name="`status-${line.memberId}`"
                  :value="opt"
                  :checked="statusFor(line) === opt"
                  :disabled="line.isExcluded"
                  class="sr-only"
                  @change="store.setLineStatus(line.memberId, opt)"
                >
                <span class="capitalize">
                  {{ opt === 'present' ? 'Présent' : opt === 'absent' ? 'Absent' : 'Excusé' }}
                </span>
              </label>
            </div>

            <!-- Note -->
            <div class="w-48 shrink-0">
              <InputText
                :model-value="noteFor(line)"
                placeholder="Note (optionnel)"
                size="small"
                class="!h-7 !text-[12px] w-full"
                :disabled="line.isExcluded"
                @update:model-value="
                  (v: string | undefined) => store.setLineNote(line.memberId, v ?? null)
                "
              />
            </div>
          </div>
        </div>
      </template>

      <!-- Sticky save bar (bottom-right) -->
      <div
        v-if="store.bookingHeader && store.bookingHeader.booking.teamId"
        class="fixed bottom-4 right-4 z-30"
      >
        <button
          type="button"
          class="btn btn-primary shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="saveDisabled"
          @click="onSave"
        >
          <Save :size="14" />
          {{ saveLabel }}
        </button>
      </div>
    </template>
  </section>
</template>
