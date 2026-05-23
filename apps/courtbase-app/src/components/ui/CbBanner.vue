<script setup lang="ts">
/**
 * Banner d'info pleine largeur. Utilisé pour signaler un état "pas bloquant
 * mais important" : licence officiel manquante, profil incomplet, etc.
 * Cf. `docs/design-brief-courtbase-app.md` § 6 (états).
 */
defineProps<{
  tone?: 'amber' | 'sky' | 'rose' | 'emerald'
  title?: string
}>()
</script>

<template>
  <div class="cb-banner" :class="tone ?? 'sky'">
    <span v-if="$slots.icon" class="icon"><slot name="icon" /></span>
    <div>
      <div v-if="title" class="ttl">{{ title }}</div>
      <div><slot /></div>
    </div>
  </div>
</template>
