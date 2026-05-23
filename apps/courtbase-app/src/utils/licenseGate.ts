/**
 * Helpers purs autour du "gate cotisation" qui conditionne la demande de
 * licence fédérale pour un joueur.
 *
 * Règle métier (cf. `docs/main.md` + brief workflow Plan A) :
 *   - On ne peut demander une licence que si le joueur a réglé sa cotisation
 *     (`paid`), bénéficie d'un sursis officiel (`pending_grace`) ou d'une
 *     exception formellement validée par l'admin (`excepted`).
 *   - Un joueur **déjà licencié** (`licenseNumber` non null) ne peut pas
 *     faire l'objet d'une nouvelle demande — c'est un retrait qui est
 *     proposé à la place côté UI.
 *
 * **Pure functions, testables sans Vue** — pas d'import store / Firebase.
 */

import type { DuesStatus, MockMember } from '@/types/mock'

/** Statuts cotisation qui débloquent la demande de licence. */
const ALLOWED: readonly DuesStatus[] = ['paid', 'pending_grace', 'excepted'] as const

/**
 * `true` si le coach peut soumettre une demande de licence pour ce joueur.
 *
 * @param m — projection minimale d'un member (suffit pour testabilité).
 */
export function canRequestLicense(
  m: Pick<MockMember, 'duesStatus' | 'licenseNumber'>,
): boolean {
  if (m.licenseNumber) return false
  return ALLOWED.includes(m.duesStatus)
}

/**
 * Message FR à afficher sous le CTA quand `canRequestLicense` est `false`.
 * Retourne `null` si l'action est autorisée OU si le joueur est déjà licencié
 * (cas où l'UI propose un retrait à la place, pas un message d'erreur).
 */
export function licenseGateReason(
  m: Pick<MockMember, 'duesStatus' | 'licenseNumber'>,
): string | null {
  if (canRequestLicense(m) || m.licenseNumber) return null
  if (m.duesStatus === 'excluded') {
    return "Cotisation impayée — demandez d'abord une exception depuis la fiche joueur."
  }
  return "Cotisation non payée. Le joueur doit régler sa cotisation (ou son arrangement de paiement) avant la demande de licence."
}
