<script setup lang="ts">
import { computed, type FunctionalComponent } from 'vue'

/**
 * S3 — Tab bar bottom mobile. 2–4 items role-aware. L'item actif est en
 * couleur primaire (emerald) avec un indicator subtle en haut + label gras.
 * Badge numérique rose en haut-droite de l'icône pour notifs non lues.
 */
export interface CbTab {
  /** Composant icône (lucide-vue-next). */
  icon: FunctionalComponent
  label: string
  /** Nombre à afficher dans le badge rose. `null` / `0` cache le badge. */
  badge?: number | null
}

const props = defineProps<{
  tabs: ReadonlyArray<CbTab>
  /** Index de l'onglet actif. */
  active?: number
}>()

defineEmits<{ select: [index: number] }>()

const colsClass = computed(() => `cols-${props.tabs.length}`)
</script>

<template>
  <div class="cb-tabbar" :class="colsClass">
    <button
      v-for="(t, i) in tabs"
      :key="i"
      type="button"
      class="cb-tab"
      :class="{ active: active === i }"
      @click="$emit('select', i)"
    >
      <component
        :is="t.icon"
        :size="22"
        :stroke-width="active === i ? 2 : 1.8"
      />
      <span>{{ t.label }}</span>
      <span v-if="t.badge" class="badge">{{ t.badge }}</span>
    </button>
  </div>
</template>
