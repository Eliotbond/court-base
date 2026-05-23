<script setup lang="ts">
/**
 * Settings → Saison / Compétition → Types de licence.
 *
 * Référentiel `/licenseTypes` — grille tarifaire des licences fédérales,
 * organisée par rôle (player / official / coach / referee) et par niveau.
 * Le prix est snapshotté au moment de l'émission d'une licence (`/licenses`)
 * — une mise à jour ici n'affecte pas les licences déjà émises.
 *
 * Vue extraite de `views/Settings.vue` (script 1544-1789 + template 3828-3989
 * + dialogs 5000-5159). Pattern : un dialog unifié `create | edit`, validation
 * locale + serveur (`validateRoleLevel` + unicité `(role, level)`), garde-fou
 * delete côté repo.
 *
 * Règles métier (cf. `docs/main.md` §"Licences") :
 * - `player` → `level: null` toujours (distinction par `name`)
 * - `official` / `coach` / `referee` → `level` numérique requis
 * - Unicité `(role, level)` pour les rôles à niveau
 */
import { computed, onMounted, ref } from 'vue'
import { BadgeCheck, Check, Plus, Trash2 } from 'lucide-vue-next'
import Checkbox from 'primevue/checkbox'
import Dialog from 'primevue/dialog'
import InputNumber from 'primevue/inputnumber'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import { useLicenseTypesStore } from '@/stores/licenseTypes'
import Pill from '@/components/ui/Pill.vue'
import type { LicenseRole, LicenseType } from '@club-app/shared-types'

const licenseTypesStore = useLicenseTypesStore()

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

onMounted(() => {
  if (licenseTypesStore.licenseTypes.length === 0) {
    void licenseTypesStore.load()
  }
})

// ---------------------------------------------------------------------------
// Affichage : filtre archivés (toggle) + 4 fieldsets (un par rôle)
// ---------------------------------------------------------------------------

const showArchivedLicenseTypes = ref(false)

const archivedLicenseTypesCount = computed<number>(() => {
  return licenseTypesStore.licenseTypes.filter((t) => !t.active).length
})

const LICENSE_ROLES: readonly LicenseRole[] = [
  'player',
  'official',
  'coach',
  'referee',
]

const LICENSE_ROLE_LABEL: Record<LicenseRole, string> = {
  player: 'Joueur',
  official: 'Officiel',
  coach: 'Coach',
  referee: 'Arbitre',
}

const LICENSE_ROLE_OPTIONS = LICENSE_ROLES.map((role) => ({
  label: LICENSE_ROLE_LABEL[role],
  value: role,
}))

/**
 * Liste à afficher pour un rôle donné, filtrée selon le toggle "afficher
 * archivées". Les fieldsets template appellent cette fonction une fois par
 * rôle (la dépendance réactive passe par `licenseTypesStore.groupedByRole`
 * + `showArchivedLicenseTypes`).
 */
function visibleLicenseTypesFor(role: LicenseRole): LicenseType[] {
  const all = licenseTypesStore.groupedByRole[role]
  if (showArchivedLicenseTypes.value) return all
  return all.filter((t) => t.active)
}

// ---------------------------------------------------------------------------
// Draft state (create/edit)
// ---------------------------------------------------------------------------

interface LicenseTypeDraft {
  role: LicenseRole
  /**
   * Niveau numérique pour les rôles avec niveau (official/coach/referee).
   * Pour `player`, ce champ est ignoré et persisté à `null`.
   */
  level: number
  name: string
  fee: number
  /** Vide → auto-assign en queue côté repo. */
  displayOrder: number | null
}

function emptyLicenseTypeDraft(role: LicenseRole = 'player'): LicenseTypeDraft {
  return {
    role,
    level: 1,
    name: '',
    fee: 0,
    displayOrder: null,
  }
}

const isAddingLicenseType = ref(false)
const editingLicenseTypeId = ref<string | null>(null)
const licenseTypeDraft = ref<LicenseTypeDraft>(emptyLicenseTypeDraft())
const licenseTypeError = ref<string | null>(null)

/** Le rôle actuellement sélectionné dans la draft attend un niveau. */
const draftRoleRequiresLevel = computed<boolean>(() => {
  return licenseTypesStore.roleRequiresLevel(licenseTypeDraft.value.role)
})

// ---------------------------------------------------------------------------
// Flash messages (created/updated/archived/unarchived/deleted)
// ---------------------------------------------------------------------------

const licenseTypeFlash = ref<
  'created' | 'updated' | 'archived' | 'unarchived' | 'deleted' | null
>(null)

function setLicenseTypeFlash(
  kind: NonNullable<typeof licenseTypeFlash.value>,
): void {
  licenseTypeFlash.value = kind
  window.setTimeout(() => {
    if (licenseTypeFlash.value === kind) licenseTypeFlash.value = null
  }, 3000)
}

const licenseTypeFlashMessage = computed<string | null>(() => {
  switch (licenseTypeFlash.value) {
    case 'created':
      return 'Type de licence créé'
    case 'updated':
      return 'Type de licence mis à jour'
    case 'archived':
      return 'Type de licence archivé'
    case 'unarchived':
      return 'Type de licence réactivé'
    case 'deleted':
      return 'Type de licence supprimé'
    default:
      return null
  }
})

// ---------------------------------------------------------------------------
// Dialog open/close
// ---------------------------------------------------------------------------

const isLicenseTypeDialogOpen = computed<boolean>({
  get: () => isAddingLicenseType.value || editingLicenseTypeId.value !== null,
  set: (v: boolean) => {
    if (!v) cancelLicenseTypeEdit()
  },
})

function startAddLicenseType(role: LicenseRole = 'player'): void {
  isAddingLicenseType.value = true
  editingLicenseTypeId.value = null
  licenseTypeDraft.value = emptyLicenseTypeDraft(role)
  licenseTypeError.value = null
}

function startEditLicenseType(t: LicenseType): void {
  isAddingLicenseType.value = false
  editingLicenseTypeId.value = t.id
  licenseTypeDraft.value = {
    role: t.role,
    level: t.level ?? 1,
    name: t.name,
    fee: t.fee,
    displayOrder: t.displayOrder,
  }
  licenseTypeError.value = null
}

function cancelLicenseTypeEdit(): void {
  isAddingLicenseType.value = false
  editingLicenseTypeId.value = null
  licenseTypeError.value = null
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateLicenseTypeDraft(): boolean {
  const name = licenseTypeDraft.value.name.trim()
  if (!name) {
    licenseTypeError.value = 'Nom requis'
    return false
  }
  if (licenseTypeDraft.value.fee < 0) {
    licenseTypeError.value = 'Le prix doit être >= 0'
    return false
  }
  if (draftRoleRequiresLevel.value && licenseTypeDraft.value.level < 0) {
    licenseTypeError.value = 'Le niveau doit être >= 0'
    return false
  }
  // Unicité (role, level) pour les rôles à niveau — vérifiée côté store
  // aussi, doublée ici pour un message d'erreur immédiat avant l'appel async.
  const level = draftRoleRequiresLevel.value
    ? licenseTypeDraft.value.level
    : null
  const conflictId = licenseTypesStore.findConflict(
    licenseTypeDraft.value.role,
    level,
    editingLicenseTypeId.value ?? undefined,
  )
  if (conflictId !== null) {
    licenseTypeError.value =
      'Un type de licence existe déjà pour ce rôle et ce niveau.'
    return false
  }
  licenseTypeError.value = null
  return true
}

// ---------------------------------------------------------------------------
// Commit (create / update)
// ---------------------------------------------------------------------------

async function commitLicenseType(): Promise<void> {
  if (!validateLicenseTypeDraft()) return
  const name = licenseTypeDraft.value.name.trim()
  const fee = licenseTypeDraft.value.fee
  const level = draftRoleRequiresLevel.value
    ? licenseTypeDraft.value.level
    : null
  const orderRaw = licenseTypeDraft.value.displayOrder
  if (isAddingLicenseType.value) {
    const id = await licenseTypesStore.create({
      role: licenseTypeDraft.value.role,
      level,
      name,
      fee,
      ...(orderRaw !== null ? { displayOrder: orderRaw } : {}),
    })
    if (id !== null) {
      cancelLicenseTypeEdit()
      setLicenseTypeFlash('created')
    } else if (licenseTypesStore.error) {
      licenseTypeError.value = licenseTypesStore.error
    }
  } else if (editingLicenseTypeId.value) {
    const ok = await licenseTypesStore.update(editingLicenseTypeId.value, {
      role: licenseTypeDraft.value.role,
      level,
      name,
      fee,
      ...(orderRaw !== null ? { displayOrder: orderRaw } : {}),
    })
    if (ok) {
      cancelLicenseTypeEdit()
      setLicenseTypeFlash('updated')
    } else if (licenseTypesStore.error) {
      licenseTypeError.value = licenseTypesStore.error
    }
  }
}

async function toggleLicenseTypeArchive(t: LicenseType): Promise<void> {
  if (t.active) {
    await licenseTypesStore.archive(t.id)
    if (licenseTypesStore.error === null) setLicenseTypeFlash('archived')
  } else {
    await licenseTypesStore.unarchive(t.id)
    if (licenseTypesStore.error === null) setLicenseTypeFlash('unarchived')
  }
}

// ---------------------------------------------------------------------------
// Delete dialog — garde-fou côté repo (refuse si licence émise référence ce
// type). L'erreur est surfacée via `licenseTypesStore.error`.
// ---------------------------------------------------------------------------

const deleteLicenseTypeDialogTarget = ref<LicenseType | null>(null)

const isDeleteLicenseTypeDialogOpen = computed<boolean>({
  get: () => deleteLicenseTypeDialogTarget.value !== null,
  set: (v: boolean) => {
    if (!v) deleteLicenseTypeDialogTarget.value = null
  },
})

function openDeleteLicenseTypeDialog(t: LicenseType): void {
  licenseTypesStore.error = null
  deleteLicenseTypeDialogTarget.value = t
}

function closeDeleteLicenseTypeDialog(): void {
  deleteLicenseTypeDialogTarget.value = null
}

async function confirmDeleteLicenseType(): Promise<void> {
  const target = deleteLicenseTypeDialogTarget.value
  if (!target) return
  const ok = await licenseTypesStore.remove(target.id)
  if (ok) {
    closeDeleteLicenseTypeDialog()
    setLicenseTypeFlash('deleted')
  }
  // Si !ok : `licenseTypesStore.error` contient le message — le dialog reste
  // ouvert et l'erreur s'affiche dans la card d'avertissement.
}
</script>

<template>
  <section class="p-6 space-y-6">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="text-[16px] font-semibold">
          Types de licence
        </h2>
        <p class="text-[13px] text-surface-500">
          Grille tarifaire des licences fédérales, organisée par rôle et
          par niveau. Le prix d'une licence émise sera capturé au moment
          du paiement, donc une mise à jour ici n'affectera pas les
          licences déjà émises. Voir
          <code class="font-mono text-[11px]">docs/main.md</code>
          (section Licences) pour le modèle complet.
        </p>
      </div>
    </div>

    <!-- Filtre archivés -->
    <div class="flex items-center gap-2 text-[12px] text-surface-600">
      <Checkbox
        v-model="showArchivedLicenseTypes"
        input-id="show-archived-license-types"
        binary
      />
      <label
        for="show-archived-license-types"
        class="cursor-pointer select-none"
      >
        Afficher les archivés
        <span
          v-if="archivedLicenseTypesCount > 0"
          class="text-surface-400"
        >
          ({{ archivedLicenseTypesCount }})
        </span>
      </label>
    </div>

    <!-- 4 fieldsets, un par rôle -->
    <div class="space-y-4">
      <div
        v-for="role in LICENSE_ROLES"
        :key="role"
        class="border border-surface-200 rounded-md overflow-hidden"
      >
        <div
          class="flex items-center justify-between gap-2 px-3 py-2 bg-surface-50 border-b border-surface-200"
        >
          <div class="flex items-center gap-2">
            <BadgeCheck
              :size="14"
              :stroke-width="2"
              class="text-surface-400"
            />
            <h3 class="text-[13px] font-semibold">
              {{ LICENSE_ROLE_LABEL[role] }}
            </h3>
            <span class="text-[11px] text-surface-400">
              {{ visibleLicenseTypesFor(role).length }} niveau{{
                visibleLicenseTypesFor(role).length > 1 ? 'x' : ''
              }}
            </span>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="isAddingLicenseType || licenseTypesStore.loading"
            @click="startAddLicenseType(role)"
          >
            <Plus
              :size="14"
              :stroke-width="2"
            />
            Ajouter
          </button>
        </div>

        <div class="divide-y divide-surface-200">
          <div
            v-for="t in visibleLicenseTypesFor(role)"
            :key="t.id"
            class="flex items-center gap-3 px-3 py-2.5"
          >
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-medium text-[13px]">{{ t.name }}</span>
                <Pill
                  v-if="t.level !== null"
                  variant="sky"
                >
                  Niveau {{ t.level }}
                </Pill>
                <Pill variant="emerald">
                  CHF {{ t.fee }}
                </Pill>
                <span class="text-[11px] text-surface-400 font-mono">
                  #{{ t.displayOrder }}
                </span>
                <Pill
                  v-if="!t.active"
                  variant="amber"
                >
                  archivé
                </Pill>
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                @click="startEditLicenseType(t)"
              >
                Éditer
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                @click="toggleLicenseTypeArchive(t)"
              >
                {{ t.active ? 'Archiver' : 'Désarchiver' }}
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-sm !text-rose-700"
                @click="openDeleteLicenseTypeDialog(t)"
              >
                <Trash2
                  :size="14"
                  :stroke-width="2"
                />
              </button>
            </div>
          </div>

          <div
            v-if="visibleLicenseTypesFor(role).length === 0"
            class="px-3 py-4 text-center text-[12px] text-surface-500"
          >
            <template v-if="licenseTypesStore.loading">
              Chargement…
            </template>
            <template v-else>
              Aucun niveau configuré pour ce rôle.
            </template>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="licenseTypeFlashMessage"
      class="text-[12px] text-emerald-700 flex items-center gap-1"
    >
      <Check
        :size="14"
        :stroke-width="2"
      />
      {{ licenseTypeFlashMessage }}
    </div>

    <!-- =================== Create/edit dialog =================== -->
    <Dialog
      v-model:visible="isLicenseTypeDialogOpen"
      modal
      :draggable="false"
      :style="{ width: '560px' }"
      :header="isAddingLicenseType ? 'Créer un type de licence' : 'Modifier le type de licence'"
    >
      <div class="space-y-3 pt-1">
        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-[12px] text-surface-600">Rôle</span>
            <Select
              v-model="licenseTypeDraft.role"
              :options="LICENSE_ROLE_OPTIONS"
              option-label="label"
              option-value="value"
              class="mt-1 w-full"
            />
          </label>
          <label class="block">
            <span class="text-[12px] text-surface-600">
              Ordre <span class="text-surface-400">(opt.)</span>
            </span>
            <InputNumber
              v-model="licenseTypeDraft.displayOrder"
              :min="0"
              input-class="!w-full"
              class="mt-1 w-full"
            />
          </label>
        </div>

        <label class="block">
          <span class="text-[12px] text-surface-600">Nom</span>
          <InputText
            v-model="licenseTypeDraft.name"
            class="mt-1 w-full"
            placeholder="Ex. Joueur Ligue A, Officiel J+S, …"
          />
        </label>

        <div class="grid grid-cols-2 gap-3">
          <label
            v-if="draftRoleRequiresLevel"
            class="block"
          >
            <span class="text-[12px] text-surface-600">Niveau</span>
            <InputNumber
              v-model="licenseTypeDraft.level"
              :min="0"
              input-class="!w-full"
              class="mt-1 w-full"
            />
          </label>
          <div
            v-else
            class="block text-[11px] text-surface-500 self-center"
          >
            Le rôle "Joueur" ne porte pas de niveau de licence ; les
            différentes licences joueurs sont distinguées par leur nom.
          </div>
          <label class="block">
            <span class="text-[12px] text-surface-600">Prix (CHF)</span>
            <InputNumber
              v-model="licenseTypeDraft.fee"
              :min="0"
              mode="currency"
              currency="CHF"
              locale="fr-CH"
              input-class="!w-full"
              class="mt-1 w-full"
            />
          </label>
        </div>

        <p
          v-if="licenseTypeError"
          class="text-[11px] text-rose-600"
        >
          {{ licenseTypeError }}
        </p>
      </div>
      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          @click="cancelLicenseTypeEdit"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          @click="commitLicenseType"
        >
          {{ isAddingLicenseType ? 'Créer' : 'Sauvegarder' }}
        </button>
      </template>
    </Dialog>

    <!-- =================== Delete dialog =================== -->
    <Dialog
      v-model:visible="isDeleteLicenseTypeDialogOpen"
      modal
      :draggable="false"
      :style="{ width: '460px' }"
      header="Supprimer le type de licence"
    >
      <div
        v-if="deleteLicenseTypeDialogTarget"
        class="space-y-3 pt-1"
      >
        <div class="flex items-center gap-2 flex-wrap">
          <BadgeCheck
            :size="14"
            :stroke-width="2"
            class="text-surface-400"
          />
          <span class="font-medium text-[13px]">
            {{ LICENSE_ROLE_LABEL[deleteLicenseTypeDialogTarget.role] }}
            — {{ deleteLicenseTypeDialogTarget.name }}
          </span>
          <Pill
            v-if="deleteLicenseTypeDialogTarget.level !== null"
            variant="sky"
          >
            Niveau {{ deleteLicenseTypeDialogTarget.level }}
          </Pill>
          <Pill variant="emerald">
            CHF {{ deleteLicenseTypeDialogTarget.fee }}
          </Pill>
        </div>
        <p class="text-[13px] text-surface-700">
          La suppression est définitive. Si tu hésites, archive plutôt — le
          type sera retiré des pickers de création de licence tout en restant
          résolvable sur l'historique.
        </p>
        <div
          v-if="licenseTypesStore.error"
          class="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5"
        >
          {{ licenseTypesStore.error }}
        </div>
      </div>
      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          @click="closeDeleteLicenseTypeDialog"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm !bg-rose-600 hover:!bg-rose-700"
          @click="confirmDeleteLicenseType"
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
