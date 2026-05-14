/**
 * `issueDuesScheduled`
 *
 * Daily scheduled function (06:00 europe-west6). Transitions dues from
 * `pending_grace` to `issued` once their `issuedAt` is in the past, and sets
 * `dueAt = issuedAt + paymentDueDays`. Also flips the member's `duesStatus`
 * to `'due'` (the syncMemberDuesStatus trigger will reconcile but we set it
 * here directly to avoid lag for the UI).
 *
 * Side-effect (post-batch) : pour chaque due tout juste flippé en `issued`,
 * on enqueue un email `dues_payment_request` dans `/pendingEmails` (ID
 * déterministe `{dueId}_dues_payment_request`). Idempotent : on saute
 * l'enqueue si `due.emailedAt != null`. On pose `emailedAt = serverTimestamp()`
 * dans le même batch que la transition.
 *
 * Idempotence : la query filtre `status == 'pending_grace'` AND
 * `issuedAt <= now()`. Une fois qu'un due a flippé vers `issued`, il ne
 * matche plus → re-runs sûrs. La sub-section "send email" est elle aussi
 * idempotente (cf. plus haut).
 *
 * Batching : Firestore caps a WriteBatch at 500 ops. We split into chunks
 * of `MAX_BATCH_WRITES` ops, counting both the dues update AND the member
 * update against the limit.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { logger } from 'firebase-functions/v2'
import type {
  DocumentReference,
  Query,
  QueryDocumentSnapshot,
} from 'firebase-admin/firestore'
import type { DueData, MemberData } from '@club-app/shared-types'
import {
  MAX_BATCH_WRITES,
  Timestamp,
  addDaysToTimestamp,
  col,
  db,
  serverTimestamp,
} from './_helpers'
import {
  buildPaymentReference,
  enqueueDuesPaymentRequest,
  errCode,
  readClubBanking,
  resolveBillingRecipients,
  tsToIso,
} from './_emailEnqueue'

interface DuesConfigLike {
  paymentDueDays: number
}

async function readPaymentDueDays(): Promise<number> {
  const cfgSnap = await db().doc('config/club').get()
  const cfg = cfgSnap.data() as { duesConfig?: DuesConfigLike } | undefined
  const value = cfg?.duesConfig?.paymentDueDays
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    logger.warn(
      'issueDuesScheduled: invalid duesConfig.paymentDueDays — defaulting to 14',
      { value },
    )
    return 14
  }
  return value
}

type DuesQuery = Query<DueData>

function pendingGraceDueQuery(): DuesQuery {
  return col<DueData>('dues')
    .where('status', '==', 'pending_grace')
    .where('issuedAt', '<=', Timestamp.now())
}


/**
 * Process one batch of pending_grace dues. Two writes per due (dues doc +
 * member doc) so the slice size is `MAX_BATCH_WRITES / 2`. Renvoie la liste
 * des due IDs effectivement transitionnés (pour pouvoir enqueuer les emails
 * en post-traitement hors batch).
 *
 * Exposed for unit tests via `__internal`.
 */
export async function processDuesIssuanceBatch(args: {
  docs: readonly QueryDocumentSnapshot<DueData>[]
  paymentDueDays: number
}): Promise<string[]> {
  const { docs, paymentDueDays } = args
  if (docs.length === 0) return []
  const issued: string[] = []

  // We pair each due update with a member update -> 2 writes per element.
  const half = Math.floor(MAX_BATCH_WRITES / 2)
  for (let i = 0; i < docs.length; i += half) {
    const slice = docs.slice(i, i + half)
    const batch = db().batch()
    for (const docSnap of slice) {
      const due = docSnap.data()
      // DueData.issuedAt is typed as the SDK-neutral Timestamp shape from
      // @club-app/shared-types; at runtime in Functions it's a real
      // admin Firestore Timestamp. Cast through unknown.
      const issuedAt = due.issuedAt as unknown as FirebaseFirestore.Timestamp | null
      if (!issuedAt) {
        logger.warn('issueDuesScheduled: dues row missing issuedAt — skipping', {
          dueId: docSnap.id,
        })
        continue
      }
      const dueAt = addDaysToTimestamp(issuedAt, paymentDueDays)
      batch.update(docSnap.ref, {
        status: 'issued',
        dueAt,
      })
      const memberRef: DocumentReference = db().doc(`members/${due.memberId}`)
      batch.update(memberRef, {
        duesStatus: 'due',
        duesStatusUpdatedAt: serverTimestamp(),
      })
      issued.push(docSnap.id)
    }
    await batch.commit()
  }
  return issued
}

/**
 * Pour chaque due tout juste flippé en `issued`, lit le doc à jour, résout
 * les recipients depuis member.comms.billingRecipients, et enqueue un mail
 * `dues_payment_request`. Idempotent — saute si `emailedAt` est déjà set.
 * Pose `emailedAt` (+ `paymentReference` si manquant) post-enqueue.
 *
 * Exposed for tests.
 */
export async function enqueuePaymentRequestEmails(
  dueIds: readonly string[],
): Promise<void> {
  if (dueIds.length === 0) return
  // Lecture banking + season name une seule fois — partagés entre tous les dues.
  let banking
  try {
    banking = await readClubBanking()
  } catch (err) {
    const code = errCode(err)
    logger.error(`issueDuesScheduled: readClubBanking failed [${code}]`, err)
    banking = {
      iban: null,
      bic: null,
      bankName: null,
      accountHolder: null,
      paymentInstructions: null,
    }
  }

  for (const dueId of dueIds) {
    try {
      const dueRef = db().doc(`dues/${dueId}`)
      const dueSnap = await dueRef.get()
      if (!dueSnap.exists) {
        logger.warn('issueDuesScheduled: due disappeared mid-pipeline', { dueId })
        continue
      }
      const due = dueSnap.data() as DueData
      // Idempotence : email déjà enqueueé sur un run précédent → skip.
      if (due.emailedAt) {
        logger.info('issueDuesScheduled: email already enqueued, skipping', { dueId })
        continue
      }

      const memberSnap = await db().doc(`members/${due.memberId}`).get()
      if (!memberSnap.exists) {
        logger.warn('issueDuesScheduled: member missing, skipping email', {
          dueId,
          memberId: due.memberId,
        })
        continue
      }
      const member = memberSnap.data() as MemberData

      const recipients = await resolveBillingRecipients(member)
      if (recipients.length === 0) {
        logger.warn('issueDuesScheduled: no recipient emails resolved', {
          dueId,
          memberId: due.memberId,
        })
        // On enqueue quand même avec `to: null` pour que le worker remonte
        // l'incident — mais on ne se bloque pas.
      }

      const paymentReference = due.paymentReference ?? buildPaymentReference(dueId)
      const dueAtIso = tsToIso(
        due.dueAt as unknown as { seconds: number; nanoseconds: number } | null,
      )

      // Optionnel : récupère le seasonName pour enrichir le contexte.
      let seasonName: string | null = null
      if (due.seasonId) {
        try {
          const seasonSnap = await db().doc(`seasons/${due.seasonId}`).get()
          if (seasonSnap.exists) {
            const s = seasonSnap.data() as { name?: string } | undefined
            seasonName = typeof s?.name === 'string' ? s.name : null
          }
        } catch (err) {
          const code = errCode(err)
          logger.warn(`issueDuesScheduled: read season failed [${code}]`, { err, dueId })
        }
      }

      await enqueueDuesPaymentRequest({
        dueId,
        amount: due.amount,
        memberId: due.memberId,
        memberFirstName: member.firstName,
        memberLastName: member.lastName,
        recipients,
        banking,
        paymentReference,
        dueAt: dueAtIso,
        seasonName,
      })

      // Pose emailedAt + paymentReference (si manquant) — idempotence pour les
      // futurs re-runs. Hors batch (1 write isolée par due, négligeable).
      await dueRef.update({
        emailedAt: serverTimestamp(),
        paymentReference,
      })
    } catch (err) {
      const code = errCode(err)
      logger.error(`issueDuesScheduled: enqueue email failed [${code}]`, {
        err,
        dueId,
      })
      // Continue les autres dues — un échec isolé ne bloque pas le batch.
    }
  }
}

export const issueDuesScheduled = onSchedule(
  {
    schedule: '0 6 * * *',
    timeZone: 'Europe/Zurich',
  },
  async () => {
    const paymentDueDays = await readPaymentDueDays()
    const snap = await pendingGraceDueQuery().get()
    if (snap.empty) {
      logger.info('issueDuesScheduled: nothing to issue')
      return
    }
    logger.info('issueDuesScheduled: issuing dues', { count: snap.size })
    const issuedIds = await processDuesIssuanceBatch({ docs: snap.docs, paymentDueDays })
    logger.info('issueDuesScheduled: transitions done, enqueueing emails', {
      count: issuedIds.length,
    })
    await enqueuePaymentRequestEmails(issuedIds)
  },
)
