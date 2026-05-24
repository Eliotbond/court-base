<script setup lang="ts">
/**
 * Tab "Demandes en cours" — page `/licenses`.
 *
 * Liste toutes les `/licenseRequests` visibles par le caller (scope géré
 * côté rules selon le rôle). Self-contained : pas de props, pas d'emits ;
 * monte son propre store, charge au `onMounted`, cache court intra-session.
 *
 * Architecture : composant → store `licenseRequests` → repo → Firebase
 * (cf. apps/web/CLAUDE.md §"Architecture en couches").
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  CheckCircle2,
  FileText,
  RotateCcw,
  Search,
  Trash2,
  TriangleAlert,
} from 'lucide-vue-next'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import {
  useLicenseRequestsStore,
  type LicenseRequestStatusFilter,
} from '@/stores/licenseRequests'
import type {
  LicenseRequest,
  LicenseRequestStatus,
} from '@club-app/shared-types'
import { licenseRequestIsTerminal } from '@/repositories/licenseRequests.repo'
import Avatar from '@/components/ui/Avatar.vue'
import Chip from '@/components/ui/Chip.vue'
import Pill from '@/components/ui/Pill.vue'

// ---------------------------------------------------------------------------
// Store + router.
// ---------------------------------------------------------------------------

const store = useLicenseRequestsStore()
const router = useRouter()

onMounted(() => {
  // `load()` est idempotent — pas de re-fetch si déjà chargé (cache court
  // intra-session). Le tab parent peut donc remonter ce composant sans
  // recharger la liste à chaque switch d'onglet.
  void store.load()
})

// ---------------------------------------------------------------------------
// Status pill mapping — tons sémantiques alignés sur le design system
// (cf. `Cotisations.vue`).
// ---------------------------------------------------------------------------

type PillVariant = 'emerald' | 'sky' | 'amber' | 'rose' | 'slate' | 'violet'

interface StatusPillDef {
  variant: PillVariant
  label: string
}

function statusPill(status: LicenseRequestStatus): StatusPillDef {
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
      // Legacy — anciens docs antérieurs au workflow 4-étapes.
      return { variant: 'slate', label: 'En attente' }
    default: {
      // Exhaustive guard — TS proof tout statut est mappé.
      const _exhaust: never = status
      return { variant: 'slate', label: String(_exhaust) }
    }
  }
}

// ---------------------------------------------------------------------------
// Filter chips — ordre logique du workflow (pending_parent_docs → terminal).
// ---------------------------------------------------------------------------

interface StatusChipDef {
  id: LicenseRequestStatusFilter
  label: string
}

const STATUS_CHIPS: readonly StatusChipDef[] = [
  { id: 'all', label: 'Toutes' },
  { id: 'pending_parent_docs', label: 'En attente parent' },
  { id: 'parent_docs_submitted', label: 'Docs reçus' },
  { id: 'coach_validated', label: 'Validé coach' },
  { id: 'approved', label: 'Approuvées' },
  { id: 'rejected', label: 'Refusées' },
  { id: 'pending', label: 'En attente (legacy)' },
] as const

// ---------------------------------------------------------------------------
// Formatters — date FR + helpers denorm fallback.
// ---------------------------------------------------------------------------

const DATE_FMT = new Intl.DateTimeFormat('fr-CH', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** Convertit un Timestamp neutre `{ seconds, nanoseconds }` en Date JS. */
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

/**
 * Nom complet du membre dérivé du `denorm`. Fallback sur les 6 premiers
 * caractères du `memberId` si le denorm est absent (cas légitime selon le
 * schéma — un trigger admin pourra backfill plus tard).
 */
function memberName(req: LicenseRequest): string {
  const d = req.denorm
  if (!d) return 'Joueur sans denorm'
  const first = (d.memberFirstName ?? '').trim()
  const last = (d.memberLastName ?? '').trim()
  const full = [first, last].filter((s) => s.length > 0).join(' ')
  return full.length > 0 ? full : 'Joueur sans denorm'
}

/** Identifiant de secours pour l'affichage quand le denorm manque. */
function memberIdShort(req: LicenseRequest): string {
  return req.memberId.slice(0, 6)
}

function teamName(req: LicenseRequest): string {
  return req.denorm?.teamName ?? '—'
}

function coachName(req: LicenseRequest): string {
  return req.denorm?.coachName ?? '—'
}

interface DocsProgress {
  done: number
  total: number
  isTerminal: boolean
}

/**
 * Progression docs uploadés / requis. Pour les statuts terminaux
 * (`approved` / `rejected`) on force `done = total` visuellement — la
 * décision a été prise indépendamment de l'état documentaire courant
 * (cas typique : approval out-of-band, ou rejet avant complétion).
 */
function docsProgress(req: LicenseRequest): DocsProgress {
  const total = req.requiredDocs?.length ?? 0
  const uploaded = req.uploadedDocs ? Object.keys(req.uploadedDocs).length : 0
  const isTerminal = req.status === 'approved' || req.status === 'rejected'
  return {
    done: isTerminal ? total : uploaded,
    total,
    isTerminal,
  }
}

// ---------------------------------------------------------------------------
// Empty state — distinguer "rien en base" vs "filtres trop restrictifs".
// ---------------------------------------------------------------------------

const isEmptyAll = computed(
  () => !store.loading && store.requests.length === 0,
)
const isFilteredOut = computed(
  () =>
    !store.loading &&
    store.requests.length > 0 &&
    store.filtered.length === 0,
)

const hasActiveFilters = computed<boolean>(
  () => store.statusFilter !== 'all' || store.search.trim().length > 0,
)

// ---------------------------------------------------------------------------
// Row navigation — clic ligne → fiche membre.
// ---------------------------------------------------------------------------

function goToMember(req: LicenseRequest): void {
  void router.push({ name: 'member-detail', params: { id: req.memberId } })
}

function onRowClick(event: { data: LicenseRequest }): void {
  goToMember(event.data)
}

/** Style ligne — curseur pointer pour signaler la navigation. */
const rowStyle = (): Record<string, string> => ({ cursor: 'pointer' })

// ---------------------------------------------------------------------------
// Delete dialog — suppression définitive d'une demande "en cours" (admin
// only). Garde-fou UX type-to-confirm, aligné sur `Inscriptions.vue`.
// ---------------------------------------------------------------------------

const DELETE_CONFIRM_TOKEN = 'SUPPRIMER'

const deleteDialogOpen = ref(false)
const deleteTargetId = ref<string | null>(null)
const deleteConfirmInput = ref('')

const deleteTargetRequest = computed<LicenseRequest | null>(() => {
  const id = deleteTargetId.value
  if (!id) return null
  return store.requests.find((r) => r.id === id) ?? null
})

const canSubmitDelete = computed<boolean>(() => {
  if (store.actionPendingId !== null) return false
  return deleteConfirmInput.value.trim().toUpperCase() === DELETE_CONFIRM_TOKEN
})

function canDelete(req: LicenseRequest): boolean {
  return store.isAdminScope && !licenseRequestIsTerminal(req.status)
}

function openDeleteDialog(id: string): void {
  deleteTargetId.value = id
  deleteConfirmInput.value = ''
  deleteDialogOpen.value = true
}

function closeDeleteDialog(): void {
  if (store.actionPendingId !== null) return
  deleteDialogOpen.value = false
  deleteTargetId.value = null
  deleteConfirmInput.value = ''
}

async function submitDelete(): Promise<void> {
  const id = deleteTargetId.value
  if (!id || !canSubmitDelete.value) return
  const ok = await store.remove(id)
  if (ok) {
    deleteDialogOpen.value = false
    deleteTargetId.value = null
    deleteConfirmInput.value = ''
  }
}
</script>

<template>
  <section class="space-y-4">
    <!-- ================= Toolbar : search + chips =================== -->
    <div class="flex items-center gap-2 flex-wrap">
      <div class="input-wrap w-72">
        <Search />
        <input
          class="input input-with-icon !h-9"
          placeholder="Joueur, équipe ou coach"
          aria-label="Rechercher une demande de licence"
          :value="store.search"
          @input="store.setSearch(($event.target as HTMLInputElement).value)"
        >
      </div>

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

      <Button
        v-if="hasActiveFilters"
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
        :row-style="rowStyle"
        @row-click="onRowClick"
      >
        <template #empty>
          <div
            v-if="isEmptyAll"
            class="px-3 py-10 text-center flex flex-col items-center gap-2"
          >
            <span
              class="w-10 h-10 rounded-full bg-surface-100 inline-flex items-center justify-center text-surface-500"
            >
              <FileText
                :size="18"
                :stroke-width="2"
              />
            </span>
            <div class="text-[14px] font-semibold">
              Aucune demande de licence pour l'instant.
            </div>
            <div class="text-[12px] text-surface-500 max-w-md">
              Les demandes apparaîtront ici dès qu'un coach déclenchera une
              demande depuis l'app companion.
            </div>
          </div>
          <div
            v-else-if="isFilteredOut"
            class="px-3 py-10 text-center flex flex-col items-center gap-2 text-[12px] text-surface-500"
          >
            <div>Aucune demande ne correspond à vos critères.</div>
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
            Chargement des demandes…
          </div>
        </template>

        <Column
          header="Joueur"
          sortable
          sort-field="denorm.memberLastName"
        >
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
                <div
                  v-if="!(data as LicenseRequest).denorm"
                  class="text-[11px] text-surface-500 font-mono"
                >
                  {{ memberIdShort(data as LicenseRequest) }}
                </div>
              </div>
            </div>
          </template>
        </Column>

        <Column
          header="Équipe"
          :pt="{ headerCell: { style: 'width: 160px' } }"
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
          :pt="{ headerCell: { style: 'width: 160px' } }"
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
          :pt="{ headerCell: { style: 'width: 150px' } }"
        >
          <template #body="{ data }">
            <Pill :variant="statusPill((data as LicenseRequest).status).variant">
              {{ statusPill((data as LicenseRequest).status).label }}
            </Pill>
          </template>
        </Column>

        <Column
          header="Docs uploadés"
          :pt="{
            headerCell: { style: 'width: 130px', class: 'text-right' },
            bodyCell: { class: 'text-right num' },
          }"
        >
          <template #body="{ data }">
            <span
              class="inline-flex items-center gap-1 text-[12px]"
              :class="
                docsProgress(data as LicenseRequest).isTerminal
                  ? 'text-emerald-700'
                  : 'text-surface-700'
              "
            >
              <CheckCircle2
                v-if="docsProgress(data as LicenseRequest).isTerminal"
                :size="12"
                :stroke-width="2"
              />
              {{ docsProgress(data as LicenseRequest).done }}/{{ docsProgress(data as LicenseRequest).total }}
            </span>
          </template>
        </Column>

        <Column
          header="Date"
          :pt="{ headerCell: { style: 'width: 140px' } }"
        >
          <template #body="{ data }">
            <span class="text-[12px] text-surface-600 num">
              {{ formatDate((data as LicenseRequest).createdAt) }}
            </span>
          </template>
        </Column>

        <Column
          v-if="store.isAdminScope"
          header=""
          :pt="{ headerCell: { style: 'width: 48px' }, bodyCell: { class: 'text-right' } }"
        >
          <template #body="{ data }">
            <button
              v-if="canDelete(data as LicenseRequest)"
              type="button"
              class="btn btn-ghost btn-sm !px-1.5 text-rose-600"
              :disabled="store.actionPendingId === (data as LicenseRequest).id"
              title="Supprimer la demande en cours"
              aria-label="Supprimer la demande de licence"
              @click.stop="openDeleteDialog((data as LicenseRequest).id)"
            >
              <Trash2
                :size="13"
                :stroke-width="2"
              />
            </button>
          </template>
        </Column>
      </DataTable>

      <!-- Footer count -->
      <div
        class="flex items-center justify-between border-t border-surface-200 px-4 h-11 text-[12px] text-surface-500 gap-3 flex-wrap"
      >
        <div>
          <template v-if="store.loading && store.requests.length === 0">
            Chargement…
          </template>
          <template v-else>
            {{ store.filtered.length }} sur {{ store.requests.length }}
            demande<span v-if="store.requests.length > 1">s</span>
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
      Erreur de chargement des demandes ({{ store.error }}).
    </div>

    <!-- ================= Delete confirmation dialog =================== -->
    <Dialog
      v-model:visible="deleteDialogOpen"
      modal
      :draggable="false"
      :closable="store.actionPendingId === null"
      :close-on-escape="store.actionPendingId === null"
      :style="{ width: '480px' }"
    >
      <template #header>
        <span class="flex items-center gap-2 text-rose-700 font-semibold">
          <TriangleAlert
            :size="16"
            :stroke-width="2"
          />
          Supprimer la demande de licence
        </span>
      </template>

      <div
        v-if="deleteTargetRequest"
        class="space-y-3 pt-1 text-[13px]"
      >
        <div class="card bg-amber-50 border-amber-200 px-3 py-2 text-[12px] text-amber-900 flex items-start gap-2">
          <TriangleAlert
            :size="14"
            :stroke-width="2"
            class="mt-0.5 shrink-0"
          />
          <p class="leading-snug">
            Cette action est destinée à corriger une demande créée par
            <strong>erreur</strong>. La voie normale d'extinction reste le
            <strong>refus</strong> (motif + audit trail conservés). Une fois
            supprimée, la demande et ses documents uploadés ne sont plus
            récupérables.
          </p>
        </div>

        <div class="card bg-surface-50 border-surface-200 px-3 py-2 text-[12px] text-surface-700 space-y-0.5">
          <div>
            Joueur :
            <strong>{{ memberName(deleteTargetRequest) }}</strong>
          </div>
          <div>
            Équipe :
            <span>{{ teamName(deleteTargetRequest) }}</span>
          </div>
          <div>
            Coach :
            <span>{{ coachName(deleteTargetRequest) }}</span>
          </div>
          <div>
            Statut actuel :
            <Pill :variant="statusPill(deleteTargetRequest.status).variant">
              {{ statusPill(deleteTargetRequest.status).label }}
            </Pill>
          </div>
          <div class="text-rose-700 pt-1">
            <strong>Action irréversible.</strong>
          </div>
        </div>

        <label class="block">
          <span class="text-[12px] text-surface-700">
            Tapez
            <code class="font-mono text-rose-700">{{ DELETE_CONFIRM_TOKEN }}</code>
            pour confirmer
          </span>
          <InputText
            v-model="deleteConfirmInput"
            class="mt-1 w-full"
            :placeholder="DELETE_CONFIRM_TOKEN"
            :disabled="store.actionPendingId !== null"
            autocomplete="off"
            @keyup.enter="submitDelete"
          />
        </label>
      </div>

      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="store.actionPendingId !== null"
          @click="closeDeleteDialog"
        >
          Retour
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm !bg-rose-600 hover:!bg-rose-700 disabled:!bg-rose-300"
          :disabled="!canSubmitDelete"
          @click="submitDelete"
        >
          <Trash2
            :size="14"
            :stroke-width="2"
          />
          <template v-if="store.actionPendingId !== null">
            Suppression…
          </template>
          <template v-else>
            Supprimer définitivement
          </template>
        </button>
      </template>
    </Dialog>
  </section>
</template>
