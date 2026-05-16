<script setup lang="ts">
import { computed, onMounted } from 'vue'
import {
  ArrowDownRight,
  ArrowUpRight,
  Download,
  Gavel,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-vue-next'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import {
  useOfficialsStore,
  type OfficialsQuickFilter,
} from '@/stores/officials'
import type {
  OfficialLoadStatus,
  OfficialRow,
} from '@/repositories/officials.repo'
import Avatar from '@/components/ui/Avatar.vue'
import Chip from '@/components/ui/Chip.vue'
import MiniBar from '@/components/ui/MiniBar.vue'
import Pill from '@/components/ui/Pill.vue'

/**
 * Onglet "Officiels" de la page `/officials` — tableau de bord rentabilité.
 *
 * Contenu extrait tel quel de l'ancienne vue `Officials.vue` (stat cards,
 * chips de filtre, DataTable, bannières). Ajout : export CSV de la liste de
 * la saison côté client (Blob + lien `<a download>`).
 */

const store = useOfficialsStore()

onMounted(() => {
  void store.load()
})

const rows = computed<OfficialRow[]>(() => store.filtered)
const counts = computed(() => store.counts)
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
// Chips
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
// Stat cards (4) — Total / Sous-utilisés / Bien / Sur-sollicités.
//
// "Critique" est volontairement omis du tuilage (4 cartes pour rester
// lisible) ; il reste accessible via le chip dédié.
// ---------------------------------------------------------------------------

interface StatCard {
  id: OfficialsQuickFilter
  label: string
  value: number
  icon: typeof ShieldCheck
  iconClass: string
}

const STAT_CARDS = computed<StatCard[]>(() => [
  {
    id: 'all',
    label: 'Total officials',
    value: counts.value.all,
    icon: Gavel,
    iconClass: 'text-surface-500 bg-surface-100',
  },
  {
    id: 'low',
    label: 'Sous-utilisés',
    value: counts.value.low,
    icon: ArrowDownRight,
    iconClass: 'text-amber-700 bg-amber-50',
  },
  {
    id: 'ok',
    label: 'Bien utilisés',
    value: counts.value.ok,
    icon: ShieldCheck,
    iconClass: 'text-emerald-700 bg-emerald-50',
  },
  {
    id: 'high',
    label: 'Sur-sollicités',
    value: counts.value.high,
    icon: ArrowUpRight,
    iconClass: 'text-sky-700 bg-sky-50',
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

function fullName(o: OfficialRow): string {
  return `${o.firstName} ${o.lastName}`
}

// ---------------------------------------------------------------------------
// Export CSV — généré côté client à partir de `store.officials`.
// ---------------------------------------------------------------------------

const canExport = computed(() => store.officials.length > 0)

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
    'Assignations',
    'Confirmés',
    'En attente',
    'Déclinés',
    'Statut de charge',
  ]

  const lines = store.officials.map((o) =>
    [
      csvField(fullName(o)),
      csvField(o.officialLevel !== null ? `L${o.officialLevel}` : '—'),
      csvField(o.licenseNumber ?? ''),
      csvField(o.assignmentsThisSeason),
      csvField(o.confirmedThisSeason),
      csvField(o.pendingThisSeason),
      csvField(o.declinedThisSeason),
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
          Rentabilité des officiels
        </h2>
        <p class="text-[13px] text-surface-500 mt-0.5">
          {{ counts.all }} officiels · seuils {{ thresholds.min }}–{{ thresholds.max }} matchs / saison
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
      <button
        v-for="card in STAT_CARDS"
        :key="card.id"
        type="button"
        class="card text-left px-4 py-3 hover:bg-surface-50 transition-colors"
        :class="store.quickFilter === card.id ? 'ring-1 ring-emerald-200' : ''"
        @click="store.setQuickFilter(card.id)"
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
      </button>
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
      Aucune saison active. Activez une saison pour mesurer la charge.
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
          <template #body="{ data }: { data: OfficialRow }">
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
            headerCell: { style: 'width: 96px', class: 'text-center' },
            bodyCell: { class: 'text-center' },
          }"
        >
          <template #body="{ data }: { data: OfficialRow }">
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
          field="assignmentsThisSeason"
          header="Assignations"
          sortable
          :pt="{
            headerCell: { style: 'width: 120px', class: 'text-right' },
            bodyCell: { class: 'text-right num' },
          }"
        >
          <template #body="{ data }: { data: OfficialRow }">
            {{ data.assignmentsThisSeason }}
          </template>
        </Column>

        <Column
          field="confirmedThisSeason"
          header="Confirmés"
          sortable
          :pt="{
            headerCell: { style: 'width: 104px', class: 'text-right' },
            bodyCell: { class: 'text-right num' },
          }"
        >
          <template #body="{ data }: { data: OfficialRow }">
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
            headerCell: { style: 'width: 104px', class: 'text-right' },
            bodyCell: { class: 'text-right num' },
          }"
        >
          <template #body="{ data }: { data: OfficialRow }">
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
            headerCell: { style: 'width: 96px', class: 'text-right' },
            bodyCell: { class: 'text-right num' },
          }"
        >
          <template #body="{ data }: { data: OfficialRow }">
            <span :class="data.declinedThisSeason > 0 ? 'text-rose-600' : 'text-surface-500'">
              {{ data.declinedThisSeason }}
            </span>
          </template>
        </Column>

        <Column
          header="Charge"
          :pt="{ headerCell: { style: 'width: 220px' } }"
        >
          <template #body="{ data }: { data: OfficialRow }">
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
            {{ rows.length }} sur {{ counts.all }} officiel<span v-if="counts.all > 1">s</span>
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
  </div>
</template>
