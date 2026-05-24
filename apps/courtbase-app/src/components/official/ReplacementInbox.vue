<script setup lang="ts">
/**
 * ReplacementInbox — Inbox des demandes de remplacement reçues par
 * l'officiel courant. Intégré tout en haut de `MyAssignments.vue` (tab
 * Liste, AVANT la section URGENT).
 *
 * Côté target (l'officiel qui REÇOIT la demande) : on liste les requests
 * `status === 'pending'` où `targetMemberId === auth.userDoc.memberId`,
 * et on permet 2 actions :
 *   - **Accepter** → callable `acceptRequest` : la cible devient
 *     titulaire de l'assignation, le demandeur est libéré.
 *   - **Décliner** → callable `declineRequest(id, reason?)` : la cible
 *     refuse, le demandeur reste titulaire et peut tenter quelqu'un d'autre.
 *
 * Pour aider la décision, chaque card affiche les **conflits d'agenda**
 * détectés côté caller (déjà coach/joueur/officiant pendant le créneau)
 * via `detectConflicts`. Les boutons restent actifs même avec conflits —
 * c'est au target de juger.
 *
 * Composant **contenu pur** : pas de shell, pas de header. Visible
 * uniquement si `incomingPending.length > 0` (sinon la section racine ne
 * rend rien — v-if sur le `section`).
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  AlertTriangle,
  CheckCircle2,
  Inbox,
  Info,
  MapPin,
  XCircle,
} from 'lucide-vue-next'

import type { ReplacementRequest } from '@club-app/shared-types'

import CbPill from '@/components/ui/CbPill.vue'
import { useAuthStore } from '@/stores/auth'
import { useBookingsStore } from '@/stores/bookings'
import { useOfficialsStore } from '@/stores/officials'
import { useReplacementsStore } from '@/stores/replacements'
import {
  detectConflicts,
  type ConflictBookingSource,
  type ConflictInfo,
} from '@/utils/officialConflicts'

// ─── Emits ───────────────────────────────────────────────────────────

const emit = defineEmits<{
  (e: 'accepted', requestId: string): void
  (e: 'declined', requestId: string): void
}>()

// ─── Stores ──────────────────────────────────────────────────────────

const auth = useAuthStore()
const bookingsStore = useBookingsStore()
const officialsStore = useOfficialsStore()
const replacementsStore = useReplacementsStore()

// ─── Mount ───────────────────────────────────────────────────────────
// Le parent (`MyAssignments.vue`) appelle déjà `loadOfficialContext` —
// on charge ici uniquement bookings (idempotent) + les requests.

onMounted(async () => {
  const memberId = auth.userDoc?.memberId
  if (!memberId) return
  await Promise.all([
    bookingsStore.loadActiveContext(),
    replacementsStore.load(memberId),
  ])
})

// ─── State local — submit / dialog / toast ───────────────────────────

const submittingId = ref<string | null>(null)

interface DeclineState {
  requestId: string
  reason: string
}
const declineDialog = ref<DeclineState | null>(null)

interface ToastState {
  tone: 'emerald' | 'rose' | 'sky'
  message: string
  visible: boolean
}
const toast = ref<ToastState>({ tone: 'sky', message: '', visible: false })
let toastTimer: ReturnType<typeof setTimeout> | null = null

const toastIcon = computed(() => {
  if (toast.value.tone === 'rose') return AlertTriangle
  if (toast.value.tone === 'sky') return Info
  return CheckCircle2
})

function showToast(tone: ToastState['tone'], message: string): void {
  if (toastTimer !== null) {
    clearTimeout(toastTimer)
    toastTimer = null
  }
  toast.value = { tone, message, visible: true }
  toastTimer = setTimeout(() => {
    toast.value = { ...toast.value, visible: false }
    toastTimer = null
  }, 3500)
}

onBeforeUnmount(() => {
  if (toastTimer !== null) {
    clearTimeout(toastTimer)
    toastTimer = null
  }
})

// ─── Source ──────────────────────────────────────────────────────────

const incomingPending = computed<ReadonlyArray<ReplacementRequest>>(
  () => replacementsStore.incomingPending,
)

// ─── Helpers ─────────────────────────────────────────────────────────

const DATE_FMT = new Intl.DateTimeFormat('fr-CH', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

function fmtDate(ms: number): string {
  if (!ms) return ''
  const raw = DATE_FMT.format(new Date(ms))
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

/**
 * Parse `"HH:mm"` et retourne le offset en ms depuis 00:00 local.
 * Tolère les formats malformés (fallback 0).
 */
function hhmmToMsOffset(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!m) return 0
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return 0
  return hh * 60 * 60 * 1000 + mm * 60 * 1000
}

/**
 * Calcule la fenêtre temporelle [start, end] du match concerné par la
 * request. `matchDateMs` est aligné 00:00 local côté écriture (cf. types
 * shared) — on ajoute l'offset HH:mm.
 *
 * Si `matchEndTime` est absent ou malformé, fallback +90 min sur le start
 * (pattern repris d'OfficialAssignmentsCalendar).
 */
function requestWindowMs(r: ReplacementRequest): { startMs: number; endMs: number } {
  const baseMs = r.matchDateMs
  const startMs = baseMs + hhmmToMsOffset(r.matchStartTime)
  const endOffset = hhmmToMsOffset(r.matchEndTime)
  const endMs = endOffset > 0 ? baseMs + endOffset : startMs + 90 * 60 * 1000
  return { startMs, endMs }
}

/**
 * Adapte un `BookingRow` (qui n'expose pas `coachUid`) en
 * `ConflictBookingSource`. Comme `coachUid` est inconnu côté
 * `apps/courtbase-app` (le repo ne le dénormalise pas), on passe `null` —
 * conséquence : aucun conflit "coaching" ne sera détecté pour le target. La
 * détection officiating + playing reste pleinement fonctionnelle.
 */
function bookingsAsConflictSources(): ReadonlyArray<ConflictBookingSource> {
  return bookingsStore.allBookings.map((b) => ({
    id: b.id,
    startMs: b.startMs,
    endMs: b.endMs,
    coachUid: null,
    teamId: b.teamId,
    opponentName: b.opponentName,
    teamName: b.teamName,
    slotType: b.slotType,
  }))
}

/**
 * Détecte les conflits d'agenda du target (= moi) sur la fenêtre du match
 * concerné par la request. Exclut le `parentId` de la request (la cible
 * peut être déjà en pending sur ce match si elle a refusé — improbable mais
 * couvert par excludeParentId).
 */
function conflictsFor(r: ReplacementRequest): ReadonlyArray<ConflictInfo> {
  const memberId = auth.userDoc?.memberId
  if (!memberId) return []
  const teamIds = auth.linkedMember?.teamIds ?? []
  const { startMs, endMs } = requestWindowMs(r)
  return detectConflicts({
    memberId,
    linkedUserId: auth.uid ?? null,
    teamIds,
    targetStartMs: startMs,
    targetEndMs: endMs,
    excludeParentId: r.parentId,
    allBookings: bookingsAsConflictSources(),
    awayMatches: officialsStore.awayMatches.map((m) => ({
      id: m.id,
      date: { seconds: m.date.seconds },
      startTime: m.startTime,
      endTime: m.endTime,
      opponentName: m.opponentName,
      teamId: m.teamId,
    })),
    homeAssignments: officialsStore.homeAssignmentsByBookingId,
    awayAssignments: officialsStore.awayAssignmentsByMatchId,
  })
}

function venueLabel(r: ReplacementRequest): string {
  return r.matchVenueLabel ?? (r.parentKind === 'away' ? 'Adresse à confirmer' : 'Salle non attribuée')
}

function opponentLabel(r: ReplacementRequest): string {
  return r.matchOpponentName ?? 'Adversaire à confirmer'
}

function kindLabel(r: ReplacementRequest): string {
  return r.parentKind === 'home' ? 'Domicile' : 'Extérieur'
}

// ─── Actions ─────────────────────────────────────────────────────────

async function onAccept(r: ReplacementRequest): Promise<void> {
  if (submittingId.value !== null) return
  submittingId.value = r.id
  try {
    await replacementsStore.acceptRequest(r.id)
    showToast('emerald', 'Remplacement accepté — vous êtes maintenant titulaire.')
    emit('accepted', r.id)
  } catch (err) {
    console.error('[ReplacementInbox.accept] failed', err)
    showToast('rose', "Échec de l'acceptation. Réessayez.")
  } finally {
    submittingId.value = null
  }
}

function openDecline(r: ReplacementRequest): void {
  declineDialog.value = { requestId: r.id, reason: '' }
}

function closeDecline(): void {
  declineDialog.value = null
}

async function confirmDecline(): Promise<void> {
  const state = declineDialog.value
  if (!state) return
  if (submittingId.value !== null) return
  const raw = state.reason.trim()
  // Reason optionnel — si non-vide, doit respecter 5-300 chars.
  if (raw.length > 0 && (raw.length < 5 || raw.length > 300)) {
    showToast('rose', 'Le motif doit faire entre 5 et 300 caractères (ou rester vide).')
    return
  }
  const reason = raw.length > 0 ? raw : null
  submittingId.value = state.requestId
  try {
    await replacementsStore.declineRequest(state.requestId, reason)
    showToast('sky', 'Demande déclinée.')
    emit('declined', state.requestId)
    declineDialog.value = null
  } catch (err) {
    console.error('[ReplacementInbox.decline] failed', err)
    showToast('rose', 'Échec du refus. Réessayez.')
  } finally {
    submittingId.value = null
  }
}

// ─── Computed display helpers ────────────────────────────────────────

const pendingCount = computed<number>(() => incomingPending.value.length)

const countLabel = computed<string>(() =>
  pendingCount.value === 1 ? '1 en attente' : `${pendingCount.value} en attente`,
)

const declineCharCount = computed<number>(() => declineDialog.value?.reason.trim().length ?? 0)

// ─── Conflits — affichage limité à 3 + overflow ──────────────────────

const MAX_VISIBLE_CONFLICTS = 3

const KIND_LABEL: Record<ConflictInfo['kind'], string> = {
  officiating: 'Officiel',
  coaching: 'Coach',
  playing: 'Joueur',
}

function visibleConflicts(list: ReadonlyArray<ConflictInfo>): ReadonlyArray<ConflictInfo> {
  return list.slice(0, MAX_VISIBLE_CONFLICTS)
}

function overflowCount(list: ReadonlyArray<ConflictInfo>): number {
  return Math.max(0, list.length - MAX_VISIBLE_CONFLICTS)
}

function conflictsHeaderLabel(list: ReadonlyArray<ConflictInfo>): string {
  return list.length === 1
    ? 'Conflit détecté sur ce créneau'
    : `${list.length} conflits détectés sur ce créneau`
}
</script>

<template>
  <section v-if="incomingPending.length > 0" class="ri-section">
    <!-- ─── Header de section ──────────────────────────────────── -->
    <div class="ri-header">
      <div class="ri-header-left">
        <Inbox :size="18" class="ri-header-icon" />
        <h2 class="ri-header-title">Demandes de remplacement reçues</h2>
      </div>
      <CbPill tone="amber" solid>{{ countLabel }}</CbPill>
    </div>

    <!-- ─── Banner erreur store (optionnel) ────────────────────── -->
    <div
      v-if="replacementsStore.lastError"
      class="ri-error-banner"
      role="alert"
    >
      <AlertTriangle :size="14" />
      <span>{{ replacementsStore.lastError }}</span>
    </div>

    <!-- ─── Cards ──────────────────────────────────────────────── -->
    <div class="ri-cards">
      <article
        v-for="r in incomingPending"
        :key="r.id"
        class="cb-card ri-card"
      >
        <!-- Ligne 1 — requester message -->
        <header class="ri-card-head">
          <div class="ri-card-title">
            <strong>{{ r.requesterDisplayName }}</strong>
            <span class="ri-card-title-tail">vous demande un remplacement</span>
          </div>
          <div class="ri-card-head-pills">
            <CbPill :tone="r.parentKind === 'home' ? 'emerald' : 'sky'" solid>
              {{ kindLabel(r) }}
            </CbPill>
            <CbPill tone="slate">Niveau {{ r.officialLevel }}</CbPill>
          </div>
        </header>

        <!-- Ligne 2 — match meta -->
        <div class="ri-card-meta">
          <div class="ri-card-meta-line">
            <span class="ri-card-meta-when mono">
              {{ fmtDate(r.matchDateMs) }} · {{ r.matchStartTime }}<span v-if="r.matchEndTime">–{{ r.matchEndTime }}</span>
            </span>
            <span class="ri-card-meta-vs">vs {{ opponentLabel(r) }}</span>
          </div>
          <div class="ri-card-meta-line cb-sub">
            <span>{{ r.matchTypeName || '—' }}</span>
            <span class="ri-card-meta-sep">·</span>
            <span class="ri-card-meta-venue">
              <MapPin :size="12" />
              {{ venueLabel(r) }}
            </span>
          </div>
        </div>

        <!-- Ligne 3 — message du demandeur -->
        <div v-if="r.message" class="ri-card-message">
          <span class="ri-card-message-label">Message :</span>
          <span class="ri-card-message-body">« {{ r.message }} »</span>
        </div>

        <!-- Ligne 4 — conflits éventuels -->
        <template v-if="conflictsFor(r).length > 0">
          <div class="ri-conflicts" role="alert">
            <div class="ri-conflicts-head">
              <AlertTriangle :size="14" />
              <span>{{ conflictsHeaderLabel(conflictsFor(r)) }}</span>
            </div>
            <ul class="ri-conflicts-list">
              <li
                v-for="c in visibleConflicts(conflictsFor(r))"
                :key="`${c.sourceId}|${c.kind}`"
              >
                <span class="ri-conflicts-kind">[{{ KIND_LABEL[c.kind] }}]</span>
                {{ c.label }}
              </li>
            </ul>
            <div
              v-if="overflowCount(conflictsFor(r)) > 0"
              class="ri-conflicts-overflow cb-sub"
            >
              {{ overflowCount(conflictsFor(r)) === 1 ? '+1 autre' : `+${overflowCount(conflictsFor(r))} autres` }}
            </div>
          </div>
        </template>

        <!-- Ligne 5 — actions -->
        <footer class="ri-card-actions">
          <button
            type="button"
            class="cb-btn outline danger sm"
            :disabled="submittingId === r.id"
            @click="openDecline(r)"
          >
            <XCircle :size="14" />
            Décliner
          </button>
          <button
            type="button"
            class="cb-btn primary sm"
            :disabled="submittingId === r.id"
            @click="onAccept(r)"
          >
            <CheckCircle2 :size="14" />
            {{ submittingId === r.id ? 'Acceptation…' : 'Accepter' }}
          </button>
        </footer>
      </article>
    </div>

    <!-- Dialog Décliner ─────────────────────────────────────────── -->
    <Teleport to="body">
      <Transition name="cb-toast">
        <div
          v-if="declineDialog"
          class="ri-dialog-overlay"
          role="dialog"
          aria-modal="true"
          @click.self="closeDecline"
        >
          <div class="ri-dialog">
            <header class="ri-dialog-head">
              <h3>Pourquoi décliner ?</h3>
              <button
                type="button"
                class="cb-btn ghost sm"
                aria-label="Fermer"
                @click="closeDecline"
              >
                <XCircle :size="16" />
              </button>
            </header>
            <p class="ri-dialog-help">
              Un motif aide le demandeur à comprendre. Optionnel (5 à 300 caractères).
            </p>
            <textarea
              v-model="declineDialog.reason"
              class="ri-dialog-textarea"
              rows="4"
              maxlength="300"
              placeholder="Ex. Je suis déjà engagé sur un autre match au même créneau."
            ></textarea>
            <div class="ri-dialog-counter cb-sub">
              {{ declineCharCount }}/300
            </div>
            <footer class="ri-dialog-actions">
              <button
                type="button"
                class="cb-btn ghost sm"
                :disabled="submittingId === declineDialog.requestId"
                @click="closeDecline"
              >
                Annuler
              </button>
              <button
                type="button"
                class="cb-btn primary sm"
                :disabled="submittingId === declineDialog.requestId"
                @click="confirmDecline"
              >
                {{ submittingId === declineDialog.requestId ? 'Refus…' : 'Confirmer le refus' }}
              </button>
            </footer>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Toast ─────────────────────────────────────────────────── -->
    <Teleport to="body">
      <Transition name="cb-toast">
        <div
          v-if="toast.visible"
          class="ri-toast"
          :class="`tone-${toast.tone}`"
          role="status"
        >
          <component
            :is="toastIcon"
            :size="16"
          />
          <span>{{ toast.message }}</span>
        </div>
      </Transition>
    </Teleport>
  </section>
</template>

<style scoped>
/* ─── Section ─────────────────────────────────────────────────── */

.ri-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 14px 16px;
  border-radius: 12px;
  border: 1px solid var(--amber-200, #fde68a);
  background: rgba(245, 158, 11, 0.06);
  max-width: 800px;
  width: 100%;
}

.ri-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ri-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ri-header-icon {
  color: var(--amber-600, #d97706);
}
.ri-header-title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--amber-700, #b45309);
}

/* ─── Error banner ────────────────────────────────────────────── */

.ri-error-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--rose-200, #fecdd3);
  background: var(--rose-50, #fff1f2);
  color: var(--rose-700, #be123c);
  font-size: 12px;
  font-weight: 500;
}

/* ─── Cards ───────────────────────────────────────────────────── */

.ri-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ri-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: var(--amber-50, #fffbeb);
  border: 1px solid var(--amber-200, #fde68a);
}

.ri-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.ri-card-title {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  line-height: 1.35;
}
.ri-card-title-tail {
  margin-left: 4px;
  color: var(--text-subtle);
  font-weight: 400;
}
.ri-card-head-pills {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-end;
  flex-shrink: 0;
}

/* ─── Meta ────────────────────────────────────────────────────── */

.ri-card-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ri-card-meta-line {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 13px;
}
.ri-card-meta-when {
  font-weight: 700;
}
.ri-card-meta-vs {
  font-weight: 600;
}
.ri-card-meta-sep {
  opacity: 0.5;
}
.ri-card-meta-venue {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* ─── Message ────────────────────────────────────────────────── */

.ri-card-message {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border, rgba(15, 23, 42, 0.08));
  background: rgba(255, 255, 255, 0.65);
  font-size: 13px;
  line-height: 1.4;
}
.ri-card-message-label {
  font-weight: 600;
  margin-right: 4px;
  color: var(--text-subtle);
}
.ri-card-message-body {
  font-style: italic;
}

/* ─── Conflits ──────────────────────────────────────────────── */

.ri-conflicts {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--rose-200, #fecdd3);
  background: var(--rose-50, #fff1f2);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ri-conflicts-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  color: var(--rose-700, #be123c);
}
.ri-conflicts-list {
  margin: 0;
  padding: 0 0 0 20px;
  list-style: disc;
  font-size: 12px;
  color: var(--rose-700, #be123c);
}
.ri-conflicts-list li {
  line-height: 1.4;
}
.ri-conflicts-kind {
  font-weight: 700;
  margin-right: 2px;
}
.ri-conflicts-overflow {
  margin-left: 20px;
  font-size: 11px;
}

/* ─── Actions ────────────────────────────────────────────────── */

.ri-card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: space-between;
  padding-top: 8px;
  border-top: 1px solid var(--border, rgba(15, 23, 42, 0.08));
}
.ri-card-actions .cb-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* ─── Dialog ─────────────────────────────────────────────────── */

.ri-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 1200;
}
.ri-dialog {
  background: var(--card-bg, #fff);
  border-radius: 14px;
  padding: 18px;
  width: 100%;
  max-width: 440px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.35);
}
.ri-dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ri-dialog-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}
.ri-dialog-help {
  margin: 0;
  font-size: 12px;
  color: var(--text-subtle);
}
.ri-dialog-textarea {
  width: 100%;
  resize: vertical;
  min-height: 88px;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid var(--border, rgba(15, 23, 42, 0.18));
  font-family: inherit;
  font-size: 13px;
  line-height: 1.4;
  background: var(--card-bg, #fff);
}
.ri-dialog-textarea:focus {
  outline: 2px solid var(--emerald-500, #10b981);
  outline-offset: -1px;
}
.ri-dialog-counter {
  align-self: flex-end;
  font-size: 11px;
}
.ri-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}

/* ─── Toast ──────────────────────────────────────────────────── */

.ri-toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 10px 25px rgba(15, 23, 42, 0.18);
  z-index: 1300;
  max-width: calc(100vw - 32px);
  color: #fff;
}
.ri-toast.tone-emerald {
  background: var(--emerald-500, #10b981);
}
.ri-toast.tone-rose {
  background: var(--rose-500, #f43f5e);
}
.ri-toast.tone-sky {
  background: var(--sky-500, #0ea5e9);
}

.cb-toast-enter-active,
.cb-toast-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}
.cb-toast-enter-from,
.cb-toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}
</style>