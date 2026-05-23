<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { LogOut, User as UserIcon } from 'lucide-vue-next'

import { useAuthStore } from '@/stores/auth'

/**
 * Menu déroulant accessible depuis le kebab du header (mobile) et le
 * userchip de la sidebar (desktop). Expose 2 actions :
 *  - "Mon profil" → `router.push({ name: 'profile-settings' })`
 *  - "Se déconnecter" → `auth.signOut()` (Firebase) puis redirect sign-in.
 *
 * Le menu se ferme :
 *  - sur click d'un item
 *  - sur click outside (listener global tant que `visible`)
 *  - sur Escape
 *
 * Positionnement : prop `anchor` détermine le coin de référence
 *  - `top-right` : pour le kebab du header mobile (default)
 *  - `bottom-left` : pour le userchip de la sidebar desktop (ouvre vers le haut)
 */
const props = withDefaults(
  defineProps<{
    visible: boolean
    anchor?: 'top-right' | 'bottom-left'
  }>(),
  { anchor: 'top-right' },
)

const emit = defineEmits<{
  'update:visible': [v: boolean]
}>()

const router = useRouter()
const auth = useAuthStore()
const root = ref<HTMLElement | null>(null)

function close(): void {
  emit('update:visible', false)
}

async function goToProfile(): Promise<void> {
  close()
  await router.push({ name: 'profile-settings' })
}

async function onSignOut(): Promise<void> {
  close()
  try {
    await auth.signOut()
  } catch (err) {
    console.error('[CbUserMenu] signOut failed', err)
  }
  await router.push({ name: 'sign-in' })
}

// ─── Click outside ─────────────────────────────────────────────
function onDocumentClick(e: MouseEvent): void {
  if (!props.visible) return
  if (root.value && !root.value.contains(e.target as Node)) {
    close()
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (props.visible && e.key === 'Escape') close()
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick, true)
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick, true)
  document.removeEventListener('keydown', onKeydown)
})

// Reset au cas où on remount avec visible déjà true (rare)
watch(() => props.visible, () => {})

const positionStyle = computed(() => {
  if (props.anchor === 'bottom-left') {
    // Sidebar desktop : userchip en bas, menu ouvre vers le haut, aligné
    // sur le bord gauche du userchip.
    return 'position: absolute; bottom: 56px; left: 12px; min-width: 200px;'
  }
  // Header mobile kebab : sous le kebab, aligné à droite.
  return 'position: absolute; top: 52px; right: 8px; min-width: 200px;'
})
</script>

<template>
  <div
    v-if="visible"
    ref="root"
    class="cb-user-menu"
    :style="positionStyle"
    role="menu"
  >
    <button type="button" class="cb-user-menu-item" role="menuitem" @click="goToProfile">
      <UserIcon :size="16" />
      <span>Mon profil</span>
    </button>
    <div class="cb-user-menu-sep" />
    <button
      type="button"
      class="cb-user-menu-item cb-user-menu-item-danger"
      role="menuitem"
      @click="onSignOut"
    >
      <LogOut :size="16" />
      <span>Se déconnecter</span>
    </button>
  </div>
</template>

<style scoped>
.cb-user-menu {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 4px;
  box-shadow: var(--shadow-md);
  z-index: 90;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cb-user-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 6px;
  border: 0;
  background: transparent;
  color: var(--slate-700);
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
}
.cb-user-menu-item:hover {
  background: var(--slate-100);
}
.cb-user-menu-item-danger {
  color: var(--rose-700);
}
.cb-user-menu-item-danger:hover {
  background: var(--rose-50);
}
.cb-user-menu-sep {
  height: 1px;
  background: var(--border);
  margin: 2px 4px;
}
</style>
