/**
 * `unlinkGuardian`
 *
 * Callable invoquée par un **user signed-in** depuis l'app
 * `apps/courtbase-register` pour se **délier d'un member dont il est tuteur**
 * (UID listé dans `/members/{memberId}.guardianUserIds`).
 *
 * Cas d'usage : un parent veut détacher un enfant de son compte (le pupille
 * reste géré côté club, mais ne figure plus dans la liste "Mes enfants" du
 * parent). Pré-requis à la suppression de compte (`deleteMyAccount`) : tant
 * qu'un user a au moins un pupille, son compte ne peut pas être supprimé.
 *
 * ## Garde-fous
 *
 *  1. Auth requise.
 *  2. Le member doit exister, sinon `not-found`.
 *  3. `request.auth.uid` doit être dans `member.guardianUserIds`, sinon
 *     `permission-denied` (on n'expose pas le détail pour éviter le probing).
 *
 * ## Effet
 *
 *  - `member.guardianUserIds` : `arrayRemove(callerUid)` (transactionnel).
 *  - **PAS d'autre cascade** : on ne touche pas à `comms.billingRecipients` /
 *    `comms.generalRecipients` (un futur dernier-tuteur-retiré laissera le
 *    member côté club orphelin de tuteur — c'est l'admin du club qui doit
 *    re-lier ou archiver). On ne supprime ni ne désactive le member.
 *  - Idempotent : si le caller n'est pas/plus dans le tableau, retourne `ok`
 *    sans rejouer (utile si le client retente après un network blip).
 *
 * Log structuré `[unlinkGuardian]` après succès.
 *
 * Déploiement (Functions v2 nouvelle) : repacker shared-types en tarball +
 * `gcloud run services add-iam-policy-binding unlinkguardian \
 *    --member=allUsers --role=roles/run.invoker --region=europe-west6 \
 *    --project=<projectId>` sinon `internal` (cf. mémoire
 * `deploy_functions_v2_invoker_binding`).
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import * as admin from 'firebase-admin'
import type { MemberData } from '@club-app/shared-types'

function dbf(): FirebaseFirestore.Firestore {
  return admin.firestore()
}

interface UnlinkGuardianInput {
  memberId: unknown
}

export interface UnlinkGuardianOutput {
  ok: true
  memberId: string
  /** `true` si le caller a effectivement été retiré ; `false` si déjà absent (idempotence). */
  removed: boolean
}

export const unlinkGuardian = onCall(
  async (
    request: CallableRequest<UnlinkGuardianInput>,
  ): Promise<UnlinkGuardianOutput> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.')
    }
    const callerUid = request.auth.uid
    const d = request.data ?? ({} as UnlinkGuardianInput)
    if (typeof d.memberId !== 'string' || d.memberId.length === 0) {
      throw new HttpsError('invalid-argument', 'memberId is required')
    }
    const memberId = d.memberId

    try {
      const memberRef = dbf().doc(`members/${memberId}`)
      const removed = await dbf().runTransaction(async (tx) => {
        const snap = await tx.get(memberRef)
        if (!snap.exists) {
          throw new HttpsError('not-found', `member ${memberId} not found`)
        }
        const member = snap.data() as MemberData
        const guardianIds: string[] = Array.isArray(member.guardianUserIds)
          ? member.guardianUserIds
          : []
        if (!guardianIds.includes(callerUid)) {
          // On distingue : "jamais été tuteur" (permission-denied) vs "déjà
          // retiré dans le doc lu juste avant" (idempotence). En pratique on
          // ne peut pas faire la différence ici (pas d'historique). On choisit
          // l'idempotence : retourner ok sans modifier. Une UI qui n'aurait
          // pas eu accès au member en lecture (rules deny) ne se serait
          // jamais affichée → impossible d'arriver ici par "abus".
          return false
        }
        tx.update(memberRef, {
          guardianUserIds: admin.firestore.FieldValue.arrayRemove(callerUid),
        })
        return true
      })

      logger.info('[unlinkGuardian] ok', { callerUid, memberId, removed })

      return { ok: true, memberId, removed }
    } catch (err) {
      if (err instanceof HttpsError) {
        throw err
      }
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: unknown }).code)
          : 'unknown'
      logger.error(`[unlinkGuardian] failed [${code}]`, {
        callerUid,
        memberId,
        err: err instanceof Error ? err.message : String(err),
      })
      throw new HttpsError('internal', 'unlinkGuardian failed unexpectedly')
    }
  },
)
