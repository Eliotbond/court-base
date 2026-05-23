<script setup lang="ts">
/**
 * Wrapper autour de `DocumentUploadTile.vue` pour les pièces d'identité du
 * workflow demande de licence parent (mock-only).
 *
 * Différences par rapport au tile générique :
 *  - Helper text métier fixe ("passeport OU CNI uniquement").
 *  - Validation MIME stricte (`image/jpeg|png|application/pdf`) + taille
 *    ≤ 10 Mo. Tout rejet bascule en état `refused` avec un motif lisible.
 *  - Upload mocké via `URL.createObjectURL(file)` → `blobUrl` éphémère.
 *  - `v-model` (`update:modelValue`) émet l'objet métier
 *    `{ kind, file: { fileName, sizeBytes, blobUrl, mimeType } }` pour que le
 *    parent puisse persister la métadonnée (le tile interne, lui, expose un
 *    `UploadState` adapté à son rendu — on convertit dans les deux sens).
 */
import { computed } from 'vue'
import DocumentUploadTile, { type UploadState } from '@/components/wizard/DocumentUploadTile.vue'

/**
 * Modèle externe — ce que le parent persiste dans la request mock. On le
 * garde minimal : seuls les champs nécessaires à `LicenseRequestMock.uploadedDocs`.
 */
export type PassportUploadValue =
  | { kind: 'empty' }
  | {
      kind: 'uploading'
      file: { fileName: string; sizeBytes: number; mimeType: string }
    }
  | {
      kind: 'uploaded'
      file: {
        fileName: string
        sizeBytes: number
        /** Blob URL éphémère — perdu au refresh, à régénérer si besoin. */
        blobUrl: string
        mimeType: string
      }
    }
  | { kind: 'refused'; reason: string }

const props = withDefaults(
  defineProps<{
    modelValue: PassportUploadValue
    label: string
    side: 'front' | 'back'
    accept?: string
  }>(),
  {
    accept: '.pdf,image/jpeg,image/png',
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: PassportUploadValue): void
  (e: 'pick', file: File): void
  (e: 'remove'): void
  (e: 'retry'): void
}>()

const HELPER_TEXT =
  "Passeport ou carte d'identité officielle uniquement — ni permis de conduire ni permis de séjour."

const MAX_BYTES = 10 * 1024 * 1024 // 10 Mo
const ACCEPTED_MIME = new Set(['image/jpeg', 'image/png', 'application/pdf'])

/**
 * Convertit le modèle externe (parent) en `UploadState` interne (tile). Le
 * tile ne connaît pas les `blobUrl` ; on lui passe un `storagePath` factice
 * `'mock://passport-{side}'` pour qu'il reste dans son état "uploaded".
 */
const tileState = computed<UploadState>(() => {
  const v = props.modelValue
  switch (v.kind) {
    case 'empty':
      return { kind: 'empty' }
    case 'uploading':
      return { kind: 'uploading', fileName: v.file.fileName, progress: 50 }
    case 'uploaded':
      return {
        kind: 'uploaded',
        fileName: v.file.fileName,
        size: v.file.sizeBytes,
        storagePath: `mock://passport-${props.side}`,
      }
    case 'refused':
      return { kind: 'refused', reason: v.reason }
  }
})

/**
 * Reçoit un `File` du `<input>` interne, valide, et bascule le modelValue.
 * On émet aussi un `pick` pour les consumers qui voudraient instrumenter
 * (logs, analytics), sans dépendre du `update:modelValue`.
 */
function onPick(file: File): void {
  emit('pick', file)

  if (!ACCEPTED_MIME.has(file.type)) {
    emit('update:modelValue', {
      kind: 'refused',
      reason:
        'Format non accepté. Utilisez un JPG, PNG ou PDF (passeport ou CNI).',
    })
    return
  }

  if (file.size > MAX_BYTES) {
    emit('update:modelValue', {
      kind: 'refused',
      reason: `Fichier trop volumineux (max 10 Mo).`,
    })
    return
  }

  // Mock upload : pas de Storage, on crée juste un blob URL éphémère.
  const blobUrl = URL.createObjectURL(file)
  emit('update:modelValue', {
    kind: 'uploaded',
    file: {
      fileName: file.name,
      sizeBytes: file.size,
      blobUrl,
      mimeType: file.type,
    },
  })
}

function onRemove(): void {
  // Révoque le blob URL pour libérer la mémoire si on en avait un.
  if (props.modelValue.kind === 'uploaded') {
    try {
      URL.revokeObjectURL(props.modelValue.file.blobUrl)
    } catch {
      /* noop — sentinel ou déjà révoqué */
    }
  }
  emit('remove')
  emit('update:modelValue', { kind: 'empty' })
}

function onRetry(): void {
  emit('retry')
  emit('update:modelValue', { kind: 'empty' })
}
</script>

<template>
  <DocumentUploadTile
    :label="label"
    :helper="HELPER_TEXT"
    :file="tileState"
    :accept="accept"
    @pick="onPick"
    @remove="onRemove"
    @retry="onRetry"
  />
</template>
