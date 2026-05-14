import type { Timestamp } from './index'

/**
 * Document `/matches/{matchId}` — entité produit "match" (équipe locale, type,
 * adversaire, date, statut). Voir docs/firebase.md (section /matches).
 *
 * Modèle bidirectionnel :
 *  - Match HOME : `bookingId` pointe sur un `/bookings/{bookingId}` avec
 *    `slotType: 'match_home'` ; ce booking porte en retour
 *    `booking.matchId === match.id` (cf. `BookingData.matchId`). Atomicité
 *    gérée via `writeBatch` côté repo (`createHomeMatch` / `deleteMatch`).
 *  - Match AWAY : pas de booking associé (`bookingId: null`) — le match
 *    est la source de vérité pour `date` / `startTime` / `endTime` /
 *    `awayAddress`. L'admin saisit ces champs directement sur le match.
 *
 * Les anciens bookings `match_away` (avec `venueId/courtId = ''`) créés avant
 * cette refonte restent en place mais ne sont plus créés via le flow matches.
 */
export type MatchKind = 'home' | 'away'
export type MatchStatus = 'scheduled' | 'cancelled' | 'played'

export interface MatchData {
  /** Référence au booking qui contient le créneau (court/horaires). null pour away. */
  bookingId: string | null
  kind: MatchKind
  /** Notre équipe locale. */
  teamId: string
  matchTypeId: string
  /** Nom équipe adverse. Optionnel pour HOME (peut être inconnu à la création), obligatoire pour AWAY. */
  opponentName: string | null
  /** Adresse extérieure — uniquement pour kind === 'away'. */
  awayAddress: string | null
  /**
   * Date du match (00:00 local). Pour HOME : dénormalisée depuis le booking
   * référencé (pour permettre les queries `where('date', '>=', ...)` sans
   * join). Pour AWAY : source de vérité (pas de booking).
   */
  date: Timestamp
  /** "HH:MM". Dénormalisé pour HOME, source pour AWAY. */
  startTime: string
  endTime: string
  status: MatchStatus
  notes: string | null
  createdAt: Timestamp
  /** uid de l'admin qui a créé le match. */
  createdBy: string
}

export type Match = MatchData & { id: string }
