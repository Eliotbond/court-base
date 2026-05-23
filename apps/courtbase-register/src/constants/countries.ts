/**
 * Liste des pays acceptés dans l'app register.
 *
 * Source partagée pour éviter la duplication entre `Account.vue`,
 * `ProfileSetup.vue` et `LicenseRequestForm.vue`. Codes ISO 3166-1 alpha-2,
 * libellés en français.
 *
 * Si le pays cherché n'est pas dans la liste, on retombe sur `'OTHER'`. Pour
 * étendre la liste, ajouter une ligne et synchroniser les `select` qui
 * dépendent encore d'une copie locale (à dé-dupliquer progressivement).
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
