<script setup lang="ts">
import { computed } from 'vue'
import { ArrowLeft, Bell, MoreVertical } from 'lucide-vue-next'
import { useClubStore } from '@/stores/club'

/**
 * S1 (partie header) — Header sticky 56px. Logo club à gauche par défaut
 * (ou flèche retour si `showBack`), titre au centre, cloche + menu kebab
 * à droite.
 *
 * Branding : lit `useClubStore` (hydraté par `App.vue`). La prop `club` n'est
 * gardée que comme fallback pour les valeurs hardcodées des vues existantes.
 */
const props = defineProps<{
  title: string
  /** Initiales 2-3 chars du club (ex. "BCA"). Fallback si store pas chargé. */
  club?: string
  showBack?: boolean
  /**
   * Badge non-lues affiché sur la cloche.
   * - `number > 0` → pastille rose avec le compteur (capé à "9+" au-delà).
   * - `true` → dot rose simple (legacy — utilisé par les vues qui ne
   *   connaissent pas le count exact).
   * - `false` / `0` / `null` → cloche nue (pas de badge).
   */
  notifBadge?: boolean | number | null
}>()

defineEmits<{
  back: []
  notifClick: []
  moreClick: []
}>()

const clubStore = useClubStore()

const resolvedInitials = computed(() =>
  clubStore.loaded ? clubStore.initials : (props.club ?? 'CB'),
)
const resolvedLogoUrl = computed(() => clubStore.logoUrl)
const resolvedClubName = computed(() => clubStore.name ?? 'Club')

/**
 * Forme normalisée du badge : `{ kind: 'count', value: string }` quand on
 * a un compteur numérique > 0, `{ kind: 'dot' }` pour le legacy `true`,
 * `null` sinon. Capé à "9+" pour rester lisible (la pastille est ronde).
 */
const badge = computed<{ kind: 'count'; value: string } | { kind: 'dot' } | null>(() => {
  const b = props.notifBadge
  if (b === true) return { kind: 'dot' }
  if (typeof b === 'number' && b > 0) {
    return { kind: 'count', value: b > 9 ? '9+' : String(b) }
  }
  return null
})
</script>

<template>
  <div class="cb-header">
    <div class="left">
      <button
        v-if="showBack"
        type="button"
        class="cb-iconbtn"
        aria-label="Retour"
        @click="$emit('back')"
      >
        <ArrowLeft :size="20" />
      </button>
      <div v-else class="cb-logo">
        <img
          v-if="resolvedLogoUrl"
          :src="resolvedLogoUrl"
          :alt="`Logo ${resolvedClubName}`"
          class="cb-logo-img"
        />
        <template v-else>{{ resolvedInitials }}</template>
      </div>
    </div>
    <div class="title">{{ title }}</div>
    <div class="right">
      <button
        type="button"
        class="cb-iconbtn"
        aria-label="Notifications"
        @click="$emit('notifClick')"
      >
        <Bell :size="20" />
        <span v-if="badge?.kind === 'count'" class="count-badge">{{ badge.value }}</span>
        <span v-else-if="badge?.kind === 'dot'" class="dot" />
      </button>
      <slot name="right">
        <button
          type="button"
          class="cb-iconbtn"
          aria-label="Plus d'options"
          @click="$emit('moreClick')"
        >
          <MoreVertical :size="20" />
        </button>
      </slot>
    </div>
  </div>
</template>
