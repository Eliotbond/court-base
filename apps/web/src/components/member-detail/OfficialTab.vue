<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  Award,
  CheckCircle2,
  Clock,
  Info,
  Plus,
  ShieldCheck,
  TriangleAlert,
  Trophy,
  XCircle,
} from 'lucide-vue-next'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Dialog from 'primevue/dialog'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import Pill from '@/components/ui/Pill.vue'
import { useAuthStore } from '@/stores/auth'
import { useMemberDetailStore } from '@/stores/memberDetail'
import { useLicensesStore } from '@/stores/licenses'
import { useLicenseTypesStore } from '@/stores/licenseTypes'
import { useSeasonsStore } from '@/stores/seasons'
import { useMemberOfficialAssignments } from '@/composables/useMemberOfficialAssignments'
import type { MemberDetailRow } from '@/repositories/members.repo'
import type { OfficialAssignmentRow } from '@/repositories/officialAssignments.repo'
import type {
  License,
  LicenseStatus,
  OfficialAssignmentStatus,
} from '@club-app/shared-types'

const props = defineProps<{
  memberId: string
  member: MemberDetailRow | null
  canEdit: boolean
}>()

const store = useMemberDetailStore()
const auth = useAuthStore()
const licensesStore = useLicensesStore()
const licenseTypesStore = useLicenseTypesStore()
const seasonsStore = useSeasonsStore()

// ---------------------------------------------------------------------------
// Composable — assignments + officialsConfig + dérivés (rentabilité officiel)
// ---------------------------------------------------------------------------
const memberIdRef = computed(() => props.memberId)
const {
  assignments,
  loading,
  error,
  officialsConfig,
  totals,
  rentabilityScore,
  load,
} = useMemberOfficialAssignments(memberIdRef)

const isOfficial = computed(
  () =>
    props.member?.officialLevel !== null &&
    props.member?.officialLevel !== undefined,
)

onMounted(() => {
  if (isOfficial.value) void load()
  // Référentiels nécessaires aux dialogs (idempotent — load() reset le state).
  void licensesStore.load(props.memberId)
  if (licenseTypesStore.licenseTypes.length === 0) void licenseTypesStore.load()
  if (seasonsStore.seasons.length === 0) void seasonsStore.load()
})

// Si l'admin promeut le membre en officiel pendant la session, refetch.
watch(isOfficial, (now, before) => {
  if (now && !before) void load()
})

// Recharge les licences si on change de membre (tab monté pour un autre id).
watch(memberIdRef, (id) => {
  void licensesStore.load(id)
})

// ---------------------------------------------------------------------------
// Détection "index manquant" — bannière info plutôt qu'erreur sèche.
// ---------------------------------------------------------------------------
const isIndexMissing = computed(() => {
  const msg = error.value?.toLowerCase() ?? ''
  return msg.includes('index') || msg.includes('failed-precondition')
})

// ---------------------------------------------------------------------------
// Rôle : qui peut confirmer une licence (génère l'écriture comptable).
// treasurer / admin / secretary / rootAdmin.
// ---------------------------------------------------------------------------
const canConfirmLicense = computed(() => {
  if (auth.rootAdmin) return true
  const roles = auth.userDoc?.roles ?? []
  return (
    roles.includes('treasurer') ||
    roles.includes('admin') ||
    roles.includes('secretary')
  )
})

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------
const chfFormatter = new Intl.NumberFormat('fr-CH', {
  style: 'currency',
  currency: 'CHF',
  maximumFractionDigits: 0,
})

function formatDate(date: Date | null): string {
  if (!date) return '—'
  return date.toLocaleDateString('fr-CH', { day: '2-digit', month: 'short' })
}

function formatSlot(row: OfficialAssignmentRow): string {
  if (!row.bookingStartTime || !row.bookingEndTime) return '—'
  return `${row.bookingStartTime}–${row.bookingEndTime}`
}

// ---------------------------------------------------------------------------
// Status pill mapping — assignations
// ---------------------------------------------------------------------------
type StatusVariant = 'emerald' | 'slate' | 'rose'
interface StatusDef {
  variant: StatusVariant
  label: string
}

function statusDef(status: OfficialAssignmentStatus): StatusDef {
  switch (status) {
    case 'confirmed':
      return { variant: 'emerald', label: 'Confirmé' }
    case 'declined':
      return { variant: 'rose', label: 'Décliné' }
    case 'pending':
    default:
      return { variant: 'slate', label: 'En attente' }
  }
}

// ---------------------------------------------------------------------------
// Niveaux officiel / coach — qualifications numériques 1..N, réglées par
// l'admin. Édition via dialog (InputNumber). `null` = retirer la qualification.
// ---------------------------------------------------------------------------
type LevelKind = 'official' | 'coach'

const isLevelDialogOpen = ref(false)
const levelDialogKind = ref<LevelKind>('official')
/** Valeur saisie dans le dialog. `null` = retirer la qualification. */
const levelDraft = ref<number | null>(1)
const levelError = ref<string | null>(null)

const levelDialogTitle = computed(() =>
  levelDialogKind.value === 'official'
    ? 'Niveau officiel'
    : 'Niveau coach',
)

function openLevelDialog(kind: LevelKind): void {
  levelDialogKind.value = kind
  const current =
    kind === 'official'
      ? props.member?.officialLevel ?? null
      : props.member?.coachLevel ?? null
  levelDraft.value = current ?? 1
  levelError.value = null
  isLevelDialogOpen.value = true
}

async function submitLevel(remove = false): Promise<void> {
  levelError.value = null
  const value = remove ? null : levelDraft.value
  if (!remove && (value === null || value < 1)) {
    levelError.value = 'Le niveau doit être un entier ≥ 1.'
    return
  }
  if (levelDialogKind.value === 'official') {
    await store.applyProfilePatch({ officialLevel: value })
  } else {
    await store.applyProfilePatch({ coachLevel: value })
  }
  if (store.error) {
    levelError.value = store.error
    return
  }
  isLevelDialogOpen.value = false
}

// ---------------------------------------------------------------------------
// Badges dérivés "Officiel actif" / "Coach actif" — vrai si la réf
// dénormalisée cible la saison active.
// ---------------------------------------------------------------------------
const activeSeasonId = computed(() => seasonsStore.activeSeason?.id ?? null)

const isOfficialActive = computed(() => {
  const ref_ = props.member?.officialLicense ?? null
  return ref_ !== null && ref_.seasonId === activeSeasonId.value
})

const isCoachActive = computed(() => {
  const ref_ = props.member?.coachLicense ?? null
  return ref_ !== null && ref_.seasonId === activeSeasonId.value
})

// ---------------------------------------------------------------------------
// Licences — liste + statut + libellés
// ---------------------------------------------------------------------------
function licenseStatusDef(status: LicenseStatus): {
  variant: 'amber' | 'emerald' | 'slate'
  label: string
} {
  switch (status) {
    case 'active':
      return { variant: 'emerald', label: 'Active' }
    case 'cancelled':
      return { variant: 'slate', label: 'Annulée' }
    case 'pending':
    default:
      return { variant: 'amber', label: 'En attente' }
  }
}

function seasonLabel(seasonId: string): string {
  return seasonsStore.getById(seasonId)?.name ?? seasonId
}

// ---------------------------------------------------------------------------
// Création d'une licence — dialog
// ---------------------------------------------------------------------------
const isCreateLicenseOpen = ref(false)
const createForm = ref<{ licenseTypeId: string | null; seasonId: string | null }>({
  licenseTypeId: null,
  seasonId: null,
})
const createError = ref<string | null>(null)

/** Types de licence actifs — options du Select. */
const licenseTypeOptions = computed(() =>
  licenseTypesStore.activeLicenseTypes.map((t) => ({
    value: t.id,
    label: `${t.name} · ${chfFormatter.format(t.fee)}`,
  })),
)

/** Saisons — options du Select (active pré-sélectionnée). */
const seasonOptions = computed(() =>
  seasonsStore.seasons.map((s) => ({
    value: s.id,
    label: s.status === 'active' ? `${s.name} (active)` : s.name,
  })),
)

function openCreateLicenseDialog(): void {
  createForm.value = {
    licenseTypeId: null,
    seasonId: activeSeasonId.value,
  }
  createError.value = null
  isCreateLicenseOpen.value = true
}

async function submitCreateLicense(): Promise<void> {
  createError.value = null
  const { licenseTypeId, seasonId } = createForm.value
  if (!licenseTypeId) {
    createError.value = 'Sélectionnez un type de licence.'
    return
  }
  if (!seasonId) {
    createError.value = 'Sélectionnez une saison.'
    return
  }
  const id = await licensesStore.create({
    memberId: props.memberId,
    seasonId,
    licenseTypeId,
  })
  if (!id) {
    createError.value = licensesStore.error ?? 'Erreur lors de la création.'
    return
  }
  isCreateLicenseOpen.value = false
}

// ---------------------------------------------------------------------------
// Confirmation d'une licence — dialog
// ---------------------------------------------------------------------------
const isConfirmLicenseOpen = ref(false)
const licenseToConfirm = ref<License | null>(null)
const confirmError = ref<string | null>(null)

function openConfirmLicenseDialog(license: License): void {
  licenseToConfirm.value = license
  confirmError.value = null
  isConfirmLicenseOpen.value = true
}

async function submitConfirmLicense(): Promise<void> {
  if (!licenseToConfirm.value) return
  confirmError.value = null
  const ok = await licensesStore.confirm(licenseToConfirm.value.id)
  if (!ok) {
    confirmError.value = licensesStore.error ?? 'Erreur lors de la confirmation.'
    return
  }
  isConfirmLicenseOpen.value = false
  licenseToConfirm.value = null
  // Recharge le membre : `confirmLicense` a dénormalisé officialLicense /
  // coachLicense côté serveur — il faut réconcilier les badges "actif".
  await store.load(props.memberId)
}
</script>

<template>
  <div class="space-y-4">
    <!-- ============================================================
         Niveaux officiel & coach (qualifications)
         ============================================================ -->
    <div class="card p-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-[14px] font-semibold">
          Qualifications
        </h2>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- Niveau officiel -->
        <div class="border border-surface-200 rounded-md p-4 space-y-3">
          <div class="flex items-center gap-2">
            <ShieldCheck
              :size="16"
              :stroke-width="2"
              class="text-surface-500"
            />
            <span class="text-[13px] font-medium">Officiel</span>
            <Pill
              v-if="isOfficialActive"
              variant="emerald"
              class="ml-auto"
            >
              Officiel actif
            </Pill>
          </div>
          <div class="flex items-center gap-2">
            <template v-if="props.member?.officialLevel !== null && props.member?.officialLevel !== undefined">
              <Pill
                variant="emerald"
                class="num"
              >
                Niveau {{ props.member?.officialLevel }}
              </Pill>
              <span class="text-[12px] text-surface-500">qualification</span>
            </template>
            <span
              v-else
              class="text-[12px] text-surface-400"
            >
              Pas de qualification officiel
            </span>
          </div>
          <button
            v-if="canEdit"
            type="button"
            class="btn btn-secondary btn-sm"
            :disabled="store.saving"
            @click="openLevelDialog('official')"
          >
            <Award
              :size="13"
              :stroke-width="2"
            />
            {{ props.member?.officialLevel != null ? 'Modifier le niveau' : 'Définir un niveau' }}
          </button>
        </div>

        <!-- Niveau coach -->
        <div class="border border-surface-200 rounded-md p-4 space-y-3">
          <div class="flex items-center gap-2">
            <Trophy
              :size="16"
              :stroke-width="2"
              class="text-surface-500"
            />
            <span class="text-[13px] font-medium">Coach</span>
            <Pill
              v-if="isCoachActive"
              variant="emerald"
              class="ml-auto"
            >
              Coach actif
            </Pill>
          </div>
          <div class="flex items-center gap-2">
            <template v-if="props.member?.coachLevel !== null && props.member?.coachLevel !== undefined">
              <Pill
                variant="emerald"
                class="num"
              >
                Niveau {{ props.member?.coachLevel }}
              </Pill>
              <span class="text-[12px] text-surface-500">qualification</span>
            </template>
            <span
              v-else
              class="text-[12px] text-surface-400"
            >
              Pas de qualification coach
            </span>
          </div>
          <button
            v-if="canEdit"
            type="button"
            class="btn btn-secondary btn-sm"
            :disabled="store.saving"
            @click="openLevelDialog('coach')"
          >
            <Award
              :size="13"
              :stroke-width="2"
            />
            {{ props.member?.coachLevel != null ? 'Modifier le niveau' : 'Définir un niveau' }}
          </button>
        </div>
      </div>

      <p class="mt-4 pt-3 border-t border-surface-100 flex items-start gap-2 text-[11px] text-surface-500 leading-relaxed">
        <Info
          :size="12"
          :stroke-width="2"
          class="text-surface-400 mt-0.5 shrink-0"
        />
        <span>
          Le <strong>niveau</strong> est une qualification (ce pour quoi le membre
          est formé). Être <strong>actif</strong> dépend d'une licence confirmée
          pour la saison courante — voir la section Licences ci-dessous.
        </span>
      </p>
    </div>

    <!-- ============================================================
         Licences
         ============================================================ -->
    <div class="card overflow-hidden">
      <div class="px-5 py-3 border-b border-surface-100 flex items-center justify-between">
        <h2 class="text-[14px] font-semibold">
          Licences
        </h2>
        <button
          v-if="canEdit"
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="licensesStore.creating"
          @click="openCreateLicenseDialog"
        >
          <Plus
            :size="13"
            :stroke-width="2"
          />
          Créer une licence
        </button>
      </div>

      <!-- Error banner -->
      <div
        v-if="licensesStore.error"
        class="m-4 card border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700 flex items-start gap-2"
      >
        <TriangleAlert
          :size="14"
          :stroke-width="2"
          class="mt-0.5 shrink-0"
        />
        <div class="flex-1">
          {{ licensesStore.error }}
        </div>
      </div>

      <!-- Empty -->
      <div
        v-if="!licensesStore.loading && licensesStore.licenses.length === 0"
        class="p-8 text-center text-[13px] text-surface-500"
      >
        Aucune licence émise pour ce membre.
      </div>

      <!-- Liste -->
      <DataTable
        v-else-if="licensesStore.licenses.length > 0"
        :value="licensesStore.licenses"
        data-key="id"
        :row-hover="true"
        striped-rows
        class="text-[13px]"
      >
        <Column header="Type">
          <template #body="{ data }: { data: License }">
            <span class="font-medium">{{ data.licenseName }}</span>
            <span
              v-if="data.level !== null"
              class="text-surface-400 ml-1 num"
            >· N{{ data.level }}</span>
          </template>
        </Column>

        <Column header="Saison">
          <template #body="{ data }: { data: License }">
            {{ seasonLabel(data.seasonId) }}
          </template>
        </Column>

        <Column header="Montant">
          <template #body="{ data }: { data: License }">
            <span class="num">{{ chfFormatter.format(data.feeSnapshot) }}</span>
          </template>
        </Column>

        <Column header="Statut">
          <template #body="{ data }: { data: License }">
            <Pill :variant="licenseStatusDef(data.status).variant">
              {{ licenseStatusDef(data.status).label }}
            </Pill>
          </template>
        </Column>

        <Column
          header=""
          class="text-right"
        >
          <template #body="{ data }: { data: License }">
            <button
              v-if="data.status === 'pending' && canConfirmLicense"
              type="button"
              class="btn btn-secondary btn-sm"
              :disabled="licensesStore.confirmingId === data.id"
              @click="openConfirmLicenseDialog(data)"
            >
              <CheckCircle2
                :size="13"
                :stroke-width="2"
              />
              {{ licensesStore.confirmingId === data.id ? 'Confirmation…' : 'Confirmer' }}
            </button>
          </template>
        </Column>
      </DataTable>
    </div>

    <!-- ============================================================
         Rentabilité officiel — affichée si le membre est officiel.
         ============================================================ -->
    <div
      v-if="!isOfficial"
      class="card p-6 flex flex-col items-center text-center gap-2"
    >
      <ShieldCheck
        :size="28"
        :stroke-width="1.5"
        class="text-surface-400"
      />
      <p class="text-[12px] text-surface-500 max-w-md">
        Définissez un niveau officiel pour assigner des matches à ce membre et
        suivre sa rentabilité.
      </p>
    </div>

    <div
      v-else
      class="space-y-4"
    >
      <!-- Header card rentabilité -->
      <div class="card p-5">
        <div class="flex items-start gap-4 flex-wrap">
          <div class="space-y-1">
            <div class="text-[11px] uppercase tracking-wide text-surface-500">
              Coût licence
            </div>
            <div class="text-[15px] font-semibold tracking-tight num">
              {{ chfFormatter.format(officialsConfig.licenseFee) }}
              <span class="text-[11px] text-surface-500 font-normal">
                / saison
              </span>
            </div>
          </div>

          <div class="space-y-1 ml-auto">
            <div class="text-[11px] uppercase tracking-wide text-surface-500">
              Rentabilité (12 derniers mois)
            </div>
            <div class="flex items-center gap-2">
              <Pill :variant="rentabilityScore.variant">
                {{ rentabilityScore.label }}
              </Pill>
              <span class="text-[13px] text-surface-700 num">
                {{ rentabilityScore.matches }}
                <span class="text-surface-400">/ {{ officialsConfig.thresholdGreen }}</span>
                <span class="text-surface-500"> matches confirmés</span>
              </span>
            </div>
          </div>
        </div>

        <div class="mt-4 pt-3 border-t border-surface-100 flex items-start gap-2">
          <Info
            :size="12"
            :stroke-width="2"
            class="text-surface-400 mt-0.5 shrink-0"
          />
          <p class="text-[11px] text-surface-500 leading-relaxed">
            <span class="text-emerald-700 font-medium">Rentable</span>
            : ≥ {{ officialsConfig.thresholdGreen }} matches confirmés ·
            <span class="text-amber-700 font-medium">Faible</span>
            : ≥ {{ officialsConfig.thresholdOrange }} ·
            <span class="text-rose-700 font-medium">Critique</span>
            : &lt; {{ officialsConfig.thresholdOrange }}. Seuils configurés dans
            <code class="font-mono text-[10px] text-surface-600">Settings → Officials</code>.
          </p>
        </div>
      </div>

      <!-- Stats compactes -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div class="card p-4">
          <div class="text-[11px] uppercase tracking-wide text-surface-500">
            Total
          </div>
          <div class="text-[18px] font-semibold tracking-tight num">
            {{ totals.total }}
          </div>
        </div>
        <div class="card p-4">
          <div class="text-[11px] uppercase tracking-wide text-surface-500 flex items-center gap-1">
            <CheckCircle2
              :size="11"
              :stroke-width="2"
              class="text-emerald-600"
            />
            Confirmés
          </div>
          <div class="text-[18px] font-semibold tracking-tight num text-emerald-700">
            {{ totals.confirmed }}
          </div>
        </div>
        <div class="card p-4">
          <div class="text-[11px] uppercase tracking-wide text-surface-500 flex items-center gap-1">
            <Clock
              :size="11"
              :stroke-width="2"
              class="text-slate-500"
            />
            En attente
          </div>
          <div class="text-[18px] font-semibold tracking-tight num text-surface-700">
            {{ totals.pending }}
          </div>
        </div>
        <div class="card p-4">
          <div class="text-[11px] uppercase tracking-wide text-surface-500 flex items-center gap-1">
            <XCircle
              :size="11"
              :stroke-width="2"
              class="text-rose-600"
            />
            Déclinés
          </div>
          <div class="text-[18px] font-semibold tracking-tight num text-rose-700">
            {{ totals.declined }}
          </div>
        </div>
      </div>

      <!-- Index missing banner -->
      <div
        v-if="isIndexMissing"
        class="card border-sky-200 bg-sky-50 px-4 py-3 text-[13px] text-sky-800 flex items-start gap-2"
      >
        <Info
          :size="14"
          :stroke-width="2"
          class="mt-0.5 shrink-0"
        />
        <div class="flex-1">
          <div class="font-medium">
            Index Firestore manquant
          </div>
          <div class="text-[12px] mt-0.5">
            La query collectionGroup nécessite un index composite
            (<code class="font-mono">officialAssignments.memberId + assignedAt</code>).
            Demande à un admin technique d'ajouter l'index dans
            <code class="font-mono">firestore.indexes.json</code>.
          </div>
        </div>
      </div>

      <!-- Error banner (autre) -->
      <div
        v-else-if="error"
        class="card border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700 flex items-start gap-2"
      >
        <TriangleAlert
          :size="14"
          :stroke-width="2"
          class="mt-0.5 shrink-0"
        />
        <div class="flex-1">
          <div class="font-medium">
            Erreur de chargement
          </div>
          <div class="text-[12px] mt-0.5">
            {{ error }}
          </div>
        </div>
      </div>

      <!-- Liste assignations -->
      <div class="card overflow-hidden">
        <div class="px-5 py-3 border-b border-surface-100 flex items-center justify-between">
          <h2 class="text-[14px] font-semibold">
            Assignations
          </h2>
          <span
            v-if="loading"
            class="text-[12px] text-surface-500"
          >
            Chargement…
          </span>
        </div>

        <div
          v-if="!loading && assignments.length === 0 && !error"
          class="p-8 text-center text-[13px] text-surface-500"
        >
          Aucune assignation pour le moment.
        </div>

        <DataTable
          v-else-if="assignments.length > 0"
          :value="assignments"
          data-key="id"
          :row-hover="true"
          striped-rows
          class="text-[13px]"
        >
          <Column
            field="bookingDate"
            header="Date"
            :sortable="true"
          >
            <template #body="{ data }: { data: OfficialAssignmentRow }">
              {{ formatDate(data.bookingDate) }}
            </template>
          </Column>

          <Column
            field="teamName"
            header="Équipe"
          >
            <template #body="{ data }: { data: OfficialAssignmentRow }">
              <span v-if="data.teamName">{{ data.teamName }}</span>
              <span
                v-else
                class="text-surface-400"
              >—</span>
            </template>
          </Column>

          <Column header="Slot">
            <template #body="{ data }: { data: OfficialAssignmentRow }">
              <span class="font-mono text-[12px] text-surface-600">
                {{ formatSlot(data) }}
              </span>
            </template>
          </Column>

          <Column
            field="status"
            header="Statut"
          >
            <template #body="{ data }: { data: OfficialAssignmentRow }">
              <Pill :variant="statusDef(data.status).variant">
                {{ statusDef(data.status).label }}
              </Pill>
            </template>
          </Column>

          <Column
            field="seasonId"
            header="Saison"
          >
            <template #body="{ data }: { data: OfficialAssignmentRow }">
              <span
                v-if="data.seasonId"
                class="font-mono text-[11px] text-surface-500"
              >
                {{ data.seasonId }}
              </span>
              <span
                v-else
                class="text-surface-400"
              >—</span>
            </template>
          </Column>
        </DataTable>
      </div>
    </div>
  </div>

  <!-- ============================================================
       Dialog — niveau officiel / coach
       ============================================================ -->
  <Dialog
    v-model:visible="isLevelDialogOpen"
    modal
    :draggable="false"
    :style="{ width: '420px' }"
    :header="levelDialogTitle"
  >
    <div class="space-y-4 pt-1">
      <p class="text-[13px] text-surface-600">
        Niveau de qualification pour
        <strong>{{ props.member?.firstName }} {{ props.member?.lastName }}</strong>.
        C'est un entier 1..N réglé manuellement. Indépendant du fait d'être actif
        (qui dépend d'une licence confirmée).
      </p>

      <label class="block">
        <span class="text-[12px] text-surface-600">Niveau</span>
        <InputNumber
          v-model="levelDraft"
          :min="1"
          :max="20"
          :max-fraction-digits="0"
          show-buttons
          input-class="!w-full"
          class="mt-1 w-full"
        />
      </label>

      <p
        v-if="levelError"
        class="text-[12px] text-rose-600"
      >
        {{ levelError }}
      </p>
    </div>

    <template #footer>
      <button
        type="button"
        class="btn btn-ghost btn-sm !text-rose-600 mr-auto"
        :disabled="store.saving"
        @click="submitLevel(true)"
      >
        Retirer le niveau
      </button>
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        @click="isLevelDialogOpen = false"
      >
        Annuler
      </button>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        :disabled="store.saving"
        @click="submitLevel(false)"
      >
        {{ store.saving ? 'Enregistrement…' : 'Enregistrer' }}
      </button>
    </template>
  </Dialog>

  <!-- ============================================================
       Dialog — créer une licence
       ============================================================ -->
  <Dialog
    v-model:visible="isCreateLicenseOpen"
    modal
    :draggable="false"
    :style="{ width: '460px' }"
    header="Créer une licence"
  >
    <div class="space-y-4 pt-1">
      <p class="text-[13px] text-surface-600">
        La licence est créée en statut <strong>En attente</strong>. Sa
        confirmation (par le comité) génère l'écriture comptable de la charge.
      </p>

      <label class="block">
        <span class="text-[12px] text-surface-600">Type de licence</span>
        <Select
          v-model="createForm.licenseTypeId"
          :options="licenseTypeOptions"
          option-label="label"
          option-value="value"
          placeholder="Sélectionner un type"
          class="mt-1 w-full"
        />
        <span
          v-if="licenseTypeOptions.length === 0"
          class="text-[11px] text-amber-600 mt-1 block"
        >
          Aucun type de licence actif — créez-en un dans Settings.
        </span>
      </label>

      <label class="block">
        <span class="text-[12px] text-surface-600">Saison</span>
        <Select
          v-model="createForm.seasonId"
          :options="seasonOptions"
          option-label="label"
          option-value="value"
          placeholder="Sélectionner une saison"
          class="mt-1 w-full"
        />
      </label>

      <p
        v-if="createError"
        class="text-[12px] text-rose-600"
      >
        {{ createError }}
      </p>
    </div>

    <template #footer>
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        @click="isCreateLicenseOpen = false"
      >
        Annuler
      </button>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        :disabled="licensesStore.creating"
        @click="submitCreateLicense"
      >
        {{ licensesStore.creating ? 'Création…' : 'Créer' }}
      </button>
    </template>
  </Dialog>

  <!-- ============================================================
       Dialog — confirmer une licence
       ============================================================ -->
  <Dialog
    v-model:visible="isConfirmLicenseOpen"
    modal
    :draggable="false"
    :style="{ width: '460px' }"
    header="Confirmer la licence"
  >
    <div
      v-if="licenseToConfirm"
      class="space-y-4 pt-1"
    >
      <p class="text-[13px] text-surface-600">
        Confirmer la licence
        <strong>{{ licenseToConfirm.licenseName }}</strong>
        ({{ seasonLabel(licenseToConfirm.seasonId) }}) ?
      </p>

      <div class="card border-sky-200 bg-sky-50 px-4 py-3 text-[12px] text-sky-800 flex items-start gap-2">
        <Info
          :size="14"
          :stroke-width="2"
          class="mt-0.5 shrink-0"
        />
        <div>
          La confirmation passe la licence en <strong>Active</strong> et
          <strong>génère l'écriture comptable de la charge</strong>
          ({{ chfFormatter.format(licenseToConfirm.feeSnapshot) }} — débit
          « Licences fédérales », crédit trésorerie). Le membre devient officiel
          / coach actif pour la saison.
        </div>
      </div>

      <p
        v-if="confirmError"
        class="text-[12px] text-rose-600"
      >
        {{ confirmError }}
      </p>
    </div>

    <template #footer>
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        @click="isConfirmLicenseOpen = false"
      >
        Annuler
      </button>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        :disabled="!!licensesStore.confirmingId"
        @click="submitConfirmLicense"
      >
        {{ licensesStore.confirmingId ? 'Confirmation…' : 'Confirmer' }}
      </button>
    </template>
  </Dialog>
</template>
