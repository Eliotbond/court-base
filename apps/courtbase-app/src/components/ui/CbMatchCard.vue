<script setup lang="ts">
import { MapPin } from 'lucide-vue-next'
import CbPill from './CbPill.vue'
import CbMatchTypeChip from './CbMatchTypeChip.vue'

/**
 * S6 — Match card. Affiche un match (home ou away) avec staffing officiels
 * et avatars des officiels déjà inscrits.
 *
 * `staffing.complete === true` ⇒ pill verte "Complet". Sinon pill ambre
 * "À pourvoir X/Y".
 *
 * Émet un event `click` quand la card est tappée — préférable à la
 * propagation DOM via `@click` sur le root (pas typé).
 */
defineProps<{
  /** Texte de date formaté ex: "Sa 18 oct." (pas un Date object — l'app
   * forme la chaîne côté composable pour rester FR + i18n-friendly). */
  date: string
  time: string
  type: string
  opponent: string
  venue: string
  /** Préfixe "→" devant l'opponent pour signaler un match à l'extérieur. */
  away?: boolean
  staffing?: { filled: number; total: number; complete?: boolean }
  /** Initiales (2 lettres) des officiels déjà inscrits, max 4 affichés. */
  officials?: ReadonlyArray<string>
}>()

defineEmits<{ click: [] }>()
</script>

<template>
  <div class="cb-match" role="button" tabindex="0" @click="$emit('click')" @keydown.enter.prevent="$emit('click')" @keydown.space.prevent="$emit('click')">
    <div class="top">
      <div>
        <div class="date">{{ date }}<span class="time">{{ time }}</span></div>
        <div class="vs" style="margin-top: 4px">{{ away ? '→ ' : '' }}{{ opponent }}</div>
      </div>
      <CbMatchTypeChip :type="type" />
    </div>
    <div class="venue">
      <MapPin :size="14" />
      <span>{{ venue }}</span>
    </div>
    <div class="footer">
      <div class="officials">
        <span
          v-for="(o, i) in officials ?? []"
          :key="i"
          class="cb-avatar xs"
        >{{ o }}</span>
      </div>
      <CbPill
        v-if="staffing"
        :tone="staffing.complete ? 'emerald' : 'amber'"
        dot
      >
        {{ staffing.complete ? 'Complet' : `À pourvoir ${staffing.filled}/${staffing.total}` }}
      </CbPill>
    </div>
  </div>
</template>
