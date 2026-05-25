<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  Ban,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  MoreHorizontal,
  PieChart,
  RotateCcw,
  Search,
  TriangleAlert,
  Users,
  Wallet,
} from 'lucide-vue-next'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Select from 'primevue/select'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import DatePicker from 'primevue/datepicker'
import Textarea from 'primevue/textarea'
import Menu from 'primevue/menu'
import Popover from 'primevue/popover'
import type { MenuItem } from 'primevue/menuitem'
import { useCotisationsStore, type CotisationStatusFilter } from '@/stores/cotisations'
import { useSeasonsStore } from '@/stores/seasons'
import { useAuthStore } from '@/stores/auth'
import type { CotisationRow } from '@/repositories/cotisations.repo'
import type { MarkCotisationPaymentMethod } from '@/services/cloudFunctions'
import type { CotisationStatus } from '@club-app/shared-types'
import Avatar from '@/components/ui/Avatar.vue'
import Chip from '@/components/ui/Chip.vue'
import Pill from '@/components/ui/Pill.vue'
import EditCotisationDialog from '@/components/cotisations/EditCotisationDialog.vue'

// ---------------------------------------------------------------------------
// Stores — Cotisations pour la liste/actions, Seasons pour alimenter le Select.
// ---------------------------------------------------------------------------

const cotisations = useCotisationsStore()
const seasons = useSeasonsStore()
const auth = useAuthStore()
const router = useRouter()

/**
 * Droit d'éditer une cotisation — réservé au comité (admin / treasurer ;
 * rootAdmin couvert par `hasAccess`). Pilote la visibilité de l'item de menu
 * "Modifier". La garde réelle vit côté Cloud Function `updateDue`.
 */
const canEditCotisation = computed<boolean>(() =>
  auth.hasAccess(['admin', 'treasurer']),
)

onMounted(() => {
  void cotisations.load()
  // On charge les saisons en parallèle pour peupler le Select. Pas bloquant
  // si le call échoue : le Select reste vide → l'utilisateur peut toujours
  // basculer sur "Toutes les saisons".
  void seasons.load()
})

// ---------------------------------------------------------------------------
// Season select — options dérivées du store seasons + valeur "all".
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

// ---------------------------------------------------------------------------
// Status filter chips — driven par le store.
// ---------------------------------------------------------------------------

interface StatusChipDef {
  id: CotisationStatusFilter
  label: string
  badgeClass?: string
}

const STATUS_CHIPS: readonly StatusChipDef[] = [
  { id: 'all', label: 'Tous' },
  { id: 'overdue', label: 'En retard', badgeClass: 'text-rose-600' },
  { id: 'issued', label: 'Émis' },
  { id: 'paid', label: 'Payés' },
  { id: 'pending_grace', label: 'En grâce' },
  { id: 'excepted', label: 'Exceptés' },
  { id: 'cancelled', label: 'Annulés' },
] as const

const statusCounts = computed(() => {
  const list = cotisations.cotisations
  return {
    all: list.length,
    overdue: list.filter((c) => c.status === 'overdue').length,
    issued: list.filter((c) => c.status === 'issued').length,
    paid: list.filter((c) => c.status === 'paid').length,
    pending_grace: list.filter((c) => c.status === 'pending_grace').length,
    excepted: list.filter((c) => c.status === 'excepted').length,
    cancelled: list.filter((c) => c.status === 'cancelled').length,
  } as Record<CotisationStatusFilter, number>
})

// ---------------------------------------------------------------------------
// Status pill mapping — couleur + label par status (cf. spec design).
// ---------------------------------------------------------------------------

type PillVariant = 'emerald' | 'sky' | 'amber' | 'rose' | 'slate' | 'violet'

interface StatusPillDef {
  variant: PillVariant
  label: string
  strike: boolean
}

function statusPill(status: CotisationStatus): StatusPillDef {
  switch (status) {
    case 'pending_grace':
      return { variant: 'slate', label: 'En grâce', strike: false }
    case 'issued':
      return { variant: 'sky', label: 'Émis', strike: false }
    case 'paid':
      return { variant: 'emerald', label: 'Payé', strike: false }
    case 'overdue':
      return { variant: 'rose', label: 'En retard', strike: false }
    case 'excepted':
      return { variant: 'violet', label: 'Excepté', strike: false }
    case 'cancelled':
      return { variant: 'slate', label: 'Annulé', strike: true }
    default:
      return { variant: 'slate', label: status, strike: false }
  }
}

// ---------------------------------------------------------------------------
// Payment method pill — variant par méthode.
// ---------------------------------------------------------------------------

/**
 * Couvre les 3 méthodes du schéma actuel (`CotisationPaymentMethod`) plus
 * `'card'`, qui est accepté par le callable serveur `markDuePaid` (nom de la
 * callable serveur — wrapper TS côté client : `markCotisationPaid`) et peut
 * donc apparaître en base via un appel UI ou un script. La signature accepte
 * un `string` côté doc Firestore (lignes legacy ou évolutions) pour ne jamais
 * casser le rendu.
 */
function methodPill(method: string | null): StatusPillDef | null {
  if (!method) return null
  switch (method) {
    case 'cash':
      return { variant: 'amber', label: 'Cash', strike: false }
    case 'transfer':
      return { variant: 'sky', label: 'Virement', strike: false }
    case 'card':
      return { variant: 'violet', label: 'Carte', strike: false }
    case 'other':
      return { variant: 'slate', label: 'Autre', strike: false }
    default:
      return { variant: 'slate', label: method, strike: false }
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

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

function formatChf(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return CHF.format(n)
}

/** Convertit un Firestore Timestamp (shape neutre `{ seconds, nanoseconds }`)
 *  en Date JS. Retourne `null` pour les Timestamp absents. */
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
// Stats cards — 4 KPIs en haut d'écran.
// ---------------------------------------------------------------------------

interface StatCard {
  label: string
  value: string
  sub?: string
  variant: PillVariant
}

const statCards = computed<StatCard[]>(() => {
  const s = cotisations.stats
  return [
    {
      label: 'Total dû',
      value: formatChf(s.total.amount),
      sub: `${s.total.count} cotisation${s.total.count > 1 ? 's' : ''}`,
      variant: 'slate',
    },
    {
      label: 'Payé',
      value: formatChf(s.paid.amount),
      sub: `${s.paid.count} cotisation${s.paid.count > 1 ? 's' : ''}`,
      variant: 'emerald',
    },
    {
      label: 'En attente',
      value: String(s.pending.count),
      sub: 'à percevoir',
      variant: 'sky',
    },
    {
      label: 'En retard',
      value: String(s.overdue.count),
      sub: 'à relancer',
      variant: 'rose',
    },
  ]
})

// ---------------------------------------------------------------------------
// Row navigation — clic sur le membre ouvre /members/:id.
// ---------------------------------------------------------------------------

function goToMember(memberId: string): void {
  void router.push({ name: 'member-detail', params: { id: memberId } })
}

// ---------------------------------------------------------------------------
// Action menu — PrimeVue `Menu` partagé, ouvert via toggle par ligne.
//
// On stocke le `CotisationRow` cible dans `activeMenuRow` pour que les items
// "Marquer comme payé" / "Annuler" connaissent la cible courante.
// ---------------------------------------------------------------------------

const menuRef = ref<InstanceType<typeof Menu> | null>(null)
const activeMenuRow = ref<CotisationRow | null>(null)

/** Items recalculés à chaque ouverture pour refléter le row courant
 *  (disabled selon le status). */
const menuItems = computed<MenuItem[]>(() => {
  const row = activeMenuRow.value
  if (!row) return []
  const isFinalPaid = row.status === 'paid' || row.status === 'excepted'
  const isCancelled = row.status === 'cancelled'
  const items: MenuItem[] = [
    {
      label: 'Marquer comme payé',
      icon: 'pi pi-check',
      disabled: isFinalPaid || isCancelled,
      command: () => openMarkPaidDialog(row),
    },
    {
      label: 'Annuler',
      icon: 'pi pi-times',
      disabled: row.status === 'paid' || isCancelled,
      command: () => openCancelDialog(row),
    },
  ]
  // L'édition (dates / statut / note) est réservée au comité — l'item
  // n'apparaît que pour admin / treasurer / rootAdmin.
  if (canEditCotisation.value) {
    items.push({
      label: 'Modifier',
      icon: 'pi pi-pencil',
      command: () => openEditDialog(row),
    })
  }
  return items
})

function openMenu(event: Event, row: CotisationRow): void {
  activeMenuRow.value = row
  menuRef.value?.toggle(event)
}

// ---------------------------------------------------------------------------
// Edit dialog — `EditCotisationDialog` réutilisable. Le dialog appelle lui-même
// la callable `updateDue` ; à la réussite il émet `saved` → on recharge la
// liste via `cotisations.load()` (les transitions de statut peuvent recomputer
// `member.duesStatus` via le trigger serveur).
// `CotisationRow` étend `Cotisation` → passe tel quel à la prop `cotisation`.
// ---------------------------------------------------------------------------

const editOpen = ref(false)
const editTarget = ref<CotisationRow | null>(null)

function openEditDialog(row: CotisationRow): void {
  editTarget.value = row
  editOpen.value = true
}

async function onCotisationEdited(): Promise<void> {
  const name = editTarget.value?.memberName ?? ''
  await cotisations.load()
  flashNotice(
    name ? `Cotisation mise à jour pour ${name}.` : 'Cotisation mise à jour.',
    'success',
  )
}

// ---------------------------------------------------------------------------
// Mark paid dialog — formulaire (date, montant, méthode, note).
// ---------------------------------------------------------------------------

interface MarkPaidForm {
  paidAt: Date
  amount: number
  /**
   * Étendu à `'card'` (accepté par le callable serveur `markDuePaid` — wrapper
   * TS côté client : `markCotisationPaid`) en plus des trois valeurs du schéma
   * `CotisationPaymentMethod` actuel. Quand `shared-types` sera étendu,
   * retomber sur `CotisationPaymentMethod` natif.
   */
  method: MarkCotisationPaymentMethod
  note: string
}

const markPaidOpen = ref(false)
const markPaidTarget = ref<CotisationRow | null>(null)
const markPaidSubmitting = ref(false)
const markPaidForm = reactive<MarkPaidForm>({
  paidAt: new Date(),
  amount: 0,
  method: 'transfer',
  note: '',
})

const METHOD_OPTIONS: readonly { value: MarkCotisationPaymentMethod; label: string }[] = [
  { value: 'transfer', label: 'Virement' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Carte' },
  { value: 'other', label: 'Autre' },
]

function openMarkPaidDialog(row: CotisationRow): void {
  markPaidTarget.value = row
  markPaidForm.paidAt = new Date()
  markPaidForm.amount = row.amount
  markPaidForm.method = 'transfer'
  markPaidForm.note = ''
  markPaidOpen.value = true
}

async function submitMarkPaid(): Promise<void> {
  const target = markPaidTarget.value
  if (!target) return
  markPaidSubmitting.value = true
  try {
    await cotisations.markPaid(target.id, {
      paidAt: markPaidForm.paidAt,
      amount: markPaidForm.amount,
      method: markPaidForm.method,
      note: markPaidForm.note,
    })
    flashNotice(`Paiement enregistré pour ${target.memberName}.`, 'success')
    markPaidOpen.value = false
  } catch (e: unknown) {
    flashNotice(
      e instanceof Error ? e.message : 'Erreur lors du marquage du paiement',
      'error',
    )
  } finally {
    markPaidSubmitting.value = false
  }
}

// ---------------------------------------------------------------------------
// Cancel dialog — confirm + raison.
// ---------------------------------------------------------------------------

const cancelOpen = ref(false)
const cancelTarget = ref<CotisationRow | null>(null)
const cancelSubmitting = ref(false)
const cancelReason = ref('')

function openCancelDialog(row: CotisationRow): void {
  cancelTarget.value = row
  cancelReason.value = ''
  cancelOpen.value = true
}

async function submitCancel(): Promise<void> {
  const target = cancelTarget.value
  if (!target) return
  const reason = cancelReason.value.trim()
  if (!reason) return
  cancelSubmitting.value = true
  try {
    await cotisations.cancel(target.id, reason)
    flashNotice(`Cotisation annulée pour ${target.memberName}.`, 'success')
    cancelOpen.value = false
  } catch (e: unknown) {
    flashNotice(
      e instanceof Error ? e.message : "Erreur lors de l'annulation",
      'error',
    )
  } finally {
    cancelSubmitting.value = false
  }
}

// ---------------------------------------------------------------------------
// Inline notice — remplace useToast tant que `ToastService` n'est pas câblé
// globalement dans `main.ts` (out of scope ici). Auto-hide après 4s.
// ---------------------------------------------------------------------------

interface Notice {
  message: string
  kind: 'success' | 'error'
}

const notice = ref<Notice | null>(null)
let noticeTimeout: ReturnType<typeof setTimeout> | null = null

function flashNotice(message: string, kind: Notice['kind']): void {
  notice.value = { message, kind }
  if (noticeTimeout) clearTimeout(noticeTimeout)
  noticeTimeout = setTimeout(() => {
    notice.value = null
  }, 4000)
}

// ---------------------------------------------------------------------------
// Empty state — distinguer "Firestore vide" vs "filtres trop restrictifs".
// ---------------------------------------------------------------------------

const isEmptyForSeason = computed(
  () => !cotisations.loading && cotisations.cotisations.length === 0,
)
const isFilteredOut = computed(
  () =>
    !cotisations.loading &&
    cotisations.cotisations.length > 0 &&
    cotisations.filteredCotisations.length === 0,
)

// ---------------------------------------------------------------------------
// Type filter — Select alimenté par les types présents dans la saison
// courante (cf. `useCotisationsStore.typeNamesInUse`). On filtre sur le nom
// (porté par `CotisationRow.cotisationTypeName`) plutôt que sur un id pour
// éviter d'introduire un champ dérivé supplémentaire.
// ---------------------------------------------------------------------------

type TypeOptionValue = string | null

interface TypeOption {
  value: TypeOptionValue
  label: string
}

const typeOptions = computed<TypeOption[]>(() => {
  const list: TypeOption[] = [{ value: null, label: 'Tous les types' }]
  for (const name of cotisations.typeNamesInUse) {
    list.push({ value: name, label: name })
  }
  return list
})

// ---------------------------------------------------------------------------
// Empty state — libellé enrichi quand un ou plusieurs filtres sont actifs,
// pour que l'utilisateur sache pourquoi la table est vide.
// ---------------------------------------------------------------------------

const STATUS_LABELS: Readonly<Record<CotisationStatusFilter, string>> = {
  all: 'Tous',
  overdue: 'En retard',
  issued: 'Émis',
  paid: 'Payés',
  pending_grace: 'En grâce',
  excepted: 'Exceptés',
  cancelled: 'Annulés',
}

const filteredOutLabel = computed<string>(() => {
  const parts: string[] = []
  if (cotisations.statusFilter !== 'all') {
    parts.push(`statut "${STATUS_LABELS[cotisations.statusFilter]}"`)
  }
  if (cotisations.typeFilter !== null) {
    parts.push(`type "${cotisations.typeFilter}"`)
  }
  const q = cotisations.searchQuery.trim()
  if (q.length > 0) {
    parts.push(`recherche "${q}"`)
  }
  if (parts.length === 0) {
    return 'Aucune cotisation ne correspond à ce filtre.'
  }
  return `Aucune cotisation pour ${parts.join(' et ')}.`
})

// ---------------------------------------------------------------------------
// Breakdown popover — Popover PrimeVue partagé. Toggle via le bouton header.
// ---------------------------------------------------------------------------

const breakdownPopover = ref<InstanceType<typeof Popover> | null>(null)

function toggleBreakdown(event: Event): void {
  breakdownPopover.value?.toggle(event)
}
</script>

<template>
  <section class="p-6 space-y-4">
    <!-- ================= Page heading =================== -->
    <div class="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-[22px] font-semibold tracking-tight">
          Cotisations
        </h1>
        <p class="text-[13px] text-surface-500 mt-0.5">
          Suivi des cotisations par saison — marquer payé, annuler, surveiller les retards.
        </p>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <div class="input-wrap w-72">
          <Search />
          <input
            class="input input-with-icon !h-9"
            placeholder="Membre ou réf. (DUE-…)"
            aria-label="Rechercher par nom de membre ou référence de paiement"
            :value="cotisations.searchQuery"
            @input="cotisations.setSearchQuery(($event.target as HTMLInputElement).value)"
          >
        </div>
        <Select
          :model-value="cotisations.typeFilter"
          :options="typeOptions"
          option-label="label"
          option-value="value"
          placeholder="Type de cotisation"
          class="w-48"
          aria-label="Filtrer par type de cotisation"
          @update:model-value="(v: TypeOptionValue) => cotisations.setTypeFilter(v)"
        />
        <Select
          :model-value="cotisations.seasonFilter"
          :options="seasonOptions"
          option-label="label"
          option-value="value"
          placeholder="Saison"
          class="w-56"
          aria-label="Filtrer par saison"
          @update:model-value="(v: SeasonOptionValue) => cotisations.setSeasonFilter(v)"
        />
        <Button
          v-if="cotisations.breakdownByType.length > 0"
          severity="secondary"
          size="small"
          aria-label="Répartition par type de cotisation"
          @click="toggleBreakdown($event)"
        >
          <template #icon>
            <PieChart
              :size="14"
              :stroke-width="2"
            />
          </template>
          <span class="ml-1">Répartition</span>
        </Button>
      </div>
    </div>

    <!-- ================= Stats cards (4) =================== -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <div
        v-for="(card, idx) in statCards"
        :key="card.label"
        class="card p-4"
      >
        <div class="flex items-center justify-between mb-2">
          <span class="text-[12px] text-surface-500 font-medium">
            {{ card.label }}
          </span>
          <span
            class="w-7 h-7 rounded-full inline-flex items-center justify-center"
            :class="{
              'bg-slate-100 text-slate-600': card.variant === 'slate',
              'bg-emerald-50 text-emerald-700': card.variant === 'emerald',
              'bg-sky-50 text-sky-700': card.variant === 'sky',
              'bg-rose-50 text-rose-700': card.variant === 'rose',
            }"
          >
            <Wallet
              v-if="idx === 0"
              :size="14"
              :stroke-width="2"
            />
            <CheckCircle2
              v-else-if="idx === 1"
              :size="14"
              :stroke-width="2"
            />
            <Clock3
              v-else-if="idx === 2"
              :size="14"
              :stroke-width="2"
            />
            <TriangleAlert
              v-else
              :size="14"
              :stroke-width="2"
            />
          </span>
        </div>
        <div class="text-[20px] font-semibold tracking-tight num">
          {{ card.value }}
        </div>
        <div
          v-if="card.sub"
          class="text-[11px] text-surface-500 mt-0.5"
        >
          {{ card.sub }}
        </div>
      </div>
    </div>

    <!-- ================= Filter chips row =================== -->
    <div class="flex items-center gap-2 flex-wrap">
      <Chip
        v-for="chip in STATUS_CHIPS"
        :key="chip.id"
        :active="cotisations.statusFilter === chip.id"
        :aria-label="`Filtrer par statut ${chip.label}`"
        :aria-pressed="cotisations.statusFilter === chip.id"
        @click="cotisations.setStatusFilter(chip.id)"
      >
        {{ chip.label }}
        <span
          class="ml-1 text-[11px] num"
          :class="chip.badgeClass"
        >{{ statusCounts[chip.id] ?? 0 }}</span>
      </Chip>
      <Button
        v-if="cotisations.hasActiveFilters"
        text
        size="small"
        severity="secondary"
        aria-label="Réinitialiser les filtres"
        class="ml-1"
        @click="cotisations.resetFilters()"
      >
        <template #icon>
          <RotateCcw
            :size="13"
            :stroke-width="2"
          />
        </template>
        <span class="ml-1">Réinitialiser les filtres</span>
      </Button>
    </div>

    <!-- ================= DataTable =================== -->
    <div class="card overflow-hidden">
      <DataTable
        :value="cotisations.filteredCotisations"
        :loading="cotisations.loading"
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
              <CircleDollarSign
                :size="18"
                :stroke-width="2"
              />
            </span>
            <div class="text-[14px] font-semibold">
              Aucune cotisation pour cette saison.
            </div>
            <div class="text-[12px] text-surface-500 max-w-md">
              Les cotisations sont générées automatiquement quand un joueur est
              activé dans une équipe (`team.playerIds`). Vérifie la composition
              des équipes ou choisis une autre saison.
            </div>
            <div class="flex items-center gap-2 mt-2">
              <Button
                label="Voir les équipes"
                severity="secondary"
                size="small"
                @click="router.push({ name: 'teams' })"
              />
            </div>
          </div>
          <div
            v-else-if="isFilteredOut"
            class="px-3 py-10 text-center flex flex-col items-center gap-2 text-[12px] text-surface-500"
          >
            <div>{{ filteredOutLabel }}</div>
            <Button
              v-if="cotisations.hasActiveFilters"
              text
              size="small"
              severity="secondary"
              aria-label="Réinitialiser les filtres"
              @click="cotisations.resetFilters()"
            >
              <template #icon>
                <RotateCcw
                  :size="13"
                  :stroke-width="2"
                />
              </template>
              <span class="ml-1">Réinitialiser les filtres</span>
            </Button>
          </div>
          <div
            v-else-if="cotisations.loading"
            class="px-3 py-10 text-center text-[12px] text-surface-500"
            aria-busy="true"
          >
            Chargement des cotisations…
          </div>
        </template>

        <Column
          field="memberName"
          header="Membre"
          sortable
        >
          <template #body="{ data }">
            <button
              type="button"
              class="flex items-center gap-2.5 text-left hover:underline"
              @click="goToMember((data as CotisationRow).memberId)"
            >
              <Avatar
                :name="(data as CotisationRow).memberName"
                :size="28"
              />
              <div class="leading-tight">
                <div class="font-medium">
                  {{ (data as CotisationRow).memberName }}
                </div>
                <div class="text-[11px] text-surface-500 font-mono">
                  {{ (data as CotisationRow).id.slice(0, 8) }}
                </div>
              </div>
            </button>
          </template>
        </Column>

        <Column
          header="Équipe"
          :pt="{ headerCell: { style: 'width: 140px' } }"
        >
          <template #body="{ data }">
            <Pill
              v-if="(data as CotisationRow).teamName"
              variant="slate"
            >
              {{ (data as CotisationRow).teamName }}
            </Pill>
            <span
              v-else
              class="text-surface-400"
            >—</span>
          </template>
        </Column>

        <Column
          header="Type cotisation"
          :pt="{ headerCell: { style: 'width: 160px' } }"
        >
          <template #body="{ data }">
            <Pill
              v-if="(data as CotisationRow).cotisationTypeName"
              variant="violet"
            >
              {{ (data as CotisationRow).cotisationTypeName }}
            </Pill>
            <span
              v-else
              class="text-surface-400"
            >—</span>
          </template>
        </Column>

        <Column
          field="seasonId"
          header="Saison"
          :pt="{ headerCell: { style: 'width: 130px' } }"
        >
          <template #body="{ data }">
            <span class="text-[12px] text-surface-600">
              {{ (data as CotisationRow).seasonId }}
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
            {{ formatChf((data as CotisationRow).amount) }}
          </template>
        </Column>

        <Column
          header="Statut"
          :pt="{ headerCell: { style: 'width: 120px' } }"
        >
          <template #body="{ data }">
            <Pill
              :variant="statusPill((data as CotisationRow).status).variant"
              :strike="statusPill((data as CotisationRow).status).strike"
            >
              {{ statusPill((data as CotisationRow).status).label }}
            </Pill>
          </template>
        </Column>

        <Column
          header="Référence"
          :pt="{ headerCell: { style: 'width: 140px' } }"
        >
          <template #body="{ data }">
            <span
              v-if="(data as CotisationRow).paymentReference"
              class="text-[11px] text-surface-600 font-mono"
            >
              {{ (data as CotisationRow).paymentReference }}
            </span>
            <span
              v-else
              class="text-surface-400"
            >—</span>
          </template>
        </Column>

        <Column
          header="Émis le"
          :pt="{ headerCell: { style: 'width: 120px' } }"
        >
          <template #body="{ data }">
            <span class="text-[12px] text-surface-600 num">
              {{ formatDate((data as CotisationRow).issuedAt) }}
            </span>
          </template>
        </Column>

        <Column
          header="À payer le"
          :pt="{ headerCell: { style: 'width: 120px' } }"
        >
          <template #body="{ data }">
            <span class="text-[12px] text-surface-600 num">
              {{ formatDate((data as CotisationRow).dueAt) }}
            </span>
          </template>
        </Column>

        <Column
          header="Payé le"
          :pt="{ headerCell: { style: 'width: 120px' } }"
        >
          <template #body="{ data }">
            <span class="text-[12px] text-surface-600 num">
              {{ formatDate((data as CotisationRow).paidAt) }}
            </span>
          </template>
        </Column>

        <Column
          header="Méthode"
          :pt="{ headerCell: { style: 'width: 110px' } }"
        >
          <template #body="{ data }">
            <Pill
              v-if="methodPill((data as CotisationRow).paymentMethod)"
              :variant="methodPill((data as CotisationRow).paymentMethod)!.variant"
            >
              {{ methodPill((data as CotisationRow).paymentMethod)!.label }}
            </Pill>
            <span
              v-else
              class="text-surface-400"
            >—</span>
          </template>
        </Column>

        <Column
          header=""
          :pt="{
            headerCell: { style: 'width: 56px' },
            bodyCell: { class: 'text-right' },
          }"
        >
          <template #body="{ data }">
            <Button
              icon="pi"
              text
              rounded
              size="small"
              aria-label="Actions"
              :loading="cotisations.pendingActionFor === (data as CotisationRow).id"
              @click="openMenu($event, data as CotisationRow)"
            >
              <template #icon>
                <MoreHorizontal
                  :size="16"
                  :stroke-width="2"
                />
              </template>
            </Button>
          </template>
        </Column>
      </DataTable>

      <!-- Footer : count + active filter chips -->
      <div
        class="flex items-center justify-between border-t border-surface-200 px-4 h-11 text-[12px] text-surface-500 gap-3 flex-wrap"
      >
        <div>
          <template v-if="cotisations.loading && cotisations.cotisations.length === 0">
            Chargement…
          </template>
          <template v-else>
            {{ cotisations.filteredCotisations.length }} sur {{ cotisations.cotisations.length }} résultat<span v-if="cotisations.cotisations.length > 1">s</span>
          </template>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <span
            v-if="cotisations.statusFilter !== 'all'"
            class="inline-flex items-center gap-1 text-[11px] text-surface-600"
          >
            Statut :
            <Pill variant="slate">
              {{ STATUS_LABELS[cotisations.statusFilter] }}
            </Pill>
          </span>
          <span
            v-if="cotisations.typeFilter !== null"
            class="inline-flex items-center gap-1 text-[11px] text-surface-600"
          >
            Type :
            <Pill variant="violet">
              {{ cotisations.typeFilter }}
            </Pill>
          </span>
          <span
            v-if="cotisations.searchQuery.trim().length > 0"
            class="inline-flex items-center gap-1 text-[11px] text-surface-600"
          >
            Recherche :
            <Pill variant="sky">
              {{ cotisations.searchQuery.trim() }}
            </Pill>
          </span>
          <span
            v-if="cotisations.seasonFilter"
            class="inline-flex items-center gap-1"
          >
            <Users
              :size="12"
              :stroke-width="2"
            />
            Saison : {{ seasonOptions.find((o) => o.value === cotisations.seasonFilter)?.label ?? cotisations.seasonFilter }}
          </span>
        </div>
      </div>
    </div>

    <!-- ================= Breakdown popover =================== -->
    <Popover
      ref="breakdownPopover"
      :pt="{ content: { class: 'p-0' } }"
    >
      <div class="w-80 p-4">
        <div class="flex items-center gap-2 mb-3">
          <PieChart
            :size="14"
            :stroke-width="2"
          />
          <span class="text-[13px] font-semibold">Répartition par type</span>
        </div>
        <div
          v-if="cotisations.breakdownByType.length === 0"
          class="text-[12px] text-surface-500"
        >
          Aucune donnée pour cette saison.
        </div>
        <ul
          v-else
          class="space-y-2"
        >
          <li
            v-for="entry in cotisations.breakdownByType"
            :key="entry.key"
            class="flex items-center justify-between gap-2 text-[12px]"
          >
            <div class="flex items-center gap-2 min-w-0">
              <Pill
                :variant="entry.typeName ? 'violet' : 'slate'"
              >
                {{ entry.typeName ?? 'Sans type' }}
              </Pill>
              <span class="text-surface-500 truncate">
                {{ entry.count }} cotisation<span v-if="entry.count > 1">s</span>
              </span>
            </div>
            <div class="text-right shrink-0 num">
              <div class="text-surface-700 font-medium">
                {{ formatChf(entry.duAmount) }}
              </div>
              <div class="text-[11px] text-emerald-700">
                {{ formatChf(entry.paidAmount) }} payé
              </div>
            </div>
          </li>
        </ul>
      </div>
    </Popover>

    <!-- ================= Error banner =================== -->
    <div
      v-if="cotisations.error"
      class="card border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700 flex items-center gap-2"
    >
      <TriangleAlert
        :size="14"
        :stroke-width="2"
      />
      {{ cotisations.error }}
    </div>

    <!-- ================= Inline notice (toast-like) =================== -->
    <div
      v-if="notice"
      class="fixed bottom-4 right-4 z-50 card px-4 py-3 text-[13px] flex items-center gap-2 shadow-md"
      :class="{
        'border-emerald-200 bg-emerald-50 text-emerald-700': notice.kind === 'success',
        'border-rose-200 bg-rose-50 text-rose-700': notice.kind === 'error',
      }"
      role="status"
      aria-live="polite"
    >
      <CheckCircle2
        v-if="notice.kind === 'success'"
        :size="14"
        :stroke-width="2"
      />
      <TriangleAlert
        v-else
        :size="14"
        :stroke-width="2"
      />
      {{ notice.message }}
    </div>

    <!-- ================= Action menu (shared) =================== -->
    <Menu
      ref="menuRef"
      :model="menuItems"
      :popup="true"
    />

    <!-- ================= Mark-paid dialog =================== -->
    <Dialog
      v-model:visible="markPaidOpen"
      modal
      header="Marquer comme payé"
      :style="{ width: '480px' }"
      :closable="!markPaidSubmitting"
      :close-on-escape="!markPaidSubmitting"
    >
      <div
        v-if="markPaidTarget"
        class="space-y-3"
      >
        <div class="flex items-center gap-2 text-[13px] text-surface-600">
          <Avatar
            :name="markPaidTarget.memberName"
            :size="24"
          />
          <span class="font-medium">{{ markPaidTarget.memberName }}</span>
          <span class="text-surface-400">·</span>
          <span>{{ markPaidTarget.teamName ?? '—' }}</span>
        </div>

        <!-- Référence de paiement (read-only) — affichée pour rappel quand
             l'admin vient de recevoir un virement avec cette mention. -->
        <div
          v-if="markPaidTarget.paymentReference"
          class="rounded-md bg-surface-50 border border-surface-200 px-3 py-2 text-[12px] flex items-center justify-between gap-2"
        >
          <span class="text-surface-500">Référence virement</span>
          <span class="font-mono text-surface-700">
            {{ markPaidTarget.paymentReference }}
          </span>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-[12px] font-medium text-surface-700 mb-1">
              Date de paiement
            </label>
            <DatePicker
              v-model="markPaidForm.paidAt"
              date-format="dd/mm/yy"
              show-icon
              class="w-full"
            />
          </div>
          <div>
            <label class="block text-[12px] font-medium text-surface-700 mb-1">
              Montant
            </label>
            <div
              class="px-3 py-2 rounded border border-surface-200 bg-surface-50 text-[13px] num text-surface-800"
            >
              {{ markPaidTarget ? formatChf(markPaidTarget.amount) : '—' }}
            </div>
            <p class="mt-1 text-[11px] text-surface-500">
              Validation au montant intégral. Un arrangement comité passe par la
              page Détail membre.
            </p>
          </div>
        </div>

        <div>
          <label class="block text-[12px] font-medium text-surface-700 mb-1">
            Méthode
          </label>
          <Select
            v-model="markPaidForm.method"
            :options="[...METHOD_OPTIONS]"
            option-label="label"
            option-value="value"
            class="w-full"
          />
        </div>

        <div>
          <label class="block text-[12px] font-medium text-surface-700 mb-1">
            Note (optionnel)
          </label>
          <Textarea
            v-model="markPaidForm.note"
            rows="2"
            class="w-full"
            placeholder="Référence, remarque, etc."
          />
        </div>
      </div>

      <template #footer>
        <Button
          label="Annuler"
          severity="secondary"
          :disabled="markPaidSubmitting"
          @click="markPaidOpen = false"
        />
        <Button
          label="Confirmer"
          :loading="markPaidSubmitting"
          @click="submitMarkPaid"
        />
      </template>
    </Dialog>

    <!-- ================= Cancel dialog =================== -->
    <Dialog
      v-model:visible="cancelOpen"
      modal
      header="Annuler la cotisation"
      :style="{ width: '440px' }"
      :closable="!cancelSubmitting"
      :close-on-escape="!cancelSubmitting"
    >
      <div
        v-if="cancelTarget"
        class="space-y-3"
      >
        <div class="flex items-center gap-2 text-[13px] text-surface-600">
          <Avatar
            :name="cancelTarget.memberName"
            :size="24"
          />
          <span class="font-medium">{{ cancelTarget.memberName }}</span>
        </div>
        <p class="text-[13px] text-surface-600">
          Cette cotisation passera en statut <strong>Annulé</strong>. Cette
          action est tracée dans les notes et impactera le statut cotisation
          du membre.
        </p>
        <div>
          <label class="block text-[12px] font-medium text-surface-700 mb-1">
            Raison
          </label>
          <Textarea
            v-model="cancelReason"
            rows="2"
            class="w-full"
            placeholder="Pourquoi annuler cette cotisation ?"
          />
        </div>
      </div>

      <template #footer>
        <Button
          label="Retour"
          severity="secondary"
          :disabled="cancelSubmitting"
          @click="cancelOpen = false"
        />
        <Button
          label="Confirmer l'annulation"
          severity="danger"
          :loading="cancelSubmitting"
          :disabled="cancelReason.trim().length === 0"
          @click="submitCancel"
        >
          <template #icon>
            <Ban
              :size="14"
              :stroke-width="2"
            />
          </template>
        </Button>
      </template>
    </Dialog>

    <!-- ================= Edit dialog (réutilisable) =================== -->
    <EditCotisationDialog
      v-model:visible="editOpen"
      :cotisation="editTarget"
      @saved="onCotisationEdited"
    />
  </section>
</template>
