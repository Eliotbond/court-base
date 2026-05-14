<script setup lang="ts">
import { computed } from 'vue'

type SlotKind = 'training' | 'match_home' | 'match_away' | 'reserve' | 'custom' | 'empty'

const props = withDefaults(
  defineProps<{
    kind: SlotKind
    /**
     * Match à domicile dont l'adversaire n'a pas encore été défini
     * (`matchTypeId === null`). Affiche une couleur distincte du match
     * "défini" pour signaler qu'une action de l'admin est attendue.
     */
    pendingMatch?: boolean
    /**
     * Réservation libérée (status === 'freed'). Rendue avec un fond hachuré
     * neutre pour indiquer que le créneau est devenu disponible.
     */
    freed?: boolean
    /**
     * Réservation annulée (status === 'cancelled'). Atténuée + barrée par
     * le caller, on ne touche pas à la couleur de base ici.
     */
    cancelled?: boolean
  }>(),
  { kind: 'empty', pendingMatch: false, freed: false, cancelled: false },
)

const variantClass = computed(() => {
  // Freed override : un slot libéré n'utilise plus sa couleur d'origine
  // (training/match…) → fond gris hachuré, plus discret qu'un slot actif.
  if (props.freed) {
    return 'bg-surface-50 border-surface-300 text-surface-500 border-dashed'
  }
  switch (props.kind) {
    case 'training':
      return 'bg-blue-50 border-blue-200 text-blue-700'
    case 'match_home':
      // Match à domicile non encore défini → orange (pending),
      // sinon émeraude (match prêt avec un matchType associé).
      return props.pendingMatch
        ? 'bg-orange-50 border-orange-300 text-orange-700'
        : 'bg-emerald-50 border-emerald-300 text-emerald-700'
    case 'match_away':
      return 'bg-violet-50 border-violet-300 text-violet-700'
    case 'reserve':
      return 'bg-surface-100 border-surface-300 text-surface-600'
    case 'custom':
      return 'bg-amber-50 border-amber-300 text-amber-700'
    case 'empty':
    default:
      return 'bg-transparent border-dashed border-surface-200 text-transparent cursor-default'
  }
})

const isEmpty = computed(() => props.kind === 'empty')
</script>

<template>
  <div
    class="border rounded-md px-2 py-1.5 text-[11px] leading-tight overflow-hidden transition-transform"
    :class="[
      variantClass,
      isEmpty ? '' : 'cursor-pointer hover:-translate-y-px hover:shadow-pop',
      cancelled ? 'opacity-50 line-through' : '',
    ]"
  >
    <slot />
  </div>
</template>
