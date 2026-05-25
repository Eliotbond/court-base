import type { AppRole } from '@/types/roles'

/**
 * Allowlist deny-by-default des routes par rôle.
 *
 * Convention : toute route nommée doit apparaître **explicitement** dans au
 * moins un rôle pour être atteignable. Un user multi-rôle voit l'union de ses
 * routes autorisées. Le claim `rootAdmin` bypass cette table (cf.
 * `router/index.ts` → guard).
 *
 * Routes "neutres" (sign-in, profile, blocker membre inactif, 404) ne sont
 * pas listées ici — elles sont matchées avant le guard par leur `meta`.
 *
 * Aligné sur `docs/courtbase-app.md` § "Shell restreint — allowlist par rôle"
 * + le brief design `docs/design-brief-courtbase-app.md`.
 */
/**
 * **Alpha 2026-05-25** : la section admin et la page notifications sont
 * désactivées en attendant les phases ultérieures (broadcast / staffing /
 * FCM web push). On garde le type `AppRole` complet et l'entrée `admin`
 * dans la map (tableau vide) pour ne pas casser les call-sites côté UI
 * (`auth.isAdmin`, `useShellNav`, etc.). Conséquence : toutes les routes
 * admin et la route `notifications` retombent sur le fallback `home` via
 * le guard router (cf. `router/index.ts`).
 */
export const ALLOW: Record<AppRole, ReadonlyArray<string>> = {
  coach: [
    'home',
    'team',
    'team-roster',
    'member',
    'member-edit',
    'member-new',
    'planning',
    'agenda',
    'my-calendar',
    'training-attendance',
    'away-match-create',
    'registrations',
    'registration-detail',
    'match-request-create',
    'license-reviews',
    'license-request-review',
    'profile-settings',
  ],
  official: [
    'home',
    'matches-open',
    'my-assignments',
    'match-detail',
    'my-calendar',
    'profile-settings',
  ],
  admin: [],
  player: [
    'home',
    'agenda',
    'my-calendar',
    'profile-settings',
  ],
} as const

/** Vrai si l'un des rôles du caller autorise la route nommée. */
export function isAllowed(routeName: string, roles: ReadonlyArray<AppRole>): boolean {
  return roles.some((role) => ALLOW[role].includes(routeName))
}
