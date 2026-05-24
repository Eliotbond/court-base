<script setup lang="ts">
import { computed, type FunctionalComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/**
 * S3 — Tab bar bottom mobile. 2–4 items role-aware. L'item actif est en
 * couleur primaire (emerald) avec un indicator subtle en haut + label gras.
 * Badge numérique rose en haut-droite de l'icône pour notifs non lues.
 *
 * Navigation : si `tab.routeName` est défini, le click route directement et
 * l'onglet actif est auto-détecté depuis `route.name`. Le prop `active` et
 * l'event `select` restent en rétro-compat (multi-rôle switcher etc.).
 */
export interface CbTab {
  /** Composant icône (lucide-vue-next). */
  icon: FunctionalComponent
  label: string
  /** Nombre à afficher dans le badge rose. `null` / `0` cache le badge. */
  badge?: number | null
  /** Nom de la route Vue Router. Si présent → click navigue + auto-active. */
  routeName?: string
  params?: Record<string, string>
  /** Routes additionnelles qui marquent cet onglet comme actif (sous-pages). */
  activeRoutes?: ReadonlyArray<string>
}

const props = defineProps<{
  tabs: ReadonlyArray<CbTab>
  /** Override manuel de l'index actif (legacy). Auto-détecté sinon. */
  active?: number
}>()

const emit = defineEmits<{ select: [index: number] }>()

const route = useRoute()
const router = useRouter()

const colsClass = computed(() => `cols-${props.tabs.length}`)

const autoActiveIndex = computed<number>(() => {
  const name = typeof route.name === 'string' ? route.name : null
  if (!name) return -1
  const exact = props.tabs.findIndex((t) => t.routeName === name)
  if (exact >= 0) return exact
  return props.tabs.findIndex((t) => t.activeRoutes?.includes(name) ?? false)
})

const effectiveActive = computed<number>(() => {
  if (autoActiveIndex.value >= 0) return autoActiveIndex.value
  return props.active ?? -1
})

function onTabClick(index: number): void {
  const tab = props.tabs[index]
  if (!tab) return
  if (tab.routeName) {
    void router.push({ name: tab.routeName, params: tab.params })
    return
  }
  emit('select', index)
}
</script>

<template>
  <div class="cb-tabbar" :class="colsClass">
    <button
      v-for="(t, i) in tabs"
      :key="i"
      type="button"
      class="cb-tab"
      :class="{ active: effectiveActive === i }"
      @click="onTabClick(i)"
    >
      <component
        :is="t.icon"
        :size="22"
        :stroke-width="effectiveActive === i ? 2 : 1.8"
      />
      <span>{{ t.label }}</span>
      <span v-if="t.badge" class="badge">{{ t.badge }}</span>
    </button>
  </div>
</template>
