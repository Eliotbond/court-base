<script setup lang="ts">
/**
 * O3 — Détail match (officiel) — wired sur la fondation Firestore réelle.
 *
 * Transcription quasi-littérale de `O3Mobile` (JSX) — cf.
 * `/tmp/courtbase-app-design/courtbase-app/project/screens/official.jsx`
 * lignes 174-255. La structure visuelle reste identique au mock — seuls
 * les sources de données + les actions sont branchées sur les stores
 * (auth / bookings / officials) et le dialog `CbAssignmentActionDialog`.
 *
 * Discriminateur HOME/AWAY :
 *  - `kind === 'home'` si le `route.params.id` matche un booking avec
 *    `slotType === 'match_home'` dans `bookingsStore.allBookings`.
 *  - `kind === 'away'` si l'id matche un match dans `officialsStore.awayMatches`.
 *  - Sinon : empty-state "Match introuvable".
 *
 * État UI dérivé (cf. `viewState`) :
 *  - `nolicense` : `!auth.hasActiveOfficialLicense`.
 *  - `declined`  : caller a une assignation `status: 'declined'`.
 *  - `confirmed` : caller a une assignation `status: 'confirmed'`.
 *  - `pending`   : caller a une assignation `status: 'pending'`.
 *  - `full`      : caller n'a pas d'assignation mais 0 slot ouvert.
 *  - `open`      : caller peut s'inscrire (>= 1 slot ouvert).
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Check,
  CalendarPlus,
  Info,
  MapPin,
  MoreVertical,
  RefreshCw,
  X,
} from 'lucide-vue-next'

import CbAssignmentActionDialog, {
  type CbAssignmentMatchSummary,
} from '@/components/dialogs/CbAssignmentActionDialog.vue'
import CbAvatar from '@/components/ui/CbAvatar.vue'
import CbBanner from '@/components/ui/CbBanner.vue'
import CbBottomBar from '@/components/ui/CbBottomBar.vue'
import CbDesktopShell from '@/components/ui/CbDesktopShell.vue'
import CbEmptyState from '@/components/ui/CbEmptyState.vue'
import CbMemberRow from '@/components/ui/CbMemberRow.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbPageHead from '@/components/ui/CbPageHead.vue'
import CbPill from '@/components/ui/CbPill.vue'
import CbSkel from '@/components/ui/CbSkel.vue'
import { useShellNav } from '@/composables/useShellNav'
import { useViewport } from '@/composables/useViewport'
import { useAuthStore } from '@/stores/auth'
import { useBookingsStore } from '@/stores/bookings'
import { useOfficialsStore } from '@/stores/officials'
import type { BookingRow } from '@/repositories/bookings.repo'
import type { Match, MatchType, OfficialAssignment } from '@club-app/shared-types'
import { logMockAction } from '@/repositories/mock'

// ────────────────────────────────────────────────────────────────
// Stores + route
// ────────────────────────────────────────────────────────────────

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const bookingsStore = useBookingsStore()
const officialsStore = useOfficialsStore()
const { isDesktop } = useViewport()
const { nav, primaryRoleLabel } = useShellNav()

const id = computed<string>(() => {
  const raw = route.params['id']
  return Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
})

// ────────────────────────────────────────────────────────────────
// Hydratation idempotente (au mount + à chaque changement de route)
// ────────────────────────────────────────────────────────────────

const loading = ref(true)

async function hydrate(): Promise<void> {
  loading.value = true
  try {
    await bookingsStore.loadActiveContext()
    const seasonId = bookingsStore.allBookings[0]?.seasonId ?? 'mock-season'
    await officialsStore.loadOfficialContext(seasonId)
  } catch (err) {
    console.error('[match-detail] hydrate failed', err)
  } finally {
    loading.value = false
  }
}

onMounted(hydrate)

// ────────────────────────────────────────────────────────────────
// Discriminateur HOME / AWAY
// ────────────────────────────────────────────────────────────────

interface HomeParent {
  kind: 'home'
  booking: BookingRow
}
interface AwayParent {
  kind: 'away'
  match: Match
}
type Parent = HomeParent | AwayParent

const parent = computed<Parent | null>(() => {
  const targetId = id.value
  if (!targetId) return null
  const booking = bookingsStore.allBookings.find(
    (b) => b.id === targetId && b.slotType === 'match_home',
  )
  if (booking) return { kind: 'home', booking }
  const match = officialsStore.awayMatches.find((m) => m.id === targetId)
  if (match) return { kind: 'away', match }
  return null
})

const kind = computed<'home' | 'away' | null>(() => parent.value?.kind ?? null)

// ────────────────────────────────────────────────────────────────
// MatchType résolu + assignments du match
// ────────────────────────────────────────────────────────────────

const matchType = computed<MatchType | null>(() => {
  const p = parent.value
  if (!p) return null
  if (p.kind === 'home') {
    if (!p.booking.matchTypeId) return null
    return officialsStore.matchTypesById.get(p.booking.matchTypeId) ?? null
  }
  return officialsStore.matchTypesById.get(p.match.matchTypeId) ?? null
})

const assignments = computed<ReadonlyArray<OfficialAssignment>>(() => {
  const p = parent.value
  if (!p) return []
  if (p.kind === 'home') {
    return officialsStore.homeAssignmentsByBookingId.get(p.booking.id) ?? []
  }
  return officialsStore.awayAssignmentsByMatchId.get(p.match.id) ?? []
})

// ────────────────────────────────────────────────────────────────
// Mon assignation (memberId === auth.linkedMember.id)
// ────────────────────────────────────────────────────────────────

const myMemberId = computed<string | null>(() => auth.linkedMember?.id ?? null)

const myAssignment = computed<OfficialAssignment | null>(() => {
  const memberId = myMemberId.value
  if (!memberId) return null
  return assignments.value.find((a) => a.memberId === memberId) ?? null
})

// ────────────────────────────────────────────────────────────────
// Total des slots ouverts (HOME = somme tous niveaux, AWAY = global)
// Un slot est "ouvert" tant que (required - non-declined) > 0.
// ────────────────────────────────────────────────────────────────

interface LevelSlots {
  level: number
  requiredCount: number
  taken: number
  open: number
  filled: ReadonlyArray<OfficialAssignment>
}

const homeSlotsByLevel = computed<ReadonlyArray<LevelSlots>>(() => {
  if (kind.value !== 'home') return []
  const requirements = matchType.value?.homeOfficialRequirements ?? []
  // Conserve l'ordre du référentiel matchType (priorité élevée d'abord en pratique).
  return requirements.map((req) => {
    const filled = assignments.value.filter(
      (a) => a.officialLevel === req.level && a.status !== 'declined',
    )
    const taken = filled.length
    return {
      level: req.level,
      requiredCount: req.count,
      taken,
      open: Math.max(0, req.count - taken),
      filled,
    }
  })
})

const awaySlot = computed<LevelSlots | null>(() => {
  if (kind.value !== 'away') return null
  const required = matchType.value?.awayOfficialCount ?? 0
  if (required <= 0) return null
  const filled = assignments.value.filter((a) => a.status !== 'declined')
  return {
    level: 0,
    requiredCount: required,
    taken: filled.length,
    open: Math.max(0, required - filled.length),
    filled,
  }
})

const totalOpenSlots = computed<number>(() => {
  if (kind.value === 'home') {
    return homeSlotsByLevel.value.reduce((sum, s) => sum + s.open, 0)
  }
  if (kind.value === 'away') {
    return awaySlot.value?.open ?? 0
  }
  return 0
})

// Pour l'auto-inscription, niveau cible = niveau du caller. HOME : nécessite
// que le caller ait un slot ouvert à son niveau. AWAY : niveau ignoré côté
// matchType (le slot AWAY n'est pas typé par niveau dans le modèle actuel).
const callerHasOpenSlotForLevel = computed<boolean>(() => {
  if (kind.value === 'home') {
    const level = auth.officialLevel
    if (level == null) return false
    const entry = homeSlotsByLevel.value.find((s) => s.level === level)
    return (entry?.open ?? 0) > 0
  }
  if (kind.value === 'away') {
    return (awaySlot.value?.open ?? 0) > 0
  }
  return false
})

// ────────────────────────────────────────────────────────────────
// State machine UI
// ────────────────────────────────────────────────────────────────

type ViewState = 'open' | 'pending' | 'confirmed' | 'declined' | 'nolicense' | 'full'

const viewState = computed<ViewState>(() => {
  if (!auth.hasActiveOfficialLicense) return 'nolicense'
  const mine = myAssignment.value
  if (mine?.status === 'declined') return 'declined'
  if (mine?.status === 'confirmed') return 'confirmed'
  if (mine?.status === 'pending') return 'pending'
  // Pas d'assignation → ouvert si encore un slot dispo au niveau du caller.
  if (callerHasOpenSlotForLevel.value) return 'open'
  return 'full'
})

// ────────────────────────────────────────────────────────────────
// Libellés UI dérivés
// ────────────────────────────────────────────────────────────────

const WEEKDAY_LABELS = ['Di', 'Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa'] as const
const MONTH_LABELS = [
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
] as const

function tsToMs(ts: { seconds?: number; toMillis?: () => number } | null | undefined): number {
  if (!ts) return 0
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (typeof ts.seconds === 'number') return ts.seconds * 1000
  return 0
}

function formatDateLabel(ms: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const day = WEEKDAY_LABELS[d.getDay()] ?? ''
  const month = MONTH_LABELS[d.getMonth()] ?? ''
  return `${day} ${d.getDate()} ${month}`
}

const dateLabel = computed<string>(() => {
  const p = parent.value
  if (!p) return '—'
  if (p.kind === 'home') return formatDateLabel(p.booking.startMs)
  return formatDateLabel(tsToMs(p.match.date))
})

const startTime = computed<string>(() => {
  const p = parent.value
  if (!p) return ''
  return p.kind === 'home' ? p.booking.startTime : p.match.startTime
})

const opponentLabel = computed<string>(() => {
  const p = parent.value
  if (!p) return ''
  if (p.kind === 'home') return p.booking.opponentName ?? 'Adversaire à confirmer'
  return p.match.opponentName ?? 'Adversaire à confirmer'
})

const homeTeamName = computed<string>(() => {
  const p = parent.value
  if (!p) return ''
  if (p.kind === 'home') return p.booking.teamName ?? 'Équipe'
  // AWAY : le team du match = notre équipe locale.
  // On a accès au team via le store officials.myAssignments si besoin —
  // ici on utilise un lookup léger via les teams chargées dans bookingsStore.
  const team = bookingsStore.teams.find((t) => t.id === p.match.teamId)
  return team?.name ?? 'Équipe'
})

const versusLabel = computed<string>(() => {
  return `${homeTeamName.value} vs ${opponentLabel.value}`
})

const venueLabel = computed<string>(() => {
  const p = parent.value
  if (!p) return ''
  if (p.kind === 'home') {
    if (p.booking.venueName && p.booking.courtName) {
      return `${p.booking.venueName} · ${p.booking.courtName}`
    }
    return 'Salle non attribuée'
  }
  return p.match.awayAddress ?? 'Adresse à confirmer'
})

const matchTypeLabel = computed<string>(() => matchType.value?.name ?? '—')

// Récap envoyé au dialog confirm/decline.
const dialogMatchSummary = computed<CbAssignmentMatchSummary>(() => ({
  dateLabel: dateLabel.value,
  time: startTime.value,
  opponent: opponentLabel.value,
  venueLabel: venueLabel.value,
  type: matchTypeLabel.value,
}))

// ────────────────────────────────────────────────────────────────
// Grille des slots pour la card "Officiels"
// ────────────────────────────────────────────────────────────────

interface SlotFillView {
  assignmentId: string
  memberId: string
  name: string
  status: OfficialAssignment['status']
  you: boolean
}

interface SlotView {
  level: number
  requiredCount: number
  filled: SlotFillView[]
}

function nameForMemberId(memberId: string, you: boolean): string {
  if (you) return auth.displayName || 'Vous'
  // Pas de cache members générique côté officials → fallback sur memberId.
  // (Pas d'impact UX critique — la card officiels est secondaire vs CTA.)
  return memberId
}

function fillToView(filled: ReadonlyArray<OfficialAssignment>): SlotFillView[] {
  const myId = myMemberId.value
  return filled.map((a) => ({
    assignmentId: a.id,
    memberId: a.memberId,
    name: nameForMemberId(a.memberId, a.memberId === myId),
    status: a.status,
    you: a.memberId === myId,
  }))
}

const slotsView = computed<SlotView[]>(() => {
  if (kind.value === 'home') {
    return homeSlotsByLevel.value.map((s) => ({
      level: s.level,
      requiredCount: s.requiredCount,
      filled: fillToView(s.filled),
    }))
  }
  if (kind.value === 'away' && awaySlot.value) {
    return [
      {
        level: 0, // affiché "Officiels" sans niveau côté AWAY.
        requiredCount: awaySlot.value.requiredCount,
        filled: fillToView(awaySlot.value.filled),
      },
    ]
  }
  return []
})

function statusLabel(status: OfficialAssignment['status']): 'Confirmé' | 'Pending' | 'Décliné' {
  if (status === 'confirmed') return 'Confirmé'
  if (status === 'declined') return 'Décliné'
  return 'Pending'
}

function statusTone(status: OfficialAssignment['status']): 'emerald' | 'amber' | 'slate' {
  if (status === 'confirmed') return 'emerald'
  if (status === 'declined') return 'slate'
  return 'amber'
}

function levelTitle(level: number): string {
  if (level <= 0) return 'Officiels'
  return `Niveau ${level}`
}

// ────────────────────────────────────────────────────────────────
// Toast UI (pattern repris de LicenseRequestReview.vue)
// ────────────────────────────────────────────────────────────────

interface ToastState {
  tone: 'emerald' | 'rose' | 'sky'
  message: string
  visible: boolean
}

const toast = ref<ToastState>({ tone: 'sky', message: '', visible: false })

function showToast(tone: ToastState['tone'], message: string): void {
  toast.value = { tone, message, visible: true }
  window.setTimeout(() => {
    toast.value = { ...toast.value, visible: false }
  }, 3500)
}

// ────────────────────────────────────────────────────────────────
// Dialog confirm / decline
// ────────────────────────────────────────────────────────────────

const dialogOpen = ref(false)
const dialogMode = ref<'confirm' | 'decline'>('confirm')
const dialogSubmitting = ref(false)

function openConfirmDialog(): void {
  dialogMode.value = 'confirm'
  dialogOpen.value = true
}

function openDeclineDialog(): void {
  dialogMode.value = 'decline'
  dialogOpen.value = true
}

async function onDialogSubmit(reason?: string): Promise<void> {
  const p = parent.value
  if (!p) return
  const mine = myAssignment.value
  if (!mine) return
  dialogSubmitting.value = true
  try {
    await officialsStore.respond({
      kind: p.kind,
      parentId: p.kind === 'home' ? p.booking.id : p.match.id,
      assignmentId: mine.id,
      status: dialogMode.value === 'confirm' ? 'confirmed' : 'declined',
    })
    if (dialogMode.value === 'confirm') {
      showToast('emerald', 'Présence confirmée.')
    } else {
      // `reason` est UX-only — pas écrit en DB côté store/repo actuels.
      void reason
      showToast('rose', 'Assignation déclinée. L\'admin est notifié.')
    }
    dialogOpen.value = false
  } catch (err) {
    console.error('[match-detail] respond failed', err)
    showToast('rose', "Échec de l'action. Réessayez.")
  } finally {
    dialogSubmitting.value = false
  }
}

// ────────────────────────────────────────────────────────────────
// Actions auto-inscription / re-postuler
// ────────────────────────────────────────────────────────────────

const enrolling = ref(false)

async function actionEnroll(): Promise<void> {
  const p = parent.value
  if (!p) return
  const memberId = myMemberId.value
  const level = auth.officialLevel
  const uid = auth.uid
  if (!memberId || level == null || !uid) {
    showToast('rose', 'Profil incomplet. Contactez votre admin.')
    return
  }
  enrolling.value = true
  try {
    await officialsStore.selfRegister({
      kind: p.kind,
      parentId: p.kind === 'home' ? p.booking.id : p.match.id,
      memberId,
      officialLevel: level,
      byUid: uid,
    })
    showToast('emerald', "Inscription envoyée à l'admin.")
  } catch (err) {
    console.error('[match-detail] selfRegister failed', err)
    showToast('rose', "Échec de l'inscription. Réessayez.")
  } finally {
    enrolling.value = false
  }
}

async function actionReapply(): Promise<void> {
  // selfRegister utilise un ID déterministe = memberId côté serveur → écrase
  // proprement l'ancien doc `declined`. Même action que enroll.
  await actionEnroll()
}

function actionEnrollBlocked(): void {
  logMockAction('o3.enroll_blocked_no_license', { id: id.value })
}

function actionAddToCalendar(): void {
  // Pas de wiring serveur — log only, à brancher dans une future PR (.ics).
  logMockAction('o3.add_to_calendar', { id: id.value })
  showToast('sky', 'Ajout au calendrier indisponible pour l\'instant.')
}

function actionMore(): void {
  logMockAction('o3.kebab', { id: id.value })
}

function onBack(): void {
  if (window.history.length > 1) {
    router.back()
  } else {
    void router.push({ name: 'home' })
  }
}

function onNavSelect(i: number): void {
  if (i === 0) router.push({ name: 'home' })
  else if (i === 1) router.push({ name: 'matches-open' })
  else if (i === 2) router.push({ name: 'my-assignments' })
  else if (i === 3) router.push({ name: 'notifications' })
}
</script>

<template>
  <!-- ─── Loading skeleton ─────────────────────────────────────── -->
  <CbMobileShell
    v-if="loading && !parent"
    title="Détail match"
    show-back
    @back="onBack"
  >
    <div class="cb-page">
      <CbSkel :h="120" />
      <CbSkel :h="60" />
      <CbSkel :h="180" />
    </div>
  </CbMobileShell>

  <!-- ─── Match introuvable ───────────────────────────────────── -->
  <CbMobileShell
    v-else-if="!parent"
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
    v-else-if="!isDesktop"
    class="o3-mobile"
    title="Détail match"
    show-back
    @back="onBack"
  >
    <div class="cb-page">
      <div class="cb-card" style="padding: 16px">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px">
          <div>
            <div class="cb-h1" style="font-size: 22px">{{ dateLabel }}</div>
            <div
              class="mono"
              style="font-size: 18px; font-weight: 600; color: var(--slate-700); margin-top: 2px"
            >{{ startTime }}</div>
          </div>
          <CbPill tone="violet">{{ matchTypeLabel }}</CbPill>
        </div>
        <div style="margin-top: 10px; font-size: 16px; font-weight: 600">
          {{ homeTeamName }} <span style="color: var(--text-subtle); font-weight: 500">vs</span> {{ opponentLabel }}
        </div>
        <div class="cb-sub" style="margin-top: 8px; display: flex; gap: 6px; align-items: center">
          <MapPin :size="14" color="var(--slate-400)" />
          {{ venueLabel }}
        </div>
      </div>

      <div v-if="kind === 'home' && parent && parent.kind === 'home' && parent.booking.coachLabel">
        <div class="cb-section-label" style="padding: 0 0 6px">Équipe à domicile</div>
        <div class="cb-card" style="padding: 12px">
          <CbMemberRow
            :name="parent.booking.coachLabel"
            sub="Head coach"
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
            v-for="slot in slotsView"
            :key="`m-${slot.level}`"
            style="border-bottom: 1px solid var(--border); padding: 10px 0"
          >
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px">
              <div style="font-size: 13px; font-weight: 600">
                {{ levelTitle(slot.level) }}
                <span class="mono" style="color: var(--text-subtle); font-weight: 500">
                  · {{ slot.filled.filter((f) => f.status !== 'declined').length }}/{{ slot.requiredCount }}
                </span>
              </div>
              <CbPill
                v-if="slot.filled.filter((f) => f.status !== 'declined').length === slot.requiredCount"
                tone="emerald"
                dot
              >Complet</CbPill>
              <CbPill v-else tone="amber" dot>
                {{ slot.requiredCount - slot.filled.filter((f) => f.status !== 'declined').length }} à pourvoir
              </CbPill>
            </div>
            <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 6px">
              <div
                v-for="f in slot.filled"
                :key="`m-f-${slot.level}-${f.assignmentId}`"
                style="display: flex; align-items: center; gap: 8px"
              >
                <CbAvatar :name="f.name" size="xs" :tone="f.you ? 'emerald' : undefined" />
                <span :style="`font-size: 13px; font-weight: ${f.you ? 600 : 500}`">
                  {{ f.name }}<span v-if="f.you"> (vous)</span>
                </span>
                <CbPill :tone="statusTone(f.status)" dot>
                  {{ statusLabel(f.status) }}
                </CbPill>
              </div>
              <div
                v-for="empty in Math.max(
                  0,
                  slot.requiredCount - slot.filled.filter((f) => f.status !== 'declined').length,
                )"
                :key="`m-empty-${slot.level}-${empty}`"
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

      <CbBanner
        v-else-if="viewState === 'full'"
        tone="sky"
        title="Match complet"
      >
        <template #icon><Info :size="18" /></template>
        Tous les slots officiels disponibles à votre niveau ont déjà été pris.
      </CbBanner>
    </div>

    <CbBottomBar>
      <button
        v-if="viewState === 'open'"
        type="button"
        class="cb-btn primary block lg"
        :disabled="enrolling"
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
      <button
        v-if="viewState === 'full'"
        type="button"
        class="cb-btn block lg"
        disabled
      >
        Match complet
      </button>
      <template v-if="viewState === 'pending'">
        <button
          type="button"
          class="cb-btn outline"
          style="flex: 1"
          :disabled="dialogSubmitting"
          @click="openDeclineDialog"
        >
          <X :size="16" /> Décliner
        </button>
        <button
          type="button"
          class="cb-btn primary"
          style="flex: 2"
          :disabled="dialogSubmitting"
          @click="openConfirmDialog"
        >
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
        :disabled="enrolling"
        @click="actionReapply"
      >
        <RefreshCw :size="16" /> Re-postuler
      </button>
    </CbBottomBar>
  </CbMobileShell>

  <!-- ─── Desktop minimaliste ──────────────────────────────────── -->
  <CbDesktopShell
    v-else
    class="o3-desktop"
    :items="nav"
    brand-name="BC Aigles"
    brand-sub="Saison 2025/26"
    club-initials="BCA"
    :user-name="auth.displayName"
    :user-role="primaryRoleLabel"
    @nav-select="onNavSelect"
  >
    <CbPageHead
      title="Détail match"
      :subtitle="`${dateLabel} · ${startTime} · ${versusLabel}`"
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
              <div class="cb-h1" style="font-size: 22px">{{ dateLabel }}</div>
              <div
                class="mono"
                style="font-size: 18px; font-weight: 600; color: var(--slate-700); margin-top: 2px"
              >{{ startTime }}</div>
            </div>
            <CbPill tone="violet">{{ matchTypeLabel }}</CbPill>
          </div>
          <div style="margin-top: 10px; font-size: 16px; font-weight: 600">
            {{ homeTeamName }} <span style="color: var(--text-subtle); font-weight: 500">vs</span> {{ opponentLabel }}
          </div>
          <div class="cb-sub" style="margin-top: 8px; display: flex; gap: 6px; align-items: center">
            <MapPin :size="14" color="var(--slate-400)" />
            {{ venueLabel }}
          </div>
        </div>

        <div v-if="kind === 'home' && parent && parent.kind === 'home' && parent.booking.coachLabel">
          <div class="cb-section-label" style="padding: 0 0 6px">Équipe à domicile</div>
          <div class="cb-card" style="padding: 12px">
            <CbMemberRow
              :name="parent.booking.coachLabel"
              sub="Head coach"
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
              v-for="slot in slotsView"
              :key="`d-${slot.level}`"
              style="border-bottom: 1px solid var(--border); padding: 10px 0"
            >
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px">
                <div style="font-size: 13px; font-weight: 600">
                  {{ levelTitle(slot.level) }}
                  <span class="mono" style="color: var(--text-subtle); font-weight: 500">
                    · {{ slot.filled.filter((f) => f.status !== 'declined').length }}/{{ slot.requiredCount }}
                  </span>
                </div>
                <CbPill
                  v-if="slot.filled.filter((f) => f.status !== 'declined').length === slot.requiredCount"
                  tone="emerald"
                  dot
                >Complet</CbPill>
                <CbPill v-else tone="amber" dot>
                  {{ slot.requiredCount - slot.filled.filter((f) => f.status !== 'declined').length }} à pourvoir
                </CbPill>
              </div>
              <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 6px">
                <div
                  v-for="f in slot.filled"
                  :key="`d-f-${slot.level}-${f.assignmentId}`"
                  style="display: flex; align-items: center; gap: 8px"
                >
                  <CbAvatar :name="f.name" size="xs" :tone="f.you ? 'emerald' : undefined" />
                  <span :style="`font-size: 13px; font-weight: ${f.you ? 600 : 500}`">
                    {{ f.name }}<span v-if="f.you"> (vous)</span>
                  </span>
                  <CbPill :tone="statusTone(f.status)" dot>
                    {{ statusLabel(f.status) }}
                  </CbPill>
                </div>
                <div
                  v-for="empty in Math.max(
                    0,
                    slot.requiredCount - slot.filled.filter((f) => f.status !== 'declined').length,
                  )"
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

        <CbBanner
          v-else-if="viewState === 'full'"
          tone="sky"
          title="Match complet"
        >
          <template #icon><Info :size="18" /></template>
          Tous les slots officiels disponibles à votre niveau ont déjà été pris.
        </CbBanner>

        <!-- CTAs desktop : repris du BottomBar mobile pour parité d'usage. -->
        <div class="o3-desktop-cta">
          <button
            v-if="viewState === 'open'"
            type="button"
            class="cb-btn primary lg"
            :disabled="enrolling"
            @click="actionEnroll"
          >
            <Check :size="16" /> Je m'inscris
          </button>
          <button
            v-else-if="viewState === 'nolicense'"
            type="button"
            class="cb-btn lg"
            disabled
            @click="actionEnrollBlocked"
          >
            Je m'inscris (bloqué)
          </button>
          <button
            v-else-if="viewState === 'full'"
            type="button"
            class="cb-btn lg"
            disabled
          >
            Match complet
          </button>
          <template v-else-if="viewState === 'pending'">
            <button
              type="button"
              class="cb-btn outline"
              :disabled="dialogSubmitting"
              @click="openDeclineDialog"
            >
              <X :size="16" /> Décliner
            </button>
            <button
              type="button"
              class="cb-btn primary"
              :disabled="dialogSubmitting"
              @click="openConfirmDialog"
            >
              <Check :size="16" /> Confirmer ma présence
            </button>
          </template>
          <template v-else-if="viewState === 'confirmed'">
            <button type="button" class="cb-btn outline" @click="actionMore">
              <MoreVertical :size="16" />
            </button>
            <button type="button" class="cb-btn primary" @click="actionAddToCalendar">
              <CalendarPlus :size="16" /> Ajouter au calendrier
            </button>
          </template>
          <button
            v-else-if="viewState === 'declined'"
            type="button"
            class="cb-btn primary lg"
            :disabled="enrolling"
            @click="actionReapply"
          >
            <RefreshCw :size="16" /> Re-postuler
          </button>
        </div>
      </div>
    </div>
  </CbDesktopShell>

  <!-- ─── Dialog confirm / decline (Teleport interne) ─────────── -->
  <CbAssignmentActionDialog
    v-model:visible="dialogOpen"
    :mode="dialogMode"
    :match-summary="dialogMatchSummary"
    :submitting="dialogSubmitting"
    @submit="onDialogSubmit"
  />

  <!-- ─── Toast UX ─────────────────────────────────────────────── -->
  <Teleport to="body">
    <Transition name="cb-toast">
      <div
        v-if="toast.visible"
        class="cb-md-toast"
        :class="`tone-${toast.tone}`"
        role="status"
      >
        <component
          :is="toast.tone === 'rose' ? AlertTriangle : toast.tone === 'sky' ? Info : Check"
          :size="16"
        />
        <span>{{ toast.message }}</span>
      </div>
    </Transition>
  </Teleport>
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
.o3-desktop-cta {
  display: flex;
  gap: 8px;
  padding-top: 4px;
}

/* Toast UX (aligné sur le pattern de LicenseRequestReview). */
.cb-md-toast {
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
  z-index: 1100;
  max-width: calc(100vw - 32px);
}
.cb-md-toast.tone-emerald {
  background: var(--emerald-500, #10b981);
  color: #fff;
}
.cb-md-toast.tone-rose {
  background: var(--rose-500, #f43f5e);
  color: #fff;
}
.cb-md-toast.tone-sky {
  background: var(--sky-500, #0ea5e9);
  color: #fff;
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
