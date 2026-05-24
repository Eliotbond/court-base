/**
 * I/O contracts pour les 4 callables de la **phase trésorier** du workflow
 * `/licenseRequests`. Partagés entre `functions/` (Cloud Functions
 * implémentations) et `apps/web` (wrappers `cloudFunctions.ts` + UI trésorier).
 *
 * Workflow couvert (cf. `LicenseRequestStatus` dans `./license.ts`) :
 *
 *   coach_validated
 *     │ treasurerUploadSignableDoc(requestId, storagePath, ...)
 *     ▼
 *   awaiting_parent_signature
 *     │ (parent re-uploade le signed doc — write client direct, hors callable)
 *     ▼
 *   parent_signed
 *     │ treasurerConfirmSignedDoc(requestId, notes?)
 *     ▼
 *   form_confirmed
 *     │ treasurerMarkSentAndPaid(requestId, paymentProofStoragePath?)
 *     │ → crée /licenses/{id} en status='pending'
 *     ▼
 *   sent_paid
 *     │ treasurerFinalizeLicense(requestId, licenseNumber)
 *     │ → /licenses/{id} : status='active' via confirmLicense
 *     │ → member.licensed = true + dénormalisation
 *     ▼
 *   approved   (terminal)
 *
 * Auth (toutes les 4 callables) : claim `rootAdmin` OU rôle `treasurer` sur
 * `/users/{uid}.roles`. PAS `admin` standard — cohérent avec le module compta.
 * (Cf. mémoire `[[project_compta_module_v1]]`.)
 *
 * Convention paths Storage (à respecter côté trésorier UI + parent re-upload) :
 *  - signable.pdf       : `licenseRequests/{uid}/{requestId}/signable.pdf`
 *  - signed.pdf         : `licenseRequests/{uid}/{requestId}/signed.pdf`
 *  - payment-proof.{ext}: `licenseRequests/{uid}/{requestId}/payment-proof.{ext}`
 */

// ---------------------------------------------------------------------------
// 1. treasurerUploadSignableDoc — coach_validated → awaiting_parent_signature
// ---------------------------------------------------------------------------

export interface TreasurerUploadSignableDocInput {
  requestId: string
  /**
   * Path Storage du PDF formulaire fédéral pré-rempli, uploadé par le
   * trésorier AVANT l'appel à la callable. Convention :
   * `licenseRequests/{uid}/{requestId}/signable.pdf` (où `uid` est l'uid du
   * trésorier — différent du `uid` parent du `signed.pdf`).
   */
  storagePath: string
  /** Nom du fichier original (audit + UI). */
  fileName: string
  /** Taille du fichier en octets (validation côté serveur). */
  sizeBytes: number
  /** Content-type MIME du fichier (`application/pdf` attendu). */
  contentType: string
}

export interface TreasurerUploadSignableDocResult {
  newStatus: 'awaiting_parent_signature'
}

// ---------------------------------------------------------------------------
// 2. treasurerConfirmSignedDoc — parent_signed → form_confirmed
// ---------------------------------------------------------------------------

export interface TreasurerConfirmSignedDocInput {
  requestId: string
  /**
   * Notes libres facultatives (workflow interne trésorier). Posées sur
   * `LicenseRequestData.treasurerNotes`. `null` ou `undefined` = pas de
   * modification.
   */
  notes?: string | null
}

export interface TreasurerConfirmSignedDocResult {
  newStatus: 'form_confirmed'
}

// ---------------------------------------------------------------------------
// 3. treasurerMarkSentAndPaid — form_confirmed → sent_paid
//    + crée /licenses/{id} en status='pending'
// ---------------------------------------------------------------------------

export interface TreasurerMarkSentAndPaidInput {
  requestId: string
  /**
   * Path Storage de la preuve de paiement (extrait bancaire / screenshot
   * e-banking). Optionnel — peut être uploadée plus tard via un re-call
   * (workflow asynchrone : la preuve peut arriver après l'envoi du
   * dossier). Convention : `licenseRequests/{uid}/{requestId}/payment-proof.{ext}`.
   *
   * `null` ou `undefined` = pas de preuve attachée pour cet appel.
   */
  paymentProofStoragePath?: string | null
}

export interface TreasurerMarkSentAndPaidResult {
  newStatus: 'sent_paid'
  /**
   * id de la `/licenses/{id}` créée par cette callable, en `status='pending'`.
   * Utilisable par le coach **dès cet instant** pour aligner un joueur sur un
   * match — la licence sera passée en `'active'` plus tard par
   * `treasurerFinalizeLicense` (qui appelle `confirmLicense`).
   */
  licenseId: string
}

// ---------------------------------------------------------------------------
// 4. treasurerFinalizeLicense — sent_paid → approved
//    + confirme /licenses/{id} (pending → active) via confirmLicense
// ---------------------------------------------------------------------------

export interface TreasurerFinalizeLicenseInput {
  requestId: string
  /**
   * Numéro de licence saisi manuellement par le trésorier, à partir du
   * retour fédération (email/portail). Texte libre — pas de validation
   * format côté wire (la fédération peut faire évoluer le format).
   */
  licenseNumber: string
}

export interface TreasurerFinalizeLicenseResult {
  newStatus: 'approved'
  /** id de la `/licenses/{id}` désormais `status='active'`. */
  licenseId: string
  /**
   * Snapshot des dénormalisations posées sur le membre. `null` si la
   * licence est de rôle `'player'` ou `'referee'` (pas de denorm posée par
   * `confirmLicense` pour ces rôles).
   */
  memberPatch: {
    memberId: string
    /** Champ effectivement posé sur `/members/{id}`. */
    field: 'officialLicense' | 'coachLicense' | 'playerLicense'
  } | null
}
