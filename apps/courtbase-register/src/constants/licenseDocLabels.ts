import type { LicenseDocKind, Timestamp } from '@club-app/shared-types'

/**
 * Libellés FR `LicenseDocKind` → label utilisateur. Aligné sur ceux exposés
 * par `apps/courtbase-app` (`CbLicenseRequestDialog.vue`) pour que parent et
 * coach voient les mêmes noms de pièces.
 */
export const LICENSE_DOC_LABELS: Record<LicenseDocKind, string> = {
  id_front: "Carte d'identité (recto)",
  id_back: "Carte d'identité (verso)",
  avs: 'Numéro AVS',
  transfer_letter_swiss: 'Lettre de sortie du club précédent',
}

export function licenseDocLabel(kind: LicenseDocKind): string {
  return LICENSE_DOC_LABELS[kind]
}

const REVIEW_DATE_FMT = new Intl.DateTimeFormat('fr-CH', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
})

/**
 * Formate un Timestamp Firestore en `lundi 24 mai à 14:32`. Retourne `null`
 * si le timestamp est absent ou non résolu (`seconds === 0`, cas
 * `serverTimestamp()` pending côté client).
 */
export function formatReviewAt(at: Timestamp | null | undefined): string | null {
  if (!at?.seconds) return null
  return REVIEW_DATE_FMT.format(new Date(at.seconds * 1000))
}
