<script setup lang="ts">
/**
 * Page header desktop (équivalent du PageHead du bundle design). À utiliser
 * dans le `<main>` du `CbDesktopShell` pour afficher un titre + sous-titre +
 * CTAs alignés à droite. Pas utilisé sur mobile (la version mobile vit dans
 * le `CbHeader` 56px du shell).
 */
defineProps<{
  title: string
  subtitle?: string
}>()
</script>

<template>
  <header class="cb-pagehead">
    <div>
      <h1 class="cb-h1">{{ title }}</h1>
      <div v-if="subtitle" class="cb-sub" style="margin-top: 2px">{{ subtitle }}</div>
    </div>
    <div v-if="$slots.actions" class="cb-pagehead-actions"><slot name="actions" /></div>
  </header>
</template>

<style scoped>
.cb-pagehead {
  padding: 20px 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.cb-pagehead-actions {
  display: flex;
  gap: 8px;
}
</style>
