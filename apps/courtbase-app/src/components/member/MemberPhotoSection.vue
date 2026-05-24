<script setup lang="ts">
/**
 * Section "Photo licence membre" — UI partagée (coach + admin) pour
 * uploader / remplacer / supprimer la photo passeport d'un member.
 *
 * Cf. brief : `docs/members/license-photo.md` § Affichage.
 *
 * Pattern picker fichier+caméra :
 *   <input type="file" accept="image/jpeg,image/png,image/webp" capture="user">
 *   - sur mobile, ouvre la caméra **frontale** par défaut (idéal pour
 *     photo type passeport / selfie) ;
 *   - desktop ignore `capture` et tombe sur le file picker classique ;
 *   - sur iOS/Android le natif propose "Prendre une photo / Galerie" via
 *     la sheet système.
 *
 * Le composant ne touche pas Firestore ni Storage directement — c'est le
 * caller qui orchestre l'appel store/repo via les events `updated` /
 * `removed`. Cohérent avec l'architecture en couches (cf. CLAUDE.md
 * `apps/courtbase-app`).
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import { AlertTriangle, Camera, Loader2, RefreshCcw, Trash2 } from 'lucide-vue-next'

import { useMembersStore } from '@/stores/members'
import { getMemberPhotoDownloadUrl } from '@/repositories/members.repo'

interface Props {
  memberId: string
  /** Photo path actuelle ou null. */
  photoStoragePath: string | null
  /** Timestamp pour cache-buster `?v=<seconds>`. Null si pas de photo. */
  photoUpdatedAt: { seconds: number } | null
  /** Peut éditer (uploader / remplacer). */
  canEdit: boolean
  /** Peut supprimer (admin uniquement). Défaut false. */
  canDelete?: boolean
}

interface Emits {
  (e: 'updated', payload: { storagePath: string }): void
  (e: 'removed'): void
}

const props = withDefaults(defineProps<Props>(), {
  canDelete: false,
})
const emit = defineEmits<Emits>()

const membersStore = useMembersStore()

// ─── État local ──────────────────────────────────────────────────
const fileInput = ref<HTMLInputElement | null>(null)
const isUploading = ref(false)
const isRemoving = ref(false)
const errorMessage = ref<string | null>(null)

/** URL résolue depuis Storage (downloadURL signée). Null = placeholder. */
const downloadUrl = ref<string | null>(null)

// ─── MIME + taille (alignés sur la rule Storage / repo) ─────────
const ACCEPT_MIME = 'image/jpeg,image/png,image/webp'
const MAX_BYTES = 5 * 1024 * 1024

function isAcceptedMime(type: string): boolean {
  return type === 'image/jpeg' || type === 'image/png' || type === 'image/webp'
}

// ─── Resolve download URL ────────────────────────────────────────
async function resolveUrl(): Promise<void> {
  if (!props.photoStoragePath) {
    downloadUrl.value = null
    return
  }
  // Note : on n'efface pas l'URL existante pendant le refetch — on évite
  // le flash placeholder pendant une réauthentification du signed URL.
  const url = await getMemberPhotoDownloadUrl(props.photoStoragePath)
  downloadUrl.value = url
}

watch(
  () => props.photoStoragePath,
  () => {
    void resolveUrl()
  },
  { immediate: true },
)

/** Cache-busted img src — change quand `photoUpdatedAt.seconds` bouge. */
const imgSrc = computed<string | null>(() => {
  if (!downloadUrl.value) return null
  const v = props.photoUpdatedAt?.seconds ?? 0
  // Append `?v=…` au query string (sans casser ceux déjà posés par Storage).
  const sep = downloadUrl.value.includes('?') ? '&' : '?'
  return v > 0 ? `${downloadUrl.value}${sep}v=${v}` : downloadUrl.value
})

const hasPhoto = computed(() => Boolean(props.photoStoragePath))

const uploadLabel = computed(() =>
  hasPhoto.value ? 'Remplacer' : 'Ajouter une photo',
)

// ─── Actions ─────────────────────────────────────────────────────
function pickFile(): void {
  errorMessage.value = null
  fileInput.value?.click()
}

async function onFileChange(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0] ?? null
  // Reset value pour permettre un re-pick du même fichier sans reload.
  if (target) target.value = ''
  if (!file) return

  errorMessage.value = null

  // Pré-validation client (le repo re-valide aussi).
  if (!isAcceptedMime(file.type)) {
    errorMessage.value =
      "Format non supporté. Utilisez JPEG, PNG ou WebP."
    return
  }
  if (file.size > MAX_BYTES) {
    errorMessage.value = `Fichier trop volumineux (${(file.size / 1024 / 1024).toFixed(2)} Mo). Maximum 5 Mo.`
    return
  }

  isUploading.value = true
  try {
    await membersStore.uploadPhoto(props.memberId, file)
    // Le storagePath réel est `members/{id}/license-photo.{ext}` — on le
    // ré-émet pour que la vue parente le persiste sur son état local.
    const ext =
      file.type === 'image/jpeg'
        ? 'jpg'
        : file.type === 'image/png'
        ? 'png'
        : 'webp'
    emit('updated', { storagePath: `members/${props.memberId}/license-photo.${ext}` })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Échec de l'upload."
    errorMessage.value = message
  } finally {
    isUploading.value = false
  }
}

async function onRemove(): Promise<void> {
  if (!props.canDelete) return
  errorMessage.value = null
  isRemoving.value = true
  try {
    await membersStore.removePhoto(props.memberId)
    emit('removed')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Échec de la suppression.'
    errorMessage.value = message
  } finally {
    isRemoving.value = false
  }
}

onUnmounted(() => {
  errorMessage.value = null
})
</script>

<template>
  <section class="mps">
    <div class="mps-row">
      <!-- Thumbnail / Placeholder -->
      <div
        class="mps-thumb"
        :class="{ 'mps-thumb--empty': !hasPhoto }"
        aria-hidden="true"
      >
        <img
          v-if="hasPhoto && imgSrc"
          :src="imgSrc"
          alt="Photo licence"
          loading="lazy"
        />
        <Camera v-else :size="28" color="var(--slate-400)" />
      </div>

      <div class="mps-meta">
        <div class="mps-label">Photo licence</div>
        <div v-if="!hasPhoto" class="mps-sub">Aucune photo licence</div>
        <div v-else class="mps-sub">
          Photo enregistrée — visible côté coach et trésorier.
        </div>

        <div v-if="canEdit || canDelete" class="mps-actions">
          <button
            v-if="canEdit"
            type="button"
            class="cb-btn outline sm"
            :disabled="isUploading || isRemoving"
            @click="pickFile"
          >
            <Loader2 v-if="isUploading" :size="14" class="mps-spin" />
            <RefreshCcw v-else-if="hasPhoto" :size="14" />
            <Camera v-else :size="14" />
            <span>{{ uploadLabel }}</span>
          </button>

          <button
            v-if="canDelete && hasPhoto"
            type="button"
            class="cb-btn outline danger sm"
            :disabled="isUploading || isRemoving"
            @click="onRemove"
          >
            <Loader2 v-if="isRemoving" :size="14" class="mps-spin" />
            <Trash2 v-else :size="14" />
            <span>Supprimer</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Hidden file input — bouton "Ajouter/Remplacer" déclenche le picker. -->
    <input
      ref="fileInput"
      type="file"
      :accept="ACCEPT_MIME"
      capture="user"
      class="mps-input"
      @change="onFileChange"
    />

    <!-- Erreur inline -->
    <div v-if="errorMessage" class="mps-error" role="alert">
      <AlertTriangle :size="14" />
      <span>{{ errorMessage }}</span>
    </div>

    <!-- Aide -->
    <p v-if="canEdit" class="mps-help">
      Fond clair et uni, type photo passeport. La photo sera utilisée sur la
      licence fédérale.
    </p>
  </section>
</template>

<style scoped>
.mps {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mps-row {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}
.mps-thumb {
  width: 96px;
  height: 96px;
  border-radius: 12px;
  background: var(--slate-100, #f1f5f9);
  border: 1px solid var(--border);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.mps-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.mps-thumb--empty {
  background: var(--slate-50, #f8fafc);
}
.mps-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  flex: 1;
}
.mps-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-subtle);
}
.mps-sub {
  font-size: 13px;
  color: var(--text);
}
.mps-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
}
.mps-input {
  display: none;
}
.mps-error {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--rose-700, #be123c);
  background: var(--rose-50, rgba(244, 63, 94, 0.08));
  border: 1px solid var(--rose-200, rgba(244, 63, 94, 0.25));
  border-radius: 8px;
  padding: 6px 10px;
}
.mps-help {
  font-size: 12px;
  color: var(--text-subtle);
  line-height: 1.45;
  margin: 0;
}
.mps-spin {
  animation: mps-spin 1s linear infinite;
}
@keyframes mps-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
