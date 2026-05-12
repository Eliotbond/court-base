<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeft,
  Ban,
  CalendarRange,
  Check,
  CheckCheck,
  CircleAlert,
  TriangleAlert,
  Users,
} from 'lucide-vue-next'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import { useSeasonsStore } from '@/stores/seasons'
import {
  previewActivation,
  type DryRunBookingPreview,
  type DryRunResult,
  type DryRunSlotType,
  type SeasonRow,
} from '@/repositories/seasons.repo'
import type { Timestamp } from '@club-app/shared-types'
import Pill from '@/components/ui/Pill.vue'

/**
 * Vue SeasonActivate — dry-run preview avant activation d'une saison (B2).
 *
 * Modélée sur le design `Courtbase Mockups.html` → template `tpl-seasons`
 * (`SCREEN: 7 — SEASON ACTIVATION (DRY-RUN)`). À cette étape, aucun booking
 * n'est créé : l'admin review les counts + la preview des 20 premiers
 * bookings, puis confirme via le footer sticky.
 *
 * Layout :
 *   - Header : breadcrumb + titre saison + métadonnées (dates, équipes,
 *     venues) + bandeau "DRY-RUN — aucun booking créé".
 *   - 4 stats cards : bookings, équipes, conflits, exclusions.
 *   - Preview table : ~20 premières lignes (date · timeSlot · court · team
 *     · slotType pill).
 *   - Sticky footer : Annuler (retour /seasons) + Confirmer activation.
 *
 * Architecture : la vue passe par `previewActivation()` (repo) directement
 * pour la preview — c'est un fetch one-shot pour cette page seule, pas une
 * data partagée à mettre en store. La confirmation passe par `store.activate`
 * qui réutilise le repo `activateSeason`.
 */

const route = useRoute()
const router = useRouter()
const store = useSeasonsStore()

const seasonId = computed<string>(() => {
  const raw = route.params.id
  return Array.isArray(raw) ? (raw[0] ?? '') : raw
})

const season = ref<SeasonRow | null>(null)
const dryRun = ref<DryRunResult | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const confirming = ref(false)

onMounted(async () => {
  loading.value = true
  error.value = null
  try {
    // Le store peut déjà avoir la liste en mémoire (si l'admin vient de
    // /seasons). Sinon on déclenche un load — pas d'appel direct au repo
    // depuis la vue (cf. règle d'architecture en couches).
    if (store.seasons.length === 0) {
      await store.load()
    }
    const row = store.getById(seasonId.value)
    if (!row) {
      error.value = 'Saison introuvable.'
      return
    }
    season.value = row

    // TODO(firestore): replace by callable result.
    // Le `previewActivation` est un fetch one-shot dédié à cette page, OK de
    // passer directement par le repo (pas de cache à mutualiser).
    dryRun.value = await previewActivation(seasonId.value)
    if (!dryRun.value) {
      error.value = 'Impossible de calculer la preview.'
    }
  } catch (e: unknown) {
    error.value =
      e instanceof Error ? e.message : 'Erreur lors du chargement du dry-run.'
  } finally {
    loading.value = false
  }
})

// ---------------------------------------------------------------------------
// Date / range formatters — locale fr-CH (alignés sur Seasons.vue).
// ---------------------------------------------------------------------------

const shortDateFormatter = new Intl.DateTimeFormat('fr-CH', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const dayMonthFormatter = new Intl.DateTimeFormat('fr-CH', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
})

function timestampToDate(t: Timestamp): Date {
  return new Date(t.seconds * 1000)
}

function formatDate(t: Timestamp): string {
  return shortDateFormatter.format(timestampToDate(t))
}

function formatDayMonth(t: Timestamp): string {
  return dayMonthFormatter.format(timestampToDate(t))
}

const subtitle = computed<string>(() => {
  const d = dryRun.value
  const s = season.value
  if (!d || !s) return 'Aperçu avant génération…'
  return [
    `Aperçu avant génération`,
    `${d.bookingsCount.toLocaleString('fr-CH')} bookings`,
    `${d.teamsCount} équipe${d.teamsCount > 1 ? 's' : ''}`,
    `${d.venuesCount} venue${d.venuesCount > 1 ? 's' : ''}`,
  ].join(' · ')
})

const headerRange = computed<string>(() => {
  const s = season.value
  if (!s) return ''
  return `${formatDate(s.startDate)} → ${formatDate(s.endDate)}`
})

// ---------------------------------------------------------------------------
// Slot type pill — couleur alignée avec le design (Mockups #7).
// ---------------------------------------------------------------------------

type PillVariant = 'emerald' | 'sky' | 'amber' | 'rose' | 'slate' | 'violet'

interface SlotTypePillDef {
  variant: PillVariant
  label: string
}

function slotTypePill(t: DryRunSlotType): SlotTypePillDef {
  switch (t) {
    case 'training':
      return { variant: 'sky', label: 'training' }
    case 'match-home':
      return { variant: 'emerald', label: 'match home' }
    case 'match-away':
    default:
      return { variant: 'violet', label: 'match away' }
  }
}

// ---------------------------------------------------------------------------
// Actions du footer.
// ---------------------------------------------------------------------------

function onCancel(): void {
  void router.push({ name: 'seasons' })
}

async function onConfirm(): Promise<void> {
  if (!season.value || confirming.value) return
  confirming.value = true
  try {
    // TODO(firestore): la mutation devra inclure le `runId` du dry-run pour
    // que le callable serveur réutilise le résultat compilé sans recomputer.
    await store.activate(season.value.id)
    void router.push({
      name: 'seasons',
      query: { activated: season.value.id },
    })
  } finally {
    confirming.value = false
  }
}

const previewRows = computed<DryRunBookingPreview[]>(
  () => dryRun.value?.preview ?? [],
)
</script>

<template>
  <section
    class="flex flex-col"
    style="min-height: calc(100vh - 56px);"
  >
    <div class="flex-1 p-6 space-y-4">
      <!-- ================= Breadcrumb =================== -->
      <div class="flex items-center gap-2 text-[12px] text-surface-500">
        <button
          type="button"
          class="hover:text-surface-700 inline-flex items-center gap-1"
          @click="onCancel"
        >
          <ArrowLeft
            :size="12"
            :stroke-width="2"
          />
          Seasons
        </button>
        <span>·</span>
        <span class="text-surface-700">Activation — preview</span>
      </div>

      <!-- ================= Header card =================== -->
      <div
        v-if="season"
        class="card p-5"
      >
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div class="flex items-center gap-2 text-[12px] text-amber-700">
              <TriangleAlert
                :size="14"
                :stroke-width="2"
              />
              DRY-RUN — aucun booking n'a encore été créé
            </div>
            <h1 class="text-[22px] font-semibold tracking-tight mt-1">
              Activer la saison · {{ season.name }}
            </h1>
            <p class="text-[13px] text-surface-500 mt-0.5 num">
              {{ subtitle }}
            </p>
            <div class="text-[12px] text-surface-500 mt-1 num">
              {{ headerRange }}
            </div>
          </div>
          <Pill variant="amber">
            draft
          </Pill>
        </div>
      </div>

      <!-- ================= Loading / error =================== -->
      <div
        v-if="loading"
        class="card px-4 py-10 text-center text-[12px] text-surface-500"
      >
        Chargement de la preview…
      </div>
      <div
        v-else-if="error"
        class="card border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700 flex items-center gap-2"
      >
        <TriangleAlert
          :size="14"
          :stroke-width="2"
        />
        {{ error }}
      </div>

      <!-- ================= Stats cards =================== -->
      <div
        v-if="dryRun && !loading && !error"
        class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4"
      >
        <div class="card p-4">
          <div class="flex items-center gap-2 text-[12px] text-surface-500">
            <CalendarRange
              :size="14"
              :stroke-width="2"
            />
            Bookings à générer
          </div>
          <div class="text-[28px] font-semibold num mt-1">
            {{ dryRun.bookingsCount.toLocaleString('fr-CH') }}
          </div>
          <div class="text-[11px] text-surface-500">
            à la confirmation
          </div>
        </div>

        <div class="card p-4">
          <div class="flex items-center gap-2 text-[12px] text-surface-500">
            <Users
              :size="14"
              :stroke-width="2"
            />
            Équipes couvertes
          </div>
          <div class="text-[28px] font-semibold num mt-1 text-blue-700">
            {{ dryRun.teamsCount }}
          </div>
          <div class="text-[11px] text-blue-700 num">
            sur {{ dryRun.venuesCount }} venue{{ dryRun.venuesCount > 1 ? 's' : '' }}
          </div>
        </div>

        <div class="card p-4">
          <div class="flex items-center gap-2 text-[12px] text-surface-500">
            <CircleAlert
              :size="14"
              :stroke-width="2"
            />
            Conflits détectés
          </div>
          <div
            class="text-[28px] font-semibold num mt-1"
            :class="dryRun.conflictsCount === 0 ? 'text-emerald-700' : 'text-rose-700'"
          >
            {{ dryRun.conflictsCount }}
          </div>
          <div
            class="text-[11px] num"
            :class="dryRun.conflictsCount === 0 ? 'text-emerald-700' : 'text-rose-700'"
          >
            {{ dryRun.conflictsCount === 0 ? 'aucun chevauchement' : 'à résoudre' }}
          </div>
        </div>

        <div class="card p-4">
          <div class="flex items-center gap-2 text-[12px] text-surface-500">
            <Ban
              :size="14"
              :stroke-width="2"
            />
            Jours exclus (fermetures)
          </div>
          <div class="text-[28px] font-semibold num mt-1 text-amber-700">
            {{ dryRun.closuresCount }}
          </div>
          <div class="text-[11px] text-amber-700 num">
            closure periods appliquées
          </div>
        </div>
      </div>

      <!-- ================= Preview table =================== -->
      <div
        v-if="dryRun && !loading && !error"
        class="card overflow-hidden"
      >
        <div
          class="px-4 h-12 border-b border-surface-200 flex items-center justify-between"
        >
          <h2 class="text-[14px] font-semibold">
            Preview — 20 premiers bookings
          </h2>
          <span class="text-[11px] text-surface-500 num">
            sur {{ dryRun.bookingsCount.toLocaleString('fr-CH') }} à générer
          </span>
        </div>

        <DataTable
          :value="previewRows"
          size="small"
          data-key="id"
          striped-rows
          class="text-[13px]"
        >
          <template #empty>
            <div class="px-3 py-10 text-center text-[12px] text-surface-500">
              Aucun booking à afficher dans cette preview.
            </div>
          </template>

          <Column
            header="Date"
            :pt="{ headerCell: { style: 'width: 140px' } }"
          >
            <template #body="{ data }">
              <span class="num">{{ formatDayMonth(data.date) }}</span>
            </template>
          </Column>

          <Column
            header="Plage"
            :pt="{ headerCell: { style: 'width: 140px' } }"
          >
            <template #body="{ data }">
              <span class="num">{{ data.timeSlot }}</span>
            </template>
          </Column>

          <Column header="Court">
            <template #body="{ data }">
              <div class="font-medium">
                {{ data.court }}
              </div>
            </template>
          </Column>

          <Column
            header="Équipe"
            :pt="{ headerCell: { style: 'width: 160px' } }"
          >
            <template #body="{ data }">
              {{ data.team }}
            </template>
          </Column>

          <Column
            header="Type"
            :pt="{ headerCell: { style: 'width: 130px' } }"
          >
            <template #body="{ data }">
              <Pill :variant="slotTypePill(data.slotType).variant">
                {{ slotTypePill(data.slotType).label }}
              </Pill>
            </template>
          </Column>
        </DataTable>

        <div
          class="flex items-center justify-between border-t border-surface-200 px-4 h-11 text-[12px] text-surface-500"
        >
          <span>
            Preview tronquée à {{ previewRows.length }} lignes — la liste
            complète sera générée à la confirmation.
          </span>
        </div>
      </div>
    </div>

    <!-- ================= Sticky footer =================== -->
    <div
      v-if="dryRun && !loading && !error"
      class="sticky bottom-0 bg-white border-t border-surface-200 px-6 py-3 flex items-center gap-3 flex-wrap"
    >
      <div class="text-[12px] text-surface-500">
        Tu confirmes la génération de
        <strong class="text-surface-900 num">
          {{ dryRun.bookingsCount.toLocaleString('fr-CH') }} bookings
        </strong>
        sur la base ci-dessus. Action irréversible (bookings éditables
        individuellement après).
      </div>
      <div class="ml-auto flex items-center gap-2">
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="confirming"
          @click="onCancel"
        >
          <ArrowLeft
            :size="12"
            :stroke-width="2"
          />
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="confirming"
          @click="onConfirm"
        >
          <CheckCheck
            v-if="!confirming"
            :size="14"
            :stroke-width="2"
          />
          <Check
            v-else
            :size="14"
            :stroke-width="2"
            class="animate-pulse"
          />
          {{ confirming ? 'Activation…' : 'Confirmer activation' }}
        </button>
      </div>
    </div>
  </section>
</template>
