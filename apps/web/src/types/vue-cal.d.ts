/**
 * Shim de typage minimal pour `vue-cal` v4 — la lib est pure JS, pas de `.d.ts`
 * bundlé. On déclare uniquement ce que `Bookings.vue` consomme (props +
 * structures d'events / splits).
 *
 * Si on étend l'usage (drag-and-drop, formats supplémentaires…), enrichir ici
 * plutôt que de répandre des `// any:` à travers le code.
 */
declare module 'vue-cal' {
  import type { DefineComponent } from 'vue'

  export interface VueCalSplit {
    id: string | number
    label?: string
    class?: string
    hide?: boolean
  }

  export interface VueCalEvent {
    /** `YYYY-MM-DD HH:MM` ou `Date`. Inclusif. */
    start: string | Date
    /** `YYYY-MM-DD HH:MM` ou `Date`. Exclusif. */
    end: string | Date
    title?: string
    content?: string
    class?: string
    /** Id d'un split déclaré dans `splitDays`. */
    split?: string | number
    allDay?: boolean
    background?: boolean
    /** Données arbitraires propagées (lues dans `event-click`). */
    [key: string]: unknown
  }

  const VueCal: DefineComponent<
    Record<string, unknown>,
    Record<string, unknown>,
    unknown
  >
  export default VueCal
}

declare module 'vue-cal/dist/vuecal.css'
