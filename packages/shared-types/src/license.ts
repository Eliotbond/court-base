import type { Timestamp } from './index'

/**
 * Rôles pour lesquels une licence peut être émise. Aligné sur les rôles
 * système de `/roles` (cf. `docs/firebase.md` → /roles/{roleId}).
 * `referee` = arbitre, `official` = officiel de table.
 */
export type LicenseRole = 'player' | 'official' | 'coach' | 'referee'

/**
 * Document `/licenseTypes/{id}` — grille tarifaire éditable par l'admin.
 * Voir docs/firebase.md + main.md (Licences).
 *
 * Une entrée = un (role, level, name, fee).
 *
 * **Règle rôle/niveau** : seuls `official` / `coach` / `referee` portent un
 * niveau numérique. Le rôle `player` a toujours `level: null` (ses
 * licences Junior/Senior/… sont distinguées par leur `name`). Validé côté
 * store (`validateRoleLevel`).
 *
 * **Unicité** : `(role, level)` enforced côté store/UI uniquement pour les
 * rôles à niveau (level !== null). Pour les joueurs (level=null), plusieurs
 * entrées sont autorisées et distinguées par le nom.
 *
 * Le prix `fee` représente le prix **courant**. À l'émission d'une licence
 * (entité `/licenses` à venir), il sera snapshotté dans la transaction
 * comptable pour préserver l'historique malgré les évolutions de grille.
 */
export interface LicenseTypeData {
  role: LicenseRole
  /**
   * Numérique pour official/coach/referee, toujours `null` pour player.
   * Cf. règle rôle/niveau ci-dessus.
   */
  level: number | null
  /** Libellé affiché. Ex : "Officiel J+S", "Joueur Ligue A", "Coach C+". */
  name: string
  /** Prix courant en CHF. */
  fee: number
  displayOrder: number
  active: boolean
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type LicenseType = LicenseTypeData & { id: string }

/**
 * Document `/licenseRequests/{requestId}` — workflow "demande de licence
 * parent". Démarré par le coach (PR1), complété par le parent
 * (`courtbase-register`), validé par le coach (PR2), puis processé en plusieurs
 * étapes par le trésorier (PR3 + PR4 trésorier-phase). Voir docs/firebase.md +
 * main.md + docs/licenses/parent-completion-workflow.md.
 *
 * Lifecycle complet (le préfixe `treasurer-` matérialise une étape interne au
 * trésorier ; le parent peut aussi avoir une action — re-upload du doc signé) :
 *
 *   (none)
 *     │ coach déclenche la demande (gate cotisation OK)          ← PR1
 *     ▼
 *   pending_parent_docs
 *     │ parent uploade docs + soumet                              ← courtbase-register
 *     ▼
 *   parent_docs_submitted
 *     │ coach valide les pièces                                   ← PR2
 *     ▼
 *   coach_validated
 *     │ trésorier uploade le formulaire fédéral pré-rempli        ← PR-trésorier
 *     ▼
 *   awaiting_parent_signature
 *     │ parent re-uploade le doc signé                            ← register UI (déférée)
 *     ▼
 *   parent_signed
 *     │ trésorier valide la conformité du signed doc              ← PR-trésorier
 *     ▼
 *   form_confirmed
 *     │ trésorier marque "envoyé fédération + payé"               ← PR-trésorier
 *     │ (crée la /licenses/{id} en status='pending', utilisable
 *     │  par le coach en match dès cet instant)
 *     ▼
 *   sent_paid
 *     │ trésorier saisit le numéro de licence reçu fédération     ← PR-trésorier
 *     │ (passe /licenses → status='active' via confirmLicense, pose
 *     │  member.licensed = true, écrit la charge comptable)
 *     ▼
 *   approved   (terminal)
 *
 *   À tout moment depuis `parent_docs_submitted` jusqu'à `sent_paid` :
 *     rejected   (terminal)
 *
 * `'pending'` est conservé pour compat ascendante avec d'éventuels documents
 * legacy ; nouveaux écrits passent par `'pending_parent_docs'`.
 *
 * Approval → `member.licensed = true` (procédure fédérale réelle hors-bande).
 */
export type LicenseRequestStatus =
  /** @deprecated Legacy generic status — utiliser `'pending_parent_docs'` pour les nouvelles demandes. */
  | 'pending'
  /** Coach a déclenché la demande, attend que le parent uploade les pièces. */
  | 'pending_parent_docs'
  /** Parent a soumis ses pièces, attend la validation du coach. */
  | 'parent_docs_submitted'
  /** Coach a validé les pièces, attend traitement trésorier/admin. */
  | 'coach_validated'
  /**
   * Trésorier a uploadé le formulaire fédéral pré-rempli (PDF "signable
   * doc") ; on attend que le parent le télécharge, le signe et le re-uploade.
   * Transition posée par `treasurerUploadSignableDoc`.
   */
  | 'awaiting_parent_signature'
  /**
   * Parent a re-uploadé le doc signé. Transition posée par le parent
   * (client direct write — l'UI register est différée hors PR3).
   */
  | 'parent_signed'
  /**
   * Trésorier a validé la conformité du signed doc. La demande est prête à
   * être envoyée à la fédération. Transition posée par
   * `treasurerConfirmSignedDoc`.
   */
  | 'form_confirmed'
  /**
   * Trésorier a marqué la demande "envoyée fédération + payée". À cet
   * instant, une `/licenses/{id}` est créée en `status:'pending'` —
   * utilisable par le coach en match (cf. `linkedLicenseId`).
   * Transition posée par `treasurerMarkSentAndPaid`.
   */
  | 'sent_paid'
  | 'approved'
  | 'rejected'

/**
 * Pièces que le parent peut être amené à uploader.
 *
 * Note : pas de `'transfer_letter_foreign'` — la Letter of Clearance FIBA
 * est gérée out-of-band par l'admin (procédure MAP, croisement de bases
 * fédérales). Le parent fournit uniquement le **contexte** via
 * `ForeignPlayerContext`.
 *
 * Liste figée à la création de la demande dans `requiredDocs`.
 */
export type LicenseDocKind =
  | 'id_front'
  | 'id_back'
  | 'avs'
  | 'transfer_letter_swiss'

/**
 * Décision de review portée sur un `UploadedDocRef` par un coach (PR2) ou
 * un trésorier/admin/secrétaire (PR3). `null` côté `UploadedDocRef` tant
 * qu'aucune review n'a été posée pour ce niveau.
 *
 * **Pas d'historique** : chaque nouvelle review écrase la précédente. Le
 * volume typique (1-2 refus avant accept) ne justifie pas une sub-collection
 * `/refusals/{...}`. La trace utile (qui, quand, pourquoi) reste accessible
 * tant que la review en cours n'a pas été écrasée par une suivante.
 *
 * Quand le parent re-uploade un doc refusé, les deux niveaux de review
 * (`coachReview` et `treasurerReview`) sont remis à `null` sur ce doc : le
 * doc repart du début du cycle de validation.
 */
export interface DocReviewDecision {
  decision: 'accepted' | 'refused'
  at: Timestamp
  /** uid Auth du reviewer (coach ou trésorier). */
  byUid: string
  /**
   * Motif de refus — requis si `decision === 'refused'`, `null` sinon.
   * Trim + length ≥ 5 et ≤ 500 chars enforced côté callable.
   */
  refusalReason: string | null
}

/**
 * Référence d'un document uploadé par le parent dans Firebase Storage.
 *
 * Convention chemin Storage : `licenseRequests/{uid}/{requestId}/{kind}.{ext}`.
 * Les règles Storage par-dossier sont posées dans `storage.rules`.
 *
 * `coachReview` / `treasurerReview` (PR2 / PR3) portent la décision per-doc
 * du coach puis du trésorier. Voir `DocReviewDecision`.
 */
export interface UploadedDocRef {
  /** Chemin du fichier dans Firebase Storage (relatif au bucket). */
  storagePath: string
  uploadedAt: Timestamp
  fileName: string
  sizeBytes: number
  contentType: string
  /**
   * Décision de review du coach pour ce doc (PR2). `null` tant qu'aucune
   * review coach n'a été posée. Remis à `null` automatiquement à chaque
   * re-upload du doc par le parent.
   */
  coachReview: DocReviewDecision | null
  /**
   * Décision de review du trésorier pour ce doc (PR3). `null` tant qu'aucune
   * review trésorier n'a été posée. Remis à `null` automatiquement à chaque
   * re-upload du doc par le parent ET à chaque refus du coach.
   */
  treasurerReview: DocReviewDecision | null
}

/**
 * Contexte joueur étranger — déclaratif uniquement (renseigné par le
 * parent pendant la complétion). Sert à driver le banner FIBA + à informer
 * l'admin qu'une procédure MAP / Letter of Clearance sera nécessaire.
 *
 * `null` côté `LicenseRequestData.foreignPlayerContext` tant que le parent
 * n'a pas signalé un transfert international.
 */
export interface ForeignPlayerContext {
  /** Code ISO 2-lettres du pays de l'ancien club (ex. 'FR', 'ES'). */
  previousCountry: string
  /**
   * Le joueur a-t-il participé à des compétitions officielles à l'étranger ?
   * `null` = parent n'a pas encore répondu (l'UI laisse "OUI/NON" indécis).
   */
  hadCompetition: boolean | null
  isMinor: boolean
  /** Niveau déclaré de l'ancien club, si connu. */
  level?: 'LNA' | 'LNB' | 'regional'
}

export interface LicenseRequestData {
  memberId: string
  teamId: string
  /**
   * Saison de validité de la licence demandée. Sert aussi à dériver l'ID
   * déterministe `lr-{memberId}-{seasonId}` (évite les doublons sur double
   * clic). Required côté PR1.
   */
  seasonId: string
  /** uid du coach qui a déclenché la demande. */
  requestedBy: string
  status: LicenseRequestStatus
  /**
   * Liste figée à la création (PR1, immutable côté serveur par règle à
   * venir). Dérivée par `inferRequiredDocs(...)` depuis le profil du
   * membre + un flag coach "previously licensed in Switzerland".
   */
  requiredDocs: LicenseDocKind[]
  /**
   * UIDs du linked member + des guardians du membre, snapshottés à la
   * création par le coach (= `member.linkedUserId` ∪ `member.guardianUserIds`).
   *
   * **Ancre statiquement filtrable** pour la rule `read` parent — évite
   * que le `get()` dynamique de `isGuardianOf(memberId)` ne fasse refuser
   * la LIST query côté Firestore (cf. memo `firestore-list-query-dynamic-rule`
   * + l'incident analogue `due-registered-by-uid` sur `/dues`). La rule
   * accepte le read si `request.auth.uid in resource.data.parentUserIds`.
   *
   * Snapshot à la création : si les guardians changent ensuite, ce champ
   * ne suit PAS (à ré-aligner par callable admin si besoin — cas rare en
   * pratique).
   *
   * Tableau, peut être `[]` (cas où le coach crée pour un membre sans
   * compte parent rattaché — la demande sera traitée par l'admin sans
   * notification parent).
   */
  parentUserIds: string[]
  /**
   * Documents effectivement uploadés par le parent. `{}` à la création
   * (PR1) ; rempli au fil des uploads côté `courtbase-register` (PR2).
   * `Partial` parce qu'aucune clé n'est garantie tant que le parent n'a
   * pas commencé à uploader.
   */
  uploadedDocs: Partial<Record<LicenseDocKind, UploadedDocRef>>
  /**
   * Contexte joueur étranger, posé par le parent si l'enfant vient d'un
   * club hors-CH. `null` par défaut. Lu côté coach (PR2) et trésorier
   * (PR3) pour driver le banner FIBA et la procédure MAP.
   */
  foreignPlayerContext: ForeignPlayerContext | null
  /**
   * AVS saisi par le parent dans le formulaire de complétion (cas où
   * `member.avs` était manquant à la création de la demande, donc `avs`
   * listé dans `requiredDocs`). Texte uniquement — la carte AVS n'est PAS
   * uploadée (cf. `docs/licenses/parent-completion-workflow.md` §"Documents
   * requis"). Format attendu : `756.XXXX.XXXX.XX` (validé côté UI parent).
   *
   * Lu côté coach/admin pour synchroniser vers `member.avs` lors du review
   * (PR2/PR3) — la mutation `members.avs` reste admin-only (rules).
   *
   * `null` tant que le parent ne l'a pas saisi.
   */
  parentSubmittedAvs: string | null
  /**
   * Champs dénormalisés pour permettre aux apps qui n'ont pas accès au
   * member (rules) de rendre une demande sans join. Optionnel/nullable
   * parce que tous les callers ne le posent pas — un trigger admin pourra
   * backfill plus tard.
   */
  denorm: {
    memberFirstName: string
    memberLastName: string
    teamName: string
    coachName: string
  } | null
  /** Timestamp posé quand le parent soumet ses pièces (status → `parent_docs_submitted`). */
  parentCompletedAt: Timestamp | null
  /** Timestamp posé quand le coach valide les pièces (status → `coach_validated`, PR2). */
  coachValidatedAt: Timestamp | null
  /** uid du coach ayant validé (status → `coach_validated`, PR2). */
  coachValidatedByUid: string | null
  /**
   * uid du trésorier/admin/secrétaire ayant tranché en `approved` /
   * `rejected` (PR3). Reste `null` tant que pas tranchée.
   */
  reviewedBy: string | null
  /** Timestamp de la décision finale (PR3). */
  reviewedAt: Timestamp | null
  /** Commentaire optionnel posé à l'approval / rejection (PR3). */
  adminComment: string | null
  createdAt: Timestamp

  // =====================================================================
  // Phase trésorier (PR3 trésorier-phase, 2026-05-24)
  // ---------------------------------------------------------------------
  // Tous ces champs sont `null` à la création (PR1 coach). Backward-compat :
  // les demandes existantes en `coach_validated` n'ont pas ces champs —
  // utiliser `.data.get('<field>', null)` dans les rules Firestore.
  // =====================================================================

  /**
   * Path Storage du formulaire fédéral pré-rempli ("signable doc"), uploadé
   * par le trésorier. Convention de path : `licenseRequests/{uid}/{requestId}/signable.pdf`
   * (cf. `storage.rules`).
   * Posé à la transition `coach_validated → awaiting_parent_signature`.
   */
  signableDocStoragePath: string | null
  /** Timestamp de l'upload du signable doc par le trésorier. */
  signableDocUploadedAt: Timestamp | null
  /** uid du trésorier ayant uploadé le signable doc. */
  signableDocUploadedByUid: string | null

  /**
   * Path Storage du document signé re-uploadé par le parent. Convention :
   * `licenseRequests/{uid}/{requestId}/signed.pdf`.
   * Posé à la transition `awaiting_parent_signature → parent_signed`
   * (write client direct côté parent, l'UI register est différée hors PR3).
   */
  signedDocStoragePath: string | null
  /** Timestamp du re-upload du signed doc par le parent. */
  signedDocUploadedAt: Timestamp | null
  /** uid du parent (linked member ou guardian) ayant uploadé le signed doc. */
  signedDocUploadedByUid: string | null

  /**
   * Timestamp de la confirmation de conformité du signed doc par le trésorier.
   * Posé à la transition `parent_signed → form_confirmed`.
   */
  formConfirmedAt: Timestamp | null
  /** uid du trésorier ayant confirmé la conformité du signed doc. */
  formConfirmedByUid: string | null

  /**
   * Timestamp où le trésorier a marqué la demande envoyée à la fédération.
   * Posé à la transition `form_confirmed → sent_paid`.
   */
  sentToFederationAt: Timestamp | null
  /**
   * Timestamp où la fédération a été payée par le club. Posé à la même
   * transition que `sentToFederationAt` (le règlement est fait avant
   * l'envoi du dossier, voir flow trésorier).
   */
  paidAt: Timestamp | null
  /**
   * Path Storage de la preuve de paiement (extrait bancaire / e-banking
   * snapshot). Convention : `licenseRequests/{uid}/{requestId}/payment-proof.{ext}`.
   * Optionnel — peut être posé à `sent_paid` ou re-uploadé plus tard
   * (workflow asynchrone : la preuve peut arriver après l'envoi).
   */
  paymentProofStoragePath: string | null
  /** Timestamp d'upload de la preuve de paiement. */
  paymentProofUploadedAt: Timestamp | null

  /**
   * Numéro de licence saisi par le trésorier après réception fédération.
   * Posé à la transition `sent_paid → approved`. Texte libre — format
   * Swiss Basketball à valider côté UI/callable si besoin.
   */
  licenseNumber: string | null
  /** Timestamp de la finalisation (saisie du numéro de licence). */
  licenseFinalizedAt: Timestamp | null
  /** uid du trésorier ayant finalisé. */
  licenseFinalizedByUid: string | null

  /**
   * Référence vers la `/licenses/{id}` créée à `sent_paid` (status
   * `'pending'`) puis confirmée à `approved` (status `'active'`). Permet le
   * bridge bidirectionnel entre la demande et la licence émise — la
   * `/licenses/{id}` porte aussi `requestId` (cf. `LicenseData.requestId`).
   * `null` tant que la demande n'a pas atteint `sent_paid`.
   */
  linkedLicenseId: string | null

  /**
   * Notes libres du trésorier (workflow interne, non visible côté parent).
   * Sert au trésorier à tracer pourquoi un signed doc a été refusé, des
   * particularités du dossier fédéral, etc. Mis à jour par n'importe quelle
   * transition trésorier (via la whitelist des affectedKeys côté rules).
   */
  treasurerNotes: string | null
}

export type LicenseRequest = LicenseRequestData & { id: string }

/**
 * Dérive la liste minimale des pièces à demander au parent pour cette
 * demande de licence.
 *
 * **Règle métier** :
 *  - Toujours : carte d'identité recto + verso.
 *  - AVS si le membre n'a pas encore d'AVS connu côté club.
 *  - Lettre de sortie suisse (`transfer_letter_swiss`) si le coach a
 *    signalé que le joueur a été précédemment licencié en Suisse.
 *
 * Fonction pure (pas d'I/O). Le caller passe des primitives plutôt que
 * tout le `Member`, pour que ce package ne dépende pas du type Member
 * canonique pour un simple helper.
 *
 * @example
 * ```ts
 * const docs = inferRequiredDocs({ hasAvs: false, previouslyLicensedInSwitzerland: true })
 * // → ['id_front', 'id_back', 'avs', 'transfer_letter_swiss']
 * ```
 */
export function inferRequiredDocs(input: {
  hasAvs: boolean
  previouslyLicensedInSwitzerland: boolean
}): LicenseDocKind[] {
  const out: LicenseDocKind[] = ['id_front', 'id_back']
  if (!input.hasAvs) out.push('avs')
  if (input.previouslyLicensedInSwitzerland) out.push('transfer_letter_swiss')
  return out
}

/**
 * Statut d'une licence émise (`/licenses/{id}`).
 * - `pending`   : licence créée par l'admin, en attente de confirmation par
 *                 la fédération (Swiss Basketball) et de paiement par le club.
 * - `active`    : confirmée + payée — posée via la callable `confirmLicense`
 *                 (trésorier / admin / secrétaire). Rend l'officiel/coach ACTIF.
 * - `cancelled` : licence annulée. Terminal.
 */
export type LicenseStatus = 'pending' | 'active' | 'cancelled'

/**
 * Document `/licenses/{id}` — instance concrète d'une licence fédérale émise
 * pour un membre × saison × type de licence. Voir docs/firebase.md + main.md.
 *
 * Cycle de vie : `pending` (créée par l'admin depuis la fiche membre) →
 * `active` (confirmée par Swiss Basketball + payée par le club ; passage via
 * la callable `confirmLicense` qui poste aussi l'écriture comptable de la
 * charge). Un membre est officiel/coach ACTIF si une licence `active` existe
 * pour le rôle et la saison courante (réf dénormalisée
 * `member.officialLicense` / `member.coachLicense`).
 *
 * `level`, `licenseName`, `feeSnapshot` sont snapshottés depuis le
 * `LicenseType` à la création — figés malgré les évolutions de la grille.
 */
export interface LicenseData {
  memberId: string
  /** `/seasons/{id}` — saison de validité de la licence. */
  seasonId: string
  /** `/licenseTypes/{id}` référencé à la création. */
  licenseTypeId: string
  /** Snapshot du rôle du `LicenseType`. */
  role: LicenseRole
  /** Snapshot du niveau du `LicenseType` (numérique official/coach/referee, null player). */
  level: number | null
  /** Snapshot du libellé du `LicenseType` (ex. "Officiel J+S"). */
  licenseName: string
  /** Snapshot du prix courant du `LicenseType` au moment de la création (CHF). */
  feeSnapshot: number
  status: LicenseStatus
  createdAt: Timestamp
  /** uid de l'admin ayant créé la licence. */
  createdByUid: string
  /** Posé par `confirmLicense`. `null` tant que `status !== 'active'`. */
  confirmedAt: Timestamp | null
  /** uid du trésorier/admin/secrétaire ayant confirmé. `null` si pas confirmée. */
  confirmedByUid: string | null
  /**
   * id de l'écriture `/accountingEntries` postée à la confirmation (charge
   * "Licences fédérales" / crédit trésorerie). `null` tant que pas confirmée.
   */
  accountingEntryId: string | null
  /**
   * Référence inverse vers la `/licenseRequests/{id}` qui a déclenché la
   * création de cette licence (PR3 — callable `validateLicenseRequest`).
   * `null` pour les licences créées hors workflow (création admin directe
   * depuis la fiche membre).
   */
  requestId: string | null
  /**
   * uid du coach qui avait initialement déclenché la demande de licence
   * (`request.requestedBy`), snapshotté à l'approbation par le trésorier.
   * `null` pour les licences créées hors workflow.
   */
  requestedByUid: string | null
}

export type License = LicenseData & { id: string }
