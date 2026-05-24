/**
 * Repository Officials — sub-collections `/officialAssignments` (HOME + AWAY).
 *
 * SEULE couche autorisée à importer le SDK Firebase pour ces sub-collections
 * (cf. architecture en couches CLAUDE.md racine). Pattern hybride mock +
 * Firestore identique à `bookings.repo.ts` / `licenseRequests.repo.ts`.
 *
 * **Pas de Cloud Function** — les writes sont autorisés en direct par les
 * rules (cf. `firestore.rules` lignes 344-365 HOME, 392-413 AWAY) :
 *  - **create** : self-register par un officiel (memberId == userDoc().memberId,
 *    status == 'pending', licence officiel ACTIVE requise via
 *    `callerHasOfficialLicense()`).
 *  - **update** : confirm/decline sur SA propre assignation (whitelist stricte
 *    `affectedKeys().hasOnly(['status', 'respondedAt'])`).
 *
 * **ID déterministe = memberId** pour idempotence : un re-clic "S'inscrire"
 * n'ouvre pas de doublon — `setDoc(..., { merge: false })` écrase l'entrée
 * existante avec les mêmes valeurs (status 'pending'). Cf. CLAUDE.md règle
 * IDs déterministes pour les writes Firestore.
 *
 * Cf. `docs/firebase.md` § officialAssignments, `packages/shared-types/src/booking.ts`
 * (types `OfficialAssignmentData`).
 */

import {
  Timestamp,
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { FirebaseError } from 'firebase/app'

import type {
  OfficialAssignment,
  OfficialAssignmentData,
  OfficialAssignmentStatus,
} from '@club-app/shared-types'

import { db } from '@/services/firebase'
import { logMockAction } from '@/repositories/mock'

// ─── Constantes Firestore ────────────────────────────────────────────

const BOOKINGS = 'bookings'
const MATCHES = 'matches'
const OFFICIAL_ASSIGNMENTS = 'officialAssignments'

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
 * symétrique à `bookings.repo.ts`). Le mode "mock pur" est en pratique
 * piloté par le store ; ce repo dégrade ponctuellement sur erreur
 * `permission-denied` (list → []) ou throw (write).
 */
function getFirestoreOrNull(): typeof db | null {
  try {
    return db
  } catch {
    return null
  }
}

/**
 * Forme défensive du doc Firestore. Un doc legacy sans `respondedAt` retombe
 * sur `null` propre côté UI.
 */
function snapToAssignment(
  snap: QueryDocumentSnapshot<DocumentData>,
): OfficialAssignment {
  const data = snap.data() as Partial<OfficialAssignmentData>
  return {
    id: snap.id,
    memberId: data.memberId ?? '',
    officialLevel: typeof data.officialLevel === 'number' ? data.officialLevel : 0,
    status: (data.status ?? 'pending') as OfficialAssignmentStatus,
    assignedAt: data.assignedAt ?? Timestamp.fromMillis(0),
    assignedBy: data.assignedBy ?? '',
    respondedAt: data.respondedAt ?? null,
  }
}

// ─── List (HOME / AWAY) ──────────────────────────────────────────────

/**
 * Liste les assignations d'un booking HOME. Dégrade en `[]` si :
 *  - `bookingId` vide.
 *  - mode mock (db inaccessible).
 *  - erreur Firestore `permission-denied` (loguée en warn — rare car
 *    `read: if isSignedIn() && !callerSuspended()`).
 *  - autre erreur Firebase (loguée).
 */
export async function listAssignmentsForBooking(
  bookingId: string,
): Promise<OfficialAssignment[]> {
  if (!bookingId) return []
  const firestore = getFirestoreOrNull()
  if (!firestore) return []
  try {
    const snap = await getDocs(
      collection(firestore, BOOKINGS, bookingId, OFFICIAL_ASSIGNMENTS),
    )
    return snap.docs.map(snapToAssignment)
  } catch (err) {
    if (isPermissionDenied(err)) {
      console.warn(`[officials.repo] listAssignmentsForBooking(${bookingId}) permission-denied`)
      return []
    }
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(
      `[officials.repo] listAssignmentsForBooking(${bookingId}) failed [${code}]`,
      err,
    )
    return []
  }
}

/**
 * Symétrique pour AWAY (sub-collection portée par `/matches/{matchId}`).
 */
export async function listAssignmentsForMatch(
  matchId: string,
): Promise<OfficialAssignment[]> {
  if (!matchId) return []
  const firestore = getFirestoreOrNull()
  if (!firestore) return []
  try {
    const snap = await getDocs(
      collection(firestore, MATCHES, matchId, OFFICIAL_ASSIGNMENTS),
    )
    return snap.docs.map(snapToAssignment)
  } catch (err) {
    if (isPermissionDenied(err)) {
      console.warn(`[officials.repo] listAssignmentsForMatch(${matchId}) permission-denied`)
      return []
    }
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(
      `[officials.repo] listAssignmentsForMatch(${matchId}) failed [${code}]`,
      err,
    )
    return []
  }
}

// ─── Self-register (HOME / AWAY) ─────────────────────────────────────

export interface SelfRegisterForBookingInput {
  bookingId: string
  memberId: string
  officialLevel: number
  /** uid Auth du caller (sera `assignedBy`). */
  byUid: string
}

export interface SelfRegisterForMatchInput {
  matchId: string
  memberId: string
  officialLevel: number
  byUid: string
}

/**
 * Crée le doc d'assignation. Champs whitelistés cohérents avec les rules :
 *  - `memberId` : doit matcher `userDoc().memberId` (vérifié par les rules).
 *  - `officialLevel` : snapshot du niveau au moment de la création (cf. type
 *    `OfficialAssignmentData`).
 *  - `status: 'pending'` : seul status autorisé en create par les rules.
 *  - `assignedAt`/`assignedBy`/`respondedAt` : audit.
 */
function buildAssignmentDoc(input: {
  memberId: string
  officialLevel: number
  byUid: string
}): OfficialAssignmentData {
  return {
    memberId: input.memberId,
    officialLevel: input.officialLevel,
    status: 'pending',
    // `serverTimestamp()` est un sentinel — typé `Timestamp` dans le SDK
    // mais résolu serveur-side. Pas grave que TS le voie comme `Timestamp`.
    assignedAt: serverTimestamp() as unknown as Timestamp,
    assignedBy: input.byUid,
    respondedAt: null,
  }
}

/**
 * Self-register sur un booking HOME.
 *
 * **ID déterministe = memberId** → un re-clic n'ouvre pas de doublon. Le
 * `setDoc(..., { merge: false })` écrase l'entrée existante avec un status
 * `pending` propre (réinitialise `respondedAt` à null si l'officiel s'était
 * déjà inscrit puis avait quitté — comportement attendu : il "revient"
 * dans la liste pending pour le coach/admin).
 *
 * Throws si :
 *  - `permission-denied` (officiel sans licence active, ou tentative de
 *    self-register pour un autre memberId, ou membre suspendu).
 *  - autre erreur Firebase.
 *
 * Mode mock : `logMockAction` + no-op (le store gère l'optimistic update
 * pour démo).
 */
export async function selfRegisterForBooking(
  input: SelfRegisterForBookingInput,
): Promise<void> {
  if (!input.bookingId) throw new Error('selfRegisterForBooking: bookingId required')
  if (!input.memberId) throw new Error('selfRegisterForBooking: memberId required')
  if (!input.byUid) throw new Error('selfRegisterForBooking: byUid required')

  const firestore = getFirestoreOrNull()
  if (!firestore) {
    logMockAction('officials.selfRegisterForBooking', {
      bookingId: input.bookingId,
      memberId: input.memberId,
      officialLevel: input.officialLevel,
    })
    return
  }

  try {
    await setDoc(
      doc(firestore, BOOKINGS, input.bookingId, OFFICIAL_ASSIGNMENTS, input.memberId),
      buildAssignmentDoc({
        memberId: input.memberId,
        officialLevel: input.officialLevel,
        byUid: input.byUid,
      }),
      { merge: false },
    )
  } catch (err) {
    if (isPermissionDenied(err)) {
      console.error('[officials.repo] selfRegisterForBooking permission-denied', err)
      throw new Error(
        "Inscription refusée. Vérifiez que votre licence d'officiel est active.",
      )
    }
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[officials.repo] selfRegisterForBooking failed [${code}]`, err)
    throw new Error(`Erreur lors de l'inscription (${code}).`)
  }
}

/** Symétrique pour AWAY (sub-collection `/matches/{matchId}/officialAssignments`). */
export async function selfRegisterForMatch(
  input: SelfRegisterForMatchInput,
): Promise<void> {
  if (!input.matchId) throw new Error('selfRegisterForMatch: matchId required')
  if (!input.memberId) throw new Error('selfRegisterForMatch: memberId required')
  if (!input.byUid) throw new Error('selfRegisterForMatch: byUid required')

  const firestore = getFirestoreOrNull()
  if (!firestore) {
    logMockAction('officials.selfRegisterForMatch', {
      matchId: input.matchId,
      memberId: input.memberId,
      officialLevel: input.officialLevel,
    })
    return
  }

  try {
    await setDoc(
      doc(firestore, MATCHES, input.matchId, OFFICIAL_ASSIGNMENTS, input.memberId),
      buildAssignmentDoc({
        memberId: input.memberId,
        officialLevel: input.officialLevel,
        byUid: input.byUid,
      }),
      { merge: false },
    )
  } catch (err) {
    if (isPermissionDenied(err)) {
      console.error('[officials.repo] selfRegisterForMatch permission-denied', err)
      throw new Error(
        "Inscription refusée. Vérifiez que votre licence d'officiel est active.",
      )
    }
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[officials.repo] selfRegisterForMatch failed [${code}]`, err)
    throw new Error(`Erreur lors de l'inscription (${code}).`)
  }
}

// ─── Respond (confirm / decline) ─────────────────────────────────────

export interface RespondToBookingAssignmentInput {
  bookingId: string
  assignmentId: string
  status: 'confirmed' | 'declined'
}

export interface RespondToMatchAssignmentInput {
  matchId: string
  assignmentId: string
  status: 'confirmed' | 'declined'
}

/**
 * Confirme ou décline une assignation HOME. Whitelist stricte côté rules :
 * `affectedKeys().hasOnly(['status', 'respondedAt'])`. Aucun motif persisté
 * (le motif côté UI sert au toast / push éventuel — pas de champ
 * rules-acceptable).
 *
 * Throws si `permission-denied` (assignation d'un autre membre, ou membre
 * suspendu) ou erreur Firebase. Mode mock : log-only.
 */
export async function respondToBookingAssignment(
  input: RespondToBookingAssignmentInput,
): Promise<void> {
  if (!input.bookingId) throw new Error('respondToBookingAssignment: bookingId required')
  if (!input.assignmentId) throw new Error('respondToBookingAssignment: assignmentId required')

  const firestore = getFirestoreOrNull()
  if (!firestore) {
    logMockAction('officials.respondToBookingAssignment', { ...input })
    return
  }

  try {
    await updateDoc(
      doc(firestore, BOOKINGS, input.bookingId, OFFICIAL_ASSIGNMENTS, input.assignmentId),
      {
        status: input.status,
        respondedAt: serverTimestamp(),
      },
    )
  } catch (err) {
    if (isPermissionDenied(err)) {
      console.error('[officials.repo] respondToBookingAssignment permission-denied', err)
      throw new Error(
        "Réponse refusée. Vous ne pouvez modifier que votre propre assignation.",
      )
    }
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[officials.repo] respondToBookingAssignment failed [${code}]`, err)
    throw new Error(`Erreur lors de la mise à jour (${code}).`)
  }
}

/** Symétrique pour AWAY. */
export async function respondToMatchAssignment(
  input: RespondToMatchAssignmentInput,
): Promise<void> {
  if (!input.matchId) throw new Error('respondToMatchAssignment: matchId required')
  if (!input.assignmentId) throw new Error('respondToMatchAssignment: assignmentId required')

  const firestore = getFirestoreOrNull()
  if (!firestore) {
    logMockAction('officials.respondToMatchAssignment', { ...input })
    return
  }

  try {
    await updateDoc(
      doc(firestore, MATCHES, input.matchId, OFFICIAL_ASSIGNMENTS, input.assignmentId),
      {
        status: input.status,
        respondedAt: serverTimestamp(),
      },
    )
  } catch (err) {
    if (isPermissionDenied(err)) {
      console.error('[officials.repo] respondToMatchAssignment permission-denied', err)
      throw new Error(
        "Réponse refusée. Vous ne pouvez modifier que votre propre assignation.",
      )
    }
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[officials.repo] respondToMatchAssignment failed [${code}]`, err)
    throw new Error(`Erreur lors de la mise à jour (${code}).`)
  }
}
