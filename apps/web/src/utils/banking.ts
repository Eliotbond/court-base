/**
 * Validation + normalisation des coordonnées bancaires saisies par l'admin
 * dans Settings → Club info → Infos bancaires.
 *
 * Objectifs :
 *  - Empêcher la persistance d'un IBAN/BIC syntaxiquement faux dans
 *    `/config/club.banking` (sinon les emails de demande de paiement
 *    afficheraient des références illisibles côté joueurs).
 *  - Normaliser la forme stockée (uppercase + sans espaces) pour avoir une
 *    forme canonique en base : c'est la consumer-side (`PaymentInstructions.vue`
 *    register, templates email) qui reformate à l'affichage.
 *
 * NB : pas de logique Firebase ici — utilitaires purs, testables en isolation.
 */

/** Longueurs IBAN par code pays ISO 3166-1 (alpha-2). */
const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22,
  BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DK: 18, DO: 28,
  EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23,
  GL: 18, GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26,
  IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20,
  LV: 21, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18,
  NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, SA: 24,
  SE: 24, SI: 19, SK: 24, SM: 27, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26,
  UA: 29, VG: 24, XK: 20,
}

/**
 * Forme canonique d'un IBAN : uppercase, sans espaces ni tiret. À utiliser
 * **avant** persistance et **avant** validation.
 */
export function normalizeIban(raw: string): string {
  return raw.replace(/[\s-]+/g, '').toUpperCase()
}

/**
 * Forme canonique d'un BIC/SWIFT : uppercase, sans espaces.
 */
export function normalizeBic(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase()
}

/**
 * Affichage d'un IBAN canonique en groupes de 4 : `CH9300762011623852957`
 * → `CH93 0076 2011 6238 5295 7`. Utiliser uniquement pour l'affichage —
 * le storage et la validation se font sur la forme canonique.
 */
export function formatIbanForDisplay(iban: string): string {
  const c = normalizeIban(iban)
  return c.replace(/(.{4})/g, '$1 ').trim()
}

/**
 * ISO 7064 mod-97-10. L'IBAN canonique est valide si on déplace les 4 premiers
 * caractères (pays + check digits) à la fin, remplace chaque lettre par sa
 * position dans l'alphabet (A=10, B=11, …, Z=35), puis prend modulo 97 ; le
 * résultat doit être 1.
 */
function ibanMod97(canonical: string): number {
  const rearranged = canonical.slice(4) + canonical.slice(0, 4)
  // Replace letters with numeric equivalent (A=10, …, Z=35).
  let expanded = ''
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0)
    if (code >= 48 && code <= 57) {
      expanded += ch
    } else if (code >= 65 && code <= 90) {
      expanded += String(code - 55)
    } else {
      return -1
    }
  }
  // Process in chunks of 9 digits to stay in JS safe integer range.
  let remainder = 0
  for (let i = 0; i < expanded.length; i += 7) {
    const chunk = String(remainder) + expanded.slice(i, i + 7)
    remainder = Number(chunk) % 97
  }
  return remainder
}

/**
 * Valide un IBAN. Retourne `null` si OK, sinon un message d'erreur en français
 * adapté à l'affichage sous le champ.
 *
 * Règles :
 *  - 15 à 34 caractères alphanumériques après normalisation.
 *  - Commence par un code pays connu (table `IBAN_LENGTHS`).
 *  - Longueur exacte attendue pour ce pays.
 *  - Mod-97-10 = 1.
 */
export function validateIban(raw: string): string | null {
  const c = normalizeIban(raw)
  if (c.length === 0) return 'IBAN requis'
  if (!/^[A-Z0-9]+$/.test(c)) {
    return 'Caractères invalides (lettres et chiffres uniquement)'
  }
  if (c.length < 15 || c.length > 34) {
    return 'Longueur invalide (15 à 34 caractères)'
  }
  const country = c.slice(0, 2)
  if (!/^[A-Z]{2}$/.test(country)) {
    return 'Doit commencer par un code pays (2 lettres, ex. CH, FR, DE)'
  }
  const expectedLength = IBAN_LENGTHS[country]
  if (expectedLength === undefined) {
    return `Code pays "${country}" non reconnu`
  }
  if (c.length !== expectedLength) {
    return `IBAN ${country} doit faire ${expectedLength} caractères (actuel : ${c.length})`
  }
  if (ibanMod97(c) !== 1) {
    return 'Clé de contrôle invalide (vérifiez la saisie)'
  }
  return null
}

/**
 * Valide un BIC/SWIFT. Retourne `null` si OK, sinon un message d'erreur.
 *
 * Format ISO 9362 : 8 ou 11 caractères, `AAAA BB CC [DDD]` :
 *  - AAAA : code banque (4 lettres)
 *  - BB   : code pays (2 lettres)
 *  - CC   : code emplacement (2 alphanumériques)
 *  - DDD  : code branche optionnel (3 alphanumériques)
 */
export function validateBic(raw: string): string | null {
  const c = normalizeBic(raw)
  if (c.length === 0) return null // BIC optionnel
  if (c.length !== 8 && c.length !== 11) {
    return 'BIC doit faire 8 ou 11 caractères'
  }
  if (!/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(c)) {
    return 'Format BIC invalide (ex. UBSWCHZH80A)'
  }
  return null
}

/** Limites de longueur (anti-paste accidentel + cohérence DB). */
export const BANKING_FIELD_LIMITS = {
  bankName: 100,
  accountHolder: 140,
  paymentInstructions: 500,
} as const
