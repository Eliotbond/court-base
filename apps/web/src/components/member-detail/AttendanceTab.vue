<script setup lang="ts">
import { computed, onMounted, toRef } from 'vue'
import {
  CalendarX,
  CheckCircle2,
  Info,
  MinusCircle,
  TriangleAlert,
  XCircle,
} from 'lucide-vue-next'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Pill from '@/components/ui/Pill.vue'
import { useMemberAttendance } from '@/composables/useMemberAttendance'
import type { MemberDetailRow } from '@/repositories/members.repo'
import type {
  AttendanceEntry,
  AttendanceStatus,
} from '@/repositories/attendance.repo'

const props = defineProps<{
  memberId: string
  member: MemberDetailRow | null
  // canEdit n'est pas utilisé ici : les écritures se font côté coach via la
  // page /attendance, ce tab est en lecture seule. Le prop est gardé pour
  // signature uniforme avec les autres tabs.
  canEdit: boolean
}>()

// Le composable accepte un Ref<string>. On expose memberId réactif via
// `toRef` pour qu'un changement de route déclenche un reload automatique.
const {
  loading,
  error,
  missingIndex,
  load,
  totals,
  byTeamList,
  recent,
} = useMemberAttendance(toRef(props, 'memberId'))

onMounted(() => {
  void load()
})

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

type PillVariant = 'emerald' | 'rose' | 'amber' | 'slate'

interface StatusDef {
  variant: PillVariant
  label: string
  Icon: typeof CheckCircle2
}

function statusDef(status: AttendanceStatus): StatusDef {
  switch (status) {
    case 'present':
      return { variant: 'emerald', label: 'Présent', Icon: CheckCircle2 }
    case 'absent':
      return { variant: 'rose', label: 'Absent', Icon: XCircle }
    case 'excused':
      return { variant: 'amber', label: 'Excusé', Icon: MinusCircle }
    default:
      return { variant: 'slate', label: status, Icon: MinusCircle }
  }
}

const dateFmt = new Intl.DateTimeFormat('fr-CH', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
})

function formatBookingDate(entry: AttendanceEntry): string {
  const d = entry.bookingDate ?? entry.recordedAt
  return dateFmt.format(d)
}

function formatSlot(entry: AttendanceEntry): string {
  if (entry.bookingStartTime && entry.bookingEndTime) {
    return `${entry.bookingStartTime} – ${entry.bookingEndTime}`
  }
  return '—'
}

// ---------------------------------------------------------------------------
// Stats cards : 4 mini-stats + rate %.
// ---------------------------------------------------------------------------

const presentRateLabel = computed(() => {
  if (totals.value.total === 0) return '—'
  return `${totals.value.presentRate}%`
})
</script>

<template>
  <!-- ============== Loading ============== -->
  <div
    v-if="loading && totals.total === 0"
    class="card p-8 text-center text-[13px] text-surface-500"
    aria-busy="true"
  >
    Chargement…
  </div>

  <!-- ============== Error (non-index) ============== -->
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
        Impossible de charger les présences
      </div>
      <div class="text-[12px] mt-0.5">
        {{ error }}
      </div>
    </div>
  </div>

  <div
    v-else
    class="space-y-4"
  >
    <!-- ============== Missing-index banner ============== -->
    <div
      v-if="missingIndex"
      class="card border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800 flex items-start gap-2"
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
          La requête collectionGroup <code class="font-mono">'attendance'</code>
          nécessite un index composite
          <code class="font-mono">memberId asc · recordedAt desc</code>
          qui n'est pas encore déployé. Contacter l'admin pour
          déployer <code class="font-mono">firestore.indexes.json</code>.
        </div>
      </div>
    </div>

    <!-- ============== Empty state ============== -->
    <div
      v-if="totals.total === 0 && !missingIndex"
      class="card p-10 flex flex-col items-center text-center gap-3 text-surface-500"
    >
      <span class="w-10 h-10 rounded-full bg-surface-100 inline-flex items-center justify-center text-surface-500">
        <CalendarX
          :size="18"
          :stroke-width="2"
        />
      </span>
      <div class="text-[14px] font-medium text-surface-700">
        Aucune présence enregistrée
      </div>
      <div class="text-[12px] max-w-md">
        Les présences sont saisies par les coachs depuis la page
        <span class="font-medium">Attendance</span>.
      </div>
    </div>

    <template v-else>
      <!-- ============== Summary card ============== -->
      <div class="grid gap-3 md:grid-cols-5 sm:grid-cols-2">
        <div class="card p-4">
          <div class="text-[11px] text-surface-500 uppercase tracking-wide">
            Total
          </div>
          <div class="text-[22px] font-semibold num mt-1">
            {{ totals.total }}
          </div>
        </div>
        <div class="card p-4">
          <div class="text-[11px] text-emerald-700 uppercase tracking-wide flex items-center gap-1">
            <CheckCircle2
              :size="12"
              :stroke-width="2"
            />
            Présent
          </div>
          <div class="text-[22px] font-semibold text-emerald-700 num mt-1">
            {{ totals.present }}
          </div>
        </div>
        <div class="card p-4">
          <div class="text-[11px] text-rose-700 uppercase tracking-wide flex items-center gap-1">
            <XCircle
              :size="12"
              :stroke-width="2"
            />
            Absent
          </div>
          <div class="text-[22px] font-semibold text-rose-700 num mt-1">
            {{ totals.absent }}
          </div>
        </div>
        <div class="card p-4">
          <div class="text-[11px] text-amber-700 uppercase tracking-wide flex items-center gap-1">
            <MinusCircle
              :size="12"
              :stroke-width="2"
            />
            Excusé
          </div>
          <div class="text-[22px] font-semibold text-amber-700 num mt-1">
            {{ totals.excused }}
          </div>
        </div>
        <div class="card p-4">
          <div class="text-[11px] text-surface-500 uppercase tracking-wide">
            Taux de présence
          </div>
          <div class="text-[22px] font-semibold num mt-1">
            {{ presentRateLabel }}
          </div>
        </div>
      </div>

      <!-- ============== Breakdown par équipe ============== -->
      <div class="card p-5 space-y-3">
        <h2 class="text-[14px] font-semibold">
          Par équipe
        </h2>
        <div
          v-if="byTeamList.length === 0"
          class="text-[12px] text-surface-500"
        >
          Aucune équipe associée à l'historique.
        </div>
        <table
          v-else
          class="w-full text-[13px]"
        >
          <thead>
            <tr class="text-left text-[11px] text-surface-500 uppercase tracking-wide">
              <th class="py-2 font-medium">
                Équipe
              </th>
              <th class="py-2 font-medium text-right w-16">
                Total
              </th>
              <th class="py-2 font-medium text-right w-20 text-emerald-700">
                Présent
              </th>
              <th class="py-2 font-medium text-right w-20 text-rose-700">
                Absent
              </th>
              <th class="py-2 font-medium text-right w-20 text-amber-700">
                Excusé
              </th>
              <th class="py-2 font-medium text-right w-16">
                Taux
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="team in byTeamList"
              :key="team.teamId ?? '__none__'"
              class="border-t border-surface-100"
            >
              <td class="py-2">
                {{ team.teamName }}
              </td>
              <td class="py-2 text-right num">
                {{ team.total }}
              </td>
              <td class="py-2 text-right num text-emerald-700">
                {{ team.present }}
              </td>
              <td class="py-2 text-right num text-rose-700">
                {{ team.absent }}
              </td>
              <td class="py-2 text-right num text-amber-700">
                {{ team.excused }}
              </td>
              <td class="py-2 text-right num font-medium">
                {{ team.rate }}%
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ============== 10 dernières entrées ============== -->
      <div class="card overflow-hidden">
        <div class="px-5 pt-4 pb-2">
          <h2 class="text-[14px] font-semibold">
            10 dernières présences
          </h2>
        </div>
        <DataTable
          :value="recent"
          size="small"
          data-key="id"
          striped-rows
          class="text-[13px]"
        >
          <template #empty>
            <div class="px-3 py-6 text-center text-[12px] text-surface-500">
              Aucune présence à afficher.
            </div>
          </template>

          <Column
            header="Date"
            :pt="{ headerCell: { style: 'width: 140px' } }"
          >
            <template #body="{ data }">
              <span class="num">{{ formatBookingDate(data as AttendanceEntry) }}</span>
            </template>
          </Column>

          <Column header="Équipe">
            <template #body="{ data }">
              <template v-if="(data as AttendanceEntry).teamName">
                {{ (data as AttendanceEntry).teamName }}
              </template>
              <span
                v-else
                class="text-surface-400"
              >—</span>
            </template>
          </Column>

          <Column
            header="Créneau"
            :pt="{ headerCell: { style: 'width: 130px' } }"
          >
            <template #body="{ data }">
              <span class="num">{{ formatSlot(data as AttendanceEntry) }}</span>
            </template>
          </Column>

          <Column
            header="Statut"
            :pt="{ headerCell: { style: 'width: 120px' } }"
          >
            <template #body="{ data }">
              <Pill :variant="statusDef((data as AttendanceEntry).status).variant">
                <component
                  :is="statusDef((data as AttendanceEntry).status).Icon"
                  :size="11"
                  :stroke-width="2"
                />
                {{ statusDef((data as AttendanceEntry).status).label }}
              </Pill>
            </template>
          </Column>

          <Column header="Note">
            <template #body="{ data }">
              <template v-if="(data as AttendanceEntry).note">
                <span class="text-[12px] text-surface-600">
                  {{ (data as AttendanceEntry).note }}
                </span>
              </template>
              <span
                v-else
                class="text-surface-400"
              >—</span>
            </template>
          </Column>
        </DataTable>
      </div>
    </template>
  </div>
</template>
