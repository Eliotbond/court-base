<script setup lang="ts">
/**
 * CO8 — Inscriptions à traiter (coach).
 *
 * Transcription quasi-littérale de `CO8Mobile` (JSX `screens/coach.jsx`
 * lignes 513-550) avec le RegRow (lignes 498-511) inliné dans le v-for.
 *
 * 3 chips de filtre :
 *   - "À traiter" (default) : registrations en pré-décision (submitted,
 *     open_pending_trial, conditional_pending_review, trial_in_progress).
 *   - "Essai en cours" : trial_in_progress uniquement.
 *   - "Toutes" : tous statuts.
 *
 * Actions inline par card selon le status :
 *   - pré-trial → "Refuser" + "Marquer essai en cours".
 *   - trial_in_progress → "Refuser" + "Confirmer l'inscription".
 *
 * Refus : `window.prompt` natif demande un motif (acceptable pour le mock).
 * Toutes les mutations sont log-only via `logMockAction(...)`.
 *
 * Tap sur la card → `router.push({ name: 'registration-detail', params: { id } })`.
 */
import { computed, ref } from 'vue'
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
import {
  getTeam,
  listRegistrations,
  listRegistrationsToTreat,
  logMockAction,
  type MockRegistration,
} from '@/repositories/mock'

const router = useRouter()
const auth = useAuthStore()
const { isDesktop } = useViewport()
const { coachTabs, coachNav } = useShellNav()

void auth // silence unused — le store est instancié pour les futures gates rôle.

// ─── Filtres chips (3 chips JSX) ─────────────────────────────────
type FilterKind = 'to_treat' | 'trial' | 'all'

const TO_TREAT_STATUSES: ReadonlyArray<MockRegistration['status']> = [
  'submitted',
  'open_pending_trial',
  'conditional_pending_review',
  'trial_in_progress',
]

const activeFilter = ref<FilterKind>('to_treat')

const toTreatCount = computed(() => listRegistrationsToTreat().length)
const trialCount = computed(
  () => listRegistrations({ status: ['trial_in_progress'] }).length,
)

const filters = computed<ReadonlyArray<{ id: FilterKind; label: string }>>(() => [
  { id: 'to_treat', label: `À traiter · ${toTreatCount.value}` },
  { id: 'trial', label: `Essai en cours · ${trialCount.value}` },
  { id: 'all', label: 'Toutes' },
])

function setFilter(id: FilterKind): void {
  if (activeFilter.value === id) return
  activeFilter.value = id
  logMockAction('co8.filter-changed', { filter: id })
}

// ─── Liste filtrée ───────────────────────────────────────────────
const filteredRegistrations = computed<ReadonlyArray<MockRegistration>>(() => {
  switch (activeFilter.value) {
    case 'to_treat':
      return listRegistrations({ status: [...TO_TREAT_STATUSES] })
    case 'trial':
      return listRegistrations({ status: ['trial_in_progress'] })
    default:
      return listRegistrations()
  }
})

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

function statusMeta(status: MockRegistration['status']): StatusMeta {
  switch (status) {
    case 'submitted':
    case 'open_pending_trial':
      return { label: 'Soumise', tone: 'amber' }
    case 'conditional_pending_review':
      return { label: 'Conditionnelle', tone: 'amber' }
    case 'trial_in_progress':
      return { label: 'Essai en cours', tone: 'sky' }
    case 'confirmed_pending_dues':
      return { label: 'En attente cotisation', tone: 'amber' }
    case 'active':
      return { label: 'Active', tone: 'emerald' }
    case 'refused':
      return { label: 'Refusée', tone: 'rose' }
  }
}

function avatarToneFor(
  status: MockRegistration['status'],
): 'emerald' | 'sky' | 'amber' | 'violet' | 'rose' {
  // JSX : tone === "amber" ? "amber" : tone === "sky" ? "sky" : "emerald".
  const tone = statusMeta(status).tone
  if (tone === 'amber') return 'amber'
  if (tone === 'sky') return 'sky'
  if (tone === 'rose') return 'rose'
  return 'emerald'
}

function sinceLabel(r: MockRegistration): string {
  if (r.status === 'trial_in_progress') {
    return `Essai depuis ${r.submittedAt}`
  }
  if (r.status === 'conditional_pending_review') {
    return `Soumise ${r.submittedAt} · candidature à examiner`
  }
  return `Soumise ${r.submittedAt} par ${r.submitterName}`
}

function isPreTrial(status: MockRegistration['status']): boolean {
  return (
    status === 'submitted' ||
    status === 'open_pending_trial' ||
    status === 'conditional_pending_review'
  )
}

// ─── Actions ─────────────────────────────────────────────────────
function openDetail(r: MockRegistration): void {
  router
    .push({ name: 'registration-detail', params: { id: r.id } })
    .catch((err) => {
      console.warn('[co8.open-detail] navigation failed', err)
    })
}

function onMarkTrial(r: MockRegistration, evt: Event): void {
  evt.stopPropagation()
  logMockAction('co8.mark-trial', { registrationId: r.id })
}

function onConfirm(r: MockRegistration, evt: Event): void {
  evt.stopPropagation()
  logMockAction('co8.confirm', { registrationId: r.id })
}

function onRefuse(r: MockRegistration, evt: Event): void {
  evt.stopPropagation()
  const reason = window.prompt('Motif du refus :', '')
  if (reason == null) return
  const trimmed = reason.trim()
  if (!trimmed) return
  logMockAction('co8.refuse', { registrationId: r.id, reason: trimmed })
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
    case 3:
      router.push({ name: 'notifications' })
      break
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
    case 4:
      router.push({ name: 'notifications' })
      break
  }
}

function onNotifClick(): void {
  router.push({ name: 'notifications' })
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
    :items="coachNav"
    :active="3"
    brand-name="BC Aigles"
    brand-sub="Saison 2025/26"
    club-initials="BCA"
    user-name="Coach"
    user-role="Coach"
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
        style="display: flex; flex-direction: column; gap: 10px; padding: 14px; cursor: pointer"
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
            Confirmer l'inscription
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
    :tabs="coachTabs"
    :active-tab="2"
    @notif-click="onNotifClick"
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
        style="display: flex; flex-direction: column; gap: 10px; padding: 14px; cursor: pointer"
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
            Confirmer l'inscription
          </button>
        </div>
      </div>
    </div>
  </CbMobileShell>
</template>
