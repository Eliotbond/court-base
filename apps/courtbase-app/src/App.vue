<script setup lang="ts">
import { RouterView } from 'vue-router'
import CbMockBadge from '@/components/ui/CbMockBadge.vue'
</script>

<template>
  <RouterView />
  <!-- Badge global "Données simulées" — à retirer quand on branchera le backend. -->
  <CbMockBadge />
</template>
