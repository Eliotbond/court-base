/**
 * `acceptReplacement` — callable atomic transfer d'une assignation officiel
 * via une demande de remplacement `/replacementRequests/{requestId}`.
 *
 * Workflow :
 *   1. La cible (`targetMemberId`) accepte la demande.
 *   2. La transaction Firestore exécute en un coup :
 *      - marque la demande `accepted` (+ `respondedAt`)
 *      - decline l'assignation d'origine du demandeur
 *      - crée la nouvelle assignation pour la cible (status `confirmed`)
 *
 * Decline (par la cible) et cancel (par le demandeur) ne passent PAS par
 * cette callable — ce sont des writes client-direct, autorisés par les
 * rules `/replacementRequests` (cf. `firestore.rules`).
 *
 * Auth : signed-in + `request.auth.uid` lié au `targetMemberId` via
 * `/users/{uid}.memberId`. Sinon `permission-denied`.
 *
 * Erreurs typées :
 *  - `unauthenticated`     : pas de `request.auth`
 *  - `invalid-argument`    : `requestId` manquant / mal formé
 *  - `not-found`           : demande ou assignation d'origine introuvable
 *  - `failed-precondition` : `status !== 'pending'`
 *  - `permission-denied`   : caller pas lié au `targetMemberId`
 *
 * Region : `europe-west6` (héritée de `setGlobalOptions` dans `src/index.ts`).
 *
 * NOTE deploy : nouvelle Function v2 → après le premier deploy, ajouter le
 * binding IAM `allUsers/run.invoker` (cf. `functions/CLAUDE.md`).
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'

import type {
  OfficialAssignmentData,
  ReplacementRequestData,
  UserData,
} from '@club-app/shared-types'
import { db, serverTimestamp } from '../dues/_helpers'

interface AcceptReplacementInput {
  requestId: unknown
}

export interface AcceptReplacementOutput {
  ok: true
  /** ID du nouveau doc d'assignation créé pour la cible (== `targetMemberId`). */
  newAssignmentId: string
}

interface ParsedInput {
  requestId: string
}

function parseInput(data: AcceptReplacementInput): ParsedInput {
  const d = data ?? ({} as AcceptReplacementInput)
  if (typeof d.requestId !== 'string' || d.requestId.length === 0) {
    throw new HttpsError('invalid-argument', '[acceptReplacement] requestId is required')
  }
  return { requestId: d.requestId }
}

/**
 * Path de la sub-collection d'assignations selon le `parentKind`.
 *  - `home` : `bookings/{parentId}/officialAssignments`
 *  - `away` : `matches/{parentId}/officialAssignments`
 */
function assignmentsPath(parentKind: 'home' | 'away', parentId: string): string {
  return parentKind === 'home'
    ? `bookings/${parentId}/officialAssignments`
    : `matches/${parentId}/officialAssignments`
}

export const acceptReplacement = onCall(
  async (
    request: CallableRequest<AcceptReplacementInput>,
  ): Promise<AcceptReplacementOutput> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', '[acceptReplacement] Must be signed in.')
    }
    const callerUid = request.auth.uid
    const { requestId } = parseInput(request.data)

    // Pré-charge le user doc hors transaction (stable pendant le call).
    const userSnap = await db().doc(`users/${callerUid}`).get()
    if (!userSnap.exists) {
      throw new HttpsError(
        'permission-denied',
        '[acceptReplacement] caller has no /users/{uid} doc',
      )
    }
    const user = userSnap.data() as UserData
    const callerMemberId = user.memberId ?? null
    if (!callerMemberId) {
      throw new HttpsError(
        'permission-denied',
        '[acceptReplacement] caller is not linked to any member',
      )
    }

    const requestRef = db().doc(`replacementRequests/${requestId}`)
    let newAssignmentId = ''

    try {
      await db().runTransaction(async (tx) => {
        // --- READS (toujours avant les writes dans une transaction) ---
        const reqSnap = await tx.get(requestRef)
        if (!reqSnap.exists) {
          throw new HttpsError(
            'not-found',
            `[acceptReplacement] replacementRequest ${requestId} not found`,
          )
        }
        const reqData = reqSnap.data() as ReplacementRequestData

        // Auth scopée : caller doit être lié au targetMemberId.
        if (reqData.targetMemberId !== callerMemberId) {
          throw new HttpsError(
            'permission-denied',
            '[acceptReplacement] caller is not the target of this replacement request',
          )
        }

        // Lifecycle : pending strict.
        if (reqData.status !== 'pending') {
          throw new HttpsError(
            'failed-precondition',
            `[acceptReplacement] cannot accept in status '${reqData.status}' — must be 'pending'`,
          )
        }

        // Lookup de l'assignation d'origine.
        const originalRef = db().doc(
          `${assignmentsPath(reqData.parentKind, reqData.parentId)}/${reqData.originalAssignmentId}`,
        )
        const originalSnap = await tx.get(originalRef)
        if (!originalSnap.exists) {
          throw new HttpsError(
            'not-found',
            `[acceptReplacement] original assignment ${reqData.originalAssignmentId} not found`,
          )
        }
        const original = originalSnap.data() as OfficialAssignmentData

        // --- WRITES ---
        const now = serverTimestamp()

        // 1. Marquer la demande accepted.
        tx.update(requestRef, {
          status: 'accepted',
          respondedAt: now,
        })

        // 2. Decline l'assignation d'origine. On marque `respondedAt` aussi
        //    pour cohérence avec le path normal "decline" (les UI de listing
        //    s'appuient sur ce champ pour trier les réponses).
        tx.update(originalRef, {
          status: 'declined',
          respondedAt: now,
        })

        // 3. Créer la nouvelle assignation pour la cible. ID déterministe =
        //    targetMemberId (cohérent avec la convention `selfRegister`
        //    côté repo, et idempotent : un re-accept écraserait avec les
        //    mêmes valeurs).
        const newRef = db().doc(
          `${assignmentsPath(reqData.parentKind, reqData.parentId)}/${reqData.targetMemberId}`,
        )
        const newAssign: OfficialAssignmentData = {
          memberId: reqData.targetMemberId,
          officialLevel: original.officialLevel,
          status: 'confirmed',
          assignedAt: now as unknown as FirebaseFirestore.Timestamp,
          assignedBy: reqData.targetMemberId,
          respondedAt: now as unknown as FirebaseFirestore.Timestamp,
        }
        tx.set(newRef, newAssign)

        newAssignmentId = reqData.targetMemberId
      })
    } catch (err) {
      if (err instanceof HttpsError) throw err
      const msg = err instanceof Error ? err.message : 'unknown'
      logger.error(`[acceptReplacement] transaction failed [${msg}]`, {
        err,
        requestId,
        callerUid,
      })
      throw new HttpsError('internal', '[acceptReplacement] transaction failed')
    }

    logger.info('[acceptReplacement] ok', {
      requestId,
      callerUid,
      newAssignmentId,
    })

    return { ok: true, newAssignmentId }
  },
)
