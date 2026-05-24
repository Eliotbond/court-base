import type { Timestamp } from './index'

/**
 * Document `/members/{memberId}` — fiche membre côté club.
 * Voir docs/firebase.md (section /members/{memberId}).
 *
 * **Pas de `email`/`phone` ici** : ces champs vivent dans la subcollection
 * `/members/{memberId}/private/contact` (voir `MemberContactData`), gated
 * pour exclure les `official`-only de la lecture.
 */
export type MemberTransferState =
  | 'none'
  | 'national_pending'
  | 'international_pending'
  | 'cleared'

/**
 * Statut "cycle de vie" d'un membre côté club.
 * - `active` : par défaut — membre actuellement géré.
 * - `archived` : mis de côté (refus d'inscription, départ, etc.). N'apparaît
 *   plus dans les listes par défaut, conserve les références (dues, attendance,
 *   etc.) pour l'historique.
 *
 * L'archive est posée par callable (jamais write client direct). Le flag
 * `active` (bool) reste utilisé pour la sélection coach/team, l'archive est
 * orthogonale : un membre peut être `active = false` (banc) sans être archivé,
 * et un archivé reste `active = false` par convention.
 */
export type MemberStatus = 'active' | 'archived'

export type DuesStatus =
  | 'ok'
  | 'pending_grace'
  | 'due'
  | 'overdue'
  | 'excluded'
  | 'excepted'
  | 'n/a'

/**
 * Catégorie de destinataire pour les comms liées à un membre.
 * - `member` : le membre lui-même (suppose `linkedUserId` + contact joignable).
 * - `guardians` : tous les UIDs listés dans `member.guardianUserIds`.
 */
export type CommsRecipient = 'member' | 'guardians'

/**
 * Configuration par-membre du routage des communications.
 *
 * Defaults dérivés à la création depuis `isMinor(birthDate)` :
 * - mineur : `billing = ['guardians']`, `general = ['guardians']`
 * - majeur : `billing = ['member']`,    `general = ['member']`
 *
 * Surcharges autorisées :
 * - admin : tout
 * - coach d'une des équipes du membre : `generalRecipients` uniquement (pas billing)
 */
export interface MemberCommsConfig {
  /** Destinataires des factures / notifs de cotisations. */
  billingRecipients: CommsRecipient[]
  /** Destinataires des comms générales (assignations, planning, etc.). */
  generalRecipients: CommsRecipient[]
  /** État du flow de transition majorité. `null` tant que le membre n'a pas eu 18 ans. */
  majorityTransition: MajorityTransitionState | null
}

/**
 * Workflow de transition à la majorité.
 *
 * 1. Function `onMajorityReached` (scheduled) détecte `birthDate + 18ans` atteint
 *    → écrit un mail dans `/pendingEmails` pour les guardians, set `triggeredAt`.
 * 2. Un guardian répond via callable `respondGuardianConsent` → set `guardiansResponse`.
 * 3. Si guardians = `yes`, mail au membre → callable `respondMemberConsent` → set `memberResponse`.
 * 4. `resolvedAt` set quand le résultat est appliqué à `comms.generalRecipients`.
 *
 * Tant que pending : les defaults mineurs restent appliqués pour la `generalRecipients`.
 * `billingRecipients` bascule sur `['member']` dès la majorité, indépendamment.
 */
export interface MajorityTransitionState {
  triggeredAt: Timestamp
  guardiansResponse: MajorityResponse | null
  memberResponse: MajorityResponse | null
  resolvedAt: Timestamp | null
}

export interface MajorityResponse {
  answer: 'yes' | 'no'
  respondedAt: Timestamp
  /** UID de l'auteur de la réponse (guardian ou membre selon l'étape). */
  respondedByUid: string
}

/**
 * Référence dénormalisée vers la licence ACTIVE (confirmée) d'un membre pour
 * un rôle donné (`official` / `coach`). Posée par la callable `confirmLicense`
 * à la confirmation d'une licence, `null` sinon.
 *
 * Sert à dériver « officiel/coach actif » sans requête `/licenses`, et à gater
 * l'accès app côté `firestore.rules`. La dérivation est saison-précise : un
 * membre est officiel ACTIF si `officialLicense != null` ET
 * `officialLicense.seasonId === <id de la saison active>`.
 *
 * À distinguer de `officialLevel` / `coachLevel` qui sont des QUALIFICATIONS
 * (ce pour quoi le membre est formé) — indépendantes du fait d'être actif.
 */
export interface ActiveLicenseRef {
  /** id du doc `/licenses/{id}`. */
  licenseId: string
  /** Saison de la licence (`/seasons/{id}`). */
  seasonId: string
  /** Niveau snapshot de la licence (numérique pour official/coach). */
  level: number | null
}

export interface MemberData {
  firstName: string
  lastName: string
  /**
   * État cycle de vie. `'active'` par défaut à la création (`createMember`).
   * Bascule à `'archived'` via callable serveur (ex. refus de registration,
   * cf. `docs/chantier-registrations.md` Phase E + `docs/main.md` → "Refus
   * d'une registration → archive du member lié"). Pas d'écriture client direct.
   */
  status: MemberStatus
  /** Posé par la callable d'archive. `null` tant que `status === 'active'`. */
  archivedAt: Timestamp | null
  /** Motif libre passé à la callable. `null` si pas archivé. */
  archivedReason: string | null
  /** uid de l'admin/coach ayant déclenché l'archive. `null` si pas archivé. */
  archivedByUid: string | null
  /** refs vers /roles */
  roles: string[]
  /** uid Auth si le membre a un compte */
  linkedUserId: string | null
  licenseNumber: string
  /**
   * Niveau de QUALIFICATION officiel (numérique, 1..N). `null` si le membre
   * n'est pas qualifié comme officiel. Réglé manuellement par l'admin.
   * Détermine quel `homeOfficialRequirements` (ventilé par niveau) le membre
   * peut couvrir. Indépendant du fait d'être officiel ACTIF (cf.
   * `officialLicense`).
   */
  officialLevel: number | null
  /**
   * Niveau de QUALIFICATION coach (numérique, 1..N). `null` si le membre
   * n'est pas qualifié comme coach. Réglé manuellement par l'admin.
   * Indépendant du fait d'être coach ACTIF (cf. `coachLicense`).
   */
  coachLevel: number | null
  /**
   * Réf dénormalisée vers la licence d'officiel active (confirmée). `null` =
   * aucune licence officiel confirmée. Le membre est officiel ACTIF si cette
   * réf existe ET cible la saison courante. Posée par `confirmLicense`.
   */
  officialLicense: ActiveLicenseRef | null
  /** Idem pour la licence de coach. Cf. `officialLicense`. */
  coachLicense: ActiveLicenseRef | null
  licensed: boolean
  duesStatus: DuesStatus
  duesStatusUpdatedAt: Timestamp
  active: boolean
  /**
   * Date de naissance. `null` = inconnue (traité comme adulte côté defaults,
   * mais l'UI doit avertir l'admin).
   */
  birthDate: Timestamp | null
  /**
   * UIDs des utilisateurs ayant le rôle `parent` rattachés à ce membre.
   * Source de vérité du lien tuteur ↔ pupille. `firestore.rules` étend la
   * lecture du membre + de la sub `/private/contact` à ces UIDs.
   */
  guardianUserIds: string[]
  /** Configuration des destinataires de comms (facturation + générale). */
  comms: MemberCommsConfig
  /**
   * Numéro AVS (756.XXXX.XXXX.XX). Distinct de `licenseNumber` qui est l'ID
   * fédéral. Saisi via app register lors d'une inscription, sinon édité par admin.
   * `null` = pas encore connu (ex. réfugié en cours de procédure d'asile).
   */
  avs: string | null
  /**
   * État de transfert du joueur. Mis à jour par admin lors d'une procédure de
   * transfert national ou international (cf. `docs/chantier-registrations.md` §4.9).
   */
  transferState: MemberTransferState
  /**
   * Chemin Storage de la photo licence du membre (format passeport, réutilisée
   * par l'admin/trésorier lors de la création de la licence fédérale).
   * Pattern : `members/{memberId}/license-photo.{ext}`.
   * `null` tant qu'aucune photo n'a été uploadée.
   * Posé par le coach (scope team via callable serveur) ou un
   * admin/treasurer/rootAdmin. Pas d'écriture self par le membre.
   * Cf. `docs/members/license-photo.md`.
   */
  photoStoragePath: string | null
  /**
   * Timestamp du dernier upload de photo licence. Sert d'audit + de
   * cache-buster pour les URLs signées. `null` si aucune photo.
   */
  photoUpdatedAt: Timestamp | null
  /** UID du coach/admin ayant uploadé la dernière version. `null` si aucune photo. */
  photoUpdatedByUid: string | null
}

export type Member = MemberData & { id: string }

/**
 * Document `/members/{memberId}/private/contact` (ID fixe `contact`).
 * Lecture : admin, coach, et le membre lui-même.
 * Écriture : admin et le membre lui-même.
 * Les `official`-only ne lisent PAS ce doc.
 */
export interface MemberContactData {
  email: string
  phone: string
}

export type MemberContact = MemberContactData & { id: string }
