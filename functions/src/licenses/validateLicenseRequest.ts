/**
 * `validateLicenseRequest` — décision finale du trésorier/admin/secrétaire
 * sur une `/licenseRequests/{id}` (PR3 du workflow).
 *
 * Pré-conditions selon la décision :
 *  - `approve` : `status === 'coach_validated'` ET TOUS les `requiredDocs`
 *    ont `treasurerReview.accepted` (le trésorier doit avoir explicitement
 *    validé chaque doc via `treasurerReviewLicenseDoc` avant d'approuver).
 *  - `reject` : `status ∈ {parent_docs_submitted, coach_validated}` —
 *    plus souple, pour permettre au trésorier de refuser dès que les docs
 *    parent sont arrivés (sans attendre la validation coach) si un défaut
 *    flagrant est détecté (doc faux, info erronée…). La validation coach
 *    reste un pré-filtre qui soulage le trésorier, mais elle n'est pas
 *    bloquante pour un refus.
 *
 * Effets :
 *  - **approve** : crée `/licenses/{auto-id}` `status: 'pending'`, snapshot
 *    `role/level/name/fee` depuis un `/licenseTypes` joueur (sélection :
 *    rôle `'player'` + actif, premier par `displayOrder asc`). Update la
 *    `/licenseRequests` en `'approved'`. Output `{ licenseId }`.
 *  - **reject**  : Update la `/licenseRequests` en `'rejected'`. Pas de
 *    `/licenses` créée. Output `{ licenseId: null }`.
 *
 * Pas de transition `pending → active` ici — cela reste l'acte séparé de
 * `confirmLicense` (qui poste aussi l'écriture comptable de la charge). La
 * licence est créée mais pas encore payée à la fédération.
 *
 * Auth : claim `rootAdmin` OU rôle `admin | treasurer | secretary`. Aligné
 * sur `confirmLicense` et `treasurerReviewLicenseDoc`.
 *
 * Idempotence : pas de retry sûr — un `approve` re-appelé après création de
 * `/licenses` produirait une 2ᵉ licence si le caller insiste (pré-condition
 * `status === 'coach_validated'` bloque cependant les retries naïfs, car le
 * premier appel pose `'approved'`). En cas de doute, lire la `/licenses` via
 * `request.requestId` côté UI avant retry.
 *
 * Region : europe-west6.
 *
 * NOTE deploy : nouvelle Function v2 → après le premier deploy, ajouter le
 * binding IAM `allUsers/run.invoker` (cf. `functions/CLAUDE.md`).
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import type {
  LicenseData,
  LicenseRequestData,
  LicenseTypeData,
  MemberData,
} from '@club-app/shared-types'
import { Timestamp, db } from '../dues/_helpers'
import {
  assertCanReviewAsTreasurer,
  computeAllTreasurerAccepted,
  loadCallerUser,
} from './_reviewHelpers'

interface ValidateLicenseRequestInput {
  requestId: unknown
  decision: unknown
  comment?: unknown
}

export interface ValidateLicenseRequestOutput {
  ok: true
  requestId: string
  newStatus: 'approved' | 'rejected'
  /** id `/licenses/{id}` créée si `approve`, `null` si `reject`. */
  licenseId: string | null
}

interface ParsedInput {
  requestId: string
  decision: 'approve' | 'reject'
  comment: string | null
}

const COMMENT_MAX = 500

function parseInput(data: ValidateLicenseRequestInput): ParsedInput {
  const d = data ?? ({} as ValidateLicenseRequestInput)
  if (typeof d.requestId !== 'string' || d.requestId.length === 0) {
    throw new HttpsError('invalid-argument', 'requestId is required')
  }
  if (d.decision !== 'approve' && d.decision !== 'reject') {
    throw new HttpsError('invalid-argument', "decision must be 'approve' or 'reject'")
  }
  let comment: string | null = null
  if (d.comment !== undefined && d.comment !== null) {
    if (typeof d.comment !== 'string') {
      throw new HttpsError('invalid-argument', 'comment must be a string')
    }
    const trimmed = d.comment.trim()
    if (trimmed.length > COMMENT_MAX) {
      throw new HttpsError(
        'invalid-argument',
        `comment must be ≤ ${COMMENT_MAX} characters.`,
      )
    }
    comment = trimmed.length === 0 ? null : trimmed
  }
  return { requestId: d.requestId, decision: d.decision, comment }
}

interface ResolvedLicenseType {
  id: string
  data: LicenseTypeData
}

/**
 * Résout le `LicenseType` à snapshotter pour une licence joueur créée via
 * le workflow demande de licence parent. Stratégie :
 *  1. Le premier `/licenseTypes` actif avec `role === 'player'`, ordonné
 *     par `displayOrder asc`. Suffisant pour la PR3 MVP — l'UI trésorier
 *     pourra demander un choix explicite plus tard.
 *  2. Aucun → throw `failed-precondition`. Le trésorier doit seeder une
 *     ligne `player` dans Settings → Licences avant d'approuver.
 *
 * Note : la lecture passe **hors transaction** parce que `/licenseTypes` est
 * un référentiel rarement touché. Une transaction n'apporterait pas de
 * cohérence supplémentaire ici.
 */
async function resolvePlayerLicenseType(): Promise<ResolvedLicenseType> {
  const snap = await db().collection('licenseTypes').get()
  const players = snap.docs
    .map((d) => ({ id: d.id, data: d.data() as LicenseTypeData }))
    .filter((t) => t.data.active && t.data.role === 'player')
    .sort((a, b) => a.data.displayOrder - b.data.displayOrder)
  const first = players[0]
  if (!first) {
    throw new HttpsError(
      'failed-precondition',
      "Aucun /licenseTypes joueur actif — seedez la grille tarifaire d'abord.",
    )
  }
  return first
}

export const validateLicenseRequest = onCall(
  async (
    request: CallableRequest<ValidateLicenseRequestInput>,
  ): Promise<ValidateLicenseRequestOutput> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', '[validateLicenseRequest] Must be signed in.')
    }
    const callerUid = request.auth.uid
    const { requestId, decision, comment } = parseInput(request.data)

    const user = await loadCallerUser(callerUid)
    assertCanReviewAsTreasurer(request, user)

    const requestRef = db().doc(`licenseRequests/${requestId}`)
    let createdLicenseId: string | null = null

    // Pour un approve, on doit pré-résoudre le LicenseType joueur HORS
    // transaction (lecture de la collection complète + filtrage en JS).
    // Si la pré-condition n'est pas remplie, on throw avant d'ouvrir la tx.
    let playerType: ResolvedLicenseType | null = null
    if (decision === 'approve') {
      playerType = await resolvePlayerLicenseType()
    }

    try {
      await db().runTransaction(async (tx) => {
        const snap = await tx.get(requestRef)
        if (!snap.exists) {
          throw new HttpsError(
            'not-found',
            `[validateLicenseRequest] licenseRequest ${requestId} not found`,
          )
        }
        const lr = snap.data() as LicenseRequestData

        // Approve : pré-condition stricte. Reject : assoupli pour permettre
        // au trésorier de couper court dès `parent_docs_submitted` (cf.
        // header). Les statuts terminaux et `pending_parent_docs` restent
        // refusés dans tous les cas.
        if (decision === 'approve') {
          if (lr.status !== 'coach_validated') {
            throw new HttpsError(
              'failed-precondition',
              `[validateLicenseRequest] cannot approve in status '${lr.status}' — must be 'coach_validated'`,
            )
          }
        } else {
          if (lr.status !== 'parent_docs_submitted' && lr.status !== 'coach_validated') {
            throw new HttpsError(
              'failed-precondition',
              `[validateLicenseRequest] cannot reject in status '${lr.status}' — must be 'parent_docs_submitted' or 'coach_validated'`,
            )
          }
        }

        const now = Timestamp.now()

        if (decision === 'approve') {
          // Vérifie l'invariant "tous les docs validés par le trésorier".
          if (!computeAllTreasurerAccepted(lr)) {
            throw new HttpsError(
              'failed-precondition',
              'Tous les documents doivent être validés par le trésorier avant approbation.',
            )
          }

          // Pré-charge le member pour valider l'existence (l'écriture
          // /licenses référence memberId).
          const memberRef = db().doc(`members/${lr.memberId}`)
          const memberSnap = await tx.get(memberRef)
          if (!memberSnap.exists) {
            throw new HttpsError(
              'not-found',
              `[validateLicenseRequest] member ${lr.memberId} not found`,
            )
          }
          // Lecture pour valider l'existence ; le snapshot n'est pas utilisé.
          memberSnap.data() as MemberData

          const licenseRef = db().collection('licenses').doc()
          const type = playerType!
          const licenseData: LicenseData = {
            memberId: lr.memberId,
            seasonId: lr.seasonId,
            licenseTypeId: type.id,
            role: type.data.role,
            level: type.data.level,
            licenseName: type.data.name,
            feeSnapshot: type.data.fee,
            status: 'pending',
            createdAt: now,
            createdByUid: callerUid,
            confirmedAt: null,
            confirmedByUid: null,
            accountingEntryId: null,
            requestId,
            requestedByUid: lr.requestedBy,
          }
          tx.set(licenseRef, licenseData)
          createdLicenseId = licenseRef.id

          tx.update(requestRef, {
            status: 'approved',
            reviewedBy: callerUid,
            reviewedAt: now,
            adminComment: comment,
          })
        } else {
          // reject
          tx.update(requestRef, {
            status: 'rejected',
            reviewedBy: callerUid,
            reviewedAt: now,
            adminComment: comment,
          })
        }
      })
    } catch (err) {
      if (err instanceof HttpsError) throw err
      const msg = err instanceof Error ? err.message : 'unknown'
      logger.error(`[validateLicenseRequest] transaction failed [${msg}]`, {
        err,
        requestId,
        decision,
      })
      throw new HttpsError('internal', '[validateLicenseRequest] transaction failed')
    }

    const newStatus = decision === 'approve' ? 'approved' : 'rejected'
    logger.info('[validateLicenseRequest] ok', {
      requestId,
      decision,
      callerUid,
      newStatus,
      licenseId: createdLicenseId,
    })

    return { ok: true, requestId, newStatus, licenseId: createdLicenseId }
  },
)
