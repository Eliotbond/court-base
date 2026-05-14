<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  Award,
  CheckCircle2,
  Clock,
  Info,
  ShieldCheck,
  TriangleAlert,
  XCircle,
} from 'lucide-vue-next'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Dialog from 'primevue/dialog'
import RadioButton from 'primevue/radiobutton'
import Pill from '@/components/ui/Pill.vue'
import { useMemberDetailStore } from '@/stores/memberDetail'
import { useMemberOfficialAssignments } from '@/composables/useMemberOfficialAssignments'
import type { MemberDetailRow } from '@/repositories/members.repo'
import type { OfficialAssignmentRow } from '@/repositories/officialAssignments.repo'
import type { OfficialAssignmentStatus } from '@club-app/shared-types'

const props = defineProps<{
  memberId: string
  member: MemberDetailRow | null
  canEdit: boolean
}>()

const store = useMemberDetailStore()

// ---------------------------------------------------------------------------
// Composable — assignments + officialsConfig + dérivés
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
})

// Si l'admin promeut le membre en officiel pendant la session, refetch.
watch(isOfficial, (now, before) => {
  if (now && !before) void load()
})

// ---------------------------------------------------------------------------
// Détection "index manquant" — pour afficher une bannière info plutôt qu'une
// erreur sèche. Le repo log déjà côté console ; ici on infère depuis le
// message d'erreur exposé.
// ---------------------------------------------------------------------------
const isIndexMissing = computed(() => {
  const msg = error.value?.toLowerCase() ?? ''
  return msg.includes('index') || msg.includes('failed-precondition')
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
// Status pill mapping
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
// Promote-to-official dialog (admin only — when officialLevel == null)
// ---------------------------------------------------------------------------
const isPromoteDialogOpen = ref(false)
const promoteLevel = ref<1 | 2>(1)
const promoteError = ref<string | null>(null)

function openPromoteDialog(): void {
  promoteLevel.value = 1
  promoteError.value = null
  isPromoteDialogOpen.value = true
}

async function submitPromote(): Promise<void> {
  promoteError.value = null
  await store.applyProfilePatch({ officialLevel: promoteLevel.value })
  if (store.error) {
    promoteError.value = store.error
    return
  }
  isPromoteDialogOpen.value = false
  // Le store recharge le membre — l'effet de bord déclenche `isOfficial` true
  // et le watcher relance `load()`.
}
</script>

<template>
  <!-- ============================================================
       État : pas officiel — affiche un placeholder + CTA admin.
       ============================================================ -->
  <div
    v-if="!isOfficial"
    class="card p-8 flex flex-col items-center text-center gap-3"
  >
    <ShieldCheck
      :size="32"
      :stroke-width="1.5"
      class="text-surface-400"
    />
    <div class="space-y-1">
      <div class="text-[14px] font-medium text-surface-700">
        Ce membre n'est pas officiel
      </div>
      <p class="text-[12px] text-surface-500 max-w-md">
        Définissez un niveau officiel (L1 ou L2) pour lui assigner des matches
        et suivre sa rentabilité. La licence coûte
        <strong>{{ chfFormatter.format(officialsConfig.licenseFee) }}</strong>
        et il faut au moins
        <strong>{{ officialsConfig.thresholdGreen }} matches</strong>
        confirmés par saison pour la rentabiliser.
      </p>
    </div>
    <button
      v-if="canEdit"
      type="button"
      class="btn btn-primary btn-sm"
      :disabled="store.saving"
      @click="openPromoteDialog"
    >
      <Award
        :size="14"
        :stroke-width="2"
      />
      Définir le niveau officiel
    </button>
  </div>

  <!-- ============================================================
       État : officiel — header + légende + table.
       ============================================================ -->
  <div
    v-else
    class="space-y-4"
  >
    <!-- =============== Header card =============== -->
    <div class="card p-5">
      <div class="flex items-start gap-4 flex-wrap">
        <!-- Niveau -->
        <div class="space-y-1">
          <div class="text-[11px] uppercase tracking-wide text-surface-500">
            Niveau
          </div>
          <div class="flex items-center gap-2">
            <Pill
              variant="emerald"
              class="num"
            >
              L{{ props.member?.officialLevel }}
            </Pill>
            <span class="text-[12px] text-surface-500">officiel</span>
          </div>
        </div>

        <!-- Licence fee -->
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

        <!-- Score rentabilité -->
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

      <!-- Légende thresholds -->
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

    <!-- =============== Stats compactes =============== -->
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

    <!-- =============== Index missing banner =============== -->
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

    <!-- =============== Error banner (autre erreur) =============== -->
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

    <!-- =============== Liste assignations =============== -->
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

      <!-- Empty state -->
      <div
        v-if="!loading && assignments.length === 0 && !error"
        class="p-8 text-center text-[13px] text-surface-500"
      >
        Aucune assignation pour le moment.
      </div>

      <!-- Table -->
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

  <!-- ============================================================
       Promote-to-official dialog
       ============================================================ -->
  <Dialog
    v-model:visible="isPromoteDialogOpen"
    modal
    :draggable="false"
    :style="{ width: '420px' }"
    header="Définir le niveau officiel"
  >
    <div class="space-y-4 pt-1">
      <p class="text-[13px] text-surface-600">
        Choisissez le niveau officiel pour
        <strong>{{ props.member?.firstName }} {{ props.member?.lastName }}</strong>.
        Vous pourrez le modifier plus tard depuis cette page.
      </p>

      <div class="space-y-2">
        <label
          class="flex items-start gap-2 cursor-pointer p-3 border border-surface-200 rounded hover:bg-surface-50"
          :class="promoteLevel === 1 ? 'bg-primary-50 border-primary-300' : ''"
        >
          <RadioButton
            v-model="promoteLevel"
            :value="1"
            input-id="level-1"
            class="mt-0.5"
          />
          <div class="flex-1">
            <div class="text-[13px] font-medium">
              Niveau 1
            </div>
            <div class="text-[11px] text-surface-500">
              Officiel de base — peut couvrir la majorité des matches home.
            </div>
          </div>
        </label>

        <label
          class="flex items-start gap-2 cursor-pointer p-3 border border-surface-200 rounded hover:bg-surface-50"
          :class="promoteLevel === 2 ? 'bg-primary-50 border-primary-300' : ''"
        >
          <RadioButton
            v-model="promoteLevel"
            :value="2"
            input-id="level-2"
            class="mt-0.5"
          />
          <div class="flex-1">
            <div class="text-[13px] font-medium">
              Niveau 2
            </div>
            <div class="text-[11px] text-surface-500">
              Officiel confirmé — couvre tous les types de matches.
            </div>
          </div>
        </label>
      </div>

      <p
        v-if="promoteError"
        class="text-[12px] text-rose-600"
      >
        {{ promoteError }}
      </p>
    </div>

    <template #footer>
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        @click="isPromoteDialogOpen = false"
      >
        Annuler
      </button>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        :disabled="store.saving"
        @click="submitPromote"
      >
        <template v-if="store.saving">
          Enregistrement…
        </template>
        <template v-else>
          Confirmer
        </template>
      </button>
    </template>
  </Dialog>
</template>
