<script setup lang="ts">
import { computed, onMounted } from 'vue'
import {
  ArrowDownRight,
  ArrowUpRight,
  Clock,
  Download,
  Gavel,
  Repeat2,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-vue-next'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import {
  useOfficialsStore,
  type OfficialsActiveFilter,
  type OfficialsQuickFilter,
} from '@/stores/officials'
import type {
  OfficialLoadStatus,
  OfficialMetricsRow,
} from '@/repositories/officials.repo'
import Avatar from '@/components/ui/Avatar.vue'
import Chip from '@/components/ui/Chip.vue'
import MiniBar from '@/components/ui/MiniBar.vue'
import Pill from '@/components/ui/Pill.vue'

/**
 * Onglet "Officiels" de la page `/officials` — tableau de bord saison.
 *
 * Tab restructuré 2026-05-24 pour devenir un dashboard de tracking des
 * officiels actifs de la saison plutôt qu'un focus rentabilité pur :
 *  - Stat cards : Actifs / Confirmés cumul / Last-minute / Remplacements.
 *  - Filtre "Actifs cette saison" / "Tous" (officiels qualifiés y compris
 *    sans licence active) — par défaut "Actifs cette saison".
 *  - DataTable enrichie : colonnes Licence + Last-minute + Remplacements +
 *    Charge. Sparkbar de charge conservée.
 *  - Export CSV étendu aux nouvelles colonnes.
 *
 * NB : la métrique « En retard pendant un match » (présence) est défiérée —
 * cf. spec produit Eliot 2026-05-24.
 */

const store = useOfficialsStore()

onMounted(() => {
  void store.load()
})

const rows = computed<OfficialMetricsRow[]>(() => store.filtered)
const counts = computed(() => store.counts)
const summary = computed(() => store.metricsSummary)
const thresholds = computed(() => store.thresholds)
const hasActiveSeason = computed(() => store.activeSeasonId !== null)

// ---------------------------------------------------------------------------
// Pill load — couleur + label + tooltip (renvoie les seuils en clair).
// ---------------------------------------------------------------------------

type PillVariant = 'emerald' | 'sky' | 'amber' | 'rose' | 'slate' | 'violet'

interface LoadPillDef {
  variant: PillVariant
  label: string
}

function loadPill(status: OfficialLoadStatus): LoadPillDef {
  switch (status) {
    case 'ok':
      return { variant: 'emerald', label: 'Bien utilisé' }
    case 'low':
      return { variant: 'amber', label: 'Sous-utilisé' }
    case 'high':
      return { variant: 'sky', label: 'Sur-sollicité' }
    case 'critical':
      return { variant: 'rose', label: 'Critique' }
  }
}

function loadTooltip(status: OfficialLoadStatus): string {
  const t = thresholds.value
  switch (status) {
    case 'ok':
      return `Cible : ${t.min}–${t.max} matchs confirmés cette saison.`
    case 'low':
      return `Moins de ${t.min} matchs confirmés (cible : ${t.target}).`
    case 'high':
      return `Au-delà de ${t.target} matchs confirmés (limite saine : ${t.max}).`
    case 'critical':
      return `Aucun match confirmé ou plus de ${t.max} matchs — action requise.`
  }
}

/** Label texte de la charge — réutilisé pour le CSV. */
function loadLabel(status: OfficialLoadStatus): string {
  return loadPill(status).label
}

// ---------------------------------------------------------------------------
// Pill licence — Active / Aucune (qualifié seulement).
// ---------------------------------------------------------------------------

interface LicensePillDef {
  variant: PillVariant
  label: string
}

function licensePill(row: OfficialMetricsRow): LicensePillDef {
  if (row.hasActiveOfficialLicenseThisSeason) {
    return { variant: 'emerald', label: 'Active' }
  }
  return { variant: 'slate', label: 'Aucune' }
}

// ---------------------------------------------------------------------------
// Chips de filtre — charge (low/ok/high/critical).
// ---------------------------------------------------------------------------

interface ChipDef {
  id: OfficialsQuickFilter
  label: string
  badgeClass?: string
}

const CHIPS: readonly ChipDef[] = [
  { id: 'all', label: 'Tous' },
  { id: 'low', label: 'Sous-utilisés', badgeClass: 'text-amber-600' },
  { id: 'ok', label: 'Bien' },
  { id: 'high', label: 'Sur-sollicités', badgeClass: 'text-sky-600' },
  { id: 'critical', label: 'Critique', badgeClass: 'text-rose-600' },
] as const

// ---------------------------------------------------------------------------
// Chips actif / inactif — "Actifs cette saison" par défaut.
// ---------------------------------------------------------------------------

interface ActiveChipDef {
  id: OfficialsActiveFilter
  label: string
}

const ACTIVE_CHIPS: readonly ActiveChipDef[] = [
  { id: 'active', label: 'Actifs cette saison' },
  { id: 'all', label: 'Tous (qualifiés)' },
] as const

// ---------------------------------------------------------------------------
// Stat cards (4) — Actifs / Confirmés / Last-minute / Remplacements.
// ---------------------------------------------------------------------------

interface StatCard {
  label: string
  value: number
  icon: typeof ShieldCheck
  iconClass: string
  highlight?: boolean
}

const STAT_CARDS = computed<StatCard[]>(() => [
  {
    label: 'Officiels actifs',
    value: summary.value.activeCount,
    icon: Gavel,
    iconClass: 'text-emerald-700 bg-emerald-50',
  },
  {
    label: 'Confirmés cumul saison',
    value: summary.value.confirmedTotal,
    icon: ShieldCheck,
    iconClass: 'text-sky-700 bg-sky-50',
  },
  {
    label: 'Pris last-minute',
    value: summary.value.lastMinuteTotal,
    icon: Clock,
    iconClass: 'text-amber-700 bg-amber-50',
    highlight: summary.value.lastMinuteTotal > 0,
  },
  {
    label: 'Remplacements demandés',
    value: summary.value.replacementsTotal,
    icon: Repeat2,
    iconClass: 'text-rose-700 bg-rose-50',
    highlight: summary.value.replacementsTotal > 0,
  },
])

// ---------------------------------------------------------------------------
// MiniBar — progression dans la bande [0, max × 1.1] avec target et limite.
// ---------------------------------------------------------------------------

function miniBarRatio(confirmed: number): number {
  const ceil = Math.max(1, Math.round(thresholds.value.max * 1.1))
  return confirmed / ceil
}

function miniBarColor(status: OfficialLoadStatus): string {
  switch (status) {
    case 'ok':
      return '#10b981' // emerald-500
    case 'low':
      return '#f59e0b' // amber-500
    case 'high':
      return '#0ea5e9' // sky-500
    case 'critical':
    default:
      return '#f43f5e' // rose-500
  }
}

function fullName(o: OfficialMetricsRow): string {
  return `${o.firstName} ${o.lastName}`
}

// ---------------------------------------------------------------------------
// Export CSV — généré côté client à partir de `store.visibleOfficials`.
// L'export reflète la sélection courante (active vs all) pour aligner les
// chiffres entre le CSV et les stat cards.
// ---------------------------------------------------------------------------

const canExport = computed(() => store.visibleOfficials.length > 0)

/** Échappe un champ CSV : guillemets doublés, encadrement si caractère spécial. */
function csvField(value: string | number | null): string {
  const raw = value === null ? '' : String(value)
  if (/[",\r\n;]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`
  }
  return raw
}

function exportCsv(): void {
  if (!canExport.value) return

  const headers = [
    'Nom',
    'Niveau',
    'N° licence',
    'Licence saison',
    'Assignations',
    'Confirmés',
    'En attente',
    'Déclinés',
    'Last-minute',
    'Remplacements demandés',
    'Statut de charge',
  ]

  const lines = store.visibleOfficials.map((o) =>
    [
      csvField(fullName(o)),
      csvField(o.officialLevel !== null ? `L${o.officialLevel}` : '—'),
      csvField(o.licenseNumber ?? ''),
      csvField(o.hasActiveOfficialLicenseThisSeason ? 'Active' : 'Aucune'),
      csvField(o.assignmentsThisSeason),
      csvField(o.confirmedThisSeason),
      csvField(o.pendingThisSeason),
      csvField(o.declinedThisSeason),
      csvField(o.lastMinuteThisSeason),
      csvField(o.replacementsRequestedThisSeason),
      csvField(loadLabel(o.loadStatus)),
    ].join(','),
  )

  // BOM UTF-8 pour qu'Excel interprète correctement les accents.
  const content = '﻿' + [headers.join(','), ...lines].join('\r\n')
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'officiels-saison.csv'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="space-y-4">
    <!-- ================= Tab heading + export =================== -->
    <div class="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h2 class="text-[16px] font-semibold tracking-tight">
          Officiels de la saison
        </h2>
        <p class="text-[13px] text-surface-500 mt-0.5">
          {{ summary.activeCount }} actifs sur {{ summary.totalCount }} qualifiés ·
          seuils {{ thresholds.min }}–{{ thresholds.max }} matchs / saison
        </p>
      </div>
      <Button
        type="button"
        size="small"
        severity="secondary"
        outlined
        :disabled="!canExport"
        label="Exporter (CSV)"
        @click="exportCsv"
      >
        <template #icon>
          <Download
            :size="14"
            :stroke-width="2"
            class="mr-1.5"
          />
        </template>
      </Button>
    </div>

    <!-- ================= Stat cards =================== -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <div
        v-for="card in STAT_CARDS"
        :key="card.label"
        class="card text-left px-4 py-3"
        :class="card.highlight ? 'ring-1 ring-amber-200' : ''"
      >
        <div class="flex items-start justify-between gap-2">
          <div>
            <div class="text-[12px] text-surface-500">
              {{ card.label }}
            </div>
            <div class="text-[22px] font-semibold tracking-tight num mt-1">
              {{ card.value }}
            </div>
          </div>
          <span
            class="w-8 h-8 rounded-md inline-flex items-center justify-center"
            :class="card.iconClass"
          >
            <component
              :is="card.icon"
              :size="16"
              :stroke-width="2"
            />
          </span>
        </div>
      </div>
    </div>

    <!-- ================= No active season =================== -->
    <div
      v-if="!hasActiveSeason && !store.loading"
      class="card border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800 flex items-center gap-2"
    >
      <TriangleAlert
        :size="14"
        :stroke-width="2"
      />
      Aucune saison active. Activez une saison pour mesurer la charge et les
      métriques de tracking.
    </div>

    <!-- ================= Filtres : actifs/all + charge =================== -->
    <div class="flex flex-col gap-2">
      <!-- Active / All -->
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold mr-1">
          Périmètre
        </span>
        <Chip
          v-for="chip in ACTIVE_CHIPS"
          :key="chip.id"
          :active="store.activeFilter === chip.id"
          :aria-pressed="store.activeFilter === chip.id"
          @click="store.setActiveFilter(chip.id)"
        >
          {{ chip.label }}
        </Chip>
      </div>
      <!-- Charge -->
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold mr-1">
          Charge
        </span>
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
    </div>

    <!-- ================= DataTable =================== -->
    <div class="card overflow-hidden">
      <DataTable
        :value="rows"
        :loading="store.loading"
        size="small"
        data-key="id"
        striped-rows
        class="text-[13px]"
      >
        <template #empty>
          <!-- Distinction "club vide" (1ʳᵉ utilisation) vs "filtre vide". -->
          <div
            v-if="!store.loading && store.officials.length === 0"
            class="px-3 py-10 text-center flex flex-col items-center gap-2"
          >
            <span
              class="w-10 h-10 rounded-full bg-surface-100 inline-flex items-center justify-center text-surface-500"
            >
              <Gavel
                :size="18"
                :stroke-width="2"
              />
            </span>
            <div class="text-[14px] font-semibold">
              Aucun officiel pour l'instant
            </div>
            <div class="text-[12px] text-surface-500 max-w-md">
              Marquez un membre comme "official" depuis la page Members pour
              le voir apparaître ici.
            </div>
          </div>
          <div
            v-else-if="store.loading && store.officials.length === 0"
            class="px-3 py-10 text-center text-[12px] text-surface-500"
            aria-busy="true"
          >
            Chargement des officials…
          </div>
          <div
            v-else
            class="px-3 py-10 text-center text-[12px] text-surface-500"
          >
            Aucun officiel ne correspond à ce filtre.
          </div>
        </template>

        <Column
          field="lastName"
          header="Nom"
          sortable
        >
          <template #body="{ data }: { data: OfficialMetricsRow }">
            <div class="flex items-center gap-2.5">
              <Avatar
                :name="fullName(data)"
                :size="28"
              />
              <div class="leading-tight">
                <div
                  class="font-medium"
                  :class="data.active ? '' : 'line-through text-surface-500'"
                >
                  {{ fullName(data) }}
                </div>
                <div
                  v-if="data.licenseNumber"
                  class="text-[11px] text-surface-500 font-mono"
                >
                  {{ data.licenseNumber }}
                </div>
              </div>
            </div>
          </template>
        </Column>

        <Column
          field="officialLevel"
          header="Niveau"
          sortable
          :pt="{
            headerCell: { style: 'width: 88px', class: 'text-center' },
            bodyCell: { class: 'text-center' },
          }"
        >
          <template #body="{ data }: { data: OfficialMetricsRow }">
            <Pill
              v-if="data.officialLevel !== null"
              variant="emerald"
              class="num"
            >
              L{{ data.officialLevel }}
            </Pill>
            <span
              v-else
              class="text-surface-400"
            >—</span>
          </template>
        </Column>

        <Column
          header="Licence"
          :pt="{
            headerCell: { style: 'width: 96px', class: 'text-center' },
            bodyCell: { class: 'text-center' },
          }"
        >
          <template #body="{ data }: { data: OfficialMetricsRow }">
            <Pill
              :variant="licensePill(data).variant"
              :title="data.hasActiveOfficialLicenseThisSeason ? 'Licence officiel active cette saison' : 'Pas de licence officiel active cette saison'"
            >
              {{ licensePill(data).label }}
            </Pill>
          </template>
        </Column>

        <Column
          field="confirmedThisSeason"
          header="Confirmés"
          sortable
          :pt="{
            headerCell: { style: 'width: 96px', class: 'text-right' },
            bodyCell: { class: 'text-right num' },
          }"
        >
          <template #body="{ data }: { data: OfficialMetricsRow }">
            <span :class="data.confirmedThisSeason === 0 ? 'text-rose-600' : ''">
              {{ data.confirmedThisSeason }}
            </span>
          </template>
        </Column>

        <Column
          field="pendingThisSeason"
          header="En attente"
          sortable
          :pt="{
            headerCell: { style: 'width: 96px', class: 'text-right' },
            bodyCell: { class: 'text-right num' },
          }"
        >
          <template #body="{ data }: { data: OfficialMetricsRow }">
            <span :class="data.pendingThisSeason > 0 ? 'text-amber-700' : 'text-surface-500'">
              {{ data.pendingThisSeason }}
            </span>
          </template>
        </Column>

        <Column
          field="declinedThisSeason"
          header="Déclinés"
          sortable
          :pt="{
            headerCell: { style: 'width: 88px', class: 'text-right' },
            bodyCell: { class: 'text-right num' },
          }"
        >
          <template #body="{ data }: { data: OfficialMetricsRow }">
            <span :class="data.declinedThisSeason > 0 ? 'text-rose-600' : 'text-surface-500'">
              {{ data.declinedThisSeason }}
            </span>
          </template>
        </Column>

        <Column
          field="lastMinuteThisSeason"
          header="Last-minute"
          sortable
          :pt="{
            headerCell: { style: 'width: 110px', class: 'text-right' },
            bodyCell: { class: 'text-right num' },
          }"
        >
          <template #body="{ data }: { data: OfficialMetricsRow }">
            <Pill
              v-if="data.lastMinuteThisSeason > 0"
              variant="amber"
              :title="`${data.lastMinuteThisSeason} match(s) pris à la dernière minute (< 48 h avant le coup d'envoi).`"
              class="num"
            >
              <Clock
                :size="11"
                :stroke-width="2"
                class="-ml-0.5"
              />
              {{ data.lastMinuteThisSeason }}
            </Pill>
            <span
              v-else
              class="text-surface-400"
            >0</span>
          </template>
        </Column>

        <Column
          field="replacementsRequestedThisSeason"
          header="Remplacements"
          sortable
          :pt="{
            headerCell: { style: 'width: 124px', class: 'text-right' },
            bodyCell: { class: 'text-right num' },
          }"
        >
          <template #body="{ data }: { data: OfficialMetricsRow }">
            <Pill
              v-if="data.replacementsRequestedThisSeason > 0"
              variant="rose"
              :title="`${data.replacementsRequestedThisSeason} remplacement(s) demandé(s) sur la saison.`"
              class="num"
            >
              <Repeat2
                :size="11"
                :stroke-width="2"
                class="-ml-0.5"
              />
              {{ data.replacementsRequestedThisSeason }}
            </Pill>
            <span
              v-else
              class="text-surface-400"
            >0</span>
          </template>
        </Column>

        <Column
          header="Charge"
          :pt="{ headerCell: { style: 'width: 200px' } }"
        >
          <template #body="{ data }: { data: OfficialMetricsRow }">
            <div class="flex flex-col gap-1.5">
              <div class="flex items-center gap-2">
                <Pill
                  :variant="loadPill(data.loadStatus).variant"
                  :title="loadTooltip(data.loadStatus)"
                >
                  {{ loadPill(data.loadStatus).label }}
                </Pill>
              </div>
              <MiniBar
                :value="miniBarRatio(data.confirmedThisSeason)"
                :color="miniBarColor(data.loadStatus)"
                :height="4"
              />
            </div>
          </template>
        </Column>

        <Column
          header="Charge"
          :pt="{
            headerCell: { style: 'width: 88px', class: 'sr-only' },
          }"
        >
          <template #header>
            <span class="sr-only">Charge — icône</span>
          </template>
          <template #body="{ data }: { data: OfficialMetricsRow }">
            <div class="flex justify-end">
              <ArrowDownRight
                v-if="data.loadStatus === 'low'"
                :size="14"
                :stroke-width="2"
                class="text-amber-600"
                aria-label="Sous-utilisé"
              />
              <ArrowUpRight
                v-else-if="data.loadStatus === 'high'"
                :size="14"
                :stroke-width="2"
                class="text-sky-600"
                aria-label="Sur-sollicité"
              />
              <span
                v-else-if="data.loadStatus === 'critical'"
                class="text-rose-600 text-[11px] num"
                aria-label="Critique"
              >!</span>
              <span
                v-else
                class="sr-only"
              >Bien utilisé</span>
            </div>
          </template>
        </Column>
      </DataTable>

      <!-- Footer : count -->
      <div
        class="flex items-center justify-between border-t border-surface-200 px-4 h-11 text-[12px] text-surface-500"
      >
        <div>
          <template v-if="store.loading && rows.length === 0">
            Chargement…
          </template>
          <template v-else>
            {{ rows.length }} sur {{ store.visibleOfficials.length }}
            officiel<span v-if="store.visibleOfficials.length > 1">s</span>
            {{ store.activeFilter === 'active' ? 'actif(s)' : 'qualifié(s)' }}
          </template>
        </div>
      </div>
    </div>

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

    <!-- ================= TODO Phase suivante =================== -->
    <!--
      TODO (Phase courtbase-app coach/officiel mobile) — actions à câbler :
      1. Bouton "Demander un remplacement" côté courtbase-app sur les
         assignations confirmed de l'officiel courant. Le repo `officials.repo`
         expose déjà `requestReplacement({ parentKind, parentId, assignmentId,
         requestedByUid })` côté apps/web — port à faire dans la couche
         repos/store de courtbase-app.
      2. Action admin "Marquer en retard pendant le match" (présence) pour
         tracker la ponctualité (cf. spec produit Eliot — "par la suite").
         Nécessitera un champ supplémentaire sur `OfficialAssignmentData`
         (ex. `arrivedLateAt: Timestamp | null`) + rule + une action admin
         dans le drawer.
    -->
  </div>
</template>
