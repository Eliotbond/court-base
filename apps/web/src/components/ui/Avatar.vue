<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    name: string
    size?: number
  }>(),
  { size: 28 },
)

const initials = computed(() => {
  const parts = props.name.trim().split(/\s+/)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
})

const style = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  fontSize: `${Math.max(10, Math.round(props.size * 0.4))}px`,
}))
</script>

<template>
  <span
    class="inline-flex items-center justify-center rounded-full bg-surface-200 font-semibold text-surface-900 shrink-0"
    :style="style"
  >
    {{ initials }}
  </span>
</template>
