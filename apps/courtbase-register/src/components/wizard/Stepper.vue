<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    current: number
    title: string
    total?: number
  }>(),
  { total: 7 },
)

const dots = computed(() => {
  const arr: Array<'done' | 'current' | 'pending'> = []
  for (let i = 1; i <= props.total; i += 1) {
    if (i < props.current) arr.push('done')
    else if (i === props.current) arr.push('current')
    else arr.push('pending')
  }
  return arr
})

const metaLabel = computed(() => `ÉTAPE ${props.current} / ${props.total}`)
</script>

<template>
  <div class="stepper">
    <div class="stepper-dots">
      <div
        v-for="(state, i) in dots"
        :key="i"
        class="step-dot"
        :class="{ done: state === 'done', current: state === 'current' }"
      />
    </div>
    <div class="stepper-label">
      <div class="stepper-name">{{ title }}</div>
      <div class="stepper-meta">{{ metaLabel }}</div>
    </div>
  </div>
</template>
