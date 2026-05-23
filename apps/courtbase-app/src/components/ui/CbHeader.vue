<script setup lang="ts">
import { ArrowLeft, Bell, MoreVertical } from 'lucide-vue-next'

/**
 * S1 (partie header) — Header sticky 56px. Logo club à gauche par défaut
 * (ou flèche retour si `showBack`), titre au centre, cloche + menu kebab
 * à droite.
 */
defineProps<{
  title: string
  /** Initiales 2-3 chars du club (ex. "BCA"). */
  club?: string
  showBack?: boolean
  /** Affiche un point rose sur la cloche (notifs non lues). */
  notifBadge?: boolean
}>()

defineEmits<{
  back: []
  notifClick: []
  moreClick: []
}>()
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
      <div v-else class="cb-logo">{{ club ?? 'CB' }}</div>
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
        <span v-if="notifBadge" class="dot" />
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
