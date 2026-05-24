/**
 * Repository ReplacementRequests — `/replacementRequests/{requestId}`.
 *
 * SEULE couche autorisée à importer le SDK Firebase pour ces docs (cf.
 * architecture en couches CLAUDE.md racine). Pattern hybride mock +
 * Firestore identique à `officials.repo.ts` / `licenseRequests.repo.ts`.
 *
 * Couvre :
 *  - **listIncoming/Outgoing** : inbox des demandes reçues / sortantes pour
 *    un member (LIST queries `targetMemberId == X` / `requesterMemberId == X`).
 *  - **create** : nouvelle demande pending (rules autorisent
 *    `requesterMemberId == callerMember()`).
 *  - **accept** : passe par la callable serveur `acceptReplacement` qui
 *    fait le transfert atomique d'assignation (Admin SDK).
 *  - **decline** : write client-direct (target uniquement, whitelist
 *    `[status, respondedAt, declineReason]`).
 *  - **cancel** : write client-direct (requester uniquement, whitelist idem).
 *
 * Cf. `firestore.rules` § `/replacementRequests`, schéma
 * `packages/shared-types/src/replacementRequest.ts`.
 */

import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { FirebaseError } from 'firebase/app'
import { httpsCallable } from 'firebase/functions'

import type {
  ReplacementRequest,
  ReplacementRequestData,
  ReplacementRequestStatus,
  ReplacementParentKind,
} from '@club-app/shared-types'

import { db, functions } from '@/services/firebase'
import { logMockAction } from '@/repositories/mock'

// ─── Constantes Firestore ────────────────────────────────────────────

const REPLACEMENT_REQUESTS = 'replacementRequests'

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Vérifie un code Firestore sans `instanceof FirestoreError` (cf. CLAUDE.md
 * règle 13 + mémoire `firebase-error-instanceof-unreliable`).
 */
function isPermissionDenied(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'permission-denied'
  )
}

/**
 * Renvoie `db` ou `null` si l'init Firestore a échoué (rare — pattern
 * symétrique à `officials.repo.ts`). Le mode "mock" est piloté par le
 * store via la présence d'un memberId réel ; ici on dégrade silencieusement
 * en `[]` / no-op.
 */
function getFirestoreOrNull(): typeof db | null {
  try {
    return db
  } catch {
    return null
  }
}

/**
 * Forme défensive du doc Firestore. Tolère un doc legacy partiel.
 */
function snapToReplacementRequest(
  snap: QueryDocumentSnapshot<DocumentData>,
): ReplacementRequest {
  const data = snap.data() as Partial<ReplacementRequestData>
  return {
    id: snap.id,
    parentKind: (data.parentKind ?? 'home') as ReplacementParentKind,
    parentId: data.parentId ?? '',
    originalAssignmentId: data.originalAssignmentId ?? '',
    requesterMemberId: data.requesterMemberId ?? '',
    requesterDisplayName: data.requesterDisplayName ?? '',
    targetMemberId: data.targetMemberId ?? '',
    targetDisplayName: data.targetDisplayName ?? '',
    matchDateMs: typeof data.matchDateMs === 'number' ? data.matchDateMs : 0,
    matchStartTime: data.matchStartTime ?? '',
    matchEndTime: data.matchEndTime ?? '',
    matchTypeName: data.matchTypeName ?? '',
    matchOpponentName: data.matchOpponentName ?? null,
    matchVenueLabel: data.matchVenueLabel ?? null,
    officialLevel: typeof data.officialLevel === 'number' ? data.officialLevel : 0,
    message: data.message ?? null,
    status: (data.status ?? 'pending') as ReplacementRequestStatus,
    createdAt: data.createdAt ?? Timestamp.fromMillis(0),
    respondedAt: data.respondedAt ?? null,
    declineReason: data.declineReason ?? null,
  }
}

// ─── Input types ─────────────────────────────────────────────────────

export interface CreateReplacementRequestInput {
  parentKind: ReplacementParentKind
  parentId: string
  originalAssignmentId: string
  requesterMemberId: string
  requesterDisplayName: string
  targetMemberId: string
  targetDisplayName: string
  matchDateMs: number
  matchStartTime: string
  matchEndTime: string
  matchTypeName: string
  matchOpponentName: string | null
  matchVenueLabel: string | null
  officialLevel: number
  message: string | null
}

// ─── List (Incoming / Outgoing) ──────────────────────────────────────

/**
 * Demandes reçues : `targetMemberId == X`. Triées createdAt DESC côté JS
 * (cf. CLAUDE.md règle 10 — petit volume, pas d'index composite).
 */
export async function listIncomingReplacementRequests(
  targetMemberId: string,
): Promise<ReplacementRequest[]> {
  if (!targetMemberId) return []
  const firestore = getFirestoreOrNull()
  if (!firestore) return []
  try {
    const snap = await getDocs(
      query(
        collection(firestore, REPLACEMENT_REQUESTS),
        where('targetMemberId', '==', targetMemberId),
      ),
    )
    return snap.docs
      .map(snapToReplacementRequest)
      .sort((a, b) => (b.createdAt.seconds ?? 0) - (a.createdAt.seconds ?? 0))
  } catch (err) {
    if (isPermissionDenied(err)) {
      console.warn(
        `[replacements.repo] listIncomingReplacementRequests(${targetMemberId}) permission-denied`,
      )
      return []
    }
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(
      `[replacements.repo] listIncomingReplacementRequests(${targetMemberId}) failed [${code}]`,
      err,
    )
    return []
  }
}

/**
 * Demandes sortantes : `requesterMemberId == X`. Tri identique.
 */
export async function listOutgoingReplacementRequests(
  requesterMemberId: string,
): Promise<ReplacementRequest[]> {
  if (!requesterMemberId) return []
  const firestore = getFirestoreOrNull()
  if (!firestore) return []
  try {
    const snap = await getDocs(
      query(
        collection(firestore, REPLACEMENT_REQUESTS),
        where('requesterMemberId', '==', requesterMemberId),
      ),
    )
    return snap.docs
      .map(snapToReplacementRequest)
      .sort((a, b) => (b.createdAt.seconds ?? 0) - (a.createdAt.seconds ?? 0))
  } catch (err) {
    if (isPermissionDenied(err)) {
      console.warn(
        `[replacements.repo] listOutgoingReplacementRequests(${requesterMemberId}) permission-denied`,
      )
      return []
    }
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(
      `[replacements.repo] listOutgoingReplacementRequests(${requesterMemberId}) failed [${code}]`,
      err,
    )
    return []
  }
}

// ─── Create ──────────────────────────────────────────────────────────

/**
 * Crée une demande de remplacement (status `pending`). Auto-id Firestore.
 * Retourne l'ID du nouveau doc.
 *
 * Mode mock : `logMockAction` + ID synthétique. Throws sur permission-denied
 * (le caller doit pouvoir afficher un toast d'erreur).
 */
export async function createReplacementRequest(
  input: CreateReplacementRequestInput,
): Promise<string> {
  if (!input.requesterMemberId) {
    throw new Error('createReplacementRequest: requesterMemberId required')
  }
  if (!input.targetMemberId) {
    throw new Error('createReplacementRequest: targetMemberId required')
  }
  if (input.targetMemberId === input.requesterMemberId) {
    throw new Error('createReplacementRequest: target must differ from requester')
  }

  const firestore = getFirestoreOrNull()
  if (!firestore) {
    logMockAction('replacements.create', {
      parentKind: input.parentKind,
      parentId: input.parentId,
      target: input.targetMemberId,
    })
    return `mock-${Date.now()}`
  }

  try {
    const docRef = await addDoc(collection(firestore, REPLACEMENT_REQUESTS), {
      ...input,
      status: 'pending',
      createdAt: serverTimestamp(),
      respondedAt: null,
      declineReason: null,
    })
    return docRef.id
  } catch (err) {
    if (isPermissionDenied(err)) {
      console.error('[replacements.repo] createReplacementRequest permission-denied', err)
      throw new Error(
        'Demande refusée. Vérifiez que vous êtes bien lié à un membre officiel.',
      )
    }
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[replacements.repo] createReplacementRequest failed [${code}]`, err)
    throw new Error(`Erreur lors de la création de la demande (${code}).`)
  }
}

// ─── Accept (callable serveur) ───────────────────────────────────────

interface AcceptReplacementCallableResult {
  ok: true
  newAssignmentId: string
}

/**
 * Accepte une demande de remplacement via la callable serveur
 * `acceptReplacement` (transfert atomique : decline l'original, crée la
 * nouvelle assignation pour la cible, marque la demande `accepted`).
 *
 * Mode mock : log-only, retourne un stub.
 */
export async function acceptReplacementRequest(
  requestId: string,
): Promise<{ newAssignmentId: string }> {
  if (!requestId) throw new Error('acceptReplacementRequest: requestId required')

  const firestore = getFirestoreOrNull()
  if (!firestore) {
    logMockAction('replacements.accept', { requestId })
    return { newAssignmentId: 'mock-assignment' }
  }

  try {
    const fn = httpsCallable<{ requestId: string }, AcceptReplacementCallableResult>(
      functions,
      'acceptReplacement',
    )
    const res = await fn({ requestId })
    return { newAssignmentId: res.data.newAssignmentId }
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[replacements.repo] acceptReplacementRequest failed [${code}]`, err)
    throw new Error(`Erreur lors de l'acceptation (${code}).`)
  }
}

// ─── Decline (client-direct) ─────────────────────────────────────────

/**
 * Décline une demande (target uniquement). Whitelist rules :
 * `affectedKeys.hasOnly(['status', 'respondedAt', 'declineReason'])`.
 *
 * Mode mock : log-only.
 */
export async function declineReplacementRequest(
  requestId: string,
  reason: string | null,
): Promise<void> {
  if (!requestId) throw new Error('declineReplacementRequest: requestId required')

  const firestore = getFirestoreOrNull()
  if (!firestore) {
    logMockAction('replacements.decline', { requestId, reason })
    return
  }

  try {
    await updateDoc(doc(firestore, REPLACEMENT_REQUESTS, requestId), {
      status: 'declined',
      respondedAt: serverTimestamp(),
      declineReason: reason ?? null,
    })
  } catch (err) {
    if (isPermissionDenied(err)) {
      console.error('[replacements.repo] declineReplacementRequest permission-denied', err)
      throw new Error(
        'Refus impossible. Vous ne pouvez décliner que les demandes qui vous sont adressées.',
      )
    }
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[replacements.repo] declineReplacementRequest failed [${code}]`, err)
    throw new Error(`Erreur lors du refus (${code}).`)
  }
}

// ─── Cancel (client-direct) ──────────────────────────────────────────

/**
 * Annule une demande (requester uniquement). Whitelist rules identique.
 *
 * Mode mock : log-only.
 */
export async function cancelReplacementRequest(requestId: string): Promise<void> {
  if (!requestId) throw new Error('cancelReplacementRequest: requestId required')

  const firestore = getFirestoreOrNull()
  if (!firestore) {
    logMockAction('replacements.cancel', { requestId })
    return
  }

  try {
    await updateDoc(doc(firestore, REPLACEMENT_REQUESTS, requestId), {
      status: 'cancelled',
      respondedAt: serverTimestamp(),
      declineReason: null,
    })
  } catch (err) {
    if (isPermissionDenied(err)) {
      console.error('[replacements.repo] cancelReplacementRequest permission-denied', err)
      throw new Error(
        "Annulation impossible. Vous ne pouvez annuler que vos propres demandes.",
      )
    }
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[replacements.repo] cancelReplacementRequest failed [${code}]`, err)
    throw new Error(`Erreur lors de l'annulation (${code}).`)
  }
}
