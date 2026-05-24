<script setup lang="ts">
/**
 * Étape 6 — DÉPRÉCIÉE (2026-05-23).
 *
 * Avant : collectait la lettre de sortie de l'ancien club si
 * `previouslyLicensed === true`.
 *
 * Maintenant : les documents de licence (lettre de sortie, passeport, AVS,
 * contexte joueur étranger) sont collectés au moment de la **création de
 * la licence** par le coach, via `LicenseRequestForm.vue` (cf.
 * `docs/licenses/parent-completion-workflow.md`). Le wizard d'inscription
 * lui-même ne collecte plus rien d'autre que le flag `previouslyLicensed`
 * + nom du club précédent (pour info coach lors de la décision essai).
 *
 * Cette vue est conservée comme **redirection défensive** : si un draft
 * existant ou un bookmark pointe encore vers `/register/step-6`, on
 * route silencieusement vers Step 7.
 */
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

onMounted(() => {
  void router.replace('/register/step-7')
})
</script>

<template>
  <div />
</template>
