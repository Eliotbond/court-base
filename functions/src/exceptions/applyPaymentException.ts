/**
 * `applyPaymentException`
 *
 * Firestore trigger on `paymentExceptionRequests/{requestId}` writes.
 * Coordinates the side-effects of the dues-exception lifecycle described in
 * `docs/main.md` ("Flow exception coach") and `docs/firebase.md` (Cloud
 * Functions table row `applyPaymentException`).
 *
 * Lifecycle handled here :
 *
 *   pending  → set `dues.status = "excepted"` and link `exceptionRequestId`
 *              (so `syncMemberDuesStatus` will compute `member.duesStatus =
 *              "excepted"` — exclusion suspended while the admin reviews).
 *
 *   approved → apply `newIssuedAt` / `newDueAt` from the request onto the
 *              dues doc. If the dues was tentatively `excepted`, restore it
 *              to `issued` or `overdue` depending on the new `dueAt` vs now.
 *              Keep `exceptionRequestId` pointing at the resolved request
 *              (audit trail).
 *
 *   rejected → restore the dues : clear `exceptionRequestId`, recompute the
 *              status from the existing dates (`issued` if `dueAt >= now`,
 *              `overdue` otherwise). `syncMemberDuesStatus` will then flip
 *              the member back to `excluded` if appropriate (worst-status-
 *              wins).
 *
 * We deliberately **only** touch the dues doc here. The member's
 * `duesStatus` is recomputed by `syncMemberDuesStatus` (single source of
 * truth) once the dues write lands.
 *
 * Idempotence : every branch checks the current dues state before writing
 * and short-circuits when there is nothing to change. Re-triggers on the
 * same transition are no-ops.
 *
 * NOTE on pending : we expose a second handler (`applyPaymentExceptionOnCreate`)
 * triggered on document creation. Splitting create vs. update is simpler
 * than overloading a single `onDocumentWritten` with three branches and
 * avoids accidentally re-running the create-time bootstrap on later updates.
 */
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore'
import type { Timestamp as AdminTimestamp } from 'firebase-admin/firestore'
import * as admin from 'firebase-admin'
import type {
  CotisationData as DueData,
  PaymentExceptionRequestData,
} from '@club-app/shared-types'
import { db } from '../shared/firestore'
import { logger } from '../shared/logger'

type AnyTimestamp = AdminTimestamp | { seconds: number; nanoseconds: number }

/** Returns `true` when `ts` represents a moment strictly before `now`. */
function isInPast(ts: AnyTimestamp | null | undefined, nowSeconds: number): boolean {
  if (!ts) return false
  return ts.seconds < nowSeconds
}

/** "Now" as a Firestore Timestamp (seconds resolution sufficient here). */
function nowSeconds(): number {
  return admin.firestore.Timestamp.now().seconds
}

// ---------------------------------------------------------------------------
// onCreate : pending → tentatively mark the dues as `excepted`.
// ---------------------------------------------------------------------------

export const applyPaymentExceptionOnCreate = onDocumentCreated(
  'paymentExceptionRequests/{requestId}',
  async (event) => {
    const snap = event.data
    if (!snap) {
      logger.warn('applyPaymentExceptionOnCreate: missing event.data, skipping')
      return
    }
    const request = snap.data() as PaymentExceptionRequestData | undefined
    if (!request) {
      logger.warn('applyPaymentExceptionOnCreate: empty request data, skipping')
      return
    }
    // Defensive: only act if the request was created `pending` (other initial
    // states would be unusual but we don't want to clobber dues either way).
    if (request.status !== 'pending') return

    const requestId = event.params.requestId
    const dueRef = db().doc(`dues/${request.dueId}`)

    try {
      await db().runTransaction(async (tx) => {
        const dueSnap = await tx.get(dueRef)
        if (!dueSnap.exists) {
          logger.warn('applyPaymentExceptionOnCreate: dues doc missing', {
            requestId,
            dueId: request.dueId,
          })
          return
        }
        const due = dueSnap.data() as DueData
        // Idempotence: already excepted and linked to this same request → no-op.
        if (due.status === 'excepted' && due.exceptionRequestId === requestId) return
        // Don't override terminal states.
        if (due.status === 'paid' || due.status === 'cancelled') {
          logger.warn(
            'applyPaymentExceptionOnCreate: dues already terminal, skipping',
            { requestId, dueId: request.dueId, status: due.status },
          )
          return
        }
        tx.update(dueRef, {
          status: 'excepted',
          exceptionRequestId: requestId,
        })
      })
    } catch (err) {
      logger.error('applyPaymentExceptionOnCreate: transaction failed', {
        requestId,
        dueId: request.dueId,
        err,
      })
    }
  },
)

// ---------------------------------------------------------------------------
// onWrite : pending → approved | rejected. Other transitions are no-ops.
// ---------------------------------------------------------------------------

type Transition = 'approve' | 'reject' | 'none'

export function classifyTransition(
  before: PaymentExceptionRequestData | undefined,
  after: PaymentExceptionRequestData | undefined,
): Transition {
  if (!before || !after) return 'none'
  if (before.status !== 'pending') return 'none'
  if (after.status === 'approved') return 'approve'
  if (after.status === 'rejected') return 'reject'
  return 'none'
}

/**
 * Recompute the appropriate dues `status` post-rejection / when restoring an
 * approved-exception that has past dates. Pure function — easy to unit-test.
 */
export function restoredDueStatus(
  dueAt: AnyTimestamp | null | undefined,
  now: number,
): 'issued' | 'overdue' {
  return isInPast(dueAt, now) ? 'overdue' : 'issued'
}

export async function applyApproval(args: {
  requestId: string
  request: PaymentExceptionRequestData
}): Promise<void> {
  const { requestId, request } = args
  const dueRef = db().doc(`dues/${request.dueId}`)
  await db().runTransaction(async (tx) => {
    const dueSnap = await tx.get(dueRef)
    if (!dueSnap.exists) {
      logger.warn('applyPaymentException(approve): dues doc missing', {
        requestId,
        dueId: request.dueId,
      })
      return
    }
    const due = dueSnap.data() as DueData
    // Don't override terminal states (paid / cancelled).
    if (due.status === 'paid' || due.status === 'cancelled') {
      logger.warn('applyPaymentException(approve): dues already terminal, skipping', {
        requestId,
        dueId: request.dueId,
        status: due.status,
      })
      return
    }

    const newIssuedAt = request.newIssuedAt ?? due.issuedAt
    const newDueAt = request.newDueAt ?? due.dueAt
    const nextStatus = restoredDueStatus(newDueAt, nowSeconds())

    // Idempotence : if every target field already matches, skip.
    const sameIssuedAt = sameTimestamp(due.issuedAt, newIssuedAt)
    const sameDueAt = sameTimestamp(due.dueAt, newDueAt)
    const sameStatus = due.status === nextStatus
    const sameLink = due.exceptionRequestId === requestId
    if (sameIssuedAt && sameDueAt && sameStatus && sameLink) return

    tx.update(dueRef, {
      issuedAt: newIssuedAt,
      dueAt: newDueAt,
      status: nextStatus,
      exceptionRequestId: requestId,
    })
  })
}

export async function applyRejection(args: {
  requestId: string
  request: PaymentExceptionRequestData
}): Promise<void> {
  const { requestId, request } = args
  const dueRef = db().doc(`dues/${request.dueId}`)
  await db().runTransaction(async (tx) => {
    const dueSnap = await tx.get(dueRef)
    if (!dueSnap.exists) {
      logger.warn('applyPaymentException(reject): dues doc missing', {
        requestId,
        dueId: request.dueId,
      })
      return
    }
    const due = dueSnap.data() as DueData
    // Don't override terminal states.
    if (due.status === 'paid' || due.status === 'cancelled') return

    // Only undo the link we set on create. If a different request now owns
    // the dues (race / re-assignment), leave it alone.
    const linkedToThis = due.exceptionRequestId === requestId
    const isExcepted = due.status === 'excepted'

    // Idempotence : nothing to undo.
    if (!linkedToThis && !isExcepted) return

    const nextStatus = isExcepted
      ? restoredDueStatus(due.dueAt, nowSeconds())
      : due.status

    const statusChanged = nextStatus !== due.status

    if (linkedToThis && statusChanged) {
      tx.update(dueRef, { exceptionRequestId: null, status: nextStatus })
    } else if (linkedToThis) {
      tx.update(dueRef, { exceptionRequestId: null })
    } else if (statusChanged) {
      tx.update(dueRef, { status: nextStatus })
    }
  })
}

function sameTimestamp(
  a: AnyTimestamp | null | undefined,
  b: AnyTimestamp | null | undefined,
): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return a.seconds === b.seconds && a.nanoseconds === b.nanoseconds
}

export const applyPaymentException = onDocumentWritten(
  'paymentExceptionRequests/{requestId}',
  async (event) => {
    const change = event.data
    if (!change) {
      logger.warn('applyPaymentException: missing event.data, skipping')
      return
    }
    const before = change.before.exists
      ? (change.before.data() as PaymentExceptionRequestData)
      : undefined
    const after = change.after.exists
      ? (change.after.data() as PaymentExceptionRequestData)
      : undefined

    const transition = classifyTransition(before, after)
    if (transition === 'none' || !after) return

    const requestId = event.params.requestId

    try {
      if (transition === 'approve') {
        await applyApproval({ requestId, request: after })
      } else {
        await applyRejection({ requestId, request: after })
      }
      logger.info('applyPaymentException: resolved', {
        requestId,
        dueId: after.dueId,
        transition,
      })
    } catch (err) {
      logger.error('applyPaymentException: failed', {
        requestId,
        dueId: after.dueId,
        transition,
        err,
      })
    }
  },
)

