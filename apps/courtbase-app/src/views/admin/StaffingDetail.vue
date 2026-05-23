<script setup lang="ts">
/**
 * A2 — Détail staffing match (admin restreint).
 *
 * Édite les assignations d'un match en présentant, pour **chaque niveau
 * requis**, la liste des slots remplis (avec status + kebab actions) et des
 * slots vides ("Assigner un officiel"). Permet aussi d'envoyer un rappel
 * `officials_needed` global si le staffing est incomplet.
 *
 * Mock-only — toutes les mutations sont simulées via `logMockAction(...)`. La
 * vue ne modifie pas les seeds : l'état reste constant entre les actions
 * (idem aux autres écrans `courtbase-app`).
 *
 * Référence visuelle :
 *   - `/tmp/courtbase-app-design/courtbase-app/project/screens/admin.jsx`
 *     → bloc `A2Mobile`.
 *   - Brief § 5 "A2 — Détail staffing match" dans
 *     `docs/design-brief-courtbase-app.md`.
 *
 * Routes/URL :
 *   - Mobile : `/staffing/:matchId` (lazy via `router/index.ts`).
 *   - Admin scope (allowlist `staffing-detail`).
 *
 * Limitations connues :
 *   - Pas de "Forcer confirmé" (rootAdmin only, claim non disponible côté UI
 *     en mock — l'item est masqué).
 *   - La liste des candidats du dialog "Assigner" inclut **toujours** Mathieu
 *     (session) + 3 candidats inline générés pour démonstration. En vrai
 *     code, on chargera `listMembers({ minOfficialLevel })`.
 *   - `assign / unassign / notify-individual / send-reminder` loguent
 *     uniquement — pas de refetch ni d'optimistic UI.
 */

import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertTriangle,
  ArrowLeft,
  BellRing,
  CheckCircle2,
  CircleHelp,
  Inbox,
  MapPin,
  MoreVertical,
  Plus,
  Send,
  Shield,
  X,
} from 'lucide-vue-next'

import CbAvatar from '@/components/ui/CbAvatar.vue'
import CbBanner from '@/components/ui/CbBanner.vue'
import CbDesktopShell from '@/components/ui/CbDesktopShell.vue'
import CbEmptyState from '@/components/ui/CbEmptyState.vue'
import CbMatchTypeChip from '@/components/ui/CbMatchTypeChip.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbPageHead from '@/components/ui/CbPageHead.vue'
import CbPill from '@/components/ui/CbPill.vue'
import type { CbNavItem } from '@/components/ui/CbSidebar.vue'

import {
  getMatch,
  getMember,
  getTeam,
  listAssignmentsForMatch,
  logMockAction,
  type MockAssignment,
  type MockMatch,
} from '@/repositories/mock'

// ────────────────────────────────────────────────────────────────
// Data — match + assignations + équipe à domicile
// ────────────────────────────────────────────────────────────────

const route = useRoute()
const router = useRouter()

const matchId = computed<string>(() => {
  const raw = route.params['matchId']
  return Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
})

const match = computed<MockMatch | null>(() =>
  matchId.value ? getMatch(matchId.value) : null,
)

const team = computed(() => (match.value ? getTeam(match.value.teamId) : null))

const assignments = computed<MockAssignment[]>(() =>
  match.value ? listAssignmentsForMatch(match.value.id) : [],
)

// ────────────────────────────────────────────────────────────────
// Formatting helpers — dates / heures (FR, déterministe)
// ────────────────────────────────────────────────────────────────

const FR_WEEKDAYS = ['Di', 'Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa']
const FR_MONTHS = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
]

function formatDateLongFr(iso: string): string {
  const parts = iso.split('-').map((p) => Number(p))
  const y = parts[0] ?? 1970
  const m = parts[1] ?? 1
  const d = parts[2] ?? 1
  const date = new Date(y, m - 1, d)
  const wd = FR_WEEKDAYS[date.getDay()] ?? '?'
  const mo = FR_MONTHS[m - 1] ?? '?'
  return `${wd} ${d} ${mo}`
}

const formattedDate = computed(() =>
  match.value ? formatDateLongFr(match.value.date) : '',
)
const formattedTime = computed(() => match.value?.startTime ?? '')

const homeTeamLabel = computed(() => team.value?.name ?? 'Équipe à domicile')

const oppositionLabel = computed(() => {
  if (!match.value) return ''
  return match.value.kind === 'home'
    ? `${homeTeamLabel.value} vs ${match.value.opponent}`
    : `${homeTeamLabel.value} → ${match.value.opponent}`
})

const matchHeaderTitle = computed(() => {
  if (!match.value) return 'Staffing'
  return `Staffing — ${match.value.opponent}`
})

const matchHeaderSubtitle = computed(() => {
  if (!match.value) return ''
  return `${formattedDate.value} · ${formattedTime.value} · ${match.value.venueLabel}`
})

// ────────────────────────────────────────────────────────────────
// Slots officiels — par niveau requis
// ────────────────────────────────────────────────────────────────

interface SlotFill {
  assignmentId: string
  memberId: string
  fullName: string
  status: MockAssignment['status']
  tone?: 'emerald' | 'sky' | 'amber' | 'violet' | 'rose'
}

interface OfficialSlot {
  level: number
  required: number
  filled: SlotFill[]
  /** Nombre de slots vides à afficher. */
  empties: number
}

const officialSlots = computed<OfficialSlot[]>(() => {
  if (!match.value) return []
  const m = match.value
  const levels = Object.keys(m.requiredByLevel)
    .map((k) => Number(k))
    .sort((a, b) => b - a) // niveau le plus haut d'abord

  return levels.map<OfficialSlot>((level) => {
    const required = m.requiredByLevel[level] ?? 0
    const filled: SlotFill[] = assignments.value
      .filter((a) => a.requiredLevel === level)
      .map<SlotFill>((a) => {
        const member = getMember(a.memberId)
        const fullName = member
          ? `${member.firstName} ${member.lastName}`
          : 'Officiel externe'
        return {
          assignmentId: a.id,
          memberId: a.memberId,
          fullName,
          status: a.status,
          tone: member?.avatarTone,
        }
      })
    const empties = Math.max(0, required - filled.length)
    return { level, required, filled, empties }
  })
})

const totalFilled = computed(() =>
  officialSlots.value.reduce((acc, s) => acc + s.filled.length, 0),
)
const totalRequired = computed(() => match.value?.requiredOfficialsTotal ?? 0)
const staffingIncomplete = computed(
  () => totalFilled.value < totalRequired.value,
)

// ────────────────────────────────────────────────────────────────
// Candidats (pour le dialog "Assigner un officiel")
// ────────────────────────────────────────────────────────────────

/**
 * Catalogue de candidats inline pour la démo. En mock, `MOCK_MEMBERS` ne
 * contient qu'un seul officiel (Mathieu, niveau 2). Pour rendre la
 * sélection crédible, on ajoute 3 candidats virtuels avec différents
 * niveaux + "dernier match" pour le helper text de la row.
 *
 * Quand on branchera Firebase, supprimer ce catalogue et charger via
 * `listMembers({ minOfficialLevel: level })` côté repo.
 */
interface Candidate {
  id: string
  firstName: string
  lastName: string
  officialLevel: number
  avatarTone?: 'emerald' | 'sky' | 'amber' | 'violet' | 'rose'
  lastAssignment?: string
}

const CANDIDATES: ReadonlyArray<Candidate> = [
  {
    id: 'm-mathieu',
    firstName: 'Mathieu',
    lastName: 'Brun',
    officialLevel: 2,
    avatarTone: 'emerald',
    lastAssignment: 'Sa 11 oct. · CSJC Lausanne',
  },
  {
    id: 'm-other-official-1',
    firstName: 'Rachel',
    lastName: 'Dind',
    officialLevel: 1,
    avatarTone: 'amber',
    lastAssignment: 'Di 05 oct. · AFBB Yverdon',
  },
  {
    id: 'm-other-official-2',
    firstName: 'Lucas',
    lastName: 'Vauthey',
    officialLevel: 2,
    avatarTone: 'violet',
    lastAssignment: 'Sa 04 oct. · CSJC Pully',
  },
  {
    id: 'm-other-official-3',
    firstName: 'Tom',
    lastName: 'Riedo',
    officialLevel: 1,
    avatarTone: 'sky',
    lastAssignment: 'Aucune cette saison',
  },
]

// ────────────────────────────────────────────────────────────────
// Dialog "Assigner un officiel"
// ────────────────────────────────────────────────────────────────

const assignDialogOpen = ref(false)
const assignDialogLevel = ref<number | null>(null)

function openAssignDialog(level: number): void {
  assignDialogLevel.value = level
  assignDialogOpen.value = true
}

function closeAssignDialog(): void {
  assignDialogOpen.value = false
  assignDialogLevel.value = null
}

/**
 * Liste des candidats éligibles au niveau requis :
 *   - officialLevel ≥ requiredLevel ;
 *   - non déjà assigné à ce match (toutes assignments confondues).
 */
const assignDialogCandidates = computed<Candidate[]>(() => {
  const level = assignDialogLevel.value
  if (level == null) return []
  const alreadyAssignedIds = new Set(assignments.value.map((a) => a.memberId))
  return CANDIDATES.filter(
    (c) => c.officialLevel >= level && !alreadyAssignedIds.has(c.id),
  )
})

function selectCandidate(candidate: Candidate): void {
  if (!match.value || assignDialogLevel.value == null) return
  logMockAction('a2.assign', {
    matchId: match.value.id,
    level: assignDialogLevel.value,
    memberId: candidate.id,
  })
  closeAssignDialog()
  showToast(
    `${candidate.firstName} ${candidate.lastName} assigné — niveau ${assignDialogLevel.value}.`,
    'emerald',
  )
}

// ────────────────────────────────────────────────────────────────
// Kebab par-assignment + dialog "Retirer"
// ────────────────────────────────────────────────────────────────

const openKebabAssignmentId = ref<string | null>(null)

function toggleKebab(assignmentId: string): void {
  openKebabAssignmentId.value =
    openKebabAssignmentId.value === assignmentId ? null : assignmentId
}

function closeKebab(): void {
  openKebabAssignmentId.value = null
}

const unassignDialogOpen = ref(false)
const unassignTarget = ref<SlotFill | null>(null)

function openUnassignDialog(fill: SlotFill): void {
  unassignTarget.value = fill
  unassignDialogOpen.value = true
  closeKebab()
}

function closeUnassignDialog(): void {
  unassignDialogOpen.value = false
  unassignTarget.value = null
}

function confirmUnassign(): void {
  if (!unassignTarget.value) return
  logMockAction('a2.unassign', {
    assignmentId: unassignTarget.value.assignmentId,
  })
  const name = unassignTarget.value.fullName
  closeUnassignDialog()
  showToast(`${name} retiré du staffing.`, 'rose')
}

function notifyIndividual(fill: SlotFill): void {
  logMockAction('a2.notify-individual', { assignmentId: fill.assignmentId })
  closeKebab()
  showToast(`Rappel envoyé à ${fill.fullName}.`, 'emerald')
}

// ────────────────────────────────────────────────────────────────
// Send reminder (broadcast officials_needed)
// ────────────────────────────────────────────────────────────────

function sendReminder(): void {
  if (!match.value) return
  logMockAction('a2.send-reminder', { matchId: match.value.id })
  showToast(
    'Rappel officials_needed envoyé aux officiels disponibles.',
    'emerald',
  )
}

// ────────────────────────────────────────────────────────────────
// Toast (auto-hide 3s)
// ────────────────────────────────────────────────────────────────

const toastMessage = ref<string>('')
const toastTone = ref<'emerald' | 'amber' | 'rose'>('emerald')
const toastVisible = ref(false)
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(
  message: string,
  tone: 'emerald' | 'amber' | 'rose' = 'emerald',
): void {
  toastMessage.value = message
  toastTone.value = tone
  toastVisible.value = true
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastVisible.value = false
  }, 3000)
}

function dismissToast(): void {
  toastVisible.value = false
  if (toastTimer) {
    clearTimeout(toastTimer)
    toastTimer = null
  }
}

// ────────────────────────────────────────────────────────────────
// Navigation
// ────────────────────────────────────────────────────────────────

function onBack(): void {
  if (window.history.length > 1) {
    router.back()
  } else {
    void router.push({ name: 'staffing' })
  }
}

// ────────────────────────────────────────────────────────────────
// Sidebar desktop (admin)
// ────────────────────────────────────────────────────────────────

const navAdmin: CbNavItem[] = [
  { icon: Shield, label: 'Accueil' },
  { icon: BellRing, label: 'Staffing' },
  { icon: Inbox, label: 'Demandes', badge: 5 },
  { icon: Send, label: 'Diffuser' },
]

// ────────────────────────────────────────────────────────────────
// Status pill helper
// ────────────────────────────────────────────────────────────────

function statusLabel(status: MockAssignment['status']): string {
  return status === 'confirmed'
    ? 'Confirmé'
    : status === 'pending'
      ? 'Pending'
      : 'Décliné'
}

function statusTone(
  status: MockAssignment['status'],
): 'emerald' | 'amber' | 'slate' {
  return status === 'confirmed'
    ? 'emerald'
    : status === 'pending'
      ? 'amber'
      : 'slate'
}
</script>

<template>
  <!-- ─── Cas erreur : match introuvable ─────────────────────── -->
  <CbMobileShell
    v-if="!match"
    title="Staffing"
    show-back
    @back="onBack"
  >
    <div class="cb-page">
      <CbEmptyState
        :icon="CircleHelp"
        title="Match introuvable"
        body="Ce match n'existe pas ou n'est plus disponible. Il a peut-être été annulé ou supprimé."
      >
        <template #actions>
          <button type="button" class="cb-btn primary sm" @click="onBack">
            <ArrowLeft :size="16" /> Retour
          </button>
        </template>
      </CbEmptyState>
    </div>
  </CbMobileShell>

  <!-- ─── Mobile ─────────────────────────────────────────────── -->
  <CbMobileShell
    v-else
    class="a2-mobile"
    title="Staffing"
    show-back
    @back="onBack"
  >
    <div class="cb-page">
      <!-- Card récap match -->
      <div class="cb-card" style="padding: 14px">
        <div
          style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px"
        >
          <div>
            <div class="cb-h2" style="font-size: 18px">{{ formattedDate }}</div>
            <div
              class="mono"
              style="font-size: 15px; font-weight: 600; color: var(--slate-700); margin-top: 2px"
            >
              {{ formattedTime }}
            </div>
          </div>
          <CbMatchTypeChip :type="match.matchType" />
        </div>
        <div style="margin-top: 10px; font-size: 15px; font-weight: 600">
          {{ homeTeamLabel }}
          <span style="color: var(--text-subtle); font-weight: 500">{{
            match.kind === 'home' ? 'vs' : '→'
          }}</span>
          {{ match.opponent }}
        </div>
        <div
          class="cb-sub"
          style="margin-top: 8px; display: flex; gap: 6px; align-items: center"
        >
          <MapPin :size="14" />
          <span>{{ match.venueLabel }}</span>
        </div>
        <div style="margin-top: 10px; display: flex; gap: 6px; flex-wrap: wrap">
          <CbPill v-if="match.kind === 'away'" tone="sky">Extérieur</CbPill>
          <CbPill v-else tone="violet">Domicile</CbPill>
          <CbPill tone="slate">{{ match.durationHours }}h</CbPill>
          <CbPill
            :tone="staffingIncomplete ? 'amber' : 'emerald'"
            dot
          >{{ totalFilled }}/{{ totalRequired }}</CbPill>
        </div>
      </div>

      <!-- Section "Assignations" par niveau -->
      <div>
        <div class="cb-section-label" style="padding: 0 0 6px">Assignations</div>
        <div class="cb-card" style="padding: 4px 14px">
          <div
            v-for="(slot, i) in officialSlots"
            :key="slot.level"
            class="a2-slot"
            :style="i === officialSlots.length - 1 ? { borderBottom: 'none' } : undefined"
          >
            <!-- Tête de niveau : libellé + ratio + pill -->
            <div class="a2-slot-head">
              <div class="a2-slot-title">
                Niveau {{ slot.level }}
                <span
                  class="mono"
                  style="color: var(--text-subtle); font-weight: 500"
                >
                  · {{ slot.filled.length }}/{{ slot.required }}
                </span>
              </div>
              <CbPill
                v-if="slot.filled.length >= slot.required"
                tone="emerald"
                dot
              >Complet</CbPill>
              <CbPill v-else tone="amber" dot>
                {{ slot.required - slot.filled.length }} à pourvoir
              </CbPill>
            </div>

            <!-- Liste des slots (remplis puis vides) -->
            <div class="a2-slot-list">
              <div
                v-for="fill in slot.filled"
                :key="fill.assignmentId"
                class="a2-slot-row filled"
              >
                <CbAvatar :name="fill.fullName" size="sm" :tone="fill.tone" />
                <div class="a2-slot-body">
                  <div class="a2-slot-name">{{ fill.fullName }}</div>
                  <div class="a2-slot-sub">
                    <CbPill :tone="statusTone(fill.status)" dot>
                      {{ statusLabel(fill.status) }}
                    </CbPill>
                  </div>
                </div>
                <div class="a2-kebab-wrap">
                  <button
                    type="button"
                    class="cb-iconbtn"
                    aria-label="Plus d'options"
                    :aria-expanded="openKebabAssignmentId === fill.assignmentId"
                    @click="toggleKebab(fill.assignmentId)"
                  >
                    <MoreVertical :size="18" />
                  </button>
                  <div
                    v-if="openKebabAssignmentId === fill.assignmentId"
                    class="a2-kebab-menu"
                    @click.stop
                  >
                    <button
                      type="button"
                      class="a2-kebab-item"
                      @click="notifyIndividual(fill)"
                    >
                      <Send :size="14" /> Notifier
                    </button>
                    <button
                      type="button"
                      class="a2-kebab-item danger"
                      @click="openUnassignDialog(fill)"
                    >
                      <X :size="14" /> Retirer
                    </button>
                  </div>
                </div>
              </div>

              <button
                v-for="empty in slot.empties"
                :key="`empty-${slot.level}-${empty}`"
                type="button"
                class="a2-slot-row empty"
                @click="openAssignDialog(slot.level)"
              >
                <span class="a2-slot-placeholder"><Plus :size="14" /></span>
                <span class="a2-slot-name muted">Assigner un officiel</span>
                <span class="cb-sub mono">niveau ≥ {{ slot.level }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Section "Notification" -->
      <div v-if="staffingIncomplete">
        <div class="cb-section-label" style="padding: 0 0 6px">Notification</div>
        <div
          class="cb-card"
          style="padding: 14px; display: flex; justify-content: space-between; align-items: center; gap: 12px"
        >
          <div style="flex: 1; min-width: 0">
            <div style="font-weight: 600; font-size: 13px">
              Envoyer un rappel officials_needed
            </div>
            <div class="cb-sub" style="margin-top: 2px">
              Notifie tous les officiels niveau ≥ 1 disponibles.
            </div>
          </div>
          <button type="button" class="cb-btn outline sm" @click="sendReminder">
            <Send :size="14" /> Envoyer
          </button>
        </div>
      </div>

      <CbBanner v-else tone="emerald" title="Staffing complet">
        <template #icon><CheckCircle2 :size="18" /></template>
        Tous les slots officiels sont pourvus. Aucun rappel à envoyer.
      </CbBanner>
    </div>
  </CbMobileShell>

  <!-- ─── Desktop (≥1024 px) ─────────────────────────────────── -->
  <CbDesktopShell
    v-if="match"
    class="a2-desktop"
    :items="navAdmin"
    :active="1"
    brand-name="BC Aigles"
    brand-sub="Saison 2025/26"
    club-initials="BCA"
    user-name="Mathieu Brun"
    user-role="Admin · Officiel"
  >
    <CbPageHead
      :title="matchHeaderTitle"
      :subtitle="matchHeaderSubtitle"
    >
      <template #actions>
        <button type="button" class="cb-btn ghost" @click="onBack">
          <ArrowLeft :size="16" /> Retour
        </button>
        <button
          v-if="staffingIncomplete"
          type="button"
          class="cb-btn outline"
          @click="sendReminder"
        >
          <Send :size="16" /> Envoyer un rappel
        </button>
      </template>
    </CbPageHead>

    <div class="a2-desktop-body">
      <div class="a2-desktop-grid">
        <!-- Colonne gauche : récap match -->
        <div style="display: flex; flex-direction: column; gap: 16px">
          <div class="cb-card" style="padding: 18px">
            <div
              style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px"
            >
              <div>
                <div class="cb-h1" style="font-size: 22px">{{ formattedDate }}</div>
                <div
                  class="mono"
                  style="font-size: 18px; font-weight: 600; color: var(--slate-700); margin-top: 2px"
                >
                  {{ formattedTime }}
                </div>
              </div>
              <CbMatchTypeChip :type="match.matchType" />
            </div>
            <div style="margin-top: 12px; font-size: 16px; font-weight: 600">
              {{ homeTeamLabel }}
              <span style="color: var(--text-subtle); font-weight: 500">{{
                match.kind === 'home' ? 'vs' : '→'
              }}</span>
              {{ match.opponent }}
            </div>
            <div
              class="cb-sub"
              style="margin-top: 8px; display: flex; gap: 6px; align-items: center"
            >
              <MapPin :size="14" />
              <span>{{ match.venueLabel }}</span>
            </div>
            <div style="margin-top: 12px; display: flex; gap: 6px; flex-wrap: wrap">
              <CbPill v-if="match.kind === 'away'" tone="sky">Extérieur</CbPill>
              <CbPill v-else tone="violet">Domicile</CbPill>
              <CbPill tone="slate">{{ match.durationHours }}h</CbPill>
              <CbPill
                :tone="staffingIncomplete ? 'amber' : 'emerald'"
                dot
              >{{ totalFilled }}/{{ totalRequired }}</CbPill>
            </div>
          </div>

          <CbBanner
            v-if="staffingIncomplete"
            tone="amber"
            title="Staffing incomplet"
          >
            <template #icon><AlertTriangle :size="18" /></template>
            {{ totalRequired - totalFilled }} slot(s) à pourvoir. Vous pouvez
            assigner manuellement un officiel ci-contre ou envoyer un rappel
            collectif.
          </CbBanner>
          <CbBanner v-else tone="emerald" title="Staffing complet">
            <template #icon><CheckCircle2 :size="18" /></template>
            Tous les slots officiels sont pourvus. Aucun rappel à envoyer.
          </CbBanner>
        </div>

        <!-- Colonne droite : assignations -->
        <div style="display: flex; flex-direction: column; gap: 16px">
          <div>
            <div class="cb-section-label" style="padding: 0 4px 8px">Assignations</div>
            <div class="cb-card" style="padding: 4px 18px">
              <div
                v-for="(slot, i) in officialSlots"
                :key="slot.level"
                class="a2-slot"
                :style="i === officialSlots.length - 1 ? { borderBottom: 'none' } : undefined"
              >
                <div class="a2-slot-head">
                  <div class="a2-slot-title">
                    Niveau {{ slot.level }}
                    <span
                      class="mono"
                      style="color: var(--text-subtle); font-weight: 500"
                    >
                      · {{ slot.filled.length }}/{{ slot.required }}
                    </span>
                  </div>
                  <CbPill
                    v-if="slot.filled.length >= slot.required"
                    tone="emerald"
                    dot
                  >Complet</CbPill>
                  <CbPill v-else tone="amber" dot>
                    {{ slot.required - slot.filled.length }} à pourvoir
                  </CbPill>
                </div>
                <div class="a2-slot-list">
                  <div
                    v-for="fill in slot.filled"
                    :key="`d-${fill.assignmentId}`"
                    class="a2-slot-row filled"
                  >
                    <CbAvatar :name="fill.fullName" size="sm" :tone="fill.tone" />
                    <div class="a2-slot-body">
                      <div class="a2-slot-name">{{ fill.fullName }}</div>
                      <div class="a2-slot-sub">
                        <CbPill :tone="statusTone(fill.status)" dot>
                          {{ statusLabel(fill.status) }}
                        </CbPill>
                      </div>
                    </div>
                    <div class="a2-kebab-wrap">
                      <button
                        type="button"
                        class="cb-iconbtn"
                        aria-label="Plus d'options"
                        :aria-expanded="openKebabAssignmentId === fill.assignmentId"
                        @click="toggleKebab(fill.assignmentId)"
                      >
                        <MoreVertical :size="18" />
                      </button>
                      <div
                        v-if="openKebabAssignmentId === fill.assignmentId"
                        class="a2-kebab-menu desktop"
                        @click.stop
                      >
                        <button
                          type="button"
                          class="a2-kebab-item"
                          @click="notifyIndividual(fill)"
                        >
                          <Send :size="14" /> Notifier
                        </button>
                        <button
                          type="button"
                          class="a2-kebab-item danger"
                          @click="openUnassignDialog(fill)"
                        >
                          <X :size="14" /> Retirer
                        </button>
                      </div>
                    </div>
                  </div>

                  <button
                    v-for="empty in slot.empties"
                    :key="`d-empty-${slot.level}-${empty}`"
                    type="button"
                    class="a2-slot-row empty"
                    @click="openAssignDialog(slot.level)"
                  >
                    <span class="a2-slot-placeholder"><Plus :size="14" /></span>
                    <span class="a2-slot-name muted">Assigner un officiel</span>
                    <span class="cb-sub mono">niveau ≥ {{ slot.level }}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </CbDesktopShell>

  <!-- ─── Dialog "Assigner un officiel" (fullscreen mobile / centré desktop) -->
  <Teleport to="body">
    <div
      v-if="assignDialogOpen && assignDialogLevel !== null"
      class="a2-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      :aria-label="`Assigner un officiel — Niveau ${assignDialogLevel}`"
      @click.self="closeAssignDialog"
    >
      <div class="a2-dialog">
        <div class="a2-dialog-head">
          <h2 class="cb-h2">Assigner un officiel — Niveau {{ assignDialogLevel }}</h2>
          <button
            type="button"
            class="cb-iconbtn"
            aria-label="Fermer"
            @click="closeAssignDialog"
          >
            <X :size="18" />
          </button>
        </div>
        <div class="a2-dialog-body">
          <p class="cb-sub" style="margin-bottom: 12px">
            Sélectionnez un officiel avec un niveau supérieur ou égal à
            <strong>{{ assignDialogLevel }}</strong>. La personne recevra une
            notification immédiate.
          </p>
          <div v-if="assignDialogCandidates.length === 0" class="a2-no-candidate">
            <CbEmptyState
              :icon="Shield"
              title="Aucun candidat éligible"
              body="Aucun officiel actif n'a un niveau suffisant pour ce slot. Élargissez les critères ou contactez la fédération."
            />
          </div>
          <div v-else class="a2-candidate-list">
            <button
              v-for="c in assignDialogCandidates"
              :key="c.id"
              type="button"
              class="a2-candidate"
              @click="selectCandidate(c)"
            >
              <CbAvatar
                :name="`${c.firstName} ${c.lastName}`"
                size="sm"
                :tone="c.avatarTone"
              />
              <div class="a2-candidate-body">
                <div class="a2-candidate-name">
                  {{ c.firstName }} {{ c.lastName }}
                </div>
                <div class="a2-candidate-sub">
                  <CbPill tone="violet">Niveau {{ c.officialLevel }}</CbPill>
                  <span v-if="c.lastAssignment" class="cb-sub">
                    Dernier match : {{ c.lastAssignment }}
                  </span>
                </div>
              </div>
            </button>
          </div>
        </div>
        <div class="a2-dialog-actions">
          <button type="button" class="cb-btn ghost" @click="closeAssignDialog">
            Annuler
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ─── Dialog "Retirer" (confirmation simple) ──────────────── -->
  <Teleport to="body">
    <div
      v-if="unassignDialogOpen && unassignTarget"
      class="a2-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      :aria-label="`Retirer ${unassignTarget.fullName} du staffing`"
      @click.self="closeUnassignDialog"
    >
      <div class="a2-dialog" style="max-width: 420px">
        <div class="a2-dialog-head">
          <h2 class="cb-h2">Retirer du staffing</h2>
          <button
            type="button"
            class="cb-iconbtn"
            aria-label="Fermer"
            @click="closeUnassignDialog"
          >
            <X :size="18" />
          </button>
        </div>
        <div class="a2-dialog-body">
          <p style="font-size: 13px; line-height: 1.55">
            Vous allez retirer <strong>{{ unassignTarget.fullName }}</strong>
            du staffing de ce match. La personne recevra une notification de
            désassignation. Vous pourrez réassigner un autre officiel ensuite.
          </p>
        </div>
        <div class="a2-dialog-actions">
          <button type="button" class="cb-btn ghost" @click="closeUnassignDialog">
            Annuler
          </button>
          <button type="button" class="cb-btn danger" @click="confirmUnassign">
            <X :size="16" /> Retirer
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ─── Toast (emerald / amber / rose) ──────────────────────── -->
  <Teleport to="body">
    <div
      v-if="toastVisible"
      class="cb-toast"
      :class="toastTone"
      role="status"
      aria-live="polite"
      @click="dismissToast"
    >
      <CheckCircle2 v-if="toastTone === 'emerald'" :size="18" />
      <AlertTriangle v-else-if="toastTone === 'amber'" :size="18" />
      <X v-else :size="18" />
      <span style="flex: 1">{{ toastMessage }}</span>
    </div>
  </Teleport>
</template>

<style scoped>
/* ─── Responsive shells ───────────────────────────────────── */
.a2-mobile { display: flex; }
.a2-desktop { display: none; }
@media (min-width: 1024px) {
  .a2-mobile { display: none; }
  .a2-desktop { display: flex; }
}

/* ─── Slots officiels (par niveau) ────────────────────────── */
.a2-slot {
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}
.a2-slot-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.a2-slot-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.a2-slot-list {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.a2-slot-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 6px;
  border-radius: 8px;
  background: transparent;
  border: 0;
  font: inherit;
  text-align: left;
  width: 100%;
  cursor: default;
}
.a2-slot-row.filled {
  cursor: default;
}
.a2-slot-row.empty {
  cursor: pointer;
  border: 1px dashed var(--slate-300);
  background: var(--slate-50, transparent);
}
.a2-slot-row.empty:hover {
  background: var(--slate-100, var(--slate-50));
}
.a2-slot-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.a2-slot-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.a2-slot-name.muted {
  color: var(--text-subtle);
  font-weight: 500;
  flex: 1;
}
.a2-slot-sub {
  display: flex;
  gap: 6px;
  align-items: center;
}
.a2-slot-placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 14px;
  background: var(--bg);
  color: var(--text-subtle);
  border: 1px dashed var(--slate-300);
}

/* ─── Kebab per-assignment ────────────────────────────────── */
.a2-kebab-wrap {
  position: relative;
}
.a2-kebab-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow-md, 0 8px 24px rgba(15, 23, 42, 0.12));
  padding: 4px;
  min-width: 180px;
  z-index: 60;
}
.a2-kebab-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  width: 100%;
  background: transparent;
  border: 0;
  border-radius: 6px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  cursor: pointer;
  text-align: left;
}
.a2-kebab-item:hover {
  background: var(--slate-50);
}
.a2-kebab-item.danger {
  color: var(--rose-600);
}
.a2-kebab-item.danger:hover {
  background: var(--rose-50, rgba(244, 63, 94, 0.08));
}

/* ─── Dialogs ─────────────────────────────────────────────── */
.a2-dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 1000;
}
.a2-dialog {
  background: var(--bg);
  border-radius: 16px;
  box-shadow: var(--shadow-lg, 0 20px 40px rgba(0, 0, 0, 0.18));
  width: 100%;
  max-width: 520px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  max-height: 88vh;
}
/* Sur mobile (< 640px), le dialog "assigner" s'étend en pleine hauteur. */
@media (max-width: 639px) {
  .a2-dialog-backdrop {
    padding: 0;
    align-items: stretch;
  }
  .a2-dialog {
    border-radius: 0;
    max-width: 100%;
    max-height: 100vh;
  }
}
.a2-dialog-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border);
}
.a2-dialog-body {
  padding: 18px;
  overflow: auto;
  flex: 1;
  min-height: 0;
}
.a2-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 18px 18px;
  border-top: 1px solid var(--border);
  background: var(--slate-50, var(--bg));
}

/* ─── Candidate list (dialog "Assigner") ──────────────────── */
.a2-candidate-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.a2-candidate {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: transparent;
  border: 1px solid var(--border);
  font: inherit;
  text-align: left;
  cursor: pointer;
  width: 100%;
}
.a2-candidate:hover {
  background: var(--slate-50);
  border-color: var(--slate-300);
}
.a2-candidate-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.a2-candidate-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.a2-candidate-sub {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.a2-no-candidate {
  padding: 4px 0;
}

/* ─── Desktop layout ──────────────────────────────────────── */
.a2-desktop-body {
  flex: 1;
  overflow: auto;
  padding: 24px 28px;
  background: var(--bg-muted);
}
.a2-desktop-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
  gap: 20px;
  align-items: start;
  max-width: 1100px;
}

/* ─── Toast positioning override : on l'utilise sans tab bar
       sur desktop, donc on remonte un peu sur ce viewport. */
@media (min-width: 1024px) {
  :global(.cb-toast) {
    bottom: 32px !important;
    left: auto !important;
    right: 32px !important;
    max-width: 420px;
  }
}
</style>
