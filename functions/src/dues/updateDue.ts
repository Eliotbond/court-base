/**
 * `updateDue` — callable utilisée par admin / treasurer pour modifier une
 * cotisation (`/dues/{dueId}`) côté serveur, hors du flux paiement.
 *
 * Champs éditables : dates (`activatedAt`, `issuedAt`, `dueAt`), `notes`,
 * `status`. **Pas le montant** (`amount`) — il est figé à la création depuis
 * `team.duesAmount`. **Pas le passage à `paid`** — la mise en paiement passe
 * par le flux dédié `markDuePaid` (qui pose `paidAt` / `paidAmount` /
 * `paymentMethod`).
 *
 * Auth : signed-in. Le caller doit porter le claim Auth `rootAdmin === true`
 * OU avoir `roles` incluant `'admin'` OU `'treasurer'` côté `/users/{uid}`.
 * Sinon `permission-denied`.
 *
 * Sémantique des champs (wire) :
 *   - champ absent           ⇒ non modifié.
 *   - `null` explicite       ⇒ efface le champ (`issuedAt` / `dueAt` / `notes`
 *                              uniquement — `activatedAt` n'est pas nullable).
 *   - nombre (epoch millis)  ⇒ pose la date.
 *
 * Effet : `update` du doc `/dues/{dueId}` via Admin SDK. Le trigger existant
 * `syncMemberDuesStatus` recalcule `member.duesStatus` automatiquement — on ne
 * le touche PAS ici.
 *
 * Idempotence : un update plein est naturellement idempotent (même payload =
 * même état final). Aucun champ `updatedBy` / `updatedAt` ajouté au schéma
 * `Cotisation` (cf. CONTRAT).
 *
 * Region : europe-west6 (héritée du `setGlobalOptions` dans `src/index.ts`).
 *
 * NOTE deploy : nouvelle Function v2 → après le premier deploy, ajouter le
 * binding IAM `allUsers/run.invoker` (cf. `functions/CLAUDE.md` §"Après deploy").
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import type { CotisationStatus, UserData } from '@club-app/shared-types'
import { Timestamp, db } from './_helpers'
import { errCode } from './_emailEnqueue'

interface UpdateDueInput {
  dueId: unknown
  activatedAt?: unknown
  issuedAt?: unknown
  dueAt?: unknown
  status?: unknown
  notes?: unknown
}

export interface UpdateDueOutput {
  ok: true
}

/**
 * Statuts acceptés par `updateDue`. `'paid'` est volontairement exclu — le
 * passage à payé doit transiter par `markDuePaid` (qui pose paidAt /
 * paidAmount). Toute tentative de poser `status: 'paid'` ici est rejetée en
 * `invalid-argument`.
 */
const ACCEPTED_STATUSES: readonly CotisationStatus[] = [
  'pending_grace',
  'issued',
  'overdue',
  'excepted',
  'cancelled',
]

/** Représente un champ "non touché" pour le diff partiel. */
const UNSET = Symbol('unset')

interface ParsedInput {
  dueId: string
  /** `UNSET` = non modifié ; `Timestamp` = nouvelle valeur. `activatedAt` n'est jamais `null`. */
  activatedAt: FirebaseFirestore.Timestamp | typeof UNSET
  /** `UNSET` = non modifié ; `null` = effacer ; `Timestamp` = nouvelle valeur. */
  issuedAt: FirebaseFirestore.Timestamp | null | typeof UNSET
  /** `UNSET` = non modifié ; `null` = effacer ; `Timestamp` = nouvelle valeur. */
  dueAt: FirebaseFirestore.Timestamp | null | typeof UNSET
  /** `UNSET` = non modifié ; sinon nouvelle valeur. */
  status: CotisationStatus | typeof UNSET
  /** `UNSET` = non modifié ; `null` = effacer ; `string` = nouvelle valeur. */
  notes: string | null | typeof UNSET
}

/** Parse une date epoch-millis requise (non-nullable). */
function parseRequiredDate(
  value: unknown,
  field: string,
): FirebaseFirestore.Timestamp | typeof UNSET {
  if (value === undefined) return UNSET
  if (value === null) {
    throw new HttpsError('invalid-argument', `${field} cannot be null`)
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpsError('invalid-argument', `${field} must be an epoch-millis number`)
  }
  return Timestamp.fromMillis(value)
}

/** Parse une date epoch-millis nullable (`null` = effacer). */
function parseNullableDate(
  value: unknown,
  field: string,
): FirebaseFirestore.Timestamp | null | typeof UNSET {
  if (value === undefined) return UNSET
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpsError('invalid-argument', `${field} must be an epoch-millis number or null`)
  }
  return Timestamp.fromMillis(value)
}

function parseInput(data: UpdateDueInput): ParsedInput {
  const d = data ?? ({} as UpdateDueInput)
  if (typeof d.dueId !== 'string' || d.dueId.length === 0) {
    throw new HttpsError('invalid-argument', 'dueId is required')
  }

  let status: CotisationStatus | typeof UNSET = UNSET
  if (d.status !== undefined) {
    if (d.status === 'paid') {
      throw new HttpsError(
        'invalid-argument',
        "status 'paid' is not allowed here — use the markDuePaid flow to record a payment.",
      )
    }
    if (
      typeof d.status !== 'string' ||
      !ACCEPTED_STATUSES.includes(d.status as CotisationStatus)
    ) {
      throw new HttpsError(
        'invalid-argument',
        `status must be one of: ${ACCEPTED_STATUSES.join(', ')}`,
      )
    }
    status = d.status as CotisationStatus
  }

  let notes: string | null | typeof UNSET = UNSET
  if (d.notes !== undefined) {
    if (d.notes === null) {
      notes = null
    } else if (typeof d.notes !== 'string') {
      throw new HttpsError('invalid-argument', 'notes must be a string or null')
    } else {
      const trimmed = d.notes.trim()
      notes = trimmed.length > 0 ? trimmed : null
    }
  }

  return {
    dueId: d.dueId,
    activatedAt: parseRequiredDate(d.activatedAt, 'activatedAt'),
    issuedAt: parseNullableDate(d.issuedAt, 'issuedAt'),
    dueAt: parseNullableDate(d.dueAt, 'dueAt'),
    status,
    notes,
  }
}

/**
 * Autorise rootAdmin (claim Auth) OU admin / treasurer (rôles `/users`).
 * Même garde de base que `markDuePaid`, étendue au claim `rootAdmin` pour
 * couvrir un rootAdmin qui n'aurait pas le rôle `admin` dans son doc user.
 */
function assertCanUpdateDue(
  request: CallableRequest<UpdateDueInput>,
  user: UserData,
): void {
  if (request.auth?.token?.rootAdmin === true) return
  const roles = user.roles ?? []
  if (roles.includes('admin')) return
  if (roles.includes('treasurer')) return
  throw new HttpsError(
    'permission-denied',
    'Caller must be rootAdmin, admin or treasurer to update a due.',
  )
}

export const updateDue = onCall(
  async (
    request: CallableRequest<UpdateDueInput>,
  ): Promise<UpdateDueOutput> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', '[updateDue] Must be signed in.')
    }
    const callerUid = request.auth.uid
    const input = parseInput(request.data)

    const userSnap = await db().doc(`users/${callerUid}`).get()
    if (!userSnap.exists) {
      throw new HttpsError('permission-denied', '[updateDue] No /users doc for caller.')
    }
    const user = userSnap.data() as UserData
    assertCanUpdateDue(request, user)

    // Construit le patch partiel : seuls les champs explicitement fournis.
    const patch: Record<string, unknown> = {}
    if (input.activatedAt !== UNSET) patch.activatedAt = input.activatedAt
    if (input.issuedAt !== UNSET) patch.issuedAt = input.issuedAt
    if (input.dueAt !== UNSET) patch.dueAt = input.dueAt
    if (input.status !== UNSET) patch.status = input.status
    if (input.notes !== UNSET) patch.notes = input.notes

    if (Object.keys(patch).length === 0) {
      throw new HttpsError('invalid-argument', '[updateDue] no field to update')
    }

    const dueRef = db().doc(`dues/${input.dueId}`)

    try {
      // Lecture préalable pour distinguer `not-found` d'une rules-error
      // côté Admin SDK (qui bypass les rules, mais on veut un code propre).
      const dueSnap = await dueRef.get()
      if (!dueSnap.exists) {
        throw new HttpsError('not-found', `[updateDue] due ${input.dueId} not found`)
      }
      await dueRef.update(patch)
    } catch (err) {
      if (err instanceof HttpsError) throw err
      const code = errCode(err)
      logger.error(`[updateDue] update failed [${code}]`, { err, dueId: input.dueId })
      throw new HttpsError('internal', `[updateDue] update failed [${code}]`)
    }

    logger.info('[updateDue] ok', {
      dueId: input.dueId,
      callerUid,
      fields: Object.keys(patch),
    })

    return { ok: true }
  },
)
