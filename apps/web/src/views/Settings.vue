<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  BadgeCheck,
  Banknote,
  Building2,
  CalendarX,
  Check,
  CircleAlert,
  Crown,
  Dribbble,
  Layers,
  Mail,
  Plus,
  Send,
  Siren,
  Tag as TagIcon,
  Tags,
  Trash2,
  TriangleAlert,
  Trophy,
  Users,
  X,
} from 'lucide-vue-next'
import Checkbox from 'primevue/checkbox'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import Textarea from 'primevue/textarea'
import { useSettingsStore, type SettingsSection } from '@/stores/settings'
import { useCategoriesStore } from '@/stores/categories'
import { useTagsStore } from '@/stores/tags'
import { useCotisationTypesStore } from '@/stores/cotisationTypes'
import { useLicenseTypesStore } from '@/stores/licenseTypes'
import { useMatchTypesStore, type MatchTypeInput } from '@/stores/matchTypes'
import Avatar from '@/components/ui/Avatar.vue'
import Pill from '@/components/ui/Pill.vue'
import RoleBadge from '@/components/ui/RoleBadge.vue'
import {
  BANKING_FIELD_LIMITS,
  formatIbanForDisplay,
  normalizeBic,
  normalizeIban,
  validateBic,
  validateIban,
} from '@/utils/banking'
import type {
  Category,
  ClubAddress,
  CotisationType,
  CourtSize,
  DuesConfig,
  LicenseRole,
  LicenseType,
  MatchType,
  OfficialRequirement,
  OfficialsConfig,
  Role,
  SubscriptionStatus,
  Tag,
  TagColor,
  Timestamp,
} from '@club-app/shared-types'

const store = useSettingsStore()

onMounted(() => {
  void store.load()
})

// ---------------------------------------------------------------------------
// Vertical nav (left tabs)
// ---------------------------------------------------------------------------

interface NavItem {
  id: SettingsSection
  label: string
  icon: typeof Building2
}

interface NavGroup {
  label: string
  items: readonly NavItem[]
}

/**
 * Nav groupée par domaine. Le header de groupe est non-cliquable (juste un
 * label uppercase muted), les items dessous sont les boutons existants.
 * Garde les ids alignés sur `SettingsSection` — ne change pas l'id `general`
 * (utilisé partout dans le store et les watchers).
 */
const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'Club',
    items: [
      { id: 'general', label: 'Club info', icon: Building2 },
      { id: 'adminTeam', label: 'Admin team', icon: Users },
    ],
  },
  {
    label: 'Équipes',
    items: [
      { id: 'categories', label: 'Catégories', icon: Layers },
      { id: 'tags', label: 'Tags', icon: TagIcon },
      { id: 'cotisations', label: 'Types de cotisation', icon: Banknote },
    ],
  },
  {
    label: 'Membres',
    items: [
      { id: 'roles', label: 'Member roles', icon: Tags },
    ],
  },
  {
    label: 'Saison / Compétition',
    items: [
      { id: 'officials', label: 'Officials', icon: Siren },
      { id: 'matchTypes', label: 'Match types', icon: Trophy },
      { id: 'closurePeriods', label: 'Closure periods', icon: CalendarX },
    ],
  },
  {
    label: 'Licences',
    items: [
      { id: 'licenses', label: 'Types de licence', icon: BadgeCheck },
    ],
  },
  {
    label: 'Finances',
    items: [
      { id: 'dues', label: 'Dues config', icon: Banknote },
    ],
  },
] as const

const activeSection = ref<SettingsSection>('general')

// ---------------------------------------------------------------------------
// General — local form state hydrated from store. Watcher pour syncer après
// load() async.
// ---------------------------------------------------------------------------

interface GeneralForm {
  name: string
  shortCode: string
  addressLine: string
  contactEmail: string
  contactPhone: string
}

const generalForm = ref<GeneralForm>({
  name: '',
  shortCode: '',
  addressLine: '',
  contactEmail: '',
  contactPhone: '',
})

const generalErrors = ref<Partial<Record<keyof GeneralForm, string>>>({})

/** Reconstruit l'address line "Av. de la Forêt 12, 1010 Lausanne" depuis ClubAddress. */
function addressLineFrom(addr: ClubAddress | null): string {
  if (!addr) return ''
  const parts: string[] = []
  if (addr.street) parts.push(addr.street)
  const cityPart = [addr.zip, addr.city].filter(Boolean).join(' ')
  if (cityPart) parts.push(cityPart)
  return parts.join(', ')
}

/**
 * Parse "Street, ZIP City" → `ClubAddress`. Fallback : street = input entier
 * si format inattendu. `country` est conservé tel quel depuis le snapshot
 * existant (l'écran ne l'expose pas dans v1).
 */
function parseAddressLine(line: string, existing: ClubAddress | null): ClubAddress {
  const country = existing?.country ?? 'CH'
  const trimmed = line.trim()
  if (!trimmed) {
    return { street: '', city: '', zip: '', country }
  }
  const [streetPart, cityPart] = trimmed.split(',').map((s) => s.trim())
  if (!cityPart) {
    return { street: streetPart, city: '', zip: '', country }
  }
  const match = cityPart.match(/^(\d{4,5})\s+(.+)$/)
  if (match) {
    return { street: streetPart, zip: match[1], city: match[2], country }
  }
  return { street: streetPart, city: cityPart, zip: '', country }
}

watch(
  () => store.config,
  (config) => {
    if (config) {
      generalForm.value = {
        name: config.name,
        shortCode: config.shortCode,
        addressLine: addressLineFrom(config.address),
        contactEmail: config.contact.email,
        contactPhone: config.contact.phone,
      }
    }
  },
  { immediate: true, deep: true },
)

function validateGeneral(): boolean {
  const errors: Partial<Record<keyof GeneralForm, string>> = {}
  if (!generalForm.value.name.trim()) errors.name = 'Le nom du club est requis'
  if (!generalForm.value.shortCode.trim()) {
    errors.shortCode = 'Code court requis'
  } else if (!/^[a-z0-9-]+$/.test(generalForm.value.shortCode)) {
    errors.shortCode = 'Lowercase, chiffres, tirets uniquement'
  }
  if (generalForm.value.contactEmail.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(generalForm.value.contactEmail)) {
    errors.contactEmail = 'Email invalide'
  }
  generalErrors.value = errors
  return Object.keys(errors).length === 0
}

async function saveGeneral(): Promise<void> {
  if (!validateGeneral()) return
  if (!store.config) return
  const addr = parseAddressLine(generalForm.value.addressLine, store.config.address)
  try {
    await store.saveClubInfo({
      name: generalForm.value.name.trim(),
      shortCode: generalForm.value.shortCode.trim(),
      address: addr,
      contact: {
        email: generalForm.value.contactEmail.trim(),
        phone: generalForm.value.contactPhone.trim(),
      },
    })
  } catch {
    /* error surfaced via store.error */
  }
}

function resetGeneral(): void {
  if (store.config) {
    generalForm.value = {
      name: store.config.name,
      shortCode: store.config.shortCode,
      addressLine: addressLineFrom(store.config.address),
      contactEmail: store.config.contact.email,
      contactPhone: store.config.contact.phone,
    }
    generalErrors.value = {}
  }
}

// ---------------------------------------------------------------------------
// Logo upload — file input caché, déclenché par le bouton "Remplacer".
//
// Validation locale : type image + taille < 2 MB (aligné avec storage.rules).
// Le store gère l'upload + le patch /config/club.logo + le cleanup ancien.
// ---------------------------------------------------------------------------

const logoInputRef = ref<HTMLInputElement | null>(null)
const logoUploading = ref(false)
const logoError = ref<string | null>(null)

const LOGO_MAX_BYTES = 2 * 1024 * 1024
const LOGO_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']

function triggerLogoPicker(): void {
  logoError.value = null
  logoInputRef.value?.click()
}

async function onLogoSelected(e: Event): Promise<void> {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0] ?? null
  // Reset le input pour permettre un re-pick du même fichier après une erreur.
  target.value = ''
  if (!file) return
  if (!LOGO_ACCEPTED_TYPES.includes(file.type)) {
    logoError.value = 'Format non supporté (PNG, JPG, SVG ou WebP attendu).'
    return
  }
  if (file.size > LOGO_MAX_BYTES) {
    logoError.value = 'Fichier trop volumineux (max 2 MB).'
    return
  }
  logoUploading.value = true
  try {
    await store.setLogo(file)
  } catch {
    logoError.value = store.error ?? "Erreur lors de l'upload."
  } finally {
    logoUploading.value = false
  }
}

async function removeLogo(): Promise<void> {
  logoError.value = null
  logoUploading.value = true
  try {
    await store.removeLogo()
  } catch {
    logoError.value = store.error ?? 'Erreur lors de la suppression.'
  } finally {
    logoUploading.value = false
  }
}

// ---------------------------------------------------------------------------
// Banking info — local form synced from `/config/club.banking`.
//
// Tous les champs sont optionnels (`null` côté schéma) ; on les manipule en
// string vide côté UI pour les InputText, puis on normalise au save :
//   - chaîne trimée non-vide → string
//   - chaîne trimée vide     → null
// Le bouton "Sauvegarder" persiste l'objet complet (ou `null` si tous les
// champs sont vides — pour permettre de "reset" la section).
// ---------------------------------------------------------------------------

interface BankingForm {
  iban: string
  bic: string
  bankName: string
  accountHolder: string
  paymentInstructions: string
}

const bankingForm = ref<BankingForm>({
  iban: '',
  bic: '',
  bankName: '',
  accountHolder: '',
  paymentInstructions: '',
})
const bankingErrors = ref<Partial<Record<keyof BankingForm, string>>>({})

watch(
  () => store.config?.banking,
  (banking) => {
    bankingForm.value = {
      // Affichage IBAN avec groupes de 4 (la forme canonique est sans espaces
      // côté base — cf. `normalizeIban` au save).
      iban: banking?.iban ? formatIbanForDisplay(banking.iban) : '',
      bic: banking?.bic ?? '',
      bankName: banking?.bankName ?? '',
      accountHolder: banking?.accountHolder ?? '',
      paymentInstructions: banking?.paymentInstructions ?? '',
    }
  },
  { immediate: true, deep: true },
)

/**
 * Validation du formulaire banking. Politique :
 *  - Tous les champs vides → OK (reset complet, persiste `banking: null`).
 *  - Dès qu'un champ est rempli, on impose le **minimum vital pour un virement** :
 *    IBAN valide + titulaire du compte (sinon le parent ne peut pas payer côté
 *    register, cf. `useClubStore.hasUsableBanking` dans `apps/courtbase-register`).
 *  - L'IBAN est validé strictement (format + longueur pays + mod-97).
 *  - Le BIC est validé strictement s'il est renseigné (format ISO 9362).
 *  - Les champs libres (bankName, accountHolder, paymentInstructions) sont
 *    bornés en longueur pour bloquer les paste accidentels.
 */
function validateBanking(): boolean {
  const errors: Partial<Record<keyof BankingForm, string>> = {}
  const f = bankingForm.value
  const allEmpty =
    !f.iban.trim() &&
    !f.bic.trim() &&
    !f.bankName.trim() &&
    !f.accountHolder.trim() &&
    !f.paymentInstructions.trim()
  if (allEmpty) {
    bankingErrors.value = {}
    return true
  }

  // IBAN — requis dès qu'un champ est rempli, validation stricte.
  const ibanErr = validateIban(f.iban)
  if (ibanErr) errors.iban = ibanErr

  // Titulaire — requis pour qu'un virement soit possible.
  if (!f.accountHolder.trim()) {
    errors.accountHolder = 'Titulaire du compte requis'
  } else if (f.accountHolder.trim().length > BANKING_FIELD_LIMITS.accountHolder) {
    errors.accountHolder = `Maximum ${BANKING_FIELD_LIMITS.accountHolder} caractères`
  }

  // BIC — optionnel mais strict si renseigné.
  const bicErr = validateBic(f.bic)
  if (bicErr) errors.bic = bicErr

  // bankName — borne uniquement.
  if (f.bankName.trim().length > BANKING_FIELD_LIMITS.bankName) {
    errors.bankName = `Maximum ${BANKING_FIELD_LIMITS.bankName} caractères`
  }

  // paymentInstructions — borne uniquement.
  if (f.paymentInstructions.trim().length > BANKING_FIELD_LIMITS.paymentInstructions) {
    errors.paymentInstructions = `Maximum ${BANKING_FIELD_LIMITS.paymentInstructions} caractères`
  }

  bankingErrors.value = errors
  return Object.keys(errors).length === 0
}

async function saveBanking(): Promise<void> {
  if (!validateBanking()) return
  const f = bankingForm.value
  const trim = (s: string): string | null => {
    const t = s.trim()
    return t.length === 0 ? null : t
  }
  // Normalisation : IBAN/BIC stockés en forme canonique (uppercase, sans
  // espaces) — la couche présentation reformate à l'affichage.
  const ibanCanon = trim(f.iban)
  const bicCanon = trim(f.bic)
  const banking = {
    iban: ibanCanon ? normalizeIban(ibanCanon) : null,
    bic: bicCanon ? normalizeBic(bicCanon) : null,
    bankName: trim(f.bankName),
    accountHolder: trim(f.accountHolder),
    paymentInstructions: trim(f.paymentInstructions),
  }
  const isAllNull =
    banking.iban === null &&
    banking.bic === null &&
    banking.bankName === null &&
    banking.accountHolder === null &&
    banking.paymentInstructions === null
  try {
    await store.saveBanking(isAllNull ? null : banking)
    // Re-sync du form sur la valeur normalisée (sans cela, l'utilisateur
    // verrait toujours sa saisie minuscule + espacée alors qu'on a persisté
    // la canonique).
    if (banking.iban) bankingForm.value.iban = formatIbanForDisplay(banking.iban)
    if (banking.bic) bankingForm.value.bic = banking.bic
  } catch {
    /* error surfaced via store.error */
  }
}

function resetBanking(): void {
  const banking = store.config?.banking
  bankingForm.value = {
    iban: banking?.iban ? formatIbanForDisplay(banking.iban) : '',
    bic: banking?.bic ?? '',
    bankName: banking?.bankName ?? '',
    accountHolder: banking?.accountHolder ?? '',
    paymentInstructions: banking?.paymentInstructions ?? '',
  }
  bankingErrors.value = {}
}

// ---------------------------------------------------------------------------
// Officials config — local form + threshold preview
// ---------------------------------------------------------------------------

const officialsForm = ref<OfficialsConfig>({
  licenseFee: 140,
  thresholdGreen: 6,
  thresholdOrange: 3,
})
const officialsErrors = ref<Partial<Record<keyof OfficialsConfig, string>>>({})

watch(
  () => store.config?.officialsConfig,
  (cfg) => {
    if (cfg) officialsForm.value = { ...cfg }
  },
  { immediate: true, deep: true },
)

function validateOfficials(): boolean {
  const errors: Partial<Record<keyof OfficialsConfig, string>> = {}
  if (officialsForm.value.licenseFee <= 0) errors.licenseFee = 'Montant > 0'
  if (officialsForm.value.thresholdOrange < 1) errors.thresholdOrange = 'Min 1'
  if (officialsForm.value.thresholdGreen <= officialsForm.value.thresholdOrange) {
    errors.thresholdGreen = 'Doit être > seuil orange'
  }
  officialsErrors.value = errors
  return Object.keys(errors).length === 0
}

async function saveOfficials(): Promise<void> {
  if (!validateOfficials()) return
  try {
    await store.saveOfficialsConfig({ ...officialsForm.value })
  } catch {
    /* error surfaced via store.error */
  }
}

// ---------------------------------------------------------------------------
// Dues config — local form + timeline preview
// ---------------------------------------------------------------------------

const duesForm = ref<DuesConfig>({
  gracePeriodDays: 21,
  paymentDueDays: 14,
})
const duesErrors = ref<Partial<Record<keyof DuesConfig, string>>>({})

watch(
  () => store.config?.duesConfig,
  (cfg) => {
    if (cfg) duesForm.value = { ...cfg }
  },
  { immediate: true, deep: true },
)

function validateDues(): boolean {
  const errors: Partial<Record<keyof DuesConfig, string>> = {}
  if (duesForm.value.gracePeriodDays < 0) errors.gracePeriodDays = 'Min 0'
  if (duesForm.value.paymentDueDays <= 0) errors.paymentDueDays = 'Min 1'
  duesErrors.value = errors
  return Object.keys(errors).length === 0
}

async function saveDues(): Promise<void> {
  if (!validateDues()) return
  try {
    await store.saveDuesConfig({ ...duesForm.value })
  } catch {
    /* error surfaced via store.error */
  }
}

// ---------------------------------------------------------------------------
// Roles — CRUD modal-ish inline. Pas de modal real ; on utilise un row
// "edit" qui flip en mode édition.
// ---------------------------------------------------------------------------

interface RoleDraft {
  name: string
  color: string
}

const COLOR_PRESETS: readonly { value: string; label: string }[] = [
  { value: '#dbeafe', label: 'Bleu' },
  { value: '#fee2e2', label: 'Rouge' },
  { value: '#dcfce7', label: 'Vert' },
  { value: '#fef3c7', label: 'Ambre' },
  { value: '#ede9fe', label: 'Violet' },
  { value: '#fce7f3', label: 'Rose' },
  { value: '#cffafe', label: 'Cyan' },
  { value: '#fde68a', label: 'Jaune' },
  { value: '#f1f5f9', label: 'Gris' },
] as const

const editingRoleId = ref<string | null>(null)
const isAddingRole = ref(false)
const roleDraft = ref<RoleDraft>({ name: '', color: COLOR_PRESETS[0].value })
const roleError = ref<string | null>(null)

function startAddRole(): void {
  isAddingRole.value = true
  editingRoleId.value = null
  roleDraft.value = { name: '', color: COLOR_PRESETS[0].value }
  roleError.value = null
}

function startEditRole(role: Role): void {
  if (role.type === 'system') return
  isAddingRole.value = false
  editingRoleId.value = role.id
  roleDraft.value = { name: role.name, color: role.color }
  roleError.value = null
}

function cancelRoleEdit(): void {
  isAddingRole.value = false
  editingRoleId.value = null
  roleError.value = null
}

function validateRoleDraft(): boolean {
  const name = roleDraft.value.name.trim()
  if (!name) {
    roleError.value = 'Nom requis'
    return false
  }
  if (name.length > 32) {
    roleError.value = 'Maximum 32 caractères'
    return false
  }
  roleError.value = null
  return true
}

async function commitRole(): Promise<void> {
  if (!validateRoleDraft()) return
  const payload: RoleDraft = {
    name: roleDraft.value.name.trim(),
    color: roleDraft.value.color,
  }
  try {
    if (isAddingRole.value) {
      await store.addCustomRole(payload)
    } else if (editingRoleId.value) {
      await store.editRole(editingRoleId.value, payload)
    }
    cancelRoleEdit()
  } catch {
    /* surfaced via store.error */
  }
}

async function confirmDeleteRole(role: Role): Promise<void> {
  if (role.type === 'system') return
  const ok = window.confirm(`Supprimer le rôle "${role.name}" ? Les membres qui l'utilisent perdront ce rôle.`)
  if (!ok) return
  try {
    await store.removeRole(role.id)
  } catch {
    /* surfaced */
  }
}

/**
 * Amorce `/roles` sur un projet vierge (6 rôles système + 2 customs par
 * défaut). CTA affiché tant que la collection est vide.
 */
async function seedRoles(): Promise<void> {
  try {
    await store.seedRolesAction()
  } catch {
    /* surfaced via store.error */
  }
}

// ---------------------------------------------------------------------------
// Closure periods — list + add form
// ---------------------------------------------------------------------------

interface ClosureDraft {
  name: string
  startDate: string
  endDate: string
  type: 'holiday' | 'custom'
}

const CLOSURE_TYPE_OPTIONS: readonly { value: 'holiday' | 'custom'; label: string }[] = [
  { value: 'holiday', label: 'Vacances scolaires' },
  { value: 'custom', label: 'Custom' },
] as const

const isAddingClosure = ref(false)
const closureDraft = ref<ClosureDraft>({
  name: '',
  startDate: '',
  endDate: '',
  type: 'holiday',
})
const closureError = ref<string | null>(null)

function startAddClosure(): void {
  isAddingClosure.value = true
  closureDraft.value = { name: '', startDate: '', endDate: '', type: 'holiday' }
  closureError.value = null
}

function cancelClosureAdd(): void {
  isAddingClosure.value = false
  closureError.value = null
}

function validateClosureDraft(): boolean {
  const { name, startDate, endDate } = closureDraft.value
  if (!name.trim()) {
    closureError.value = 'Nom requis'
    return false
  }
  if (!startDate || !endDate) {
    closureError.value = 'Dates de début et fin requises'
    return false
  }
  if (new Date(startDate) > new Date(endDate)) {
    closureError.value = 'La date de fin doit être ≥ date de début'
    return false
  }
  closureError.value = null
  return true
}

async function commitClosure(): Promise<void> {
  if (!validateClosureDraft()) return
  try {
    await store.addClosurePeriod({
      name: closureDraft.value.name.trim(),
      startDate: closureDraft.value.startDate,
      endDate: closureDraft.value.endDate,
      type: closureDraft.value.type,
    })
    cancelClosureAdd()
  } catch {
    /* surfaced */
  }
}

async function confirmDeleteClosure(id: string, name: string): Promise<void> {
  const ok = window.confirm(`Supprimer la closure period "${name}" ?`)
  if (!ok) return
  try {
    await store.removeClosurePeriod(id)
  } catch {
    /* surfaced */
  }
}

// ---------------------------------------------------------------------------
// Admin team — invite dialog + remove action (v1 mock, no Firestore writes)
// ---------------------------------------------------------------------------

const isInviteDialogOpen = ref(false)
const inviteForm = ref({ email: '' })
const inviteError = ref<string | null>(null)

function openInviteDialog(): void {
  inviteForm.value = { email: '' }
  inviteError.value = null
  isInviteDialogOpen.value = true
}

function closeInviteDialog(): void {
  isInviteDialogOpen.value = false
  inviteError.value = null
}

function validateInvite(): boolean {
  const email = inviteForm.value.email.trim()
  if (!email) {
    inviteError.value = 'Email requis'
    return false
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    inviteError.value = 'Email invalide'
    return false
  }
  inviteError.value = null
  return true
}

async function submitInvite(): Promise<void> {
  if (!validateInvite()) return
  try {
    await store.inviteAdminAction({ email: inviteForm.value.email.trim() })
    closeInviteDialog()
  } catch {
    /* surfaced via store.error */
  }
}

async function confirmRemoveAdmin(uid: string, name: string): Promise<void> {
  const ok = window.confirm(
    `Retirer ${name} de l'équipe admin ? L'utilisateur perdra l'accès admin (mais conservera ses autres rôles).`,
  )
  if (!ok) return
  try {
    await store.removeAdminAction(uid)
  } catch {
    /* surfaced */
  }
}

async function confirmCancelInvitation(id: string, email: string): Promise<void> {
  const ok = window.confirm(
    `Annuler l'invitation de ${email} ? Le lien de sign-in ne fonctionnera plus.`,
  )
  if (!ok) return
  try {
    await store.cancelInvitationAction(id)
  } catch {
    /* surfaced */
  }
}

// ---------------------------------------------------------------------------
// Manage roles dialog (admin team) — gestion cumulative des rôles app sur
// un user existant. `admin` est forcé présent (la révocation passe par
// "Retirer", qui appellera la callable dédiée à terme).
//
// Rôles app gérables ici (cf. docs/firebase.md /users.roles) :
//   - `admin`      : accès complet admin (immuable depuis cette UI)
//   - `coach`      : scope coach via /users.teamIds
//   - `official`   : capacité officiel (lié à /members.officialLevel côté métier)
//   - `treasurer`  : marque les cotisations comme payées (callable serveur
//                    `markDuePaid` ; wrapper TS : `markCotisationPaid`) ET
//                    peut enregistrer un montant partiel (arrangement comité
//                    in extremis) — capability réservée à `rootAdmin` /
//                    `treasurer`, cf. `assertCanRecordPartial` côté Function.
//
// Volontairement absents : `player`, `parent` — gérés par d'autres flows
// (création membre, ajout tuteur).
// ---------------------------------------------------------------------------

interface RolesDialogState {
  uid: string
  displayName: string
  email: string
  admin: boolean
  coach: boolean
  official: boolean
  treasurer: boolean
  /** Autres rôles préservés à la sauvegarde (ex. `'parent'`, `'player'`). */
  preservedRoles: string[]
}

const rolesDialogOpen = ref(false)
const rolesDialogTarget = ref<RolesDialogState | null>(null)
const rolesDialogError = ref<string | null>(null)

const MANAGED_ROLES = ['admin', 'coach', 'official', 'treasurer'] as const
type ManagedRole = typeof MANAGED_ROLES[number]

function openRolesDialog(admin: {
  id: string
  displayName: string
  email: string
  roles: string[]
}): void {
  const has = (r: ManagedRole): boolean => admin.roles.includes(r)
  const preserved = admin.roles.filter(
    (r) => !MANAGED_ROLES.includes(r as ManagedRole),
  )
  rolesDialogTarget.value = {
    uid: admin.id,
    displayName: admin.displayName,
    email: admin.email,
    admin: true, // toujours forcé true depuis cette UI
    coach: has('coach'),
    official: has('official'),
    treasurer: has('treasurer'),
    preservedRoles: preserved,
  }
  rolesDialogError.value = null
  rolesDialogOpen.value = true
}

function closeRolesDialog(): void {
  rolesDialogOpen.value = false
  rolesDialogTarget.value = null
  rolesDialogError.value = null
}

async function submitRolesDialog(): Promise<void> {
  const target = rolesDialogTarget.value
  if (!target) return
  const next: string[] = []
  // `admin` toujours présent — on ne propose pas la révocation via cette UI.
  next.push('admin')
  if (target.coach) next.push('coach')
  if (target.official) next.push('official')
  if (target.treasurer) next.push('treasurer')
  // Préserve les rôles non gérés ici (parent, player, futurs ajouts).
  for (const r of target.preservedRoles) {
    if (!next.includes(r)) next.push(r)
  }
  rolesDialogError.value = null
  try {
    await store.updateAdminRoles(target.uid, next)
    closeRolesDialog()
  } catch (e: unknown) {
    rolesDialogError.value =
      e instanceof Error ? e.message : 'Erreur lors de la mise à jour des rôles'
  }
}

// ---------------------------------------------------------------------------
// Categories — référentiel /categories (cf. docs/firebase.md + docs/main.md).
// Lazy-load à l'ouverture de la section (cf. watcher en bas du script).
// ---------------------------------------------------------------------------

const categoriesStore = useCategoriesStore()

/** Toggle UI : par défaut on cache les archivées. */
const showArchivedCategories = ref(false)

/**
 * Liste filtrée affichée. `categoriesStore.categories` est déjà triée
 * (`displayOrder asc, minAge asc nulls last, name asc`) — on filtre
 * uniquement sur `active` ici.
 */
const visibleCategories = computed<Category[]>(() => {
  if (showArchivedCategories.value) return categoriesStore.categories
  return categoriesStore.categories.filter((c) => c.active)
})

const archivedCategoriesCount = computed<number>(() => {
  return categoriesStore.categories.filter((c) => !c.active).length
})

/** Texte affiché dans la pill âge — aligné sur docs/main.md. */
function categoryAgeLabel(c: { minAge: number | null; maxAge: number | null }): string {
  if (c.minAge === null && c.maxAge === null) return 'Ouvert'
  if (c.minAge !== null && c.maxAge === null) return `${c.minAge} ans+`
  if (c.minAge === null && c.maxAge !== null) return `≤ ${c.maxAge} ans`
  if (c.minAge === c.maxAge) return `${c.minAge} ans`
  return `${c.minAge}-${c.maxAge} ans`
}

interface CategoryDraft {
  name: string
  hasMin: boolean
  minAge: number | null
  hasMax: boolean
  maxAge: number | null
  /** Vide → auto-assign en queue côté repo. */
  displayOrder: number | null
}

function emptyCategoryDraft(): CategoryDraft {
  return {
    name: '',
    hasMin: true,
    minAge: 14,
    hasMax: true,
    maxAge: 16,
    displayOrder: null,
  }
}

const isAddingCategory = ref(false)
const editingCategoryId = ref<string | null>(null)
const categoryDraft = ref<CategoryDraft>(emptyCategoryDraft())
const categoryError = ref<string | null>(null)

/** Banner inline : la section Categories n'utilise pas `lastSaved` du store. */
const categoryFlash = ref<'created' | 'updated' | 'archived' | 'unarchived' | 'deleted' | null>(null)

function setCategoryFlash(kind: NonNullable<typeof categoryFlash.value>): void {
  categoryFlash.value = kind
  window.setTimeout(() => {
    if (categoryFlash.value === kind) categoryFlash.value = null
  }, 3000)
}

const categoryFlashMessage = computed<string | null>(() => {
  switch (categoryFlash.value) {
    case 'created':
      return 'Catégorie créée'
    case 'updated':
      return 'Catégorie mise à jour'
    case 'archived':
      return 'Catégorie archivée'
    case 'unarchived':
      return 'Catégorie réactivée'
    case 'deleted':
      return 'Catégorie supprimée'
    default:
      return null
  }
})

function startAddCategory(): void {
  isAddingCategory.value = true
  editingCategoryId.value = null
  categoryDraft.value = emptyCategoryDraft()
  categoryError.value = null
}

function startEditCategory(c: Category): void {
  isAddingCategory.value = false
  editingCategoryId.value = c.id
  categoryDraft.value = {
    name: c.name,
    hasMin: c.minAge !== null,
    minAge: c.minAge,
    hasMax: c.maxAge !== null,
    maxAge: c.maxAge,
    displayOrder: c.displayOrder,
  }
  categoryError.value = null
}

function cancelCategoryEdit(): void {
  isAddingCategory.value = false
  editingCategoryId.value = null
  categoryError.value = null
}

/** Aperçu live de la pill âge pendant la saisie. */
const categoryDraftPreview = computed<{ minAge: number | null; maxAge: number | null }>(() => {
  return {
    minAge: categoryDraft.value.hasMin ? categoryDraft.value.minAge : null,
    maxAge: categoryDraft.value.hasMax ? categoryDraft.value.maxAge : null,
  }
})

function validateCategoryDraft(): boolean {
  const name = categoryDraft.value.name.trim()
  if (!name) {
    categoryError.value = 'Nom requis'
    return false
  }
  if (name.length > 32) {
    categoryError.value = 'Maximum 32 caractères'
    return false
  }
  const min = categoryDraft.value.hasMin ? categoryDraft.value.minAge : null
  const max = categoryDraft.value.hasMax ? categoryDraft.value.maxAge : null
  if (categoryDraft.value.hasMin && (min === null || Number.isNaN(min))) {
    categoryError.value = 'Borne min requise (ou décochez "Pas de borne min")'
    return false
  }
  if (categoryDraft.value.hasMax && (max === null || Number.isNaN(max))) {
    categoryError.value = 'Borne max requise (ou décochez "Pas de borne max")'
    return false
  }
  if (min !== null && (min < 0 || min > 120)) {
    categoryError.value = 'Borne min entre 0 et 120'
    return false
  }
  if (max !== null && (max < 0 || max > 120)) {
    categoryError.value = 'Borne max entre 0 et 120'
    return false
  }
  if (min !== null && max !== null && min > max) {
    categoryError.value = 'Borne min > borne max'
    return false
  }
  categoryError.value = null
  return true
}

async function commitCategory(): Promise<void> {
  if (!validateCategoryDraft()) return
  const min = categoryDraft.value.hasMin ? categoryDraft.value.minAge : null
  const max = categoryDraft.value.hasMax ? categoryDraft.value.maxAge : null
  const name = categoryDraft.value.name.trim()
  const orderRaw = categoryDraft.value.displayOrder
  if (isAddingCategory.value) {
    const id = await categoriesStore.create({
      name,
      minAge: min,
      maxAge: max,
      ...(orderRaw !== null ? { displayOrder: orderRaw } : {}),
    })
    if (id !== null) {
      cancelCategoryEdit()
      setCategoryFlash('created')
    }
  } else if (editingCategoryId.value) {
    const ok = await categoriesStore.update(editingCategoryId.value, {
      name,
      minAge: min,
      maxAge: max,
      ...(orderRaw !== null ? { displayOrder: orderRaw } : {}),
    })
    if (ok) {
      cancelCategoryEdit()
      setCategoryFlash('updated')
    }
  }
}

async function toggleCategoryArchive(c: Category): Promise<void> {
  if (c.active) {
    await categoriesStore.archive(c.id)
    if (categoriesStore.error === null) setCategoryFlash('archived')
  } else {
    await categoriesStore.unarchive(c.id)
    if (categoriesStore.error === null) setCategoryFlash('unarchived')
  }
}

// --- Delete dialog --------------------------------------------------------

const deleteDialogTarget = ref<Category | null>(null)
const deleteDialogUsageCount = ref<number>(0)
const deleteDialogLoading = ref(false)

const isDeleteDialogOpen = computed<boolean>({
  get: () => deleteDialogTarget.value !== null,
  set: (v: boolean) => {
    if (!v) deleteDialogTarget.value = null
  },
})

async function openDeleteCategoryDialog(c: Category): Promise<void> {
  deleteDialogTarget.value = c
  deleteDialogLoading.value = true
  try {
    deleteDialogUsageCount.value = await categoriesStore.refreshUsageCount(c.id)
  } catch {
    // Si le count échoue on assume "utilisée" pour ne pas autoriser une
    // suppression sur la base d'un état inconnu.
    deleteDialogUsageCount.value = -1
  } finally {
    deleteDialogLoading.value = false
  }
}

function closeDeleteCategoryDialog(): void {
  deleteDialogTarget.value = null
}

async function confirmDeleteCategory(): Promise<void> {
  const target = deleteDialogTarget.value
  if (!target) return
  if (deleteDialogUsageCount.value !== 0) return
  const ok = await categoriesStore.remove(target.id)
  if (ok) {
    closeDeleteCategoryDialog()
    setCategoryFlash('deleted')
  }
}

async function archiveFromDeleteDialog(): Promise<void> {
  const target = deleteDialogTarget.value
  if (!target) return
  await categoriesStore.archive(target.id)
  if (categoriesStore.error === null) {
    closeDeleteCategoryDialog()
    setCategoryFlash('archived')
  }
}

// ---------------------------------------------------------------------------
// Tags — référentiel /tags (cf. docs/firebase.md + docs/main.md).
// Pattern miroir de Categories en plus simple (pas de min/max age, juste
// name + color). Lazy-load à l'ouverture de la section (cf. watcher en bas).
// ---------------------------------------------------------------------------

const tagsStore = useTagsStore()

/** Palette bornée — alignée sur les variants du composant Pill. */
const TAG_PALETTE: ReadonlyArray<{ value: TagColor; label: string; bg: string; text: string }> = [
  { value: 'emerald', label: 'Vert', bg: 'bg-emerald-50', text: 'text-emerald-700' },
  { value: 'sky', label: 'Bleu', bg: 'bg-sky-50', text: 'text-sky-700' },
  { value: 'amber', label: 'Ambre', bg: 'bg-amber-50', text: 'text-amber-700' },
  { value: 'rose', label: 'Rose', bg: 'bg-rose-50', text: 'text-rose-700' },
  { value: 'violet', label: 'Violet', bg: 'bg-violet-50', text: 'text-violet-700' },
  { value: 'slate', label: 'Gris', bg: 'bg-slate-100', text: 'text-slate-600' },
] as const

const showArchivedTags = ref(false)

const visibleTags = computed<Tag[]>(() => {
  if (showArchivedTags.value) return tagsStore.tags
  return tagsStore.tags.filter((t) => t.active)
})

const archivedTagsCount = computed<number>(() => {
  return tagsStore.tags.filter((t) => !t.active).length
})

interface TagDraft {
  name: string
  color: TagColor
  /** Vide → auto-assign en queue côté repo. */
  displayOrder: number | null
}

function emptyTagDraft(): TagDraft {
  return {
    name: '',
    color: 'slate',
    displayOrder: null,
  }
}

const isAddingTag = ref(false)
const editingTagId = ref<string | null>(null)
const tagDraft = ref<TagDraft>(emptyTagDraft())
const tagError = ref<string | null>(null)

const tagFlash = ref<'created' | 'updated' | 'archived' | 'unarchived' | 'deleted' | null>(null)

function setTagFlash(kind: NonNullable<typeof tagFlash.value>): void {
  tagFlash.value = kind
  window.setTimeout(() => {
    if (tagFlash.value === kind) tagFlash.value = null
  }, 3000)
}

const tagFlashMessage = computed<string | null>(() => {
  switch (tagFlash.value) {
    case 'created':
      return 'Tag créé'
    case 'updated':
      return 'Tag mis à jour'
    case 'archived':
      return 'Tag archivé'
    case 'unarchived':
      return 'Tag réactivé'
    case 'deleted':
      return 'Tag supprimé'
    default:
      return null
  }
})

function startAddTag(): void {
  isAddingTag.value = true
  editingTagId.value = null
  tagDraft.value = emptyTagDraft()
  tagError.value = null
}

function startEditTag(t: Tag): void {
  isAddingTag.value = false
  editingTagId.value = t.id
  tagDraft.value = {
    name: t.name,
    color: t.color,
    displayOrder: t.displayOrder,
  }
  tagError.value = null
}

function cancelTagEdit(): void {
  isAddingTag.value = false
  editingTagId.value = null
  tagError.value = null
}

function validateTagDraft(): boolean {
  const name = tagDraft.value.name.trim()
  if (!name) {
    tagError.value = 'Nom requis'
    return false
  }
  if (name.length > 24) {
    tagError.value = 'Maximum 24 caractères'
    return false
  }
  tagError.value = null
  return true
}

async function commitTag(): Promise<void> {
  if (!validateTagDraft()) return
  const name = tagDraft.value.name.trim()
  const color = tagDraft.value.color
  const orderRaw = tagDraft.value.displayOrder
  if (isAddingTag.value) {
    const id = await tagsStore.create({
      name,
      color,
      ...(orderRaw !== null ? { displayOrder: orderRaw } : {}),
    })
    if (id !== null) {
      cancelTagEdit()
      setTagFlash('created')
    }
  } else if (editingTagId.value) {
    const ok = await tagsStore.update(editingTagId.value, {
      name,
      color,
      ...(orderRaw !== null ? { displayOrder: orderRaw } : {}),
    })
    if (ok) {
      cancelTagEdit()
      setTagFlash('updated')
    }
  }
}

async function toggleTagArchive(t: Tag): Promise<void> {
  if (t.active) {
    await tagsStore.archive(t.id)
    if (tagsStore.error === null) setTagFlash('archived')
  } else {
    await tagsStore.unarchive(t.id)
    if (tagsStore.error === null) setTagFlash('unarchived')
  }
}

// --- Tag delete dialog ----------------------------------------------------

const deleteTagDialogTarget = ref<Tag | null>(null)
const deleteTagDialogUsageCount = ref<number>(0)
const deleteTagDialogLoading = ref(false)

const isDeleteTagDialogOpen = computed<boolean>({
  get: () => deleteTagDialogTarget.value !== null,
  set: (v: boolean) => {
    if (!v) deleteTagDialogTarget.value = null
  },
})

async function openDeleteTagDialog(t: Tag): Promise<void> {
  deleteTagDialogTarget.value = t
  deleteTagDialogLoading.value = true
  try {
    deleteTagDialogUsageCount.value = await tagsStore.refreshUsageCount(t.id)
  } catch {
    // Si le count échoue, on assume "utilisé" pour ne pas autoriser une
    // suppression sur la base d'un état inconnu.
    deleteTagDialogUsageCount.value = -1
  } finally {
    deleteTagDialogLoading.value = false
  }
}

function closeDeleteTagDialog(): void {
  deleteTagDialogTarget.value = null
}

async function confirmDeleteTag(): Promise<void> {
  const target = deleteTagDialogTarget.value
  if (!target) return
  if (deleteTagDialogUsageCount.value !== 0) return
  const ok = await tagsStore.remove(target.id)
  if (ok) {
    closeDeleteTagDialog()
    setTagFlash('deleted')
  }
}

async function archiveFromDeleteTagDialog(): Promise<void> {
  const target = deleteTagDialogTarget.value
  if (!target) return
  await tagsStore.archive(target.id)
  if (tagsStore.error === null) {
    closeDeleteTagDialog()
    setTagFlash('archived')
  }
}

// ---------------------------------------------------------------------------
// Types de cotisation — référentiel /cotisations (cf. docs/firebase.md +
// docs/main.md). Pattern miroir de Tags : draft local, dialog d'édition,
// archive vs delete avec usage count. Lazy-load à l'ouverture (cf. watcher
// en bas du script).
//
// NB sémantique : la collection Firestore reste `'cotisations'` (string
// inchangée), mais côté code on parle de `CotisationType` (template de
// pricing) — le mot "cotisation" est réservé aux factures membres
// (ex-`Due`, géré par un autre module).
// ---------------------------------------------------------------------------

const cotisationTypesStore = useCotisationTypesStore()

const showArchivedCotisations = ref(false)

const visibleCotisations = computed<CotisationType[]>(() => {
  if (showArchivedCotisations.value) return cotisationTypesStore.cotisationTypes
  return cotisationTypesStore.cotisationTypes.filter((c) => c.active)
})

const archivedCotisationsCount = computed<number>(() => {
  return cotisationTypesStore.cotisationTypes.filter((c) => !c.active).length
})

interface CotisationTypeDraft {
  name: string
  description: string
  price: number
  /** Vide → auto-assign en queue côté repo. */
  displayOrder: number | null
}

function emptyCotisationTypeDraft(): CotisationTypeDraft {
  return {
    name: '',
    description: '',
    price: 0,
    displayOrder: null,
  }
}

const isAddingCotisationType = ref(false)
const editingCotisationId = ref<string | null>(null)
const cotisationDraft = ref<CotisationTypeDraft>(emptyCotisationTypeDraft())
const cotisationError = ref<string | null>(null)

const cotisationFlash = ref<
  'created' | 'updated' | 'archived' | 'unarchived' | 'deleted' | null
>(null)

function setCotisationFlash(kind: NonNullable<typeof cotisationFlash.value>): void {
  cotisationFlash.value = kind
  window.setTimeout(() => {
    if (cotisationFlash.value === kind) cotisationFlash.value = null
  }, 3000)
}

const cotisationFlashMessage = computed<string | null>(() => {
  switch (cotisationFlash.value) {
    case 'created':
      return 'Type de cotisation créé'
    case 'updated':
      return 'Type de cotisation mis à jour'
    case 'archived':
      return 'Type de cotisation archivé'
    case 'unarchived':
      return 'Type de cotisation réactivé'
    case 'deleted':
      return 'Type de cotisation supprimé'
    default:
      return null
  }
})

const isCotisationTypeDialogOpen = computed<boolean>({
  get: () => isAddingCotisationType.value || editingCotisationId.value !== null,
  set: (v: boolean) => {
    if (!v) cancelCotisationTypeEdit()
  },
})

function startAddCotisationType(): void {
  isAddingCotisationType.value = true
  editingCotisationId.value = null
  cotisationDraft.value = emptyCotisationTypeDraft()
  cotisationError.value = null
}

function startEditCotisationType(c: CotisationType): void {
  isAddingCotisationType.value = false
  editingCotisationId.value = c.id
  cotisationDraft.value = {
    name: c.name,
    description: c.description,
    price: c.price,
    displayOrder: c.displayOrder,
  }
  cotisationError.value = null
}

function cancelCotisationTypeEdit(): void {
  isAddingCotisationType.value = false
  editingCotisationId.value = null
  cotisationError.value = null
}

function validateCotisationTypeDraft(): boolean {
  const name = cotisationDraft.value.name.trim()
  if (!name) {
    cotisationError.value = 'Nom requis'
    return false
  }
  if (cotisationDraft.value.price < 0) {
    cotisationError.value = 'Le prix doit être >= 0'
    return false
  }
  cotisationError.value = null
  return true
}

async function commitCotisationType(): Promise<void> {
  if (!validateCotisationTypeDraft()) return
  const name = cotisationDraft.value.name.trim()
  const description = cotisationDraft.value.description.trim()
  const price = cotisationDraft.value.price
  const orderRaw = cotisationDraft.value.displayOrder
  if (isAddingCotisationType.value) {
    const id = await cotisationTypesStore.create({
      name,
      description,
      price,
      ...(orderRaw !== null ? { displayOrder: orderRaw } : {}),
    })
    if (id !== null) {
      cancelCotisationTypeEdit()
      setCotisationFlash('created')
    }
  } else if (editingCotisationId.value) {
    const ok = await cotisationTypesStore.update(editingCotisationId.value, {
      name,
      description,
      price,
      ...(orderRaw !== null ? { displayOrder: orderRaw } : {}),
    })
    if (ok) {
      cancelCotisationTypeEdit()
      setCotisationFlash('updated')
    }
  }
}

async function toggleCotisationTypeArchive(c: CotisationType): Promise<void> {
  if (c.active) {
    await cotisationTypesStore.archive(c.id)
    if (cotisationTypesStore.error === null) setCotisationFlash('archived')
  } else {
    await cotisationTypesStore.unarchive(c.id)
    if (cotisationTypesStore.error === null) setCotisationFlash('unarchived')
  }
}

// --- Type-de-cotisation delete dialog ------------------------------------

const deleteCotisationTypeDialogTarget = ref<CotisationType | null>(null)
const deleteCotisationTypeDialogUsageCount = ref<number>(0)
const deleteCotisationTypeDialogLoading = ref(false)

const isDeleteCotisationTypeDialogOpen = computed<boolean>({
  get: () => deleteCotisationTypeDialogTarget.value !== null,
  set: (v: boolean) => {
    if (!v) deleteCotisationTypeDialogTarget.value = null
  },
})

async function openDeleteCotisationTypeDialog(c: CotisationType): Promise<void> {
  deleteCotisationTypeDialogTarget.value = c
  deleteCotisationTypeDialogLoading.value = true
  try {
    deleteCotisationTypeDialogUsageCount.value = await cotisationTypesStore.refreshUsageCount(c.id)
  } catch {
    // Si le count échoue, on assume "utilisée" pour ne pas autoriser une
    // suppression sur la base d'un état inconnu.
    deleteCotisationTypeDialogUsageCount.value = -1
  } finally {
    deleteCotisationTypeDialogLoading.value = false
  }
}

function closeDeleteCotisationTypeDialog(): void {
  deleteCotisationTypeDialogTarget.value = null
}

async function confirmDeleteCotisationType(): Promise<void> {
  const target = deleteCotisationTypeDialogTarget.value
  if (!target) return
  if (deleteCotisationTypeDialogUsageCount.value !== 0) return
  const ok = await cotisationTypesStore.remove(target.id)
  if (ok) {
    closeDeleteCotisationTypeDialog()
    setCotisationFlash('deleted')
  }
}

async function archiveFromDeleteCotisationTypeDialog(): Promise<void> {
  const target = deleteCotisationTypeDialogTarget.value
  if (!target) return
  await cotisationTypesStore.archive(target.id)
  if (cotisationTypesStore.error === null) {
    closeDeleteCotisationTypeDialog()
    setCotisationFlash('archived')
  }
}

// ---------------------------------------------------------------------------
// License types — référentiel /licenseTypes (cf. docs/firebase.md +
// docs/main.md "Licences"). Affichage groupé par rôle (4 fieldsets), même
// dialog création/édition. Pattern miroir des types de cotisation. Lazy-load
// à l'ouverture de la section (cf. watcher en bas du script).
// ---------------------------------------------------------------------------

const licenseTypesStore = useLicenseTypesStore()

const showArchivedLicenseTypes = ref(false)

const archivedLicenseTypesCount = computed<number>(() => {
  return licenseTypesStore.licenseTypes.filter((t) => !t.active).length
})

/**
 * Liste à afficher pour un rôle donné, filtrée selon le toggle "afficher
 * archivées". Les fieldsets template appellent ce computed une fois par rôle.
 */
function visibleLicenseTypesFor(role: LicenseRole): LicenseType[] {
  const all = licenseTypesStore.groupedByRole[role]
  if (showArchivedLicenseTypes.value) return all
  return all.filter((t) => t.active)
}

const LICENSE_ROLES: readonly LicenseRole[] = [
  'player',
  'official',
  'coach',
  'referee',
]

const LICENSE_ROLE_LABEL: Record<LicenseRole, string> = {
  player: 'Joueur',
  official: 'Officiel',
  coach: 'Coach',
  referee: 'Arbitre',
}

const LICENSE_ROLE_OPTIONS = LICENSE_ROLES.map((role) => ({
  label: LICENSE_ROLE_LABEL[role],
  value: role,
}))

interface LicenseTypeDraft {
  role: LicenseRole
  /**
   * Niveau numérique pour les rôles avec niveau (official/coach/referee).
   * Pour `player`, ce champ est ignoré et persisté à `null` — cf. règle
   * docs/main.md "Licences" (seuls coach/officiel/arbitre ont un niveau).
   */
  level: number
  name: string
  fee: number
  /** Vide → auto-assign en queue côté repo. */
  displayOrder: number | null
}

function emptyLicenseTypeDraft(role: LicenseRole = 'player'): LicenseTypeDraft {
  return {
    role,
    level: 1,
    name: '',
    fee: 0,
    displayOrder: null,
  }
}

/** Le rôle actuellement sélectionné dans la draft attend un niveau. */
const draftRoleRequiresLevel = computed<boolean>(() => {
  return licenseTypesStore.roleRequiresLevel(licenseTypeDraft.value.role)
})

const isAddingLicenseType = ref(false)
const editingLicenseTypeId = ref<string | null>(null)
const licenseTypeDraft = ref<LicenseTypeDraft>(emptyLicenseTypeDraft())
const licenseTypeError = ref<string | null>(null)

const licenseTypeFlash = ref<
  'created' | 'updated' | 'archived' | 'unarchived' | 'deleted' | null
>(null)

function setLicenseTypeFlash(
  kind: NonNullable<typeof licenseTypeFlash.value>,
): void {
  licenseTypeFlash.value = kind
  window.setTimeout(() => {
    if (licenseTypeFlash.value === kind) licenseTypeFlash.value = null
  }, 3000)
}

const licenseTypeFlashMessage = computed<string | null>(() => {
  switch (licenseTypeFlash.value) {
    case 'created':
      return 'Type de licence créé'
    case 'updated':
      return 'Type de licence mis à jour'
    case 'archived':
      return 'Type de licence archivé'
    case 'unarchived':
      return 'Type de licence réactivé'
    case 'deleted':
      return 'Type de licence supprimé'
    default:
      return null
  }
})

const isLicenseTypeDialogOpen = computed<boolean>({
  get: () => isAddingLicenseType.value || editingLicenseTypeId.value !== null,
  set: (v: boolean) => {
    if (!v) cancelLicenseTypeEdit()
  },
})

function startAddLicenseType(role: LicenseRole = 'player'): void {
  isAddingLicenseType.value = true
  editingLicenseTypeId.value = null
  licenseTypeDraft.value = emptyLicenseTypeDraft(role)
  licenseTypeError.value = null
}

function startEditLicenseType(t: LicenseType): void {
  isAddingLicenseType.value = false
  editingLicenseTypeId.value = t.id
  licenseTypeDraft.value = {
    role: t.role,
    level: t.level ?? 1,
    name: t.name,
    fee: t.fee,
    displayOrder: t.displayOrder,
  }
  licenseTypeError.value = null
}

function cancelLicenseTypeEdit(): void {
  isAddingLicenseType.value = false
  editingLicenseTypeId.value = null
  licenseTypeError.value = null
}

function validateLicenseTypeDraft(): boolean {
  const name = licenseTypeDraft.value.name.trim()
  if (!name) {
    licenseTypeError.value = 'Nom requis'
    return false
  }
  if (licenseTypeDraft.value.fee < 0) {
    licenseTypeError.value = 'Le prix doit être >= 0'
    return false
  }
  if (draftRoleRequiresLevel.value && licenseTypeDraft.value.level < 0) {
    licenseTypeError.value = 'Le niveau doit être >= 0'
    return false
  }
  // Unicité (role, level) pour les rôles à niveau — vérifiée côté store
  // aussi, doublée ici pour un message d'erreur immédiat avant l'appel async.
  const level = draftRoleRequiresLevel.value
    ? licenseTypeDraft.value.level
    : null
  const conflictId = licenseTypesStore.findConflict(
    licenseTypeDraft.value.role,
    level,
    editingLicenseTypeId.value ?? undefined,
  )
  if (conflictId !== null) {
    licenseTypeError.value =
      'Un type de licence existe déjà pour ce rôle et ce niveau.'
    return false
  }
  licenseTypeError.value = null
  return true
}

async function commitLicenseType(): Promise<void> {
  if (!validateLicenseTypeDraft()) return
  const name = licenseTypeDraft.value.name.trim()
  const fee = licenseTypeDraft.value.fee
  const level = draftRoleRequiresLevel.value
    ? licenseTypeDraft.value.level
    : null
  const orderRaw = licenseTypeDraft.value.displayOrder
  if (isAddingLicenseType.value) {
    const id = await licenseTypesStore.create({
      role: licenseTypeDraft.value.role,
      level,
      name,
      fee,
      ...(orderRaw !== null ? { displayOrder: orderRaw } : {}),
    })
    if (id !== null) {
      cancelLicenseTypeEdit()
      setLicenseTypeFlash('created')
    } else if (licenseTypesStore.error) {
      licenseTypeError.value = licenseTypesStore.error
    }
  } else if (editingLicenseTypeId.value) {
    const ok = await licenseTypesStore.update(editingLicenseTypeId.value, {
      role: licenseTypeDraft.value.role,
      level,
      name,
      fee,
      ...(orderRaw !== null ? { displayOrder: orderRaw } : {}),
    })
    if (ok) {
      cancelLicenseTypeEdit()
      setLicenseTypeFlash('updated')
    } else if (licenseTypesStore.error) {
      licenseTypeError.value = licenseTypesStore.error
    }
  }
}

async function toggleLicenseTypeArchive(t: LicenseType): Promise<void> {
  if (t.active) {
    await licenseTypesStore.archive(t.id)
    if (licenseTypesStore.error === null) setLicenseTypeFlash('archived')
  } else {
    await licenseTypesStore.unarchive(t.id)
    if (licenseTypesStore.error === null) setLicenseTypeFlash('unarchived')
  }
}

// --- License type delete dialog ------------------------------------------

const deleteLicenseTypeDialogTarget = ref<LicenseType | null>(null)

const isDeleteLicenseTypeDialogOpen = computed<boolean>({
  get: () => deleteLicenseTypeDialogTarget.value !== null,
  set: (v: boolean) => {
    if (!v) deleteLicenseTypeDialogTarget.value = null
  },
})

function openDeleteLicenseTypeDialog(t: LicenseType): void {
  deleteLicenseTypeDialogTarget.value = t
}

function closeDeleteLicenseTypeDialog(): void {
  deleteLicenseTypeDialogTarget.value = null
}

async function confirmDeleteLicenseType(): Promise<void> {
  const target = deleteLicenseTypeDialogTarget.value
  if (!target) return
  const ok = await licenseTypesStore.remove(target.id)
  if (ok) {
    closeDeleteLicenseTypeDialog()
    setLicenseTypeFlash('deleted')
  }
}

// ---------------------------------------------------------------------------
// Match types — CRUD (Settings → Saison / Compétition → Match types)
// ---------------------------------------------------------------------------
//
// Le référentiel `/matchTypes` est édité directement depuis Settings (la route
// `/match-types` a été supprimée — cf. `apps/web/CLAUDE.md`). Les types
// définissent les besoins officiels (`homeOfficialRequirements`) et la taille
// de court requise pour chaque type de compétition (CSJC, AFBB, Amical…).
//
// Pattern aligné sur les sections Catégories / License types : dialog unique
// `create | edit`, validation client minimale (regex hex pour la couleur,
// `awayOfficialCount >= 0`), garde-fou sur la suppression (le repo refuse si
// au moins un booking référence le type — l'UI suggère alors la désactivation).

const matchTypesStore = useMatchTypesStore()

const COURT_SIZE_OPTIONS: { value: CourtSize; label: string }[] = [
  { value: 'small', label: 'Petit' },
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Grand' },
]

const COURT_SIZE_LABEL: Record<CourtSize, string> = {
  small: 'Petit',
  normal: 'Normal',
  large: 'Grand',
}

/**
 * Mode du dialog Match type : `null` = fermé. Inline ici (pas de composant
 * extrait) pour rester aligné sur le pattern des autres dialogs Settings —
 * la logique fait <200 lignes au total.
 */
type MatchTypeDialogMode = 'create' | 'edit'

interface MatchTypeDraft {
  id: string | null
  name: string
  requiredCourtSize: CourtSize
  homeOfficialRequirements: OfficialRequirement[]
  awayOfficialCount: number
  color: string
  active: boolean
}

function emptyMatchTypeDraft(): MatchTypeDraft {
  return {
    id: null,
    name: '',
    requiredCourtSize: 'normal',
    homeOfficialRequirements: [],
    awayOfficialCount: 0,
    color: '#10b981',
    active: true,
  }
}

const matchTypeDialogMode = ref<MatchTypeDialogMode | null>(null)
const matchTypeDraft = ref<MatchTypeDraft>(emptyMatchTypeDraft())
const matchTypeError = ref<string | null>(null)

const isMatchTypeDialogOpen = computed<boolean>({
  get: () => matchTypeDialogMode.value !== null,
  set: (v: boolean) => {
    if (!v) {
      matchTypeDialogMode.value = null
      matchTypeError.value = null
    }
  },
})

function openCreateMatchTypeDialog(): void {
  matchTypeDraft.value = emptyMatchTypeDraft()
  matchTypeError.value = null
  matchTypeDialogMode.value = 'create'
}

function openEditMatchTypeDialog(mt: MatchType): void {
  matchTypeDraft.value = {
    id: mt.id,
    name: mt.name,
    requiredCourtSize: mt.requiredCourtSize,
    // Copie défensive pour ne pas muter le state du store en cours d'édition.
    homeOfficialRequirements: mt.homeOfficialRequirements.map((r) => ({
      level: r.level,
      count: r.count,
    })),
    awayOfficialCount: mt.awayOfficialCount,
    color: mt.color,
    active: mt.active,
  }
  matchTypeError.value = null
  matchTypeDialogMode.value = 'edit'
}

function closeMatchTypeDialog(): void {
  matchTypeDialogMode.value = null
  matchTypeError.value = null
}

function addOfficialRequirement(): void {
  matchTypeDraft.value.homeOfficialRequirements.push({ level: 1, count: 1 })
}

function removeOfficialRequirement(idx: number): void {
  matchTypeDraft.value.homeOfficialRequirements.splice(idx, 1)
}

/** Hex `#RRGGBB` (case-insensitive). 3-digit form refusé pour rester strict. */
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

function validateMatchTypeDraft(d: MatchTypeDraft): string | null {
  const name = d.name.trim()
  if (!name) return 'Le nom est requis.'
  if (!['small', 'normal', 'large'].includes(d.requiredCourtSize)) {
    return 'Taille de court invalide.'
  }
  if (
    typeof d.awayOfficialCount !== 'number'
    || Number.isNaN(d.awayOfficialCount)
    || d.awayOfficialCount < 0
  ) {
    return 'Le nombre d\'officiels away doit être >= 0.'
  }
  for (const r of d.homeOfficialRequirements) {
    if (
      typeof r.level !== 'number'
      || Number.isNaN(r.level)
      || r.level < 0
    ) {
      return 'Niveau d\'officiel invalide (doit être >= 0).'
    }
    if (
      typeof r.count !== 'number'
      || Number.isNaN(r.count)
      || r.count < 1
    ) {
      return 'Quantité d\'officiels invalide (doit être >= 1).'
    }
  }
  if (!HEX_COLOR_RE.test(d.color)) {
    return 'Couleur invalide — format attendu #RRGGBB.'
  }
  return null
}

/**
 * Formatte les exigences home pour l'affichage liste : `[{level:2,count:1},
 * {level:1,count:2}]` → "1× N2 + 2× N1". Renvoie "—" si vide.
 */
function formatOfficialReqs(reqs: OfficialRequirement[]): string {
  if (reqs.length === 0) return '—'
  return reqs.map((r) => `${r.count}× N${r.level}`).join(' + ')
}

const matchTypeFlashMessage = ref<string | null>(null)

function setMatchTypeFlash(
  kind: 'created' | 'updated' | 'deleted' | 'activated' | 'deactivated',
): void {
  const labels: Record<typeof kind, string> = {
    created: 'Type de match créé.',
    updated: 'Type de match mis à jour.',
    deleted: 'Type de match supprimé.',
    activated: 'Type de match activé.',
    deactivated: 'Type de match désactivé.',
  }
  matchTypeFlashMessage.value = labels[kind]
  window.setTimeout(() => {
    if (matchTypeFlashMessage.value === labels[kind]) {
      matchTypeFlashMessage.value = null
    }
  }, 2500)
}

async function commitMatchType(): Promise<void> {
  const draft = matchTypeDraft.value
  const validationError = validateMatchTypeDraft(draft)
  if (validationError) {
    matchTypeError.value = validationError
    return
  }
  const input: MatchTypeInput = {
    name: draft.name.trim(),
    requiredCourtSize: draft.requiredCourtSize,
    homeOfficialRequirements: draft.homeOfficialRequirements.map((r) => ({
      level: r.level,
      count: r.count,
    })),
    awayOfficialCount: draft.awayOfficialCount,
    color: draft.color,
    active: draft.active,
  }
  if (matchTypeDialogMode.value === 'create') {
    const id = await matchTypesStore.create(input)
    if (id !== null) {
      closeMatchTypeDialog()
      setMatchTypeFlash('created')
    } else if (matchTypesStore.error) {
      matchTypeError.value = matchTypesStore.error
    }
  } else if (matchTypeDialogMode.value === 'edit' && draft.id) {
    const ok = await matchTypesStore.update(draft.id, input)
    if (ok) {
      closeMatchTypeDialog()
      setMatchTypeFlash('updated')
    } else if (matchTypesStore.error) {
      matchTypeError.value = matchTypesStore.error
    }
  }
}

async function toggleMatchTypeActive(mt: MatchType): Promise<void> {
  const ok = await matchTypesStore.update(mt.id, { active: !mt.active })
  if (ok) {
    setMatchTypeFlash(mt.active ? 'deactivated' : 'activated')
  }
}

// --- Match type delete dialog --------------------------------------------

const deleteMatchTypeDialogTarget = ref<MatchType | null>(null)

const isDeleteMatchTypeDialogOpen = computed<boolean>({
  get: () => deleteMatchTypeDialogTarget.value !== null,
  set: (v: boolean) => {
    if (!v) deleteMatchTypeDialogTarget.value = null
  },
})

function openDeleteMatchTypeDialog(mt: MatchType): void {
  // Clear toute erreur précédente (ex. tentative de suppression d'un type
  // référencé) pour que le dialog démarre propre.
  matchTypesStore.error = null
  deleteMatchTypeDialogTarget.value = mt
}

function closeDeleteMatchTypeDialog(): void {
  deleteMatchTypeDialogTarget.value = null
}

async function confirmDeleteMatchType(): Promise<void> {
  const target = deleteMatchTypeDialogTarget.value
  if (!target) return
  const ok = await matchTypesStore.remove(target.id)
  if (ok) {
    closeDeleteMatchTypeDialog()
    setMatchTypeFlash('deleted')
  }
  // Si !ok : `matchTypesStore.error` contient le message ("matchType in use…")
  // — le dialog reste ouvert et l'erreur s'affiche dans la card d'avertissement
  // dédiée (cf. template).
}

// ---------------------------------------------------------------------------
// Subscription card — display helpers
// ---------------------------------------------------------------------------

const dateFormatter = new Intl.DateTimeFormat('fr-CH', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

function tsToDate(t: Timestamp | null): Date | null {
  if (!t) return null
  return new Date(t.seconds * 1000)
}

function fmtDate(d: Date | null): string {
  if (!d) return '—'
  return dateFormatter.format(d)
}

function subscriptionPillVariant(status: SubscriptionStatus): 'emerald' | 'sky' | 'amber' | 'rose' {
  switch (status) {
    case 'paid':
      return 'emerald'
    case 'trial':
      return 'sky'
    case 'free_tier':
      return 'amber'
    case 'past_due':
    default:
      return 'rose'
  }
}

// ---------------------------------------------------------------------------
// Saved banner helper (per-section)
// ---------------------------------------------------------------------------

const savedFor = computed<SettingsSection | null>(() => store.lastSaved)

function isSavingThis(section: SettingsSection): boolean {
  return store.savingSection === section
}

function isSavedThis(section: SettingsSection): boolean {
  return savedFor.value === section
}

// ---------------------------------------------------------------------------
// Closure period date formatter
// ---------------------------------------------------------------------------

function closureRange(start: Timestamp, end: Timestamp): string {
  const startDate = fmtDate(tsToDate(start))
  const endDate = fmtDate(tsToDate(end))
  return `${startDate} → ${endDate}`
}

// ---------------------------------------------------------------------------
// Lazy-load des référentiels (/categories, /tags) — uniquement quand la
// section devient visible. Évite un fetch inutile au mount initial pour les
// utilisateurs qui ne vont jamais sur ces onglets.
// ---------------------------------------------------------------------------

watch(
  activeSection,
  (s) => {
    if (s === 'categories' && categoriesStore.categories.length === 0) {
      void categoriesStore.load()
    }
    if (s === 'tags' && tagsStore.tags.length === 0) {
      void tagsStore.load()
    }
    if (s === 'cotisations' && cotisationTypesStore.cotisationTypes.length === 0) {
      void cotisationTypesStore.load()
    }
    if (s === 'licenses' && licenseTypesStore.licenseTypes.length === 0) {
      void licenseTypesStore.load()
    }
    if (s === 'matchTypes' && matchTypesStore.matchTypes.length === 0) {
      void matchTypesStore.load()
    }
  },
  { immediate: true },
)
</script>

<template>
  <section class="p-6">
    <div
      class="card overflow-hidden grid"
      style="grid-template-columns: 220px 1fr;"
    >
      <!-- =================== Vertical tabs (grouped) =================== -->
      <aside class="border-r border-surface-200 p-3 bg-surface-50/40 space-y-3">
        <div
          v-for="group in NAV_GROUPS"
          :key="group.label"
        >
          <div
            class="text-[11px] uppercase tracking-wider text-surface-400 font-semibold px-2 pb-1.5"
          >
            {{ group.label }}
          </div>
          <button
            v-for="item in group.items"
            :key="item.id"
            type="button"
            class="w-full flex items-center gap-2.5 px-3 h-9 rounded-md text-[13px] text-left transition-colors"
            :class="
              activeSection === item.id
                ? 'bg-emerald-50 text-emerald-700 font-medium'
                : 'text-surface-600 hover:bg-surface-100'
            "
            @click="activeSection = item.id"
          >
            <component
              :is="item.icon"
              :size="14"
              :stroke-width="2"
            />
            {{ item.label }}
          </button>
        </div>
      </aside>

      <!-- =================== Panel content =================== -->
      <div class="p-6 space-y-6">
        <!-- ============ Section: GENERAL ============ -->
        <template v-if="activeSection === 'general'">
          <div>
            <h2 class="text-[16px] font-semibold">
              Configuration générale
            </h2>
            <p class="text-[13px] text-surface-500">
              Identité du club et statut d'abonnement.
            </p>
          </div>

          <div class="grid grid-cols-2 gap-6">
            <label class="block">
              <span class="text-[12px] text-surface-600">Nom du club</span>
              <InputText
                v-model="generalForm.name"
                class="mt-1 w-full"
                :invalid="!!generalErrors.name"
              />
              <span
                v-if="generalErrors.name"
                class="text-[11px] text-rose-600 mt-1 block"
              >
                {{ generalErrors.name }}
              </span>
            </label>
            <label class="block">
              <span class="text-[12px] text-surface-600">Code court (URL)</span>
              <InputText
                v-model="generalForm.shortCode"
                class="mt-1 w-full font-mono"
                :invalid="!!generalErrors.shortCode"
              />
              <span
                v-if="generalErrors.shortCode"
                class="text-[11px] text-rose-600 mt-1 block"
              >
                {{ generalErrors.shortCode }}
              </span>
            </label>
            <label class="block col-span-2">
              <span class="text-[12px] text-surface-600">Adresse principale</span>
              <InputText
                v-model="generalForm.addressLine"
                class="mt-1 w-full"
                placeholder="Av. de la Forêt 12, 1010 Lausanne"
              />
            </label>
            <label class="block">
              <span class="text-[12px] text-surface-600">Email contact</span>
              <InputText
                v-model="generalForm.contactEmail"
                class="mt-1 w-full"
                :invalid="!!generalErrors.contactEmail"
              />
              <span
                v-if="generalErrors.contactEmail"
                class="text-[11px] text-rose-600 mt-1 block"
              >
                {{ generalErrors.contactEmail }}
              </span>
            </label>
            <label class="block">
              <span class="text-[12px] text-surface-600">Téléphone</span>
              <InputText
                v-model="generalForm.contactPhone"
                class="mt-1 w-full"
              />
            </label>
          </div>

          <!-- Logo upload -->
          <div
            class="border border-surface-200 rounded-md p-4 bg-surface-50/40 flex items-center gap-4"
          >
            <div
              class="w-14 h-14 rounded-md overflow-hidden flex items-center justify-center bg-surface-100"
              :class="{ 'bg-emerald-600 text-white': !store.config?.logo }"
            >
              <img
                v-if="store.config?.logo"
                :src="store.config.logo"
                alt="Logo du club"
                class="w-full h-full object-contain"
              >
              <Dribbble
                v-else
                :size="28"
                :stroke-width="2"
              />
            </div>
            <div class="flex-1 min-w-0">
              <div class="font-medium text-[14px]">
                Logo du club
              </div>
              <div class="text-[12px] text-surface-500">
                PNG, JPG, SVG ou WebP · max 2 MB · 512×512 recommandé
              </div>
              <div
                v-if="logoError"
                class="text-[11px] text-rose-600 mt-1"
              >
                {{ logoError }}
              </div>
            </div>
            <input
              ref="logoInputRef"
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              class="hidden"
              @change="onLogoSelected"
            >
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              :disabled="logoUploading"
              @click="triggerLogoPicker"
            >
              <template v-if="logoUploading">
                Envoi…
              </template>
              <template v-else>
                {{ store.config?.logo ? 'Remplacer' : 'Téléverser' }}
              </template>
            </button>
            <button
              v-if="store.config?.logo"
              type="button"
              class="btn btn-ghost btn-sm !text-rose-700"
              :disabled="logoUploading"
              @click="removeLogo"
            >
              Supprimer
            </button>
          </div>

          <!-- Subscription card -->
          <div>
            <h3 class="text-[14px] font-semibold mb-2">
              Abonnement
            </h3>
            <div class="grid grid-cols-3 gap-3">
              <div class="border border-surface-200 rounded-md p-3">
                <div
                  class="text-[11px] uppercase tracking-wider text-surface-400 font-semibold"
                >
                  Statut
                </div>
                <div class="mt-1 flex items-center gap-2">
                  <template v-if="store.subscription">
                    <Pill :variant="subscriptionPillVariant(store.subscription.status)">
                      {{ store.subscription.status }}
                    </Pill>
                    <span class="text-[12px] text-surface-500">
                      renouvellement {{ fmtDate(tsToDate(store.subscription.renewsAt)) }}
                    </span>
                  </template>
                  <template v-else>
                    <span class="text-[12px] text-surface-400">—</span>
                  </template>
                </div>
              </div>
              <div class="border border-surface-200 rounded-md p-3">
                <div
                  class="text-[11px] uppercase tracking-wider text-surface-400 font-semibold"
                >
                  Plan
                </div>
                <div class="mt-1 font-medium">
                  {{ store.subscription?.planLabel ?? '—' }}
                </div>
              </div>
              <div class="border border-surface-200 rounded-md p-3">
                <div
                  class="text-[11px] uppercase tracking-wider text-surface-400 font-semibold"
                >
                  Membres inclus
                </div>
                <div class="mt-1 num font-medium">
                  <template v-if="store.subscription">
                    {{ store.subscription.memberCount }} / {{ store.subscription.memberCap }}
                  </template>
                  <template v-else>
                    —
                  </template>
                </div>
              </div>
            </div>
          </div>

          <!-- Footer actions -->
          <div
            class="pt-4 border-t border-surface-200 flex items-center gap-2 justify-end"
          >
            <span
              v-if="isSavedThis('general')"
              class="text-[12px] text-emerald-700 flex items-center gap-1 mr-auto"
            >
              <Check
                :size="14"
                :stroke-width="2"
              />
              Modifications enregistrées
            </span>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              :disabled="isSavingThis('general')"
              @click="resetGeneral"
            >
              Annuler
            </button>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              :disabled="isSavingThis('general')"
              @click="saveGeneral"
            >
              <template v-if="isSavingThis('general')">
                Sauvegarde…
              </template>
              <template v-else>
                Sauvegarder
              </template>
            </button>
          </div>

          <!-- ============ Card: BANKING INFO (Infos bancaires) ============ -->
          <div class="card p-5 space-y-4 mt-6">
            <div class="flex items-start gap-3">
              <span
                class="w-9 h-9 rounded-md bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0"
              >
                <Banknote
                  :size="16"
                  :stroke-width="2"
                />
              </span>
              <div class="flex-1 min-w-0">
                <h2 class="text-[16px] font-semibold">
                  Infos bancaires
                </h2>
                <p class="text-[13px] text-surface-500">
                  Coordonnées bancaires utilisées pour les emails de demande
                  de paiement (cotisations) et l'écran de paiement côté inscription.
                  Tant que l'IBAN n'est pas saisi, ces messages omettront la
                  section "comment payer".
                </p>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <label class="block col-span-2">
                <span class="text-[12px] text-surface-600">IBAN</span>
                <InputText
                  v-model="bankingForm.iban"
                  class="mt-1 w-full font-mono"
                  placeholder="CH00 0000 0000 0000 0000 0"
                  :invalid="!!bankingErrors.iban"
                />
                <span
                  v-if="bankingErrors.iban"
                  class="text-[11px] text-rose-600 mt-1 block"
                >
                  {{ bankingErrors.iban }}
                </span>
              </label>

              <label class="block">
                <span class="text-[12px] text-surface-600">BIC / SWIFT</span>
                <InputText
                  v-model="bankingForm.bic"
                  class="mt-1 w-full font-mono"
                  placeholder="UBSWCHZH80A"
                  :invalid="!!bankingErrors.bic"
                />
                <span
                  v-if="bankingErrors.bic"
                  class="text-[11px] text-rose-600 mt-1 block"
                >
                  {{ bankingErrors.bic }}
                </span>
              </label>

              <label class="block">
                <span class="text-[12px] text-surface-600">Nom de la banque</span>
                <InputText
                  v-model="bankingForm.bankName"
                  class="mt-1 w-full"
                  placeholder="UBS Switzerland AG"
                  :invalid="!!bankingErrors.bankName"
                />
                <span
                  v-if="bankingErrors.bankName"
                  class="text-[11px] text-rose-600 mt-1 block"
                >
                  {{ bankingErrors.bankName }}
                </span>
              </label>

              <label class="block col-span-2">
                <span class="text-[12px] text-surface-600">
                  Titulaire du compte
                  <span class="text-rose-600">*</span>
                </span>
                <InputText
                  v-model="bankingForm.accountHolder"
                  class="mt-1 w-full"
                  placeholder="Nom de l'association"
                  :invalid="!!bankingErrors.accountHolder"
                />
                <span
                  v-if="bankingErrors.accountHolder"
                  class="text-[11px] text-rose-600 mt-1 block"
                >
                  {{ bankingErrors.accountHolder }}
                </span>
              </label>

              <label class="block col-span-2">
                <span class="text-[12px] text-surface-600">Instructions de paiement</span>
                <Textarea
                  v-model="bankingForm.paymentInstructions"
                  class="mt-1 w-full"
                  rows="3"
                  placeholder="Indiquer le prénom et le nom du joueur en référence du virement."
                  :invalid="!!bankingErrors.paymentInstructions"
                />
                <span
                  v-if="bankingErrors.paymentInstructions"
                  class="text-[11px] text-rose-600 mt-1 block"
                >
                  {{ bankingErrors.paymentInstructions }}
                </span>
                <span
                  v-else
                  class="text-[11px] text-surface-500 mt-1 block"
                >
                  Texte libre concaténé après l'IBAN dans les emails / écran
                  paiement.
                </span>
              </label>
            </div>

            <!-- Footer actions banking -->
            <div
              class="pt-4 border-t border-surface-200 flex items-center gap-2 justify-end"
            >
              <span
                v-if="isSavedThis('banking')"
                class="text-[12px] text-emerald-700 flex items-center gap-1 mr-auto"
              >
                <Check
                  :size="14"
                  :stroke-width="2"
                />
                Infos bancaires enregistrées
              </span>
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                :disabled="isSavingThis('banking')"
                @click="resetBanking"
              >
                Annuler
              </button>
              <button
                type="button"
                class="btn btn-primary btn-sm"
                :disabled="isSavingThis('banking')"
                @click="saveBanking"
              >
                <template v-if="isSavingThis('banking')">
                  Sauvegarde…
                </template>
                <template v-else>
                  Sauvegarder
                </template>
              </button>
            </div>
          </div>
        </template>

        <!-- ============ Section: OFFICIALS CONFIG ============ -->
        <template v-else-if="activeSection === 'officials'">
          <div>
            <h2 class="text-[16px] font-semibold">
              Officials — rentabilité
            </h2>
            <p class="text-[13px] text-surface-500">
              Seuils utilisés pour le widget rentabilité du Dashboard. Modifiables à
              la volée — recalcul client-side.
            </p>
          </div>

          <div class="grid grid-cols-3 gap-6">
            <label class="block">
              <span class="text-[12px] text-surface-600">Coût licence (CHF)</span>
              <InputNumber
                v-model="officialsForm.licenseFee"
                :min="0"
                :max-fraction-digits="0"
                input-class="!w-full"
                class="mt-1 w-full"
                :invalid="!!officialsErrors.licenseFee"
              />
              <span
                v-if="officialsErrors.licenseFee"
                class="text-[11px] text-rose-600 mt-1 block"
              >
                {{ officialsErrors.licenseFee }}
              </span>
            </label>
            <label class="block">
              <span class="text-[12px] text-surface-600">Seuil orange</span>
              <InputNumber
                v-model="officialsForm.thresholdOrange"
                :min="1"
                input-class="!w-full"
                class="mt-1 w-full"
                :invalid="!!officialsErrors.thresholdOrange"
              />
              <span class="text-[11px] text-surface-500 mt-1 block">
                Matches/saison &lt; ce seuil → rouge
              </span>
            </label>
            <label class="block">
              <span class="text-[12px] text-surface-600">Seuil vert</span>
              <InputNumber
                v-model="officialsForm.thresholdGreen"
                :min="2"
                input-class="!w-full"
                class="mt-1 w-full"
                :invalid="!!officialsErrors.thresholdGreen"
              />
              <span
                v-if="officialsErrors.thresholdGreen"
                class="text-[11px] text-rose-600 mt-1 block"
              >
                {{ officialsErrors.thresholdGreen }}
              </span>
              <span
                v-else
                class="text-[11px] text-surface-500 mt-1 block"
              >
                Matches/saison ≥ ce seuil → vert
              </span>
            </label>
          </div>

          <!-- Légende live preview -->
          <div class="border border-surface-200 rounded-md p-4 bg-surface-50/40">
            <div
              class="text-[11px] uppercase tracking-wider text-surface-400 font-semibold mb-2"
            >
              Aperçu — légende couleur
            </div>
            <div class="flex items-center gap-4 text-[12px]">
              <div class="flex items-center gap-2">
                <span class="w-3 h-3 rounded-full bg-rose-500" />
                <span>&lt; {{ officialsForm.thresholdOrange }} matchs / saison</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="w-3 h-3 rounded-full bg-amber-500" />
                <span>
                  {{ officialsForm.thresholdOrange }}–{{ Math.max(officialsForm.thresholdGreen - 1, officialsForm.thresholdOrange) }} matchs
                </span>
              </div>
              <div class="flex items-center gap-2">
                <span class="w-3 h-3 rounded-full bg-emerald-500" />
                <span>≥ {{ officialsForm.thresholdGreen }} matchs / saison</span>
              </div>
              <div class="ml-auto text-surface-500 num">
                Licence CHF {{ officialsForm.licenseFee }}.–
              </div>
            </div>
          </div>

          <div
            class="pt-4 border-t border-surface-200 flex items-center gap-2 justify-end"
          >
            <span
              v-if="isSavedThis('officials')"
              class="text-[12px] text-emerald-700 flex items-center gap-1 mr-auto"
            >
              <Check
                :size="14"
                :stroke-width="2"
              />
              Seuils sauvegardés
            </span>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              :disabled="isSavingThis('officials')"
              @click="saveOfficials"
            >
              <template v-if="isSavingThis('officials')">
                Sauvegarde…
              </template>
              <template v-else>
                Sauvegarder
              </template>
            </button>
          </div>
        </template>

        <!-- ============ Section: DUES CONFIG ============ -->
        <template v-else-if="activeSection === 'dues'">
          <div>
            <h2 class="text-[16px] font-semibold">
              Dues — cycle de cotisation
            </h2>
            <p class="text-[13px] text-surface-500">
              Configuration du lifecycle automatique géré par les Cloud Functions
              (cf. <code class="font-mono text-[11px]">docs/main.md</code>).
            </p>
          </div>

          <div class="grid grid-cols-2 gap-6">
            <label class="block">
              <span class="text-[12px] text-surface-600">Grace period (jours)</span>
              <InputNumber
                v-model="duesForm.gracePeriodDays"
                :min="0"
                input-class="!w-full"
                class="mt-1 w-full"
                :invalid="!!duesErrors.gracePeriodDays"
              />
              <span class="text-[11px] text-surface-500 mt-1 block">
                Délai avant l'émission auto du due (`pending_grace` → `issued`).
              </span>
            </label>
            <label class="block">
              <span class="text-[12px] text-surface-600">Délai de paiement (jours)</span>
              <InputNumber
                v-model="duesForm.paymentDueDays"
                :min="1"
                input-class="!w-full"
                class="mt-1 w-full"
                :invalid="!!duesErrors.paymentDueDays"
              />
              <span class="text-[11px] text-surface-500 mt-1 block">
                Délai après émission avant passage en `overdue`.
              </span>
            </label>
          </div>

          <!-- Timeline preview -->
          <div class="pt-3 border-t border-surface-200">
            <h3 class="text-[14px] font-semibold">
              Aperçu — timeline cotisation
            </h3>
            <p class="text-[12px] text-surface-500">
              Grace {{ duesForm.gracePeriodDays }} j · échéance
              {{ duesForm.gracePeriodDays + duesForm.paymentDueDays }} j
            </p>
            <div class="mt-3 flex items-center text-[11px] font-mono">
              <div class="flex-1 flex items-center gap-2">
                <span class="w-3 h-3 rounded-full bg-slate-400" />
                <div class="flex-1 h-px bg-slate-200" />
              </div>
              <div class="flex-1 flex items-center gap-2">
                <span class="w-3 h-3 rounded-full bg-sky-500" />
                <div class="flex-1 h-px bg-slate-200" />
              </div>
              <div class="flex-1 flex items-center gap-2">
                <span class="w-3 h-3 rounded-full bg-rose-500" />
                <div class="flex-1" />
              </div>
            </div>
            <div class="mt-1 flex items-center text-[11px] text-surface-500">
              <span class="flex-1">J0 · activated</span>
              <span class="flex-1">J+{{ duesForm.gracePeriodDays }} · issued</span>
              <span class="flex-1">
                J+{{ duesForm.gracePeriodDays + duesForm.paymentDueDays }} · overdue
              </span>
            </div>
            <div
              class="mt-4 text-[11px] text-surface-500 flex items-center gap-1.5"
            >
              <CircleAlert
                :size="12"
                :stroke-width="2"
              />
              Recalculé par les Functions au prochain tick (~06:00 quotidien).
            </div>
          </div>

          <div
            class="pt-4 border-t border-surface-200 flex items-center gap-2 justify-end"
          >
            <span
              v-if="isSavedThis('dues')"
              class="text-[12px] text-emerald-700 flex items-center gap-1 mr-auto"
            >
              <Check
                :size="14"
                :stroke-width="2"
              />
              Cycle sauvegardé
            </span>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              :disabled="isSavingThis('dues')"
              @click="saveDues"
            >
              <template v-if="isSavingThis('dues')">
                Sauvegarde…
              </template>
              <template v-else>
                Sauvegarder
              </template>
            </button>
          </div>
        </template>

        <!-- ============ Section: MEMBER ROLES ============ -->
        <template v-else-if="activeSection === 'roles'">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h2 class="text-[16px] font-semibold">
                Rôles membres
              </h2>
              <p class="text-[13px] text-surface-500">
                Rôles système (non-supprimables) + rôles custom du club. Voir
                <code class="font-mono text-[11px]">/roles</code> dans firebase.md.
              </p>
            </div>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              :disabled="isAddingRole || isSavingThis('roles')"
              @click="startAddRole"
            >
              <Plus
                :size="14"
                :stroke-width="2"
              />
              Ajouter un rôle
            </button>
          </div>

          <!-- Add row (inline) -->
          <div
            v-if="isAddingRole"
            class="border border-emerald-200 bg-emerald-50/40 rounded-md p-3 flex items-center gap-3"
          >
            <InputText
              v-model="roleDraft.name"
              placeholder="Ex. Trésorier"
              class="flex-1"
            />
            <Select
              v-model="roleDraft.color"
              :options="[...COLOR_PRESETS]"
              option-label="label"
              option-value="value"
              class="w-40"
            >
              <template #value="{ value }">
                <div class="flex items-center gap-2">
                  <span
                    class="w-3 h-3 rounded-full"
                    :style="{ background: value }"
                  />
                  <span class="text-[12px]">
                    {{ COLOR_PRESETS.find((c) => c.value === value)?.label ?? '' }}
                  </span>
                </div>
              </template>
              <template #option="{ option }">
                <div class="flex items-center gap-2">
                  <span
                    class="w-3 h-3 rounded-full"
                    :style="{ background: option.value }"
                  />
                  <span>{{ option.label }}</span>
                </div>
              </template>
            </Select>
            <RoleBadge
              :label="roleDraft.name || 'Aperçu'"
              :bg="roleDraft.color"
              color="#0f172a"
            />
            <span
              v-if="roleError"
              class="text-[11px] text-rose-600"
            >
              {{ roleError }}
            </span>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              @click="cancelRoleEdit"
            >
              Annuler
            </button>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              :disabled="isSavingThis('roles')"
              @click="commitRole"
            >
              Créer
            </button>
          </div>

          <!-- Roles list -->
          <div class="border border-surface-200 rounded-md divide-y divide-surface-200">
            <div
              v-for="role in store.roles"
              :key="role.id"
              class="flex items-center gap-3 px-3 h-12"
            >
              <!-- View mode -->
              <template v-if="editingRoleId !== role.id">
                <RoleBadge
                  :label="role.name"
                  :bg="role.color"
                  color="#0f172a"
                />
                <Pill
                  v-if="role.type === 'system'"
                  variant="slate"
                >
                  système
                </Pill>
                <Pill
                  v-else
                  variant="emerald"
                >
                  custom
                </Pill>
                <span class="text-[12px] text-surface-500 font-mono ml-2">
                  /roles/{{ role.id }}
                </span>
                <div class="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    :disabled="role.type === 'system' || isSavingThis('roles')"
                    @click="startEditRole(role)"
                  >
                    Éditer
                  </button>
                  <button
                    v-if="role.type !== 'system'"
                    type="button"
                    class="btn btn-ghost btn-sm !text-rose-700"
                    :disabled="isSavingThis('roles')"
                    @click="confirmDeleteRole(role)"
                  >
                    <Trash2
                      :size="14"
                      :stroke-width="2"
                    />
                  </button>
                </div>
              </template>

              <!-- Edit mode (inline) -->
              <template v-else>
                <InputText
                  v-model="roleDraft.name"
                  class="flex-1"
                />
                <Select
                  v-model="roleDraft.color"
                  :options="[...COLOR_PRESETS]"
                  option-label="label"
                  option-value="value"
                  class="w-40"
                >
                  <template #value="{ value }">
                    <div class="flex items-center gap-2">
                      <span
                        class="w-3 h-3 rounded-full"
                        :style="{ background: value }"
                      />
                      <span class="text-[12px]">
                        {{ COLOR_PRESETS.find((c) => c.value === value)?.label ?? '' }}
                      </span>
                    </div>
                  </template>
                  <template #option="{ option }">
                    <div class="flex items-center gap-2">
                      <span
                        class="w-3 h-3 rounded-full"
                        :style="{ background: option.value }"
                      />
                      <span>{{ option.label }}</span>
                    </div>
                  </template>
                </Select>
                <RoleBadge
                  :label="roleDraft.name || 'Aperçu'"
                  :bg="roleDraft.color"
                  color="#0f172a"
                />
                <span
                  v-if="roleError"
                  class="text-[11px] text-rose-600"
                >
                  {{ roleError }}
                </span>
                <div class="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    class="btn btn-secondary btn-sm"
                    @click="cancelRoleEdit"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    class="btn btn-primary btn-sm"
                    :disabled="isSavingThis('roles')"
                    @click="commitRole"
                  >
                    Sauvegarder
                  </button>
                </div>
              </template>
            </div>

            <div
              v-if="store.roles.length === 0"
              class="px-3 py-6 flex flex-col items-center gap-3 text-center"
            >
              <p class="text-[12px] text-surface-500">
                Aucun rôle configuré. Initialisez les 6 rôles système
                (+ 2 rôles custom par défaut) pour démarrer.
              </p>
              <button
                type="button"
                class="btn btn-primary btn-sm"
                :disabled="isSavingThis('roles')"
                @click="seedRoles"
              >
                <Plus
                  :size="14"
                  :stroke-width="2"
                />
                Initialiser les rôles
              </button>
            </div>
          </div>

          <div
            v-if="isSavedThis('roles')"
            class="text-[12px] text-emerald-700 flex items-center gap-1"
          >
            <Check
              :size="14"
              :stroke-width="2"
            />
            Rôles mis à jour
          </div>
        </template>

        <!-- ============ Section: CATEGORIES ============ -->
        <template v-else-if="activeSection === 'categories'">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h2 class="text-[16px] font-semibold">
                Catégories d'équipes
              </h2>
              <p class="text-[13px] text-surface-500">
                Référentiel d'âge éditable par le club. Renommer une catégorie
                se reflète automatiquement sur toutes ses équipes ; pour retirer
                une catégorie utilisée, archive-la plutôt que la supprimer
                (cf. lifecycle dans <code class="font-mono text-[11px]">docs/main.md</code>).
              </p>
            </div>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              :disabled="isAddingCategory || categoriesStore.loading"
              @click="startAddCategory"
            >
              <Plus
                :size="14"
                :stroke-width="2"
              />
              Ajouter une catégorie
            </button>
          </div>

          <!-- Filtre archivées -->
          <div class="flex items-center gap-2 text-[12px] text-surface-600">
            <Checkbox
              v-model="showArchivedCategories"
              input-id="show-archived-categories"
              binary
            />
            <label
              for="show-archived-categories"
              class="cursor-pointer select-none"
            >
              Afficher les archivées
              <span
                v-if="archivedCategoriesCount > 0"
                class="text-surface-400"
              >
                ({{ archivedCategoriesCount }})
              </span>
            </label>
          </div>

          <!-- Add row (inline) -->
          <div
            v-if="isAddingCategory"
            class="border border-emerald-200 bg-emerald-50/40 rounded-md p-3 space-y-3"
          >
            <div class="grid grid-cols-6 gap-3">
              <label class="block col-span-2">
                <span class="text-[12px] text-surface-600">Nom</span>
                <InputText
                  v-model="categoryDraft.name"
                  placeholder="Ex. U14"
                  class="mt-1 w-full"
                />
              </label>
              <label class="block">
                <span class="text-[12px] text-surface-600">Borne min</span>
                <InputNumber
                  v-model="categoryDraft.minAge"
                  :min="0"
                  :max="120"
                  input-class="!w-full"
                  class="mt-1 w-full"
                  :disabled="!categoryDraft.hasMin"
                />
              </label>
              <label class="block">
                <span class="text-[12px] text-surface-600">Borne max</span>
                <InputNumber
                  v-model="categoryDraft.maxAge"
                  :min="0"
                  :max="120"
                  input-class="!w-full"
                  class="mt-1 w-full"
                  :disabled="!categoryDraft.hasMax"
                />
              </label>
              <label class="block">
                <span class="text-[12px] text-surface-600">
                  Ordre <span class="text-surface-400">(opt.)</span>
                </span>
                <InputNumber
                  v-model="categoryDraft.displayOrder"
                  :min="0"
                  input-class="!w-full"
                  class="mt-1 w-full"
                />
              </label>
              <div class="block flex items-end">
                <Pill variant="slate">
                  {{ categoryAgeLabel(categoryDraftPreview) }}
                </Pill>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-4 text-[12px]">
              <label class="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  v-model="categoryDraft.hasMin"
                  binary
                  :true-value="false"
                  :false-value="true"
                />
                <span>Pas de borne min</span>
              </label>
              <label class="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  v-model="categoryDraft.hasMax"
                  binary
                  :true-value="false"
                  :false-value="true"
                />
                <span>Pas de borne max</span>
              </label>
              <span
                v-if="categoryError"
                class="text-[11px] text-rose-600"
              >
                {{ categoryError }}
              </span>
              <div class="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  @click="cancelCategoryEdit"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  @click="commitCategory"
                >
                  Créer
                </button>
              </div>
            </div>
          </div>

          <!-- Categories list -->
          <div class="border border-surface-200 rounded-md divide-y divide-surface-200">
            <template
              v-for="c in visibleCategories"
              :key="c.id"
            >
              <!-- View mode -->
              <div
                v-if="editingCategoryId !== c.id"
                class="flex items-center gap-3 px-3 h-12"
              >
                <Layers
                  :size="14"
                  :stroke-width="2"
                  class="text-surface-400"
                />
                <span class="font-medium text-[13px]">{{ c.name }}</span>
                <Pill variant="slate">
                  {{ categoryAgeLabel(c) }}
                </Pill>
                <span class="text-[11px] text-surface-400 font-mono">
                  #{{ c.displayOrder }}
                </span>
                <Pill
                  v-if="!c.active"
                  variant="amber"
                >
                  archivée
                </Pill>
                <span class="text-[12px] text-surface-500 font-mono ml-2">
                  /categories/{{ c.id }}
                </span>
                <div class="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    @click="startEditCategory(c)"
                  >
                    Éditer
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    @click="toggleCategoryArchive(c)"
                  >
                    {{ c.active ? 'Archiver' : 'Désarchiver' }}
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm !text-rose-700"
                    @click="openDeleteCategoryDialog(c)"
                  >
                    <Trash2
                      :size="14"
                      :stroke-width="2"
                    />
                  </button>
                </div>
              </div>

              <!-- Edit mode (inline) -->
              <div
                v-else
                class="border border-emerald-200 bg-emerald-50/40 rounded-md p-3 space-y-3"
              >
                <div class="grid grid-cols-6 gap-3">
                  <label class="block col-span-2">
                    <span class="text-[12px] text-surface-600">Nom</span>
                    <InputText
                      v-model="categoryDraft.name"
                      class="mt-1 w-full"
                    />
                  </label>
                  <label class="block">
                    <span class="text-[12px] text-surface-600">Borne min</span>
                    <InputNumber
                      v-model="categoryDraft.minAge"
                      :min="0"
                      :max="120"
                      input-class="!w-full"
                      class="mt-1 w-full"
                      :disabled="!categoryDraft.hasMin"
                    />
                  </label>
                  <label class="block">
                    <span class="text-[12px] text-surface-600">Borne max</span>
                    <InputNumber
                      v-model="categoryDraft.maxAge"
                      :min="0"
                      :max="120"
                      input-class="!w-full"
                      class="mt-1 w-full"
                      :disabled="!categoryDraft.hasMax"
                    />
                  </label>
                  <label class="block">
                    <span class="text-[12px] text-surface-600">Ordre</span>
                    <InputNumber
                      v-model="categoryDraft.displayOrder"
                      :min="0"
                      input-class="!w-full"
                      class="mt-1 w-full"
                    />
                  </label>
                  <div class="block flex items-end">
                    <Pill variant="slate">
                      {{ categoryAgeLabel(categoryDraftPreview) }}
                    </Pill>
                  </div>
                </div>
                <div class="flex flex-wrap items-center gap-4 text-[12px]">
                  <label class="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      v-model="categoryDraft.hasMin"
                      binary
                      :true-value="false"
                      :false-value="true"
                    />
                    <span>Pas de borne min</span>
                  </label>
                  <label class="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      v-model="categoryDraft.hasMax"
                      binary
                      :true-value="false"
                      :false-value="true"
                    />
                    <span>Pas de borne max</span>
                  </label>
                  <span
                    v-if="categoryError"
                    class="text-[11px] text-rose-600"
                  >
                    {{ categoryError }}
                  </span>
                  <div class="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      class="btn btn-secondary btn-sm"
                      @click="cancelCategoryEdit"
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      class="btn btn-primary btn-sm"
                      @click="commitCategory"
                    >
                      Sauvegarder
                    </button>
                  </div>
                </div>
              </div>
            </template>

            <div
              v-if="visibleCategories.length === 0"
              class="px-3 py-6 text-center text-[12px] text-surface-500"
            >
              <template v-if="categoriesStore.loading">
                Chargement…
              </template>
              <template v-else-if="!showArchivedCategories && archivedCategoriesCount > 0">
                Aucune catégorie active.
                <button
                  type="button"
                  class="text-emerald-700 underline ml-1"
                  @click="showArchivedCategories = true"
                >
                  Afficher les {{ archivedCategoriesCount }} archivée(s)
                </button>
              </template>
              <template v-else>
                Aucune catégorie configurée. Crée la première pour pouvoir
                l'assigner aux équipes.
              </template>
            </div>
          </div>

          <div
            v-if="categoryFlashMessage"
            class="text-[12px] text-emerald-700 flex items-center gap-1"
          >
            <Check
              :size="14"
              :stroke-width="2"
            />
            {{ categoryFlashMessage }}
          </div>
        </template>

        <!-- ============ Section: TAGS ============ -->
        <template v-else-if="activeSection === 'tags'">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h2 class="text-[16px] font-semibold">
                Tags d'équipes
              </h2>
              <p class="text-[13px] text-surface-500">
                Étiquettes colorées pour différencier des équipes similaires
                (ex. deux U14M, version Compet vs Loisir). Le flag « afficher »
                est défini par-équipe lors de l'ajout d'un tag — utile pour des
                tags admin invisibles côté UI publique. Cf.
                <code class="font-mono text-[11px]">docs/main.md</code> →
                « Tags d'équipes ».
              </p>
            </div>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              :disabled="isAddingTag || tagsStore.loading"
              @click="startAddTag"
            >
              <Plus
                :size="14"
                :stroke-width="2"
              />
              Ajouter un tag
            </button>
          </div>

          <!-- Filtre archivés -->
          <div class="flex items-center gap-2 text-[12px] text-surface-600">
            <Checkbox
              v-model="showArchivedTags"
              input-id="show-archived-tags"
              binary
            />
            <label
              for="show-archived-tags"
              class="cursor-pointer select-none"
            >
              Afficher les archivés
              <span
                v-if="archivedTagsCount > 0"
                class="text-surface-400"
              >
                ({{ archivedTagsCount }})
              </span>
            </label>
          </div>

          <!-- Add row (inline) -->
          <div
            v-if="isAddingTag"
            class="border border-emerald-200 bg-emerald-50/40 rounded-md p-3 space-y-3"
          >
            <div class="grid grid-cols-6 gap-3">
              <label class="block col-span-2">
                <span class="text-[12px] text-surface-600">Nom</span>
                <InputText
                  v-model="tagDraft.name"
                  placeholder="Ex. Compet, U14 A, Élite"
                  class="mt-1 w-full"
                />
              </label>
              <label class="block">
                <span class="text-[12px] text-surface-600">
                  Ordre <span class="text-surface-400">(opt.)</span>
                </span>
                <InputNumber
                  v-model="tagDraft.displayOrder"
                  :min="0"
                  input-class="!w-full"
                  class="mt-1 w-full"
                />
              </label>
              <div class="col-span-3 flex items-end">
                <Pill :variant="tagDraft.color">
                  {{ tagDraft.name.trim() || 'Aperçu' }}
                </Pill>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <span class="text-[12px] text-surface-600">Couleur</span>
              <div class="flex items-center gap-1.5">
                <button
                  v-for="swatch in TAG_PALETTE"
                  :key="swatch.value"
                  type="button"
                  class="h-7 px-2 rounded-md text-[11px] font-medium leading-none transition-shadow"
                  :class="[
                    swatch.bg,
                    swatch.text,
                    tagDraft.color === swatch.value
                      ? 'ring-2 ring-offset-1 ring-emerald-500'
                      : 'opacity-80 hover:opacity-100',
                  ]"
                  :aria-pressed="tagDraft.color === swatch.value"
                  :aria-label="`Couleur ${swatch.label}`"
                  @click="tagDraft.color = swatch.value"
                >
                  {{ swatch.label }}
                </button>
              </div>
              <span
                v-if="tagError"
                class="text-[11px] text-rose-600"
              >
                {{ tagError }}
              </span>
              <div class="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  @click="cancelTagEdit"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  @click="commitTag"
                >
                  Créer
                </button>
              </div>
            </div>
          </div>

          <!-- Tags list -->
          <div class="border border-surface-200 rounded-md divide-y divide-surface-200">
            <template
              v-for="t in visibleTags"
              :key="t.id"
            >
              <!-- View mode -->
              <div
                v-if="editingTagId !== t.id"
                class="flex items-center gap-3 px-3 h-12"
              >
                <TagIcon
                  :size="14"
                  :stroke-width="2"
                  class="text-surface-400"
                />
                <Pill :variant="t.color">
                  {{ t.name }}
                </Pill>
                <span class="text-[11px] text-surface-400 font-mono">
                  #{{ t.displayOrder }}
                </span>
                <Pill
                  v-if="!t.active"
                  variant="amber"
                >
                  archivé
                </Pill>
                <span class="text-[12px] text-surface-500 font-mono ml-2">
                  /tags/{{ t.id }}
                </span>
                <div class="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    @click="startEditTag(t)"
                  >
                    Éditer
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    @click="toggleTagArchive(t)"
                  >
                    {{ t.active ? 'Archiver' : 'Désarchiver' }}
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm !text-rose-700"
                    @click="openDeleteTagDialog(t)"
                  >
                    <Trash2
                      :size="14"
                      :stroke-width="2"
                    />
                  </button>
                </div>
              </div>

              <!-- Edit mode (inline) -->
              <div
                v-else
                class="border border-emerald-200 bg-emerald-50/40 rounded-md p-3 space-y-3"
              >
                <div class="grid grid-cols-6 gap-3">
                  <label class="block col-span-2">
                    <span class="text-[12px] text-surface-600">Nom</span>
                    <InputText
                      v-model="tagDraft.name"
                      class="mt-1 w-full"
                    />
                  </label>
                  <label class="block">
                    <span class="text-[12px] text-surface-600">Ordre</span>
                    <InputNumber
                      v-model="tagDraft.displayOrder"
                      :min="0"
                      input-class="!w-full"
                      class="mt-1 w-full"
                    />
                  </label>
                  <div class="col-span-3 flex items-end">
                    <Pill :variant="tagDraft.color">
                      {{ tagDraft.name.trim() || 'Aperçu' }}
                    </Pill>
                  </div>
                </div>
                <div class="flex flex-wrap items-center gap-3">
                  <span class="text-[12px] text-surface-600">Couleur</span>
                  <div class="flex items-center gap-1.5">
                    <button
                      v-for="swatch in TAG_PALETTE"
                      :key="swatch.value"
                      type="button"
                      class="h-7 px-2 rounded-md text-[11px] font-medium leading-none transition-shadow"
                      :class="[
                        swatch.bg,
                        swatch.text,
                        tagDraft.color === swatch.value
                          ? 'ring-2 ring-offset-1 ring-emerald-500'
                          : 'opacity-80 hover:opacity-100',
                      ]"
                      :aria-pressed="tagDraft.color === swatch.value"
                      :aria-label="`Couleur ${swatch.label}`"
                      @click="tagDraft.color = swatch.value"
                    >
                      {{ swatch.label }}
                    </button>
                  </div>
                  <span
                    v-if="tagError"
                    class="text-[11px] text-rose-600"
                  >
                    {{ tagError }}
                  </span>
                  <div class="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      class="btn btn-secondary btn-sm"
                      @click="cancelTagEdit"
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      class="btn btn-primary btn-sm"
                      @click="commitTag"
                    >
                      Sauvegarder
                    </button>
                  </div>
                </div>
              </div>
            </template>

            <div
              v-if="visibleTags.length === 0"
              class="px-3 py-6 text-center text-[12px] text-surface-500"
            >
              <template v-if="tagsStore.loading">
                Chargement…
              </template>
              <template v-else-if="!showArchivedTags && archivedTagsCount > 0">
                Aucun tag actif.
                <button
                  type="button"
                  class="text-emerald-700 underline ml-1"
                  @click="showArchivedTags = true"
                >
                  Afficher les {{ archivedTagsCount }} archivé(s)
                </button>
              </template>
              <template v-else>
                Aucun tag configuré. Crée le premier pour pouvoir l'attacher
                à une équipe.
              </template>
            </div>
          </div>

          <div
            v-if="tagFlashMessage"
            class="text-[12px] text-emerald-700 flex items-center gap-1"
          >
            <Check
              :size="14"
              :stroke-width="2"
            />
            {{ tagFlashMessage }}
          </div>
        </template>

        <!-- ============ Section: COTISATION TYPES ============ -->
        <template v-else-if="activeSection === 'cotisations'">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h2 class="text-[16px] font-semibold">
                Types de cotisation
              </h2>
              <p class="text-[13px] text-surface-500">
                Référentiel des types de cotisation annuels (CHF/an/joueur).
                Renommer ou repricer un type se reflète automatiquement sur
                toutes les équipes qui le référencent. Pour retirer un type
                utilisé, archive-le plutôt que le supprimer (cf.
                <code class="font-mono text-[11px]">docs/main.md</code>).
              </p>
            </div>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              :disabled="isAddingCotisationType || cotisationTypesStore.loading"
              @click="startAddCotisationType"
            >
              <Plus
                :size="14"
                :stroke-width="2"
              />
              Ajouter un type
            </button>
          </div>

          <!-- Filtre archivées -->
          <div class="flex items-center gap-2 text-[12px] text-surface-600">
            <Checkbox
              v-model="showArchivedCotisations"
              input-id="show-archived-cotisations"
              binary
            />
            <label
              for="show-archived-cotisations"
              class="cursor-pointer select-none"
            >
              Afficher les archivées
              <span
                v-if="archivedCotisationsCount > 0"
                class="text-surface-400"
              >
                ({{ archivedCotisationsCount }})
              </span>
            </label>
          </div>

          <!-- Liste des types de cotisation -->
          <div class="border border-surface-200 rounded-md divide-y divide-surface-200">
            <div
              v-for="c in visibleCotisations"
              :key="c.id"
              class="flex items-center gap-3 px-3 py-2.5"
            >
              <Banknote
                :size="14"
                :stroke-width="2"
                class="text-surface-400 shrink-0"
              />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-medium text-[13px]">{{ c.name }}</span>
                  <Pill variant="emerald">
                    CHF {{ c.price }}
                  </Pill>
                  <span class="text-[11px] text-surface-400 font-mono">
                    #{{ c.displayOrder }}
                  </span>
                  <Pill
                    v-if="!c.active"
                    variant="amber"
                  >
                    archivée
                  </Pill>
                </div>
                <div
                  v-if="c.description"
                  class="text-[12px] text-surface-500 mt-0.5 truncate"
                >
                  {{ c.description }}
                </div>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  @click="startEditCotisationType(c)"
                >
                  Éditer
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  @click="toggleCotisationTypeArchive(c)"
                >
                  {{ c.active ? 'Archiver' : 'Désarchiver' }}
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm !text-rose-700"
                  :disabled="(cotisationTypesStore.lastUsageCount[c.id] ?? 0) > 0"
                  :title="
                    (cotisationTypesStore.lastUsageCount[c.id] ?? 0) > 0
                      ? `Utilisé par ${cotisationTypesStore.lastUsageCount[c.id]} équipe(s) — archivez-le plutôt`
                      : undefined
                  "
                  @click="openDeleteCotisationTypeDialog(c)"
                >
                  <Trash2
                    :size="14"
                    :stroke-width="2"
                  />
                </button>
              </div>
            </div>

            <div
              v-if="visibleCotisations.length === 0"
              class="px-3 py-6 text-center text-[12px] text-surface-500"
            >
              <template v-if="cotisationTypesStore.loading">
                Chargement…
              </template>
              <template v-else-if="!showArchivedCotisations && archivedCotisationsCount > 0">
                Aucun type de cotisation actif.
                <button
                  type="button"
                  class="text-emerald-700 underline ml-1"
                  @click="showArchivedCotisations = true"
                >
                  Afficher les {{ archivedCotisationsCount }} archivé(s)
                </button>
              </template>
              <template v-else>
                Aucun type de cotisation configuré. Crée le premier pour
                pouvoir l'attacher à une équipe.
              </template>
            </div>
          </div>

          <div
            v-if="cotisationFlashMessage"
            class="text-[12px] text-emerald-700 flex items-center gap-1"
          >
            <Check
              :size="14"
              :stroke-width="2"
            />
            {{ cotisationFlashMessage }}
          </div>
        </template>

        <!-- ============ Section: LICENSE TYPES ============ -->
        <template v-else-if="activeSection === 'licenses'">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h2 class="text-[16px] font-semibold">
                Types de licence
              </h2>
              <p class="text-[13px] text-surface-500">
                Grille tarifaire des licences fédérales, organisée par rôle et
                par niveau. Le prix d'une licence émise sera capturé au moment
                du paiement, donc une mise à jour ici n'affectera pas les
                licences déjà émises. Voir
                <code class="font-mono text-[11px]">docs/main.md</code>
                (section Licences) pour le modèle complet.
              </p>
            </div>
          </div>

          <!-- Filtre archivés -->
          <div class="flex items-center gap-2 text-[12px] text-surface-600">
            <Checkbox
              v-model="showArchivedLicenseTypes"
              input-id="show-archived-license-types"
              binary
            />
            <label
              for="show-archived-license-types"
              class="cursor-pointer select-none"
            >
              Afficher les archivés
              <span
                v-if="archivedLicenseTypesCount > 0"
                class="text-surface-400"
              >
                ({{ archivedLicenseTypesCount }})
              </span>
            </label>
          </div>

          <!-- 4 fieldsets, un par rôle -->
          <div class="space-y-4">
            <div
              v-for="role in LICENSE_ROLES"
              :key="role"
              class="border border-surface-200 rounded-md overflow-hidden"
            >
              <div
                class="flex items-center justify-between gap-2 px-3 py-2 bg-surface-50 border-b border-surface-200"
              >
                <div class="flex items-center gap-2">
                  <BadgeCheck
                    :size="14"
                    :stroke-width="2"
                    class="text-surface-400"
                  />
                  <h3 class="text-[13px] font-semibold">
                    {{ LICENSE_ROLE_LABEL[role] }}
                  </h3>
                  <span class="text-[11px] text-surface-400">
                    {{ visibleLicenseTypesFor(role).length }} niveau{{
                      visibleLicenseTypesFor(role).length > 1 ? 'x' : ''
                    }}
                  </span>
                </div>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  :disabled="isAddingLicenseType || licenseTypesStore.loading"
                  @click="startAddLicenseType(role)"
                >
                  <Plus
                    :size="14"
                    :stroke-width="2"
                  />
                  Ajouter
                </button>
              </div>

              <div class="divide-y divide-surface-200">
                <div
                  v-for="t in visibleLicenseTypesFor(role)"
                  :key="t.id"
                  class="flex items-center gap-3 px-3 py-2.5"
                >
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="font-medium text-[13px]">{{ t.name }}</span>
                      <Pill
                        v-if="t.level !== null"
                        variant="sky"
                      >
                        Niveau {{ t.level }}
                      </Pill>
                      <Pill variant="emerald">
                        CHF {{ t.fee }}
                      </Pill>
                      <span class="text-[11px] text-surface-400 font-mono">
                        #{{ t.displayOrder }}
                      </span>
                      <Pill
                        v-if="!t.active"
                        variant="amber"
                      >
                        archivé
                      </Pill>
                    </div>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      @click="startEditLicenseType(t)"
                    >
                      Éditer
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      @click="toggleLicenseTypeArchive(t)"
                    >
                      {{ t.active ? 'Archiver' : 'Désarchiver' }}
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm !text-rose-700"
                      @click="openDeleteLicenseTypeDialog(t)"
                    >
                      <Trash2
                        :size="14"
                        :stroke-width="2"
                      />
                    </button>
                  </div>
                </div>

                <div
                  v-if="visibleLicenseTypesFor(role).length === 0"
                  class="px-3 py-4 text-center text-[12px] text-surface-500"
                >
                  <template v-if="licenseTypesStore.loading">
                    Chargement…
                  </template>
                  <template v-else>
                    Aucun niveau configuré pour ce rôle.
                  </template>
                </div>
              </div>
            </div>
          </div>

          <div
            v-if="licenseTypeFlashMessage"
            class="text-[12px] text-emerald-700 flex items-center gap-1"
          >
            <Check
              :size="14"
              :stroke-width="2"
            />
            {{ licenseTypeFlashMessage }}
          </div>
        </template>

        <!-- ============ Section: MATCH TYPES ============ -->
        <template v-else-if="activeSection === 'matchTypes'">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h2 class="text-[16px] font-semibold">
                Match types
              </h2>
              <p class="text-[13px] text-surface-500">
                Référentiel des types de compétition (CSJC, AFBB, Amical, …).
                Chaque type définit la taille de court requise et les officiels
                à fournir à domicile et à l'extérieur. Désactive un type pour
                le retirer des pickers de création de match sans perdre
                l'historique.
              </p>
            </div>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              :disabled="matchTypesStore.loading"
              @click="openCreateMatchTypeDialog"
            >
              <Plus
                :size="14"
                :stroke-width="2"
              />
              Nouveau type
            </button>
          </div>

          <!-- Match types list -->
          <div class="border border-surface-200 rounded-md divide-y divide-surface-200">
            <div
              v-for="mt in matchTypesStore.matchTypes"
              :key="mt.id"
              class="flex items-center gap-3 px-3 py-2.5"
            >
              <span
                class="inline-block h-3 w-3 rounded-full border border-surface-200 shrink-0"
                :style="{ backgroundColor: mt.color }"
              />
              <span class="font-medium text-[13px]">{{ mt.name }}</span>
              <Pill variant="slate">
                {{ COURT_SIZE_LABEL[mt.requiredCourtSize] }}
              </Pill>
              <span class="text-[11px] text-surface-500">
                Home : {{ formatOfficialReqs(mt.homeOfficialRequirements) }}
              </span>
              <span class="text-[11px] text-surface-500">
                Away : {{ mt.awayOfficialCount }} officiel{{ mt.awayOfficialCount > 1 ? 's' : '' }}
              </span>
              <Pill
                v-if="!mt.active"
                variant="amber"
              >
                inactif
              </Pill>
              <span class="text-[11px] text-surface-400 font-mono ml-2">
                /matchTypes/{{ mt.id }}
              </span>
              <div class="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  @click="openEditMatchTypeDialog(mt)"
                >
                  Éditer
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  @click="toggleMatchTypeActive(mt)"
                >
                  {{ mt.active ? 'Désactiver' : 'Activer' }}
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm !text-rose-700"
                  @click="openDeleteMatchTypeDialog(mt)"
                >
                  <Trash2
                    :size="14"
                    :stroke-width="2"
                  />
                </button>
              </div>
            </div>

            <div
              v-if="matchTypesStore.matchTypes.length === 0"
              class="px-3 py-6 text-center text-[12px] text-surface-500"
            >
              <template v-if="matchTypesStore.loading">
                Chargement…
              </template>
              <template v-else>
                Aucun type de match configuré. Crée le premier pour pouvoir
                l'utiliser depuis la création de match.
              </template>
            </div>
          </div>

          <div
            v-if="matchTypeFlashMessage"
            class="text-[12px] text-emerald-700 flex items-center gap-1"
          >
            <Check
              :size="14"
              :stroke-width="2"
            />
            {{ matchTypeFlashMessage }}
          </div>
        </template>

        <!-- ============ Section: CLOSURE PERIODS ============ -->
        <template v-else-if="activeSection === 'closurePeriods'">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h2 class="text-[16px] font-semibold">
                Closure periods
              </h2>
              <p class="text-[13px] text-surface-500">
                Périodes de fermeture réutilisables entre saisons (vacances, travaux).
                L'ajout à une saison `active` déclenche `applyClosurePeriod` (cascading cancel).
              </p>
            </div>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              :disabled="isAddingClosure || isSavingThis('closurePeriods')"
              @click="startAddClosure"
            >
              <Plus
                :size="14"
                :stroke-width="2"
              />
              Ajouter une période
            </button>
          </div>

          <!-- Add form (inline) -->
          <div
            v-if="isAddingClosure"
            class="border border-emerald-200 bg-emerald-50/40 rounded-md p-3 space-y-3"
          >
            <div class="grid grid-cols-4 gap-3">
              <label class="block col-span-2">
                <span class="text-[12px] text-surface-600">Nom</span>
                <InputText
                  v-model="closureDraft.name"
                  class="mt-1 w-full"
                  placeholder="Ex. Vacances de Pâques"
                />
              </label>
              <label class="block">
                <span class="text-[12px] text-surface-600">Début</span>
                <input
                  v-model="closureDraft.startDate"
                  type="date"
                  class="input !pl-3 mt-1"
                >
              </label>
              <label class="block">
                <span class="text-[12px] text-surface-600">Fin</span>
                <input
                  v-model="closureDraft.endDate"
                  type="date"
                  class="input !pl-3 mt-1"
                >
              </label>
            </div>
            <div class="flex items-center gap-3">
              <label class="block w-40">
                <span class="text-[12px] text-surface-600">Type</span>
                <Select
                  v-model="closureDraft.type"
                  :options="[...CLOSURE_TYPE_OPTIONS]"
                  option-label="label"
                  option-value="value"
                  class="mt-1 w-full"
                />
              </label>
              <span
                v-if="closureError"
                class="text-[11px] text-rose-600"
              >
                {{ closureError }}
              </span>
              <div class="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  @click="cancelClosureAdd"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  :disabled="isSavingThis('closurePeriods')"
                  @click="commitClosure"
                >
                  Créer
                </button>
              </div>
            </div>
          </div>

          <!-- List -->
          <div class="border border-surface-200 rounded-md divide-y divide-surface-200">
            <div
              v-for="period in store.closurePeriods"
              :key="period.id"
              class="flex items-center gap-3 px-3 h-12"
            >
              <CalendarX
                :size="14"
                :stroke-width="2"
                class="text-surface-400"
              />
              <span class="font-medium text-[13px]">{{ period.name }}</span>
              <Pill
                v-if="period.type === 'holiday'"
                variant="sky"
              >
                vacances
              </Pill>
              <Pill
                v-else
                variant="slate"
              >
                custom
              </Pill>
              <span class="text-[12px] text-surface-500 num ml-2">
                {{ closureRange(period.startDate, period.endDate) }}
              </span>
              <div class="ml-auto">
                <button
                  type="button"
                  class="btn btn-ghost btn-sm !text-rose-700"
                  :disabled="isSavingThis('closurePeriods')"
                  @click="confirmDeleteClosure(period.id, period.name)"
                >
                  <Trash2
                    :size="14"
                    :stroke-width="2"
                  />
                </button>
              </div>
            </div>

            <div
              v-if="store.closurePeriods.length === 0"
              class="px-3 py-6 text-center text-[12px] text-surface-500"
            >
              Aucune closure period configurée.
            </div>
          </div>

          <div
            v-if="isSavedThis('closurePeriods')"
            class="text-[12px] text-emerald-700 flex items-center gap-1"
          >
            <Check
              :size="14"
              :stroke-width="2"
            />
            Closure periods mises à jour
          </div>
        </template>

        <!-- ============ Section: ADMIN TEAM ============ -->
        <template v-else-if="activeSection === 'adminTeam'">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h2 class="text-[16px] font-semibold">
                Admin team
              </h2>
              <p class="text-[13px] text-surface-500">
                Utilisateurs portant le rôle <code class="font-mono text-[11px]">admin</code>
                sur ce club (cf. <code class="font-mono text-[11px]">/users.roles</code>
                dans firebase.md). Le <strong>rootAdmin</strong> est non-révocable via l'UI.
              </p>
            </div>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              :disabled="isSavingThis('adminTeam')"
              @click="openInviteDialog"
            >
              <Plus
                :size="14"
                :stroke-width="2"
              />
              Inviter un admin
            </button>
          </div>

          <!-- Bannière "invitation enregistrée" -->
          <div
            v-if="store.lastInvitedEmail"
            class="border border-sky-200 bg-sky-50/60 rounded-md px-3 py-2.5 flex items-center gap-2 text-[12px] text-sky-800"
          >
            <Mail
              :size="14"
              :stroke-width="2"
            />
            <span>
              Invitation créée pour <strong>{{ store.lastInvitedEmail }}</strong>.
              Demande-lui de se connecter via Google avec cet email — son compte
              admin sera provisionné automatiquement.
            </span>
          </div>

          <!-- Admins list -->
          <div class="border border-surface-200 rounded-md divide-y divide-surface-200">
            <div
              v-for="admin in store.admins"
              :key="admin.id"
              class="flex items-center gap-3 px-3 h-14"
            >
              <Avatar
                :name="admin.displayName"
                :size="32"
              />
              <div class="flex flex-col min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-medium text-[13px] truncate">
                    {{ admin.displayName }}
                  </span>
                  <Pill
                    v-if="admin.isRootAdmin"
                    variant="amber"
                  >
                    <Crown
                      :size="11"
                      :stroke-width="2"
                    />
                    rootAdmin
                  </Pill>
                  <Pill
                    v-if="admin.roles.includes('admin')"
                    variant="rose"
                  >
                    admin
                  </Pill>
                  <Pill
                    v-if="admin.roles.includes('coach')"
                    variant="sky"
                  >
                    coach
                  </Pill>
                  <Pill
                    v-if="admin.roles.includes('official')"
                    variant="emerald"
                  >
                    official
                  </Pill>
                  <Pill
                    v-if="admin.roles.includes('treasurer')"
                    variant="violet"
                  >
                    treasurer
                  </Pill>
                </div>
                <span class="text-[11px] text-surface-500 truncate">
                  {{ admin.email }}
                </span>
              </div>
              <div class="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  :disabled="isSavingThis('adminTeam')"
                  title="Gérer les rôles (admin / coach / official / treasurer)"
                  @click="openRolesDialog(admin)"
                >
                  Rôles
                </button>
                <button
                  v-if="admin.isRootAdmin"
                  type="button"
                  class="btn btn-ghost btn-sm !text-surface-400 cursor-not-allowed"
                  disabled
                  title="Root admin · ne peut être révoqué via l'UI"
                >
                  Retirer
                </button>
                <button
                  v-else
                  type="button"
                  class="btn btn-ghost btn-sm !text-rose-700"
                  :disabled="isSavingThis('adminTeam')"
                  @click="confirmRemoveAdmin(admin.id, admin.displayName)"
                >
                  Retirer
                </button>
              </div>
            </div>

            <template v-if="store.admins.length === 0">
              <div class="px-3 py-6 text-center text-[12px] text-surface-500">
                Aucun admin (autre que rootAdmin).
              </div>
            </template>
          </div>

          <!-- Pending invitations (sous la liste admins) -->
          <template v-if="store.invitations.length > 0">
            <h3 class="text-[14px] font-semibold mt-4">
              Invitations en attente
            </h3>
            <div class="border border-surface-200 rounded-md divide-y divide-surface-200">
              <div
                v-for="invite in store.invitations"
                :key="invite.id"
                class="flex items-center gap-3 px-3 h-14"
              >
                <div
                  class="w-8 h-8 rounded-full bg-surface-100 text-surface-400 flex items-center justify-center"
                >
                  <Mail
                    :size="14"
                    :stroke-width="2"
                  />
                </div>
                <div class="flex flex-col min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="font-medium text-[13px] truncate">
                      {{ invite.email }}
                    </span>
                    <Pill variant="sky">
                      pending
                    </Pill>
                    <Pill variant="rose">
                      {{ invite.role }}
                    </Pill>
                  </div>
                  <span class="text-[11px] text-surface-500 truncate">
                    Invité par {{ invite.invitedByName }}
                  </span>
                </div>
                <div class="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm !text-rose-700"
                    :disabled="isSavingThis('adminTeam')"
                    @click="confirmCancelInvitation(invite.id, invite.email)"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            </div>
          </template>

          <div class="text-[11px] text-surface-500 flex items-center gap-1.5">
            <CircleAlert
              :size="12"
              :stroke-width="2"
            />
            <!-- TODO(security): refuse self-demote / last-admin via callable -->
            <span>
              "Retirer" est actuellement un stub côté repo (la callable
              <code class="font-mono text-[11px]">removeAdmin</code> avec garde anti
              last-admin / self-demote sera wired dans un chantier dédié).
            </span>
          </div>

          <div
            v-if="isSavedThis('adminTeam')"
            class="text-[12px] text-emerald-700 flex items-center gap-1"
          >
            <Check
              :size="14"
              :stroke-width="2"
            />
            Admin team mise à jour
          </div>
        </template>
      </div>
    </div>

    <!-- =================== Invite admin dialog =================== -->
    <Dialog
      v-model:visible="isInviteDialogOpen"
      modal
      :draggable="false"
      :style="{ width: '420px' }"
      header="Inviter un admin"
    >
      <div class="space-y-3 pt-1">
        <p class="text-[12px] text-surface-500">
          L'invité recevra un email d'invitation. À son acceptation, un compte
          Auth sera créé avec le rôle <code class="font-mono text-[11px]">admin</code>
          (cf. <code class="font-mono text-[11px]">/users.roles</code>).
        </p>
        <label class="block">
          <span class="text-[12px] text-surface-600">Email</span>
          <InputText
            v-model="inviteForm.email"
            class="mt-1 w-full"
            placeholder="prenom.nom@club.ch"
            :invalid="!!inviteError"
            @keyup.enter="submitInvite"
          />
          <span
            v-if="inviteError"
            class="text-[11px] text-rose-600 mt-1 block"
          >
            {{ inviteError }}
          </span>
        </label>
      </div>
      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          @click="closeInviteDialog"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="isSavingThis('adminTeam')"
          @click="submitInvite"
        >
          <Send
            :size="14"
            :stroke-width="2"
          />
          <template v-if="isSavingThis('adminTeam')">
            Envoi…
          </template>
          <template v-else>
            Envoyer l'invitation
          </template>
        </button>
      </template>
    </Dialog>

    <!-- =================== Manage roles dialog =================== -->
    <Dialog
      v-model:visible="rolesDialogOpen"
      modal
      :draggable="false"
      :style="{ width: '460px' }"
      header="Gérer les rôles"
    >
      <div
        v-if="rolesDialogTarget"
        class="space-y-3 pt-1"
      >
        <div class="flex items-center gap-2 text-[13px]">
          <Avatar
            :name="rolesDialogTarget.displayName"
            :size="28"
          />
          <div class="flex flex-col min-w-0">
            <span class="font-medium truncate">
              {{ rolesDialogTarget.displayName }}
            </span>
            <span class="text-[11px] text-surface-500 truncate">
              {{ rolesDialogTarget.email }}
            </span>
          </div>
        </div>

        <p class="text-[12px] text-surface-500">
          Les rôles sont cumulables (cf.
          <code class="font-mono text-[11px]">/users.roles</code>). `admin`
          est verrouillé ici — la révocation passe par "Retirer".
        </p>

        <div class="space-y-2">
          <label class="flex items-start gap-2 text-[13px]">
            <Checkbox
              :model-value="true"
              :binary="true"
              disabled
            />
            <div class="flex-1">
              <div class="font-medium">
                admin
              </div>
              <div class="text-[11px] text-surface-500">
                Accès complet à toute l'app (verrouillé depuis cette UI).
              </div>
            </div>
          </label>
          <label class="flex items-start gap-2 text-[13px]">
            <Checkbox
              v-model="rolesDialogTarget.coach"
              :binary="true"
            />
            <div class="flex-1">
              <div class="font-medium">
                coach
              </div>
              <div class="text-[11px] text-surface-500">
                Scope coach via <code class="font-mono text-[10px]">/users.teamIds</code>.
              </div>
            </div>
          </label>
          <label class="flex items-start gap-2 text-[13px]">
            <Checkbox
              v-model="rolesDialogTarget.official"
              :binary="true"
            />
            <div class="flex-1">
              <div class="font-medium">
                official
              </div>
              <div class="text-[11px] text-surface-500">
                Capacité officiel app (lié à <code class="font-mono text-[10px]">/members.officialLevel</code> côté métier).
              </div>
            </div>
          </label>
          <label class="flex items-start gap-2 text-[13px]">
            <Checkbox
              v-model="rolesDialogTarget.treasurer"
              :binary="true"
            />
            <div class="flex-1">
              <div class="font-medium">
                treasurer
              </div>
              <div class="text-[11px] text-surface-500">
                Marque les cotisations comme payées. <strong>Capability comité</strong>&nbsp;:
                peut aussi enregistrer un <strong>montant partiel</strong>
                (arrangement in extremis) — réservée à <code class="font-mono text-[10px]">rootAdmin</code>
                et <code class="font-mono text-[10px]">treasurer</code>.
              </div>
            </div>
          </label>
        </div>

        <div
          v-if="rolesDialogError"
          class="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2.5 py-2 flex items-center gap-2"
        >
          <TriangleAlert
            :size="13"
            :stroke-width="2"
          />
          {{ rolesDialogError }}
        </div>
      </div>
      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          @click="closeRolesDialog"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="isSavingThis('adminTeam')"
          @click="submitRolesDialog"
        >
          <template v-if="isSavingThis('adminTeam')">
            Sauvegarde…
          </template>
          <template v-else>
            Enregistrer
          </template>
        </button>
      </template>
    </Dialog>

    <!-- =================== Delete category dialog =================== -->
    <Dialog
      v-model:visible="isDeleteDialogOpen"
      modal
      :draggable="false"
      :style="{ width: '460px' }"
      header="Supprimer la catégorie"
    >
      <div
        v-if="deleteDialogTarget"
        class="space-y-3 pt-1"
      >
        <div class="flex items-center gap-2">
          <Layers
            :size="14"
            :stroke-width="2"
            class="text-surface-400"
          />
          <span class="font-medium text-[13px]">
            {{ deleteDialogTarget.name }}
          </span>
          <Pill variant="slate">
            {{ categoryAgeLabel(deleteDialogTarget) }}
          </Pill>
        </div>

        <p
          v-if="deleteDialogLoading"
          class="text-[12px] text-surface-500"
        >
          Vérification de l'usage…
        </p>
        <template v-else>
          <p
            v-if="deleteDialogUsageCount > 0"
            class="text-[13px] text-surface-700"
          >
            Cette catégorie est utilisée par
            <strong>{{ deleteDialogUsageCount }} équipe(s)</strong>. Tu ne peux
            pas la supprimer ; archive-la plutôt.
          </p>
          <p
            v-else-if="deleteDialogUsageCount === 0"
            class="text-[13px] text-surface-700"
          >
            Cette catégorie n'est référencée par aucune équipe. La suppression
            est définitive.
          </p>
          <p
            v-else
            class="text-[13px] text-rose-700"
          >
            Impossible de vérifier l'usage. Réessaie ou archive plutôt.
          </p>
        </template>
      </div>
      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          @click="closeDeleteCategoryDialog"
        >
          {{ deleteDialogUsageCount === 0 ? 'Annuler' : 'Fermer' }}
        </button>
        <button
          v-if="deleteDialogUsageCount > 0 && deleteDialogTarget?.active"
          type="button"
          class="btn btn-secondary btn-sm"
          @click="archiveFromDeleteDialog"
        >
          Archiver à la place
        </button>
        <button
          v-if="deleteDialogUsageCount === 0 && !deleteDialogLoading"
          type="button"
          class="btn btn-primary btn-sm !bg-rose-600 hover:!bg-rose-700"
          @click="confirmDeleteCategory"
        >
          <Trash2
            :size="14"
            :stroke-width="2"
          />
          Supprimer définitivement
        </button>
      </template>
    </Dialog>

    <!-- =================== Delete tag dialog =================== -->
    <Dialog
      v-model:visible="isDeleteTagDialogOpen"
      modal
      :draggable="false"
      :style="{ width: '460px' }"
      header="Supprimer le tag"
    >
      <div
        v-if="deleteTagDialogTarget"
        class="space-y-3 pt-1"
      >
        <div class="flex items-center gap-2">
          <TagIcon
            :size="14"
            :stroke-width="2"
            class="text-surface-400"
          />
          <Pill :variant="deleteTagDialogTarget.color">
            {{ deleteTagDialogTarget.name }}
          </Pill>
        </div>

        <p
          v-if="deleteTagDialogLoading"
          class="text-[12px] text-surface-500"
        >
          Vérification de l'usage…
        </p>
        <template v-else>
          <p
            v-if="deleteTagDialogUsageCount > 0"
            class="text-[13px] text-surface-700"
          >
            Ce tag est utilisé par
            <strong>{{ deleteTagDialogUsageCount }} équipe(s)</strong>. Tu ne
            peux pas le supprimer ; archive-le plutôt.
          </p>
          <p
            v-else-if="deleteTagDialogUsageCount === 0"
            class="text-[13px] text-surface-700"
          >
            Ce tag n'est référencé par aucune équipe. La suppression est
            définitive.
          </p>
          <p
            v-else
            class="text-[13px] text-rose-700"
          >
            Impossible de vérifier l'usage. Réessaie ou archive plutôt.
          </p>
        </template>
      </div>
      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          @click="closeDeleteTagDialog"
        >
          {{ deleteTagDialogUsageCount === 0 ? 'Annuler' : 'Fermer' }}
        </button>
        <button
          v-if="deleteTagDialogUsageCount > 0 && deleteTagDialogTarget?.active"
          type="button"
          class="btn btn-secondary btn-sm"
          @click="archiveFromDeleteTagDialog"
        >
          Archiver à la place
        </button>
        <button
          v-if="deleteTagDialogUsageCount === 0 && !deleteTagDialogLoading"
          type="button"
          class="btn btn-primary btn-sm !bg-rose-600 hover:!bg-rose-700"
          @click="confirmDeleteTag"
        >
          <Trash2
            :size="14"
            :stroke-width="2"
          />
          Supprimer définitivement
        </button>
      </template>
    </Dialog>

    <!-- =================== CotisationType create / edit dialog =================== -->
    <Dialog
      v-model:visible="isCotisationTypeDialogOpen"
      modal
      :draggable="false"
      :style="{ width: '520px' }"
      :header="isAddingCotisationType ? 'Créer un type de cotisation' : 'Modifier le type de cotisation'"
    >
      <div class="space-y-3 pt-1">
        <label class="block">
          <span class="text-[12px] text-surface-600">Nom</span>
          <InputText
            v-model="cotisationDraft.name"
            class="mt-1 w-full"
            placeholder="Ex. Junior"
          />
        </label>

        <label class="block">
          <span class="text-[12px] text-surface-600">Description</span>
          <Textarea
            v-model="cotisationDraft.description"
            rows="2"
            auto-resize
            class="mt-1 w-full"
            placeholder="Périmètre, conditions, …"
          />
        </label>

        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-[12px] text-surface-600">Prix (CHF / an / joueur)</span>
            <InputNumber
              v-model="cotisationDraft.price"
              :min="0"
              mode="currency"
              currency="CHF"
              locale="fr-CH"
              input-class="!w-full"
              class="mt-1 w-full"
            />
          </label>
          <label class="block">
            <span class="text-[12px] text-surface-600">
              Ordre <span class="text-surface-400">(opt.)</span>
            </span>
            <InputNumber
              v-model="cotisationDraft.displayOrder"
              :min="0"
              input-class="!w-full"
              class="mt-1 w-full"
            />
          </label>
        </div>

        <p
          v-if="cotisationError"
          class="text-[11px] text-rose-600"
        >
          {{ cotisationError }}
        </p>
      </div>
      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          @click="cancelCotisationTypeEdit"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          @click="commitCotisationType"
        >
          {{ isAddingCotisationType ? 'Créer' : 'Sauvegarder' }}
        </button>
      </template>
    </Dialog>

    <!-- =================== Delete cotisation type dialog =================== -->
    <Dialog
      v-model:visible="isDeleteCotisationTypeDialogOpen"
      modal
      :draggable="false"
      :style="{ width: '460px' }"
      header="Supprimer le type de cotisation"
    >
      <div
        v-if="deleteCotisationTypeDialogTarget"
        class="space-y-3 pt-1"
      >
        <div class="flex items-center gap-2 flex-wrap">
          <Banknote
            :size="14"
            :stroke-width="2"
            class="text-surface-400"
          />
          <span class="font-medium text-[13px]">
            {{ deleteCotisationTypeDialogTarget.name }}
          </span>
          <Pill variant="emerald">
            CHF {{ deleteCotisationTypeDialogTarget.price }}
          </Pill>
        </div>

        <p
          v-if="deleteCotisationTypeDialogLoading"
          class="text-[12px] text-surface-500"
        >
          Vérification de l'usage…
        </p>
        <template v-else>
          <p
            v-if="deleteCotisationTypeDialogUsageCount > 0"
            class="text-[13px] text-surface-700"
          >
            Ce type de cotisation est utilisé par
            <strong>{{ deleteCotisationTypeDialogUsageCount }} équipe(s)</strong>.
            Tu ne peux pas le supprimer ; archive-le plutôt.
          </p>
          <p
            v-else-if="deleteCotisationTypeDialogUsageCount === 0"
            class="text-[13px] text-surface-700"
          >
            Ce type de cotisation n'est référencé par aucune équipe. La
            suppression est définitive.
          </p>
          <p
            v-else
            class="text-[13px] text-rose-700"
          >
            Impossible de vérifier l'usage. Réessaie ou archive plutôt.
          </p>
        </template>
      </div>
      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          @click="closeDeleteCotisationTypeDialog"
        >
          {{ deleteCotisationTypeDialogUsageCount === 0 ? 'Annuler' : 'Fermer' }}
        </button>
        <button
          v-if="deleteCotisationTypeDialogUsageCount > 0 && deleteCotisationTypeDialogTarget?.active"
          type="button"
          class="btn btn-secondary btn-sm"
          @click="archiveFromDeleteCotisationTypeDialog"
        >
          Archiver à la place
        </button>
        <button
          v-if="deleteCotisationTypeDialogUsageCount === 0 && !deleteCotisationTypeDialogLoading"
          type="button"
          class="btn btn-primary btn-sm !bg-rose-600 hover:!bg-rose-700"
          @click="confirmDeleteCotisationType"
        >
          <Trash2
            :size="14"
            :stroke-width="2"
          />
          Supprimer définitivement
        </button>
      </template>
    </Dialog>

    <!-- =================== License type create / edit dialog =================== -->
    <Dialog
      v-model:visible="isLicenseTypeDialogOpen"
      modal
      :draggable="false"
      :style="{ width: '560px' }"
      :header="isAddingLicenseType ? 'Créer un type de licence' : 'Modifier le type de licence'"
    >
      <div class="space-y-3 pt-1">
        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-[12px] text-surface-600">Rôle</span>
            <Select
              v-model="licenseTypeDraft.role"
              :options="LICENSE_ROLE_OPTIONS"
              option-label="label"
              option-value="value"
              class="mt-1 w-full"
            />
          </label>
          <label class="block">
            <span class="text-[12px] text-surface-600">
              Ordre <span class="text-surface-400">(opt.)</span>
            </span>
            <InputNumber
              v-model="licenseTypeDraft.displayOrder"
              :min="0"
              input-class="!w-full"
              class="mt-1 w-full"
            />
          </label>
        </div>

        <label class="block">
          <span class="text-[12px] text-surface-600">Nom</span>
          <InputText
            v-model="licenseTypeDraft.name"
            class="mt-1 w-full"
            placeholder="Ex. Joueur Ligue A, Officiel J+S, …"
          />
        </label>

        <div class="grid grid-cols-2 gap-3">
          <label
            v-if="draftRoleRequiresLevel"
            class="block"
          >
            <span class="text-[12px] text-surface-600">Niveau</span>
            <InputNumber
              v-model="licenseTypeDraft.level"
              :min="0"
              input-class="!w-full"
              class="mt-1 w-full"
            />
          </label>
          <div
            v-else
            class="block text-[11px] text-surface-500 self-center"
          >
            Le rôle "Joueur" ne porte pas de niveau de licence ; les
            différentes licences joueurs sont distinguées par leur nom.
          </div>
          <label class="block">
            <span class="text-[12px] text-surface-600">Prix (CHF)</span>
            <InputNumber
              v-model="licenseTypeDraft.fee"
              :min="0"
              mode="currency"
              currency="CHF"
              locale="fr-CH"
              input-class="!w-full"
              class="mt-1 w-full"
            />
          </label>
        </div>

        <p
          v-if="licenseTypeError"
          class="text-[11px] text-rose-600"
        >
          {{ licenseTypeError }}
        </p>
      </div>
      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          @click="cancelLicenseTypeEdit"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          @click="commitLicenseType"
        >
          {{ isAddingLicenseType ? 'Créer' : 'Sauvegarder' }}
        </button>
      </template>
    </Dialog>

    <!-- =================== Delete license type dialog =================== -->
    <Dialog
      v-model:visible="isDeleteLicenseTypeDialogOpen"
      modal
      :draggable="false"
      :style="{ width: '460px' }"
      header="Supprimer le type de licence"
    >
      <div
        v-if="deleteLicenseTypeDialogTarget"
        class="space-y-3 pt-1"
      >
        <div class="flex items-center gap-2 flex-wrap">
          <BadgeCheck
            :size="14"
            :stroke-width="2"
            class="text-surface-400"
          />
          <span class="font-medium text-[13px]">
            {{ LICENSE_ROLE_LABEL[deleteLicenseTypeDialogTarget.role] }}
            — {{ deleteLicenseTypeDialogTarget.name }}
          </span>
          <Pill
            v-if="deleteLicenseTypeDialogTarget.level !== null"
            variant="sky"
          >
            Niveau {{ deleteLicenseTypeDialogTarget.level }}
          </Pill>
          <Pill variant="emerald">
            CHF {{ deleteLicenseTypeDialogTarget.fee }}
          </Pill>
        </div>
        <p class="text-[13px] text-surface-700">
          La suppression est définitive. Si tu hésites, archive plutôt — le
          type sera retiré des pickers de création de licence tout en restant
          résolvable sur l'historique.
        </p>
      </div>
      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          @click="closeDeleteLicenseTypeDialog"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm !bg-rose-600 hover:!bg-rose-700"
          @click="confirmDeleteLicenseType"
        >
          <Trash2
            :size="14"
            :stroke-width="2"
          />
          Supprimer définitivement
        </button>
      </template>
    </Dialog>

    <!-- =================== Match type create/edit dialog =================== -->
    <Dialog
      v-model:visible="isMatchTypeDialogOpen"
      modal
      :draggable="false"
      :style="{ width: '600px' }"
      :header="matchTypeDialogMode === 'edit' ? 'Éditer un type de match' : 'Nouveau type de match'"
    >
      <div class="space-y-4 pt-1">
        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-[12px] text-surface-600">Nom</span>
            <InputText
              v-model="matchTypeDraft.name"
              placeholder="Ex. CSJC, AFBB, Amical"
              class="mt-1 w-full"
            />
          </label>
          <label class="block">
            <span class="text-[12px] text-surface-600">Court requis</span>
            <Select
              v-model="matchTypeDraft.requiredCourtSize"
              :options="COURT_SIZE_OPTIONS"
              option-label="label"
              option-value="value"
              class="mt-1 w-full"
            />
          </label>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-[12px] text-surface-600">
              Officiels away
              <span class="text-surface-400">(nombre à fournir)</span>
            </span>
            <InputNumber
              v-model="matchTypeDraft.awayOfficialCount"
              :min="0"
              input-class="!w-full"
              class="mt-1 w-full"
            />
          </label>
          <div class="block">
            <span class="text-[12px] text-surface-600">Couleur (chip)</span>
            <div class="mt-1 flex items-center gap-2">
              <input
                v-model="matchTypeDraft.color"
                type="color"
                class="h-9 w-12 rounded border border-surface-200 cursor-pointer"
              >
              <InputText
                v-model="matchTypeDraft.color"
                placeholder="#10b981"
                class="flex-1"
              />
            </div>
          </div>
        </div>

        <!-- Home official requirements editor -->
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-2">
            <div>
              <span class="text-[12px] text-surface-600 font-medium">
                Officiels home
              </span>
              <p class="text-[11px] text-surface-400">
                Une ligne par niveau requis. Ex. "1 arbitre N2 + 2 arbitres N1".
              </p>
            </div>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              @click="addOfficialRequirement"
            >
              <Plus
                :size="14"
                :stroke-width="2"
              />
              Ajouter une exigence
            </button>
          </div>

          <div
            v-if="matchTypeDraft.homeOfficialRequirements.length === 0"
            class="text-[11px] text-surface-400 px-2 py-2 border border-dashed border-surface-200 rounded"
          >
            Aucune exigence — ce type ne demande pas d'officiel à domicile.
          </div>

          <div
            v-for="(req, idx) in matchTypeDraft.homeOfficialRequirements"
            :key="idx"
            class="flex items-center gap-2"
          >
            <label class="block">
              <span class="text-[11px] text-surface-500">Niveau</span>
              <InputNumber
                v-model="req.level"
                :min="0"
                input-class="!w-20"
                class="mt-0.5"
              />
            </label>
            <label class="block">
              <span class="text-[11px] text-surface-500">Quantité</span>
              <InputNumber
                v-model="req.count"
                :min="1"
                input-class="!w-20"
                class="mt-0.5"
              />
            </label>
            <button
              type="button"
              class="btn btn-ghost btn-sm !text-rose-700 self-end mb-0.5"
              @click="removeOfficialRequirement(idx)"
            >
              <Trash2
                :size="14"
                :stroke-width="2"
              />
            </button>
          </div>
        </div>

        <label class="flex items-center gap-2 cursor-pointer text-[12px]">
          <Checkbox
            v-model="matchTypeDraft.active"
            binary
            input-id="match-type-active"
          />
          <span>
            Type actif
            <span class="text-surface-400">
              (sinon, retiré des pickers de création de match)
            </span>
          </span>
        </label>

        <div
          v-if="matchTypeError"
          class="text-[11px] text-rose-600"
        >
          {{ matchTypeError }}
        </div>
      </div>
      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          @click="closeMatchTypeDialog"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          @click="commitMatchType"
        >
          {{ matchTypeDialogMode === 'edit' ? 'Sauvegarder' : 'Créer' }}
        </button>
      </template>
    </Dialog>

    <!-- =================== Delete match type dialog =================== -->
    <Dialog
      v-model:visible="isDeleteMatchTypeDialogOpen"
      modal
      :draggable="false"
      :style="{ width: '460px' }"
      header="Supprimer le type de match"
    >
      <div
        v-if="deleteMatchTypeDialogTarget"
        class="space-y-3 pt-1"
      >
        <div class="flex items-center gap-2 flex-wrap">
          <span
            class="inline-block h-3 w-3 rounded-full border border-surface-200 shrink-0"
            :style="{ backgroundColor: deleteMatchTypeDialogTarget.color }"
          />
          <span class="font-medium text-[13px]">
            {{ deleteMatchTypeDialogTarget.name }}
          </span>
          <Pill variant="slate">
            {{ COURT_SIZE_LABEL[deleteMatchTypeDialogTarget.requiredCourtSize] }}
          </Pill>
        </div>
        <p class="text-[13px] text-surface-700">
          La suppression est définitive. Si ce type est déjà utilisé par un
          ou plusieurs matchs, désactive-le plutôt — le type sera retiré des
          pickers de création tout en restant résolvable sur l'historique.
        </p>
        <div
          v-if="matchTypesStore.error"
          class="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5"
        >
          {{ matchTypesStore.error }}
        </div>
      </div>
      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          @click="closeDeleteMatchTypeDialog"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm !bg-rose-600 hover:!bg-rose-700"
          @click="confirmDeleteMatchType"
        >
          <Trash2
            :size="14"
            :stroke-width="2"
          />
          Supprimer définitivement
        </button>
      </template>
    </Dialog>

    <!-- =================== Error banner (global) =================== -->
    <div
      v-if="store.error"
      class="card border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700 flex items-center gap-2 mt-4"
    >
      <TriangleAlert
        :size="14"
        :stroke-width="2"
      />
      {{ store.error }}
      <button
        type="button"
        class="ml-auto btn btn-ghost btn-sm !text-rose-700"
        @click="store.error = null"
      >
        <X
          :size="14"
          :stroke-width="2"
        />
      </button>
    </div>
  </section>
</template>
