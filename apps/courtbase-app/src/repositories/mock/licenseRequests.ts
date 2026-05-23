/**
 * Repository mock pour les demandes de licence fédérale.
 *
 * Lit les **fixtures partagées** depuis `@club-app/shared-types/mock-fixtures`
 * (cohérence d'IDs entre `courtbase-app` coach et `courtbase-register` parent
 * pour que le faux email du coach pointe vers le bon écran parent).
 *
 * Pas de mutation : `create` log-only (cf. `licenseRequestsStore`).
 *
 * Helper `inferRequiredDocs` : dérive la liste des pièces à demander selon
 * le profil du joueur. Logique simple et déterministe (pas de side-effect).
 */

import {
  MOCK_LICENSE_REQUESTS,
  getMockLicenseRequestById,
  listMockLicenseRequestsForMember,
  type LicenseDocKind,
  type LicenseRequestMock,
} from '@club-app/shared-types'

import type { MockMember } from '@/types/mock'

// ───────────────────────────────────────────────────────────────
// Lecture
// ───────────────────────────────────────────────────────────────

/** Toutes les demandes de licence (fixtures source, immuable). */
export function listLicenseRequests(): readonly LicenseRequestMock[] {
  return MOCK_LICENSE_REQUESTS
}

/** Demandes pour un membre donné (multiple possible historiquement). */
export function listLicenseRequestsForMember(memberId: string): LicenseRequestMock[] {
  return listMockLicenseRequestsForMember(memberId)
}

/** Lookup par id. `undefined` si absent. */
export function getLicenseRequestById(id: string): LicenseRequestMock | undefined {
  return getMockLicenseRequestById(id)
}

// ───────────────────────────────────────────────────────────────
// Inférence des docs requis
// ───────────────────────────────────────────────────────────────

/**
 * Détermine la liste minimale de pièces à demander au parent pour ce membre.
 *
 * Règles :
 *   - Toujours : carte d'identité recto + verso.
 *   - AVS uniquement si manquant dans le dossier club (`member.avs == null`).
 *   - Lettre de sortie suisse (`transfer_letter_swiss`) si on a un flag
 *     `previousClubName` ET que le club précédent est en Suisse. Les
 *     `MockMember` actuels ne portent pas ces champs (ils vivent côté
 *     `MockRegistration` post-inscription), donc dans le mock on retourne
 *     uniquement la base + AVS si pertinent. Le coach pourra étendre via
 *     l'UI plus tard ; pour l'instant le mock se contente de la base.
 *
 * Cohérent avec les `requiredDocs` des fixtures partagées (`lr-leo-2025` =
 * `[id_front, id_back]`, `lr-paul-2025` = `[id_front, id_back, avs]`).
 */
export function inferRequiredDocs(member: MockMember): LicenseDocKind[] {
  const out: LicenseDocKind[] = ['id_front', 'id_back']
  if (!member.avs) out.push('avs')
  return out
}
