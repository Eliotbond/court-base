<script setup lang="ts">
/**
 * CO8 — Inscriptions à traiter (coach).
 *
 * Transcription quasi-littérale de `CO8Mobile` (JSX `screens/coach.jsx`
 * lignes 513-550) avec le RegRow (lignes 498-511) inliné dans le v-for.
 *
 * Chips de filtre :
 *   - "À traiter" (default) : combine demande + essai — tout ce qui demande
 *     une action coach (pré-trial OU essai en cours).
 *   - "Demandes" / "Essais en cours" / "Confirmées" / "Terminales" : buckets
 *     individuels (cf. `@/utils/registrationBuckets`).
 *   - "Toutes" : tous statuts.
 *
 * Actions inline par card selon le status :
 *   - pré-trial → "Refuser" + "Marquer essai en cours".
 *   - trial_in_progress → "Refuser" + "Envoyer la cotisation" (= confirm,
 *     transitionne vers confirmed_pending_dues + crée la due côté parent).
 *
 * Refus : `window.prompt` natif demande un motif (acceptable pour le mock).
 * Toutes les mutations sont log-only via `logMockAction(...)`.
 *
 * Tap sur la card → `router.push({ name: 'registration-detail', params: { id } })`.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  ArrowLeft,
  Bell,
  Calendar,
  ChevronRight,
  Clipboard,
  Home as HomeIcon,
  Inbox,
  Users,
} from 'lucide-vue-next'

import CbAvatar from '@/components/ui/CbAvatar.vue'
import CbDesktopShell from '@/components/ui/CbDesktopShell.vue'
import CbEmptyState from '@/components/ui/CbEmptyState.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbPageHead from '@/components/ui/CbPageHead.vue'
import CbPill from '@/components/ui/CbPill.vue'
import type { CbPillTone } from '@/components/ui/CbPill.vue'
import { useShellNav } from '@/composables/useShellNav'
import { useViewport } from '@/composables/useViewport'
import { useAuthStore } from '@/stores/auth'
import { useRegistrationsStore, type RegistrationsFilter } from '@/stores/registrations'
import { useTeamsStore } from '@/stores/teams'
import { getTeam } from '@/repositories/mock'
import type { MockRegistration, RegistrationStatus } from '@/types/mock'
import { BUCKET_LABELS, bucketFor, canMarkTrial } from '@/utils/registrationBuckets'

const router = useRouter()
const auth = useAuthStore()
const teamsStore = useTeamsStore()
const registrationsStore = useRegistrationsStore()
const { isDesktop } = useViewport()
const { tabs, nav, primaryRoleLabel } = useShellNav()

void auth // silence unused — le store est instancié pour les futures gates rôle.

// ─── Chargement initial ──────────────────────────────────────────
// On charge les équipes du coach (vraies si memberId réel, sinon mock),
// puis les registrations scopées sur ces équipes (vraies via Firestore
// par team si on a une vraie source, sinon fallback mock global).
onMounted(async () => {
  await teamsStore.loadForCoach(auth.userDoc?.memberId ?? null, auth.uid)
  await registrationsStore.load(teamsStore.teams.map((t) => t.id))
})

// Recharge si les équipes du coach changent (rare en mobile, mais safe).
watch(
  () => teamsStore.teams.map((t) => t.id).join('|'),
  async () => {
    await registrationsStore.load(teamsStore.teams.map((t) => t.id))
  },
)

// ─── Chips filtres : "À traiter" combiné (default) + 4 buckets + Toutes ──
const filters = computed<ReadonlyArray<{ id: RegistrationsFilter; label: string }>>(() => {
  const c = registrationsStore.counts
  return [
    { id: 'actionable', label: `À traiter · ${c.actionable}` },
    { id: 'demande', label: `${BUCKET_LABELS.demande} · ${c.demande}` },
    { id: 'essai', label: `${BUCKET_LABELS.essai} · ${c.essai}` },
    { id: 'confirmed', label: `${BUCKET_LABELS.confirmed} · ${c.confirmed}` },
    { id: 'terminal', label: `${BUCKET_LABELS.terminal} · ${c.terminal}` },
    { id: 'all', label: 'Toutes' },
  ]
})

const activeFilter = computed(() => registrationsStore.filter)

function setFilter(id: RegistrationsFilter): void {
  registrationsStore.setFilter(id)
}

// ─── Liste filtrée ───────────────────────────────────────────────
const filteredRegistrations = computed<ReadonlyArray<MockRegistration>>(
  () => registrationsStore.filtered,
)

// ─── Helpers JSX RegRow ──────────────────────────────────────────
function fullName(r: MockRegistration): string {
  return `${r.playerFirstName} ${r.playerLastName}`
}

function formatDob(iso: string): string {
  const parts = iso.split('-')
  const y = parts[0] ?? '0000'
  const m = parts[1] ?? '00'
  const d = parts[2] ?? '00'
  return `${d}.${m}.${y}`
}

function teamLabel(teamId: string): string {
  return getTeam(teamId)?.name ?? 'Équipe inconnue'
}

interface StatusMeta {
  label: string
  tone: CbPillTone
}

/**
 * Mapping status → pill (label + tone). Couvre les 9 statuts canoniques
 * (cf. `RegistrationStatus`). Sépare visuellement demande (amber) /
 * essai (sky) / confirmée (emerald) / terminale (rose ou slate).
 */
function statusMeta(status: RegistrationStatus): StatusMeta {
  switch (status) {
    case 'submitted':
      return { label: 'Soumise', tone: 'amber' }
    case 'open_pending_trial':
      return { label: 'Prête pour essai', tone: 'amber' }
    case 'conditional_pending_review':
      return { label: 'Conditionnelle', tone: 'amber' }
    case 'conditional_pending_trial':
      return { label: 'Acceptée, à démarrer', tone: 'amber' }
    case 'trial_in_progress':
      return { label: 'Essai en cours', tone: 'sky' }
    case 'confirmed_pending_dues':
      return { label: 'Confirmée · attente cotisation', tone: 'emerald' }
    case 'active':
      return { label: 'Active', tone: 'emerald' }
    case 'refused':
      return { label: 'Refusée', tone: 'rose' }
    case 'cancelled':
      return { label: 'Annulée', tone: 'slate' }
  }
}

function avatarToneFor(
  status: RegistrationStatus,
): 'emerald' | 'sky' | 'amber' | 'violet' | 'rose' {
  const b = bucketFor(status)
  if (b === 'essai') return 'sky'
  if (b === 'demande') return 'amber'
  if (b === 'confirmed') return 'emerald'
  return 'rose'
}

function sinceLabel(r: MockRegistration): string {
  if (r.status === 'trial_in_progress') {
    return `Essai démarré ${r.submittedAt}`
  }
  if (r.status === 'conditional_pending_review') {
    return `Soumise ${r.submittedAt} · candidature à examiner`
  }
  if (r.status === 'refused' && r.refusalReason) {
    return `Refusée — ${r.refusalReason.slice(0, 60)}${r.refusalReason.length > 60 ? '…' : ''}`
  }
  return `Soumise ${r.submittedAt} par ${r.submitterName}`
}

// ─── Actions ─────────────────────────────────────────────────────
function openDetail(r: MockRegistration): void {
  router
    .push({ name: 'registration-detail', params: { id: r.id } })
    .catch((err) => {
      console.warn('[co8.open-detail] navigation failed', err)
    })
}

async function onMarkTrial(r: MockRegistration, evt: Event): Promise<void> {
  evt.stopPropagation()
  try {
    await registrationsStore.markTrial(r.id)
  } catch (err) {
    console.warn('[co8.mark-trial] failed', err)
  }
}

async function onConfirm(r: MockRegistration, evt: Event): Promise<void> {
  evt.stopPropagation()
  try {
    await registrationsStore.confirm(r.id)
  } catch (err) {
    console.warn('[co8.confirm] failed', err)
  }
}

async function onRefuse(r: MockRegistration, evt: Event): Promise<void> {
  evt.stopPropagation()
  const reason = window.prompt(
    'Motif du refus (≥ 5 caractères, visible par le parent) :',
    '',
  )
  if (reason == null) return
  const trimmed = reason.trim()
  if (trimmed.length < 5) {
    window.alert('Motif trop court (5 caractères minimum).')
    return
  }
  try {
    await registrationsStore.refuse(r.id, trimmed)
  } catch (err) {
    console.warn('[co8.refuse] failed', err)
  }
}

/** Vrai si on peut démarrer l'essai depuis ce status. */
function isPreTrial(status: RegistrationStatus): boolean {
  return canMarkTrial(status)
}

/**
 * Couleur de bordure gauche par bucket — permet au coach de scanner la
 * liste mixte (filtre "Toutes") sans lire chaque pill.
 */
function bucketBorderColor(status: RegistrationStatus): string {
  switch (bucketFor(status)) {
    case 'demande':
      return 'var(--amber-500, #f59e0b)'
    case 'essai':
      return 'var(--sky-500, #0ea5e9)'
    case 'confirmed':
      return 'var(--emerald-500, #10b981)'
    case 'terminal':
      return 'var(--slate-400, #94a3b8)'
  }
}

function cardStyle(r: MockRegistration): Record<string, string> {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '14px 14px 14px 12px',
    cursor: 'pointer',
    borderLeft: `4px solid ${bucketBorderColor(r.status)}`,
  }
}

// ─── Shell handlers ──────────────────────────────────────────────
function onTabSelect(index: number): void {
  switch (index) {
    case 0:
      router.push({ name: 'team' })
      break
    case 1:
      router.push({ name: 'team' })
      break
    case 2:
      return
  }
}

function onNavSelect(index: number): void {
  switch (index) {
    case 0:
      router.push({ name: 'home' })
      break
    case 1:
      router.push({ name: 'team' })
      break
    case 2:
      router.push({ name: 'team' })
      break
    case 3:
      return
  }
}

function onBackClick(): void {
  router.push({ name: 'home' })
}

// Icônes exposées au template (cf. mapping JSX → lucide).
const Icons = {
  ArrowLeft,
  Bell,
  Calendar,
  ChevronRight,
  Clipboard,
  HomeIcon,
  Inbox,
  Users,
}
void Icons
</script>

<template>
  <!-- Desktop shell (≥1024px) ─────────────────────────────────── -->
  <CbDesktopShell
    v-if="isDesktop"
    :items="nav"
    brand-name="BC Aigles"
    brand-sub="Saison 2025/26"
    club-initials="BCA"
    user-name="Coach"
    :user-role="primaryRoleLabel"
    @nav-select="onNavSelect"
  >
    <CbPageHead title="Inscriptions">
      <template #actions>
        <div class="cb-chiprow" style="border: 0; padding: 0">
          <button
            v-for="f in filters"
            :key="f.id"
            class="cb-chip"
            :class="{ active: activeFilter === f.id }"
            type="button"
            @click="setFilter(f.id)"
          >
            {{ f.label }}
          </button>
        </div>
      </template>
    </CbPageHead>

    <div style="flex: 1; overflow: auto; padding: 20px 28px 32px; max-width: 720px; margin: 0 auto; width: 100%; display: flex; flex-direction: column; gap: 12px">
      <CbEmptyState
        v-if="filteredRegistrations.length === 0"
        :icon="Inbox"
        title="Aucune inscription dans cette vue"
        body="Les inscriptions soumises pour vos équipes apparaîtront ici."
      />

      <div
        v-for="r in filteredRegistrations"
        :key="r.id"
        class="cb-card"
        :style="cardStyle(r)"
        role="button"
        tabindex="0"
        @click="openDetail(r)"
        @keyup.enter="openDetail(r)"
      >
        <div style="display: flex; gap: 12px; align-items: center">
          <CbAvatar :name="fullName(r)" :tone="avatarToneFor(r.status)" />
          <div style="flex: 1; min-width: 0">
            <div style="font-weight: 600">{{ fullName(r) }}</div>
            <div class="cb-sub">Né(e) le {{ formatDob(r.playerBirthDate) }} · {{ teamLabel(r.teamId) }}</div>
          </div>
          <CbPill :tone="statusMeta(r.status).tone" dot>{{ statusMeta(r.status).label }}</CbPill>
        </div>

        <div class="cb-sub" style="margin-left: 48px; margin-top: -4px">
          {{ sinceLabel(r) }}
        </div>

        <div v-if="isPreTrial(r.status)" style="display: flex; gap: 8px; margin-top: 4px">
          <button class="cb-btn outline sm" style="flex: 1" type="button" @click="onRefuse(r, $event)">
            Refuser
          </button>
          <button class="cb-btn primary sm" style="flex: 2" type="button" @click="onMarkTrial(r, $event)">
            Marquer essai en cours
          </button>
        </div>
        <div v-else-if="r.status === 'trial_in_progress'" style="display: flex; gap: 8px; margin-top: 4px">
          <button class="cb-btn outline sm" style="flex: 1" type="button" @click="onRefuse(r, $event)">
            Refuser
          </button>
          <button class="cb-btn primary sm" style="flex: 2" type="button" @click="onConfirm(r, $event)">
            Envoyer la cotisation
          </button>
        </div>
      </div>
    </div>
  </CbDesktopShell>

  <!-- Mobile shell (< 1024px) — transcription littérale de CO8Mobile ── -->
  <CbMobileShell
    v-else
    title="Inscriptions"
    club="BCA"
    :tabs="tabs"
    @tab-select="onTabSelect"
    @back-click="onBackClick"
  >
    <div class="cb-chiprow">
      <button
        v-for="f in filters"
        :key="f.id"
        class="cb-chip"
        :class="{ active: activeFilter === f.id }"
        type="button"
        @click="setFilter(f.id)"
      >
        {{ f.label }}
      </button>
    </div>
    <div style="flex: 1; overflow: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 12px">
      <CbEmptyState
        v-if="filteredRegistrations.length === 0"
        :icon="Inbox"
        title="Aucune inscription dans cette vue"
        body="Les inscriptions soumises pour vos équipes apparaîtront ici."
      />

      <div
        v-for="r in filteredRegistrations"
        :key="r.id"
        class="cb-card"
        :style="cardStyle(r)"
        role="button"
        tabindex="0"
        @click="openDetail(r)"
        @keyup.enter="openDetail(r)"
      >
        <div style="display: flex; gap: 12px; align-items: center">
          <CbAvatar :name="fullName(r)" :tone="avatarToneFor(r.status)" />
          <div style="flex: 1; min-width: 0">
            <div style="font-weight: 600">{{ fullName(r) }}</div>
            <div class="cb-sub">Né(e) le {{ formatDob(r.playerBirthDate) }} · {{ teamLabel(r.teamId) }}</div>
          </div>
          <CbPill :tone="statusMeta(r.status).tone" dot>{{ statusMeta(r.status).label }}</CbPill>
        </div>

        <div class="cb-sub" style="margin-left: 48px; margin-top: -4px">
          {{ sinceLabel(r) }}
        </div>

        <div v-if="isPreTrial(r.status)" style="display: flex; gap: 8px; margin-top: 4px">
          <button class="cb-btn outline sm" style="flex: 1" type="button" @click="onRefuse(r, $event)">
            Refuser
          </button>
          <button class="cb-btn primary sm" style="flex: 2" type="button" @click="onMarkTrial(r, $event)">
            Marquer essai en cours
          </button>
        </div>
        <div v-else-if="r.status === 'trial_in_progress'" style="display: flex; gap: 8px; margin-top: 4px">
          <button class="cb-btn outline sm" style="flex: 1" type="button" @click="onRefuse(r, $event)">
            Refuser
          </button>
          <button class="cb-btn primary sm" style="flex: 2" type="button" @click="onConfirm(r, $event)">
            Envoyer la cotisation
          </button>
        </div>
      </div>
    </div>
  </CbMobileShell>
</template>
