<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  Building2,
  Calendar,
  Link2,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-vue-next'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import DatePicker from 'primevue/datepicker'
import MultiSelect from 'primevue/multiselect'
import InputSwitch from 'primevue/inputswitch'
import Menu from 'primevue/menu'
import type { MenuItem } from 'primevue/menuitem'
import { useVenuesStore } from '@/stores/venues'
import type { VenueRow } from '@/repositories/venues.repo'
import type { Court, CourtSize, Timestamp } from '@club-app/shared-types'
import Pill from '@/components/ui/Pill.vue'

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const store = useVenuesStore()

onMounted(() => {
  void store.load()
})

const totals = computed(() => store.totals)
const filteredVenues = computed<VenueRow[]>(() => store.filtered)
const selectedVenue = computed<VenueRow | null>(() => store.selectedVenue)
const selectedCourts = computed<Court[]>(() => store.selectedCourts)

// ---------------------------------------------------------------------------
// Helpers dates / coordonnées
// ---------------------------------------------------------------------------

function formatTimestamp(ts: Timestamp): string {
  return new Date(ts.seconds * 1000).toLocaleDateString('fr-CH')
}

function formatCoord(lat: number, lng: number): string {
  const latDir = lat >= 0 ? 'N' : 'S'
  const lngDir = lng >= 0 ? 'E' : 'O'
  return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lng).toFixed(4)}° ${lngDir}`
}

// ---------------------------------------------------------------------------
// Helpers courts
// ---------------------------------------------------------------------------

const COURT_SIZE_OPTIONS: ReadonlyArray<{ value: CourtSize; label: string }> = [
  { value: 'small', label: 'Petit' },
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Grand' },
] as const

function courtSizeVariant(size: CourtSize): 'slate' | 'emerald' | 'violet' {
  switch (size) {
    case 'small':
      return 'slate'
    case 'large':
      return 'violet'
    case 'normal':
    default:
      return 'emerald'
  }
}

function courtSizeLabel(size: CourtSize): string {
  switch (size) {
    case 'small':
      return 'Petit'
    case 'large':
      return 'Grand'
    case 'normal':
    default:
      return 'Normal'
  }
}

/** Résout les IDs de courts liés vers leurs noms pour l'affichage. */
function resolvedCombinedNames(courtIds: string[]): string[] {
  return courtIds.map((id) => {
    const found = selectedCourts.value.find((c) => c.id === id)
    return found ? found.name : id
  })
}

// ---------------------------------------------------------------------------
// Sélection venue — colonne gauche
// ---------------------------------------------------------------------------

function selectVenue(id: string): void {
  store.selectVenue(id)
}

// ---------------------------------------------------------------------------
// Per-court actions menu — PrimeVue Menu en mode popup
// ---------------------------------------------------------------------------

const courtMenuRef = ref<InstanceType<typeof Menu> | null>(null)
const menuTargetCourt = ref<Court | null>(null)

const courtMenuItems = computed<MenuItem[]>(() => {
  const target = menuTargetCourt.value
  const venue = selectedVenue.value
  if (!target || !venue) return []
  return [
    {
      label: 'Modifier',
      command: () => {
        openEditCourtDialog(target)
      },
    },
    {
      label: 'Supprimer',
      command: () => {
        openDeleteCourtConfirm(target)
      },
    },
  ]
})

function openCourtMenu(event: Event, court: Court): void {
  menuTargetCourt.value = court
  courtMenuRef.value?.toggle(event)
}

// ---------------------------------------------------------------------------
// Toggle actif/inactif d'un court
// ---------------------------------------------------------------------------

async function toggleActive(court: Court): Promise<void> {
  const venue = selectedVenue.value
  if (!venue) return
  await store.toggleCourtActive(venue.id, court.id)
}

// ---------------------------------------------------------------------------
// Dialog — Créer une salle
// ---------------------------------------------------------------------------

interface CreateVenueForm {
  name: string
  address: string
  latitude: number
  longitude: number
}

interface CreateVenueErrors {
  name: string | null
  address: string | null
  latitude: string | null
  longitude: string | null
}

const isCreateVenueOpen = ref(false)
const createVenueForm = reactive<CreateVenueForm>({
  name: '',
  address: '',
  latitude: 46.5,
  longitude: 6.6,
})
const createVenueErrors = reactive<CreateVenueErrors>({
  name: null,
  address: null,
  latitude: null,
  longitude: null,
})
const submittingVenue = ref(false)

function openCreateVenueDialog(): void {
  createVenueForm.name = ''
  createVenueForm.address = ''
  createVenueForm.latitude = 46.5
  createVenueForm.longitude = 6.6
  createVenueErrors.name = null
  createVenueErrors.address = null
  createVenueErrors.latitude = null
  createVenueErrors.longitude = null
  isCreateVenueOpen.value = true
}

function closeCreateVenueDialog(): void {
  isCreateVenueOpen.value = false
}

function validateCreateVenue(): boolean {
  createVenueErrors.name = createVenueForm.name.trim() ? null : 'Nom requis'
  createVenueErrors.address = createVenueForm.address.trim() ? null : 'Adresse requise'
  const lat = createVenueForm.latitude
  createVenueErrors.latitude =
    lat >= -90 && lat <= 90 ? null : 'Latitude invalide'
  const lng = createVenueForm.longitude
  createVenueErrors.longitude =
    lng >= -180 && lng <= 180 ? null : 'Longitude invalide'
  return (
    !createVenueErrors.name &&
    !createVenueErrors.address &&
    !createVenueErrors.latitude &&
    !createVenueErrors.longitude
  )
}

async function submitCreateVenue(): Promise<void> {
  if (!validateCreateVenue()) return
  submittingVenue.value = true
  try {
    const newId = await store.createVenue({
      name: createVenueForm.name.trim(),
      address: createVenueForm.address.trim(),
      latitude: createVenueForm.latitude,
      longitude: createVenueForm.longitude,
    })
    if (newId) {
      closeCreateVenueDialog()
      store.selectVenue(newId)
    }
  } finally {
    submittingVenue.value = false
  }
}

// ---------------------------------------------------------------------------
// Dialog — Modifier une salle
// ---------------------------------------------------------------------------

interface EditVenueForm {
  name: string
  address: string
  latitude: number
  longitude: number
}

interface EditVenueErrors {
  name: string | null
  address: string | null
  latitude: string | null
  longitude: string | null
}

const isEditVenueOpen = ref(false)
const editVenueForm = reactive<EditVenueForm>({
  name: '',
  address: '',
  latitude: 0,
  longitude: 0,
})
const editVenueErrors = reactive<EditVenueErrors>({
  name: null,
  address: null,
  latitude: null,
  longitude: null,
})
const editingVenue = ref(false)

function openEditVenueDialog(): void {
  const v = selectedVenue.value
  if (!v) return
  editVenueForm.name = v.name
  editVenueForm.address = v.address
  editVenueForm.latitude = v.coordinates?.latitude ?? 46.5
  editVenueForm.longitude = v.coordinates?.longitude ?? 6.6
  editVenueErrors.name = null
  editVenueErrors.address = null
  editVenueErrors.latitude = null
  editVenueErrors.longitude = null
  isEditVenueOpen.value = true
}

function closeEditVenueDialog(): void {
  isEditVenueOpen.value = false
}

function validateEditVenue(): boolean {
  editVenueErrors.name = editVenueForm.name.trim() ? null : 'Nom requis'
  editVenueErrors.address = editVenueForm.address.trim() ? null : 'Adresse requise'
  const lat = editVenueForm.latitude
  editVenueErrors.latitude =
    lat >= -90 && lat <= 90 ? null : 'Latitude invalide'
  const lng = editVenueForm.longitude
  editVenueErrors.longitude =
    lng >= -180 && lng <= 180 ? null : 'Longitude invalide'
  return (
    !editVenueErrors.name &&
    !editVenueErrors.address &&
    !editVenueErrors.latitude &&
    !editVenueErrors.longitude
  )
}

async function submitEditVenue(): Promise<void> {
  const v = selectedVenue.value
  if (!v) return
  if (!validateEditVenue()) return
  editingVenue.value = true
  try {
    const ok = await store.updateVenue(v.id, {
      name: editVenueForm.name.trim(),
      address: editVenueForm.address.trim(),
      latitude: editVenueForm.latitude,
      longitude: editVenueForm.longitude,
    })
    if (ok) {
      closeEditVenueDialog()
    }
  } finally {
    editingVenue.value = false
  }
}

// ---------------------------------------------------------------------------
// Confirmation — Supprimer une salle
// ---------------------------------------------------------------------------

const isDeleteVenueOpen = ref(false)
const confirmingDeleteVenue = ref(false)

function openDeleteVenueConfirm(): void {
  isDeleteVenueOpen.value = true
}

function closeDeleteVenueConfirm(): void {
  isDeleteVenueOpen.value = false
}

async function confirmDeleteVenue(): Promise<void> {
  const v = selectedVenue.value
  if (!v) return
  confirmingDeleteVenue.value = true
  try {
    const ok = await store.deleteVenue(v.id)
    if (ok) {
      store.selectVenue(null)
      closeDeleteVenueConfirm()
    }
  } finally {
    confirmingDeleteVenue.value = false
  }
}

// ---------------------------------------------------------------------------
// Dialog — Créer un court
// ---------------------------------------------------------------------------

interface CourtForm {
  name: string
  courtSize: CourtSize
  sport: string
  isCombined: boolean
  combinedCourtIds: string[]
  active: boolean
}

interface CourtErrors {
  name: string | null
}

function makeEmptyCourtForm(): CourtForm {
  return {
    name: '',
    courtSize: 'normal',
    sport: 'basketball',
    isCombined: false,
    combinedCourtIds: [],
    active: true,
  }
}

const isCreateCourtOpen = ref(false)
const courtForm = reactive<CourtForm>(makeEmptyCourtForm())
const courtErrors = reactive<CourtErrors>({ name: null })
const submittingCourt = ref(false)

/** Courts disponibles comme "sous-courts" (exclut le court lui-même en mode édition). */
const combinedCourtOptions = computed<Court[]>(() => {
  const courts = selectedCourts.value
  if (!isEditCourtOpen.value) return courts
  const target = editingCourt.value
  if (!target) return courts
  return courts.filter((c) => c.id !== target.id)
})

function openCreateCourtDialog(): void {
  Object.assign(courtForm, makeEmptyCourtForm())
  courtErrors.name = null
  isCreateCourtOpen.value = true
}

function closeCreateCourtDialog(): void {
  isCreateCourtOpen.value = false
}

function validateCourtForm(): boolean {
  courtErrors.name = courtForm.name.trim() ? null : 'Nom requis'
  return !courtErrors.name
}

async function submitCreateCourt(): Promise<void> {
  const v = selectedVenue.value
  if (!v) return
  if (!validateCourtForm()) return
  submittingCourt.value = true
  try {
    const newId = await store.createCourt(v.id, {
      name: courtForm.name.trim(),
      courtSize: courtForm.courtSize,
      sport: courtForm.sport.trim() || 'basketball',
      isCombined: courtForm.isCombined,
      combinedCourtIds: courtForm.isCombined ? courtForm.combinedCourtIds : [],
    })
    if (newId) {
      closeCreateCourtDialog()
    }
  } finally {
    submittingCourt.value = false
  }
}

// ---------------------------------------------------------------------------
// Dialog — Modifier un court
// ---------------------------------------------------------------------------

const isEditCourtOpen = ref(false)
const editingCourt = ref<Court | null>(null)
const editingCourtSaving = ref(false)

function openEditCourtDialog(court: Court): void {
  editingCourt.value = court
  courtForm.name = court.name
  courtForm.courtSize = court.courtSize
  courtForm.sport = court.sport
  courtForm.isCombined = court.isCombined
  courtForm.combinedCourtIds = [...court.combinedCourtIds]
  courtForm.active = court.active
  courtErrors.name = null
  isEditCourtOpen.value = true
}

function closeEditCourtDialog(): void {
  isEditCourtOpen.value = false
  editingCourt.value = null
}

async function submitEditCourt(): Promise<void> {
  const v = selectedVenue.value
  const target = editingCourt.value
  if (!v || !target) return
  if (!validateCourtForm()) return
  editingCourtSaving.value = true
  try {
    const ok = await store.updateCourt(v.id, target.id, {
      name: courtForm.name.trim(),
      courtSize: courtForm.courtSize,
      sport: courtForm.sport.trim() || 'basketball',
      isCombined: courtForm.isCombined,
      combinedCourtIds: courtForm.isCombined ? courtForm.combinedCourtIds : [],
      active: courtForm.active,
    })
    if (ok) {
      closeEditCourtDialog()
    }
  } finally {
    editingCourtSaving.value = false
  }
}

// ---------------------------------------------------------------------------
// Confirmation — Supprimer un court
// ---------------------------------------------------------------------------

const isDeleteCourtOpen = ref(false)
const deletingCourt = ref<Court | null>(null)
const confirmingDeleteCourt = ref(false)

function openDeleteCourtConfirm(court: Court): void {
  deletingCourt.value = court
  isDeleteCourtOpen.value = true
}

function closeDeleteCourtConfirm(): void {
  isDeleteCourtOpen.value = false
  deletingCourt.value = null
}

async function confirmDeleteCourt(): Promise<void> {
  const v = selectedVenue.value
  const target = deletingCourt.value
  if (!v || !target) return
  confirmingDeleteCourt.value = true
  try {
    const ok = await store.deleteCourt(v.id, target.id)
    if (ok) {
      closeDeleteCourtConfirm()
    }
  } finally {
    confirmingDeleteCourt.value = false
  }
}

// ---------------------------------------------------------------------------
// Fermetures ponctuelles (customClosures)
// ---------------------------------------------------------------------------

interface ClosureForm {
  name: string
  startDate: Date | null
  endDate: Date | null
}

interface ClosureErrors {
  name: string | null
  startDate: string | null
  endDate: string | null
}

const closureForm = reactive<ClosureForm>({
  name: '',
  startDate: null,
  endDate: null,
})
const closureErrors = reactive<ClosureErrors>({
  name: null,
  startDate: null,
  endDate: null,
})
const submittingClosure = ref(false)

function resetClosureForm(): void {
  closureForm.name = ''
  closureForm.startDate = null
  closureForm.endDate = null
  closureErrors.name = null
  closureErrors.startDate = null
  closureErrors.endDate = null
}

function validateClosureForm(): boolean {
  closureErrors.name = closureForm.name.trim() ? null : 'Nom requis'
  closureErrors.startDate = closureForm.startDate ? null : 'Date de début requise'
  closureErrors.endDate = closureForm.endDate ? null : 'Date de fin requise'
  return !closureErrors.name && !closureErrors.startDate && !closureErrors.endDate
}

async function submitAddClosure(): Promise<void> {
  const v = selectedVenue.value
  if (!v) return
  if (!validateClosureForm()) return
  if (!closureForm.startDate || !closureForm.endDate) return
  submittingClosure.value = true
  try {
    const ok = await store.addCustomClosure(v.id, {
      name: closureForm.name.trim(),
      startDate: closureForm.startDate,
      endDate: closureForm.endDate,
    })
    if (ok) {
      resetClosureForm()
    }
  } finally {
    submittingClosure.value = false
  }
}

async function removeClosure(index: number): Promise<void> {
  const v = selectedVenue.value
  if (!v) return
  await store.removeCustomClosure(v.id, index)
}
</script>

<template>
  <section class="p-6 flex flex-col gap-4 h-full min-h-0">
    <!-- ================= Page heading =================== -->
    <div class="flex items-end justify-between gap-4 flex-wrap flex-shrink-0">
      <div>
        <h1 class="text-[22px] font-semibold tracking-tight">
          Venues &amp; courts
        </h1>
        <p class="text-[13px] text-surface-500 mt-0.5">
          {{ totals.venues }} salle<span v-if="totals.venues > 1">s</span>
          · {{ totals.courts }} court<span v-if="totals.courts > 1">s</span>
          ({{ totals.activeCourts }} actif<span v-if="totals.activeCourts > 1">s</span>)
        </p>
      </div>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        @click="openCreateVenueDialog"
      >
        <Plus
          :size="14"
          :stroke-width="2"
        />
        Nouvelle salle
      </button>
    </div>

    <!-- ================= Error banner =================== -->
    <div
      v-if="store.error"
      class="card border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700 flex items-center gap-2 flex-shrink-0"
    >
      <TriangleAlert
        :size="14"
        :stroke-width="2"
      />
      {{ store.error }}
    </div>

    <!-- ================= Layout master / detail =================== -->
    <div class="flex gap-4 flex-1 min-h-0 overflow-hidden">
      <!-- ====== Colonne gauche — liste venues ====== -->
      <div class="w-80 flex-shrink-0 flex flex-col gap-3 overflow-y-auto">
        <!-- Search -->
        <div class="input-wrap">
          <Search :size="14" />
          <input
            class="input input-with-icon !h-8"
            placeholder="Rechercher une salle…"
            :value="store.search"
            @input="store.setSearch(($event.target as HTMLInputElement).value)"
          >
        </div>

        <!-- Loading skeleton -->
        <template v-if="store.loading && filteredVenues.length === 0">
          <div
            v-for="i in 3"
            :key="`skel-${i}`"
            class="card p-4 animate-pulse h-[72px] bg-surface-50"
          />
        </template>

        <!-- Empty state — aucune salle -->
        <div
          v-else-if="filteredVenues.length === 0"
          class="card p-8 text-center flex flex-col items-center gap-3"
        >
          <span class="w-10 h-10 rounded-full bg-surface-100 inline-flex items-center justify-center text-surface-500">
            <Building2
              :size="18"
              :stroke-width="2"
            />
          </span>
          <div class="text-[13px] font-semibold">
            Aucune salle configurée
          </div>
          <button
            type="button"
            class="btn btn-primary btn-sm mt-1"
            @click="openCreateVenueDialog"
          >
            <Plus
              :size="14"
              :stroke-width="2"
            />
            Créer la première salle
          </button>
        </div>

        <!-- Liste venues -->
        <template v-else>
          <button
            v-for="venue in filteredVenues"
            :key="venue.id"
            type="button"
            class="card p-4 text-left transition-colors hover:border-surface-300 hover:bg-surface-50 w-full"
            :class="
              store.selectedVenueId === venue.id
                ? 'bg-surface-50 border-emerald-500 border'
                : ''
            "
            @click="selectVenue(venue.id)"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0 flex-1">
                <div class="text-[14px] font-semibold truncate">
                  {{ venue.name }}
                </div>
                <div class="text-[12px] text-surface-500 truncate mt-0.5">
                  <MapPin
                    :size="11"
                    :stroke-width="2"
                    class="inline mr-0.5 opacity-60"
                  />
                  {{ venue.address }}
                </div>
              </div>
            </div>
            <div class="flex items-center gap-1.5 mt-2 flex-wrap">
              <Pill variant="slate">
                {{ venue.courtCount }} court<span v-if="venue.courtCount > 1">s</span>
              </Pill>
              <Pill variant="emerald">
                {{ venue.activeCourtCount }} actif<span v-if="venue.activeCourtCount > 1">s</span>
              </Pill>
            </div>
          </button>
        </template>
      </div>

      <!-- ====== Colonne droite — détail venue ====== -->
      <div class="flex-1 overflow-y-auto min-w-0">
        <!-- Empty state — aucune salle sélectionnée -->
        <div
          v-if="!selectedVenue"
          class="card p-12 text-center flex flex-col items-center gap-3 h-full justify-center"
        >
          <span class="w-12 h-12 rounded-full bg-surface-100 inline-flex items-center justify-center text-surface-400">
            <Building2
              :size="22"
              :stroke-width="2"
            />
          </span>
          <div class="text-[14px] font-semibold text-surface-600">
            Sélectionnez une salle
          </div>
          <div class="text-[12px] text-surface-500">
            Choisissez une salle dans la liste à gauche pour voir ses détails et gérer ses courts.
          </div>
        </div>

        <!-- Détail venue sélectionnée -->
        <div
          v-else
          class="space-y-5"
        >
          <!-- Header détail -->
          <div class="card p-5 flex items-start justify-between gap-4">
            <div class="min-w-0 flex-1">
              <h2 class="text-[18px] font-semibold">
                {{ selectedVenue.name }}
              </h2>
              <div class="text-[13px] text-surface-500 flex items-center gap-1 mt-1">
                <MapPin
                  :size="13"
                  :stroke-width="2"
                />
                {{ selectedVenue.address }}
              </div>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                @click="openEditVenueDialog"
              >
                <Pencil
                  :size="14"
                  :stroke-width="2"
                />
                Modifier
              </button>
              <button
                type="button"
                class="btn btn-sm border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors"
                @click="openDeleteVenueConfirm"
              >
                <Trash2
                  :size="14"
                  :stroke-width="2"
                />
                Supprimer
              </button>
            </div>
          </div>

          <!-- Section informations -->
          <div class="card p-5 space-y-3">
            <h3 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
              Informations
            </h3>
            <div class="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
              <div>
                <div class="text-[11px] text-surface-500 mb-0.5">
                  Nom
                </div>
                <div class="font-medium">
                  {{ selectedVenue.name }}
                </div>
              </div>
              <div>
                <div class="text-[11px] text-surface-500 mb-0.5">
                  Adresse
                </div>
                <div class="font-medium">
                  {{ selectedVenue.address }}
                </div>
              </div>
              <div v-if="selectedVenue.coordinates">
                <div class="text-[11px] text-surface-500 mb-0.5">
                  Coordonnées
                </div>
                <div class="font-medium num text-[12px]">
                  {{ formatCoord(selectedVenue.coordinates.latitude, selectedVenue.coordinates.longitude) }}
                </div>
              </div>
            </div>
          </div>

          <!-- Section courts -->
          <div class="card p-5 space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
                Courts
                <span class="ml-1 num text-surface-600 normal-case text-[12px]">({{ selectedCourts.length }})</span>
              </h3>
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                @click="openCreateCourtDialog"
              >
                <Plus
                  :size="14"
                  :stroke-width="2"
                />
                Ajouter un court
              </button>
            </div>

            <!-- Empty state courts -->
            <div
              v-if="selectedCourts.length === 0"
              class="py-6 text-center text-[12px] text-surface-500 border border-dashed border-surface-200 rounded-lg"
            >
              Aucun court configuré dans cette salle.
              <button
                type="button"
                class="ml-1 text-emerald-700 hover:underline font-medium"
                @click="openCreateCourtDialog"
              >
                Ajouter un court
              </button>
            </div>

            <!-- Grille courts -->
            <div
              v-else
              class="grid grid-cols-1 md:grid-cols-2 gap-3"
            >
              <div
                v-for="court in selectedCourts"
                :key="court.id"
                class="card p-4 space-y-3"
                :class="!court.active ? 'opacity-60' : ''"
              >
                <!-- Court header -->
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0 flex-1">
                    <div class="text-[13px] font-semibold truncate">
                      {{ court.name }}
                    </div>
                    <div class="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      <Pill :variant="courtSizeVariant(court.courtSize)">
                        {{ courtSizeLabel(court.courtSize) }}
                      </Pill>
                      <Pill variant="slate">
                        {{ court.sport }}
                      </Pill>
                      <Pill
                        v-if="court.isCombined"
                        variant="sky"
                      >
                        <Link2
                          :size="10"
                          :stroke-width="2"
                        />
                        Combiné
                      </Pill>
                      <Pill
                        v-if="!court.active"
                        variant="amber"
                      >
                        Inactif
                      </Pill>
                    </div>
                  </div>
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm !px-1.5 text-surface-500"
                    aria-label="Actions court"
                    @click="openCourtMenu($event, court)"
                  >
                    <MoreHorizontal
                      :size="14"
                      :stroke-width="2"
                    />
                  </button>
                </div>

                <!-- Courts liés (si combiné) -->
                <div
                  v-if="court.isCombined && court.combinedCourtIds.length > 0"
                  class="text-[11px] text-surface-500"
                >
                  <span class="font-medium">Comprend :</span>
                  {{ resolvedCombinedNames(court.combinedCourtIds).join(', ') }}
                </div>

                <!-- Switch actif -->
                <div class="flex items-center justify-between pt-1 border-t border-surface-100">
                  <span class="text-[12px] text-surface-600">
                    {{ court.active ? 'Actif' : 'Inactif' }}
                  </span>
                  <InputSwitch
                    :model-value="court.active"
                    @update:model-value="() => toggleActive(court)"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- Section fermetures ponctuelles -->
          <div class="card p-5 space-y-4">
            <h3 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
              Fermetures ponctuelles
            </h3>

            <!-- Liste des fermetures existantes -->
            <div
              v-if="selectedVenue.customClosures && selectedVenue.customClosures.length > 0"
              class="space-y-2"
            >
              <div
                v-for="(closure, idx) in selectedVenue.customClosures"
                :key="idx"
                class="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-surface-50 border border-surface-100 text-[13px]"
              >
                <div class="flex items-center gap-2 min-w-0">
                  <Calendar
                    :size="13"
                    :stroke-width="2"
                    class="text-surface-400 flex-shrink-0"
                  />
                  <span class="font-medium truncate">{{ closure.name }}</span>
                  <span class="text-surface-500 text-[12px] flex-shrink-0">
                    {{ formatTimestamp(closure.startDate) }} → {{ formatTimestamp(closure.endDate) }}
                  </span>
                </div>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm !px-1.5 text-surface-500 flex-shrink-0"
                  :aria-label="`Supprimer la fermeture ${closure.name}`"
                  @click="removeClosure(idx)"
                >
                  <X
                    :size="14"
                    :stroke-width="2"
                  />
                </button>
              </div>
            </div>
            <div
              v-else
              class="text-[12px] text-surface-400"
            >
              Aucune fermeture ponctuelle.
            </div>

            <!-- Formulaire ajout fermeture inline -->
            <div class="border-t border-surface-100 pt-4 space-y-3">
              <div class="text-[12px] font-medium text-surface-600">
                Ajouter une fermeture
              </div>
              <div class="grid grid-cols-3 gap-3">
                <label class="block">
                  <span class="text-[11px] text-surface-500">Nom</span>
                  <InputText
                    v-model="closureForm.name"
                    class="mt-1 w-full"
                    placeholder="Ex. Noël 2025"
                    :invalid="!!closureErrors.name"
                  />
                  <span
                    v-if="closureErrors.name"
                    class="text-[11px] text-rose-600 mt-0.5 block"
                  >
                    {{ closureErrors.name }}
                  </span>
                </label>
                <label class="block">
                  <span class="text-[11px] text-surface-500">Début</span>
                  <DatePicker
                    v-model="closureForm.startDate"
                    class="mt-1 w-full"
                    date-format="dd/mm/yy"
                    placeholder="jj/mm/aaaa"
                    :invalid="!!closureErrors.startDate"
                  />
                  <span
                    v-if="closureErrors.startDate"
                    class="text-[11px] text-rose-600 mt-0.5 block"
                  >
                    {{ closureErrors.startDate }}
                  </span>
                </label>
                <label class="block">
                  <span class="text-[11px] text-surface-500">Fin</span>
                  <DatePicker
                    v-model="closureForm.endDate"
                    class="mt-1 w-full"
                    date-format="dd/mm/yy"
                    placeholder="jj/mm/aaaa"
                    :invalid="!!closureErrors.endDate"
                  />
                  <span
                    v-if="closureErrors.endDate"
                    class="text-[11px] text-rose-600 mt-0.5 block"
                  >
                    {{ closureErrors.endDate }}
                  </span>
                </label>
              </div>
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                :disabled="submittingClosure"
                @click="submitAddClosure"
              >
                <Plus
                  :size="14"
                  :stroke-width="2"
                />
                <template v-if="submittingClosure">
                  Ajout…
                </template>
                <template v-else>
                  Ajouter
                </template>
              </button>
            </div>

            <!-- Note périodes club -->
            <p class="text-[11px] text-surface-400 flex items-start gap-1.5 border-t border-surface-100 pt-3 mt-2">
              <TriangleAlert
                :size="11"
                :stroke-width="2"
                class="flex-shrink-0 mt-0.5"
              />
              Les périodes de fermeture du club (vacances scolaires) se gèrent dans
              <span class="text-surface-400 cursor-not-allowed line-through">Settings → Closure periods</span>
              <span class="text-surface-400">(disponible prochainement).</span>
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- ================= Court card menu (popup, one instance) =================== -->
    <Menu
      id="court-card-menu"
      ref="courtMenuRef"
      :model="courtMenuItems"
      popup
    />

    <!-- ================= Dialog — Créer une salle =================== -->
    <Dialog
      v-model:visible="isCreateVenueOpen"
      modal
      :draggable="false"
      :style="{ width: '480px' }"
      header="Nouvelle salle"
    >
      <div class="space-y-4 pt-1">
        <label class="block">
          <span class="text-[12px] text-surface-600">Nom de la salle <span class="text-rose-500">*</span></span>
          <InputText
            v-model="createVenueForm.name"
            class="mt-1 w-full"
            placeholder="Ex. Salle du Collège"
            :invalid="!!createVenueErrors.name"
            @keyup.enter="submitCreateVenue"
          />
          <span
            v-if="createVenueErrors.name"
            class="text-[11px] text-rose-600 mt-1 block"
          >
            {{ createVenueErrors.name }}
          </span>
        </label>

        <label class="block">
          <span class="text-[12px] text-surface-600">Adresse <span class="text-rose-500">*</span></span>
          <InputText
            v-model="createVenueForm.address"
            class="mt-1 w-full"
            placeholder="Ex. Rue de l'École 12, 1000 Lausanne"
            :invalid="!!createVenueErrors.address"
          />
          <span
            v-if="createVenueErrors.address"
            class="text-[11px] text-rose-600 mt-1 block"
          >
            {{ createVenueErrors.address }}
          </span>
        </label>

        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-[12px] text-surface-600">Latitude</span>
            <InputNumber
              v-model="createVenueForm.latitude"
              :min="-90"
              :max="90"
              :max-fraction-digits="6"
              input-class="!w-full"
              class="mt-1 w-full"
              :invalid="!!createVenueErrors.latitude"
            />
            <span
              v-if="createVenueErrors.latitude"
              class="text-[11px] text-rose-600 mt-1 block"
            >
              {{ createVenueErrors.latitude }}
            </span>
          </label>

          <label class="block">
            <span class="text-[12px] text-surface-600">Longitude</span>
            <InputNumber
              v-model="createVenueForm.longitude"
              :min="-180"
              :max="180"
              :max-fraction-digits="6"
              input-class="!w-full"
              class="mt-1 w-full"
              :invalid="!!createVenueErrors.longitude"
            />
            <span
              v-if="createVenueErrors.longitude"
              class="text-[11px] text-rose-600 mt-1 block"
            >
              {{ createVenueErrors.longitude }}
            </span>
          </label>
        </div>
      </div>

      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="submittingVenue"
          @click="closeCreateVenueDialog"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="submittingVenue"
          @click="submitCreateVenue"
        >
          <Plus
            :size="14"
            :stroke-width="2"
          />
          <template v-if="submittingVenue">
            Création…
          </template>
          <template v-else>
            Créer la salle
          </template>
        </button>
      </template>
    </Dialog>

    <!-- ================= Dialog — Modifier une salle =================== -->
    <Dialog
      v-model:visible="isEditVenueOpen"
      modal
      :draggable="false"
      :style="{ width: '480px' }"
      header="Modifier la salle"
    >
      <div class="space-y-4 pt-1">
        <label class="block">
          <span class="text-[12px] text-surface-600">Nom de la salle <span class="text-rose-500">*</span></span>
          <InputText
            v-model="editVenueForm.name"
            class="mt-1 w-full"
            :invalid="!!editVenueErrors.name"
          />
          <span
            v-if="editVenueErrors.name"
            class="text-[11px] text-rose-600 mt-1 block"
          >
            {{ editVenueErrors.name }}
          </span>
        </label>

        <label class="block">
          <span class="text-[12px] text-surface-600">Adresse <span class="text-rose-500">*</span></span>
          <InputText
            v-model="editVenueForm.address"
            class="mt-1 w-full"
            :invalid="!!editVenueErrors.address"
          />
          <span
            v-if="editVenueErrors.address"
            class="text-[11px] text-rose-600 mt-1 block"
          >
            {{ editVenueErrors.address }}
          </span>
        </label>

        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-[12px] text-surface-600">Latitude</span>
            <InputNumber
              v-model="editVenueForm.latitude"
              :min="-90"
              :max="90"
              :max-fraction-digits="6"
              input-class="!w-full"
              class="mt-1 w-full"
              :invalid="!!editVenueErrors.latitude"
            />
            <span
              v-if="editVenueErrors.latitude"
              class="text-[11px] text-rose-600 mt-1 block"
            >
              {{ editVenueErrors.latitude }}
            </span>
          </label>

          <label class="block">
            <span class="text-[12px] text-surface-600">Longitude</span>
            <InputNumber
              v-model="editVenueForm.longitude"
              :min="-180"
              :max="180"
              :max-fraction-digits="6"
              input-class="!w-full"
              class="mt-1 w-full"
              :invalid="!!editVenueErrors.longitude"
            />
            <span
              v-if="editVenueErrors.longitude"
              class="text-[11px] text-rose-600 mt-1 block"
            >
              {{ editVenueErrors.longitude }}
            </span>
          </label>
        </div>
      </div>

      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="editingVenue"
          @click="closeEditVenueDialog"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="editingVenue"
          @click="submitEditVenue"
        >
          <Pencil
            :size="14"
            :stroke-width="2"
          />
          <template v-if="editingVenue">
            Enregistrement…
          </template>
          <template v-else>
            Enregistrer
          </template>
        </button>
      </template>
    </Dialog>

    <!-- ================= Dialog — Confirmation suppression salle =================== -->
    <Dialog
      v-model:visible="isDeleteVenueOpen"
      modal
      :draggable="false"
      :style="{ width: '440px' }"
      header="Supprimer la salle"
    >
      <div class="pt-1 space-y-3">
        <div class="flex items-start gap-3 p-3 rounded-lg bg-rose-50 border border-rose-200">
          <TriangleAlert
            :size="16"
            :stroke-width="2"
            class="text-rose-600 flex-shrink-0 mt-0.5"
          />
          <div class="text-[13px] text-rose-700">
            <strong>Cette action est irréversible.</strong> Les courts associés deviendront orphelins et ne seront plus disponibles pour la planification.
          </div>
        </div>
        <p
          v-if="selectedVenue"
          class="text-[13px] text-surface-600"
        >
          Confirmer la suppression de <strong>{{ selectedVenue.name }}</strong> ?
        </p>
      </div>

      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="confirmingDeleteVenue"
          @click="closeDeleteVenueConfirm"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-sm border border-rose-300 bg-rose-600 text-white hover:bg-rose-700 transition-colors"
          :disabled="confirmingDeleteVenue"
          @click="confirmDeleteVenue"
        >
          <Trash2
            :size="14"
            :stroke-width="2"
          />
          <template v-if="confirmingDeleteVenue">
            Suppression…
          </template>
          <template v-else>
            Supprimer
          </template>
        </button>
      </template>
    </Dialog>

    <!-- ================= Dialog — Créer un court =================== -->
    <Dialog
      v-model:visible="isCreateCourtOpen"
      modal
      :draggable="false"
      :style="{ width: '480px' }"
      header="Ajouter un court"
    >
      <div class="space-y-4 pt-1">
        <label class="block">
          <span class="text-[12px] text-surface-600">Nom du court <span class="text-rose-500">*</span></span>
          <InputText
            v-model="courtForm.name"
            class="mt-1 w-full"
            placeholder="Ex. Court A"
            :invalid="!!courtErrors.name"
          />
          <span
            v-if="courtErrors.name"
            class="text-[11px] text-rose-600 mt-1 block"
          >
            {{ courtErrors.name }}
          </span>
        </label>

        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-[12px] text-surface-600">Taille</span>
            <Select
              v-model="courtForm.courtSize"
              :options="[...COURT_SIZE_OPTIONS]"
              option-label="label"
              option-value="value"
              class="mt-1 w-full"
            />
          </label>

          <label class="block">
            <span class="text-[12px] text-surface-600">Sport</span>
            <InputText
              v-model="courtForm.sport"
              class="mt-1 w-full"
              placeholder="Ex. basketball"
            />
          </label>
        </div>

        <div class="flex items-center justify-between py-2 border border-surface-100 rounded-lg px-3">
          <div>
            <div class="text-[13px] font-medium">
              Court combiné
            </div>
            <div class="text-[11px] text-surface-500 mt-0.5">
              Ce court regroupe plusieurs petits courts
            </div>
          </div>
          <InputSwitch v-model="courtForm.isCombined" />
        </div>

        <label
          v-if="courtForm.isCombined"
          class="block"
        >
          <span class="text-[12px] text-surface-600">Courts inclus</span>
          <MultiSelect
            v-model="courtForm.combinedCourtIds"
            :options="combinedCourtOptions"
            option-label="name"
            option-value="id"
            placeholder="Sélectionner les courts…"
            class="mt-1 w-full"
            :empty-message="'Aucun autre court dans cette salle'"
          />
        </label>
      </div>

      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="submittingCourt"
          @click="closeCreateCourtDialog"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="submittingCourt"
          @click="submitCreateCourt"
        >
          <Plus
            :size="14"
            :stroke-width="2"
          />
          <template v-if="submittingCourt">
            Ajout…
          </template>
          <template v-else>
            Ajouter le court
          </template>
        </button>
      </template>
    </Dialog>

    <!-- ================= Dialog — Modifier un court =================== -->
    <Dialog
      v-model:visible="isEditCourtOpen"
      modal
      :draggable="false"
      :style="{ width: '480px' }"
      header="Modifier le court"
    >
      <div class="space-y-4 pt-1">
        <label class="block">
          <span class="text-[12px] text-surface-600">Nom du court <span class="text-rose-500">*</span></span>
          <InputText
            v-model="courtForm.name"
            class="mt-1 w-full"
            :invalid="!!courtErrors.name"
          />
          <span
            v-if="courtErrors.name"
            class="text-[11px] text-rose-600 mt-1 block"
          >
            {{ courtErrors.name }}
          </span>
        </label>

        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-[12px] text-surface-600">Taille</span>
            <Select
              v-model="courtForm.courtSize"
              :options="[...COURT_SIZE_OPTIONS]"
              option-label="label"
              option-value="value"
              class="mt-1 w-full"
            />
          </label>

          <label class="block">
            <span class="text-[12px] text-surface-600">Sport</span>
            <InputText
              v-model="courtForm.sport"
              class="mt-1 w-full"
            />
          </label>
        </div>

        <div class="flex items-center justify-between py-2 border border-surface-100 rounded-lg px-3">
          <div>
            <div class="text-[13px] font-medium">
              Court combiné
            </div>
            <div class="text-[11px] text-surface-500 mt-0.5">
              Ce court regroupe plusieurs petits courts
            </div>
          </div>
          <InputSwitch v-model="courtForm.isCombined" />
        </div>

        <label
          v-if="courtForm.isCombined"
          class="block"
        >
          <span class="text-[12px] text-surface-600">Courts inclus</span>
          <MultiSelect
            v-model="courtForm.combinedCourtIds"
            :options="combinedCourtOptions"
            option-label="name"
            option-value="id"
            placeholder="Sélectionner les courts…"
            class="mt-1 w-full"
            :empty-message="'Aucun autre court dans cette salle'"
          />
        </label>

        <div class="flex items-center justify-between py-2 border border-surface-100 rounded-lg px-3">
          <div>
            <div class="text-[13px] font-medium">
              Court actif
            </div>
            <div class="text-[11px] text-surface-500 mt-0.5">
              Un court inactif n'est plus proposé à la réservation
            </div>
          </div>
          <InputSwitch v-model="courtForm.active" />
        </div>
      </div>

      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="editingCourtSaving"
          @click="closeEditCourtDialog"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="editingCourtSaving"
          @click="submitEditCourt"
        >
          <Pencil
            :size="14"
            :stroke-width="2"
          />
          <template v-if="editingCourtSaving">
            Enregistrement…
          </template>
          <template v-else>
            Enregistrer
          </template>
        </button>
      </template>
    </Dialog>

    <!-- ================= Dialog — Confirmation suppression court =================== -->
    <Dialog
      v-model:visible="isDeleteCourtOpen"
      modal
      :draggable="false"
      :style="{ width: '400px' }"
      header="Supprimer le court"
    >
      <div class="pt-1 space-y-3">
        <p
          v-if="deletingCourt"
          class="text-[13px] text-surface-600"
        >
          Confirmer la suppression du court <strong>{{ deletingCourt.name }}</strong> ?
          Cette action est irréversible.
        </p>
      </div>

      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="confirmingDeleteCourt"
          @click="closeDeleteCourtConfirm"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-sm border border-rose-300 bg-rose-600 text-white hover:bg-rose-700 transition-colors"
          :disabled="confirmingDeleteCourt"
          @click="confirmDeleteCourt"
        >
          <Trash2
            :size="14"
            :stroke-width="2"
          />
          <template v-if="confirmingDeleteCourt">
            Suppression…
          </template>
          <template v-else>
            Supprimer
          </template>
        </button>
      </template>
    </Dialog>
  </section>
</template>
