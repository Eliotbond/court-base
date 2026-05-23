<script setup lang="ts">
/**
 * CO9 — Détail registration (coach).
 *
 * Transcription quasi-littérale de `CO9Mobile` (coach.jsx l. 560–611).
 * - Réplique cards Joueur / Inscrit par / Historique / Documents.
 * - Toggle AVS (Eye / EyeOff).
 * - CTAs Refuser / Confirmer + Marquer essai (statuts pré-décision).
 * - Refuser → dialog motif (Teleport) → `logMockAction('co9.refuse', { id, reason })`.
 * - Confirmer / Marquer essai → `logMockAction(...)` + `router.back()`.
 * - Si `registration.previousClubAbroad` → banner amber transfert international.
 * - Si registration introuvable → `CbEmptyState` fallback.
 */
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  X,
} from 'lucide-vue-next'

import CbAvatar from '@/components/ui/CbAvatar.vue'
import CbBanner from '@/components/ui/CbBanner.vue'
import CbBottomBar from '@/components/ui/CbBottomBar.vue'
import CbEmptyState from '@/components/ui/CbEmptyState.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbPill from '@/components/ui/CbPill.vue'
import {
  getRegistration,
  getTeam,
  logMockAction,
  type MockRegistration,
} from '@/repositories/mock'

const route = useRoute()
const router = useRouter()

const registrationId = computed<string>(() => {
  const raw = route.params['id']
  return Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
})

const registration = computed<MockRegistration | null>(() =>
  registrationId.value ? getRegistration(registrationId.value) : null,
)

const team = computed(() =>
  registration.value ? getTeam(registration.value.teamId) : null,
)

const playerFullName = computed(() =>
  registration.value
    ? `${registration.value.playerFirstName} ${registration.value.playerLastName}`
    : '',
)

// ─── Helpers FR (date + âge + genre) ──────────────────────────────
const FR_MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
]

function parseIso(iso: string): { y: number; m: number; d: number } | null {
  const parts = iso.split('-').map((p) => Number(p))
  if (parts.length !== 3) return null
  const y = parts[0]
  const m = parts[1]
  const d = parts[2]
  if (y === undefined || m === undefined || d === undefined) return null
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return null
  return { y, m, d }
}

function ageFromIso(iso: string): number | null {
  const p = parseIso(iso)
  if (!p) return null
  const today = new Date()
  let age = today.getFullYear() - p.y
  const before =
    today.getMonth() + 1 < p.m ||
    (today.getMonth() + 1 === p.m && today.getDate() < p.d)
  if (before) age -= 1
  return age
}

/** Format JSX "08.07.2010 (15 ans)" — DD.MM.YYYY + (X ans). */
function formatBirthDate(iso: string): string {
  const p = parseIso(iso)
  if (!p) return iso
  const dd = String(p.d).padStart(2, '0')
  const mm = String(p.m).padStart(2, '0')
  const age = ageFromIso(iso)
  return `${dd}.${mm}.${p.y}${age !== null ? ` (${age} ans)` : ''}`
}

function genderLabel(g: MockRegistration['playerGender']): string {
  if (g === 'M') return 'Masculin'
  if (g === 'F') return 'Féminin'
  if (g === 'other') return 'Autre'
  return 'Non précisé'
}

function genderTone(
  g: MockRegistration['playerGender'],
): 'sky' | 'amber' | 'violet' {
  if (g === 'F') return 'amber'
  if (g === 'M') return 'sky'
  return 'violet'
}

function relationshipLabel(rel: MockRegistration['submitterRelationship']): string {
  switch (rel) {
    case 'parent':
      return 'Parent'
    case 'tutor':
      return 'Tuteur légal'
    case 'sibling':
      return 'Fratrie'
    case 'caritas':
      return 'Caritas'
    case 'self':
      return 'Joueur lui-même'
    case 'other':
    default:
      return 'Autre'
  }
}

// ─── Status pill (essai / à traiter / refusée / active …) ────────
interface StatusBadge {
  label: string
  tone: 'amber' | 'sky' | 'emerald' | 'rose' | 'slate'
  dot: boolean
}

function statusBadge(status: MockRegistration['status']): StatusBadge {
  switch (status) {
    case 'submitted':
      return { label: 'À traiter', tone: 'amber', dot: true }
    case 'open_pending_trial':
      return { label: 'Essai à proposer', tone: 'amber', dot: true }
    case 'conditional_pending_review':
      return { label: 'À revoir', tone: 'amber', dot: true }
    case 'trial_in_progress':
      return { label: 'Essai en cours', tone: 'sky', dot: true }
    case 'confirmed_pending_dues':
      return { label: 'En attente paiement', tone: 'sky', dot: true }
    case 'active':
      return { label: 'Inscription active', tone: 'emerald', dot: true }
    case 'refused':
      return { label: 'Refusée', tone: 'rose', dot: true }
    default:
      return { label: status, tone: 'slate', dot: false }
  }
}

const currentStatus = computed<StatusBadge | null>(() =>
  registration.value ? statusBadge(registration.value.status) : null,
)

// ─── AVS (mocké déterministe + toggle) ────────────────────────────
const showAvs = ref(false)
const avsValue = computed(
  () => `756.${(registrationId.value.length || 4)}423.7785.21`,
)
const avsMasked = '••• •••• •••• ••'

function toggleAvs(): void {
  showAvs.value = !showAvs.value
}

// ─── Contacts mockés du submitter ────────────────────────────────
const submitterContact = computed(() => {
  if (!registration.value) return { phone: '+41 79 100 22 41', email: '' }
  const slug = registration.value.submitterName
    .toLowerCase()
    .replace(/\s+/g, '.')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  return {
    phone: '+41 79 100 22 41',
    email: `${slug}@famille.ch`,
  }
})

const playerPhone = '+41 79 442 18 99'
const playerAddress = 'Ch. du Lac 12, 1015 Lausanne'

// ─── CTA visibility ───────────────────────────────────────────────
type CtaSet = 'preDecision' | 'trial' | 'refused' | 'active' | 'pending_dues' | 'none'

const ctaSet = computed<CtaSet>(() => {
  if (!registration.value) return 'none'
  switch (registration.value.status) {
    case 'submitted':
    case 'open_pending_trial':
    case 'conditional_pending_review':
      return 'preDecision'
    case 'trial_in_progress':
      return 'trial'
    case 'refused':
      return 'refused'
    case 'active':
      return 'active'
    case 'confirmed_pending_dues':
      return 'pending_dues'
    default:
      return 'none'
  }
})

// ─── Actions ──────────────────────────────────────────────────────
function goBack(): void {
  if (window.history.length > 1) {
    router.back()
  } else {
    void router.push({ name: 'registrations' })
  }
}

function actionConfirm(): void {
  if (!registration.value) return
  logMockAction('co9.confirm', { id: registration.value.id })
  goBack()
}

function actionMarkTrial(): void {
  if (!registration.value) return
  logMockAction('co9.mark-trial', { id: registration.value.id })
  goBack()
}

// ─── Refuse dialog ────────────────────────────────────────────────
const refuseOpen = ref(false)
const refuseReason = ref('')
const refuseError = ref('')

function openRefuse(): void {
  refuseReason.value = ''
  refuseError.value = ''
  refuseOpen.value = true
}

function closeRefuse(): void {
  refuseOpen.value = false
}

function submitRefuse(): void {
  if (!registration.value) return
  const reason = refuseReason.value.trim()
  if (reason.length < 5) {
    refuseError.value = 'Précisez un motif (5 caractères minimum).'
    return
  }
  logMockAction('co9.refuse', { id: registration.value.id, reason })
  refuseOpen.value = false
  goBack()
}
</script>

<template>
  <!-- ─── Empty state : registration introuvable ──────────────── -->
  <CbMobileShell
    v-if="!registration"
    title="Inscription introuvable"
    show-back
    @back="goBack"
  >
    <div class="cb-page">
      <CbEmptyState
        :icon="FileText"
        title="Inscription introuvable"
        body="Cette inscription n'existe pas ou n'est plus accessible."
      >
        <template #actions>
          <button type="button" class="cb-btn primary sm" @click="goBack">
            <ArrowLeft :size="16" /> Retour
          </button>
        </template>
      </CbEmptyState>
    </div>
  </CbMobileShell>

  <!-- ─── CO9 — Mobile (transcription JSX l. 560-609) ────────── -->
  <CbMobileShell
    v-else
    title="Inscription"
    show-back
    @back="goBack"
  >
    <div class="cb-page">
      <!-- En-tête joueur (JSX l. 563-570) -->
      <div style="display: flex; gap: 12px; align-items: center">
        <CbAvatar :name="playerFullName" :tone="genderTone(registration.playerGender)" size="lg" />
        <div>
          <div class="cb-h2">{{ playerFullName }}</div>
          <div class="cb-sub">{{ team?.name ?? 'Équipe inconnue' }}</div>
          <div v-if="currentStatus" style="margin-top: 6px">
            <CbPill :tone="currentStatus.tone" :dot="currentStatus.dot">
              {{ currentStatus.label }}
            </CbPill>
          </div>
        </div>
      </div>

      <!-- Banner transfert international -->
      <CbBanner
        v-if="registration.previousClubAbroad"
        tone="amber"
        title="Transfert international détecté"
      >
        <template #icon><AlertTriangle :size="18" /></template>
        Un admin du club vous contactera après l'inscription pour traiter la
        lettre de sortie et l'enregistrement fédéral.
      </CbBanner>

      <!-- ─── Joueur (JSX l. 572-579) ─────────────────────────── -->
      <div class="cb-section-label" style="padding: 8px 0 4px">Joueur</div>
      <div class="cb-card">
        <div style="display: grid; grid-template-columns: 115px 1fr; gap: 8px; padding: 6px 0">
          <div class="cb-sub" style="font-size: 12px">Date de naissance</div>
          <div style="font-size: 13px; font-weight: 500">{{ formatBirthDate(registration.playerBirthDate) }}</div>
        </div>
        <div style="display: grid; grid-template-columns: 115px 1fr; gap: 8px; padding: 6px 0">
          <div class="cb-sub" style="font-size: 12px">Genre</div>
          <div style="font-size: 13px; font-weight: 500">{{ genderLabel(registration.playerGender) }}</div>
        </div>
        <div style="display: grid; grid-template-columns: 115px 1fr; gap: 8px; padding: 6px 0">
          <div class="cb-sub" style="font-size: 12px">AVS</div>
          <div class="mono" style="font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 8px">
            <span>{{ showAvs ? avsValue : avsMasked }}</span>
            <button
              type="button"
              class="co9-eye-btn"
              :aria-label="showAvs ? 'Masquer AVS' : 'Voir AVS'"
              @click="toggleAvs"
            >
              <EyeOff v-if="showAvs" :size="14" />
              <Eye v-else :size="14" />
            </button>
          </div>
        </div>
        <div style="display: grid; grid-template-columns: 115px 1fr; gap: 8px; padding: 6px 0">
          <div class="cb-sub" style="font-size: 12px">Téléphone</div>
          <div class="mono" style="font-size: 13px; font-weight: 500">{{ playerPhone }}</div>
        </div>
        <div style="display: grid; grid-template-columns: 115px 1fr; gap: 8px; padding: 6px 0">
          <div class="cb-sub" style="font-size: 12px">Adresse</div>
          <div style="font-size: 13px; font-weight: 500">{{ playerAddress }}</div>
        </div>
      </div>

      <!-- ─── Inscrit par (JSX l. 581-586) ────────────────────── -->
      <div class="cb-section-label" style="padding: 8px 0 4px">Inscrit par</div>
      <div class="cb-card">
        <div style="display: grid; grid-template-columns: 115px 1fr; gap: 8px; padding: 6px 0">
          <div class="cb-sub" style="font-size: 12px">Nom</div>
          <div style="font-size: 13px; font-weight: 500">{{ registration.submitterName }}</div>
        </div>
        <div style="display: grid; grid-template-columns: 115px 1fr; gap: 8px; padding: 6px 0">
          <div class="cb-sub" style="font-size: 12px">Relation</div>
          <div style="font-size: 13px; font-weight: 500">{{ relationshipLabel(registration.submitterRelationship) }}</div>
        </div>
        <div style="display: grid; grid-template-columns: 115px 1fr; gap: 8px; padding: 6px 0">
          <div class="cb-sub" style="font-size: 12px">Contact</div>
          <div style="font-size: 13px; font-weight: 500; word-break: break-all">
            {{ submitterContact.email }} · {{ submitterContact.phone }}
          </div>
        </div>
      </div>

      <!-- ─── Historique (JSX l. 588-593) ─────────────────────── -->
      <div class="cb-section-label" style="padding: 8px 0 4px">Historique</div>
      <div class="cb-card">
        <div style="display: grid; grid-template-columns: 115px 1fr; gap: 8px; padding: 6px 0">
          <div class="cb-sub" style="font-size: 12px">Déjà licencié</div>
          <div style="font-size: 13px; font-weight: 500">{{ registration.previouslyLicensed ? 'Oui' : 'Non' }}</div>
        </div>
        <div style="display: grid; grid-template-columns: 115px 1fr; gap: 8px; padding: 6px 0">
          <div class="cb-sub" style="font-size: 12px">Ancien club</div>
          <div style="font-size: 13px; font-weight: 500">
            {{ registration.previousClubName ?? 'Aucun' }}
            <template v-if="registration.previousClubName">
              ({{ registration.previousClubAbroad ? 'Étranger' : 'Suisse' }})
            </template>
          </div>
        </div>
        <div style="display: grid; grid-template-columns: 115px 1fr; gap: 8px; padding: 6px 0">
          <div class="cb-sub" style="font-size: 12px">Étranger</div>
          <div style="font-size: 13px; font-weight: 500">{{ registration.previousClubAbroad ? 'Oui' : 'Non' }}</div>
        </div>
      </div>

      <!-- ─── Documents (JSX l. 595-603) ──────────────────────── -->
      <template v-if="registration.previouslyLicensed">
        <div class="cb-section-label" style="padding: 8px 0 4px">Documents</div>
        <div class="cb-card" style="padding: 12px; display: flex; align-items: center; gap: 10px">
          <FileText :size="20" color="var(--slate-500)" />
          <div style="flex: 1">
            <div style="font-weight: 600; font-size: 13px">Lettre de sortie</div>
            <div class="cb-sub">
              <template v-if="registration.hasTransferLetter">
                PDF · 184 ko · reçue avec l'inscription
              </template>
              <template v-else>
                Document manquant
              </template>
            </div>
          </div>
          <CbPill
            v-if="registration.hasTransferLetter"
            tone="emerald"
            dot
          >Validée</CbPill>
          <CbPill v-else tone="amber" dot>Manquante</CbPill>
        </div>
      </template>

      <!-- ─── Banner status post-décision ─────────────────────── -->
      <CbBanner
        v-if="ctaSet === 'refused'"
        tone="rose"
        title="Inscription refusée"
      >
        <template #icon><X :size="18" /></template>
        <template v-if="registration.refusalReason">
          Motif : {{ registration.refusalReason }}
        </template>
        <template v-else>
          Aucun motif n'a été enregistré.
        </template>
      </CbBanner>

      <CbBanner
        v-else-if="ctaSet === 'active'"
        tone="emerald"
        title="Inscription active"
      >
        <template #icon><CheckCircle2 :size="18" /></template>
        Le joueur est officiellement inscrit dans l'équipe.
      </CbBanner>

      <CbBanner
        v-else-if="ctaSet === 'pending_dues'"
        tone="sky"
        title="En attente de paiement"
      >
        <template #icon><CheckCircle2 :size="18" /></template>
        L'inscription est confirmée — l'activation finale se fait à la
        réception de la cotisation.
      </CbBanner>
    </div>

    <!-- ─── Bottom bar (JSX l. 605-608, étendue par status) ───── -->
    <CbBottomBar v-if="ctaSet === 'preDecision'">
      <button type="button" class="cb-btn outline danger" style="flex: 1" @click="openRefuse">
        Refuser
      </button>
      <button type="button" class="cb-btn outline" style="flex: 1" @click="actionMarkTrial">
        Marquer essai
      </button>
      <button type="button" class="cb-btn primary" style="flex: 2" @click="actionConfirm">
        <CheckCircle2 :size="16" /> Confirmer l'inscription
      </button>
    </CbBottomBar>

    <CbBottomBar v-else-if="ctaSet === 'trial'">
      <button type="button" class="cb-btn outline danger" style="flex: 1" @click="openRefuse">
        Refuser
      </button>
      <button type="button" class="cb-btn primary" style="flex: 2" @click="actionConfirm">
        <CheckCircle2 :size="16" /> Confirmer l'inscription
      </button>
    </CbBottomBar>
  </CbMobileShell>

  <!-- ─── Dialog motif refus ──────────────────────────────────── -->
  <Teleport to="body">
    <div
      v-if="refuseOpen"
      class="co9-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      :aria-label="`Refuser l'inscription de ${playerFullName}`"
      @click.self="closeRefuse"
    >
      <div class="co9-dialog">
        <div class="co9-dialog-head">
          <h2 class="cb-h2">Refuser l'inscription</h2>
          <button
            type="button"
            class="cb-iconbtn"
            aria-label="Fermer"
            @click="closeRefuse"
          >
            <X :size="18" />
          </button>
        </div>
        <div class="co9-dialog-body">
          <p class="cb-sub" style="margin-bottom: 12px">
            Indiquez le motif du refus. Il sera transmis à
            <strong>{{ registration?.submitterName ?? 'la personne ayant inscrit' }}</strong>
            par notification.
          </p>
          <label class="co9-dialog-label" for="co9-refuse-reason">
            Motif (obligatoire)
          </label>
          <textarea
            id="co9-refuse-reason"
            v-model="refuseReason"
            class="co9-textarea"
            rows="4"
            placeholder="Ex. Effectif complet pour cette catégorie. Voir équipe U16M loisir comme alternative…"
            :aria-invalid="refuseError ? 'true' : 'false'"
          />
          <p v-if="refuseError" class="co9-error">{{ refuseError }}</p>
        </div>
        <div class="co9-dialog-actions">
          <button type="button" class="cb-btn ghost" @click="closeRefuse">
            Annuler
          </button>
          <button type="button" class="cb-btn danger" @click="submitRefuse">
            <X :size="16" /> Confirmer le refus
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Bouton toggle AVS — pas couvert par tokens.css */
.co9-eye-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-subtle);
  cursor: pointer;
  padding: 0;
}
.co9-eye-btn:hover {
  background: var(--slate-50);
  color: var(--text);
}

/* Dialog motif refus */
.co9-dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 1000;
}
.co9-dialog {
  background: var(--bg);
  border-radius: 16px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.18);
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.co9-dialog-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border);
}
.co9-dialog-body {
  padding: 18px;
}
.co9-dialog-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-subtle);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.co9-textarea {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  font: inherit;
  font-size: 13px;
  resize: vertical;
  background: var(--bg);
  color: var(--text);
  outline: none;
}
.co9-textarea:focus {
  border-color: var(--emerald-500, var(--slate-700));
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
}
.co9-textarea[aria-invalid='true'] {
  border-color: var(--rose-500);
}
.co9-error {
  color: var(--rose-600);
  font-size: 12px;
  margin-top: 6px;
}
.co9-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 18px 18px;
  border-top: 1px solid var(--border);
  background: var(--slate-50, var(--bg));
}
</style>
