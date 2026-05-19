<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FirebaseError } from 'firebase/app'
import Dialog from 'primevue/dialog'
import AutoComplete, {
  type AutoCompleteCompleteEvent,
} from 'primevue/autocomplete'
import SelectButton from 'primevue/selectbutton'
import { Link2, TriangleAlert } from 'lucide-vue-next'
import { useMembersStore } from '@/stores/members'
import { useMemberDetailStore } from '@/stores/memberDetail'
import { searchUsersByEmail, type UserMini } from '@/repositories/users.repo'
import Avatar from '@/components/ui/Avatar.vue'
import type { GuardianRef } from '@/repositories/members.repo'

/**
 * Dialog unifié "Lier un user" — associe un `/users/{uid}` (compte Firebase
 * Auth) à un membre, soit comme **propriétaire** (compte du membre :
 * `member.linkedUserId` ↔ `user.memberId`), soit comme **tuteur** (parent :
 * `member.guardianUserIds`).
 *
 * Remplace les deux anciens dialogs séparés (`ManageLinkedUserDialog` +
 * `ManageGuardiansDialog`) par un point d'entrée unique avec sélecteur de
 * rôle. Un même user ne peut être propriétaire ET tuteur du même membre.
 *
 * Les actions de RETRAIT (délier le propriétaire, retirer un tuteur) restent
 * gérées inline dans `ProfileTab.vue` — ce dialog ne fait que la liaison.
 */

const props = defineProps<{
  memberId: string
  /** uid du compte Auth actuellement propriétaire ; null = aucun. */
  currentLinkedUserId: string | null
  /** Tuteurs déjà liés ; un même user ne peut être tuteur ET propriétaire. */
  currentGuardians: readonly GuardianRef[]
  /** Visibilité contrôlée par le parent (v-model:visible). */
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'linked'): void
}>()

const membersStore = useMembersStore()
const detailStore = useMemberDetailStore()

// ---------------------------------------------------------------------------
// Rôle de liaison — propriétaire (compte du membre) ou tuteur (parent).
// ---------------------------------------------------------------------------

type LinkRole = 'owner' | 'guardian'

interface RoleOption {
  label: string
  value: LinkRole
}

const ROLE_OPTIONS: ReadonlyArray<RoleOption> = [
  { label: 'Propriétaire (compte du membre)', value: 'owner' },
  { label: 'Tuteur (parent)', value: 'guardian' },
] as const

const role = ref<LinkRole>('owner')

// ---------------------------------------------------------------------------
// AutoComplete state — recherche start-with sur `email` via
// `searchUsersByEmail`, debounce 200ms côté input.
// ---------------------------------------------------------------------------

const selected = ref<UserMini | null>(null)
const suggestions = ref<UserMini[]>([])
const isSearching = ref(false)
const errorMessage = ref<string | null>(null)
const isSubmitting = ref(false)

let searchTimer: ReturnType<typeof setTimeout> | null = null

async function onComplete(event: AutoCompleteCompleteEvent): Promise<void> {
  if (searchTimer) {
    clearTimeout(searchTimer)
    searchTimer = null
  }
  const q = event.query.trim()
  // Debounce : on attend 200ms d'inactivité avant de hit Firestore.
  searchTimer = setTimeout(async () => {
    isSearching.value = true
    try {
      const results = await searchUsersByEmail(q)
      suggestions.value = results
    } catch (e: unknown) {
      // En cas d'erreur réseau, on laisse les suggestions vides plutôt que
      // d'afficher une erreur bloquante — l'utilisateur peut retaper.
      suggestions.value = []
      errorMessage.value =
        e instanceof Error ? e.message : 'Erreur lors de la recherche.'
    } finally {
      isSearching.value = false
    }
  }, 200)
}

// ---------------------------------------------------------------------------
// Validation — dépend du rôle choisi.
//
// owner    : refuse si le user est déjà propriétaire actuel, refuse s'il est
//            déjà tuteur de ce membre.
// guardian : refuse si le user est le propriétaire actuel, refuse s'il est
//            déjà tuteur.
// ---------------------------------------------------------------------------

const isCurrentOwner = computed<boolean>(() => {
  if (!selected.value) return false
  return (
    !!props.currentLinkedUserId &&
    selected.value.uid === props.currentLinkedUserId
  )
})

const isCurrentGuardian = computed<boolean>(() => {
  if (!selected.value) return false
  return props.currentGuardians.some((g) => g.uid === selected.value!.uid)
})

const validationWarning = computed<string | null>(() => {
  if (!selected.value) return null
  if (role.value === 'owner') {
    if (isCurrentOwner.value)
      return 'Cet utilisateur est déjà le compte propriétaire de ce membre.'
    if (isCurrentGuardian.value)
      return "Cet utilisateur est tuteur de ce membre. Un membre ne peut pas être à la fois tuteur et propriétaire du compte."
  } else {
    if (isCurrentOwner.value)
      return "Cet utilisateur est le compte propriétaire de ce membre. Un membre ne peut pas être à la fois propriétaire et tuteur."
    if (isCurrentGuardian.value)
      return 'Cet utilisateur est déjà tuteur de ce membre.'
  }
  return null
})

const canConfirm = computed<boolean>(
  () =>
    !!selected.value &&
    validationWarning.value === null &&
    !isSubmitting.value,
)

/** Le membre a déjà un propriétaire → le bouton owner devient "Remplacer". */
const hasCurrentOwner = computed<boolean>(
  () => props.currentLinkedUserId !== null,
)

const confirmLabel = computed<string>(() => {
  if (role.value === 'guardian') return 'Lier comme tuteur'
  return hasCurrentOwner.value
    ? 'Remplacer le compte propriétaire'
    : 'Lier le compte'
})

// ---------------------------------------------------------------------------
// Submit / cancel
// ---------------------------------------------------------------------------

async function confirm(): Promise<void> {
  if (!selected.value || !canConfirm.value) return
  isSubmitting.value = true
  errorMessage.value = null
  try {
    const ok =
      role.value === 'owner'
        ? await membersStore.setLinkedUser(props.memberId, selected.value.uid)
        : await membersStore.addGuardian(props.memberId, selected.value.uid)
    if (ok) {
      // Refresh aussi le détail (séparé du store /members) pour rafraîchir la
      // section "Comptes liés" affichée dans le ProfileTab.
      await detailStore.load(props.memberId)
      emit('linked')
      close()
    } else {
      errorMessage.value =
        membersStore.error ?? 'Échec de la liaison du compte.'
    }
  } catch (err: unknown) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`LinkUserDialog.confirm failed [${code}]`, err)
    errorMessage.value =
      err instanceof Error ? err.message : 'Échec de la liaison du compte.'
  } finally {
    isSubmitting.value = false
  }
}

function close(): void {
  emit('update:visible', false)
}

// Reset l'état chaque fois que la dialog se rouvre.
watch(
  () => props.visible,
  (v) => {
    if (v) {
      role.value = 'owner'
      selected.value = null
      suggestions.value = []
      errorMessage.value = null
      isSubmitting.value = false
    }
  },
)
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :draggable="false"
    :style="{ width: '480px' }"
    header="Lier un user"
    @update:visible="(v: boolean) => emit('update:visible', v)"
  >
    <div class="space-y-3 pt-1">
      <p class="text-[12px] text-surface-500">
        Lie un compte Firebase Auth (typiquement créé via le portail
        d'inscription) à ce membre. Choisis si le compte est le
        <strong>propriétaire</strong> (le membre lui-même) ou un
        <strong>tuteur</strong> (parent).
      </p>

      <label class="block">
        <span class="text-[12px] text-surface-600">Rôle du compte lié</span>
        <SelectButton
          v-model="role"
          :options="[...ROLE_OPTIONS]"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          class="mt-1"
        />
        <span class="text-[11px] text-surface-500 mt-1 block">
          <template v-if="role === 'guardian'">
            L'utilisateur recevra automatiquement le rôle
            <code class="font-mono text-[11px]">parent</code>.
          </template>
          <template v-else>
            Permet au titulaire de se reconnaître et d'accéder à ses propres
            informations.
          </template>
        </span>
      </label>

      <label class="block">
        <span class="text-[12px] text-surface-600">Rechercher par email</span>
        <AutoComplete
          v-model="selected"
          :suggestions="suggestions"
          option-label="email"
          placeholder="prenom.nom@exemple.ch"
          force-selection
          class="mt-1 w-full"
          input-class="w-full"
          :loading="isSearching"
          @complete="onComplete"
        >
          <template #option="{ option }">
            <div class="flex items-center gap-2 py-1">
              <Avatar
                :name="option.displayName || option.email"
                :size="24"
              />
              <div class="leading-tight min-w-0">
                <div class="text-[13px] truncate">
                  {{ option.displayName || option.email }}
                </div>
                <div
                  v-if="option.displayName"
                  class="text-[11px] text-surface-500 truncate"
                >
                  {{ option.email }}
                </div>
              </div>
            </div>
          </template>
        </AutoComplete>
        <span class="text-[11px] text-surface-500 mt-1 block">
          L'utilisateur doit déjà avoir un compte dans le club.
        </span>
      </label>

      <div
        v-if="validationWarning"
        class="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-start gap-2"
      >
        <TriangleAlert
          :size="14"
          :stroke-width="2"
          class="mt-0.5 shrink-0"
        />
        {{ validationWarning }}
      </div>

      <div
        v-if="role === 'owner' && hasCurrentOwner && !validationWarning"
        class="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-start gap-2"
      >
        <TriangleAlert
          :size="14"
          :stroke-width="2"
          class="mt-0.5 shrink-0"
        />
        Ce membre a déjà un compte propriétaire. Confirmer remplacera le lien
        actuel.
      </div>

      <div
        v-if="errorMessage"
        class="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 flex items-start gap-2"
      >
        <TriangleAlert
          :size="14"
          :stroke-width="2"
          class="mt-0.5 shrink-0"
        />
        {{ errorMessage }}
      </div>
    </div>

    <template #footer>
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        :disabled="isSubmitting"
        @click="close"
      >
        Annuler
      </button>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        :disabled="!canConfirm"
        @click="confirm"
      >
        <Link2
          :size="14"
          :stroke-width="2"
        />
        <template v-if="isSubmitting">
          Liaison…
        </template>
        <template v-else>
          {{ confirmLabel }}
        </template>
      </button>
    </template>
  </Dialog>
</template>
