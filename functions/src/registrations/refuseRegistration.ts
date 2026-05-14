/**
 * `refuseRegistration`
 *
 * Callable invoquée par un coach pour refuser une registration en attente
 * d'acceptation. Effets transactionnels :
 *
 *  1. `registration.status = 'refused'` + `refusalReason` + `refusedByUid`.
 *  2. Écrit `/teams/{teamId}/refusalLogs/{logId}` (audit gated admin-only —
 *     cf. `firestore.rules` §refusalLogs).
 *  3. Append entrée `actionLog` (action: 'refused').
 *  4. Crée notif `registration_refused` pour `submittedByUid`.
 *  5. Enqueue email `registration_refused` dans `/pendingEmails`.
 *  6. (TODO) Auto-rerouting si une autre team `open` existe dans la même
 *     `categoryId` — déclenché par le trigger `onRegistrationStatusChanged`
 *     plutôt qu'ici, pour garder cette callable focalisée sur l'écriture
 *     synchrone et le log.
 *
 * Auth : signed-in. Le caller doit être coach de la team
 * (`team.coachIds.includes(callerMemberId)`) OU admin.
 *
 * State preconditions : `status` ∈ {`submitted`, `conditional_pending_review`,
 * `open_pending_trial`, `conditional_pending_trial`, `trial_in_progress`}.
 * Un refus sur `active` ou `refused` est rejeté en `failed-precondition`.
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import type {
  RefusalLogData,
  RegistrationActionLogEntry,
  RegistrationData,
  RegistrationStatus,
  TeamData,
  UserData,
} from '@club-app/shared-types'
import { Timestamp, db, serverTimestamp } from './_helpers'

interface RefuseRegistrationInput {
  registrationId: unknown
  reason: unknown
}

export interface RefuseRegistrationOutput {
  ok: true
  registrationId: string
  refusalLogId: string
}

const REFUSABLE_STATUSES: readonly RegistrationStatus[] = [
  'submitted',
  'open_pending_trial',
  'conditional_pending_review',
  'conditional_pending_trial',
  'trial_in_progress',
]

function parseInput(data: RefuseRegistrationInput): { registrationId: string; reason: string } {
  const d = data ?? ({} as RefuseRegistrationInput)
  if (typeof d.registrationId !== 'string' || d.registrationId.length === 0) {
    throw new HttpsError('invalid-argument', 'registrationId is required')
  }
  if (typeof d.reason !== 'string' || d.reason.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'reason is required (text non-empty)')
  }
  return { registrationId: d.registrationId, reason: d.reason.trim() }
}

/**
 * Détermine si l'utilisateur courant est autorisé à refuser une registration
 * sur cette team. Admin OU coach attaché à la team (via `/users.teamIds`).
 * On résout `userDoc.roles` + `teamIds` pour ne pas dépendre du claim côté
 * Auth (qui n'est posé qu'en cas de rootAdmin).
 */
function assertCoachOrAdmin(user: UserData, teamId: string): void {
  if (user.roles?.includes('admin')) return
  if (user.roles?.includes('coach') && (user.teamIds ?? []).includes(teamId)) return
  throw new HttpsError(
    'permission-denied',
    'Caller is neither admin nor coach of this team.',
  )
}

export const refuseRegistration = onCall(
  async (
    request: CallableRequest<RefuseRegistrationInput>,
  ): Promise<RefuseRegistrationOutput> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.')
    }
    const callerUid = request.auth.uid
    const { registrationId, reason } = parseInput(request.data)

    // Précharge user doc hors transaction (rôles stables pendant le call).
    const userSnap = await db().doc(`users/${callerUid}`).get()
    if (!userSnap.exists) {
      throw new HttpsError('permission-denied', 'No /users doc for caller.')
    }
    const userData = userSnap.data() as UserData

    const registrationRef = db().doc(`registrations/${registrationId}`)
    let actualRefusalLogId = ''

    await db().runTransaction(async (tx) => {
      const regSnap = await tx.get(registrationRef)
      if (!regSnap.exists) {
        throw new HttpsError('not-found', `registration ${registrationId} not found`)
      }
      const reg = regSnap.data() as RegistrationData

      assertCoachOrAdmin(userData, reg.teamId)

      if (!REFUSABLE_STATUSES.includes(reg.status)) {
        throw new HttpsError(
          'failed-precondition',
          `cannot refuse registration in status '${reg.status}'`,
        )
      }

      // Vérifier la team existe (et qu'elle est cohérente avec la registration).
      const teamRef = db().doc(`teams/${reg.teamId}`)
      const teamSnap = await tx.get(teamRef)
      if (!teamSnap.exists) {
        throw new HttpsError('internal', `team ${reg.teamId} disappeared`)
      }
      // (team utilisé en lecture pour cohérence ; pas modifié ici.)
      const _team = teamSnap.data() as TeamData
      void _team

      // [READ] Lis le member rattaché avant tout write (Firestore exige toutes
      // les lectures avant les writes dans une transaction).
      let memberToArchiveRef: FirebaseFirestore.DocumentReference | null = null
      if (typeof reg.matchedMemberId === 'string' && reg.matchedMemberId.length > 0) {
        const memberRef = db().doc(`members/${reg.matchedMemberId}`)
        const memberSnap = await tx.get(memberRef)
        if (memberSnap.exists) {
          memberToArchiveRef = memberRef
        }
      }

      const now = Timestamp.now()
      const previousStatus = reg.status
      const refusalLogDoc = teamRef.collection('refusalLogs').doc()
      actualRefusalLogId = refusalLogDoc.id

      const refusalLog: RefusalLogData = {
        registrationId,
        playerName: `${reg.player.firstName} ${reg.player.lastName}`,
        reason,
        refusedAt: now,
        refusedByUid: callerUid,
      }
      tx.set(refusalLogDoc, refusalLog)

      const action: RegistrationActionLogEntry = {
        at: now,
        byUid: callerUid,
        action: 'refused',
        previousStatus,
        newStatus: 'refused',
        note: reason,
      }
      tx.update(registrationRef, {
        status: 'refused',
        statusUpdatedAt: now,
        refusalReason: reason,
        refusedByUid: callerUid,
        actionLog: [...(reg.actionLog ?? []), action],
      })

      // [WRITE] Archive le member rattaché si présent (lecture faite plus haut).
      // shared-types ajoute `status: 'active' | 'archived'` + archive metadata
      // en parallèle ; on écrit les champs au runtime (Firestore est
      // schema-less, le subagent types les expose côté lecture).
      if (memberToArchiveRef) {
        tx.update(memberToArchiveRef, {
          status: 'archived',
          archivedAt: now,
          archivedReason: reason,
          archivedByUid: callerUid,
          // Désactive le member (compat code legacy qui lit `active` boolean).
          active: false,
        })
      }

      // Notif au submitter.
      const notifRef = db().collection('notifications').doc(
        `${registrationId}_refused_${reg.submittedByUid}`,
      )
      tx.set(notifRef, {
        type: 'registration_refused',
        recipientUid: reg.submittedByUid,
        payload: {
          registrationId,
          teamId: reg.teamId,
          reason,
          refusedByUid: callerUid,
        },
        readBy: [],
        createdAt: serverTimestamp(),
      })

      // Email au submitter.
      const pendingEmailRef = db().doc(
        `pendingEmails/${registrationId}_registration_refused`,
      )
      tx.set(pendingEmailRef, {
        to: null,  // résolution to-from-uid faite par le worker email
        template: 'registration_refused',
        context: {
          registrationId,
          submittedByUid: reg.submittedByUid,
          teamId: reg.teamId,
          playerName: `${reg.player.firstName} ${reg.player.lastName}`,
          reason,
        },
        createdAt: serverTimestamp(),
        sentAt: null,
      })
    })

    logger.info('refuseRegistration: refused', {
      registrationId,
      callerUid,
      refusalLogId: actualRefusalLogId,
    })

    return {
      ok: true,
      registrationId,
      refusalLogId: actualRefusalLogId,
    }
  },
)
