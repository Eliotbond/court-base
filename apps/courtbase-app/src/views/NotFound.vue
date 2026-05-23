<script setup lang="ts">
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
</script>

<template>
  <CbMobileShell hide-header plain-body>
    <div class="cb-page" style="padding: 80px 24px; align-items: center; text-align: center; gap: 20px">
      <h1 class="cb-h1">404 — page introuvable</h1>
      <p class="cb-sub" style="max-width: 320px">
        La page demandée n'existe pas dans l'app companion.
      </p>
      <RouterLink to="/" class="cb-btn primary">Retour à l'accueil</RouterLink>
    </div>
  </CbMobileShell>
</template>
