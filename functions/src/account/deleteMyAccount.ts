/**
 * `deleteMyAccount`
 *
 * Callable invoquée par un **user signed-in** depuis l'app
 * `apps/courtbase-register` pour **supprimer définitivement son propre
 * compte** (Auth + Firestore). Flow self-service RGPD.
 *
 * **IRRÉVERSIBLE.** Au retour, le user est déconnecté et son compte Firebase
 * Auth est détruit — pour revenir, il devra recréer un compte de zéro.
 *
 * ## Garde-fous
 *
 *  1. Auth requise.
 *  2. `confirmText` doit valoir littéralement `"SUPPRIMER"` (anti-fat-finger).
 *  3. Aucun member ne doit avoir `callerUid` dans `guardianUserIds`. Le user
 *     doit d'abord se délier de tous ses pupilles via `unlinkGuardian`.
 *     → `failed-precondition` sinon, avec le compte d'enfants restants.
 *  4. Si un member est lié au caller (`linkedUserId === callerUid`) ET qu'au
 *     moins un due lié à ce member est `status === 'paid'` :
 *     → `failed-precondition`. L'historique comptable ne doit pas être
 *     détruit ; le user doit contacter le club pour passer par l'archive.
 *
 * ## Cleanup transactionnel
 *
 * Tout dans une seule transaction Firestore (atomicité). L'opération
 * `admin.auth().deleteUser()` est faite **après** la transaction (l'API
 * Auth n'est pas transactionnelle avec Firestore — best-effort, en cas
 * d'échec on log mais Firestore reste cohérent).
 *
 *  - Si linked member : même cleanup que la callable admin `deleteMember` :
 *    - `tx.delete(/members/{linkedMemberId})`,
 *    - `arrayRemove(memberId)` sur `playerIds`/`coachIds` des teams concernées,
 *    - registrations `matchedMemberId === memberId` : `matchedMemberId = null`
 *      + append `actionLog` (préserve l'historique),
 *    - dues non-paid liés au member : `tx.delete` + best-effort suppression
 *      des `/pendingEmails` à IDs déterministes.
 *  - Registrations en statut `draft` créées par le caller : `tx.delete`
 *    (drafts personnels, aucune valeur d'audit).
 *  - Sub `/users/{uid}/fcmTokens/*` : `tx.delete` de chaque token (queryés
 *    hors tx, supprimés dans la tx).
 *  - `tx.delete(/users/{callerUid})`.
 *
 * Après tx : `admin.auth().deleteUser(callerUid)`. Si ça échoue, on log mais
 * on retourne quand même `ok: true` — Firestore est déjà cohérent, et l'admin
 * peut nettoyer l'orphelin Auth manuellement. Trigger
 * `syncUserRolesFromMember` n'écrasera plus le doc /users (déjà supprimé).
 *
 * Log structuré `[deleteMyAccount]` après succès.
 *
 * Déploiement (Functions v2 nouvelle) : repacker shared-types en tarball +
 * `gcloud run services add-iam-policy-binding deletemyaccount \
 *    --member=allUsers --role=roles/run.invoker --region=europe-west6 \
 *    --project=<projectId>` sinon `internal` (cf. mémoire
 * `deploy_functions_v2_invoker_binding`).
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import * as admin from 'firebase-admin'
import type {
  CotisationData as DueData,
  CotisationStatus as DueStatus,
  MemberData,
  RegistrationActionLogEntry,
  RegistrationData,
  UserData,
} from '@club-app/shared-types'

function dbf(): FirebaseFirestore.Firestore {
  return admin.firestore()
}

function now(): FirebaseFirestore.Timestamp {
  return admin.firestore.Timestamp.now()
}

// =============================================================================
// I/O
// =============================================================================

interface DeleteMyAccountInput {
  /**
   * Le user doit retaper exactement `"SUPPRIMER"` (anti-fat-finger). Comparé
   * en strict-equal après trim — pas de normalisation casse / accents.
   */
  confirmText: unknown
}

export interface DeleteMyAccountOutput {
  ok: true
  /** UID supprimé (utile pour le toast côté client après signOut). */
  deletedUid: string
  /** True si un /members/{id} a été supprimé en cascade. */
  hadLinkedMember: boolean
  removedFromTeamsCount: number
  unlinkedRegistrationsCount: number
  deletedDuesCount: number
  deletedDraftsCount: number
  deletedFcmTokensCount: number
  /**
   * False si l'appel `admin.auth().deleteUser()` a échoué après le cleanup
   * Firestore. Le client doit quand même signOut + redirect ; un admin
   * pourra ensuite supprimer l'orphelin Auth depuis la console.
   */
  authDeleted: boolean
}

const REQUIRED_CONFIRM_TEXT = 'SUPPRIMER'

const NON_PAID_DUE_STATUSES: readonly DueStatus[] = [
  'pending_grace',
  'issued',
  'overdue',
  'excepted',
  'cancelled',
]

function parseInput(data: DeleteMyAccountInput): { confirmText: string } {
  const d = data ?? ({} as DeleteMyAccountInput)
  if (typeof d.confirmText !== 'string') {
    throw new HttpsError('invalid-argument', 'confirmText is required (string)')
  }
  return { confirmText: d.confirmText.trim() }
}

// =============================================================================
// Callable
// =============================================================================

export const deleteMyAccount = onCall(
  async (
    request: CallableRequest<DeleteMyAccountInput>,
  ): Promise<DeleteMyAccountOutput> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.')
    }
    const callerUid = request.auth.uid
    const { confirmText } = parseInput(request.data)
    if (confirmText !== REQUIRED_CONFIRM_TEXT) {
      throw new HttpsError(
        'invalid-argument',
        `confirmText doit valoir exactement "${REQUIRED_CONFIRM_TEXT}"`,
      )
    }

    try {
      // -----------------------------------------------------------------
      // Préchecks hors transaction.
      // -----------------------------------------------------------------
      const userRef = dbf().doc(`users/${callerUid}`)
      const userSnap = await userRef.get()
      // Pas de /users/{uid} : on accepte (cas exotique où le user a auth mais
      // jamais complété ProfileSetup). On nettoie quand même les éventuels
      // residus (drafts, guardian links — impossible logiquement, mais safe)
      // puis on delete l'Auth account.
      const userDoc = userSnap.exists ? (userSnap.data() as UserData) : null
      const linkedMemberId = userDoc?.memberId ?? null

      // 1) Aucun pupille restant (le caller ne doit pas être listé dans
      //    `guardianUserIds` d'un autre member).
      const dependentsSnap = await dbf()
        .collection('members')
        .where('guardianUserIds', 'array-contains', callerUid)
        .get()
      if (!dependentsSnap.empty) {
        throw new HttpsError(
          'failed-precondition',
          `Vous avez encore ${dependentsSnap.size} enfant(s) lié(s) à votre compte. ` +
            `Déliez-les d'abord avant de supprimer votre compte.`,
        )
      }

      // 2) Linked member : pas de due `paid` (préservation comptable).
      let linkedMember: MemberData | null = null
      let duesToDelete: { id: string; data: DueData }[] = []
      let teamRefsForLinked: FirebaseFirestore.DocumentReference[] = []
      let regRefsForLinked: FirebaseFirestore.DocumentReference[] = []
      if (linkedMemberId) {
        const memberSnap = await dbf().doc(`members/${linkedMemberId}`).get()
        if (memberSnap.exists) {
          linkedMember = memberSnap.data() as MemberData

          const duesSnap = await dbf()
            .collection('dues')
            .where('memberId', '==', linkedMemberId)
            .get()
          const dueDocs: { id: string; data: DueData }[] = duesSnap.docs.map(
            (doc) => ({ id: doc.id, data: doc.data() as DueData }),
          )
          const hasPaid = dueDocs.some((d) => d.data.status === 'paid')
          if (hasPaid) {
            throw new HttpsError(
              'failed-precondition',
              'Votre profil joueur a des cotisations déjà payées. ' +
                'Contactez le club pour qu\'il archive votre profil au lieu de le supprimer (préservation comptable).',
            )
          }
          duesToDelete = dueDocs.filter((d) =>
            NON_PAID_DUE_STATUSES.includes(d.data.status),
          )

          const teamsPlayerSnap = await dbf()
            .collection('teams')
            .where('playerIds', 'array-contains', linkedMemberId)
            .get()
          const teamsCoachSnap = await dbf()
            .collection('teams')
            .where('coachIds', 'array-contains', linkedMemberId)
            .get()
          const teamRefsById = new Map<
            string,
            FirebaseFirestore.DocumentReference
          >()
          for (const doc of teamsPlayerSnap.docs) {
            teamRefsById.set(doc.id, doc.ref)
          }
          for (const doc of teamsCoachSnap.docs) {
            teamRefsById.set(doc.id, doc.ref)
          }
          teamRefsForLinked = Array.from(teamRefsById.values())

          const regsSnap = await dbf()
            .collection('registrations')
            .where('matchedMemberId', '==', linkedMemberId)
            .get()
          regRefsForLinked = regsSnap.docs.map((doc) => doc.ref)
        }
      }

      // 3) Drafts de registrations créés par le caller — à supprimer
      //    (personnel, aucune valeur d'audit, rule register autorise déjà).
      const draftsSnap = await dbf()
        .collection('registrations')
        .where('submittedByUid', '==', callerUid)
        .where('status', '==', 'draft')
        .get()
      const draftRefs = draftsSnap.docs.map((doc) => doc.ref)

      // 4) Sub /users/{uid}/fcmTokens/* — listés hors tx, supprimés dedans.
      const fcmSnap = await userRef.collection('fcmTokens').get()
      const fcmRefs = fcmSnap.docs.map((doc) => doc.ref)

      // -----------------------------------------------------------------
      // Transaction : reads → writes.
      // -----------------------------------------------------------------
      const counts = await dbf().runTransaction(async (tx) => {
        // [READS]
        const teamSnaps = await Promise.all(
          teamRefsForLinked.map((ref) => tx.get(ref)),
        )
        const regSnaps = await Promise.all(
          regRefsForLinked.map((ref) => tx.get(ref)),
        )

        const at = now()

        // [WRITES]
        let removedFromTeamsCount = 0
        if (linkedMemberId) {
          for (let i = 0; i < teamSnaps.length; i++) {
            const snap = teamSnaps[i]!
            if (!snap.exists) continue
            const data = snap.data() as {
              playerIds?: string[]
              coachIds?: string[]
            }
            const isPlayer = (data.playerIds ?? []).includes(linkedMemberId)
            const isCoach = (data.coachIds ?? []).includes(linkedMemberId)
            if (!isPlayer && !isCoach) continue
            const patch: {
              playerIds?: admin.firestore.FieldValue
              coachIds?: admin.firestore.FieldValue
            } = {}
            if (isPlayer) {
              patch.playerIds = admin.firestore.FieldValue.arrayRemove(
                linkedMemberId,
              )
            }
            if (isCoach) {
              patch.coachIds = admin.firestore.FieldValue.arrayRemove(
                linkedMemberId,
              )
            }
            tx.update(teamRefsForLinked[i]!, patch)
            removedFromTeamsCount++
          }
        }

        let unlinkedRegistrationsCount = 0
        if (linkedMemberId) {
          for (let i = 0; i < regSnaps.length; i++) {
            const snap = regSnaps[i]!
            if (!snap.exists) continue
            const reg = snap.data() as RegistrationData
            if (reg.matchedMemberId !== linkedMemberId) continue
            const action: RegistrationActionLogEntry = {
              at,
              byUid: callerUid,
              action: 'status_changed',
              previousStatus: reg.status,
              newStatus: reg.status,
              note: 'matched member deleted (self-service account deletion)',
            }
            tx.update(regRefsForLinked[i]!, {
              matchedMemberId: null,
              actionLog: [...(reg.actionLog ?? []), action],
            })
            unlinkedRegistrationsCount++
          }
        }

        let deletedDuesCount = 0
        for (const d of duesToDelete) {
          tx.delete(dbf().doc(`dues/${d.id}`))
          tx.delete(dbf().doc(`pendingEmails/${d.id}_dues_payment_request`))
          tx.delete(dbf().doc(`pendingEmails/${d.id}_dues_payment_confirmed`))
          deletedDuesCount++
        }

        if (linkedMemberId) {
          tx.delete(dbf().doc(`members/${linkedMemberId}`))
        }

        let deletedDraftsCount = 0
        for (const ref of draftRefs) {
          tx.delete(ref)
          deletedDraftsCount++
        }

        let deletedFcmTokensCount = 0
        for (const ref of fcmRefs) {
          tx.delete(ref)
          deletedFcmTokensCount++
        }

        // /users/{uid} en dernier — son trigger `syncUserRolesFromMember`
        // n'a plus rien à écrire dessus puisque le member lié est déjà
        // tx-deleted plus haut.
        if (userSnap.exists) {
          tx.delete(userRef)
        }

        return {
          removedFromTeamsCount,
          unlinkedRegistrationsCount,
          deletedDuesCount,
          deletedDraftsCount,
          deletedFcmTokensCount,
        }
      })

      // -----------------------------------------------------------------
      // Auth deletion — hors tx, best-effort. Si ça plante, Firestore est
      // déjà cohérent ; on log et on signale au client qui pourra alerter
      // l'admin pour nettoyer l'orphelin.
      // -----------------------------------------------------------------
      let authDeleted = false
      try {
        await admin.auth().deleteUser(callerUid)
        authDeleted = true
      } catch (authErr) {
        logger.error('[deleteMyAccount] Firestore cleanup ok but Auth delete failed', {
          callerUid,
          err: authErr instanceof Error ? authErr.message : String(authErr),
        })
      }

      logger.info('[deleteMyAccount] ok', {
        callerUid,
        hadLinkedMember: linkedMember !== null,
        ...counts,
        authDeleted,
      })

      return {
        ok: true,
        deletedUid: callerUid,
        hadLinkedMember: linkedMember !== null,
        ...counts,
        authDeleted,
      }
    } catch (err) {
      if (err instanceof HttpsError) {
        throw err
      }
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: unknown }).code)
          : 'unknown'
      logger.error(`[deleteMyAccount] failed [${code}]`, {
        callerUid,
        err: err instanceof Error ? err.message : String(err),
      })
      throw new HttpsError('internal', 'deleteMyAccount failed unexpectedly')
    }
  },
)
