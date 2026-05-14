import { FirebaseError } from 'firebase/app'
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type UpdateData,
} from 'firebase/firestore'
import { auth, db } from '@/services/firebase'
import type { LicenseRequest, LicenseRequestData } from '@club-app/shared-types'

/**
 * Repository LicenseRequests — Firestore-backed (collection `/licenseRequests/{id}`).
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase
 * (cf. docs/frontend-desktop.md — architecture en couches).
 *
 * Domaine (rappel cf. docs/main.md — license requests) :
 *  - Création par un coach mobile via la Function dédiée → status `pending`.
 *  - Approbation / rejet par admin : la Function trigger
 *    `applyLicenseRequest` (cf. `functions/src/licenses/applyLicenseRequest.ts`)
 *    écoute l'update et propage `member.licensed = true` lorsqu'on passe à
 *    `approved`. Ce repo NE TOUCHE PAS au doc `/members/{id}` — la Function
 *    s'en occupe pour garantir la cohérence côté serveur.
 *  - Rules `/licenseRequests` : admin / rootAdmin lisent tout. Coach lit
 *    uniquement les demandes de ses teams. Update / delete : admin only.
 *
 * Pas d'index dédié `memberId + createdAt` (cf. firestore.indexes.json — seul
 * `status + createdAt` est défini). On filtre par `memberId` (single-field
 * autorisé sans index composite) puis on trie côté client par `createdAt`
 * desc. Acceptable : volumétrie attendue par membre = quelques unités.
 */

const COLLECTION = 'licenseRequests'

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Liste toutes les demandes de licence pour un membre donné, ordre
 * antéchronologique (`createdAt` desc), tri côté client.
 *
 * Dégradation : `permission-denied` → `[]` (ex. coach hors-scope qui regarde
 * un membre qu'il ne devrait pas voir — l'écran reste fonctionnel sans la
 * liste). Toute autre erreur Firebase remonte.
 */
export async function listMemberLicenseRequests(
  memberId: string,
): Promise<LicenseRequest[]> {
  try {
    const snap = await getDocs(
      query(collection(db, COLLECTION), where('memberId', '==', memberId)),
    )
    const rows: LicenseRequest[] = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as LicenseRequestData),
    }))
    // Tri client-side : `createdAt.seconds` desc (le type neutre `Timestamp`
    // de shared-types expose `seconds` / `nanoseconds` ; runtime Firestore
    // les remplit toujours).
    rows.sort((a, b) => b.createdAt.seconds - a.createdAt.seconds)
    return rows
  } catch (err: unknown) {
    if (err instanceof FirebaseError && err.code === 'permission-denied') {
      return []
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// Writes — admin only (rules update/delete admin-only).
//
// On pose `reviewedAt: serverTimestamp()` et `reviewedBy: <uid admin courant>`
// pour tracer la décision. La Function `applyLicenseRequest` écoute l'update
// et propage côté `/members/{id}` (set `licensed = true` sur approve). On ne
// touche donc PAS au doc member ici — sinon double-write race.
// ---------------------------------------------------------------------------

interface ReviewPayload {
  adminComment?: string
}

function resolveAdminUid(): string {
  const uid = auth.currentUser?.uid
  if (!uid) {
    throw new Error('Utilisateur non authentifié — revue de demande impossible.')
  }
  return uid
}

function buildReviewUpdate(
  status: 'approved' | 'rejected',
  payload: ReviewPayload,
): UpdateData<LicenseRequestData> {
  const update: UpdateData<LicenseRequestData> = {
    status,
    reviewedAt: serverTimestamp(),
    reviewedBy: resolveAdminUid(),
    adminComment:
      payload.adminComment !== undefined && payload.adminComment.trim().length > 0
        ? payload.adminComment.trim()
        : null,
  }
  return update
}

/** Approuve une demande de licence. La Function trigger propage côté `/members`. */
export async function approveLicenseRequest(
  id: string,
  payload: ReviewPayload = {},
): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), buildReviewUpdate('approved', payload))
}

/** Rejette une demande de licence. Aucun side-effect côté `/members`. */
export async function rejectLicenseRequest(
  id: string,
  payload: ReviewPayload = {},
): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), buildReviewUpdate('rejected', payload))
}
