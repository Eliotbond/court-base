<script setup lang="ts">
const model = defineModel<boolean>({ default: false })
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="model"
    class="relative w-[30px] h-[18px] rounded-full transition-colors"
    :class="model ? 'bg-emerald-500' : 'bg-surface-300'"
    @click="model = !model"
  >
    <span
      class="absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-[left] duration-150"
      :class="model ? 'left-[14px]' : 'left-[2px]'"
    />
  </button>
</template>
