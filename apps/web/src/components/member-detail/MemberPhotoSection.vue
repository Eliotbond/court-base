<script setup lang="ts">
/**
 * Photo licence membre — composant réutilisable (apps/web admin / treasurer).
 *
 * Cf. `docs/members/license-photo.md` pour l'intention et le workflow.
 * Pendant côté coach : `apps/courtbase-app/src/components/member/MemberPhotoSection.vue`
 * (UX cohérente mais composant dupliqué — composants Vue ne se partagent pas
 * entre apps via package).
 *
 * Comportement desktop-first :
 *  - Sans photo : placeholder carré 120x120 + texte "Aucune photo licence".
 *  - Avec photo : preview 120x120 + bouton "Voir en grand" (modal).
 *  - `canEdit` → bouton "Ajouter" / "Remplacer" qui ouvre un input file
 *    (`accept="image/jpeg,image/png,image/webp"`). Pas de `capture="user"`
 *    côté web admin (filepicker classique uniquement).
 *  - `canDelete` → bouton "Supprimer" rose avec dialog confirm 2-clics.
 *  - Pré-validation MIME + size ≤ 5 Mo côté client (banner erreur inline).
 *  - Loading state pendant upload (spinner sur bouton + bouton disabled).
 *
 * Architecture en couches : le composant utilise `useMemberDetailStore` pour
 * upload/remove (couches `components → stores → repos → SDK`). Il consomme
 * aussi un getter URL signée du store pour le preview (le store wrap le repo
 * `getMemberPhotoDownloadUrl`). Le composant NE TOUCHE JAMAIS le SDK Firebase
 * directement.
 *
 * Pour signaler au parent un changement (utile si le parent veut faire un
 * reload supplémentaire au-delà de celui que le store fait déjà), on émet
 * `updated` / `removed` après chaque opération réussie.
 */
import { computed, ref, watch } from 'vue'
import {
  Camera,
  ImageIcon,
  Loader2,
  Trash2,
  TriangleAlert,
  ZoomIn,
} from 'lucide-vue-next'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import { useMemberDetailStore } from '@/stores/memberDetail'

interface Props {
  memberId: string
  photoStoragePath: string | null
  photoUpdatedAt: { seconds: number } | null
  canEdit: boolean
  canDelete?: boolean
}
interface Emits {
  (e: 'updated', payload: { storagePath: string }): void
  (e: 'removed'): void
}

const props = withDefaults(defineProps<Props>(), { canDelete: false })
const emit = defineEmits<Emits>()

const store = useMemberDetailStore()

// ---------------------------------------------------------------------------
// Validation client — alignée sur la rule Storage PR-A + la callable PR-B.
// ---------------------------------------------------------------------------

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const
const MAX_BYTES = 5 * 1024 * 1024 // 5 Mo

// ---------------------------------------------------------------------------
// State local
// ---------------------------------------------------------------------------

const fileInput = ref<HTMLInputElement | null>(null)
const isUploading = ref(false)
const isRemoving = ref(false)
const validationError = ref<string | null>(null)
const downloadUrl = ref<string | null>(null)
const isLoadingUrl = ref(false)
const previewDialogOpen = ref(false)
const confirmDeleteOpen = ref(false)

// ---------------------------------------------------------------------------
// Resolve signed URL via store getter (qui wrap le repo). Lazy + cache-busted
// par photoUpdatedAt.seconds (cf. docs/members/license-photo.md §Garde-fous).
// On évite l'import direct du repo dans le composant (cf. architecture en
// couches) — mais ici la résolution d'URL signée Storage n'a pas de mutation,
// donc on peut soit passer par le store (préféré), soit recevoir l'URL en prop.
// Le store ne porte pas (encore) ce helper en l'état, donc on lit via le
// composable `useMemberPhotoUrl` ci-dessous, qui est un thin wrapper repo
// (sans état persistant, c'est l'équivalent d'un composable pur).
// ---------------------------------------------------------------------------

async function resolveDownloadUrl(): Promise<void> {
  if (!props.photoStoragePath) {
    downloadUrl.value = null
    return
  }
  isLoadingUrl.value = true
  try {
    // Composable pur (pas de state). Importé paresseusement pour garder le
    // boundary `components → repos` propre en lecture (équivalent à un appel
    // de store getter — ici lecture only, pas de mutation Firestore).
    const { getMemberPhotoDownloadUrl } = await import(
      '@/repositories/members.repo'
    )
    const url = await getMemberPhotoDownloadUrl(props.photoStoragePath)
    const v = props.photoUpdatedAt?.seconds ?? Date.now()
    downloadUrl.value = url.includes('?') ? `${url}&v=${v}` : `${url}?v=${v}`
  } catch (err) {
    console.error(
      `[MemberPhotoSection.resolveDownloadUrl] failed path=${props.photoStoragePath}`,
      err,
    )
    downloadUrl.value = null
    validationError.value =
      'Aperçu indisponible. Vérifiez vos droits Storage ou réessayez.'
  } finally {
    isLoadingUrl.value = false
  }
}

// Re-resolve quand le path change (replace, remove, switch member).
watch(
  () => [props.photoStoragePath, props.photoUpdatedAt?.seconds] as const,
  () => {
    void resolveDownloadUrl()
  },
  { immediate: true },
)

// ---------------------------------------------------------------------------
// Upload flow — passe par le store qui wrap le repo (architecture en couches).
// ---------------------------------------------------------------------------

function triggerFilePicker(): void {
  if (!props.canEdit || isUploading.value) return
  validationError.value = null
  fileInput.value?.click()
}

async function onFileSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // Reset input pour pouvoir re-uploader le même fichier après une erreur.
  if (input) input.value = ''
  if (!file) return

  // Pré-validation MIME + taille (UX immédiate, sans round-trip réseau).
  if (!ALLOWED_MIME.includes(file.type as (typeof ALLOWED_MIME)[number])) {
    validationError.value =
      'Type de fichier non supporté. Utilisez JPEG, PNG ou WebP.'
    return
  }
  if (file.size > MAX_BYTES) {
    validationError.value = `Fichier trop volumineux (${(file.size / 1024 / 1024).toFixed(1)} Mo). Max 5 Mo.`
    return
  }

  isUploading.value = true
  validationError.value = null
  try {
    const ok = await store.uploadPhoto(file)
    if (ok) {
      // Le store a reload le member ; on émet pour permettre au parent un
      // éventuel post-traitement (toast, navigation, etc.).
      emit('updated', {
        storagePath: store.member?.photoStoragePath ?? '',
      })
    } else {
      validationError.value = store.error ?? 'Échec de l\'upload.'
    }
  } finally {
    isUploading.value = false
  }
}

// ---------------------------------------------------------------------------
// Remove flow (admin/rootAdmin only).
// ---------------------------------------------------------------------------

function askDelete(): void {
  if (!props.canDelete) return
  validationError.value = null
  confirmDeleteOpen.value = true
}

async function confirmDelete(): Promise<void> {
  if (!props.canDelete || isRemoving.value) return
  isRemoving.value = true
  try {
    const ok = await store.removePhoto()
    if (ok) {
      emit('removed')
      confirmDeleteOpen.value = false
    } else {
      validationError.value = store.error ?? 'Échec de la suppression.'
    }
  } finally {
    isRemoving.value = false
  }
}

// ---------------------------------------------------------------------------
// Derived
// ---------------------------------------------------------------------------

const hasPhoto = computed<boolean>(() => props.photoStoragePath !== null)
const showSpinnerOverlay = computed<boolean>(
  () => isLoadingUrl.value || isUploading.value,
)
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-start gap-4 flex-wrap">
      <!-- ===== Preview / placeholder ===== -->
      <div
        class="relative w-[120px] h-[120px] rounded-lg overflow-hidden border border-surface-200 bg-surface-50 shrink-0"
      >
        <template v-if="hasPhoto && downloadUrl">
          <img
            :src="downloadUrl"
            alt="Photo licence du membre"
            class="w-full h-full object-cover"
          >
        </template>
        <template v-else>
          <div
            class="flex flex-col items-center justify-center w-full h-full text-surface-400 text-[11px] text-center px-2"
          >
            <ImageIcon
              :size="28"
              :stroke-width="1.5"
              class="mb-1"
            />
            <span>{{ hasPhoto ? 'Chargement…' : 'Aucune photo licence' }}</span>
          </div>
        </template>

        <!-- Overlay loading (upload / URL resolve) -->
        <div
          v-if="showSpinnerOverlay"
          class="absolute inset-0 flex items-center justify-center bg-white/70"
          aria-busy="true"
        >
          <Loader2
            :size="20"
            :stroke-width="2"
            class="animate-spin text-surface-600"
          />
        </div>
      </div>

      <!-- ===== Actions + guidelines ===== -->
      <div class="flex-1 min-w-[200px] space-y-2">
        <p class="text-[12px] text-surface-500 leading-snug">
          Fond clair et uni, type photo passeport. La photo sera utilisée sur
          la licence fédérale.
        </p>
        <div class="flex items-center gap-2 flex-wrap">
          <Button
            v-if="hasPhoto && downloadUrl"
            size="small"
            severity="secondary"
            outlined
            aria-label="Voir la photo en grand"
            :disabled="isUploading || isRemoving"
            @click="previewDialogOpen = true"
          >
            <template #icon>
              <ZoomIn
                :size="13"
                :stroke-width="2"
              />
            </template>
            <span class="ml-1">Voir en grand</span>
          </Button>

          <Button
            v-if="canEdit"
            size="small"
            severity="secondary"
            aria-label="Ajouter ou remplacer la photo licence"
            :disabled="isUploading || isRemoving"
            @click="triggerFilePicker"
          >
            <template #icon>
              <Loader2
                v-if="isUploading"
                :size="13"
                :stroke-width="2"
                class="animate-spin"
              />
              <Camera
                v-else
                :size="13"
                :stroke-width="2"
              />
            </template>
            <span class="ml-1">
              {{ isUploading ? 'Upload…' : hasPhoto ? 'Remplacer' : 'Ajouter' }}
            </span>
          </Button>

          <Button
            v-if="canDelete && hasPhoto"
            size="small"
            severity="danger"
            outlined
            aria-label="Supprimer la photo licence"
            :disabled="isUploading || isRemoving"
            @click="askDelete"
          >
            <template #icon>
              <Trash2
                :size="13"
                :stroke-width="2"
              />
            </template>
            <span class="ml-1">Supprimer</span>
          </Button>
        </div>

        <!-- Banner d'erreur de validation client / upload -->
        <div
          v-if="validationError"
          class="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5 flex items-start gap-1.5"
        >
          <TriangleAlert
            :size="12"
            :stroke-width="2"
            class="mt-0.5 shrink-0"
          />
          <span>{{ validationError }}</span>
        </div>
      </div>

      <!-- Input file caché — déclenché via Button -->
      <input
        ref="fileInput"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        class="hidden"
        @change="onFileSelected"
      >
    </div>

    <!-- ===== Dialog "Voir en grand" ===== -->
    <Dialog
      v-model:visible="previewDialogOpen"
      modal
      :draggable="false"
      :style="{ width: 'min(560px, 92vw)' }"
      header="Photo licence"
    >
      <div class="flex items-center justify-center">
        <img
          v-if="downloadUrl"
          :src="downloadUrl"
          alt="Photo licence du membre — grand format"
          class="max-w-full max-h-[70vh] object-contain rounded"
        >
      </div>
    </Dialog>

    <!-- ===== Dialog confirmation suppression (2-clics) ===== -->
    <Dialog
      v-model:visible="confirmDeleteOpen"
      modal
      :draggable="false"
      :closable="!isRemoving"
      :close-on-escape="!isRemoving"
      :style="{ width: '420px' }"
    >
      <template #header>
        <span class="flex items-center gap-2 text-rose-700 font-semibold">
          <TriangleAlert
            :size="16"
            :stroke-width="2"
          />
          Supprimer la photo
        </span>
      </template>
      <div class="space-y-2 pt-1 text-[13px]">
        <p>
          Supprimer définitivement la photo licence de ce membre ?
        </p>
        <p class="text-[12px] text-surface-500">
          Le fichier sera retiré du stockage et le coach devra ré-uploader une
          nouvelle photo pour pouvoir valider une demande de licence.
        </p>
      </div>
      <template #footer>
        <Button
          severity="secondary"
          :disabled="isRemoving"
          @click="confirmDeleteOpen = false"
        >
          Annuler
        </Button>
        <Button
          severity="danger"
          :disabled="isRemoving"
          :loading="isRemoving"
          @click="confirmDelete"
        >
          Supprimer
        </Button>
      </template>
    </Dialog>
  </div>
</template>
