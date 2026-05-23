/**
 * Rôles auth utilisés par l'app companion. Sous-ensemble de l'énum canonique
 * `UserRole` de `packages/shared-types` (cf. `docs/main.md`). On ne liste que
 * les rôles **pertinents pour cette app** — un `parent` reste sur
 * `courtbase-register`, un `treasurer` sur `apps/web`.
 *
 * Note : le claim `rootAdmin` (Auth custom claim) bypass l'allowlist côté UI
 * via un short-circuit dans le router guard. Cf. `router/allowlist.ts`.
 */
export type AppRole = 'admin' | 'coach' | 'official'

/** Tab cible par défaut quand un user signed-in atterrit sur `/`. */
export type HomeTab = 'coach' | 'official' | 'admin'

/**
 * Priorité du tab par défaut quand un user porte plusieurs rôles. Coach
 * d'abord (volume d'usage attendu le plus important), puis officiel, puis
 * admin (mobilité ponctuelle uniquement).
 */
export const ROLE_TAB_PRIORITY: readonly AppRole[] = ['coach', 'official', 'admin'] as const
