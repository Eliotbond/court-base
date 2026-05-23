<script setup lang="ts">
import { computed } from 'vue'

/**
 * Avatar à initiales (fallback quand on n'a pas de photo). Aligné `cb-avatar`
 * (cf. `tokens.css`). Pour une vraie photo, slotter une `<img>` à la place du
 * fallback.
 */
const props = withDefaults(
  defineProps<{
    /** Nom complet utilisé pour dériver les initiales (2 caractères max). */
    name?: string
    /** Taille — défaut = base 36px ; sm=28, lg=56, xs=22. */
    size?: 'xs' | 'sm' | 'lg'
    /** Couleur thématique (emerald=officiel actif, amber=warning, etc.). */
    tone?: 'emerald' | 'sky' | 'amber' | 'violet' | 'rose' | 'slate'
  }>(),
  { name: '' },
)

const initials = computed(() => {
  if (!props.name) return '?'
  return props.name
    .split(' ')
    .filter(Boolean)
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
})

const classes = computed(() => ['cb-avatar', props.size, props.tone].filter(Boolean))
</script>

<template>
  <span :class="classes">
    <slot>{{ initials }}</slot>
  </span>
</template>
