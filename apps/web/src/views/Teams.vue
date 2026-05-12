<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  Archive,
  ArchiveRestore,
  Calendar,
  CalendarClock,
  Copy,
  Filter,
  Mail,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  TriangleAlert,
  UserPlus,
  Users,
  UsersRound,
  Wallet,
  X,
} from 'lucide-vue-next'
import Dialog from 'primevue/dialog'
import Drawer from 'primevue/drawer'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Menu from 'primevue/menu'
import type { MenuItem } from 'primevue/menuitem'
import Select from 'primevue/select'
import {
  useTeamsStore,
  type TeamCategoryFilter,
  type TeamGenderFilter,
  type TeamStatusFilter,
} from '@/stores/teams'
import { useMembersStore } from '@/stores/members'
import type { TeamRow, TeamCoachAvatar } from '@/repositories/teams.repo'
import type { MemberRow } from '@/repositories/members.repo'
import type { TeamGender } from '@club-app/shared-types'
import Avatar from '@/components/ui/Avatar.vue'
import Chip from '@/components/ui/Chip.vue'
import Pill from '@/components/ui/Pill.vue'

const store = useTeamsStore()

onMounted(() => {
  void store.load()
})

const rows = computed<TeamRow[]>(() => store.filtered)
const counts = computed(() => store.counts)

// ---------------------------------------------------------------------------
// Heading subline — "N équipes actives · saison 2025-26 · CHF X émis".
// Aligné sur le mockup ligne 1521 :
//   "5 équipes actives · saison 2025-26 · CHF 49'200 émis"
// ---------------------------------------------------------------------------

const chfFormatter = new Intl.NumberFormat('fr-CH', {
  style: 'decimal',
  maximumFractionDigits: 0,
})

const headingSubline = computed(() => {
  const c = counts.value
  // TODO(firestore): read active season label from /seasons where status == 'active'.
  const seasonLabel = '2025-26'
  const dues = chfFormatter.format(c.totalDuesIssued)
  return `${c.totalActive} équipe${c.totalActive > 1 ? 's' : ''} active${c.totalActive > 1 ? 's' : ''} · saison ${seasonLabel} · CHF ${dues} émis`
})

// ---------------------------------------------------------------------------
// Category chips — DYNAMIQUES.
//
// Décision C1 (Eliot): les catégories sont définies par le club (référentiel
// éditable). Les chips reflètent donc les catégories effectivement présentes
// dans `teams`, avec le compte live, et triées par `ageRange.min` croissant
// (U11 → Seniors). Les catégories sans range (Seniors / Loisirs) finissent
// en queue, triées alphabétiquement.
// ---------------------------------------------------------------------------

interface CategoryChip {
  id: TeamCategoryFilter
  label: string
  count: number
  /** Pour tri uniquement, jamais affiché. `null` → bucket "ouvert" (Seniors). */
  minAge: number | null
}

const categoryChips = computed<CategoryChip[]>(() => {
  const byCat = counts.value.byCategory
  // Récupère le min-age depuis la 1ʳᵉ team de la catégorie (toutes les teams
  // d'une même catégorie partagent la même range — vient du référentiel).
  const minAgeByCat = new Map<string, number | null>()
  for (const t of store.teams) {
    if (!minAgeByCat.has(t.category)) {
      minAgeByCat.set(t.category, t.ageRange?.min ?? null)
    }
  }

  const entries: CategoryChip[] = []
  for (const [cat, count] of byCat.entries()) {
    entries.push({
      id: cat,
      label: cat,
      count,
      minAge: minAgeByCat.get(cat) ?? null,
    })
  }
  entries.sort((a, b) => {
    if (a.minAge !== null && b.minAge !== null) return a.minAge - b.minAge
    if (a.minAge !== null) return -1
    if (b.minAge !== null) return 1
    return a.label.localeCompare(b.label, 'fr')
  })

  const allChip: CategoryChip = {
    id: 'all',
    label: 'Toutes',
    count: counts.value.all,
    minAge: null,
  }
  return [allChip, ...entries]
})

// ---------------------------------------------------------------------------
// Gender chips — secondary row.
// ---------------------------------------------------------------------------

interface GenderChipDef {
  id: TeamGenderFilter
  label: string
}

const GENDER_CHIPS: readonly GenderChipDef[] = [
  { id: 'all', label: 'Tous genres' },
  { id: 'M', label: 'Masculin' },
  { id: 'F', label: 'Féminin' },
  { id: 'mixed', label: 'Mixte' },
] as const

function genderCount(id: TeamGenderFilter): number {
  if (id === 'all') return counts.value.all
  if (id === 'M') return counts.value.genderM
  if (id === 'F') return counts.value.genderF
  return counts.value.genderMixed
}

// ---------------------------------------------------------------------------
// Gender pill — couleur + label par TeamGender (cf. design Mockups screen 4).
// Les pills "Féminin"/"Masculin"/"Mixte" du mockup sont en slate ; on garde
// la même neutralité visuelle, le bucket d'âge et le nom portent la couleur.
// ---------------------------------------------------------------------------

function genderLabel(g: TeamGender): string {
  switch (g) {
    case 'M':
      return 'Masculin'
    case 'F':
      return 'Féminin'
    case 'mixed':
    default:
      return 'Mixte'
  }
}

// ---------------------------------------------------------------------------
// Age range — "12-13 ans" / "16 ans" / "18 ans+" (open).
// ---------------------------------------------------------------------------

function ageRangeLabel(team: TeamRow): string | null {
  const r = team.ageRange
  if (!r) return null
  if (r.max === null) return `${r.min} ans+`
  if (r.min === r.max) return `${r.min} ans`
  return `${r.min}-${r.max} ans`
}

// ---------------------------------------------------------------------------
// Status filter — toggle entre actives / archivées / toutes.
// ---------------------------------------------------------------------------

interface StatusOption {
  id: TeamStatusFilter
  label: string
}

const STATUS_OPTIONS: readonly StatusOption[] = [
  { id: 'active', label: 'Actives' },
  { id: 'archived', label: 'Archivées' },
  { id: 'all', label: 'Toutes' },
] as const

// ---------------------------------------------------------------------------
// Card actions — placeholders pour l'instant (cf. doc UI handoff strategy).
// ---------------------------------------------------------------------------

function openTeam(team: TeamRow): void {
  // C3 — drawer in-page, plus de `router.push('/teams/:id')`.
  store.openDrawer(team.id)
}

const noop = (): void => {
  /* TODO(actions): wire "Nouvelle équipe", "Copier saison précédente", actions card. */
}

// ---------------------------------------------------------------------------
// Per-card actions menu — PrimeVue Menu en mode popup. Une seule instance par
// page (anchored on click), le `menuTargetTeam` mémorise l'équipe ciblée pour
// que les `command` des MenuItem appellent les bonnes actions du store.
// ---------------------------------------------------------------------------

const cardMenuRef = ref<InstanceType<typeof Menu> | null>(null)
const menuTargetTeam = ref<TeamRow | null>(null)

const cardMenuItems = computed<MenuItem[]>(() => {
  const target = menuTargetTeam.value
  if (!target) return []
  return [
    {
      label: 'Ouvrir le détail',
      command: () => {
        store.openDrawer(target.id)
      },
    },
    {
      label: 'Dupliquer',
      command: () => {
        void store.duplicate(target.id)
      },
    },
    {
      label: target.active ? 'Archiver' : 'Désarchiver',
      command: () => {
        store.toggleArchive(target.id)
      },
    },
  ]
})

function openCardMenu(event: Event, team: TeamRow): void {
  menuTargetTeam.value = team
  cardMenuRef.value?.toggle(event)
}

// ---------------------------------------------------------------------------
// Coach avatars — affiche jusqu'à 3 avatars, plus un "+N" si davantage.
// ---------------------------------------------------------------------------

interface DisplayCoaches {
  visible: TeamCoachAvatar[]
  overflow: number
}

function coachesToDisplay(team: TeamRow): DisplayCoaches {
  const MAX = 3
  if (team.coachAvatars.length <= MAX) {
    return { visible: team.coachAvatars, overflow: 0 }
  }
  return {
    visible: team.coachAvatars.slice(0, MAX),
    overflow: team.coachAvatars.length - MAX,
  }
}

/**
 * Sous-titre coach de la carte : 1 nom → "Coach Marc Dubois", 2+ noms →
 * "Coach Marc Dubois, Julie Favre", 0 → null (la pill "Coach à assigner"
 * sera affichée à la place).
 */
function coachSummary(team: TeamRow): string | null {
  if (team.coachLabels.length === 0) return null
  const head = team.coachLabels.slice(0, 2).join(', ')
  const extra = team.coachLabels.length - 2
  if (extra > 0) return `Coachs ${head} +${extra}`
  if (team.coachLabels.length === 1) return `Coach ${head}`
  return `Coachs ${head}`
}

function playersWord(team: TeamRow): string {
  if (team.gender === 'F') return team.playerCount > 1 ? 'joueuses' : 'joueuse'
  return team.playerCount > 1 ? 'joueurs' : 'joueur'
}

function trainingsWord(t: TeamRow): string {
  return t.schedulingConstraints.trainingsPerWeek > 1
    ? 'entraînements / sem.'
    : 'entraînement / sem.'
}

// ---------------------------------------------------------------------------
// Empty-state copy — depend du contexte (recherche vs filtre strict).
// ---------------------------------------------------------------------------

const emptyCopy = computed(() => {
  if (store.search.trim().length > 0) {
    return {
      title: 'Aucune équipe trouvée',
      body: `Aucune équipe ne correspond à « ${store.search} ».`,
    }
  }
  if (store.coachStateFilter === 'needsCoach') {
    return {
      title: 'Aucune équipe sans coach',
      body: 'Toutes les équipes filtrées ont au moins un coach assigné.',
    }
  }
  if (store.statusFilter === 'archived') {
    return {
      title: 'Aucune équipe archivée',
      body: 'Les équipes archivées apparaîtront ici une fois leur saison clôturée.',
    }
  }
  return {
    title: 'Aucune équipe pour ces filtres',
    body: 'Ajustez les filtres ou créez une nouvelle équipe pour démarrer la saison.',
  }
})

// ---------------------------------------------------------------------------
// Drawer state — proxy autour de `selectedTeamId` pour le `v-model` PrimeVue.
// ---------------------------------------------------------------------------

const drawerOpen = computed<boolean>({
  get: () => store.selectedTeamId !== null,
  set: (v: boolean) => {
    if (!v) {
      // Sortir du mode édition à la fermeture pour repartir propre.
      isEditing.value = false
      store.closeDrawer()
    }
  },
})

const selectedTeam = computed<TeamRow | null>(() => store.selectedTeam)

function archiveSelected(): void {
  const t = selectedTeam.value
  if (!t) return
  // TODO(actions): replace mock toggle by repository write
  //   teamsRepo.setActive(t.id, !t.active) once the write path is wired.
  store.toggleArchive(t.id)
}

// ---------------------------------------------------------------------------
// Inline edit mode — bascule le body du drawer en mode édition. Couvre les
// champs identité (`name`, `category`, `gender`), `duesAmount` et deux
// contraintes scheduling (`trainingsPerWeek`, `anticipatedMatches`). Les
// coachs / joueurs / créneaux gardent leur flux dédié.
// ---------------------------------------------------------------------------

interface EditTeamForm {
  name: string
  category: string
  gender: TeamGender
  duesAmount: number
  trainingsPerWeek: number
  anticipatedMatches: number
}

interface EditTeamErrors {
  name: string | null
  category: string | null
  duesAmount: string | null
}

const isEditing = ref(false)
const editSubmitting = ref(false)
const editForm = reactive<EditTeamForm>({
  name: '',
  category: '',
  gender: 'M',
  duesAmount: 0,
  trainingsPerWeek: 0,
  anticipatedMatches: 0,
})
const editErrors = reactive<EditTeamErrors>({
  name: null,
  category: null,
  duesAmount: null,
})

function resetEditErrors(): void {
  editErrors.name = null
  editErrors.category = null
  editErrors.duesAmount = null
}

function hydrateEditForm(team: TeamRow): void {
  editForm.name = team.name
  editForm.category = team.category
  editForm.gender = team.gender
  editForm.duesAmount = team.duesAmount
  editForm.trainingsPerWeek = team.schedulingConstraints.trainingsPerWeek
  editForm.anticipatedMatches = team.schedulingConstraints.anticipatedMatches
  resetEditErrors()
}

function editSelected(): void {
  const t = selectedTeam.value
  if (!t) return
  hydrateEditForm(t)
  isEditing.value = true
}

function cancelEdit(): void {
  isEditing.value = false
  resetEditErrors()
}

function validateEditForm(): boolean {
  editErrors.name = editForm.name.trim() ? null : 'Nom requis'
  editErrors.category = editForm.category.trim() ? null : 'Catégorie requise'
  editErrors.duesAmount =
    editForm.duesAmount >= 0 ? null : 'Cotisation invalide'
  return !editErrors.name && !editErrors.category && !editErrors.duesAmount
}

async function submitEdit(): Promise<void> {
  const t = selectedTeam.value
  if (!t) return
  if (!validateEditForm()) return
  editSubmitting.value = true
  try {
    const ok = await store.update(t.id, {
      name: editForm.name.trim(),
      category: editForm.category.trim(),
      gender: editForm.gender,
      duesAmount: editForm.duesAmount,
      trainingsPerWeek: editForm.trainingsPerWeek,
      anticipatedMatches: editForm.anticipatedMatches,
    })
    if (ok) {
      isEditing.value = false
    }
  } finally {
    editSubmitting.value = false
  }
}

// ---------------------------------------------------------------------------
// Create dialog — "Nouvelle équipe". Form minimal : on couvre les champs
// requis par le schéma `/teams`. Les coachs et joueurs sont assignés ensuite
// via la fiche détail (le badge "Coach à assigner" s'affiche tant que vide).
// ---------------------------------------------------------------------------

interface CreateTeamForm {
  name: string
  category: string
  gender: TeamGender
  duesAmount: number
  trainingsPerWeek: number
  anticipatedMatches: number
}

interface CreateTeamErrors {
  name: string | null
  category: string | null
  duesAmount: string | null
}

function makeEmptyForm(): CreateTeamForm {
  return {
    name: '',
    category: '',
    gender: 'M',
    duesAmount: 350,
    trainingsPerWeek: 1,
    anticipatedMatches: 0,
  }
}

const isCreateDialogOpen = ref(false)
const createForm = reactive<CreateTeamForm>(makeEmptyForm())
const createErrors = reactive<CreateTeamErrors>({
  name: null,
  category: null,
  duesAmount: null,
})
const submitting = ref(false)

const GENDER_OPTIONS: ReadonlyArray<{ value: TeamGender; label: string }> = [
  { value: 'M', label: 'Masculin' },
  { value: 'F', label: 'Féminin' },
  { value: 'mixed', label: 'Mixte' },
] as const

/** Suggestions de catégorie tirées des équipes existantes (datalist). */
const categorySuggestions = computed<string[]>(() => {
  const set = new Set<string>()
  for (const t of store.teams) set.add(t.category)
  return [...set].sort((a, b) => a.localeCompare(b, 'fr'))
})

function openCreateDialog(): void {
  Object.assign(createForm, makeEmptyForm())
  createErrors.name = null
  createErrors.category = null
  createErrors.duesAmount = null
  isCreateDialogOpen.value = true
}

function closeCreateDialog(): void {
  isCreateDialogOpen.value = false
}

function validateCreateForm(): boolean {
  createErrors.name = createForm.name.trim() ? null : 'Nom requis'
  createErrors.category = createForm.category.trim() ? null : 'Catégorie requise'
  createErrors.duesAmount =
    createForm.duesAmount >= 0 ? null : 'Cotisation invalide'
  return (
    !createErrors.name && !createErrors.category && !createErrors.duesAmount
  )
}

async function submitCreate(): Promise<void> {
  if (!validateCreateForm()) return
  submitting.value = true
  try {
    const newId = await store.create({
      name: createForm.name.trim(),
      category: createForm.category.trim(),
      gender: createForm.gender,
      duesAmount: createForm.duesAmount,
      trainingsPerWeek: createForm.trainingsPerWeek,
      anticipatedMatches: createForm.anticipatedMatches,
    })
    if (newId) {
      closeCreateDialog()
      // Ouvre le drawer de la team nouvellement créée pour que l'utilisateur
      // puisse enchaîner sur l'ajout coach/joueurs.
      store.openDrawer(newId)
    }
  } finally {
    submitting.value = false
  }
}

// ---------------------------------------------------------------------------
// Coach picker — dialog "Assigner un coach".
//
// Lazy-load des membres : on déclenche `load()` une seule fois quand la
// première ouverture du picker survient (évite de charger la liste tant
// que l'admin n'a pas cliqué). Le store Pinia déduplique les chargements.
// ---------------------------------------------------------------------------

const membersStore = useMembersStore()

const isCoachPickerOpen = ref(false)
const coachPickerError = ref<string | null>(null)
const coachActionPending = ref<string | null>(null)

function openCoachPicker(): void {
  coachPickerError.value = null
  isCoachPickerOpen.value = true
  // Lazy load — uniquement si pas déjà chargé. Le store ne dédup pas par lui-même,
  // donc on vérifie ici pour éviter un re-fetch à chaque ouverture.
  if (membersStore.members.length === 0 && !membersStore.loading) {
    void membersStore.load()
  }
}

function closeCoachPicker(): void {
  isCoachPickerOpen.value = false
}

/**
 * Candidats à l'assignation : membres actifs avec rôle 'coach', en excluant
 * ceux déjà assignés à l'équipe sélectionnée. Triés par nom (FR locale).
 */
const coachCandidates = computed<MemberRow[]>(() => {
  const team = selectedTeam.value
  if (!team) return []
  const assigned = new Set(team.coachIds)
  return membersStore.members
    .filter(
      (m) => m.active && m.roles.includes('coach') && !assigned.has(m.id),
    )
    .slice()
    .sort((a, b) =>
      `${a.firstName} ${a.lastName}`.localeCompare(
        `${b.firstName} ${b.lastName}`,
        'fr',
      ),
    )
})

async function assignCoach(memberId: string): Promise<void> {
  const team = selectedTeam.value
  if (!team) return
  coachActionPending.value = memberId
  try {
    await store.assignCoach(team.id, memberId)
    closeCoachPicker()
  } finally {
    coachActionPending.value = null
  }
}

async function removeCoach(memberId: string): Promise<void> {
  const team = selectedTeam.value
  if (!team) return
  coachActionPending.value = memberId
  try {
    await store.removeCoach(team.id, memberId)
  } finally {
    coachActionPending.value = null
  }
}
</script>

<template>
  <section class="p-6 space-y-4">
    <!-- ================= Page heading =================== -->
    <div class="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-[22px] font-semibold tracking-tight">
          Teams
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
          <Copy
            :size="14"
            :stroke-width="2"
          />
          Copier saison précédente
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          @click="openCreateDialog"
        >
          <Plus
            :size="14"
            :stroke-width="2"
          />
          Nouvelle équipe
        </button>
      </div>
    </div>

    <!-- ================= Filter chips — DYNAMIC categories =================== -->
    <div class="flex items-center gap-2 flex-wrap">
      <Chip
        v-for="chip in categoryChips"
        :key="chip.id"
        :active="store.categoryFilter === chip.id"
        :aria-pressed="store.categoryFilter === chip.id"
        @click="store.setCategoryFilter(chip.id)"
      >
        {{ chip.label }}
        <span class="ml-1 text-[11px] num">{{ chip.count }}</span>
      </Chip>

      <div class="ml-auto flex items-center gap-2">
        <div class="input-wrap w-72">
          <Search />
          <input
            class="input input-with-icon !h-8"
            placeholder="Nom, catégorie, coach…"
            :value="store.search"
            @input="store.setSearch(($event.target as HTMLInputElement).value)"
          >
        </div>
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

    <!-- ================= Secondary filters — gender + status + coach state =================== -->
    <div class="flex items-center gap-2 flex-wrap text-[12px]">
      <span class="text-surface-500">Genre :</span>
      <Chip
        v-for="chip in GENDER_CHIPS"
        :key="chip.id"
        :active="store.genderFilter === chip.id"
        :aria-pressed="store.genderFilter === chip.id"
        @click="store.setGenderFilter(chip.id)"
      >
        {{ chip.label }}
        <span class="ml-1 text-[11px] num">{{ genderCount(chip.id) }}</span>
      </Chip>

      <span class="text-surface-500 ml-2">Statut :</span>
      <Chip
        v-for="opt in STATUS_OPTIONS"
        :key="opt.id"
        :active="store.statusFilter === opt.id"
        :aria-pressed="store.statusFilter === opt.id"
        @click="store.setStatusFilter(opt.id)"
      >
        {{ opt.label }}
      </Chip>

      <Chip
        class="ml-2"
        :active="store.coachStateFilter === 'needsCoach'"
        :aria-pressed="store.coachStateFilter === 'needsCoach'"
        @click="
          store.setCoachStateFilter(
            store.coachStateFilter === 'needsCoach' ? 'all' : 'needsCoach',
          )
        "
      >
        <UserPlus
          :size="12"
          :stroke-width="2"
        />
        Sans coach
        <span class="ml-1 text-[11px] num text-rose-600">{{ counts.needsCoach }}</span>
      </Chip>
    </div>

    <!-- ================= Loading skeleton =================== -->
    <div
      v-if="store.loading && rows.length === 0"
      class="grid grid-cols-1 md:grid-cols-2 gap-4"
      aria-busy="true"
    >
      <div
        v-for="i in 4"
        :key="`skel-${i}`"
        class="card p-5 animate-pulse h-[170px] bg-surface-50"
      />
    </div>

    <!-- ================= Empty state =================== -->
    <div
      v-else-if="rows.length === 0"
      class="card p-10 text-center flex flex-col items-center gap-2"
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
        {{ emptyCopy.title }}
      </div>
      <div class="text-[12px] text-surface-500 max-w-md">
        {{ emptyCopy.body }}
      </div>
      <button
        v-if="store.search.trim().length > 0"
        type="button"
        class="btn btn-secondary btn-sm mt-2"
        @click="store.setSearch('')"
      >
        Effacer la recherche
      </button>
      <button
        v-else
        type="button"
        class="btn btn-primary btn-sm mt-2"
        @click="openCreateDialog"
      >
        <Plus
          :size="14"
          :stroke-width="2"
        />
        Nouvelle équipe
      </button>
    </div>

    <!-- ================= Teams grid =================== -->
    <div
      v-else
      class="grid grid-cols-1 md:grid-cols-2 gap-4"
    >
      <button
        v-for="team in rows"
        :key="team.id"
        type="button"
        class="card p-5 text-left transition-shadow hover:shadow-card hover:border-surface-300 group"
        :class="team.active ? '' : 'opacity-70'"
        @click="openTeam(team)"
      >
        <!-- Header : name + pills -->
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h3
                class="text-[15px] font-semibold"
                :class="team.active ? '' : 'line-through text-surface-500'"
              >
                {{ team.name }}
              </h3>
              <Pill
                variant="slate"
                :title="ageRangeLabel(team) ? `${team.category} · ${ageRangeLabel(team)}` : team.category"
              >
                {{ team.category }}
              </Pill>
              <Pill variant="slate">
                {{ genderLabel(team.gender) }}
              </Pill>
              <Pill
                v-if="!team.active"
                variant="amber"
              >
                Archivée
              </Pill>
              <Pill
                v-if="team.coachIds.length === 0"
                variant="rose"
              >
                Coach à assigner
              </Pill>
            </div>
            <div class="text-[12px] text-surface-500 mt-1">
              <template v-if="coachSummary(team)">
                {{ coachSummary(team) }} ·
              </template>
              {{ team.playerCount }} {{ playersWord(team) }} ·
              {{ team.schedulingConstraints.trainingsPerWeek }} {{ trainingsWord(team) }}
              <template v-if="ageRangeLabel(team)">
                · {{ ageRangeLabel(team) }}
              </template>
            </div>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-sm !px-1.5 text-surface-500 opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label="Actions"
            aria-haspopup="true"
            aria-controls="team-card-menu"
            @click.stop="openCardMenu($event, team)"
          >
            <MoreHorizontal
              :size="14"
              :stroke-width="2"
            />
          </button>
        </div>

        <!-- Stats row : cotisation / coachs / matchs prévus -->
        <div class="mt-3 grid grid-cols-3 gap-3 text-[12px]">
          <div>
            <div class="text-surface-500 text-[11px]">
              Cotis. annuelle
            </div>
            <div class="num font-semibold mt-0.5">
              CHF {{ team.duesAmount }}
            </div>
          </div>
          <div>
            <div class="text-surface-500 text-[11px]">
              Coachs
            </div>
            <div class="font-semibold mt-0.5 flex items-center gap-1.5">
              <template v-if="team.coachAvatars.length === 0">
                <span class="text-surface-400 num">0</span>
              </template>
              <template v-else>
                <span class="flex -space-x-1.5">
                  <!-- TODO(media): wire src=member.photoURL when storage upload lands. -->
                  <Avatar
                    v-for="coach in coachesToDisplay(team).visible"
                    :key="coach.id"
                    :name="coach.name"
                    :size="20"
                    class="ring-2 ring-white"
                  />
                  <span
                    v-if="coachesToDisplay(team).overflow > 0"
                    class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-surface-100 text-surface-600 text-[9px] font-semibold ring-2 ring-white num"
                    :aria-label="`${coachesToDisplay(team).overflow} coachs supplémentaires`"
                  >
                    +{{ coachesToDisplay(team).overflow }}
                  </span>
                </span>
                <span class="num">{{ team.coachAvatars.length }}</span>
              </template>
            </div>
          </div>
          <div>
            <div class="text-surface-500 text-[11px]">
              Matchs prévus
            </div>
            <div class="num font-semibold mt-0.5">
              {{ team.schedulingConstraints.anticipatedMatches }}
            </div>
          </div>
        </div>

        <!-- Preferred slots — small pills row -->
        <div
          v-if="team.preferredSlotLabels.length > 0"
          class="mt-3 flex flex-wrap gap-1"
        >
          <Pill
            v-for="slot in team.preferredSlotLabels"
            :key="slot"
            variant="slate"
          >
            <Calendar
              :size="10"
              :stroke-width="2"
              class="opacity-60"
            />
            {{ slot }}
          </Pill>
        </div>
      </button>
    </div>

    <!-- ================= Footer count =================== -->
    <div
      v-if="!store.loading || rows.length > 0"
      class="text-[12px] text-surface-500 flex items-center gap-1"
    >
      <Users
        :size="12"
        :stroke-width="2"
      />
      {{ rows.length }} équipe<span v-if="rows.length > 1">s</span>
      affichée<span v-if="rows.length > 1">s</span> sur {{ counts.all }}
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

    <!-- ================= Per-card actions menu (popup, one instance) =================== -->
    <Menu
      id="team-card-menu"
      ref="cardMenuRef"
      :model="cardMenuItems"
      popup
    />

    <!-- ================= Detail drawer (C3) =================== -->
    <Drawer
      v-model:visible="drawerOpen"
      position="right"
      :show-close-icon="true"
      :pt="{ root: { style: 'width: 480px; max-width: 100vw;' } }"
      aria-label="Détail de l'équipe"
    >
      <template #container="{ closeCallback }">
        <div
          v-if="selectedTeam"
          class="flex flex-col h-full"
        >
          <!-- Drawer header -->
          <header class="flex items-center justify-between gap-3 px-5 py-4 border-b border-surface-200">
            <div class="flex items-center gap-3 min-w-0">
              <!-- TODO(media): wire src=member.photoURL when storage upload lands. -->
              <Avatar
                :name="selectedTeam.name"
                :size="36"
              />
              <div class="min-w-0">
                <div class="text-[15px] font-semibold truncate">
                  {{ selectedTeam.name }}
                </div>
                <div class="text-[12px] text-surface-500">
                  {{ selectedTeam.category }}
                  <template v-if="ageRangeLabel(selectedTeam)">
                    · {{ ageRangeLabel(selectedTeam) }}
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
            <!-- ============== Edit mode form (alternative to read-only) ============== -->
            <template v-if="isEditing">
              <section class="space-y-3">
                <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
                  Modifier l'équipe
                </h4>

                <label class="block">
                  <span class="text-[12px] text-surface-600">Nom de l'équipe</span>
                  <InputText
                    v-model="editForm.name"
                    class="mt-1 w-full"
                    placeholder="Ex. U14F"
                    :invalid="!!editErrors.name"
                  />
                  <span
                    v-if="editErrors.name"
                    class="text-[11px] text-rose-600 mt-1 block"
                  >
                    {{ editErrors.name }}
                  </span>
                </label>

                <div class="grid grid-cols-2 gap-3">
                  <label class="block">
                    <span class="text-[12px] text-surface-600">Catégorie</span>
                    <InputText
                      v-model="editForm.category"
                      class="mt-1 w-full"
                      placeholder="U14, Seniors…"
                      list="team-edit-category-suggestions"
                      :invalid="!!editErrors.category"
                    />
                    <datalist id="team-edit-category-suggestions">
                      <option
                        v-for="cat in categorySuggestions"
                        :key="cat"
                        :value="cat"
                      />
                    </datalist>
                    <span
                      v-if="editErrors.category"
                      class="text-[11px] text-rose-600 mt-1 block"
                    >
                      {{ editErrors.category }}
                    </span>
                  </label>

                  <label class="block">
                    <span class="text-[12px] text-surface-600">Genre</span>
                    <Select
                      v-model="editForm.gender"
                      :options="[...GENDER_OPTIONS]"
                      option-label="label"
                      option-value="value"
                      class="mt-1 w-full"
                    />
                  </label>
                </div>

                <label class="block">
                  <span class="text-[12px] text-surface-600">Cotisation annuelle (CHF)</span>
                  <InputNumber
                    v-model="editForm.duesAmount"
                    :min="0"
                    :max-fraction-digits="0"
                    input-class="!w-full"
                    class="mt-1 w-full"
                    :invalid="!!editErrors.duesAmount"
                  />
                  <span
                    v-if="editErrors.duesAmount"
                    class="text-[11px] text-rose-600 mt-1 block"
                  >
                    {{ editErrors.duesAmount }}
                  </span>
                </label>

                <div class="grid grid-cols-2 gap-3">
                  <label class="block">
                    <span class="text-[12px] text-surface-600">Entr. / sem.</span>
                    <InputNumber
                      v-model="editForm.trainingsPerWeek"
                      :min="0"
                      :max="7"
                      :max-fraction-digits="0"
                      input-class="!w-full"
                      class="mt-1 w-full"
                    />
                  </label>

                  <label class="block">
                    <span class="text-[12px] text-surface-600">Matchs prévus</span>
                    <InputNumber
                      v-model="editForm.anticipatedMatches"
                      :min="0"
                      :max-fraction-digits="0"
                      input-class="!w-full"
                      class="mt-1 w-full"
                    />
                  </label>
                </div>
              </section>
            </template>

            <!-- ============== Read-only display blocks ============== -->
            <template v-else>
              <!-- Identity block -->
              <section class="space-y-2">
                <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
                  Identité
                </h4>
                <div class="flex items-center gap-2 flex-wrap">
                  <Pill variant="slate">
                    {{ selectedTeam.category }}
                  </Pill>
                  <Pill variant="slate">
                    {{ genderLabel(selectedTeam.gender) }}
                  </Pill>
                  <Pill
                    v-if="selectedTeam.active"
                    variant="emerald"
                  >
                    Active
                  </Pill>
                  <Pill
                    v-else
                    variant="amber"
                  >
                    Archivée
                  </Pill>
                  <Pill
                    v-if="selectedTeam.coachIds.length === 0"
                    variant="rose"
                  >
                    Coach à assigner
                  </Pill>
                  <Pill
                    v-if="ageRangeLabel(selectedTeam)"
                    variant="slate"
                  >
                    {{ ageRangeLabel(selectedTeam) }}
                  </Pill>
                </div>
              </section>

              <!-- Coaches block -->
              <section class="space-y-2">
                <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
                  Coachs
                </h4>
                <div
                  v-if="selectedTeam.coachAvatars.length === 0"
                  class="text-[12px] text-surface-500"
                >
                  Aucun coach assigné pour l'instant.
                </div>
                <ul
                  v-else
                  class="space-y-2"
                >
                  <li
                    v-for="coach in selectedTeam.coachAvatars"
                    :key="coach.id"
                    class="flex items-center gap-3 group/coach"
                  >
                    <!-- TODO(media): wire src=member.photoURL when storage upload lands. -->
                    <Avatar
                      :name="coach.name"
                      :size="28"
                    />
                    <div class="min-w-0 flex-1">
                      <div class="text-[13px] font-medium truncate">
                        {{ coach.name }}
                      </div>
                      <div
                        v-if="coach.email"
                        class="text-[11px] text-surface-500 flex items-center gap-1 truncate"
                      >
                        <Mail
                          :size="11"
                          :stroke-width="2"
                        />
                        {{ coach.email }}
                      </div>
                    </div>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm !px-1.5 text-surface-500 opacity-0 group-hover/coach:opacity-100 focus:opacity-100 transition-opacity"
                      :aria-label="`Retirer ${coach.name}`"
                      :disabled="coachActionPending === coach.id"
                      @click="removeCoach(coach.id)"
                    >
                      <X
                        :size="14"
                        :stroke-width="2"
                      />
                    </button>
                  </li>
                </ul>
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  @click="openCoachPicker"
                >
                  <Plus
                    :size="14"
                    :stroke-width="2"
                  />
                  Ajouter un coach
                </button>
              </section>

              <!-- Roster block -->
              <section class="space-y-2">
                <h4
                  class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold flex items-center justify-between"
                >
                  <span>Effectif</span>
                  <span class="num text-surface-600">{{ selectedTeam.playerCount }}</span>
                </h4>
                <div
                  v-if="selectedTeam.playerCount === 0"
                  class="text-[12px] text-surface-500"
                >
                  Aucun joueur dans l'effectif pour la saison en cours.
                </div>
                <ul
                  v-else
                  class="grid grid-cols-2 gap-x-3 gap-y-1.5"
                >
                  <li
                    v-for="(playerName, idx) in selectedTeam.rosterPlayerNames"
                    :key="`${selectedTeam.id}-player-${idx}`"
                    class="flex items-center gap-2 min-w-0"
                  >
                    <!-- TODO(media): wire src=member.photoURL when storage upload lands. -->
                    <Avatar
                      :name="playerName"
                      :size="20"
                    />
                    <span class="text-[12px] truncate">{{ playerName }}</span>
                  </li>
                </ul>
              </section>

              <!-- Preferred slots block -->
              <section
                v-if="selectedTeam.preferredSlotLabels.length > 0"
                class="space-y-2"
              >
                <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
                  Créneaux préférés
                </h4>
                <div class="flex flex-wrap gap-1.5">
                  <Pill
                    v-for="slot in selectedTeam.preferredSlotLabels"
                    :key="slot"
                    variant="slate"
                  >
                    <Calendar
                      :size="10"
                      :stroke-width="2"
                      class="opacity-60"
                    />
                    {{ slot }}
                  </Pill>
                </div>
              </section>

              <!-- Stats block -->
              <section class="space-y-2">
                <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
                  Statistiques
                </h4>
                <div class="grid grid-cols-2 gap-3">
                  <div class="card p-3">
                    <div class="text-[11px] text-surface-500 flex items-center gap-1">
                      <Wallet
                        :size="11"
                        :stroke-width="2"
                      />
                      Cotis. encaissées
                    </div>
                    <div class="text-[14px] font-semibold mt-1 num">
                      CHF {{ chfFormatter.format(selectedTeam.duesPaidToDate) }}
                    </div>
                  </div>
                  <div class="card p-3">
                    <div class="text-[11px] text-surface-500 flex items-center gap-1">
                      <CalendarClock
                        :size="11"
                        :stroke-width="2"
                      />
                      Matchs à venir
                    </div>
                    <div class="text-[14px] font-semibold mt-1 num">
                      {{ selectedTeam.upcomingMatchesCount }}
                    </div>
                  </div>
                </div>
              </section>
            </template>
          </div>

          <!-- Drawer footer -->
          <footer class="flex items-center justify-end gap-2 px-5 py-3 border-t border-surface-200">
            <template v-if="isEditing">
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                :disabled="editSubmitting"
                @click="cancelEdit"
              >
                Annuler
              </button>
              <button
                type="button"
                class="btn btn-primary btn-sm"
                :disabled="editSubmitting"
                @click="submitEdit"
              >
                <Pencil
                  :size="14"
                  :stroke-width="2"
                />
                <template v-if="editSubmitting">
                  Enregistrement…
                </template>
                <template v-else>
                  Enregistrer
                </template>
              </button>
            </template>
            <template v-else>
              <button
                v-if="selectedTeam.active"
                type="button"
                class="btn btn-secondary btn-sm"
                @click="archiveSelected"
              >
                <Archive
                  :size="14"
                  :stroke-width="2"
                />
                Archiver
              </button>
              <button
                v-else
                type="button"
                class="btn btn-secondary btn-sm"
                @click="archiveSelected"
              >
                <ArchiveRestore
                  :size="14"
                  :stroke-width="2"
                />
                Désarchiver
              </button>
              <button
                type="button"
                class="btn btn-primary btn-sm"
                @click="editSelected"
              >
                <Pencil
                  :size="14"
                  :stroke-width="2"
                />
                Modifier
              </button>
            </template>
          </footer>
        </div>
      </template>
    </Drawer>

    <!-- ================= Create team dialog =================== -->
    <Dialog
      v-model:visible="isCreateDialogOpen"
      modal
      :draggable="false"
      :style="{ width: '480px' }"
      header="Nouvelle équipe"
    >
      <div class="space-y-3 pt-1">
        <p class="text-[12px] text-surface-500">
          Crée l'équipe ; tu pourras ensuite assigner coachs, joueurs et créneaux
          depuis sa fiche détail.
        </p>

        <label class="block">
          <span class="text-[12px] text-surface-600">Nom de l'équipe</span>
          <InputText
            v-model="createForm.name"
            class="mt-1 w-full"
            placeholder="Ex. U14F"
            :invalid="!!createErrors.name"
            @keyup.enter="submitCreate"
          />
          <span
            v-if="createErrors.name"
            class="text-[11px] text-rose-600 mt-1 block"
          >
            {{ createErrors.name }}
          </span>
        </label>

        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-[12px] text-surface-600">Catégorie</span>
            <InputText
              v-model="createForm.category"
              class="mt-1 w-full"
              placeholder="U14, Seniors…"
              list="team-category-suggestions"
              :invalid="!!createErrors.category"
            />
            <datalist id="team-category-suggestions">
              <option
                v-for="cat in categorySuggestions"
                :key="cat"
                :value="cat"
              />
            </datalist>
            <span
              v-if="createErrors.category"
              class="text-[11px] text-rose-600 mt-1 block"
            >
              {{ createErrors.category }}
            </span>
          </label>

          <label class="block">
            <span class="text-[12px] text-surface-600">Genre</span>
            <Select
              v-model="createForm.gender"
              :options="[...GENDER_OPTIONS]"
              option-label="label"
              option-value="value"
              class="mt-1 w-full"
            />
          </label>
        </div>

        <div class="grid grid-cols-3 gap-3">
          <label class="block">
            <span class="text-[12px] text-surface-600">Cotisation (CHF)</span>
            <InputNumber
              v-model="createForm.duesAmount"
              :min="0"
              :max-fraction-digits="0"
              input-class="!w-full"
              class="mt-1 w-full"
              :invalid="!!createErrors.duesAmount"
            />
            <span
              v-if="createErrors.duesAmount"
              class="text-[11px] text-rose-600 mt-1 block"
            >
              {{ createErrors.duesAmount }}
            </span>
          </label>

          <label class="block">
            <span class="text-[12px] text-surface-600">Entr. / sem.</span>
            <InputNumber
              v-model="createForm.trainingsPerWeek"
              :min="0"
              :max="7"
              :max-fraction-digits="0"
              input-class="!w-full"
              class="mt-1 w-full"
            />
          </label>

          <label class="block">
            <span class="text-[12px] text-surface-600">Matchs prévus</span>
            <InputNumber
              v-model="createForm.anticipatedMatches"
              :min="0"
              :max-fraction-digits="0"
              input-class="!w-full"
              class="mt-1 w-full"
            />
          </label>
        </div>
      </div>

      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="submitting"
          @click="closeCreateDialog"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="submitting"
          @click="submitCreate"
        >
          <Plus
            :size="14"
            :stroke-width="2"
          />
          <template v-if="submitting">
            Création…
          </template>
          <template v-else>
            Créer l'équipe
          </template>
        </button>
      </template>
    </Dialog>

    <!-- ================= Assign coach dialog =================== -->
    <Dialog
      v-model:visible="isCoachPickerOpen"
      modal
      :draggable="false"
      :style="{ width: '440px' }"
      header="Assigner un coach"
    >
      <div class="space-y-3 pt-1">
        <p class="text-[12px] text-surface-500">
          Choisis un membre avec le rôle <strong>coach</strong> pour
          l'assigner à
          <template v-if="selectedTeam">
            <strong>{{ selectedTeam.name }}</strong>.
          </template>
          <template v-else>
            l'équipe.
          </template>
        </p>

        <div
          v-if="membersStore.loading && coachCandidates.length === 0"
          class="text-[12px] text-surface-500 py-6 text-center"
          aria-busy="true"
        >
          Chargement des membres…
        </div>

        <div
          v-else-if="coachCandidates.length === 0"
          class="text-[12px] text-surface-500 py-6 text-center"
        >
          Aucun coach disponible. Tous les coachs actifs sont déjà assignés à
          cette équipe, ou aucun membre n'a le rôle "coach".
        </div>

        <ul
          v-else
          class="max-h-72 overflow-y-auto -mx-1 divide-y divide-surface-100"
        >
          <li
            v-for="member in coachCandidates"
            :key="member.id"
          >
            <button
              type="button"
              class="w-full flex items-center gap-3 px-2 py-2 rounded-md hover:bg-surface-50 disabled:opacity-50 text-left"
              :disabled="coachActionPending !== null"
              @click="assignCoach(member.id)"
            >
              <!-- TODO(media): wire src=member.photoURL when storage upload lands. -->
              <Avatar
                :name="`${member.firstName} ${member.lastName}`"
                :size="28"
              />
              <div class="min-w-0 flex-1">
                <div class="text-[13px] font-medium truncate">
                  {{ member.firstName }} {{ member.lastName }}
                </div>
                <div
                  v-if="member.email"
                  class="text-[11px] text-surface-500 truncate"
                >
                  {{ member.email }}
                </div>
              </div>
              <span
                v-if="coachActionPending === member.id"
                class="text-[11px] text-surface-500"
              >
                Assignation…
              </span>
            </button>
          </li>
        </ul>

        <div
          v-if="coachPickerError"
          class="text-[11px] text-rose-600"
        >
          {{ coachPickerError }}
        </div>
      </div>

      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="coachActionPending !== null"
          @click="closeCoachPicker"
        >
          Fermer
        </button>
      </template>
    </Dialog>
  </section>
</template>
