<script setup lang="ts">
/**
 * Settings → Tags d'équipes.
 *
 * Vue autonome extraite de `views/Settings.vue` (section `tags`,
 * lignes 1123-1325 du script et 3373-3672 du template d'origine, plus le
 * dialog de suppression 4749-4832). Source de vérité métier :
 * `docs/main.md` (section "Tags d'équipes") + `docs/firebase.md`
 * (`/tags/{id}`).
 *
 * Architecture : composant → store → repo → Firebase (cf. `apps/web/CLAUDE.md`).
 */
import { computed, onMounted, ref } from 'vue'
import { FirebaseError } from 'firebase/app'
import { Check, Plus, Tag as TagIcon, Trash2 } from 'lucide-vue-next'
import Checkbox from 'primevue/checkbox'
import Dialog from 'primevue/dialog'
import InputNumber from 'primevue/inputnumber'
import InputText from 'primevue/inputtext'
import Pill from '@/components/ui/Pill.vue'
import { useTagsStore } from '@/stores/tags'
import type { Tag, TagColor } from '@club-app/shared-types'

const tagsStore = useTagsStore()

// ---------------------------------------------------------------------------
// Bootstrap — charge la liste si pas encore en cache.
// ---------------------------------------------------------------------------

onMounted(() => {
  if (tagsStore.tags.length === 0) {
    void loadTags()
  }
})

async function loadTags(): Promise<void> {
  try {
    await tagsStore.load()
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`Tags.load failed [${code}]`, err)
  }
}

// ---------------------------------------------------------------------------
// Palette — bornée, alignée sur les variants du composant Pill.
// ---------------------------------------------------------------------------

const TAG_PALETTE: ReadonlyArray<{ value: TagColor; label: string; bg: string; text: string }> = [
  { value: 'emerald', label: 'Vert', bg: 'bg-emerald-50', text: 'text-emerald-700' },
  { value: 'sky', label: 'Bleu', bg: 'bg-sky-50', text: 'text-sky-700' },
  { value: 'amber', label: 'Ambre', bg: 'bg-amber-50', text: 'text-amber-700' },
  { value: 'rose', label: 'Rose', bg: 'bg-rose-50', text: 'text-rose-700' },
  { value: 'violet', label: 'Violet', bg: 'bg-violet-50', text: 'text-violet-700' },
  { value: 'slate', label: 'Gris', bg: 'bg-slate-100', text: 'text-slate-600' },
] as const

// ---------------------------------------------------------------------------
// Filtre archivés
// ---------------------------------------------------------------------------

const showArchivedTags = ref(false)

const visibleTags = computed<Tag[]>(() => {
  if (showArchivedTags.value) return tagsStore.tags
  return tagsStore.tags.filter((t) => t.active)
})

const archivedTagsCount = computed<number>(() => {
  return tagsStore.tags.filter((t) => !t.active).length
})

// ---------------------------------------------------------------------------
// Draft + édition inline
// ---------------------------------------------------------------------------

interface TagDraft {
  name: string
  color: TagColor
  /** Vide → auto-assign en queue côté repo. */
  displayOrder: number | null
}

function emptyTagDraft(): TagDraft {
  return {
    name: '',
    color: 'slate',
    displayOrder: null,
  }
}

const isAddingTag = ref(false)
const editingTagId = ref<string | null>(null)
const tagDraft = ref<TagDraft>(emptyTagDraft())
const tagError = ref<string | null>(null)

const tagFlash = ref<'created' | 'updated' | 'archived' | 'unarchived' | 'deleted' | null>(null)

function setTagFlash(kind: NonNullable<typeof tagFlash.value>): void {
  tagFlash.value = kind
  window.setTimeout(() => {
    if (tagFlash.value === kind) tagFlash.value = null
  }, 3000)
}

const tagFlashMessage = computed<string | null>(() => {
  switch (tagFlash.value) {
    case 'created':
      return 'Tag créé'
    case 'updated':
      return 'Tag mis à jour'
    case 'archived':
      return 'Tag archivé'
    case 'unarchived':
      return 'Tag réactivé'
    case 'deleted':
      return 'Tag supprimé'
    default:
      return null
  }
})

function startAddTag(): void {
  isAddingTag.value = true
  editingTagId.value = null
  tagDraft.value = emptyTagDraft()
  tagError.value = null
}

function startEditTag(t: Tag): void {
  isAddingTag.value = false
  editingTagId.value = t.id
  tagDraft.value = {
    name: t.name,
    color: t.color,
    displayOrder: t.displayOrder,
  }
  tagError.value = null
}

function cancelTagEdit(): void {
  isAddingTag.value = false
  editingTagId.value = null
  tagError.value = null
}

function validateTagDraft(): boolean {
  const name = tagDraft.value.name.trim()
  if (!name) {
    tagError.value = 'Nom requis'
    return false
  }
  if (name.length > 24) {
    tagError.value = 'Maximum 24 caractères'
    return false
  }
  tagError.value = null
  return true
}

async function commitTag(): Promise<void> {
  if (!validateTagDraft()) return
  const name = tagDraft.value.name.trim()
  const color = tagDraft.value.color
  const orderRaw = tagDraft.value.displayOrder
  try {
    if (isAddingTag.value) {
      const id = await tagsStore.create({
        name,
        color,
        ...(orderRaw !== null ? { displayOrder: orderRaw } : {}),
      })
      if (id !== null) {
        cancelTagEdit()
        setTagFlash('created')
      }
    } else if (editingTagId.value) {
      const ok = await tagsStore.update(editingTagId.value, {
        name,
        color,
        ...(orderRaw !== null ? { displayOrder: orderRaw } : {}),
      })
      if (ok) {
        cancelTagEdit()
        setTagFlash('updated')
      }
    }
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`Tags.commit failed [${code}]`, err)
  }
}

async function toggleTagArchive(t: Tag): Promise<void> {
  try {
    if (t.active) {
      await tagsStore.archive(t.id)
      if (tagsStore.error === null) setTagFlash('archived')
    } else {
      await tagsStore.unarchive(t.id)
      if (tagsStore.error === null) setTagFlash('unarchived')
    }
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`Tags.toggleArchive failed [${code}]`, err)
  }
}

// ---------------------------------------------------------------------------
// Delete dialog — garde anti-delete (cf. règle métier docs/main.md).
// ---------------------------------------------------------------------------

const deleteTagDialogTarget = ref<Tag | null>(null)
const deleteTagDialogUsageCount = ref<number>(0)
const deleteTagDialogLoading = ref(false)

const isDeleteTagDialogOpen = computed<boolean>({
  get: () => deleteTagDialogTarget.value !== null,
  set: (v: boolean) => {
    if (!v) deleteTagDialogTarget.value = null
  },
})

async function openDeleteTagDialog(t: Tag): Promise<void> {
  deleteTagDialogTarget.value = t
  deleteTagDialogLoading.value = true
  try {
    deleteTagDialogUsageCount.value = await tagsStore.refreshUsageCount(t.id)
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`Tags.refreshUsageCount failed [${code}]`, err)
    // Si le count échoue, on assume "utilisé" pour ne pas autoriser une
    // suppression sur la base d'un état inconnu.
    deleteTagDialogUsageCount.value = -1
  } finally {
    deleteTagDialogLoading.value = false
  }
}

function closeDeleteTagDialog(): void {
  deleteTagDialogTarget.value = null
}

async function confirmDeleteTag(): Promise<void> {
  const target = deleteTagDialogTarget.value
  if (!target) return
  if (deleteTagDialogUsageCount.value !== 0) return
  try {
    const ok = await tagsStore.remove(target.id)
    if (ok) {
      closeDeleteTagDialog()
      setTagFlash('deleted')
    }
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`Tags.remove failed [${code}]`, err)
  }
}

async function archiveFromDeleteTagDialog(): Promise<void> {
  const target = deleteTagDialogTarget.value
  if (!target) return
  try {
    await tagsStore.archive(target.id)
    if (tagsStore.error === null) {
      closeDeleteTagDialog()
      setTagFlash('archived')
    }
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`Tags.archive failed [${code}]`, err)
  }
}
</script>

<template>
  <section class="space-y-4">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="text-[16px] font-semibold">
          Tags d'équipes
        </h2>
        <p class="text-[13px] text-surface-500">
          Étiquettes colorées pour différencier des équipes similaires
          (ex. deux U14M, version Compet vs Loisir). Le flag « afficher »
          est défini par-équipe lors de l'ajout d'un tag — utile pour des
          tags admin invisibles côté UI publique. Cf.
          <code class="font-mono text-[11px]">docs/main.md</code> →
          « Tags d'équipes ».
        </p>
      </div>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        :disabled="isAddingTag || tagsStore.loading"
        @click="startAddTag"
      >
        <Plus
          :size="14"
          :stroke-width="2"
        />
        Ajouter un tag
      </button>
    </div>

    <!-- Filtre archivés -->
    <div class="flex items-center gap-2 text-[12px] text-surface-600">
      <Checkbox
        v-model="showArchivedTags"
        input-id="show-archived-tags"
        binary
      />
      <label
        for="show-archived-tags"
        class="cursor-pointer select-none"
      >
        Afficher les archivés
        <span
          v-if="archivedTagsCount > 0"
          class="text-surface-400"
        >
          ({{ archivedTagsCount }})
        </span>
      </label>
    </div>

    <!-- Add row (inline) -->
    <div
      v-if="isAddingTag"
      class="border border-emerald-200 bg-emerald-50/40 rounded-md p-3 space-y-3"
    >
      <div class="grid grid-cols-6 gap-3">
        <label class="block col-span-2">
          <span class="text-[12px] text-surface-600">Nom</span>
          <InputText
            v-model="tagDraft.name"
            placeholder="Ex. Compet, U14 A, Élite"
            class="mt-1 w-full"
          />
        </label>
        <label class="block">
          <span class="text-[12px] text-surface-600">
            Ordre <span class="text-surface-400">(opt.)</span>
          </span>
          <InputNumber
            v-model="tagDraft.displayOrder"
            :min="0"
            input-class="!w-full"
            class="mt-1 w-full"
          />
        </label>
        <div class="col-span-3 flex items-end">
          <Pill :variant="tagDraft.color">
            {{ tagDraft.name.trim() || 'Aperçu' }}
          </Pill>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <span class="text-[12px] text-surface-600">Couleur</span>
        <div class="flex items-center gap-1.5">
          <button
            v-for="swatch in TAG_PALETTE"
            :key="swatch.value"
            type="button"
            class="h-7 px-2 rounded-md text-[11px] font-medium leading-none transition-shadow"
            :class="[
              swatch.bg,
              swatch.text,
              tagDraft.color === swatch.value
                ? 'ring-2 ring-offset-1 ring-emerald-500'
                : 'opacity-80 hover:opacity-100',
            ]"
            :aria-pressed="tagDraft.color === swatch.value"
            :aria-label="`Couleur ${swatch.label}`"
            @click="tagDraft.color = swatch.value"
          >
            {{ swatch.label }}
          </button>
        </div>
        <span
          v-if="tagError"
          class="text-[11px] text-rose-600"
        >
          {{ tagError }}
        </span>
        <div class="ml-auto flex items-center gap-2">
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            @click="cancelTagEdit"
          >
            Annuler
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            @click="commitTag"
          >
            Créer
          </button>
        </div>
      </div>
    </div>

    <!-- Tags list -->
    <div class="border border-surface-200 rounded-md divide-y divide-surface-200">
      <template
        v-for="t in visibleTags"
        :key="t.id"
      >
        <!-- View mode -->
        <div
          v-if="editingTagId !== t.id"
          class="flex items-center gap-3 px-3 h-12"
        >
          <TagIcon
            :size="14"
            :stroke-width="2"
            class="text-surface-400"
          />
          <Pill :variant="t.color">
            {{ t.name }}
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
          <span class="text-[12px] text-surface-500 font-mono ml-2">
            /tags/{{ t.id }}
          </span>
          <div class="ml-auto flex items-center gap-2">
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              @click="startEditTag(t)"
            >
              Éditer
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              @click="toggleTagArchive(t)"
            >
              {{ t.active ? 'Archiver' : 'Désarchiver' }}
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm !text-rose-700"
              @click="openDeleteTagDialog(t)"
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
                v-model="tagDraft.name"
                class="mt-1 w-full"
              />
            </label>
            <label class="block">
              <span class="text-[12px] text-surface-600">Ordre</span>
              <InputNumber
                v-model="tagDraft.displayOrder"
                :min="0"
                input-class="!w-full"
                class="mt-1 w-full"
              />
            </label>
            <div class="col-span-3 flex items-end">
              <Pill :variant="tagDraft.color">
                {{ tagDraft.name.trim() || 'Aperçu' }}
              </Pill>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <span class="text-[12px] text-surface-600">Couleur</span>
            <div class="flex items-center gap-1.5">
              <button
                v-for="swatch in TAG_PALETTE"
                :key="swatch.value"
                type="button"
                class="h-7 px-2 rounded-md text-[11px] font-medium leading-none transition-shadow"
                :class="[
                  swatch.bg,
                  swatch.text,
                  tagDraft.color === swatch.value
                    ? 'ring-2 ring-offset-1 ring-emerald-500'
                    : 'opacity-80 hover:opacity-100',
                ]"
                :aria-pressed="tagDraft.color === swatch.value"
                :aria-label="`Couleur ${swatch.label}`"
                @click="tagDraft.color = swatch.value"
              >
                {{ swatch.label }}
              </button>
            </div>
            <span
              v-if="tagError"
              class="text-[11px] text-rose-600"
            >
              {{ tagError }}
            </span>
            <div class="ml-auto flex items-center gap-2">
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                @click="cancelTagEdit"
              >
                Annuler
              </button>
              <button
                type="button"
                class="btn btn-primary btn-sm"
                @click="commitTag"
              >
                Sauvegarder
              </button>
            </div>
          </div>
        </div>
      </template>

      <div
        v-if="visibleTags.length === 0"
        class="px-3 py-6 text-center text-[12px] text-surface-500"
      >
        <template v-if="tagsStore.loading">
          Chargement…
        </template>
        <template v-else-if="!showArchivedTags && archivedTagsCount > 0">
          Aucun tag actif.
          <button
            type="button"
            class="text-emerald-700 underline ml-1"
            @click="showArchivedTags = true"
          >
            Afficher les {{ archivedTagsCount }} archivé(s)
          </button>
        </template>
        <template v-else>
          Aucun tag configuré. Crée le premier pour pouvoir l'attacher
          à une équipe.
        </template>
      </div>
    </div>

    <div
      v-if="tagFlashMessage"
      class="text-[12px] text-emerald-700 flex items-center gap-1"
    >
      <Check
        :size="14"
        :stroke-width="2"
      />
      {{ tagFlashMessage }}
    </div>

    <!-- =================== Delete tag dialog =================== -->
    <Dialog
      v-model:visible="isDeleteTagDialogOpen"
      modal
      :draggable="false"
      :style="{ width: '460px' }"
      header="Supprimer le tag"
    >
      <div
        v-if="deleteTagDialogTarget"
        class="space-y-3 pt-1"
      >
        <div class="flex items-center gap-2">
          <TagIcon
            :size="14"
            :stroke-width="2"
            class="text-surface-400"
          />
          <Pill :variant="deleteTagDialogTarget.color">
            {{ deleteTagDialogTarget.name }}
          </Pill>
        </div>

        <p
          v-if="deleteTagDialogLoading"
          class="text-[12px] text-surface-500"
        >
          Vérification de l'usage…
        </p>
        <template v-else>
          <p
            v-if="deleteTagDialogUsageCount > 0"
            class="text-[13px] text-surface-700"
          >
            Ce tag est utilisé par
            <strong>{{ deleteTagDialogUsageCount }} équipe(s)</strong>. Tu ne
            peux pas le supprimer ; archive-le plutôt.
          </p>
          <p
            v-else-if="deleteTagDialogUsageCount === 0"
            class="text-[13px] text-surface-700"
          >
            Ce tag n'est référencé par aucune équipe. La suppression est
            définitive.
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
          @click="closeDeleteTagDialog"
        >
          {{ deleteTagDialogUsageCount === 0 ? 'Annuler' : 'Fermer' }}
        </button>
        <button
          v-if="deleteTagDialogUsageCount > 0 && deleteTagDialogTarget?.active"
          type="button"
          class="btn btn-secondary btn-sm"
          @click="archiveFromDeleteTagDialog"
        >
          Archiver à la place
        </button>
        <button
          v-if="deleteTagDialogUsageCount === 0 && !deleteTagDialogLoading"
          type="button"
          class="btn btn-primary btn-sm !bg-rose-600 hover:!bg-rose-700"
          @click="confirmDeleteTag"
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
