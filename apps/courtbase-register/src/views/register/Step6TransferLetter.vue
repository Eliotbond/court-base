<script setup lang="ts">
/**
 * Étape 6/8 du wizard d'inscription parents/joueurs — Lettre de sortie.
 *
 * Étape **conditionnelle** : on ne l'affiche que si
 * `currentDraft.previouslyLicensed === true`. Sinon → redirige vers step 7.
 *
 * Comportement :
 *  - Lit le draft courant depuis `useRegistrationsStore`.
 *  - Permet d'uploader (optionnellement) la lettre de sortie via le repo
 *    `storage.ts` (`uploadTransferLetter`). Le `storagePath` retourné est
 *    persisté dans le draft via `patchDraft({ transferLetterStoragePath })`.
 *  - Upload toujours optionnel à ce stade (cf. `docs/chantier-registrations.md`
 *    §4.9) — l'utilisateur peut continuer sans uploader, et fournir le doc
 *    plus tard depuis son espace personnel.
 *  - Si transfert international (`currentDraft.previousClubAbroad === true`),
 *    affiche un bandeau d'information supplémentaire.
 */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertTriangle,
  ArrowRight,
  ChevronLeft,
  Globe,
} from 'lucide-vue-next'
import WizardLayout from '@/components/wizard/WizardLayout.vue'
import DocumentUploadTile, {
  type UploadState,
} from '@/components/wizard/DocumentUploadTile.vue'
import { useRegistrationsStore } from '@/stores/registrations'
import { useAuthStore } from '@/stores/auth'
import { uploadTransferLetter } from '@/repositories/storage'

const router = useRouter()
const registrationsStore = useRegistrationsStore()
const authStore = useAuthStore()

const uploadState = ref<UploadState>({ kind: 'empty' })

const ACCEPTED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
] as const
const MAX_BYTES = 10 * 1024 * 1024

onMounted(() => {
  const draft = registrationsStore.currentDraft
  if (!draft) {
    void router.replace('/register/step-1')
    return
  }

  // Étape sautée si le joueur n'a jamais été licencié auparavant.
  if (draft.previouslyLicensed === false) {
    void router.replace('/register/step-7')
    return
  }

  // Initialise l'état d'upload depuis le draft existant.
  if (draft.transferLetterStoragePath) {
    uploadState.value = {
      kind: 'uploaded',
      fileName: basename(draft.transferLetterStoragePath),
      // La taille n'est pas dénormalisée — affichage "déjà uploadé" sans
      // info de taille est acceptable côté reprise de draft.
      size: 0,
      storagePath: draft.transferLetterStoragePath,
    }
  }
})

function basename(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(i + 1) : path
}

function isAcceptedMime(type: string): boolean {
  return (ACCEPTED_MIME_TYPES as readonly string[]).includes(type)
}

async function onPick(file: File): Promise<void> {
  // Validation client : taille.
  if (file.size > MAX_BYTES) {
    uploadState.value = {
      kind: 'refused',
      reason: 'Fichier trop volumineux (max 10 Mo).',
    }
    return
  }

  // Validation client : type MIME.
  if (!isAcceptedMime(file.type)) {
    uploadState.value = {
      kind: 'refused',
      reason: 'Format non supporté (PDF, JPG ou PNG uniquement).',
    }
    return
  }

  const uid = authStore.authSnap?.uid
  const registrationId = registrationsStore.currentDraftId
  if (!uid || !registrationId) {
    uploadState.value = {
      kind: 'refused',
      reason: 'Session invalide, veuillez réessayer.',
    }
    return
  }

  uploadState.value = {
    kind: 'uploading',
    fileName: file.name,
    progress: 50,
  }

  try {
    const result = await uploadTransferLetter({ uid, registrationId, file })
    await registrationsStore.patchDraft({
      transferLetterStoragePath: result.storagePath,
    })
    uploadState.value = {
      kind: 'uploaded',
      fileName: file.name,
      size: result.size,
      storagePath: result.storagePath,
    }
  } catch {
    uploadState.value = {
      kind: 'refused',
      reason: "Échec de l'envoi. Réessayez.",
    }
  }
}

async function onRemove(): Promise<void> {
  try {
    await registrationsStore.patchDraft({ transferLetterStoragePath: null })
    uploadState.value = { kind: 'empty' }
  } catch {
    uploadState.value = {
      kind: 'refused',
      reason: "Échec de la suppression. Réessayez.",
    }
  }
}

function onRetry(): void {
  uploadState.value = { kind: 'empty' }
}

function goPrevious(): void {
  void router.push('/register/step-5')
}

function goNext(): void {
  if (uploadState.value.kind === 'uploading') return
  void router.push('/register/step-7')
}
</script>

<template>
  <WizardLayout :current="6" title="Lettre de sortie">
    <h1 class="step6__title">Lettre de sortie de l'ancien club</h1>
    <p class="step6__sub">
      Pour qu'une nouvelle licence soit délivrée, votre ancien club doit
      fournir une lettre de sortie.
    </p>

    <div class="banner banner-strong step6__banner">
      <AlertTriangle :size="14" />
      <div>
        <strong>Important</strong> — Aucune licence ne pourra être délivrée
        tant que ce document manque. Vous pouvez l'uploader maintenant si
        vous l'avez déjà, ou plus tard depuis votre espace personnel.
      </div>
    </div>

    <div
      v-if="registrationsStore.currentDraft?.previousClubAbroad === true"
      class="banner banner-warn step6__banner"
    >
      <Globe :size="14" />
      <div>
        <strong>Transfert international détecté</strong> — la procédure peut
        nécessiter des documents supplémentaires que l'admin du club vous
        demandera après l'inscription.
      </div>
    </div>

    <DocumentUploadTile
      class="step6__tile"
      label="Lettre de sortie (PDF ou image)"
      :file="uploadState"
      helper="Formats acceptés : PDF, JPG, PNG. Taille max : 10 Mo."
      accept=".pdf,image/png,image/jpeg"
      @pick="onPick"
      @remove="onRemove"
      @retry="onRetry"
    />

    <template #footer>
      <button
        type="button"
        class="btn btn-secondary"
        @click="goPrevious"
      >
        <ChevronLeft :size="16" />
        Précédent
      </button>
      <button
        type="button"
        class="btn btn-primary flex-1"
        :disabled="uploadState.kind === 'uploading'"
        @click="goNext"
      >
        Continuer
        <ArrowRight :size="16" />
      </button>
    </template>
  </WizardLayout>
</template>

<style scoped>
.step6__title {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.3;
  margin: 0;
  color: #0f172a;
}
.step6__sub {
  margin-top: 6px;
  margin-bottom: 0;
  font-size: 13px;
  color: #475569;
  line-height: 1.55;
}
.step6__banner {
  margin-top: 16px;
}
.step6__tile {
  margin-top: 16px;
}
</style>
