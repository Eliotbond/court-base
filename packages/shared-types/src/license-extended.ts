/**
 * Types étendus du workflow "demande de licence parent" — **mock-only**.
 *
 * Ce fichier est un draft destiné à être promu dans `license.ts` (et fusionné
 * avec `LicenseRequestData` / `LicenseRequestStatus`) quand la Phase backend
 * land. Pour l'instant il alimente les fixtures partagées
 * (`mock-fixtures/licenseRequests.ts`) consommées par `apps/courtbase-app`
 * (coach) et `apps/courtbase-register` (parent) pour la démo E2E sans
 * Firebase.
 *
 * Conventions :
 * - Pas de dépendance Firebase (cohérent avec le reste du package).
 * - Toutes les dates sont en millisecondes epoch (`number`), pas en
 *   `Timestamp` — la conversion sera faite à la promotion backend.
 * - `denorm` permet aux apps de rendre une LR sans avoir à partager
 *   `MOCK_MEMBERS` entre les deux apps.
 */

import type { LicenseRequestStatus } from './license'

/**
 * Statuts étendus du workflow parent. Compatibles avec
 * `LicenseRequestStatus` (`pending` | `approved` | `rejected`) auxquels
 * s'ajoutent les deux états intermédiaires du workflow parent.
 */
export type LicenseRequestExtendedStatus =
  | 'pending_parent_docs' // coach a envoyé, attend parent
  | 'parent_docs_submitted' // parent a soumis, attend admin
  | LicenseRequestStatus // 'pending' | 'approved' | 'rejected'

/**
 * Pièces que le parent peut être amené à uploader.
 *
 * Note : pas de `'transfer_letter_foreign'` — la Letter of Clearance FIBA
 * est gérée out-of-band par l'admin (procédure MAP, croisement de bases
 * fédérales). Le parent fournit uniquement le **contexte** via
 * `ForeignPlayerContextMock`.
 */
export type LicenseDocKind = 'id_front' | 'id_back' | 'avs' | 'transfer_letter_swiss'

/**
 * Métadonnées d'un fichier uploadé (mock-only — pas de Storage réel).
 * L'URL `mock://...` n'est jamais résolue ; côté UI on garde le nom et la
 * taille pour rendre une tile "uploaded" sans preview cliquable.
 */
export interface UploadedDocFileMock {
  /** Convention : `mock://licenseRequests/{uid}/{requestId}/{kind}.{ext}`. */
  url: string
  fileName: string
  /** Millisecondes epoch. */
  uploadedAt: number
  sizeBytes: number
}

/**
 * Contexte joueur étranger — déclaratif uniquement.
 *
 * `hadCompetition: null` = parent n'a pas encore répondu au toggle
 * "le joueur a-t-il participé à des compétitions officielles à l'étranger ?".
 */
export interface ForeignPlayerContextMock {
  /** Code ISO 2-lettres du pays de l'ancien club ('FR', 'ES', ...). */
  previousCountry: string
  hadCompetition: boolean | null
  isMinor: boolean
  /** Niveau déclaré de l'ancien club, si connu. */
  level?: 'LNA' | 'LNB' | 'regional'
}

/**
 * Document `/licenseRequests/{requestId}` — version mock étendue. Sera
 * promue vers `LicenseRequestData` à la Phase backend.
 */
export interface LicenseRequestMock {
  id: string
  memberId: string
  teamId: string
  /** uid du coach qui a déclenché la demande. */
  requestedBy: string
  status: LicenseRequestExtendedStatus
  requiredDocs: LicenseDocKind[]
  uploadedDocs: Partial<Record<LicenseDocKind, UploadedDocFileMock | null>>
  foreignPlayerContext?: ForeignPlayerContextMock
  parentNotes: string | null
  /** Millisecondes epoch — posé quand le parent passe en `parent_docs_submitted`. */
  parentCompletedAt: number | null
  /** Millisecondes epoch. */
  createdAt: number
  /**
   * Champs dénormalisés pour éviter de partager `MOCK_MEMBERS` entre apps.
   * À retirer à la promotion backend (les apps re-feront un join member/team).
   */
  denorm: {
    memberFirstName: string
    memberLastName: string
    teamName: string
    coachName: string
  }
}
