/**
 * `deleteMember`
 *
 * Callable invoquée par un **admin** pour supprimer **définitivement** un
 * `/members/{memberId}` en cas d'**erreur de création** (typo, doublon créé
 * par accident avant le dedup défensif, mauvais flow). Flow exceptionnel,
 * distinct de l'archive (cf. `refuseRegistration` → `member.status =
 * 'archived'` qui est le chemin nominal de "fin d'adhésion").
 *
 * **IRRÉVERSIBLE.** À n'utiliser que pour les erreurs de saisie.
 *
 * ## Garde-fous
 *
 *  1. Auth requise.
 *  2. Caller doit avoir le rôle `admin` (pas `treasurer`, pas `coach`).
 *  3. Le member doit exister, sinon `not-found`.
 *  4. `confirmName` doit matcher `${firstName} ${lastName}` du member après
 *     normalisation (lowercase + trim + diacritiques). Anti-fat-finger.
 *  5. Si **au moins un due lié** a `status === 'paid'`, on refuse en
 *     `failed-precondition` : l'historique comptable ne doit pas être détruit.
 *     L'admin doit alors utiliser l'archive plutôt que la suppression.
 *
 * ## Cleanup transactionnel (tout ou rien)
 *
 *  - Pour chaque team où `playerIds.includes(memberId)` ou
 *    `coachIds.includes(memberId)` : `arrayRemove(memberId)` sur le champ.
 *    (Les teams candidates sont pré-queryées hors tx, relues dans la tx pour
 *    cohérence.)
 *  - Pour chaque registration `matchedMemberId === memberId` : on **NE
 *    supprime PAS** la registration (historique précieux, traçabilité de
 *    l'erreur). On défait juste le lien : `matchedMemberId = null` + append
 *    `actionLog` avec une note explicative. Le `status` ne change pas.
 *  - Pour chaque due non-paid (status ∈ `pending_grace` | `issued` |
 *    `overdue` | `excepted` | `cancelled`) : `tx.delete(dueRef)`.
 *  - Pour chaque due supprimé : suppression best-effort des deux
 *    `/pendingEmails` à IDs déterministes (`{dueId}_dues_payment_request` et
 *    `{dueId}_dues_payment_confirmed`) pour éviter d'envoyer un mail relatif
 *    à un due détruit. `tx.delete` sur un doc inexistant est tolérée par
 *    Firestore (no-op silencieux).
 *  - `tx.delete(memberRef)`.
 *
 * Log structuré `[deleteMember]` après succès.
 *
 * Déploiement (Functions v2 nouvelle) :
 *   - Repacker shared-types en tarball avant deploy.
 *   - `gcloud run services add-iam-policy-binding deletemember \
 *       --member=allUsers --role=roles/run.invoker --region=europe-west6 \
 *       --project=<projectId>`
 *     sinon la callable rejette en `internal` (cf. mémoire
 *     `deploy_functions_v2_invoker_binding`).
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
import { Timestamp, db, normalizeName } from '../registrations/_helpers'

// =============================================================================
// I/O
// =============================================================================

interface DeleteMemberInput {
  memberId: unknown
  /**
   * Nom complet "Firstname Lastname" que l'admin doit retaper exactement
   * pour confirmer la suppression. Comparé après normalisation (diacritiques,
   * casse, espaces) au `${firstName} ${lastName}` du member.
   */
  confirmName: unknown
}

export interface DeleteMemberOutput {
  ok: true
  memberId: string
  removedFromTeamsCount: number
  unlinkedRegistrationsCount: number
  deletedDuesCount: number
}

/** Statuts de dues considérés "non-paid" — éligibles à la suppression. */
const NON_PAID_DUE_STATUSES: readonly DueStatus[] = [
  'pending_grace',
  'issued',
  'overdue',
  'excepted',
  'cancelled',
]

function parseInput(data: DeleteMemberInput): { memberId: string; confirmName: string } {
  const d = data ?? ({} as DeleteMemberInput)
  if (typeof d.memberId !== 'string' || d.memberId.length === 0) {
    throw new HttpsError('invalid-argument', 'memberId is required')
  }
  if (typeof d.confirmName !== 'string' || d.confirmName.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'confirmName is required (text non-empty)')
  }
  return { memberId: d.memberId, confirmName: d.confirmName }
}

function assertAdmin(user: UserData | undefined): void {
  if (!user || !user.roles?.includes('admin')) {
    throw new HttpsError(
      'permission-denied',
      'Caller must have the admin role to delete a member.',
    )
  }
}

// =============================================================================
// Callable
// =============================================================================

export const deleteMember = onCall(
  async (
    request: CallableRequest<DeleteMemberInput>,
  ): Promise<DeleteMemberOutput> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.')
    }
    const callerUid = request.auth.uid
    const { memberId, confirmName } = parseInput(request.data)

    try {
      // -----------------------------------------------------------------
      // Préchecks hors transaction (auth + existence + dues paid + name).
      // -----------------------------------------------------------------
      const callerSnap = await db().doc(`users/${callerUid}`).get()
      if (!callerSnap.exists) {
        throw new HttpsError('permission-denied', 'No /users doc for caller.')
      }
      assertAdmin(callerSnap.data() as UserData | undefined)

      const memberRef = db().doc(`members/${memberId}`)
      const memberSnap = await memberRef.get()
      if (!memberSnap.exists) {
        throw new HttpsError('not-found', `member ${memberId} not found`)
      }
      const member = memberSnap.data() as MemberData
      const memberName = `${member.firstName} ${member.lastName}`

      const expected = normalizeName(memberName)
      const provided = normalizeName(confirmName)
      if (expected !== provided) {
        throw new HttpsError(
          'invalid-argument',
          'Le nom de confirmation ne correspond pas au member',
        )
      }

      // Tous les dues du member (paid → bloque ; sinon à supprimer dans la tx).
      const duesSnap = await db()
        .collection('dues')
        .where('memberId', '==', memberId)
        .get()
      const dueDocs: { id: string; data: DueData }[] = duesSnap.docs.map((doc) => ({
        id: doc.id,
        data: doc.data() as DueData,
      }))
      const hasPaid = dueDocs.some((d) => d.data.status === 'paid')
      if (hasPaid) {
        throw new HttpsError(
          'failed-precondition',
          'Ce membre a des cotisations déjà payées. Utilisez l\'archive plutôt que la suppression pour conserver l\'historique comptable.',
        )
      }
      const duesToDelete = dueDocs.filter((d) =>
        NON_PAID_DUE_STATUSES.includes(d.data.status),
      )

      // Teams candidates (player ou coach). Deux queries (array-contains ne
      // supporte qu'un seul champ à la fois).
      const teamsPlayerSnap = await db()
        .collection('teams')
        .where('playerIds', 'array-contains', memberId)
        .get()
      const teamsCoachSnap = await db()
        .collection('teams')
        .where('coachIds', 'array-contains', memberId)
        .get()
      const teamRefsById = new Map<string, FirebaseFirestore.DocumentReference>()
      for (const doc of teamsPlayerSnap.docs) teamRefsById.set(doc.id, doc.ref)
      for (const doc of teamsCoachSnap.docs) teamRefsById.set(doc.id, doc.ref)
      const teamRefs = Array.from(teamRefsById.values())

      // Registrations qui lient ce member.
      const regsSnap = await db()
        .collection('registrations')
        .where('matchedMemberId', '==', memberId)
        .get()
      const regRefs = regsSnap.docs.map((doc) => doc.ref)

      // -----------------------------------------------------------------
      // Transaction : lectures puis writes (Firestore exige cet ordre).
      // -----------------------------------------------------------------
      const result = await db().runTransaction(async (tx) => {
        // [READS]
        // Member relu (cohérence transactionnelle — pourrait avoir été
        // archivé/modifié entre-temps).
        const memberTxSnap = await tx.get(memberRef)
        if (!memberTxSnap.exists) {
          throw new HttpsError('not-found', `member ${memberId} disappeared`)
        }

        // Teams : on relit pour s'assurer qu'on a bien la dernière version
        // des arrays (un autre admin a pu retirer le memberId entre-temps).
        const teamSnaps = await Promise.all(teamRefs.map((ref) => tx.get(ref)))

        // Registrations : relues pour l'actionLog append cohérent.
        const regSnaps = await Promise.all(regRefs.map((ref) => tx.get(ref)))

        const now = Timestamp.now()

        // [WRITES]
        let removedFromTeamsCount = 0
        for (let i = 0; i < teamSnaps.length; i++) {
          const snap = teamSnaps[i]!
          if (!snap.exists) continue
          const data = snap.data() as { playerIds?: string[]; coachIds?: string[] }
          const isPlayer = (data.playerIds ?? []).includes(memberId)
          const isCoach = (data.coachIds ?? []).includes(memberId)
          if (!isPlayer && !isCoach) continue
          const patch: {
            playerIds?: admin.firestore.FieldValue
            coachIds?: admin.firestore.FieldValue
          } = {}
          if (isPlayer) {
            patch.playerIds = admin.firestore.FieldValue.arrayRemove(memberId)
          }
          if (isCoach) {
            patch.coachIds = admin.firestore.FieldValue.arrayRemove(memberId)
          }
          tx.update(teamRefs[i]!, patch)
          removedFromTeamsCount++
        }

        let unlinkedRegistrationsCount = 0
        for (let i = 0; i < regSnaps.length; i++) {
          const snap = regSnaps[i]!
          if (!snap.exists) continue
          const reg = snap.data() as RegistrationData
          if (reg.matchedMemberId !== memberId) continue
          const action: RegistrationActionLogEntry = {
            at: now,
            byUid: callerUid,
            action: 'status_changed',
            previousStatus: reg.status,
            newStatus: reg.status,
            note: 'matched member deleted (admin manual deletion)',
          }
          tx.update(regRefs[i]!, {
            matchedMemberId: null,
            actionLog: [...(reg.actionLog ?? []), action],
          })
          unlinkedRegistrationsCount++
        }

        let deletedDuesCount = 0
        for (const d of duesToDelete) {
          tx.delete(db().doc(`dues/${d.id}`))
          // Best-effort : supprime les emails déterministes liés à ce due.
          // `tx.delete` sur un doc inexistant est tolérée (no-op).
          tx.delete(db().doc(`pendingEmails/${d.id}_dues_payment_request`))
          tx.delete(db().doc(`pendingEmails/${d.id}_dues_payment_confirmed`))
          deletedDuesCount++
        }

        tx.delete(memberRef)

        return {
          removedFromTeamsCount,
          unlinkedRegistrationsCount,
          deletedDuesCount,
        }
      })

      logger.info('[deleteMember] ok', {
        callerUid,
        memberId,
        memberName,
        removedFromTeamsCount: result.removedFromTeamsCount,
        unlinkedRegistrationsCount: result.unlinkedRegistrationsCount,
        deletedDuesCount: result.deletedDuesCount,
      })

      return {
        ok: true,
        memberId,
        removedFromTeamsCount: result.removedFromTeamsCount,
        unlinkedRegistrationsCount: result.unlinkedRegistrationsCount,
        deletedDuesCount: result.deletedDuesCount,
      }
    } catch (err) {
      if (err instanceof HttpsError) {
        // Erreurs métier déjà typées → propage tel quel.
        throw err
      }
      // Firebase / Firestore errors → log structuré + remap en `internal`.
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: unknown }).code)
          : 'unknown'
      logger.error(`[deleteMember] failed [${code}]`, {
        callerUid,
        memberId,
        err: err instanceof Error ? err.message : String(err),
      })
      throw new HttpsError('internal', 'deleteMember failed unexpectedly')
    }
  },
)
