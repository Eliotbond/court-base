<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import AutoComplete, {
  type AutoCompleteCompleteEvent,
} from 'primevue/autocomplete'
import { TriangleAlert, UserPlus } from 'lucide-vue-next'
import { useMembersStore } from '@/stores/members'
import { useMemberDetailStore } from '@/stores/memberDetail'
import { searchUsersByEmail, type UserMini } from '@/repositories/users.repo'
import Avatar from '@/components/ui/Avatar.vue'
import type { GuardianRef } from '@/repositories/members.repo'

/**
 * Dialog "Ajouter un tuteur" — lie un /users/{uid} à un membre comme tuteur.
 *
 * Flow :
 *   1. Saisie email → `searchUsersByEmail` (start-with, max 10).
 *   2. Sélection d'un user dans la dropdown PrimeVue AutoComplete.
 *   3. Validation : ne peut pas être déjà tuteur, ne peut pas être le member
 *      lui-même (`linkedUserId`).
 *   4. Confirme → `useMembersStore.addGuardian()` (atomique côté repo,
 *      idempotent : pas de risque de double si déjà lié).
 *
 * On utilise `useMembersStore` pour l'action (atomique member + user.roles)
 * et on émet `linked` pour que le parent (`MemberDetailRow`) refresh sa propre
 * vue détail via `useMemberDetailStore.load()`.
 */

const props = defineProps<{
  memberId: string
  /** Tuteurs déjà liés ; empêche le double-link. */
  currentGuardians: readonly GuardianRef[]
  /** uid du compte Auth lié au membre ; un membre ne peut pas être son propre tuteur. */
  memberLinkedUserId: string | null
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
// AutoComplete state
//
// `selected` = user choisi dans la dropdown (UserMini | null). `query` est
// la string courante dans l'input (utile pour distinguer "rien tapé" vs
// "sélectionné mais l'utilisateur a recommencé à taper"). `suggestions`
// alimente la dropdown PrimeVue ; debounce 200ms côté search Firestore.
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
// Validation — empêche de cliquer "Lier" si le user choisi est déjà tuteur
// ou est le member lui-même.
// ---------------------------------------------------------------------------

const alreadyGuardian = computed<boolean>(() => {
  if (!selected.value) return false
  return props.currentGuardians.some((g) => g.uid === selected.value!.uid)
})

const isSelfLink = computed<boolean>(() => {
  if (!selected.value) return false
  return (
    !!props.memberLinkedUserId &&
    selected.value.uid === props.memberLinkedUserId
  )
})

const validationWarning = computed<string | null>(() => {
  if (alreadyGuardian.value) return 'Cet utilisateur est déjà tuteur de ce membre.'
  if (isSelfLink.value)
    return "Un membre ne peut pas être son propre tuteur."
  return null
})

const canConfirm = computed<boolean>(
  () =>
    !!selected.value &&
    !alreadyGuardian.value &&
    !isSelfLink.value &&
    !isSubmitting.value,
)

// ---------------------------------------------------------------------------
// Submit / cancel
// ---------------------------------------------------------------------------

async function confirm(): Promise<void> {
  if (!selected.value || !canConfirm.value) return
  isSubmitting.value = true
  errorMessage.value = null
  const ok = await membersStore.addGuardian(props.memberId, selected.value.uid)
  if (ok) {
    // Reload aussi le détail (séparé du store /members) pour rafraîchir la
    // liste affichée dans le ProfileTab.
    await detailStore.load(props.memberId)
    emit('linked')
    close()
  } else {
    errorMessage.value =
      membersStore.error ?? "Échec de l'ajout du tuteur."
  }
  isSubmitting.value = false
}

function close(): void {
  emit('update:visible', false)
}

// Reset l'état chaque fois que la dialog se rouvre.
watch(
  () => props.visible,
  (v) => {
    if (v) {
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
    header="Ajouter un tuteur"
    @update:visible="(v: boolean) => emit('update:visible', v)"
  >
    <div class="space-y-3 pt-1">
      <p class="text-[12px] text-surface-500">
        Lie un compte existant comme tuteur de ce membre. L'utilisateur
        recevra automatiquement le rôle <code class="font-mono text-[11px]">parent</code>.
      </p>

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
        <UserPlus
          :size="14"
          :stroke-width="2"
        />
        <template v-if="isSubmitting">
          Liaison…
        </template>
        <template v-else>
          Lier comme tuteur
        </template>
      </button>
    </template>
  </Dialog>
</template>
