<script setup lang="ts">
/**
 * Page `/license-requests` — vue trésorier pour la review et la décision
 * finale (approve/reject) sur les demandes de licence pré-validées par le
 * coach (PR3 du workflow `docs/licenses/parent-completion-workflow.md`).
 *
 * Deux onglets :
 *   - "À traiter" : union des statuts pour lesquels le staff trésorier
 *     (treasurer / admin / secretary / rootAdmin) a une action concrète à
 *     mener — `coach_validated`, `parent_signed`, `form_confirmed`,
 *     `sent_paid`. Cf. `TREASURER_ACTIONABLE_STATUSES` dans le store.
 *     `awaiting_parent_signature` est exclu (on attend le parent).
 *   - "Toutes en cours" : tous les statuts non-terminaux — pour consultation.
 *
 * Self-contained : monte le store `licenseRequests` au mount, charge la liste,
 * filtre côté JS via les getters `pendingTreasurer` / `allActive`. Chips de
 * filtre statut disponibles dans les deux onglets (sous-ensemble actionable
 * dans "À traiter", set complet non-terminal dans "Toutes en cours").
 *
 * Routing : `meta.allowedRoles: ['admin','treasurer','secretary']` —
 * rootAdmin bypass. Coach exclu (il a sa propre vue dans courtbase-app).
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { FileText, Search, TriangleAlert } from 'lucide-vue-next'

import Tabs from 'primevue/tabs'
import TabList from 'primevue/tablist'
import Tab from 'primevue/tab'
import TabPanels from 'primevue/tabpanels'
import TabPanel from 'primevue/tabpanel'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'

import Avatar from '@/components/ui/Avatar.vue'
import Chip from '@/components/ui/Chip.vue'
import Pill from '@/components/ui/Pill.vue'
import {
  useLicenseRequestsStore,
  type LicenseRequestStatusFilter,
} from '@/stores/licenseRequests'
import type { LicenseRequest, LicenseRequestStatus } from '@club-app/shared-types'

const store = useLicenseRequestsStore()
const router = useRouter()

onMounted(() => {
  void store.load()
})

// ---------------------------------------------------------------------------
// Tabs — `pending` (coach_validated only) / `active` (tous non-terminaux).
// ---------------------------------------------------------------------------

type TreasurerTabKey = 'pending' | 'active'

const activeTab = ref<TreasurerTabKey>('pending')

// ---------------------------------------------------------------------------
// Search — JS filter sur denorm.* (aligné sur LicenseRequestsTab.vue).
// ---------------------------------------------------------------------------

const search = ref('')

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

function matchSearch(req: LicenseRequest, q: string): boolean {
  if (q.length === 0) return true
  const d = req.denorm
  if (!d) return false
  const haystack = [d.memberFirstName, d.memberLastName, d.teamName, d.coachName]
    .map((s) => normalize(s ?? ''))
    .join(' ')
  return haystack.includes(q)
}

/**
 * Filtres statut indépendants par onglet — évite que basculer entre
 * "À traiter" et "Toutes en cours" mélange les sélections, et autorise un
 * sous-ensemble de chips différent dans chaque onglet (cf. `PENDING_CHIPS`
 * et `STATUS_CHIPS` plus bas).
 *
 *  - `pendingStatusFilter` : `'all' | TreasurerActionableStatus`. `all` =
 *    union des 4 statuts actionables (alimentée par `store.pendingTreasurer`).
 *  - `activeStatusFilter` : `'all' | <toute valeur LicenseRequestStatus>`.
 *    `all` = tous les statuts non-terminaux (`store.allActive`).
 */
type TreasurerActionableStatus =
  | 'coach_validated'
  | 'parent_signed'
  | 'form_confirmed'
  | 'sent_paid'

type PendingStatusFilter = 'all' | TreasurerActionableStatus

const pendingStatusFilter = ref<PendingStatusFilter>('all')
const activeStatusFilter = ref<LicenseRequestStatusFilter>('all')

function matchStatus(req: LicenseRequest, f: LicenseRequestStatusFilter): boolean {
  return f === 'all' ? true : req.status === f
}

function matchPendingStatus(req: LicenseRequest, f: PendingStatusFilter): boolean {
  return f === 'all' ? true : req.status === f
}

const filteredPending = computed<LicenseRequest[]>(() => {
  const q = normalize(search.value.trim())
  return store.pendingTreasurer.filter(
    (r) => matchPendingStatus(r, pendingStatusFilter.value) && matchSearch(r, q),
  )
})

const filteredActive = computed<LicenseRequest[]>(() => {
  const q = normalize(search.value.trim())
  return store.allActive.filter(
    (r) => matchStatus(r, activeStatusFilter.value) && matchSearch(r, q),
  )
})

const currentRows = computed<LicenseRequest[]>(() =>
  activeTab.value === 'pending' ? filteredPending.value : filteredActive.value,
)

// ---------------------------------------------------------------------------
// Chips de filtre statut — set complet (non-terminal) pour l'onglet "Toutes
// en cours" + sous-ensemble actionable pour l'onglet "À traiter".
// ---------------------------------------------------------------------------

interface StatusChipDef {
  id: LicenseRequestStatusFilter
  label: string
  /** Compteur lu depuis `store.countsByStatus`. `all` agrège `allActive`. */
  count: () => number
}

interface PendingChipDef {
  id: PendingStatusFilter
  label: string
  /**
   * Compteur lu depuis `store.countsByStatus`. `all` agrège
   * `pendingTreasurer` (i.e. les 4 statuts actionables).
   */
  count: () => number
}

/**
 * Chips de l'onglet "À traiter" — restreintes au sous-ensemble actionable
 * par le staff trésorier. Pas de chip pour `awaiting_parent_signature` :
 * on attend le parent, rien à faire pour le staff.
 */
const PENDING_CHIPS = computed<readonly PendingChipDef[]>(() => [
  { id: 'all', label: 'Toutes', count: () => store.pendingTreasurer.length },
  {
    id: 'coach_validated',
    label: 'Validé coach',
    count: () => store.countsByStatus.coach_validated,
  },
  {
    id: 'parent_signed',
    label: 'Doc signé reçu',
    count: () => store.countsByStatus.parent_signed,
  },
  {
    id: 'form_confirmed',
    label: 'Forme confirmée',
    count: () => store.countsByStatus.form_confirmed,
  },
  {
    id: 'sent_paid',
    label: 'Envoyé + payé',
    count: () => store.countsByStatus.sent_paid,
  },
])

const STATUS_CHIPS = computed<readonly StatusChipDef[]>(() => [
  { id: 'all', label: 'Toutes', count: () => store.allActive.length },
  {
    id: 'pending_parent_docs',
    label: 'En attente parent',
    count: () => store.countsByStatus.pending_parent_docs,
  },
  {
    id: 'parent_docs_submitted',
    label: 'Docs reçus',
    count: () => store.countsByStatus.parent_docs_submitted,
  },
  {
    id: 'coach_validated',
    label: 'Validé coach',
    count: () => store.countsByStatus.coach_validated,
  },
  // Phase trésorier (PR3-trésorier, 2026-05-24)
  {
    id: 'awaiting_parent_signature',
    label: 'Att. signature parent',
    count: () => store.countsByStatus.awaiting_parent_signature,
  },
  {
    id: 'parent_signed',
    label: 'Doc signé reçu',
    count: () => store.countsByStatus.parent_signed,
  },
  {
    id: 'form_confirmed',
    label: 'Forme confirmée',
    count: () => store.countsByStatus.form_confirmed,
  },
  {
    id: 'sent_paid',
    label: 'Envoyé + payé',
    count: () => store.countsByStatus.sent_paid,
  },
])

// ---------------------------------------------------------------------------
// Status pill — réutilise la convention sémantique de `LicenseRequestsTab`.
// ---------------------------------------------------------------------------

type PillVariant = 'emerald' | 'sky' | 'amber' | 'rose' | 'slate' | 'violet'

function statusPill(status: LicenseRequestStatus): { variant: PillVariant; label: string } {
  switch (status) {
    case 'pending_parent_docs':
      return { variant: 'amber', label: 'En attente parent' }
    case 'parent_docs_submitted':
      return { variant: 'sky', label: 'Docs reçus' }
    case 'coach_validated':
      return { variant: 'violet', label: 'Validé coach' }
    // Phase trésorier (PR3-trésorier, 2026-05-24)
    case 'awaiting_parent_signature':
      return { variant: 'amber', label: 'Att. signature parent' }
    case 'parent_signed':
      return { variant: 'sky', label: 'Doc signé reçu' }
    case 'form_confirmed':
      return { variant: 'violet', label: 'Forme confirmée' }
    case 'sent_paid':
      return { variant: 'violet', label: 'Envoyé + payé' }
    case 'approved':
      return { variant: 'emerald', label: 'Approuvée' }
    case 'rejected':
      return { variant: 'rose', label: 'Refusée' }
    case 'pending':
      return { variant: 'slate', label: 'En attente' }
    default: {
      const _exhaust: never = status
      return { variant: 'slate', label: String(_exhaust) }
    }
  }
}

// ---------------------------------------------------------------------------
// Formatters.
// ---------------------------------------------------------------------------

const DATE_FMT = new Intl.DateTimeFormat('fr-CH', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function tsToDate(ts: { seconds: number; nanoseconds: number } | null | undefined): Date | null {
  if (!ts) return null
  return new Date(ts.seconds * 1000 + Math.floor(ts.nanoseconds / 1_000_000))
}

function formatDate(ts: { seconds: number; nanoseconds: number } | null | undefined): string {
  const d = tsToDate(ts)
  return d ? DATE_FMT.format(d) : '—'
}

function memberName(req: LicenseRequest): string {
  const d = req.denorm
  if (!d) return 'Joueur sans denorm'
  const first = (d.memberFirstName ?? '').trim()
  const last = (d.memberLastName ?? '').trim()
  const full = [first, last].filter((s) => s.length > 0).join(' ')
  return full.length > 0 ? full : 'Joueur sans denorm'
}

function teamName(req: LicenseRequest): string {
  return req.denorm?.teamName ?? '—'
}

function coachName(req: LicenseRequest): string {
  return req.denorm?.coachName ?? '—'
}

// ---------------------------------------------------------------------------
// Navigation — click row → vue détail (`/license-requests/:id`).
// ---------------------------------------------------------------------------

function openReview(req: LicenseRequest): void {
  void router.push({ name: 'license-request-detail', params: { id: req.id } })
}

function onRowClick(event: { data: LicenseRequest }): void {
  openReview(event.data)
}

const rowStyle = (): Record<string, string> => ({ cursor: 'pointer' })

// ---------------------------------------------------------------------------
// Empty states.
// ---------------------------------------------------------------------------

const isEmptyAll = computed(() => !store.loading && store.requests.length === 0)
const isFilteredOut = computed(
  () => !store.loading && store.requests.length > 0 && currentRows.value.length === 0,
)
</script>

<template>
  <section class="p-6 space-y-4">
    <header class="space-y-1">
      <h1 class="text-[18px] font-semibold tracking-tight">
        Demandes de licence
      </h1>
      <p class="text-[12.5px] text-surface-500">
        Examiner et trancher les demandes pré-validées par les coachs avant
        émission de la licence fédérale.
      </p>
    </header>

    <Tabs v-model:value="activeTab">
      <TabList>
        <Tab value="pending">
          À traiter
          <span class="ml-1 text-[11px] num text-surface-500">
            {{ store.pendingTreasurer.length }}
          </span>
        </Tab>
        <Tab value="active">
          Toutes en cours
          <span class="ml-1 text-[11px] num text-surface-500">
            {{ store.allActive.length }}
          </span>
        </Tab>
      </TabList>

      <TabPanels>
        <TabPanel
          value="pending"
          class="space-y-3"
        >
          <div class="flex items-center gap-2 flex-wrap">
            <div class="input-wrap w-80">
              <Search />
              <input
                v-model="search"
                class="input input-with-icon !h-9"
                placeholder="Joueur, équipe ou coach"
                aria-label="Rechercher une demande à traiter"
              >
            </div>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <Chip
              v-for="chip in PENDING_CHIPS"
              :key="chip.id"
              :active="pendingStatusFilter === chip.id"
              :aria-label="`Filtrer par statut ${chip.label}`"
              :aria-pressed="pendingStatusFilter === chip.id"
              @click="pendingStatusFilter = chip.id"
            >
              {{ chip.label }}
              <span class="ml-1 text-[11px] num">{{ chip.count() }}</span>
            </Chip>
          </div>
        </TabPanel>
        <TabPanel
          value="active"
          class="space-y-3"
        >
          <div class="flex items-center gap-2 flex-wrap">
            <div class="input-wrap w-80">
              <Search />
              <input
                v-model="search"
                class="input input-with-icon !h-9"
                placeholder="Joueur, équipe ou coach"
                aria-label="Rechercher une demande en cours"
              >
            </div>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <Chip
              v-for="chip in STATUS_CHIPS"
              :key="chip.id"
              :active="activeStatusFilter === chip.id"
              :aria-label="`Filtrer par statut ${chip.label}`"
              :aria-pressed="activeStatusFilter === chip.id"
              @click="activeStatusFilter = chip.id"
            >
              {{ chip.label }}
              <span class="ml-1 text-[11px] num">{{ chip.count() }}</span>
            </Chip>
          </div>
        </TabPanel>
      </TabPanels>
    </Tabs>

    <div class="card overflow-hidden">
      <DataTable
        :value="currentRows"
        :loading="store.loading"
        size="small"
        data-key="id"
        striped-rows
        class="text-[13px]"
        :row-style="rowStyle"
        @row-click="onRowClick"
      >
        <template #empty>
          <div
            v-if="isEmptyAll"
            class="px-3 py-10 text-center flex flex-col items-center gap-2"
          >
            <span class="w-10 h-10 rounded-full bg-surface-100 inline-flex items-center justify-center text-surface-500">
              <FileText
                :size="18"
                :stroke-width="2"
              />
            </span>
            <div class="text-[14px] font-semibold">
              Aucune demande de licence en cours.
            </div>
            <div class="text-[12px] text-surface-500 max-w-md">
              Les demandes apparaîtront ici dès qu'un coach déclenchera une
              demande et que le parent aura uploadé ses pièces.
            </div>
          </div>
          <div
            v-else-if="isFilteredOut"
            class="px-3 py-10 text-center text-[12px] text-surface-500"
          >
            Aucune demande ne correspond à vos critères.
          </div>
          <div
            v-else-if="store.loading"
            class="px-3 py-10 text-center text-[12px] text-surface-500"
            aria-busy="true"
          >
            Chargement des demandes…
          </div>
        </template>

        <Column header="Joueur">
          <template #body="{ data }">
            <div class="flex items-center gap-2.5 text-left">
              <Avatar
                :name="memberName(data as LicenseRequest)"
                :size="28"
              />
              <div class="leading-tight">
                <div class="font-medium">
                  {{ memberName(data as LicenseRequest) }}
                </div>
              </div>
            </div>
          </template>
        </Column>

        <Column
          header="Équipe"
          :pt="{ headerCell: { style: 'width: 180px' } }"
        >
          <template #body="{ data }">
            <Pill
              v-if="(data as LicenseRequest).denorm?.teamName"
              variant="slate"
            >
              {{ teamName(data as LicenseRequest) }}
            </Pill>
            <span
              v-else
              class="text-surface-400"
            >—</span>
          </template>
        </Column>

        <Column
          header="Coach"
          :pt="{ headerCell: { style: 'width: 180px' } }"
        >
          <template #body="{ data }">
            <span
              v-if="(data as LicenseRequest).denorm?.coachName"
              class="text-[12px] text-surface-700"
            >
              {{ coachName(data as LicenseRequest) }}
            </span>
            <span
              v-else
              class="text-surface-400"
            >—</span>
          </template>
        </Column>

        <Column
          header="Statut"
          :pt="{ headerCell: { style: 'width: 160px' } }"
        >
          <template #body="{ data }">
            <Pill :variant="statusPill((data as LicenseRequest).status).variant">
              {{ statusPill((data as LicenseRequest).status).label }}
            </Pill>
          </template>
        </Column>

        <Column
          header="Date création"
          :pt="{ headerCell: { style: 'width: 150px' } }"
        >
          <template #body="{ data }">
            <span class="text-[12px] text-surface-600 num">
              {{ formatDate((data as LicenseRequest).createdAt) }}
            </span>
          </template>
        </Column>

        <Column
          header=""
          :pt="{ headerCell: { style: 'width: 120px' }, bodyCell: { class: 'text-right' } }"
        >
          <template #body="{ data }">
            <Button
              size="small"
              severity="secondary"
              outlined
              aria-label="Examiner la demande"
              @click.stop="openReview(data as LicenseRequest)"
            >
              Examiner
            </Button>
          </template>
        </Column>
      </DataTable>

      <div
        class="flex items-center justify-between border-t border-surface-200 px-4 h-11 text-[12px] text-surface-500 gap-3 flex-wrap"
      >
        <div>
          <template v-if="store.loading && store.requests.length === 0">
            Chargement…
          </template>
          <template v-else>
            {{ currentRows.length }} demande<span v-if="currentRows.length > 1">s</span>
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
      Erreur de chargement des demandes ({{ store.error }}).
    </div>
  </section>
</template>
