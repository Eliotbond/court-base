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
