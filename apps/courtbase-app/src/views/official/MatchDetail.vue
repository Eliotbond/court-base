<script setup lang="ts">
/**
 * O3 — Détail match (officiel).
 *
 * Transcription quasi-littérale de `O3Mobile` (JSX) — cf.
 * `/tmp/courtbase-app-design/courtbase-app/project/screens/official.jsx`
 * lignes 174-255. Le contenu (date "Sa 18 oct.", "14:30", noms, etc.)
 * est statique dans le JSX, on le garde tel quel ici en mock.
 *
 * États (5) pilotés par `MOCK_DEMO_STATE` :
 *   open | pending | confirmed | declined | nolicense
 *
 * Côté Firebase, dériver depuis `myAssignment.status` +
 * `auth.hasActiveOfficialLicense` (cf. `resolveViewState`).
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  Calendar,
  CalendarPlus,
  Check,
  CheckCircle2,
  Clock,
  Info,
  MapPin,
  MoreVertical,
  RefreshCw,
  Users,
  X,
  XCircle,
} from 'lucide-vue-next'

import CbAvatar from '@/components/ui/CbAvatar.vue'
import CbBanner from '@/components/ui/CbBanner.vue'
import CbBottomBar from '@/components/ui/CbBottomBar.vue'
import CbDesktopShell from '@/components/ui/CbDesktopShell.vue'
import CbEmptyState from '@/components/ui/CbEmptyState.vue'
import CbMemberRow from '@/components/ui/CbMemberRow.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbPageHead from '@/components/ui/CbPageHead.vue'
import CbPill from '@/components/ui/CbPill.vue'
import type { CbNavItem } from '@/components/ui/CbSidebar.vue'

import { getMatch, logMockAction } from '@/repositories/mock'

// ────────────────────────────────────────────────────────────────
// Mock — état démo (5 variantes O3)
// ────────────────────────────────────────────────────────────────

type ViewState = 'open' | 'pending' | 'confirmed' | 'declined' | 'nolicense'

/**
 * Force l'état affiché pour la démo. En réel : dériver via `resolveViewState`.
 */
const MOCK_DEMO_STATE: ViewState = 'open'

const route = useRoute()
const router = useRouter()

const matchId = computed<string>(() => {
  const raw = route.params['id']
  return Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
})

const match = computed(() => (matchId.value ? getMatch(matchId.value) : null))

const viewState = computed<ViewState>(() => MOCK_DEMO_STATE)

// ────────────────────────────────────────────────────────────────
// Slots officiels — calqué sur le JSX statique de la référence
// (level=2 [1 required, Marc Brunet] + level=1 [2 required, Rachel...])
// ────────────────────────────────────────────────────────────────

interface SlotFill {
  name: string
  status: 'Confirmé' | 'Pending'
  you?: boolean
}

interface OfficialSlot {
  level: number
  requiredCount: number
  filled: SlotFill[]
}

const officialSlots = computed<OfficialSlot[]>(() => {
  const state = viewState.value
  return [
    {
      level: 2,
      requiredCount: 1,
      filled: [{ name: 'Marc Brunet', status: 'Confirmé' }],
    },
    {
      level: 1,
      requiredCount: 2,
      filled: [
        { name: 'Rachel Dind', status: 'Confirmé', you: state === 'confirmed' },
        ...(state === 'pending'
          ? [{ name: 'Rachel Dind (vous)', status: 'Pending' as const, you: true }]
          : []),
      ],
    },
  ]
})

// ────────────────────────────────────────────────────────────────
// Sidebar desktop (officiel)
// ────────────────────────────────────────────────────────────────

const navOfficial: CbNavItem[] = [
  { icon: Calendar, label: 'Accueil' },
  { icon: Bell, label: 'Matchs à pourvoir' },
  { icon: Calendar, label: 'Mes assignations' },
]

// ────────────────────────────────────────────────────────────────
// Actions — log-only (mock)
// ────────────────────────────────────────────────────────────────

function onBack(): void {
  if (window.history.length > 1) {
    router.back()
  } else {
    void router.push({ name: 'home' })
  }
}

function actionEnroll(): void {
  logMockAction('o3.enroll', { matchId: matchId.value })
}

function actionEnrollBlocked(): void {
  logMockAction('o3.enroll_blocked_no_license', { matchId: matchId.value })
}

function actionConfirm(): void {
  logMockAction('o3.confirm', { matchId: matchId.value })
}

function actionDecline(): void {
  logMockAction('o3.decline', { matchId: matchId.value })
}

function actionAddToCalendar(): void {
  logMockAction('o3.add_to_calendar', { matchId: matchId.value })
}

function actionReapply(): void {
  logMockAction('o3.reapply', { matchId: matchId.value })
}

function actionMore(): void {
  logMockAction('o3.kebab', { matchId: matchId.value })
}
</script>

<template>
  <!-- ─── Match introuvable ───────────────────────────────────── -->
  <CbMobileShell
    v-if="!match"
    title="Match introuvable"
    show-back
    @back="onBack"
  >
    <div class="cb-page">
      <CbEmptyState
        :icon="Info"
        title="Match introuvable"
        body="Ce match n'existe pas ou n'est plus disponible."
      >
        <template #actions>
          <button type="button" class="cb-btn primary sm" @click="onBack">
            <ArrowLeft :size="16" /> Retour
          </button>
        </template>
      </CbEmptyState>
    </div>
  </CbMobileShell>

  <!-- ─── Mobile (transcription littérale O3Mobile) ──────────── -->
  <CbMobileShell
    v-else
    class="o3-mobile"
    title="Détail match"
    show-back
    @back="onBack"
  >
    <div class="cb-page">
      <div class="cb-card" style="padding: 16px">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px">
          <div>
            <div class="cb-h1" style="font-size: 22px">Sa 18 oct.</div>
            <div
              class="mono"
              style="font-size: 18px; font-weight: 600; color: var(--slate-700); margin-top: 2px"
            >14:30</div>
          </div>
          <CbPill tone="violet">CSJC</CbPill>
        </div>
        <div style="margin-top: 10px; font-size: 16px; font-weight: 600">
          BC Aigles U16M <span style="color: var(--text-subtle); font-weight: 500">vs</span> Pully BC U16M
        </div>
        <div class="cb-sub" style="margin-top: 8px; display: flex; gap: 6px; align-items: center">
          <MapPin :size="14" color="var(--slate-400)" />
          Centre sportif Aigues-Vertes · Court A
        </div>
      </div>

      <div>
        <div class="cb-section-label" style="padding: 0 0 6px">Équipe à domicile</div>
        <div class="cb-card" style="padding: 12px">
          <CbMemberRow
            name="Mathieu Brun"
            sub="Head coach · +41 79 543 21 08"
            avatar-tone="emerald"
            hide-chev
          >
            <template #right><span /></template>
          </CbMemberRow>
        </div>
      </div>

      <div>
        <div class="cb-section-label" style="padding: 0 0 6px">Officiels</div>
        <div class="cb-card" style="padding: 0 14px">
          <div
            v-for="slot in officialSlots"
            :key="slot.level"
            style="border-bottom: 1px solid var(--border); padding: 10px 0"
          >
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px">
              <div style="font-size: 13px; font-weight: 600">
                Niveau {{ slot.level }}
                <span class="mono" style="color: var(--text-subtle); font-weight: 500">
                  · {{ slot.filled.length }}/{{ slot.requiredCount }}
                </span>
              </div>
              <CbPill
                v-if="slot.filled.length === slot.requiredCount"
                tone="emerald"
                dot
              >Complet</CbPill>
              <CbPill v-else tone="amber" dot>
                {{ slot.requiredCount - slot.filled.length }} à pourvoir
              </CbPill>
            </div>
            <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 6px">
              <div
                v-for="(f, i) in slot.filled"
                :key="`f-${slot.level}-${i}`"
                style="display: flex; align-items: center; gap: 8px"
              >
                <CbAvatar :name="f.name" size="xs" :tone="f.you ? 'emerald' : undefined" />
                <span :style="`font-size: 13px; font-weight: ${f.you ? 600 : 500}`">
                  {{ f.name }}<span v-if="f.you"> (vous)</span>
                </span>
                <CbPill :tone="f.status === 'Confirmé' ? 'emerald' : 'amber'" dot>
                  {{ f.status }}
                </CbPill>
              </div>
              <div
                v-for="empty in Math.max(0, slot.requiredCount - slot.filled.length)"
                :key="`empty-${slot.level}-${empty}`"
                style="display: flex; align-items: center; gap: 8px"
              >
                <div
                  class="cb-avatar xs"
                  style="background: var(--slate-100); color: var(--slate-400); border: 1px dashed var(--slate-300)"
                >?</div>
                <span style="font-size: 13px; color: var(--text-subtle)">À pourvoir</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <CbBanner
        v-if="viewState === 'nolicense'"
        tone="amber"
        title="Pas de licence officiel active"
      >
        <template #icon><AlertTriangle :size="18" /></template>
        L'auto-inscription est bloquée. Contactez votre admin pour la régulariser.
      </CbBanner>
    </div>

    <CbBottomBar>
      <button
        v-if="viewState === 'open'"
        type="button"
        class="cb-btn primary block lg"
        @click="actionEnroll"
      >
        <Check :size="16" /> Je m'inscris
      </button>
      <button
        v-if="viewState === 'nolicense'"
        type="button"
        class="cb-btn block lg"
        disabled
        @click="actionEnrollBlocked"
      >
        Je m'inscris (bloqué)
      </button>
      <template v-if="viewState === 'pending'">
        <button type="button" class="cb-btn outline" style="flex: 1" @click="actionDecline">
          <X :size="16" /> Décliner
        </button>
        <button type="button" class="cb-btn primary" style="flex: 2" @click="actionConfirm">
          <Check :size="16" /> Confirmer ma présence
        </button>
      </template>
      <template v-if="viewState === 'confirmed'">
        <button type="button" class="cb-btn outline" style="flex: 1" @click="actionMore">
          <MoreVertical :size="16" />
        </button>
        <button type="button" class="cb-btn primary" style="flex: 2" @click="actionAddToCalendar">
          <CalendarPlus :size="16" /> Ajouter au calendrier
        </button>
      </template>
      <button
        v-if="viewState === 'declined'"
        type="button"
        class="cb-btn primary block lg"
        @click="actionReapply"
      >
        <RefreshCw :size="16" /> Re-postuler
      </button>
    </CbBottomBar>
  </CbMobileShell>

  <!-- ─── Desktop minimaliste (pas d'O3Desktop dans le JSX) ──── -->
  <CbDesktopShell
    v-if="match"
    class="o3-desktop"
    :items="navOfficial"
    :active="2"
    brand-name="BC Aigles"
    brand-sub="Saison 2025/26"
    club-initials="BCA"
    user-name="Mathieu Brun"
    user-role="Officiel"
  >
    <CbPageHead
      title="Détail match"
      subtitle="Sa 18 oct. · 14:30 · BC Aigles U16M vs Pully BC U16M"
    >
      <template #actions>
        <button type="button" class="cb-btn ghost" @click="onBack">
          <ArrowLeft :size="16" /> Retour
        </button>
      </template>
    </CbPageHead>

    <div class="o3-desktop-body">
      <div class="o3-desktop-inner">
        <div class="cb-card" style="padding: 18px">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px">
            <div>
              <div class="cb-h1" style="font-size: 22px">Sa 18 oct.</div>
              <div
                class="mono"
                style="font-size: 18px; font-weight: 600; color: var(--slate-700); margin-top: 2px"
              >14:30</div>
            </div>
            <CbPill tone="violet">CSJC</CbPill>
          </div>
          <div style="margin-top: 10px; font-size: 16px; font-weight: 600">
            BC Aigles U16M <span style="color: var(--text-subtle); font-weight: 500">vs</span> Pully BC U16M
          </div>
          <div class="cb-sub" style="margin-top: 8px; display: flex; gap: 6px; align-items: center">
            <MapPin :size="14" color="var(--slate-400)" />
            Centre sportif Aigues-Vertes · Court A
          </div>
        </div>

        <div>
          <div class="cb-section-label" style="padding: 0 0 6px">Équipe à domicile</div>
          <div class="cb-card" style="padding: 12px">
            <CbMemberRow
              name="Mathieu Brun"
              sub="Head coach · +41 79 543 21 08"
              avatar-tone="emerald"
              hide-chev
            >
              <template #right><span /></template>
            </CbMemberRow>
          </div>
        </div>

        <div>
          <div class="cb-section-label" style="padding: 0 0 6px">Officiels</div>
          <div class="cb-card" style="padding: 0 14px">
            <div
              v-for="slot in officialSlots"
              :key="`d-${slot.level}`"
              style="border-bottom: 1px solid var(--border); padding: 10px 0"
            >
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px">
                <div style="font-size: 13px; font-weight: 600">
                  Niveau {{ slot.level }}
                  <span class="mono" style="color: var(--text-subtle); font-weight: 500">
                    · {{ slot.filled.length }}/{{ slot.requiredCount }}
                  </span>
                </div>
                <CbPill
                  v-if="slot.filled.length === slot.requiredCount"
                  tone="emerald"
                  dot
                >Complet</CbPill>
                <CbPill v-else tone="amber" dot>
                  {{ slot.requiredCount - slot.filled.length }} à pourvoir
                </CbPill>
              </div>
              <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 6px">
                <div
                  v-for="(f, i) in slot.filled"
                  :key="`df-${slot.level}-${i}`"
                  style="display: flex; align-items: center; gap: 8px"
                >
                  <CbAvatar :name="f.name" size="xs" :tone="f.you ? 'emerald' : undefined" />
                  <span :style="`font-size: 13px; font-weight: ${f.you ? 600 : 500}`">
                    {{ f.name }}<span v-if="f.you"> (vous)</span>
                  </span>
                  <CbPill :tone="f.status === 'Confirmé' ? 'emerald' : 'amber'" dot>
                    {{ f.status }}
                  </CbPill>
                </div>
                <div
                  v-for="empty in Math.max(0, slot.requiredCount - slot.filled.length)"
                  :key="`d-empty-${slot.level}-${empty}`"
                  style="display: flex; align-items: center; gap: 8px"
                >
                  <div
                    class="cb-avatar xs"
                    style="background: var(--slate-100); color: var(--slate-400); border: 1px dashed var(--slate-300)"
                  >?</div>
                  <span style="font-size: 13px; color: var(--text-subtle)">À pourvoir</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <CbBanner
          v-if="viewState === 'nolicense'"
          tone="amber"
          title="Pas de licence officiel active"
        >
          <template #icon><AlertTriangle :size="18" /></template>
          L'auto-inscription est bloquée. Contactez votre admin pour la régulariser.
        </CbBanner>
      </div>
    </div>
  </CbDesktopShell>
</template>

<style scoped>
.o3-mobile { display: flex; }
.o3-desktop { display: none; }
@media (min-width: 1024px) {
  .o3-mobile { display: none; }
  .o3-desktop { display: flex; }
}
.o3-desktop-body {
  flex: 1;
  overflow: auto;
  padding: 24px 28px;
  background: var(--bg-muted);
}
.o3-desktop-inner {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 720px;
}
</style>
