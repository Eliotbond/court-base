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
 * Document `/licenseRequests/{requestId}` — coach (mobile) demande licence
 * pour un joueur. Voir docs/firebase.md + main.md (license requests).
 *
 * Approval → `member.licensed = true` (procédure fédérale réelle hors-bande).
 */
export type LicenseRequestStatus = 'pending' | 'approved' | 'rejected'

export interface LicenseRequestData {
  memberId: string
  teamId: string
  /** uid coach mobile. */
  requestedBy: string
  status: LicenseRequestStatus
  reviewedBy: string | null
  reviewedAt: Timestamp | null
  adminComment: string | null
  createdAt: Timestamp
}

export type LicenseRequest = LicenseRequestData & { id: string }

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
}

export type License = LicenseData & { id: string }
