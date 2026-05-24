<script setup lang="ts">
/**
 * Header de section générique pour les hubs (Home, etc.).
 *
 * Rend un `<h2>` 17px (classe `.cb-h2`) avec un éventuel slot `action` à
 * droite (lien "Voir tout", etc.).
 *
 * Préfère cet atomic à un `<h2>` ad-hoc inline pour garder la typo + le
 * spacing cohérents entre les sections Home (Coach / Officiel / Admin /
 * Joueur) et les hubs futurs.
 */
defineProps<{
  /** Titre de la section. */
  title: string
}>()
</script>

<template>
  <div class="cb-section-header">
    <h2 class="cb-h2">{{ title }}</h2>
    <div v-if="$slots.action" class="cb-section-header__action">
      <slot name="action" />
    </div>
  </div>
</template>

<style scoped>
.cb-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 4px 6px;
}
.cb-section-header__action {
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
