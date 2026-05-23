<script setup lang="ts">
/**
 * Settings → Member roles — vue dédiée extraite de `Settings.vue` (lignes
 * 2791-3035 pour le template, 533-635 pour le script setup d'origine).
 *
 * Gère le référentiel `/roles` du club :
 * - 6 rôles système (`admin`, `treasurer`, `secretary`, `coach`, `official`,
 *   `player`) — non-supprimables ni renommables. Détectés via `role.type === 'system'`.
 * - Rôles custom (Comité, Arbitre, …) — full CRUD inline (row flip).
 *
 * Le CTA "Initialiser les rôles" amorce la collection sur un projet vierge
 * (6 système + 2 customs par défaut, idempotent côté repo).
 *
 * NOTE — Dialog "Manage roles" (Settings.vue lignes 4531-4661) :
 * ce dialog gère les ROLES D'UN USER ADMIN (avec `displayName`, `email`,
 * checkboxes `coach`/`official`/`treasurer` et `isSavingThis('adminTeam')`).
 * Il appartient à AdminTeam.vue, PAS à cette vue.
 *
 * Architecture en couches : vue → store → repo. Aucun appel Firestore direct.
 */
import { computed, onMounted, ref } from 'vue'
import { Check, Plus, Trash2 } from 'lucide-vue-next'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import { FirebaseError } from 'firebase/app'
import { useSettingsStore } from '@/stores/settings'
import Pill from '@/components/ui/Pill.vue'
import RoleBadge from '@/components/ui/RoleBadge.vue'
import type { Role } from '@club-app/shared-types'

const store = useSettingsStore()

onMounted(() => {
  if (!store.config) {
    void store.load()
  }
})

// ---------------------------------------------------------------------------
// Local draft + edit/add inline mode. Pas de modal — flip de la row courante.
// ---------------------------------------------------------------------------

interface RoleDraft {
  name: string
  color: string
}

/**
 * Palette des couleurs disponibles pour un rôle custom — alignée sur la palette
 * de `RoleBadge.vue` côté UI (tokens design pastel).
 */
const COLOR_PRESETS: readonly { value: string; label: string }[] = [
  { value: '#dbeafe', label: 'Bleu' },
  { value: '#fee2e2', label: 'Rouge' },
  { value: '#dcfce7', label: 'Vert' },
  { value: '#fef3c7', label: 'Ambre' },
  { value: '#ede9fe', label: 'Violet' },
  { value: '#fce7f3', label: 'Rose' },
  { value: '#cffafe', label: 'Cyan' },
  { value: '#fde68a', label: 'Jaune' },
  { value: '#f1f5f9', label: 'Gris' },
] as const

const editingRoleId = ref<string | null>(null)
const isAddingRole = ref(false)
const roleDraft = ref<RoleDraft>({ name: '', color: COLOR_PRESETS[0].value })
const roleError = ref<string | null>(null)

function startAddRole(): void {
  isAddingRole.value = true
  editingRoleId.value = null
  roleDraft.value = { name: '', color: COLOR_PRESETS[0].value }
  roleError.value = null
}

function startEditRole(role: Role): void {
  if (role.type === 'system') return
  isAddingRole.value = false
  editingRoleId.value = role.id
  roleDraft.value = { name: role.name, color: role.color }
  roleError.value = null
}

function cancelRoleEdit(): void {
  isAddingRole.value = false
  editingRoleId.value = null
  roleError.value = null
}

function validateRoleDraft(): boolean {
  const name = roleDraft.value.name.trim()
  if (!name) {
    roleError.value = 'Nom requis'
    return false
  }
  if (name.length > 32) {
    roleError.value = 'Maximum 32 caractères'
    return false
  }
  roleError.value = null
  return true
}

async function commitRole(): Promise<void> {
  if (!validateRoleDraft()) return
  const payload: RoleDraft = {
    name: roleDraft.value.name.trim(),
    color: roleDraft.value.color,
  }
  try {
    if (isAddingRole.value) {
      await store.addCustomRole(payload)
    } else if (editingRoleId.value) {
      await store.editRole(editingRoleId.value, payload)
    }
    cancelRoleEdit()
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`commitRole failed [${code}]`, err)
    // Erreur déjà surfacée via `store.error` (optimistic + rollback côté store).
  }
}

async function confirmDeleteRole(role: Role): Promise<void> {
  if (role.type === 'system') return
  const ok = window.confirm(
    `Supprimer le rôle "${role.name}" ? Les membres qui l'utilisent perdront ce rôle.`,
  )
  if (!ok) return
  try {
    await store.removeRole(role.id)
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`removeRole failed [${code}]`, err)
  }
}

/**
 * Amorce `/roles` sur un projet vierge (6 rôles système + 2 customs par
 * défaut). CTA affiché tant que la collection est vide.
 */
async function seedRoles(): Promise<void> {
  try {
    await store.seedRolesAction()
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`seedRolesAction failed [${code}]`, err)
  }
}

// ---------------------------------------------------------------------------
// Saving / saved banner helpers
// ---------------------------------------------------------------------------

const isSaving = computed<boolean>(() => store.savingSection === 'roles')
const isSaved = computed<boolean>(() => store.lastSaved === 'roles')
</script>

<template>
  <section class="space-y-5">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="text-[16px] font-semibold">
          Rôles membres
        </h2>
        <p class="text-[13px] text-surface-500">
          Rôles système (non-supprimables) + rôles custom du club. Voir
          <code class="font-mono text-[11px]">/roles</code> dans firebase.md.
        </p>
      </div>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        :disabled="isAddingRole || isSaving"
        @click="startAddRole"
      >
        <Plus
          :size="14"
          :stroke-width="2"
        />
        Ajouter un rôle
      </button>
    </div>

    <!-- Add row (inline) -->
    <div
      v-if="isAddingRole"
      class="border border-emerald-200 bg-emerald-50/40 rounded-md p-3 flex items-center gap-3"
    >
      <InputText
        v-model="roleDraft.name"
        placeholder="Ex. Trésorier"
        class="flex-1"
      />
      <Select
        v-model="roleDraft.color"
        :options="[...COLOR_PRESETS]"
        option-label="label"
        option-value="value"
        class="w-40"
      >
        <template #value="{ value }">
          <div class="flex items-center gap-2">
            <span
              class="w-3 h-3 rounded-full"
              :style="{ background: value }"
            />
            <span class="text-[12px]">
              {{ COLOR_PRESETS.find((c) => c.value === value)?.label ?? '' }}
            </span>
          </div>
        </template>
        <template #option="{ option }">
          <div class="flex items-center gap-2">
            <span
              class="w-3 h-3 rounded-full"
              :style="{ background: option.value }"
            />
            <span>{{ option.label }}</span>
          </div>
        </template>
      </Select>
      <RoleBadge
        :label="roleDraft.name || 'Aperçu'"
        :bg="roleDraft.color"
        color="#0f172a"
      />
      <span
        v-if="roleError"
        class="text-[11px] text-rose-600"
      >
        {{ roleError }}
      </span>
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        @click="cancelRoleEdit"
      >
        Annuler
      </button>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        :disabled="isSaving"
        @click="commitRole"
      >
        Créer
      </button>
    </div>

    <!-- Roles list -->
    <div class="border border-surface-200 rounded-md divide-y divide-surface-200">
      <div
        v-for="role in store.roles"
        :key="role.id"
        class="flex items-center gap-3 px-3 h-12"
      >
        <!-- View mode -->
        <template v-if="editingRoleId !== role.id">
          <RoleBadge
            :label="role.name"
            :bg="role.color"
            color="#0f172a"
          />
          <Pill
            v-if="role.type === 'system'"
            variant="slate"
          >
            système
          </Pill>
          <Pill
            v-else
            variant="emerald"
          >
            custom
          </Pill>
          <span class="text-[12px] text-surface-500 font-mono ml-2">
            /roles/{{ role.id }}
          </span>
          <div class="ml-auto flex items-center gap-2">
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              :disabled="role.type === 'system' || isSaving"
              @click="startEditRole(role)"
            >
              Éditer
            </button>
            <button
              v-if="role.type !== 'system'"
              type="button"
              class="btn btn-ghost btn-sm !text-rose-700"
              :disabled="isSaving"
              @click="confirmDeleteRole(role)"
            >
              <Trash2
                :size="14"
                :stroke-width="2"
              />
            </button>
          </div>
        </template>

        <!-- Edit mode (inline) -->
        <template v-else>
          <InputText
            v-model="roleDraft.name"
            class="flex-1"
          />
          <Select
            v-model="roleDraft.color"
            :options="[...COLOR_PRESETS]"
            option-label="label"
            option-value="value"
            class="w-40"
          >
            <template #value="{ value }">
              <div class="flex items-center gap-2">
                <span
                  class="w-3 h-3 rounded-full"
                  :style="{ background: value }"
                />
                <span class="text-[12px]">
                  {{ COLOR_PRESETS.find((c) => c.value === value)?.label ?? '' }}
                </span>
              </div>
            </template>
            <template #option="{ option }">
              <div class="flex items-center gap-2">
                <span
                  class="w-3 h-3 rounded-full"
                  :style="{ background: option.value }"
                />
                <span>{{ option.label }}</span>
              </div>
            </template>
          </Select>
          <RoleBadge
            :label="roleDraft.name || 'Aperçu'"
            :bg="roleDraft.color"
            color="#0f172a"
          />
          <span
            v-if="roleError"
            class="text-[11px] text-rose-600"
          >
            {{ roleError }}
          </span>
          <div class="ml-auto flex items-center gap-2">
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              @click="cancelRoleEdit"
            >
              Annuler
            </button>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              :disabled="isSaving"
              @click="commitRole"
            >
              Sauvegarder
            </button>
          </div>
        </template>
      </div>

      <!-- Empty state — seed CTA -->
      <div
        v-if="store.roles.length === 0"
        class="px-3 py-6 flex flex-col items-center gap-3 text-center"
      >
        <p class="text-[12px] text-surface-500">
          Aucun rôle configuré. Initialisez les 6 rôles système
          (+ 2 rôles custom par défaut) pour démarrer.
        </p>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="isSaving"
          @click="seedRoles"
        >
          <Plus
            :size="14"
            :stroke-width="2"
          />
          Initialiser les rôles
        </button>
      </div>
    </div>

    <div
      v-if="isSaved"
      class="text-[12px] text-emerald-700 flex items-center gap-1"
    >
      <Check
        :size="14"
        :stroke-width="2"
      />
      Rôles mis à jour
    </div>
  </section>
</template>
