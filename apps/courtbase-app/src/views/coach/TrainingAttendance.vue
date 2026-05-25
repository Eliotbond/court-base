<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Calendar,
  Check,
  Clipboard,
  Home as HomeIcon,
  Users,
} from 'lucide-vue-next'

import CbAvatar from '@/components/ui/CbAvatar.vue'
import CbBottomBar from '@/components/ui/CbBottomBar.vue'
import CbDesktopShell from '@/components/ui/CbDesktopShell.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbPageHead from '@/components/ui/CbPageHead.vue'
import CbPill from '@/components/ui/CbPill.vue'
import type { CbNavItem } from '@/components/ui/CbSidebar.vue'
import type { CbTab } from '@/components/ui/CbTabBar.vue'
import { useViewport } from '@/composables/useViewport'
import {
  getTeam,
  listMembersByTeam,
  listRegistrationsToTreat,
  logMockAction,
  type MockMember,
  type MockTeam,
} from '@/repositories/mock'
import { useAuthStore } from '@/stores/auth'

/**
 * CO6 — TrainingAttendance (coach · présences entraînement).
 *
 * Transcription quasi-littérale du JSX `coach.jsx` lignes 398-468.
 * Liste plate des joueurs de l'équipe avec un radio horizontal
 * Présent / Absent / Excusé (tons emerald / slate / amber).
 *
 * **Règles métier conservées du JSX** :
 * - Joueur `duesStatus === 'excluded'` ET pas d'exception pending →
 *   bouton "Présent" désactivé, row fadée, avatar rose, pill rose "Exclu",
 *   nom barré.
 * - Joueur `duesStatus === 'excepted'` → pill violet "Exception pending"
 *   (toutes les options restent disponibles, l'exception lève la
 *   suspension le temps du traitement comité).
 *
 * **Mock pur** : `Enregistrer` log `co6.save-attendance` et revient sur
 * la page précédente. Aucune écriture Firestore.
 *
 * **Booking inline** : on ne dispose pas (en mock) d'un `listBookings`
 * côté repo. On reconstitue un booking fictif depuis
 * `route.params.bookingId` + un `teamId` issu de la query (à défaut
 * `t-u16m-compet` qui couvre tous les cas de `duesStatus`).
 */

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { isDesktop } = useViewport()

// ─── Paramètres + booking mock inline ────────────────────────────
const bookingId = computed(() => {
  const p = route.params['bookingId']
  return Array.isArray(p) ? (p[0] ?? '') : (p ?? '')
})

const teamIdParam = computed(() => {
  const q = route.query['teamId']
  if (Array.isArray(q)) return q[0] ?? 't-u16m-compet'
  return q ?? 't-u16m-compet'
})

interface MockBooking {
  id: string
  teamId: string
  date: string
  startTime: string
  endTime: string
  venueLabel: string
}

const MOCK_BOOKING = computed<MockBooking>(() => ({
  id: bookingId.value,
  teamId: teamIdParam.value,
  date: 'Mercredi 15 oct.',
  startTime: '18:00',
  endTime: '20:00',
  venueLabel: 'Centre sportif · Court A',
}))

const team = computed<MockTeam | null>(() => getTeam(MOCK_BOOKING.value.teamId))

const players = computed<MockMember[]>(() => {
  if (!team.value) return []
  return listMembersByTeam(team.value.id)
})

// ─── État des présences ──────────────────────────────────────────
type AttendanceMark = 'P' | 'A' | 'E' | null

const marks = reactive<Record<string, AttendanceMark>>({})

function getMark(memberId: string): AttendanceMark {
  return marks[memberId] ?? null
}

function setMark(memberId: string, value: Exclude<AttendanceMark, null>, disabled: boolean): void {
  if (disabled) return
  marks[memberId] = value
}

// ─── Règles métier exclusion / exception ─────────────────────────
function isExcluded(m: MockMember): boolean {
  return m.duesStatus === 'excluded'
}

function isExcepted(m: MockMember): boolean {
  return m.duesStatus === 'excepted'
}

/** Présent désactivé si exclu **et pas** d'exception pending. */
function isPresentDisabled(m: MockMember): boolean {
  return isExcluded(m) && !isExcepted(m)
}

function fullName(m: MockMember): string {
  return `${m.firstName} ${m.lastName}`
}

// ─── Compteur marqués (pour CTA "Enregistrer (n marqués)") ───────
const markedCount = computed(() => {
  let n = 0
  for (const p of players.value) {
    if (marks[p.id]) n++
  }
  return n
})

const saveLabel = computed(() =>
  markedCount.value > 0
    ? `Enregistrer (${markedCount.value} marqué${markedCount.value > 1 ? 's' : ''})`
    : 'Enregistrer',
)

// ─── Save ────────────────────────────────────────────────────────
const saving = ref(false)

function onSave(): void {
  if (saving.value) return
  saving.value = true
  logMockAction('co6.save-attendance', {
    bookingId: bookingId.value,
    teamId: team.value?.id,
    marks: { ...marks },
  })
  setTimeout(() => {
    saving.value = false
    router.back()
  }, 120)
}

function onCancel(): void {
  router.back()
}

// ─── Shell coach (tabs mobile + sidebar desktop) ─────────────────
const registrationsToTreatCount = computed(() => listRegistrationsToTreat().length)

const tabsCoach = computed<CbTab[]>(() => [
  { icon: Users, label: 'Équipes' },
  { icon: Calendar, label: 'Planning' },
  {
    icon: Clipboard,
    label: 'Inscriptions',
    badge: registrationsToTreatCount.value || undefined,
  },
])

const navCoach = computed<CbNavItem[]>(() => [
  { icon: HomeIcon, label: 'Accueil' },
  { icon: Users, label: 'Mes équipes' },
  { icon: Calendar, label: 'Planning' },
  {
    icon: Clipboard,
    label: 'Inscriptions',
    badge: registrationsToTreatCount.value || undefined,
  },
])

function onTabSelect(index: number): void {
  if (index === 0) router.push({ name: 'team' })
  else if (index === 1) {
    if (team.value) router.push({ name: 'planning', params: { teamId: team.value.id } })
    else router.push({ name: 'team' })
  } else if (index === 2) router.push({ name: 'registrations' })
}

function onNavSelect(index: number): void {
  if (index === 0) router.push({ name: 'home' })
  else if (index === 1) router.push({ name: 'team' })
  else if (index === 2) {
    if (team.value) router.push({ name: 'planning', params: { teamId: team.value.id } })
    else router.push({ name: 'team' })
  } else if (index === 3) router.push({ name: 'registrations' })
}

function onBack(): void {
  router.back()
}

// ─── Titres ──────────────────────────────────────────────────────
const desktopTitle = computed(() =>
  team.value ? `Présences — ${team.value.name}` : 'Présences',
)
const desktopSubtitle = computed(() => {
  const b = MOCK_BOOKING.value
  return `${b.date} · ${b.startTime}–${b.endTime} · ${b.venueLabel}`
})

// ─── Sub-line équipe + venue (transcription JSX ligne 439) ───────
const subLine = computed(() => {
  const b = MOCK_BOOKING.value
  if (team.value) return `${team.value.name} · ${b.venueLabel}`
  return b.venueLabel
})

// ─── Tons radio (transcription JSX `opts` lignes 400-404) ────────
interface RadioOpt {
  v: 'P' | 'A' | 'E'
  tone: 'emerald' | 'slate' | 'amber'
  lbl: string
}
const RADIO_OPTS: RadioOpt[] = [
  { v: 'P', tone: 'emerald', lbl: 'Présent' },
  { v: 'A', tone: 'slate', lbl: 'Absent' },
  { v: 'E', tone: 'amber', lbl: 'Excusé' },
]

/** Style inline d'un bouton radio (transcription JSX lignes 411-417). */
function radioStyle(opt: RadioOpt, active: boolean, dis: boolean): string {
  const bg = active
    ? `var(--${opt.tone}-${opt.tone === 'slate' ? '200' : '100'})`
    : 'var(--slate-50)'
  const color = active
    ? `var(--${opt.tone}-${opt.tone === 'slate' ? '800' : '700'})`
    : 'var(--slate-500)'
  const shadow = active
    ? `inset 0 0 0 1.5px var(--${opt.tone}-500)`
    : 'inset 0 0 0 1px var(--border)'
  const cursor = dis ? 'not-allowed' : 'pointer'
  const opacity = dis ? 0.4 : 1
  return `border: 0; font-family: inherit; padding: 6px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: ${cursor}; background: ${bg}; color: ${color}; box-shadow: ${shadow}; opacity: ${opacity};`
}
</script>

<template>
  <!-- ─── Desktop ≥ 1024px ─────────────────────────────────────── -->
  <CbDesktopShell
    v-if="isDesktop"
    :items="navCoach"
    :active="2"
    brand-name="BC Aigles"
    brand-sub="Saison 2025/26"
    club-initials="BCA"
    :user-name="auth.displayName"
    user-role="Coach"
    @nav-select="onNavSelect"
  >
    <CbPageHead :title="desktopTitle" :subtitle="desktopSubtitle">
      <template #actions>
        <button class="cb-btn outline" type="button" @click="onCancel">
          Annuler
        </button>
        <button class="cb-btn primary" type="button" :disabled="saving" @click="onSave">
          <Check :size="16" />
          {{ saveLabel }}
        </button>
      </template>
    </CbPageHead>

    <!-- Header info booking (transcription JSX lignes 437-446) -->
    <div style="padding: 10px 16px; background: var(--bg); border-bottom: 1px solid var(--border);">
      <div class="cb-h3">{{ MOCK_BOOKING.date }} · {{ MOCK_BOOKING.startTime }}–{{ MOCK_BOOKING.endTime }}</div>
      <div class="cb-sub" style="margin-top: 2px">{{ subLine }}</div>
      <div style="margin-top: 8px; display: flex; gap: 6px; font-size: 11px; color: var(--text-subtle); align-items: center;">
        <span>Tap rapide :</span>
        <span style="display: inline-flex; align-items: center; gap: 4px;"><span class="mono" style="font-weight: 600; color: var(--emerald-700);">P</span> Présent</span>
        <span style="display: inline-flex; align-items: center; gap: 4px;"><span class="mono" style="font-weight: 600; color: var(--slate-700);">A</span> Absent</span>
        <span style="display: inline-flex; align-items: center; gap: 4px;"><span class="mono" style="font-weight: 600; color: var(--amber-700);">E</span> Excusé</span>
      </div>
    </div>

    <!-- Liste joueurs (transcription JSX lignes 447-463) -->
    <div style="flex: 1; overflow: auto; background: var(--bg);">
      <div
        v-for="p in players"
        :key="p.id"
        :style="`display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--border); opacity: ${isPresentDisabled(p) ? 0.55 : 1};`"
      >
        <CbAvatar
          :name="fullName(p)"
          size="sm"
          :tone="isPresentDisabled(p) ? 'rose' : (p.avatarTone ?? undefined)"
        />
        <div style="flex: 1; min-width: 0;">
          <div :style="`font-size: 13px; font-weight: 600; text-decoration: ${isPresentDisabled(p) ? 'line-through' : 'none'};`">
            {{ fullName(p) }}
          </div>
          <div style="font-size: 11px; color: var(--text-subtle); display: flex; gap: 4px; align-items: center;">
            <template v-if="isPresentDisabled(p)">
              <CbPill tone="rose" dot>Exclu</CbPill> Cotisation impayée
            </template>
            <template v-else-if="isExcepted(p)">
              <CbPill tone="violet" dot>Exception pending</CbPill>
            </template>
            <template v-else>
              Saison · 18 P · 1 A · 3 E
            </template>
          </div>
        </div>
        <!-- PresRadio (transcription JSX lignes 399-422) -->
        <div style="display: flex; gap: 4px;">
          <button
            v-for="o in RADIO_OPTS"
            :key="o.v"
            type="button"
            :disabled="isPresentDisabled(p) && o.v === 'P'"
            :style="radioStyle(o, getMark(p.id) === o.v, isPresentDisabled(p) && o.v === 'P')"
            :title="isPresentDisabled(p) && o.v === 'P' ? 'Cotisation impayée — soumettez une exception depuis sa fiche' : o.lbl"
            @click="setMark(p.id, o.v, isPresentDisabled(p) && o.v === 'P')"
          >{{ o.lbl[0] }}</button>
        </div>
      </div>
    </div>
  </CbDesktopShell>

  <!-- ─── Mobile < 1024px ──────────────────────────────────────── -->
  <CbMobileShell
    v-else
    title="Présences"
    show-back
    :tabs="tabsCoach"
    :active-tab="1"
    @back="onBack"
    @tab-select="onTabSelect"
  >
    <!-- Header booking (transcription JSX lignes 437-446) -->
    <div style="padding: 10px 16px; background: var(--bg); border-bottom: 1px solid var(--border);">
      <div class="cb-h3">{{ MOCK_BOOKING.date }} · {{ MOCK_BOOKING.startTime }}–{{ MOCK_BOOKING.endTime }}</div>
      <div class="cb-sub" style="margin-top: 2px">{{ subLine }}</div>
      <div style="margin-top: 8px; display: flex; gap: 6px; font-size: 11px; color: var(--text-subtle); align-items: center;">
        <span>Tap rapide :</span>
        <span style="display: inline-flex; align-items: center; gap: 4px;"><span class="mono" style="font-weight: 600; color: var(--emerald-700);">P</span> Présent</span>
        <span style="display: inline-flex; align-items: center; gap: 4px;"><span class="mono" style="font-weight: 600; color: var(--slate-700);">A</span> Absent</span>
        <span style="display: inline-flex; align-items: center; gap: 4px;"><span class="mono" style="font-weight: 600; color: var(--amber-700);">E</span> Excusé</span>
      </div>
    </div>

    <!-- Liste joueurs (transcription JSX lignes 447-463) -->
    <div style="flex: 1; overflow: auto; background: var(--bg);">
      <div
        v-for="p in players"
        :key="p.id"
        :style="`display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--border); opacity: ${isPresentDisabled(p) ? 0.55 : 1};`"
      >
        <CbAvatar
          :name="fullName(p)"
          size="sm"
          :tone="isPresentDisabled(p) ? 'rose' : (p.avatarTone ?? undefined)"
        />
        <div style="flex: 1; min-width: 0;">
          <div :style="`font-size: 13px; font-weight: 600; text-decoration: ${isPresentDisabled(p) ? 'line-through' : 'none'};`">
            {{ fullName(p) }}
          </div>
          <div style="font-size: 11px; color: var(--text-subtle); display: flex; gap: 4px; align-items: center;">
            <template v-if="isPresentDisabled(p)">
              <CbPill tone="rose" dot>Exclu</CbPill> Cotisation impayée
            </template>
            <template v-else-if="isExcepted(p)">
              <CbPill tone="violet" dot>Exception pending</CbPill>
            </template>
            <template v-else>
              Saison · 18 P · 1 A · 3 E
            </template>
          </div>
        </div>
        <!-- PresRadio (transcription JSX lignes 399-422) -->
        <div style="display: flex; gap: 4px;">
          <button
            v-for="o in RADIO_OPTS"
            :key="o.v"
            type="button"
            :disabled="isPresentDisabled(p) && o.v === 'P'"
            :style="radioStyle(o, getMark(p.id) === o.v, isPresentDisabled(p) && o.v === 'P')"
            :title="isPresentDisabled(p) && o.v === 'P' ? 'Cotisation impayée — soumettez une exception depuis sa fiche' : o.lbl"
            @click="setMark(p.id, o.v, isPresentDisabled(p) && o.v === 'P')"
          >{{ o.lbl[0] }}</button>
        </div>
      </div>
    </div>

    <!-- BottomBar (transcription JSX lignes 464-466) -->
    <CbBottomBar>
      <button class="cb-btn primary block lg" type="button" :disabled="saving" @click="onSave">
        <Check :size="16" />
        {{ saveLabel }}
      </button>
    </CbBottomBar>
  </CbMobileShell>
</template>
