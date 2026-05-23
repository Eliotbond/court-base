<script setup lang="ts">
/**
 * Settings → Catégories d'équipes.
 *
 * Vue autonome extraite de `views/Settings.vue` (section `categories`,
 * lignes 873-1122 du script et 3036-3372 du template d'origine, plus le
 * dialog de suppression 4662-4748). Source de vérité métier : `docs/main.md`
 * (section "Catégories d'équipes") + `docs/firebase.md` (`/categories/{id}`).
 *
 * Architecture : composant → store → repo → Firebase (cf. `apps/web/CLAUDE.md`).
 * Aucun import direct de Firestore ici.
 */
import { computed, onMounted, ref } from 'vue'
import { FirebaseError } from 'firebase/app'
import { Check, Layers, Plus, Trash2 } from 'lucide-vue-next'
import Checkbox from 'primevue/checkbox'
import Dialog from 'primevue/dialog'
import InputNumber from 'primevue/inputnumber'
import InputText from 'primevue/inputtext'
import Pill from '@/components/ui/Pill.vue'
import { useCategoriesStore } from '@/stores/categories'
import type { Category } from '@club-app/shared-types'

const categoriesStore = useCategoriesStore()

// ---------------------------------------------------------------------------
// Bootstrap — charge la liste si pas encore en cache. La section Settings
// est lazy (l'utilisateur peut atterrir ici directement via URL), donc on
// déclenche un `load()` au montage sauf si la liste est déjà peuplée.
// ---------------------------------------------------------------------------

onMounted(() => {
  if (categoriesStore.categories.length === 0) {
    void loadCategories()
  }
})

async function loadCategories(): Promise<void> {
  try {
    await categoriesStore.load()
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`Categories.load failed [${code}]`, err)
  }
}

// ---------------------------------------------------------------------------
// Filtre archivées
// ---------------------------------------------------------------------------

const showArchivedCategories = ref(false)

const visibleCategories = computed<Category[]>(() => {
  if (showArchivedCategories.value) return categoriesStore.categories
  return categoriesStore.categories.filter((c) => c.active)
})

const archivedCategoriesCount = computed<number>(() => {
  return categoriesStore.categories.filter((c) => !c.active).length
})

/** Texte affiché dans la pill âge — aligné sur docs/main.md. */
function categoryAgeLabel(c: { minAge: number | null; maxAge: number | null }): string {
  if (c.minAge === null && c.maxAge === null) return 'Ouvert'
  if (c.minAge !== null && c.maxAge === null) return `${c.minAge} ans+`
  if (c.minAge === null && c.maxAge !== null) return `≤ ${c.maxAge} ans`
  if (c.minAge === c.maxAge) return `${c.minAge} ans`
  return `${c.minAge}-${c.maxAge} ans`
}

// ---------------------------------------------------------------------------
// Draft + édition inline
// ---------------------------------------------------------------------------

interface CategoryDraft {
  name: string
  hasMin: boolean
  minAge: number | null
  hasMax: boolean
  maxAge: number | null
  /** Vide → auto-assign en queue côté repo. */
  displayOrder: number | null
}

function emptyCategoryDraft(): CategoryDraft {
  return {
    name: '',
    hasMin: true,
    minAge: 14,
    hasMax: true,
    maxAge: 16,
    displayOrder: null,
  }
}

const isAddingCategory = ref(false)
const editingCategoryId = ref<string | null>(null)
const categoryDraft = ref<CategoryDraft>(emptyCategoryDraft())
const categoryError = ref<string | null>(null)

/** Banner inline : la section Categories n'utilise pas `lastSaved` du store global. */
const categoryFlash = ref<'created' | 'updated' | 'archived' | 'unarchived' | 'deleted' | null>(null)

function setCategoryFlash(kind: NonNullable<typeof categoryFlash.value>): void {
  categoryFlash.value = kind
  window.setTimeout(() => {
    if (categoryFlash.value === kind) categoryFlash.value = null
  }, 3000)
}

const categoryFlashMessage = computed<string | null>(() => {
  switch (categoryFlash.value) {
    case 'created':
      return 'Catégorie créée'
    case 'updated':
      return 'Catégorie mise à jour'
    case 'archived':
      return 'Catégorie archivée'
    case 'unarchived':
      return 'Catégorie réactivée'
    case 'deleted':
      return 'Catégorie supprimée'
    default:
      return null
  }
})

function startAddCategory(): void {
  isAddingCategory.value = true
  editingCategoryId.value = null
  categoryDraft.value = emptyCategoryDraft()
  categoryError.value = null
}

function startEditCategory(c: Category): void {
  isAddingCategory.value = false
  editingCategoryId.value = c.id
  categoryDraft.value = {
    name: c.name,
    hasMin: c.minAge !== null,
    minAge: c.minAge,
    hasMax: c.maxAge !== null,
    maxAge: c.maxAge,
    displayOrder: c.displayOrder,
  }
  categoryError.value = null
}

function cancelCategoryEdit(): void {
  isAddingCategory.value = false
  editingCategoryId.value = null
  categoryError.value = null
}

/** Aperçu live de la pill âge pendant la saisie. */
const categoryDraftPreview = computed<{ minAge: number | null; maxAge: number | null }>(() => {
  return {
    minAge: categoryDraft.value.hasMin ? categoryDraft.value.minAge : null,
    maxAge: categoryDraft.value.hasMax ? categoryDraft.value.maxAge : null,
  }
})

function validateCategoryDraft(): boolean {
  const name = categoryDraft.value.name.trim()
  if (!name) {
    categoryError.value = 'Nom requis'
    return false
  }
  if (name.length > 32) {
    categoryError.value = 'Maximum 32 caractères'
    return false
  }
  const min = categoryDraft.value.hasMin ? categoryDraft.value.minAge : null
  const max = categoryDraft.value.hasMax ? categoryDraft.value.maxAge : null
  if (categoryDraft.value.hasMin && (min === null || Number.isNaN(min))) {
    categoryError.value = 'Borne min requise (ou décochez "Pas de borne min")'
    return false
  }
  if (categoryDraft.value.hasMax && (max === null || Number.isNaN(max))) {
    categoryError.value = 'Borne max requise (ou décochez "Pas de borne max")'
    return false
  }
  if (min !== null && (min < 0 || min > 120)) {
    categoryError.value = 'Borne min entre 0 et 120'
    return false
  }
  if (max !== null && (max < 0 || max > 120)) {
    categoryError.value = 'Borne max entre 0 et 120'
    return false
  }
  if (min !== null && max !== null && min > max) {
    categoryError.value = 'Borne min > borne max'
    return false
  }
  categoryError.value = null
  return true
}

async function commitCategory(): Promise<void> {
  if (!validateCategoryDraft()) return
  const min = categoryDraft.value.hasMin ? categoryDraft.value.minAge : null
  const max = categoryDraft.value.hasMax ? categoryDraft.value.maxAge : null
  const name = categoryDraft.value.name.trim()
  const orderRaw = categoryDraft.value.displayOrder
  try {
    if (isAddingCategory.value) {
      const id = await categoriesStore.create({
        name,
        minAge: min,
        maxAge: max,
        ...(orderRaw !== null ? { displayOrder: orderRaw } : {}),
      })
      if (id !== null) {
        cancelCategoryEdit()
        setCategoryFlash('created')
      }
    } else if (editingCategoryId.value) {
      const ok = await categoriesStore.update(editingCategoryId.value, {
        name,
        minAge: min,
        maxAge: max,
        ...(orderRaw !== null ? { displayOrder: orderRaw } : {}),
      })
      if (ok) {
        cancelCategoryEdit()
        setCategoryFlash('updated')
      }
    }
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`Categories.commit failed [${code}]`, err)
  }
}

async function toggleCategoryArchive(c: Category): Promise<void> {
  try {
    if (c.active) {
      await categoriesStore.archive(c.id)
      if (categoriesStore.error === null) setCategoryFlash('archived')
    } else {
      await categoriesStore.unarchive(c.id)
      if (categoriesStore.error === null) setCategoryFlash('unarchived')
    }
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`Categories.toggleArchive failed [${code}]`, err)
  }
}

// ---------------------------------------------------------------------------
// Delete dialog — garde anti-delete via `countTeamsUsingCategory` (cf.
// repo). Une catégorie référencée par >=1 équipe ne peut pas être
// supprimée ; on propose l'archivage à la place (règle métier docs/main.md
// "Suppression — interdite par convention tant qu'au moins une équipe la
// référence").
// ---------------------------------------------------------------------------

const deleteDialogTarget = ref<Category | null>(null)
const deleteDialogUsageCount = ref<number>(0)
const deleteDialogLoading = ref(false)

const isDeleteDialogOpen = computed<boolean>({
  get: () => deleteDialogTarget.value !== null,
  set: (v: boolean) => {
    if (!v) deleteDialogTarget.value = null
  },
})

async function openDeleteCategoryDialog(c: Category): Promise<void> {
  deleteDialogTarget.value = c
  deleteDialogLoading.value = true
  try {
    deleteDialogUsageCount.value = await categoriesStore.refreshUsageCount(c.id)
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`Categories.refreshUsageCount failed [${code}]`, err)
    // Si le count échoue on assume "utilisée" pour ne pas autoriser une
    // suppression sur la base d'un état inconnu.
    deleteDialogUsageCount.value = -1
  } finally {
    deleteDialogLoading.value = false
  }
}

function closeDeleteCategoryDialog(): void {
  deleteDialogTarget.value = null
}

async function confirmDeleteCategory(): Promise<void> {
  const target = deleteDialogTarget.value
  if (!target) return
  if (deleteDialogUsageCount.value !== 0) return
  try {
    const ok = await categoriesStore.remove(target.id)
    if (ok) {
      closeDeleteCategoryDialog()
      setCategoryFlash('deleted')
    }
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`Categories.remove failed [${code}]`, err)
  }
}

async function archiveFromDeleteDialog(): Promise<void> {
  const target = deleteDialogTarget.value
  if (!target) return
  try {
    await categoriesStore.archive(target.id)
    if (categoriesStore.error === null) {
      closeDeleteCategoryDialog()
      setCategoryFlash('archived')
    }
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`Categories.archive failed [${code}]`, err)
  }
}
</script>

<template>
  <section class="space-y-4">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="text-[16px] font-semibold">
          Catégories d'équipes
        </h2>
        <p class="text-[13px] text-surface-500">
          Référentiel d'âge éditable par le club. Renommer une catégorie
          se reflète automatiquement sur toutes ses équipes ; pour retirer
          une catégorie utilisée, archive-la plutôt que la supprimer
          (cf. lifecycle dans <code class="font-mono text-[11px]">docs/main.md</code>).
        </p>
      </div>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        :disabled="isAddingCategory || categoriesStore.loading"
        @click="startAddCategory"
      >
        <Plus
          :size="14"
          :stroke-width="2"
        />
        Ajouter une catégorie
      </button>
    </div>

    <!-- Filtre archivées -->
    <div class="flex items-center gap-2 text-[12px] text-surface-600">
      <Checkbox
        v-model="showArchivedCategories"
        input-id="show-archived-categories"
        binary
      />
      <label
        for="show-archived-categories"
        class="cursor-pointer select-none"
      >
        Afficher les archivées
        <span
          v-if="archivedCategoriesCount > 0"
          class="text-surface-400"
        >
          ({{ archivedCategoriesCount }})
        </span>
      </label>
    </div>

    <!-- Add row (inline) -->
    <div
      v-if="isAddingCategory"
      class="border border-emerald-200 bg-emerald-50/40 rounded-md p-3 space-y-3"
    >
      <div class="grid grid-cols-6 gap-3">
        <label class="block col-span-2">
          <span class="text-[12px] text-surface-600">Nom</span>
          <InputText
            v-model="categoryDraft.name"
            placeholder="Ex. U14"
            class="mt-1 w-full"
          />
        </label>
        <label class="block">
          <span class="text-[12px] text-surface-600">Borne min</span>
          <InputNumber
            v-model="categoryDraft.minAge"
            :min="0"
            :max="120"
            input-class="!w-full"
            class="mt-1 w-full"
            :disabled="!categoryDraft.hasMin"
          />
        </label>
        <label class="block">
          <span class="text-[12px] text-surface-600">Borne max</span>
          <InputNumber
            v-model="categoryDraft.maxAge"
            :min="0"
            :max="120"
            input-class="!w-full"
            class="mt-1 w-full"
            :disabled="!categoryDraft.hasMax"
          />
        </label>
        <label class="block">
          <span class="text-[12px] text-surface-600">
            Ordre <span class="text-surface-400">(opt.)</span>
          </span>
          <InputNumber
            v-model="categoryDraft.displayOrder"
            :min="0"
            input-class="!w-full"
            class="mt-1 w-full"
          />
        </label>
        <div class="block flex items-end">
          <Pill variant="slate">
            {{ categoryAgeLabel(categoryDraftPreview) }}
          </Pill>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-4 text-[12px]">
        <label class="flex items-center gap-2 cursor-pointer">
          <Checkbox
            v-model="categoryDraft.hasMin"
            binary
            :true-value="false"
            :false-value="true"
          />
          <span>Pas de borne min</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer">
          <Checkbox
            v-model="categoryDraft.hasMax"
            binary
            :true-value="false"
            :false-value="true"
          />
          <span>Pas de borne max</span>
        </label>
        <span
          v-if="categoryError"
          class="text-[11px] text-rose-600"
        >
          {{ categoryError }}
        </span>
        <div class="ml-auto flex items-center gap-2">
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            @click="cancelCategoryEdit"
          >
            Annuler
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            @click="commitCategory"
          >
            Créer
          </button>
        </div>
      </div>
    </div>

    <!-- Categories list -->
    <div class="border border-surface-200 rounded-md divide-y divide-surface-200">
      <template
        v-for="c in visibleCategories"
        :key="c.id"
      >
        <!-- View mode -->
        <div
          v-if="editingCategoryId !== c.id"
          class="flex items-center gap-3 px-3 h-12"
        >
          <Layers
            :size="14"
            :stroke-width="2"
            class="text-surface-400"
          />
          <span class="font-medium text-[13px]">{{ c.name }}</span>
          <Pill variant="slate">
            {{ categoryAgeLabel(c) }}
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
          <span class="text-[12px] text-surface-500 font-mono ml-2">
            /categories/{{ c.id }}
          </span>
          <div class="ml-auto flex items-center gap-2">
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              @click="startEditCategory(c)"
            >
              Éditer
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              @click="toggleCategoryArchive(c)"
            >
              {{ c.active ? 'Archiver' : 'Désarchiver' }}
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm !text-rose-700"
              @click="openDeleteCategoryDialog(c)"
            >
              <Trash2
                :size="14"
                :stroke-width="2"
              />
            </button>
          </div>
        </div>

        <!-- Edit mode (inline) -->
        <div
          v-else
          class="border border-emerald-200 bg-emerald-50/40 rounded-md p-3 space-y-3"
        >
          <div class="grid grid-cols-6 gap-3">
            <label class="block col-span-2">
              <span class="text-[12px] text-surface-600">Nom</span>
              <InputText
                v-model="categoryDraft.name"
                class="mt-1 w-full"
              />
            </label>
            <label class="block">
              <span class="text-[12px] text-surface-600">Borne min</span>
              <InputNumber
                v-model="categoryDraft.minAge"
                :min="0"
                :max="120"
                input-class="!w-full"
                class="mt-1 w-full"
                :disabled="!categoryDraft.hasMin"
              />
            </label>
            <label class="block">
              <span class="text-[12px] text-surface-600">Borne max</span>
              <InputNumber
                v-model="categoryDraft.maxAge"
                :min="0"
                :max="120"
                input-class="!w-full"
                class="mt-1 w-full"
                :disabled="!categoryDraft.hasMax"
              />
            </label>
            <label class="block">
              <span class="text-[12px] text-surface-600">Ordre</span>
              <InputNumber
                v-model="categoryDraft.displayOrder"
                :min="0"
                input-class="!w-full"
                class="mt-1 w-full"
              />
            </label>
            <div class="block flex items-end">
              <Pill variant="slate">
                {{ categoryAgeLabel(categoryDraftPreview) }}
              </Pill>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-4 text-[12px]">
            <label class="flex items-center gap-2 cursor-pointer">
              <Checkbox
                v-model="categoryDraft.hasMin"
                binary
                :true-value="false"
                :false-value="true"
              />
              <span>Pas de borne min</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <Checkbox
                v-model="categoryDraft.hasMax"
                binary
                :true-value="false"
                :false-value="true"
              />
              <span>Pas de borne max</span>
            </label>
            <span
              v-if="categoryError"
              class="text-[11px] text-rose-600"
            >
              {{ categoryError }}
            </span>
            <div class="ml-auto flex items-center gap-2">
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                @click="cancelCategoryEdit"
              >
                Annuler
              </button>
              <button
                type="button"
                class="btn btn-primary btn-sm"
                @click="commitCategory"
              >
                Sauvegarder
              </button>
            </div>
          </div>
        </div>
      </template>

      <div
        v-if="visibleCategories.length === 0"
        class="px-3 py-6 text-center text-[12px] text-surface-500"
      >
        <template v-if="categoriesStore.loading">
          Chargement…
        </template>
        <template v-else-if="!showArchivedCategories && archivedCategoriesCount > 0">
          Aucune catégorie active.
          <button
            type="button"
            class="text-emerald-700 underline ml-1"
            @click="showArchivedCategories = true"
          >
            Afficher les {{ archivedCategoriesCount }} archivée(s)
          </button>
        </template>
        <template v-else>
          Aucune catégorie configurée. Crée la première pour pouvoir
          l'assigner aux équipes.
        </template>
      </div>
    </div>

    <div
      v-if="categoryFlashMessage"
      class="text-[12px] text-emerald-700 flex items-center gap-1"
    >
      <Check
        :size="14"
        :stroke-width="2"
      />
      {{ categoryFlashMessage }}
    </div>

    <!-- =================== Delete category dialog =================== -->
    <Dialog
      v-model:visible="isDeleteDialogOpen"
      modal
      :draggable="false"
      :style="{ width: '460px' }"
      header="Supprimer la catégorie"
    >
      <div
        v-if="deleteDialogTarget"
        class="space-y-3 pt-1"
      >
        <div class="flex items-center gap-2">
          <Layers
            :size="14"
            :stroke-width="2"
            class="text-surface-400"
          />
          <span class="font-medium text-[13px]">
            {{ deleteDialogTarget.name }}
          </span>
          <Pill variant="slate">
            {{ categoryAgeLabel(deleteDialogTarget) }}
          </Pill>
        </div>

        <p
          v-if="deleteDialogLoading"
          class="text-[12px] text-surface-500"
        >
          Vérification de l'usage…
        </p>
        <template v-else>
          <p
            v-if="deleteDialogUsageCount > 0"
            class="text-[13px] text-surface-700"
          >
            Cette catégorie est utilisée par
            <strong>{{ deleteDialogUsageCount }} équipe(s)</strong>. Tu ne peux
            pas la supprimer ; archive-la plutôt.
          </p>
          <p
            v-else-if="deleteDialogUsageCount === 0"
            class="text-[13px] text-surface-700"
          >
            Cette catégorie n'est référencée par aucune équipe. La suppression
            est définitive.
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
          @click="closeDeleteCategoryDialog"
        >
          {{ deleteDialogUsageCount === 0 ? 'Annuler' : 'Fermer' }}
        </button>
        <button
          v-if="deleteDialogUsageCount > 0 && deleteDialogTarget?.active"
          type="button"
          class="btn btn-secondary btn-sm"
          @click="archiveFromDeleteDialog"
        >
          Archiver à la place
        </button>
        <button
          v-if="deleteDialogUsageCount === 0 && !deleteDialogLoading"
          type="button"
          class="btn btn-primary btn-sm !bg-rose-600 hover:!bg-rose-700"
          @click="confirmDeleteCategory"
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
