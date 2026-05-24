<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  CalendarDays,
  Clock,
  History,
  MapPin,
  Plus,
  Search,
  Swords,
  Trash2,
  TriangleAlert,
  Users,
} from 'lucide-vue-next'
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable, { type DataTableRowClickEvent } from 'primevue/datatable'
import Drawer from 'primevue/drawer'
import InputText from 'primevue/inputtext'
import { useBookingsStore } from '@/stores/bookings'
import { useMatchesStore } from '@/stores/matches'
import type { MatchRow } from '@/repositories/matches.repo'
import Chip from '@/components/ui/Chip.vue'
import Pill from '@/components/ui/Pill.vue'
import MatchFormDialog from '@/components/matches/MatchFormDialog.vue'

/**
 * Page `/matches` — liste des matchs de la saison.
 *
 * Source : `useMatchesStore().matches` (collection racine `/matches`, livrée
 * Chantier C). On ne filtre plus `allBookings` — chaque match est désormais un
 * doc dédié avec dénormalisations (teamName, matchTypeName, venueName,
 * courtName) résolues côté repo.
 *
 * Pour la bannière "saison inactive", on lit toujours `useBookingsStore` (qui
 * porte `activeSeasonId` + `loadActiveContext`). Le store matches.load() ne
 * dépend pas de la saison côté Firestore — il liste tous les matches.
 */

const matchesStore = useMatchesStore()
const bookingsStore = useBookingsStore()

// ---------------------------------------------------------------------------
// Init — charge les matchs (et la saison via bookings store pour le garde
// "saison inactive").
// ---------------------------------------------------------------------------

onMounted(async () => {
  if (!bookingsStore.activeSeason) {
    await bookingsStore.loadActiveContext()
  }
  if (matchesStore.matches.length === 0) {
    await matchesStore.load()
  }
})

// ---------------------------------------------------------------------------
// Source — `matches` du store.
// ---------------------------------------------------------------------------

const matchesAll = computed<MatchRow[]>(() => matchesStore.matches)

// ---------------------------------------------------------------------------
// Date helpers — Timestamp neutre sans .toDate().
// ---------------------------------------------------------------------------

function matchDateMillis(m: MatchRow): number {
  // any: Timestamp neutre de shared-types n'expose pas `.toDate()`. On lit
  // `seconds` (présent sur les deux représentations Timestamp).
  const ts = m.date as unknown as { seconds: number; toDate?: () => Date }
  if (typeof ts.toDate === 'function') return ts.toDate().getTime()
  return ts.seconds * 1000
}

function startOfTodayMs(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// ---------------------------------------------------------------------------
// Filtres — chips rapides + recherche locale.
// ---------------------------------------------------------------------------

type MatchQuickFilter = 'all' | 'upcoming' | 'past' | 'home' | 'away' | 'cancelled'

interface ChipDef {
  id: MatchQuickFilter
  label: string
}

const CHIPS: readonly ChipDef[] = [
  { id: 'all', label: 'Tous' },
  { id: 'upcoming', label: 'À venir' },
  { id: 'past', label: 'Passés' },
  { id: 'home', label: 'À domicile' },
  { id: 'away', label: "À l'extérieur" },
  { id: 'cancelled', label: 'Annulés' },
] as const

const quickFilter = ref<MatchQuickFilter>('all')
const search = ref<string>('')

function setQuickFilter(id: MatchQuickFilter): void {
  quickFilter.value = id
}

/** Counts par chip — calculé sur l'ensemble `matchesAll` (non filtré). */
const counts = computed(() => {
  const todayMs = startOfTodayMs()
  let upcoming = 0
  let past = 0
  let home = 0
  let away = 0
  let cancelled = 0
  for (const m of matchesAll.value) {
    if (m.status === 'cancelled') cancelled += 1
    if (m.kind === 'home') home += 1
    if (m.kind === 'away') away += 1
    const ms = matchDateMillis(m)
    if (ms < todayMs) {
      past += 1
    } else if (m.status === 'scheduled') {
      upcoming += 1
    }
  }
  return {
    all: matchesAll.value.length,
    upcoming,
    past,
    home,
    away,
    cancelled,
  }
})

/**
 * Subline — compte les matchs joués / annulés / à venir. "Joués" = scheduled
 * dans le passé (un match passé sans annulation est considéré joué).
 */
const headingSubline = computed<string>(() => {
  const todayMs = startOfTodayMs()
  let upcoming = 0
  let played = 0
  let cancelled = 0
  for (const m of matchesAll.value) {
    if (m.status === 'cancelled') {
      cancelled += 1
      continue
    }
    const ms = matchDateMillis(m)
    if (ms < todayMs) played += 1
    else upcoming += 1
  }
  return `${upcoming} matchs à venir · ${played} joués · ${cancelled} annulés`
})

/**
 * Predicate quick filter. `upcoming` = futur ET status='scheduled'. `past` =
 * passé (toute date strictement < aujourd'hui, peu importe le status).
 */
function passesQuickFilter(m: MatchRow): boolean {
  if (quickFilter.value === 'all') return true
  if (quickFilter.value === 'cancelled') return m.status === 'cancelled'
  if (quickFilter.value === 'home') return m.kind === 'home'
  if (quickFilter.value === 'away') return m.kind === 'away'
  const ms = matchDateMillis(m)
  const todayMs = startOfTodayMs()
  if (quickFilter.value === 'upcoming') {
    return ms >= todayMs && m.status === 'scheduled'
  }
  // past
  return ms < todayMs
}

/** Match si la query (lowercase) est contenue dans team/opponent/venue/away. */
function passesSearch(m: MatchRow, q: string): boolean {
  if (q.length === 0) return true
  const fields: Array<string | null> = [
    m.teamName,
    m.opponentName,
    m.venueName,
    m.courtName,
    m.awayAddress,
  ]
  return fields.some((f) => f !== null && f.toLowerCase().includes(q))
}

const rows = computed<MatchRow[]>(() => {
  const q = search.value.trim().toLowerCase()
  return matchesAll.value.filter((m) => passesQuickFilter(m) && passesSearch(m, q))
})

// ---------------------------------------------------------------------------
// Formatters — date long, heure, type, statut.
// ---------------------------------------------------------------------------

const longDateFormatter = new Intl.DateTimeFormat('fr-CH', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

const longFullDateFormatter = new Intl.DateTimeFormat('fr-CH', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

function formatShortDate(m: MatchRow): string {
  const raw = longDateFormatter.format(new Date(matchDateMillis(m)))
  // "Lun. 15 mai 2026" → on capitalise.
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

function formatLongDate(m: MatchRow): string {
  const raw = longFullDateFormatter.format(new Date(matchDateMillis(m)))
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

interface TypePillDef {
  variant: 'emerald' | 'violet'
  label: string
}

function typePill(m: MatchRow): TypePillDef {
  return m.kind === 'home'
    ? { variant: 'emerald', label: 'Domicile' }
    : { variant: 'violet', label: 'Extérieur' }
}

interface StatusPillDef {
  variant: 'emerald' | 'rose' | 'slate'
  label: string
}

function statusPill(m: MatchRow): StatusPillDef {
  if (m.status === 'scheduled') return { variant: 'emerald', label: 'Planifié' }
  if (m.status === 'cancelled') return { variant: 'rose', label: 'Annulé' }
  return { variant: 'slate', label: 'Terminé' }
}

/**
 * Lieu d'affichage selon le type :
 *  - home : "venueName · courtName"
 *  - away : awayAddress (tronqué à 40 chars + tooltip).
 */
function venueLabel(m: MatchRow): string {
  if (m.kind === 'home') {
    const v = m.venueName ?? '—'
    const c = m.courtName
    return c ? `${v} · ${c}` : v
  }
  return m.awayAddress ?? '—'
}

const AWAY_TRUNCATE = 40

function venueDisplay(m: MatchRow): string {
  const label = venueLabel(m)
  if (m.kind === 'away' && label.length > AWAY_TRUNCATE) {
    return `${label.slice(0, AWAY_TRUNCATE)}…`
  }
  return label
}

function venueTooltip(m: MatchRow): string | undefined {
  const label = venueLabel(m)
  return m.kind === 'away' && label.length > AWAY_TRUNCATE ? label : undefined
}

// ---------------------------------------------------------------------------
// Drawer — match sélectionné (lookup par id, source `matchesStore.matches`).
// ---------------------------------------------------------------------------

const selectedMatchId = ref<string | null>(null)

const drawerOpen = computed<boolean>({
  get: () => selectedMatchId.value !== null,
  set: (v: boolean) => {
    if (!v) selectedMatchId.value = null
  },
})

const selectedMatch = computed<MatchRow | null>(() => {
  const id = selectedMatchId.value
  if (!id) return null
  return matchesStore.matches.find((m) => m.id === id) ?? null
})

function onRowClick(event: DataTableRowClickEvent): void {
  const data = event.data as MatchRow
  selectedMatchId.value = data.id
}

// ---------------------------------------------------------------------------
// Delete — bouton danger discret dans le drawer. Confirme via window.confirm
// (pas de ConfirmDialog global — cf. memory project_tier1_decisions).
// ---------------------------------------------------------------------------

const deleting = ref<boolean>(false)
const deleteError = ref<string | null>(null)

async function handleDelete(): Promise<void> {
  const m = selectedMatch.value
  if (!m) return
  const ok = window.confirm(
    m.kind === 'home'
      ? 'Supprimer ce match ? Le créneau redeviendra disponible (match home pending).'
      : 'Supprimer ce match extérieur ?',
  )
  if (!ok) return
  deleting.value = true
  deleteError.value = null
  try {
    await matchesStore.remove(m.id)
    selectedMatchId.value = null
  } catch (err) {
    deleteError.value =
      err instanceof Error ? err.message : 'Erreur lors de la suppression du match'
  } finally {
    deleting.value = false
  }
}

// ---------------------------------------------------------------------------
// Création — dialog "+ Nouveau match".
//
// `handleCreated` accepte les deux signatures :
//  - HOME : `{ matchId, bookingId, freedBookingIds }`
//  - AWAY : `{ matchId, freedBookingIds }`
// ---------------------------------------------------------------------------

const showCreateDialog = ref<boolean>(false)

/**
 * Banner info affichée après création quand des entraînements ont été
 * automatiquement libérés (un match libère training/reserve qui chevauchent —
 * cf. `freeConflictingTrainings`). Disparaît au prochain ouverture du dialog
 * ou à la fermeture de la bannière.
 */
const freedNotice = ref<number | null>(null)

function openCreateDialog(): void {
  freedNotice.value = null
  showCreateDialog.value = true
}

interface MatchCreatedPayload {
  matchId: string
  bookingId?: string
  freedBookingIds: string[]
}

function handleCreated(payload: MatchCreatedPayload): void {
  showCreateDialog.value = false
  freedNotice.value =
    payload.freedBookingIds.length > 0 ? payload.freedBookingIds.length : null
  // Le store matchesStore recharge déjà `matches` après `createHome` / `createAway`.
}

function dismissFreedNotice(): void {
  freedNotice.value = null
}

// ---------------------------------------------------------------------------
// Basketplan enrichment — helpers d'affichage pour les champs `external*`
// (cf. `MatchData.externalSource` / `externalGameNumber` / `externalReferees`
// / `externalResult` / `externalLastSyncedAt`).
//
// Tous les helpers sont *neutres pour les matchs purement court-base* (les
// sections conditionnelles `v-if` côté template évitent d'afficher quoi que
// ce soit quand `externalSource !== 'basketplan'`).
// ---------------------------------------------------------------------------

const syncedAtFormatter = new Intl.DateTimeFormat('fr-CH', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function isBasketplanMatch(m: MatchRow): boolean {
  return m.externalSource === 'basketplan'
}

function basketplanGameLabel(m: MatchRow): string {
  return m.externalGameNumber
    ? `Basketplan #${m.externalGameNumber}`
    : 'Basketplan'
}

function formatExternalSyncedAt(m: MatchRow): string | null {
  const ts = m.externalLastSyncedAt
  if (!ts) return null
  const ms = ts.seconds * 1000
  if (Number.isNaN(ms)) return null
  return syncedAtFormatter.format(new Date(ms))
}

interface RefereeRow {
  label: string
  value: string
}

/** Lignes arbitres non vides — vide si rien à afficher (n'affiche pas la section). */
function refereeRows(m: MatchRow): RefereeRow[] {
  const refs = m.externalReferees
  if (!refs) return []
  const rows: RefereeRow[] = []
  if (refs.referee1 && refs.referee1.trim().length > 0) {
    rows.push({ label: 'Arbitre 1', value: refs.referee1.trim() })
  }
  if (refs.referee2 && refs.referee2.trim().length > 0) {
    rows.push({ label: 'Arbitre 2', value: refs.referee2.trim() })
  }
  if (refs.expert && refs.expert.trim().length > 0) {
    rows.push({ label: 'Commissaire', value: refs.expert.trim() })
  }
  return rows
}

/**
 * Renvoie `homeName` / `awayName` selon `kind` :
 *  - `home`  : nous = `teamName`, eux = `opponentName`.
 *  - `away`  : nous = `teamName`, eux = `opponentName` (l'ordre est inversé
 *              côté affichage du score puisque nous sommes "guest" Basketplan).
 *
 * Pour le tableau quarters et le score grand format, le contrat
 * `externalResult.homeScore / awayScore` est défini côté Basketplan : `home`
 * = équipe locale du match (au sens géographique), `away` = visiteur.
 * Donc :
 *  - `kind === 'home'` → notre équipe = home côté Basketplan.
 *  - `kind === 'away'` → notre équipe = away côté Basketplan.
 */
interface ResultLabels {
  leftName: string
  leftScore: number
  rightName: string
  rightScore: number
  /** `true` si notre équipe est à gauche (orienté "nous d'abord"). */
  ourTeamLeft: boolean
}

function resultLabels(m: MatchRow): ResultLabels | null {
  const r = m.externalResult
  if (!r) return null
  const us = m.teamName ?? 'Notre équipe'
  const them = m.opponentName ?? 'Adversaire'
  if (m.kind === 'home') {
    return {
      leftName: us,
      leftScore: r.homeScore,
      rightName: them,
      rightScore: r.awayScore,
      ourTeamLeft: true,
    }
  }
  return {
    leftName: us,
    leftScore: r.awayScore,
    rightName: them,
    rightScore: r.homeScore,
    ourTeamLeft: true,
  }
}

interface QuarterRow {
  label: string
  home: number
  away: number
}

/** Lignes par quart-temps + total. Empty si aucun quart non-nul fourni. */
function quarterRows(m: MatchRow): QuarterRow[] | null {
  const r = m.externalResult
  if (!r || !r.byQuarter || r.byQuarter.length === 0) return null
  // On considère vide si TOUS les quarters sont {0,0} (la spec UI dit
  // "tableau si byQuarter présent + au moins un score non-zéro").
  const allZero = r.byQuarter.every((q) => q.home === 0 && q.away === 0)
  if (allZero) return null
  const rows = r.byQuarter.map((q, idx) => ({
    label: `Q${idx + 1}`,
    home: q.home,
    away: q.away,
  }))
  rows.push({ label: 'Total', home: r.homeScore, away: r.awayScore })
  return rows
}
</script>

<template>
  <section class="p-6 space-y-4">
    <!-- ================= Page heading =================== -->
    <div class="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-[22px] font-semibold tracking-tight">
          Matches
        </h1>
        <p class="text-[13px] text-surface-500 mt-0.5">
          {{ headingSubline }}
        </p>
      </div>
    </div>

    <!-- ================= Saison inactive =================== -->
    <div
      v-if="!bookingsStore.loading && !bookingsStore.activeSeasonId"
      class="card p-10 text-center flex flex-col items-center gap-2"
    >
      <span
        class="w-10 h-10 rounded-full bg-surface-100 inline-flex items-center justify-center text-surface-500"
      >
        <CalendarDays
          :size="18"
          :stroke-width="2"
        />
      </span>
      <div class="text-[14px] font-semibold">
        Aucune saison active
      </div>
      <div class="text-[12px] text-surface-500 max-w-md">
        Activez une saison pour gérer les matchs.
      </div>
      <RouterLink
        to="/seasons"
        class="btn btn-primary btn-sm mt-2"
      >
        Aller aux saisons
      </RouterLink>
    </div>

    <template v-else>
      <!-- ================= Toolbar : search + chips + create =================== -->
      <div class="flex items-center gap-2 flex-wrap">
        <Chip
          v-for="chip in CHIPS"
          :key="chip.id"
          :active="quickFilter === chip.id"
          :aria-pressed="quickFilter === chip.id"
          @click="setQuickFilter(chip.id)"
        >
          {{ chip.label }}
          <span class="ml-1 text-[11px] num">{{ counts[chip.id] }}</span>
        </Chip>

        <div class="ml-auto flex items-center gap-2">
          <div class="input-wrap w-72">
            <Search />
            <InputText
              v-model="search"
              class="input input-with-icon !h-8"
              placeholder="Équipe, adversaire, lieu…"
            />
          </div>
          <Button
            severity="primary"
            size="small"
            @click="openCreateDialog"
          >
            <Plus
              :size="14"
              :stroke-width="2"
            />
            <span class="ml-1.5">Nouveau match</span>
          </Button>
        </div>
      </div>

      <!-- ================= Bannière info — entraînements libérés ================ -->
      <div
        v-if="freedNotice !== null"
        class="card border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800 flex items-center gap-2"
      >
        <TriangleAlert
          :size="14"
          :stroke-width="2"
        />
        <span class="flex-1">
          {{ freedNotice }} entraînement{{ freedNotice > 1 ? 's' : '' }} automatiquement libéré{{
            freedNotice > 1 ? 's' : ''
          }} pour laisser place à ce match.
        </span>
        <button
          type="button"
          class="text-amber-700 hover:text-amber-900 text-[12px] font-medium"
          @click="dismissFreedNotice"
        >
          OK
        </button>
      </div>

      <!-- ================= Bannière erreur =================== -->
      <div
        v-if="matchesStore.error"
        class="card border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700 flex items-center gap-2"
      >
        <TriangleAlert
          :size="14"
          :stroke-width="2"
        />
        {{ matchesStore.error }}
      </div>

      <!-- ================= Empty state — saison active, zéro match =============== -->
      <div
        v-if="!matchesStore.loading && matchesAll.length === 0"
        class="card p-10 text-center flex flex-col items-center gap-2"
      >
        <span
          class="w-10 h-10 rounded-full bg-surface-100 inline-flex items-center justify-center text-surface-500"
        >
          <Swords
            :size="18"
            :stroke-width="2"
          />
        </span>
        <div class="text-[14px] font-semibold">
          Aucun match planifié pour la saison
        </div>
        <div class="text-[12px] text-surface-500 max-w-md">
          Créez le premier match de la saison pour commencer à organiser le
          calendrier officiel.
        </div>
        <Button
          severity="primary"
          size="small"
          class="mt-2"
          @click="openCreateDialog"
        >
          <Plus
            :size="14"
            :stroke-width="2"
          />
          <span class="ml-1.5">Créer le premier</span>
        </Button>
      </div>

      <!-- ================= DataTable =================== -->
      <div
        v-else
        class="card overflow-hidden"
      >
        <DataTable
          :value="rows"
          :loading="matchesStore.loading"
          size="small"
          data-key="id"
          striped-rows
          class="text-[13px]"
          selection-mode="single"
          :pt="{ bodyRow: { class: 'cursor-pointer' } }"
          @row-click="onRowClick"
        >
          <template #empty>
            <div
              v-if="matchesStore.loading"
              class="px-3 py-10 text-center text-[12px] text-surface-500"
              aria-busy="true"
            >
              Chargement des matchs…
            </div>
            <div
              v-else
              class="px-3 py-10 text-center text-[12px] text-surface-500"
            >
              Aucun match ne correspond à vos filtres.
            </div>
          </template>

          <Column
            header="Date"
            :pt="{ headerCell: { style: 'width: 160px' } }"
          >
            <template #body="{ data }">
              <span class="font-medium">{{ formatShortDate(data) }}</span>
            </template>
          </Column>

          <Column
            header="Heure"
            :pt="{ headerCell: { style: 'width: 132px' } }"
          >
            <template #body="{ data }">
              <span class="num text-surface-700">
                {{ data.startTime }} → {{ data.endTime }}
              </span>
            </template>
          </Column>

          <Column
            header="Type"
            :pt="{ headerCell: { style: 'width: 104px' } }"
          >
            <template #body="{ data }">
              <Pill :variant="typePill(data).variant">
                {{ typePill(data).label }}
              </Pill>
            </template>
          </Column>

          <Column
            header="Équipe locale"
            :pt="{ headerCell: { style: 'width: 168px' } }"
          >
            <template #body="{ data }">
              <span class="font-medium">{{ data.teamName ?? '—' }}</span>
            </template>
          </Column>

          <Column header="Adversaire">
            <template #body="{ data }">
              <span class="inline-flex items-center gap-1.5 min-w-0">
                <span class="truncate">{{ data.opponentName ?? '—' }}</span>
                <Pill
                  v-if="isBasketplanMatch(data)"
                  variant="violet"
                  :title="
                    data.externalGameNumber
                      ? `Basketplan #${data.externalGameNumber}`
                      : 'Match issu de la sync Basketplan'
                  "
                >
                  {{ basketplanGameLabel(data) }}
                </Pill>
              </span>
            </template>
          </Column>

          <Column
            header="Match type"
            :pt="{ headerCell: { style: 'width: 160px' } }"
          >
            <template #body="{ data }">
              <span
                v-if="data.matchTypeName"
                class="inline-flex items-center gap-1.5"
              >
                <span
                  v-if="data.matchTypeColor"
                  class="inline-block w-2.5 h-2.5 rounded-full"
                  :style="{ backgroundColor: data.matchTypeColor }"
                  aria-hidden="true"
                />
                <span class="truncate inline-block max-w-[120px]">
                  {{ data.matchTypeName }}
                </span>
              </span>
              <span
                v-else
                class="text-surface-400"
              >—</span>
            </template>
          </Column>

          <Column header="Lieu">
            <template #body="{ data }">
              <span
                class="truncate inline-block max-w-[260px]"
                :title="venueTooltip(data)"
              >
                {{ venueDisplay(data) }}
              </span>
            </template>
          </Column>

          <Column
            header="Statut"
            :pt="{ headerCell: { style: 'width: 112px' } }"
          >
            <template #body="{ data }">
              <Pill :variant="statusPill(data).variant">
                {{ statusPill(data).label }}
              </Pill>
            </template>
          </Column>
        </DataTable>

        <!-- Footer : count -->
        <div
          class="flex items-center justify-between border-t border-surface-200 px-4 h-11 text-[12px] text-surface-500"
        >
          <div>
            <template v-if="matchesStore.loading && rows.length === 0">
              Chargement…
            </template>
            <template v-else>
              {{ rows.length }} sur {{ counts.all }} match<span v-if="rows.length > 1">s</span>
            </template>
          </div>
        </div>
      </div>
    </template>

    <!-- ================= Drawer détail =================== -->
    <Drawer
      v-model:visible="drawerOpen"
      position="right"
      :show-close-icon="true"
      :pt="{ root: { style: 'width: 480px; max-width: 100vw;' } }"
      aria-label="Détail du match"
    >
      <template #container="{ closeCallback }">
        <div
          v-if="selectedMatch"
          class="flex flex-col h-full"
        >
          <header class="flex items-start justify-between gap-3 px-5 py-4 border-b border-surface-200">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap mb-1">
                <Pill :variant="typePill(selectedMatch).variant">
                  {{ typePill(selectedMatch).label }}
                </Pill>
                <Pill :variant="statusPill(selectedMatch).variant">
                  {{ statusPill(selectedMatch).label }}
                </Pill>
              </div>
              <div class="text-[15px] font-semibold truncate">
                {{ selectedMatch.teamName ?? '—' }}
              </div>
              <div class="text-[12px] text-surface-500">
                {{ formatLongDate(selectedMatch) }}
              </div>
            </div>
            <button
              type="button"
              class="btn btn-ghost btn-sm !px-1.5 text-surface-500"
              aria-label="Fermer"
              @click="closeCallback"
            >
              <span aria-hidden="true">×</span>
            </button>
          </header>

          <div class="flex-1 overflow-y-auto px-5 py-4 space-y-5 text-[13px]">
            <!-- Créneau -->
            <section class="space-y-2">
              <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
                Créneau
              </h4>
              <div class="flex items-center gap-2 text-[13px]">
                <Clock
                  :size="14"
                  :stroke-width="2"
                  class="text-surface-500"
                />
                <span class="num font-medium">
                  {{ selectedMatch.startTime }} — {{ selectedMatch.endTime }}
                </span>
              </div>
              <div class="flex items-start gap-2 text-[13px]">
                <MapPin
                  :size="14"
                  :stroke-width="2"
                  class="text-surface-500 mt-0.5"
                />
                <span class="min-w-0 break-words">
                  {{ venueLabel(selectedMatch) }}
                </span>
              </div>
            </section>

            <!-- Adversaire -->
            <section class="space-y-2">
              <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold flex items-center gap-1.5">
                <Users
                  :size="12"
                  :stroke-width="2"
                />
                Adversaire
              </h4>
              <div class="text-[13px]">
                <template v-if="selectedMatch.opponentName">
                  {{ selectedMatch.opponentName }}
                </template>
                <span
                  v-else
                  class="text-surface-400"
                >Non renseigné</span>
              </div>
            </section>

            <!-- Type de compétition -->
            <section class="space-y-2">
              <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
                Type de compétition
              </h4>
              <div class="text-[13px]">
                <span
                  v-if="selectedMatch.matchTypeName"
                  class="inline-flex items-center gap-1.5"
                >
                  <span
                    v-if="selectedMatch.matchTypeColor"
                    class="inline-block w-2.5 h-2.5 rounded-full"
                    :style="{ backgroundColor: selectedMatch.matchTypeColor }"
                    aria-hidden="true"
                  />
                  <span>{{ selectedMatch.matchTypeName }}</span>
                </span>
                <span
                  v-else
                  class="text-surface-400"
                >—</span>
              </div>
            </section>

            <!-- Notes -->
            <section
              v-if="selectedMatch.notes"
              class="space-y-2"
            >
              <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
                Notes
              </h4>
              <div class="text-[13px] text-surface-700 whitespace-pre-line">
                {{ selectedMatch.notes }}
              </div>
            </section>

            <!-- ============================================================
                 Basketplan — source officielle (champs `external*`).
                 Sections affichées uniquement pour les matchs `externalSource
                 === 'basketplan'` (créés / synchronisés depuis le back-office
                 fédéral). Read-only — admin peut toujours éditer les champs
                 manuels côté `/bookings`, mais pas les champs externes.
                 ============================================================ -->

            <!-- Section : Match officiel Basketplan -->
            <section
              v-if="isBasketplanMatch(selectedMatch)"
              class="space-y-2"
            >
              <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
                Match officiel Basketplan
              </h4>
              <div class="flex flex-wrap items-center gap-2 text-[13px]">
                <Pill variant="violet">
                  {{ basketplanGameLabel(selectedMatch) }}
                </Pill>
                <span class="text-surface-500 text-[12px]">
                  Source officielle (Swiss Basketball)
                </span>
              </div>
              <div
                v-if="formatExternalSyncedAt(selectedMatch)"
                class="text-[12px] text-surface-500"
              >
                Dernière synchro :
                <span class="num">{{ formatExternalSyncedAt(selectedMatch) }}</span>
              </div>
            </section>

            <!-- Section : Arbitres fédéraux -->
            <section
              v-if="refereeRows(selectedMatch).length > 0"
              class="space-y-2"
            >
              <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
                Arbitres fédéraux
              </h4>
              <dl class="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-[13px]">
                <template
                  v-for="row in refereeRows(selectedMatch)"
                  :key="row.label"
                >
                  <dt class="text-surface-500">
                    {{ row.label }}
                  </dt>
                  <dd class="text-surface-700 break-words">
                    {{ row.value }}
                  </dd>
                </template>
              </dl>
            </section>

            <!-- Section : Résultat officiel
                 Affichée pour tout match Basketplan : si `externalResult` est
                 présent on rend le score + homologation (+ tableau quarts si
                 dispo), sinon on rend le placeholder "En attente". -->
            <section
              v-if="isBasketplanMatch(selectedMatch)"
              class="space-y-2"
            >
              <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
                Résultat officiel
              </h4>

              <template v-if="selectedMatch.externalResult && resultLabels(selectedMatch)">
                <!-- Score grand format -->
                <div class="flex items-center gap-3 text-[15px]">
                  <span class="font-semibold truncate flex-1 text-right">
                    {{ resultLabels(selectedMatch)!.leftName }}
                  </span>
                  <span class="num font-bold text-[18px] text-surface-900">
                    {{ resultLabels(selectedMatch)!.leftScore }}
                  </span>
                  <span class="text-surface-400 num">—</span>
                  <span class="num font-bold text-[18px] text-surface-900">
                    {{ resultLabels(selectedMatch)!.rightScore }}
                  </span>
                  <span class="font-semibold truncate flex-1">
                    {{ resultLabels(selectedMatch)!.rightName }}
                  </span>
                </div>

                <!-- Badge homologation -->
                <div class="flex items-center gap-2">
                  <Pill
                    v-if="selectedMatch.externalResult.homologated"
                    variant="emerald"
                  >
                    Homologué
                  </Pill>
                  <Pill
                    v-else
                    variant="amber"
                  >
                    En attente d'homologation
                  </Pill>
                </div>

                <!-- Tableau par quart-temps (si disponible) -->
                <div
                  v-if="quarterRows(selectedMatch)"
                  class="mt-2 overflow-hidden rounded-md border border-surface-200"
                >
                  <table class="w-full text-[12px] num">
                    <thead class="bg-surface-50 text-surface-500">
                      <tr>
                        <th class="text-left font-medium px-2 py-1">
                          Période
                        </th>
                        <th class="text-right font-medium px-2 py-1">
                          {{ resultLabels(selectedMatch)!.ourTeamLeft
                            ? (selectedMatch.kind === 'home' ? 'Domicile' : 'Notre équipe')
                            : 'Domicile' }}
                        </th>
                        <th class="text-right font-medium px-2 py-1">
                          {{ resultLabels(selectedMatch)!.ourTeamLeft
                            ? (selectedMatch.kind === 'home' ? 'Visiteur' : 'Domicile')
                            : 'Visiteur' }}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="(row, idx) in quarterRows(selectedMatch)"
                        :key="row.label"
                        :class="
                          idx === quarterRows(selectedMatch)!.length - 1
                            ? 'border-t border-surface-200 font-semibold bg-surface-50'
                            : 'border-t border-surface-100'
                        "
                      >
                        <td class="px-2 py-1 text-surface-600">
                          {{ row.label }}
                        </td>
                        <td class="px-2 py-1 text-right text-surface-900">
                          {{ row.home }}
                        </td>
                        <td class="px-2 py-1 text-right text-surface-900">
                          {{ row.away }}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </template>

              <template v-else>
                <!-- externalSource = basketplan mais pas encore de résultat -->
                <div class="flex items-center gap-2">
                  <Pill variant="amber">
                    En attente d'homologation
                  </Pill>
                </div>
                <p class="text-[12px] text-surface-500">
                  Le résultat sera mis à jour à la prochaine synchro nocturne.
                </p>
              </template>
            </section>

            <!-- Historique (placeholder MVP — l'actionLog vit sur le booking
                 lié pour HOME ; non chargé ici pour éviter une query
                 supplémentaire). -->
            <section class="space-y-2">
              <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold flex items-center gap-1.5">
                <History
                  :size="12"
                  :stroke-width="2"
                />
                Historique
              </h4>
              <div class="text-[12px] text-surface-500">
                Pas d'historique disponible pour ce match en MVP.
              </div>
            </section>

            <!-- Erreur de suppression -->
            <div
              v-if="deleteError"
              class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700"
            >
              {{ deleteError }}
            </div>
          </div>

          <!-- Footer drawer : bouton danger discret -->
          <footer class="px-5 py-3 border-t border-surface-200 flex items-center justify-end gap-2">
            <Button
              severity="danger"
              size="small"
              outlined
              :loading="deleting"
              :disabled="deleting"
              @click="handleDelete"
            >
              <Trash2
                :size="14"
                :stroke-width="2"
              />
              <span class="ml-1.5">Supprimer</span>
            </Button>
          </footer>
        </div>
      </template>
    </Drawer>

    <!-- ================= Dialog création =================== -->
    <MatchFormDialog
      v-model:visible="showCreateDialog"
      @created="handleCreated"
    />
  </section>
</template>
