/**
 * `treasurerFinalizeLicense` — étape terminale de la phase trésorier.
 *
 * Transition : `sent_paid` → `approved` (terminal). Chaîne en interne
 * `confirmLicenseCore` (refactor de `confirmLicense`) pour faire passer la
 * `/licenses/{linkedLicenseId}` de `pending` à `active` + écrire la charge
 * comptable + dénormaliser `member.officialLicense` / `coachLicense` selon
 * le rôle de la licence. Pose `member.licensed = true` et le numéro de
 * licence fédéral renseigné par le trésorier.
 *
 * Auth : claim `rootAdmin` OU rôle `admin | treasurer | secretary` côté
 * `/users/{uid}`. Cf. `assertCanReviewAsTreasurer`.
 *
 * Validations input :
 *  - `requestId` non vide.
 *  - `licenseNumber` trim non vide, max 50 chars.
 *
 * Pré-conditions :
 *  - `lr.status === 'sent_paid'`.
 *  - `lr.linkedLicenseId !== null` (la `/licenses/{id}` a été créée par
 *    `treasurerMarkSentAndPaid`).
 *
 * Idempotence : si `lr.status === 'approved'` ET la licence est déjà
 * `active`, no-op (renvoie le `licenseId` connu sans rien écrire).
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
  TreasurerFinalizeLicenseInput,
  TreasurerFinalizeLicenseResult,
} from '@club-app/shared-types'
import { Timestamp, db } from '../dues/_helpers'
import {
  assertCanReviewAsTreasurer,
  loadCallerUser,
} from './_reviewHelpers'
import { confirmLicenseCore } from './confirmLicense'

const LICENSE_NUMBER_MAX = 50

interface ParsedInput {
  requestId: string
  licenseNumber: string
}

function parseInput(data: TreasurerFinalizeLicenseInput | undefined): ParsedInput {
  const d = (data ?? {}) as Partial<TreasurerFinalizeLicenseInput>
  if (typeof d.requestId !== 'string' || d.requestId.length === 0) {
    throw new HttpsError('invalid-argument', 'requestId is required')
  }
  if (typeof d.licenseNumber !== 'string') {
    throw new HttpsError('invalid-argument', 'licenseNumber must be a string')
  }
  const trimmed = d.licenseNumber.trim()
  if (trimmed.length === 0) {
    throw new HttpsError('invalid-argument', 'licenseNumber must not be empty')
  }
  if (trimmed.length > LICENSE_NUMBER_MAX) {
    throw new HttpsError(
      'invalid-argument',
      `licenseNumber must be ≤ ${LICENSE_NUMBER_MAX} characters.`,
    )
  }
  return { requestId: d.requestId, licenseNumber: trimmed }
}

/**
 * Mappe le rôle de la licence sur le champ dénormalisé posé par
 * `confirmLicenseCore`. `null` pour `player` / `referee` (pas de denorm
 * membre).
 *
 * Aligné avec la logique de `confirmLicenseCore` :
 *  - `'official'` → `officialLicense`
 *  - `'coach'` → `coachLicense`
 *  - `'player'` → pas de denorm (mais le workflow parent_docs est pour
 *    joueur — on documente le champ retourné comme `'playerLicense'` à
 *    titre de placeholder pour le client, même si rien n'est posé sur le
 *    membre côté Firestore par `confirmLicenseCore`).
 */
function deriveMemberPatchField(
  role: LicenseData['role'],
): 'officialLicense' | 'coachLicense' | 'playerLicense' | null {
  if (role === 'official') return 'officialLicense'
  if (role === 'coach') return 'coachLicense'
  if (role === 'player') return 'playerLicense'
  return null
}

export const treasurerFinalizeLicense = onCall(
  async (
    request: CallableRequest<TreasurerFinalizeLicenseInput>,
  ): Promise<TreasurerFinalizeLicenseResult> => {
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        '[treasurerFinalizeLicense] Must be signed in.',
      )
    }
    const callerUid = request.auth.uid
    const { requestId, licenseNumber } = parseInput(request.data)

    const user = await loadCallerUser(callerUid)
    assertCanReviewAsTreasurer(request, user)

    const requestRef = db().doc(`licenseRequests/${requestId}`)

    let resolvedLicenseId = ''
    let memberPatch: TreasurerFinalizeLicenseResult['memberPatch'] = null

    try {
      await db().runTransaction(async (tx) => {
        // --- 1. Lecture license request (toutes les lectures AVANT les writes
        //        — règle Firestore [READS] before [WRITES] de la tx). ---
        const snap = await tx.get(requestRef)
        if (!snap.exists) {
          throw new HttpsError(
            'not-found',
            `[treasurerFinalizeLicense] licenseRequest ${requestId} not found`,
          )
        }
        const lr = snap.data() as LicenseRequestData

        // --- 2. Pré-conditions / idempotence ---
        if (lr.status === 'approved') {
          // Vérifie que la licence liée est bien active — si oui, no-op.
          if (!lr.linkedLicenseId) {
            throw new HttpsError(
              'failed-precondition',
              '[treasurerFinalizeLicense] request is approved but linkedLicenseId is null',
            )
          }
          const licSnap = await tx.get(db().doc(`licenses/${lr.linkedLicenseId}`))
          if (licSnap.exists) {
            const lic = licSnap.data() as LicenseData
            if (lic.status === 'active') {
              resolvedLicenseId = lr.linkedLicenseId
              const field = deriveMemberPatchField(lic.role)
              memberPatch = field
                ? { memberId: lr.memberId, field }
                : null
              return
            }
          }
          // approved sans licence active → état corrompu, on refuse
          // explicitement (un caller ne devrait pas pouvoir re-finaliser).
          throw new HttpsError(
            'failed-precondition',
            '[treasurerFinalizeLicense] request is approved but linked license is not active',
          )
        }

        if (lr.status !== 'sent_paid') {
          throw new HttpsError(
            'failed-precondition',
            `[treasurerFinalizeLicense] cannot finalize in status '${lr.status}' — must be 'sent_paid'`,
          )
        }
        if (!lr.linkedLicenseId) {
          throw new HttpsError(
            'failed-precondition',
            '[treasurerFinalizeLicense] linkedLicenseId is null — call treasurerMarkSentAndPaid first',
          )
        }
        resolvedLicenseId = lr.linkedLicenseId

        // --- 3. Confirme la licence (pending → active + compta + denorm
        //        official/coach). Toutes les reads internes (license + member +
        //        accounts collection) sont faites par confirmLicenseCore AVANT
        //        ses writes — OK car on n'a fait aucun write encore. ---
        const confirmResult = await confirmLicenseCore(tx, lr.linkedLicenseId, callerUid)
        // confirmLicenseCore ne retourne pas le rôle, on le récupère depuis
        // un re-tx.get léger (la licence vient juste d'être mise à jour mais
        // tx.get retourne le snapshot d'origine — il faut une autre lecture
        // serait illégale après tx.update). On lit AVANT confirmLicenseCore
        // côté retravail : refactor ci-dessous.
        // ⚠ Note : `confirmResult.alreadyActive` peut être `true` pour les
        // retries — ne sera pas le cas en pratique car la pré-condition
        // `lr.status === 'sent_paid'` (`approved` capturé plus haut)
        // implique que la licence n'a pas été confirmée.
        void confirmResult

        // --- 4. Patch /licenseRequests : status → 'approved' + traçabilité ---
        const now = Timestamp.now()
        tx.update(requestRef, {
          status: 'approved',
          licenseNumber,
          licenseFinalizedAt: now,
          licenseFinalizedByUid: callerUid,
        })

        // --- 5. Patch /members : licensed=true + licenseNumber ---
        // Note : confirmLicenseCore a déjà posé officialLicense / coachLicense
        // selon le rôle. On ajoute ici `licensed` (boolean général) et
        // `licenseNumber` (numéro fédéral saisi). Le rôle pour memberPatch est
        // récupéré via un read séparé hors-tx pour éviter de re-lire la licence
        // après confirmLicenseCore (qui a écrit dessus).
        const memberRef = db().doc(`members/${lr.memberId}`)
        tx.update(memberRef, {
          licensed: true,
          licenseNumber,
        })
      })

      // --- 6. Hors-tx : récupère le rôle de la licence pour le memberPatch
      //        de retour (lecture simple, déjà active à ce stade). ---
      if (memberPatch === null && resolvedLicenseId) {
        const licSnap = await db().doc(`licenses/${resolvedLicenseId}`).get()
        if (licSnap.exists) {
          const lic = licSnap.data() as LicenseData
          const field = deriveMemberPatchField(lic.role)
          // Pour player/coach/official, mais on lit le membre id depuis la
          // licence (cohérent avec memberId stocké dans la licence).
          memberPatch = field
            ? { memberId: lic.memberId, field }
            : null
        }
      }
    } catch (err) {
      if (err instanceof HttpsError) throw err
      const msg = err instanceof Error ? err.message : 'unknown'
      logger.error(`[treasurerFinalizeLicense] transaction failed [${msg}]`, {
        err,
        requestId,
      })
      throw new HttpsError(
        'internal',
        '[treasurerFinalizeLicense] transaction failed',
      )
    }

    logger.info('[treasurerFinalizeLicense] ok', {
      requestId,
      callerUid,
      newStatus: 'approved',
      licenseId: resolvedLicenseId,
      memberPatch,
    })

    return {
      newStatus: 'approved',
      licenseId: resolvedLicenseId,
      memberPatch,
    }
  },
)
