import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { FirebaseError } from 'firebase/app'

import { getClubConfig } from '@/repositories/club.repo'
import { getActiveSeason } from '@/repositories/seasons.repo'

/**
 * Store Club — source unique pour le branding du shell (nom, shortCode,
 * logo, saison courante).
 *
 * Singleton chargé une fois au démarrage (cf. `App.vue` → `load()` après
 * que l'auth résout). Pas de reload périodique : ces données changent
 * rarement et l'utilisateur peut rafraîchir la PWA si besoin.
 *
 * Pattern hybride côté courtbase-app : le store tente d'abord Firestore, et
 * tombe sur des valeurs par défaut si la lecture échoue ou si le doc est
 * absent (projet vierge). Conséquence : le shell affiche toujours quelque
 * chose, jamais d'écran vide pendant le boot.
 *
 * Catch enrichi : log `[stores/club]` + code FirebaseError, mais pas de
 * remontée d'erreur à la vue — le shell ne doit pas casser parce que la
 * lecture Firestore a planté.
 */
export const useClubStore = defineStore('club', () => {
  // ─── State ────────────────────────────────────────────────────
  const name = ref<string | null>(null)
  const shortCode = ref<string | null>(null)
  const logoUrl = ref<string | null>(null)
  const seasonName = ref<string | null>(null)
  const seasonId = ref<string | null>(null)
  const loaded = ref(false)
  const loading = ref(false)

  // ─── Actions ──────────────────────────────────────────────────

  /**
   * Charge `/config/club` + saison active en parallèle. Idempotent : un appel
   * pendant qu'un autre est en cours est ignoré (`loading` guard). Force-reload
   * possible avec `force: true`.
   */
  async function load(force = false): Promise<void> {
    if (loading.value) return
    if (loaded.value && !force) return
    loading.value = true
    try {
      const [config, season] = await Promise.all([
        getClubConfig(),
        getActiveSeason(),
      ])
      if (config) {
        name.value = config.name
        shortCode.value = config.shortCode
        logoUrl.value = config.logo
      }
      if (season) {
        seasonId.value = season.id
        seasonName.value = season.name
      }
      loaded.value = true
    } catch (err) {
      // Les repos dégradent permission-denied / doc absent en null. Tout ce
      // qui arrive ici est inattendu — log et on continue avec ce qu'on a
      // (le shell tombera sur ses fallbacks).
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`[stores/club] load failed [${code}]`, err)
    } finally {
      loading.value = false
    }
  }

  // ─── Getters ──────────────────────────────────────────────────

  /**
   * Initiales 2-3 chars dérivées du shortCode si dispo, sinon des mots du
   * nom (ex. "BC Lausanne-Sud" → "BCL"). Fallback `"CB"` (Courtbase) si
   * ni name ni shortCode chargés — évite un cercle vide dans le shell.
   */
  const initials = computed<string>(() => {
    const code = shortCode.value?.trim()
    if (code) return code.slice(0, 3).toUpperCase()
    const n = name.value?.trim()
    if (n) {
      const parts = n.split(/\s+/).filter(Boolean)
      if (parts.length === 1) {
        const single = parts[0]
        if (single) return single.slice(0, 3).toUpperCase()
      }
      const joined = parts
        .map((p) => p[0] ?? '')
        .filter(Boolean)
        .join('')
        .slice(0, 3)
        .toUpperCase()
      if (joined) return joined
    }
    return 'CB'
  })

  /**
   * Label affiché sous le nom du club dans la sidebar desktop (ex.
   * "Saison 2025-26"). `null` tant que la saison active n'est pas chargée
   * — la sidebar affichera une chaîne vide.
   */
  const seasonLabel = computed<string | null>(() => {
    if (!seasonName.value) return null
    const trimmed = seasonName.value.trim()
    if (!trimmed) return null
    return /^saison/i.test(trimmed) ? trimmed : `Saison ${trimmed}`
  })

  return {
    // State
    name,
    shortCode,
    logoUrl,
    seasonName,
    seasonId,
    loaded,
    loading,
    // Getters
    initials,
    seasonLabel,
    // Actions
    load,
  }
})
