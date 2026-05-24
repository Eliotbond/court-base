/**
 * `removeMemberLicensePhoto` — callable permettant à un admin (ou rootAdmin)
 * de retirer la **photo licence** d'un membre.
 *
 * Suppression = action plus rare et plus risquée que l'upload — réservée à
 * l'admin et au rootAdmin. **Pas le coach** (le coach remplace via
 * `setMemberLicensePhoto` s'il veut changer la photo).
 *
 * Effets :
 *  - delete best-effort de l'objet Storage référencé par `member.photoStoragePath` ;
 *  - reset des 3 champs Firestore (`photoStoragePath`, `photoUpdatedAt`,
 *    `photoUpdatedByUid`) à `null`.
 *
 * Idempotence : si le membre n'a pas de photo, la callable est un no-op
 * (renvoie succès sans écriture). Re-run safe.
 *
 * Auth : signed-in + (claim `rootAdmin` OU rôle `admin` côté `/users/{uid}`).
 *
 * Region : europe-west6 (héritée du `setGlobalOptions` dans `src/index.ts`).
 *
 * NOTE deploy : nouvelle Function v2 → après le premier deploy, ajouter le
 * binding IAM `allUsers/run.invoker` (cf. `functions/CLAUDE.md` §"Après deploy").
 *
 * Cf. `docs/members/license-photo.md` pour le brief produit complet (PR-B).
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import { getStorage } from 'firebase-admin/storage'
import type { MemberData, UserData } from '@club-app/shared-types'
import { db } from '../registrations/_helpers'
import { loadCallerUser } from './_coachAuth'

// =============================================================================
// I/O
// =============================================================================

interface RemoveMemberLicensePhotoInput {
  memberId: unknown
}

export interface RemoveMemberLicensePhotoOutput {
  ok: true
  memberId: string
}

function parseInput(data: RemoveMemberLicensePhotoInput): { memberId: string } {
  const d = data ?? ({} as RemoveMemberLicensePhotoInput)
  if (typeof d.memberId !== 'string' || d.memberId.length === 0) {
    throw new HttpsError('invalid-argument', 'memberId is required')
  }
  return { memberId: d.memberId }
}

// =============================================================================
// Auth — admin / rootAdmin only (strict, pas de coach)
// =============================================================================

function assertCanRemovePhoto(
  auth: { uid: string; token?: Record<string, unknown> | undefined },
  user: UserData,
): void {
  if (auth.token?.rootAdmin === true) return
  const roles = user.roles ?? []
  if (roles.includes('admin')) return
  throw new HttpsError(
    'permission-denied',
    'Caller must be rootAdmin or admin to remove a member license photo.',
  )
}

// =============================================================================
// Callable
// =============================================================================

export const removeMemberLicensePhoto = onCall(
  async (
    request: CallableRequest<RemoveMemberLicensePhotoInput>,
  ): Promise<RemoveMemberLicensePhotoOutput> => {
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        '[removeMemberLicensePhoto] Must be signed in.',
      )
    }
    const callerUid = request.auth.uid
    const { memberId } = parseInput(request.data)

    // Auth scope — admin/rootAdmin strict.
    const user = await loadCallerUser(callerUid)
    assertCanRemovePhoto({ uid: callerUid, token: request.auth.token }, user)

    const memberRef = db().doc(`members/${memberId}`)
    const memberSnap = await memberRef.get()
    if (!memberSnap.exists) {
      throw new HttpsError(
        'not-found',
        `[removeMemberLicensePhoto] member ${memberId} not found`,
      )
    }
    const member = memberSnap.data() as MemberData
    const currentPath = member.photoStoragePath ?? null

    // Idempotence : pas de photo → no-op.
    if (currentPath === null) {
      logger.info('[removeMemberLicensePhoto] no photo to remove — no-op', {
        memberId,
        callerUid,
      })
      return { ok: true, memberId }
    }

    // Best-effort : delete du fichier Storage. Si ça échoue, on continue et
    // on clear quand même les champs (le pointeur Firestore est la source de
    // vérité ; un orphelin Storage est tolérable, l'inverse non).
    try {
      const bucket = getStorage().bucket()
      const file = bucket.file(currentPath)
      const [exists] = await file.exists()
      if (exists) {
        await file.delete()
        logger.info('[removeMemberLicensePhoto] storage object deleted', {
          path: currentPath,
          memberId,
          callerUid,
        })
      } else {
        logger.info('[removeMemberLicensePhoto] storage object already absent', {
          path: currentPath,
          memberId,
          callerUid,
        })
      }
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: unknown }).code)
          : 'unknown'
      logger.warn(`[removeMemberLicensePhoto] storage delete failed [${code}]`, {
        path: currentPath,
        memberId,
        callerUid,
        err: err instanceof Error ? err.message : String(err),
      })
    }

    // Clear des 3 champs Firestore.
    try {
      await memberRef.update({
        photoStoragePath: null,
        photoUpdatedAt: null,
        photoUpdatedByUid: null,
      })
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: unknown }).code)
          : 'unknown'
      logger.error(`[removeMemberLicensePhoto] firestore update failed [${code}]`, {
        memberId,
        callerUid,
        err: err instanceof Error ? err.message : String(err),
      })
      throw new HttpsError(
        'internal',
        '[removeMemberLicensePhoto] failed to clear photo reference',
      )
    }

    logger.info('[removeMemberLicensePhoto] ok', {
      memberId,
      callerUid,
      previousPath: currentPath,
    })

    return { ok: true, memberId }
  },
)
