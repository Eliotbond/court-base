/**
 * Rôles auth utilisés par l'app companion. Sous-ensemble de l'énum canonique
 * `UserRole` de `packages/shared-types` (cf. `docs/main.md`). On ne liste que
 * les rôles **pertinents pour cette app** — un `treasurer` reste sur
 * `apps/web` ; un `parent` reste sur `courtbase-register`.
 *
 * Note : le claim `rootAdmin` (Auth custom claim) bypass l'allowlist côté UI
 * via un short-circuit dans le router guard. Cf. `router/allowlist.ts`.
 *
 * `player` : un joueur qui consulte son agenda (matchs / entraînements de
 * ses équipes), reçoit les notifs club et édite son profil. Pas d'accès aux
 * écrans de gestion (rosters, demandes, staffing).
 */
export type AppRole = 'admin' | 'coach' | 'official' | 'player'

/** Tab cible par défaut quand un user signed-in atterrit sur `/`. */
export type HomeTab = 'coach' | 'official' | 'admin' | 'player'

/**
 * Priorité du tab par défaut quand un user porte plusieurs rôles. Coach
 * d'abord (volume d'usage attendu le plus important), puis officiel, puis
 * admin (mobilité ponctuelle uniquement), puis player en dernier (un user
 * coach+player verra par défaut son Home coach).
 */
export const ROLE_TAB_PRIORITY: readonly AppRole[] = ['coach', 'official', 'admin', 'player'] as const
