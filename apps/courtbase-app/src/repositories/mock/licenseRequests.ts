/**
 * Repository mock pour les demandes de licence fédérale.
 *
 * Lit les **fixtures partagées** depuis `@club-app/shared-types`
 * (cohérence d'IDs entre `courtbase-app` coach et `courtbase-register` parent
 * pour que le faux email du coach pointe vers le bon écran parent).
 *
 * Pas de mutation : `create` log-only (cf. `licenseRequestsStore`).
 *
 * Helper `inferRequiredDocs` : adapter mock autour du `inferRequiredDocs`
 * **canonique** de `@club-app/shared-types/license`. Ici on reçoit un
 * `MockMember` et on dérive les primitives `{ hasAvs, previouslyLicensedInSwitzerland }`
 * attendues par le canonique. Côté mock, on n'a pas de signal "déjà
 * licencié en Suisse" sur `MockMember` — on le passe à `false` ; les
 * fixtures qui contiennent `transfer_letter_swiss` (ex. `lr-julian-2025`)
 * sont seedées en dur, pas dérivées par cette fonction.
 */

import {
  MOCK_LICENSE_REQUESTS,
  getMockLicenseRequestById,
  listMockLicenseRequestsForMember,
  inferRequiredDocs as inferRequiredDocsCanonical,
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
// Inférence des docs requis (adapter mock → canonique)
// ───────────────────────────────────────────────────────────────

/**
 * Adapter mock autour du `inferRequiredDocs` canonique : convertit le
 * `MockMember` en primitives et délègue.
 *
 * Limites côté mock :
 *  - `previouslyLicensedInSwitzerland` est forcé à `false` (le `MockMember`
 *    ne porte pas ce signal — il vient d'un champ wizard côté coach que
 *    le mock ne modélise pas).
 *  - `hasAvs` = présence d'un `avs` non-vide sur le `MockMember`.
 */
export function inferRequiredDocs(member: MockMember): LicenseDocKind[] {
  return inferRequiredDocsCanonical({
    hasAvs: Boolean(member.avs),
    previouslyLicensedInSwitzerland: false,
  })
}
