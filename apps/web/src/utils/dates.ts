/**
 * Helpers de formatage de dates — locale FR-CH, format canonique DD/MM/YYYY.
 *
 * Pourquoi un helper central : la page Bookings (table + calendrier +
 * dialogs) doit afficher toutes les dates de manière cohérente
 * (`DD/MM/YYYY`). Avant ce fichier, chaque composant déclarait son propre
 * `Intl.DateTimeFormat` avec des variations subtiles (`day: 'numeric'` vs
 * `'2-digit'`, mois en abrégé vs numéro…). Cet helper normalise tout sur
 * `DD/MM/YYYY` strict (deux chiffres jour, deux chiffres mois, quatre
 * chiffres année).
 *
 * Accepte indifféremment :
 *  - une `Date` JS
 *  - un Timestamp Firestore (avec `.toDate()`)
 *  - un Timestamp neutre `shared-types` (avec uniquement `.seconds`)
 *  - `null | undefined` → renvoie `''` (utile pour les templates)
 *
 * NB : on garde aussi des formats long (weekday + mois écrit en toutes
 * lettres) pour les UIs où l'humain doit lire vite (drawers, headers de
 * toolbar). Ces formats restent `fr-CH` mais ne suivent pas la convention
 * DD/MM/YYYY — `formatDateShort` est la fonction par défaut.
 */

/** Représentation minimale d'un Timestamp acceptée. */
export type DateLike =
  | Date
  | { seconds: number; toDate?: () => Date }
  | null
  | undefined

const shortFormatter = new Intl.DateTimeFormat('fr-CH', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const dateTimeFormatter = new Intl.DateTimeFormat('fr-CH', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const longFormatter = new Intl.DateTimeFormat('fr-CH', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

/**
 * Convertit un `DateLike` en `Date` JS — `null` si entrée nulle.
 * Le Timestamp neutre exporté par `shared-types` n'expose pas `.toDate()` ;
 * on lit `seconds` (présent partout côté Firestore SDK aussi).
 */
export function toDate(value: DateLike): Date | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value
  if (typeof value.toDate === 'function') return value.toDate()
  return new Date(value.seconds * 1000)
}

/** Renvoie `DD/MM/YYYY` (FR-CH). `''` si entrée nulle. */
export function formatDateShort(value: DateLike): string {
  const d = toDate(value)
  if (!d) return ''
  return shortFormatter.format(d)
}

/** Renvoie `DD/MM/YYYY HH:MM` (FR-CH). `''` si entrée nulle. */
export function formatDateTime(value: DateLike): string {
  const d = toDate(value)
  if (!d) return ''
  return dateTimeFormatter.format(d)
}

/**
 * Renvoie un format long lisible (ex. "Lundi 25 mai 2026") — première
 * lettre capitalisée. Utilisé sur les titres / drawers où l'humain doit
 * lire la date en un coup d'œil. Pour l'affichage tabulaire ou compact,
 * préférer `formatDateShort`.
 */
export function formatDateLong(value: DateLike): string {
  const d = toDate(value)
  if (!d) return ''
  const raw = longFormatter.format(d)
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}
