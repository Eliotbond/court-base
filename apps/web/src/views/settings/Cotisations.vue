<script setup lang="ts">
/**
 * Settings → Types de cotisation.
 *
 * Vue autonome extraite de `views/Settings.vue` (section `cotisations`,
 * lignes 1325-1539 du script et 3673-3827 du template d'origine, plus le
 * dialog create/edit 4833-4912 et le dialog delete 4913-4999). Source de
 * vérité métier : `docs/main.md` (section "Cotisations") + `docs/firebase.md`
 * (`/cotisations/{id}`).
 *
 * NB sémantique : la collection Firestore reste `'cotisations'` (string
 * inchangée), mais côté code on parle de `CotisationType` (template de
 * pricing) — le mot "cotisation" est réservé aux factures membres
 * (ex-`Due`, géré par un autre module).
 *
 * Architecture : composant → store → repo → Firebase (cf. `apps/web/CLAUDE.md`).
 */
import { computed, onMounted, ref } from 'vue'
import { FirebaseError } from 'firebase/app'
import { Banknote, Check, Plus, Trash2 } from 'lucide-vue-next'
import Checkbox from 'primevue/checkbox'
import Dialog from 'primevue/dialog'
import InputNumber from 'primevue/inputnumber'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Pill from '@/components/ui/Pill.vue'
import { useCotisationTypesStore } from '@/stores/cotisationTypes'
import type { CotisationType } from '@club-app/shared-types'

const cotisationTypesStore = useCotisationTypesStore()

// ---------------------------------------------------------------------------
// Bootstrap — charge la liste si pas encore en cache.
// ---------------------------------------------------------------------------

onMounted(() => {
  if (cotisationTypesStore.cotisationTypes.length === 0) {
    void loadCotisationTypes()
  }
})

async function loadCotisationTypes(): Promise<void> {
  try {
    await cotisationTypesStore.load()
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`Cotisations.load failed [${code}]`, err)
  }
}

// ---------------------------------------------------------------------------
// Filtre archivées
// ---------------------------------------------------------------------------

const showArchivedCotisations = ref(false)

const visibleCotisations = computed<CotisationType[]>(() => {
  if (showArchivedCotisations.value) return cotisationTypesStore.cotisationTypes
  return cotisationTypesStore.cotisationTypes.filter((c) => c.active)
})

const archivedCotisationsCount = computed<number>(() => {
  return cotisationTypesStore.cotisationTypes.filter((c) => !c.active).length
})

// ---------------------------------------------------------------------------
// Draft + dialog create/edit
// ---------------------------------------------------------------------------

interface CotisationTypeDraft {
  name: string
  description: string
  price: number
  /** Vide → auto-assign en queue côté repo. */
  displayOrder: number | null
}

function emptyCotisationTypeDraft(): CotisationTypeDraft {
  return {
    name: '',
    description: '',
    price: 0,
    displayOrder: null,
  }
}

const isAddingCotisationType = ref(false)
const editingCotisationId = ref<string | null>(null)
const cotisationDraft = ref<CotisationTypeDraft>(emptyCotisationTypeDraft())
const cotisationError = ref<string | null>(null)

const cotisationFlash = ref<
  'created' | 'updated' | 'archived' | 'unarchived' | 'deleted' | null
>(null)

function setCotisationFlash(kind: NonNullable<typeof cotisationFlash.value>): void {
  cotisationFlash.value = kind
  window.setTimeout(() => {
    if (cotisationFlash.value === kind) cotisationFlash.value = null
  }, 3000)
}

const cotisationFlashMessage = computed<string | null>(() => {
  switch (cotisationFlash.value) {
    case 'created':
      return 'Type de cotisation créé'
    case 'updated':
      return 'Type de cotisation mis à jour'
    case 'archived':
      return 'Type de cotisation archivé'
    case 'unarchived':
      return 'Type de cotisation réactivé'
    case 'deleted':
      return 'Type de cotisation supprimé'
    default:
      return null
  }
})

const isCotisationTypeDialogOpen = computed<boolean>({
  get: () => isAddingCotisationType.value || editingCotisationId.value !== null,
  set: (v: boolean) => {
    if (!v) cancelCotisationTypeEdit()
  },
})

function startAddCotisationType(): void {
  isAddingCotisationType.value = true
  editingCotisationId.value = null
  cotisationDraft.value = emptyCotisationTypeDraft()
  cotisationError.value = null
}

function startEditCotisationType(c: CotisationType): void {
  isAddingCotisationType.value = false
  editingCotisationId.value = c.id
  cotisationDraft.value = {
    name: c.name,
    description: c.description,
    price: c.price,
    displayOrder: c.displayOrder,
  }
  cotisationError.value = null
}

function cancelCotisationTypeEdit(): void {
  isAddingCotisationType.value = false
  editingCotisationId.value = null
  cotisationError.value = null
}

function validateCotisationTypeDraft(): boolean {
  const name = cotisationDraft.value.name.trim()
  if (!name) {
    cotisationError.value = 'Nom requis'
    return false
  }
  if (cotisationDraft.value.price < 0) {
    cotisationError.value = 'Le prix doit être >= 0'
    return false
  }
  cotisationError.value = null
  return true
}

async function commitCotisationType(): Promise<void> {
  if (!validateCotisationTypeDraft()) return
  const name = cotisationDraft.value.name.trim()
  const description = cotisationDraft.value.description.trim()
  const price = cotisationDraft.value.price
  const orderRaw = cotisationDraft.value.displayOrder
  try {
    if (isAddingCotisationType.value) {
      const id = await cotisationTypesStore.create({
        name,
        description,
        price,
        ...(orderRaw !== null ? { displayOrder: orderRaw } : {}),
      })
      if (id !== null) {
        cancelCotisationTypeEdit()
        setCotisationFlash('created')
      }
    } else if (editingCotisationId.value) {
      const ok = await cotisationTypesStore.update(editingCotisationId.value, {
        name,
        description,
        price,
        ...(orderRaw !== null ? { displayOrder: orderRaw } : {}),
      })
      if (ok) {
        cancelCotisationTypeEdit()
        setCotisationFlash('updated')
      }
    }
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`Cotisations.commit failed [${code}]`, err)
  }
}

async function toggleCotisationTypeArchive(c: CotisationType): Promise<void> {
  try {
    if (c.active) {
      await cotisationTypesStore.archive(c.id)
      if (cotisationTypesStore.error === null) setCotisationFlash('archived')
    } else {
      await cotisationTypesStore.unarchive(c.id)
      if (cotisationTypesStore.error === null) setCotisationFlash('unarchived')
    }
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`Cotisations.toggleArchive failed [${code}]`, err)
  }
}

// ---------------------------------------------------------------------------
// Delete dialog — garde anti-delete (cf. règle métier docs/main.md).
// ---------------------------------------------------------------------------

const deleteCotisationTypeDialogTarget = ref<CotisationType | null>(null)
const deleteCotisationTypeDialogUsageCount = ref<number>(0)
const deleteCotisationTypeDialogLoading = ref(false)

const isDeleteCotisationTypeDialogOpen = computed<boolean>({
  get: () => deleteCotisationTypeDialogTarget.value !== null,
  set: (v: boolean) => {
    if (!v) deleteCotisationTypeDialogTarget.value = null
  },
})

async function openDeleteCotisationTypeDialog(c: CotisationType): Promise<void> {
  deleteCotisationTypeDialogTarget.value = c
  deleteCotisationTypeDialogLoading.value = true
  try {
    deleteCotisationTypeDialogUsageCount.value =
      await cotisationTypesStore.refreshUsageCount(c.id)
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`Cotisations.refreshUsageCount failed [${code}]`, err)
    // Si le count échoue, on assume "utilisée" pour ne pas autoriser une
    // suppression sur la base d'un état inconnu.
    deleteCotisationTypeDialogUsageCount.value = -1
  } finally {
    deleteCotisationTypeDialogLoading.value = false
  }
}

function closeDeleteCotisationTypeDialog(): void {
  deleteCotisationTypeDialogTarget.value = null
}

async function confirmDeleteCotisationType(): Promise<void> {
  const target = deleteCotisationTypeDialogTarget.value
  if (!target) return
  if (deleteCotisationTypeDialogUsageCount.value !== 0) return
  try {
    const ok = await cotisationTypesStore.remove(target.id)
    if (ok) {
      closeDeleteCotisationTypeDialog()
      setCotisationFlash('deleted')
    }
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`Cotisations.remove failed [${code}]`, err)
  }
}

async function archiveFromDeleteCotisationTypeDialog(): Promise<void> {
  const target = deleteCotisationTypeDialogTarget.value
  if (!target) return
  try {
    await cotisationTypesStore.archive(target.id)
    if (cotisationTypesStore.error === null) {
      closeDeleteCotisationTypeDialog()
      setCotisationFlash('archived')
    }
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`Cotisations.archive failed [${code}]`, err)
  }
}
</script>

<template>
  <section class="space-y-4">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="text-[16px] font-semibold">
          Types de cotisation
        </h2>
        <p class="text-[13px] text-surface-500">
          Référentiel des types de cotisation annuels (CHF/an/joueur).
          Renommer ou repricer un type se reflète automatiquement sur
          toutes les équipes qui le référencent. Pour retirer un type
          utilisé, archive-le plutôt que le supprimer (cf.
          <code class="font-mono text-[11px]">docs/main.md</code>).
        </p>
      </div>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        :disabled="isAddingCotisationType || cotisationTypesStore.loading"
        @click="startAddCotisationType"
      >
        <Plus
          :size="14"
          :stroke-width="2"
        />
        Ajouter un type
      </button>
    </div>

    <!-- Filtre archivées -->
    <div class="flex items-center gap-2 text-[12px] text-surface-600">
      <Checkbox
        v-model="showArchivedCotisations"
        input-id="show-archived-cotisations"
        binary
      />
      <label
        for="show-archived-cotisations"
        class="cursor-pointer select-none"
      >
        Afficher les archivées
        <span
          v-if="archivedCotisationsCount > 0"
          class="text-surface-400"
        >
          ({{ archivedCotisationsCount }})
        </span>
      </label>
    </div>

    <!-- Liste des types de cotisation -->
    <div class="border border-surface-200 rounded-md divide-y divide-surface-200">
      <div
        v-for="c in visibleCotisations"
        :key="c.id"
        class="flex items-center gap-3 px-3 py-2.5"
      >
        <Banknote
          :size="14"
          :stroke-width="2"
          class="text-surface-400 shrink-0"
        />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-medium text-[13px]">{{ c.name }}</span>
            <Pill variant="emerald">
              CHF {{ c.price }}
            </Pill>
            <span class="text-[11px] text-surface-400 font-mono">
              #{{ c.displayOrder }}
            </span>
            <Pill
              v-if="!c.active"
              variant="amber"
            >
              archivée
            </Pill>
          </div>
          <div
            v-if="c.description"
            class="text-[12px] text-surface-500 mt-0.5 truncate"
          >
            {{ c.description }}
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            @click="startEditCotisationType(c)"
          >
            Éditer
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            @click="toggleCotisationTypeArchive(c)"
          >
            {{ c.active ? 'Archiver' : 'Désarchiver' }}
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm !text-rose-700"
            :disabled="(cotisationTypesStore.lastUsageCount[c.id] ?? 0) > 0"
            :title="
              (cotisationTypesStore.lastUsageCount[c.id] ?? 0) > 0
                ? `Utilisé par ${cotisationTypesStore.lastUsageCount[c.id]} équipe(s) — archivez-le plutôt`
                : undefined
            "
            @click="openDeleteCotisationTypeDialog(c)"
          >
            <Trash2
              :size="14"
              :stroke-width="2"
            />
          </button>
        </div>
      </div>

      <div
        v-if="visibleCotisations.length === 0"
        class="px-3 py-6 text-center text-[12px] text-surface-500"
      >
        <template v-if="cotisationTypesStore.loading">
          Chargement…
        </template>
        <template v-else-if="!showArchivedCotisations && archivedCotisationsCount > 0">
          Aucun type de cotisation actif.
          <button
            type="button"
            class="text-emerald-700 underline ml-1"
            @click="showArchivedCotisations = true"
          >
            Afficher les {{ archivedCotisationsCount }} archivé(s)
          </button>
        </template>
        <template v-else>
          Aucun type de cotisation configuré. Crée le premier pour
          pouvoir l'attacher à une équipe.
        </template>
      </div>
    </div>

    <div
      v-if="cotisationFlashMessage"
      class="text-[12px] text-emerald-700 flex items-center gap-1"
    >
      <Check
        :size="14"
        :stroke-width="2"
      />
      {{ cotisationFlashMessage }}
    </div>

    <!-- =================== CotisationType create / edit dialog =================== -->
    <Dialog
      v-model:visible="isCotisationTypeDialogOpen"
      modal
      :draggable="false"
      :style="{ width: '520px' }"
      :header="isAddingCotisationType ? 'Créer un type de cotisation' : 'Modifier le type de cotisation'"
    >
      <div class="space-y-3 pt-1">
        <label class="block">
          <span class="text-[12px] text-surface-600">Nom</span>
          <InputText
            v-model="cotisationDraft.name"
            class="mt-1 w-full"
            placeholder="Ex. Junior"
          />
        </label>

        <label class="block">
          <span class="text-[12px] text-surface-600">Description</span>
          <Textarea
            v-model="cotisationDraft.description"
            rows="2"
            auto-resize
            class="mt-1 w-full"
            placeholder="Périmètre, conditions, …"
          />
        </label>

        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-[12px] text-surface-600">Prix (CHF / an / joueur)</span>
            <InputNumber
              v-model="cotisationDraft.price"
              :min="0"
              mode="currency"
              currency="CHF"
              locale="fr-CH"
              input-class="!w-full"
              class="mt-1 w-full"
            />
          </label>
          <label class="block">
            <span class="text-[12px] text-surface-600">
              Ordre <span class="text-surface-400">(opt.)</span>
            </span>
            <InputNumber
              v-model="cotisationDraft.displayOrder"
              :min="0"
              input-class="!w-full"
              class="mt-1 w-full"
            />
          </label>
        </div>

        <p
          v-if="cotisationError"
          class="text-[11px] text-rose-600"
        >
          {{ cotisationError }}
        </p>
      </div>
      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          @click="cancelCotisationTypeEdit"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          @click="commitCotisationType"
        >
          {{ isAddingCotisationType ? 'Créer' : 'Sauvegarder' }}
        </button>
      </template>
    </Dialog>

    <!-- =================== Delete cotisation type dialog =================== -->
    <Dialog
      v-model:visible="isDeleteCotisationTypeDialogOpen"
      modal
      :draggable="false"
      :style="{ width: '460px' }"
      header="Supprimer le type de cotisation"
    >
      <div
        v-if="deleteCotisationTypeDialogTarget"
        class="space-y-3 pt-1"
      >
        <div class="flex items-center gap-2 flex-wrap">
          <Banknote
            :size="14"
            :stroke-width="2"
            class="text-surface-400"
          />
          <span class="font-medium text-[13px]">
            {{ deleteCotisationTypeDialogTarget.name }}
          </span>
          <Pill variant="emerald">
            CHF {{ deleteCotisationTypeDialogTarget.price }}
          </Pill>
        </div>

        <p
          v-if="deleteCotisationTypeDialogLoading"
          class="text-[12px] text-surface-500"
        >
          Vérification de l'usage…
        </p>
        <template v-else>
          <p
            v-if="deleteCotisationTypeDialogUsageCount > 0"
            class="text-[13px] text-surface-700"
          >
            Ce type de cotisation est utilisé par
            <strong>{{ deleteCotisationTypeDialogUsageCount }} équipe(s)</strong>.
            Tu ne peux pas le supprimer ; archive-le plutôt.
          </p>
          <p
            v-else-if="deleteCotisationTypeDialogUsageCount === 0"
            class="text-[13px] text-surface-700"
          >
            Ce type de cotisation n'est référencé par aucune équipe. La
            suppression est définitive.
          </p>
          <p
            v-else
            class="text-[13px] text-rose-700"
          >
            Impossible de vérifier l'usage. Réessaie ou archive plutôt.
          </p>
        </template>
      </div>
      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          @click="closeDeleteCotisationTypeDialog"
        >
          {{ deleteCotisationTypeDialogUsageCount === 0 ? 'Annuler' : 'Fermer' }}
        </button>
        <button
          v-if="deleteCotisationTypeDialogUsageCount > 0 && deleteCotisationTypeDialogTarget?.active"
          type="button"
          class="btn btn-secondary btn-sm"
          @click="archiveFromDeleteCotisationTypeDialog"
        >
          Archiver à la place
        </button>
        <button
          v-if="deleteCotisationTypeDialogUsageCount === 0 && !deleteCotisationTypeDialogLoading"
          type="button"
          class="btn btn-primary btn-sm !bg-rose-600 hover:!bg-rose-700"
          @click="confirmDeleteCotisationType"
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
