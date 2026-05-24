/**
 * Pays acceptés dans courtbase-app (côté coach pour le review de licence).
 *
 * Copie locale (et non import depuis `apps/courtbase-register/`) parce que les
 * deux apps n'ont pas le droit de partager du code de premier niveau — cf.
 * `apps/courtbase-app/CLAUDE.md` § "Ce qu'il NE FAUT PAS faire".
 *
 * Codes ISO 3166-1 alpha-2, libellés en français. Aligné sur la liste utilisée
 * par `courtbase-register/src/constants/countries.ts`. À synchroniser
 * manuellement si la liste évolue.
 */
export interface Country {
  code: string
  name: string
}

export const COUNTRIES: readonly Country[] = [
  { code: 'CH', name: 'Suisse' },
  { code: 'FR', name: 'France' },
  { code: 'DE', name: 'Allemagne' },
  { code: 'IT', name: 'Italie' },
  { code: 'AT', name: 'Autriche' },
  { code: 'BE', name: 'Belgique' },
  { code: 'LU', name: 'Luxembourg' },
  { code: 'PT', name: 'Portugal' },
  { code: 'ES', name: 'Espagne' },
  { code: 'OTHER', name: 'Autre' },
] as const

/** Renvoie le nom français d'un code pays, fallback sur le code lui-même. */
export function countryName(code: string | null | undefined): string {
  if (!code) return ''
  return COUNTRIES.find((c) => c.code === code)?.name ?? code
}
