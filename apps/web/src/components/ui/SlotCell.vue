<script setup lang="ts">
import { computed } from 'vue'

type SlotKind = 'training' | 'match_home' | 'match_away' | 'reserve' | 'custom' | 'empty'

const props = withDefaults(
  defineProps<{
    kind: SlotKind
  }>(),
  { kind: 'empty' },
)

const variantClass = computed(() => {
  switch (props.kind) {
    case 'training':
      return 'bg-blue-50 border-blue-200 text-blue-700'
    case 'match_home':
      return 'bg-emerald-50 border-emerald-300 text-emerald-700'
    case 'match_away':
      return 'bg-violet-50 border-violet-300 text-violet-700'
    case 'reserve':
      return 'bg-surface-100 border-surface-300 text-surface-600'
    case 'custom':
      return 'bg-amber-50 border-amber-300 text-amber-700'
    case 'empty':
    default:
      return 'bg-transparent border-dashed border-surface-200 text-transparent cursor-default'
  }
})

const isEmpty = computed(() => props.kind === 'empty')
</script>

<template>
  <div
    class="border rounded px-2 py-1.5 text-[11px] leading-tight overflow-hidden transition-transform"
    :class="[
      variantClass,
      isEmpty ? '' : 'cursor-pointer hover:-translate-y-px hover:shadow-pop',
    ]"
  >
    <slot />
  </div>
</template>
