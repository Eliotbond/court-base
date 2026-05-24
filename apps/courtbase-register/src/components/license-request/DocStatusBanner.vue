<script setup lang="ts">
/**
 * `DocStatusBanner` — pill + bandeau résumant l'état de review d'un document
 * uploadé (`UploadedDocRef`) côté parent.
 *
 * Quatre états visuels :
 *  - **null** (doc pas uploadé) : rien (le composant ne s'affiche pas).
 *  - **uploadé, pas de review** : pill amber "En attente de validation".
 *  - **refusé** (coach ou trésorier) : bandeau rose avec qui + quand + raison,
 *    le `update:requestRetry` permet au parent englobant de scroller vers
 *    le tile d'upload pour relancer.
 *  - **validé** : pill emerald qui distingue "validé par le coach" (étape
 *    intermédiaire) de "validé" (les deux niveaux ont accepté).
 *
 * Le re-upload n'est PAS géré ici — c'est le tile `PassportUpload` /
 * `DocumentUploadTile` au-dessus qui le porte. Le parent englobant
 * (`LicenseRequestForm.vue`) reset les deux reviews via le store au prochain
 * upload (cf. `useLicenseRequestsStore.uploadDoc`).
 */
import { computed } from 'vue'
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-vue-next'
import type { LicenseDocKind, UploadedDocRef } from '@club-app/shared-types'
import {
  formatReviewAt,
  licenseDocLabel,
} from '@/constants/licenseDocLabels'

const props = defineProps<{
  /** Référence du doc uploadé. `null` → composant invisible. */
  docRef: UploadedDocRef | null | undefined
  kind: LicenseDocKind
}>()

type Status =
  | { kind: 'none' }
  | { kind: 'pending' }
  | { kind: 'accepted-coach' }
  | { kind: 'accepted-all' }
  | { kind: 'refused'; by: 'coach' | 'treasurer'; reason: string; at: string | null }

const status = computed<Status>(() => {
  const ref = props.docRef
  if (!ref) return { kind: 'none' }
  const coach = ref.coachReview
  const treasurer = ref.treasurerReview

  if (treasurer?.decision === 'refused') {
    return {
      kind: 'refused',
      by: 'treasurer',
      reason: treasurer.refusalReason ?? '',
      at: formatReviewAt(treasurer.at),
    }
  }
  if (coach?.decision === 'refused') {
    return {
      kind: 'refused',
      by: 'coach',
      reason: coach.refusalReason ?? '',
      at: formatReviewAt(coach.at),
    }
  }
  if (treasurer?.decision === 'accepted') {
    return { kind: 'accepted-all' }
  }
  if (coach?.decision === 'accepted') {
    return { kind: 'accepted-coach' }
  }
  return { kind: 'pending' }
})

const docLabel = computed(() => licenseDocLabel(props.kind))
</script>

<template>
  <div v-if="status.kind !== 'none'" class="doc-status">
    <!-- En attente de review -->
    <span v-if="status.kind === 'pending'" class="pill pill-amber doc-status__pill">
      <Clock :size="12" />
      En attente de validation
    </span>

    <!-- Validé coach uniquement (étape intermédiaire) -->
    <span
      v-else-if="status.kind === 'accepted-coach'"
      class="pill pill-emerald doc-status__pill"
    >
      <CheckCircle2 :size="12" />
      Validé par le coach
    </span>

    <!-- Validé coach + trésorier -->
    <span
      v-else-if="status.kind === 'accepted-all'"
      class="pill pill-emerald doc-status__pill"
    >
      <CheckCircle2 :size="12" />
      Validé
    </span>

    <!-- Refusé (coach OU trésorier) -->
    <template v-else>
      <span class="pill pill-rose doc-status__pill">
        <AlertTriangle :size="12" />
        {{
          status.by === 'coach'
            ? 'Refusé par le coach'
            : 'Refusé par le trésorier'
        }}
      </span>
      <div class="banner banner-strong doc-status__refusal">
        <AlertTriangle :size="14" class="banner-icon" />
        <div class="doc-status__refusal-body">
          <div class="doc-status__refusal-title">
            {{ docLabel }} — à re-téléverser
          </div>
          <p v-if="status.reason" class="doc-status__refusal-reason">
            {{ status.reason }}
          </p>
          <p v-if="status.at" class="doc-status__refusal-meta">
            Refus posé le {{ status.at }}.
          </p>
          <p class="doc-status__refusal-cta">
            Utilisez le bouton « Supprimer » ci-dessus puis téléversez à
            nouveau le bon document — la review repartira de zéro.
          </p>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.doc-status {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
.doc-status__pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
}
.doc-status__refusal {
  align-items: flex-start;
}
.doc-status__refusal-body {
  flex: 1;
  min-width: 0;
}
.doc-status__refusal-title {
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.4;
}
.doc-status__refusal-reason {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.5;
}
.doc-status__refusal-meta {
  margin: 4px 0 0;
  font-size: 11px;
  opacity: 0.85;
  line-height: 1.45;
}
.doc-status__refusal-cta {
  margin: 6px 0 0;
  font-size: 11.5px;
  line-height: 1.5;
  opacity: 0.9;
}
</style>
