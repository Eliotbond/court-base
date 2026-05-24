/**
 * Bucket sémantique pour l'UI coach — sépare clairement :
 *
 *   - "Demandes d'inscription" : le coach doit décider (démarrer l'essai
 *     ou refuser). Statuts : `submitted`, `open_pending_trial`,
 *     `conditional_pending_review`, `conditional_pending_trial`.
 *
 *   - "Essai en cours" : le coach évalue le joueur pendant 14 jours.
 *     Statut unique : `trial_in_progress`.
 *
 *   - "Confirmées" : intégration validée, attente paiement OU active.
 *     Statuts : `confirmed_pending_dues`, `active`.
 *
 *   - "Terminales" : refusées ou annulées. Statuts : `refused`, `cancelled`.
 *
 * Cf. `docs/registrations/coach-app-screens.md` et `docs/registrations/lifecycle.md`.
 */

import type { RegistrationBucket, RegistrationStatus } from '@/types/mock'

export function bucketFor(status: RegistrationStatus): RegistrationBucket {
  switch (status) {
    case 'submitted':
    case 'open_pending_trial':
    case 'conditional_pending_review':
    case 'conditional_pending_trial':
      return 'demande'
    case 'trial_in_progress':
      return 'essai'
    case 'confirmed_pending_dues':
    case 'active':
      return 'confirmed'
    case 'refused':
    case 'cancelled':
      return 'terminal'
  }
}

/** Vrai si le coach peut démarrer l'essai depuis ce status. */
export function canMarkTrial(status: RegistrationStatus): boolean {
  return (
    status === 'submitted' ||
    status === 'open_pending_trial' ||
    status === 'conditional_pending_review' ||
    status === 'conditional_pending_trial'
  )
}

/** Vrai si le coach peut confirmer l'intégration depuis ce status. */
export function canConfirm(status: RegistrationStatus): boolean {
  return status === 'trial_in_progress'
}

/** Vrai si le coach peut refuser depuis ce status (any non-terminal). */
export function canRefuse(status: RegistrationStatus): boolean {
  return (
    status !== 'refused' &&
    status !== 'cancelled' &&
    status !== 'active' &&
    status !== 'confirmed_pending_dues'
  )
}

/** Libellés FR pour les 4 buckets — alignés sur le brief CO8. */
export const BUCKET_LABELS: Record<RegistrationBucket, string> = {
  demande: 'Demandes',
  essai: 'Essais en cours',
  confirmed: 'Confirmées',
  terminal: 'Terminales',
}
