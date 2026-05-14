import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { FirebaseError } from 'firebase/app'
import type { BankingInfo, ClubConfig } from '@club-app/shared-types'
import { loadClubConfig } from '@/repositories/club.repo'

/**
 * Store Club — singleton `/config/club` exposé en lecture seule à l'app
 * register. Fournit en particulier :
 *  - `config` : tout le doc (logo, nom, contact, etc.) — utile pour le
 *    header / footer / sign-out.
 *  - `banking` : raccourci sur `config.banking` (utilisé par l'écran
 *    `PaymentInstructions.vue`).
 *
 * Lecture one-shot : on charge à la demande puis on garde en mémoire pour la
 * durée de la session. Pas de TTL — la config club ne change pas pendant la
 * session d'un parent.
 */
export const useClubStore = defineStore('club', () => {
  const config = ref<ClubConfig | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** True dès que la première tentative de chargement a abouti (succès ou null). */
  const loaded = ref(false)

  async function load(force = false): Promise<ClubConfig | null> {
    if (loaded.value && !force) return config.value
    loading.value = true
    error.value = null
    try {
      const c = await loadClubConfig()
      config.value = c
      loaded.value = true
      return c
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`[stores/club] load failed [${code}]`, err)
      error.value = err instanceof Error ? err.message : String(err)
      return null
    } finally {
      loading.value = false
    }
  }

  const banking = computed<BankingInfo | null>(() => config.value?.banking ?? null)

  /**
   * True si l'admin a saisi au minimum un IBAN + un bénéficiaire — le
   * minimum vital pour qu'un parent puisse effectivement payer.
   */
  const hasUsableBanking = computed(() => {
    const b = banking.value
    if (!b) return false
    return Boolean(b.iban && b.accountHolder)
  })

  return {
    // State
    config,
    loading,
    error,
    loaded,
    // Computed
    banking,
    hasUsableBanking,
    // Actions
    load,
  }
})
