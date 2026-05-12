<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    name: string
    size?: number
    /** Override background. If omitted, derived deterministically from `name`. */
    bg?: string
    /** Override foreground. If omitted, derived deterministically from `name`. */
    fg?: string
    /** Override displayed initials (e.g. for a club logo). */
    initials?: string
  }>(),
  { size: 28 },
)

const PALETTE: readonly { bg: string; fg: string }[] = [
  { bg: '#dbeafe', fg: '#1e40af' }, // blue-100 / blue-800
  { bg: '#dcfce7', fg: '#166534' }, // green-100 / green-800
  { bg: '#fee2e2', fg: '#9f1239' }, // red-100 / rose-800
  { bg: '#fef3c7', fg: '#854d0e' }, // amber-100 / amber-800
  { bg: '#ede9fe', fg: '#5b21b6' }, // violet-100 / violet-800
  { bg: '#cffafe', fg: '#155e75' }, // cyan-100 / cyan-800
  { bg: '#fce7f3', fg: '#9d174d' }, // pink-100 / pink-800
  { bg: '#e0e7ff', fg: '#3730a3' }, // indigo-100 / indigo-800
] as const

function hash(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0
  }
  return h
}

const computedInitials = computed(() => {
  if (props.initials) return props.initials.slice(0, 2).toUpperCase()
  const parts = props.name.trim().split(/\s+/)
  if (parts.length === 0 || parts[0] === '') return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
})

const derived = computed(() => PALETTE[hash(props.name) % PALETTE.length])

// Size → font-size table that matches the design (20→9, 24→10, 28→11).
function fontSizeFor(size: number): number {
  if (size <= 20) return 9
  if (size <= 24) return 10
  if (size <= 28) return 11
  return Math.max(11, Math.round(size * 0.4))
}

const style = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  fontSize: `${fontSizeFor(props.size)}px`,
  background: props.bg ?? derived.value.bg,
  color: props.fg ?? derived.value.fg,
}))
</script>

<template>
  <span
    class="inline-flex items-center justify-center rounded-full font-semibold shrink-0"
    :style="style"
    :aria-label="name"
  >
    {{ computedInitials }}
  </span>
</template>
