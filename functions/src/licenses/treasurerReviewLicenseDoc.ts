/**
 * `treasurerReviewLicenseDoc` — review per-doc d'une `/licenseRequests/{id}`
 * par un trésorier/admin/secrétaire (PR3 du workflow).
 *
 * Symétrique à `coachReviewLicenseDoc` mais peut court-circuiter le coach :
 *  - **Accept** : pré-condition `status ∈ {parent_docs_submitted,
 *    coach_validated, pending_parent_docs}` — le trésorier peut valider un
 *    doc sans attendre la review coach (cas typique : coach absent, doc
 *    évident, urgence saisonnière). Pas de transition de status — le coach
 *    reste libre de faire sa propre review en parallèle.
 *  - **Refuse** : pré-condition `status ∈ {coach_validated,
 *    pending_parent_docs}` — le trésorier peut enchaîner plusieurs refus
 *    sur des docs différents dans la même session (le premier refus
 *    bascule en `pending_parent_docs`, les suivants doivent rester
 *    possibles).
 *  - pose la review sur `uploadedDocs.{kind}.treasurerReview` ;
 *  - refus → reset cycle complet (status → `pending_parent_docs`,
 *    `coachValidatedAt/ByUid` à `null`) ;
 *  - accept → status inchangé. Le trésorier doit ensuite appeler
 *    `validateLicenseRequest` pour la décision finale et la création de
 *    `/licenses` (pas de transition automatique ici — et la garde
 *    `validateLicenseRequest.approve` reste stricte sur `coach_validated`,
 *    le bypass coach concerne uniquement la review per-doc).
 *
 * Auth : claim `rootAdmin` OU rôle `admin | treasurer | secretary`
 * (cf. `assertCanReviewAsTreasurer`).
 *
 * Idempotence : re-appeler avec la même décision écrase. Pas d'effet sur
 * `coachValidatedAt/ByUid` côté accept (ils restent posés par le coach).
 *
 * Region : europe-west6.
 *
 * NOTE deploy : nouvelle Function v2 → après le premier deploy, ajouter le
 * binding IAM `allUsers/run.invoker` (cf. `functions/CLAUDE.md`).
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import type {
  DocReviewDecision,
  LicenseDocKind,
  LicenseRequestData,
  LicenseRequestStatus,
} from '@club-app/shared-types'
import { Timestamp, db } from '../dues/_helpers'
import {
  assertCanReviewAsTreasurer,
  assertReviewableKind,
  computeAllTreasurerAccepted,
  loadCallerUser,
  parseLicenseDocKind,
  validateRefusalReason,
} from './_reviewHelpers'

interface TreasurerReviewLicenseDocInput {
  requestId: unknown
  kind: unknown
  decision: unknown
  refusalReason?: unknown
}

export interface TreasurerReviewLicenseDocOutput {
  ok: true
  requestId: string
  newStatus: LicenseRequestStatus
  /** `true` si tous les `requiredDocs` ont désormais `treasurerReview.accepted`. */
  allTreasurerAccepted: boolean
}

interface ParsedInput {
  requestId: string
  kind: LicenseDocKind
  decision: 'accept' | 'refuse'
  refusalReason: string | null
}

function parseInput(data: TreasurerReviewLicenseDocInput): ParsedInput {
  const d = data ?? ({} as TreasurerReviewLicenseDocInput)
  if (typeof d.requestId !== 'string' || d.requestId.length === 0) {
    throw new HttpsError('invalid-argument', 'requestId is required')
  }
  const kind = parseLicenseDocKind(d.kind)
  if (d.decision !== 'accept' && d.decision !== 'refuse') {
    throw new HttpsError('invalid-argument', "decision must be 'accept' or 'refuse'")
  }
  const refusalReason = d.decision === 'refuse' ? validateRefusalReason(d.refusalReason) : null
  return { requestId: d.requestId, kind, decision: d.decision, refusalReason }
}

export const treasurerReviewLicenseDoc = onCall(
  async (
    request: CallableRequest<TreasurerReviewLicenseDocInput>,
  ): Promise<TreasurerReviewLicenseDocOutput> => {
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        '[treasurerReviewLicenseDoc] Must be signed in.',
      )
    }
    const callerUid = request.auth.uid
    const { requestId, kind, decision, refusalReason } = parseInput(request.data)

    const user = await loadCallerUser(callerUid)
    assertCanReviewAsTreasurer(request, user)

    const requestRef = db().doc(`licenseRequests/${requestId}`)
    let newStatus: LicenseRequestStatus = 'coach_validated'
    let allTreasurerAccepted = false

    try {
      await db().runTransaction(async (tx) => {
        const snap = await tx.get(requestRef)
        if (!snap.exists) {
          throw new HttpsError(
            'not-found',
            `[treasurerReviewLicenseDoc] licenseRequest ${requestId} not found`,
          )
        }
        const lr = snap.data() as LicenseRequestData

        // Accept : `parent_docs_submitted | coach_validated |
        // pending_parent_docs`. Le trésorier peut court-circuiter la review
        // coach (cas vécu : coach absent, doc évident, urgence saisonnière).
        // Refuse : `coach_validated | pending_parent_docs` — autorisé aussi
        // en `pending_parent_docs` pour permettre d'enchaîner plusieurs refus
        // sur des docs différents dans la même session (le premier refus a
        // déjà fait basculer la demande).
        const allowedStatuses: LicenseRequestStatus[] =
          decision === 'refuse'
            ? ['coach_validated', 'pending_parent_docs']
            : ['parent_docs_submitted', 'coach_validated', 'pending_parent_docs']
        if (!allowedStatuses.includes(lr.status)) {
          const expected = allowedStatuses.map((s) => `'${s}'`).join(' | ')
          throw new HttpsError(
            'failed-precondition',
            `[treasurerReviewLicenseDoc] cannot ${decision} in status '${lr.status}' — must be ${expected}`,
          )
        }
        const docRef = assertReviewableKind(lr, kind)

        const now = Timestamp.now()
        const review: DocReviewDecision = {
          decision: decision === 'accept' ? 'accepted' : 'refused',
          at: now,
          byUid: callerUid,
          refusalReason,
        }

        const updatedDocs: LicenseRequestData['uploadedDocs'] = {
          ...lr.uploadedDocs,
          [kind]: { ...docRef, treasurerReview: review },
        }
        const projection: LicenseRequestData = {
          ...lr,
          uploadedDocs: updatedDocs,
        }

        const patch: { [k: string]: unknown } = {
          [`uploadedDocs.${kind}.treasurerReview`]: review,
        }

        if (decision === 'refuse') {
          // Refus trésorier → reset complet : le parent re-uploade, le coach
          // re-review depuis zéro. C'est strict mais sûr (un doc rejeté par
          // le trésorier peut signaler un défaut que le coach n'avait pas vu).
          patch.status = 'pending_parent_docs'
          patch.coachValidatedAt = null
          patch.coachValidatedByUid = null
          newStatus = 'pending_parent_docs'
          allTreasurerAccepted = false
        } else {
          allTreasurerAccepted = computeAllTreasurerAccepted(projection)
          // Accept (partiel ou total) → status inchangé (parent_docs_submitted,
          // coach_validated ou pending_parent_docs selon le contexte). Le coach
          // reste libre de poursuivre sa propre review et l'approbation finale
          // se fait via `validateLicenseRequest` (qui exige coach_validated).
          newStatus = lr.status
        }

        tx.update(requestRef, patch as FirebaseFirestore.UpdateData<LicenseRequestData>)
      })
    } catch (err) {
      if (err instanceof HttpsError) throw err
      const msg = err instanceof Error ? err.message : 'unknown'
      logger.error(`[treasurerReviewLicenseDoc] transaction failed [${msg}]`, {
        err,
        requestId,
        kind,
        decision,
      })
      throw new HttpsError('internal', '[treasurerReviewLicenseDoc] transaction failed')
    }

    logger.info('[treasurerReviewLicenseDoc] ok', {
      requestId,
      kind,
      decision,
      callerUid,
      newStatus,
      allTreasurerAccepted,
    })

    return { ok: true, requestId, newStatus, allTreasurerAccepted }
  },
)
