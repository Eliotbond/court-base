<script setup lang="ts">
/**
 * CbLicenseRequestDialog — Demande de licence fédérale pour un joueur (coach).
 *
 * Réutilisable :
 *   - Depuis `TeamRoster.vue` (kebab "Demander licence" sur un row joueur).
 *   - Depuis `MemberDetail.vue` (deep-link `?action=request-license` ou CTA
 *     dans la section Licence).
 *
 * Architecture en couches (cf. `CLAUDE.md` racine) : ce composant N'APPELLE
 * **JAMAIS** Firestore directement — toute la mutation passe par
 * `useLicenseRequestsStore().createForMember(...)`, qui délègue au repo.
 *
 * Comportement :
 *   - Pré-vérifie le gate cotisation (`canRequestLicense`). Si KO →
 *     bouton "Envoyer" disabled + bannière rose avec la raison.
 *   - Pré-vérifie l'existence d'une demande en cours via le store
 *     (`existingForMember`). Si présente → bouton désactivé +
 *     bannière info "déjà en cours" (le suivi sera dispo en PR2).
 *   - Pré-calcule `requiredDocs` localement pour l'affichage via
 *     `inferRequiredDocs({ hasAvs, previouslyLicensedInSwitzerland: false })`
 *     du package `@club-app/shared-types`. PR1 force toujours
 *     `previouslyLicensedInSwitzerland: false` — le parent toggle dans le
 *     form (PR ultérieure).
 *   - Au submit : appelle `createForMember(...)`. Sur succès → émet
 *     `created` (avec `{ requestId, alreadyExisted }`) + ferme. Sur erreur
 *     → message rouge inline, dialog reste ouvert.
 *
 * Pas de toast natif (l'app n'a pas de `ToastService` global, cf. mémoire
 * `project_tier1_decisions`). Le caller gère le toast post-success.
 */

import { computed, ref, watch } from 'vue'
import { CheckCircle2, Info, AlertTriangle } from 'lucide-vue-next'
import Dialog from 'primevue/dialog'

import CbBanner from '@/components/ui/CbBanner.vue'
import { inferRequiredDocs, type LicenseDocKind } from '@club-app/shared-types'

import { useAuthStore } from '@/stores/auth'
import { useLicenseRequestsStore } from '@/stores/licenseRequests'
import { canRequestLicense, licenseGateReason } from '@/utils/licenseGate'
import type { MockMember } from '@/types/mock'

// ────────────────────────────────────────────────────────────────
// Props / emits
// ────────────────────────────────────────────────────────────────

interface Props {
  /** v-model:visible. */
  visible: boolean
  /** Member visé. null → dialog vide (fermé en pratique). */
  member: MockMember | null
  /** Team au nom de laquelle la demande est faite. */
  team: { id: string; name: string } | null
  /**
   * uids des destinataires des notifications in-app + push (linkedUserId
   * ∪ guardianUserIds). Calculé par le caller.
   */
  notifyUserIds: readonly string[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  created: [payload: { requestId: string; alreadyExisted: boolean }]
}>()

// ────────────────────────────────────────────────────────────────
// Stores
// ────────────────────────────────────────────────────────────────

const auth = useAuthStore()
const licenseRequestsStore = useLicenseRequestsStore()

// ────────────────────────────────────────────────────────────────
// Computeds — gate, existing, requiredDocs
// ────────────────────────────────────────────────────────────────

const gateOk = computed<boolean>(() =>
  props.member ? canRequestLicense(props.member) : false,
)

const gateReason = computed<string | null>(() =>
  props.member ? licenseGateReason(props.member) : null,
)

/** `LicenseRequestRef | null` depuis le cache du store. */
const existing = computed(() =>
  props.member ? licenseRequestsStore.existingForMember(props.member.id) : null,
)

/** Liste des docs à demander (calculée localement pour l'affichage). */
const requiredDocs = computed<LicenseDocKind[]>(() => {
  if (!props.member) return []
  return inferRequiredDocs({
    hasAvs: !!props.member.avs,
    previouslyLicensedInSwitzerland: false,
  })
})

const DOC_LABELS: Record<LicenseDocKind, string> = {
  id_front: "Carte d'identité (recto)",
  id_back: "Carte d'identité (verso)",
  avs: 'Numéro AVS',
  transfer_letter_swiss: 'Lettre de sortie du club précédent',
}

// ────────────────────────────────────────────────────────────────
// Mapping statut → label FR (pour la bannière "déjà en cours")
// ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  pending: 'en attente',
  pending_parent_docs: 'en attente des documents du parent',
  parent_docs_submitted: 'documents soumis, en attente de validation',
  coach_validated: 'validée par le coach, en attente du trésorier',
  approved: 'approuvée',
  rejected: 'refusée',
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

// ────────────────────────────────────────────────────────────────
// Submit
// ────────────────────────────────────────────────────────────────

const localError = ref<string | null>(null)
const submitting = computed(() => licenseRequestsStore.loading)

/** Bouton "Envoyer" disabled si : pas de member/team, gate KO, demande existante, ou submit en cours. */
const submitDisabled = computed<boolean>(() => {
  if (!props.member || !props.team) return true
  if (!gateOk.value) return true
  if (existing.value) return true
  if (submitting.value) return true
  return false
})

const submitLabel = computed<string>(() => (submitting.value ? 'Envoi…' : 'Envoyer la demande'))

/** Reset le message d'erreur à chaque ouverture. */
watch(
  () => props.visible,
  (v) => {
    if (v) localError.value = null
  },
)

function close(): void {
  emit('update:visible', false)
}

async function onSubmit(): Promise<void> {
  if (submitDisabled.value) return
  if (!props.member || !props.team) return

  localError.value = null

  const requestedByUid = auth.uid ?? null
  const requestedByMemberId = auth.userDoc?.memberId ?? null
  const coachName = auth.displayName ?? ''

  if (!requestedByUid) {
    localError.value =
      "Impossible d'envoyer la demande : votre session a expiré. Reconnectez-vous."
    return
  }
  if (!requestedByMemberId) {
    localError.value =
      "Impossible d'envoyer la demande : votre compte coach n'est pas lié à un membre."
    return
  }

  try {
    const result = await licenseRequestsStore.createForMember({
      memberId: props.member.id,
      teamId: props.team.id,
      teamName: props.team.name,
      memberFirstName: props.member.firstName,
      memberLastName: props.member.lastName,
      memberHasAvs: !!props.member.avs,
      previouslyLicensedInSwitzerland: false,
      notifyUserIds: props.notifyUserIds,
      requestedByUid,
      requestedByMemberId,
      coachName,
    })

    emit('created', result)
    close()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    localError.value = `Impossible d'envoyer la demande : ${message}`
  }
}

// ────────────────────────────────────────────────────────────────
// Affichage entête
// ────────────────────────────────────────────────────────────────

const headerTitle = computed<string>(() => {
  if (!props.member) return 'Demander une licence'
  return `Demander une licence — ${props.member.firstName} ${props.member.lastName}`
})

const seasonLabel = '2025/26' // PR1 : seasonId visible cosmétique seulement
</script>

<template>
  <Dialog
    :visible="visible"
    :header="headerTitle"
    modal
    :draggable="false"
    :dismissable-mask="true"
    :close-on-escape="true"
    :style="{ width: '92vw', maxWidth: '480px' }"
    :pt="{ root: { class: 'cb-license-dialog' } }"
    @update:visible="emit('update:visible', $event)"
  >
    <div v-if="member && team" class="cb-lr-body">
      <!-- Récap équipe / saison -->
      <div class="cb-lr-recap">
        <div class="cb-lr-recap-row">
          <span class="cb-lr-recap-label">Équipe</span>
          <span class="cb-lr-recap-value">{{ team.name }}</span>
        </div>
        <div class="cb-lr-recap-row">
          <span class="cb-lr-recap-label">Saison</span>
          <span class="cb-lr-recap-value">{{ seasonLabel }}</span>
        </div>
      </div>

      <!-- Bannière "déjà en cours" (prioritaire sur le gate) -->
      <CbBanner v-if="existing" tone="sky">
        <template #icon><Info :size="16" /></template>
        Une demande de licence est déjà en cours pour ce joueur
        <strong>(statut : {{ statusLabel(existing.status) }})</strong>.
        Le suivi détaillé sera disponible en PR2.
      </CbBanner>

      <!-- Bannière gate cotisation KO -->
      <CbBanner v-else-if="!gateOk && gateReason" tone="rose">
        <template #icon><AlertTriangle :size="16" /></template>
        {{ gateReason }}
      </CbBanner>

      <!-- Liste des docs requis -->
      <div class="cb-lr-section">
        <div class="cb-section-label">Documents qui seront demandés au parent</div>
        <ul class="cb-lr-docs">
          <li v-for="kind in requiredDocs" :key="kind">
            {{ DOC_LABELS[kind] }}
          </li>
        </ul>
      </div>

      <!-- Helper -->
      <CbBanner tone="sky">
        <template #icon><Info :size="16" /></template>
        Le parent recevra une notification avec un lien pour téléverser ces
        documents. Une fois soumis, vous pourrez valider chaque document avant
        transmission au trésorier.
      </CbBanner>

      <!-- Erreur inline -->
      <p v-if="localError" class="cb-lr-error" role="alert">
        {{ localError }}
      </p>
    </div>

    <template #footer>
      <div class="cb-lr-actions">
        <button type="button" class="cb-btn outline" :disabled="submitting" @click="close">
          Annuler
        </button>
        <button
          type="button"
          class="cb-btn primary"
          :disabled="submitDisabled"
          :title="
            existing
              ? 'Une demande existe déjà — suivi disponible en PR2'
              : !gateOk && gateReason
                ? gateReason
                : undefined
          "
          @click="onSubmit"
        >
          <CheckCircle2 v-if="!submitting" :size="16" />
          {{ submitLabel }}
        </button>
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
/**
 * Le dialog PrimeVue habille le frame (header / close button / backdrop). On
 * style uniquement le body interne — pas de :deep() pour ne pas écraser les
 * tokens du preset emerald.
 */

.cb-lr-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-size: 13px;
  color: var(--text);
}

.cb-lr-recap {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  background: var(--slate-50, var(--bg-muted));
  border-radius: 10px;
  border: 1px solid var(--border);
}

.cb-lr-recap-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
}

.cb-lr-recap-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-subtle);
}

.cb-lr-recap-value {
  font-weight: 600;
  font-size: 13px;
}

.cb-lr-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cb-lr-docs {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  line-height: 1.5;
}

.cb-lr-docs li {
  color: var(--text);
}

.cb-lr-error {
  margin: 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--rose-50, rgba(244, 63, 94, 0.08));
  color: var(--rose-700, #be123c);
  border: 1px solid var(--rose-200, rgba(244, 63, 94, 0.25));
  font-size: 12px;
  line-height: 1.45;
}

.cb-lr-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
}
</style>
