/**
 * Helpers partagés par les callables de review d'une `/licenseRequests/{id}` —
 * `coachReviewLicenseDoc`, `treasurerReviewLicenseDoc`, `validateLicenseRequest`.
 *
 * Convention auth :
 *  - **Coach** : a le droit de reviewer un doc d'une demande SI la `teamId`
 *    de la demande est dans `user.teamIds` (rangée canoniquement par
 *    `project_teamids_canonical`). Bypass : `rootAdmin` (claim) ou rôle
 *    `admin` (sur le `/users` doc).
 *  - **Treasurer review** : a le droit de reviewer un doc SI le caller est
 *    `rootAdmin` (claim) ou porte au moins un rôle parmi
 *    `admin | treasurer | secretary` côté `/users/{uid}`. Pattern identique
 *    à `assertCanConfirmLicense` (cf. `confirmLicense.ts`) — c'est la même
 *    population "comité" qui traite la demande puis émet la licence.
 *
 * Toutes les fonctions ici lèvent `HttpsError('permission-denied', ...)` en
 * cas de refus (jamais de `unauthenticated` — les callers gardent ce code
 * pour le check `request.auth == null` initial).
 */
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import type {
  LicenseDocKind,
  LicenseRequestData,
  UploadedDocRef,
  UserData,
} from '@club-app/shared-types'
import { db } from '../dues/_helpers'

/** Identité du caller — strict subset de `request.auth` utilisé ici. */
export interface CallerAuth {
  uid: string
  token?: Record<string, unknown> | undefined
}

/** `true` si le caller porte le claim Auth `rootAdmin`. */
function isRootAdmin(auth: CallerAuth): boolean {
  return auth.token?.rootAdmin === true
}

/** `true` si le doc `/users` du caller porte le rôle `admin`. */
function hasAdminRole(user: UserData | undefined): boolean {
  return !!user && (user.roles ?? []).includes('admin')
}

/**
 * Charge `/users/{uid}` pour le caller. Lève `permission-denied` si absent
 * (un caller sans doc user ne peut avoir aucun rôle applicatif).
 */
export async function loadCallerUser(uid: string): Promise<UserData> {
  const snap = await db().doc(`users/${uid}`).get()
  if (!snap.exists) {
    throw new HttpsError('permission-denied', 'No /users doc for caller.')
  }
  return snap.data() as UserData
}

/**
 * Garde scope coach SUR UNE LICENSE REQUEST. Bypass admin/rootAdmin.
 *
 * Pourquoi un helper dédié (vs `assertCoachOrAdminOfMember` du module
 * `members/`) : ici, le scope est porté par `request.teamId` qui est
 * statiquement présent sur le doc, pas par la liste des équipes contenant
 * `memberId`. Pas de query Firestore additionnelle (vs `array-contains`).
 */
export function assertCoachOfLicenseRequest(
  auth: CallerAuth,
  request: LicenseRequestData,
  user: UserData,
): void {
  if (isRootAdmin(auth)) return
  if (hasAdminRole(user)) return
  if ((user.teamIds ?? []).includes(request.teamId)) return
  throw new HttpsError(
    'permission-denied',
    'Caller must be admin or a coach of this team.',
  )
}

/**
 * Garde "qui peut reviewer/valider côté trésorier" : claim `rootAdmin` OU
 * rôle `admin | treasurer | secretary` côté `/users/{uid}`. Aligné sur
 * `assertCanConfirmLicense` dans `confirmLicense.ts` — même population.
 */
export function assertCanReviewAsTreasurer<I>(
  request: CallableRequest<I>,
  user: UserData,
): void {
  if (request.auth?.token?.rootAdmin === true) return
  const roles = user.roles ?? []
  if (roles.includes('admin')) return
  if (roles.includes('treasurer')) return
  if (roles.includes('secretary')) return
  throw new HttpsError(
    'permission-denied',
    'Caller must be rootAdmin, admin, treasurer or secretary.',
  )
}

/**
 * `true` si TOUS les `requiredDocs` ont une `coachReview` `accepted`.
 *
 * Note : un doc encore non uploadé OU sans `coachReview` posée fait retomber
 * à `false` — la demande ne peut pas passer à `coach_validated`.
 */
export function computeAllCoachAccepted(request: LicenseRequestData): boolean {
  return request.requiredDocs.every((kind) => {
    const doc: UploadedDocRef | undefined = request.uploadedDocs[kind]
    return doc?.coachReview?.decision === 'accepted'
  })
}

/**
 * `true` si TOUS les `requiredDocs` ont une `treasurerReview` `accepted`.
 *
 * Symétrique à `computeAllCoachAccepted`. Utilisé pour gater l'approbation
 * finale (`validateLicenseRequest`).
 */
export function computeAllTreasurerAccepted(request: LicenseRequestData): boolean {
  return request.requiredDocs.every((kind) => {
    const doc: UploadedDocRef | undefined = request.uploadedDocs[kind]
    return doc?.treasurerReview?.decision === 'accepted'
  })
}

/**
 * Validation textuelle d'un `refusalReason` : trim + length ∈ [5, 500].
 * Retourne la valeur trimée si valide, lève `invalid-argument` sinon.
 *
 * Caller doit s'assurer que la decision est `'refuse'` avant d'invoquer —
 * un accept ne porte pas de raison (la valeur est ignorée même si fournie).
 */
export function validateRefusalReason(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new HttpsError(
      'invalid-argument',
      'refusalReason is required when decision is refuse.',
    )
  }
  const trimmed = raw.trim()
  if (trimmed.length < 5 || trimmed.length > 500) {
    throw new HttpsError(
      'invalid-argument',
      'refusalReason must be between 5 and 500 characters.',
    )
  }
  return trimmed
}

/**
 * Validation du `kind` reçu : doit être un `LicenseDocKind` connu ET figurer
 * dans `request.requiredDocs` (sinon le coach review-rait un doc hors scope)
 * ET avoir un upload présent (sinon il n'y a rien à reviewer).
 */
export function assertReviewableKind(
  request: LicenseRequestData,
  kind: LicenseDocKind,
): UploadedDocRef {
  if (!request.requiredDocs.includes(kind)) {
    throw new HttpsError(
      'failed-precondition',
      `Document kind '${kind}' is not in this request's requiredDocs.`,
    )
  }
  const doc: UploadedDocRef | undefined = request.uploadedDocs[kind]
  if (!doc) {
    throw new HttpsError(
      'failed-precondition',
      `Document '${kind}' has not been uploaded yet.`,
    )
  }
  return doc
}

/** Set canonique des `LicenseDocKind` acceptés en input wire. */
const VALID_KINDS: readonly LicenseDocKind[] = [
  'id_front',
  'id_back',
  'avs',
  'transfer_letter_swiss',
]

/** Type-guard sur le wire input `kind` (cast safe d'un `unknown`). */
export function parseLicenseDocKind(raw: unknown): LicenseDocKind {
  if (typeof raw !== 'string' || !VALID_KINDS.includes(raw as LicenseDocKind)) {
    throw new HttpsError(
      'invalid-argument',
      `kind must be one of: ${VALID_KINDS.join(', ')}.`,
    )
  }
  return raw as LicenseDocKind
}
