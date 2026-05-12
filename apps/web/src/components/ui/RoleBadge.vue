<script setup lang="ts">
defineProps<{
  label: string
  color: string
  bg: string
}>()
</script>

<template>
  <span
    class="inline-flex items-center h-5 px-[7px] rounded text-[11px] font-medium leading-none whitespace-nowrap"
    :style="{ color, background: bg }"
  >
    {{ label }}
  </span>
</template>
