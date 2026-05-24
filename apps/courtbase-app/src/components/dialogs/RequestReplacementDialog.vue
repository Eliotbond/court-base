<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { AlertTriangle, CheckCircle2, Search, UserX, X } from 'lucide-vue-next'

import CbAvatar from '@/components/ui/CbAvatar.vue'
import CbBanner from '@/components/ui/CbBanner.vue'
import CbBottomBar from '@/components/ui/CbBottomBar.vue'
import CbPill from '@/components/ui/CbPill.vue'

import { useAuthStore } from '@/stores/auth'
import { useBookingsStore } from '@/stores/bookings'
import { useOfficialsStore, type MyAssignmentEntry } from '@/stores/officials'
import { useReplacementsStore } from '@/stores/replacements'
import {
  listClubOfficials,
  type OfficialLite,
} from '@/repositories/members.repo'
import type { CreateReplacementRequestInput } from '@/repositories/replacements.repo'
import { useActiveSeason } from '@/composables/useSeason'
import {
  detectConflicts,
  type ConflictBookingSource,
  type ConflictInfo,
} from '@/utils/officialConflicts'

/**
 * Dialog côté demandeur — "Demander un remplacement".
 *
 * Un officiel `confirmed` sur un match déclenche ce dialog depuis sa liste
 * `MyAssignments` (vue O3) → choisit un autre officiel du club, voit ses
 * conflits éventuels (calculés JS-side, pas de I/O bloquante), et envoie
 * la demande via `useReplacementsStore().createRequest`.
 *
 * Pattern Teleport + fullscreen mobile / 520px desktop calqué sur
 * `CbAssignmentActionDialog.vue` (cf. brief § S9). Pas de toast direct ici :
 * on émet `submitted` après succès, le parent toaste + refresh.
 */

const props = defineProps<{
  visible: boolean
  /** Assignation d'origine sur laquelle on demande un remplacement. */
  entry: MyAssignmentEntry
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  /** Émis après création réussie (le parent toaste + refresh). */
  submitted: []
}>()

// ─── Dépendances stores ──────────────────────────────────────────────

const auth = useAuthStore()
const bookingsStore = useBookingsStore()
const officialsStore = useOfficialsStore()
const replacementsStore = useReplacementsStore()
const activeSeason = useActiveSeason()

// ─── State local ──────────────────────────────────────────────────────

const officials = ref<OfficialLite[]>([])
const loadingOfficials = ref(false)
const officialsError = ref<string | null>(null)
const selectedTargetId = ref<string | null>(null)
const message = ref('')
const submitting = ref(false)
const submitError = ref<string | null>(null)
const search = ref('')

const MESSAGE_MAX = 280

// ─── Identité demandeur (garde "profil incomplet") ──────────────────

const requesterMemberId = computed<string | null>(() => {
  const id = auth.userDoc?.memberId
  return typeof id === 'string' && id.length > 0 ? id : null
})

const profileIncomplete = computed<boolean>(() => !requesterMemberId.value)

// ─── Fenêtre temporelle de l'assignation d'origine ───────────────────

/**
 * Convertit `Timestamp.seconds` + `"HH:mm"` en epoch ms local. Toléant aux
 * `HH:mm` malformés (fallback 00:00).
 */
function tsAndTimeToMs(secondsValue: number, hhmm: string): number {
  const baseMs = secondsValue * 1000
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!m) return baseMs
  const hours = Number(m[1])
  const minutes = Number(m[2])
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return baseMs
  return baseMs + hours * 60 * 60 * 1000 + minutes * 60 * 1000
}

/** Récap : date + heure(s) + lieu + adversaire + niveau. */
const entryRecap = computed(() => {
  const e = props.entry
  if (e.parent.kind === 'home') {
    const b = e.parent.booking
    const dateLabel = formatDateLabel(new Date(b.startMs))
    const venueLabel =
      b.venueName && b.courtName
        ? `${b.venueName} · ${b.courtName}`
        : 'Salle non attribuée'
    return {
      dateLabel,
      timeLabel: `${b.startTime}–${b.endTime}`,
      opponent: b.opponentName ?? '—',
      venue: venueLabel,
      matchTypeName: e.matchType?.name ?? '—',
      teamName: e.team?.name ?? b.teamName ?? null,
      startMs: b.startMs,
      endMs: b.endMs,
      startTime: b.startTime,
      endTime: b.endTime,
      matchDateMs: b.startMs,
      parentId: b.id,
    }
  }
  const m = e.parent.match
  const startMs = tsAndTimeToMs(m.date.seconds, m.startTime)
  const endMs = tsAndTimeToMs(m.date.seconds, m.endTime)
  const dateLabel = formatDateLabel(new Date(startMs))
  return {
    dateLabel,
    timeLabel: `${m.startTime}–${m.endTime}`,
    opponent: m.opponentName ?? '—',
    venue: m.awayAddress ?? '—',
    matchTypeName: e.matchType?.name ?? '—',
    teamName: e.team?.name ?? null,
    startMs,
    endMs,
    startTime: m.startTime,
    endTime: m.endTime,
    matchDateMs: m.date.seconds * 1000,
    parentId: m.id,
  }
})

function formatDateLabel(d: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(d)
}

// ─── Sources pour `detectConflicts` (memoizées) ──────────────────────

/**
 * Map `BookingRow` → `ConflictBookingSource`. Le store ne dénormalise pas
 * `coachUid` (seulement `coachLabel`) : on passe `null` ici — la branche
 * "coaching" du helper ne fera donc pas feu, c'est attendu (cf. brief :
 * "coachUid peut venir de booking.coachUid si exposé, sinon null").
 */
const conflictBookingSources = computed<ConflictBookingSource[]>(() =>
  bookingsStore.allBookings.map((b) => ({
    id: b.id,
    startMs: b.startMs,
    endMs: b.endMs,
    coachUid: null,
    teamId: b.teamId,
    opponentName: b.opponentName,
    teamName: b.teamName,
    slotType: b.slotType,
  })),
)

/**
 * Conflits par memberId (memo). Synchrone — recalculé uniquement si les
 * inputs (officials list, sources, entry) changent. Évite N appels par
 * scroll de liste.
 */
const conflictsByMember = computed<Map<string, ConflictInfo[]>>(() => {
  const map = new Map<string, ConflictInfo[]>()
  const recap = entryRecap.value
  for (const o of officials.value) {
    const conflicts = detectConflicts({
      memberId: o.id,
      linkedUserId: o.linkedUserId ?? null,
      teamIds: o.teamIds ?? [],
      targetStartMs: recap.startMs,
      targetEndMs: recap.endMs,
      excludeParentId: recap.parentId,
      allBookings: conflictBookingSources.value,
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
    map.set(o.id, conflicts)
  }
  return map
})

const selectedTarget = computed<OfficialLite | null>(() => {
  const id = selectedTargetId.value
  if (!id) return null
  return officials.value.find((o) => o.id === id) ?? null
})

const selectedConflicts = computed<ConflictInfo[]>(() => {
  const id = selectedTargetId.value
  if (!id) return []
  return conflictsByMember.value.get(id) ?? []
})

/** Liste filtrée par la barre de recherche (nom complet). */
const filteredOfficials = computed<OfficialLite[]>(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return officials.value
  return officials.value.filter((o) => {
    const full = `${o.firstName} ${o.lastName}`.toLowerCase()
    return full.includes(q)
  })
})

const trimmedMessage = computed(() => message.value.trim())
const messageLength = computed(() => trimmedMessage.value.length)

const canSubmit = computed<boolean>(() => {
  if (profileIncomplete.value) return false
  if (!selectedTargetId.value) return false
  if (submitting.value) return false
  return true
})

// ─── Fetch officiels au mount ────────────────────────────────────────

async function loadOfficials(): Promise<void> {
  if (!requesterMemberId.value) return
  loadingOfficials.value = true
  officialsError.value = null
  try {
    // Charge la saison active si nécessaire (idempotent côté composable).
    if (!activeSeason.seasonId.value) {
      await activeSeason.load()
    }
    const seasonId = activeSeason.seasonId.value
    if (!seasonId) {
      // Pas de saison active → on tente quand même avec "current" (fallback
      // mock-friendly) : la query ne matchera rien, la liste sera vide.
      officials.value = []
      return
    }
    officials.value = await listClubOfficials(seasonId, requesterMemberId.value)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[RequestReplacementDialog] loadOfficials failed', err)
    officialsError.value = msg
    officials.value = []
  } finally {
    loadingOfficials.value = false
  }
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      // Reset state d'une ouverture à l'autre.
      selectedTargetId.value = null
      message.value = ''
      submitError.value = null
      search.value = ''
      void loadOfficials()
    }
  },
  { immediate: true },
)

// ─── Actions ─────────────────────────────────────────────────────────

function close(): void {
  if (submitting.value) return
  emit('update:visible', false)
}

function onBackdropClick(e: MouseEvent): void {
  if (e.target === e.currentTarget) close()
}

function selectTarget(id: string): void {
  selectedTargetId.value = id
}

async function handleSubmit(): Promise<void> {
  if (!canSubmit.value) return
  if (!requesterMemberId.value || !selectedTarget.value) return
  submitting.value = true
  submitError.value = null
  try {
    const recap = entryRecap.value
    const target = selectedTarget.value
    const e = props.entry
    const input: CreateReplacementRequestInput = {
      parentKind: e.parent.kind,
      parentId: recap.parentId,
      originalAssignmentId: e.assignment.id,
      requesterMemberId: requesterMemberId.value,
      requesterDisplayName: auth.displayName,
      targetMemberId: target.id,
      targetDisplayName: `${target.firstName} ${target.lastName}`.trim(),
      matchDateMs: recap.matchDateMs,
      matchStartTime: recap.startTime,
      matchEndTime: recap.endTime,
      matchTypeName: recap.matchTypeName,
      matchOpponentName: recap.opponent === '—' ? null : recap.opponent,
      matchVenueLabel: recap.venue === '—' ? null : recap.venue,
      officialLevel: e.assignment.officialLevel,
      message: trimmedMessage.value.length > 0 ? trimmedMessage.value : null,
    }
    await replacementsStore.createRequest(input)
    emit('submitted')
    emit('update:visible', false)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[RequestReplacementDialog] submit failed', err)
    submitError.value = msg || 'Erreur lors de la création de la demande.'
  } finally {
    submitting.value = false
  }
}

// ─── Helpers d'affichage ─────────────────────────────────────────────

function levelLabel(level: number | null | undefined): string {
  if (level == null) return '—'
  return `Niv. ${level}`
}

function conflictKindLabel(kind: ConflictInfo['kind']): string {
  switch (kind) {
    case 'officiating':
      return 'Officie déjà'
    case 'coaching':
      return 'Coache'
    case 'playing':
      return 'Joue'
    default:
      return kind
  }
}

function fmtTime(ms: number): string {
  const d = new Date(ms)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}
</script>

<template>
  <Teleport to="body">
    <transition name="rrd-fade">
      <div
        v-if="visible"
        class="rrd-root"
        role="dialog"
        aria-modal="true"
        aria-label="Demander un remplacement"
        @click="onBackdropClick"
      >
        <div class="rrd-panel" @click.stop>
          <!-- Header -->
          <div class="cb-header">
            <div class="left">
              <button
                type="button"
                class="cb-iconbtn"
                aria-label="Fermer"
                :disabled="submitting"
                @click="close"
              >
                <X :size="20" />
              </button>
            </div>
            <div class="title">Demander un remplacement</div>
            <div class="right" />
          </div>

          <!-- Body -->
          <div class="rrd-body">
            <!-- Profil incomplet → on bloque tout, message + bouton fermer. -->
            <template v-if="profileIncomplete">
              <div class="cb-page">
                <CbBanner tone="rose" title="Profil incomplet">
                  <template #icon><AlertTriangle :size="18" /></template>
                  Impossible de demander un remplacement : votre compte n'est
                  pas lié à un membre officiel du club. Contactez votre admin.
                </CbBanner>
              </div>
              <CbBottomBar>
                <button
                  type="button"
                  class="cb-btn outline block"
                  @click="close"
                >
                  Fermer
                </button>
              </CbBottomBar>
            </template>

            <template v-else>
              <div class="cb-page">
                <!-- Erreur submit -->
                <CbBanner
                  v-if="submitError"
                  tone="rose"
                  title="Erreur"
                >
                  <template #icon><AlertTriangle :size="18" /></template>
                  {{ submitError }}
                </CbBanner>

                <!-- 1. Récap match -->
                <div class="cb-card rrd-recap">
                  <div class="rrd-recap-head">
                    <div>
                      <div class="rrd-recap-date">
                        {{ entryRecap.dateLabel }}
                      </div>
                      <div class="mono rrd-recap-time">
                        {{ entryRecap.timeLabel }}
                      </div>
                    </div>
                    <CbPill tone="violet">{{ levelLabel(entry.assignment.officialLevel) }}</CbPill>
                  </div>
                  <div class="rrd-recap-opponent">vs {{ entryRecap.opponent }}</div>
                  <div class="cb-sub rrd-recap-venue">{{ entryRecap.venue }}</div>
                  <div class="rrd-recap-meta">
                    <CbPill tone="slate">{{ entryRecap.matchTypeName }}</CbPill>
                    <CbPill v-if="entryRecap.teamName" tone="emerald">{{ entryRecap.teamName }}</CbPill>
                  </div>
                </div>

                <!-- 2. Liste officiels -->
                <section class="rrd-section">
                  <label class="rrd-label" for="rrd-search">
                    Choisir un officiel à qui demander
                  </label>

                  <!-- Recherche -->
                  <div class="rrd-search">
                    <Search :size="16" class="rrd-search-icon" />
                    <input
                      id="rrd-search"
                      v-model="search"
                      type="search"
                      class="cb-input rrd-search-input"
                      placeholder="Rechercher un officiel…"
                      autocomplete="off"
                    />
                  </div>

                  <!-- États : loading / erreur / vide / liste -->
                  <div v-if="loadingOfficials" class="rrd-info">
                    Chargement des officiels du club…
                  </div>
                  <CbBanner
                    v-else-if="officialsError"
                    tone="rose"
                    title="Erreur de chargement"
                  >
                    <template #icon><AlertTriangle :size="18" /></template>
                    {{ officialsError }}
                  </CbBanner>
                  <div
                    v-else-if="officials.length === 0"
                    class="rrd-empty"
                  >
                    <UserX :size="22" class="rrd-empty-icon" />
                    <div class="rrd-empty-title">
                      Aucun officiel disponible dans le club
                    </div>
                    <div class="cb-sub">
                      Aucun autre membre n'a de licence officiel active cette saison.
                    </div>
                  </div>
                  <div
                    v-else-if="filteredOfficials.length === 0"
                    class="rrd-info"
                  >
                    Aucun officiel ne correspond à « {{ search }} ».
                  </div>
                  <div v-else class="rrd-list">
                    <button
                      v-for="o in filteredOfficials"
                      :key="o.id"
                      type="button"
                      class="rrd-row"
                      :class="{ 'is-selected': o.id === selectedTargetId }"
                      :aria-pressed="o.id === selectedTargetId"
                      @click="selectTarget(o.id)"
                    >
                      <CbAvatar
                        :name="`${o.firstName} ${o.lastName}`"
                        size="sm"
                        tone="slate"
                      />
                      <div class="rrd-row-main">
                        <div class="rrd-row-name">
                          {{ o.firstName }} {{ o.lastName }}
                        </div>
                        <div class="cb-sub rrd-row-meta">
                          {{ levelLabel(o.officialLicense?.level ?? o.officialLevel ?? null) }}
                        </div>
                      </div>
                      <div class="rrd-row-side">
                        <span
                          v-if="(conflictsByMember.get(o.id)?.length ?? 0) > 0"
                          class="rrd-conflict-badge"
                          :title="`${conflictsByMember.get(o.id)?.length ?? 0} conflit(s)`"
                        >
                          <span class="rrd-conflict-dot" />
                          {{ conflictsByMember.get(o.id)?.length ?? 0 }}
                        </span>
                        <CheckCircle2
                          v-if="o.id === selectedTargetId"
                          :size="18"
                          class="rrd-check"
                        />
                      </div>
                    </button>
                  </div>
                </section>

                <!-- 3. Détails conflits du target -->
                <section v-if="selectedTarget" class="rrd-section">
                  <div
                    v-if="selectedConflicts.length === 0"
                    class="rrd-ok"
                  >
                    <CheckCircle2 :size="16" />
                    Aucun conflit détecté pour cet officiel.
                  </div>
                  <div v-else class="rrd-conflicts">
                    <div class="rrd-conflicts-title">
                      <AlertTriangle :size="16" />
                      {{ selectedConflicts.length }} conflit{{ selectedConflicts.length > 1 ? 's' : '' }}
                      détecté{{ selectedConflicts.length > 1 ? 's' : '' }}
                    </div>
                    <ul class="rrd-conflict-list">
                      <li
                        v-for="c in selectedConflicts"
                        :key="`${c.sourceId}-${c.kind}`"
                        class="rrd-conflict-row"
                      >
                        <span class="rrd-conflict-kind">{{ conflictKindLabel(c.kind) }}</span>
                        <span class="rrd-conflict-label">{{ c.label }}</span>
                        <span class="mono rrd-conflict-time">
                          {{ fmtTime(c.startMs) }}–{{ fmtTime(c.endMs) }}
                        </span>
                      </li>
                    </ul>
                  </div>
                </section>

                <!-- 4. Message optionnel -->
                <section class="rrd-section">
                  <label class="rrd-label" for="rrd-message">
                    Message (optionnel)
                  </label>
                  <textarea
                    id="rrd-message"
                    v-model="message"
                    class="cb-input rrd-textarea"
                    rows="5"
                    :maxlength="MESSAGE_MAX"
                    placeholder="Ex. Empêchement médical, à reprogrammer ?"
                  ></textarea>
                  <div class="cb-sub rrd-counter">
                    {{ messageLength }}/{{ MESSAGE_MAX }}
                  </div>
                </section>
              </div>

              <!-- Sticky CTAs -->
              <CbBottomBar>
                <button
                  type="button"
                  class="cb-btn ghost"
                  style="flex: 1"
                  :disabled="submitting"
                  @click="close"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  class="cb-btn primary"
                  style="flex: 2"
                  :disabled="!canSubmit"
                  @click="handleSubmit"
                >
                  <CheckCircle2 :size="16" />
                  {{ submitting ? 'Envoi…' : 'Envoyer la demande' }}
                </button>
              </CbBottomBar>
            </template>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.rrd-root {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  background: rgba(15, 23, 42, 0.45);
}

/* Mobile : fullscreen */
.rrd-panel {
  position: relative;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.rrd-body {
  flex: 1;
  overflow: auto;
  background: var(--bg);
  display: flex;
  flex-direction: column;
}

/* Desktop : centré, 520px max, hauteur auto, coins arrondis */
@media (min-width: 1024px) {
  .rrd-root {
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .rrd-panel {
    width: 520px;
    max-width: 100%;
    height: auto;
    max-height: calc(100vh - 48px);
    border-radius: 16px;
    box-shadow: var(--shadow-lg, 0 20px 50px rgba(15, 23, 42, 0.25));
  }
  .rrd-panel :deep(.cb-header) {
    border-radius: 16px 16px 0 0;
  }
  .rrd-panel :deep(.cb-bottom-bar) {
    border-radius: 0 0 16px 16px;
    padding-bottom: 12px;
  }
}

/* ─── Recap card ──────────────────────────────────────────────── */
.rrd-recap { padding: 16px; }
.rrd-recap-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.rrd-recap-date { font-size: 18px; font-weight: 700; }
.rrd-recap-time {
  font-size: 14px;
  font-weight: 600;
  color: var(--slate-700);
  margin-top: 2px;
}
.rrd-recap-opponent {
  margin-top: 10px;
  font-size: 15px;
  font-weight: 600;
}
.rrd-recap-venue { margin-top: 4px; }
.rrd-recap-meta {
  margin-top: 12px;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

/* ─── Section générique ───────────────────────────────────────── */
.rrd-section { margin-top: 16px; }
.rrd-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--slate-700);
  margin-bottom: 6px;
}

/* ─── Search bar ──────────────────────────────────────────────── */
.rrd-search { position: relative; }
.rrd-search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--slate-500);
  pointer-events: none;
}
.rrd-search-input { padding-left: 32px; }

/* ─── Liste officiels (scrollable) ────────────────────────────── */
.rrd-list {
  margin-top: 8px;
  border: 1px solid var(--border);
  border-radius: 10px;
  max-height: 300px;
  overflow-y: auto;
  background: var(--bg);
}
.rrd-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  background: transparent;
  border: 0;
  border-top: 1px solid var(--border);
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease;
}
.rrd-row:first-child { border-top: 0; }
.rrd-row:hover { background: var(--slate-50); }
.rrd-row.is-selected {
  background: var(--emerald-50, #ecfdf5);
  box-shadow: inset 3px 0 0 var(--emerald-600);
}
.rrd-row.is-selected .rrd-row-name { color: var(--emerald-700, #047857); }
.rrd-row-main { flex: 1; min-width: 0; }
.rrd-row-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--slate-900);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rrd-row-meta { font-size: 12px; }
.rrd-row-side {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rrd-check { color: var(--emerald-600); }

/* ─── Badge nb conflits ───────────────────────────────────────── */
.rrd-conflict-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--rose-50, #fff1f2);
  color: var(--rose-700, #be123c);
  font-size: 12px;
  font-weight: 600;
}
.rrd-conflict-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--rose-600, #e11d48);
}

/* ─── Empty state ─────────────────────────────────────────────── */
.rrd-empty {
  padding: 24px 16px;
  text-align: center;
  border: 1px dashed var(--border);
  border-radius: 10px;
  margin-top: 8px;
}
.rrd-empty-icon { color: var(--slate-500); margin-bottom: 8px; }
.rrd-empty-title { font-weight: 600; margin-bottom: 4px; }
.rrd-info {
  padding: 12px;
  text-align: center;
  color: var(--slate-600);
  font-size: 13px;
}

/* ─── Bloc OK (0 conflit) ─────────────────────────────────────── */
.rrd-ok {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--emerald-50, #ecfdf5);
  color: var(--emerald-700, #047857);
  border: 1px solid var(--emerald-200, #a7f3d0);
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
}

/* ─── Bloc conflits ───────────────────────────────────────────── */
.rrd-conflicts {
  background: var(--rose-50, #fff1f2);
  border: 1px solid var(--rose-200, #fecdd3);
  border-radius: 10px;
  padding: 10px 12px;
}
.rrd-conflicts-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--rose-700, #be123c);
  margin-bottom: 8px;
}
.rrd-conflict-list { list-style: none; padding: 0; margin: 0; }
.rrd-conflict-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 8px;
  align-items: baseline;
  padding: 6px 0;
  border-top: 1px solid var(--rose-200, #fecdd3);
  font-size: 13px;
}
.rrd-conflict-row:first-child { border-top: 0; }
.rrd-conflict-kind {
  font-weight: 600;
  color: var(--rose-700, #be123c);
}
.rrd-conflict-label {
  color: var(--slate-800);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rrd-conflict-time {
  color: var(--slate-700);
  font-size: 12px;
}

/* ─── Textarea + counter ──────────────────────────────────────── */
.rrd-textarea { resize: vertical; min-height: 96px; }
.rrd-counter {
  margin-top: 4px;
  text-align: right;
  font-size: 12px;
}

/* ─── Transition fade + slide ─────────────────────────────────── */
.rrd-fade-enter-active,
.rrd-fade-leave-active {
  transition: opacity 180ms ease;
}
.rrd-fade-enter-active .rrd-panel,
.rrd-fade-leave-active .rrd-panel {
  transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.rrd-fade-enter-from,
.rrd-fade-leave-to { opacity: 0; }
.rrd-fade-enter-from .rrd-panel,
.rrd-fade-leave-to .rrd-panel { transform: translateY(16px); }

@media (min-width: 1024px) {
  .rrd-fade-enter-from .rrd-panel,
  .rrd-fade-leave-to .rrd-panel {
    transform: translateY(0) scale(0.96);
  }
}
</style>
