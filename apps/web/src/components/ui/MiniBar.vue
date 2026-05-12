<script setup lang="ts">
import { computed } from 'vue'

/**
 * Mini-bar horizontale 0..1 — pour les breakdowns inline (Dashboard cotisations
 * card, ratios sur les alert cards). Pas de chart lib : juste un `<div>` avec
 * largeur en %. Voir design `Courtbase Mockups.html` lignes 332, 454-457.
 *
 * `value` : ratio entre 0 et 1.
 * `color` : hex de la barre (par ex. `#10b981` emerald).
 * `bg` : couleur du track (par défaut `bg-surface-100`).
 * `height` : hauteur en px (par défaut 6).
 */
const props = withDefaults(
  defineProps<{
    value: number
    color: string
    bg?: string
    height?: number
  }>(),
  { bg: '#f1f5f9', height: 6 },
)

const clamped = computed<number>(() => Math.max(0, Math.min(1, props.value)))
const trackStyle = computed(() => ({
  background: props.bg,
  height: `${props.height}px`,
}))
const fillStyle = computed(() => ({
  background: props.color,
  width: `${clamped.value * 100}%`,
  height: '100%',
}))
</script>

<template>
  <div
    class="w-full rounded-full overflow-hidden"
    :style="trackStyle"
    role="progressbar"
    :aria-valuenow="Math.round(clamped * 100)"
    aria-valuemin="0"
    aria-valuemax="100"
  >
    <div :style="fillStyle" />
  </div>
</template>
