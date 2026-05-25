<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  Archive,
  CalendarRange,
  Check,
  Copy,
  Eye,
  MapPin,
  Plus,
  Search,
  TriangleAlert,
} from 'lucide-vue-next'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import { useSeasonsStore, type SeasonQuickFilter } from '@/stores/seasons'
import type { SeasonRow } from '@/repositories/seasons.repo'
import type { SeasonStatus, Timestamp } from '@club-app/shared-types'
import Chip from '@/components/ui/Chip.vue'
import Pill from '@/components/ui/Pill.vue'

/**
 * Vue Seasons — liste/CRUD des saisons du club.
 *
 * Scope (cf. brief Eliot) :
 *  - PAS la grille hebdo Season grid (#6 du design-brief, route `/season-grid`
 *    qui n'existe pas encore — TODO route à part).
 *  - PAS le dry-run d'activation (#7, écran dédié — TODO à part).
 *  - CETTE page : liste des saisons (past / current / future), filtres par
 *    statut, actions Activer / Archiver / Dupliquer + bouton "Nouvelle saison".
 *
 * Le design-brief n'a pas de mockup dédié à la *liste* des saisons (#7 montre
 * uniquement la preview d'activation, pas l'index). On adopte donc le pattern
 * Members : page header + chips de filtre par statut + DataTable.
 */

const store = useSeasonsStore()
const router = useRouter()

onMounted(() => {
  void store.load()
})

const rows = computed<SeasonRow[]>(() => store.filtered)
const counts = computed(() => store.counts)
const activeSeason = computed(() => store.activeSeason)

// ---------------------------------------------------------------------------
// Heading subline — "X saisons · 1 active · 3 draft · 2 archivées".
// ---------------------------------------------------------------------------

const headingSubline = computed(() => {
  const c = counts.value
  const parts: string[] = [`${c.all} saison${c.all > 1 ? 's' : ''}`]
  if (c.active > 0) parts.push(`${c.active} active`)
  if (c.draft > 0) parts.push(`${c.draft} brouillon${c.draft > 1 ? 's' : ''}`)
  if (c.archived > 0)
    parts.push(`${c.archived} archivée${c.archived > 1 ? 's' : ''}`)
  return parts.join(' · ')
})

// ---------------------------------------------------------------------------
// Quick filter chips — déclaratif, drive le store.
// ---------------------------------------------------------------------------

interface ChipDef {
  id: SeasonQuickFilter
  label: string
}

const CHIPS: readonly ChipDef[] = [
  { id: 'all', label: 'Toutes' },
  { id: 'active', label: 'Active' },
  { id: 'draft', label: 'Brouillon' },
  { id: 'archived', label: 'Archivées' },
] as const

// ---------------------------------------------------------------------------
// Status pill — variant + label depuis SeasonStatus.
// ---------------------------------------------------------------------------

type PillVariant = 'emerald' | 'sky' | 'amber' | 'rose' | 'slate' | 'violet'

interface StatusPillDef {
  variant: PillVariant
  label: string
}

function statusPill(status: SeasonStatus): StatusPillDef {
  switch (status) {
    case 'active':
      return { variant: 'emerald', label: 'active' }
    case 'draft':
      return { variant: 'amber', label: 'brouillon' }
    case 'archived':
    default:
      return { variant: 'slate', label: 'archivée' }
  }
}

// ---------------------------------------------------------------------------
// Date formatters — locale fr-CH, dates en Timestamp (seconds) côté schéma.
// ---------------------------------------------------------------------------

const shortDateFormatter = new Intl.DateTimeFormat('fr-CH', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

function timestampToDate(t: Timestamp): Date {
  return new Date(t.seconds * 1000)
}

function formatDate(t: Timestamp): string {
  return shortDateFormatter.format(timestampToDate(t))
}

function formatRange(start: Timestamp, end: Timestamp): string {
  return `${formatDate(start)} → ${formatDate(end)}`
}

// ---------------------------------------------------------------------------
// Coverage / bookings density — utilisé pour la colonne "Bookings".
// ---------------------------------------------------------------------------

/** Approximation : nb de semaines entre start/end (∼42 pour une saison). */
function weeksInRange(start: Timestamp, end: Timestamp): number {
  const ms = end.seconds * 1000 - start.seconds * 1000
  const weeks = ms / (7 * 24 * 60 * 60 * 1000)
  return Math.max(1, Math.round(weeks))
}

function bookingsPerWeek(row: SeasonRow): string {
  if (row.bookingsCount === 0) return '—'
  const perWeek = row.bookingsCount / weeksInRange(row.startDate, row.endDate)
  return `≈ ${perWeek.toFixed(1)} / sem.`
}

// ---------------------------------------------------------------------------
// Action helpers — chacune route vers le store (optimistic mutation).
//
// Activation : flip direct du status `draft → active`. Pas de preview/dry-run :
// les bookings ne sont plus générés automatiquement, ils sont ajoutés
// manuellement via le wizard `/bookings` (option "Jusqu'à la fin de la
// saison"). Voir docs/main.md → Season lifecycle.
// ---------------------------------------------------------------------------

function isPending(row: SeasonRow): boolean {
  return store.pendingActionFor === row.id
}

function onActivate(row: SeasonRow): void {
  void store.activate(row.id)
}

function onArchive(row: SeasonRow): void {
  void store.archive(row.id)
}

function onDuplicate(row: SeasonRow): void {
  void store.duplicate(row.id)
}

function onView(_row: SeasonRow): void {
  // TODO(route): ouvrir /seasons/:id (drawer ou page détail). Pas dans le
  // router aujourd'hui — voir CLAUDE.md root, on ne crée pas la route
  // tant qu'elle n'est pas dans le brief.
}

function onNewSeason(): void {
  // B3 (Eliot, 12 mai 2026) : route dédiée vers le wizard 4-étapes (cf.
  // design `Courtbase Onboarding.html` template "season-config").
  void router.push({ name: 'season-new' })
}
</script>

<template>
  <section class="p-6 space-y-4">
    <!-- ================= Page heading =================== -->
    <div class="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-[22px] font-semibold tracking-tight">
          Saisons
        </h1>
        <p class="text-[13px] text-surface-500 mt-0.5">
          {{ headingSubline }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="btn btn-primary btn-sm"
          @click="onNewSeason"
        >
          <Plus
            :size="14"
            :stroke-width="2"
          />
          Nouvelle saison
        </button>
      </div>
    </div>

    <!-- ================= Active season banner =================== -->
    <!-- Le design met l'accent "saison X" partout (Dashboard, Officials,
         Dues) ; on offre ici un rappel visuel de la saison active pour que
         l'admin la repère en un coup d'œil. -->
    <div
      v-if="activeSeason"
      class="card border-emerald-200 bg-emerald-50/60 px-4 py-3 flex items-center gap-3 flex-wrap"
    >
      <span
        class="w-8 h-8 rounded-md2 inline-flex items-center justify-center bg-emerald-100 text-emerald-700 shrink-0"
      >
        <CalendarRange
          :size="16"
          :stroke-width="2"
        />
      </span>
      <div class="flex-1 min-w-0">
        <div class="text-[13px] font-semibold text-emerald-900">
          {{ activeSeason.name }} — saison active
        </div>
        <div class="text-[12px] text-emerald-800/80 mt-0.5">
          {{ formatRange(activeSeason.startDate, activeSeason.endDate) }}
          · {{ activeSeason.teamsCount }} équipes
          · <span class="num">{{ activeSeason.bookingsCount }}</span> réservations générées
        </div>
      </div>
      <Pill
        variant="emerald"
        class="num"
      >
        <Check
          :size="11"
          :stroke-width="2"
        />
        active
      </Pill>
    </div>

    <!-- ================= Filter chips row =================== -->
    <div class="flex items-center gap-2 flex-wrap">
      <Chip
        v-for="chip in CHIPS"
        :key="chip.id"
        :active="store.quickFilter === chip.id"
        :aria-pressed="store.quickFilter === chip.id"
        @click="store.setQuickFilter(chip.id)"
      >
        {{ chip.label }}
        <span class="ml-1 text-[11px] num">{{ counts[chip.id] }}</span>
      </Chip>

      <div class="ml-auto flex items-center gap-2">
        <div class="input-wrap w-72">
          <Search />
          <input
            class="input input-with-icon !h-8"
            placeholder="Nom de saison, salle…"
            :value="store.search"
            @input="store.setSearch(($event.target as HTMLInputElement).value)"
          >
        </div>
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
          <div class="px-3 py-10 text-center text-[12px] text-surface-500">
            Aucune saison ne correspond à vos filtres.
          </div>
        </template>

        <Column
          field="name"
          header="Saison"
          sortable
        >
          <template #body="{ data }">
            <div class="flex items-center gap-2.5">
              <span
                class="w-7 h-7 rounded-md2 inline-flex items-center justify-center bg-surface-100 text-surface-600 shrink-0"
              >
                <CalendarRange
                  :size="14"
                  :stroke-width="2"
                />
              </span>
              <div class="leading-tight">
                <div class="font-medium">
                  {{ data.name }}
                </div>
                <div class="text-[11px] text-surface-500">
                  {{ formatRange(data.startDate, data.endDate) }}
                </div>
              </div>
            </div>
          </template>
        </Column>

        <Column
          header="Période"
          :pt="{ headerCell: { style: 'width: 200px' } }"
        >
          <template #body="{ data }">
            <div class="text-[12px] num">
              {{ formatRange(data.startDate, data.endDate) }}
            </div>
          </template>
        </Column>

        <Column
          header="Statut"
          :pt="{ headerCell: { style: 'width: 120px' } }"
        >
          <template #body="{ data }">
            <Pill :variant="statusPill(data.status).variant">
              {{ statusPill(data.status).label }}
            </Pill>
          </template>
        </Column>

        <Column
          header="Salles"
          :pt="{ headerCell: { style: 'width: 200px' } }"
        >
          <template #body="{ data }">
            <div
              v-if="data.venueLabels.length === 0"
              class="text-surface-400"
            >
              —
            </div>
            <div
              v-else
              class="flex flex-wrap items-center gap-1"
            >
              <Pill
                v-for="venue in data.venueLabels"
                :key="venue"
                variant="slate"
              >
                <MapPin
                  :size="10"
                  :stroke-width="2"
                />
                {{ venue }}
              </Pill>
            </div>
          </template>
        </Column>

        <Column
          header="Équipes"
          :pt="{
            headerCell: { style: 'width: 80px', class: 'text-center' },
            bodyCell: { class: 'text-center' },
          }"
        >
          <template #body="{ data }">
            <span class="num font-medium">{{ data.teamsCount }}</span>
          </template>
        </Column>

        <Column
          header="Réservations"
          :pt="{ headerCell: { style: 'width: 140px' } }"
        >
          <template #body="{ data }">
            <div
              v-if="data.bookingsCount === 0"
              class="text-surface-400"
            >
              —
            </div>
            <div
              v-else
              class="leading-tight"
            >
              <div class="num font-medium">
                {{ data.bookingsCount }}
              </div>
              <div class="text-[11px] text-surface-500 num">
                {{ bookingsPerWeek(data) }}
              </div>
            </div>
          </template>
        </Column>

        <Column
          header="Actions"
          :pt="{
            headerCell: { style: 'width: 220px', class: 'text-right' },
            bodyCell: { class: 'text-right' },
          }"
        >
          <template #body="{ data }">
            <div class="inline-flex items-center gap-1 justify-end">
              <!-- Activer : seulement si draft -->
              <button
                v-if="data.status === 'draft'"
                type="button"
                class="btn btn-primary btn-sm"
                :disabled="isPending(data)"
                @click="onActivate(data)"
              >
                <Check
                  :size="12"
                  :stroke-width="2"
                />
                Activer
              </button>

              <!-- Voir : toujours dispo (placeholder route) -->
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                :title="'Voir détail (TODO route)'"
                @click="onView(data)"
              >
                <Eye
                  :size="12"
                  :stroke-width="2"
                />
              </button>

              <!-- Dupliquer : toujours dispo (utile pour fonder la suivante) -->
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                :disabled="isPending(data)"
                :title="'Dupliquer cette saison'"
                @click="onDuplicate(data)"
              >
                <Copy
                  :size="12"
                  :stroke-width="2"
                />
              </button>

              <!-- Archiver : seulement si active -->
              <button
                v-if="data.status === 'active'"
                type="button"
                class="btn btn-secondary btn-sm"
                :disabled="isPending(data)"
                :title="'Archiver'"
                @click="onArchive(data)"
              >
                <Archive
                  :size="12"
                  :stroke-width="2"
                />
              </button>
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
            {{ rows.length }} sur {{ counts.all }} saison<span v-if="rows.length > 1">s</span>
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
  </section>
</template>
