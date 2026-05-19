/**
 * `coachUpdateMember` — callable permettant à un coach (ou un admin) de
 * modifier les champs "de base" d'un membre de l'une de ses équipes.
 *
 * Périmètre volontairement étroit : un coach ne touche **que** l'identité de
 * base et le contact du joueur, plus le routage des comms générales. Tout le
 * reste (licence, rôles, billing, statut, AVS, transfert…) reste réservé à
 * l'admin via l'app web.
 *
 * Champs éditables (même whitelist pour coach ET admin — l'admin a la web app
 * pour le reste) :
 *  - `firstName`, `lastName`, `birthDate` → doc `/members/{id}`
 *  - `email`, `phone`                     → sub `/members/{id}/private/contact`
 *  - `comms.generalRecipients`            → doc `/members/{id}`
 *
 * NON éditable ici : `comms.billingRecipients`, `comms.majorityTransition`
 * (la transition majorité est pilotée ailleurs — on ne recalcule jamais
 * `comms` depuis `birthDate` ici).
 *
 * Auth : signed-in + `assertCoachOrAdminOfMember` (scope team via
 * `user.teamIds` ∩ `team.playerIds`).
 *
 * Sémantique wire :
 *  - champ absent          ⇒ non modifié.
 *  - `null` (birthDate / email / phone) ⇒ efface / vide le champ.
 *  - `birthDate` : epoch millis (cf. convention `updateDue`).
 *
 * Idempotence : un update partiel est naturellement idempotent (même payload
 * ⇒ même état final). Aucun champ `updatedAt` / `updatedBy` ajouté au schéma.
 *
 * Region : europe-west6 (héritée du `setGlobalOptions` dans `src/index.ts`).
 *
 * NOTE deploy : nouvelle Function v2 → après le premier deploy, ajouter le
 * binding IAM `allUsers/run.invoker` (cf. `functions/CLAUDE.md` §"Après deploy").
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import type { CommsRecipient, MemberData } from '@club-app/shared-types'
import { Timestamp, db } from '../registrations/_helpers'
import { assertCoachOrAdminOfMember, loadCallerUser } from './_coachAuth'

// =============================================================================
// I/O
// =============================================================================

interface CoachUpdateMemberInput {
  memberId: unknown
  firstName?: unknown
  lastName?: unknown
  birthDate?: unknown
  email?: unknown
  phone?: unknown
  comms?: unknown
}

export interface CoachUpdateMemberOutput {
  ok: true
  memberId: string
}

/** Sentinelle "champ non fourni" pour le diff partiel. */
const UNSET = Symbol('unset')

interface ParsedInput {
  memberId: string
  firstName: string | typeof UNSET
  lastName: string | typeof UNSET
  /** `null` = effacer la date de naissance. */
  birthDate: FirebaseFirestore.Timestamp | null | typeof UNSET
  /** `null` = vider le champ contact. */
  email: string | null | typeof UNSET
  /** `null` = vider le champ contact. */
  phone: string | null | typeof UNSET
  generalRecipients: CommsRecipient[] | typeof UNSET
}

const VALID_RECIPIENTS: readonly CommsRecipient[] = ['member', 'guardians']

/** Parse un champ texte requis non vide (firstName / lastName). */
function parseName(value: unknown, field: string): string | typeof UNSET {
  if (value === undefined) return UNSET
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${field} must be a string`)
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new HttpsError('invalid-argument', `${field} cannot be empty`)
  }
  return trimmed
}

/** Parse une chaîne contact nullable : `null`/'' ⇒ vide le champ. */
function parseContactField(value: unknown, field: string): string | null | typeof UNSET {
  if (value === undefined) return UNSET
  if (value === null) return null
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${field} must be a string or null`)
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Parse `comms.generalRecipients` : array non vide de `'member'`/`'guardians'`. */
function parseGeneralRecipients(comms: unknown): CommsRecipient[] | typeof UNSET {
  if (comms === undefined) return UNSET
  if (comms === null || typeof comms !== 'object') {
    throw new HttpsError('invalid-argument', 'comms must be an object')
  }
  const value = (comms as { generalRecipients?: unknown }).generalRecipients
  if (value === undefined) return UNSET
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpsError(
      'invalid-argument',
      'comms.generalRecipients must be a non-empty array',
    )
  }
  for (const r of value) {
    if (typeof r !== 'string' || !VALID_RECIPIENTS.includes(r as CommsRecipient)) {
      throw new HttpsError(
        'invalid-argument',
        `comms.generalRecipients must only contain: ${VALID_RECIPIENTS.join(', ')}`,
      )
    }
  }
  // Déduplique tout en gardant l'ordre.
  return Array.from(new Set(value as CommsRecipient[]))
}

function parseInput(data: CoachUpdateMemberInput): ParsedInput {
  const d = data ?? ({} as CoachUpdateMemberInput)
  if (typeof d.memberId !== 'string' || d.memberId.length === 0) {
    throw new HttpsError('invalid-argument', 'memberId is required')
  }

  let birthDate: FirebaseFirestore.Timestamp | null | typeof UNSET = UNSET
  if (d.birthDate !== undefined) {
    if (d.birthDate === null) {
      birthDate = null
    } else if (typeof d.birthDate !== 'number' || !Number.isFinite(d.birthDate)) {
      throw new HttpsError(
        'invalid-argument',
        'birthDate must be an epoch-millis number or null',
      )
    } else {
      birthDate = Timestamp.fromMillis(d.birthDate)
    }
  }

  return {
    memberId: d.memberId,
    firstName: parseName(d.firstName, 'firstName'),
    lastName: parseName(d.lastName, 'lastName'),
    birthDate,
    email: parseContactField(d.email, 'email'),
    phone: parseContactField(d.phone, 'phone'),
    generalRecipients: parseGeneralRecipients(d.comms),
  }
}

// =============================================================================
// Callable
// =============================================================================

export const coachUpdateMember = onCall(
  async (
    request: CallableRequest<CoachUpdateMemberInput>,
  ): Promise<CoachUpdateMemberOutput> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', '[coachUpdateMember] Must be signed in.')
    }
    const callerUid = request.auth.uid
    const input = parseInput(request.data)

    // Construit les patches whitelistés avant la moindre I/O coûteuse.
    const memberPatch: Record<string, unknown> = {}
    if (input.firstName !== UNSET) memberPatch.firstName = input.firstName
    if (input.lastName !== UNSET) memberPatch.lastName = input.lastName
    if (input.birthDate !== UNSET) memberPatch.birthDate = input.birthDate
    if (input.generalRecipients !== UNSET) {
      // Patch ciblé sur le sous-champ — ne touche pas billingRecipients /
      // majorityTransition.
      memberPatch['comms.generalRecipients'] = input.generalRecipients
    }

    const contactPatch: Record<string, unknown> = {}
    if (input.email !== UNSET) contactPatch.email = input.email
    if (input.phone !== UNSET) contactPatch.phone = input.phone

    if (Object.keys(memberPatch).length === 0 && Object.keys(contactPatch).length === 0) {
      throw new HttpsError('invalid-argument', '[coachUpdateMember] no editable field provided')
    }

    // Auth : charge le user une fois, réutilise-le pour la garde scope.
    const user = await loadCallerUser(callerUid)
    await assertCoachOrAdminOfMember(
      { uid: callerUid, token: request.auth.token },
      input.memberId,
      user,
    )

    const memberRef = db().doc(`members/${input.memberId}`)
    const contactRef = db().doc(`members/${input.memberId}/private/contact`)

    try {
      await db().runTransaction(async (tx) => {
        // [READS] — toutes les lectures avant les writes (contrainte Firestore).
        const memberSnap = await tx.get(memberRef)
        if (!memberSnap.exists) {
          throw new HttpsError(
            'not-found',
            `[coachUpdateMember] member ${input.memberId} not found`,
          )
        }
        // On valide juste l'existence ; aucune lecture du contact requise
        // (le set merge crée le doc s'il n'existe pas encore).
        const member = memberSnap.data() as MemberData
        void member

        // [WRITES]
        if (Object.keys(memberPatch).length > 0) {
          // Patch hétérogène (clés dotted + valeurs Timestamp/string/array) :
          // on relâche le typage strict de `tx.update` via `UpdateData`.
          tx.update(memberRef, memberPatch as FirebaseFirestore.UpdateData<MemberData>)
        }
        if (Object.keys(contactPatch).length > 0) {
          tx.set(contactRef, contactPatch, { merge: true })
        }
      })
    } catch (err) {
      if (err instanceof HttpsError) throw err
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: unknown }).code)
          : 'unknown'
      logger.error(`[coachUpdateMember] failed [${code}]`, {
        callerUid,
        memberId: input.memberId,
        err: err instanceof Error ? err.message : String(err),
      })
      throw new HttpsError('internal', '[coachUpdateMember] update failed unexpectedly')
    }

    logger.info('[coachUpdateMember] ok', {
      callerUid,
      memberId: input.memberId,
      memberFields: Object.keys(memberPatch),
      contactFields: Object.keys(contactPatch),
    })

    return { ok: true, memberId: input.memberId }
  },
)
