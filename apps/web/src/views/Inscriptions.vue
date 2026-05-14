<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  Ban,
  CalendarClock,
  CircleCheck,
  ClipboardList,
  Filter,
  Mail,
  Phone,
  PlayCircle,
  Search,
  ShieldCheck,
  ShieldX,
  TriangleAlert,
} from 'lucide-vue-next'
import Dialog from 'primevue/dialog'
import Drawer from 'primevue/drawer'
import Select from 'primevue/select'
import Textarea from 'primevue/textarea'
import {
  useRegistrationsStore,
  type RegistrationQuickFilter,
  type RegistrationTeamFilter,
} from '@/stores/registrations'
import {
  isConfirmable,
  isMarkTrialPossible,
  isRefusable,
  registrationStatusLabel,
  registrationStatusVariant,
  type RegistrationRow,
} from '@/repositories/registrations.repo'
import type { Timestamp } from '@club-app/shared-types'
import Avatar from '@/components/ui/Avatar.vue'
import Chip from '@/components/ui/Chip.vue'
import Pill from '@/components/ui/Pill.vue'

const store = useRegistrationsStore()

onMounted(() => {
  void store.load()
})

// ---------------------------------------------------------------------------
// Chips (quick filters) — un seul actif à la fois.
// ---------------------------------------------------------------------------

interface QuickChip {
  id: RegistrationQuickFilter
  label: string
}

const QUICK_CHIPS: readonly QuickChip[] = [
  { id: 'active', label: 'En cours' },
  { id: 'submitted', label: 'À examiner' },
  { id: 'trial', label: 'En essai' },
  { id: 'done', label: 'Validées' },
  { id: 'terminal', label: 'Refusées / annulées' },
  { id: 'all', label: 'Toutes' },
] as const

function chipCount(id: RegistrationQuickFilter): number {
  return store.counts[id]
}

// ---------------------------------------------------------------------------
// Team filter — Select piloté par les équipes présentes dans la liste.
// ---------------------------------------------------------------------------

interface TeamOption {
  value: RegistrationTeamFilter
  label: string
  count: number | null
}

const teamOptions = computed<TeamOption[]>(() => {
  const all: TeamOption = {
    value: 'all',
    label: store.isAdminScope ? 'Toutes les équipes' : 'Mes équipes',
    count: null,
  }
  const items = store.teamsInList.map<TeamOption>((t) => ({
    value: t.id,
    label: t.name,
    count: t.count,
  }))
  return [all, ...items]
})

// ---------------------------------------------------------------------------
// Date helpers — Firestore Timestamp → string lisible.
// ---------------------------------------------------------------------------

function formatRelativeDate(ts: Timestamp | null | undefined): string {
  if (!ts || !ts.seconds) return ''
  const dateMs = ts.seconds * 1000
  const diffMs = Date.now() - dateMs
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return "À l'instant"
  if (minutes < 60) return `Il y a ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Il y a ${hours} h`
  const days = Math.round(hours / 24)
  if (days < 30) return `Il y a ${days} j`
  // > 1 mois → date FR courte
  return new Date(dateMs).toLocaleDateString('fr-CH', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function formatFullDate(ts: Timestamp | null | undefined): string {
  if (!ts || !ts.seconds) return '—'
  return new Date(ts.seconds * 1000).toLocaleString('fr-CH', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatBirthDate(ts: Timestamp | null | undefined): string {
  if (!ts || !ts.seconds || ts.seconds < 1000) return '—'
  return new Date(ts.seconds * 1000).toLocaleDateString('fr-CH', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

// ---------------------------------------------------------------------------
// Relationship label — short FR translation.
// ---------------------------------------------------------------------------

function relationshipLabel(r: RegistrationRow): string {
  if (r.registrationFor === 'self') return 'Inscription personnelle'
  switch (r.relationship) {
    case 'parent':
      return 'Parent'
    case 'legal_guardian':
      return 'Tuteur légal'
    case 'sibling':
      return 'Frère / sœur'
    case 'caritas':
      return 'Caritas'
    case 'other':
      return r.relationshipOther ?? 'Autre'
    default:
      return 'Inscription pour un proche'
  }
}

// ---------------------------------------------------------------------------
// Drawer state — bridge sur `selectedRegistrationId`.
// ---------------------------------------------------------------------------

const drawerOpen = computed<boolean>({
  get: () => store.selectedRegistrationId !== null,
  set: (v: boolean) => {
    if (!v) store.closeDrawer()
  },
})

function openRow(r: RegistrationRow): void {
  store.openDrawer(r.id)
}

// ---------------------------------------------------------------------------
// Refuse dialog — saisie d'un motif obligatoire (validé côté server).
// ---------------------------------------------------------------------------

const refuseDialogOpen = ref(false)
const refuseReason = ref('')
const refuseError = ref<string | null>(null)
const refuseTargetId = ref<string | null>(null)

function openRefuseDialog(id: string): void {
  refuseTargetId.value = id
  refuseReason.value = ''
  refuseError.value = null
  refuseDialogOpen.value = true
}

function closeRefuseDialog(): void {
  refuseDialogOpen.value = false
  refuseTargetId.value = null
  refuseReason.value = ''
  refuseError.value = null
}

async function submitRefuse(): Promise<void> {
  const id = refuseTargetId.value
  if (!id) return
  const reason = refuseReason.value.trim()
  if (reason.length === 0) {
    refuseError.value = 'Motif requis (sera visible par l’auteur).'
    return
  }
  const ok = await store.refuse(id, reason)
  if (ok) closeRefuseDialog()
}

// ---------------------------------------------------------------------------
// Mark trial dialog — confirme le démarrage de la période d'essai 14j.
// ---------------------------------------------------------------------------

const markTrialDialogOpen = ref(false)
const markTrialTargetId = ref<string | null>(null)

function openMarkTrialDialog(id: string): void {
  markTrialTargetId.value = id
  markTrialDialogOpen.value = true
}

function closeMarkTrialDialog(): void {
  markTrialDialogOpen.value = false
  markTrialTargetId.value = null
}

async function submitMarkTrial(): Promise<void> {
  const id = markTrialTargetId.value
  if (!id) return
  const ok = await store.markTrial(id)
  if (ok) closeMarkTrialDialog()
}

// ---------------------------------------------------------------------------
// Confirm dialog — confirme l'intégration : crée le member (si nouveau),
// ajoute au team.playerIds, déclenche l'émission de la cotisation.
// ---------------------------------------------------------------------------

const confirmDialogOpen = ref(false)
const confirmTargetId = ref<string | null>(null)

const confirmTargetRegistration = computed<RegistrationRow | null>(() => {
  const id = confirmTargetId.value
  if (!id) return null
  return store.items.find((r) => r.id === id) ?? null
})

function openConfirmDialog(id: string): void {
  confirmTargetId.value = id
  confirmDialogOpen.value = true
}

function closeConfirmDialog(): void {
  confirmDialogOpen.value = false
  confirmTargetId.value = null
}

async function submitConfirm(): Promise<void> {
  const id = confirmTargetId.value
  if (!id) return
  const ok = await store.confirmToDues(id)
  if (ok) closeConfirmDialog()
}

// ---------------------------------------------------------------------------
// Empty state copy — dépend du contexte.
// ---------------------------------------------------------------------------

const emptyCopy = computed(() => {
  if (store.search.trim().length > 0) {
    return {
      title: 'Aucune inscription trouvée',
      body: `Aucune inscription ne correspond à « ${store.search} ».`,
    }
  }
  if (store.quickFilter !== 'all') {
    return {
      title: 'Aucune inscription dans ce filtre',
      body: 'Change de filtre ou affiche toutes les inscriptions.',
    }
  }
  return store.isAdminScope
    ? {
        title: 'Aucune inscription',
        body: 'Les nouvelles inscriptions issues du portail public apparaîtront ici.',
      }
    : {
        title: 'Aucune inscription pour vos équipes',
        body: 'Les nouvelles inscriptions vous concernant apparaîtront ici.',
      }
})

const totalsLine = computed(() => {
  const total = store.counts.all
  if (store.isAdminScope) {
    return `${total} inscription${total > 1 ? 's' : ''} · vue admin`
  }
  return `${total} inscription${total > 1 ? 's' : ''} · vos équipes`
})
</script>

<template>
  <section class="p-6 space-y-4">
    <!-- ================= Page heading =================== -->
    <div class="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-[22px] font-semibold tracking-tight">
          Inscriptions
        </h1>
        <p class="text-[13px] text-surface-500 mt-0.5">
          {{ totalsLine }}
        </p>
      </div>
    </div>

    <!-- ================= Quick chips (status buckets) =================== -->
    <div class="flex items-center gap-2 flex-wrap">
      <Chip
        v-for="chip in QUICK_CHIPS"
        :key="chip.id"
        :active="store.quickFilter === chip.id"
        :aria-pressed="store.quickFilter === chip.id"
        @click="store.setQuickFilter(chip.id)"
      >
        {{ chip.label }}
        <span class="ml-1 text-[11px] num">{{ chipCount(chip.id) }}</span>
      </Chip>

      <div class="ml-auto flex items-center gap-2">
        <Select
          v-model="store.teamFilter"
          :options="teamOptions"
          option-label="label"
          option-value="value"
          class="!h-8 min-w-[180px]"
          :pt="{ root: { style: 'height: 32px;' } }"
        >
          <template #option="{ option }">
            <div class="flex items-center justify-between gap-2 w-full">
              <span>{{ option.label }}</span>
              <span
                v-if="option.count !== null"
                class="text-[11px] text-surface-500 num"
              >
                {{ option.count }}
              </span>
            </div>
          </template>
        </Select>
        <div class="input-wrap w-72">
          <Search />
          <input
            class="input input-with-icon !h-8"
            placeholder="Nom du joueur, ancien club…"
            :value="store.search"
            @input="store.setSearch(($event.target as HTMLInputElement).value)"
          >
        </div>
      </div>
    </div>

    <!-- ================= Loading state =================== -->
    <div
      v-if="store.loading && store.items.length === 0"
      class="card p-10 text-center text-[13px] text-surface-500"
      aria-busy="true"
    >
      Chargement des inscriptions…
    </div>

    <!-- ================= Empty state =================== -->
    <div
      v-else-if="store.filtered.length === 0"
      class="card p-10 text-center flex flex-col items-center gap-2"
    >
      <span
        class="w-10 h-10 rounded-full bg-surface-100 inline-flex items-center justify-center text-surface-500"
      >
        <ClipboardList
          :size="18"
          :stroke-width="2"
        />
      </span>
      <div class="text-[14px] font-semibold">
        {{ emptyCopy.title }}
      </div>
      <div class="text-[12px] text-surface-500 max-w-md">
        {{ emptyCopy.body }}
      </div>
    </div>

    <!-- ================= Table =================== -->
    <div
      v-else
      class="card overflow-x-auto"
    >
      <table class="w-full text-[13px]">
        <thead class="text-[11px] text-surface-500 uppercase tracking-wide">
          <tr class="border-b border-surface-200">
            <th class="text-left font-medium px-4 py-2.5">
              Joueur
            </th>
            <th class="text-left font-medium px-4 py-2.5">
              Équipe
            </th>
            <th class="text-left font-medium px-4 py-2.5">
              Statut
            </th>
            <th class="text-left font-medium px-4 py-2.5">
              Soumise
            </th>
            <th class="text-right font-medium px-4 py-2.5">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in store.filtered"
            :key="row.id"
            class="border-b border-surface-100 hover:bg-surface-50 cursor-pointer"
            @click="openRow(row)"
          >
            <td class="px-4 py-2.5">
              <div class="flex items-center gap-2.5 min-w-0">
                <Avatar
                  :name="row.playerFullName || '?'"
                  :size="28"
                />
                <div class="min-w-0">
                  <div class="font-medium truncate">
                    {{ row.playerFullName || '— inconnu —' }}
                  </div>
                  <div class="text-[11px] text-surface-500 truncate">
                    <template v-if="row.playerAge !== null">
                      {{ row.playerAge }} ans ·
                    </template>
                    {{ relationshipLabel(row) }}
                  </div>
                </div>
              </div>
            </td>
            <td class="px-4 py-2.5">
              <div class="font-medium truncate">
                {{ row.team?.name ?? '— inconnue —' }}
              </div>
            </td>
            <td class="px-4 py-2.5">
              <Pill :variant="registrationStatusVariant(row.status)">
                {{ registrationStatusLabel(row.status) }}
              </Pill>
              <div
                v-if="row.foreignTransfer"
                class="text-[10px] text-amber-700 mt-1 flex items-center gap-1"
              >
                <TriangleAlert
                  :size="11"
                  :stroke-width="2"
                />
                Transfert étranger
              </div>
            </td>
            <td class="px-4 py-2.5 text-surface-500">
              {{ formatRelativeDate(row.createdAt) }}
            </td>
            <td class="px-4 py-2.5 text-right">
              <div class="inline-flex items-center gap-1.5">
                <button
                  v-if="isMarkTrialPossible(row.status)"
                  type="button"
                  class="btn btn-secondary btn-sm"
                  :disabled="store.actionPendingId === row.id"
                  title="Démarre la période d'essai de 14 jours"
                  @click.stop="openMarkTrialDialog(row.id)"
                >
                  <CalendarClock
                    :size="13"
                    :stroke-width="2"
                  />
                  Planifier essai
                </button>
                <button
                  v-if="isConfirmable(row.status)"
                  type="button"
                  class="btn btn-primary btn-sm"
                  :disabled="store.actionPendingId === row.id"
                  title="Confirme l'intégration → cotisation émise"
                  @click.stop="openConfirmDialog(row.id)"
                >
                  <PlayCircle
                    :size="13"
                    :stroke-width="2"
                  />
                  Confirmer
                </button>
                <button
                  v-if="isRefusable(row.status)"
                  type="button"
                  class="btn btn-secondary btn-sm"
                  :disabled="store.actionPendingId === row.id"
                  @click.stop="openRefuseDialog(row.id)"
                >
                  <Ban
                    :size="13"
                    :stroke-width="2"
                  />
                  Refuser
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ================= Footer count =================== -->
    <div
      v-if="store.filtered.length > 0"
      class="text-[12px] text-surface-500 flex items-center gap-1"
    >
      <ClipboardList
        :size="12"
        :stroke-width="2"
      />
      {{ store.filtered.length }} inscription<span v-if="store.filtered.length > 1">s</span>
      affichée<span v-if="store.filtered.length > 1">s</span>
      sur {{ store.counts.all }}
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

    <!-- ================= Detail drawer =================== -->
    <Drawer
      v-model:visible="drawerOpen"
      position="right"
      :show-close-icon="true"
      :pt="{ root: { style: 'width: 480px; max-width: 100vw;' } }"
      aria-label="Détail de l'inscription"
    >
      <template #container="{ closeCallback }">
        <div
          v-if="store.selectedRegistration"
          class="flex flex-col h-full"
        >
          <!-- Drawer header -->
          <header class="flex items-center justify-between gap-3 px-5 py-4 border-b border-surface-200">
            <div class="flex items-center gap-3 min-w-0">
              <Avatar
                :name="store.selectedRegistration.playerFullName || '?'"
                :size="36"
              />
              <div class="min-w-0">
                <div class="text-[15px] font-semibold truncate">
                  {{ store.selectedRegistration.playerFullName || '— inconnu —' }}
                </div>
                <div class="text-[12px] text-surface-500 truncate">
                  {{ store.selectedRegistration.team?.name ?? '— équipe inconnue —' }}
                  <template v-if="store.selectedRegistration.playerAge !== null">
                    · {{ store.selectedRegistration.playerAge }} ans
                  </template>
                </div>
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

          <!-- Drawer body -->
          <div class="flex-1 overflow-y-auto px-5 py-4 space-y-5 text-[13px]">
            <!-- Status -->
            <section class="space-y-2">
              <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
                Statut
              </h4>
              <div class="flex items-center gap-2 flex-wrap">
                <Pill :variant="registrationStatusVariant(store.selectedRegistration.status)">
                  {{ registrationStatusLabel(store.selectedRegistration.status) }}
                </Pill>
                <Pill
                  v-if="store.selectedRegistration.foreignTransfer"
                  variant="amber"
                >
                  Transfert étranger
                </Pill>
                <Pill
                  v-if="store.selectedRegistration.previouslyLicensed"
                  variant="slate"
                >
                  Déjà licencié
                </Pill>
              </div>
              <div class="text-[12px] text-surface-500">
                Mise à jour : {{ formatFullDate(store.selectedRegistration.statusUpdatedAt) }}
              </div>
              <div
                v-if="store.selectedRegistration.refusalReason"
                class="card bg-rose-50 border-rose-200 px-3 py-2 text-[12px] text-rose-700 mt-2"
              >
                <div class="font-semibold flex items-center gap-1">
                  <ShieldX
                    :size="13"
                    :stroke-width="2"
                  />
                  Motif de refus
                </div>
                <div class="mt-1">
                  {{ store.selectedRegistration.refusalReason }}
                </div>
              </div>
            </section>

            <!-- Player identity -->
            <section class="space-y-2">
              <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
                Joueur
              </h4>
              <dl class="grid grid-cols-2 gap-x-3 gap-y-1.5">
                <dt class="text-surface-500">
                  Date de naissance
                </dt>
                <dd>
                  {{ formatBirthDate(store.selectedRegistration.player.birthDate) }}
                </dd>
                <dt class="text-surface-500">
                  Genre
                </dt>
                <dd>
                  <template v-if="store.selectedRegistration.player.gender === 'M'">
                    Masculin
                  </template>
                  <template v-else-if="store.selectedRegistration.player.gender === 'F'">
                    Féminin
                  </template>
                  <template v-else-if="store.selectedRegistration.player.gender === 'other'">
                    Autre
                  </template>
                  <template v-else>
                    —
                  </template>
                </dd>
                <dt class="text-surface-500">
                  Téléphone joueur
                </dt>
                <dd class="flex items-center gap-1">
                  <Phone
                    v-if="store.selectedRegistration.player.phone"
                    :size="12"
                    :stroke-width="2"
                    class="text-surface-400"
                  />
                  {{ store.selectedRegistration.player.phone ?? '—' }}
                </dd>
                <dt class="text-surface-500">
                  AVS
                </dt>
                <dd>
                  <template v-if="store.selectedRegistration.player.avs">
                    {{ store.selectedRegistration.player.avs }}
                  </template>
                  <template v-else-if="store.selectedRegistration.player.avsUnavailable">
                    Non communiqué
                  </template>
                  <template v-else>
                    —
                  </template>
                </dd>
              </dl>
              <div
                v-if="store.selectedRegistration.matchedMemberId"
                class="text-[12px] text-emerald-700 flex items-center gap-1 mt-1"
              >
                <ShieldCheck
                  :size="12"
                  :stroke-width="2"
                />
                Lié à un membre existant
              </div>
            </section>

            <!-- Submission context -->
            <section class="space-y-2">
              <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
                Soumission
              </h4>
              <dl class="grid grid-cols-2 gap-x-3 gap-y-1.5">
                <dt class="text-surface-500">
                  Soumise par
                </dt>
                <dd>
                  {{ relationshipLabel(store.selectedRegistration) }}
                </dd>
                <dt class="text-surface-500">
                  Reçue
                </dt>
                <dd>
                  {{ formatFullDate(store.selectedRegistration.createdAt) }}
                </dd>
                <dt class="text-surface-500">
                  Auteur (uid)
                </dt>
                <dd class="font-mono text-[11px] truncate">
                  {{ store.selectedRegistration.submittedByUid }}
                </dd>
              </dl>
            </section>

            <!-- Sporting history -->
            <section
              v-if="store.selectedRegistration.previouslyLicensed || store.selectedRegistration.previousClubName"
              class="space-y-2"
            >
              <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
                Historique sportif
              </h4>
              <dl class="grid grid-cols-2 gap-x-3 gap-y-1.5">
                <dt class="text-surface-500">
                  Ancien club
                </dt>
                <dd>
                  {{ store.selectedRegistration.previousClubName ?? '—' }}
                  <span
                    v-if="store.selectedRegistration.previousClubAbroad"
                    class="text-[11px] text-amber-700"
                  >
                    (étranger)
                  </span>
                </dd>
                <dt class="text-surface-500">
                  Lettre de sortie
                </dt>
                <dd>
                  <template v-if="store.selectedRegistration.transferLetterStoragePath">
                    Fournie ({{ store.selectedRegistration.transferLetterStoragePath.split('/').pop() }})
                  </template>
                  <template v-else>
                    Non fournie
                  </template>
                </dd>
              </dl>
            </section>

            <!-- Action log (last 5) -->
            <section
              v-if="store.selectedRegistration.actionLog && store.selectedRegistration.actionLog.length > 0"
              class="space-y-2"
            >
              <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
                Journal
              </h4>
              <ul class="space-y-1.5 text-[12px]">
                <li
                  v-for="(entry, idx) in store.selectedRegistration.actionLog.slice(-5).reverse()"
                  :key="`log-${idx}`"
                  class="flex items-start gap-2"
                >
                  <span class="text-surface-400 num text-[11px] shrink-0 mt-0.5">
                    {{ formatRelativeDate(entry.at) }}
                  </span>
                  <span class="min-w-0">
                    <strong class="font-medium">{{ entry.action }}</strong>
                    <template v-if="entry.previousStatus && entry.newStatus">
                      : {{ entry.previousStatus }} → {{ entry.newStatus }}
                    </template>
                    <template v-else-if="entry.newStatus">
                      → {{ entry.newStatus }}
                    </template>
                    <span
                      v-if="entry.note"
                      class="block text-surface-500 mt-0.5"
                    >
                      {{ entry.note }}
                    </span>
                  </span>
                </li>
              </ul>
            </section>
          </div>

          <!-- Drawer footer -->
          <footer class="flex items-center justify-end gap-2 px-5 py-3 border-t border-surface-200 flex-wrap">
            <button
              v-if="isMarkTrialPossible(store.selectedRegistration.status)"
              type="button"
              class="btn btn-secondary btn-sm"
              :disabled="store.actionPendingId === store.selectedRegistration.id"
              @click="openMarkTrialDialog(store.selectedRegistration.id)"
            >
              <CalendarClock
                :size="14"
                :stroke-width="2"
              />
              Planifier essai
            </button>
            <button
              v-if="isConfirmable(store.selectedRegistration.status)"
              type="button"
              class="btn btn-primary btn-sm"
              :disabled="store.actionPendingId === store.selectedRegistration.id"
              @click="openConfirmDialog(store.selectedRegistration.id)"
            >
              <PlayCircle
                :size="14"
                :stroke-width="2"
              />
              Confirmer
            </button>
            <button
              v-if="isRefusable(store.selectedRegistration.status)"
              type="button"
              class="btn btn-secondary btn-sm"
              :disabled="store.actionPendingId === store.selectedRegistration.id"
              @click="openRefuseDialog(store.selectedRegistration.id)"
            >
              <Ban
                :size="14"
                :stroke-width="2"
              />
              Refuser
            </button>
            <button
              v-if="!isMarkTrialPossible(store.selectedRegistration.status)
                && !isConfirmable(store.selectedRegistration.status)
                && !isRefusable(store.selectedRegistration.status)"
              type="button"
              class="btn btn-secondary btn-sm"
              disabled
              :title="`Statut « ${registrationStatusLabel(store.selectedRegistration.status)} » — aucune action possible`"
            >
              <CircleCheck
                :size="14"
                :stroke-width="2"
              />
              Aucune action
            </button>
          </footer>
        </div>
      </template>
    </Drawer>

    <!-- ================= Refuse dialog =================== -->
    <Dialog
      v-model:visible="refuseDialogOpen"
      modal
      :draggable="false"
      :style="{ width: '440px' }"
      header="Refuser l'inscription"
    >
      <div class="space-y-3 pt-1">
        <p class="text-[12px] text-surface-500">
          Le motif sera <strong>visible par l'auteur</strong> et conservé dans
          l'audit (<code class="text-[11px]">/teams/{id}/refusalLogs</code>).
        </p>

        <label class="block">
          <span class="text-[12px] text-surface-600">Motif</span>
          <Textarea
            v-model="refuseReason"
            class="mt-1 w-full"
            rows="4"
            auto-resize
            placeholder="Ex. catégorie pleine, niveau insuffisant, équipe complète…"
            :invalid="!!refuseError"
          />
          <span
            v-if="refuseError"
            class="text-[11px] text-rose-600 mt-1 block"
          >
            {{ refuseError }}
          </span>
        </label>

        <div class="card bg-amber-50 border-amber-200 px-3 py-2 text-[11px] text-amber-800 flex items-start gap-2">
          <Mail
            :size="13"
            :stroke-width="2"
            class="shrink-0 mt-0.5"
          />
          <span>
            Un email automatique sera envoyé à l'auteur. Si une autre équipe est
            ouverte dans la même catégorie, l'inscription pourra être
            re-routée automatiquement.
          </span>
        </div>
      </div>

      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="store.actionPendingId !== null"
          @click="closeRefuseDialog"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="store.actionPendingId !== null"
          @click="submitRefuse"
        >
          <Ban
            :size="14"
            :stroke-width="2"
          />
          <template v-if="store.actionPendingId !== null">
            Refus en cours…
          </template>
          <template v-else>
            Confirmer le refus
          </template>
        </button>
      </template>
    </Dialog>

    <!-- ================= Mark trial dialog =================== -->
    <Dialog
      v-model:visible="markTrialDialogOpen"
      modal
      :draggable="false"
      :style="{ width: '440px' }"
      header="Planifier l'entraînement d'essai"
    >
      <div class="space-y-3 pt-1 text-[13px]">
        <p>
          La période d'essai dure
          <strong>14 jours</strong>. Pendant cette période, le joueur peut venir
          aux entraînements. À l'issue :
        </p>
        <ul class="text-[12px] text-surface-600 space-y-1 list-disc pl-5">
          <li>
            <strong>S'il continue</strong> → confirmer l'intégration (la cotisation
            sera émise automatiquement).
          </li>
          <li>
            <strong>S'il ne continue pas</strong> → refuser l'inscription.
          </li>
        </ul>
        <div class="card bg-sky-50 border-sky-200 px-3 py-2 text-[11px] text-sky-800 flex items-start gap-2">
          <CalendarClock
            :size="13"
            :stroke-width="2"
            class="shrink-0 mt-0.5"
          />
          <span>
            Le démarrage de l'essai sera notifié à l'auteur de l'inscription.
          </span>
        </div>
      </div>
      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="store.actionPendingId !== null"
          @click="closeMarkTrialDialog"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="store.actionPendingId !== null"
          @click="submitMarkTrial"
        >
          <CalendarClock
            :size="14"
            :stroke-width="2"
          />
          <template v-if="store.actionPendingId !== null">
            Démarrage…
          </template>
          <template v-else>
            Démarrer l'essai
          </template>
        </button>
      </template>
    </Dialog>

    <!-- ================= Confirm registration dialog =================== -->
    <Dialog
      v-model:visible="confirmDialogOpen"
      modal
      :draggable="false"
      :style="{ width: '460px' }"
      header="Confirmer l'intégration du joueur"
    >
      <div
        v-if="confirmTargetRegistration"
        class="space-y-3 pt-1 text-[13px]"
      >
        <p>
          Confirmer
          <strong>{{ confirmTargetRegistration.playerFullName }}</strong>
          dans l'équipe
          <strong>{{ confirmTargetRegistration.team?.name ?? '— inconnue —' }}</strong> ?
        </p>
        <ul class="text-[12px] text-surface-600 space-y-1 list-disc pl-5">
          <li v-if="!confirmTargetRegistration.matchedMemberId">
            Un nouveau membre sera créé dans
            <code class="font-mono">/members</code>.
          </li>
          <li v-else>
            Le membre existant
            <code class="font-mono">{{ confirmTargetRegistration.matchedMemberId }}</code>
            sera rattaché à l'équipe.
          </li>
          <li>
            Le joueur sera ajouté à
            <code class="font-mono">team.playerIds</code>.
          </li>
          <li>
            La cotisation sera émise automatiquement
            (<code class="font-mono">initiateDuesOnPlayerActivation</code>).
          </li>
        </ul>
        <div class="card bg-emerald-50 border-emerald-200 px-3 py-2 text-[11px] text-emerald-800 flex items-start gap-2">
          <CircleCheck
            :size="13"
            :stroke-width="2"
            class="shrink-0 mt-0.5"
          />
          <span>
            Statut final :
            <code class="font-mono">confirmed_pending_dues</code> — passera en
            <code class="font-mono">active</code> dès le paiement reçu.
          </span>
        </div>
      </div>
      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="store.actionPendingId !== null"
          @click="closeConfirmDialog"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="store.actionPendingId !== null"
          @click="submitConfirm"
        >
          <PlayCircle
            :size="14"
            :stroke-width="2"
          />
          <template v-if="store.actionPendingId !== null">
            Confirmation…
          </template>
          <template v-else>
            Confirmer et émettre la cotisation
          </template>
        </button>
      </template>
    </Dialog>

    <!-- Filter icon kept for visual parity but unused for now -->
    <span class="hidden">
      <Filter :size="0" />
    </span>
  </section>
</template>
