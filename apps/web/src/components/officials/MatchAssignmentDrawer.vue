<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Bell,
  Check,
  Clock,
  TriangleAlert,
  UserPlus,
  X,
} from 'lucide-vue-next'
import Drawer from 'primevue/drawer'
import Select from 'primevue/select'
import Button from 'primevue/button'
import Avatar from '@/components/ui/Avatar.vue'
import Pill from '@/components/ui/Pill.vue'
import { useOfficialStaffingStore } from '@/stores/officialStaffing'
import { useOfficialsStore } from '@/stores/officials'
import type { MatchStaffingRow } from '@/repositories/officialStaffing.repo'
import type {
  OfficialAssignment,
  OfficialAssignmentStatus,
} from '@club-app/shared-types'

/**
 * Drawer d'assignation des officiels à un match — écran Officials admin.
 *
 * Architecture en couches (cf. `apps/web/CLAUDE.md`) : toute mutation
 * (`assign` / `setStatus` / `remove`) passe par `useOfficialStaffingStore`.
 * Les noms des officiels sont résolus via `useOfficialsStore` (chargé à
 * l'ouverture si nécessaire). Le composant lit `store.error`.
 */

const props = defineProps<{
  match: MatchStaffingRow | null
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'notify', match: MatchStaffingRow): void
}>()

const store = useOfficialStaffingStore()
const officialsStore = useOfficialsStore()

// ---------------------------------------------------------------------------
// Chargement des officiels (pour résoudre les noms + l'assignation)
// ---------------------------------------------------------------------------

watch(
  () => props.visible,
  (next, prev) => {
    if (next && !prev) {
      selectedOfficialId.value = null
      assignError.value = null
      store.error = null
      if (officialsStore.officials.length === 0) {
        void officialsStore.load()
      }
    }
  },
)

// ---------------------------------------------------------------------------
// Résolution memberId → officiel
// ---------------------------------------------------------------------------

/** Nom complet d'un officiel résolu via `useOfficialsStore`. */
function officialName(memberId: string): string {
  const o = officialsStore.officials.find((x) => x.id === memberId)
  if (!o) return memberId
  return `${o.firstName} ${o.lastName}`
}

/** `officialLevel` courant d'un membre (null si non qualifié). */
function memberLevel(memberId: string): number | null {
  const o = officialsStore.officials.find((x) => x.id === memberId)
  return o?.officialLevel ?? null
}

// ---------------------------------------------------------------------------
// Récap des besoins — pour chaque {level,count}, combien de confirmés.
// ---------------------------------------------------------------------------

interface RequirementSummary {
  level: number
  required: number
  confirmed: number
}

const requirementSummary = computed<RequirementSummary[]>(() => {
  const m = props.match
  if (!m) return []
  return m.requirements.map((req) => {
    const confirmed = m.assignments.filter(
      (a) => a.status === 'confirmed' && a.officialLevel === req.level,
    ).length
    return { level: req.level, required: req.count, confirmed }
  })
})

/**
 * Besoin d'un match À L'EXTÉRIEUR — total simple (`awayOfficialCount`), sans
 * ventilation par niveau. `requiredTotal` porte la cible, `confirmed` compte
 * toutes les assignations confirmées quel que soit le niveau.
 */
const awaySummary = computed<{ required: number; confirmed: number } | null>(
  () => {
    const m = props.match
    if (!m || m.kind !== 'away') return null
    return {
      required: m.requiredTotal,
      confirmed: m.assignments.filter((a) => a.status === 'confirmed').length,
    }
  },
)

// ---------------------------------------------------------------------------
// Status pill mapping
// ---------------------------------------------------------------------------

type PillVariant = 'emerald' | 'amber' | 'rose'

interface StatusDef {
  variant: PillVariant
  label: string
}

function statusDef(status: OfficialAssignmentStatus): StatusDef {
  switch (status) {
    case 'confirmed':
      return { variant: 'emerald', label: 'Confirmé' }
    case 'declined':
      return { variant: 'rose', label: 'Décliné' }
    case 'pending':
    default:
      return { variant: 'amber', label: 'En attente' }
  }
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const dateFormatter = new Intl.DateTimeFormat('fr-CH', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

function formatDate(d: Date | null): string {
  return d ? dateFormatter.format(d) : '—'
}

// ---------------------------------------------------------------------------
// Assignation d'un officiel
// ---------------------------------------------------------------------------

const selectedOfficialId = ref<string | null>(null)
const assignError = ref<string | null>(null)

/** Officiels non encore assignés à ce match — alimente le Select. */
const assignableOfficials = computed(() => {
  const m = props.match
  if (!m) return []
  const assignedIds = new Set(m.assignments.map((a) => a.memberId))
  return officialsStore.officials
    .filter((o) => !assignedIds.has(o.id))
    .map((o) => ({
      value: o.id,
      label: `${o.firstName} ${o.lastName}`,
      level: o.officialLevel,
    }))
})

/** Niveau de l'officiel sélectionné (null si non qualifié). */
const selectedOfficialLevel = computed<number | null>(() => {
  if (!selectedOfficialId.value) return null
  return memberLevel(selectedOfficialId.value)
})

async function assignSelected(): Promise<void> {
  const m = props.match
  const memberId = selectedOfficialId.value
  if (!m || !memberId) return
  assignError.value = null
  try {
    // Fallback niveau 1 si l'officiel n'a pas de `officialLevel` — l'admin
    // est averti par le bandeau ambre ci-dessus.
    await store.assign(m, {
      memberId,
      officialLevel: selectedOfficialLevel.value ?? 1,
    })
    selectedOfficialId.value = null
  } catch (e: unknown) {
    assignError.value =
      e instanceof Error
        ? e.message
        : 'Erreur lors de l\'assignation de l\'officiel'
  }
}

// ---------------------------------------------------------------------------
// Mutations sur une assignation existante
// ---------------------------------------------------------------------------

async function changeStatus(
  assignment: OfficialAssignment,
  status: OfficialAssignmentStatus,
): Promise<void> {
  const m = props.match
  if (!m) return
  await store.setStatus(m, assignment.id, status)
}

async function removeAssignment(assignment: OfficialAssignment): Promise<void> {
  const m = props.match
  if (!m) return
  await store.remove(m, assignment.id)
}

function notify(): void {
  if (props.match) emit('notify', props.match)
}
</script>

<template>
  <Drawer
    :visible="props.visible"
    position="right"
    :style="{ width: '28rem' }"
    :header="props.match ? 'Staffing du match' : 'Match'"
    @update:visible="(v: boolean) => emit('update:visible', v)"
  >
    <div
      v-if="props.match"
      class="space-y-5 text-[13px]"
    >
      <!-- =============== Entête match =============== -->
      <section class="space-y-1.5">
        <div class="flex items-center gap-2">
          <span
            v-if="props.match.matchTypeColor"
            class="inline-block w-2.5 h-2.5 rounded-full shrink-0"
            :style="{ backgroundColor: props.match.matchTypeColor }"
          />
          <span class="text-[12px] text-surface-500">
            {{ props.match.matchTypeName ?? 'Type inconnu' }}
          </span>
          <Pill :variant="props.match.kind === 'home' ? 'sky' : 'violet'">
            {{ props.match.kind === 'home' ? 'Domicile' : 'Extérieur' }}
          </Pill>
        </div>
        <div class="text-[15px] font-semibold tracking-tight">
          {{ props.match.teamName ?? 'Équipe inconnue' }}
          <span class="text-surface-400 font-normal">vs</span>
          {{ props.match.opponentName ?? 'Adversaire inconnu' }}
        </div>
        <div class="text-[12px] text-surface-500">
          {{ formatDate(props.match.date) }} ·
          {{ props.match.startTime }}–{{ props.match.endTime }}
        </div>
        <div
          v-if="props.match.kind === 'away'"
          class="text-[12px] text-surface-500"
        >
          {{ props.match.awayAddress || 'Adresse non renseignée' }}
        </div>
      </section>

      <!-- =============== Récap des besoins — match HOME =============== -->
      <section
        v-if="props.match.kind === 'home' && requirementSummary.length > 0"
        class="space-y-2"
      >
        <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
          Besoins en officiels
        </h4>
        <div class="space-y-1.5">
          <div
            v-for="req in requirementSummary"
            :key="req.level"
            class="flex items-center justify-between rounded-md border border-surface-200 px-3 py-1.5"
          >
            <span class="text-[12px] text-surface-700">
              Niveau {{ req.level }}
            </span>
            <span
              class="num text-[12px]"
              :class="
                req.confirmed >= req.required
                  ? 'text-emerald-700'
                  : 'text-amber-700'
              "
            >
              {{ req.confirmed }}<span class="text-surface-400">
                / {{ req.required }} confirmé(s)</span>
            </span>
          </div>
        </div>
      </section>

      <!-- =============== Récap des besoins — match AWAY =============== -->
      <section
        v-else-if="awaySummary && awaySummary.required > 0"
        class="space-y-2"
      >
        <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
          Besoins en officiels — extérieur
        </h4>
        <div
          class="flex items-center justify-between rounded-md border border-surface-200 px-3 py-1.5"
        >
          <span class="text-[12px] text-surface-700">
            Officiels à déléguer
          </span>
          <span
            class="num text-[12px]"
            :class="
              awaySummary.confirmed >= awaySummary.required
                ? 'text-emerald-700'
                : 'text-amber-700'
            "
          >
            {{ awaySummary.confirmed }}<span class="text-surface-400">
              / {{ awaySummary.required }} confirmé(s)</span>
          </span>
        </div>
      </section>

      <div
        v-else
        class="card border-surface-200 bg-surface-50 px-3 py-2 text-[12px] text-surface-500"
      >
        Aucun besoin d'officiels défini sur ce type de match.
      </div>

      <!-- =============== Liste des assignations =============== -->
      <section class="space-y-2">
        <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
          Officiels assignés ({{ props.match.assignments.length }})
        </h4>

        <div
          v-if="props.match.assignments.length === 0"
          class="text-[12px] italic text-surface-500 px-1 py-2"
        >
          Aucun officiel assigné pour l'instant.
        </div>

        <div
          v-for="a in props.match.assignments"
          :key="a.id"
          class="rounded-md border border-surface-200 px-3 py-2 space-y-2"
        >
          <div class="flex items-center gap-2.5">
            <Avatar
              :name="officialName(a.memberId)"
              :size="28"
            />
            <div class="leading-tight flex-1 min-w-0">
              <div class="font-medium truncate">
                {{ officialName(a.memberId) }}
              </div>
              <div class="text-[11px] text-surface-500 num">
                Niveau {{ a.officialLevel }}
              </div>
            </div>
            <Pill :variant="statusDef(a.status).variant">
              {{ statusDef(a.status).label }}
            </Pill>
          </div>

          <!-- Actions status + retrait -->
          <div class="flex items-center gap-1.5 flex-wrap">
            <Button
              v-if="a.status !== 'confirmed'"
              size="small"
              severity="success"
              outlined
              :disabled="store.loading"
              @click="changeStatus(a, 'confirmed')"
            >
              <Check
                :size="13"
                :stroke-width="2"
              />
              Confirmer
            </Button>
            <Button
              v-if="a.status !== 'pending'"
              size="small"
              severity="secondary"
              outlined
              :disabled="store.loading"
              @click="changeStatus(a, 'pending')"
            >
              <Clock
                :size="13"
                :stroke-width="2"
              />
              En attente
            </Button>
            <Button
              v-if="a.status !== 'declined'"
              size="small"
              severity="warn"
              outlined
              :disabled="store.loading"
              @click="changeStatus(a, 'declined')"
            >
              <X
                :size="13"
                :stroke-width="2"
              />
              Décliner
            </Button>
            <Button
              size="small"
              severity="danger"
              text
              :disabled="store.loading"
              @click="removeAssignment(a)"
            >
              Retirer
            </Button>
          </div>
        </div>
      </section>

      <!-- =============== Assigner un officiel =============== -->
      <section class="space-y-2">
        <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
          Assigner un officiel
        </h4>
        <div class="flex items-start gap-2">
          <Select
            v-model="selectedOfficialId"
            :options="assignableOfficials"
            option-label="label"
            option-value="value"
            placeholder="Sélectionner un officiel…"
            filter
            class="flex-1"
            :empty-message="
              officialsStore.loading
                ? 'Chargement…'
                : 'Aucun officiel disponible'
            "
          >
            <template #option="{ option }">
              <div class="flex items-center justify-between gap-2 w-full">
                <span>{{ option.label }}</span>
                <span
                  v-if="option.level !== null"
                  class="text-[11px] text-surface-500 num"
                >
                  N{{ option.level }}
                </span>
                <span
                  v-else
                  class="text-[11px] text-amber-600"
                >
                  Niveau ?
                </span>
              </div>
            </template>
          </Select>
          <Button
            :disabled="!selectedOfficialId || store.loading"
            @click="assignSelected"
          >
            <UserPlus
              :size="14"
              :stroke-width="2"
            />
            Assigner
          </Button>
        </div>

        <!-- Avertissement niveau manquant -->
        <div
          v-if="selectedOfficialId && selectedOfficialLevel === null"
          class="card border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 flex items-start gap-2"
        >
          <TriangleAlert
            :size="14"
            :stroke-width="2"
            class="mt-0.5 shrink-0"
          />
          <span>
            Cet officiel n'a pas de niveau défini — il sera assigné au
            niveau 1 par défaut. Pensez à définir son niveau depuis sa fiche.
          </span>
        </div>

        <!-- Erreur d'assignation -->
        <div
          v-if="assignError"
          class="card border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 flex items-start gap-2"
        >
          <TriangleAlert
            :size="14"
            :stroke-width="2"
            class="mt-0.5 shrink-0"
          />
          <span>{{ assignError }}</span>
        </div>
      </section>

      <!-- =============== Erreur store =============== -->
      <div
        v-if="store.error && !assignError"
        class="card border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 flex items-start gap-2"
      >
        <TriangleAlert
          :size="14"
          :stroke-width="2"
          class="mt-0.5 shrink-0"
        />
        <span>{{ store.error }}</span>
      </div>

      <!-- =============== CTA notification =============== -->
      <div class="pt-1 border-t border-surface-100">
        <Button
          class="mt-3 w-full"
          severity="secondary"
          outlined
          @click="notify"
        >
          <Bell
            :size="14"
            :stroke-width="2"
          />
          Envoyer une notification
        </Button>
      </div>
    </div>

    <!-- État vide : aucun match sélectionné -->
    <div
      v-else
      class="px-2 py-10 text-center text-[13px] text-surface-500"
    >
      Aucun match sélectionné.
    </div>
  </Drawer>
</template>
