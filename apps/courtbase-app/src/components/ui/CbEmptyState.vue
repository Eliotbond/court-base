<script setup lang="ts">
import { Inbox } from 'lucide-vue-next'
import type { FunctionalComponent } from 'vue'

/**
 * S7 — Empty state. Pour : aucune équipe, aucune assignation, aucune notif.
 * Le slot `icon` permet de surcharger l'icône (lucide ou autre).
 */
defineProps<{
  /** Composant icône (lucide-vue-next). Défaut : Inbox. */
  icon?: FunctionalComponent
  title: string
  body?: string
}>()
</script>

<template>
  <div class="cb-empty">
    <div class="icon">
      <slot name="icon"><component :is="icon ?? Inbox" :size="26" /></slot>
    </div>
    <h3>{{ title }}</h3>
    <p v-if="body">{{ body }}</p>
    <div v-if="$slots.actions" class="actions"><slot name="actions" /></div>
  </div>
</template>
