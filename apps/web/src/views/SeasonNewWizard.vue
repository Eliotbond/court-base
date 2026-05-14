<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  CalendarRange,
  Check,
  CheckCheck,
  Globe,
  MapPin,
  TriangleAlert,
  Users,
  X,
} from 'lucide-vue-next'
import { useSeasonsStore } from '@/stores/seasons'
import { useTeamsStore } from '@/stores/teams'
import type { TeamRow } from '@/repositories/teams.repo'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'

/**
 * Vue SeasonNewWizard — wizard 4-étapes pour créer une saison en draft (B3).
 *
 * Référence design : `Courtbase Onboarding.html` → template `tpl-season-config`
 * ("Configure ta saison"). On simplifie pour la *création* d'une saison
 * standalone (vs. onboarding du club) : 4 étapes courtes, chacune une carte.
 *
 *   Étape 1 — Identité (name, startDate, endDate)
 *   Étape 2 — Équipes participantes (toggle par équipe `active`)
 *   Étape 3 — Venues actives (toggle par venue)
 *   Étape 4 — Vérification (summary + CTA "Créer la saison")
 *
 * State wizard : `ref` local — pas de Pinia (flow transient). Sur soumission,
 * on appelle `seasonsStore.create()` qui pousse le row dans le state global.
 *
 * Architecture : la vue consomme `useSeasonsStore` + `useTeamsStore` (pour la
 * liste des équipes existantes). Aucun appel direct repo (cf. couches).
 */

const router = useRouter()
const seasonsStore = useSeasonsStore()
const teamsStore = useTeamsStore()

// ---------------------------------------------------------------------------
// Wizard step state.
// ---------------------------------------------------------------------------

interface StepDef {
  /** Index 1-based pour rester aligné avec le design ("ÉTAPE 1 / 4"). */
  index: 1 | 2 | 3 | 4
  label: string
}

const STEPS: readonly StepDef[] = [
  { index: 1, label: 'Identité' },
  { index: 2, label: 'Équipes' },
  { index: 3, label: 'Venues' },
  { index: 4, label: 'Vérification' },
] as const

const currentStep = ref<1 | 2 | 3 | 4>(1)
const submitting = ref(false)
const submitError = ref<string | null>(null)

// ---------------------------------------------------------------------------
// Form state.
// ---------------------------------------------------------------------------

/** Préremplit avec la prochaine saison (1er sept de l'année courante → 30 juin). */
function defaultStart(): string {
  const year = new Date().getFullYear()
  // ISO YYYY-MM-DD pour <input type="date">
  return `${year}-09-01`
}

function defaultEnd(): string {
  const year = new Date().getFullYear() + 1
  return `${year}-06-30`
}

function defaultName(): string {
  const startYear = new Date().getFullYear()
  return `Saison ${startYear}-${(startYear + 1) % 100}`
}

const form = ref({
  name: defaultName(),
  startDate: defaultStart(),
  endDate: defaultEnd(),
  // Set d'ids — toggle additif via Set#has + Set.add / delete (cohérent avec
  // une future écriture vers `/teams/{id}.activeSeasonIds`).
  selectedTeamIds: new Set<string>(),
  selectedVenueIds: new Set<string>(),
})

// ---------------------------------------------------------------------------
// Venues — pas de repo dédié pour l'instant, on hardcode les 3 venues vues
// dans le design (Forêt / Vergers / Beaulieu). À terme : `listVenues()`.
// ---------------------------------------------------------------------------

interface WizardVenue {
  id: string
  label: string
  address: string
}

// TODO(firestore): remplacer par `listVenues()` (collection `/venues`).
const VENUES: readonly WizardVenue[] = [
  {
    id: 'mock-venue-foret',
    label: 'Forêt',
    address: 'Av. de la Forêt 12, 1007 Lausanne · 2 courts',
  },
  {
    id: 'mock-venue-vergers',
    label: 'Vergers',
    address: 'Ch. des Vergers 8, 1018 Lausanne · 1 court',
  },
  {
    id: 'mock-venue-beaulieu',
    label: 'Beaulieu',
    address: 'Av. Bergières 10, 1004 Lausanne · 1 court',
  },
] as const

// ---------------------------------------------------------------------------
// Teams loaded depuis le store (déjà mocké). On les filtre sur `active`.
// ---------------------------------------------------------------------------

onMounted(() => {
  // load() est idempotent (vérifie loading.value). On garantit la liste
  // dispo pour l'étape 2.
  if (teamsStore.teams.length === 0) {
    void teamsStore.load()
  }
})

const availableTeams = computed<TeamRow[]>(() =>
  teamsStore.teams.filter((t) => t.active),
)

// Par défaut on inscrit toutes les équipes actives — l'admin peut désinscrire
// au cas par cas. Hydraté en async dès que la liste est chargée.
function ensureDefaultSelections(): void {
  if (form.value.selectedTeamIds.size === 0 && availableTeams.value.length > 0) {
    form.value.selectedTeamIds = new Set(availableTeams.value.map((t) => t.id))
  }
  if (form.value.selectedVenueIds.size === 0) {
    form.value.selectedVenueIds = new Set(VENUES.map((v) => v.id))
  }
}

// ---------------------------------------------------------------------------
// Toggles.
// ---------------------------------------------------------------------------

function toggleTeam(teamId: string): void {
  const next = new Set(form.value.selectedTeamIds)
  if (next.has(teamId)) {
    next.delete(teamId)
  } else {
    next.add(teamId)
  }
  form.value.selectedTeamIds = next
}

function isTeamSelected(teamId: string): boolean {
  return form.value.selectedTeamIds.has(teamId)
}

function toggleVenue(venueId: string): void {
  const next = new Set(form.value.selectedVenueIds)
  if (next.has(venueId)) {
    next.delete(venueId)
  } else {
    next.add(venueId)
  }
  form.value.selectedVenueIds = next
}

function isVenueSelected(venueId: string): boolean {
  return form.value.selectedVenueIds.has(venueId)
}

// ---------------------------------------------------------------------------
// Navigation entre étapes — validation par étape.
// ---------------------------------------------------------------------------

const step1Valid = computed<boolean>(() => {
  const f = form.value
  if (!f.name.trim()) return false
  if (!f.startDate || !f.endDate) return false
  return new Date(f.startDate).getTime() < new Date(f.endDate).getTime()
})

const step2Valid = computed<boolean>(() => form.value.selectedTeamIds.size > 0)
const step3Valid = computed<boolean>(() => form.value.selectedVenueIds.size > 0)

const canAdvance = computed<boolean>(() => {
  switch (currentStep.value) {
    case 1:
      return step1Valid.value
    case 2:
      return step2Valid.value
    case 3:
      return step3Valid.value
    case 4:
      return step1Valid.value && step2Valid.value && step3Valid.value
    default:
      return false
  }
})

function nextStep(): void {
  if (!canAdvance.value) return
  if (currentStep.value === 1) {
    // À la sortie de l'étape 1, on prépare les sélections par défaut pour
    // l'étape 2 / 3 (si pas encore initialisées).
    ensureDefaultSelections()
  }
  if (currentStep.value < 4) {
    currentStep.value = (currentStep.value + 1) as 1 | 2 | 3 | 4
  }
}

function prevStep(): void {
  if (currentStep.value > 1) {
    currentStep.value = (currentStep.value - 1) as 1 | 2 | 3 | 4
  }
}

function goToStep(target: 1 | 2 | 3 | 4): void {
  // Permet aux étapes précédentes d'être cliquables dans le stepper.
  if (target < currentStep.value) {
    currentStep.value = target
    return
  }
  // En avant : on vérifie que toutes les étapes intermédiaires sont valides.
  if (target === 2 && step1Valid.value) {
    ensureDefaultSelections()
    currentStep.value = 2
  } else if (target === 3 && step1Valid.value && step2Valid.value) {
    currentStep.value = 3
  } else if (
    target === 4 &&
    step1Valid.value &&
    step2Valid.value &&
    step3Valid.value
  ) {
    currentStep.value = 4
  }
}

// ---------------------------------------------------------------------------
// Submit / cancel.
// ---------------------------------------------------------------------------

function onCancel(): void {
  void router.push({ name: 'seasons' })
}

/** CTA empty state — l'utilisateur n'a pas d'équipes (ou aucune active),
 *  on l'envoie sur la page Teams pour qu'il en crée / désarchive. */
function goToTeams(): void {
  void router.push({ name: 'teams' })
}

async function onSubmit(): Promise<void> {
  if (!canAdvance.value || submitting.value) return
  submitting.value = true
  submitError.value = null
  try {
    const teamIds = Array.from(form.value.selectedTeamIds)
    const venueIds = Array.from(form.value.selectedVenueIds)
    const venueLabels = VENUES.filter((v) => form.value.selectedVenueIds.has(v.id)).map(
      (v) => v.label,
    )
    const newId = await seasonsStore.create({
      name: form.value.name.trim(),
      startDate: new Date(form.value.startDate),
      endDate: new Date(form.value.endDate),
      teamIds,
      venueIds,
      venueLabels,
    })
    if (!newId) {
      submitError.value =
        seasonsStore.error ?? 'Création de la saison impossible.'
      return
    }
    void router.push({ name: 'seasons', query: { created: newId } })
  } catch (e: unknown) {
    submitError.value =
      e instanceof Error ? e.message : 'Erreur lors de la création.'
  } finally {
    submitting.value = false
  }
}

// ---------------------------------------------------------------------------
// Récap (étape 4).
// ---------------------------------------------------------------------------

const shortDateFormatter = new Intl.DateTimeFormat('fr-CH', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

function formatIsoDate(iso: string): string {
  if (!iso) return '—'
  return shortDateFormatter.format(new Date(iso))
}

const selectedTeamLabels = computed<string[]>(() =>
  availableTeams.value
    .filter((t) => form.value.selectedTeamIds.has(t.id))
    .map((t) => t.name),
)

const selectedVenueLabels = computed<string[]>(() =>
  VENUES.filter((v) => form.value.selectedVenueIds.has(v.id)).map((v) => v.label),
)
</script>

<template>
  <section class="p-6 space-y-5 max-w-[1100px] mx-auto">
    <!-- ================= Breadcrumb + header =================== -->
    <div class="flex items-center gap-2 text-[12px] text-surface-500">
      <button
        type="button"
        class="hover:text-surface-700 inline-flex items-center gap-1"
        @click="onCancel"
      >
        <ArrowLeft
          :size="12"
          :stroke-width="2"
        />
        Seasons
      </button>
      <span>·</span>
      <span class="text-surface-700">Nouvelle saison</span>
    </div>

    <div class="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-[22px] font-semibold tracking-tight">
          Configure ta saison
        </h1>
        <p class="text-[13px] text-surface-500 mt-0.5">
          4 étapes. À la fin, on crée la saison en brouillon — l'activation
          (génération des bookings) se fait depuis la liste, avec dry-run.
        </p>
      </div>
      <button
        type="button"
        class="btn btn-ghost btn-sm text-surface-600"
        @click="onCancel"
      >
        <X
          :size="14"
          :stroke-width="2"
        />
        Annuler
      </button>
    </div>

    <!-- ================= Stepper =================== -->
    <!-- Custom stepper Tailwind (cf. design Onboarding.html `.step-dot` /
         `.step-line`). On évite PrimeVue Stepper qui ne match pas le visuel
         dotté du design (cercles vert/blanc + barres). -->
    <div class="card px-5 py-4">
      <div class="flex items-center gap-2.5">
        <template
          v-for="(step, idx) in STEPS"
          :key="step.index"
        >
          <button
            type="button"
            class="w-7 h-7 rounded-full inline-flex items-center justify-center text-[11px] font-semibold transition-colors shrink-0"
            :class="[
              currentStep === step.index
                ? 'bg-surface-900 text-white ring-4 ring-surface-200'
                : currentStep > step.index
                  ? 'bg-emerald-500 text-white'
                  : 'bg-surface-200 text-surface-500',
              currentStep > step.index ? 'cursor-pointer' : 'cursor-default',
            ]"
            :aria-current="currentStep === step.index ? 'step' : undefined"
            @click="goToStep(step.index)"
          >
            <Check
              v-if="currentStep > step.index"
              :size="13"
              :stroke-width="2.5"
            />
            <span v-else>{{ step.index }}</span>
          </button>
          <div
            v-if="idx < STEPS.length - 1"
            class="flex-1 h-0.5 transition-colors"
            :class="currentStep > step.index ? 'bg-emerald-500' : 'bg-surface-200'"
          />
        </template>
      </div>
      <div class="grid grid-cols-4 gap-2.5 mt-2">
        <div
          v-for="step in STEPS"
          :key="step.index"
          class="text-[11px] text-center transition-colors"
          :class="
            currentStep === step.index
              ? 'text-surface-900 font-semibold'
              : currentStep > step.index
                ? 'text-emerald-700 font-medium'
                : 'text-surface-500'
          "
        >
          {{ step.label }}
        </div>
      </div>
    </div>

    <!-- ============================================================= -->
    <!-- ================= ÉTAPE 1 : Identité ========================= -->
    <!-- ============================================================= -->
    <div
      v-if="currentStep === 1"
      class="card p-6 space-y-4"
    >
      <div>
        <h2 class="text-[14px] font-semibold flex items-center gap-2">
          <CalendarRange
            :size="14"
            :stroke-width="2"
            class="text-surface-500"
          />
          Identité de la saison
        </h2>
        <p class="text-[12px] text-surface-500 mt-1">
          Donne un nom et les bornes de la saison. Tu pourras dupliquer cette
          config pour les suivantes.
        </p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label class="block">
          <span class="text-[12px] text-surface-600 font-medium">Nom de la saison</span>
          <input
            v-model="form.name"
            type="text"
            class="input mt-1"
            placeholder="Saison 2025-26"
          >
          <span class="text-[11px] text-surface-500 mt-1 block">
            Ex. « Saison 2025-26 » ou « 2025/26 — Compétition ».
          </span>
        </label>

        <label class="block">
          <span class="text-[12px] text-surface-600 font-medium">Fuseau horaire</span>
          <div class="input-wrap mt-1">
            <Globe />
            <input
              class="input input-with-icon"
              value="Europe/Zurich (UTC+1)"
              readonly
            >
          </div>
          <span class="text-[11px] text-surface-500 mt-1 block">
            Le fuseau du club — non modifiable au niveau saison.
          </span>
        </label>

        <label class="block">
          <span class="text-[12px] text-surface-600 font-medium">Début de saison</span>
          <div class="input-wrap mt-1">
            <Calendar />
            <input
              v-model="form.startDate"
              type="date"
              class="input input-with-icon num"
            >
          </div>
        </label>

        <label class="block">
          <span class="text-[12px] text-surface-600 font-medium">Fin de saison</span>
          <div class="input-wrap mt-1">
            <Calendar />
            <input
              v-model="form.endDate"
              type="date"
              class="input input-with-icon num"
            >
          </div>
        </label>
      </div>

      <div
        v-if="!step1Valid"
        class="text-[12px] text-amber-700 flex items-center gap-1.5"
      >
        <TriangleAlert
          :size="13"
          :stroke-width="2"
        />
        Renseigne un nom et vérifie que la date de fin est postérieure au début.
      </div>
    </div>

    <!-- ============================================================= -->
    <!-- ================= ÉTAPE 2 : Équipes ========================== -->
    <!-- ============================================================= -->
    <div
      v-if="currentStep === 2"
      class="card p-6 space-y-4"
    >
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 class="text-[14px] font-semibold flex items-center gap-2">
            <Users
              :size="14"
              :stroke-width="2"
              class="text-surface-500"
            />
            Équipes participantes
          </h2>
          <p class="text-[12px] text-surface-500 mt-1">
            Active les équipes qui jouent cette saison.
            <span class="num">{{ form.selectedTeamIds.size }}</span> sur
            <span class="num">{{ availableTeams.length }}</span> sélectionnée<span
              v-if="form.selectedTeamIds.size > 1"
            >s</span>.
          </p>
        </div>
      </div>

      <!-- Error : surface l'erreur du store (permission Firestore, etc.) avant
           les états loading / empty. Évite de masquer un problème de droits
           derrière un "Aucune équipe". -->
      <div
        v-if="teamsStore.error"
        class="card border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700 flex items-start gap-2"
        role="alert"
      >
        <TriangleAlert
          :size="14"
          :stroke-width="2"
          class="mt-0.5 shrink-0"
        />
        <div class="flex-1">
          <div class="font-medium">
            Impossible de charger les équipes.
          </div>
          <div class="text-[12px] text-rose-700/80 mt-0.5">
            {{ teamsStore.error }}
          </div>
        </div>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          @click="teamsStore.load()"
        >
          Réessayer
        </button>
      </div>

      <!-- Loading : skeleton aligné Teams.vue (4 lignes pulse) plutôt qu'un
           texte simple, pour matcher la perception "données arrivent". -->
      <div
        v-else-if="teamsStore.loading && teamsStore.teams.length === 0"
        class="border border-surface-200 rounded-md divide-y divide-surface-200"
        aria-busy="true"
      >
        <div
          v-for="i in 4"
          :key="`team-skel-${i}`"
          class="flex items-center gap-3 px-4 py-3 animate-pulse"
        >
          <div class="flex-1 space-y-1.5">
            <div class="h-3.5 w-32 bg-surface-200 rounded" />
            <div class="h-2.5 w-48 bg-surface-100 rounded" />
          </div>
          <div class="h-5 w-9 bg-surface-200 rounded-full" />
        </div>
      </div>

      <!-- Empty (no teams at all) : cas 1ʳᵉ utilisation sur projet vierge.
           CTA explicite vers /teams pour débloquer l'utilisateur. -->
      <div
        v-else-if="teamsStore.teams.length === 0"
        class="border border-surface-200 rounded-md px-4 py-10 text-center flex flex-col items-center gap-2"
      >
        <span
          class="w-10 h-10 rounded-full bg-surface-100 inline-flex items-center justify-center text-surface-500"
        >
          <Users
            :size="18"
            :stroke-width="2"
          />
        </span>
        <div class="text-[14px] font-semibold">
          Aucune équipe disponible
        </div>
        <div class="text-[12px] text-surface-500 max-w-md">
          Tu dois d'abord créer des équipes avant de pouvoir configurer une
          saison.
        </div>
        <button
          type="button"
          class="btn btn-primary btn-sm mt-2"
          @click="goToTeams"
        >
          Créer des équipes
          <ArrowRight
            :size="13"
            :stroke-width="2"
          />
        </button>
      </div>

      <!-- Empty (teams existent mais aucune active) : cas où l'admin a tout
           archivé. CTA gère le réveil d'une équipe depuis /teams. -->
      <div
        v-else-if="availableTeams.length === 0"
        class="border border-surface-200 rounded-md px-4 py-10 text-center flex flex-col items-center gap-2"
      >
        <span
          class="w-10 h-10 rounded-full bg-surface-100 inline-flex items-center justify-center text-surface-500"
        >
          <Users
            :size="18"
            :stroke-width="2"
          />
        </span>
        <div class="text-[14px] font-semibold">
          Aucune équipe active
        </div>
        <div class="text-[12px] text-surface-500 max-w-md">
          Toutes les équipes du club sont archivées. Désarchive-en une depuis
          la page Teams, ou crée-en une nouvelle.
        </div>
        <button
          type="button"
          class="btn btn-secondary btn-sm mt-2"
          @click="goToTeams"
        >
          Gérer les équipes
          <ArrowRight
            :size="13"
            :stroke-width="2"
          />
        </button>
      </div>
      <ul
        v-else
        class="divide-y divide-surface-200 border border-surface-200 rounded-md"
      >
        <li
          v-for="team in availableTeams"
          :key="team.id"
          class="flex items-center gap-3 px-4 py-3"
        >
          <div class="flex-1 min-w-0">
            <div class="text-[13px] font-medium">
              {{ team.name }}
            </div>
            <div class="text-[11px] text-surface-500">
              {{ team.category?.name ?? '—' }} · {{ team.gender }}
              <template v-if="team.coachLabels.length > 0">
                · coach
                <span class="text-surface-700">
                  {{ team.coachLabels.join(', ') }}
                </span>
              </template>
            </div>
          </div>
          <ToggleSwitch
            :model-value="isTeamSelected(team.id)"
            :aria-label="`Inscrire ${team.name} dans la saison`"
            @update:model-value="toggleTeam(team.id)"
          />
        </li>
      </ul>

      <div
        v-if="!step2Valid"
        class="text-[12px] text-amber-700 flex items-center gap-1.5"
      >
        <TriangleAlert
          :size="13"
          :stroke-width="2"
        />
        Sélectionne au moins une équipe pour continuer.
      </div>
    </div>

    <!-- ============================================================= -->
    <!-- ================= ÉTAPE 3 : Venues =========================== -->
    <!-- ============================================================= -->
    <div
      v-if="currentStep === 3"
      class="card p-6 space-y-4"
    >
      <div>
        <h2 class="text-[14px] font-semibold flex items-center gap-2">
          <MapPin
            :size="14"
            :stroke-width="2"
            class="text-surface-500"
          />
          Venues actives
        </h2>
        <p class="text-[12px] text-surface-500 mt-1">
          Les venues utilisés cette saison (= `activeVenueIds`).
          <span class="num">{{ form.selectedVenueIds.size }}</span> sur
          <span class="num">{{ VENUES.length }}</span> sélectionné<span
            v-if="form.selectedVenueIds.size > 1"
          >s</span>.
        </p>
      </div>

      <ul class="divide-y divide-surface-200 border border-surface-200 rounded-md">
        <li
          v-for="venue in VENUES"
          :key="venue.id"
          class="flex items-center gap-3 px-4 py-3"
        >
          <div class="flex-1 min-w-0">
            <div class="text-[13px] font-medium">
              {{ venue.label }}
            </div>
            <div class="text-[11px] text-surface-500">
              {{ venue.address }}
            </div>
          </div>
          <ToggleSwitch
            :model-value="isVenueSelected(venue.id)"
            :aria-label="`Activer ${venue.label} pour la saison`"
            @update:model-value="toggleVenue(venue.id)"
          />
        </li>
      </ul>

      <div
        v-if="!step3Valid"
        class="text-[12px] text-amber-700 flex items-center gap-1.5"
      >
        <TriangleAlert
          :size="13"
          :stroke-width="2"
        />
        Sélectionne au moins un venue pour continuer.
      </div>
    </div>

    <!-- ============================================================= -->
    <!-- ================= ÉTAPE 4 : Vérification ===================== -->
    <!-- ============================================================= -->
    <div
      v-if="currentStep === 4"
      class="space-y-4"
    >
      <div class="card p-6 space-y-4">
        <h2 class="text-[14px] font-semibold flex items-center gap-2">
          <CheckCheck
            :size="14"
            :stroke-width="2"
            class="text-emerald-600"
          />
          Vérification
        </h2>

        <dl class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-[13px]">
          <div>
            <dt class="text-[11px] uppercase tracking-wider text-surface-500 font-semibold">
              Nom
            </dt>
            <dd class="font-medium mt-0.5">
              {{ form.name || '—' }}
            </dd>
          </div>
          <div>
            <dt class="text-[11px] uppercase tracking-wider text-surface-500 font-semibold">
              Période
            </dt>
            <dd class="font-medium mt-0.5 num">
              {{ formatIsoDate(form.startDate) }} → {{ formatIsoDate(form.endDate) }}
            </dd>
          </div>
          <div>
            <dt class="text-[11px] uppercase tracking-wider text-surface-500 font-semibold">
              Équipes ({{ selectedTeamLabels.length }})
            </dt>
            <dd class="mt-0.5">
              <span
                v-if="selectedTeamLabels.length === 0"
                class="text-surface-400"
              >
                Aucune
              </span>
              <span v-else>{{ selectedTeamLabels.join(' · ') }}</span>
            </dd>
          </div>
          <div>
            <dt class="text-[11px] uppercase tracking-wider text-surface-500 font-semibold">
              Venues ({{ selectedVenueLabels.length }})
            </dt>
            <dd class="mt-0.5">
              <span
                v-if="selectedVenueLabels.length === 0"
                class="text-surface-400"
              >
                Aucun
              </span>
              <span v-else>{{ selectedVenueLabels.join(' · ') }}</span>
            </dd>
          </div>
        </dl>

        <div class="text-[12px] text-surface-500 border-t border-surface-200 pt-3">
          La saison sera créée en
          <strong class="text-surface-700">brouillon</strong>. La génération
          des bookings se déclenche depuis l'écran Seasons, après dry-run.
        </div>
      </div>

      <div
        v-if="submitError"
        class="card border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700 flex items-center gap-2"
      >
        <TriangleAlert
          :size="14"
          :stroke-width="2"
        />
        {{ submitError }}
      </div>
    </div>

    <!-- ================= Footer actions =================== -->
    <div class="flex items-center gap-2 flex-wrap pt-1">
      <button
        type="button"
        class="btn btn-ghost btn-sm text-surface-600"
        @click="onCancel"
      >
        Annuler
      </button>
      <div class="ml-auto flex items-center gap-2">
        <button
          v-if="currentStep > 1"
          type="button"
          class="btn btn-secondary btn-sm"
          @click="prevStep"
        >
          <ArrowLeft
            :size="13"
            :stroke-width="2"
          />
          Précédent
        </button>
        <button
          v-if="currentStep < 4"
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="!canAdvance"
          @click="nextStep"
        >
          Continuer
          <ArrowRight
            :size="13"
            :stroke-width="2"
          />
        </button>
        <button
          v-else
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="!canAdvance || submitting"
          @click="onSubmit"
        >
          <CheckCheck
            :size="14"
            :stroke-width="2"
          />
          {{ submitting ? 'Création…' : 'Créer la saison' }}
        </button>
      </div>
    </div>
  </section>
</template>
