<script setup lang="ts">
/**
 * A3-detail — Détail d'une demande (admin).
 *
 * Sous-écran de A3 (Requests). Affiche toutes les informations d'une demande
 * pending (licence / exception cotisation / déplacement match) pour permettre
 * la décision admin (approuver / refuser) avec un commentaire optionnel.
 *
 * Variantes selon `request.kind` :
 *   - `license`           → card "Concerne" pointe sur le membre + lien fiche.
 *   - `payment_exception` → card "Concerne" affiche membre + montant cotisation
 *                            + pill "Exclu" si `dues.status === 'excluded'`.
 *   - `match_move`        → card "Concerne" pointe sur le match adverse.
 *
 * Validation commentaire :
 *   - Approuver : commentaire optionnel.
 *   - Refuser   : commentaire **obligatoire**, min 10 caractères.
 *
 * Mock-only — `processMatchRequest`, `updateDoc /licenseRequests`, `updateDoc
 * /paymentExceptionRequests` seront branchés lors du switch Firebase. Pour
 * l'instant, les CTAs loguent via `logMockAction(...)` puis `router.back()`.
 *
 * Cf. `docs/design-brief-courtbase-app.md` § A3 fin + référence visuelle
 * `/tmp/courtbase-app-design/courtbase-app/project/screens/admin.jsx`
 * (composant `RequestCard`).
 */
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  FileText,
  Inbox,
  MessageSquare,
  Quote,
  Tag,
  User,
  Users,
  X,
} from 'lucide-vue-next'

import CbAvatar from '@/components/ui/CbAvatar.vue'
import CbBanner from '@/components/ui/CbBanner.vue'
import CbBottomBar from '@/components/ui/CbBottomBar.vue'
import CbDesktopShell from '@/components/ui/CbDesktopShell.vue'
import CbEmptyState from '@/components/ui/CbEmptyState.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbPageHead from '@/components/ui/CbPageHead.vue'
import CbPill, { type CbPillTone } from '@/components/ui/CbPill.vue'
import { useShellNav } from '@/composables/useShellNav'
import { useViewport } from '@/composables/useViewport'
import {
  countUnread,
  getDueForMember,
  getRequest,
  logMockAction,
  type MockDue,
  type MockMember,
  type MockRequest,
} from '@/repositories/mock'
import { MOCK_MEMBERS } from '@/repositories/mock/seeds'

// ────────────────────────────────────────────────────────────────
// Mock — id forcé pour démo (override le router param si défini)
// ────────────────────────────────────────────────────────────────

/**
 * **Mock only** — si non-null, force l'affichage d'une demande donnée
 * indépendamment du paramètre de route. Pratique pour itérer dans le
 * designer sans naviguer depuis A3 à chaque rechargement.
 *
 *   null     → utilise `route.params.id` (mode router normal)
 *   'req-1'  → license, Léo Martin (pending)
 *   'req-2'  → payment_exception, Inès Vidal (excluded)
 *   'req-3'  → match_move, vs Meyrin BC U16M
 *
 * Quand on basculera sur Firebase, supprimer cette const + utiliser
 * directement `route.params.id` comme dans `Requests.vue`.
 */
const MOCK_DEMO_REQUEST_ID: string | null = null

// ────────────────────────────────────────────────────────────────
// Data
// ────────────────────────────────────────────────────────────────

const route = useRoute()
const router = useRouter()
const { isDesktop } = useViewport()
const { tabs, nav, primaryRoleLabel } = useShellNav()

const requestId = computed<string>(() => {
  if (MOCK_DEMO_REQUEST_ID !== null) return MOCK_DEMO_REQUEST_ID
  const raw = route.params['id']
  return Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
})

const request = computed<MockRequest | null>(() =>
  requestId.value ? getRequest(requestId.value) : null,
)

/**
 * Cherche le membre concerné par `request.memberName`. Le mock ne stocke pas
 * un `memberId` direct côté request — on retrouve par nom complet (cohérent
 * avec les seeds : "Léo Martin", "Inès Vidal"). À remplacer par `memberId`
 * canonique lors du switch Firebase.
 */
function findMemberByName(fullName: string | undefined): MockMember | null {
  if (!fullName) return null
  const target = fullName.trim().toLowerCase()
  return (
    MOCK_MEMBERS.find(
      (m) => `${m.firstName} ${m.lastName}`.toLowerCase() === target,
    ) ?? null
  )
}

const concernedMember = computed<MockMember | null>(() =>
  request.value ? findMemberByName(request.value.memberName) : null,
)

const concernedDue = computed<MockDue | null>(() =>
  concernedMember.value ? getDueForMember(concernedMember.value.id) : null,
)

// ────────────────────────────────────────────────────────────────
// Kind metadata (label, pill tone, icône, header)
// ────────────────────────────────────────────────────────────────

interface KindMeta {
  label: string
  shortLabel: string
  tone: CbPillTone
}

function kindMeta(kind: MockRequest['kind']): KindMeta {
  switch (kind) {
    case 'license':
      return { label: 'Demande de licence', shortLabel: 'Licence', tone: 'violet' }
    case 'payment_exception':
      return {
        label: 'Exception cotisation',
        shortLabel: 'Exception cotisation',
        tone: 'amber',
      }
    case 'match_move':
      return {
        label: 'Déplacement match',
        shortLabel: 'Déplacement match',
        tone: 'sky',
      }
    default:
      return { label: 'Demande', shortLabel: 'Demande', tone: 'slate' }
  }
}

const kindInfo = computed<KindMeta | null>(() =>
  request.value ? kindMeta(request.value.kind) : null,
)

// ────────────────────────────────────────────────────────────────
// Status badge — pending / approved / rejected
// ────────────────────────────────────────────────────────────────

interface StatusBadge {
  label: string
  tone: CbPillTone
  dot: boolean
}

function statusBadge(status: MockRequest['status']): StatusBadge {
  switch (status) {
    case 'pending':
      return { label: 'En attente', tone: 'amber', dot: true }
    case 'approved':
      return { label: 'Approuvée', tone: 'emerald', dot: true }
    case 'rejected':
      return { label: 'Refusée', tone: 'rose', dot: true }
    default:
      return { label: status, tone: 'slate', dot: false }
  }
}

const currentStatus = computed<StatusBadge | null>(() =>
  request.value ? statusBadge(request.value.status) : null,
)

const isPending = computed(() => request.value?.status === 'pending')

// ────────────────────────────────────────────────────────────────
// Member "Concerne" — pill cotisation (pour payment_exception surtout)
// ────────────────────────────────────────────────────────────────

function duesStatusPill(status: MockDue['status']): StatusBadge {
  switch (status) {
    case 'paid':
      return { label: 'Payée', tone: 'emerald', dot: true }
    case 'pending_grace':
      return { label: 'En grâce', tone: 'amber', dot: true }
    case 'issued':
      return { label: 'À régler', tone: 'amber', dot: true }
    case 'overdue':
      return { label: 'En retard', tone: 'rose', dot: true }
    case 'excluded':
      return { label: 'Exclu', tone: 'rose', dot: true }
    case 'excepted':
      return { label: 'Exception en cours', tone: 'violet', dot: true }
    default:
      return { label: status, tone: 'slate', dot: false }
  }
}

const duesBadge = computed<StatusBadge | null>(() =>
  concernedDue.value ? duesStatusPill(concernedDue.value.status) : null,
)

// ────────────────────────────────────────────────────────────────
// Commentaire + validation
// ────────────────────────────────────────────────────────────────

const comment = ref('')
const commentError = ref('')

const REJECT_MIN_LENGTH = 10

function clearError(): void {
  if (commentError.value) commentError.value = ''
}

// ────────────────────────────────────────────────────────────────
// Actions — approve / reject
// ────────────────────────────────────────────────────────────────

function approve(): void {
  if (!request.value || !isPending.value) return
  const trimmed = comment.value.trim()
  // Commentaire optionnel pour approve — on log tel quel.
  logMockAction('a3-detail.approve', {
    id: request.value.id,
    kind: request.value.kind,
    comment: trimmed.length > 0 ? trimmed : null,
  })
  goBack()
}

function reject(): void {
  if (!request.value || !isPending.value) return
  const trimmed = comment.value.trim()
  if (trimmed.length < REJECT_MIN_LENGTH) {
    commentError.value = `Un commentaire d'au moins ${REJECT_MIN_LENGTH} caractères est requis pour refuser.`
    return
  }
  logMockAction('a3-detail.reject', {
    id: request.value.id,
    kind: request.value.kind,
    comment: trimmed,
  })
  goBack()
}

function goBack(): void {
  if (window.history.length > 1) {
    router.back()
  } else {
    void router.push({ name: 'requests' })
  }
}

function openMemberDetail(): void {
  // Limitation mock : l'app companion n'a pas de route admin "member-detail"
  // dédiée (le coach a CO4, l'admin n'a pas l'équivalent dans le brief A1-A4).
  // On log l'intent — à câbler quand une route admin-member sera créée.
  if (!concernedMember.value) return
  logMockAction('a3-detail.open-member', { memberId: concernedMember.value.id })
}

function openMatchDetail(): void {
  // Limitation mock : on n'a pas de référence `matchId` côté request
  // (`matchOpponent` est un string libre). À câbler quand le seed expose un
  // `matchId` ou quand on branchera Firebase.
  if (!request.value || request.value.kind !== 'match_move') return
  logMockAction('a3-detail.open-match', { opponent: request.value.matchOpponent })
}

// ────────────────────────────────────────────────────────────────
// Shell — badge cloche header
// ────────────────────────────────────────────────────────────────

const notifBadgeCount = computed(() => countUnread())

function onNotifClick(): void {
  void router.push({ name: 'notifications' })
}

// ────────────────────────────────────────────────────────────────
// Titles
// ────────────────────────────────────────────────────────────────

const pageTitle = computed(() =>
  kindInfo.value ? `Demande ${kindInfo.value.shortLabel.toLowerCase()}` : 'Demande',
)

const desktopSubtitle = computed(() => {
  if (!request.value) return ''
  return `Soumise ${request.value.submittedAt} · par ${request.value.requesterName}`
})

const cotisationFormatted = computed(() => {
  if (!concernedDue.value) return null
  return `${concernedDue.value.amount.toFixed(2)} CHF`
})
</script>

<template>
  <!-- ─── Cas erreur : request introuvable ──────────────────── -->
  <CbMobileShell
    v-if="!request"
    title="Demande introuvable"
    show-back
    @back="goBack"
  >
    <div class="cb-page">
      <CbEmptyState
        :icon="Inbox"
        title="Demande introuvable"
        body="Cette demande n'existe pas ou a déjà été traitée."
      >
        <template #actions>
          <button type="button" class="cb-btn primary sm" @click="goBack">
            <ArrowLeft :size="16" /> Retour
          </button>
        </template>
      </CbEmptyState>
    </div>
  </CbMobileShell>

  <!-- ─── Mobile (<1024px) ──────────────────────────────────── -->
  <CbMobileShell
    v-else-if="!isDesktop"
    class="a3d-mobile"
    :title="pageTitle"
    club="BCA"
    show-back
    :notif-badge="notifBadgeCount > 0"
    :tabs="tabs"
    @back="goBack"
    @notif-click="onNotifClick"
  >
    <div class="cb-page">
      <!-- En-tête : kind + status -->
      <div class="a3d-head">
        <div class="a3d-head-row">
          <CbPill v-if="kindInfo" :tone="kindInfo.tone">
            {{ kindInfo.shortLabel }}
          </CbPill>
          <CbPill v-if="currentStatus" :tone="currentStatus.tone" :dot="currentStatus.dot">
            {{ currentStatus.label }}
          </CbPill>
        </div>
        <div class="cb-h2" style="margin-top: 8px">
          {{ kindInfo?.label ?? 'Demande' }}
        </div>
      </div>

      <!-- ─── Card Demandeur ─────────────────────────────────── -->
      <div class="cb-section-label" style="padding: 8px 0 4px">Demandeur</div>
      <div class="cb-card a3d-card-row">
        <CbAvatar :name="request.requesterName" tone="emerald" />
        <div style="flex: 1; min-width: 0">
          <div style="font-weight: 600; font-size: 14px">
            {{ request.requesterName }}
          </div>
          <div class="cb-sub" style="margin-top: 2px">Coach</div>
        </div>
      </div>

      <!-- ─── Card Concerne ──────────────────────────────────── -->
      <div class="cb-section-label" style="padding: 8px 0 4px">Concerne</div>

      <!-- license / payment_exception → membre -->
      <button
        v-if="request.kind === 'license' || request.kind === 'payment_exception'"
        type="button"
        class="cb-card a3d-card-link"
        :disabled="!concernedMember"
        @click="openMemberDetail"
      >
        <CbAvatar
          :name="request.memberName ?? '?'"
          :tone="concernedMember?.avatarTone ?? 'sky'"
        />
        <div style="flex: 1; min-width: 0; text-align: left">
          <div class="a3d-row">
            <User :size="14" class="a3d-row-icon" />
            <div class="a3d-row-label">Membre</div>
            <div class="a3d-row-value">{{ request.memberName }}</div>
          </div>
          <div v-if="request.kind === 'payment_exception'" class="a3d-row">
            <Tag :size="14" class="a3d-row-icon" />
            <div class="a3d-row-label">Cotisation</div>
            <div
              class="a3d-row-value"
              style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap"
            >
              <span class="mono">{{ cotisationFormatted ?? '—' }}</span>
              <CbPill v-if="duesBadge" :tone="duesBadge.tone" :dot="duesBadge.dot">
                {{ duesBadge.label }}
              </CbPill>
            </div>
          </div>
        </div>
        <ChevronRight v-if="concernedMember" :size="16" class="a3d-chevron" />
      </button>

      <!-- match_move → match adverse -->
      <button
        v-else-if="request.kind === 'match_move'"
        type="button"
        class="cb-card a3d-card-link"
        @click="openMatchDetail"
      >
        <div
          class="a3d-match-icon"
          style="background: var(--sky-100); color: var(--sky-700)"
        >
          <Calendar :size="18" />
        </div>
        <div style="flex: 1; min-width: 0; text-align: left">
          <div class="a3d-row">
            <Users :size="14" class="a3d-row-icon" />
            <div class="a3d-row-label">Match</div>
            <div class="a3d-row-value">vs {{ request.matchOpponent }}</div>
          </div>
        </div>
        <ChevronRight :size="16" class="a3d-chevron" />
      </button>

      <!-- ─── Card Motivation ─────────────────────────────────── -->
      <div class="cb-section-label" style="padding: 8px 0 4px">Motivation</div>
      <div class="cb-card a3d-motivation">
        <Quote :size="16" class="a3d-quote-icon" />
        <p class="a3d-motivation-text">{{ request.motivation }}</p>
      </div>

      <!-- ─── Card Métadonnées ────────────────────────────────── -->
      <div class="cb-section-label" style="padding: 8px 0 4px">Détails</div>
      <div class="cb-card a3d-info-card">
        <div class="a3d-row">
          <Calendar :size="14" class="a3d-row-icon" />
          <div class="a3d-row-label">Soumise</div>
          <div class="a3d-row-value">{{ request.submittedAt }}</div>
        </div>
        <div class="a3d-row">
          <FileText :size="14" class="a3d-row-icon" />
          <div class="a3d-row-label">Statut</div>
          <div class="a3d-row-value">
            <CbPill v-if="currentStatus" :tone="currentStatus.tone" :dot="currentStatus.dot">
              {{ currentStatus.label }}
            </CbPill>
          </div>
        </div>
        <div class="a3d-row">
          <Tag :size="14" class="a3d-row-icon" />
          <div class="a3d-row-label">Type</div>
          <div class="a3d-row-value">
            <CbPill v-if="kindInfo" :tone="kindInfo.tone">
              {{ kindInfo.shortLabel }}
            </CbPill>
          </div>
        </div>
      </div>

      <!-- ─── Commentaire (uniquement si pending) ─────────────── -->
      <template v-if="isPending">
        <div class="cb-section-label" style="padding: 8px 0 4px">
          Commentaire (optionnel pour approuver, obligatoire pour refuser)
        </div>
        <div class="cb-card a3d-comment-card">
          <label class="a3d-comment-label" for="a3d-comment-mobile">
            <MessageSquare :size="14" /> Votre commentaire
          </label>
          <textarea
            id="a3d-comment-mobile"
            v-model="comment"
            class="a3d-textarea"
            rows="4"
            placeholder="Ex. Décision validée par le comité. Voir avec le trésorier pour la suite."
            :aria-invalid="commentError ? 'true' : 'false'"
            @input="clearError"
          />
          <p class="a3d-helper">
            Sera communiqué au coach demandeur ({{ request.requesterName }}).
          </p>
          <p v-if="commentError" class="a3d-error">{{ commentError }}</p>
        </div>
      </template>

      <!-- ─── Banner si déjà traitée ──────────────────────────── -->
      <CbBanner
        v-if="request.status === 'approved'"
        tone="emerald"
        title="Demande approuvée"
      >
        <template #icon><CheckCircle2 :size="18" /></template>
        Cette demande a déjà été approuvée — aucune action supplémentaire
        n'est requise.
      </CbBanner>
      <CbBanner
        v-else-if="request.status === 'rejected'"
        tone="rose"
        title="Demande refusée"
      >
        <template #icon><AlertTriangle :size="18" /></template>
        Cette demande a déjà été refusée. Le coach a été notifié.
      </CbBanner>
    </div>

    <!-- ─── Sticky bottom CTAs ─────────────────────────────────── -->
    <CbBottomBar v-if="isPending">
      <button
        type="button"
        class="cb-btn outline danger lg"
        style="flex: 1"
        @click="reject"
      >
        <X :size="16" /> Refuser
      </button>
      <button
        type="button"
        class="cb-btn primary lg"
        style="flex: 1"
        @click="approve"
      >
        <CheckCircle2 :size="16" /> Approuver
      </button>
    </CbBottomBar>
  </CbMobileShell>

  <!-- ─── Desktop (≥1024px) ─────────────────────────────────── -->
  <CbDesktopShell
    v-else
    class="a3d-desktop"
    :items="nav"
    brand-name="BC Aigles"
    brand-sub="Saison 2025/26"
    club-initials="BCA"
    user-name="Admin"
    :user-role="primaryRoleLabel"
  >
    <CbPageHead :title="pageTitle" :subtitle="desktopSubtitle">
      <template #actions>
        <button type="button" class="cb-btn ghost" @click="goBack">
          <ArrowLeft :size="16" /> Retour
        </button>
        <template v-if="isPending">
          <button type="button" class="cb-btn outline danger lg" @click="reject">
            <X :size="16" /> Refuser
          </button>
          <button type="button" class="cb-btn primary lg" @click="approve">
            <CheckCircle2 :size="16" /> Approuver
          </button>
        </template>
        <template v-else>
          <CbPill v-if="currentStatus" :tone="currentStatus.tone" :dot="currentStatus.dot">
            {{ currentStatus.label }}
          </CbPill>
        </template>
      </template>
    </CbPageHead>

    <div class="a3d-desktop-body">
      <!-- Banner si déjà traitée (haut de page) -->
      <CbBanner
        v-if="request.status === 'approved'"
        tone="emerald"
        title="Demande approuvée"
      >
        <template #icon><CheckCircle2 :size="18" /></template>
        Cette demande a déjà été approuvée — aucune action supplémentaire
        n'est requise.
      </CbBanner>
      <CbBanner
        v-else-if="request.status === 'rejected'"
        tone="rose"
        title="Demande refusée"
      >
        <template #icon><AlertTriangle :size="18" /></template>
        Cette demande a déjà été refusée. Le coach a été notifié.
      </CbBanner>

      <!-- Grille 2 colonnes -->
      <div class="a3d-desktop-grid">
        <!-- ─── Colonne gauche : Demandeur + Concerne + Motivation -->
        <div class="a3d-col">
          <div>
            <div class="cb-section-label" style="padding: 0 4px 8px">Demandeur</div>
            <div class="cb-card a3d-card-row">
              <CbAvatar :name="request.requesterName" tone="emerald" size="lg" />
              <div style="flex: 1; min-width: 0">
                <div style="font-weight: 600; font-size: 15px">
                  {{ request.requesterName }}
                </div>
                <div class="cb-sub" style="margin-top: 2px">Coach</div>
              </div>
            </div>
          </div>

          <div>
            <div class="cb-section-label" style="padding: 0 4px 8px">Concerne</div>

            <!-- license / payment_exception → membre -->
            <button
              v-if="request.kind === 'license' || request.kind === 'payment_exception'"
              type="button"
              class="cb-card a3d-card-link"
              :disabled="!concernedMember"
              @click="openMemberDetail"
            >
              <CbAvatar
                :name="request.memberName ?? '?'"
                :tone="concernedMember?.avatarTone ?? 'sky'"
                size="lg"
              />
              <div style="flex: 1; min-width: 0; text-align: left">
                <div class="a3d-row">
                  <User :size="14" class="a3d-row-icon" />
                  <div class="a3d-row-label">Membre</div>
                  <div class="a3d-row-value">{{ request.memberName }}</div>
                </div>
                <div v-if="request.kind === 'payment_exception'" class="a3d-row">
                  <Tag :size="14" class="a3d-row-icon" />
                  <div class="a3d-row-label">Cotisation</div>
                  <div
                    class="a3d-row-value"
                    style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap"
                  >
                    <span class="mono">{{ cotisationFormatted ?? '—' }}</span>
                    <CbPill v-if="duesBadge" :tone="duesBadge.tone" :dot="duesBadge.dot">
                      {{ duesBadge.label }}
                    </CbPill>
                  </div>
                </div>
              </div>
              <ArrowRight v-if="concernedMember" :size="16" class="a3d-chevron" />
            </button>

            <!-- match_move → match adverse -->
            <button
              v-else-if="request.kind === 'match_move'"
              type="button"
              class="cb-card a3d-card-link"
              @click="openMatchDetail"
            >
              <div
                class="a3d-match-icon lg"
                style="background: var(--sky-100); color: var(--sky-700)"
              >
                <Calendar :size="22" />
              </div>
              <div style="flex: 1; min-width: 0; text-align: left">
                <div class="a3d-row">
                  <Users :size="14" class="a3d-row-icon" />
                  <div class="a3d-row-label">Match</div>
                  <div class="a3d-row-value">vs {{ request.matchOpponent }}</div>
                </div>
              </div>
              <ArrowRight :size="16" class="a3d-chevron" />
            </button>
          </div>

          <div>
            <div class="cb-section-label" style="padding: 0 4px 8px">Motivation</div>
            <div class="cb-card a3d-motivation">
              <Quote :size="18" class="a3d-quote-icon" />
              <p class="a3d-motivation-text">{{ request.motivation }}</p>
            </div>
          </div>
        </div>

        <!-- ─── Colonne droite : Métadonnées + Commentaire -->
        <div class="a3d-col">
          <div>
            <div class="cb-section-label" style="padding: 0 4px 8px">Détails</div>
            <div class="cb-card a3d-info-card">
              <div class="a3d-row">
                <Calendar :size="14" class="a3d-row-icon" />
                <div class="a3d-row-label">Soumise</div>
                <div class="a3d-row-value">{{ request.submittedAt }}</div>
              </div>
              <div class="a3d-row">
                <FileText :size="14" class="a3d-row-icon" />
                <div class="a3d-row-label">Statut</div>
                <div class="a3d-row-value">
                  <CbPill
                    v-if="currentStatus"
                    :tone="currentStatus.tone"
                    :dot="currentStatus.dot"
                  >
                    {{ currentStatus.label }}
                  </CbPill>
                </div>
              </div>
              <div class="a3d-row">
                <Tag :size="14" class="a3d-row-icon" />
                <div class="a3d-row-label">Type</div>
                <div class="a3d-row-value">
                  <CbPill v-if="kindInfo" :tone="kindInfo.tone">
                    {{ kindInfo.shortLabel }}
                  </CbPill>
                </div>
              </div>
              <div class="a3d-row">
                <ClipboardList :size="14" class="a3d-row-icon" />
                <div class="a3d-row-label">ID</div>
                <div class="a3d-row-value mono">{{ request.id }}</div>
              </div>
            </div>
          </div>

          <template v-if="isPending">
            <div>
              <div class="cb-section-label" style="padding: 0 4px 8px">
                Commentaire
              </div>
              <div class="cb-card a3d-comment-card">
                <label class="a3d-comment-label" for="a3d-comment-desktop">
                  <MessageSquare :size="14" /> Votre commentaire
                </label>
                <textarea
                  id="a3d-comment-desktop"
                  v-model="comment"
                  class="a3d-textarea"
                  rows="5"
                  placeholder="Ex. Décision validée par le comité. Voir avec le trésorier pour la suite."
                  :aria-invalid="commentError ? 'true' : 'false'"
                  @input="clearError"
                />
                <p class="a3d-helper">
                  Sera communiqué au coach demandeur ({{ request.requesterName }}).
                  Optionnel pour approuver, <strong>obligatoire</strong> pour
                  refuser (10 caractères minimum).
                </p>
                <p v-if="commentError" class="a3d-error">{{ commentError }}</p>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </CbDesktopShell>
</template>

<style scoped>
/* ─── Responsive shells ───────────────────────────────────── */
.a3d-mobile { display: flex; }
.a3d-desktop { display: none; }
@media (min-width: 1024px) {
  .a3d-mobile { display: none; }
  .a3d-desktop { display: flex; }
}

/* ─── Head (kind pill + status pill) ──────────────────────── */
.a3d-head {
  padding: 4px 0 4px;
}
.a3d-head-row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

/* ─── Card row (Demandeur, Concerne) ──────────────────────── */
.a3d-card-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
}

/* ─── Card "link" (Concerne, clickable) ───────────────────── */
.a3d-card-link {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  width: 100%;
  border: 1px solid var(--border);
  background: var(--bg);
  border-radius: 12px;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.a3d-card-link:hover:not(:disabled) {
  background: var(--slate-50);
  border-color: var(--slate-300, var(--border));
}
.a3d-card-link:disabled {
  cursor: default;
  opacity: 0.85;
}
.a3d-chevron {
  color: var(--text-subtle);
  flex-shrink: 0;
}

.a3d-match-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  flex-shrink: 0;
}
.a3d-match-icon.lg {
  width: 48px;
  height: 48px;
  border-radius: 12px;
}

/* ─── Info card (rows label/value) ────────────────────────── */
.a3d-info-card {
  padding: 4px 14px;
}
.a3d-row {
  display: grid;
  grid-template-columns: 16px 110px 1fr;
  gap: 8px;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}
.a3d-row:last-child {
  border-bottom: none;
}
.a3d-row-icon {
  color: var(--slate-400);
  flex-shrink: 0;
}
.a3d-row-label {
  font-size: 12px;
  color: var(--text-subtle);
}
.a3d-row-value {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  min-width: 0;
  word-break: break-word;
}
.a3d-row-value.mono,
.mono {
  font-family: var(--font-mono);
}

/* ─── Motivation ──────────────────────────────────────────── */
.a3d-motivation {
  position: relative;
  padding: 16px 18px 16px 44px;
}
.a3d-quote-icon {
  position: absolute;
  top: 16px;
  left: 16px;
  color: var(--slate-300);
}
.a3d-motivation-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.55;
  color: var(--text);
  white-space: pre-wrap;
}

/* ─── Comment card ────────────────────────────────────────── */
.a3d-comment-card {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.a3d-comment-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-subtle);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.a3d-textarea {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  font: inherit;
  font-size: 13px;
  line-height: 1.45;
  resize: vertical;
  background: var(--bg);
  color: var(--text);
  outline: none;
  min-height: 96px;
}
.a3d-textarea:focus {
  border-color: var(--emerald-500, var(--slate-700));
  box-shadow: 0 0 0 3px var(--emerald-100, rgba(16, 185, 129, 0.15));
}
.a3d-textarea[aria-invalid='true'] {
  border-color: var(--rose-500);
  box-shadow: 0 0 0 3px var(--rose-100, rgba(244, 63, 94, 0.12));
}
.a3d-helper {
  margin: 0;
  font-size: 12px;
  color: var(--text-subtle);
  line-height: 1.4;
}
.a3d-error {
  margin: 0;
  color: var(--rose-600);
  font-size: 12px;
  font-weight: 500;
}

/* ─── Desktop body + grid ────────────────────────────────── */
.a3d-desktop-body {
  flex: 1;
  overflow: auto;
  padding: 24px 28px;
  background: var(--bg-muted);
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.a3d-desktop-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
  max-width: 1100px;
}
.a3d-col {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
</style>
