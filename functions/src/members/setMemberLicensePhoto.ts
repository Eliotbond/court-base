/**
 * `setMemberLicensePhoto` — callable permettant à un coach (ou un admin) de
 * poser la **photo licence** d'un membre de l'une de ses équipes.
 *
 * Le client uploade le fichier en direct dans Storage à
 * `members/{memberId}/license-photo.{ext}` (rules Storage permissives : signed-in
 * + size/MIME validés). La callable :
 *  - re-valide le scope coach côté serveur (les rules Storage ne le font pas) ;
 *  - vérifie que le fichier existe physiquement dans le bucket ;
 *  - re-valide le `contentType` et `sizeBytes` (filet anti-bypass DOM) ;
 *  - pose `member.photoStoragePath` / `photoUpdatedAt` / `photoUpdatedByUid` ;
 *  - best-effort delete de l'ancien fichier Storage si le path change.
 *
 * Auth : signed-in + `assertCoachOrAdminOfMember` (scope team via
 * `user.teamIds` ∩ `team.playerIds`).
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
import type { MemberData } from '@club-app/shared-types'
import { Timestamp, db } from '../registrations/_helpers'
import { assertCoachOrAdminOfMember, loadCallerUser } from './_coachAuth'

// =============================================================================
// I/O
// =============================================================================

interface SetMemberLicensePhotoInput {
  memberId: unknown
  storagePath: unknown
  contentType: unknown
  sizeBytes: unknown
}

export interface SetMemberLicensePhotoOutput {
  ok: true
  memberId: string
  photoStoragePath: string
}

interface ParsedInput {
  memberId: string
  storagePath: string
  contentType: string
  sizeBytes: number
}

const ALLOWED_CONTENT_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
]

/** 5 Mo — aligné sur la rule Storage. */
const MAX_SIZE_BYTES = 5 * 1024 * 1024

function parseInput(data: SetMemberLicensePhotoInput): ParsedInput {
  const d = data ?? ({} as SetMemberLicensePhotoInput)

  if (typeof d.memberId !== 'string' || d.memberId.length === 0) {
    throw new HttpsError('invalid-argument', 'memberId is required')
  }
  if (typeof d.storagePath !== 'string' || d.storagePath.length === 0) {
    throw new HttpsError('invalid-argument', 'storagePath is required')
  }
  if (typeof d.contentType !== 'string' || d.contentType.length === 0) {
    throw new HttpsError('invalid-argument', 'contentType is required')
  }
  if (!ALLOWED_CONTENT_TYPES.includes(d.contentType)) {
    throw new HttpsError(
      'invalid-argument',
      `contentType must be one of: ${ALLOWED_CONTENT_TYPES.join(', ')}`,
    )
  }
  if (
    typeof d.sizeBytes !== 'number' ||
    !Number.isFinite(d.sizeBytes) ||
    d.sizeBytes <= 0
  ) {
    throw new HttpsError('invalid-argument', 'sizeBytes must be a positive number')
  }
  if (d.sizeBytes > MAX_SIZE_BYTES) {
    throw new HttpsError(
      'invalid-argument',
      `sizeBytes must be <= ${MAX_SIZE_BYTES} (5 MB)`,
    )
  }

  // Garde-fou path : doit cibler le sous-arbre Storage du membre.
  const expectedPrefix = `members/${d.memberId}/`
  if (!d.storagePath.startsWith(expectedPrefix)) {
    throw new HttpsError(
      'invalid-argument',
      `storagePath must start with '${expectedPrefix}'`,
    )
  }

  return {
    memberId: d.memberId,
    storagePath: d.storagePath,
    contentType: d.contentType,
    sizeBytes: d.sizeBytes,
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Best-effort delete d'un fichier Storage. Loggue + ignore les erreurs — ne
 * doit jamais faire échouer la callable (le `photoStoragePath` ne pointe plus
 * dessus de toute façon).
 */
async function bestEffortDeleteStorageObject(
  path: string,
  context: { callerUid: string; memberId: string },
): Promise<void> {
  try {
    const bucket = getStorage().bucket()
    const file = bucket.file(path)
    const [exists] = await file.exists()
    if (!exists) {
      logger.info('[setMemberLicensePhoto] old object already absent — skip delete', {
        path,
        ...context,
      })
      return
    }
    await file.delete()
    logger.info('[setMemberLicensePhoto] old object deleted', { path, ...context })
  } catch (err) {
    // Erreurs Storage côté Admin SDK : `.code` est typiquement numérique (404,
    // 403, etc.) ; on logge sans bloquer.
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code: unknown }).code)
        : 'unknown'
    logger.warn(`[setMemberLicensePhoto] old object delete failed [${code}]`, {
      path,
      ...context,
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

// =============================================================================
// Callable
// =============================================================================

export const setMemberLicensePhoto = onCall(
  async (
    request: CallableRequest<SetMemberLicensePhotoInput>,
  ): Promise<SetMemberLicensePhotoOutput> => {
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        '[setMemberLicensePhoto] Must be signed in.',
      )
    }
    const callerUid = request.auth.uid
    const input = parseInput(request.data)

    // Auth : charge le user une fois, réutilise-le pour la garde scope.
    const user = await loadCallerUser(callerUid)
    await assertCoachOrAdminOfMember(
      { uid: callerUid, token: request.auth.token },
      input.memberId,
      user,
    )

    // Vérifie l'existence physique du fichier dans Storage (filet anti
    // "client a juste appelé la callable sans uploader").
    const bucket = getStorage().bucket()
    const newFile = bucket.file(input.storagePath)
    let exists = false
    try {
      ;[exists] = await newFile.exists()
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: unknown }).code)
          : 'unknown'
      logger.error(`[setMemberLicensePhoto] storage.exists check failed [${code}]`, {
        callerUid,
        memberId: input.memberId,
        storagePath: input.storagePath,
        err: err instanceof Error ? err.message : String(err),
      })
      throw new HttpsError(
        'internal',
        '[setMemberLicensePhoto] unable to verify uploaded file',
      )
    }
    if (!exists) {
      throw new HttpsError(
        'failed-precondition',
        `[setMemberLicensePhoto] no object at storagePath '${input.storagePath}'`,
      )
    }

    // Lecture du member (hors transaction — un seul write au final, pas besoin
    // de transaction Firestore ; on évite aussi un read inutile dans la tx).
    const memberRef = db().doc(`members/${input.memberId}`)
    const memberSnap = await memberRef.get()
    if (!memberSnap.exists) {
      throw new HttpsError(
        'not-found',
        `[setMemberLicensePhoto] member ${input.memberId} not found`,
      )
    }
    const member = memberSnap.data() as MemberData
    const oldPath = member.photoStoragePath ?? null

    // Write Firestore — pose la nouvelle réf + audit.
    try {
      await memberRef.update({
        photoStoragePath: input.storagePath,
        photoUpdatedAt: Timestamp.now(),
        photoUpdatedByUid: callerUid,
      })
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: unknown }).code)
          : 'unknown'
      logger.error(`[setMemberLicensePhoto] firestore update failed [${code}]`, {
        callerUid,
        memberId: input.memberId,
        storagePath: input.storagePath,
        err: err instanceof Error ? err.message : String(err),
      })
      throw new HttpsError(
        'internal',
        '[setMemberLicensePhoto] failed to persist photo reference',
      )
    }

    // Best-effort : delete de l'ancien fichier si le path change. Non bloquant
    // — on ne ré-essaye pas, on log et on continue (cf. brief PR-B).
    if (oldPath && oldPath !== input.storagePath) {
      await bestEffortDeleteStorageObject(oldPath, {
        callerUid,
        memberId: input.memberId,
      })
    }

    logger.info('[setMemberLicensePhoto] ok', {
      memberId: input.memberId,
      callerUid,
      sizeBytes: input.sizeBytes,
      contentType: input.contentType,
      storagePath: input.storagePath,
      replacedPath: oldPath && oldPath !== input.storagePath ? oldPath : null,
    })

    return {
      ok: true,
      memberId: input.memberId,
      photoStoragePath: input.storagePath,
    }
  },
)
