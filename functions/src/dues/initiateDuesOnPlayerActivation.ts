/**
 * `initiateDuesOnPlayerActivation`
 *
 * Firestore trigger on `teams/{teamId}` writes. Detects players newly added
 * to `team.playerIds` (set difference before -> after) and creates one
 * `/dues/{id}` document per (newPlayerId, teamId, activeSeasonId) with
 * `status = 'pending_grace'`. Also flips the member's `duesStatus` to
 * `'pending_grace'`.
 *
 * Business rules — see `docs/main.md` section "Dues & exclusion" :
 *   - J0  = player added to `team.playerIds`.
 *   - J+gracePeriodDays = `issuedAt`. `dueAt` stays null until issuance.
 *   - `amount` is copied from `team.duesAmount` at creation time.
 *
 * Idempotence (Firestore can replay triggers) :
 *   - If a `/dues` doc already exists for (memberId, teamId, seasonId), skip.
 *   - If no active season, log a warning and skip — operator will need to
 *     activate the season for dues to be initiated.
 *   - If 2+ active seasons, log error and skip — invariant violation.
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions/v2'
import type { CotisationData, DueData, TeamData } from '@club-app/shared-types'
import {
  Timestamp,
  addDaysToTimestamp,
  col,
  db,
  serverTimestamp,
} from './_helpers'
import { buildPaymentReference } from './_emailEnqueue'

interface ActiveSeasonLookup {
  seasonId: string | null
  multiple: boolean
}

export async function findActiveSeasonId(): Promise<ActiveSeasonLookup> {
  const snap = await col('seasons').where('status', '==', 'active').limit(2).get()
  if (snap.empty) return { seasonId: null, multiple: false }
  if (snap.size > 1) return { seasonId: snap.docs[0].id, multiple: true }
  return { seasonId: snap.docs[0].id, multiple: false }
}

export function diffNewPlayerIds(
  beforePlayerIds: readonly string[] | undefined,
  afterPlayerIds: readonly string[] | undefined,
): string[] {
  const before = new Set(beforePlayerIds ?? [])
  const after = afterPlayerIds ?? []
  return after.filter((id) => !before.has(id))
}

interface DuesConfigLike {
  gracePeriodDays: number
}

async function readGracePeriodDays(): Promise<number> {
  const cfgSnap = await db().doc('config/club').get()
  const cfg = cfgSnap.data() as { duesConfig?: DuesConfigLike } | undefined
  const value = cfg?.duesConfig?.gracePeriodDays
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    logger.warn(
      'initiateDuesOnPlayerActivation: invalid duesConfig.gracePeriodDays — defaulting to 21',
      { value },
    )
    return 21
  }
  return value
}

/**
 * Create the dues doc + flip member.duesStatus inside a single transaction.
 * Idempotent: a pre-existing dues doc for (memberId, teamId, seasonId) short-circuits.
 */
export async function createDuesIfMissing(args: {
  memberId: string
  teamId: string
  seasonId: string
  duesAmount: number
  gracePeriodDays: number
}): Promise<'created' | 'already-exists'> {
  const { memberId, teamId, seasonId, duesAmount, gracePeriodDays } = args
  const duesQuery = col('dues')
    .where('memberId', '==', memberId)
    .where('teamId', '==', teamId)
    .where('seasonId', '==', seasonId)
    .limit(1)

  return db().runTransaction(async (tx) => {
    const existing = await tx.get(duesQuery)
    if (!existing.empty) return 'already-exists' as const

    const newDueRef = col('dues').doc()
    const memberRef = db().doc(`members/${memberId}`)
    const activatedAt = Timestamp.now()
    const issuedAt = addDaysToTimestamp(activatedAt, gracePeriodDays)
    // Référence de paiement déterministe (utilisée dans l'email de demande).
    // On la pose dès la création — la transition pending_grace → issued
    // (issueDuesScheduled) la propage telle quelle dans le contexte email.
    const paymentReference = buildPaymentReference(newDueRef.id)

    // NOTE typing : `DueData` n'inclut pas encore `paymentReference` /
    // `emailedAt` dans certaines versions de shared-types (le subagent types
    // les ajoute en parallèle). On les écrit ici via un cast élargi pour ne
    // pas bloquer le build tant que la version embarquée des types n'a pas
    // les nouveaux champs.
    const due = {
      memberId,
      teamId,
      seasonId,
      amount: duesAmount,
      // Use real Timestamps for derived fields we need to query against later.
      activatedAt,
      issuedAt,
      dueAt: null,
      status: 'pending_grace' as const,
      paidAt: null,
      paidAmount: null,
      paymentMethod: null,
      recordedBy: null,
      exceptionRequestId: null,
      notes: null,
      // Nouveaux champs (shared-types subagent) — défensif si absent.
      paymentReference,
      emailedAt: null,
      // createdAt = server timestamp (recorded by Firestore on write).
      // Cast through unknown because DueData.createdAt is a Timestamp value but
      // we want the sentinel — same pattern Firestore docs recommend.
      createdAt: serverTimestamp() as unknown as DueData['createdAt'],
    } as unknown as DueData

    tx.set(newDueRef, due)
    tx.update(memberRef, {
      duesStatus: 'pending_grace',
      duesStatusUpdatedAt: serverTimestamp(),
    })
    return 'created' as const
  })
}

export const initiateDuesOnPlayerActivation = onDocumentWritten(
  'teams/{teamId}',
  async (event) => {
    const change = event.data
    if (!change) {
      logger.warn('initiateDuesOnPlayerActivation: missing event.data, skipping')
      return
    }
    const beforeData = change.before.exists ? (change.before.data() as TeamData) : undefined
    const afterData = change.after.exists ? (change.after.data() as TeamData) : undefined

    // Team deleted -> nothing to do.
    if (!afterData) return

    const newPlayerIds = diffNewPlayerIds(beforeData?.playerIds, afterData.playerIds)
    if (newPlayerIds.length === 0) return

    const teamId = event.params.teamId
    const cotisationId = afterData.cotisationId
    if (typeof cotisationId !== 'string' || cotisationId.length === 0) {
      logger.error(
        'initiateDuesOnPlayerActivation: team.cotisationId missing, skipping',
        { teamId },
      )
      return
    }
    const cotisationSnap = await db().doc(`cotisations/${cotisationId}`).get()
    if (!cotisationSnap.exists) {
      logger.error(
        'initiateDuesOnPlayerActivation: referenced cotisation not found, skipping',
        { teamId, cotisationId },
      )
      return
    }
    const cotisation = cotisationSnap.data() as CotisationData
    const duesAmount = cotisation.price
    if (typeof duesAmount !== 'number' || !Number.isFinite(duesAmount) || duesAmount < 0) {
      logger.error(
        'initiateDuesOnPlayerActivation: cotisation.price missing or invalid, skipping',
        { teamId, cotisationId, duesAmount },
      )
      return
    }

    const { seasonId, multiple } = await findActiveSeasonId()
    if (!seasonId) {
      logger.warn(
        'initiateDuesOnPlayerActivation: no active season — dues not created',
        { teamId, newPlayerIds },
      )
      return
    }
    if (multiple) {
      logger.error(
        'initiateDuesOnPlayerActivation: multiple active seasons — invariant violated, skipping',
        { teamId, newPlayerIds },
      )
      return
    }

    const gracePeriodDays = await readGracePeriodDays()

    for (const memberId of newPlayerIds) {
      try {
        const result = await createDuesIfMissing({
          memberId,
          teamId,
          seasonId,
          duesAmount,
          gracePeriodDays,
        })
        logger.info('initiateDuesOnPlayerActivation: dues processed', {
          memberId,
          teamId,
          seasonId,
          result,
        })
      } catch (err) {
        logger.error('initiateDuesOnPlayerActivation: failed to create dues', {
          memberId,
          teamId,
          seasonId,
          err,
        })
        // Continue with other players — a single failure shouldn't block the rest.
      }
    }
  },
)
