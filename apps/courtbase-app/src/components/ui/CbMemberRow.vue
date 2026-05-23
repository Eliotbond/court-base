<script setup lang="ts">
import { ChevronRight } from 'lucide-vue-next'
import CbAvatar from './CbAvatar.vue'

/**
 * S5 — Member row. Ligne dense avec avatar + nom + sub + pills slot.
 * `faded` rend la row barrée / opacifiée (cas joueur exclu : pas d'option
 * "présent" en attendance).
 */
defineProps<{
  name: string
  sub?: string
  avatarTone?: 'emerald' | 'sky' | 'amber' | 'violet' | 'rose'
  /** Désaturé + texte barré (cf. cas exclusion attendance). */
  faded?: boolean
  /** Masque le chevron par défaut (utile dans des cards read-only ou avec
   * un autre élément à droite via le slot `right`). */
  hideChev?: boolean
}>()
</script>

<template>
  <div class="cb-row" :style="faded ? 'opacity:.55' : undefined">
    <CbAvatar :name="name" :tone="avatarTone" />
    <div class="body">
      <div class="name">
        <span :style="faded ? 'text-decoration:line-through' : undefined">{{ name }}</span>
        <slot name="name-suffix" />
      </div>
      <div v-if="sub" class="sub">{{ sub }}</div>
      <div v-if="$slots.pills" class="pills"><slot name="pills" /></div>
    </div>
    <slot name="right">
      <ChevronRight v-if="!hideChev" :size="18" class="chev" />
    </slot>
  </div>
</template>
