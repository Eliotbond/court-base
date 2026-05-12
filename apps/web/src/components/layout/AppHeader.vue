<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Search, Bell, CircleHelp, ChevronRight, ChevronDown, LogOut } from 'lucide-vue-next'
import Menu from 'primevue/menu'
import type { MenuItem } from 'primevue/menuitem'
import Avatar from '@/components/ui/Avatar.vue'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const breadcrumbLabel = computed(() => {
  const meta = route.meta as { title?: string }
  if (meta.title) return meta.title
  return typeof route.name === 'string' ? route.name : 'Workspace'
})

const userName = computed(
  () => auth.authSnap?.displayName ?? auth.authSnap?.email ?? 'Utilisateur',
)

const userSubline = computed(() => {
  if (auth.rootAdmin) return 'Root admin'
  if (auth.roles.length > 0) {
    return auth.roles.map((r) => r[0].toUpperCase() + r.slice(1)).join(' · ')
  }
  return auth.authSnap?.email ?? 'Aucun rôle'
})

async function onSignOut(): Promise<void> {
  await auth.signOut()
  await router.push({ name: 'login' })
}

const userMenu = ref<InstanceType<typeof Menu> | null>(null)
const userMenuItems: MenuItem[] = [
  {
    label: 'Se déconnecter',
    icon: 'pi pi-sign-out',
    command: () => {
      void onSignOut()
    },
  },
]

function toggleUserMenu(event: MouseEvent): void {
  userMenu.value?.toggle(event)
}
</script>

<template>
  <header
    class="h-14 bg-white border-b border-surface-200 sticky top-0 z-20 flex items-center px-6 gap-4"
  >
    <div class="flex items-center gap-2 text-[13px] text-surface-500">
      <span>Workspace</span>
      <ChevronRight
        :size="14"
        :stroke-width="2"
      />
      <span class="text-surface-900 font-medium">{{ breadcrumbLabel }}</span>
    </div>
    <div class="flex-1" />
    <div class="input-wrap w-72 hidden lg:block">
      <Search
        :size="16"
        :stroke-width="2"
      />
      <input
        type="text"
        class="input input-with-icon"
        placeholder="Search members, teams, bookings…"
      >
      <span
        class="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-surface-400 px-1.5 py-0.5 border border-surface-200 rounded"
      >
        ⌘K
      </span>
    </div>
    <button
      type="button"
      class="btn btn-ghost btn-sm relative"
    >
      <Bell
        :size="16"
        :stroke-width="2"
      />
      <span
        class="absolute -top-0.5 -right-0.5 w-4 h-4 bg-rose-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center"
      >
        5
      </span>
    </button>
    <button
      type="button"
      class="btn btn-ghost btn-sm"
    >
      <CircleHelp
        :size="16"
        :stroke-width="2"
      />
    </button>
    <div class="w-px h-6 bg-surface-200" />
    <template v-if="auth.isSignedIn">
      <button
        type="button"
        class="flex items-center gap-2 hover:bg-surface-50 px-1.5 h-9 rounded-md"
        aria-haspopup="true"
        aria-label="Menu utilisateur"
        @click="toggleUserMenu"
      >
        <Avatar
          :name="userName"
          :size="28"
        />
        <div class="text-left leading-tight hidden md:block">
          <div class="text-[12px] font-medium max-w-[160px] truncate">
            {{ userName }}
          </div>
          <div class="text-[10px] text-surface-500 max-w-[160px] truncate">
            {{ userSubline }}
          </div>
        </div>
        <ChevronDown
          :size="14"
          :stroke-width="2"
          class="text-surface-400"
        />
      </button>
      <Menu
        ref="userMenu"
        :model="userMenuItems"
        :popup="true"
      />
    </template>
    <template v-else>
      <button
        type="button"
        class="btn btn-secondary btn-sm flex items-center gap-1.5"
        @click="router.push({ name: 'login' })"
      >
        <LogOut
          :size="14"
          :stroke-width="2"
        />
        Se connecter
      </button>
    </template>
  </header>
</template>
