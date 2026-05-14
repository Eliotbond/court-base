<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import AutoComplete, {
  type AutoCompleteCompleteEvent,
} from 'primevue/autocomplete'
import { Link2, TriangleAlert, Unlink } from 'lucide-vue-next'
import { useMembersStore } from '@/stores/members'
import { useMemberDetailStore } from '@/stores/memberDetail'
import { searchUsersByEmail, type UserMini } from '@/repositories/users.repo'
import Avatar from '@/components/ui/Avatar.vue'
import type { GuardianRef } from '@/repositories/members.repo'

/**
 * Dialog "Lier un compte d'inscription" — associe un `/users/{uid}` (compte
 * Firebase Auth) au membre comme titulaire.
 *
 * Cas d'usage typique : un parent inscrit son enfant via
 * `apps/courtbase-register` ; l'admin convertit la registration en member
 * puis lie le user d'inscription au member créé. La liaison est atomique
 * côté repo : `member.linkedUserId` + `user.memberId`, avec clear orphans
 * symétrique des deux côtés (cf. `members.repo.ts` → `setLinkedUser`).
 *
 * Distinct des tuteurs (`/members/{id}.guardians`) — un user peut être
 * titulaire OU tuteur mais jamais les deux pour le même membre.
 */

const props = defineProps<{
  memberId: string
  /** uid du compte Auth actuellement lié ; null = aucun. */
  currentLinkedUserId: string | null
  /** Tuteurs déjà liés ; un même user ne peut être tuteur ET titulaire. */
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
// AutoComplete state — identique au pattern de ManageGuardiansDialog : recherche
// start-with sur `email` via `searchUsersByEmail`, debounce 200ms côté input.
// ---------------------------------------------------------------------------

const selected = ref<UserMini | null>(null)
const suggestions = ref<UserMini[]>([])
const isSearching = ref(false)
const errorMessage = ref<string | null>(null)
const isSubmitting = ref(false)

/**
 * Le bouton "Délier" demande une confirmation inline en deux clics — premier
 * clic flip ce flag, second clic exécute. Évite un détachement accidentel
 * sans ouvrir un second sub-dialog.
 */
const confirmUnlink = ref(false)

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
// Validation — empêche de lier un user déjà titulaire ou déjà tuteur.
// ---------------------------------------------------------------------------

const alreadyLinked = computed<boolean>(() => {
  if (!selected.value) return false
  return (
    !!props.currentLinkedUserId &&
    selected.value.uid === props.currentLinkedUserId
  )
})

const isGuardian = computed<boolean>(() => {
  if (!selected.value) return false
  return props.currentGuardians.some((g) => g.uid === selected.value!.uid)
})

const validationWarning = computed<string | null>(() => {
  if (alreadyLinked.value)
    return 'Cet utilisateur est déjà lié comme compte du membre.'
  if (isGuardian.value)
    return "Cet utilisateur est tuteur de ce membre. Un membre ne peut pas être à la fois tuteur et titulaire du compte."
  return null
})

const canConfirm = computed<boolean>(
  () =>
    !!selected.value &&
    !alreadyLinked.value &&
    !isGuardian.value &&
    !isSubmitting.value,
)

const hasCurrentLink = computed<boolean>(() => props.currentLinkedUserId !== null)

const confirmLabel = computed<string>(() =>
  hasCurrentLink.value ? 'Remplacer le compte lié' : 'Lier le compte',
)

// ---------------------------------------------------------------------------
// Submit / unlink / cancel
// ---------------------------------------------------------------------------

async function confirm(): Promise<void> {
  if (!selected.value || !canConfirm.value) return
  isSubmitting.value = true
  errorMessage.value = null
  const ok = await membersStore.setLinkedUser(
    props.memberId,
    selected.value.uid,
  )
  if (ok) {
    // Refresh aussi le détail (séparé du store /members) pour rafraîchir la
    // section "Compte lié" affichée dans le ProfileTab.
    await detailStore.load(props.memberId)
    emit('linked')
    close()
  } else {
    errorMessage.value =
      membersStore.error ?? 'Échec de la liaison du compte.'
  }
  isSubmitting.value = false
}

async function unlink(): Promise<void> {
  if (!hasCurrentLink.value) return
  // Premier clic : flip la confirmation inline. Second clic : exécute.
  if (!confirmUnlink.value) {
    confirmUnlink.value = true
    return
  }
  isSubmitting.value = true
  errorMessage.value = null
  const ok = await membersStore.setLinkedUser(props.memberId, null)
  if (ok) {
    await detailStore.load(props.memberId)
    emit('linked')
    close()
  } else {
    errorMessage.value =
      membersStore.error ?? 'Échec du détachement du compte.'
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
      confirmUnlink.value = false
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
    header="Lier un compte d'inscription"
    @update:visible="(v: boolean) => emit('update:visible', v)"
  >
    <div class="space-y-3 pt-1">
      <p class="text-[12px] text-surface-500">
        Lie un compte Firebase Auth (typiquement créé via le portail
        d'inscription) à ce membre. Cela permet au titulaire de se reconnaître
        et d'accéder à ses propres informations. Distinct des tuteurs.
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

      <div
        v-if="confirmUnlink"
        class="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 flex items-start gap-2"
      >
        <TriangleAlert
          :size="14"
          :stroke-width="2"
          class="mt-0.5 shrink-0"
        />
        Confirme en cliquant à nouveau sur «&nbsp;Délier le compte actuel&nbsp;».
      </div>
    </div>

    <template #footer>
      <button
        v-if="hasCurrentLink"
        type="button"
        class="btn btn-secondary btn-sm"
        :disabled="isSubmitting"
        @click="unlink"
      >
        <Unlink
          :size="14"
          :stroke-width="2"
        />
        <template v-if="isSubmitting">
          Détachement…
        </template>
        <template v-else-if="confirmUnlink">
          Confirmer le détachement
        </template>
        <template v-else>
          Délier le compte actuel
        </template>
      </button>
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
