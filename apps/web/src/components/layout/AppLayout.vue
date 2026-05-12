<script setup lang="ts">
import { RouterView } from 'vue-router'
import AppSidebar from './AppSidebar.vue'
import AppHeader from './AppHeader.vue'
</script>

<template>
  <div class="min-h-screen grid grid-cols-[240px_1fr] bg-surface-50">
    <AppSidebar />
    <main class="min-w-0 flex flex-col">
      <AppHeader />
      <div class="flex-1 min-w-0">
        <RouterView />
      </div>
    </main>
  </div>
</template>
