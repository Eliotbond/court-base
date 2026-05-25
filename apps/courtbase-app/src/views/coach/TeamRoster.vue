<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Filter, MoreVertical, Plus } from 'lucide-vue-next'

import CbBottomBar from '@/components/ui/CbBottomBar.vue'
import CbDesktopShell from '@/components/ui/CbDesktopShell.vue'
import CbMemberRow from '@/components/ui/CbMemberRow.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbPageHead from '@/components/ui/CbPageHead.vue'
import CbPill, { type CbPillTone } from '@/components/ui/CbPill.vue'
import CbAvatar from '@/components/ui/CbAvatar.vue'
import CbSkel from '@/components/ui/CbSkel.vue'
import { useShellNav } from '@/composables/useShellNav'
import { useViewport } from '@/composables/useViewport'
import {
  getTeam as getTeamMock,
  listMembersByTeam as listMembersByTeamMock,
  logMockAction,
  type MockMember,
  type MockTeam,
} from '@/repositories/mock'
import { getTeam as getTeamReal } from '@/repositories/teams.repo'
import { useAuthStore } from '@/stores/auth'
import { useLicenseRequestsStore } from '@/stores/licenseRequests'
import { useMembersStore } from '@/stores/members'
import { canRequestLicense, licenseGateReason } from '@/utils/licenseGate'

/**
 * CO2 — Effectif d'équipe (coach).
 *
 * Transcription du JSX `coach.jsx` (lignes 58-120) enrichie pour la Phase
 * "gestion équipes coach" :
 *   - 3ᵉ onglet "Info" read-only (cotisation, créneaux préférés, tags, coachs).
 *   - Sub-header avec 3 stats inline (joueurs, prochain training, %
 *     cotisations payées).
 *   - Kebab `MoreVertical` sur chaque `CbMemberRow` du tab "Joueurs" qui
 *     ouvre un menu contextuel ("Voir la fiche" / "Demander licence"). Le
 *     menu "Demander licence" est **disabled** si le gate cotisation bloque
 *     la demande (`canRequestLicense(m)` faux), avec tooltip explicatif.
 *
 * Conventions : pas d'override des tokens, kebab menu inline (Teleport pour
 * sortir du flux). PrimeVue `Menu` évité ici pour rester homogène avec les
 * autres menus inline du brief design (cf. `CbUserMenu.vue`).
 */

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const membersStore = useMembersStore()
const licenseRequestsStore = useLicenseRequestsStore()
const { isDesktop } = useViewport()
const { tabs, nav, primaryRoleLabel } = useShellNav()

// ─── Param + team ────────────────────────────────────────────────
const teamId = computed<string>(() => {
  const p = route.params['teamId']
  return Array.isArray(p) ? (p[0] ?? '') : (p ?? '')
})

/**
 * Mode hybride (cf. `apps/courtbase-app/CLAUDE.md`) :
 *   - `useRealFirestore = true` quand le coach a un `userDoc.memberId` lié.
 *     On charge la team + ses members depuis Firestore.
 *   - `false` → fallback mock (mode démo /_design).
 */
const useRealFirestore = computed<boolean>(() => !!auth.userDoc?.memberId)

/** Team réelle chargée async (mode firestore). Null en mode mock. */
const realTeam = ref<MockTeam | null>(null)
/** True pendant le fetch initial de la team (mode firestore). */
const teamLoading = ref(false)

/**
 * Team unifié — résolu depuis le store firestore si dispo, sinon depuis le
 * mock. Garde la signature `MockTeam | null` que les templates consomment.
 */
const team = computed<MockTeam | null>(() => {
  if (!teamId.value) return null
  if (useRealFirestore.value) return realTeam.value
  return getTeamMock(teamId.value)
})

/**
 * True pendant un fetch (team OU members en mode firestore). En mode mock
 * c'est synchrone donc toujours `false` — on garde le getter pour le binding
 * uniforme des skeletons template.
 */
const isLoading = computed<boolean>(() => {
  if (!useRealFirestore.value) return false
  if (teamLoading.value) return true
  return membersStore.isLoadingForTeam(teamId.value)
})

// ─── Segmented control (Joueurs / Staff / Info) ──────────────────
type RosterTab = 'players' | 'staff' | 'info'
const activeRosterTab = ref<RosterTab>('players')

function selectRosterTab(tab: RosterTab): void {
  activeRosterTab.value = tab
  // Fermer un éventuel kebab ouvert quand on change d'onglet.
  openKebabMemberId.value = null
}

// ─── Players ─────────────────────────────────────────────────────
const players = computed<ReadonlyArray<MockMember>>(() => {
  if (!team.value) return []
  if (useRealFirestore.value) {
    return membersStore.getForTeam(team.value.id)
  }
  return listMembersByTeamMock(team.value.id)
})

// ─── Fetch Firestore (mode firestore uniquement) ─────────────────
/**
 * Charge la team puis ses members. Fait deux étapes pour qu'on connaisse
 * `team.playerIds` avant de fetch les members.
 *
 * Idempotence : refetch quand `teamId` change (navigation entre équipes
 * différentes via URL directe).
 */
async function loadFromFirestore(): Promise<void> {
  if (!useRealFirestore.value || !teamId.value) return
  teamLoading.value = true
  realTeam.value = null
  try {
    const t = await getTeamReal(teamId.value)
    realTeam.value = t
    if (t) {
      await membersStore.loadForTeam(t.id, t.playerIds)
      // Hydrate le cache des demandes de licence en best-effort : permet
      // au kebab d'afficher "Demande en cours" pour les joueurs concernés
      // sans bloquer le rendu initial des rows.
      void licenseRequestsStore.hydrateForMembers(t.playerIds)
    }
  } finally {
    teamLoading.value = false
  }
}

onMounted(() => {
  void loadFromFirestore()
})

// Re-fetch quand le user navigue entre `/team/:teamId` avec teamIds différents
// (cas direct URL ou back/forward navigateur).
watch(
  () => [useRealFirestore.value, teamId.value] as const,
  () => {
    void loadFromFirestore()
  },
)

// ─── Staff (mock inline — pas encore exposé par le repo) ─────────
interface StaffEntry {
  id: string
  name: string
  sub: string
  avatarTone?: 'emerald' | 'sky' | 'amber' | 'violet' | 'rose'
}

const staff = computed<ReadonlyArray<StaffEntry>>(() => [
  { id: 'staff-mathieu', name: 'Mathieu Brun', sub: 'Coach principal', avatarTone: 'emerald' },
  { id: 'staff-olivia', name: 'Olivia Chappuis', sub: 'Coach assistante', avatarTone: 'sky' },
  { id: 'staff-pierre', name: 'Pierre Dubois', sub: 'Officiel rattaché', avatarTone: 'violet' },
])

// ─── Pills — mapping (dues + license), cf. ROSTER du JSX ─────────
interface PillDef {
  tone: CbPillTone
  label: string
  dot?: boolean
}

function memberSub(m: MockMember): string {
  const [y, mo, d] = m.birthDate.split('-')
  const dateLabel = `${d}.${mo}.${y}`
  if (m.duesStatus === 'excluded') {
    return 'Cotisation impayée'
  }
  if (m.licenseNumber) {
    const shortLic = m.licenseNumber.replace(/^LIC-\d{4}-/, 'n° ')
    return `${dateLabel} · ${shortLic}`
  }
  return dateLabel
}

function avatarToneOf(m: MockMember): 'emerald' | 'sky' | 'amber' | 'violet' | 'rose' | undefined {
  if (m.avatarTone) return m.avatarTone
  switch (m.duesStatus) {
    case 'paid':
      return 'emerald'
    case 'issued':
    case 'pending_grace':
    case 'overdue':
      return 'amber'
    case 'excepted':
      return 'violet'
    case 'excluded':
      return 'rose'
    default:
      return 'sky'
  }
}

function pillsOf(m: MockMember): PillDef[] {
  if (m.duesStatus === 'excluded') {
    return [{ tone: 'rose', label: 'Exclu', dot: true }]
  }
  const out: PillDef[] = []
  switch (m.duesStatus) {
    case 'paid':
      out.push({ tone: 'emerald', label: 'Payée', dot: true })
      break
    case 'excepted':
      out.push({ tone: 'violet', label: 'Exception pending', dot: true })
      break
    default:
      out.push({ tone: 'amber', label: 'En attente', dot: true })
  }
  if (m.licenseNumber) out.push({ tone: 'emerald', label: 'Licencié', dot: true })
  else out.push({ tone: 'slate', label: 'Non licencié', dot: true })
  return out
}

// ─── Sub-header stats ────────────────────────────────────────────
const paidPercent = computed<number>(() => {
  if (players.value.length === 0) return 0
  const paid = players.value.filter(
    (m) => m.duesStatus === 'paid' || m.duesStatus === 'excepted',
  ).length
  return Math.round((paid / players.value.length) * 100)
})

const nextTrainingShort = computed<string>(() => {
  if (!team.value?.nextTraining) return '—'
  const [first] = team.value.nextTraining.split(' · ')
  return first ?? team.value.nextTraining
})

// ─── Kebab menu sur les rows joueurs ─────────────────────────────
const openKebabMemberId = ref<string | null>(null)

function toggleKebab(memberId: string, ev: Event): void {
  ev.stopPropagation()
  openKebabMemberId.value = openKebabMemberId.value === memberId ? null : memberId
}

function closeKebab(): void {
  openKebabMemberId.value = null
}

// Click ailleurs → ferme le menu.
function onDocClick(): void {
  openKebabMemberId.value = null
}
onMounted(() => {
  document.addEventListener('click', onDocClick)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
})

// ─── Actions kebab ───────────────────────────────────────────────
function actionViewMember(memberId: string): void {
  closeKebab()
  logMockAction('co2.kebab.view-member', { teamId: teamId.value, memberId })
  router.push({ name: 'member', params: { memberId } })
}

function actionRequestLicense(memberId: string): void {
  closeKebab()
  const m = players.value.find((p) => p.id === memberId)
  if (!m) return
  // Si une demande existe déjà → no-op (le kebab item est désactivé, mais
  // on évite l'action en cas de race ou de re-render asynchrone).
  if (licenseRequestsStore.existingForMember(memberId)) return
  if (!canRequestLicense(m)) return // garde-fou (déjà disabled UI)
  logMockAction('co2.kebab.request-license', { teamId: teamId.value, memberId })
  router.push({
    name: 'member',
    params: { memberId },
    query: { action: 'request-license' },
  })
}

// ─── Kebab item — état "Demande licence" 3-way ────────────────────
// 1. Demande existante → label "Demande de licence en cours" + disabled.
// 2. Gate cotisation OK → "Demander licence" enabled.
// 3. Sinon → "Demander licence" disabled avec tooltip = raison du gate.

function licenseKebabLabel(memberId: string): string {
  if (licenseRequestsStore.existingForMember(memberId)) {
    return 'Demande de licence en cours'
  }
  return 'Demander licence'
}

function licenseKebabDisabled(m: MockMember): boolean {
  if (licenseRequestsStore.existingForMember(m.id)) return true
  return !canRequestLicense(m)
}

function licenseKebabTooltip(m: MockMember): string | undefined {
  if (licenseRequestsStore.existingForMember(m.id)) {
    return 'Une demande est déjà en cours. Le suivi sera disponible en PR2.'
  }
  return licenseGateReason(m) ?? undefined
}

// ─── Navigation principale ───────────────────────────────────────
function openMember(memberId: string): void {
  logMockAction('co2.open-member', { teamId: teamId.value, memberId })
  router.push({ name: 'member', params: { memberId } })
}

function openNewMember(): void {
  logMockAction('co2.new-member', { teamId: teamId.value })
  router.push({ name: 'member-new' })
}

function onBack(): void {
  router.push({ name: 'team' })
}

function onTabSelect(index: number): void {
  if (index === 0) router.push({ name: 'team' })
  else if (index === 1) {
    if (team.value) router.push({ name: 'planning', params: { teamId: team.value.id } })
    else router.push({ name: 'home' })
  } else if (index === 2) router.push({ name: 'registrations' })
}

function onNavSelect(index: number): void {
  if (index === 0) router.push({ name: 'home' })
  else if (index === 1) router.push({ name: 'team' })
  else if (index === 2) {
    if (team.value) router.push({ name: 'planning', params: { teamId: team.value.id } })
    else router.push({ name: 'home' })
  } else if (index === 3) router.push({ name: 'registrations' })
}

// ─── Labels segmented ────────────────────────────────────────────
const playersTabLabel = computed(() => `Joueurs · ${players.value.length}`)
const staffTabLabel = computed(() => `Staff · ${staff.value.length}`)
const infoTabLabel = computed(() => 'Info')

const desktopSubtitle = computed(() => {
  if (!team.value) return ''
  const n = players.value.length
  const cat = team.value.categoryName ?? '—'
  return `${n} joueur${n > 1 ? 's' : ''} · ${cat} · saison 2025/26`
})

// Nombre de rows skeleton à afficher
const SKEL_COUNT = 6
</script>

<template>
  <!-- ─── Desktop ≥ 1024px ─────────────────────────────────────── -->
  <CbDesktopShell
    v-if="isDesktop"
    :items="nav"
    brand-name="BC Aigles"
    brand-sub="Saison 2025/26"
    club-initials="BCA"
    :user-name="auth.displayName"
    :user-role="primaryRoleLabel"
    @nav-select="onNavSelect"
  >
    <CbPageHead
      :title="team?.name ?? 'U16M Compétition'"
      :subtitle="desktopSubtitle || '14 joueurs · CSJC · saison 2025/26'"
    >
      <template #actions>
        <button class="cb-btn outline" type="button">
          <Filter :size="16" />
          Filtrer
        </button>
        <button class="cb-btn primary" type="button" @click="openNewMember">
          <Plus :size="16" />
          Ajouter un joueur
        </button>
      </template>
    </CbPageHead>

    <!-- RosterTabs (étendu avec onglet Info) ───────────────── -->
    <div
      style="display: flex; padding: 0 16px; border-bottom: 1px solid var(--border); background: var(--bg); gap: 16px"
    >
      <button
        type="button"
        :style="`border: 0; background: transparent; padding: 12px 0; font-family: inherit; font-size: 13px; font-weight: ${activeRosterTab === 'players' ? 600 : 500}; color: ${activeRosterTab === 'players' ? 'var(--text)' : 'var(--text-subtle)'}; border-bottom: ${activeRosterTab === 'players' ? '2px solid var(--emerald-600)' : '2px solid transparent'}; margin-bottom: -1px; cursor: pointer;`"
        @click="selectRosterTab('players')"
      >
        {{ playersTabLabel }}
      </button>
      <button
        type="button"
        :style="`border: 0; background: transparent; padding: 12px 0; font-family: inherit; font-size: 13px; font-weight: ${activeRosterTab === 'staff' ? 600 : 500}; color: ${activeRosterTab === 'staff' ? 'var(--text)' : 'var(--text-subtle)'}; border-bottom: ${activeRosterTab === 'staff' ? '2px solid var(--emerald-600)' : '2px solid transparent'}; margin-bottom: -1px; cursor: pointer;`"
        @click="selectRosterTab('staff')"
      >
        {{ staffTabLabel }}
      </button>
      <button
        type="button"
        :style="`border: 0; background: transparent; padding: 12px 0; font-family: inherit; font-size: 13px; font-weight: ${activeRosterTab === 'info' ? 600 : 500}; color: ${activeRosterTab === 'info' ? 'var(--text)' : 'var(--text-subtle)'}; border-bottom: ${activeRosterTab === 'info' ? '2px solid var(--emerald-600)' : '2px solid transparent'}; margin-bottom: -1px; cursor: pointer;`"
        @click="selectRosterTab('info')"
      >
        {{ infoTabLabel }}
      </button>
    </div>

    <div style="padding: 28px; overflow: auto; background: var(--bg-muted)">
      <div v-if="activeRosterTab !== 'info'" class="cb-card flush" style="background: var(--bg)">
        <!-- Onglet "Joueurs" -->
        <template v-if="activeRosterTab === 'players'">
          <template v-if="isLoading">
            <div
              v-for="i in SKEL_COUNT"
              :key="`skel-d-${i}`"
              style="display: flex; gap: 12px; align-items: center; padding: 14px 16px; border-bottom: 1px solid var(--border); background: var(--bg)"
            >
              <CbSkel w="36px" :h="36" style="border-radius: 18px" />
              <div style="flex: 1; display: flex; flex-direction: column; gap: 8px">
                <CbSkel w="55%" :h="11" />
                <CbSkel w="35%" :h="9" />
                <div style="display: flex; gap: 6px; margin-top: 4px">
                  <CbSkel w="60px" :h="16" />
                  <CbSkel w="80px" :h="16" />
                </div>
              </div>
            </div>
          </template>
          <template v-else>
            <CbMemberRow
              v-for="m in players"
              :key="m.id"
              :name="`${m.firstName} ${m.lastName}`"
              :sub="memberSub(m)"
              :avatar-tone="avatarToneOf(m)"
              :faded="m.duesStatus === 'excluded'"
              role="button"
              tabindex="0"
              style="cursor: pointer"
              @click="openMember(m.id)"
              @keyup.enter="openMember(m.id)"
            >
              <template #pills>
                <CbPill
                  v-for="(p, i) in pillsOf(m)"
                  :key="i"
                  :tone="p.tone"
                  :dot="p.dot"
                >
                  {{ p.label }}
                </CbPill>
              </template>
              <template #right>
                <div class="co2-kebab-wrap" @click.stop>
                  <button
                    type="button"
                    class="cb-iconbtn"
                    aria-label="Plus d'options pour ce joueur"
                    @click="(ev) => toggleKebab(m.id, ev)"
                  >
                    <MoreVertical :size="18" />
                  </button>
                  <div v-if="openKebabMemberId === m.id" class="co2-kebab-menu">
                    <button
                      type="button"
                      class="co2-kebab-item"
                      @click="actionViewMember(m.id)"
                    >
                      Voir la fiche
                    </button>
                    <button
                      type="button"
                      class="co2-kebab-item"
                      :disabled="licenseKebabDisabled(m)"
                      :title="licenseKebabTooltip(m)"
                      @click="actionRequestLicense(m.id)"
                    >
                      {{ licenseKebabLabel(m.id) }}
                    </button>
                  </div>
                </div>
              </template>
            </CbMemberRow>
          </template>
        </template>

        <!-- Onglet "Staff" -->
        <template v-else>
          <CbMemberRow
            v-for="s in staff"
            :key="s.id"
            :name="s.name"
            :sub="s.sub"
            :avatar-tone="s.avatarTone"
            hide-chev
          >
            <template #pills>
              <CbPill tone="violet" dot>Staff</CbPill>
            </template>
          </CbMemberRow>
        </template>
      </div>

      <!-- Onglet "Info" (read-only) -->
      <div v-else style="display: grid; gap: 14px">
        <div class="cb-card" style="padding: 14px">
          <div class="cb-section-label" style="padding: 0 0 6px">Cotisation</div>
          <div style="font-weight: 600; font-size: 15px">
            CHF {{ team?.cotisationPrice ?? '—' }}
          </div>
          <div class="cb-sub" style="margin-top: 2px">Prix saison 2025/26</div>
        </div>

        <div class="cb-card" style="padding: 14px">
          <div class="cb-section-label" style="padding: 0 0 6px">Créneaux préférés</div>
          <div v-if="team?.preferredSlots?.length" style="display: flex; gap: 6px; flex-wrap: wrap">
            <CbPill v-for="slot in team.preferredSlots" :key="slot" tone="slate">
              {{ slot }}
            </CbPill>
          </div>
          <div v-else class="cb-sub" style="font-style: italic">Aucun créneau renseigné</div>
        </div>

        <div class="cb-card" style="padding: 14px">
          <div class="cb-section-label" style="padding: 0 0 6px">Tags</div>
          <div style="display: flex; gap: 6px; flex-wrap: wrap">
            <CbPill v-if="team?.tagName" :tone="(team.tagColor as CbPillTone) ?? 'violet'">
              {{ team.tagName }}
            </CbPill>
            <CbPill v-if="team?.categoryName" tone="slate">{{ team.categoryName }}</CbPill>
            <span v-if="!team?.tagName && !team?.categoryName" class="cb-sub" style="font-style: italic">
              Aucun tag
            </span>
          </div>
        </div>

        <div class="cb-card" style="padding: 14px">
          <div class="cb-section-label" style="padding: 0 0 6px">Coachs</div>
          <div v-if="staff.length" style="display: flex; flex-direction: column; gap: 8px">
            <div
              v-for="s in staff"
              :key="s.id"
              style="display: flex; gap: 10px; align-items: center"
            >
              <CbAvatar :name="s.name" :tone="s.avatarTone" size="sm" />
              <div>
                <div style="font-weight: 600; font-size: 13px">{{ s.name }}</div>
                <div class="cb-sub" style="font-size: 12px">{{ s.sub }}</div>
              </div>
            </div>
          </div>
          <div v-else class="cb-sub" style="font-style: italic">Aucun coach assigné</div>
        </div>
      </div>
    </div>
  </CbDesktopShell>

  <!-- ─── Mobile < 1024px ──────────────────────────────────────── -->
  <CbMobileShell
    v-else
    title="Effectif"
    show-back
    :tabs="tabs"
    @back="onBack"
    @tab-select="onTabSelect"
  >
    <!-- Sub-header avec 3 stats inline ─────────────────────── -->
    <div style="padding: 14px 16px 6px; background: var(--bg)">
      <div class="cb-h2">{{ team?.name ?? 'U16M Compétition' }}</div>
      <div
        class="cb-sub"
        style="margin-top: 4px; display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px"
      >
        <span>{{ players.length || 14 }} joueurs</span>
        <span>·</span>
        <span>Prochain : {{ nextTrainingShort }}</span>
        <span>·</span>
        <span>{{ paidPercent }}% cotisations payées</span>
      </div>
    </div>

    <!-- RosterTabs étendu (3 onglets) ──────────────────────── -->
    <div
      style="display: flex; padding: 0 16px; border-bottom: 1px solid var(--border); background: var(--bg); gap: 16px"
    >
      <button
        type="button"
        :style="`border: 0; background: transparent; padding: 12px 0; font-family: inherit; font-size: 13px; font-weight: ${activeRosterTab === 'players' ? 600 : 500}; color: ${activeRosterTab === 'players' ? 'var(--text)' : 'var(--text-subtle)'}; border-bottom: ${activeRosterTab === 'players' ? '2px solid var(--emerald-600)' : '2px solid transparent'}; margin-bottom: -1px; cursor: pointer;`"
        @click="selectRosterTab('players')"
      >
        {{ playersTabLabel }}
      </button>
      <button
        type="button"
        :style="`border: 0; background: transparent; padding: 12px 0; font-family: inherit; font-size: 13px; font-weight: ${activeRosterTab === 'staff' ? 600 : 500}; color: ${activeRosterTab === 'staff' ? 'var(--text)' : 'var(--text-subtle)'}; border-bottom: ${activeRosterTab === 'staff' ? '2px solid var(--emerald-600)' : '2px solid transparent'}; margin-bottom: -1px; cursor: pointer;`"
        @click="selectRosterTab('staff')"
      >
        {{ staffTabLabel }}
      </button>
      <button
        type="button"
        :style="`border: 0; background: transparent; padding: 12px 0; font-family: inherit; font-size: 13px; font-weight: ${activeRosterTab === 'info' ? 600 : 500}; color: ${activeRosterTab === 'info' ? 'var(--text)' : 'var(--text-subtle)'}; border-bottom: ${activeRosterTab === 'info' ? '2px solid var(--emerald-600)' : '2px solid transparent'}; margin-bottom: -1px; cursor: pointer;`"
        @click="selectRosterTab('info')"
      >
        {{ infoTabLabel }}
      </button>
    </div>

    <!-- Liste / Info ─────────────────────────────────────── -->
    <div style="flex: 1; overflow: auto">
      <!-- Onglet "Joueurs" -->
      <template v-if="activeRosterTab === 'players'">
        <template v-if="isLoading">
          <div
            v-for="i in SKEL_COUNT"
            :key="`skel-m-${i}`"
            style="display: flex; gap: 12px; align-items: center; padding: 14px 16px; border-bottom: 1px solid var(--border); background: var(--bg)"
          >
            <CbSkel w="36px" :h="36" style="border-radius: 18px" />
            <div style="flex: 1; display: flex; flex-direction: column; gap: 8px">
              <CbSkel w="55%" :h="11" />
              <CbSkel w="35%" :h="9" />
              <div style="display: flex; gap: 6px; margin-top: 4px">
                <CbSkel w="60px" :h="16" />
                <CbSkel w="80px" :h="16" />
              </div>
            </div>
          </div>
        </template>
        <template v-else>
          <CbMemberRow
            v-for="m in players"
            :key="m.id"
            :name="`${m.firstName} ${m.lastName}`"
            :sub="memberSub(m)"
            :avatar-tone="avatarToneOf(m)"
            :faded="m.duesStatus === 'excluded'"
            role="button"
            tabindex="0"
            style="cursor: pointer"
            @click="openMember(m.id)"
            @keyup.enter="openMember(m.id)"
          >
            <template #pills>
              <CbPill
                v-for="(p, i) in pillsOf(m)"
                :key="i"
                :tone="p.tone"
                :dot="p.dot"
              >
                {{ p.label }}
              </CbPill>
            </template>
            <template #right>
              <div class="co2-kebab-wrap" @click.stop>
                <button
                  type="button"
                  class="cb-iconbtn"
                  aria-label="Plus d'options pour ce joueur"
                  @click="(ev) => toggleKebab(m.id, ev)"
                >
                  <MoreVertical :size="18" />
                </button>
                <div v-if="openKebabMemberId === m.id" class="co2-kebab-menu">
                  <button
                    type="button"
                    class="co2-kebab-item"
                    @click="actionViewMember(m.id)"
                  >
                    Voir la fiche
                  </button>
                  <button
                    type="button"
                    class="co2-kebab-item"
                    :disabled="licenseKebabDisabled(m)"
                    :title="licenseKebabTooltip(m)"
                    @click="actionRequestLicense(m.id)"
                  >
                    {{ licenseKebabLabel(m.id) }}
                  </button>
                </div>
              </div>
            </template>
          </CbMemberRow>
        </template>
      </template>

      <!-- Onglet "Staff" -->
      <template v-else-if="activeRosterTab === 'staff'">
        <CbMemberRow
          v-for="s in staff"
          :key="s.id"
          :name="s.name"
          :sub="s.sub"
          :avatar-tone="s.avatarTone"
          hide-chev
        >
          <template #pills>
            <CbPill tone="violet" dot>Staff</CbPill>
          </template>
        </CbMemberRow>
      </template>

      <!-- Onglet "Info" (read-only) -->
      <template v-else>
        <div style="padding: 14px 16px; display: grid; gap: 12px">
          <div class="cb-card" style="padding: 14px">
            <div class="cb-section-label" style="padding: 0 0 6px">Cotisation</div>
            <div style="font-weight: 600; font-size: 15px">
              CHF {{ team?.cotisationPrice ?? '—' }}
            </div>
            <div class="cb-sub" style="margin-top: 2px">Prix saison 2025/26</div>
          </div>

          <div class="cb-card" style="padding: 14px">
            <div class="cb-section-label" style="padding: 0 0 6px">Créneaux préférés</div>
            <div v-if="team?.preferredSlots?.length" style="display: flex; gap: 6px; flex-wrap: wrap">
              <CbPill v-for="slot in team.preferredSlots" :key="slot" tone="slate">
                {{ slot }}
              </CbPill>
            </div>
            <div v-else class="cb-sub" style="font-style: italic">
              Aucun créneau renseigné
            </div>
          </div>

          <div class="cb-card" style="padding: 14px">
            <div class="cb-section-label" style="padding: 0 0 6px">Tags</div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap">
              <CbPill v-if="team?.tagName" :tone="(team.tagColor as CbPillTone) ?? 'violet'">
                {{ team.tagName }}
              </CbPill>
              <CbPill v-if="team?.categoryName" tone="slate">{{ team.categoryName }}</CbPill>
              <span
                v-if="!team?.tagName && !team?.categoryName"
                class="cb-sub"
                style="font-style: italic"
              >
                Aucun tag
              </span>
            </div>
          </div>

          <div class="cb-card" style="padding: 14px">
            <div class="cb-section-label" style="padding: 0 0 6px">Coachs</div>
            <div v-if="staff.length" style="display: flex; flex-direction: column; gap: 10px">
              <div
                v-for="s in staff"
                :key="s.id"
                style="display: flex; gap: 10px; align-items: center"
              >
                <CbAvatar :name="s.name" :tone="s.avatarTone" size="sm" />
                <div>
                  <div style="font-weight: 600; font-size: 13px">{{ s.name }}</div>
                  <div class="cb-sub" style="font-size: 12px">{{ s.sub }}</div>
                </div>
              </div>
            </div>
            <div v-else class="cb-sub" style="font-style: italic">
              Aucun coach assigné
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- BottomBar CTA (JSX lignes 97-99) -->
    <CbBottomBar v-if="activeRosterTab !== 'info'">
      <button class="cb-btn primary block lg" type="button" @click="openNewMember">
        <Plus :size="16" />
        Ajouter un joueur
      </button>
    </CbBottomBar>
  </CbMobileShell>
</template>

<style scoped>
/**
 * Kebab menu inline (cohérent avec CbUserMenu et co4-kebab-menu de
 * MemberDetail). Positionné en absolute sous le bouton.
 */
.co2-kebab-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.co2-kebab-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 30;
  min-width: 180px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.co2-kebab-item {
  padding: 8px 10px;
  border-radius: 6px;
  border: 0;
  background: transparent;
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
}
.co2-kebab-item:hover:not(:disabled) {
  background: var(--bg-muted);
}
.co2-kebab-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
