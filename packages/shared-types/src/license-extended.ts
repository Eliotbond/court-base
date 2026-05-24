/**
 * @deprecated Compat shim de la phase mock — utilisez `./license` directement
 * pour les types canoniques. Ce fichier est conservé pendant la transition
 * PR1 → PR2 parce que :
 *
 *  - les **fixtures partagées** (`mock-fixtures/licenseRequests.ts`) et les
 *    deux apps (`courtbase-app` coach + `courtbase-register` parent)
 *    consomment encore des variantes "mock" avec `number` (epoch ms) au
 *    lieu de `Timestamp` Firestore — pour rester sessionStorage-friendly ;
 *  - une rename de masse augmenterait le bruit de la PR1.
 *
 * **À supprimer** quand les apps passeront sur Firestore réel et adopteront
 * directement `LicenseRequestData` / `UploadedDocRef` du canonical.
 *
 * Alias rétrocompat (ré-exportés ici à titre documentaire, identiques aux
 * symboles canoniques exportés par `./license` via `index.ts`) :
 *  - `LicenseRequestExtendedStatus` ≡ `LicenseRequestStatus` du canonical.
 *  - `ForeignPlayerContextMock` ≡ `ForeignPlayerContext` du canonical.
 *
 * Pour éviter les conflits de ré-export `export *` dans `index.ts`, ces
 * alias sont **uniquement disponibles via import direct** depuis ce fichier :
 *   `import type { LicenseRequestExtendedStatus } from '@club-app/shared-types/license-extended'`
 * (ou plus simplement : importer le canonique).
 *
 * Variantes mock spécifiques (timestamps `number`, `url` blob) — exportées
 * via `index.ts` :
 *  - `UploadedDocFileMock` — équivalent mock de `UploadedDocRef`
 *  - `LicenseRequestMock` — équivalent mock de `LicenseRequestData & { id }`
 */

import type {
  LicenseDocKind,
  LicenseRequestStatus,
  ForeignPlayerContext,
} from './license'

/** @deprecated Alias de `LicenseRequestStatus` (canonical `./license`). */
export type LicenseRequestExtendedStatus = LicenseRequestStatus

/** @deprecated Alias de `ForeignPlayerContext` (canonical `./license`). */
export type ForeignPlayerContextMock = ForeignPlayerContext

/**
 * Métadonnées d'un fichier uploadé (mock-only — pas de Storage réel).
 * L'URL `mock://...` n'est jamais résolue ; côté UI on garde le nom et la
 * taille pour rendre une tile "uploaded" sans preview cliquable.
 *
 * @deprecated Variante mock — équivalent canonique : `UploadedDocRef` dans
 * `./license` (qui utilise `Timestamp` Firestore et `storagePath` /
 * `contentType`).
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
 * Document `/licenseRequests/{requestId}` — version mock étendue. Utilisée
 * par les fixtures partagées + les apps tant qu'elles tournent en mock.
 *
 * @deprecated Variante mock — équivalent canonique : `LicenseRequestData & { id }`
 * dans `./license` (qui utilise `Timestamp` Firestore + `seasonId` + `denorm`
 * optionnel + `UploadedDocRef`).
 */
export interface LicenseRequestMock {
  id: string
  memberId: string
  teamId: string
  /** uid du coach qui a déclenché la demande. */
  requestedBy: string
  status: LicenseRequestStatus
  requiredDocs: LicenseDocKind[]
  uploadedDocs: Partial<Record<LicenseDocKind, UploadedDocFileMock | null>>
  foreignPlayerContext?: ForeignPlayerContext
  parentNotes: string | null
  /** Millisecondes epoch — posé quand le parent passe en `parent_docs_submitted`. */
  parentCompletedAt: number | null
  /** Millisecondes epoch. */
  createdAt: number
  /**
   * Champs dénormalisés pour éviter de partager `MOCK_MEMBERS` entre apps.
   * À retirer à la promotion full-Firestore.
   */
  denorm: {
    memberFirstName: string
    memberLastName: string
    teamName: string
    coachName: string
  }
}
