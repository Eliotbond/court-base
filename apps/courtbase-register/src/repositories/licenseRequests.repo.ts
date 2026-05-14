import {
  FirestoreError,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import type {
  LicenseRequest,
  LicenseRequestData,
} from '@club-app/shared-types'
import { db } from '@/services/firebase'

/**
 * Repository LicenseRequests — accès lecture pour l'app register (§5).
 *
 * Lecture autorisée par les rules (cf. `firestore.rules` §licenseRequests) :
 *  - admin / rootAdmin
 *  - coach de la team
 *  - `isLinkedMember(memberId)` — le user lié comme joueur
 *  - `isGuardianOf(memberId)` — le user tuteur d'un membre mineur
 *
 * Côté app register, le caller est typiquement le linked member majeur OU un
 * tuteur. La query principale est "mes licenseRequests" : pour cela, on doit
 * passer par 2 queries (linkedMemberId courant côté /users, plus la liste
 * des memberIds dont le caller est guardian — résolue en amont via
 * members.repo.listMyDependents).
 *
 * Écriture : interdite côté client (allow create par admin/coach uniquement,
 * allow update par admin uniquement). L'upload de documents licence passera
 * par une callable `uploadLicenseDocument` (à venir Phase E).
 */

const LICENSE_REQUESTS = 'licenseRequests'

function snapToLicenseRequest(
  snap: { id: string; data: () => unknown },
): LicenseRequest {
  const data = snap.data() as LicenseRequestData
  return { id: snap.id, ...data }
}

/**
 * Liste les licenseRequests d'un member donné. Tri `createdAt desc`. Le
 * caller doit être linked member, guardian, coach team ou admin (cf. rules).
 *
 * Vide si aucune licenseRequest, ou si la rule refuse silencieusement le
 * caller (cas pathologique — pas d'erreur explicite côté client).
 */
export async function listLicenseRequestsForMember(
  memberId: string,
): Promise<LicenseRequest[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, LICENSE_REQUESTS),
        where('memberId', '==', memberId),
        orderBy('createdAt', 'desc'),
      ),
    )
    return snap.docs.map(snapToLicenseRequest)
  } catch (err) {
    if (err instanceof FirestoreError && err.code === 'permission-denied') {
      return []
    }
    throw err
  }
}

/** Récupère une licenseRequest par son id. Retourne `null` si absent ou refusé. */
export async function getLicenseRequestById(
  requestId: string,
): Promise<LicenseRequest | null> {
  try {
    const snap = await getDoc(doc(db, LICENSE_REQUESTS, requestId))
    if (!snap.exists()) return null
    return snapToLicenseRequest(snap)
  } catch (err) {
    if (err instanceof FirestoreError && err.code === 'permission-denied') {
      return null
    }
    throw err
  }
}

/**
 * Liste les licenseRequests pour plusieurs membres d'un coup (utilisé par
 * Home après avoir résolu `mes pupilles`). Firestore `in` est limité à 30
 * valeurs — au-delà, on découpe.
 */
export async function listLicenseRequestsForMembers(
  memberIds: readonly string[],
): Promise<LicenseRequest[]> {
  if (memberIds.length === 0) return []
  const CHUNK = 30
  const out: LicenseRequest[] = []
  for (let i = 0; i < memberIds.length; i += CHUNK) {
    const chunk = memberIds.slice(i, i + CHUNK)
    try {
      const snap = await getDocs(
        query(
          collection(db, LICENSE_REQUESTS),
          where('memberId', 'in', chunk),
        ),
      )
      for (const d of snap.docs) out.push(snapToLicenseRequest(d))
    } catch (err) {
      if (err instanceof FirestoreError && err.code === 'permission-denied') {
        continue
      }
      throw err
    }
  }
  // Tri client `createdAt desc` (les chunks ne sont pas pré-triés).
  out.sort((a, b) => {
    const sa = a.createdAt?.seconds ?? 0
    const sb = b.createdAt?.seconds ?? 0
    return sb - sa
  })
  return out
}
