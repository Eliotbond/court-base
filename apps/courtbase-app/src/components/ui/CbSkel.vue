<script setup lang="ts">
import { computed } from 'vue'

/**
 * Skeleton loader atomique. Pour les patterns composés (row, card), composer
 * plusieurs `<CbSkel>` côté view ou créer des sous-composants `CbSkelRow.vue`.
 */
const props = withDefaults(
  defineProps<{
    /** Largeur CSS ("100%", "60%", "120px"…). Défaut : 100%. */
    w?: string
    /** Hauteur en pixels. Défaut : 12. */
    h?: number
  }>(),
  { w: '100%', h: 12 },
)

const style = computed(() => `width:${props.w};height:${props.h}px;`)
</script>

<template>
  <div class="cb-skel" :style="style" />
</template>
