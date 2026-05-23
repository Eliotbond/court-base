<script setup lang="ts">
import { computed, h, ref, type FunctionalComponent, type VNode } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertTriangle,
  Award,
  Bell,
  BellRing,
  Bus,
  Calendar,
  CalendarPlus,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  Home as HomeIcon,
  Inbox,
  Info,
  MapPin,
  Megaphone,
  Shield,
  Users,
  XCircle,
} from 'lucide-vue-next'

import CbBanner from '@/components/ui/CbBanner.vue'
import CbBottomBar from '@/components/ui/CbBottomBar.vue'
import CbDesktopShell from '@/components/ui/CbDesktopShell.vue'
import CbMatchCard from '@/components/ui/CbMatchCard.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbPageHead from '@/components/ui/CbPageHead.vue'
import CbPill from '@/components/ui/CbPill.vue'
import { useShellNav } from '@/composables/useShellNav'
import { useViewport } from '@/composables/useViewport'
import {
  countUnread,
  listAssignmentsForMatch,
  listMembersByTeam,
  listMyAssignments,
  listOpenMatches,
  listRegistrationsToTreat,
  listRequests,
  listTeamsForCoach,
  logMockAction,
  type MockMatch,
  type MockTeam,
} from '@/repositories/mock'
import { useAuthStore } from '@/stores/auth'

/**
 * C3 — Home (role-aware). Transcription quasi-littérale de `common.jsx`
 * (`HomeCoachMobile`, `HomeOfficialMobile`, `HomeAdminMobile`,
 * `HomeMultiRoleMobile`, `HomeDesktop`).
 *
 * Sélection du variant :
 * - `isDesktop`            → `HomeDesktop`
 * - mobile + multi-rôle    → `HomeMultiRoleMobile`
 * - mobile + coach unique  → `HomeCoachMobile`
 * - mobile + official      → `HomeOfficialMobile`
 * - mobile + admin         → `HomeAdminMobile`
 */

// ─── Mocks d'état UI (toggle dev) ───────────────────────────────
const MOCK_LOADING_HOME = false
const MOCK_NO_LICENSE = false

const router = useRouter()
const auth = useAuthStore()
const { isDesktop } = useViewport()
const {
  coachTabs,
  officialTabs,
  adminTabs,
  multiRoleTabs,
  coachNav,
  officialNav,
  adminNav,
} = useShellNav()

// ─── Sélection rôle courant ─────────────────────────────────────
const isMultiRole = computed(() => auth.roles.length > 1)

const currentRole = ref<'coach' | 'official' | 'admin'>(
  auth.isCoach ? 'coach' : auth.isOfficial ? 'official' : 'admin',
)

function setRole(r: 'coach' | 'official' | 'admin'): void {
  currentRole.value = r
  logMockAction('home.role-switch', { role: r })
}

// ─── Données dérivées ───────────────────────────────────────────
const coachTeams = computed<MockTeam[]>(() => listTeamsForCoach(auth.uid))

const registrationsToTreatCount = computed(() => listRegistrationsToTreat().length)

const excludedMembersCount = computed(() => {
  const seen = new Set<string>()
  for (const team of coachTeams.value) {
    for (const m of listMembersByTeam(team.id)) {
      if (m.duesStatus === 'excluded') seen.add(m.id)
    }
  }
  return seen.size
})

function countExcludedInTeam(teamId: string): number {
  return listMembersByTeam(teamId).filter((m) => m.duesStatus === 'excluded').length
}

const openMatchesForLevel = computed<ReadonlyArray<MockMatch>>(() => {
  const base = listOpenMatches(auth.officialLevel)
  return [...base].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3)
})

const myAssignments = computed(() => {
  const memberId = auth.linkedMember?.id ?? ''
  if (!memberId) return []
  const allMatches = listOpenMatches()
  return listMyAssignments(memberId)
    .filter((a) => a.status === 'pending' || a.status === 'confirmed')
    .map((a) => ({ ...a, match: allMatches.find((m) => m.id === a.matchId) ?? null }))
    .sort((a, b) => (a.match?.date ?? '9999').localeCompare(b.match?.date ?? '9999'))
    .slice(0, 3)
})

const licenseRequestsCount = computed(
  () => listRequests({ kind: 'license', status: 'pending' }).length,
)
const paymentExceptionRequestsCount = computed(
  () => listRequests({ kind: 'payment_exception', status: 'pending' }).length,
)
const matchMoveRequestsCount = computed(
  () => listRequests({ kind: 'match_move', status: 'pending' }).length,
)

function isWithinNextSevenDays(isoDate: string): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const horizon = new Date(today)
  horizon.setDate(horizon.getDate() + 7)
  const parts = isoDate.split('-')
  const y = Number(parts[0] ?? '1970')
  const m = Number(parts[1] ?? '1')
  const d = Number(parts[2] ?? '1')
  const target = new Date(y, m - 1, d)
  return target >= today && target <= horizon
}

const adminOpenHomeMatches = computed<ReadonlyArray<MockMatch>>(() =>
  listOpenMatches()
    .filter((m) => m.kind === 'home')
    .filter((m) => isWithinNextSevenDays(m.date))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5),
)

// ─── Formatage ──────────────────────────────────────────────────
const dateFormatter = new Intl.DateTimeFormat('fr-CH', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

function formatDate(isoDate: string): string {
  const parts = isoDate.split('-')
  const y = Number(parts[0] ?? '1970')
  const m = Number(parts[1] ?? '1')
  const d = Number(parts[2] ?? '1')
  const raw = dateFormatter.format(new Date(y, m - 1, d))
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

const today = new Date()
const todayLongFr = new Intl.DateTimeFormat('fr-CH', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
}).format(today)
const todayCapitalized = todayLongFr.charAt(0).toUpperCase() + todayLongFr.slice(1)

const greeting = computed(() => {
  const first = auth.displayName.split(' ')[0] ?? auth.displayName
  return `Bonjour, ${first}`
})

function initialsForMember(memberId: string): string {
  const fallback = memberId.replace(/^m-/, '').split('-').map((p) => p.charAt(0).toUpperCase()).join('').slice(0, 2)
  return fallback || '??'
}

function officialsForMatch(matchId: string): string[] {
  return listAssignmentsForMatch(matchId).slice(0, 4).map((a) => initialsForMember(a.memberId))
}

function filledForMatch(match: MockMatch): number {
  return listAssignmentsForMatch(match.id).length
}

// ─── Header / notif ─────────────────────────────────────────────
const notifBadgeCount = computed(() => countUnread())

function onNotifClick(): void {
  router.push({ name: 'notifications' })
}

// ─── Tab bar dispatch ───────────────────────────────────────────
const mobileTabs = computed(() => {
  if (isMultiRole.value) return multiRoleTabs.value
  if (currentRole.value === 'coach') return coachTabs.value
  if (currentRole.value === 'official') return officialTabs.value
  return adminTabs.value
})

function onMobileTabSelect(index: number): void {
  const tabs = mobileTabs.value
  const target = tabs[index]
  if (!target) return
  if (isMultiRole.value) {
    // Multi-rôle : 4 onglets [Coach | Officiel | Admin | Notifs]
    if (index === 0) setRole('coach')
    else if (index === 1) setRole('official')
    else if (index === 2) setRole('admin')
    else router.push({ name: 'notifications' })
    return
  }
  // Mono-rôle : navigation classique selon le label.
  const map: Record<string, string> = {
    Équipes: 'team',
    Planning: 'planning',
    Inscriptions: 'registrations',
    'À pourvoir': 'matches-open',
    'Mes matchs': 'my-assignments',
    Staffing: 'staffing',
    Demandes: 'requests',
    Diffuser: 'broadcast',
    Notifs: 'notifications',
  }
  const routeName = map[target.label]
  if (routeName) router.push({ name: routeName })
}

// ─── Sidebar desktop ────────────────────────────────────────────
const desktopNav = computed(() => {
  if (currentRole.value === 'coach') return coachNav.value
  if (currentRole.value === 'official') return officialNav.value
  return adminNav.value
})

function onDesktopNavSelect(index: number): void {
  const items = desktopNav.value
  const target = items[index]
  if (!target) return
  if (target.label === 'Accueil') return
  const map: Record<string, string> = {
    'Mes équipes': 'team',
    Planning: 'planning',
    Inscriptions: 'registrations',
    'Matchs à pourvoir': 'matches-open',
    'Mes assignations': 'my-assignments',
    Staffing: 'staffing',
    Demandes: 'requests',
    Diffuser: 'broadcast',
    Notifications: 'notifications',
  }
  const routeName = map[target.label]
  if (routeName) router.push({ name: routeName })
}

const desktopUserRole = computed(() => {
  if (currentRole.value === 'coach') return 'Coach'
  if (currentRole.value === 'official') return 'Officiel'
  return 'Admin'
})

// ─── Actions ────────────────────────────────────────────────────
function openTeam(teamId: string): void {
  router.push({ name: 'team-roster', params: { teamId } })
}
function openRegistrations(): void {
  router.push({ name: 'registrations' })
}
function openExcluded(): void {
  const first = coachTeams.value[0]
  router.push(first ? { name: 'team-roster', params: { teamId: first.id } } : { name: 'team' })
}
function openAwayMatchCreate(): void {
  const first = coachTeams.value[0]
  router.push(first ? { name: 'away-match-create', params: { teamId: first.id } } : { name: 'team' })
}
function openMatchDetail(matchId: string): void {
  router.push({ name: 'match-detail', params: { id: matchId } })
}
function openMatchesOpen(): void {
  router.push({ name: 'matches-open' })
}
function openMyAssignments(): void {
  router.push({ name: 'my-assignments' })
}
function openRequests(kind?: 'license' | 'payment_exception' | 'match_move'): void {
  router.push(kind ? { name: 'requests', query: { kind } } : { name: 'requests' })
}
function openStaffing(): void {
  router.push({ name: 'staffing' })
}
function openBroadcast(): void {
  router.push({ name: 'broadcast' })
}
function confirmAssignment(assignmentId: string): void {
  logMockAction('home.assignment-confirm', { assignmentId })
}
function declineAssignment(assignmentId: string): void {
  logMockAction('home.assignment-decline', { assignmentId })
}
function addToCalendar(assignmentId: string): void {
  logMockAction('home.assignment-add-to-calendar', { assignmentId })
}

// ─── Banner officiel ────────────────────────────────────────────
const showNoLicenseBanner = computed(() => MOCK_NO_LICENSE || !auth.hasActiveOfficialLicense)

// ─── SectionTitle (helper du JSX, lignes 195-200) ───────────────
// Transcrit en composant fonctionnel pour rester littéral.
const SectionTitle: FunctionalComponent<unknown, Record<string, never>, { default?: () => VNode[]; action?: () => VNode[] }> = (
  _props,
  { slots },
) =>
  h(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 4px 6px',
      },
    },
    [
      h('h2', { class: 'cb-h2' }, slots.default ? slots.default() : []),
      slots.action ? slots.action() : null,
    ],
  )
</script>

<template>
  <!-- ─── Desktop ───────────────────────────────────────────────── -->
  <CbDesktopShell
    v-if="isDesktop"
    :items="desktopNav"
    :active="0"
    brand-name="BC Aigles"
    brand-sub="Saison 2025/26"
    club-initials="BCA"
    :user-name="auth.displayName"
    :user-role="desktopUserRole"
    @nav-select="onDesktopNavSelect"
  >
    <CbPageHead
      title="Accueil"
      :subtitle="`${auth.displayName} · Coach U16M, U14F · Officiel niveau 2 · ${todayCapitalized.toLowerCase()}.`"
    >
      <template v-if="isMultiRole" #actions>
        <div style="display: flex; gap: 6px">
          <button
            type="button"
            class="cb-chip"
            :class="{ active: currentRole === 'coach' }"
            @click="setRole('coach')"
          >
            Coach
          </button>
          <button
            type="button"
            class="cb-chip"
            :class="{ active: currentRole === 'official' }"
            @click="setRole('official')"
          >
            Officiel
          </button>
          <button
            type="button"
            class="cb-chip"
            :class="{ active: currentRole === 'admin' }"
            @click="setRole('admin')"
          >
            Admin
          </button>
        </div>
      </template>
    </CbPageHead>

    <div
      style="
        padding: 24px 28px;
        overflow: auto;
        display: grid;
        grid-template-columns: 1.5fr 1fr;
        gap: 24px;
        background: var(--bg-muted);
        flex: 1;
      "
    >
      <div style="display: flex; flex-direction: column; gap: 22px">
        <section>
          <SectionTitle>Mes équipes</SectionTitle>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px">
            <button
              v-for="t in coachTeams"
              :key="t.id"
              style="
                display: block;
                width: 100%;
                text-align: left;
                border: 0;
                background: transparent;
                padding: 0;
                cursor: pointer;
                font-family: inherit;
              "
              @click="openTeam(t.id)"
            >
              <div class="cb-card" style="position: relative; padding: 14px">
                <div
                  style="
                    display: flex;
                    justify-content: space-between;
                    gap: 10px;
                    align-items: flex-start;
                  "
                >
                  <div style="display: flex; align-items: center; gap: 10px">
                    <div class="cb-h3">{{ t.name }}</div>
                    <CbPill v-if="t.tagName" tone="slate">{{ t.tagName }}</CbPill>
                  </div>
                  <CbPill v-if="countExcludedInTeam(t.id) > 0" tone="rose" dot>
                    {{ countExcludedInTeam(t.id) }} exclus
                  </CbPill>
                </div>
                <div class="cb-sub" style="margin-top: 4px">
                  {{ t.playerIds.length }} joueurs<span v-if="t.nextTraining"> · prochain training {{ t.nextTraining }}</span>
                </div>
                <div v-if="t.categoryName" style="margin-top: 8px">
                  <CbPill tone="violet">{{ t.categoryName }}</CbPill>
                </div>
              </div>
            </button>
          </div>
        </section>

        <section>
          <SectionTitle>
            Matchs à pourvoir (officiel)
            <template #action>
              <a
                style="font-size: 13px; color: var(--emerald-700); font-weight: 600; cursor: pointer"
                @click="openMatchesOpen"
              >Voir tous</a>
            </template>
          </SectionTitle>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px">
            <CbMatchCard
              v-for="m in openMatchesForLevel"
              :key="m.id"
              :date="formatDate(m.date)"
              :time="m.startTime"
              :type="m.matchType"
              :opponent="m.opponent"
              :venue="m.venueLabel"
              :away="m.kind === 'away'"
              :staffing="{ filled: filledForMatch(m), total: m.requiredOfficialsTotal }"
              :officials="officialsForMatch(m.id)"
              style="cursor: pointer"
              @click="openMatchDetail(m.id)"
            />
          </div>
        </section>
      </div>

      <aside style="display: flex; flex-direction: column; gap: 14px">
        <SectionTitle>À traiter</SectionTitle>
        <div style="display: flex; flex-direction: column; gap: 10px">
          <button
            type="button"
            :style="`display: flex; align-items: center; gap: 12px; width: 100%; border: 0; background: var(--amber-50); padding: 12px 14px; border-radius: 12px; cursor: pointer; text-align: left; color: var(--amber-700); box-shadow: inset 0 0 0 1px var(--amber-200); font-family: inherit;`"
            @click="openRegistrations"
          >
            <div
              style="
                width: 34px;
                height: 34px;
                border-radius: 17px;
                background: var(--amber-100);
                display: flex;
                align-items: center;
                justify-content: center;
              "
            >
              <Clipboard :size="18" />
            </div>
            <div style="flex: 1; line-height: 1.2">
              <div style="font-weight: 600; font-size: 14px">
                {{ registrationsToTreatCount }} inscriptions à valider
              </div>
              <div style="font-size: 12px; opacity: 0.75; margin-top: 2px">à traiter</div>
            </div>
            <ChevronRight :size="18" />
          </button>

          <button
            type="button"
            :style="`display: flex; align-items: center; gap: 12px; width: 100%; border: 0; background: var(--rose-50); padding: 12px 14px; border-radius: 12px; cursor: pointer; text-align: left; color: var(--rose-700); box-shadow: inset 0 0 0 1px var(--rose-200); font-family: inherit;`"
            @click="openExcluded"
          >
            <div
              style="
                width: 34px;
                height: 34px;
                border-radius: 17px;
                background: var(--rose-100);
                display: flex;
                align-items: center;
                justify-content: center;
              "
            >
              <AlertTriangle :size="18" />
            </div>
            <div style="flex: 1; line-height: 1.2">
              <div style="font-weight: 600; font-size: 14px">
                {{ excludedMembersCount }} exclusions à gérer
              </div>
              <div style="font-size: 12px; opacity: 0.75; margin-top: 2px">à traiter</div>
            </div>
            <ChevronRight :size="18" />
          </button>

          <button
            type="button"
            :style="`display: flex; align-items: center; gap: 12px; width: 100%; border: 0; background: var(--violet-50); padding: 12px 14px; border-radius: 12px; cursor: pointer; text-align: left; color: var(--violet-700); box-shadow: inset 0 0 0 1px var(--violet-200); font-family: inherit;`"
            @click="openMyAssignments"
          >
            <div
              style="
                width: 34px;
                height: 34px;
                border-radius: 17px;
                background: var(--violet-100);
                display: flex;
                align-items: center;
                justify-content: center;
              "
            >
              <BellRing :size="18" />
            </div>
            <div style="flex: 1; line-height: 1.2">
              <div style="font-weight: 600; font-size: 14px">1 assignation pending</div>
              <div style="font-size: 12px; opacity: 0.75; margin-top: 2px">à traiter</div>
            </div>
            <ChevronRight :size="18" />
          </button>
        </div>

        <SectionTitle>Mes 3 prochaines assignations</SectionTitle>
        <div style="display: flex; flex-direction: column; gap: 10px">
          <div
            v-for="a in myAssignments"
            :key="a.id"
            style="
              background: var(--bg);
              border: 1px solid var(--border);
              border-radius: 10px;
              padding: 10px 12px;
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 10px;
            "
          >
            <div>
              <div class="mono" style="font-size: 12px; font-weight: 600">
                {{ a.match ? formatDate(a.match.date) : '—' }} · {{ a.match?.startTime ?? '—' }}
              </div>
              <div class="cb-sub" style="margin-top: 2px; color: var(--text)">
                {{ a.match?.opponent ?? 'Match inconnu' }}
              </div>
            </div>
            <CbPill :tone="a.status === 'confirmed' ? 'emerald' : 'amber'" dot>
              {{ a.status === 'confirmed' ? 'Confirmé' : 'Pending' }}
            </CbPill>
          </div>
        </div>
      </aside>
    </div>
  </CbDesktopShell>

  <!-- ─── Mobile multi-rôle ────────────────────────────────────── -->
  <CbMobileShell
    v-else-if="isMultiRole"
    title="Accueil"
    club="BCA"
    :notif-badge="notifBadgeCount > 0"
    :tabs="mobileTabs"
    :active-tab="currentRole === 'coach' ? 0 : currentRole === 'official' ? 1 : 2"
    @notif-click="onNotifClick"
    @tab-select="onMobileTabSelect"
  >
    <div style="height: 100%; overflow: auto">
      <div class="cb-chiprow" style="border-bottom: 0; padding-bottom: 4px">
        <button
          type="button"
          class="cb-chip"
          :class="{ active: currentRole === 'coach' }"
          @click="setRole('coach')"
        >
          Coach
        </button>
        <button
          type="button"
          class="cb-chip"
          :class="{ active: currentRole === 'official' }"
          @click="setRole('official')"
        >
          Officiel
        </button>
        <button
          type="button"
          class="cb-chip"
          :class="{ active: currentRole === 'admin' }"
          @click="setRole('admin')"
        >
          Admin
        </button>
      </div>
      <div class="cb-page" style="padding-top: 4px">
        <div>
          <div class="cb-h1" style="font-size: 22px">{{ greeting }}</div>
          <div class="cb-sub" style="margin-top: 2px">
            Coach prédominant · {{ todayCapitalized.toLowerCase() }}
          </div>
        </div>

        <SectionTitle>Mes équipes</SectionTitle>
        <button
          v-for="t in coachTeams"
          :key="t.id"
          style="
            display: block;
            width: 100%;
            text-align: left;
            border: 0;
            background: transparent;
            padding: 0;
            cursor: pointer;
            font-family: inherit;
          "
          @click="openTeam(t.id)"
        >
          <div class="cb-card" style="position: relative; padding: 14px">
            <div
              style="
                display: flex;
                justify-content: space-between;
                gap: 10px;
                align-items: flex-start;
              "
            >
              <div style="display: flex; align-items: center; gap: 10px">
                <div class="cb-h3">{{ t.name }}</div>
                <CbPill v-if="t.tagName" tone="slate">{{ t.tagName }}</CbPill>
              </div>
              <CbPill v-if="countExcludedInTeam(t.id) > 0" tone="rose" dot>
                {{ countExcludedInTeam(t.id) }} exclus
              </CbPill>
            </div>
            <div class="cb-sub" style="margin-top: 4px">
              {{ t.playerIds.length }} joueurs<span v-if="t.nextTraining"> · prochain training {{ t.nextTraining }}</span>
            </div>
            <div v-if="t.categoryName" style="margin-top: 8px">
              <CbPill tone="violet">{{ t.categoryName }}</CbPill>
            </div>
          </div>
        </button>

        <SectionTitle>À traiter</SectionTitle>
        <div style="display: flex; flex-direction: column; gap: 10px">
          <button
            type="button"
            :style="`display: flex; align-items: center; gap: 12px; width: 100%; border: 0; background: var(--amber-50); padding: 12px 14px; border-radius: 12px; cursor: pointer; text-align: left; color: var(--amber-700); box-shadow: inset 0 0 0 1px var(--amber-200); font-family: inherit;`"
            @click="openRegistrations"
          >
            <div
              style="
                width: 34px;
                height: 34px;
                border-radius: 17px;
                background: var(--amber-100);
                display: flex;
                align-items: center;
                justify-content: center;
              "
            >
              <Clipboard :size="18" />
            </div>
            <div style="flex: 1; line-height: 1.2">
              <div style="font-weight: 600; font-size: 14px">
                {{ registrationsToTreatCount }} inscriptions à valider
              </div>
              <div style="font-size: 12px; opacity: 0.75; margin-top: 2px">à traiter</div>
            </div>
            <ChevronRight :size="18" />
          </button>
          <button
            type="button"
            :style="`display: flex; align-items: center; gap: 12px; width: 100%; border: 0; background: var(--violet-50); padding: 12px 14px; border-radius: 12px; cursor: pointer; text-align: left; color: var(--violet-700); box-shadow: inset 0 0 0 1px var(--violet-200); font-family: inherit;`"
            @click="openMyAssignments"
          >
            <div
              style="
                width: 34px;
                height: 34px;
                border-radius: 17px;
                background: var(--violet-100);
                display: flex;
                align-items: center;
                justify-content: center;
              "
            >
              <BellRing :size="18" />
            </div>
            <div style="flex: 1; line-height: 1.2">
              <div style="font-weight: 600; font-size: 14px">1 assignation pending</div>
              <div style="font-size: 12px; opacity: 0.75; margin-top: 2px">à traiter</div>
            </div>
            <ChevronRight :size="18" />
          </button>
        </div>
      </div>
    </div>
  </CbMobileShell>

  <!-- ─── Mobile COACH (mono-rôle) ─────────────────────────────── -->
  <CbMobileShell
    v-else-if="currentRole === 'coach'"
    title="Accueil"
    club="BCA"
    :notif-badge="notifBadgeCount > 0"
    :tabs="mobileTabs"
    :active-tab="0"
    @notif-click="onNotifClick"
    @tab-select="onMobileTabSelect"
  >
    <div class="cb-page">
      <div>
        <div class="cb-h1" style="font-size: 22px">{{ greeting }}</div>
        <div class="cb-sub" style="margin-top: 2px">{{ todayCapitalized }}</div>
      </div>

      <SectionTitle>
        Mes équipes
        <template #action>
          <a
            style="font-size: 12px; color: var(--emerald-700); font-weight: 600; cursor: pointer"
            @click="router.push({ name: 'team' })"
          >Voir tout</a>
        </template>
      </SectionTitle>

      <template v-if="MOCK_LOADING_HOME">
        <div class="cb-skel" style="height: 86px; border-radius: 12px; margin-bottom: 10px"></div>
        <div class="cb-skel" style="height: 86px; border-radius: 12px"></div>
      </template>
      <template v-else>
        <button
          v-for="t in coachTeams"
          :key="t.id"
          style="
            display: block;
            width: 100%;
            text-align: left;
            border: 0;
            background: transparent;
            padding: 0;
            cursor: pointer;
            font-family: inherit;
          "
          @click="openTeam(t.id)"
        >
          <div class="cb-card" style="position: relative; padding: 14px">
            <div
              style="
                display: flex;
                justify-content: space-between;
                gap: 10px;
                align-items: flex-start;
              "
            >
              <div style="display: flex; align-items: center; gap: 10px">
                <div class="cb-h3">{{ t.name }}</div>
                <CbPill v-if="t.tagName" tone="slate">{{ t.tagName }}</CbPill>
              </div>
              <CbPill v-if="countExcludedInTeam(t.id) > 0" tone="rose" dot>
                {{ countExcludedInTeam(t.id) }} exclus
              </CbPill>
            </div>
            <div class="cb-sub" style="margin-top: 4px">
              {{ t.playerIds.length }} joueurs<span v-if="t.nextTraining"> · prochain training {{ t.nextTraining }}</span>
            </div>
            <div v-if="t.categoryName" style="margin-top: 8px">
              <CbPill tone="violet">{{ t.categoryName }}</CbPill>
            </div>
          </div>
        </button>
      </template>

      <SectionTitle>À traiter</SectionTitle>
      <div
        v-if="MOCK_LOADING_HOME"
        style="display: flex; flex-direction: column; gap: 10px"
      >
        <div class="cb-skel" style="height: 58px; border-radius: 12px"></div>
        <div class="cb-skel" style="height: 58px; border-radius: 12px"></div>
      </div>
      <div v-else style="display: flex; flex-direction: column; gap: 10px">
        <button
          type="button"
          :style="`display: flex; align-items: center; gap: 12px; width: 100%; border: 0; background: var(--amber-50); padding: 12px 14px; border-radius: 12px; cursor: pointer; text-align: left; color: var(--amber-700); box-shadow: inset 0 0 0 1px var(--amber-200); font-family: inherit;`"
          @click="openRegistrations"
        >
          <div
            style="
              width: 34px;
              height: 34px;
              border-radius: 17px;
              background: var(--amber-100);
              display: flex;
              align-items: center;
              justify-content: center;
            "
          >
            <Clipboard :size="18" />
          </div>
          <div style="flex: 1; line-height: 1.2">
            <div style="font-weight: 600; font-size: 14px">
              {{ registrationsToTreatCount }} inscriptions à valider
            </div>
            <div style="font-size: 12px; opacity: 0.75; margin-top: 2px">à traiter</div>
          </div>
          <ChevronRight :size="18" />
        </button>
        <button
          type="button"
          :style="`display: flex; align-items: center; gap: 12px; width: 100%; border: 0; background: var(--rose-50); padding: 12px 14px; border-radius: 12px; cursor: pointer; text-align: left; color: var(--rose-700); box-shadow: inset 0 0 0 1px var(--rose-200); font-family: inherit;`"
          @click="openExcluded"
        >
          <div
            style="
              width: 34px;
              height: 34px;
              border-radius: 17px;
              background: var(--rose-100);
              display: flex;
              align-items: center;
              justify-content: center;
            "
          >
            <AlertTriangle :size="18" />
          </div>
          <div style="flex: 1; line-height: 1.2">
            <div style="font-weight: 600; font-size: 14px">
              {{ excludedMembersCount }} exclusions à gérer
            </div>
            <div style="font-size: 12px; opacity: 0.75; margin-top: 2px">à traiter</div>
          </div>
          <ChevronRight :size="18" />
        </button>
      </div>
    </div>

    <CbBottomBar>
      <button class="cb-btn outline block" type="button" @click="openAwayMatchCreate">
        <Bus :size="16" />
        Créer un match à l'extérieur
      </button>
    </CbBottomBar>
  </CbMobileShell>

  <!-- ─── Mobile OFFICIEL (mono-rôle) ─────────────────────────── -->
  <CbMobileShell
    v-else-if="currentRole === 'official'"
    title="Accueil"
    club="BCA"
    :notif-badge="notifBadgeCount > 0"
    :tabs="mobileTabs"
    :active-tab="0"
    @notif-click="onNotifClick"
    @tab-select="onMobileTabSelect"
  >
    <div style="height: 100%; overflow: auto">
      <div style="padding: 14px 16px 0">
        <div class="cb-h1" style="font-size: 22px">{{ greeting }}</div>
        <div class="cb-sub" style="margin-top: 2px">{{ todayCapitalized }}</div>
      </div>

      <CbBanner v-if="showNoLicenseBanner" tone="amber" title="Pas de licence officiel active">
        <template #icon><AlertTriangle :size="18" /></template>
        L'auto-inscription est bloquée. Contactez votre admin pour la régulariser.
      </CbBanner>

      <div
        style="
          padding: 0 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-top: 14px;
        "
      >
        <SectionTitle>
          Matchs à pourvoir
          <template #action>
            <a
              style="font-size: 12px; color: var(--emerald-700); font-weight: 600; cursor: pointer"
              @click="openMatchesOpen"
            >Voir tous</a>
          </template>
        </SectionTitle>

        <CbMatchCard
          v-for="m in openMatchesForLevel"
          :key="m.id"
          :date="formatDate(m.date)"
          :time="m.startTime"
          :type="m.matchType"
          :opponent="m.opponent"
          :venue="m.venueLabel"
          :away="m.kind === 'away'"
          :staffing="{ filled: filledForMatch(m), total: m.requiredOfficialsTotal }"
          :officials="officialsForMatch(m.id)"
          style="cursor: pointer"
          @click="openMatchDetail(m.id)"
        />

        <SectionTitle>Mes assignations à venir</SectionTitle>

        <div
          v-for="(a, idx) in myAssignments"
          :key="a.id"
          class="cb-match"
          :style="
            idx === myAssignments.length - 1
              ? 'padding: 14px; padding-bottom: 0'
              : 'padding: 14px'
          "
        >
          <div class="top">
            <div>
              <div class="date">
                {{ a.match ? formatDate(a.match.date) : '—' }}<span class="time">{{ a.match?.startTime ?? '—' }}</span>
              </div>
              <div class="vs" style="margin-top: 4px">
                {{ a.match?.opponent ?? 'Match inconnu' }}
              </div>
              <div class="venue" style="margin-top: 6px">
                <MapPin :size="14" color="var(--slate-400)" />
                {{ a.match?.venueLabel ?? '—' }}
              </div>
            </div>
            <CbPill :tone="a.status === 'confirmed' ? 'emerald' : 'amber'" dot>
              {{ a.status === 'confirmed' ? 'Confirmé' : 'Pending' }}
            </CbPill>
          </div>

          <div
            v-if="a.status === 'pending'"
            style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px"
          >
            <button class="cb-btn outline sm" type="button" @click="declineAssignment(a.id)">
              <XCircle :size="14" />
              Décliner
            </button>
            <button class="cb-btn primary sm" type="button" @click="confirmAssignment(a.id)">
              <CheckCircle2 :size="14" />
              Confirmer
            </button>
          </div>
          <div
            v-else
            style="
              display: flex;
              gap: 6px;
              padding: 12px 0;
              border-top: 1px solid var(--border);
            "
          >
            <button class="cb-btn ghost sm" type="button" @click="addToCalendar(a.id)">
              <CalendarPlus :size="14" />
              Ajouter au calendrier
            </button>
          </div>
        </div>
      </div>
    </div>
  </CbMobileShell>

  <!-- ─── Mobile ADMIN (mono-rôle) ─────────────────────────────── -->
  <CbMobileShell
    v-else
    title="Accueil admin"
    club="BCA"
    :notif-badge="notifBadgeCount > 0"
    :tabs="mobileTabs"
    :active-tab="0"
    @notif-click="onNotifClick"
    @tab-select="onMobileTabSelect"
  >
    <div class="cb-page">
      <div class="cb-h1" style="font-size: 22px">{{ greeting }}</div>
      <div class="cb-sub" style="margin-top: -8px">
        Vue admin · {{ todayCapitalized.toLowerCase() }}
      </div>

      <SectionTitle>Demandes à traiter</SectionTitle>
      <div style="display: flex; flex-direction: column; gap: 10px">
        <button
          type="button"
          :style="`display: flex; align-items: center; gap: 12px; width: 100%; border: 0; background: var(--violet-50); padding: 12px 14px; border-radius: 12px; cursor: pointer; text-align: left; color: var(--violet-700); box-shadow: inset 0 0 0 1px var(--violet-200); font-family: inherit;`"
          @click="openRequests('license')"
        >
          <div
            style="
              width: 34px;
              height: 34px;
              border-radius: 17px;
              background: var(--violet-100);
              display: flex;
              align-items: center;
              justify-content: center;
            "
          >
            <Award :size="18" />
          </div>
          <div style="flex: 1; line-height: 1.2">
            <div style="font-weight: 600; font-size: 14px">
              {{ licenseRequestsCount }} demandes de licence
            </div>
            <div style="font-size: 12px; opacity: 0.75; margin-top: 2px">à traiter</div>
          </div>
          <ChevronRight :size="18" />
        </button>

        <button
          type="button"
          :style="`display: flex; align-items: center; gap: 12px; width: 100%; border: 0; background: var(--amber-50); padding: 12px 14px; border-radius: 12px; cursor: pointer; text-align: left; color: var(--amber-700); box-shadow: inset 0 0 0 1px var(--amber-200); font-family: inherit;`"
          @click="openRequests('payment_exception')"
        >
          <div
            style="
              width: 34px;
              height: 34px;
              border-radius: 17px;
              background: var(--amber-100);
              display: flex;
              align-items: center;
              justify-content: center;
            "
          >
            <Info :size="18" />
          </div>
          <div style="flex: 1; line-height: 1.2">
            <div style="font-weight: 600; font-size: 14px">
              {{ paymentExceptionRequestsCount }} exceptions cotisation
            </div>
            <div style="font-size: 12px; opacity: 0.75; margin-top: 2px">à traiter</div>
          </div>
          <ChevronRight :size="18" />
        </button>

        <button
          type="button"
          :style="`display: flex; align-items: center; gap: 12px; width: 100%; border: 0; background: var(--sky-50); padding: 12px 14px; border-radius: 12px; cursor: pointer; text-align: left; color: var(--sky-700); box-shadow: inset 0 0 0 1px var(--sky-200); font-family: inherit;`"
          @click="openRequests('match_move')"
        >
          <div
            style="
              width: 34px;
              height: 34px;
              border-radius: 17px;
              background: var(--sky-100);
              display: flex;
              align-items: center;
              justify-content: center;
            "
          >
            <Calendar :size="18" />
          </div>
          <div style="flex: 1; line-height: 1.2">
            <div style="font-weight: 600; font-size: 14px">
              {{ matchMoveRequestsCount }} déplacement de match
            </div>
            <div style="font-size: 12px; opacity: 0.75; margin-top: 2px">à traiter</div>
          </div>
          <ChevronRight :size="18" />
        </button>
      </div>

      <SectionTitle>Matchs à pourvoir (semaine)</SectionTitle>
      <CbMatchCard
        v-for="m in adminOpenHomeMatches"
        :key="m.id"
        :date="formatDate(m.date)"
        :time="m.startTime"
        :type="m.matchType"
        :opponent="m.opponent"
        :venue="m.venueLabel"
        :staffing="{ filled: filledForMatch(m), total: m.requiredOfficialsTotal }"
        :officials="officialsForMatch(m.id)"
        style="cursor: pointer"
        @click="openMatchDetail(m.id)"
      />
    </div>

    <CbBottomBar>
      <button class="cb-btn primary block" type="button" @click="openBroadcast">
        <Megaphone :size="16" />
        Envoyer une notification
      </button>
    </CbBottomBar>
  </CbMobileShell>
</template>
