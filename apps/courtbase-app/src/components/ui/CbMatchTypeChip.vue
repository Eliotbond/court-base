<script setup lang="ts">
import { computed } from 'vue'
import CbPill, { type CbPillTone } from './CbPill.vue'

/**
 * Chip de type de match. Le mapping est volontairement extensible — un
 * `matchType` inconnu sera affiché en `slate` avec son label brut.
 *
 * La source de vérité reste `/matchTypes` côté Firestore (cf. `docs/main.md`).
 * Cette table est un mapping **visuel** par convention pour les types courants.
 */
const props = defineProps<{ type: string }>()

const TYPE_MAP: Record<string, { tone: CbPillTone; label: string }> = {
  CSJC: { tone: 'violet', label: 'CSJC' },
  AFBB: { tone: 'violet', label: 'AFBB' },
  Amical: { tone: 'sky', label: 'Amical' },
  Training: { tone: 'emerald', label: 'Training' },
}

const resolved = computed(() => TYPE_MAP[props.type] ?? { tone: 'slate' as CbPillTone, label: props.type })
</script>

<template>
  <CbPill :tone="resolved.tone">{{ resolved.label }}</CbPill>
</template>
