<script setup lang="ts">
/**
 * Wrapper autour de `DocumentUploadTile.vue` pour les pièces d'identité du
 * workflow demande de licence parent.
 *
 * Différences par rapport au tile générique :
 *  - Helper text métier fixe ("passeport OU CNI uniquement").
 *  - Validation MIME stricte (`image/jpeg|png|application/pdf`) + taille
 *    ≤ 10 Mo. Tout rejet bascule l'état en `refused` avec un motif lisible.
 *
 * L'upload effectif vers Firebase Storage est délégué au parent (le
 * `LicenseRequestForm` qui orchestre Storage + Firestore via le store). Ce
 * composant ne fait que :
 *  - valider côté client avant de remonter le `File` pické ;
 *  - rendre la tile dans l'état que le parent lui passe.
 */
import DocumentUploadTile, { type UploadState } from '@/components/wizard/DocumentUploadTile.vue'

const props = withDefaults(
  defineProps<{
    modelValue: UploadState
    label: string
    /** Conservé pour compat appels existants — non utilisé en interne. */
    side: 'front' | 'back'
    accept?: string
  }>(),
  {
    accept: '.pdf,image/jpeg,image/png',
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: UploadState): void
  (e: 'pick', file: File): void
  (e: 'remove'): void
  (e: 'retry'): void
}>()

const HELPER_TEXT =
  "Passeport ou carte d'identité officielle uniquement — ni permis de conduire ni permis de séjour."

const MAX_BYTES = 10 * 1024 * 1024 // 10 Mo
const ACCEPTED_MIME = new Set(['image/jpeg', 'image/png', 'application/pdf'])

/**
 * Reçoit un `File` du `<input>` interne, valide MIME + taille, et délègue
 * l'upload au parent en émettant `pick(file)`. Sur rejet de validation, on
 * pose directement l'état `refused` sans remonter le pick.
 */
function onPick(file: File): void {
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
      reason: 'Fichier trop volumineux (max 10 Mo).',
    })
    return
  }
  emit('pick', file)
}

function onRemove(): void {
  emit('remove')
}

function onRetry(): void {
  emit('retry')
  emit('update:modelValue', { kind: 'empty' })
}

void props
</script>

<template>
  <DocumentUploadTile
    :label="label"
    :helper="HELPER_TEXT"
    :file="modelValue"
    :accept="accept"
    @pick="onPick"
    @remove="onRemove"
    @retry="onRetry"
  />
</template>
