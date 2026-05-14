import { FirebaseError } from 'firebase/app'
import {
  Timestamp,
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
import type {
  PaymentExceptionRequest,
  PaymentExceptionRequestData,
} from '@club-app/shared-types'

/**
 * Repository PaymentExceptionRequests — Firestore-backed
 * (collection `/paymentExceptionRequests/{id}`).
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase
 * (cf. docs/frontend-desktop.md — architecture en couches).
 *
 * Domaine (rappel cf. docs/main.md — flow exception) :
 *  - Création par un coach (mobile) pour demander un override d'exclusion sur
 *    une cotisation dépassée. Status initial `pending`.
 *  - Approbation / rejet par admin : la Function trigger
 *    `applyPaymentException` (cf. `functions/src/exceptions/applyPaymentException.ts`)
 *    écoute l'update et propage les changements sur `/dues/{dueId}` (notamment
 *    `status: 'excepted'` + nouvelles dates si fournies). Ce repo NE TOUCHE
 *    PAS au doc due — la Function s'en occupe.
 *  - Rules `/paymentExceptionRequests` : admin / rootAdmin lisent tout. Coach
 *    lit uniquement les demandes de ses teams. Update / delete : admin only.
 *
 * Pas d'index composite défini sur `memberId + createdAt`. On filtre par
 * `memberId` (single-field autorisé) puis tri client-side par `createdAt`
 * desc. Volumétrie par membre = unités, acceptable.
 *
 * MVP : `newIssuedAt` / `newDueAt` exposés mais optionnels. L'écran Demandes
 * du Member detail expose pour l'instant approve/reject simple — l'édition
 * des dates ira dans un drawer dédié (cf. design-brief, écran Dues).
 */

const COLLECTION = 'paymentExceptionRequests'

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Liste toutes les demandes d'exception cotisation pour un membre donné,
 * ordre antéchronologique (`createdAt` desc), tri côté client.
 *
 * Dégradation : `permission-denied` → `[]` (cf. justification dans
 * `licenseRequests.repo.ts`).
 */
export async function listMemberPaymentExceptionRequests(
  memberId: string,
): Promise<PaymentExceptionRequest[]> {
  try {
    const snap = await getDocs(
      query(collection(db, COLLECTION), where('memberId', '==', memberId)),
    )
    const rows: PaymentExceptionRequest[] = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as PaymentExceptionRequestData),
    }))
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
// Writes — admin only.
//
// Pattern identique à `licenseRequests.repo.ts`. La Function
// `applyPaymentException` propage côté `/dues` — on ne double-write pas.
// ---------------------------------------------------------------------------

interface ApprovePayload {
  adminComment?: string
  /** Optionnel — re-pose `issuedAt` côté Function. */
  newIssuedAt?: Date
  /** Optionnel — re-pose `dueAt` côté Function. */
  newDueAt?: Date
}

interface RejectPayload {
  adminComment?: string
}

function resolveAdminUid(): string {
  const uid = auth.currentUser?.uid
  if (!uid) {
    throw new Error('Utilisateur non authentifié — revue de demande impossible.')
  }
  return uid
}

/**
 * Approuve une demande d'exception cotisation. Les dates `newIssuedAt` /
 * `newDueAt` sont optionnelles ; si fournies, on les convertit en Timestamp
 * Firestore. La Function trigger relit ces valeurs et les pousse sur le doc
 * `/dues/{dueId}` correspondant.
 */
export async function approvePaymentExceptionRequest(
  id: string,
  payload: ApprovePayload = {},
): Promise<void> {
  const update: UpdateData<PaymentExceptionRequestData> = {
    status: 'approved',
    reviewedAt: serverTimestamp(),
    reviewedBy: resolveAdminUid(),
    adminComment:
      payload.adminComment !== undefined && payload.adminComment.trim().length > 0
        ? payload.adminComment.trim()
        : null,
  }
  if (payload.newIssuedAt) {
    update.newIssuedAt = Timestamp.fromDate(payload.newIssuedAt)
  }
  if (payload.newDueAt) {
    update.newDueAt = Timestamp.fromDate(payload.newDueAt)
  }
  await updateDoc(doc(db, COLLECTION, id), update)
}

/** Rejette une demande d'exception cotisation. Aucun side-effect sur `/dues`. */
export async function rejectPaymentExceptionRequest(
  id: string,
  payload: RejectPayload = {},
): Promise<void> {
  const update: UpdateData<PaymentExceptionRequestData> = {
    status: 'rejected',
    reviewedAt: serverTimestamp(),
    reviewedBy: resolveAdminUid(),
    adminComment:
      payload.adminComment !== undefined && payload.adminComment.trim().length > 0
        ? payload.adminComment.trim()
        : null,
  }
  await updateDoc(doc(db, COLLECTION, id), update)
}
