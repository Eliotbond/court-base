/**
 * `markDuePaid` — callable utilisée par admin / treasurer pour enregistrer
 * manuellement le paiement d'un due. Transactionnel : flip status -> paid +
 * pose les champs paidAt / paidAmount / paymentMethod / recordedBy / notes,
 * puis enqueue un email de confirmation (`dues_payment_confirmed`).
 *
 * Auth : signed-in. Le caller doit avoir `roles` incluant `'admin'` OU
 * `'treasurer'` côté `/users/{uid}`. Sinon `permission-denied`.
 *
 * State preconditions : `due.status !== 'paid'`. Sinon `failed-precondition`.
 *
 * Idempotence email : le doc `/pendingEmails/{dueId}_dues_payment_confirmed`
 * a un ID déterministe — un re-call (qui de toute façon serait rejeté en
 * `failed-precondition`) n'enverrait pas de doublon.
 *
 * Region : europe-west6 (héritée du `setGlobalOptions` dans `src/index.ts`).
 *
 * NOTE deploy : nouvelle Function v2 → après le premier deploy, ajouter le
 * binding IAM `allUsers/run.invoker` (cf. `functions/CLAUDE.md` §"Après deploy").
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import type {
  DuePaymentMethod,
  DueData,
  MemberData,
  UserData,
} from '@club-app/shared-types'
import { Timestamp, db, serverTimestamp } from './_helpers'
import {
  buildPaymentReference,
  enqueueDuesPaymentConfirmed,
  errCode,
  nowIso,
  resolveBillingRecipients,
} from './_emailEnqueue'

interface MarkDuePaidInput {
  dueId: unknown
  paidAmount?: unknown
  paymentMethod: unknown
  paidAt?: unknown
  notes?: unknown
}

export interface MarkDuePaidOutput {
  ok: true
  dueId: string
}

/** Méthodes de paiement acceptées par la callable. */
const ACCEPTED_PAYMENT_METHODS: readonly DuePaymentMethod[] = [
  'transfer',
  'cash',
  'other',
]
// Le brief inclut `'card'` mais `DuePaymentMethod` (shared-types) ne le liste
// pas — on l'accepte côté input puis on stocke `'other'` (ou le mapping
// décidé par le subagent types s'il l'a ajouté). Pour rester safe, on accepte
// 'card' au runtime ET on persiste tel quel via cast — Firestore est schema-less.
type ExtendedPaymentMethod = DuePaymentMethod | 'card'
const ACCEPTED_RUNTIME_METHODS: readonly ExtendedPaymentMethod[] = [
  ...ACCEPTED_PAYMENT_METHODS,
  'card',
]

interface ParsedInput {
  dueId: string
  paidAmount: number | null
  paymentMethod: ExtendedPaymentMethod
  paidAt: { iso: string; ts: FirebaseFirestore.Timestamp }
  notes: string | null
}

function parseInput(data: MarkDuePaidInput): ParsedInput {
  const d = data ?? ({} as MarkDuePaidInput)
  if (typeof d.dueId !== 'string' || d.dueId.length === 0) {
    throw new HttpsError('invalid-argument', 'dueId is required')
  }
  if (
    typeof d.paymentMethod !== 'string' ||
    !ACCEPTED_RUNTIME_METHODS.includes(d.paymentMethod as ExtendedPaymentMethod)
  ) {
    throw new HttpsError(
      'invalid-argument',
      `paymentMethod must be one of: ${ACCEPTED_RUNTIME_METHODS.join(', ')}`,
    )
  }
  let paidAmount: number | null = null
  if (d.paidAmount !== undefined && d.paidAmount !== null) {
    if (typeof d.paidAmount !== 'number' || !Number.isFinite(d.paidAmount) || d.paidAmount < 0) {
      throw new HttpsError('invalid-argument', 'paidAmount must be a non-negative finite number')
    }
    paidAmount = d.paidAmount
  }

  let paidAtIso: string
  let paidAtTs: FirebaseFirestore.Timestamp
  if (d.paidAt === undefined || d.paidAt === null) {
    paidAtTs = Timestamp.now()
    paidAtIso = nowIso()
  } else {
    if (typeof d.paidAt !== 'string') {
      throw new HttpsError('invalid-argument', 'paidAt must be an ISO date string')
    }
    const parsed = Date.parse(d.paidAt)
    if (Number.isNaN(parsed)) {
      throw new HttpsError('invalid-argument', `paidAt is not a valid ISO date: ${d.paidAt}`)
    }
    paidAtIso = d.paidAt
    paidAtTs = Timestamp.fromMillis(parsed)
  }

  let notes: string | null = null
  if (d.notes !== undefined && d.notes !== null) {
    if (typeof d.notes !== 'string') {
      throw new HttpsError('invalid-argument', 'notes must be a string')
    }
    const trimmed = d.notes.trim()
    notes = trimmed.length > 0 ? trimmed : null
  }

  return {
    dueId: d.dueId,
    paidAmount,
    paymentMethod: d.paymentMethod as ExtendedPaymentMethod,
    paidAt: { iso: paidAtIso, ts: paidAtTs },
    notes,
  }
}

function assertAdminOrTreasurer(user: UserData): void {
  const roles = user.roles ?? []
  if (roles.includes('admin')) return
  if (roles.includes('treasurer')) return
  throw new HttpsError(
    'permission-denied',
    'Caller must be admin or treasurer to mark a due as paid.',
  )
}

/**
 * Garde "comité only" sur les montants partiels : un paiement < montant dû
 * (arrangement in extremis) ne peut être enregistré que par un rootAdmin ou un
 * treasurer. Un admin standard est rejeté en `permission-denied` — il doit
 * passer au montant intégral. Pose la règle au niveau callable pour fermer la
 * porte que l'UI ferme déjà côté `apps/web` (défense en profondeur — sans ça,
 * un admin pourrait appeler le callable directement avec un montant arbitraire).
 */
function assertCanRecordPartial(
  request: CallableRequest<MarkDuePaidInput>,
  user: UserData,
): void {
  if (request.auth?.token?.rootAdmin === true) return
  const roles = user.roles ?? []
  if (roles.includes('treasurer')) return
  throw new HttpsError(
    'permission-denied',
    'Only rootAdmin or treasurer can record a partial payment (paidAmount < due.amount).',
  )
}

export const markDuePaid = onCall(
  async (
    request: CallableRequest<MarkDuePaidInput>,
  ): Promise<MarkDuePaidOutput> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', '[markDuePaid] Must be signed in.')
    }
    const callerUid = request.auth.uid
    const input = parseInput(request.data)

    // Pré-charge le user doc hors transaction (rôles stables pendant le call).
    const userSnap = await db().doc(`users/${callerUid}`).get()
    if (!userSnap.exists) {
      throw new HttpsError('permission-denied', '[markDuePaid] No /users doc for caller.')
    }
    const user = userSnap.data() as UserData
    assertAdminOrTreasurer(user)

    const dueRef = db().doc(`dues/${input.dueId}`)
    let resolvedMemberId = ''
    let resolvedAmount = 0
    let resolvedPaymentReference = ''

    try {
      await db().runTransaction(async (tx) => {
        const dueSnap = await tx.get(dueRef)
        if (!dueSnap.exists) {
          throw new HttpsError('not-found', `[markDuePaid] due ${input.dueId} not found`)
        }
        const due = dueSnap.data() as DueData & {
          paymentReference?: string | null
        }
        if (due.status === 'paid') {
          throw new HttpsError(
            'failed-precondition',
            `[markDuePaid] due ${input.dueId} already paid`,
          )
        }
        resolvedMemberId = due.memberId
        const finalAmount = input.paidAmount ?? due.amount
        // Arrangement in extremis : montant < dû ⇒ comité only (rootAdmin /
        // treasurer). Le check vit dans la transaction parce qu'on a besoin de
        // `due.amount` comme référence.
        if (finalAmount < due.amount) {
          assertCanRecordPartial(request, user)
        }
        resolvedAmount = finalAmount
        resolvedPaymentReference = due.paymentReference ?? buildPaymentReference(input.dueId)

        tx.update(dueRef, {
          status: 'paid',
          paidAt: input.paidAt.ts,
          paidAmount: finalAmount,
          paymentMethod: input.paymentMethod,
          recordedBy: callerUid,
          notes: input.notes,
          // Pose `paymentReference` si manquant (legacy / dues créés avant le
          // déploiement des nouveaux champs).
          ...(due.paymentReference ? {} : { paymentReference: resolvedPaymentReference }),
          // Stamp de mise à jour côté duesStatus du member — laissé au
          // trigger `syncMemberDuesStatus` qui re-calcule worst-status-wins.
          // On NE flip PAS member.duesStatus ici pour éviter une double
          // source de vérité.
        })

        // Note : updateMember(duesStatus) géré par le trigger syncMemberDuesStatus.
        void serverTimestamp
      })
    } catch (err) {
      // Re-throw HttpsError tel quel ; loggue les autres avec code.
      if (err instanceof HttpsError) throw err
      const code = errCode(err)
      logger.error(`[markDuePaid] transaction failed [${code}]`, { err, dueId: input.dueId })
      throw new HttpsError('internal', `[markDuePaid] transaction failed [${code}]`)
    }

    // Hors transaction : enqueue email de confirmation. Pas critique pour
    // l'état Firestore — un échec ici ne doit pas rollback le paiement.
    try {
      const memberSnap = await db().doc(`members/${resolvedMemberId}`).get()
      let memberFirstName = ''
      let memberLastName = ''
      let recipients: string[] = []
      if (memberSnap.exists) {
        const member = memberSnap.data() as MemberData
        memberFirstName = member.firstName
        memberLastName = member.lastName
        recipients = await resolveBillingRecipients(member)
      } else {
        logger.warn('[markDuePaid] member missing for confirmation email', {
          memberId: resolvedMemberId,
          dueId: input.dueId,
        })
      }

      await enqueueDuesPaymentConfirmed({
        dueId: input.dueId,
        amount: resolvedAmount,
        memberFirstName,
        memberLastName,
        recipients,
        paidAt: input.paidAt.iso,
        paymentMethod: input.paymentMethod,
        paymentReference: resolvedPaymentReference,
      })
    } catch (err) {
      const code = errCode(err)
      logger.error(`[markDuePaid] enqueue confirmation email failed [${code}]`, {
        err,
        dueId: input.dueId,
      })
      // Pas de re-throw : le paiement est enregistré, l'email est best-effort.
    }

    logger.info('[markDuePaid] ok', {
      dueId: input.dueId,
      callerUid,
      paymentMethod: input.paymentMethod,
    })

    return { ok: true, dueId: input.dueId }
  },
)
