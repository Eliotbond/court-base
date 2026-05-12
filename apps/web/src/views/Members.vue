<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  Check,
  Download,
  Filter,
  Search,
  TriangleAlert,
  Upload,
  UserPlus,
  Users,
  UsersRound,
  X,
} from 'lucide-vue-next'
import DataTable, { type DataTableRowClickEvent } from 'primevue/datatable'
import Column from 'primevue/column'
import { useMembersStore, type MemberQuickFilter } from '@/stores/members'
import type { MemberRow } from '@/repositories/members.repo'
import type { DuesStatus } from '@club-app/shared-types'
import Avatar from '@/components/ui/Avatar.vue'
import Chip from '@/components/ui/Chip.vue'
import Pill from '@/components/ui/Pill.vue'
import RoleBadge from '@/components/ui/RoleBadge.vue'
import { useRoleColors } from '@/composables/useRoleColors'

const store = useMembersStore()
const router = useRouter()
const { colorsFor, labelFor } = useRoleColors()

onMounted(() => {
  void store.load()
})

const rows = computed<MemberRow[]>(() => store.filtered)
const counts = computed(() => store.counts)

// ---------------------------------------------------------------------------
// Heading subline — "X membres · Y officiels · Z coachs".
// ---------------------------------------------------------------------------

const headingSubline = computed(() => {
  const c = counts.value
  return `${c.all} membres · ${c.officials} officiels · ${c.coachs} coachs`
})

// ---------------------------------------------------------------------------
// Quick filter chips — déclaratif, drive le store.
// ---------------------------------------------------------------------------

interface ChipDef {
  id: MemberQuickFilter
  label: string
  /** Si null, on lit counts[id] ; sinon, on affiche cette valeur (rouge pour
   *  "dues overdue" qui appelle l'attention). */
  badgeClass?: string
}

const CHIPS: readonly ChipDef[] = [
  { id: 'all', label: 'Tous' },
  { id: 'players', label: 'Joueurs' },
  { id: 'officials', label: 'Officiels' },
  { id: 'coachs', label: 'Coachs' },
  { id: 'comite', label: 'Comité' },
  { id: 'unlicensed', label: 'Sans licence' },
  { id: 'duesOverdue', label: 'Cotisation en retard', badgeClass: 'text-rose-600' },
] as const

// ---------------------------------------------------------------------------
// Dues pill — couleur + label selon DuesStatus (cf. design Mockups).
// ---------------------------------------------------------------------------

type PillVariant = 'emerald' | 'sky' | 'amber' | 'rose' | 'slate' | 'violet'

interface DuesPillDef {
  variant: PillVariant
  label: string
  strike: boolean
}

function duesPill(status: DuesStatus): DuesPillDef {
  switch (status) {
    case 'ok':
      return { variant: 'emerald', label: 'À jour', strike: false }
    case 'pending_grace':
      return { variant: 'slate', label: 'pending_grace', strike: false }
    case 'due':
      return { variant: 'sky', label: 'issued', strike: false }
    case 'overdue':
      return { variant: 'rose', label: 'overdue', strike: false }
    case 'excluded':
      return { variant: 'rose', label: 'excluded', strike: false }
    case 'excepted':
      return { variant: 'amber', label: 'excepted', strike: false }
    case 'n/a':
    default:
      return { variant: 'slate', label: 'n/a', strike: true }
  }
}

// ---------------------------------------------------------------------------
// Last-login formatter — "il y a Xj" / "il y a Xh" / "—".
// ---------------------------------------------------------------------------

function formatLastLogin(d: Date | null): string {
  if (!d) return '—'
  const diffMs = Date.now() - d.getTime()
  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return "à l'instant"
  if (min < 60) return `il y a ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `il y a ${h} h`
  const days = Math.floor(h / 24)
  if (days === 1) return 'hier'
  if (days < 30) return `il y a ${days} j`
  const months = Math.floor(days / 30)
  return `il y a ${months} mois`
}

// ---------------------------------------------------------------------------
// Row click → navigate to /members/:id (placeholder pour l'instant).
// ---------------------------------------------------------------------------

function onRowClick(event: DataTableRowClickEvent): void {
  // PrimeVue passe la donnée brute dans event.data.
  const data = event.data as MemberRow
  void router.push({ name: 'member-detail', params: { id: data.id } })
}

const noop = (): void => {
  /* TODO(actions): wire Importer CSV / Exporter / Ajouter membre. */
}

function fullName(m: MemberRow): string {
  return `${m.firstName} ${m.lastName}`
}
</script>

<template>
  <section class="p-6 space-y-4">
    <!-- ================= Page heading =================== -->
    <div class="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-[22px] font-semibold tracking-tight">
          Members
        </h1>
        <p class="text-[13px] text-surface-500 mt-0.5">
          {{ headingSubline }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          @click="noop"
        >
          <Upload
            :size="14"
            :stroke-width="2"
          />
          Importer CSV
        </button>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          @click="noop"
        >
          <Download
            :size="14"
            :stroke-width="2"
          />
          Exporter
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          @click="noop"
        >
          <UserPlus
            :size="14"
            :stroke-width="2"
          />
          Ajouter membre
        </button>
      </div>
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
        <span
          class="ml-1 text-[11px] num"
          :class="chip.badgeClass"
        >{{ counts[chip.id] }}</span>
      </Chip>

      <div class="ml-auto flex items-center gap-2">
        <div class="input-wrap w-72">
          <Search />
          <input
            class="input input-with-icon !h-8"
            placeholder="Nom, email, téléphone…"
            :value="store.search"
            @input="store.setSearch(($event.target as HTMLInputElement).value)"
          >
        </div>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          @click="noop"
        >
          <Users
            :size="14"
            :stroke-width="2"
          />
          Équipe : toutes
        </button>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          @click="noop"
        >
          <Filter
            :size="14"
            :stroke-width="2"
          />
          Plus
        </button>
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
        selection-mode="single"
        :pt="{ bodyRow: { class: 'cursor-pointer' } }"
        @row-click="onRowClick"
      >
        <template #empty>
          <!-- Distinguer "club vide" (1ʳᵉ utilisation, /members Firestore vide)
               vs "aucun résultat pour ces filtres". Aligné sur Teams.vue
               (icon + title + body + CTA primary). -->
          <div
            v-if="!store.loading && store.members.length === 0"
            class="px-3 py-10 text-center flex flex-col items-center gap-2"
          >
            <span
              class="w-10 h-10 rounded-full bg-surface-100 inline-flex items-center justify-center text-surface-500"
            >
              <UsersRound
                :size="18"
                :stroke-width="2"
              />
            </span>
            <div class="text-[14px] font-semibold">
              Aucun membre dans le club
            </div>
            <div class="text-[12px] text-surface-500 max-w-md">
              Importe un CSV ou ajoute manuellement les premiers membres pour
              démarrer.
            </div>
            <div class="flex items-center gap-2 mt-2">
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                @click="noop"
              >
                <Upload
                  :size="14"
                  :stroke-width="2"
                />
                Importer CSV
              </button>
              <button
                type="button"
                class="btn btn-primary btn-sm"
                @click="noop"
              >
                <UserPlus
                  :size="14"
                  :stroke-width="2"
                />
                Ajouter membre
              </button>
            </div>
          </div>
          <div
            v-else-if="store.loading && store.members.length === 0"
            class="px-3 py-10 text-center text-[12px] text-surface-500"
            aria-busy="true"
          >
            Chargement des membres…
          </div>
          <div
            v-else
            class="px-3 py-10 text-center text-[12px] text-surface-500"
          >
            Aucun membre ne correspond à vos filtres.
          </div>
        </template>

        <Column
          field="lastName"
          header="Nom"
          sortable
        >
          <template #body="{ data }">
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
                <div class="text-[11px] text-surface-500">
                  <template v-if="data.email">
                    {{ data.email }}
                  </template>
                  <template v-else>
                    — pas de compte lié
                  </template>
                  <template v-if="data.licenseNumber">
                    ·
                    <span class="font-mono">{{ data.licenseNumber }}</span>
                  </template>
                </div>
              </div>
            </div>
          </template>
        </Column>

        <Column
          header="Rôles"
          :pt="{ headerCell: { style: 'width: 224px' } }"
        >
          <template #body="{ data }">
            <div class="flex flex-wrap gap-1">
              <RoleBadge
                v-for="role in data.roles"
                :key="role"
                :label="labelFor(role)"
                :bg="colorsFor(role).bg"
                :color="colorsFor(role).fg"
              />
            </div>
          </template>
        </Column>

        <Column
          header="Équipes"
          :pt="{ headerCell: { style: 'width: 176px' } }"
        >
          <template #body="{ data }">
            <div
              v-if="data.teamLabels.length === 0"
              class="text-surface-400"
            >
              —
            </div>
            <div
              v-else
              class="flex flex-wrap gap-1"
            >
              <Pill
                v-for="team in data.teamLabels"
                :key="team"
                variant="slate"
              >
                {{ team }}
              </Pill>
            </div>
          </template>
        </Column>

        <Column
          header="Off. level"
          :pt="{
            headerCell: { style: 'width: 96px', class: 'text-center' },
            bodyCell: { class: 'text-center' },
          }"
        >
          <template #body="{ data }">
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
            headerCell: { style: 'width: 80px', class: 'text-center' },
            bodyCell: { class: 'text-center' },
          }"
        >
          <template #body="{ data }">
            <Check
              v-if="data.licensed"
              :size="16"
              :stroke-width="2"
              class="text-emerald-600 inline-block"
              aria-label="licencié"
            />
            <X
              v-else
              :size="16"
              :stroke-width="2"
              class="text-surface-400 inline-block"
              aria-label="non licencié"
            />
          </template>
        </Column>

        <Column
          header="Cotisation"
          :pt="{ headerCell: { style: 'width: 128px' } }"
        >
          <template #body="{ data }">
            <Pill
              :variant="duesPill(data.duesStatus).variant"
              :strike="duesPill(data.duesStatus).strike"
            >
              {{ duesPill(data.duesStatus).label }}
            </Pill>
          </template>
        </Column>

        <Column
          header="Dernier login"
          :pt="{ headerCell: { style: 'width: 128px' } }"
        >
          <template #body="{ data }">
            <span class="text-[12px] text-surface-500 num">
              {{ formatLastLogin(data.lastLoginAt) }}
            </span>
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
            {{ rows.length }} sur {{ counts.all }} résultat<span v-if="rows.length > 1">s</span>
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
