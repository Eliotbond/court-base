<script setup lang="ts">
import { computed } from 'vue'

type PillVariant = 'emerald' | 'sky' | 'amber' | 'rose' | 'slate' | 'violet'

const props = withDefaults(
  defineProps<{
    variant?: PillVariant
    strike?: boolean
  }>(),
  { variant: 'slate', strike: false },
)

const variantClass = computed(() => {
  switch (props.variant) {
    case 'emerald':
      return 'bg-emerald-50 text-emerald-700'
    case 'sky':
      return 'bg-sky-50 text-sky-700'
    case 'amber':
      return 'bg-amber-50 text-amber-700'
    case 'rose':
      return 'bg-rose-50 text-rose-700'
    case 'violet':
      return 'bg-violet-50 text-violet-700'
    case 'slate':
    default:
      return 'bg-surface-100 text-surface-600'
  }
})
</script>

<template>
  <span
    class="inline-flex items-center gap-1 h-5 px-[7px] rounded text-[11px] font-medium leading-none whitespace-nowrap"
    :class="[variantClass, strike ? 'line-through opacity-70' : '']"
  >
    <slot />
  </span>
</template>
