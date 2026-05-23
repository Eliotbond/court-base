import { computed, onMounted, onUnmounted, ref } from 'vue'

/**
 * Composable viewport — détection mobile vs desktop, réactive au resize.
 *
 * Convention : breakpoint **1024px** pour basculer sur le shell desktop
 * (sidebar 240px). En-dessous, on garde le shell mobile (header + tab bar).
 *
 * À utiliser dans toute vue qui doit rendre deux shells différents
 * conditionnellement (`v-if="isDesktop"`).
 */
const DESKTOP_BREAKPOINT = 1024

export function useViewport() {
  const width = ref(typeof window !== 'undefined' ? window.innerWidth : 1280)

  function update(): void {
    width.value = window.innerWidth
  }

  onMounted(() => window.addEventListener('resize', update, { passive: true }))
  onUnmounted(() => window.removeEventListener('resize', update))

  const isDesktop = computed(() => width.value >= DESKTOP_BREAKPOINT)
  const isMobile = computed(() => !isDesktop.value)

  return { isDesktop, isMobile, width }
}
