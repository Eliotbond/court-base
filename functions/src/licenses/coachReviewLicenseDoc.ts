/**
 * `coachReviewLicenseDoc` — review per-doc d'une `/licenseRequests/{id}` par
 * un coach (PR2 du workflow "demande de licence parent").
 *
 * Le coach choisit, pour chaque document uploadé par le parent, **accept**
 * ou **refuse** (commentaire requis si refus). Le résultat est porté sur le
 * sous-champ `uploadedDocs.{kind}.coachReview` du document.
 *
 * Transitions de statut (auto, dans la transaction) :
 *  - **Refuse** 1+ docs    → `status: 'pending_parent_docs'` + reset
 *                            `coachValidatedAt/ByUid` à `null`. Le parent
 *                            doit re-uploader ; au re-upload, la review est
 *                            effacée (cf. store register).
 *  - **Accept** tous docs  → `status: 'coach_validated'` + pose
 *                            `coachValidatedAt: now`, `coachValidatedByUid`.
 *                            **Pré-condition** : `member.photoStoragePath`
 *                            doit être posée (sinon `failed-precondition`).
 *                            Cf. `docs/members/license-photo.md` (PR-B).
 *  - **Accept** partiel    → `status` reste `'parent_docs_submitted'`.
 *
 * Pré-conditions :
 *  - **Accept** : `status === 'parent_docs_submitted'` strict (un doc déjà
 *    refusé a fait basculer la demande en `pending_parent_docs` — le coach
 *    ne peut plus valider tant que le parent n'a pas re-uploadé).
 *  - **Refuse** : `status ∈ {parent_docs_submitted, pending_parent_docs}`.
 *    Permet d'enchaîner plusieurs refus dans la même session de review
 *    (premier refus → status bascule en `pending_parent_docs`, mais le
 *    coach peut continuer à refuser les autres docs avec leurs motifs
 *    propres avant de quitter la page).
 *  - `kind ∈ request.requiredDocs` ET `uploadedDocs[kind]` existant.
 *
 * Auth : coach scope (`teamId ∈ user.teamIds`) ; bypass admin/rootAdmin
 * (cf. `assertCoachOfLicenseRequest`).
 *
 * Idempotence : re-appeler avec la même décision écrase une review
 * équivalente — pas de conséquence métier (le `at` change, le `byUid` reste).
 *
 * Region : europe-west6 (héritée de `setGlobalOptions` dans `src/index.ts`).
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
  MemberData,
} from '@club-app/shared-types'
import { Timestamp, db } from '../dues/_helpers'
import {
  assertCoachOfLicenseRequest,
  assertReviewableKind,
  computeAllCoachAccepted,
  loadCallerUser,
  parseLicenseDocKind,
  validateRefusalReason,
} from './_reviewHelpers'

interface CoachReviewLicenseDocInput {
  requestId: unknown
  kind: unknown
  decision: unknown
  refusalReason?: unknown
}

export interface CoachReviewLicenseDocOutput {
  ok: true
  requestId: string
  newStatus: LicenseRequestStatus
  /** `true` si tous les `requiredDocs` ont désormais `coachReview.accepted`. */
  allCoachAccepted: boolean
}

interface ParsedInput {
  requestId: string
  kind: LicenseDocKind
  decision: 'accept' | 'refuse'
  refusalReason: string | null
}

function parseInput(data: CoachReviewLicenseDocInput): ParsedInput {
  const d = data ?? ({} as CoachReviewLicenseDocInput)
  if (typeof d.requestId !== 'string' || d.requestId.length === 0) {
    throw new HttpsError('invalid-argument', 'requestId is required')
  }
  const kind = parseLicenseDocKind(d.kind)
  if (d.decision !== 'accept' && d.decision !== 'refuse') {
    throw new HttpsError('invalid-argument', "decision must be 'accept' or 'refuse'")
  }
  // refusalReason : requis si refus, ignoré sinon.
  const refusalReason = d.decision === 'refuse' ? validateRefusalReason(d.refusalReason) : null
  return { requestId: d.requestId, kind, decision: d.decision, refusalReason }
}

export const coachReviewLicenseDoc = onCall(
  async (
    request: CallableRequest<CoachReviewLicenseDocInput>,
  ): Promise<CoachReviewLicenseDocOutput> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', '[coachReviewLicenseDoc] Must be signed in.')
    }
    const callerUid = request.auth.uid
    const { requestId, kind, decision, refusalReason } = parseInput(request.data)

    // Pré-charge le user doc hors transaction (rôles stables pendant le call).
    const user = await loadCallerUser(callerUid)

    const requestRef = db().doc(`licenseRequests/${requestId}`)
    let newStatus: LicenseRequestStatus = 'parent_docs_submitted'
    let allCoachAccepted = false

    try {
      await db().runTransaction(async (tx) => {
        const snap = await tx.get(requestRef)
        if (!snap.exists) {
          throw new HttpsError(
            'not-found',
            `[coachReviewLicenseDoc] licenseRequest ${requestId} not found`,
          )
        }
        const lr = snap.data() as LicenseRequestData

        // --- Auth scopée à la team de la demande ---
        assertCoachOfLicenseRequest(
          { uid: callerUid, token: request.auth?.token },
          lr,
          user,
        )

        // --- Pré-conditions ---
        // Accept : strictement `parent_docs_submitted` (un refus antérieur
        // a fait basculer la demande en `pending_parent_docs` — invalide
        // les validations partielles tant que le parent n'a pas re-uploadé).
        // Refuse : autorisé aussi en `pending_parent_docs` pour permettre
        // d'enchaîner plusieurs refus sur des docs différents dans la même
        // session de review (cas typique : 2 docs problématiques, chacun
        // avec son propre motif).
        const allowedStatuses: LicenseRequestStatus[] =
          decision === 'refuse'
            ? ['parent_docs_submitted', 'pending_parent_docs']
            : ['parent_docs_submitted']
        if (!allowedStatuses.includes(lr.status)) {
          const expected = allowedStatuses.map((s) => `'${s}'`).join(' | ')
          throw new HttpsError(
            'failed-precondition',
            `[coachReviewLicenseDoc] cannot ${decision} in status '${lr.status}' — must be ${expected}`,
          )
        }
        const docRef = assertReviewableKind(lr, kind)

        // --- Lecture conditionnelle du member (pour le gate "photo requise"
        // avant transition `coach_validated`) — toujours fait avant tout write
        // pour respecter la règle Firestore [READS] avant [WRITES] de la tx,
        // même si le membre n'est utilisé qu'en cas d'accept final.
        const memberRef = db().doc(`members/${lr.memberId}`)
        const memberSnap = await tx.get(memberRef)
        // Note : on tolère le member absent (lr.memberId orphelin) — le gate
        // photo ne s'applique que si on s'apprête à transitionner ; pour les
        // accepts partiels / refus, le doc member n'est pas exigé. Si on doit
        // gater et que le member est introuvable, on remontera en
        // `failed-precondition` plus bas.

        // --- Pose la review ---
        const now = Timestamp.now()
        const review: DocReviewDecision = {
          decision: decision === 'accept' ? 'accepted' : 'refused',
          at: now,
          byUid: callerUid,
          refusalReason,
        }

        // Build la projection du doc post-update pour compute allAccepted en
        // intégrant ce nouveau review (la transaction ne re-lit pas le doc).
        const updatedDocs: LicenseRequestData['uploadedDocs'] = {
          ...lr.uploadedDocs,
          [kind]: { ...docRef, coachReview: review },
        }
        const projection: LicenseRequestData = {
          ...lr,
          uploadedDocs: updatedDocs,
        }

        // --- Décide la transition de statut ---
        // Patch permissif : la valeur peut être un nested object
        // (`DocReviewDecision`), une string (status), un `Timestamp`, ou
        // `null` — la signature stricte `UpdateData<T>` du SDK n'accepte
        // pas la dot-notation typée pour les sub-fields ; cast au tx.update.
        const patch: { [k: string]: unknown } = {
          [`uploadedDocs.${kind}.coachReview`]: review,
        }

        if (decision === 'refuse') {
          // Refus → retour parent. Reset coachValidatedAt/ByUid au cas où la
          // demande aurait déjà été validée puis ré-ouverte (cas rare mais
          // possible avec un treasurer refuse → parent re-uploade → coach
          // re-review et refuse).
          patch.status = 'pending_parent_docs'
          patch.coachValidatedAt = null
          patch.coachValidatedByUid = null
          newStatus = 'pending_parent_docs'
          allCoachAccepted = false
        } else {
          allCoachAccepted = computeAllCoachAccepted(projection)
          if (allCoachAccepted) {
            // --- Gate "photo membre requise" (cf. docs/members/license-photo.md) ---
            // La photo licence est requise pour la transition finale côté
            // coach (`parent_docs_submitted → coach_validated`). Pas pour les
            // accepts partiels, pas pour les refus.
            if (!memberSnap.exists) {
              throw new HttpsError(
                'failed-precondition',
                `[coachReviewLicenseDoc] member ${lr.memberId} not found — cannot validate license request`,
              )
            }
            const member = memberSnap.data() as MemberData
            if ((member.photoStoragePath ?? null) === null) {
              throw new HttpsError(
                'failed-precondition',
                '[coachReviewLicenseDoc] Photo membre requise avant validation finale. Uploader la photo licence depuis la fiche du membre.',
              )
            }

            patch.status = 'coach_validated'
            patch.coachValidatedAt = now
            patch.coachValidatedByUid = callerUid
            newStatus = 'coach_validated'
          } else {
            // Accept partiel — pas de changement de status.
            newStatus = lr.status
          }
        }

        // tx.update n'a pas de surcharge `UpdateData<unknown>` propre — on
        // cast vers le record générique attendu par le SDK Admin (dot-notation
        // patches partiels incluant des nested objects pour `coachReview`).
        tx.update(requestRef, patch as FirebaseFirestore.UpdateData<LicenseRequestData>)
      })
    } catch (err) {
      if (err instanceof HttpsError) throw err
      const msg = err instanceof Error ? err.message : 'unknown'
      logger.error(`[coachReviewLicenseDoc] transaction failed [${msg}]`, {
        err,
        requestId,
        kind,
        decision,
      })
      throw new HttpsError('internal', '[coachReviewLicenseDoc] transaction failed')
    }

    logger.info('[coachReviewLicenseDoc] ok', {
      requestId,
      kind,
      decision,
      callerUid,
      newStatus,
      allCoachAccepted,
    })

    return { ok: true, requestId, newStatus, allCoachAccepted }
  },
)
