<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronRight, Search, Users } from 'lucide-vue-next'

import CbDesktopShell from '@/components/ui/CbDesktopShell.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbPageHead from '@/components/ui/CbPageHead.vue'
import CbPill from '@/components/ui/CbPill.vue'
import CbEmptyState from '@/components/ui/CbEmptyState.vue'
import CbSkel from '@/components/ui/CbSkel.vue'

import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import InputText from 'primevue/inputtext'

import { useViewport } from '@/composables/useViewport'
import { useShellNav } from '@/composables/useShellNav'
import { useAuthStore } from '@/stores/auth'
import { useTeamsStore } from '@/stores/teams'

/**
 * CO1 — Mes équipes (coach).
 *
 * Liste filtrable des équipes coachées par l'utilisateur. Reprend la
 * transcription littérale du JSX `screens/coach.jsx` (TeamCardCO) pour la
 * card équipe, et l'enrichit avec :
 *   - sub-header dynamique `"N équipes · saison 2025/26"` ;
 *   - search input sticky en haut (IconField PrimeVue) ;
 *   - chips horizontales scrollables (catégories + "Sans coach") inspirées
 *     du segmented control de TeamRoster ;
 *   - card équipe enrichie d'une ligne "Coachs : Mathieu B., +N" et de
 *     pills alertes (`exclus` rose, `sans coach` amber).
 *
 * Données : `useTeamsStore()` qui consomme `listTeamsForCoach` + filtres
 * en computed. Toggle `MOCK_LOADING` pour visualiser les skeletons.
 */

const MOCK_EMPTY = false
const MOCK_LOADING = false
const MOCK_SEASON_LABEL = 'saison 2025/26'

const router = useRouter()
const auth = useAuthStore()
const teamsStore = useTeamsStore()
const { isDesktop } = useViewport()
const { tabs, nav } = useShellNav()

// Charge à l'init. Si le user a un `memberId` réel (userDoc.memberId), on
// frappe Firestore ; sinon on retombe sur le mock pour le mode démo.
onMounted(() => {
  void teamsStore.loadForCoach(auth.userDoc?.memberId ?? null, auth.uid)
})

// ─── Card équipe enrichie (dérivée du store) ──────────────────────
interface TeamCardData {
  id: string
  name: string
  /** Catégorie courte (U16M, U14F, ...) — pill slate top. */
  categoryName: string
  /** Tag (Compétition / Loisir / Élite) — pill violet bas. */
  tagName: string | null
  count: number
  nextTraining: string
  /** Alertes affichées en pills à droite. */
  alerts: Array<{ tone: 'rose' | 'amber'; label: string }>
  /** Ligne "Coachs : X, +N" — affichée sous le count. */
  coachLine: string
}

function shortNextTraining(nt: string | null | undefined): string {
  if (!nt) return ''
  const [first] = nt.split(' · ')
  return first ?? nt
}

/**
 * Mapping coach id → libellé court.
 *
 * En mode `firestore`, `coachIds` contient des `memberId`s ; en mode `mock`,
 * des uid (cohérent avec les seeds). On compare donc avec l'identifiant qui
 * a servi à charger la liste : `userDoc.memberId` côté réel, `auth.uid`
 * côté mock. À terme (membres réels branchés), on lira le `displayName`
 * via un store members ; pour l'instant on garde "Moi" en libellé.
 */
function coachLineFor(coachIds: string[]): string {
  if (coachIds.length === 0) return 'Sans coach'
  const myId =
    teamsStore.source === 'firestore' ? (auth.userDoc?.memberId ?? null) : auth.uid
  const meIdx = myId ? coachIds.indexOf(myId) : -1
  const others = coachIds.length - (meIdx >= 0 ? 1 : 0)
  const meLabel = meIdx >= 0 ? 'Moi' : null
  if (meLabel && others === 0) return `Coachs : ${meLabel}`
  if (meLabel) return `Coachs : ${meLabel}, +${others}`
  return `Coachs : ${coachIds.length}`
}

const teamCards = computed<ReadonlyArray<TeamCardData>>(() =>
  teamsStore.filtered.map((team) => {
    const stats = teamsStore.teamStats.get(team.id) ?? { count: 0, excluded: 0 }
    const alerts: TeamCardData['alerts'] = []
    if (stats.excluded > 0) alerts.push({ tone: 'rose', label: `${stats.excluded} exclus` })
    if (team.coachIds.length === 0) alerts.push({ tone: 'amber', label: 'Sans coach' })
    return {
      id: team.id,
      name: team.name,
      categoryName: team.categoryName,
      tagName: team.tagName,
      count: stats.count,
      nextTraining: shortNextTraining(team.nextTraining),
      alerts,
      coachLine: coachLineFor(team.coachIds),
    }
  }),
)

// ─── Sub-header dynamique ─────────────────────────────────────────
const subheaderLabel = computed(() => {
  const n = teamsStore.counts.total
  return `${n} équipe${n > 1 ? 's' : ''} · ${MOCK_SEASON_LABEL}`
})

// ─── Chips filtres ────────────────────────────────────────────────
interface ChipDef {
  key: 'cat-all' | string
  label: string
  active: boolean
  onClick: () => void
}

const filterChips = computed<ChipDef[]>(() => {
  const chips: ChipDef[] = []
  chips.push({
    key: 'cat-all',
    label: 'Toutes',
    active: teamsStore.categoryFilter === 'all' && teamsStore.coachStateFilter === 'all',
    onClick: () => {
      teamsStore.setCategoryFilter('all')
      teamsStore.setCoachStateFilter('all')
    },
  })
  for (const cat of teamsStore.categories) {
    chips.push({
      key: `cat-${cat}`,
      label: cat,
      active: teamsStore.categoryFilter === cat,
      onClick: () => {
        teamsStore.setCategoryFilter(teamsStore.categoryFilter === cat ? 'all' : cat)
      },
    })
  }
  chips.push({
    key: 'needs-coach',
    label: `Sans coach${teamsStore.counts.needsCoach ? ` · ${teamsStore.counts.needsCoach}` : ''}`,
    active: teamsStore.coachStateFilter === 'needsCoach',
    onClick: () => {
      teamsStore.setCoachStateFilter(
        teamsStore.coachStateFilter === 'needsCoach' ? 'all' : 'needsCoach',
      )
    },
  })
  return chips
})

const hasActiveFilter = computed(
  () =>
    teamsStore.categoryFilter !== 'all' ||
    teamsStore.coachStateFilter !== 'all' ||
    teamsStore.search.trim().length > 0,
)

function openTeam(teamId: string): void {
  router.push({ name: 'team-roster', params: { teamId } })
}
</script>

<template>
  <!-- Desktop shell (≥1024px) — CO1Desktop ────────────────────── -->
  <CbDesktopShell v-if="isDesktop" :items="nav">
    <CbPageHead title="Mes équipes" :subtitle="subheaderLabel" />

    <!-- Toolbar desktop : search + chips ─────────────────────── -->
    <div
      style="
        padding: 16px 28px 0;
        background: var(--bg-muted);
        display: flex;
        flex-direction: column;
        gap: 10px;
      "
    >
      <IconField icon-position="left" style="max-width: 360px">
        <InputIcon>
          <Search :size="16" />
        </InputIcon>
        <InputText
          :model-value="teamsStore.search"
          placeholder="Rechercher une équipe..."
          style="width: 100%"
          @update:model-value="(v: string | undefined) => teamsStore.setSearch(v ?? '')"
        />
      </IconField>

      <div class="cb-chips-row">
        <button
          v-for="chip in filterChips"
          :key="chip.key"
          type="button"
          :class="['cb-chip', chip.active ? 'is-active' : '']"
          @click="chip.onClick()"
        >
          {{ chip.label }}
        </button>
      </div>
    </div>

    <div
      style="
        padding: 16px 28px 28px;
        overflow: auto;
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 18px;
        background: var(--bg-muted);
      "
    >
      <CbEmptyState
        v-if="teamCards.length === 0"
        :icon="Users"
        :title="hasActiveFilter ? 'Aucune équipe ne correspond' : 'Aucune équipe'"
        :body="
          hasActiveFilter
            ? 'Ajustez la recherche ou les filtres pour voir plus d\'équipes.'
            : 'Vous n\'êtes coach d\'aucune équipe pour cette saison.'
        "
        style="grid-column: 1 / -1"
      >
        <template v-if="hasActiveFilter" #actions>
          <button class="cb-btn outline sm" type="button" @click="teamsStore.resetFilters()">
            Réinitialiser
          </button>
        </template>
      </CbEmptyState>

      <button
        v-for="card in teamCards"
        :key="card.id"
        type="button"
        @click="openTeam(card.id)"
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
            <div style="min-width: 0; flex: 1">
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
                <div class="cb-h3">{{ card.name }}</div>
                <CbPill tone="slate">{{ card.categoryName }}</CbPill>
              </div>
              <div class="cb-sub" style="margin-top: 4px">
                {{ card.count }} joueurs<span v-if="card.nextTraining"> · prochain training {{ card.nextTraining }}</span>
              </div>
              <div class="cb-sub" style="margin-top: 2px; font-size: 12px">
                {{ card.coachLine }}
              </div>
              <div
                v-if="card.tagName"
                style="margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap"
              >
                <CbPill tone="violet">{{ card.tagName }}</CbPill>
              </div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end">
              <CbPill
                v-for="alert in card.alerts"
                :key="alert.label"
                :tone="alert.tone"
                dot
              >
                {{ alert.label }}
              </CbPill>
              <ChevronRight
                v-if="card.alerts.length === 0"
                :size="18"
                style="color: var(--slate-400); align-self: center"
              />
            </div>
          </div>
        </div>
      </button>
    </div>
  </CbDesktopShell>

  <!-- Mobile shell (< 1024px) — CO1Mobile ─────────────────────── -->
  <CbMobileShell v-else title="Mes équipes" :tabs="tabs">
    <div class="cb-page">
      <!-- Sub-header dynamique ───────────────────────────────── -->
      <div class="cb-sub" style="font-size: 12px">
        {{ subheaderLabel }}
      </div>

      <!-- Search sticky en haut de la liste ──────────────────── -->
      <IconField icon-position="left">
        <InputIcon>
          <Search :size="16" />
        </InputIcon>
        <InputText
          :model-value="teamsStore.search"
          placeholder="Rechercher une équipe..."
          style="width: 100%"
          @update:model-value="(v: string | undefined) => teamsStore.setSearch(v ?? '')"
        />
      </IconField>

      <!-- Chips filtres ─────────────────────────────────────── -->
      <div class="cb-chips-row">
        <button
          v-for="chip in filterChips"
          :key="chip.key"
          type="button"
          :class="['cb-chip', chip.active ? 'is-active' : '']"
          @click="chip.onClick()"
        >
          {{ chip.label }}
        </button>
      </div>

      <!-- Liste équipes ─────────────────────────────────────── -->
      <template v-if="MOCK_LOADING || teamsStore.loading">
        <CbSkel :h="100" />
        <CbSkel :h="100" />
        <CbSkel :h="100" />
      </template>

      <CbEmptyState
        v-else-if="MOCK_EMPTY"
        :icon="Users"
        title="Aucune équipe"
        body="Vous n'êtes coach d'aucune équipe pour cette saison. Contactez l'admin du club."
      >
        <template #actions>
          <button class="cb-btn outline sm">Contacter</button>
        </template>
      </CbEmptyState>

      <CbEmptyState
        v-else-if="teamCards.length === 0"
        :icon="Users"
        :title="hasActiveFilter ? 'Aucune équipe ne correspond' : 'Aucune équipe'"
        :body="
          hasActiveFilter
            ? 'Ajustez la recherche ou les filtres pour voir plus d\'équipes.'
            : 'Vous n\'êtes coach d\'aucune équipe pour cette saison.'
        "
      >
        <template v-if="hasActiveFilter" #actions>
          <button class="cb-btn outline sm" type="button" @click="teamsStore.resetFilters()">
            Réinitialiser
          </button>
        </template>
      </CbEmptyState>

      <template v-else>
        <button
          v-for="card in teamCards"
          :key="card.id"
          type="button"
          @click="openTeam(card.id)"
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
              <div style="min-width: 0; flex: 1">
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
                  <div class="cb-h3">{{ card.name }}</div>
                  <CbPill tone="slate">{{ card.categoryName }}</CbPill>
                </div>
                <div class="cb-sub" style="margin-top: 4px">
                  {{ card.count }} joueurs<span v-if="card.nextTraining"> · {{ card.nextTraining }}</span>
                </div>
                <div class="cb-sub" style="margin-top: 2px; font-size: 12px">
                  {{ card.coachLine }}
                </div>
                <div
                  v-if="card.tagName"
                  style="margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap"
                >
                  <CbPill tone="violet">{{ card.tagName }}</CbPill>
                </div>
              </div>
              <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end">
                <CbPill
                  v-for="alert in card.alerts"
                  :key="alert.label"
                  :tone="alert.tone"
                  dot
                >
                  {{ alert.label }}
                </CbPill>
                <ChevronRight
                  v-if="card.alerts.length === 0"
                  :size="18"
                  style="color: var(--slate-400); align-self: center"
                />
              </div>
            </div>
          </div>
        </button>
      </template>
    </div>
  </CbMobileShell>
</template>

<style scoped>
/**
 * Chips row — pattern Tailwind-light (pas d'override des tokens globaux).
 * Inspirées du segmented control de TeamRoster, en version pill ronde
 * pour distinguer (filtres vs onglets).
 */
.cb-chips-row {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
  padding: 2px 0;
}
.cb-chips-row::-webkit-scrollbar {
  display: none;
}
.cb-chip {
  flex: 0 0 auto;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.cb-chip:hover {
  background: var(--bg-muted);
}
.cb-chip.is-active {
  background: var(--emerald-600);
  color: white;
  border-color: var(--emerald-600);
}
</style>
