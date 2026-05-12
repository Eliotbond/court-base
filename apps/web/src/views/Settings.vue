<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  Banknote,
  Building2,
  CalendarX,
  Check,
  CircleAlert,
  Crown,
  Dribbble,
  Mail,
  Plus,
  Send,
  Siren,
  Tags,
  Trash2,
  TriangleAlert,
  Users,
  X,
} from 'lucide-vue-next'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import { useSettingsStore, type SettingsSection } from '@/stores/settings'
import Avatar from '@/components/ui/Avatar.vue'
import Pill from '@/components/ui/Pill.vue'
import RoleBadge from '@/components/ui/RoleBadge.vue'
import type {
  ClubAddress,
  DuesConfig,
  OfficialsConfig,
  Role,
  SubscriptionStatus,
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

const NAV_ITEMS: readonly NavItem[] = [
  { id: 'general', label: 'General', icon: Building2 },
  { id: 'officials', label: 'Officials', icon: Siren },
  { id: 'dues', label: 'Dues', icon: Banknote },
  { id: 'roles', label: 'Member roles', icon: Tags },
  { id: 'closurePeriods', label: 'Closure periods', icon: CalendarX },
  { id: 'adminTeam', label: 'Admin team', icon: Users },
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
</script>

<template>
  <section class="p-6">
    <div
      class="card overflow-hidden grid"
      style="grid-template-columns: 220px 1fr;"
    >
      <!-- =================== Vertical tabs =================== -->
      <aside class="border-r border-surface-200 p-3 bg-surface-50/40">
        <div
          class="text-[11px] uppercase tracking-wider text-surface-400 font-semibold px-2 pb-1.5"
        >
          Configuration
        </div>
        <button
          v-for="item in NAV_ITEMS"
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

          <!-- Logo placeholder -->
          <div
            class="border border-surface-200 rounded-md p-4 bg-surface-50/40 flex items-center gap-4"
          >
            <div
              class="w-14 h-14 rounded-md bg-emerald-600 text-white flex items-center justify-center"
            >
              <Dribbble
                :size="28"
                :stroke-width="2"
              />
            </div>
            <div class="flex-1">
              <div class="font-medium text-[14px]">
                Logo du club
              </div>
              <div class="text-[12px] text-surface-500">
                PNG ou SVG · 512×512 recommandé
              </div>
            </div>
            <!-- TODO(firestore): wire vers Firebase Storage `/club/logo.png` -->
            <button
              type="button"
              class="btn btn-secondary btn-sm"
            >
              Remplacer
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm !text-rose-700"
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
              class="px-3 py-6 text-center text-[12px] text-surface-500"
            >
              Aucun rôle configuré.
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
                <div class="flex items-center gap-2">
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
                    v-else
                    variant="rose"
                  >
                    admin
                  </Pill>
                </div>
                <span class="text-[11px] text-surface-500 truncate">
                  {{ admin.email }}
                </span>
              </div>
              <div class="ml-auto flex items-center gap-2">
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
