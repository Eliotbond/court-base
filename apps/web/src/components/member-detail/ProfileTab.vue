<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  CalendarDays,
  CircleAlert,
  Info,
  Link2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Power,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Unlink,
  Users as UsersIcon,
} from 'lucide-vue-next'
import InputText from 'primevue/inputtext'
import Dialog from 'primevue/dialog'
import DatePicker from 'primevue/datepicker'
import MultiSelect from 'primevue/multiselect'
import { useAuthStore } from '@/stores/auth'
import { useMembersStore } from '@/stores/members'
import { useMemberDetailStore } from '@/stores/memberDetail'
import type {
  MemberDetailRow,
  GuardianRef,
} from '@/repositories/members.repo'
import type {
  CommsRecipient,
  Timestamp,
  UserAddress,
} from '@club-app/shared-types'
import Avatar from '@/components/ui/Avatar.vue'
import Pill from '@/components/ui/Pill.vue'
import LinkUserDialog from '@/components/member-detail/LinkUserDialog.vue'
import DeleteMemberDialog from '@/components/member-detail/DeleteMemberDialog.vue'
import MemberPhotoSection from '@/components/member-detail/MemberPhotoSection.vue'

defineProps<{
  memberId: string
  member: MemberDetailRow | null
  canEdit: boolean
}>()

/**
 * Émis lorsque le membre vient d'être supprimé définitivement (callable
 * `deleteMember`). Le parent (`MemberDetail.vue`) navigue vers la liste —
 * cette tab ne route pas elle-même pour rester réutilisable.
 */
const emit = defineEmits<{
  (e: 'deleted', memberId: string): void
}>()

const store = useMemberDetailStore()
const membersStore = useMembersStore()
const auth = useAuthStore()

/**
 * Zone de danger réservée aux admins (pas coach / treasurer). On regarde le
 * rôle dans `/users/{uid}.roles` ET le claim rootAdmin (qui by-pass tout).
 * Découplé du prop `canEdit` (qui inclut treasurer dans certaines vues) pour
 * verrouiller spécifiquement la suppression définitive.
 */
const isAdmin = computed<boolean>(
  () => (auth.userDoc?.roles.includes('admin') ?? false) || auth.rootAdmin,
)

/**
 * Helpers pour la photo licence (cf. docs/members/license-photo.md §Affichage
 * apps/web). Édition autorisée à admin/rootAdmin/treasurer/coach-of-member ;
 * suppression réservée à admin/rootAdmin (le coach peut remplacer mais pas
 * supprimer purement).
 *
 * `coach-of-member` est dérivé du chevauchement entre `user.teamIds`
 * (canonique, cf. mémoire `[[teamids-canonical]]`) et les `teams` du membre.
 * Pour ne pas dépendre du paramètre `canEdit` du parent (qui n'inclut pas
 * forcément treasurer/coach), on recompose le gating localement.
 */
const isTreasurer = computed<boolean>(
  () => auth.userDoc?.roles.includes('treasurer') ?? false,
)
const isCoachOfThisMember = computed<boolean>(() => {
  if (!store.member) return false
  if (!auth.userDoc?.roles.includes('coach')) return false
  const callerTeamIds = new Set(auth.userDoc?.teamIds ?? [])
  return store.member.teams.some((t) => callerTeamIds.has(t.id))
})
const canEditPhoto = computed<boolean>(
  () =>
    auth.rootAdmin ||
    isAdmin.value ||
    isTreasurer.value ||
    isCoachOfThisMember.value,
)
const canDeletePhoto = computed<boolean>(() => isAdmin.value)

async function onPhotoUpdated(_: { storagePath: string }): Promise<void> {
  if (!store.member) return
  // Le store a déjà reload member après uploadPhoto, donc on émet juste pour
  // tracer (logs) — pas de second reload pour éviter le double round-trip.
  console.info(
    `[ProfileTab] member photo updated for ${store.member.id}`,
  )
}

async function onPhotoRemoved(): Promise<void> {
  if (!store.member) return
  console.info(
    `[ProfileTab] member photo removed for ${store.member.id}`,
  )
}

// ---------------------------------------------------------------------------
// Helpers locaux
//
// `MAJORITY_AGE_YEARS` est dupliqué ici (présent aussi dans repo + store) :
// pas de constants partagé pour cette valeur ; OK car c'est une règle légale
// stable et chaque consumer l'utilise pour de l'affichage local.
// ---------------------------------------------------------------------------

const MAJORITY_AGE_YEARS = 18

function tsToDate(ts: Timestamp | null): Date | null {
  if (!ts) return null
  return new Date(ts.seconds * 1000 + Math.floor(ts.nanoseconds / 1_000_000))
}

function isMinor(ts: Timestamp | null, now: number = Date.now()): boolean {
  if (!ts) return false
  const cutoff = new Date(now)
  cutoff.setFullYear(cutoff.getFullYear() - MAJORITY_AGE_YEARS)
  return ts.seconds * 1000 > cutoff.getTime()
}

/** Format FR-CH long : "15 mars 2008". */
function formatBirthDate(ts: Timestamp | null): string {
  const d = tsToDate(ts)
  if (!d) return ''
  return d.toLocaleDateString('fr-CH', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

const memberIsMinor = computed(() =>
  store.member ? isMinor(store.member.birthDate) : false,
)

// ---------------------------------------------------------------------------
// Contact edit dialog — inchangé (déjà en place avant le chantier majorité).
// ---------------------------------------------------------------------------

const isContactDialogOpen = ref(false)
const contactForm = ref({ email: '', phone: '' })

function openContactDialog(): void {
  if (!store.member) return
  contactForm.value = {
    email: store.member.email ?? '',
    phone: store.member.phone ?? '',
  }
  isContactDialogOpen.value = true
}

async function submitContact(): Promise<void> {
  await store.applyContactPatch({
    email: contactForm.value.email.trim(),
    phone: contactForm.value.phone.trim(),
  })
  if (!store.error) {
    isContactDialogOpen.value = false
  }
}

// ---------------------------------------------------------------------------
// Birthdate edit dialog — admin only.
//
// On passe par `membersStore.setBirthDate` (qui ré-aligne les defaults comms
// si pas de transition en cours, cf. repo `updateMember`) puis on recharge
// la vue détail.
// ---------------------------------------------------------------------------

const isBirthDateDialogOpen = ref(false)
const birthDateForm = ref<Date | null>(null)
const birthDateError = ref<string | null>(null)
const isSavingBirthDate = ref(false)

function openBirthDateDialog(): void {
  if (!store.member) return
  birthDateForm.value = tsToDate(store.member.birthDate)
  birthDateError.value = null
  isBirthDateDialogOpen.value = true
}

async function submitBirthDate(): Promise<void> {
  if (!store.member) return
  const v = birthDateForm.value
  // Validation simple : la date ne peut pas être dans le futur. Pas de borne
  // basse (un membre peut être très âgé).
  if (v && v.getTime() > Date.now()) {
    birthDateError.value = 'La date ne peut pas être dans le futur.'
    return
  }
  isSavingBirthDate.value = true
  const ok = await membersStore.setBirthDate(store.member.id, v)
  if (ok) {
    await store.load(store.member.id)
    isBirthDateDialogOpen.value = false
  } else {
    birthDateError.value =
      membersStore.error ?? 'Erreur lors de la mise à jour.'
  }
  isSavingBirthDate.value = false
}

function clearBirthDate(): void {
  birthDateForm.value = null
}

// ---------------------------------------------------------------------------
// AVS edit dialog — admin only.
//
// Format suisse 756.XXXX.XXXX.XX (13 chiffres groupés). Optionnel : un membre
// peut ne pas avoir de n° AVS (ex. réfugié en cours de procédure d'asile).
// ---------------------------------------------------------------------------

const AVS_REGEX = /^756\.\d{4}\.\d{4}\.\d{2}$/

const isAvsDialogOpen = ref(false)
const avsForm = ref<string>('')
const avsError = ref<string | null>(null)
const isSavingAvs = ref(false)

function openAvsDialog(): void {
  if (!store.member) return
  avsForm.value = store.member.avs ?? ''
  avsError.value = null
  isAvsDialogOpen.value = true
}

async function submitAvs(): Promise<void> {
  if (!store.member) return
  const trimmed = avsForm.value.trim()
  if (trimmed && !AVS_REGEX.test(trimmed)) {
    avsError.value = 'Format attendu : 756.XXXX.XXXX.XX'
    return
  }
  isSavingAvs.value = true
  const ok = await membersStore.setAvs(store.member.id, trimmed || null)
  if (ok) {
    await store.load(store.member.id)
    isAvsDialogOpen.value = false
  } else {
    avsError.value =
      membersStore.error ?? 'Erreur lors de la mise à jour.'
  }
  isSavingAvs.value = false
}

function clearAvs(): void {
  avsForm.value = ''
}

// ---------------------------------------------------------------------------
// Comptes liés — un seul dialog unifié `LinkUserDialog` pour lier un
// /users/{uid} comme propriétaire (member.linkedUserId) OU comme tuteur
// (member.guardianUserIds). Les retraits restent inline ci-dessous.
// ---------------------------------------------------------------------------

const isLinkUserDialogOpen = ref(false)

function openLinkUserDialog(): void {
  isLinkUserDialogOpen.value = true
}

// ---------------------------------------------------------------------------
// Guardians — remove (confirm). L'ajout passe par `LinkUserDialog`.
// ---------------------------------------------------------------------------

const guardianToRemove = ref<GuardianRef | null>(null)
const isRemovingGuardian = ref(false)

function askRemoveGuardian(g: GuardianRef): void {
  guardianToRemove.value = g
}

async function confirmRemoveGuardian(): Promise<void> {
  if (!store.member || !guardianToRemove.value) return
  isRemovingGuardian.value = true
  const ok = await membersStore.removeGuardian(
    store.member.id,
    guardianToRemove.value.uid,
  )
  if (ok) {
    await store.load(store.member.id)
    guardianToRemove.value = null
  }
  isRemovingGuardian.value = false
}

function guardianLabel(g: GuardianRef): string {
  return g.displayName || g.email || `uid: ${g.uid}`
}

/**
 * Format compact d'une adresse : `street, zip city (country)`.
 * Gère les cas dégénérés où seuls quelques champs sont renseignés.
 */
function formatAddress(addr: UserAddress | null): string {
  if (!addr) return ''
  const street = addr.street?.trim() ?? ''
  const zip = addr.zip?.trim() ?? ''
  const city = addr.city?.trim() ?? ''
  const country = addr.country?.trim() ?? ''
  const cityLine = [zip, city].filter(Boolean).join(' ')
  const parts: string[] = []
  if (street) parts.push(street)
  if (cityLine) parts.push(cityLine)
  let result = parts.join(', ')
  if (country) {
    result = result ? `${result} (${country})` : `(${country})`
  }
  return result
}

// ---------------------------------------------------------------------------
// Owner unlink — délie le compte propriétaire du membre. Confirmation inline
// en deux clics (pas de sub-dialog). La liaison, elle, passe par `LinkUserDialog`.
// ---------------------------------------------------------------------------

const confirmUnlinkOwner = ref(false)
const isUnlinkingOwner = ref(false)

function askUnlinkOwner(): void {
  confirmUnlinkOwner.value = true
}

function cancelUnlinkOwner(): void {
  confirmUnlinkOwner.value = false
}

async function confirmUnlinkOwnerAction(): Promise<void> {
  if (!store.member) return
  isUnlinkingOwner.value = true
  const ok = await membersStore.setLinkedUser(store.member.id, null)
  if (ok) {
    await store.load(store.member.id)
    confirmUnlinkOwner.value = false
  }
  isUnlinkingOwner.value = false
}

// ---------------------------------------------------------------------------
// Toggle Actif / Inactif — `member.active` pilote l'accès à l'app mobile
// (enforced par firestore.rules). Distinct de l'archive (`status`).
//
// Passage en INACTIF → confirmation (le membre perd l'accès mobile).
// Passage en ACTIF → pas de confirmation.
// ---------------------------------------------------------------------------

const isDeactivateConfirmOpen = ref(false)
const isTogglingActive = ref(false)

function onToggleActive(): void {
  if (!store.member) return
  if (store.member.active) {
    // Actif → inactif : on demande confirmation.
    isDeactivateConfirmOpen.value = true
  } else {
    // Inactif → actif : pas de confirmation.
    void setActive(true)
  }
}

async function setActive(active: boolean): Promise<void> {
  if (!store.member) return
  isTogglingActive.value = true
  const ok = await membersStore.setMemberActive(store.member.id, active)
  if (ok) {
    await store.load(store.member.id)
    isDeactivateConfirmOpen.value = false
  }
  isTogglingActive.value = false
}

// ---------------------------------------------------------------------------
// Comms — édition billing / general recipients.
//
// La transition à la majorité (`comms.majorityTransition`) verrouille la
// `generalRecipients` (pilotée par Cloud Functions). `billingRecipients`
// reste éditable.
//
// Validation : min 1 destinataire (sinon plus personne ne reçoit les comms).
// ---------------------------------------------------------------------------

interface CommsOption {
  label: string
  value: CommsRecipient
}

const COMMS_OPTIONS: ReadonlyArray<CommsOption> = [
  { label: 'Membre', value: 'member' },
  { label: 'Tuteurs', value: 'guardians' },
] as const

const transitionPending = computed<boolean>(() => {
  if (!store.member) return false
  const t = store.member.comms?.majorityTransition
  return !!t && t.resolvedAt == null
})

const billingDraft = ref<CommsRecipient[]>([])
const generalDraft = ref<CommsRecipient[]>([])
const commsError = ref<string | null>(null)
const isSavingComms = ref(false)
const isEditingComms = ref(false)

function startEditComms(): void {
  if (!store.member) return
  billingDraft.value = [...(store.member.comms?.billingRecipients ?? [])]
  generalDraft.value = [...(store.member.comms?.generalRecipients ?? [])]
  commsError.value = null
  isEditingComms.value = true
}

function cancelEditComms(): void {
  isEditingComms.value = false
  commsError.value = null
}

async function saveComms(): Promise<void> {
  if (!store.member) return
  // Validation : au moins une cible côté billing.
  if (billingDraft.value.length === 0) {
    commsError.value =
      'Choisis au moins un destinataire pour la facturation.'
    return
  }
  // Idem côté general — mais seulement si la transition n'est pas pending
  // (sinon le champ est read-only et on ne le sauvegarde pas).
  if (!transitionPending.value && generalDraft.value.length === 0) {
    commsError.value =
      'Choisis au moins un destinataire pour les comms générales.'
    return
  }
  isSavingComms.value = true
  const patch: { billingRecipients: CommsRecipient[]; generalRecipients?: CommsRecipient[] } = {
    billingRecipients: billingDraft.value,
  }
  if (!transitionPending.value) {
    patch.generalRecipients = generalDraft.value
  }
  const ok = await membersStore.setComms(store.member.id, patch)
  if (ok) {
    await store.load(store.member.id)
    isEditingComms.value = false
  } else {
    commsError.value =
      membersStore.error ?? 'Erreur lors de la mise à jour.'
  }
  isSavingComms.value = false
}

function recipientLabel(r: CommsRecipient): string {
  return r === 'member' ? 'Membre' : 'Tuteurs'
}

// ---------------------------------------------------------------------------
// Majority transition — affichage state machine.
//
// Steps :
//   1. Tuteurs notifiés (toujours quand transition.triggeredAt présent).
//   2. Réponse des tuteurs (yes/no).
//   3. Confirmation du membre (only si guardians.answer === 'yes').
// ---------------------------------------------------------------------------

interface TransitionStep {
  label: string
  status: 'done' | 'pending'
  detail?: string
}

const transitionSteps = computed<readonly TransitionStep[]>(() => {
  if (!store.member) return []
  const t = store.member.comms?.majorityTransition
  if (!t) return []

  const steps: TransitionStep[] = [
    { label: 'Tuteurs notifiés', status: 'done' },
  ]

  if (t.guardiansResponse) {
    steps.push({
      label: 'Tuteurs ont répondu',
      status: 'done',
      detail: t.guardiansResponse.answer === 'yes' ? 'oui' : 'non',
    })
    if (t.guardiansResponse.answer === 'yes') {
      if (t.memberResponse) {
        steps.push({
          label: 'Membre a confirmé',
          status: 'done',
          detail: t.memberResponse.answer === 'yes' ? 'oui' : 'non',
        })
      } else {
        steps.push({
          label: 'En attente confirmation du membre',
          status: 'pending',
        })
      }
    }
  } else {
    steps.push({
      label: 'En attente réponse des tuteurs',
      status: 'pending',
    })
  }
  return steps
})

// ---------------------------------------------------------------------------
// Derived for display
// ---------------------------------------------------------------------------

const commsBillingLabel = computed<string>(() => {
  if (!store.member?.comms) return '—'
  const list = store.member.comms.billingRecipients
  if (list.length === 0) return '—'
  return list.map(recipientLabel).join(' + ')
})

const commsGeneralLabel = computed<string>(() => {
  if (!store.member?.comms) return '—'
  const list = store.member.comms.generalRecipients
  if (list.length === 0) return '—'
  return list.map(recipientLabel).join(' + ')
})

// ---------------------------------------------------------------------------
// Suppression définitive (zone de danger) — admin only.
//
// Le dialog gère lui-même la confirmation par nom + l'appel callable. À la
// réception de `deleted`, on émet vers le parent (`MemberDetail.vue`) qui
// fait la navigation router vers la liste — on ne route pas ici.
// ---------------------------------------------------------------------------

const isDeleteDialogOpen = ref(false)

function openDeleteDialog(): void {
  isDeleteDialogOpen.value = true
}

function onDeleted(memberId: string): void {
  isDeleteDialogOpen.value = false
  emit('deleted', memberId)
}
</script>

<template>
  <div
    v-if="store.member"
    class="grid gap-4 md:grid-cols-2"
  >
    <!-- ============== Identité ============== -->
    <div class="card p-5 space-y-3">
      <div class="flex items-center justify-between">
        <h2 class="text-[14px] font-semibold flex items-center gap-2">
          Identité
          <Pill
            v-if="memberIsMinor"
            variant="amber"
          >
            Mineur
          </Pill>
        </h2>
      </div>
      <dl class="text-[13px] space-y-2">
        <div class="flex">
          <dt class="w-32 text-surface-500">
            Prénom
          </dt>
          <dd>{{ store.member.firstName }}</dd>
        </div>
        <div class="flex">
          <dt class="w-32 text-surface-500">
            Nom
          </dt>
          <dd>{{ store.member.lastName }}</dd>
        </div>
        <div class="flex items-start">
          <dt class="w-32 text-surface-500 flex items-center gap-1">
            <CalendarDays
              :size="12"
              :stroke-width="2"
            />
            Naissance
          </dt>
          <dd class="flex-1 flex items-center justify-between gap-2">
            <span v-if="store.member.birthDate">
              {{ formatBirthDate(store.member.birthDate) }}
            </span>
            <span
              v-else
              class="inline-flex items-center gap-1 text-amber-700"
            >
              <TriangleAlert
                :size="12"
                :stroke-width="2"
              />
              Non renseignée
            </span>
            <button
              v-if="canEdit"
              type="button"
              class="btn btn-ghost btn-sm !h-6 !px-2"
              :disabled="store.saving"
              @click="openBirthDateDialog"
            >
              <Pencil
                :size="12"
                :stroke-width="2"
              />
            </button>
          </dd>
        </div>
        <div class="flex">
          <dt class="w-32 text-surface-500">
            N° de licence
          </dt>
          <dd class="font-mono">
            {{ store.member.licenseNumber || '—' }}
          </dd>
        </div>
        <div class="flex items-start">
          <dt class="w-32 text-surface-500">
            N° AVS
          </dt>
          <dd class="flex-1 flex items-center justify-between gap-2">
            <span
              v-if="store.member.avs"
              class="font-mono"
            >{{ store.member.avs }}</span>
            <span
              v-else
              class="text-surface-400"
            >—</span>
            <button
              v-if="canEdit"
              type="button"
              class="btn btn-ghost btn-sm !h-6 !px-2"
              :disabled="store.saving"
              @click="openAvsDialog"
            >
              <Pencil
                :size="12"
                :stroke-width="2"
              />
            </button>
          </dd>
        </div>
        <div class="flex items-start">
          <dt class="w-32 text-surface-500">
            Statut
          </dt>
          <dd class="flex-1 flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5 flex-wrap">
              <Pill :variant="store.member.active ? 'emerald' : 'amber'">
                {{ store.member.active ? 'Actif' : 'Inactif' }}
              </Pill>
              <Pill
                v-if="store.member.status === 'archived'"
                variant="rose"
              >
                Archivé
              </Pill>
            </div>
            <button
              v-if="canEdit"
              type="button"
              class="btn btn-ghost btn-sm !h-6 !px-2"
              :class="store.member.active ? '!text-amber-700' : '!text-emerald-700'"
              :disabled="store.saving || isTogglingActive"
              @click="onToggleActive"
            >
              <Power
                :size="12"
                :stroke-width="2"
              />
              {{ store.member.active ? 'Désactiver' : 'Activer' }}
            </button>
          </dd>
        </div>
      </dl>
    </div>

    <!-- ============== Photo licence ============== -->
    <div class="card p-5 space-y-3 md:col-span-2">
      <h2 class="text-[14px] font-semibold">
        Photo licence
      </h2>
      <MemberPhotoSection
        :member-id="store.member.id"
        :photo-storage-path="store.member.photoStoragePath ?? null"
        :photo-updated-at="store.member.photoUpdatedAt ?? null"
        :can-edit="canEditPhoto"
        :can-delete="canDeletePhoto"
        @updated="onPhotoUpdated"
        @removed="onPhotoRemoved"
      />
    </div>

    <!-- ============== Contact ============== -->
    <div class="card p-5 space-y-3">
      <div class="flex items-center justify-between">
        <h2 class="text-[14px] font-semibold">
          Contact
        </h2>
        <button
          v-if="canEdit"
          type="button"
          class="btn btn-ghost btn-sm"
          :disabled="store.saving"
          @click="openContactDialog"
        >
          <Pencil
            :size="12"
            :stroke-width="2"
          />
          Modifier
        </button>
      </div>
      <dl class="text-[13px] space-y-2">
        <div class="flex items-center">
          <dt class="w-32 text-surface-500 flex items-center gap-1">
            <Mail
              :size="12"
              :stroke-width="2"
            />
            Email
          </dt>
          <dd v-if="store.member.email">
            <a
              :href="`mailto:${store.member.email}`"
              class="hover:underline"
            >
              {{ store.member.email }}
            </a>
          </dd>
          <dd
            v-else
            class="text-surface-400"
          >
            —
          </dd>
        </div>
        <div class="flex items-center">
          <dt class="w-32 text-surface-500 flex items-center gap-1">
            <Phone
              :size="12"
              :stroke-width="2"
            />
            Téléphone
          </dt>
          <dd v-if="store.member.phone">
            {{ store.member.phone }}
          </dd>
          <dd
            v-else
            class="text-surface-400"
          >
            —
          </dd>
        </div>
      </dl>
    </div>

    <!-- ============== Tuteurs ============== -->
    <div class="card p-5 space-y-3 md:col-span-2">
      <div class="flex items-center justify-between flex-wrap gap-2">
        <h2 class="text-[14px] font-semibold flex items-center gap-2">
          <ShieldCheck
            :size="14"
            :stroke-width="2"
          />
          Tuteurs
          <span class="text-[11px] font-normal text-surface-500 num">
            ({{ store.member.guardians.length }})
          </span>
        </h2>
        <button
          v-if="canEdit"
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="store.saving"
          @click="openLinkUserDialog"
        >
          <Link2
            :size="13"
            :stroke-width="2"
          />
          Lier un user
        </button>
      </div>

      <!-- Liste -->
      <div
        v-if="store.member.guardians.length > 0"
        class="divide-y divide-surface-100"
      >
        <div
          v-for="g in store.member.guardians"
          :key="g.uid"
          class="py-2 flex items-start gap-3"
        >
          <Avatar
            :name="guardianLabel(g)"
            :size="32"
          />
          <div class="flex-1 min-w-0 space-y-0.5">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-[13px] font-medium truncate">
                {{ g.displayName || '(nom non renseigné)' }}
              </span>
              <Pill
                v-if="g.profileCompletedAt"
                variant="emerald"
              >
                Profil complété
              </Pill>
              <Pill
                v-else
                variant="amber"
              >
                Profil incomplet
              </Pill>
            </div>
            <div class="text-[11px] text-surface-500 truncate flex items-center gap-1">
              <Mail
                :size="11"
                :stroke-width="2"
              />
              <span>{{ g.email || `uid: ${g.uid}` }}</span>
            </div>
            <div
              v-if="g.phone"
              class="text-[11px] text-surface-500 truncate flex items-center gap-1"
            >
              <Phone
                :size="11"
                :stroke-width="2"
              />
              <span>{{ g.phone }}</span>
            </div>
            <div
              v-if="g.address && formatAddress(g.address)"
              class="text-[11px] text-surface-500 truncate flex items-center gap-1"
            >
              <MapPin
                :size="11"
                :stroke-width="2"
              />
              <span>{{ formatAddress(g.address) }}</span>
            </div>
          </div>
          <button
            v-if="canEdit"
            type="button"
            class="btn btn-ghost btn-sm !text-rose-700"
            :disabled="store.saving"
            @click="askRemoveGuardian(g)"
          >
            <Trash2
              :size="12"
              :stroke-width="2"
            />
            Retirer
          </button>
        </div>
      </div>

      <!-- Empty state -->
      <div
        v-else
        class="rounded border border-dashed border-surface-200 px-4 py-6 text-center"
      >
        <p class="text-[13px] text-surface-500">
          Aucun tuteur lié à ce membre.
        </p>
        <p
          v-if="memberIsMinor"
          class="text-[12px] text-amber-700 mt-2 inline-flex items-center gap-1"
        >
          <CircleAlert
            :size="12"
            :stroke-width="2"
          />
          Ce membre est mineur — un tuteur devrait être associé pour recevoir
          les comms.
        </p>
      </div>
    </div>

    <!-- ============== Communications ============== -->
    <div class="card p-5 space-y-3 md:col-span-2">
      <div class="flex items-center justify-between flex-wrap gap-2">
        <h2 class="text-[14px] font-semibold">
          Communications
        </h2>
        <div
          v-if="canEdit && !isEditingComms"
          class="flex items-center gap-2"
        >
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            :disabled="store.saving"
            @click="startEditComms"
          >
            <Pencil
              :size="12"
              :stroke-width="2"
            />
            Modifier
          </button>
        </div>
      </div>

      <!-- Transition à la majorité (info panel) -->
      <div
        v-if="transitionPending"
        class="rounded border border-sky-200 bg-sky-50 px-4 py-3 space-y-2"
      >
        <div class="flex items-center gap-2 text-[13px] font-medium text-sky-800">
          <Info
            :size="14"
            :stroke-width="2"
          />
          Transition à la majorité en cours
        </div>
        <ul class="text-[12px] text-sky-900 space-y-1">
          <li
            v-for="(step, idx) in transitionSteps"
            :key="idx"
            class="flex items-center gap-2"
          >
            <span
              class="inline-flex w-4 h-4 items-center justify-center text-[12px] leading-none"
              :class="step.status === 'done' ? 'text-emerald-600' : 'text-sky-500'"
            >
              {{ step.status === 'done' ? '✓' : '○' }}
            </span>
            <span>
              {{ step.label }}
              <span
                v-if="step.detail"
                class="text-sky-700 font-medium"
              >: {{ step.detail }}</span>
            </span>
          </li>
        </ul>
        <p class="text-[11px] text-sky-700">
          Les destinataires des comms générales sont verrouillés tant que la
          transition n'est pas résolue.
        </p>
      </div>

      <!-- Affichage lecture -->
      <dl
        v-if="!isEditingComms"
        class="text-[13px] space-y-2"
      >
        <div class="flex items-start">
          <dt class="w-44 text-surface-500">
            Factures
          </dt>
          <dd class="flex flex-wrap gap-1">
            <Pill
              v-for="r in store.member.comms?.billingRecipients ?? []"
              :key="`b-${r}`"
              variant="sky"
            >
              {{ recipientLabel(r) }}
            </Pill>
            <span
              v-if="(store.member.comms?.billingRecipients ?? []).length === 0"
              class="text-surface-400"
            >—</span>
          </dd>
        </div>
        <div class="flex items-start">
          <dt class="w-44 text-surface-500">
            Comms générales
          </dt>
          <dd class="flex flex-wrap gap-1">
            <Pill
              v-for="r in store.member.comms?.generalRecipients ?? []"
              :key="`g-${r}`"
              variant="violet"
            >
              {{ recipientLabel(r) }}
            </Pill>
            <span
              v-if="(store.member.comms?.generalRecipients ?? []).length === 0"
              class="text-surface-400"
            >—</span>
          </dd>
        </div>
        <p class="text-[11px] text-surface-500">
          Routage : <span class="font-medium">factures</span> → {{ commsBillingLabel }} ·
          <span class="font-medium">général</span> → {{ commsGeneralLabel }}
        </p>
      </dl>

      <!-- Édition -->
      <div
        v-else
        class="space-y-3"
      >
        <label class="block">
          <span class="text-[12px] text-surface-600">Destinataires des factures</span>
          <MultiSelect
            v-model="billingDraft"
            :options="[...COMMS_OPTIONS]"
            option-label="label"
            option-value="value"
            display="chip"
            class="mt-1 w-full"
            placeholder="Sélectionner…"
          />
        </label>
        <label class="block">
          <span class="text-[12px] text-surface-600 flex items-center gap-1">
            Destinataires des comms générales
            <span
              v-if="transitionPending"
              title="Modifiable une fois la transition résolue"
              class="inline-flex items-center gap-1 text-[11px] text-amber-700"
            >
              <CircleAlert
                :size="11"
                :stroke-width="2"
              />
              verrouillé
            </span>
          </span>
          <MultiSelect
            v-model="generalDraft"
            :options="[...COMMS_OPTIONS]"
            option-label="label"
            option-value="value"
            display="chip"
            class="mt-1 w-full"
            placeholder="Sélectionner…"
            :disabled="transitionPending"
          />
        </label>
        <p
          v-if="commsError"
          class="text-[12px] text-rose-600"
        >
          {{ commsError }}
        </p>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            :disabled="isSavingComms"
            @click="cancelEditComms"
          >
            Annuler
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="isSavingComms"
            @click="saveComms"
          >
            <template v-if="isSavingComms">
              Enregistrement…
            </template>
            <template v-else>
              Enregistrer
            </template>
          </button>
        </div>
      </div>
    </div>

    <!-- ============== Rôles ============== -->
    <div class="card p-5 space-y-3">
      <h2 class="text-[14px] font-semibold">
        Rôles club
      </h2>
      <p class="text-[12px] text-surface-500">
        Les rôles sont cumulables (cf. <code class="font-mono text-[11px]">/members.roles</code>).
        L'édition complète (ajout / retrait, niveau official, licence) sera
        wired dans un drawer dédié.
      </p>
      <div class="flex flex-wrap gap-1.5">
        <span
          v-for="role in store.member.roles"
          :key="role"
          class="inline-flex h-6 px-2 rounded text-[11px] font-medium bg-surface-100 text-surface-700"
        >
          {{ role }}
        </span>
        <span
          v-if="store.member.roles.length === 0"
          class="text-surface-400 text-[12px]"
        >
          aucun rôle assigné
        </span>
      </div>
    </div>

    <!-- ============== Compte Auth ============== -->
    <div class="card p-5 space-y-3">
      <div class="flex items-center justify-between flex-wrap gap-2">
        <h2 class="text-[14px] font-semibold flex items-center gap-2">
          <UsersIcon
            :size="14"
            :stroke-width="2"
          />
          Compte Firebase Auth
        </h2>
        <div
          v-if="canEdit"
          class="flex items-center gap-2"
        >
          <button
            v-if="store.member.linkedUserId"
            type="button"
            class="btn btn-ghost btn-sm !text-rose-700"
            :disabled="store.saving || isUnlinkingOwner"
            @click="confirmUnlinkOwner ? confirmUnlinkOwnerAction() : askUnlinkOwner()"
          >
            <Unlink
              :size="12"
              :stroke-width="2"
            />
            <template v-if="isUnlinkingOwner">
              Détachement…
            </template>
            <template v-else-if="confirmUnlinkOwner">
              Confirmer le détachement
            </template>
            <template v-else>
              Délier
            </template>
          </button>
          <button
            v-if="confirmUnlinkOwner"
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="isUnlinkingOwner"
            @click="cancelUnlinkOwner"
          >
            Annuler
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            :disabled="store.saving"
            @click="openLinkUserDialog"
          >
            <Link2
              :size="12"
              :stroke-width="2"
            />
            {{ store.member.linkedUserId ? 'Remplacer' : 'Lier un user' }}
          </button>
        </div>
      </div>
      <template v-if="store.member.linkedUser">
        <dl class="text-[13px] space-y-2">
          <div class="flex items-center">
            <dt class="w-32 text-surface-500">
              Display name
            </dt>
            <dd class="flex-1 flex items-center justify-between gap-2">
              <span>{{ store.member.linkedUser.displayName || '—' }}</span>
              <Pill
                v-if="store.member.linkedUser.profileCompletedAt"
                variant="emerald"
              >
                Profil complété
              </Pill>
              <Pill
                v-else
                variant="amber"
              >
                Profil incomplet
              </Pill>
            </dd>
          </div>
          <div class="flex">
            <dt class="w-32 text-surface-500 flex items-center gap-1">
              <Mail
                :size="12"
                :stroke-width="2"
              />
              Email
            </dt>
            <dd>{{ store.member.linkedUser.email || '—' }}</dd>
          </div>
          <div
            v-if="store.member.linkedUser.phone"
            class="flex"
          >
            <dt class="w-32 text-surface-500 flex items-center gap-1">
              <Phone
                :size="12"
                :stroke-width="2"
              />
              Téléphone
            </dt>
            <dd>{{ store.member.linkedUser.phone }}</dd>
          </div>
          <div
            v-if="store.member.linkedUser.address && formatAddress(store.member.linkedUser.address)"
            class="flex items-start"
          >
            <dt class="w-32 text-surface-500 flex items-center gap-1">
              <MapPin
                :size="12"
                :stroke-width="2"
              />
              Adresse
            </dt>
            <dd class="flex-1">
              {{ formatAddress(store.member.linkedUser.address) }}
            </dd>
          </div>
          <div class="flex">
            <dt class="w-32 text-surface-500">
              Rôles auth
            </dt>
            <dd class="flex flex-wrap gap-1">
              <span
                v-for="role in store.member.linkedUser.roles"
                :key="role"
                class="inline-flex h-5 px-1.5 rounded text-[11px] bg-surface-100 text-surface-700"
              >
                {{ role }}
              </span>
              <span
                v-if="store.member.linkedUser.roles.length === 0"
                class="text-surface-400 text-[12px]"
              >—</span>
            </dd>
          </div>
          <div class="flex">
            <dt class="w-32 text-surface-500">
              uid
            </dt>
            <dd class="font-mono text-[11px] text-surface-500 truncate">
              {{ store.member.linkedUser.id }}
            </dd>
          </div>
        </dl>
      </template>
      <template v-else-if="store.member.linkedUserId">
        <p class="text-[12px] text-amber-700">
          Lié à un user (uid <code class="font-mono">{{ store.member.linkedUserId }}</code>)
          mais le document <code class="font-mono">/users/{uid}</code> est inaccessible ou absent.
        </p>
      </template>
      <template v-else>
        <p class="text-[12px] text-surface-500">
          Ce membre n'a pas de compte Firebase Auth lié.
        </p>
      </template>
    </div>

    <!-- ============== Zone de danger (admin only) ============== -->
    <div
      v-if="isAdmin && store.member"
      class="card p-5 space-y-3 md:col-span-2 border-rose-200"
    >
      <h2 class="text-[14px] font-semibold text-rose-700 flex items-center gap-2">
        <TriangleAlert
          :size="14"
          :stroke-width="2"
        />
        Zone de danger
      </h2>
      <p class="text-[12px] text-surface-500">
        Actions irréversibles. À utiliser uniquement en cas d'erreur de
        création. Pour mettre fin à l'adhésion d'un membre légitime, utilisez
        plutôt le bouton « Désactiver » de la carte Identité : il conserve
        l'historique et retire l'accès à l'app mobile.
      </p>
      <div>
        <button
          type="button"
          class="btn btn-secondary btn-sm border !border-rose-300 !text-rose-700 hover:!bg-rose-50"
          :disabled="store.saving"
          @click="openDeleteDialog"
        >
          <Trash2
            :size="13"
            :stroke-width="2"
          />
          Supprimer définitivement ce membre
        </button>
      </div>
    </div>
  </div>

  <!-- ============== Contact dialog ============== -->
  <Dialog
    v-model:visible="isContactDialogOpen"
    modal
    :draggable="false"
    :style="{ width: '420px' }"
    header="Modifier le contact"
  >
    <div class="space-y-3 pt-1">
      <label class="block">
        <span class="text-[12px] text-surface-600">Email</span>
        <InputText
          v-model="contactForm.email"
          class="mt-1 w-full"
          placeholder="prenom.nom@club.ch"
        />
      </label>
      <label class="block">
        <span class="text-[12px] text-surface-600">Téléphone</span>
        <InputText
          v-model="contactForm.phone"
          class="mt-1 w-full"
          placeholder="+41 ..."
        />
      </label>
    </div>
    <template #footer>
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        @click="isContactDialogOpen = false"
      >
        Annuler
      </button>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        :disabled="store.saving"
        @click="submitContact"
      >
        <template v-if="store.saving">
          Enregistrement…
        </template>
        <template v-else>
          Enregistrer
        </template>
      </button>
    </template>
  </Dialog>

  <!-- ============== BirthDate dialog ============== -->
  <Dialog
    v-model:visible="isBirthDateDialogOpen"
    modal
    :draggable="false"
    :style="{ width: '420px' }"
    header="Date de naissance"
  >
    <div class="space-y-3 pt-1">
      <label class="block">
        <span class="text-[12px] text-surface-600">Date</span>
        <DatePicker
          v-model="birthDateForm"
          date-format="dd/mm/yy"
          show-icon
          class="mt-1 w-full"
          :max-date="new Date()"
        />
        <span class="text-[11px] text-surface-500 mt-1 block">
          Laisser vide si la date n'est pas connue.
        </span>
      </label>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          @click="clearBirthDate"
        >
          Effacer
        </button>
      </div>
      <p
        v-if="birthDateError"
        class="text-[12px] text-rose-600"
      >
        {{ birthDateError }}
      </p>
    </div>
    <template #footer>
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        :disabled="isSavingBirthDate"
        @click="isBirthDateDialogOpen = false"
      >
        Annuler
      </button>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        :disabled="isSavingBirthDate"
        @click="submitBirthDate"
      >
        <template v-if="isSavingBirthDate">
          Enregistrement…
        </template>
        <template v-else>
          Enregistrer
        </template>
      </button>
    </template>
  </Dialog>

  <!-- ============== AVS dialog ============== -->
  <Dialog
    v-model:visible="isAvsDialogOpen"
    modal
    :draggable="false"
    :style="{ width: '420px' }"
    header="N° AVS"
  >
    <div class="space-y-3 pt-1">
      <label class="block">
        <span class="text-[12px] text-surface-600">N° AVS</span>
        <InputText
          v-model="avsForm"
          class="mt-1 w-full font-mono"
          placeholder="756.XXXX.XXXX.XX"
          :invalid="!!avsError"
          @keyup.enter="submitAvs"
        />
        <span class="text-[11px] text-surface-500 mt-1 block">
          Format suisse 756.XXXX.XXXX.XX. Laisser vide si inconnu.
        </span>
      </label>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          @click="clearAvs"
        >
          Effacer
        </button>
      </div>
      <p
        v-if="avsError"
        class="text-[12px] text-rose-600"
      >
        {{ avsError }}
      </p>
    </div>
    <template #footer>
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        :disabled="isSavingAvs"
        @click="isAvsDialogOpen = false"
      >
        Annuler
      </button>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        :disabled="isSavingAvs"
        @click="submitAvs"
      >
        <template v-if="isSavingAvs">
          Enregistrement…
        </template>
        <template v-else>
          Enregistrer
        </template>
      </button>
    </template>
  </Dialog>

  <!-- ============== Link user dialog (unifié owner / guardian) ============== -->
  <LinkUserDialog
    v-if="store.member"
    :visible="isLinkUserDialogOpen"
    :member-id="store.member.id"
    :current-linked-user-id="store.member.linkedUserId"
    :current-guardians="store.member.guardians"
    @update:visible="isLinkUserDialogOpen = $event"
    @linked="isLinkUserDialogOpen = false"
  />

  <!-- ============== Delete member dialog (zone de danger) ============== -->
  <DeleteMemberDialog
    v-if="store.member"
    :visible="isDeleteDialogOpen"
    :member="store.member"
    @update:visible="isDeleteDialogOpen = $event"
    @deleted="onDeleted"
  />

  <!-- ============== Confirm remove guardian ============== -->
  <Dialog
    :visible="guardianToRemove !== null"
    modal
    :draggable="false"
    :style="{ width: '420px' }"
    header="Retirer ce tuteur"
    @update:visible="(v: boolean) => { if (!v) guardianToRemove = null }"
  >
    <div
      v-if="guardianToRemove"
      class="space-y-2 pt-1 text-[13px]"
    >
      <p>
        Retirer <strong>{{ guardianLabel(guardianToRemove) }}</strong> comme tuteur de ce membre ?
      </p>
      <p class="text-[12px] text-surface-500">
        Le rôle <code class="font-mono">parent</code> sera retiré du compte
        uniquement si l'utilisateur n'est plus tuteur d'aucun autre membre.
      </p>
    </div>
    <template #footer>
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        :disabled="isRemovingGuardian"
        @click="guardianToRemove = null"
      >
        Annuler
      </button>
      <button
        type="button"
        class="btn btn-primary btn-sm !bg-rose-600 hover:!bg-rose-700"
        :disabled="isRemovingGuardian"
        @click="confirmRemoveGuardian"
      >
        <template v-if="isRemovingGuardian">
          Retrait…
        </template>
        <template v-else>
          Retirer
        </template>
      </button>
    </template>
  </Dialog>

  <!-- ============== Confirm deactivate member ============== -->
  <Dialog
    :visible="isDeactivateConfirmOpen"
    modal
    :draggable="false"
    :style="{ width: '440px' }"
    header="Désactiver ce membre"
    @update:visible="(v: boolean) => { if (!v) isDeactivateConfirmOpen = false }"
  >
    <div class="space-y-2 pt-1 text-[13px]">
      <p>
        Passer ce membre en <strong>inactif</strong> ?
      </p>
      <p class="text-[12px] text-surface-500">
        Ce membre perdra l'accès à l'application mobile. Il pourra toujours se
        réinscrire via le portail d'inscription.
      </p>
    </div>
    <template #footer>
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        :disabled="isTogglingActive"
        @click="isDeactivateConfirmOpen = false"
      >
        Annuler
      </button>
      <button
        type="button"
        class="btn btn-primary btn-sm !bg-amber-600 hover:!bg-amber-700"
        :disabled="isTogglingActive"
        @click="setActive(false)"
      >
        <template v-if="isTogglingActive">
          …
        </template>
        <template v-else>
          Désactiver
        </template>
      </button>
    </template>
  </Dialog>
</template>
