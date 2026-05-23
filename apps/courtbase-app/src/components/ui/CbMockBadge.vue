<script setup lang="ts">
import { FlaskConical } from 'lucide-vue-next'

/**
 * Badge persistant qui signale que l'app tourne en **mode mock** — toutes
 * les données sont simulées (`@/repositories/mock`), aucune écriture vers
 * Firestore, aucun callable réellement invoqué.
 *
 * Affiché en bas-droite du viewport en permanence tant que la couche mock
 * est active. Sera supprimé quand Firebase Auth + repos réels seront branchés.
 */
</script>

<template>
  <div class="cb-mock-badge" role="status" aria-label="Mode données simulées">
    <FlaskConical :size="14" />
    <span>Données simulées</span>
  </div>
</template>

<style scoped>
.cb-mock-badge {
  position: fixed;
  bottom: max(var(--safe-bottom), 12px);
  right: 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  background: var(--amber-100);
  color: var(--amber-700);
  border: 1px solid var(--amber-200);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.01em;
  box-shadow: var(--shadow);
  z-index: 100;
  pointer-events: none;
  user-select: none;
}

/* Sur mobile, remonter au-dessus de la tab bar (56 + safe-bottom). */
@media (max-width: 1023px) {
  .cb-mock-badge {
    bottom: calc(max(var(--safe-bottom), 12px) + 76px);
  }
}
</style>
