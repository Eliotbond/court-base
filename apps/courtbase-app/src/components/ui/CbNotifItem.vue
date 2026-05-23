<script setup lang="ts">
import { computed } from 'vue'
import { AlertTriangle, Bell, Calendar, CheckCircle2, Info } from 'lucide-vue-next'
// `Whistle` n'existe pas dans toutes les versions de lucide ; on fallback sur
// `BellRing` qui couvre sémantiquement "officials needed".
import { BellRing } from 'lucide-vue-next'

/**
 * S10 — Notif item. Type → icône + couleur dérivés. Click = deep-link
 * géré par le parent (`<RouterLink>` autour ou émission d'event).
 */
type NotifType = 'match' | 'urgent' | 'officials_needed' | 'bell' | 'info' | 'check'

const props = defineProps<{
  type: NotifType
  title: string
  extract?: string
  time?: string
  unread?: boolean
}>()

const ICONS = {
  match: { comp: Calendar, tone: 'violet' },
  urgent: { comp: AlertTriangle, tone: 'rose' },
  officials_needed: { comp: BellRing, tone: 'amber' },
  bell: { comp: Bell, tone: 'sky' },
  info: { comp: Info, tone: 'sky' },
  check: { comp: CheckCircle2, tone: 'emerald' },
} as const

const meta = computed(() => ICONS[props.type] ?? ICONS.bell)
</script>

<template>
  <div class="cb-notif" :class="{ unread }">
    <div
      class="icon"
      :style="`background: var(--${meta.tone}-100); color: var(--${meta.tone}-700);`"
    >
      <component :is="meta.comp" :size="18" />
    </div>
    <div class="body">
      <div class="title">{{ title }}</div>
      <div v-if="extract" class="extract">{{ extract }}</div>
      <div v-if="time" class="time">{{ time }}</div>
    </div>
  </div>
</template>
