<script setup lang="ts">
import { RouterView } from 'vue-router'
import SettingsSidebar from './SettingsSidebar.vue'
</script>

<template>
  <div class="flex min-w-0 h-full">
    <SettingsSidebar />
    <div class="flex-1 min-w-0">
      <RouterView />
    </div>
  </div>
</template>
