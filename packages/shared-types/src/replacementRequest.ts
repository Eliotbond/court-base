/**
 * `/replacementRequests/{requestId}` — demande de remplacement d'officiel.
 *
 * Un officiel `confirmed` sur une assignation (HOME : `bookings/{}/officialAssignments` ;
 * AWAY : `matches/{}/officialAssignments`) peut demander à un autre officiel
 * de prendre sa place. Le doc capture la **conversation** entre demandeur et
 * cible :
 *   - création par le demandeur (`status: 'pending'`) ;
 *   - **accept** par la cible → callable serveur `acceptReplacement` qui
 *     transfère atomiquement l'assignation (decline l'ancienne, crée la
 *     nouvelle, marque la demande `accepted`) ;
 *   - **decline** par la cible → write client direct (rules `update`
 *     restreint au `targetMemberId`) ;
 *   - **cancel** par le demandeur → write client direct (rules `update`
 *     restreint au `requesterMemberId`).
 *
 * Les métadonnées match sont **dénormalisées** (`matchDateMs`, `matchStartTime`,
 * `matchTypeName`, etc.) pour permettre une LIST query `targetMemberId == me`
 * en inbox sans N+1 (pas besoin de re-lire chaque parent booking/match).
 *
 * Cf. `firestore.rules` (section `/replacementRequests`) et
 * `functions/src/officials/replacement.ts` (callable `acceptReplacement`).
 */
import type { Timestamp } from './index'

export type ReplacementRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled'

export type ReplacementParentKind = 'home' | 'away'

export interface ReplacementRequestData {
  // ─── Parent (le match concerné) ───────────────────────────────────
  /** `'home'` → parentId = bookingId. `'away'` → parentId = matchId. */
  parentKind: ReplacementParentKind
  /** bookingId (HOME) ou matchId (AWAY). */
  parentId: string
  /** ID du doc d'assignation à transférer (sub-collection `officialAssignments`). */
  originalAssignmentId: string

  // ─── Membres impliqués ────────────────────────────────────────────
  requesterMemberId: string
  requesterDisplayName: string
  targetMemberId: string
  targetDisplayName: string

  // ─── Métadonnées match (dénormalisées pour la liste inbox sans N+1) ─
  /** epoch ms du début local du match. */
  matchDateMs: number
  /** "HH:mm" — heure de début. */
  matchStartTime: string
  /** "HH:mm" — heure de fin. */
  matchEndTime: string
  /** Libellé du type de match (snapshot — robuste si le matchType est renommé). */
  matchTypeName: string
  /** Adversaire si connu. `null` si non-renseigné (match HOME pending). */
  matchOpponentName: string | null
  /**
   * Libellé du lieu du match :
   *  - HOME : `"Venue · Court"` (dénormalisé depuis le booking).
   *  - AWAY : adresse libre (`awayAddress` du match).
   *  - `null` si lieu inconnu (HOME sans salle attribuée).
   */
  matchVenueLabel: string | null

  // ─── Niveau requis ─────────────────────────────────────────────────
  /** Niveau de l'assignation d'origine (snapshot). Permet à la cible de
   *  filtrer ses inbox sur les niveaux qu'elle peut couvrir. */
  officialLevel: number

  // ─── Message optionnel du demandeur ───────────────────────────────
  /** Message libre du demandeur (raison, urgence…). `null` si non fourni. */
  message: string | null

  // ─── Lifecycle ─────────────────────────────────────────────────────
  status: ReplacementRequestStatus
  createdAt: Timestamp
  /** Posé via `serverTimestamp()` lors de accept/decline/cancel. */
  respondedAt: Timestamp | null
  /** Motif de refus (cible). `null` si pas refusé. */
  declineReason: string | null
}

export type ReplacementRequest = ReplacementRequestData & { id: string }
