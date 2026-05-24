<script setup lang="ts">
/**
 * OfficialAssignmentsList — Tab "Liste" de la vue `MyAssignments` (officiel).
 *
 * Trois sections empilées verticalement :
 *  1. **URGENT** — opportunités à mon niveau dans les 3 prochains jours
 *     (cards à bordure rouge épaisse). Visible uniquement si non-vide.
 *  2. **Mes assignations à venir** — pending + confirmed (declined exclu).
 *  3. **Matchs à pourvoir cette semaine** — opportunités à mon niveau dans
 *     les 7 prochains jours, hors section URGENT et hors `parentId` où je
 *     suis déjà assigné (tous status confondus, dédoublonnage par
 *     `kind:parentId`).
 *
 * Composant **contenu pur** : pas de shell, pas de header, pas de tab bar
 * — le parent (`MyAssignments.vue` ou autre) fournit le shell et déclenche
 * les `loadXxx` au mount. Toutes les sources viennent de `useOfficialsStore`.
 *
 * Emit `select` avec `{ parentId, kind }` quand une card est cliquée : le
 * parent gère la navigation (généralement `match-detail`).
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCircle2,
  Info,
  Repeat,
  X as XIcon,
} from 'lucide-vue-next'

import { Timestamp as FsTimestamp } from 'firebase/firestore'

import CbAssignmentActionDialog, {
  type CbAssignmentMatchSummary,
} from '@/components/dialogs/CbAssignmentActionDialog.vue'
import CbEmptyState from '@/components/ui/CbEmptyState.vue'
import CbPill from '@/components/ui/CbPill.vue'
import CbSectionHeader from '@/components/ui/CbSectionHeader.vue'
import CbUpcomingMatchCard from '@/components/ui/CbUpcomingMatchCard.vue'
import { useAuthStore } from '@/stores/auth'
import { useBookingsStore } from '@/stores/bookings'
import {
  useOfficialsStore,
  type MyAssignmentEntry,
  type OpportunityEntry,
} from '@/stores/officials'
import { useTeamsStore } from '@/stores/teams'
import type { MockTeam } from '@/types/mock'
import type { Match, MatchType, OfficialAssignment, Timestamp } from '@club-app/shared-types'

// ─── Emits ───────────────────────────────────────────────────────────

const emit = defineEmits<{
  (e: 'select', payload: { parentId: string; kind: 'home' | 'away' }): void
  (e: 'request-replacement', entry: MyAssignmentEntry): void
}>()

// ─── Stores ──────────────────────────────────────────────────────────

const officialsStore = useOfficialsStore()
const auth = useAuthStore()
const bookingsStore = useBookingsStore()
const teamsStore = useTeamsStore()

const officialLevel = computed<number>(() => auth.officialLevel ?? 1)

// ─── "Now" stable durant le rendu, rafraîchi périodiquement ──────────
// Lire `Date.now()` dans chaque computed donnerait des résultats inconsistants
// entre `urgentOpportunities` et `weekOpportunities` (les sets de dédoublonnage
// pourraient diverger). On ancre `now` sur une ref rafraîchie toutes les 60s.

const now = ref(Date.now())
let nowInterval: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  nowInterval = setInterval(() => {
    now.value = Date.now()
  }, 60_000)
})

onBeforeUnmount(() => {
  if (nowInterval !== null) {
    clearInterval(nowInterval)
    nowInterval = null
  }
})

// ─── Helpers temporels ──────────────────────────────────────────────

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

function tsToMs(
  ts: { seconds?: number; toMillis?: () => number } | null | undefined,
): number {
  if (!ts) return 0
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (typeof ts.seconds === 'number') return ts.seconds * 1000
  return 0
}

function entryStartMs(e: MyAssignmentEntry): number {
  return e.parent.kind === 'home'
    ? e.parent.booking.startMs
    : tsToMs(e.parent.match.date)
}

function opportunityStartMs(o: OpportunityEntry): number {
  return tsToMs(o.date)
}

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

// ─── Sources ────────────────────────────────────────────────────────

/** Mes assignations futures non-declined, triées date ASC. */
const myUpcoming = computed<ReadonlyArray<MyAssignmentEntry>>(() => {
  const cutoff = now.value
  return [
    ...officialsStore.myAssignments.pending,
    ...officialsStore.myAssignments.confirmed,
  ]
    .filter((e) => entryStartMs(e) >= cutoff)
    .sort((a, b) => entryStartMs(a) - entryStartMs(b))
})

/** Toutes les opportunités ouvertes au niveau du caller (futures). */
const allOpportunities = computed<ReadonlyArray<OpportunityEntry>>(() =>
  officialsStore.openOpportunitiesForLevel(officialLevel.value),
)

/**
 * Index des `kind:parentId` où je suis déjà assigné (pending / confirmed /
 * declined). Sert à exclure les opportunités déjà engagées (même un decline
 * doit cacher le match — ne pas le reproposer dans "à pourvoir").
 */
const myParentIds = computed<Set<string>>(() => {
  const set = new Set<string>()
  const lists: ReadonlyArray<ReadonlyArray<MyAssignmentEntry>> = [
    officialsStore.myAssignments.pending,
    officialsStore.myAssignments.confirmed,
    officialsStore.myAssignments.declined,
  ]
  for (const list of lists) {
    for (const e of list) {
      const id =
        e.parent.kind === 'home' ? e.parent.booking.id : e.parent.match.id
      set.add(`${e.parent.kind}:${id}`)
    }
  }
  return set
})

/** Opportunités URGENT : à mon niveau, dans les 3 prochains jours, non engagées. */
const urgentOpportunities = computed<ReadonlyArray<OpportunityEntry>>(() => {
  const start = now.value
  const cutoff = start + THREE_DAYS_MS
  return allOpportunities.value
    .filter((o) => {
      const ms = opportunityStartMs(o)
      if (ms < start || ms > cutoff) return false
      return !myParentIds.value.has(`${o.kind}:${o.parentId}`)
    })
    .slice()
    .sort((a, b) => opportunityStartMs(a) - opportunityStartMs(b))
})

/** Opportunités semaine : 7 jours, hors URGENT, hors mes engagements. */
const weekOpportunities = computed<ReadonlyArray<OpportunityEntry>>(() => {
  const urgentSet = new Set(
    urgentOpportunities.value.map((o) => `${o.kind}:${o.parentId}`),
  )
  const start = now.value
  const cutoff = start + SEVEN_DAYS_MS
  return allOpportunities.value
    .filter((o) => {
      const ms = opportunityStartMs(o)
      if (ms < start || ms > cutoff) return false
      const key = `${o.kind}:${o.parentId}`
      if (urgentSet.has(key)) return false
      if (myParentIds.value.has(key)) return false
      return true
    })
    .slice()
    .sort((a, b) => opportunityStartMs(a) - opportunityStartMs(b))
})

// ─── Prochains matchs (5) ───────────────────────────────────────────
//
// Liste forward-looking de TOUS les prochains matchs du club (HOME +
// AWAY), staffés ou non, indépendamment de mon engagement. Donne à
// l'officiel un aperçu du calendrier proche. Même règle produit que
// `OpenMatches.allFutureMatches` : on exclut les matchs sans adversaire
// confirmé.

const NEXT_MATCHES_LIMIT = 5

/** Récupère les initiales (max 2 lettres) d'un memberId — cohérent avec OpenMatches. */
function initialsFromMemberId(memberId: string): string {
  return (
    memberId
      .replace(/^m-/, '')
      .split('-')
      .map((p) => p.charAt(0).toUpperCase())
      .join('')
      .slice(0, 2) || '??'
  )
}

function officialsInitialsFor(
  assigns: ReadonlyArray<OfficialAssignment> | undefined,
): string[] {
  if (!assigns) return []
  return assigns
    .filter((a) => a.status !== 'declined')
    .map((a) => initialsFromMemberId(a.memberId))
}

interface UpcomingMatchVM {
  key: string
  kind: 'home' | 'away'
  parentId: string
  date: Timestamp
  startTime: string
  matchType: string
  teamName: string
  opponent: string
  venue: string
  away: boolean
  officials: string[]
  staffing: { filled: number; total: number; complete: boolean }
}

const allUpcomingMatches = computed<ReadonlyArray<UpcomingMatchVM>>(() => {
  const cutoff = now.value
  const teamById = new Map<string, MockTeam>()
  for (const t of teamsStore.teams) teamById.set(t.id, t)

  const items: UpcomingMatchVM[] = []

  // HOME — bookings `match_home` futurs avec adversaire confirmé.
  for (const booking of bookingsStore.allBookings) {
    if (booking.slotType !== 'match_home') continue
    if (booking.startMs < cutoff) continue
    if (!booking.opponentName || booking.opponentName.trim() === '') continue
    const mt: MatchType | null = booking.matchTypeId
      ? (officialsStore.matchTypesById.get(booking.matchTypeId) ?? null)
      : null
    const assigns = officialsStore.homeAssignmentsByBookingId.get(booking.id) ?? []
    const requirements = mt?.homeOfficialRequirements ?? []
    const total = requirements.reduce((s, r) => s + r.count, 0)
    const taken = assigns.filter((a) => a.status !== 'declined').length
    const filled = Math.max(0, Math.min(taken, total))
    const venue =
      booking.venueName && booking.courtName
        ? `${booking.venueName} · ${booking.courtName}`
        : 'Salle non attribuée'
    const team = booking.teamId ? (teamById.get(booking.teamId) ?? null) : null
    const teamName = booking.teamName ?? team?.name ?? 'Mon équipe'
    items.push({
      key: `home-${booking.id}`,
      kind: 'home',
      parentId: booking.id,
      date: FsTimestamp.fromMillis(booking.startMs),
      startTime: booking.startTime,
      matchType: mt?.name ?? '—',
      teamName,
      opponent: booking.opponentName,
      venue,
      away: false,
      officials: officialsInitialsFor(assigns),
      staffing: { filled, total, complete: total > 0 && filled >= total },
    })
  }

  // AWAY — matchs `kind: 'away'` futurs avec adversaire confirmé.
  for (const match of officialsStore.awayMatches as ReadonlyArray<Match>) {
    const ms = tsToMs(match.date)
    if (ms < cutoff) continue
    if (!match.opponentName || match.opponentName.trim() === '') continue
    const mt: MatchType | null =
      officialsStore.matchTypesById.get(match.matchTypeId) ?? null
    const assigns = officialsStore.awayAssignmentsByMatchId.get(match.id) ?? []
    const total = mt?.awayOfficialCount ?? 0
    const taken = assigns.filter((a) => a.status !== 'declined').length
    const filled = Math.max(0, Math.min(taken, total))
    const team = teamById.get(match.teamId) ?? null
    items.push({
      key: `away-${match.id}`,
      kind: 'away',
      parentId: match.id,
      date: match.date,
      startTime: match.startTime,
      matchType: mt?.name ?? '—',
      teamName: team?.name ?? 'Mon équipe',
      opponent: match.opponentName,
      venue: match.awayAddress ?? 'Adresse à confirmer',
      away: true,
      officials: officialsInitialsFor(assigns),
      staffing: { filled, total, complete: total > 0 && filled >= total },
    })
  }

  items.sort((a, b) => tsToMs(a.date) - tsToMs(b.date))
  return items
})

const nextFiveMatches = computed<ReadonlyArray<UpcomingMatchVM>>(() =>
  allUpcomingMatches.value.slice(0, NEXT_MATCHES_LIMIT),
)

function upcomingDateLabel(item: UpcomingMatchVM): string {
  return fmtDate(tsToMs(item.date))
}

function selectUpcoming(item: UpcomingMatchVM): void {
  emit('select', { parentId: item.parentId, kind: item.kind })
}

// ─── Labels — MyAssignmentEntry ─────────────────────────────────────

function asgDate(e: MyAssignmentEntry): string {
  return fmtDate(entryStartMs(e))
}
function asgTime(e: MyAssignmentEntry): string {
  return e.parent.kind === 'home'
    ? e.parent.booking.startTime
    : e.parent.match.startTime
}
function asgOpponent(e: MyAssignmentEntry): string {
  const raw =
    e.parent.kind === 'home'
      ? e.parent.booking.opponentName
      : e.parent.match.opponentName
  return raw ?? 'Adversaire à confirmer'
}
function asgVenue(e: MyAssignmentEntry): string {
  if (e.parent.kind === 'home') {
    const b = e.parent.booking
    if (b.venueName && b.courtName) return `${b.venueName} · ${b.courtName}`
    return 'Salle non attribuée'
  }
  return e.parent.match.awayAddress ?? 'Adresse à confirmer'
}
function asgTeam(e: MyAssignmentEntry): string {
  return e.team?.name ?? ''
}
function asgMatchType(e: MyAssignmentEntry): string {
  return e.matchType?.name ?? '—'
}
function asgParentId(e: MyAssignmentEntry): string {
  return e.parent.kind === 'home' ? e.parent.booking.id : e.parent.match.id
}

// ─── Labels — OpportunityEntry ──────────────────────────────────────

function oppDate(o: OpportunityEntry): string {
  return fmtDate(opportunityStartMs(o))
}
function oppTime(o: OpportunityEntry): string {
  return o.startTime
}
function oppOpponent(o: OpportunityEntry): string {
  return o.opponentName ?? 'Adversaire à confirmer'
}
function oppVenue(o: OpportunityEntry): string {
  return o.location ?? (o.kind === 'home' ? 'Salle non attribuée' : 'Adresse à confirmer')
}
function oppTeam(o: OpportunityEntry): string {
  return o.team?.name ?? ''
}
function oppMatchType(o: OpportunityEntry): string {
  return o.matchType?.name ?? '—'
}
function oppLevelLabel(o: OpportunityEntry): string {
  // HOME : on connaît le niveau requis (= officialLevel du caller, par
  // construction de openOpportunitiesForLevel). AWAY : pas de niveau côté
  // requirements, on rend un libellé neutre.
  return o.kind === 'home' ? `Niveau ${officialLevel.value}` : 'Tous niveaux'
}
function oppSlotsLabel(o: OpportunityEntry): string {
  return o.openSlots > 1 ? `${o.openSlots} slots manquants` : '1 slot manquant'
}

// ─── Click handlers ─────────────────────────────────────────────────

function selectAssignment(e: MyAssignmentEntry): void {
  emit('select', { parentId: asgParentId(e), kind: e.parent.kind })
}

function selectOpportunity(o: OpportunityEntry): void {
  emit('select', { parentId: o.parentId, kind: o.kind })
}

// ─── Actions Section 2 (accept / decline / request-replacement) ─────

const submittingId = ref<string | null>(null)
const declineDialogOpen = ref(false)
const declineTarget = ref<MyAssignmentEntry | null>(null)

interface ToastState {
  tone: 'emerald' | 'rose' | 'sky'
  message: string
  visible: boolean
}

const toast = ref<ToastState>({ tone: 'sky', message: '', visible: false })
let toastTimer: ReturnType<typeof setTimeout> | null = null

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

/** Récap match passé au dialog (mode decline). */
function matchSummaryFor(e: MyAssignmentEntry): CbAssignmentMatchSummary {
  return {
    dateLabel: asgDate(e),
    time: asgTime(e),
    opponent: asgOpponent(e),
    venueLabel: asgVenue(e),
    type: e.matchType?.name ?? '—',
  }
}

async function onAccept(e: MyAssignmentEntry): Promise<void> {
  if (submittingId.value !== null) return
  submittingId.value = e.assignment.id
  try {
    await officialsStore.respond({
      kind: e.parent.kind,
      parentId: asgParentId(e),
      assignmentId: e.assignment.id,
      status: 'confirmed',
    })
    showToast('emerald', 'Présence confirmée')
  } catch (err) {
    console.error('[OfficialAssignmentsList.accept] failed', err)
    showToast('rose', 'Échec de la confirmation. Réessayez.')
  } finally {
    submittingId.value = null
  }
}

function openDecline(e: MyAssignmentEntry): void {
  declineTarget.value = e
  declineDialogOpen.value = true
}

async function onDeclineSubmit(reason?: string): Promise<void> {
  const target = declineTarget.value
  if (!target) return
  if (submittingId.value !== null) return
  submittingId.value = target.assignment.id
  try {
    // Le callable n'accepte pas encore le motif — on le log seulement.
    console.info('[OfficialAssignmentsList.decline] reason:', reason ?? '(none)')
    await officialsStore.respond({
      kind: target.parent.kind,
      parentId: asgParentId(target),
      assignmentId: target.assignment.id,
      status: 'declined',
    })
    declineDialogOpen.value = false
    declineTarget.value = null
    showToast('sky', 'Refus enregistré, admin notifié')
  } catch (err) {
    console.error('[OfficialAssignmentsList.decline] failed', err)
    showToast('rose', 'Échec du refus. Réessayez.')
  } finally {
    submittingId.value = null
  }
}

function onDeclineCancel(): void {
  declineDialogOpen.value = false
  declineTarget.value = null
}

function onRequestReplacement(e: MyAssignmentEntry): void {
  // Le parent gère l'ouverture du dialog (Phase 2). Ici on remonte juste l'entry.
  emit('request-replacement', e)
}
</script>

<template>
  <div class="oa-root">
    <!-- ─── SECTION 1 — URGENT ──────────────────────────────────── -->
    <section v-if="urgentOpportunities.length > 0" class="oa-urgent-section">
      <div class="oa-urgent-header">
        <AlertTriangle :size="16" class="oa-urgent-icon" />
        <h2 class="oa-urgent-title">URGENT — Officiels manquants</h2>
      </div>
      <div class="oa-cards">
        <button
          v-for="o in urgentOpportunities"
          :key="`urg-${o.kind}-${o.parentId}`"
          type="button"
          class="cb-card oa-card oa-urgent-card"
          @click="selectOpportunity(o)"
        >
          <div class="oa-card-row">
            <div class="oa-card-main">
              <div class="oa-card-when mono">
                {{ oppDate(o) }} · {{ oppTime(o) }}
              </div>
              <div class="oa-card-opp">vs {{ oppOpponent(o) }}</div>
              <div v-if="oppTeam(o)" class="cb-sub oa-card-team">
                {{ oppTeam(o) }}
              </div>
              <div class="cb-sub oa-card-venue">{{ oppVenue(o) }}</div>
            </div>
            <div class="oa-card-pills">
              <CbPill tone="rose" solid>{{ oppSlotsLabel(o) }}</CbPill>
              <CbPill tone="violet">{{ oppMatchType(o) }}</CbPill>
              <CbPill tone="slate">{{ oppLevelLabel(o) }}</CbPill>
            </div>
          </div>
        </button>
      </div>
    </section>

    <!-- ─── SECTION 2 — Mes assignations à venir ─────────────────── -->
    <section class="oa-section">
      <CbSectionHeader title="Mes assignations à venir" />
      <CbEmptyState
        v-if="myUpcoming.length === 0"
        :icon="CalendarDays"
        title="Aucune assignation à venir"
        body="Inscrivez-vous sur un match à pourvoir pour commencer."
      />
      <div v-else class="oa-cards">
        <div
          v-for="e in myUpcoming"
          :key="`asg-${e.assignment.id}`"
          role="button"
          tabindex="0"
          class="cb-card oa-card"
          @click="selectAssignment(e)"
          @keydown.enter.prevent="selectAssignment(e)"
          @keydown.space.prevent="selectAssignment(e)"
        >
          <div class="oa-card-row">
            <div class="oa-card-main">
              <div class="oa-card-when mono">
                {{ asgDate(e) }} · {{ asgTime(e) }}
              </div>
              <div class="oa-card-opp">vs {{ asgOpponent(e) }}</div>
              <div v-if="asgTeam(e)" class="cb-sub oa-card-team">
                {{ asgTeam(e) }}
              </div>
              <div class="cb-sub oa-card-venue">{{ asgVenue(e) }}</div>
            </div>
            <div class="oa-card-pills">
              <CbPill
                :tone="e.assignment.status === 'pending' ? 'amber' : 'emerald'"
                dot
              >
                {{ e.assignment.status === 'pending' ? 'En attente' : 'Confirmé' }}
              </CbPill>
              <CbPill
                :tone="e.parent.kind === 'home' ? 'emerald' : 'sky'"
                solid
              >
                {{ e.parent.kind === 'home' ? 'Domicile' : 'Extérieur' }}
              </CbPill>
              <CbPill tone="violet">{{ asgMatchType(e) }}</CbPill>
            </div>
          </div>

          <!-- Actions inline (status === 'pending') ─────────────── -->
          <div
            v-if="e.assignment.status === 'pending'"
            class="oa-card-actions"
            @click.stop
          >
            <button
              type="button"
              class="cb-btn outline danger sm"
              :disabled="submittingId === e.assignment.id"
              @click.stop="openDecline(e)"
            >
              <XIcon :size="14" />
              Décliner
            </button>
            <button
              type="button"
              class="cb-btn primary sm"
              :disabled="submittingId === e.assignment.id"
              @click.stop="onAccept(e)"
            >
              <Check :size="14" />
              Accepter
            </button>
          </div>

          <!-- Actions inline (status === 'confirmed') ───────────── -->
          <div
            v-else-if="e.assignment.status === 'confirmed'"
            class="oa-card-actions"
            @click.stop
          >
            <button
              type="button"
              class="cb-btn ghost sm"
              :disabled="submittingId === e.assignment.id"
              @click.stop="onRequestReplacement(e)"
            >
              <Repeat :size="14" />
              Demander un remplacement
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- ─── SECTION 3 — Matchs à pourvoir cette semaine ───────────── -->
    <section class="oa-section">
      <CbSectionHeader title="Matchs à pourvoir cette semaine" />
      <p v-if="weekOpportunities.length === 0" class="oa-inline-empty">
        Aucun match à pourvoir cette semaine.
      </p>
      <div v-else class="oa-cards">
        <button
          v-for="o in weekOpportunities"
          :key="`wk-${o.kind}-${o.parentId}`"
          type="button"
          class="cb-card oa-card"
          @click="selectOpportunity(o)"
        >
          <div class="oa-card-row">
            <div class="oa-card-main">
              <div class="oa-card-when mono">
                {{ oppDate(o) }} · {{ oppTime(o) }}
              </div>
              <div class="oa-card-opp">vs {{ oppOpponent(o) }}</div>
              <div v-if="oppTeam(o)" class="cb-sub oa-card-team">
                {{ oppTeam(o) }}
              </div>
              <div class="cb-sub oa-card-venue">{{ oppVenue(o) }}</div>
            </div>
            <div class="oa-card-pills">
              <CbPill tone="rose" dot>{{ oppSlotsLabel(o) }}</CbPill>
              <CbPill tone="violet">{{ oppLevelLabel(o) }}</CbPill>
              <CbPill tone="slate">{{ oppMatchType(o) }}</CbPill>
            </div>
          </div>
        </button>
      </div>
    </section>

    <!-- ─── SECTION 4 — Prochains matchs ─────────────────────────── -->
    <section class="oa-section">
      <CbSectionHeader title="Prochains matchs" />
      <p v-if="nextFiveMatches.length === 0" class="oa-inline-empty">
        Aucun match à venir dans le calendrier du club.
      </p>
      <div v-else class="oa-cards">
        <CbUpcomingMatchCard
          v-for="item in nextFiveMatches"
          :key="item.key"
          :date="upcomingDateLabel(item)"
          :time="item.startTime"
          :match-type="item.matchType"
          :team-name="item.teamName"
          :opponent="item.opponent"
          :away="item.away"
          :venue="item.venue"
          :officials="item.officials"
          :staffing="item.staffing"
          @click="selectUpcoming(item)"
        />
      </div>
    </section>

    <!-- Dialog Décliner (mode decline) ──────────────────────────── -->
    <CbAssignmentActionDialog
      v-if="declineTarget"
      v-model:visible="declineDialogOpen"
      mode="decline"
      :match-summary="matchSummaryFor(declineTarget)"
      :submitting="submittingId === declineTarget.assignment.id"
      @submit="onDeclineSubmit"
      @cancel="onDeclineCancel"
    />

    <!-- Toast UX ─────────────────────────────────────────────────── -->
    <Teleport to="body">
      <Transition name="cb-toast">
        <div
          v-if="toast.visible"
          class="oa-toast"
          :class="`tone-${toast.tone}`"
          role="status"
        >
          <component
            :is="toast.tone === 'rose' ? AlertTriangle : toast.tone === 'sky' ? Info : CheckCircle2"
            :size="16"
          />
          <span>{{ toast.message }}</span>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.oa-root {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 4px 0;
}

/* ─── Sections ────────────────────────────────────────────────── */

.oa-section {
  display: flex;
  flex-direction: column;
}

.oa-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Section URGENT : encadré rouge léger pour bien la séparer ─── */
.oa-urgent-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px 14px;
  border-radius: 12px;
  border: 1px solid var(--rose-200, #fecdd3);
  background: rgba(244, 63, 94, 0.04);
}
.oa-urgent-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 2px 4px;
}
.oa-urgent-icon {
  color: var(--rose-600, #e11d48);
}
.oa-urgent-title {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--rose-700, #be123c);
}

/* ─── Cards ──────────────────────────────────────────────────── */

.oa-card {
  display: block;
  width: 100%;
  padding: 12px;
  text-align: left;
  font-family: inherit;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--card-bg, #fff);
}
.oa-card:hover {
  transform: translateY(-1px);
  transition: transform 120ms ease;
}

.oa-urgent-card {
  border: 2px solid var(--rose-500, #f43f5e);
  background: var(--rose-50, #fff1f2);
  box-shadow: 0 4px 14px rgba(244, 63, 94, 0.18);
}

.oa-card-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}
.oa-card-main {
  flex: 1;
  min-width: 0;
}
.oa-card-pills {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-end;
  flex-shrink: 0;
}

.oa-card-when {
  font-weight: 700;
  font-size: 13px;
}
.oa-card-opp {
  font-weight: 600;
  margin-top: 2px;
}
.oa-card-team {
  margin-top: 2px;
}
.oa-card-venue {
  margin-top: 2px;
}

/* ─── Inline empty (section 3) ───────────────────────────────── */

.oa-inline-empty {
  margin: 6px 4px 0;
  font-size: 13px;
  color: var(--text-subtle);
}

/* ─── Inline actions (Section 2) ─────────────────────────────── */

.oa-card-actions {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border, rgba(15, 23, 42, 0.08));
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}
.oa-card-actions .cb-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* ─── Toast UX ───────────────────────────────────────────────── */

.oa-toast {
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
  color: #fff;
}
.oa-toast.tone-emerald {
  background: var(--emerald-500, #10b981);
}
.oa-toast.tone-rose {
  background: var(--rose-500, #f43f5e);
}
.oa-toast.tone-sky {
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
