<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FirebaseError } from 'firebase/app'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'
import { Info, Trash2, TriangleAlert } from 'lucide-vue-next'
import { useMembersStore } from '@/stores/members'
import type { Member } from '@club-app/shared-types'

/**
 * Dialog "Suppression définitive" d'un membre.
 *
 * Distinct de l'archive (`status === 'archived'`) qui est le flow normal de
 * fin d'adhésion. Ici on supprime physiquement le doc /members/{id}. Réservé
 * à la correction d'une erreur de création — l'UI insiste sur ce point.
 *
 * Sécurité côté UI (filets, la vraie autorité est côté Cloud Function) :
 *   - bouton "Supprimer" disabled tant que l'admin n'a pas tapé le nom complet
 *     du membre exactement (comparaison case-insensitive ici ; le serveur fait
 *     en plus la normalisation diacritiques)
 *   - inputs disabled pendant l'appel + spinner sur le bouton
 *   - distinction des erreurs serveur :
 *       * `failed-precondition` → bandeau orange (info) : dues paid existent,
 *         suggérer l'archive
 *       * `invalid-argument`    → bandeau rouge (devrait pas arriver vu le
 *         disabled, mais filet contre un envoi forcé)
 *       * autres                → message générique
 *
 * Émet `deleted(memberId)` sur succès ; le parent close la dialog ET fait la
 * navigation (router.push vers /members) — cette dialog ne route pas.
 */

const props = defineProps<{
  visible: boolean
  /** Member à supprimer. Doit avoir `firstName` et `lastName`. */
  member: Member
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'deleted', memberId: string): void
}>()

const membersStore = useMembersStore()

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const confirmInput = ref('')
const isSubmitting = ref(false)

/**
 * Distingue les codes d'erreur serveur pour adapter la sévérité visuelle :
 *  - `precondition` (orange / info) → dues paid existe, suggérer l'archive
 *  - `mismatch`     (rouge)        → confirmName mismatch (filet)
 *  - `generic`      (rouge)        → autres erreurs
 */
type ServerErrorKind = 'precondition' | 'mismatch' | 'generic'

interface ServerError {
  kind: ServerErrorKind
  message: string
}

const serverError = ref<ServerError | null>(null)

// ---------------------------------------------------------------------------
// Validation — match le nom complet du member (case-insensitive côté UI).
//
// Le serveur fait en plus la normalisation diacritiques (é → e, etc.) ; on ne
// la duplique pas ici pour éviter une divergence (single source = serveur).
// L'UI accepte tout input qui matche après trim + lowercase ; si l'admin tape
// les diacritiques différemment, le bouton restera disabled, mais le serveur
// validerait quand même. Volontaire : on garde l'UI stricte pour le filet.
// ---------------------------------------------------------------------------

const fullName = computed<string>(
  () => `${props.member.firstName} ${props.member.lastName}`.trim(),
)

const expectedNormalized = computed<string>(() => fullName.value.toLowerCase())

const canSubmit = computed<boolean>(() => {
  if (isSubmitting.value) return false
  return confirmInput.value.trim().toLowerCase() === expectedNormalized.value
})

// ---------------------------------------------------------------------------
// Reset à chaque ouverture (pas seulement à la fermeture : si la dialog est
// rouverte sur un autre membre, on veut un état propre).
// ---------------------------------------------------------------------------
watch(
  () => props.visible,
  (v) => {
    if (v) {
      confirmInput.value = ''
      isSubmitting.value = false
      serverError.value = null
    }
  },
)

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

function close(): void {
  emit('update:visible', false)
}

function classifyError(err: unknown): ServerError {
  if (err instanceof FirebaseError) {
    if (err.code === 'failed-precondition') {
      return {
        kind: 'precondition',
        // Le serveur expose un message explicatif (ex. "Le membre a des
        // cotisations payées — utilisez l'archive..."). On le réutilise tel
        // quel pour éviter de divergence de wording.
        message:
          err.message ||
          "Ce membre a un historique comptable (cotisations payées). Utilisez l'archive pour préserver l'historique.",
      }
    }
    if (err.code === 'invalid-argument') {
      return {
        kind: 'mismatch',
        message:
          'Le nom saisi ne correspond pas exactement au membre. Vérifiez la casse et les accents.',
      }
    }
  }
  return {
    kind: 'generic',
    message: 'Suppression impossible, voir la console pour le détail.',
  }
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  isSubmitting.value = true
  serverError.value = null
  try {
    await membersStore.deletePermanently(
      props.member.id,
      confirmInput.value.trim(),
    )
    emit('deleted', props.member.id)
    close()
  } catch (err: unknown) {
    serverError.value = classifyError(err)
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :draggable="false"
    :closable="!isSubmitting"
    :close-on-escape="!isSubmitting"
    :style="{ width: '520px' }"
    @update:visible="(v: boolean) => emit('update:visible', v)"
  >
    <template #header>
      <span class="flex items-center gap-2 text-rose-700 font-semibold">
        <TriangleAlert
          :size="16"
          :stroke-width="2"
        />
        Suppression définitive
      </span>
    </template>

    <div class="space-y-3 pt-1 text-[13px]">
      <!-- Bandeau d'avertissement principal -->
      <div
        class="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 flex items-start gap-2"
      >
        <Info
          :size="14"
          :stroke-width="2"
          class="mt-0.5 shrink-0"
        />
        <p class="text-[12px] leading-snug">
          Cette action est destinée uniquement à corriger une
          <strong>erreur de création</strong> du membre. Pour mettre fin à
          l'adhésion d'un membre légitime, utilisez plutôt l'archive — elle
          conserve l'historique comptable.
        </p>
      </div>

      <!-- Liste des effets -->
      <div class="rounded border border-surface-200 bg-surface-50 px-3 py-2">
        <p class="text-[12px] text-surface-700 leading-snug">
          Cette opération va définitivement supprimer
          <strong>{{ fullName }}</strong>, le retirer de ses équipes, défaire
          le lien sur ses inscriptions historiques et supprimer ses
          cotisations non payées. <strong>Action irréversible.</strong>
        </p>
      </div>

      <!-- Champ de confirmation -->
      <label class="block">
        <span class="text-[12px] text-surface-700">
          Nom complet du membre
        </span>
        <InputText
          v-model="confirmInput"
          class="mt-1 w-full"
          :placeholder="`Tapez « ${fullName} » pour confirmer`"
          :disabled="isSubmitting"
          autocomplete="off"
          @keyup.enter="submit"
        />
      </label>

      <!-- Erreurs serveur -->
      <Message
        v-if="serverError?.kind === 'precondition'"
        severity="warn"
        :closable="false"
      >
        {{ serverError.message }}
      </Message>
      <Message
        v-else-if="serverError?.kind === 'mismatch'"
        severity="error"
        :closable="false"
      >
        {{ serverError.message }}
      </Message>
      <Message
        v-else-if="serverError?.kind === 'generic'"
        severity="error"
        :closable="false"
      >
        {{ serverError.message }}
      </Message>
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
        class="btn btn-primary btn-sm !bg-rose-600 hover:!bg-rose-700 disabled:!bg-rose-300"
        :disabled="!canSubmit"
        @click="submit"
      >
        <Trash2
          :size="13"
          :stroke-width="2"
        />
        <template v-if="isSubmitting">
          Suppression…
        </template>
        <template v-else>
          Supprimer définitivement
        </template>
      </button>
    </template>
  </Dialog>
</template>
