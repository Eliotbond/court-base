/**
 * `transitionRegistrationOnDuePaid`
 *
 * Firestore trigger `onUpdate('dues/{dueId}')`. Quand un due passe à
 * `status='paid'`, on cherche la registration associée
 * `(matchedMemberId=due.memberId, teamId=due.teamId)` et, si elle est en
 * `confirmed_pending_dues`, on la fait transiter vers `active`. On en profite
 * aussi pour s'assurer que `members/{memberId}.active === true`.
 *
 * Cycle de vie ciblé (cf. `docs/registrations/lifecycle.md` §5) :
 *   `confirmed_pending_dues` → `active` quand `due.status === 'paid'`.
 *
 * Idempotence :
 *  - Trigger interne `onUpdate` ⇒ filtre `before.status !== 'paid' && after.status === 'paid'`
 *    — un re-trigger Firestore (replay) ne re-flipperait pas si la registration
 *    est déjà en `active` (early-return silencieux).
 *  - Si plusieurs registrations matchent (joueur ré-inscrit la saison
 *    suivante), on garde la plus récente par `createdAt` — pareil que
 *    `findRegistrationContext` dans `initiateDuesOnPlayerActivation`.
 *
 * Erreurs :
 *  - Registration introuvable ⇒ log info + skip (cas paiement d'une cotisation
 *    hors flow inscription — création directe admin).
 *  - Toute autre erreur Firestore ⇒ log error avec code mais on throw pas →
 *    un trigger qui throw fait re-tenter Firestore, on préfère échouer
 *    silencieusement et investiguer via logs.
 *
 * Region : `europe-west6` (héritée du `setGlobalOptions` dans `src/index.ts`).
 * Pas d'IAM binding `allUsers/run.invoker` nécessaire — c'est un trigger
 * Firestore, pas un callable (la garde IAM ne concerne que les invocations
 * HTTP côté client).
 */
import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions/v2'
import type {
  CotisationData as DueData,
  MemberData,
  RegistrationActionLogEntry,
  RegistrationData,
} from '@club-app/shared-types'
import { Timestamp, col, db, serverTimestamp } from './_helpers'
import { errCode } from './_emailEnqueue'

/**
 * Détecte la transition `status: <anything> -> 'paid'`. Pure — exposée pour
 * les tests.
 */
export function isPaidTransition(
  before: { status?: string } | undefined,
  after: { status?: string } | undefined,
): boolean {
  if (!after) return false
  if (after.status !== 'paid') return false
  if (!before) return true
  return before.status !== 'paid'
}

/**
 * Cherche la registration associée à `(memberId, teamId)`. Garde la plus
 * récente si plusieurs matches (cas joueur ré-inscrit saison suivante). Pas
 * d'index composite — deux filtres d'égalité + tri JS (cf. CLAUDE.md §10).
 *
 * Retourne `null` si rien ne matche ou si la lecture échoue (log warn).
 */
export async function findRegistrationForPaidDue(
  memberId: string,
  teamId: string,
): Promise<{ id: string; data: RegistrationData } | null> {
  try {
    const snap = await col('registrations')
      .where('matchedMemberId', '==', memberId)
      .where('teamId', '==', teamId)
      .get()
    if (snap.empty) return null
    const sorted = snap.docs
      .map((d) => ({ id: d.id, data: d.data() as RegistrationData }))
      .sort(
        (a, b) =>
          (b.data.createdAt?.seconds ?? 0) - (a.data.createdAt?.seconds ?? 0),
      )
    return sorted[0] ?? null
  } catch (err) {
    const code = errCode(err)
    logger.warn(
      `transitionRegistrationOnDuePaid: registration lookup failed [${code}]`,
      { err, memberId, teamId },
    )
    return null
  }
}

/**
 * Result discriminant du processing (utile pour les tests).
 */
export type TransitionOutcome =
  | 'transitioned'
  | 'already-active'
  | 'wrong-status'
  | 'no-registration'
  | 'no-change'

/**
 * Pipeline principal extrait du handler — testable sans la wrapper
 * `onDocumentUpdated`. Encapsule lookup + transition + activation member.
 */
export async function processDuePaid(args: {
  dueId: string
  memberId: string
  teamId: string
}): Promise<TransitionOutcome> {
  const { dueId, memberId, teamId } = args
  const reg = await findRegistrationForPaidDue(memberId, teamId)
  if (!reg) {
    logger.info(
      'transitionRegistrationOnDuePaid: no registration matched (paiement hors flow register)',
      { dueId, memberId, teamId },
    )
    return 'no-registration'
  }

  if (reg.data.status === 'active') {
    logger.info('transitionRegistrationOnDuePaid: registration already active, skipping', {
      dueId,
      registrationId: reg.id,
    })
    return 'already-active'
  }

  if (reg.data.status !== 'confirmed_pending_dues') {
    logger.info(
      'transitionRegistrationOnDuePaid: registration status not eligible for activation',
      { dueId, registrationId: reg.id, status: reg.data.status },
    )
    return 'wrong-status'
  }

  // Transition transactionnelle : on relit les deux docs dans la tx pour
  // garantir la cohérence (registration + member). Lectures avant writes
  // (contrainte Firestore Admin SDK).
  try {
    await db().runTransaction(async (tx) => {
      const regRef = db().doc(`registrations/${reg.id}`)
      const memberRef = db().doc(`members/${memberId}`)

      const [regSnap, memberSnap] = await Promise.all([
        tx.get(regRef),
        tx.get(memberRef),
      ])

      if (!regSnap.exists) {
        logger.warn(
          'transitionRegistrationOnDuePaid: registration disappeared between lookup and tx',
          { dueId, registrationId: reg.id },
        )
        return
      }
      const freshReg = regSnap.data() as RegistrationData
      // Double-check inside the tx — concurrent writes could have flipped status.
      if (freshReg.status === 'active') {
        logger.info(
          'transitionRegistrationOnDuePaid: registration flipped to active concurrently',
          { dueId, registrationId: reg.id },
        )
        return
      }
      if (freshReg.status !== 'confirmed_pending_dues') {
        logger.info(
          'transitionRegistrationOnDuePaid: registration status changed concurrently, skipping',
          { dueId, registrationId: reg.id, status: freshReg.status },
        )
        return
      }

      const now = Timestamp.now()
      const action: RegistrationActionLogEntry = {
        at: now,
        byUid: 'system',
        action: 'status_changed',
        previousStatus: 'confirmed_pending_dues',
        newStatus: 'active',
        note: 'due_paid',
      }
      tx.update(regRef, {
        status: 'active',
        statusUpdatedAt: now,
        actionLog: [...(freshReg.actionLog ?? []), action],
      })

      // Active le member si pas déjà. On ne touche QUE `active` ; le champ
      // `status` côté member relève d'un autre cycle (archivage) — pas notre
      // job ici.
      if (memberSnap.exists) {
        const member = memberSnap.data() as MemberData
        if (member.active !== true) {
          tx.update(memberRef, { active: true })
        }
      } else {
        logger.warn(
          'transitionRegistrationOnDuePaid: member doc missing — registration flipped but member.active not touched',
          { dueId, memberId, registrationId: reg.id },
        )
      }
    })

    // serverTimestamp() est importé pour cohérence avec le pattern repo — non
    // utilisé directement ici (on préfère `Timestamp.now()` pour le tracer
    // dans actionLog).
    void serverTimestamp

    logger.info('transitionRegistrationOnDuePaid: registration activated', {
      dueId,
      registrationId: reg.id,
      memberId,
    })
    return 'transitioned'
  } catch (err) {
    const code = errCode(err)
    logger.error(`transitionRegistrationOnDuePaid: tx failed [${code}]`, {
      err,
      dueId,
      registrationId: reg.id,
    })
    return 'no-change'
  }
}

export const transitionRegistrationOnDuePaid = onDocumentUpdated(
  'dues/{dueId}',
  async (event) => {
    const change = event.data
    if (!change) {
      logger.warn('transitionRegistrationOnDuePaid: missing event.data, skipping')
      return
    }
    const before = change.before.exists
      ? (change.before.data() as DueData)
      : undefined
    const after = change.after.exists
      ? (change.after.data() as DueData)
      : undefined

    if (!isPaidTransition(before, after)) return
    // `after` est non-null si on est ici (isPaidTransition l'exige).
    const due = after as DueData
    const dueId = event.params.dueId

    if (!due.memberId || !due.teamId) {
      logger.warn(
        'transitionRegistrationOnDuePaid: due missing memberId/teamId, skipping',
        { dueId },
      )
      return
    }

    await processDuePaid({
      dueId,
      memberId: due.memberId,
      teamId: due.teamId,
    })
  },
)
