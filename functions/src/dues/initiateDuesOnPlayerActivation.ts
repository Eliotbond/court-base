/**
 * `initiateDuesOnPlayerActivation`
 *
 * Firestore trigger on `teams/{teamId}` writes. Detects players newly added
 * to `team.playerIds` (set difference before -> after) and creates one
 * `/dues/{id}` document per (newPlayerId, teamId, activeSeasonId).
 *
 * Deux paths à la naissance du due selon le contexte d'activation :
 *
 *  A. **Flux d'inscription register** — la registration liée au couple
 *     `(matchedMemberId=memberId, teamId)` existe et son `status` est l'un de
 *     `{ 'trial_in_progress', 'confirmed_pending_dues' }`. Le due naît
 *     directement en `status='issued'`, avec :
 *       - `issuedAt = now`
 *       - `dueAt    = registration.trialStartedAt + paymentDueDays`
 *       - `emailedAt = now` (l'email `dues_payment_request` est enqueueé
 *         immédiatement dans `/pendingEmails`).
 *     Conséquence : si le coach a tardé à confirmer (>paymentDueDays après
 *     `trialStartedAt`), le due est créé déjà overdue. C'est volontaire — la
 *     règle métier "max 2 semaines de paiement à partir du démarrage de
 *     l'essai" est portée par cette date, pas par la date de confirm.
 *
 *  B. **Hors flux register** — pas de registration matchée, ou registration
 *     dans un autre status. Le due naît en `status='pending_grace'`,
 *     `issuedAt = now + gracePeriodDays`, `dueAt = null`, pas d'email. C'est
 *     le path historique (player ajouté à `team.playerIds` par un admin
 *     directement). La transition `pending_grace → issued` reste portée par
 *     le scheduler `issueDuesScheduled`.
 *
 * Side-effect commun aux deux paths : `member.duesStatus` est flippé en
 * `pending_grace` ou `due` selon le statut du due — le trigger
 * `syncMemberDuesStatus` re-calculera worst-status-wins ensuite, mais ce stamp
 * direct évite un lag pour l'UI.
 *
 * Idempotence (Firestore can replay triggers) :
 *   - If a `/dues` doc already exists for (memberId, teamId, seasonId), skip.
 *   - If no active season, log a warning and skip — operator will need to
 *     activate the season for dues to be initiated.
 *   - If 2+ active seasons, log error and skip — invariant violation.
 *   - L'enqueue email post-création ré-utilise les `set()` sur ID déterministe
 *     `{dueId}_dues_payment_request` — un re-trigger n'écrit pas de doublon.
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions/v2'
import type {
  CotisationData as DueData,
  CotisationTypeData,
  MemberData,
  RegistrationData,
  RegistrationStatus,
  TeamData,
} from '@club-app/shared-types'
import {
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

/**
 * Contexte registration récupéré best-effort par `findRegistrationContext`.
 *
 * - `registeredByUid` : uid du compte ayant soumis l'inscription. Dénormalisé
 *   dans `due.registeredByUid` pour ancrer l'autorisation de lecture (rule
 *   `/dues`).
 * - `status` : statut courant de la registration. Sert à décider entre le
 *   path A (due naît `issued`) et le path B (due naît `pending_grace`).
 * - `trialStartedAt` : ancre temporelle pour `dueAt` quand on est en path A.
 *
 * Tous les champs peuvent être `null` (hors flux register, lecture échouée).
 */
export interface RegistrationContext {
  registeredByUid: string | null
  status: RegistrationStatus | null
  trialStartedAt: { seconds: number; nanoseconds: number } | null
}

/**
 * Best-effort : retrouve la registration qui a mené à l'ajout de ce joueur
 * dans la team, et extrait `submittedByUid` + `status` + `trialStartedAt`
 * pour piloter à la fois la dénormalisation `due.registeredByUid` ET la
 * branche A/B (issued vs pending_grace) de la création du due.
 *
 * Retourne `{ registeredByUid: null, status: null, trialStartedAt: null }` si
 * le joueur a été ajouté hors flux d'inscription (création directe par un
 * admin) ou si la lecture échoue — la cotisation reste créée normalement, la
 * rule retombe alors sur ses autres clauses (admin / coach / tuteur / membre
 * lié) et le path B s'applique.
 *
 * Pas d'index composite : deux filtres d'égalité + tri JS (cf. CLAUDE.md §10).
 * Plusieurs registrations possibles pour un même couple (joueur ré-inscrit) —
 * on garde la plus récente par `createdAt`.
 */
export async function findRegistrationContext(
  memberId: string,
  teamId: string,
): Promise<RegistrationContext> {
  const empty: RegistrationContext = {
    registeredByUid: null,
    status: null,
    trialStartedAt: null,
  }
  try {
    const snap = await col('registrations')
      .where('matchedMemberId', '==', memberId)
      .where('teamId', '==', teamId)
      .get()
    if (snap.empty) return empty
    const latest = snap.docs
      .map((d) => d.data() as RegistrationData)
      .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))[0]
    if (!latest) return empty
    return {
      registeredByUid: latest.submittedByUid ?? null,
      status: latest.status ?? null,
      trialStartedAt: latest.trialStartedAt ?? null,
    }
  } catch (err) {
    logger.warn(
      'initiateDuesOnPlayerActivation: registration lookup failed — context left empty',
      { memberId, teamId, err },
    )
    return empty
  }
}

/**
 * Backward-compat shim : conserve l'ancienne signature pour les tests existants
 * et tout call site externe. Préférer `findRegistrationContext` dans le nouveau
 * code — il retourne aussi `status` et `trialStartedAt` (utiles pour décider
 * du path A/B). Cette fonction n'est plus utilisée en interne par le trigger
 * mais on la garde exportée pour ne pas casser les tests / consumers.
 */
export async function findRegisteredByUid(
  memberId: string,
  teamId: string,
): Promise<string | null> {
  const ctx = await findRegistrationContext(memberId, teamId)
  return ctx.registeredByUid
}

interface DuesConfigLike {
  gracePeriodDays?: number
  paymentDueDays?: number
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
 * Lecture de `paymentDueDays` (cf. duplicata dans `issueDuesScheduled.ts`).
 * On duplique délibérément ici plutôt que d'extraire dans `_helpers.ts` — les
 * deux call sites consomment la valeur différemment (delta sur `trialStartedAt`
 * ici vs delta sur `issuedAt` côté scheduler), et on évite le couplage entre
 * fichiers tant que le subagent qui possède `_helpers.ts` ne factorise pas.
 */
async function readPaymentDueDays(): Promise<number> {
  const cfgSnap = await db().doc('config/club').get()
  const cfg = cfgSnap.data() as { duesConfig?: DuesConfigLike } | undefined
  const value = cfg?.duesConfig?.paymentDueDays
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    logger.warn(
      'initiateDuesOnPlayerActivation: invalid duesConfig.paymentDueDays — defaulting to 14',
      { value },
    )
    return 14
  }
  return value
}

/**
 * Statuts de registration qui autorisent la naissance du due directement en
 * `issued` (path A). Hors de cette liste, on retombe sur le path B
 * (`pending_grace`).
 */
const ISSUED_PATH_REGISTRATION_STATUSES: readonly RegistrationStatus[] = [
  'trial_in_progress',
  'confirmed_pending_dues',
]

export interface CreateDuesResult {
  outcome: 'created' | 'already-exists'
  /** `true` si on est sur le path A — le caller doit enqueuer l'email. */
  needsImmediateEmail: boolean
  /** ID du dues doc créé (utilisable pour l'enqueue email post-tx). */
  dueId: string | null
}

/**
 * Décide si on est sur le path A (due naît `issued`, email immédiat) ou le
 * path B (due naît `pending_grace`, scheduler s'occupe de l'issue + email).
 * Pure — facile à unit-tester.
 */
export function shouldIssueImmediately(ctx: RegistrationContext): boolean {
  if (!ctx.status) return false
  if (!ctx.trialStartedAt) return false
  return ISSUED_PATH_REGISTRATION_STATUSES.includes(ctx.status)
}

/**
 * Create the dues doc + flip member.duesStatus inside a single transaction.
 * Idempotent: a pre-existing dues doc for (memberId, teamId, seasonId) short-circuits.
 *
 * Branch A (path register, `regCtx` matche `shouldIssueImmediately`) :
 *   - `status = 'issued'`
 *   - `issuedAt = activatedAt = now`
 *   - `dueAt   = regCtx.trialStartedAt + paymentDueDays` (peut être passé)
 *   - `emailedAt = now` (l'email sera enqueueé hors transaction par le caller)
 *   - `member.duesStatus = 'due'`
 *
 * Branch B (path historique) :
 *   - `status = 'pending_grace'`
 *   - `issuedAt = activatedAt + gracePeriodDays`
 *   - `dueAt = null`
 *   - `emailedAt = null`
 *   - `member.duesStatus = 'pending_grace'`
 */
export async function createDuesIfMissing(args: {
  memberId: string
  teamId: string
  seasonId: string
  duesAmount: number
  gracePeriodDays: number
  paymentDueDays: number
  regCtx: RegistrationContext
}): Promise<CreateDuesResult> {
  const {
    memberId,
    teamId,
    seasonId,
    duesAmount,
    gracePeriodDays,
    paymentDueDays,
    regCtx,
  } = args
  const duesQuery = col('dues')
    .where('memberId', '==', memberId)
    .where('teamId', '==', teamId)
    .where('seasonId', '==', seasonId)
    .limit(1)

  return db().runTransaction(async (tx) => {
    const existing = await tx.get(duesQuery)
    if (!existing.empty) {
      return {
        outcome: 'already-exists' as const,
        needsImmediateEmail: false,
        dueId: null,
      }
    }

    const newDueRef = col('dues').doc()
    const memberRef = db().doc(`members/${memberId}`)
    const activatedAt = Timestamp.now()
    // Référence de paiement déterministe (utilisée dans l'email de demande).
    const paymentReference = buildPaymentReference(newDueRef.id)

    const issueImmediately = shouldIssueImmediately(regCtx)

    let status: DueData['status']
    let issuedAt: FirebaseFirestore.Timestamp
    let dueAt: FirebaseFirestore.Timestamp | null
    let emailedAt: FirebaseFirestore.Timestamp | null
    let memberDuesStatus: 'pending_grace' | 'due'

    if (issueImmediately && regCtx.trialStartedAt) {
      // Path A — registration confirmée, due naît déjà issued.
      // dueAt = trialStartedAt + paymentDueDays. Peut être dans le passé si
      // confirm tardif → due immédiatement overdue (markOverdueScheduled fera
      // la transition au prochain run quotidien).
      //
      // `regCtx.trialStartedAt` est typé `{seconds, nanoseconds}` (forme
      // structurelle compatible) — `addDaysToTimestamp` lit ces deux champs
      // et renvoie un `admin.firestore.Timestamp`. On cast vers le type Admin
      // SDK pour satisfaire le compilateur sans instancier (le constructor
      // exige le Admin SDK chargé, ce qui complique les tests).
      const trialTs = regCtx.trialStartedAt as unknown as FirebaseFirestore.Timestamp
      status = 'issued'
      issuedAt = activatedAt
      dueAt = addDaysToTimestamp(trialTs, paymentDueDays)
      emailedAt = activatedAt
      memberDuesStatus = 'due'
    } else {
      // Path B — pas de registration matchée (ou status hors fenêtre). Cas
      // historique : admin ajoute un joueur à la team directement.
      status = 'pending_grace'
      issuedAt = addDaysToTimestamp(activatedAt, gracePeriodDays)
      dueAt = null
      emailedAt = null
      memberDuesStatus = 'pending_grace'
    }

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
      dueAt,
      status,
      paidAt: null,
      paidAmount: null,
      paymentMethod: null,
      recordedBy: null,
      exceptionRequestId: null,
      notes: null,
      // Nouveaux champs (shared-types subagent) — défensif si absent.
      paymentReference,
      emailedAt,
      // Ancre d'autorisation : le compte ayant fait l'inscription pourra lire
      // cette cotisation via la rule `/dues` (cf. firestore.rules).
      registeredByUid: regCtx.registeredByUid,
      // createdAt = server timestamp (recorded by Firestore on write).
      // Cast through unknown because DueData.createdAt is a Timestamp value but
      // we want the sentinel — same pattern Firestore docs recommend.
      createdAt: serverTimestamp() as unknown as DueData['createdAt'],
    } as unknown as DueData

    tx.set(newDueRef, due)
    tx.update(memberRef, {
      duesStatus: memberDuesStatus,
      duesStatusUpdatedAt: serverTimestamp(),
    })
    return {
      outcome: 'created' as const,
      needsImmediateEmail: issueImmediately && regCtx.trialStartedAt !== null,
      dueId: newDueRef.id,
    }
  })
}

/**
 * Post-transaction : pour un due qui vient de naître en `issued` (path A), on
 * enqueue un mail `dues_payment_request` dans `/pendingEmails`. ID
 * déterministe `{dueId}_dues_payment_request` → set idempotent. Best-effort :
 * un échec ici n'invalide pas la création du due.
 *
 * Logique miroir de `enqueuePaymentRequestEmails` côté `issueDuesScheduled` —
 * dupliquée volontairement pour éviter le couplage des deux call sites.
 */
async function enqueueImmediatePaymentRequest(dueId: string): Promise<void> {
  try {
    const dueRef = db().doc(`dues/${dueId}`)
    const dueSnap = await dueRef.get()
    if (!dueSnap.exists) {
      logger.warn('initiateDuesOnPlayerActivation: due disappeared before email', {
        dueId,
      })
      return
    }
    const due = dueSnap.data() as DueData

    const memberSnap = await db().doc(`members/${due.memberId}`).get()
    if (!memberSnap.exists) {
      logger.warn('initiateDuesOnPlayerActivation: member missing, skipping email', {
        dueId,
        memberId: due.memberId,
      })
      return
    }
    const member = memberSnap.data() as MemberData

    const banking = await readClubBanking()
    const recipients = await resolveBillingRecipients(member)
    if (recipients.length === 0) {
      logger.warn('initiateDuesOnPlayerActivation: no recipient emails resolved', {
        dueId,
        memberId: due.memberId,
      })
      // On enqueue quand même `to: null` pour que le worker remonte l'incident.
    }

    const paymentReference = due.paymentReference ?? buildPaymentReference(dueId)
    const dueAtIso = tsToIso(
      due.dueAt as unknown as { seconds: number; nanoseconds: number } | null,
    )

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
        logger.warn(`initiateDuesOnPlayerActivation: read season failed [${code}]`, {
          err,
          dueId,
        })
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
  } catch (err) {
    const code = errCode(err)
    logger.error(
      `initiateDuesOnPlayerActivation: enqueue immediate email failed [${code}]`,
      { err, dueId },
    )
  }
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
    const cotisation = cotisationSnap.data() as CotisationTypeData
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

    const [gracePeriodDays, paymentDueDays] = await Promise.all([
      readGracePeriodDays(),
      readPaymentDueDays(),
    ])

    for (const memberId of newPlayerIds) {
      try {
        const regCtx = await findRegistrationContext(memberId, teamId)
        const result = await createDuesIfMissing({
          memberId,
          teamId,
          seasonId,
          duesAmount,
          gracePeriodDays,
          paymentDueDays,
          regCtx,
        })
        logger.info('initiateDuesOnPlayerActivation: dues processed', {
          memberId,
          teamId,
          seasonId,
          outcome: result.outcome,
          path: result.needsImmediateEmail ? 'A (issued)' : 'B (pending_grace)',
        })
        // Path A — enqueue mail "à payer" immédiatement, hors transaction.
        if (
          result.outcome === 'created' &&
          result.needsImmediateEmail &&
          result.dueId
        ) {
          await enqueueImmediatePaymentRequest(result.dueId)
        }
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
