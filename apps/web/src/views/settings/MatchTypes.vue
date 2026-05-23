<script setup lang="ts">
/**
 * Settings → Saison / Compétition → Match types.
 *
 * Référentiel `/matchTypes` — un type définit la taille de court requise et
 * les exigences officiels home / away pour chaque type de compétition (CSJC,
 * AFBB, Amical…). Vue extraite de `views/Settings.vue` (script 1793-2045 +
 * template 3990-4102 + dialogs 5161-5326 / 5327-5384).
 *
 * Pattern aligné sur LicenseTypes : un dialog unifié `create | edit`, garde-fou
 * anti-delete dans le repo (`isMatchTypeUsed`) — l'UI surface l'erreur dans
 * la card d'avertissement du dialog suppression et suggère la désactivation
 * (`active: false`) en alternative.
 */
import { computed, onMounted, ref } from 'vue'
import { Check, Plus, Trash2 } from 'lucide-vue-next'
import Checkbox from 'primevue/checkbox'
import Dialog from 'primevue/dialog'
import InputNumber from 'primevue/inputnumber'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import { useMatchTypesStore, type MatchTypeInput } from '@/stores/matchTypes'
import Pill from '@/components/ui/Pill.vue'
import type {
  CourtSize,
  MatchType,
  OfficialRequirement,
} from '@club-app/shared-types'

const matchTypesStore = useMatchTypesStore()

// ---------------------------------------------------------------------------
// Lifecycle — lazy load à la 1re visite. Pas de re-fetch si déjà chargé.
// ---------------------------------------------------------------------------

onMounted(() => {
  if (matchTypesStore.matchTypes.length === 0) {
    void matchTypesStore.load()
  }
})

// ---------------------------------------------------------------------------
// Constantes (court sizes)
// ---------------------------------------------------------------------------

const COURT_SIZE_OPTIONS: { value: CourtSize; label: string }[] = [
  { value: 'small', label: 'Petit' },
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Grand' },
]

const COURT_SIZE_LABEL: Record<CourtSize, string> = {
  small: 'Petit',
  normal: 'Normal',
  large: 'Grand',
}

// ---------------------------------------------------------------------------
// Create/Edit dialog — un seul dialog unifié pour limiter la duplication.
// `mode === null` ⇔ fermé.
// ---------------------------------------------------------------------------

type MatchTypeDialogMode = 'create' | 'edit'

interface MatchTypeDraft {
  id: string | null
  name: string
  requiredCourtSize: CourtSize
  homeOfficialRequirements: OfficialRequirement[]
  awayOfficialCount: number
  color: string
  active: boolean
}

function emptyMatchTypeDraft(): MatchTypeDraft {
  return {
    id: null,
    name: '',
    requiredCourtSize: 'normal',
    homeOfficialRequirements: [],
    awayOfficialCount: 0,
    color: '#10b981',
    active: true,
  }
}

const matchTypeDialogMode = ref<MatchTypeDialogMode | null>(null)
const matchTypeDraft = ref<MatchTypeDraft>(emptyMatchTypeDraft())
const matchTypeError = ref<string | null>(null)

const isMatchTypeDialogOpen = computed<boolean>({
  get: () => matchTypeDialogMode.value !== null,
  set: (v: boolean) => {
    if (!v) {
      matchTypeDialogMode.value = null
      matchTypeError.value = null
    }
  },
})

function openCreateMatchTypeDialog(): void {
  matchTypeDraft.value = emptyMatchTypeDraft()
  matchTypeError.value = null
  matchTypeDialogMode.value = 'create'
}

function openEditMatchTypeDialog(mt: MatchType): void {
  matchTypeDraft.value = {
    id: mt.id,
    name: mt.name,
    requiredCourtSize: mt.requiredCourtSize,
    // Copie défensive — sinon le binding v-model muterait le state du store
    // tant que le dialog n'est pas validé.
    homeOfficialRequirements: mt.homeOfficialRequirements.map((r) => ({
      level: r.level,
      count: r.count,
    })),
    awayOfficialCount: mt.awayOfficialCount,
    color: mt.color,
    active: mt.active,
  }
  matchTypeError.value = null
  matchTypeDialogMode.value = 'edit'
}

function closeMatchTypeDialog(): void {
  matchTypeDialogMode.value = null
  matchTypeError.value = null
}

function addOfficialRequirement(): void {
  matchTypeDraft.value.homeOfficialRequirements.push({ level: 1, count: 1 })
}

function removeOfficialRequirement(idx: number): void {
  matchTypeDraft.value.homeOfficialRequirements.splice(idx, 1)
}

// ---------------------------------------------------------------------------
// Validation & helpers d'affichage
// ---------------------------------------------------------------------------

/** Hex `#RRGGBB` (case-insensitive). 3-digit form refusé pour rester strict. */
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

function validateMatchTypeDraft(d: MatchTypeDraft): string | null {
  const name = d.name.trim()
  if (!name) return 'Le nom est requis.'
  if (!['small', 'normal', 'large'].includes(d.requiredCourtSize)) {
    return 'Taille de court invalide.'
  }
  if (
    typeof d.awayOfficialCount !== 'number'
    || Number.isNaN(d.awayOfficialCount)
    || d.awayOfficialCount < 0
  ) {
    return 'Le nombre d\'officiels away doit être >= 0.'
  }
  for (const r of d.homeOfficialRequirements) {
    if (
      typeof r.level !== 'number'
      || Number.isNaN(r.level)
      || r.level < 0
    ) {
      return 'Niveau d\'officiel invalide (doit être >= 0).'
    }
    if (
      typeof r.count !== 'number'
      || Number.isNaN(r.count)
      || r.count < 1
    ) {
      return 'Quantité d\'officiels invalide (doit être >= 1).'
    }
  }
  if (!HEX_COLOR_RE.test(d.color)) {
    return 'Couleur invalide — format attendu #RRGGBB.'
  }
  return null
}

/**
 * Formatte les exigences home pour l'affichage liste : `[{level:2,count:1},
 * {level:1,count:2}]` → "1× N2 + 2× N1". Renvoie "—" si vide.
 */
function formatOfficialReqs(reqs: OfficialRequirement[]): string {
  if (reqs.length === 0) return '—'
  return reqs.map((r) => `${r.count}× N${r.level}`).join(' + ')
}

// ---------------------------------------------------------------------------
// Flash messages (created/updated/deleted/activated/deactivated)
// ---------------------------------------------------------------------------

const matchTypeFlashMessage = ref<string | null>(null)

function setMatchTypeFlash(
  kind: 'created' | 'updated' | 'deleted' | 'activated' | 'deactivated',
): void {
  const labels: Record<typeof kind, string> = {
    created: 'Type de match créé.',
    updated: 'Type de match mis à jour.',
    deleted: 'Type de match supprimé.',
    activated: 'Type de match activé.',
    deactivated: 'Type de match désactivé.',
  }
  matchTypeFlashMessage.value = labels[kind]
  window.setTimeout(() => {
    if (matchTypeFlashMessage.value === labels[kind]) {
      matchTypeFlashMessage.value = null
    }
  }, 2500)
}

// ---------------------------------------------------------------------------
// Commit (create / update)
// ---------------------------------------------------------------------------

async function commitMatchType(): Promise<void> {
  const draft = matchTypeDraft.value
  const validationError = validateMatchTypeDraft(draft)
  if (validationError) {
    matchTypeError.value = validationError
    return
  }
  const input: MatchTypeInput = {
    name: draft.name.trim(),
    requiredCourtSize: draft.requiredCourtSize,
    homeOfficialRequirements: draft.homeOfficialRequirements.map((r) => ({
      level: r.level,
      count: r.count,
    })),
    awayOfficialCount: draft.awayOfficialCount,
    color: draft.color,
    active: draft.active,
  }
  if (matchTypeDialogMode.value === 'create') {
    const id = await matchTypesStore.create(input)
    if (id !== null) {
      closeMatchTypeDialog()
      setMatchTypeFlash('created')
    } else if (matchTypesStore.error) {
      matchTypeError.value = matchTypesStore.error
    }
  } else if (matchTypeDialogMode.value === 'edit' && draft.id) {
    const ok = await matchTypesStore.update(draft.id, input)
    if (ok) {
      closeMatchTypeDialog()
      setMatchTypeFlash('updated')
    } else if (matchTypesStore.error) {
      matchTypeError.value = matchTypesStore.error
    }
  }
}

async function toggleMatchTypeActive(mt: MatchType): Promise<void> {
  const ok = await matchTypesStore.update(mt.id, { active: !mt.active })
  if (ok) {
    setMatchTypeFlash(mt.active ? 'deactivated' : 'activated')
  }
}

// ---------------------------------------------------------------------------
// Delete dialog — garde-fou anti-delete enforced dans le repo
// (`isMatchTypeUsed`). Si l'erreur remonte, le dialog reste ouvert et affiche
// l'erreur dans une card d'avertissement avec invitation à désactiver plutôt.
// ---------------------------------------------------------------------------

const deleteMatchTypeDialogTarget = ref<MatchType | null>(null)

const isDeleteMatchTypeDialogOpen = computed<boolean>({
  get: () => deleteMatchTypeDialogTarget.value !== null,
  set: (v: boolean) => {
    if (!v) deleteMatchTypeDialogTarget.value = null
  },
})

function openDeleteMatchTypeDialog(mt: MatchType): void {
  // Clear toute erreur précédente (ex. tentative de suppression d'un type
  // référencé) pour que le dialog démarre propre.
  matchTypesStore.error = null
  deleteMatchTypeDialogTarget.value = mt
}

function closeDeleteMatchTypeDialog(): void {
  deleteMatchTypeDialogTarget.value = null
}

async function confirmDeleteMatchType(): Promise<void> {
  const target = deleteMatchTypeDialogTarget.value
  if (!target) return
  const ok = await matchTypesStore.remove(target.id)
  if (ok) {
    closeDeleteMatchTypeDialog()
    setMatchTypeFlash('deleted')
  }
  // Si !ok : `matchTypesStore.error` contient le message ("matchType in use…")
  // — le dialog reste ouvert et l'erreur s'affiche dans la card d'avertissement
  // dédiée (cf. template).
}
</script>

<template>
  <section class="p-6 space-y-6">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="text-[16px] font-semibold">
          Match types
        </h2>
        <p class="text-[13px] text-surface-500">
          Référentiel des types de compétition (CSJC, AFBB, Amical, …).
          Chaque type définit la taille de court requise et les officiels
          à fournir à domicile et à l'extérieur. Désactive un type pour
          le retirer des pickers de création de match sans perdre
          l'historique.
        </p>
      </div>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        :disabled="matchTypesStore.loading"
        @click="openCreateMatchTypeDialog"
      >
        <Plus
          :size="14"
          :stroke-width="2"
        />
        Nouveau type
      </button>
    </div>

    <!-- Match types list -->
    <div class="border border-surface-200 rounded-md divide-y divide-surface-200">
      <div
        v-for="mt in matchTypesStore.matchTypes"
        :key="mt.id"
        class="flex items-center gap-3 px-3 py-2.5"
      >
        <span
          class="inline-block h-3 w-3 rounded-full border border-surface-200 shrink-0"
          :style="{ backgroundColor: mt.color }"
        />
        <span class="font-medium text-[13px]">{{ mt.name }}</span>
        <Pill variant="slate">
          {{ COURT_SIZE_LABEL[mt.requiredCourtSize] }}
        </Pill>
        <span class="text-[11px] text-surface-500">
          Home : {{ formatOfficialReqs(mt.homeOfficialRequirements) }}
        </span>
        <span class="text-[11px] text-surface-500">
          Away : {{ mt.awayOfficialCount }} officiel{{ mt.awayOfficialCount > 1 ? 's' : '' }}
        </span>
        <Pill
          v-if="!mt.active"
          variant="amber"
        >
          inactif
        </Pill>
        <span class="text-[11px] text-surface-400 font-mono ml-2">
          /matchTypes/{{ mt.id }}
        </span>
        <div class="ml-auto flex items-center gap-2">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            @click="openEditMatchTypeDialog(mt)"
          >
            Éditer
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            @click="toggleMatchTypeActive(mt)"
          >
            {{ mt.active ? 'Désactiver' : 'Activer' }}
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm !text-rose-700"
            @click="openDeleteMatchTypeDialog(mt)"
          >
            <Trash2
              :size="14"
              :stroke-width="2"
            />
          </button>
        </div>
      </div>

      <div
        v-if="matchTypesStore.matchTypes.length === 0"
        class="px-3 py-6 text-center text-[12px] text-surface-500"
      >
        <template v-if="matchTypesStore.loading">
          Chargement…
        </template>
        <template v-else>
          Aucun type de match configuré. Crée le premier pour pouvoir
          l'utiliser depuis la création de match.
        </template>
      </div>
    </div>

    <div
      v-if="matchTypeFlashMessage"
      class="text-[12px] text-emerald-700 flex items-center gap-1"
    >
      <Check
        :size="14"
        :stroke-width="2"
      />
      {{ matchTypeFlashMessage }}
    </div>

    <!-- =================== Create/edit dialog =================== -->
    <Dialog
      v-model:visible="isMatchTypeDialogOpen"
      modal
      :draggable="false"
      :style="{ width: '600px' }"
      :header="matchTypeDialogMode === 'edit' ? 'Éditer un type de match' : 'Nouveau type de match'"
    >
      <div class="space-y-4 pt-1">
        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-[12px] text-surface-600">Nom</span>
            <InputText
              v-model="matchTypeDraft.name"
              placeholder="Ex. CSJC, AFBB, Amical"
              class="mt-1 w-full"
            />
          </label>
          <label class="block">
            <span class="text-[12px] text-surface-600">Court requis</span>
            <Select
              v-model="matchTypeDraft.requiredCourtSize"
              :options="COURT_SIZE_OPTIONS"
              option-label="label"
              option-value="value"
              class="mt-1 w-full"
            />
          </label>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-[12px] text-surface-600">
              Officiels away
              <span class="text-surface-400">(nombre à fournir)</span>
            </span>
            <InputNumber
              v-model="matchTypeDraft.awayOfficialCount"
              :min="0"
              input-class="!w-full"
              class="mt-1 w-full"
            />
          </label>
          <div class="block">
            <span class="text-[12px] text-surface-600">Couleur (chip)</span>
            <div class="mt-1 flex items-center gap-2">
              <input
                v-model="matchTypeDraft.color"
                type="color"
                class="h-9 w-12 rounded border border-surface-200 cursor-pointer"
              >
              <InputText
                v-model="matchTypeDraft.color"
                placeholder="#10b981"
                class="flex-1"
              />
            </div>
          </div>
        </div>

        <!-- Home official requirements editor -->
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-2">
            <div>
              <span class="text-[12px] text-surface-600 font-medium">
                Officiels home
              </span>
              <p class="text-[11px] text-surface-400">
                Une ligne par niveau requis. Ex. "1 arbitre N2 + 2 arbitres N1".
              </p>
            </div>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              @click="addOfficialRequirement"
            >
              <Plus
                :size="14"
                :stroke-width="2"
              />
              Ajouter une exigence
            </button>
          </div>

          <div
            v-if="matchTypeDraft.homeOfficialRequirements.length === 0"
            class="text-[11px] text-surface-400 px-2 py-2 border border-dashed border-surface-200 rounded"
          >
            Aucune exigence — ce type ne demande pas d'officiel à domicile.
          </div>

          <div
            v-for="(req, idx) in matchTypeDraft.homeOfficialRequirements"
            :key="idx"
            class="flex items-center gap-2"
          >
            <label class="block">
              <span class="text-[11px] text-surface-500">Niveau</span>
              <InputNumber
                v-model="req.level"
                :min="0"
                input-class="!w-20"
                class="mt-0.5"
              />
            </label>
            <label class="block">
              <span class="text-[11px] text-surface-500">Quantité</span>
              <InputNumber
                v-model="req.count"
                :min="1"
                input-class="!w-20"
                class="mt-0.5"
              />
            </label>
            <button
              type="button"
              class="btn btn-ghost btn-sm !text-rose-700 self-end mb-0.5"
              @click="removeOfficialRequirement(idx)"
            >
              <Trash2
                :size="14"
                :stroke-width="2"
              />
            </button>
          </div>
        </div>

        <label class="flex items-center gap-2 cursor-pointer text-[12px]">
          <Checkbox
            v-model="matchTypeDraft.active"
            binary
            input-id="match-type-active"
          />
          <span>
            Type actif
            <span class="text-surface-400">
              (sinon, retiré des pickers de création de match)
            </span>
          </span>
        </label>

        <div
          v-if="matchTypeError"
          class="text-[11px] text-rose-600"
        >
          {{ matchTypeError }}
        </div>
      </div>
      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          @click="closeMatchTypeDialog"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          @click="commitMatchType"
        >
          {{ matchTypeDialogMode === 'edit' ? 'Sauvegarder' : 'Créer' }}
        </button>
      </template>
    </Dialog>

    <!-- =================== Delete dialog =================== -->
    <Dialog
      v-model:visible="isDeleteMatchTypeDialogOpen"
      modal
      :draggable="false"
      :style="{ width: '460px' }"
      header="Supprimer le type de match"
    >
      <div
        v-if="deleteMatchTypeDialogTarget"
        class="space-y-3 pt-1"
      >
        <div class="flex items-center gap-2 flex-wrap">
          <span
            class="inline-block h-3 w-3 rounded-full border border-surface-200 shrink-0"
            :style="{ backgroundColor: deleteMatchTypeDialogTarget.color }"
          />
          <span class="font-medium text-[13px]">
            {{ deleteMatchTypeDialogTarget.name }}
          </span>
          <Pill variant="slate">
            {{ COURT_SIZE_LABEL[deleteMatchTypeDialogTarget.requiredCourtSize] }}
          </Pill>
        </div>
        <p class="text-[13px] text-surface-700">
          La suppression est définitive. Si ce type est déjà utilisé par un
          ou plusieurs matchs, désactive-le plutôt — le type sera retiré des
          pickers de création tout en restant résolvable sur l'historique.
        </p>
        <div
          v-if="matchTypesStore.error"
          class="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5"
        >
          {{ matchTypesStore.error }}
        </div>
      </div>
      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          @click="closeDeleteMatchTypeDialog"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm !bg-rose-600 hover:!bg-rose-700"
          @click="confirmDeleteMatchType"
        >
          <Trash2
            :size="14"
            :stroke-width="2"
          />
          Supprimer définitivement
        </button>
      </template>
    </Dialog>
  </section>
</template>
