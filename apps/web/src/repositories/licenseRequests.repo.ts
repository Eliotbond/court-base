import { FirebaseError } from 'firebase/app'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type UpdateData,
} from 'firebase/firestore'
import {
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from 'firebase/storage'
import { auth, db, storage } from '@/services/firebase'
import type {
  LicenseRequest,
  LicenseRequestData,
  LicenseRequestStatus,
} from '@club-app/shared-types'

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
 * Comparator `createdAt` desc. Tolère les docs dont `createdAt` n'est pas
 * encore résolu (`serverTimestamp` pending → champ `null` côté snapshot lu
 * juste après l'écriture) en les plaçant en tête — pattern aligné sur
 * `licenses.repo.ts:compareByCreatedAtDesc`.
 */
function compareByCreatedAtDesc(a: LicenseRequest, b: LicenseRequest): number {
  const as = a.createdAt?.seconds ?? Number.MAX_SAFE_INTEGER
  const bs = b.createdAt?.seconds ?? Number.MAX_SAFE_INTEGER
  return bs - as
}

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
    return rows.sort(compareByCreatedAtDesc)
  } catch (err: unknown) {
    if (err instanceof FirebaseError && err.code === 'permission-denied') {
      return []
    }
    throw err
  }
}

/**
 * Liste toutes les demandes de licence visibles par le caller, tri client
 * `createdAt` desc. Scope par rôle (rules Firestore) :
 *   - rootAdmin / admin / treasurer / secretary → toutes
 *   - coach → uniquement ses teams (filtré côté serveur par les rules)
 *
 * Dégradation : `permission-denied` → `[]` (UI affiche un empty state plutôt
 * qu'un crash). Toute autre FirebaseError remonte avec le code loggé pour
 * faciliter le diagnostic (apps/web/CLAUDE.md §"Catch enrichi obligatoire").
 *
 * Pas d'index dédié — query plate sur la collection + tri JS, volumétrie
 * attendue < quelques centaines (cf. règle 10 du CLAUDE.md racine ; tolère
 * aussi les docs avec `serverTimestamp` pas encore résolu, qui seraient
 * exclus d'un `orderBy` Firestore).
 */
export async function listAllLicenseRequests(): Promise<LicenseRequest[]> {
  try {
    const snap = await getDocs(collection(db, COLLECTION))
    const rows: LicenseRequest[] = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as LicenseRequestData),
    }))
    return rows.sort(compareByCreatedAtDesc)
  } catch (err: unknown) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    if (err instanceof FirebaseError && err.code === 'permission-denied') {
      console.warn(`[licenseRequests.repo/listAllLicenseRequests] denied [${code}]`)
      return []
    }
    console.error(`[licenseRequests.repo/listAllLicenseRequests] failed [${code}]`, err)
    throw err
  }
}

/**
 * Lecture single d'une `/licenseRequests/{id}`. Retourne `null` si le doc
 * n'existe pas — l'UI peut afficher un not-found gracieux sans throw.
 *
 * `permission-denied` (caller hors-scope) → `null` également, pour aligner sur
 * la sémantique "rien à afficher" plutôt que crash.
 */
export async function getLicenseRequest(id: string): Promise<LicenseRequest | null> {
  try {
    const snap = await getDoc(doc(db, COLLECTION, id))
    if (!snap.exists()) return null
    return { id: snap.id, ...(snap.data() as LicenseRequestData) }
  } catch (err: unknown) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    if (err instanceof FirebaseError && err.code === 'permission-denied') {
      console.warn(`[licenseRequests.repo/getLicenseRequest] denied [${code}] id=${id}`)
      return null
    }
    console.error(`[licenseRequests.repo/getLicenseRequest] failed [${code}]`, err)
    throw err
  }
}

/**
 * Liste toutes les demandes de licence "actives" (non-terminales) visibles
 * par le caller. Strictement filtré côté JS depuis `listAllLicenseRequests`
 * (pas d'index dédié, volumétrie attendue petite).
 *
 * Utilisé par la vue trésorier `/license-requests` qui n'affiche jamais les
 * statuts terminaux (`approved` / `rejected`). Conserve l'ordre `createdAt`
 * desc déjà appliqué par le repo source.
 */
export async function listActiveLicenseRequests(): Promise<LicenseRequest[]> {
  const all = await listAllLicenseRequests()
  return all.filter((r) => !licenseRequestIsTerminal(r.status))
}

/**
 * Résout l'URL signée Firebase Storage pour aperçu/téléchargement d'un
 * document uploadé par le parent. Path canonique :
 * `licenseRequests/{uid}/{requestId}/{kind}.{ext}` — mais on accepte tout
 * `storagePath` brut posé sur `UploadedDocRef.storagePath`.
 *
 * Une `FirebaseError` (notamment `storage/unauthorized` côté rules) remonte au
 * caller pour qu'il puisse afficher un message d'erreur dédié (l'UI ne doit
 * pas faire fallback silencieux sur un doc privé).
 */
export async function getLicenseDocumentUrl(storagePath: string): Promise<string> {
  try {
    return await getDownloadURL(storageRef(storage, storagePath))
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`getLicenseDocumentUrl failed [${code}] path=${storagePath}`, err)
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

// ---------------------------------------------------------------------------
// Delete — admin only (rules `delete: isRootAdmin() || isAdmin()`).
//
// Destiné aux demandes "en cours" (non-terminales) — correction d'erreur
// admin. Pas de garde-fou côté repo (l'UI gate l'affichage du bouton sur les
// statuts non-terminaux + ajoute un dialog type-to-confirm). Aucune Function
// trigger n'écoute le delete : la suppression est strictement une opération
// de nettoyage Firestore, pas d'effet de bord côté `/members` ou `/licenses`.
// ---------------------------------------------------------------------------

/**
 * Une demande est dite "en cours" tant qu'elle n'est pas terminale. Helper
 * exporté pour que l'UI gate l'affichage du bouton supprimer de la même
 * façon que le repo.
 */
export function licenseRequestIsTerminal(
  status: LicenseRequestStatus,
): boolean {
  return status === 'approved' || status === 'rejected'
}

/**
 * Supprime définitivement une `/licenseRequests/{id}`. Réservé à l'admin /
 * rootAdmin (gating par rules). L'UI doit confirmer via dialog type-to-confirm.
 */
export async function deleteLicenseRequest(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, COLLECTION, id))
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`deleteLicenseRequest failed [${code}]`, err)
    throw err
  }
}

// ---------------------------------------------------------------------------
// Storage uploads — phase trésorier (PR3 trésorier, 2026-05-24).
//
// Convention (cf. `packages/shared-types/src/license-treasurer.ts` § "paths
// Storage") :
//   - signable.pdf        : `licenseRequests/{uid}/{requestId}/signable.pdf`
//   - payment-proof.{ext} : `licenseRequests/{uid}/{requestId}/payment-proof.{ext}`
//
// `uid` est l'uid Firebase Auth de l'uploader (le trésorier ici — différent du
// `uid` parent du `signed.pdf`). Les fichiers sont uploadés AVANT l'appel à la
// callable correspondante (`treasurerUploadSignableDoc` /
// `treasurerMarkSentAndPaid`) qui valide le path côté serveur.
// ---------------------------------------------------------------------------

export interface TreasurerUploadResult {
  storagePath: string
  fileName: string
  sizeBytes: number
  contentType: string
}

/** Infère l'extension depuis le `File` (basename + content-type fallback). */
function inferFileExtension(file: File): string {
  const lastDot = file.name.lastIndexOf('.')
  if (lastDot >= 0) return file.name.slice(lastDot).toLowerCase()
  if (file.type === 'application/pdf') return '.pdf'
  if (file.type === 'image/png') return '.png'
  if (file.type === 'image/jpeg') return '.jpg'
  return ''
}

/**
 * Upload le PDF formulaire fédéral pré-rempli ("signable doc") par le
 * trésorier, à utiliser depuis le store/UI **avant** d'appeler la callable
 * `treasurerUploadSignableDoc`. Path : `licenseRequests/{callerUid}/{requestId}/signable.pdf`.
 *
 * Catch enrichi `FirebaseError` (cf. apps/web/CLAUDE.md §"Catch enrichi
 * obligatoire") — l'erreur remonte au caller pour qu'il affiche un banner
 * (pas de fallback silencieux sur un Storage refusé).
 */
export async function uploadSignableDoc(
  requestId: string,
  callerUid: string,
  file: File,
): Promise<TreasurerUploadResult> {
  if (!callerUid) {
    throw new Error('uploadSignableDoc: callerUid manquant.')
  }
  const path = `licenseRequests/${callerUid}/${requestId}/signable.pdf`
  try {
    const fileRef = storageRef(storage, path)
    await uploadBytes(fileRef, file, { contentType: file.type })
    return {
      storagePath: path,
      fileName: file.name,
      sizeBytes: file.size,
      contentType: file.type,
    }
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`uploadSignableDoc failed [${code}] path=${path}`, err)
    throw err
  }
}

/**
 * Upload la preuve de paiement (extrait bancaire / screenshot e-banking) par
 * le trésorier. Path : `licenseRequests/{callerUid}/{requestId}/payment-proof.{ext}`.
 * Utilisé avant l'appel à `treasurerMarkSentAndPaid` (ou en re-upload via la
 * même callable si la preuve arrive après l'envoi du dossier — flow async).
 */
export async function uploadPaymentProof(
  requestId: string,
  callerUid: string,
  file: File,
): Promise<TreasurerUploadResult> {
  if (!callerUid) {
    throw new Error('uploadPaymentProof: callerUid manquant.')
  }
  const ext = inferFileExtension(file)
  const path = `licenseRequests/${callerUid}/${requestId}/payment-proof${ext}`
  try {
    const fileRef = storageRef(storage, path)
    await uploadBytes(fileRef, file, { contentType: file.type })
    return {
      storagePath: path,
      fileName: file.name,
      sizeBytes: file.size,
      contentType: file.type,
    }
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`uploadPaymentProof failed [${code}] path=${path}`, err)
    throw err
  }
}

/**
 * Variante "défensive" de `getLicenseDocumentUrl` qui ne throw pas si le
 * fichier est inaccessible (rules Storage / objet inexistant). Retourne
 * `null` à la place — pratique pour rendre une liste de liens téléchargements
 * dans l'UI trésorier sans crasher tout le composant si une URL résout pas.
 *
 * Toute autre erreur reste loggée et propagée (cohérent avec le pattern
 * `getLicenseDocumentUrl` existant pour les caches plus stricts).
 */
export async function getLicenseRequestFileDownloadUrl(
  storagePath: string,
): Promise<string | null> {
  try {
    return await getDownloadURL(storageRef(storage, storagePath))
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    if (
      err instanceof FirebaseError &&
      (err.code === 'storage/object-not-found' ||
        err.code === 'storage/unauthorized')
    ) {
      console.warn(
        `[licenseRequests.repo/getLicenseRequestFileDownloadUrl] denied/not-found [${code}] path=${storagePath}`,
      )
      return null
    }
    console.error(
      `getLicenseRequestFileDownloadUrl failed [${code}] path=${storagePath}`,
      err,
    )
    throw err
  }
}
