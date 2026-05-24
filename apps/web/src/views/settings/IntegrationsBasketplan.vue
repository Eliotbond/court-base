<script setup lang="ts">
/**
 * Settings → Intégrations → Basketplan.
 *
 * Configure l'intégration Swiss Basketball / ORCA Systems pour ce club. Les
 * champs vivent dans `/config/club.basketplan` (cf.
 * `docs/basketplan-integration.md` § 4.3 et `docs/firebase.md`). Patch
 * partiel via `useSettingsStore.saveBasketplan()` (lui-même délégué au
 * pattern `setDoc({ merge: true })` du repo settings).
 *
 * Contenu (PR 1) :
 *  - Switch `enabled` (toggle global).
 *  - InputNumber `clubId`.
 *  - Select `defaultFederationId` (alimenté par `BASKETPLAN_FEDERATIONS` +
 *    option "Autre ID…" pour saisir un id arbitraire).
 *  - Bouton "Tester la connexion" → `testBasketplanConnection`.
 *  - Affichage `lastSyncAt` / `lastSyncError` (read-only — la sync est livrée
 *    en PR 2, donc placeholder "Aucune synchronisation effectuée" tant que
 *    `lastSyncAt == null`).
 *
 * Pas de CTA "Lancer la synchro maintenant" — out-of-scope PR 1.
 *
 * Sécurité : write `/config/club.basketplan` est admin-only côté rules
 * (couvert par la règle existante sur `/config/club`). La callable
 * `testBasketplanConnection` est admin-only côté serveur.
 */

import { computed, onMounted, ref, watch } from 'vue'
import { FirebaseError } from 'firebase/app'
import {
  AlertTriangle,
  CheckCircle2,
  Plug,
  Loader2,
  RotateCw,
} from 'lucide-vue-next'
import Dialog from 'primevue/dialog'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import { useSettingsStore } from '@/stores/settings'
import { useTeamsStore } from '@/stores/teams'
import {
  syncBasketplanForTeam,
  testBasketplanConnection,
  type SyncBasketplanForTeamPerLink,
} from '@/services/cloudFunctions'
import {
  BASKETPLAN_FEDERATIONS,
  findFederationById,
  type BasketplanFederation,
} from '@/lib/basketplan-federations'
import type {
  BasketplanIntegrationConfig,
  Timestamp,
} from '@club-app/shared-types'

const store = useSettingsStore()
const teamsStore = useTeamsStore()

onMounted(() => {
  void store.load()
  // Pré-chargement des teams pour peupler le dropdown du dialog "Synchroniser
  // maintenant". Pas critique si déjà chargé ailleurs (no-op si non vide).
  if (teamsStore.teams.length === 0) {
    void teamsStore.load()
  }
})

// ---------------------------------------------------------------------------
// Local form state — hydraté depuis `store.config.basketplan` au load.
// `defaultFederationId === 'custom'` est un sentinel UI quand l'admin choisit
// "Autre ID…" — l'`InputNumber` `customFederationId` prend alors la main.
// ---------------------------------------------------------------------------

interface BasketplanForm {
  enabled: boolean
  clubId: number | null
  defaultFederationId: number | null
  /** Reflète si l'`InputNumber` "Autre ID" est visible. */
  useCustomFederation: boolean
  customFederationId: number | null
}

const form = ref<BasketplanForm>({
  enabled: false,
  clubId: null,
  defaultFederationId: null,
  useCustomFederation: false,
  customFederationId: null,
})

const formError = ref<string | null>(null)
const saving = ref(false)

/**
 * Hydrate le form depuis le store. Si `defaultFederationId` n'est pas dans
 * la liste statique, on bascule en mode "custom" pour préserver la valeur.
 */
function hydrate(cfg: BasketplanIntegrationConfig | undefined): void {
  if (!cfg) {
    form.value = {
      enabled: false,
      clubId: null,
      defaultFederationId: null,
      useCustomFederation: false,
      customFederationId: null,
    }
    return
  }
  const known = findFederationById(cfg.defaultFederationId)
  form.value = {
    enabled: cfg.enabled,
    clubId: cfg.clubId,
    defaultFederationId: known ? cfg.defaultFederationId : null,
    useCustomFederation: !known,
    customFederationId: known ? null : cfg.defaultFederationId,
  }
}

watch(
  () => store.config?.basketplan,
  (cfg) => {
    hydrate(cfg)
  },
  { immediate: true, deep: true },
)

// ---------------------------------------------------------------------------
// Select options — fédérations connues + sentinel "custom".
// ---------------------------------------------------------------------------

interface FederationOption {
  /** `'custom'` pour la sentinelle "Autre ID", sinon `id` numérique. */
  value: number | 'custom'
  label: string
  /** Code court pour le rendu compact (ex. "AFBB"). */
  code: string | null
}

const FEDERATION_OPTIONS = computed<FederationOption[]>(() => {
  const list: FederationOption[] = BASKETPLAN_FEDERATIONS.map((f) => ({
    value: f.id,
    label: `${f.code} — ${f.name}`,
    code: f.code,
  }))
  list.push({ value: 'custom', label: 'Autre ID…', code: null })
  return list
})

/**
 * Valeur courante du Select fédération — `'custom'` si l'admin a saisi un
 * id custom, sinon `defaultFederationId`. Le proxy gère le toggle entre les
 * deux modes proprement.
 */
const selectedFederation = computed<number | 'custom' | null>({
  get: () => {
    if (form.value.useCustomFederation) return 'custom'
    return form.value.defaultFederationId
  },
  set: (val) => {
    if (val === 'custom') {
      form.value.useCustomFederation = true
      form.value.defaultFederationId = null
    } else {
      form.value.useCustomFederation = false
      form.value.defaultFederationId = val
      form.value.customFederationId = null
    }
  },
})

/** L'id de fédération effectivement envoyé au serveur. */
const effectiveFederationId = computed<number | null>(() => {
  if (form.value.useCustomFederation) return form.value.customFederationId
  return form.value.defaultFederationId
})

// ---------------------------------------------------------------------------
// Validation + save (delegate vers `useSettingsStore.saveBasketplan`).
// ---------------------------------------------------------------------------

function validate(): boolean {
  formError.value = null
  if (form.value.enabled) {
    // Validation stricte uniquement quand l'intégration est activée.
    if (form.value.clubId === null || form.value.clubId <= 0) {
      formError.value = 'Le clubId Basketplan est requis (entier positif).'
      return false
    }
    const fed = effectiveFederationId.value
    if (fed === null || fed <= 0) {
      formError.value =
        'Sélectionne une fédération par défaut (ou saisis un id custom > 0).'
      return false
    }
  }
  return true
}

async function save(): Promise<void> {
  if (!validate()) return
  saving.value = true
  try {
    // Si désactivé, on laisse l'admin sauvegarder sans clubId / federationId
    // valide — on persiste `enabled: false` + les valeurs partielles.
    const fed = effectiveFederationId.value
    const payload: BasketplanIntegrationConfig = {
      clubId: form.value.clubId ?? 0,
      defaultFederationId: fed ?? 0,
      enabled: form.value.enabled,
      // Préserve les champs sync existants (mis à jour par le scheduler
      // PR 2). On ne les efface pas en patchant.
      lastSyncAt: store.config?.basketplan?.lastSyncAt ?? null,
      lastSyncError: store.config?.basketplan?.lastSyncError ?? null,
    }
    await store.saveBasketplan(payload)
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`saveBasketplan failed [${code}]`, err)
    formError.value =
      err instanceof Error
        ? err.message
        : 'Erreur lors de la sauvegarde de la configuration Basketplan.'
  } finally {
    saving.value = false
  }
}

// ---------------------------------------------------------------------------
// Test connection — appelle `testBasketplanConnection` (admin only).
// Affiche un Tag vert (`ok: true, leagueCount`) ou rouge (`error`).
// ---------------------------------------------------------------------------

interface TestResult {
  ok: boolean
  leagueCount?: number
  error?: string
  federationId: number | null
}

const testResult = ref<TestResult | null>(null)
const testing = ref(false)

async function runTestConnection(): Promise<void> {
  testing.value = true
  testResult.value = null
  try {
    const res = await testBasketplanConnection()
    testResult.value = {
      ok: res.ok,
      leagueCount: res.leagueCount,
      error: res.error,
      federationId: res.federationId,
    }
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`testBasketplanConnection failed [${code}]`, err)
    testResult.value = {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Erreur inconnue lors du test de connexion.',
      federationId: null,
    }
  } finally {
    testing.value = false
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers — lastSyncAt + libellé fédération.
// ---------------------------------------------------------------------------

function formatTimestamp(ts: Timestamp | null | undefined): string | null {
  if (!ts) return null
  const date = new Date(ts.seconds * 1000)
  if (Number.isNaN(date.getTime())) return null
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${day}/${month}/${year} ${hours}:${minutes}`
}

const lastSyncLabel = computed<string | null>(() =>
  formatTimestamp(store.config?.basketplan?.lastSyncAt),
)

const lastSyncError = computed<string | null>(
  () => store.config?.basketplan?.lastSyncError ?? null,
)

function federationLabelFor(id: number): string {
  const known: BasketplanFederation | null = findFederationById(id)
  return known ? `${known.code} — ${known.name}` : `Fédération #${id}`
}

// ---------------------------------------------------------------------------
// Manual sync — dialog "Synchroniser maintenant".
//
// La callable `syncBasketplanForTeam` exige un `teamId` (le cron tourne sur
// toutes les teams, mais à la demande on cible une équipe). On expose un
// dropdown des teams qui ont `basketplanLinks.length > 0` (les autres
// n'auraient rien à synchroniser).
//
// Auth : la callable accepte admin OU coach-of-team ; Settings étant un
// écran admin, c'est forcément admin ici — pas de garde supplémentaire UI.
// ---------------------------------------------------------------------------

interface TeamPickOption {
  /** `teamId` (Firestore). */
  value: string
  /** Libellé "Marly U16 M · 2 liens" — info densité pour aider le choix. */
  label: string
}

const showSyncDialog = ref(false)
const selectedSyncTeamId = ref<string | null>(null)
const syncing = ref(false)
const syncResult = ref<{
  teamId: string
  perLink: SyncBasketplanForTeamPerLink[]
} | null>(null)
const syncError = ref<string | null>(null)

/** Liste des teams ayant au moins un `BasketplanCompetitionLink` mappé. */
const syncableTeams = computed<TeamPickOption[]>(() => {
  return teamsStore.teams
    .filter((t) => (t.basketplanLinks?.length ?? 0) > 0)
    .map((t) => {
      const count = t.basketplanLinks?.length ?? 0
      const suffix = ` · ${count} lien${count > 1 ? 's' : ''}`
      return { value: t.id, label: `${t.name}${suffix}` }
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'))
})

/** Agrégat des compteurs `perLink` pour le résumé toast/banner. */
const syncTotals = computed(() => {
  if (!syncResult.value) return null
  const totals = {
    processed: 0,
    created: 0,
    patched: 0,
    linked: 0,
    skipped: 0,
    errors: 0,
    linkErrors: 0,
    links: syncResult.value.perLink.length,
  }
  for (const l of syncResult.value.perLink) {
    totals.processed += l.processed
    totals.created += l.created
    totals.patched += l.patched
    totals.linked += l.linked
    totals.skipped += l.skipped
    totals.errors += l.errors
    if (l.error !== null) totals.linkErrors += 1
  }
  return totals
})

function openSyncDialog(): void {
  syncError.value = null
  syncResult.value = null
  selectedSyncTeamId.value = syncableTeams.value[0]?.value ?? null
  showSyncDialog.value = true
}

function closeSyncDialog(): void {
  if (syncing.value) return
  showSyncDialog.value = false
}

async function runManualSync(): Promise<void> {
  const teamId = selectedSyncTeamId.value
  if (!teamId) {
    syncError.value = 'Sélectionne une équipe à synchroniser.'
    return
  }
  syncing.value = true
  syncError.value = null
  syncResult.value = null
  try {
    const res = await syncBasketplanForTeam({ teamId })
    syncResult.value = { teamId: res.teamId, perLink: res.summary.perLink }
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`syncBasketplanForTeam failed [${code}]`, err)
    syncError.value =
      err instanceof Error
        ? err.message
        : 'Erreur inconnue lors de la synchronisation Basketplan.'
  } finally {
    syncing.value = false
  }
}
</script>

<template>
  <section class="p-6 space-y-4 max-w-3xl">
    <!-- ================= Page heading =================== -->
    <div>
      <h1 class="text-[22px] font-semibold tracking-tight flex items-center gap-2">
        <Plug
          :size="20"
          :stroke-width="2"
        />
        Intégration Basketplan
      </h1>
      <p class="text-[13px] text-surface-500 mt-0.5">
        Configure l'intégration Swiss Basketball / ORCA Systems pour ce club.
        Les équipes pourront ensuite être liées à leurs compétitions
        (championnats, coupes) depuis la fiche détail.
      </p>
    </div>

    <!-- ================= Configuration card =================== -->
    <div class="card p-5 space-y-4">
      <h3 class="text-[14px] font-semibold">
        Configuration
      </h3>

      <!-- Enabled toggle -->
      <div class="flex items-start justify-between gap-4">
        <div>
          <div class="text-[13px] font-medium">
            Activer l'intégration
          </div>
          <p class="text-[12px] text-surface-500 mt-0.5">
            Lorsque désactivé, le sync nocturne ne s'exécute pas. Le mapping
            des équipes reste accessible.
          </p>
        </div>
        <ToggleSwitch v-model="form.enabled" />
      </div>

      <!-- ClubId -->
      <label class="block">
        <span class="text-[12px] text-surface-600">
          clubId Basketplan
        </span>
        <InputNumber
          v-model="form.clubId"
          :min="1"
          :max-fraction-digits="0"
          :use-grouping="false"
          placeholder="Ex. 60 (Marly)"
          input-class="!w-full"
          class="mt-1 w-full"
        />
        <span class="text-[11px] text-surface-500 mt-1 block">
          Id numérique du club côté Basketplan. Visible dans l'URL des pages
          public Swiss Basketball (paramètre <code class="text-surface-700">clubId</code>).
        </span>
      </label>

      <!-- Default federation -->
      <label class="block">
        <span class="text-[12px] text-surface-600">
          Fédération par défaut
        </span>
        <Select
          v-model="selectedFederation"
          :options="FEDERATION_OPTIONS"
          option-label="label"
          option-value="value"
          placeholder="Sélectionner une fédération…"
          class="mt-1 w-full"
        />
        <span class="text-[11px] text-surface-500 mt-1 block">
          Fédération principale du club. Sert au dropdown initial du dialog
          de mapping et au test de connexion ci-dessous. Une équipe peut
          être liée à des compétitions d'autres fédérations.
        </span>
      </label>

      <!-- Custom federation id (only when "Autre ID" selected) -->
      <label
        v-if="form.useCustomFederation"
        class="block"
      >
        <span class="text-[12px] text-surface-600">
          Id de fédération (custom)
        </span>
        <InputNumber
          v-model="form.customFederationId"
          :min="1"
          :max-fraction-digits="0"
          :use-grouping="false"
          placeholder="Ex. 12"
          input-class="!w-full"
          class="mt-1 w-full"
        />
        <span class="text-[11px] text-surface-500 mt-1 block">
          Si ta fédération n'est pas dans la liste, saisis son id numérique
          Basketplan ici. Tu peux le trouver via
          <code class="text-surface-700">findAllLeagueHoldings.do?federationId=N</code>.
        </span>
      </label>

      <!-- Form error -->
      <div
        v-if="formError"
        class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 flex items-start gap-2"
      >
        <AlertTriangle
          :size="14"
          :stroke-width="2"
          class="mt-px shrink-0"
        />
        <span>{{ formError }}</span>
      </div>

      <!-- Save button -->
      <div class="flex items-center gap-2 pt-1">
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="saving || store.savingSection !== null"
          @click="save"
        >
          <template v-if="saving">
            Enregistrement…
          </template>
          <template v-else>
            Enregistrer
          </template>
        </button>
        <span
          v-if="store.lastSaved === 'basketplan'"
          class="text-[12px] text-emerald-700 inline-flex items-center gap-1"
        >
          <CheckCircle2
            :size="12"
            :stroke-width="2"
          />
          Sauvegardé
        </span>
      </div>
    </div>

    <!-- ================= Test connection card =================== -->
    <div class="card p-5 space-y-3">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h3 class="text-[14px] font-semibold">
            Tester la connexion
          </h3>
          <p class="text-[12px] text-surface-500 mt-0.5">
            Effectue un ping sur
            <code class="text-surface-700">findAllLeagueHoldings.do</code> pour
            la fédération par défaut configurée. Confirme que la
            connectivité Basketplan fonctionne.
          </p>
        </div>
        <button
          type="button"
          class="btn btn-secondary btn-sm shrink-0"
          :disabled="testing"
          @click="runTestConnection"
        >
          <Loader2
            v-if="testing"
            :size="14"
            :stroke-width="2"
            class="animate-spin"
          />
          <Plug
            v-else
            :size="14"
            :stroke-width="2"
          />
          <template v-if="testing">
            Test en cours…
          </template>
          <template v-else>
            Tester
          </template>
        </button>
      </div>

      <div
        v-if="testResult && testResult.ok"
        class="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700 flex items-start gap-2"
      >
        <CheckCircle2
          :size="14"
          :stroke-width="2"
          class="mt-px shrink-0"
        />
        <span>
          Connexion OK
          <template v-if="testResult.federationId !== null">
            sur {{ federationLabelFor(testResult.federationId) }}
          </template>
          —
          <strong class="num">{{ testResult.leagueCount ?? 0 }}</strong>
          compétition<span v-if="(testResult.leagueCount ?? 0) > 1">s</span>
          retournée<span v-if="(testResult.leagueCount ?? 0) > 1">s</span>.
        </span>
      </div>

      <div
        v-else-if="testResult && !testResult.ok"
        class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 flex items-start gap-2"
      >
        <AlertTriangle
          :size="14"
          :stroke-width="2"
          class="mt-px shrink-0"
        />
        <span>
          {{ testResult.error ?? 'Erreur inconnue.' }}
        </span>
      </div>
    </div>

    <!-- ================= Sync status card =================== -->
    <div class="card p-5 space-y-3">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h3 class="text-[14px] font-semibold">
            Dernière synchronisation
          </h3>
          <p class="text-[12px] text-surface-500 mt-0.5">
            La synchronisation nocturne s'exécute chaque jour à 03:00
            (Europe/Zurich) et met à jour les matchs (création / arbitres /
            scores) pour toutes les équipes du club.
          </p>
        </div>
        <button
          type="button"
          class="btn btn-secondary btn-sm shrink-0"
          :disabled="syncableTeams.length === 0"
          :title="
            syncableTeams.length === 0
              ? 'Aucune équipe liée à une compétition Basketplan.'
              : undefined
          "
          @click="openSyncDialog"
        >
          <RotateCw
            :size="14"
            :stroke-width="2"
          />
          <span class="ml-1.5">Synchroniser maintenant</span>
        </button>
      </div>

      <template v-if="lastSyncLabel">
        <div class="text-[13px] text-surface-700 num">
          {{ lastSyncLabel }}
        </div>
      </template>
      <template v-else>
        <p class="text-[12px] text-surface-500">
          Aucune synchronisation effectuée pour l'instant.
        </p>
      </template>

      <div
        v-if="lastSyncError"
        class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 flex items-start gap-2"
      >
        <AlertTriangle
          :size="14"
          :stroke-width="2"
          class="mt-px shrink-0"
        />
        <span>{{ lastSyncError }}</span>
      </div>
    </div>

    <!-- ================= Dialog "Synchroniser maintenant" =================== -->
    <Dialog
      v-model:visible="showSyncDialog"
      modal
      :closable="!syncing"
      :close-on-escape="!syncing"
      :draggable="false"
      header="Synchroniser une équipe avec Basketplan"
      :pt="{ root: { style: 'width: 540px; max-width: calc(100vw - 32px);' } }"
      @hide="closeSyncDialog"
    >
      <div class="space-y-4">
        <p class="text-[12.5px] text-surface-600">
          Lance manuellement la synchronisation Basketplan pour une seule
          équipe (création des matchs AWAY, mise à jour des arbitres et des
          scores homologués). La sync globale tourne automatiquement chaque
          nuit — utilise ce bouton uniquement pour un besoin ponctuel.
        </p>

        <template v-if="syncableTeams.length === 0">
          <div
            class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 flex items-start gap-2"
          >
            <AlertTriangle
              :size="14"
              :stroke-width="2"
              class="mt-px shrink-0"
            />
            <span>
              Aucune équipe n'est liée à une compétition Basketplan.
              Configure le mapping depuis la fiche détail d'une équipe avant
              de pouvoir synchroniser.
            </span>
          </div>
        </template>

        <template v-else>
          <label class="block">
            <span class="text-[12px] text-surface-600">Équipe</span>
            <Select
              v-model="selectedSyncTeamId"
              :options="syncableTeams"
              option-label="label"
              option-value="value"
              placeholder="Sélectionner une équipe…"
              :disabled="syncing"
              class="mt-1 w-full"
            />
          </label>
        </template>

        <div
          v-if="syncError"
          class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 flex items-start gap-2"
        >
          <AlertTriangle
            :size="14"
            :stroke-width="2"
            class="mt-px shrink-0"
          />
          <span>{{ syncError }}</span>
        </div>

        <div
          v-if="syncResult && syncTotals"
          class="space-y-2"
        >
          <div
            class="rounded-md border px-3 py-2 text-[12px] flex items-start gap-2"
            :class="
              syncTotals.errors > 0 || syncTotals.linkErrors > 0
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            "
          >
            <CheckCircle2
              v-if="syncTotals.errors === 0 && syncTotals.linkErrors === 0"
              :size="14"
              :stroke-width="2"
              class="mt-px shrink-0"
            />
            <AlertTriangle
              v-else
              :size="14"
              :stroke-width="2"
              class="mt-px shrink-0"
            />
            <span>
              Sync terminée sur
              <strong class="num">{{ syncTotals.links }}</strong>
              lien<span v-if="syncTotals.links > 1">s</span> :
              <strong class="num">{{ syncTotals.created }}</strong> créé<span
                v-if="syncTotals.created > 1"
              >s</span>,
              <strong class="num">{{ syncTotals.patched }}</strong> patché<span
                v-if="syncTotals.patched > 1"
              >s</span>,
              <strong class="num">{{ syncTotals.linked }}</strong> lié<span
                v-if="syncTotals.linked > 1"
              >s</span>,
              <strong class="num">{{ syncTotals.skipped }}</strong> ignoré<span
                v-if="syncTotals.skipped > 1"
              >s</span>,
              <strong class="num">{{ syncTotals.errors }}</strong> erreur<span
                v-if="syncTotals.errors > 1"
              >s</span>.
            </span>
          </div>

          <!-- Détail par lien si erreur ou pour transparence -->
          <details
            v-if="syncResult.perLink.length > 0"
            class="rounded-md border border-surface-200 bg-surface-50 px-3 py-2 text-[12px] text-surface-700"
          >
            <summary class="cursor-pointer font-medium select-none">
              Détail par compétition ({{ syncResult.perLink.length }})
            </summary>
            <ul class="mt-2 space-y-1.5">
              <li
                v-for="link in syncResult.perLink"
                :key="link.linkId"
                class="flex flex-col gap-0.5"
              >
                <div class="font-medium text-surface-900">
                  {{ link.leagueHoldingName || `#${link.leagueHoldingId}` }}
                </div>
                <div class="text-[11.5px] text-surface-600 num">
                  {{ link.processed }} traité<span v-if="link.processed > 1">s</span> ·
                  +{{ link.created }} créé<span v-if="link.created > 1">s</span> ·
                  ~{{ link.patched }} patché<span v-if="link.patched > 1">s</span> ·
                  ↪{{ link.linked }} lié<span v-if="link.linked > 1">s</span> ·
                  {{ link.skipped }} ignoré<span v-if="link.skipped > 1">s</span> ·
                  {{ link.errors }} erreur<span v-if="link.errors > 1">s</span>
                </div>
                <div
                  v-if="link.error"
                  class="text-[11.5px] text-rose-700 truncate"
                  :title="link.error"
                >
                  {{ link.error }}
                </div>
              </li>
            </ul>
          </details>
        </div>
      </div>

      <template #footer>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          :disabled="syncing"
          @click="closeSyncDialog"
        >
          Fermer
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="syncing || !selectedSyncTeamId || syncableTeams.length === 0"
          @click="runManualSync"
        >
          <Loader2
            v-if="syncing"
            :size="14"
            :stroke-width="2"
            class="animate-spin"
          />
          <RotateCw
            v-else
            :size="14"
            :stroke-width="2"
          />
          <span class="ml-1.5">
            <template v-if="syncing">Synchronisation…</template>
            <template v-else>Lancer la sync</template>
          </span>
        </button>
      </template>
    </Dialog>
  </section>
</template>
