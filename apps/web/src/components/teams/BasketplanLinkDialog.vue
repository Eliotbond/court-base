<script setup lang="ts">
/**
 * Dialog "Lier une compétition Basketplan" — cascade 3 étapes :
 *   1. Sélection fédération (alimentée par `BASKETPLAN_FEDERATIONS`).
 *   2. Sélection compétition / `leagueHolding` (appel `listBasketplanLeagueHoldings`).
 *   3. Sélection équipe dans la ligue (appel `listClubTeamsInLeague`).
 *
 * Submit → `linkTeamToBasketplan({ teamId, federationId, leagueHoldingId,
 * teamIdInLeague })`. Sur succès, émet `linked` avec le link reçu du
 * serveur et ferme le dialog.
 *
 * Brief : `docs/basketplan-integration.md` § 6.2. Pattern Dialog PrimeVue
 * aligné sur `MatchFormDialog.vue` (defineProps `visible`, defineEmits
 * `update:visible`, footer custom).
 *
 * Note auth : la callable serveur garde le scope admin OU coach-of-team via
 * `assertAdminOrCoachOfTeam`. L'UI ne refait pas la garde côté client — elle
 * est masquée hors-scope par le composant parent.
 */

import { computed, ref, watch } from 'vue'
import { FirebaseError } from 'firebase/app'
import { AlertTriangle, Loader2, Plug, Trophy, Users } from 'lucide-vue-next'
import Dialog from 'primevue/dialog'
import RadioButton from 'primevue/radiobutton'
import Select from 'primevue/select'
import {
  linkTeamToBasketplan,
  listBasketplanLeagueHoldings,
  listClubTeamsInLeague,
  type BasketplanClubTeamInLeague,
  type BasketplanLeagueHolding,
} from '@/services/cloudFunctions'
import {
  BASKETPLAN_FEDERATIONS,
  type BasketplanFederation,
} from '@/lib/basketplan-federations'
import type { BasketplanCompetitionLink } from '@club-app/shared-types'

const props = defineProps<{
  visible: boolean
  teamId: string
  teamName: string
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'linked', payload: { link: BasketplanCompetitionLink }): void
}>()

// ---------------------------------------------------------------------------
// Proxy v-model pour le Dialog. Le reset des sélections se fait à l'ouverture
// (watch sur `visible`).
// ---------------------------------------------------------------------------

const dialogVisible = computed<boolean>({
  get: () => props.visible,
  set: (val) => emit('update:visible', val),
})

// ---------------------------------------------------------------------------
// State cascade — fédération → ligue → équipe.
// ---------------------------------------------------------------------------

const selectedFederation = ref<BasketplanFederation | null>(null)

const leagueHoldings = ref<BasketplanLeagueHolding[]>([])
const loadingLeagues = ref(false)
const selectedLeagueHolding = ref<BasketplanLeagueHolding | null>(null)

const teamsInLeague = ref<BasketplanClubTeamInLeague[]>([])
const loadingTeams = ref(false)
const selectedTeamInLeague = ref<BasketplanClubTeamInLeague | null>(null)

const submitting = ref(false)
const error = ref<string | null>(null)

const FEDERATION_OPTIONS = computed(() =>
  BASKETPLAN_FEDERATIONS.map((f) => ({
    ...f,
    label: `${f.code} — ${f.name}`,
  })),
)

/**
 * Reset complet à chaque ouverture pour repartir d'un état propre (cas
 * "rouverture après cancel" ou "rouverture pour une autre team").
 */
watch(
  () => props.visible,
  (open) => {
    if (open) {
      selectedFederation.value = null
      leagueHoldings.value = []
      selectedLeagueHolding.value = null
      teamsInLeague.value = []
      selectedTeamInLeague.value = null
      submitting.value = false
      error.value = null
    }
  },
)

// ---------------------------------------------------------------------------
// Étape 2 : à chaque changement de fédération → fetch les ligues.
// ---------------------------------------------------------------------------

watch(selectedFederation, async (fed) => {
  // Reset des étapes downstream à chaque changement.
  leagueHoldings.value = []
  selectedLeagueHolding.value = null
  teamsInLeague.value = []
  selectedTeamInLeague.value = null
  error.value = null
  if (!fed) return
  loadingLeagues.value = true
  try {
    const res = await listBasketplanLeagueHoldings({ federationId: fed.id })
    // Tri season DESC puis name ASC (cf. brief § 6.2).
    leagueHoldings.value = [...res.leagueHoldings].sort((a, b) => {
      if (a.season !== b.season) return b.season.localeCompare(a.season)
      return a.name.localeCompare(b.name, 'fr')
    })
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`listBasketplanLeagueHoldings failed [${code}]`, err)
    error.value =
      err instanceof Error
        ? err.message
        : 'Impossible de charger les compétitions de cette fédération.'
  } finally {
    loadingLeagues.value = false
  }
})

// ---------------------------------------------------------------------------
// Étape 3 : à chaque changement de ligue → fetch les équipes du club.
// ---------------------------------------------------------------------------

watch(selectedLeagueHolding, async (lh) => {
  teamsInLeague.value = []
  selectedTeamInLeague.value = null
  error.value = null
  if (!lh) return
  loadingTeams.value = true
  try {
    const res = await listClubTeamsInLeague({ leagueHoldingId: lh.id })
    teamsInLeague.value = [...res.teams].sort((a, b) =>
      a.name.localeCompare(b.name, 'fr'),
    )
    // Auto-sélection si une seule équipe (cas dominant — un club a souvent
    // une équipe par compétition).
    if (teamsInLeague.value.length === 1) {
      selectedTeamInLeague.value = teamsInLeague.value[0]
    }
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`listClubTeamsInLeague failed [${code}]`, err)
    error.value =
      err instanceof Error
        ? err.message
        : 'Impossible de charger les équipes du club pour cette ligue.'
  } finally {
    loadingTeams.value = false
  }
})

// ---------------------------------------------------------------------------
// Submit — `linkTeamToBasketplan`.
// ---------------------------------------------------------------------------

const canSubmit = computed<boolean>(
  () =>
    !!selectedFederation.value &&
    !!selectedLeagueHolding.value &&
    !!selectedTeamInLeague.value &&
    !submitting.value,
)

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  const fed = selectedFederation.value!
  const lh = selectedLeagueHolding.value!
  const t = selectedTeamInLeague.value!
  submitting.value = true
  error.value = null
  try {
    const res = await linkTeamToBasketplan({
      teamId: props.teamId,
      federationId: fed.id,
      leagueHoldingId: lh.id,
      teamIdInLeague: t.id,
    })
    emit('linked', { link: res.link })
    dialogVisible.value = false
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`linkTeamToBasketplan failed [${code}]`, err)
    if (code === 'already-exists') {
      error.value =
        'Cette équipe est déjà liée à cette compétition. Choisis-en une autre.'
    } else if (code === 'permission-denied') {
      error.value =
        "Tu n'as pas les droits pour lier cette équipe (admin ou coach de l'équipe requis)."
    } else if (code === 'failed-precondition') {
      error.value =
        "L'équipe sélectionnée n'existe pas dans cette compétition. Vérifie la sélection."
    } else if (code === 'unavailable') {
      error.value =
        'Basketplan est temporairement injoignable. Réessaie dans quelques minutes.'
    } else {
      error.value =
        err instanceof Error
          ? err.message
          : 'Erreur lors de la création du lien.'
    }
  } finally {
    submitting.value = false
  }
}

function cancel(): void {
  dialogVisible.value = false
}
</script>

<template>
  <Dialog
    v-model:visible="dialogVisible"
    modal
    :draggable="false"
    :style="{ width: '520px' }"
    :close-on-escape="!submitting"
    :dismissable-mask="!submitting"
  >
    <template #header>
      <div class="flex items-center gap-2">
        <Plug
          :size="16"
          :stroke-width="2"
        />
        <span class="text-[15px] font-semibold">
          Lier une compétition Basketplan
        </span>
      </div>
    </template>

    <div class="space-y-4 pt-1">
      <p class="text-[12px] text-surface-500">
        Lier <strong>{{ teamName }}</strong> à une compétition Swiss
        Basketball. Le sync nocturne remontera ensuite automatiquement
        matchs, scores et arbitres officiels.
      </p>

      <!-- ============== Étape 1 : Fédération ============== -->
      <label class="block">
        <span class="text-[12px] text-surface-600 font-medium">
          1. Fédération
        </span>
        <Select
          v-model="selectedFederation"
          :options="FEDERATION_OPTIONS"
          option-label="label"
          placeholder="Sélectionner une fédération…"
          class="mt-1 w-full"
        >
          <template #option="{ option }">
            <div class="flex items-center gap-2">
              <span class="text-[12px] font-semibold text-surface-700">
                {{ option.code }}
              </span>
              <span class="text-[12px] text-surface-500">
                {{ option.name }}
              </span>
            </div>
          </template>
        </Select>
      </label>

      <!-- ============== Étape 2 : Compétition ============== -->
      <label
        v-if="selectedFederation"
        class="block"
      >
        <span class="text-[12px] text-surface-600 font-medium flex items-center gap-1">
          <Trophy
            :size="12"
            :stroke-width="2"
          />
          2. Compétition
        </span>
        <div
          v-if="loadingLeagues"
          class="mt-2 text-[12px] text-surface-500 flex items-center gap-2"
        >
          <Loader2
            :size="14"
            :stroke-width="2"
            class="animate-spin"
          />
          Chargement des compétitions…
        </div>
        <template v-else>
          <Select
            v-model="selectedLeagueHolding"
            :options="leagueHoldings"
            option-label="name"
            placeholder="Sélectionner une compétition…"
            class="mt-1 w-full"
            :empty-message="loadingLeagues ? 'Chargement…' : 'Aucune compétition retournée.'"
            filter
            filter-placeholder="Filtrer par nom…"
          >
            <template #option="{ option }">
              <div class="flex items-center justify-between gap-2 w-full">
                <span class="text-[13px]">{{ option.name }}</span>
                <span class="text-[11px] text-surface-500 num">
                  {{ option.season }}
                </span>
              </div>
            </template>
          </Select>
          <span
            v-if="!loadingLeagues && leagueHoldings.length === 0 && selectedFederation"
            class="text-[11px] text-surface-500 mt-1 block"
          >
            Aucune compétition retournée pour cette fédération.
          </span>
        </template>
      </label>

      <!-- ============== Étape 3 : Équipe ============== -->
      <div v-if="selectedLeagueHolding">
        <span class="text-[12px] text-surface-600 font-medium flex items-center gap-1">
          <Users
            :size="12"
            :stroke-width="2"
          />
          3. Équipe du club
        </span>
        <div
          v-if="loadingTeams"
          class="mt-2 text-[12px] text-surface-500 flex items-center gap-2"
        >
          <Loader2
            :size="14"
            :stroke-width="2"
            class="animate-spin"
          />
          Chargement des équipes du club…
        </div>
        <div
          v-else-if="teamsInLeague.length === 0"
          class="mt-2 text-[12px] text-surface-500"
        >
          Aucune équipe du club trouvée dans cette compétition. Vérifie le
          <code class="text-surface-700">clubId</code> configuré dans
          Settings → Intégrations → Basketplan.
        </div>
        <ul
          v-else
          class="mt-2 space-y-1.5"
        >
          <li
            v-for="t in teamsInLeague"
            :key="t.id"
            class="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-50 cursor-pointer"
            @click="selectedTeamInLeague = t"
          >
            <RadioButton
              :model-value="selectedTeamInLeague?.id"
              :value="t.id"
              :input-id="`bp-team-${t.id}`"
              @update:model-value="selectedTeamInLeague = t"
            />
            <label
              :for="`bp-team-${t.id}`"
              class="text-[13px] cursor-pointer flex-1"
            >
              {{ t.name }}
              <span class="text-[11px] text-surface-500 num ml-1">
                #{{ t.id }}
              </span>
            </label>
          </li>
        </ul>
      </div>

      <!-- ============== Error banner ============== -->
      <div
        v-if="error"
        class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 flex items-start gap-2"
      >
        <AlertTriangle
          :size="14"
          :stroke-width="2"
          class="mt-px shrink-0"
        />
        <span>{{ error }}</span>
      </div>
    </div>

    <template #footer>
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        :disabled="submitting"
        @click="cancel"
      >
        Annuler
      </button>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        :disabled="!canSubmit"
        @click="submit"
      >
        <Loader2
          v-if="submitting"
          :size="14"
          :stroke-width="2"
          class="animate-spin"
        />
        <template v-if="submitting">
          Liaison en cours…
        </template>
        <template v-else>
          Lier
        </template>
      </button>
    </template>
  </Dialog>
</template>
