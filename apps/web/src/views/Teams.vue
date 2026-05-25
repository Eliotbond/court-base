<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
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
import { useAuthStore } from '@/stores/auth'
import { useCategoriesStore } from '@/stores/categories'
import { useCotisationTypesStore } from '@/stores/cotisationTypes'
import { useTagsStore } from '@/stores/tags'
import { useMembersStore } from '@/stores/members'
import type { TeamRow, TeamCoachAvatar } from '@/repositories/teams.repo'
import type { MemberRow } from '@/repositories/members.repo'
import type {
  BasketplanCompetitionLink,
  TeamGender,
  TeamRegistrationStatus,
  TeamTagRef,
} from '@club-app/shared-types'
import { FirebaseError } from 'firebase/app'
import { Plug, Trophy } from 'lucide-vue-next'
import ToggleSwitch from 'primevue/toggleswitch'
import BasketplanLinkDialog from '@/components/teams/BasketplanLinkDialog.vue'
import {
  toggleTeamBasketplanLink,
  unlinkTeamBasketplan,
} from '@/services/cloudFunctions'
import Avatar from '@/components/ui/Avatar.vue'
import Chip from '@/components/ui/Chip.vue'
import Pill from '@/components/ui/Pill.vue'
import Checkbox from 'primevue/checkbox'

const router = useRouter()
const store = useTeamsStore()
const auth = useAuthStore()
const categoriesStore = useCategoriesStore()
const cotisationTypesStore = useCotisationTypesStore()
const tagsStore = useTagsStore()

onMounted(() => {
  // Loads indépendants — la résolution `categoryId → name`,
  // `cotisationId → name+price` (resp. `tagId → name+color`) se fait à
  // l'affichage côté stores, pas de dépendance d'ordre.
  void store.load()
  void categoriesStore.loadActive()
  void cotisationTypesStore.loadActive()
  void tagsStore.loadActive()
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
// éditable `/categories`). Les chips reflètent donc les catégories
// effectivement présentes dans `teams` (compte live), avec leur libellé
// résolu via `useCategoriesStore.byId`. Le tri est piloté par
// `displayOrder` (admin contrôle l'ordre dans Settings) avec tie-break
// `minAge` puis nom — cohérent avec `compareCategories` du repo/store.
// ---------------------------------------------------------------------------

interface CategoryChip {
  id: TeamCategoryFilter
  label: string
  count: number
  /** Pour tri uniquement, jamais affiché. `null` → bucket "ouvert" (Seniors). */
  minAge: number | null
  /** Pour tri uniquement — `displayOrder` du référentiel. */
  displayOrder: number
}

const categoryChips = computed<CategoryChip[]>(() => {
  const byCat = counts.value.byCategory
  const catMap = categoriesStore.byId

  const entries: CategoryChip[] = []
  for (const [catId, count] of byCat.entries()) {
    const cat = catMap.get(catId)
    entries.push({
      id: catId,
      label: cat?.name ?? 'Inconnue',
      count,
      minAge: cat?.minAge ?? null,
      // Catégorie introuvable → fond de liste.
      displayOrder: cat?.displayOrder ?? Number.MAX_SAFE_INTEGER,
    })
  }
  entries.sort((a, b) => {
    if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder
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
    displayOrder: -1,
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
// Registration status — état d'ouverture aux inscriptions (saison courante).
//
// `closed` est rendu comme "Complète" : sémantiquement c'est "pas de place" /
// "pas d'inscription possible", ce qui correspond à la copie souhaitée par
// l'utilisateur (cf. demande "complète, ouverte, sous condition").
// ---------------------------------------------------------------------------

interface RegistrationStatusOption {
  value: TeamRegistrationStatus
  label: string
}

const REGISTRATION_STATUS_OPTIONS: ReadonlyArray<RegistrationStatusOption> = [
  { value: 'open', label: 'Ouverte' },
  { value: 'conditional', label: 'Sous condition' },
  { value: 'closed', label: 'Complète' },
] as const

function registrationStatusLabel(s: TeamRegistrationStatus): string {
  return (
    REGISTRATION_STATUS_OPTIONS.find((o) => o.value === s)?.label ?? 'Complète'
  )
}

function registrationStatusVariant(
  s: TeamRegistrationStatus,
): 'emerald' | 'amber' | 'slate' {
  if (s === 'open') return 'emerald'
  if (s === 'conditional') return 'amber'
  return 'slate'
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
// champs identité (`name`, `category`, `gender`), `cotisationId` et deux
// contraintes scheduling (`trainingsPerWeek`, `anticipatedMatches`). Les
// coachs / joueurs / créneaux gardent leur flux dédié.
// ---------------------------------------------------------------------------

interface EditTeamForm {
  name: string
  categoryId: string
  gender: TeamGender
  cotisationId: string
  trainingsPerWeek: number
  anticipatedMatches: number
  /**
   * Tags attachés à l'équipe (référence + flag display par-équipe).
   * Voir docs/main.md → "Tags d'équipes" pour le lifecycle.
   */
  tags: TeamTagRef[]
  /** État d'inscription affiché à l'admin (et à terme dans l'app register). */
  registrationStatus: TeamRegistrationStatus
}

interface EditTeamErrors {
  name: string | null
  categoryId: string | null
  cotisationId: string | null
}

const isEditing = ref(false)
const editSubmitting = ref(false)
const editForm = reactive<EditTeamForm>({
  name: '',
  categoryId: '',
  gender: 'M',
  cotisationId: '',
  trainingsPerWeek: 0,
  anticipatedMatches: 0,
  tags: [],
  registrationStatus: 'closed',
})
const editErrors = reactive<EditTeamErrors>({
  name: null,
  categoryId: null,
  cotisationId: null,
})

function resetEditErrors(): void {
  editErrors.name = null
  editErrors.categoryId = null
  editErrors.cotisationId = null
}

function hydrateEditForm(team: TeamRow): void {
  editForm.name = team.name
  // On lit le doc (`categoryId`), pas la résolution UI (`team.category`) —
  // ainsi le picker reste valide même si la catégorie a été archivée et
  // n'apparaît plus dans `activeCategories`.
  editForm.categoryId = team.categoryId
  editForm.gender = team.gender
  // Pré-rempli depuis la résolution UI : si la cotisation référencée est
  // orpheline (supprimée), on retombe sur '' et l'admin doit en choisir une.
  editForm.cotisationId = team.cotisation?.id ?? ''
  editForm.trainingsPerWeek = team.schedulingConstraints.trainingsPerWeek
  editForm.anticipatedMatches = team.schedulingConstraints.anticipatedMatches
  // Clone défensif : éviter la mutation directe du doc Pinia.
  editForm.tags = team.tags.map((r) => ({ ...r }))
  editForm.registrationStatus = team.registrationStatus
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
  editErrors.categoryId = editForm.categoryId.trim() ? null : 'Catégorie requise'
  editErrors.cotisationId = editForm.cotisationId ? null : 'Type de cotisation requis'
  return !editErrors.name && !editErrors.categoryId && !editErrors.cotisationId
}

async function submitEdit(): Promise<void> {
  const t = selectedTeam.value
  if (!t) return
  if (!validateEditForm()) return
  editSubmitting.value = true
  try {
    const ok = await store.update(t.id, {
      name: editForm.name.trim(),
      categoryId: editForm.categoryId.trim(),
      gender: editForm.gender,
      cotisationId: editForm.cotisationId,
      trainingsPerWeek: editForm.trainingsPerWeek,
      anticipatedMatches: editForm.anticipatedMatches,
      tags: editForm.tags,
      registrationStatus: editForm.registrationStatus,
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
  categoryId: string
  gender: TeamGender
  cotisationId: string
  trainingsPerWeek: number
  anticipatedMatches: number
  tags: TeamTagRef[]
  /** État d'inscription initial (défaut "Complète" = inscriptions fermées). */
  registrationStatus: TeamRegistrationStatus
}

interface CreateTeamErrors {
  name: string | null
  categoryId: string | null
  cotisationId: string | null
}

function makeEmptyForm(): CreateTeamForm {
  return {
    name: '',
    categoryId: '',
    gender: 'M',
    cotisationId: '',
    trainingsPerWeek: 1,
    anticipatedMatches: 0,
    tags: [],
    registrationStatus: 'closed',
  }
}

const isCreateDialogOpen = ref(false)
const createForm = reactive<CreateTeamForm>(makeEmptyForm())
const createErrors = reactive<CreateTeamErrors>({
  name: null,
  categoryId: null,
  cotisationId: null,
})
const submitting = ref(false)

const GENDER_OPTIONS: ReadonlyArray<{ value: TeamGender; label: string }> = [
  { value: 'M', label: 'Masculin' },
  { value: 'F', label: 'Féminin' },
  { value: 'mixed', label: 'Mixte' },
] as const

/**
 * Libellé d'âge affiché dans le slot `#option` du Select catégorie.
 * Aligne le rendu sur l'écran Settings → Catégories pour cohérence visuelle.
 */
function ageLabelFor(c: { minAge: number | null; maxAge: number | null }): string {
  if (c.minAge === null && c.maxAge === null) return 'Ouvert'
  if (c.minAge !== null && c.maxAge === null) return `${c.minAge} ans+`
  if (c.minAge === null && c.maxAge !== null) return `≤ ${c.maxAge} ans`
  if (c.minAge === c.maxAge) return `${c.minAge} ans`
  return `${c.minAge}-${c.maxAge} ans`
}

/**
 * Renvoie l'admin sur Settings → section Catégories. Le param `section`
 * n'est pas encore implémenté côté Settings.vue mais sert de pointer
 * naturel — au pire on tombe sur la section General.
 */
function goToCategoriesSettings(): void {
  void router.push({ path: '/settings', query: { section: 'categories' } })
}

/** Pointer vers Settings → Tags (même limitation que goToCategoriesSettings). */
function goToTagsSettings(): void {
  void router.push({ path: '/settings', query: { section: 'tags' } })
}

// ---------------------------------------------------------------------------
// Tags helpers — manipulent un tableau `TeamTagRef[]` (forme partagée
// create + edit). On garde la logique en dehors du template pour rester
// lisible.
// ---------------------------------------------------------------------------

function findTagIndex(tags: TeamTagRef[], tagId: string): number {
  return tags.findIndex((r) => r.tagId === tagId)
}

function isTagAttached(tags: TeamTagRef[], tagId: string): boolean {
  return findTagIndex(tags, tagId) !== -1
}

function isTagDisplayed(tags: TeamTagRef[], tagId: string): boolean {
  const ref = tags.find((r) => r.tagId === tagId)
  return ref ? ref.display : false
}

/**
 * Attache / détache le tag. Par défaut un tag fraîchement coché est
 * `display: true` (cas dominant) ; l'admin peut le passer à `display: false`
 * via la checkbox secondaire.
 */
function toggleTagOnForm(tags: TeamTagRef[], tagId: string): void {
  const idx = findTagIndex(tags, tagId)
  if (idx === -1) {
    tags.push({ tagId, display: true })
  } else {
    tags.splice(idx, 1)
  }
}

function setTagDisplayOnForm(
  tags: TeamTagRef[],
  tagId: string,
  display: boolean,
): void {
  const idx = findTagIndex(tags, tagId)
  if (idx === -1) return
  tags[idx] = { tagId, display }
}

function openCreateDialog(): void {
  Object.assign(createForm, makeEmptyForm())
  createErrors.name = null
  createErrors.categoryId = null
  createErrors.cotisationId = null
  isCreateDialogOpen.value = true
}

function closeCreateDialog(): void {
  isCreateDialogOpen.value = false
}

function validateCreateForm(): boolean {
  createErrors.name = createForm.name.trim() ? null : 'Nom requis'
  createErrors.categoryId = createForm.categoryId.trim() ? null : 'Catégorie requise'
  createErrors.cotisationId = createForm.cotisationId ? null : 'Type de cotisation requis'
  return (
    !createErrors.name && !createErrors.categoryId && !createErrors.cotisationId
  )
}

async function submitCreate(): Promise<void> {
  if (!validateCreateForm()) return
  submitting.value = true
  try {
    const newId = await store.create({
      name: createForm.name.trim(),
      categoryId: createForm.categoryId.trim(),
      gender: createForm.gender,
      cotisationId: createForm.cotisationId,
      trainingsPerWeek: createForm.trainingsPerWeek,
      anticipatedMatches: createForm.anticipatedMatches,
      tags: createForm.tags,
      registrationStatus: createForm.registrationStatus,
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

// ---------------------------------------------------------------------------
// Basketplan — section "Compétitions Basketplan" dans le drawer team.
//
// Visible uniquement pour admin / rootAdmin / coach-of-this-team. Les
// mutations passent par les callables `linkTeamToBasketplan` /
// `unlinkTeamBasketplan` / `toggleTeamBasketplanLink` (cf.
// docs/basketplan-integration.md § 6.2).
// ---------------------------------------------------------------------------

/**
 * `true` si le user courant peut administrer les liens Basketplan de l'équipe
 * sélectionnée. Aligné sur la garde serveur `assertAdminOrCoachOfTeam`.
 */
const canManageBasketplan = computed<boolean>(() => {
  const team = selectedTeam.value
  if (!team) return false
  if (auth.rootAdmin) return true
  if (auth.roles.includes('admin')) return true
  const uid = auth.authSnap?.uid
  if (!uid) return false
  return team.coachIds.includes(uid)
})

const isBasketplanDialogOpen = ref(false)
/** Id du link en cours de toggle/unlink, pour disabled granulaire. */
const basketplanActionPending = ref<string | null>(null)
/** Erreur transitoire (toggle/unlink) — affichée sous la liste. */
const basketplanError = ref<string | null>(null)

function openBasketplanDialog(): void {
  basketplanError.value = null
  isBasketplanDialogOpen.value = true
}

function onBasketplanLinked(payload: { link: BasketplanCompetitionLink }): void {
  const team = selectedTeam.value
  if (!team) return
  // Patch local — pas de re-fetch nécessaire, la callable a déjà résolu les
  // caches côté serveur et renvoyé le link complet.
  store.addBasketplanLinkLocal(team.id, payload.link)
}

async function onToggleBasketplanLink(
  link: BasketplanCompetitionLink,
  active: boolean,
): Promise<void> {
  const team = selectedTeam.value
  if (!team) return
  basketplanActionPending.value = link.id
  basketplanError.value = null
  // Optimistic local toggle puis rollback en cas d'erreur.
  store.toggleBasketplanLinkLocal(team.id, link.id, active)
  try {
    await toggleTeamBasketplanLink({
      teamId: team.id,
      linkId: link.id,
      active,
    })
  } catch (err) {
    // Rollback.
    store.toggleBasketplanLinkLocal(team.id, link.id, !active)
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`toggleTeamBasketplanLink failed [${code}]`, err)
    basketplanError.value =
      code === 'permission-denied'
        ? "Tu n'as pas les droits pour modifier ce lien."
        : err instanceof Error
          ? err.message
          : 'Erreur lors du toggle du lien Basketplan.'
  } finally {
    basketplanActionPending.value = null
  }
}

async function onUnlinkBasketplan(
  link: BasketplanCompetitionLink,
): Promise<void> {
  const team = selectedTeam.value
  if (!team) return
  const confirmed = window.confirm(
    `Retirer le lien Basketplan vers "${link.leagueHoldingName}" (${link.federationCode}) ?\n\nLes matchs déjà synchronisés ne seront pas supprimés, mais le sync nocturne s'arrêtera pour cette compétition.`,
  )
  if (!confirmed) return
  basketplanActionPending.value = link.id
  basketplanError.value = null
  try {
    await unlinkTeamBasketplan({ teamId: team.id, linkId: link.id })
    store.removeBasketplanLinkLocal(team.id, link.id)
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`unlinkTeamBasketplan failed [${code}]`, err)
    basketplanError.value =
      code === 'permission-denied'
        ? "Tu n'as pas les droits pour retirer ce lien."
        : err instanceof Error
          ? err.message
          : 'Erreur lors du retrait du lien Basketplan.'
  } finally {
    basketplanActionPending.value = null
  }
}
</script>

<template>
  <section class="p-6 space-y-4">
    <!-- ================= Page heading =================== -->
    <div class="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-[22px] font-semibold tracking-tight">
          Équipes
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
                :title="ageRangeLabel(team) ? `${team.category?.name ?? 'Catégorie inconnue'} · ${ageRangeLabel(team)}` : (team.category?.name ?? 'Catégorie inconnue')"
              >
                {{ team.category?.name ?? 'Catégorie inconnue' }}
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
              <Pill
                v-for="tagRef in team.tagRefs.filter((t) => t.display)"
                :key="tagRef.id"
                :variant="tagRef.color"
              >
                {{ tagRef.name }}
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
              <template v-if="team.cotisation">
                CHF {{ team.cotisation.price }}
              </template>
              <template v-else>
                <span class="text-surface-400">—</span>
              </template>
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
                  {{ selectedTeam.category?.name ?? 'Catégorie inconnue' }}
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
                    <Select
                      v-model="editForm.categoryId"
                      :options="categoriesStore.activeCategories"
                      option-label="name"
                      option-value="id"
                      placeholder="Sélectionner…"
                      class="mt-1 w-full"
                      :invalid="!!editErrors.categoryId"
                      :empty-message="categoriesStore.loading ? 'Chargement…' : 'Aucune catégorie active'"
                    >
                      <template #option="{ option }">
                        <div class="flex items-center justify-between gap-2 w-full">
                          <span>{{ option.name }}</span>
                          <span class="text-[11px] text-surface-500">{{ ageLabelFor(option) }}</span>
                        </div>
                      </template>
                    </Select>
                    <span
                      v-if="editErrors.categoryId"
                      class="text-[11px] text-rose-600 mt-1 block"
                    >
                      {{ editErrors.categoryId }}
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
                  <span class="text-[12px] text-surface-600">Type de cotisation</span>
                  <Select
                    v-model="editForm.cotisationId"
                    :options="cotisationTypesStore.activeCotisationTypes"
                    option-label="name"
                    option-value="id"
                    placeholder="Sélectionner un type de cotisation…"
                    class="mt-1 w-full"
                    :invalid="!!editErrors.cotisationId"
                    :empty-message="cotisationTypesStore.loading ? 'Chargement…' : 'Aucun type de cotisation actif'"
                  >
                    <template #option="{ option }">
                      <div class="flex items-center justify-between gap-2 w-full">
                        <span>{{ option.name }}</span>
                        <span class="text-[11px] text-surface-500 num">CHF {{ option.price }}</span>
                      </div>
                    </template>
                  </Select>
                  <span
                    v-if="editErrors.cotisationId"
                    class="text-[11px] text-rose-600 mt-1 block"
                  >
                    {{ editErrors.cotisationId }}
                  </span>
                </label>

                <label class="block">
                  <span class="text-[12px] text-surface-600">État de l'équipe</span>
                  <Select
                    v-model="editForm.registrationStatus"
                    :options="[...REGISTRATION_STATUS_OPTIONS]"
                    option-label="label"
                    option-value="value"
                    class="mt-1 w-full"
                  />
                  <span class="text-[11px] text-surface-500 mt-1 block">
                    Affichage public dans l'app d'inscription : "Ouverte" =
                    inscriptions libres, "Sous condition" = inscriptions soumises
                    à validation, "Complète" = inscriptions fermées.
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

                <!-- Tags picker (multi-select + flag display par-équipe) -->
                <div class="block">
                  <span class="text-[12px] text-surface-600">
                    Tags
                  </span>
                  <div
                    v-if="!tagsStore.loading && tagsStore.activeTags.length === 0"
                    class="mt-1 text-[12px] text-surface-500"
                  >
                    Aucun tag actif.
                    <button
                      type="button"
                      class="text-emerald-700 hover:underline font-medium"
                      @click="goToTagsSettings"
                    >
                      Créer un tag
                    </button>
                    dans Settings → Tags.
                  </div>
                  <div
                    v-else
                    class="mt-1 space-y-1.5"
                  >
                    <div
                      v-for="tag in tagsStore.activeTags"
                      :key="tag.id"
                      class="flex items-center gap-2"
                    >
                      <Checkbox
                        :input-id="`edit-tag-${tag.id}`"
                        :model-value="isTagAttached(editForm.tags, tag.id)"
                        binary
                        @update:model-value="toggleTagOnForm(editForm.tags, tag.id)"
                      />
                      <label
                        :for="`edit-tag-${tag.id}`"
                        class="cursor-pointer select-none"
                      >
                        <Pill :variant="tag.color">
                          {{ tag.name }}
                        </Pill>
                      </label>
                      <label
                        v-if="isTagAttached(editForm.tags, tag.id)"
                        class="ml-auto flex items-center gap-1.5 text-[11px] text-surface-600 cursor-pointer"
                      >
                        <Checkbox
                          :model-value="isTagDisplayed(editForm.tags, tag.id)"
                          binary
                          @update:model-value="(v) => setTagDisplayOnForm(editForm.tags, tag.id, v === true)"
                        />
                        afficher
                      </label>
                    </div>
                  </div>
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
                    {{ selectedTeam.category?.name ?? 'Catégorie inconnue' }}
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
                  <Pill
                    :variant="registrationStatusVariant(selectedTeam.registrationStatus)"
                    :title="`Inscriptions : ${registrationStatusLabel(selectedTeam.registrationStatus).toLowerCase()}`"
                  >
                    {{ registrationStatusLabel(selectedTeam.registrationStatus) }}
                  </Pill>
                  <Pill
                    v-for="tagRef in selectedTeam.tagRefs.filter((t) => t.display)"
                    :key="tagRef.id"
                    :variant="tagRef.color"
                  >
                    {{ tagRef.name }}
                  </Pill>
                </div>
                <!-- Tags non-display : visibles uniquement côté admin (ligne discrète) -->
                <div
                  v-if="selectedTeam.tagRefs.some((t) => !t.display)"
                  class="flex items-center gap-1.5 flex-wrap pt-0.5"
                >
                  <span class="text-[11px] text-surface-400">
                    Tags admin (non affichés) :
                  </span>
                  <Pill
                    v-for="tagRef in selectedTeam.tagRefs.filter((t) => !t.display)"
                    :key="tagRef.id"
                    :variant="tagRef.color"
                    class="opacity-60"
                  >
                    {{ tagRef.name }}
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

              <!-- ============== Compétitions Basketplan ============== -->
              <section
                v-if="canManageBasketplan"
                class="space-y-2"
              >
                <h4 class="text-[11px] uppercase tracking-wide text-surface-500 font-semibold flex items-center gap-1">
                  <Trophy
                    :size="11"
                    :stroke-width="2"
                  />
                  Compétitions Basketplan
                </h4>
                <div
                  v-if="!selectedTeam.basketplanLinks || selectedTeam.basketplanLinks.length === 0"
                  class="text-[12px] text-surface-500"
                >
                  Aucune compétition liée pour l'instant. Lie l'équipe à une
                  compétition Swiss Basketball pour synchroniser
                  automatiquement ses matchs.
                </div>
                <ul
                  v-else
                  class="space-y-1.5"
                >
                  <li
                    v-for="link in selectedTeam.basketplanLinks"
                    :key="link.id"
                    class="flex items-center gap-2 px-2 py-1.5 rounded-md border border-surface-200 bg-white"
                  >
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2 min-w-0">
                        <span class="text-[11px] font-semibold text-surface-700 shrink-0">
                          {{ link.federationCode }}
                        </span>
                        <span class="text-[13px] truncate">
                          {{ link.leagueHoldingName }}
                        </span>
                      </div>
                      <div class="text-[11px] text-surface-500 mt-0.5 truncate">
                        Équipe : {{ link.teamNameInLeague }}
                      </div>
                    </div>
                    <ToggleSwitch
                      :model-value="link.active"
                      :disabled="basketplanActionPending === link.id"
                      :aria-label="link.active ? 'Désactiver le lien' : 'Activer le lien'"
                      @update:model-value="(v: boolean) => onToggleBasketplanLink(link, v)"
                    />
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm !px-1.5 text-surface-500"
                      :disabled="basketplanActionPending === link.id"
                      :aria-label="`Retirer le lien ${link.leagueHoldingName}`"
                      @click="onUnlinkBasketplan(link)"
                    >
                      <X
                        :size="14"
                        :stroke-width="2"
                      />
                    </button>
                  </li>
                </ul>
                <div
                  v-if="basketplanError"
                  class="text-[11px] text-rose-600"
                >
                  {{ basketplanError }}
                </div>
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  @click="openBasketplanDialog"
                >
                  <Plug
                    :size="14"
                    :stroke-width="2"
                  />
                  Lier une compétition
                </button>
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
            <Select
              v-model="createForm.categoryId"
              :options="categoriesStore.activeCategories"
              option-label="name"
              option-value="id"
              placeholder="Sélectionner…"
              class="mt-1 w-full"
              :invalid="!!createErrors.categoryId"
              :empty-message="categoriesStore.loading ? 'Chargement…' : 'Aucune catégorie active'"
            >
              <template #option="{ option }">
                <div class="flex items-center justify-between gap-2 w-full">
                  <span>{{ option.name }}</span>
                  <span class="text-[11px] text-surface-500">{{ ageLabelFor(option) }}</span>
                </div>
              </template>
            </Select>
            <span
              v-if="createErrors.categoryId"
              class="text-[11px] text-rose-600 mt-1 block"
            >
              {{ createErrors.categoryId }}
            </span>
            <span
              v-if="!categoriesStore.loading && categoriesStore.activeCategories.length === 0"
              class="text-[11px] text-surface-500 mt-1 block"
            >
              Aucune catégorie active.
              <button
                type="button"
                class="text-emerald-700 hover:underline font-medium"
                @click="goToCategoriesSettings"
              >
                Créer une catégorie
              </button>
              dans Settings → Catégories.
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

        <label class="block">
          <span class="text-[12px] text-surface-600">Type de cotisation</span>
          <Select
            v-model="createForm.cotisationId"
            :options="cotisationTypesStore.activeCotisationTypes"
            option-label="name"
            option-value="id"
            placeholder="Sélectionner un type de cotisation…"
            class="mt-1 w-full"
            :invalid="!!createErrors.cotisationId"
            :empty-message="cotisationTypesStore.loading ? 'Chargement…' : 'Aucun type de cotisation actif'"
          >
            <template #option="{ option }">
              <div class="flex items-center justify-between gap-2 w-full">
                <span>{{ option.name }}</span>
                <span class="text-[11px] text-surface-500 num">CHF {{ option.price }}</span>
              </div>
            </template>
          </Select>
          <span
            v-if="createErrors.cotisationId"
            class="text-[11px] text-rose-600 mt-1 block"
          >
            {{ createErrors.cotisationId }}
          </span>
        </label>

        <label class="block">
          <span class="text-[12px] text-surface-600">État de l'équipe</span>
          <Select
            v-model="createForm.registrationStatus"
            :options="[...REGISTRATION_STATUS_OPTIONS]"
            option-label="label"
            option-value="value"
            class="mt-1 w-full"
          />
          <span class="text-[11px] text-surface-500 mt-1 block">
            "Ouverte" = inscriptions libres, "Sous condition" = inscriptions
            soumises à validation, "Complète" = inscriptions fermées.
          </span>
        </label>

        <div class="grid grid-cols-2 gap-3">
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

        <!-- Tags picker (multi-select + flag display par-équipe) -->
        <div class="block">
          <span class="text-[12px] text-surface-600">
            Tags <span class="text-surface-400">(optionnel)</span>
          </span>
          <div
            v-if="!tagsStore.loading && tagsStore.activeTags.length === 0"
            class="mt-1 text-[12px] text-surface-500"
          >
            Aucun tag actif.
            <button
              type="button"
              class="text-emerald-700 hover:underline font-medium"
              @click="goToTagsSettings"
            >
              Créer un tag
            </button>
            dans Settings → Tags.
          </div>
          <div
            v-else
            class="mt-1 space-y-1.5"
          >
            <div
              v-for="tag in tagsStore.activeTags"
              :key="tag.id"
              class="flex items-center gap-2"
            >
              <Checkbox
                :input-id="`create-tag-${tag.id}`"
                :model-value="isTagAttached(createForm.tags, tag.id)"
                binary
                @update:model-value="toggleTagOnForm(createForm.tags, tag.id)"
              />
              <label
                :for="`create-tag-${tag.id}`"
                class="cursor-pointer select-none"
              >
                <Pill :variant="tag.color">
                  {{ tag.name }}
                </Pill>
              </label>
              <label
                v-if="isTagAttached(createForm.tags, tag.id)"
                class="ml-auto flex items-center gap-1.5 text-[11px] text-surface-600 cursor-pointer"
              >
                <Checkbox
                  :model-value="isTagDisplayed(createForm.tags, tag.id)"
                  binary
                  @update:model-value="(v) => setTagDisplayOnForm(createForm.tags, tag.id, v === true)"
                />
                afficher
              </label>
            </div>
          </div>
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

    <!-- ================= Basketplan link dialog =================== -->
    <BasketplanLinkDialog
      v-if="selectedTeam"
      v-model:visible="isBasketplanDialogOpen"
      :team-id="selectedTeam.id"
      :team-name="selectedTeam.name"
      @linked="onBasketplanLinked"
    />
  </section>
</template>
