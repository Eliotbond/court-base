<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { BadgeCheck, RotateCcw, Search } from 'lucide-vue-next'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Select from 'primevue/select'
import Button from 'primevue/button'
import {
  useLicensesIndexStore,
  type LicenseRoleFilter,
  type LicenseStatusFilter,
} from '@/stores/licensesIndex'
import { useSeasonsStore } from '@/stores/seasons'
import { useMembersStore } from '@/stores/members'
import type {
  License,
  LicenseRole,
  LicenseStatus,
} from '@club-app/shared-types'
import Avatar from '@/components/ui/Avatar.vue'
import Chip from '@/components/ui/Chip.vue'
import Pill from '@/components/ui/Pill.vue'

// ---------------------------------------------------------------------------
// Stores — licences (liste), saisons (Select), membres (résolution nom).
// ---------------------------------------------------------------------------

const store = useLicensesIndexStore()
const seasons = useSeasonsStore()
const members = useMembersStore()
const router = useRouter()

// ---------------------------------------------------------------------------
// Mount — charge en parallèle saisons + membres + licences. Quand les saisons
// sont disponibles, pré-sélectionne la saison active (sauf si l'utilisateur a
// déjà touché au filtre — `seasonInitialized` empêche d'écraser un choix
// explicite par le watch).
// ---------------------------------------------------------------------------

let seasonInitialized = false

onMounted(() => {
  void seasons.load()
  void members.load()
  void store.load()
})

watch(
  () => seasons.activeSeason,
  (active) => {
    if (seasonInitialized) return
    if (!active) return
    if (store.seasonFilter !== null) {
      // L'utilisateur a déjà fait un choix (improbable au mount, mais on
      // respecte). Marquer comme initialisé pour ne pas retenter.
      seasonInitialized = true
      return
    }
    seasonInitialized = true
    store.setSeasonFilter(active.id)
  },
  { immediate: true },
)

// ---------------------------------------------------------------------------
// Season select — options dérivées du store seasons + valeur "Toutes".
// ---------------------------------------------------------------------------

type SeasonOptionValue = string | null

interface SeasonOption {
  value: SeasonOptionValue
  label: string
}

const seasonOptions = computed<SeasonOption[]>(() => {
  const list: SeasonOption[] = [{ value: null, label: 'Toutes les saisons' }]
  for (const s of seasons.seasons) {
    list.push({ value: s.id, label: s.name })
  }
  return list
})

function seasonLabelOf(seasonId: string): string {
  return seasons.getById(seasonId)?.name ?? seasonId
}

// ---------------------------------------------------------------------------
// Status filter chips.
// ---------------------------------------------------------------------------

interface StatusChipDef {
  id: LicenseStatusFilter
  label: string
}

const STATUS_CHIPS: readonly StatusChipDef[] = [
  { id: 'all', label: 'Toutes' },
  { id: 'pending', label: 'En attente' },
  { id: 'active', label: 'Actives' },
  { id: 'cancelled', label: 'Annulées' },
] as const

// ---------------------------------------------------------------------------
// Role filter chips.
// ---------------------------------------------------------------------------

interface RoleChipDef {
  id: LicenseRoleFilter
  label: string
}

const ROLE_CHIPS: readonly RoleChipDef[] = [
  { id: 'all', label: 'Tous' },
  { id: 'player', label: 'Joueur' },
  { id: 'official', label: 'Officiel' },
  { id: 'coach', label: 'Coach' },
  { id: 'referee', label: 'Arbitre' },
] as const

const ROLE_LABEL: Readonly<Record<LicenseRole, string>> = {
  player: 'Joueur',
  official: 'Officiel',
  coach: 'Coach',
  referee: 'Arbitre',
}

// ---------------------------------------------------------------------------
// Status pill mapping — couleur + label par status (cf. spec design).
// ---------------------------------------------------------------------------

type PillVariant = 'emerald' | 'sky' | 'amber' | 'rose' | 'slate' | 'violet'

interface StatusPillDef {
  variant: PillVariant
  label: string
  strike: boolean
}

function statusPill(status: LicenseStatus): StatusPillDef {
  switch (status) {
    case 'pending':
      return { variant: 'amber', label: 'En attente', strike: false }
    case 'active':
      return { variant: 'emerald', label: 'Active', strike: false }
    case 'cancelled':
      return { variant: 'slate', label: 'Annulée', strike: true }
    default:
      return { variant: 'slate', label: status, strike: false }
  }
}

// ---------------------------------------------------------------------------
// Formatters — CHF + dates short FR.
// ---------------------------------------------------------------------------

const CHF = new Intl.NumberFormat('fr-CH', {
  style: 'currency',
  currency: 'CHF',
  maximumFractionDigits: 0,
})

const DATE_FMT = new Intl.DateTimeFormat('fr-CH', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

function formatChf(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return CHF.format(n)
}

function tsToDate(
  ts: { seconds: number; nanoseconds: number } | null | undefined,
): Date | null {
  if (!ts) return null
  return new Date(ts.seconds * 1000 + Math.floor(ts.nanoseconds / 1_000_000))
}

function formatDate(
  ts: { seconds: number; nanoseconds: number } | null | undefined,
): string {
  const d = tsToDate(ts)
  return d ? DATE_FMT.format(d) : '—'
}

// ---------------------------------------------------------------------------
// Member name lookup — résout `memberId` → `{ firstName, lastName }` via le
// store members. Si pas encore chargé (ou membre supprimé), fallback sur un
// short id pour ne jamais casser le rendu.
// ---------------------------------------------------------------------------

interface MemberDisplay {
  /** Nom affiché (`firstName lastName`), fallback short id si membre absent. */
  name: string
  /** Nom passé au composant `Avatar` (qui dérive ses initiales depuis le nom). */
  avatarName: string
  shortId: string
}

function memberDisplay(memberId: string): MemberDisplay {
  const shortId = memberId.slice(0, 6)
  const m = members.members.find((x) => x.id === memberId)
  if (!m) {
    return { name: shortId + '…', avatarName: '?', shortId }
  }
  const full = `${m.firstName} ${m.lastName}`.trim()
  return { name: full || shortId, avatarName: full || '?', shortId }
}

// ---------------------------------------------------------------------------
// Row navigation — clic sur la ligne ouvre la fiche membre.
// ---------------------------------------------------------------------------

function goToMember(memberId: string): void {
  void router.push({ name: 'member-detail', params: { id: memberId } })
}

// ---------------------------------------------------------------------------
// Empty state — distinguer "Firestore vide pour cette saison" vs "filtres
// trop restrictifs".
// ---------------------------------------------------------------------------

const isEmptyForSeason = computed(
  () => !store.loading && store.licenses.length === 0,
)
const isFilteredOut = computed(
  () =>
    !store.loading &&
    store.licenses.length > 0 &&
    store.filtered.length === 0,
)

const hasJsOnlyFilters = computed<boolean>(
  () =>
    store.statusFilter !== 'all' ||
    store.roleFilter !== 'all' ||
    store.search.trim().length > 0,
)
</script>

<template>
  <section class="space-y-4">
    <!-- ================= Toolbar row =================== -->
    <div class="flex items-center gap-2 flex-wrap">
      <Select
        :model-value="store.seasonFilter"
        :options="seasonOptions"
        option-label="label"
        option-value="value"
        placeholder="Saison"
        class="w-56"
        aria-label="Filtrer par saison"
        @update:model-value="(v: SeasonOptionValue) => store.setSeasonFilter(v)"
      />
      <div class="input-wrap w-72">
        <Search />
        <input
          class="input input-with-icon !h-9"
          placeholder="Type de licence ou id membre"
          aria-label="Rechercher par type de licence ou id de membre"
          :value="store.search"
          @input="store.setSearch(($event.target as HTMLInputElement).value)"
        >
      </div>

      <!-- Status chips alignés à droite via ml-auto. -->
      <div class="flex items-center gap-2 flex-wrap ml-auto">
        <Chip
          v-for="chip in STATUS_CHIPS"
          :key="chip.id"
          :active="store.statusFilter === chip.id"
          :aria-label="`Filtrer par statut ${chip.label}`"
          :aria-pressed="store.statusFilter === chip.id"
          @click="store.setStatusFilter(chip.id)"
        >
          {{ chip.label }}
          <span class="ml-1 text-[11px] num">
            {{ store.countsByStatus[chip.id] ?? 0 }}
          </span>
        </Chip>
      </div>
    </div>

    <!-- ================= Role chips row =================== -->
    <div class="flex items-center gap-2 flex-wrap">
      <span class="text-[11px] text-surface-500 font-medium uppercase tracking-wide mr-1">
        Rôles
      </span>
      <Chip
        v-for="chip in ROLE_CHIPS"
        :key="chip.id"
        :active="store.roleFilter === chip.id"
        :aria-label="`Filtrer par rôle ${chip.label}`"
        :aria-pressed="store.roleFilter === chip.id"
        @click="store.setRoleFilter(chip.id)"
      >
        {{ chip.label }}
        <span class="ml-1 text-[11px] num">
          {{ store.countsByRole[chip.id] ?? 0 }}
        </span>
      </Chip>
      <Button
        v-if="hasJsOnlyFilters"
        text
        size="small"
        severity="secondary"
        aria-label="Réinitialiser les filtres"
        class="ml-1"
        @click="store.resetFilters()"
      >
        <template #icon>
          <RotateCcw
            :size="13"
            :stroke-width="2"
          />
        </template>
        <span class="ml-1">Réinitialiser</span>
      </Button>
    </div>

    <!-- ================= DataTable =================== -->
    <div class="card overflow-hidden">
      <DataTable
        :value="store.filtered"
        :loading="store.loading"
        size="small"
        data-key="id"
        striped-rows
        class="text-[13px]"
      >
        <template #empty>
          <div
            v-if="isEmptyForSeason"
            class="px-3 py-10 text-center flex flex-col items-center gap-2"
          >
            <span
              class="w-10 h-10 rounded-full bg-surface-100 inline-flex items-center justify-center text-surface-500"
            >
              <BadgeCheck
                :size="18"
                :stroke-width="2"
              />
            </span>
            <div class="text-[14px] font-semibold">
              Aucune licence pour cette saison.
            </div>
            <div class="text-[12px] text-surface-500 max-w-md">
              Les licences sont créées depuis la fiche membre (onglet « Officiel
              & coach »), puis confirmées par le trésorier.
            </div>
          </div>
          <div
            v-else-if="isFilteredOut"
            class="px-3 py-10 text-center flex flex-col items-center gap-2 text-[12px] text-surface-500"
          >
            <div>Aucune licence ne correspond à vos critères.</div>
            <Button
              text
              size="small"
              severity="secondary"
              aria-label="Réinitialiser les filtres"
              @click="store.resetFilters()"
            >
              <template #icon>
                <RotateCcw
                  :size="13"
                  :stroke-width="2"
                />
              </template>
              <span class="ml-1">Réinitialiser</span>
            </Button>
          </div>
          <div
            v-else-if="store.loading"
            class="px-3 py-10 text-center text-[12px] text-surface-500"
            aria-busy="true"
          >
            Chargement des licences…
          </div>
        </template>

        <Column
          header="Membre"
          sortable
          field="memberId"
        >
          <template #body="{ data }">
            <button
              type="button"
              class="flex items-center gap-2.5 text-left hover:underline"
              @click="goToMember((data as License).memberId)"
            >
              <Avatar
                :name="memberDisplay((data as License).memberId).avatarName"
                :size="28"
              />
              <div class="leading-tight">
                <div class="font-medium">
                  {{ memberDisplay((data as License).memberId).name }}
                </div>
                <div class="text-[11px] text-surface-500 font-mono">
                  {{ memberDisplay((data as License).memberId).shortId }}
                </div>
              </div>
            </button>
          </template>
        </Column>

        <Column
          header="Rôle"
          field="role"
          sortable
          :pt="{ headerCell: { style: 'width: 110px' } }"
        >
          <template #body="{ data }">
            <Pill variant="slate">
              {{ ROLE_LABEL[(data as License).role] ?? (data as License).role }}
            </Pill>
          </template>
        </Column>

        <Column
          header="Type"
          field="licenseName"
          sortable
        >
          <template #body="{ data }">
            <Pill variant="violet">
              {{ (data as License).licenseName }}
            </Pill>
          </template>
        </Column>

        <Column
          header="Niveau"
          :pt="{ headerCell: { style: 'width: 90px' } }"
        >
          <template #body="{ data }">
            <span
              v-if="(data as License).level !== null"
              class="num text-surface-700"
            >
              N{{ (data as License).level }}
            </span>
            <span
              v-else
              class="text-surface-400"
            >—</span>
          </template>
        </Column>

        <Column
          header="Saison"
          :pt="{ headerCell: { style: 'width: 130px' } }"
        >
          <template #body="{ data }">
            <span class="text-[12px] text-surface-600">
              {{ seasonLabelOf((data as License).seasonId) }}
            </span>
          </template>
        </Column>

        <Column
          header="Montant"
          :pt="{
            headerCell: { style: 'width: 110px', class: 'text-right' },
            bodyCell: { class: 'text-right num' },
          }"
        >
          <template #body="{ data }">
            {{ formatChf((data as License).feeSnapshot) }}
          </template>
        </Column>

        <Column
          header="Statut"
          :pt="{ headerCell: { style: 'width: 120px' } }"
        >
          <template #body="{ data }">
            <Pill
              :variant="statusPill((data as License).status).variant"
              :strike="statusPill((data as License).status).strike"
            >
              {{ statusPill((data as License).status).label }}
            </Pill>
          </template>
        </Column>

        <Column
          header="Date"
          :pt="{ headerCell: { style: 'width: 110px' } }"
        >
          <template #body="{ data }">
            <span class="text-[12px] text-surface-600 num">
              {{
                formatDate(
                  (data as License).confirmedAt ?? (data as License).createdAt,
                )
              }}
            </span>
          </template>
        </Column>
      </DataTable>

      <!-- Footer : count + filtres actifs. -->
      <div
        class="flex items-center justify-between border-t border-surface-200 px-4 h-11 text-[12px] text-surface-500 gap-3 flex-wrap"
      >
        <div>
          <template v-if="store.loading && store.licenses.length === 0">
            Chargement…
          </template>
          <template v-else>
            {{ store.filtered.length }} sur {{ store.licenses.length }}
            licence<span v-if="store.licenses.length > 1">s</span>
          </template>
        </div>
      </div>
    </div>

    <!-- ================= Error banner =================== -->
    <div
      v-if="store.error"
      class="card border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700"
      role="alert"
    >
      {{ store.error }}
    </div>
  </section>
</template>
