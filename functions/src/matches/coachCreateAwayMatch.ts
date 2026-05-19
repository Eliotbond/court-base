/**
 * `coachCreateAwayMatch` — callable : création d'un match AWAY par un coach
 * (de l'équipe concernée) ou un admin / rootAdmin.
 *
 * Port server-side de `apps/web/src/repositories/matches.repo.ts`
 * (`createAwayMatch`). Un match away n'a **pas** de booking associé
 * (`bookingId: null`) — le doc `/matches/{matchId}` est la source de vérité
 * pour `date` / `startTime` / `endTime` / `awayAddress` / `opponentName`.
 *
 * Auth : signed-in. Le caller doit être :
 *   - admin (rôle `'admin'` côté `/users/{uid}` ou claim `rootAdmin`), OU
 *   - coach (`'coach'` dans `roles`) ET membre de l'équipe (`teamId` dans
 *     `user.teamIds`).
 * Sinon `permission-denied`.
 *
 * Effet :
 *   1. `add()` sur `/matches` avec `kind: 'away'`, `bookingId: null`,
 *      `date` ancrée en **minuit UTC** (cf. `_helpers.utcMidnight` — un
 *      serveur n'a pas de TZ navigateur, et `autoOfficialsNeeded` /
 *      `matchReminders` lisent `/matches.date` comme une date UTC).
 *   2. Best-effort : `freeConflictingTrainings` libère les trainings/reserves
 *      de l'équipe qui chevauchent le créneau. Si ça échoue, le match reste
 *      créé — on logge et on renvoie `freedBookingIds: []`.
 *
 * Region : europe-west6 (héritée du `setGlobalOptions` dans `src/index.ts`).
 *
 * NOTE deploy : nouvelle Function v2 → après le premier deploy, ajouter le
 * binding IAM `allUsers/run.invoker` (cf. `functions/CLAUDE.md` §"Après deploy").
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from '../shared/logger'
import type { MatchData, MatchTypeData, UserData } from '@club-app/shared-types'
import {
  db,
  freeConflictingTrainings,
  serverTimestamp,
  utcMidnight,
} from './_helpers'

interface CoachCreateAwayMatchInput {
  teamId: unknown
  matchTypeId: unknown
  opponentName: unknown
  awayAddress: unknown
  /** Epoch millis. */
  date: unknown
  /** "HH:MM". */
  startTime: unknown
  /** "HH:MM". */
  endTime: unknown
  notes: unknown
}

export interface CoachCreateAwayMatchOutput {
  ok: true
  matchId: string
  freedBookingIds: string[]
}

interface ParsedInput {
  teamId: string
  matchTypeId: string
  opponentName: string
  awayAddress: string
  /** Epoch millis du jour du match. */
  date: number
  startTime: string
  endTime: string
  notes: string | null
}

/** "HH:MM" 24h, zéro-paddé (00:00 → 23:59). */
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/** Parse + trim une string requise non-vide. */
function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${field} must be a string`)
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new HttpsError('invalid-argument', `${field} is required`)
  }
  return trimmed
}

/** Parse une string "HH:MM" requise. */
function requiredTime(value: unknown, field: string): string {
  const s = requiredString(value, field)
  if (!HHMM_RE.test(s)) {
    throw new HttpsError('invalid-argument', `${field} must be "HH:MM"`)
  }
  return s
}

function parseInput(data: CoachCreateAwayMatchInput): ParsedInput {
  const d = data ?? ({} as CoachCreateAwayMatchInput)

  const teamId = requiredString(d.teamId, 'teamId')
  const matchTypeId = requiredString(d.matchTypeId, 'matchTypeId')
  const opponentName = requiredString(d.opponentName, 'opponentName')
  const awayAddress = requiredString(d.awayAddress, 'awayAddress')
  const startTime = requiredTime(d.startTime, 'startTime')
  const endTime = requiredTime(d.endTime, 'endTime')

  if (typeof d.date !== 'number' || !Number.isFinite(d.date)) {
    throw new HttpsError('invalid-argument', 'date must be an epoch-millis number')
  }

  if (endTime <= startTime) {
    throw new HttpsError('invalid-argument', 'endTime must be after startTime')
  }

  let notes: string | null = null
  if (d.notes !== undefined && d.notes !== null) {
    if (typeof d.notes !== 'string') {
      throw new HttpsError('invalid-argument', 'notes must be a string or null')
    }
    const trimmed = d.notes.trim()
    notes = trimmed.length > 0 ? trimmed : null
  }

  return {
    teamId,
    matchTypeId,
    opponentName,
    awayAddress,
    date: d.date,
    startTime,
    endTime,
    notes,
  }
}

/**
 * Autorise un admin / rootAdmin, OU un coach de l'équipe `teamId`.
 *
 * - admin : claim Auth `rootAdmin === true` OU rôle `'admin'` côté `/users`.
 * - coach : rôle `'coach'` côté `/users` ET `teamId` présent dans
 *   `user.teamIds` (scope team — cf. mémoire `project_teamids_canonical`).
 */
function assertCoachOrAdmin(
  user: UserData,
  token: CallableRequest<CoachCreateAwayMatchInput>['auth'],
  teamId: string,
): void {
  if (token?.token?.rootAdmin === true) return
  const roles = user.roles ?? []
  if (roles.includes('admin')) return
  if (roles.includes('coach') && (user.teamIds ?? []).includes(teamId)) return
  throw new HttpsError(
    'permission-denied',
    'Caller must be an admin or a coach of the team to create an away match.',
  )
}

export const coachCreateAwayMatch = onCall(
  async (
    request: CallableRequest<CoachCreateAwayMatchInput>,
  ): Promise<CoachCreateAwayMatchOutput> => {
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        '[coachCreateAwayMatch] Must be signed in.',
      )
    }
    const callerUid = request.auth.uid
    const input = parseInput(request.data)

    const firestore = db()

    // --- Pré-checks : user, team, matchType existent. -----------------------
    const userSnap = await firestore.doc(`users/${callerUid}`).get()
    if (!userSnap.exists) {
      throw new HttpsError(
        'permission-denied',
        '[coachCreateAwayMatch] No /users doc for caller.',
      )
    }
    const user = userSnap.data() as UserData
    assertCoachOrAdmin(user, request.auth, input.teamId)

    const [teamSnap, matchTypeSnap] = await Promise.all([
      firestore.doc(`teams/${input.teamId}`).get(),
      firestore.doc(`matchTypes/${input.matchTypeId}`).get(),
    ])
    if (!teamSnap.exists) {
      throw new HttpsError(
        'not-found',
        `[coachCreateAwayMatch] team ${input.teamId} not found`,
      )
    }
    if (!matchTypeSnap.exists) {
      throw new HttpsError(
        'not-found',
        `[coachCreateAwayMatch] matchType ${input.matchTypeId} not found`,
      )
    }
    // Touch the data so the schema type is referenced (and future-proofs a
    // check if matchType.active gating is ever required here).
    void (matchTypeSnap.data() as MatchTypeData)

    // --- Création du match away (pas de booking — un seul add()). -----------
    const dayStart = utcMidnight(input.date)
    const matchData: MatchData = {
      bookingId: null,
      kind: 'away',
      teamId: input.teamId,
      matchTypeId: input.matchTypeId,
      opponentName: input.opponentName,
      awayAddress: input.awayAddress,
      date: dayStart,
      startTime: input.startTime,
      endTime: input.endTime,
      status: 'scheduled',
      notes: input.notes,
      // serverTimestamp() — résolu côté serveur ; le type MatchData attend un
      // Timestamp, le FieldValue est accepté à l'écriture.
      createdAt: serverTimestamp() as unknown as MatchData['createdAt'],
      createdBy: callerUid,
    }

    let matchId: string
    try {
      const ref = await firestore.collection('matches').add(matchData)
      matchId = ref.id
    } catch (err) {
      logger.error('[coachCreateAwayMatch] failed to create match', {
        err,
        teamId: input.teamId,
      })
      throw new HttpsError('internal', '[coachCreateAwayMatch] match creation failed')
    }

    // --- Best-effort : libération des trainings/reserves conflictuels. ------
    // Si ça échoue, le match reste créé (pas de rollback) — un re-trigger
    // manuel libérera les bookings plus tard.
    let freedBookingIds: string[] = []
    try {
      freedBookingIds = await freeConflictingTrainings({
        teamId: input.teamId,
        dayStart,
        startTime: input.startTime,
        endTime: input.endTime,
        reason: 'match_away',
        editorUid: callerUid,
      })
    } catch (err) {
      logger.error(
        `[coachCreateAwayMatch] match ${matchId} created but freeConflictingTrainings failed — manual re-trigger required`,
        { err, matchId, teamId: input.teamId },
      )
    }

    logger.info('[coachCreateAwayMatch] ok', {
      matchId,
      callerUid,
      teamId: input.teamId,
      freed: freedBookingIds.length,
    })

    return { ok: true, matchId, freedBookingIds }
  },
)
