/**
 * Composable — résolution + cache de la saison active.
 *
 * Lecture unique pour toute la session via `seasons.repo.ts` (qui implémente
 * la query canonique `/seasons where status == 'active' limit 1` — cf.
 * `packages/shared-types/src/season.ts`, `SeasonStatus = 'draft' | 'active'
 * | 'archived'`). Le résultat est consommé par plusieurs stores
 * (licenseRequests pour l'ID déterministe `lr-{memberId}-{seasonId}`, à
 * venir : dues pour la saison courante, etc.). On évite ainsi :
 *
 *  - un store Pinia complet pour un seul champ (overkill) ;
 *  - une refetch à chaque montage de composant (le coach navigue plusieurs
 *    vues qui ont chacune besoin de la saison) ;
 *  - une dépendance à l'ordre d'init : tout consommateur peut appeler
 *    `useActiveSeason().load()` ; les appels concurrents partagent le même
 *    promise `inFlight` (anti-dogpile).
 *
 * **Cache module-level** (pas par-instance Pinia) — volontaire : tous les
 * composants du même process partagent le résultat. Si la saison change
 * pendant une session, le user devra recharger l'app (rare + acceptable).
 * `reset()` est exposé pour les tests / un futur switcher de saison admin.
 *
 * Historique du bug `2026-05-23` : la version initiale dupliquait la query
 * en lisant `where('active', '==', true)` (champ inexistant côté schéma
 * canonique) → toujours `null` → "Aucune saison active configurée" au
 * déclenchement d'une demande de licence. Fix : déléguer à `getActiveSeason`
 * (single source of truth).
 */

import { ref } from 'vue'

import { getActiveSeason } from '@/repositories/seasons.repo'

// ─── Cache module-level (partagé entre toutes les invocations) ────────
let cached: string | null = null
let inFlight: Promise<string | null> | null = null

export function useActiveSeason() {
  const seasonId = ref<string | null>(cached)
  const loading = ref(false)
  const error = ref<string | null>(null)

  /**
   * Résout la saison active via `seasons.repo.getActiveSeason()`. Re-utilise
   * le cache module-level si déjà fetché ; partage le promise `inFlight` si
   * une autre instance est en train de fetch (anti-dogpile sur le premier
   * appel concurrent).
   *
   * Retour : l'id résolu ou `null` si pas de saison active déclarée /
   * erreur Firestore (loguée). Le caller décide quoi faire (toast UX +
   * abort, vs fallback silent).
   */
  async function load(): Promise<string | null> {
    if (cached) {
      seasonId.value = cached
      return cached
    }
    if (inFlight) return inFlight

    loading.value = true
    error.value = null
    inFlight = (async () => {
      try {
        const season = await getActiveSeason()
        if (!season) return null
        cached = season.id
        seasonId.value = season.id
        return season.id
      } catch (err) {
        const code =
          err && typeof err === 'object' && 'code' in err
            ? String((err as { code: unknown }).code)
            : 'unknown'
        console.error(`[useActiveSeason] load failed [${code}]`, err)
        error.value = code
        return null
      } finally {
        loading.value = false
        inFlight = null
      }
    })()
    return inFlight
  }

  /**
   * Réinitialise le cache module-level. Sert aux tests + à un futur switcher
   * de saison côté admin. Pas appelé par le flow normal.
   */
  function reset(): void {
    cached = null
    seasonId.value = null
    error.value = null
  }

  return { seasonId, loading, error, load, reset }
}
