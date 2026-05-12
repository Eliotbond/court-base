<script setup lang="ts">
import { useRouter } from 'vue-router'
import Button from 'primevue/button'

const router = useRouter()
</script>

<template>
  <main class="forbidden">
    <h1>403 — Accès refusé</h1>
    <p>Vous n'avez pas les droits pour accéder à cette page.</p>
    <Button
      label="Retour à l'accueil"
      @click="router.push('/')"
    />
  </main>
</template>

<style scoped>
.forbidden {
  max-width: 600px;
  margin: 4rem auto;
  padding: 2rem;
  text-align: center;
}
</style>
