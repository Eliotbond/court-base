<script setup lang="ts">
defineProps<{
  active?: boolean
}>()
</script>

<template>
  <button
    type="button"
    class="inline-flex items-center gap-1 h-7 px-[11px] rounded-full text-[12px] font-medium border bg-white text-surface-600 transition-colors hover:bg-surface-50"
    :class="active ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-50' : 'border-surface-200'"
  >
    <slot />
  </button>
</template>
