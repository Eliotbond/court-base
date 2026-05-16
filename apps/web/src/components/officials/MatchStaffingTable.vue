<script setup lang="ts">
import { computed } from 'vue'
import { CalendarX2 } from 'lucide-vue-next'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Pill from '@/components/ui/Pill.vue'
import type {
  MatchStaffingRow,
  MatchStaffingStatus,
} from '@/repositories/officialStaffing.repo'

/**
 * Table de staffing des matchs à domicile — écran Officials admin.
 *
 * Lecture pure : reçoit la liste agrégée (`MatchStaffingRow[]`) et émet
 * `select` au clic sur une ligne. Aucune mutation, aucun store ici —
 * le composant parent (`OfficialsMatchesTab.vue`) orchestre store + drawer.
 */

const props = defineProps<{
  matches: MatchStaffingRow[]
  loading: boolean
}>()

const emit = defineEmits<{
  (e: 'select', row: MatchStaffingRow): void
}>()

// ---------------------------------------------------------------------------
// Pill staffing — couleur + label.
// ---------------------------------------------------------------------------

type PillVariant = 'emerald' | 'amber' | 'rose' | 'slate'

interface StaffingPillDef {
  variant: PillVariant
  label: string
}

function staffingPill(status: MatchStaffingStatus): StaffingPillDef {
  switch (status) {
    case 'full':
      return { variant: 'emerald', label: 'Complet' }
    case 'partial':
      return { variant: 'amber', label: 'Incomplet' }
    case 'unstaffed':
    default:
      return { variant: 'rose', label: 'Aucun officiel' }
  }
}

/**
 * Pill de staffing d'une ligne. Un match sans besoin d'officiels
 * (`requiredTotal === 0`, ex. amical extérieur) affiche un état neutre
 * plutôt que "Complet" — il n'y a tout simplement rien à staffer.
 */
function rowPill(row: MatchStaffingRow): StaffingPillDef {
  if (row.requiredTotal === 0) {
    return { variant: 'slate', label: 'Aucun requis' }
  }
  return staffingPill(row.staffingStatus)
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const dateFormatter = new Intl.DateTimeFormat('fr-CH', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
})

/** "ven. 23 mai · 19:00" — date courte + heure de début. */
function formatDateTime(row: MatchStaffingRow): string {
  const time = row.startTime || '—'
  if (!row.date) return time
  return `${dateFormatter.format(row.date)} · ${time}`
}

/** Couleur du compteur `confirmés / requis` selon l'état de staffing. */
function countClass(row: MatchStaffingRow): string {
  if (row.requiredTotal === 0) return 'text-surface-400'
  if (row.confirmedTotal >= row.requiredTotal) return 'text-emerald-700'
  if (row.confirmedTotal === 0) return 'text-rose-600'
  return 'text-amber-700'
}

const matchesCount = computed(() => props.matches.length)

/** Clic sur une ligne du DataTable → remonte la `MatchStaffingRow`. */
function onRowClick(event: { data: MatchStaffingRow }): void {
  emit('select', event.data)
}
</script>

<template>
  <div class="card overflow-hidden">
    <DataTable
      :value="props.matches"
      :loading="props.loading"
      size="small"
      data-key="matchId"
      striped-rows
      row-hover
      class="text-[13px] cursor-pointer"
      @row-click="onRowClick"
    >
      <template #empty>
        <div
          v-if="props.loading"
          class="px-3 py-10 text-center text-[12px] text-surface-500"
          aria-busy="true"
        >
          Chargement des matchs…
        </div>
        <div
          v-else
          class="px-3 py-10 text-center flex flex-col items-center gap-2"
        >
          <span
            class="w-10 h-10 rounded-full bg-surface-100 inline-flex items-center justify-center text-surface-500"
          >
            <CalendarX2
              :size="18"
              :stroke-width="2"
            />
          </span>
          <div class="text-[14px] font-semibold">
            Aucun match
          </div>
          <div class="text-[12px] text-surface-500 max-w-md">
            Les matchs (à domicile et à l'extérieur) créés depuis la page
            Matches apparaîtront ici pour y assigner des officiels.
          </div>
        </div>
      </template>

      <!-- Date + heure -->
      <Column
        field="date"
        header="Date"
        :pt="{ headerCell: { style: 'width: 170px' } }"
      >
        <template #body="{ data }: { data: MatchStaffingRow }">
          <div class="leading-tight">
            <div class="font-medium">
              {{ formatDateTime(data) }}
            </div>
            <div
              v-if="data.matchStatus === 'cancelled'"
              class="text-[11px] text-rose-600"
            >
              Annulé
            </div>
            <div
              v-else-if="data.matchStatus === 'played'"
              class="text-[11px] text-surface-500"
            >
              Joué
            </div>
          </div>
        </template>
      </Column>

      <!-- Équipe -->
      <Column
        field="teamName"
        header="Équipe"
      >
        <template #body="{ data }: { data: MatchStaffingRow }">
          <span v-if="data.teamName">{{ data.teamName }}</span>
          <span
            v-else
            class="text-surface-400"
          >—</span>
        </template>
      </Column>

      <!-- Adversaire + chip type de match -->
      <Column
        field="opponentName"
        header="Adversaire"
      >
        <template #body="{ data }: { data: MatchStaffingRow }">
          <div class="flex items-center gap-2">
            <span
              v-if="data.matchTypeColor"
              class="inline-block w-2.5 h-2.5 rounded-full shrink-0"
              :style="{ backgroundColor: data.matchTypeColor }"
              :title="data.matchTypeName ?? ''"
            />
            <span class="leading-tight">
              <span v-if="data.opponentName">{{ data.opponentName }}</span>
              <span
                v-else
                class="text-surface-400 italic"
              >Adversaire inconnu</span>
              <span
                v-if="data.matchTypeName"
                class="block text-[11px] text-surface-500"
              >
                {{ data.matchTypeName }}
              </span>
            </span>
          </div>
        </template>
      </Column>

      <!-- Lieu : domicile / extérieur -->
      <Column
        header="Lieu"
        :pt="{ headerCell: { style: 'width: 116px' } }"
      >
        <template #body="{ data }: { data: MatchStaffingRow }">
          <Pill :variant="data.kind === 'home' ? 'sky' : 'violet'">
            {{ data.kind === 'home' ? 'Domicile' : 'Extérieur' }}
          </Pill>
        </template>
      </Column>

      <!-- Officiels : confirmés / requis + Pill staffing -->
      <Column
        header="Officiels"
        :pt="{ headerCell: { style: 'width: 200px' } }"
      >
        <template #body="{ data }: { data: MatchStaffingRow }">
          <div class="flex items-center gap-2">
            <span
              class="num text-[13px]"
              :class="countClass(data)"
            >
              {{ data.confirmedTotal }}<span class="text-surface-400">
                / {{ data.requiredTotal }}</span>
            </span>
            <Pill :variant="rowPill(data).variant">
              {{ rowPill(data).label }}
            </Pill>
          </div>
        </template>
      </Column>
    </DataTable>

    <!-- Footer : compteur -->
    <div
      class="flex items-center justify-between border-t border-surface-200 px-4 h-11 text-[12px] text-surface-500"
    >
      <div>
        <template v-if="props.loading && matchesCount === 0">
          Chargement…
        </template>
        <template v-else>
          {{ matchesCount }} match<span v-if="matchesCount > 1">s</span>
        </template>
      </div>
    </div>
  </div>
</template>
