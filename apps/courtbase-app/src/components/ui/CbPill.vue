<script setup lang="ts">
/**
 * S4 — Status pill.
 * Couleurs sémantiques (cf. `docs/design-brief-courtbase-app.md` § 8) :
 *   emerald = confirmé/payé/présent/licencié
 *   amber   = pending/à pourvoir/exception
 *   rose    = exclusion/refus/urgent
 *   sky     = info bénin
 *   violet  = admin/assignations
 *   slate   = inactif/archivé
 */
export type CbPillTone = 'emerald' | 'amber' | 'rose' | 'sky' | 'violet' | 'slate'

defineProps<{
  tone?: CbPillTone
  /** Pastille pleine (couleur de fond solide, texte blanc). */
  solid?: boolean
  /** Petit point devant le label (utile pour les status visuellement actifs). */
  dot?: boolean
}>()
</script>

<template>
  <span class="cb-pill" :class="[solid ? `solid-${tone ?? 'slate'}` : (tone ?? 'slate')]">
    <span v-if="dot" class="dot" />
    <slot />
  </span>
</template>
