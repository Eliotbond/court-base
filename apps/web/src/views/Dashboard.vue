<script setup lang="ts">
import { computed, onMounted } from 'vue'
import {
  Activity,
  BadgeCheck,
  Banknote,
  CalendarClock,
  CircleAlert,
  CircleQuestionMark,
  Download,
  Funnel,
  House,
  Plane,
  Plus,
  Siren,
  TriangleAlert,
} from 'lucide-vue-next'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import { useDashboardStore } from '@/stores/dashboard'
import { useSeasonsStore } from '@/stores/seasons'
import type {
  WeekBookingRow,
  WeekBookingStatus,
} from '@/repositories/dashboard.repo'
import AlertCard from '@/components/ui/AlertCard.vue'
import MiniBar from '@/components/ui/MiniBar.vue'
import Pill from '@/components/ui/Pill.vue'

const store = useDashboardStore()
const seasonsStore = useSeasonsStore()

onMounted(() => {
  void store.load()
  // Saison active utilisée pour la sous-ligne du heading ("Saison 2025-26").
  // Le store seasons est partagé : on évite un re-fetch s'il est déjà chargé
  // (ex. user navigue depuis /seasons → /).
  if (seasonsStore.seasons.length === 0) void seasonsStore.load()
})

const alerts = computed(() => store.alerts)
const bookings = computed<WeekBookingRow[]>(() => store.weekBookings)
const officials = computed(() => store.officialsProfitability)
const duesBreakdown = computed(() => store.duesBreakdown)
const activityFeed = computed(() => store.activityFeed)

// ---------------------------------------------------------------------------
// Heading subline — dynamic date + ISO week + season label.
// ---------------------------------------------------------------------------

const longDateFormatter = new Intl.DateTimeFormat('fr-CH', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

/** ISO 8601 week number (lundi = start). */
function isoWeekNumber(d: Date): number {
  const target = new Date(d.valueOf())
  const dayNr = (d.getDay() + 6) % 7
  target.setDate(target.getDate() - dayNr + 3)
  const firstThursday = new Date(target.getFullYear(), 0, 4)
  const diff = target.getTime() - firstThursday.getTime()
  return 1 + Math.round(diff / (7 * 24 * 60 * 60 * 1000))
}

const heading = computed(() => {
  const now = new Date()
  const longDate = longDateFormatter.format(now)
  const week = isoWeekNumber(now)
  // Saison active dérivée du store seasons (cf. /seasons where status ==
  // 'active'). Fallback '—' tant que le store n'est pas chargé / s'il n'y a
  // pas de saison active configurée.
  const seasonLabel = seasonsStore.activeSeason?.name ?? '—'
  // Capitalize first letter (Intl returns lowercase weekday in fr).
  const pretty = longDate.charAt(0).toUpperCase() + longDate.slice(1)
  return `${pretty} · Semaine ${week} · Saison ${seasonLabel}`
})

// ---------------------------------------------------------------------------
// "Cette semaine" table — formatters + status pills.
// ---------------------------------------------------------------------------

const dayFormatter = new Intl.DateTimeFormat('fr-CH', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
})

function formatDay(d: Date): string {
  return dayFormatter.format(d)
}

type SlotKind = WeekBookingRow['slotType']

/** Variant + label de la pill "Session" (combiné slotType + matchType). */
function sessionPill(row: WeekBookingRow): {
  variant: 'emerald' | 'violet' | 'sky' | 'slate' | 'amber'
  label: string
  icon: typeof House | typeof Plane | null
} {
  const kind: SlotKind = row.slotType
  if (kind === 'match_home') {
    return {
      variant: 'emerald',
      label: row.matchTypeLabel ? `${row.matchTypeLabel} home` : 'Match home',
      icon: House,
    }
  }
  if (kind === 'match_away') {
    return {
      variant: 'violet',
      label: row.matchTypeLabel ? `${row.matchTypeLabel} away` : 'Match away',
      icon: Plane,
    }
  }
  if (kind === 'training') {
    return { variant: 'sky', label: 'Training', icon: null }
  }
  if (kind === 'reserve') {
    return { variant: 'slate', label: 'Reserve', icon: null }
  }
  return { variant: 'amber', label: 'Custom', icon: null }
}

function statusPill(row: WeekBookingRow): {
  variant: 'emerald' | 'amber' | 'rose'
  label: string
  showIcon: boolean
} {
  const status: WeekBookingStatus = row.status
  if (status === 'conflict') {
    return { variant: 'rose', label: 'conflit', showIcon: true }
  }
  if (status === 'staffing') {
    const got = row.officials.filter((o) => o.status === 'confirmed').length
    const req = row.officialsRequired
    // 0/N = critique (rose), partiel = amber.
    if (got === 0 && req > 0) {
      return { variant: 'rose', label: `${got}/${req} officials`, showIcon: true }
    }
    return { variant: 'amber', label: `${got}/${req} officials`, showIcon: false }
  }
  return { variant: 'emerald', label: 'scheduled', showIcon: false }
}

// ---------------------------------------------------------------------------
// Officials profitability widget — stacked bar segments.
// ---------------------------------------------------------------------------

const tierBar = computed(() => {
  const tiers = officials.value?.tiers
  if (!tiers) return null
  const total = tiers.green + tiers.orange + tiers.red
  if (total === 0) return null
  return {
    green: (tiers.green / total) * 100,
    orange: (tiers.orange / total) * 100,
    red: (tiers.red / total) * 100,
  }
})

// ---------------------------------------------------------------------------
// Alert card icons — dot color helper for the officials-to-staff mini-list.
// ---------------------------------------------------------------------------

function severityDot(severity: 'urgent' | 'soon' | 'later'): string {
  if (severity === 'urgent') return '#e11d48'
  if (severity === 'soon') return '#f59e0b'
  return '#94a3b8'
}

const shortDateFormatter = new Intl.DateTimeFormat('fr-CH', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
})

function shortDate(d: Date): string {
  return shortDateFormatter.format(d)
}

function formatChf(amount: number): string {
  // Swiss formatting : apostrophe thousand separator.
  return amount.toLocaleString('fr-CH', { maximumFractionDigits: 0 }).replace(/ /g, "'")
}

/** Compute initials for a name string (2 letters max). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const noop = (): void => {
  /* TODO(actions): wire Export / Filtres / Nouveau booking. */
}
</script>

<template>
  <section class="p-6 space-y-6">
    <!-- ================= Page heading =================== -->
    <div class="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-[22px] font-semibold tracking-tight">
          Vue d'ensemble du club
        </h1>
        <p class="text-[13px] text-surface-500 mt-0.5">
          {{ heading }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          @click="noop"
        >
          <Download
            :size="14"
            :stroke-width="2"
          />
          Export
        </button>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          @click="noop"
        >
          <Funnel
            :size="14"
            :stroke-width="2"
          />
          Filtres
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          @click="noop"
        >
          <Plus
            :size="14"
            :stroke-width="2"
          />
          Nouveau booking
        </button>
      </div>
    </div>

    <!-- ================= 5 alert cards =================== -->
    <div
      class="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 items-stretch"
    >
      <!-- 1) Officiels à staffer -->
      <AlertCard
        variant="rose"
        to="/officials"
      >
        <template #icon>
          <Siren
            :size="14"
            :stroke-width="2"
          />
        </template>
        Officiels à staffer
        <template #metric>
          <template v-if="store.loading && !alerts">
            <div class="h-7 w-12 bg-surface-200 animate-pulse rounded-md2" />
          </template>
          <template v-else>
            <span class="text-[28px] font-semibold num tracking-tight">{{ alerts?.officialsToStaff.total ?? 0 }}</span>
            <Pill
              v-if="(alerts?.officialsToStaff.urgent ?? 0) > 0"
              variant="rose"
            >
              <TriangleAlert
                :size="12"
                :stroke-width="2"
              />
              dont {{ alerts?.officialsToStaff.urgent }} urgent<span v-if="(alerts?.officialsToStaff.urgent ?? 0) > 1">s</span>
            </Pill>
          </template>
        </template>
        <template
          v-if="alerts"
          #content
        >
          <div
            v-if="alerts.officialsToStaff.upcoming.length === 0"
            class="text-surface-500"
          >
            Tous les matches sont staffés.
          </div>
          <div
            v-else
            class="space-y-1.5"
          >
            <div
              v-for="entry in alerts.officialsToStaff.upcoming"
              :key="entry.bookingId"
              class="flex items-center gap-2 truncate"
            >
              <span
                class="w-1.5 h-1.5 rounded-full shrink-0"
                :style="{ background: severityDot(entry.severity) }"
                :aria-label="entry.severity"
              />
              <span class="font-mono text-[11px] text-surface-500">{{ shortDate(entry.date) }}</span>
              <span class="truncate">{{ entry.label }}</span>
            </div>
          </div>
        </template>
        <template #cta>
          Assigner
        </template>
      </AlertCard>

      <!-- 2) Cotisations en retard -->
      <AlertCard
        variant="rose"
        to="/dues"
      >
        <template #icon>
          <Banknote
            :size="14"
            :stroke-width="2"
          />
        </template>
        Cotisations en retard
        <template #metric>
          <template v-if="store.loading && !alerts">
            <div class="h-7 w-12 bg-surface-200 animate-pulse rounded-md2" />
          </template>
          <template v-else>
            <span class="text-[28px] font-semibold num tracking-tight">{{ alerts?.duesOverdue.membersCount ?? 0 }}</span>
            <span class="text-[13px] text-surface-500 num">membres</span>
          </template>
        </template>
        <template
          v-if="alerts"
          #content
        >
          <div class="text-rose-700 font-medium num mb-1.5">
            CHF {{ formatChf(alerts.duesOverdue.amountChf) }}.– à recouvrer
          </div>
          <MiniBar
            :value="alerts.duesOverdue.totalIssuedChf > 0
              ? alerts.duesOverdue.amountChf / alerts.duesOverdue.totalIssuedChf
              : 0"
            color="#e11d48"
          />
          <div class="mt-1.5 flex items-center justify-between text-[11px] text-surface-500">
            <span>
              {{ alerts.duesOverdue.totalIssuedChf > 0
                ? Math.round((alerts.duesOverdue.amountChf / alerts.duesOverdue.totalIssuedChf) * 100)
                : 0 }} % du total émis
            </span>
            <span class="num">CHF {{ formatChf(alerts.duesOverdue.totalIssuedChf) }} émis</span>
          </div>
        </template>
        <template #cta>
          Voir liste
        </template>
      </AlertCard>

      <!-- 3) Licences en attente -->
      <AlertCard
        variant="sky"
        to="/licenses"
      >
        <template #icon>
          <BadgeCheck
            :size="14"
            :stroke-width="2"
          />
        </template>
        Licences en attente
        <template #metric>
          <template v-if="store.loading && !alerts">
            <div class="h-7 w-12 bg-surface-200 animate-pulse rounded-md2" />
          </template>
          <template v-else>
            <span class="text-[28px] font-semibold num tracking-tight">{{ alerts?.licensePending.total ?? 0 }}</span>
            <Pill
              v-if="(alerts?.licensePending.total ?? 0) > 0"
              variant="amber"
            >
              à traiter
            </Pill>
          </template>
        </template>
        <template
          v-if="alerts"
          #content
        >
          <div
            v-if="alerts.licensePending.latest.length === 0"
            class="text-surface-500"
          >
            Aucune demande en attente.
          </div>
          <div
            v-else
            class="space-y-1.5"
          >
            <div
              v-for="entry in alerts.licensePending.latest"
              :key="entry.memberId"
              class="flex items-center gap-2 truncate"
            >
              <span
                class="inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-semibold shrink-0"
                :style="{ background: entry.avatarBg, color: entry.avatarFg }"
                aria-hidden="true"
              >{{ initials(entry.displayName) }}</span>
              <span class="truncate">{{ entry.displayName }}</span>
              <span class="ml-auto text-[11px] text-surface-500">{{ entry.teamLabel }}</span>
            </div>
          </div>
        </template>
        <template #cta>
          Examiner
        </template>
      </AlertCard>

      <!-- 4) Demandes de match -->
      <AlertCard
        variant="sky"
        :to="null"
      >
        <template #icon>
          <CircleQuestionMark
            :size="14"
            :stroke-width="2"
          />
        </template>
        Demandes de match
        <template #metric>
          <template v-if="store.loading && !alerts">
            <div class="h-7 w-12 bg-surface-200 animate-pulse rounded-md2" />
          </template>
          <template v-else>
            <span class="text-[28px] font-semibold num tracking-tight">{{ alerts?.matchRequests.total ?? 0 }}</span>
            <Pill
              v-if="(alerts?.matchRequests.total ?? 0) > 0"
              variant="sky"
            >
              visiteurs
            </Pill>
          </template>
        </template>
        <template
          v-if="alerts"
          #content
        >
          <div
            v-if="alerts.matchRequests.pending.length === 0"
            class="text-surface-500"
          >
            Aucune demande en attente.
          </div>
          <div
            v-else
            class="space-y-1.5"
          >
            <div
              v-for="entry in alerts.matchRequests.pending"
              :key="entry.requestId"
              class="flex items-center gap-2 truncate"
            >
              <span class="font-mono text-[11px] text-surface-500">{{ shortDate(entry.date) }}</span>
              <span class="truncate">{{ entry.label }}</span>
            </div>
          </div>
        </template>
        <template
          v-if="(alerts?.matchRequests.total ?? 0) > 0"
          #actions
        >
          <button
            type="button"
            class="btn btn-secondary btn-sm flex-1 justify-center"
            @click.stop="noop"
          >
            Refuser
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm flex-1 justify-center"
            @click.stop="noop"
          >
            Accepter
          </button>
        </template>
      </AlertCard>

      <!-- 5) Conflits de planning (kept from current impl) -->
      <AlertCard
        variant="amber"
        to="/bookings"
        show-chevron
      >
        <template #icon>
          <CalendarClock
            :size="14"
            :stroke-width="2"
          />
        </template>
        Conflits de planning cette semaine
        <template #metric>
          <template v-if="store.loading && !alerts">
            <div class="h-7 w-12 bg-surface-200 animate-pulse rounded-md2" />
          </template>
          <template v-else>
            <span class="text-[28px] font-semibold num tracking-tight">{{ alerts?.schedulingConflicts.total ?? 0 }}</span>
            <span class="text-[13px] text-surface-500 num">à résoudre</span>
          </template>
        </template>
        <template #cta>
          Voir bookings
        </template>
      </AlertCard>
    </div>

    <!-- ================= Main row: this-week (2/3) + officials (1/3) ============ -->
    <div class="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <!-- This week -->
      <div class="card xl:col-span-2 overflow-hidden">
        <div class="px-4 h-12 border-b border-surface-200 flex items-center gap-3">
          <CalendarClock
            :size="16"
            :stroke-width="2"
            class="text-surface-500"
          />
          <h2 class="text-[14px] font-semibold">
            Cette semaine
          </h2>
          <span class="text-[12px] text-surface-500 num">{{ bookings.length }} sessions</span>
          <button
            type="button"
            class="btn btn-secondary btn-sm ml-auto"
            @click="noop"
          >
            Voir saison
          </button>
        </div>

        <DataTable
          :value="bookings"
          :loading="store.loading"
          size="small"
          data-key="id"
          striped-rows
          class="text-[13px]"
        >
          <template #empty>
            <div class="px-3 py-6 text-center text-[12px] text-surface-500">
              Aucun booking cette semaine.
            </div>
          </template>

          <Column
            field="date"
            header="Jour"
            :pt="{ bodyCell: { class: 'whitespace-nowrap' } }"
          >
            <template #body="{ data }">
              <div class="font-mono text-[11px] text-surface-500">
                {{ formatDay(data.date) }}
              </div>
              <div class="text-[12px] num">
                {{ data.startTime }}–{{ data.endTime }}
              </div>
            </template>
          </Column>

          <Column header="Session">
            <template #body="{ data }">
              <Pill :variant="sessionPill(data).variant">
                <component
                  :is="sessionPill(data).icon"
                  v-if="sessionPill(data).icon"
                  :size="11"
                  :stroke-width="2"
                />
                {{ sessionPill(data).label }}
              </Pill>
            </template>
          </Column>

          <Column
            field="teamLabel"
            header="Équipe"
          >
            <template #body="{ data }">
              <span class="text-surface-900 font-medium">{{ data.teamLabel }}</span>
            </template>
          </Column>

          <Column
            field="courtLabel"
            header="Court"
          >
            <template #body="{ data }">
              <span class="text-surface-700">{{ data.courtLabel }}</span>
            </template>
          </Column>

          <Column header="Coach">
            <template #body="{ data }">
              <div class="flex items-center gap-2">
                <span
                  class="inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-semibold shrink-0"
                  :style="{ background: data.coachAvatarBg, color: data.coachAvatarFg }"
                  aria-hidden="true"
                >{{ initials(data.coachLabel) }}</span>
                <span>{{ data.coachLabel }}</span>
              </div>
            </template>
          </Column>

          <Column header="Statut">
            <template #body="{ data }">
              <Pill :variant="statusPill(data).variant">
                <TriangleAlert
                  v-if="statusPill(data).showIcon"
                  :size="11"
                  :stroke-width="2"
                />
                {{ statusPill(data).label }}
              </Pill>
            </template>
          </Column>
        </DataTable>
      </div>

      <!-- Officials profitability -->
      <div class="card p-4 flex flex-col">
        <div class="flex items-center justify-between">
          <h2 class="text-[14px] font-semibold">
            Rentabilité officiels
          </h2>
        </div>
        <p class="text-[12px] text-surface-500 mt-0.5">
          <template v-if="store.loading && !officials">
            <span class="inline-block h-3 w-32 bg-surface-200 animate-pulse rounded" />
          </template>
          <template v-else-if="officials">
            {{ officials.totalOfficials }} officials · saison {{ officials.seasonLabel }}
          </template>
        </p>

        <!-- Stacked bar -->
        <div
          v-if="tierBar"
          class="mt-4 flex h-3 rounded-full overflow-hidden"
          style="background: #f1f5f9"
          role="img"
          aria-label="Distribution rentabilité officiels"
        >
          <div :style="{ background: '#10b981', width: `${tierBar.green}%` }" />
          <div :style="{ background: '#f59e0b', width: `${tierBar.orange}%` }" />
          <div :style="{ background: '#e11d48', width: `${tierBar.red}%` }" />
        </div>
        <div
          v-else
          class="mt-4 h-3 bg-surface-200 animate-pulse rounded-full"
        />

        <!-- 3-col counts grid -->
        <div class="mt-3 grid grid-cols-3 gap-2 text-center">
          <div>
            <div class="text-[20px] font-semibold num text-emerald-600">
              {{ officials?.tiers.green ?? '–' }}
            </div>
            <div class="text-[11px] text-surface-500">
              ≥ 6 matchs
            </div>
          </div>
          <div>
            <div class="text-[20px] font-semibold num text-amber-600">
              {{ officials?.tiers.orange ?? '–' }}
            </div>
            <div class="text-[11px] text-surface-500">
              3–5 matchs
            </div>
          </div>
          <div>
            <div class="text-[20px] font-semibold num text-rose-600">
              {{ officials?.tiers.red ?? '–' }}
            </div>
            <div class="text-[11px] text-surface-500">
              &lt; 3 matchs
            </div>
          </div>
        </div>

        <!-- À surveiller -->
        <div class="mt-4 pt-3 border-t border-surface-200">
          <div class="text-[11px] uppercase text-surface-400 font-semibold tracking-wider">
            À surveiller
          </div>
          <div
            v-if="officials && officials.atRisk.length === 0"
            class="mt-2 text-[12px] text-surface-500"
          >
            Aucun official en zone rouge.
          </div>
          <div
            v-else
            class="mt-2 space-y-2 text-[12px]"
          >
            <div
              v-for="row in officials?.atRisk ?? []"
              :key="row.memberId"
              class="flex items-center gap-2"
            >
              <span
                class="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-semibold shrink-0"
                :style="{ background: row.avatarBg, color: row.avatarFg }"
                aria-hidden="true"
              >{{ initials(row.displayName) }}</span>
              <div class="flex-1 min-w-0">
                <div class="truncate font-medium">
                  {{ row.displayName }}
                </div>
                <div class="text-[11px] text-surface-500">
                  L{{ row.level }} · {{ row.matchesAssigned }} match<span v-if="row.matchesAssigned > 1">s</span> ·
                  CHF {{ formatChf(row.licenseFeeChf) }} licence
                </div>
              </div>
              <Pill
                variant="rose"
                class="num"
              >
                {{ row.matchesAssigned }}
              </Pill>
            </div>
          </div>
        </div>

        <div
          class="mt-4 pt-3 border-t border-surface-200 text-[11px] text-surface-500 flex items-center gap-1.5"
        >
          <CircleAlert
            :size="12"
            :stroke-width="2"
          />
          Seuils config club
        </div>
      </div>
    </div>

    <!-- ================= Bottom row: cotisations + activité ============ -->
    <div class="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <!-- Cotisations · saison -->
      <div class="card p-4">
        <div class="flex items-center justify-between">
          <h2 class="text-[14px] font-semibold">
            Cotisations · saison
          </h2>
          <span class="text-[11px] text-surface-500 num">
            <template v-if="duesBreakdown">{{ duesBreakdown.duesCount }} dues</template>
            <template v-else>–</template>
          </span>
        </div>
        <div class="mt-3 space-y-2.5 text-[12px]">
          <template v-if="store.loading && !duesBreakdown">
            <div
              v-for="i in 4"
              :key="i"
              class="h-5 bg-surface-100 animate-pulse rounded-md2"
            />
          </template>
          <template v-else>
            <div
              v-for="row in duesBreakdown?.rows ?? []"
              :key="row.label"
              class="flex items-center gap-2"
            >
              <span class="w-20 text-surface-500">{{ row.label }}</span>
              <div class="flex-1">
                <MiniBar
                  :value="row.ratio"
                  :color="row.color"
                />
              </div>
              <span
                class="num font-medium w-24 text-right"
                :style="row.amountColor ? { color: row.amountColor } : {}"
              >CHF {{ formatChf(row.amountChf) }}</span>
            </div>
          </template>
        </div>
      </div>

      <!-- Activité récente -->
      <div class="card p-4 xl:col-span-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <Activity
              :size="16"
              :stroke-width="2"
              class="text-surface-500"
            />
            <h2 class="text-[14px] font-semibold">
              Activité récente
            </h2>
          </div>
          <a
            class="text-[12px] text-surface-500 hover:text-surface-700 cursor-pointer"
            @click="noop"
          >
            Voir tout
          </a>
        </div>
        <div class="mt-3 space-y-3 text-[12px]">
          <template v-if="store.loading && activityFeed.length === 0">
            <div
              v-for="i in 5"
              :key="i"
              class="h-4 bg-surface-100 animate-pulse rounded-md2"
            />
          </template>
          <template v-else-if="activityFeed.length === 0">
            <div class="text-surface-500 text-center py-6">
              Aucune activité récente.
            </div>
          </template>
          <template v-else>
            <div
              v-for="entry in activityFeed"
              :key="entry.id"
              class="flex items-center gap-2 flex-wrap"
            >
              <span class="font-medium">{{ entry.actor }}</span>
              <span class="text-surface-500">{{ entry.action }}</span>
              <span class="font-medium">{{ entry.target }}</span>
              <Pill
                v-if="entry.pill"
                :variant="entry.pill.variant"
              >
                {{ entry.pill.label }}
              </Pill>
              <span class="ml-auto font-mono text-[11px] text-surface-400">{{ entry.timeAgo }}</span>
            </div>
          </template>
        </div>
      </div>
    </div>

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
  </section>
</template>
