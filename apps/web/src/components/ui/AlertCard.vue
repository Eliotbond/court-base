<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronRight, ArrowRight } from 'lucide-vue-next'

/**
 * Carte d'alerte cliquable, slot-based.
 *
 * Layout cible (cf. design `Courtbase Mockups.html` lignes 304-372) :
 *   - slot `#icon` : petite icône monochromatique en tête de carte
 *   - slot `default` (ou `#header-label`) : libellé textuel de la carte
 *   - slot `#metric` : grand chiffre + chip secondaire (à côté du chiffre)
 *   - slot `#content` : zone de détails (mini-liste, mini-bar, sous-stats…)
 *   - slot `#actions` : zone optionnelle pour boutons inline (Refuser/Accepter)
 *   - slot `#cta` : libellé du CTA en bas (par défaut "Voir détails →")
 *
 * Toute la carte est cliquable sauf si `to` est null ou si le slot `#actions`
 * intercepte les clics (utiliser `@click.stop` dans le slot).
 *
 * Variants : impact visuel selon la criticité.
 */
type AlertVariant = 'rose' | 'amber' | 'sky' | 'emerald' | 'violet' | 'slate'

const props = withDefaults(
  defineProps<{
    /** Route name ou path à ouvrir au clic. `null` désactive la navigation. */
    to?: string | null
    variant?: AlertVariant
    /** Libellé court affiché en tête (peut être remplacé par le slot `default`). */
    label?: string
    /** Affiche un chevron décoratif à droite (toggle pour cards full-content). */
    showChevron?: boolean
  }>(),
  { variant: 'rose', to: null, label: '', showChevron: false },
)

const router = useRouter()

const variantClasses = computed(() => {
  switch (props.variant) {
    case 'rose':
      return {
        iconWrap: 'bg-rose-50 text-rose-600',
        cta: 'text-rose-700 hover:text-rose-800',
      }
    case 'amber':
      return {
        iconWrap: 'bg-amber-50 text-amber-600',
        cta: 'text-amber-700 hover:text-amber-800',
      }
    case 'sky':
      return {
        iconWrap: 'bg-sky-50 text-sky-600',
        cta: 'text-sky-700 hover:text-sky-800',
      }
    case 'emerald':
      return {
        iconWrap: 'bg-emerald-50 text-emerald-600',
        cta: 'text-emerald-700 hover:text-emerald-800',
      }
    case 'violet':
      return {
        iconWrap: 'bg-violet-50 text-violet-600',
        cta: 'text-violet-700 hover:text-violet-800',
      }
    case 'slate':
    default:
      return {
        iconWrap: 'bg-surface-100 text-surface-600',
        cta: 'text-surface-700 hover:text-surface-900',
      }
  }
})

function open(): void {
  if (props.to) {
    void router.push(props.to)
  }
}
</script>

<template>
  <component
    :is="to ? 'button' : 'div'"
    :type="to ? 'button' : undefined"
    class="card p-4 text-left w-full flex flex-col gap-3 transition-shadow group"
    :class="to ? 'cursor-pointer hover:shadow-card hover:border-surface-300' : ''"
    @click="open"
  >
    <!-- Header row : icon + label (+ optional chevron) -->
    <div class="flex items-center gap-2 text-[12px] text-surface-500">
      <span
        v-if="$slots.icon"
        class="w-7 h-7 rounded-md2 inline-flex items-center justify-center shrink-0"
        :class="variantClasses.iconWrap"
      >
        <slot name="icon" />
      </span>
      <span class="truncate font-medium">
        <slot>{{ label }}</slot>
      </span>
      <ChevronRight
        v-if="showChevron && to"
        :size="14"
        :stroke-width="2"
        class="ml-auto text-surface-300 shrink-0 group-hover:text-surface-500 transition-colors"
      />
    </div>

    <!-- Metric row : big number + optional secondary chip. -->
    <div
      v-if="$slots.metric"
      class="flex items-baseline gap-2"
    >
      <slot name="metric" />
    </div>

    <!-- Content : mini-list, mini-bar, sub-stats… -->
    <div
      v-if="$slots.content"
      class="text-[12px]"
    >
      <slot name="content" />
    </div>

    <!-- Inline actions row (Refuser / Accepter…). Use @click.stop in slot. -->
    <div
      v-if="$slots.actions"
      class="flex gap-2 mt-auto"
    >
      <slot name="actions" />
    </div>

    <!-- CTA link — only rendered if `to` is set and slot `#cta` is provided. -->
    <a
      v-if="to && $slots.cta"
      class="inline-flex items-center gap-1 text-[12px] font-medium mt-auto self-start"
      :class="variantClasses.cta"
    >
      <slot name="cta" />
      <ArrowRight
        :size="13"
        :stroke-width="2"
      />
    </a>
  </component>
</template>
