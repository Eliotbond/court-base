<script setup lang="ts">
/**
 * O2 — Calendrier des Officiels (officiel).
 *
 * Renommé depuis "Mes assignations" le 2026-05-25 — le contenu (mes assignations
 * + matchs à pourvoir au niveau du caller) n'a pas changé, seul le titre exposé
 * a évolué pour mieux refléter la vue "calendrier officiel" (assignations
 * confirmées + opportunités urgentes). Le nom de route `my-assignments` reste
 * inchangé (identifiant technique).
 *
 * Orchestrateur de 2 tabs + inbox de remplacements :
 *  - **Inbox remplacements** (au-dessus des tabs, visible si demandes pending
 *    reçues). Permet d'accepter / décliner les demandes d'autres officiels.
 *  - **Calendrier** (default) — `OfficialAssignmentsCalendar` (vue-cal v4,
 *    vue Semaine + plage Soir par défaut). Affiche mes assignations + matchs
 *    à pourvoir à mon niveau ; opportunités à moins de 3 jours = rouge.
 *  - **Liste** — `OfficialAssignmentsList` (3 sections : URGENT < 3 jours,
 *    Mes assignations à venir, À pourvoir cette semaine).
 *
 * Cette coquille s'occupe de :
 *  1. Mount des stores (bookings + saison + officials + replacements) — idempotent.
 *  2. Shell mobile / desktop + tab bar / sidebar role-aware.
 *  3. Toggle `Calendrier | Liste` (state local).
 *  4. Navigation `event-click` / `select` → vue détail match.
 *  5. Wire `request-replacement` (depuis la liste) → ouverture du dialog.
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import CbDesktopShell from '@/components/ui/CbDesktopShell.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbPageHead from '@/components/ui/CbPageHead.vue'
import CbSkel from '@/components/ui/CbSkel.vue'
import OfficialAssignmentsCalendar from '@/components/official/OfficialAssignmentsCalendar.vue'
import OfficialAssignmentsList from '@/components/official/OfficialAssignmentsList.vue'
import ReplacementInbox from '@/components/official/ReplacementInbox.vue'
import RequestReplacementDialog from '@/components/dialogs/RequestReplacementDialog.vue'
import { useActiveSeason } from '@/composables/useSeason'
import { useShellNav } from '@/composables/useShellNav'
import { useViewport } from '@/composables/useViewport'
import { useAuthStore } from '@/stores/auth'
import { useBookingsStore } from '@/stores/bookings'
import { useOfficialsStore, type MyAssignmentEntry } from '@/stores/officials'
import { useReplacementsStore } from '@/stores/replacements'

const router = useRouter()
const auth = useAuthStore()
const bookingsStore = useBookingsStore()
const officialsStore = useOfficialsStore()
const replacementsStore = useReplacementsStore()
const seasonStore = useActiveSeason()
const { isDesktop } = useViewport()
const { tabs, nav, primaryRoleLabel } = useShellNav()

// ───────────────────────────────────────────────────────────────
// Mount : hydrate bookings + officials + replacements
// ───────────────────────────────────────────────────────────────

const localLoading = ref(true)

onMounted(async () => {
  try {
    await bookingsStore.loadActiveContext()
    const resolvedSeasonId = (await seasonStore.load()) ?? 'mock-season'
    await officialsStore.loadOfficialContext(resolvedSeasonId)
    const memberId = auth.userDoc?.memberId
    if (memberId) {
      await replacementsStore.load(memberId)
    }
  } catch (err) {
    console.error('[MyAssignments] mount failed', err)
  } finally {
    localLoading.value = false
  }
})

const isLoading = computed(
  () => localLoading.value || officialsStore.loading || bookingsStore.loading,
)

// ───────────────────────────────────────────────────────────────
// Tabs Calendrier / Liste
// ───────────────────────────────────────────────────────────────

type TabKey = 'calendar' | 'list'
const activeTab = ref<TabKey>('calendar')

function setTab(t: TabKey): void {
  activeTab.value = t
}

// ───────────────────────────────────────────────────────────────
// Navigation
// ───────────────────────────────────────────────────────────────

function goToMatch(payload: { parentId: string; kind: 'home' | 'away' }): void {
  router.push({ name: 'match-detail', params: { id: payload.parentId } })
}

// ───────────────────────────────────────────────────────────────
// Dialog "Demander un remplacement"
// ───────────────────────────────────────────────────────────────

const replaceDialogOpen = ref(false)
const replaceDialogEntry = ref<MyAssignmentEntry | null>(null)

function openReplaceDialog(entry: MyAssignmentEntry): void {
  replaceDialogEntry.value = entry
  replaceDialogOpen.value = true
}

function onReplaceDialogSubmitted(): void {
  // Le dialog appelle déjà `replacementsStore.createRequest` + refresh.
  // Ici on ferme + reset local state.
  replaceDialogOpen.value = false
  replaceDialogEntry.value = null
}

// ───────────────────────────────────────────────────────────────
// Sous-titre desktop
// ───────────────────────────────────────────────────────────────

const officialLevelLabel = computed<string>(() => {
  const lvl = auth.officialLevel
  return lvl ? `Niveau ${lvl}` : 'Officiel'
})
</script>

<template>
  <!-- ─── Mobile shell (<1024px) ─────────────────────────────── -->
  <CbMobileShell
    v-if="!isDesktop"
    title="Calendrier des Officiels"
    :tabs="tabs"
  >
    <!-- Inbox des demandes de remplacement reçues (auto-hide si vide) -->
    <ReplacementInbox v-if="!isLoading" />

    <div class="oa-segmented-wrap">
      <div class="cb-segmented oa-segmented-full">
        <button
          type="button"
          :class="{ active: activeTab === 'calendar' }"
          @click="setTab('calendar')"
        >
          Calendrier
        </button>
        <button
          type="button"
          :class="{ active: activeTab === 'list' }"
          @click="setTab('list')"
        >
          Liste
        </button>
      </div>
    </div>

    <div v-if="isLoading" class="oa-loading">
      <CbSkel w="40%" :h="16" />
      <div style="height: 12px" />
      <CbSkel :h="140" />
      <div style="height: 10px" />
      <CbSkel :h="140" />
    </div>

    <template v-else>
      <OfficialAssignmentsCalendar
        v-if="activeTab === 'calendar'"
        @event-click="goToMatch"
      />
      <OfficialAssignmentsList
        v-else
        @select="goToMatch"
        @request-replacement="openReplaceDialog"
      />
    </template>
  </CbMobileShell>

  <!-- ─── Desktop shell (≥1024px) ────────────────────────────── -->
  <CbDesktopShell
    v-else
    :items="nav"
    :user-role="primaryRoleLabel"
  >
    <CbPageHead title="Calendrier des Officiels" :subtitle="officialLevelLabel">
      <template #actions>
        <div class="cb-segmented">
          <button
            type="button"
            :class="{ active: activeTab === 'calendar' }"
            @click="setTab('calendar')"
          >
            Calendrier
          </button>
          <button
            type="button"
            :class="{ active: activeTab === 'list' }"
            @click="setTab('list')"
          >
            Liste
          </button>
        </div>
      </template>
    </CbPageHead>

    <!-- Inbox desktop : juste en-dessous du PageHead -->
    <div v-if="!isLoading" class="oa-inbox-wrap-desktop">
      <ReplacementInbox />
    </div>

    <div v-if="isLoading" class="oa-loading oa-loading-desktop">
      <CbSkel w="40%" :h="18" />
      <div style="height: 14px" />
      <CbSkel :h="180" />
      <div style="height: 12px" />
      <CbSkel :h="180" />
    </div>

    <template v-else>
      <OfficialAssignmentsCalendar
        v-if="activeTab === 'calendar'"
        @event-click="goToMatch"
      />
      <OfficialAssignmentsList
        v-else
        @select="goToMatch"
        @request-replacement="openReplaceDialog"
      />
    </template>
  </CbDesktopShell>

  <!-- Dialog "Demander un remplacement" ─────────────────────── -->
  <RequestReplacementDialog
    v-if="replaceDialogEntry"
    v-model:visible="replaceDialogOpen"
    :entry="replaceDialogEntry"
    @submitted="onReplaceDialogSubmitted"
  />
</template>

<style scoped>
.oa-segmented-wrap {
  padding: 8px 16px 0;
  background: var(--bg);
}

.oa-segmented-full {
  width: 100%;
  display: flex;
}
.oa-segmented-full button {
  flex: 1;
  text-align: center;
}

.oa-loading {
  padding: 16px;
  display: flex;
  flex-direction: column;
}

.oa-loading-desktop {
  padding: 24px 28px;
  background: var(--bg-muted);
}

.oa-inbox-wrap-desktop {
  padding: 16px 28px 0;
  background: var(--bg-muted);
}
</style>
