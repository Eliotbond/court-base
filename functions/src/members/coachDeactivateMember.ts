/**
 * `coachDeactivateMember` — callable permettant à un coach (ou un admin) de
 * retirer un membre de l'activité, selon deux modes :
 *
 *  - `bench` : "mise au banc". Pose seulement `active: false`. Le membre
 *    reste sur `team.playerIds`, son `status` reste `'active'`. Réversible
 *    trivialement (l'admin / coach repasse `active` à true ailleurs).
 *
 *  - `archive` : fin d'adhésion. Pose `status: 'archived'`, `archivedAt`,
 *    `archivedReason`, `archivedByUid`, et `active: false`. Le membre N'est
 *    PAS retiré de `team.playerIds` (on conserve l'historique d'équipe).
 *    `reason` (texte non vide) est obligatoire.
 *
 * Le flag `active` et `status` sont orthogonaux (cf. `MemberData` docstring) :
 * un membre archivé est par convention `active: false`.
 *
 * Auth : signed-in + `assertCoachOrAdminOfMember` (scope team via
 * `user.teamIds` ∩ `team.playerIds`).
 *
 * Idempotence : si le membre est déjà dans l'état cible (déjà benché / déjà
 * archivé), la transaction ne réécrit rien et renvoie un succès — re-run safe.
 *
 * Region : europe-west6 (héritée du `setGlobalOptions` dans `src/index.ts`).
 *
 * NOTE deploy : nouvelle Function v2 → après le premier deploy, ajouter le
 * binding IAM `allUsers/run.invoker` (cf. `functions/CLAUDE.md` §"Après deploy").
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import type { MemberData } from '@club-app/shared-types'
import { Timestamp, db } from '../registrations/_helpers'
import { assertCoachOrAdminOfMember, loadCallerUser } from './_coachAuth'

// =============================================================================
// I/O
// =============================================================================

type DeactivateMode = 'bench' | 'archive'

interface CoachDeactivateMemberInput {
  memberId: unknown
  mode: unknown
  reason?: unknown
}

export interface CoachDeactivateMemberOutput {
  ok: true
  memberId: string
  mode: DeactivateMode
}

interface ParsedInput {
  memberId: string
  mode: DeactivateMode
  /** Toujours présent et non vide pour `archive` ; `null` pour `bench`. */
  reason: string | null
}

const VALID_MODES: readonly DeactivateMode[] = ['bench', 'archive']

function parseInput(data: CoachDeactivateMemberInput): ParsedInput {
  const d = data ?? ({} as CoachDeactivateMemberInput)
  if (typeof d.memberId !== 'string' || d.memberId.length === 0) {
    throw new HttpsError('invalid-argument', 'memberId is required')
  }
  if (typeof d.mode !== 'string' || !VALID_MODES.includes(d.mode as DeactivateMode)) {
    throw new HttpsError(
      'invalid-argument',
      `mode must be one of: ${VALID_MODES.join(', ')}`,
    )
  }
  const mode = d.mode as DeactivateMode

  let reason: string | null = null
  if (mode === 'archive') {
    if (typeof d.reason !== 'string' || d.reason.trim().length === 0) {
      throw new HttpsError(
        'invalid-argument',
        'reason is required (non-empty text) when mode is "archive"',
      )
    }
    reason = d.reason.trim()
  }

  return { memberId: d.memberId, mode, reason }
}

// =============================================================================
// Callable
// =============================================================================

export const coachDeactivateMember = onCall(
  async (
    request: CallableRequest<CoachDeactivateMemberInput>,
  ): Promise<CoachDeactivateMemberOutput> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', '[coachDeactivateMember] Must be signed in.')
    }
    const callerUid = request.auth.uid
    const input = parseInput(request.data)

    // Auth : charge le user une fois, réutilise-le pour la garde scope.
    const user = await loadCallerUser(callerUid)
    await assertCoachOrAdminOfMember(
      { uid: callerUid, token: request.auth.token },
      input.memberId,
      user,
    )

    const memberRef = db().doc(`members/${input.memberId}`)

    try {
      await db().runTransaction(async (tx) => {
        // [READS]
        const memberSnap = await tx.get(memberRef)
        if (!memberSnap.exists) {
          throw new HttpsError(
            'not-found',
            `[coachDeactivateMember] member ${input.memberId} not found`,
          )
        }
        const member = memberSnap.data() as MemberData

        // [WRITES] — idempotence : si déjà dans l'état cible, no-op.
        if (input.mode === 'bench') {
          if (member.active === false) {
            // Déjà benché — re-run safe, on ne réécrit rien.
            return
          }
          tx.update(memberRef, { active: false })
          return
        }

        // mode === 'archive'
        if (member.status === 'archived') {
          // Déjà archivé — re-run safe, on ne réécrit rien.
          return
        }
        tx.update(memberRef, {
          status: 'archived',
          archivedAt: Timestamp.now(),
          archivedReason: input.reason,
          archivedByUid: callerUid,
          active: false,
        })
      })
    } catch (err) {
      if (err instanceof HttpsError) throw err
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: unknown }).code)
          : 'unknown'
      logger.error(`[coachDeactivateMember] failed [${code}]`, {
        callerUid,
        memberId: input.memberId,
        mode: input.mode,
        err: err instanceof Error ? err.message : String(err),
      })
      throw new HttpsError(
        'internal',
        '[coachDeactivateMember] deactivation failed unexpectedly',
      )
    }

    logger.info('[coachDeactivateMember] ok', {
      callerUid,
      memberId: input.memberId,
      mode: input.mode,
    })

    return { ok: true, memberId: input.memberId, mode: input.mode }
  },
)
