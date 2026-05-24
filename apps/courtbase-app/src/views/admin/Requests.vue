<script setup lang="ts">
/**
 * A3 — Requests à traiter (admin restreint).
 *
 * 3 onglets (segmented) filtrant `MOCK_REQUESTS.pending` par `kind` :
 *   - Licences            (`kind === 'license'`)
 *   - Exceptions cotisation (`kind === 'payment_exception'`)
 *   - Déplacements match    (`kind === 'match_move'`)
 *
 * Compteurs sur chaque tab = nombre de requests `pending` du kind.
 *
 * Card par request :
 *   - Avatar à initiales (du `requesterName`) + nom demandeur en titre.
 *   - Sous-titre : "Soumise {submittedAt}" (+ pour match_move : nom adverse).
 *   - Extrait motivation tronqué à 3 lignes (clamp CSS).
 *   - Pill kind (violet pour licence, amber pour exception, sky pour
 *     match_move) à droite du titre.
 *   - CTAs inline "Approuver" (emerald) + "Refuser" (rose).
 *
 * Tap card (hors boutons) → `request-detail` (route nommée).
 *
 * Refus : dialog PrimeVue avec textarea motif obligatoire. À la confirmation
 * → `logMockAction('a3.reject', { requestId, reason })`. La liste ne change
 * pas visuellement (cf. convention `mock/index.ts`).
 *
 * Query string `?kind=license|payment_exception|match_move` pré-sélectionne
 * l'onglet correspondant à l'arrivée sur la vue (deep-link depuis C3-admin).
 *
 * Mobile-first : `CbMobileShell` avec tab bar admin (Demandes actif, idx 1).
 * Desktop ≥1024px : `CbDesktopShell` + `CbPageHead` (segmented en `#actions`)
 *                   + grille 2 colonnes (auto-fill cards larges).
 */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Inbox } from 'lucide-vue-next'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Textarea from 'primevue/textarea'

import CbAvatar from '@/components/ui/CbAvatar.vue'
import CbDesktopShell from '@/components/ui/CbDesktopShell.vue'
import CbEmptyState from '@/components/ui/CbEmptyState.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbPageHead from '@/components/ui/CbPageHead.vue'
import CbPill from '@/components/ui/CbPill.vue'
import type { CbPillTone } from '@/components/ui/CbPill.vue'
import { useShellNav } from '@/composables/useShellNav'
import { useViewport } from '@/composables/useViewport'
import {
  countUnread,
  listRequests,
  logMockAction,
  type MockRequest,
} from '@/repositories/mock'

const route = useRoute()
const router = useRouter()
const { isDesktop } = useViewport()
const { tabs, nav, primaryRoleLabel } = useShellNav()

// ─── Onglets ────────────────────────────────────────────────
type TabKind = MockRequest['kind']

interface TabDef {
  id: TabKind
  label: string
  pillTone: CbPillTone
  pillLabel: string
}

const TABS: ReadonlyArray<TabDef> = [
  { id: 'license', label: 'Licences', pillTone: 'violet', pillLabel: 'Licence' },
  { id: 'payment_exception', label: 'Exceptions cotisation', pillTone: 'amber', pillLabel: 'Exception' },
  { id: 'match_move', label: 'Déplacements match', pillTone: 'sky', pillLabel: 'Déplacement' },
] as const

function isTabKind(v: unknown): v is TabKind {
  return v === 'license' || v === 'payment_exception' || v === 'match_move'
}

// Pré-sélection depuis la query (?kind=license)
const initialKindFromQuery = ((): TabKind => {
  const q = route.query['kind']
  const raw = Array.isArray(q) ? q[0] : q
  return isTabKind(raw) ? raw : 'license'
})()

const activeTab = ref<TabKind>(initialKindFromQuery)

// Si la query change après mount (navigation interne), suivre.
watch(
  () => route.query['kind'],
  (q) => {
    const raw = Array.isArray(q) ? q[0] : q
    if (isTabKind(raw) && raw !== activeTab.value) activeTab.value = raw
  },
)

function setTab(id: TabKind): void {
  if (activeTab.value === id) return
  activeTab.value = id
  logMockAction('a3.tab-changed', { kind: id })
}

// ─── Compteurs pending par tab ──────────────────────────────
function countPending(kind: TabKind): number {
  return listRequests({ kind, status: 'pending' }).length
}

const counts = computed<Record<TabKind, number>>(() => ({
  license: countPending('license'),
  payment_exception: countPending('payment_exception'),
  match_move: countPending('match_move'),
}))

// ─── Liste filtrée (active tab, pending only) ───────────────
const filteredRequests = computed<ReadonlyArray<MockRequest>>(() =>
  listRequests({ kind: activeTab.value, status: 'pending' }),
)

// ─── Helpers d'affichage ────────────────────────────────────
function tabDef(id: TabKind): TabDef {
  // TABS est exhaustif sur TabKind — fallback pour TS strict.
  return TABS.find((t) => t.id === id) ?? TABS[0]!
}

function cardTitle(r: MockRequest): string {
  // Licences + exceptions : le membre concerné est la "tête" de la card.
  // Déplacements : pas de membre, on met le nom du coach demandeur.
  if (r.kind === 'match_move') return r.requesterName
  return r.memberName ?? r.requesterName
}

function cardSubtitle(r: MockRequest): string {
  switch (r.kind) {
    case 'license':
      return `Demandée par ${r.requesterName} · ${r.submittedAt}`
    case 'payment_exception':
      return `Demandée par ${r.requesterName} · ${r.submittedAt}`
    case 'match_move':
      return r.matchOpponent
        ? `vs ${r.matchOpponent} · soumise ${r.submittedAt}`
        : `Soumise ${r.submittedAt}`
  }
}

function avatarTone(kind: TabKind): 'violet' | 'amber' | 'sky' | 'emerald' | 'rose' {
  switch (kind) {
    case 'license':
      return 'violet'
    case 'payment_exception':
      return 'amber'
    case 'match_move':
      return 'sky'
  }
}

// ─── Navigation détail ──────────────────────────────────────
function openDetail(r: MockRequest): void {
  router.push({ name: 'request-detail', params: { id: r.id } }).catch((err) => {
    // RequestDetail.vue n'existe peut-être pas encore — log sans casser.
    console.warn('[a3.open-detail] navigation failed', err)
  })
}

// ─── Actions inline ─────────────────────────────────────────
function onApprove(r: MockRequest, evt: Event): void {
  evt.stopPropagation()
  logMockAction('a3.approve', { requestId: r.id, kind: r.kind })
}

// ─── Dialog motif refus ─────────────────────────────────────
const rejectDialogOpen = ref(false)
const rejectTarget = ref<MockRequest | null>(null)
const rejectReason = ref('')
const rejectAttempted = ref(false)

function onReject(r: MockRequest, evt: Event): void {
  evt.stopPropagation()
  rejectTarget.value = r
  rejectReason.value = ''
  rejectAttempted.value = false
  rejectDialogOpen.value = true
}

const rejectReasonValid = computed(() => rejectReason.value.trim().length > 0)

function confirmReject(): void {
  rejectAttempted.value = true
  const target = rejectTarget.value
  if (!target) return
  if (!rejectReasonValid.value) return
  logMockAction('a3.reject', {
    requestId: target.id,
    kind: target.kind,
    reason: rejectReason.value.trim(),
  })
  rejectDialogOpen.value = false
  rejectTarget.value = null
  rejectReason.value = ''
}

function cancelReject(): void {
  rejectDialogOpen.value = false
  rejectTarget.value = null
  rejectReason.value = ''
  rejectAttempted.value = false
}

// ─── Shell (badge cloche header) ──────────────────────────────
const notifBadgeCount = computed(() => countUnread())
const requestsTotalPending = computed(
  () => counts.value.license + counts.value.payment_exception + counts.value.match_move,
)

function onNotifClick(): void {
  router.push({ name: 'notifications' })
}
</script>

<template>
  <!-- Desktop shell (≥1024px) ────────────────────────────────── -->
  <CbDesktopShell
    v-if="isDesktop"
    :items="nav"
    brand-name="BC Aigles"
    brand-sub="Saison 2025/26"
    club-initials="BCA"
    user-name="Admin"
    :user-role="primaryRoleLabel"
  >
    <CbPageHead
      title="Demandes"
      :subtitle="`${requestsTotalPending} demande${requestsTotalPending > 1 ? 's' : ''} en attente`"
    >
      <template #actions>
        <div class="cb-segmented">
          <button
            v-for="t in TABS"
            :key="t.id"
            type="button"
            :class="{ active: activeTab === t.id }"
            @click="setTab(t.id)"
          >
            {{ t.label }}<template v-if="counts[t.id] > 0"> · {{ counts[t.id] }}</template>
          </button>
        </div>
      </template>
    </CbPageHead>

    <div class="cb-req-desktop">
      <CbEmptyState
        v-if="filteredRequests.length === 0"
        :icon="Inbox"
        title="Aucune demande"
        :body="`Aucune demande de ${tabDef(activeTab).label.toLowerCase()} en attente.`"
      />

      <div v-else class="cb-req-grid">
        <article
          v-for="r in filteredRequests"
          :key="r.id"
          class="cb-card cb-req-card"
          role="button"
          tabindex="0"
          @click="openDetail(r)"
          @keyup.enter="openDetail(r)"
        >
          <div class="cb-req-head">
            <CbAvatar :name="cardTitle(r)" size="sm" :tone="avatarTone(r.kind)" />
            <div class="cb-req-id">
              <div class="cb-req-name">{{ cardTitle(r) }}</div>
              <div class="cb-sub">{{ cardSubtitle(r) }}</div>
            </div>
            <CbPill :tone="tabDef(r.kind).pillTone">{{ tabDef(r.kind).pillLabel }}</CbPill>
          </div>

          <p class="cb-req-motivation">{{ r.motivation }}</p>

          <div class="cb-req-actions">
            <button class="cb-btn outline sm" type="button" @click="onReject(r, $event)">
              Refuser
            </button>
            <button class="cb-btn primary sm" type="button" @click="onApprove(r, $event)">
              Approuver
            </button>
          </div>
        </article>
      </div>
    </div>
  </CbDesktopShell>

  <!-- Mobile shell (< 1024px) ────────────────────────────────── -->
  <CbMobileShell
    v-else
    title="Demandes"
    club="BCA"
    :notif-badge="notifBadgeCount > 0"
    :tabs="tabs"
    @notif-click="onNotifClick"
  >
    <div class="cb-req-tabs">
      <button
        v-for="t in TABS"
        :key="t.id"
        type="button"
        class="cb-req-tab"
        :class="{ active: activeTab === t.id }"
        @click="setTab(t.id)"
      >
        {{ t.label }}<template v-if="counts[t.id] > 0"> · {{ counts[t.id] }}</template>
      </button>
    </div>

    <div v-if="filteredRequests.length === 0" style="padding: 24px 16px">
      <CbEmptyState
        :icon="Inbox"
        title="Aucune demande"
        :body="`Aucune demande de ${tabDef(activeTab).label.toLowerCase()} en attente.`"
      />
    </div>

    <div v-else class="cb-req-mobile">
      <article
        v-for="r in filteredRequests"
        :key="r.id"
        class="cb-card cb-req-card"
        role="button"
        tabindex="0"
        @click="openDetail(r)"
        @keyup.enter="openDetail(r)"
      >
        <div class="cb-req-head">
          <CbAvatar :name="cardTitle(r)" size="sm" :tone="avatarTone(r.kind)" />
          <div class="cb-req-id">
            <div class="cb-req-name">{{ cardTitle(r) }}</div>
            <div class="cb-sub">{{ cardSubtitle(r) }}</div>
          </div>
          <CbPill :tone="tabDef(r.kind).pillTone">{{ tabDef(r.kind).pillLabel }}</CbPill>
        </div>

        <p class="cb-req-motivation">{{ r.motivation }}</p>

        <div class="cb-req-actions">
          <button class="cb-btn outline sm" type="button" @click="onReject(r, $event)">
            Refuser
          </button>
          <button class="cb-btn primary sm" type="button" @click="onApprove(r, $event)">
            Approuver
          </button>
        </div>
      </article>
    </div>
  </CbMobileShell>

  <!-- Dialog motif refus (commun mobile/desktop) ─────────────── -->
  <Dialog
    v-model:visible="rejectDialogOpen"
    modal
    :closable="false"
    :draggable="false"
    :style="{ width: '92vw', maxWidth: '480px' }"
    header="Refuser la demande"
  >
    <p v-if="rejectTarget" class="cb-sub" style="margin: 0 0 12px">
      Motif (obligatoire) pour refuser la demande de {{ cardTitle(rejectTarget) }} :
    </p>
    <Textarea
      v-model="rejectReason"
      rows="4"
      autoResize
      style="width: 100%"
      :class="{ 'p-invalid': rejectAttempted && !rejectReasonValid }"
      placeholder="Expliquez la raison du refus…"
    />
    <small v-if="rejectAttempted && !rejectReasonValid" class="cb-req-error">
      Le motif est obligatoire.
    </small>
    <template #footer>
      <Button label="Annuler" severity="secondary" text @click="cancelReject" />
      <Button label="Confirmer le refus" severity="danger" @click="confirmReject" />
    </template>
  </Dialog>
</template>

<style scoped>
/* ─── Onglets mobile (sous le header sticky) ───────────────── */
.cb-req-tabs {
  display: flex;
  gap: 14px;
  padding: 0 16px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
  flex-shrink: 0;
}
.cb-req-tab {
  border: 0;
  background: transparent;
  padding: 12px 0;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
  border-bottom: 2px solid transparent;
  white-space: nowrap;
  cursor: pointer;
}
.cb-req-tab.active {
  color: var(--slate-900);
  font-weight: 600;
  border-bottom-color: var(--emerald-600);
}

/* ─── Listes ───────────────────────────────────────────────── */
.cb-req-mobile {
  padding: 12px 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cb-req-desktop {
  padding: 20px 28px 32px;
  max-width: 1080px;
  margin: 0 auto;
  width: 100%;
}

.cb-req-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 14px;
}

/* ─── Card ─────────────────────────────────────────────────── */
.cb-req-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  cursor: pointer;
  transition: background 120ms ease;
}
.cb-req-card:hover {
  background: var(--slate-50);
}
.cb-req-card:focus-visible {
  outline: 2px solid var(--emerald-600);
  outline-offset: 2px;
}

.cb-req-head {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.cb-req-id {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cb-req-name {
  font-weight: 600;
  font-size: 15px;
  color: var(--slate-900);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cb-req-motivation {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: var(--slate-700);
  /* Truncate à 3 lignes */
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.cb-req-actions {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}
.cb-req-actions .cb-btn.outline {
  flex: 1;
  color: var(--rose-600);
  border-color: var(--rose-200, #fecdd3);
}
.cb-req-actions .cb-btn.outline:hover {
  background: var(--rose-50, #fff1f2);
}
.cb-req-actions .cb-btn.primary {
  flex: 2;
}

.cb-req-error {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: var(--rose-600);
}
</style>
