<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
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
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import MultiSelect from 'primevue/multiselect'
import Select from 'primevue/select'
import InputSwitch from 'primevue/inputswitch'
import DatePicker from 'primevue/datepicker'
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
  // Membres < 18 ans (cf. store : `isMinor(birthDate)` ; birthDate=null traité
  // comme adulte). Utile pour repérer les comptes qui devraient avoir un tuteur.
  { id: 'minors', label: 'Mineurs' },
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
  /* TODO(actions): wire Importer CSV / Exporter. */
}

function fullName(m: MemberRow): string {
  return `${m.firstName} ${m.lastName}`
}

/**
 * Vrai si la `birthDate` du membre (Firestore Timestamp) tombe dans les 18
 * dernières années. Aligné sur la logique du store (`isMinor`) — dupliqué
 * localement pour éviter d'importer un helper interne.
 */
function isMinorRow(m: MemberRow): boolean {
  if (!m.birthDate) return false
  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - 18)
  return m.birthDate.seconds * 1000 > cutoff.getTime()
}

// ---------------------------------------------------------------------------
// Dialog — Créer un membre
//
// Pour l'instant l'admin assigne librement les rôles + le flag `licensed` +
// le `officialLevel` depuis ce form (cf. user request 2026-05-14). Plus tard,
// l'attribution de `licensed` / `official` / `coach` ne sera plus possible
// directement ici : ces rôles seront posés via la création d'une licence
// (workflow dédié — pas implémenté). Le form reste utilisable côté admin
// même après bascule, mais les champs sensibles seront déplacés.
//
// Le link member↔user (linkedUserId) n'est PAS exposé : il sera renseigné
// par le flow d'invitation modifié (cf. docs/main.md "Admin invitation flow").
// ---------------------------------------------------------------------------

interface RoleOption {
  value: string
  label: string
}

const ROLE_OPTIONS: ReadonlyArray<RoleOption> = [
  { value: 'player', label: 'Joueur' },
  { value: 'official', label: 'Officiel' },
  { value: 'coach', label: 'Coach' },
  { value: 'comite', label: 'Comité' },
] as const

interface OfficialLevelOption {
  value: number | null
  label: string
}

const OFFICIAL_LEVEL_OPTIONS: ReadonlyArray<OfficialLevelOption> = [
  { value: null, label: '— Aucun' },
  { value: 1, label: 'Niveau 1' },
  { value: 2, label: 'Niveau 2' },
] as const

interface CreateMemberForm {
  firstName: string
  lastName: string
  email: string
  phone: string
  roles: string[]
  licenseNumber: string
  officialLevel: number | null
  licensed: boolean
  active: boolean
  /**
   * Date de naissance (optionnelle). `null` = inconnue. Le repo gère le
   * fallback en defaults `comms` adulte. Permet aussi de détecter "mineur"
   * pour afficher le hint d'ajout de tuteur.
   */
  birthDate: Date | null
  /** N° AVS au format `756.XXXX.XXXX.XX`. Vide = non renseigné. */
  avs: string
}

interface CreateMemberErrors {
  firstName: string | null
  lastName: string | null
  email: string | null
  officialLevel: string | null
  avs: string | null
}

function makeEmptyCreateForm(): CreateMemberForm {
  return {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    roles: [],
    licenseNumber: '',
    officialLevel: null,
    licensed: false,
    active: true,
    birthDate: null,
    avs: '',
  }
}

/**
 * Format du n° AVS suisse : `756.XXXX.XXXX.XX` (13 chiffres groupés).
 * Dupliqué dans `apps/courtbase-register/.../Step2Identity.vue` et
 * `ProfileTab.vue` — règle légale stable, OK de dupliquer.
 */
const AVS_REGEX = /^756\.\d{4}\.\d{4}\.\d{2}$/

/** Âge légal de majorité (CH) — aligné sur stores/members.ts. */
const MAJORITY_AGE_YEARS = 18

/**
 * Vrai si la date saisie correspond à un mineur (< 18 ans). Sert uniquement
 * à afficher un info chip dans le wizard.
 */
function isMinorDate(d: Date | null, now: number = Date.now()): boolean {
  if (!d) return false
  const cutoff = new Date(now)
  cutoff.setFullYear(cutoff.getFullYear() - MAJORITY_AGE_YEARS)
  return d.getTime() > cutoff.getTime()
}

const isCreateOpen = ref(false)
const createForm = reactive<CreateMemberForm>(makeEmptyCreateForm())
const createErrors = reactive<CreateMemberErrors>({
  firstName: null,
  lastName: null,
  email: null,
  officialLevel: null,
  avs: null,
})
const submittingCreate = ref(false)

function openCreateDialog(): void {
  Object.assign(createForm, makeEmptyCreateForm())
  createErrors.firstName = null
  createErrors.lastName = null
  createErrors.email = null
  createErrors.officialLevel = null
  createErrors.avs = null
  isCreateOpen.value = true
}

function closeCreateDialog(): void {
  isCreateOpen.value = false
}

// Regex email simple — pas RFC, juste "qqch@qqch.qqch". Suffisant pour
// repérer les fautes de frappe avant submit.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validateCreateForm(): boolean {
  createErrors.firstName = createForm.firstName.trim() ? null : 'Prénom requis'
  createErrors.lastName = createForm.lastName.trim() ? null : 'Nom requis'

  const email = createForm.email.trim()
  createErrors.email =
    !email || EMAIL_REGEX.test(email) ? null : 'Email invalide'

  // Cohérence officiel : si on pose un officialLevel sans le rôle official,
  // l'admin a probablement oublié le rôle. On le bloque pour éviter un
  // membre "fantôme officiel" qui n'apparaîtrait pas dans le filtre
  // Officiels (cf. counts.officials qui filtre sur `roles.includes('official')`).
  const isOfficial = createForm.roles.includes('official')
  if (createForm.officialLevel !== null && !isOfficial) {
    createErrors.officialLevel =
      'Cocher le rôle "Officiel" pour assigner un niveau'
  } else {
    createErrors.officialLevel = null
  }

  // AVS optionnel mais si fourni doit matcher le format suisse.
  const avs = createForm.avs.trim()
  createErrors.avs =
    !avs || AVS_REGEX.test(avs) ? null : 'Format attendu : 756.XXXX.XXXX.XX'

  return (
    !createErrors.firstName &&
    !createErrors.lastName &&
    !createErrors.email &&
    !createErrors.officialLevel &&
    !createErrors.avs
  )
}

async function submitCreate(): Promise<void> {
  if (!validateCreateForm()) return
  submittingCreate.value = true
  try {
    const email = createForm.email.trim()
    const phone = createForm.phone.trim()
    const avs = createForm.avs.trim()
    const newId = await store.createMember({
      firstName: createForm.firstName.trim(),
      lastName: createForm.lastName.trim(),
      roles: [...createForm.roles],
      licenseNumber: createForm.licenseNumber.trim(),
      officialLevel: createForm.officialLevel,
      licensed: createForm.licensed,
      active: createForm.active,
      email: email || undefined,
      phone: phone || undefined,
      birthDate: createForm.birthDate,
      avs: avs || null,
    })
    if (newId) {
      closeCreateDialog()
    }
  } finally {
    submittingCreate.value = false
  }
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
          @click="openCreateDialog"
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

      <!-- ===== Status toggle (active / archived) ===== -->
      <div class="ml-2 inline-flex border border-surface-200 rounded-md overflow-hidden text-[12px]">
        <button
          type="button"
          class="px-2.5 py-1"
          :class="{
            'bg-surface-100 text-surface-900 font-medium': store.archivedView === 'active',
            'text-surface-500': store.archivedView !== 'active',
          }"
          @click="store.setArchivedView('active')"
        >
          Actifs
        </button>
        <button
          type="button"
          class="px-2.5 py-1 border-l border-surface-200"
          :class="{
            'bg-surface-100 text-surface-900 font-medium': store.archivedView === 'archived',
            'text-surface-500': store.archivedView !== 'archived',
          }"
          @click="store.setArchivedView('archived')"
        >
          Archivés
          <span class="ml-1 text-[11px] num text-surface-500">
            {{ counts.archived }}
          </span>
        </button>
      </div>

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
                @click="openCreateDialog"
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
                  class="font-medium flex items-center gap-1.5"
                  :class="data.active ? '' : 'line-through text-surface-500'"
                >
                  {{ fullName(data) }}
                  <Pill
                    v-if="isMinorRow(data)"
                    variant="amber"
                  >
                    Mineur
                  </Pill>
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

    <!-- ================= Dialog — Ajouter un membre =================== -->
    <Dialog
      v-model:visible="isCreateOpen"
      modal
      :draggable="false"
      :style="{ width: '560px' }"
      header="Nouveau membre"
    >
      <div class="space-y-4 pt-1">
        <!-- Identité -->
        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-[12px] text-surface-600">Prénom <span class="text-rose-500">*</span></span>
            <InputText
              v-model="createForm.firstName"
              class="mt-1 w-full"
              :invalid="!!createErrors.firstName"
              @keyup.enter="submitCreate"
            />
            <span
              v-if="createErrors.firstName"
              class="text-[11px] text-rose-600 mt-1 block"
            >
              {{ createErrors.firstName }}
            </span>
          </label>
          <label class="block">
            <span class="text-[12px] text-surface-600">Nom <span class="text-rose-500">*</span></span>
            <InputText
              v-model="createForm.lastName"
              class="mt-1 w-full"
              :invalid="!!createErrors.lastName"
              @keyup.enter="submitCreate"
            />
            <span
              v-if="createErrors.lastName"
              class="text-[11px] text-rose-600 mt-1 block"
            >
              {{ createErrors.lastName }}
            </span>
          </label>
        </div>

        <!-- Contact -->
        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-[12px] text-surface-600">Email</span>
            <InputText
              v-model="createForm.email"
              class="mt-1 w-full"
              placeholder="prenom@example.com"
              :invalid="!!createErrors.email"
            />
            <span
              v-if="createErrors.email"
              class="text-[11px] text-rose-600 mt-1 block"
            >
              {{ createErrors.email }}
            </span>
          </label>
          <label class="block">
            <span class="text-[12px] text-surface-600">Téléphone</span>
            <InputText
              v-model="createForm.phone"
              class="mt-1 w-full"
              placeholder="+41 79 123 45 67"
            />
          </label>
        </div>

        <!-- Date de naissance (optionnelle) -->
        <label class="block">
          <span class="text-[12px] text-surface-600">Date de naissance</span>
          <DatePicker
            v-model="createForm.birthDate"
            date-format="dd/mm/yy"
            show-icon
            class="mt-1 w-full"
            :max-date="new Date()"
            placeholder="jj/mm/aaaa"
          />
          <span class="text-[11px] text-surface-500 mt-1 block">
            Optionnel — pourra être renseignée plus tard.
          </span>
          <span
            v-if="isMinorDate(createForm.birthDate)"
            class="text-[11px] text-amber-700 mt-1 inline-flex items-center gap-1"
          >
            <TriangleAlert
              :size="11"
              :stroke-width="2"
            />
            Le membre est mineur — pensez à ajouter un tuteur après la création.
          </span>
        </label>

        <!-- Rôles -->
        <label class="block">
          <span class="text-[12px] text-surface-600">Rôles</span>
          <MultiSelect
            v-model="createForm.roles"
            :options="[...ROLE_OPTIONS]"
            option-label="label"
            option-value="value"
            placeholder="Sélectionner les rôles…"
            class="mt-1 w-full"
            display="chip"
          />
          <span class="text-[11px] text-surface-500 mt-1 block">
            Un membre peut cumuler plusieurs rôles (ex. coach + officiel).
          </span>
        </label>

        <!-- Licence + Officiel -->
        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-[12px] text-surface-600">N° de licence</span>
            <InputText
              v-model="createForm.licenseNumber"
              class="mt-1 w-full"
              placeholder="ex. CH-12345"
            />
          </label>
          <label class="block">
            <span class="text-[12px] text-surface-600">Niveau officiel</span>
            <Select
              v-model="createForm.officialLevel"
              :options="[...OFFICIAL_LEVEL_OPTIONS]"
              option-label="label"
              option-value="value"
              class="mt-1 w-full"
              :invalid="!!createErrors.officialLevel"
            />
            <span
              v-if="createErrors.officialLevel"
              class="text-[11px] text-rose-600 mt-1 block"
            >
              {{ createErrors.officialLevel }}
            </span>
          </label>
        </div>

        <!-- N° AVS (optionnel) -->
        <label class="block">
          <span class="text-[12px] text-surface-600">N° AVS</span>
          <InputText
            v-model="createForm.avs"
            class="mt-1 w-full"
            placeholder="756.XXXX.XXXX.XX"
            :invalid="!!createErrors.avs"
          />
          <span
            v-if="createErrors.avs"
            class="text-[11px] text-rose-600 mt-1 block"
          >
            {{ createErrors.avs }}
          </span>
          <span
            v-else
            class="text-[11px] text-surface-500 mt-1 block"
          >
            Optionnel — format suisse 756.XXXX.XXXX.XX.
          </span>
        </label>

        <!-- Switches -->
        <div class="flex items-center justify-between py-2 border border-surface-100 rounded-lg px-3">
          <div class="min-w-0 pr-3">
            <div class="text-[13px] font-medium">
              Joueur licencié
            </div>
            <div class="text-[11px] text-surface-500 mt-0.5">
              Active la licence du joueur. Sera bientôt géré via la création
              d'une licence dédiée.
            </div>
          </div>
          <InputSwitch v-model="createForm.licensed" />
        </div>

        <div class="flex items-center justify-between py-2 border border-surface-100 rounded-lg px-3">
          <div class="min-w-0 pr-3">
            <div class="text-[13px] font-medium">
              Membre actif
            </div>
            <div class="text-[11px] text-surface-500 mt-0.5">
              Un membre inactif est conservé dans l'historique mais filtré par défaut.
            </div>
          </div>
          <InputSwitch v-model="createForm.active" />
        </div>
      </div>

      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="submittingCreate"
          @click="closeCreateDialog"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="submittingCreate"
          @click="submitCreate"
        >
          <UserPlus
            :size="14"
            :stroke-width="2"
          />
          <template v-if="submittingCreate">
            Création…
          </template>
          <template v-else>
            Créer le membre
          </template>
        </button>
      </template>
    </Dialog>
  </section>
</template>
