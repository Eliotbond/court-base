<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Construction } from 'lucide-vue-next'

const route = useRoute()

const title = computed(() => {
  const meta = route.meta as { title?: string }
  return meta.title ?? 'Écran'
})

const subtitle = computed(() => {
  const meta = route.meta as { subtitle?: string }
  return meta.subtitle ?? null
})
</script>

<template>
  <section class="p-6 space-y-6">
    <div>
      <h1 class="text-[22px] font-semibold tracking-tight">
        {{ title }}
      </h1>
      <p
        v-if="subtitle"
        class="text-[13px] text-surface-500 mt-0.5"
      >
        {{ subtitle }}
      </p>
    </div>

    <div
      class="card p-12 flex flex-col items-center justify-center text-center gap-3 text-surface-500"
    >
      <Construction
        :size="32"
        :stroke-width="1.75"
        class="text-surface-400"
      />
      <div>
        <div class="text-[14px] font-medium text-surface-700">
          Écran en cours d'implémentation
        </div>
        <div class="text-[12px] mt-1">
          Design system et shell en place. Cet écran sera implémenté dans une PR dédiée.
        </div>
      </div>
    </div>
  </section>
</template>
