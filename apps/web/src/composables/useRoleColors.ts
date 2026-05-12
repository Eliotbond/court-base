/**
 * Palette par défaut des rôles membres. Source de vérité v1 ; sera remplacée
 * par une config par club (`/clubs/{clubId}/roles` ou `/config/club.memberRoles`)
 * quand les rôles deviendront éditables (cf. design-brief.md).
 *
 * Couleurs tirées du mockup design (Mockups.html role pills) :
 *   player → blue-100 / blue-800
 *   coach  → red-100 / rose-800
 *   official → green-100 / green-800
 *   comite → amber-100 / amber-800
 *
 * Les rôles canoniques côté auth restent `admin | coach | official`
 * (cf. docs/firebase.md). `player`/`comite` sont des rôles métier optionnels
 * définis par le club ; on les expose ici parce que le design les utilise déjà.
 */

export type RoleId = 'admin' | 'coach' | 'official' | 'player' | 'comite' | (string & {})

interface RoleColor {
  bg: string
  fg: string
  border?: string
}

const DEFAULT_COLORS: Record<string, RoleColor> = {
  admin: { bg: '#fee2e2', fg: '#9f1239', border: '#fecaca' }, // red-100 / rose-800 — autorité
  coach: { bg: '#fee2e2', fg: '#9f1239', border: '#fecaca' },
  official: { bg: '#dcfce7', fg: '#166534', border: '#bbf7d0' }, // green-100 / green-800
  player: { bg: '#dbeafe', fg: '#1e40af', border: '#bfdbfe' }, // blue-100 / blue-800
  comite: { bg: '#fef3c7', fg: '#854d0e', border: '#fde68a' }, // amber-100 / amber-800
}

const FALLBACK: RoleColor = { bg: '#f1f5f9', fg: '#475569', border: '#e2e8f0' } // slate

export function useRoleColors() {
  function colorsFor(roleId: RoleId): RoleColor {
    return DEFAULT_COLORS[roleId] ?? FALLBACK
  }

  function labelFor(roleId: RoleId): string {
    switch (roleId) {
      case 'admin':
        return 'Admin'
      case 'coach':
        return 'Coach'
      case 'official':
        return 'Officiel'
      case 'player':
        return 'Player'
      case 'comite':
        return 'Comité'
      default:
        return roleId
    }
  }

  return { colorsFor, labelFor }
}
