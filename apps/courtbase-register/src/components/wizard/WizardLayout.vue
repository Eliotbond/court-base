<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronLeft, X } from 'lucide-vue-next'
import Stepper from './Stepper.vue'

const props = withDefaults(
  defineProps<{
    current: number
    title: string
    /** Override la cible du bouton retour. Si non fournie, ChevronLeft → history.back() ; X (étape 1) → /home. */
    backTo?: string
    /** Force l'affichage de X (croix) au lieu de la flèche. Par défaut, X uniquement à l'étape 1. */
    closeMode?: boolean
    total?: number
  }>(),
  { total: 8, closeMode: undefined },
)

const router = useRouter()

const showClose = computed(() => {
  if (props.closeMode !== undefined) return props.closeMode
  return props.current === 1
})

function onBack() {
  if (props.backTo) {
    router.push(props.backTo)
    return
  }
  if (showClose.value) {
    router.push('/home')
    return
  }
  router.back()
}
</script>

<template>
  <div class="m-app">
    <div class="m-header">
      <button
        type="button"
        class="btn btn-ghost btn-sm wiz-back"
        :aria-label="showClose ? 'Fermer' : 'Précédent'"
        @click="onBack"
      >
        <X v-if="showClose" :size="16" />
        <ChevronLeft v-else :size="16" />
      </button>
      <div class="wiz-title">Nouvelle inscription</div>
      <div class="wiz-autosave">brouillon auto-enregistré</div>
    </div>

    <Stepper :current="current" :title="title" :total="total" />

    <div class="m-content">
      <slot />
    </div>

    <div v-if="$slots.footer" class="m-bottom">
      <slot name="footer" />
    </div>
  </div>
</template>

<style scoped>
.wiz-back {
  margin-left: -8px;
}
.wiz-title {
  font-size: 13px;
  font-weight: 500;
  color: #334155;
  margin-left: 4px;
}
.wiz-autosave {
  margin-left: auto;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: #64748b;
}
</style>
