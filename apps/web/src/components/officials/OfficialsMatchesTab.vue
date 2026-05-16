<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { TriangleAlert } from 'lucide-vue-next'
import type { NotificationType } from '@club-app/shared-types'
import {
  useOfficialStaffingStore,
  type StaffingQuickFilter,
} from '@/stores/officialStaffing'
import type { MatchStaffingRow } from '@/repositories/officialStaffing.repo'
import Chip from '@/components/ui/Chip.vue'
import MatchStaffingTable from '@/components/officials/MatchStaffingTable.vue'
import MatchAssignmentDrawer from '@/components/officials/MatchAssignmentDrawer.vue'
import SendNotificationDialog from '@/components/officials/SendNotificationDialog.vue'

/**
 * Onglet "Assignations" de la page `/officials` — orchestration du staffing
 * des matchs à domicile.
 *
 * Charge `useOfficialStaffingStore`, rend la table de staffing, le drawer
 * d'assignation et le dialog de notification. Aucune logique métier ici :
 * tout passe par le store (cf. apps/web/CLAUDE.md — architecture en couches).
 */

const store = useOfficialStaffingStore()

onMounted(() => {
  void store.load()
})

// ---------------------------------------------------------------------------
// Chips de filtre rapide
// ---------------------------------------------------------------------------

interface ChipDef {
  id: StaffingQuickFilter
  label: string
  badgeClass?: string
}

const CHIPS: readonly ChipDef[] = [
  { id: 'all', label: 'Tous' },
  { id: 'unstaffed', label: 'Non staffés', badgeClass: 'text-rose-600' },
  { id: 'partial', label: 'Partiels', badgeClass: 'text-amber-600' },
  { id: 'full', label: 'Complets', badgeClass: 'text-emerald-600' },
] as const

const counts = computed(() => store.counts)

const subtitle = computed(() => {
  const c = counts.value
  return `${c.all} match${c.all > 1 ? 's' : ''} · ${c.unstaffed} non staffé${c.unstaffed > 1 ? 's' : ''} · ${c.partial} partiel${c.partial > 1 ? 's' : ''} · ${c.full} complet${c.full > 1 ? 's' : ''}`
})

// ---------------------------------------------------------------------------
// Drawer d'assignation
// ---------------------------------------------------------------------------

const selectedMatch = ref<MatchStaffingRow | null>(null)
const drawerVisible = ref(false)

function onSelect(row: MatchStaffingRow): void {
  selectedMatch.value = row
  drawerVisible.value = true
}

// ---------------------------------------------------------------------------
// Dialog de notification
// ---------------------------------------------------------------------------

const notifyVisible = ref(false)
const notifyBookingId = ref<string | null>(null)
const notifyMatchId = ref<string | null>(null)
const NOTIFY_DEFAULT_TYPE: NotificationType = 'officials_needed'

function onNotify(match: MatchStaffingRow): void {
  // Match à domicile : la notif est rattachée au booking ET au match.
  // Match à l'extérieur : pas de booking → seulement le match.
  notifyBookingId.value = match.bookingId
  notifyMatchId.value = match.matchId
  notifyVisible.value = true
}
</script>

<template>
  <div class="space-y-4">
    <!-- ================= Tab heading =================== -->
    <div>
      <h2 class="text-[16px] font-semibold tracking-tight">
        Assignations des matchs
      </h2>
      <p class="text-[13px] text-surface-500 mt-0.5">
        {{ subtitle }}
      </p>
    </div>

    <!-- ================= Filter chips =================== -->
    <div class="flex items-center gap-2 flex-wrap">
      <Chip
        v-for="chip in CHIPS"
        :key="chip.id"
        :active="store.quickFilter === chip.id"
        :aria-pressed="store.quickFilter === chip.id"
        @click="store.setQuickFilter(chip.id)"
      >
        {{ chip.label }}
        <span
          class="ml-1 text-[11px] num"
          :class="chip.badgeClass"
        >{{ counts[chip.id] }}</span>
      </Chip>
    </div>

    <!-- ================= Staffing table =================== -->
    <MatchStaffingTable
      :matches="store.filtered"
      :loading="store.loading"
      @select="onSelect"
    />

    <!-- ================= Error banner =================== -->
    <div
      v-if="store.error"
      class="card border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700 flex items-center gap-2"
    >
      <TriangleAlert
        :size="14"
        :stroke-width="2"
      />
      {{ store.error }}
    </div>

    <!-- ================= Assignment drawer =================== -->
    <MatchAssignmentDrawer
      v-model:visible="drawerVisible"
      :match="selectedMatch"
      @notify="onNotify"
    />

    <!-- ================= Notification dialog =================== -->
    <SendNotificationDialog
      v-model:visible="notifyVisible"
      :related-booking-id="notifyBookingId"
      :related-match-id="notifyMatchId"
      :default-type="NOTIFY_DEFAULT_TYPE"
    />
  </div>
</template>
