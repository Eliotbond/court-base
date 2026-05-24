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

/**
 * Source externe d'un match (intégration fédérale). `'basketplan'` est la
 * seule valeur supportée pour l'instant — extensible si un autre back-office
 * fédéral apparaît. `null` ou `undefined` = match purement court-base
 * (créé manuellement par admin/coach, sans contre-partie fédérale).
 */
export type MatchExternalSource = 'basketplan'

/**
 * Score officiel d'un match Basketplan — homologué ou en attente.
 *
 * `byQuarter` peut être absent quand le résultat est encore en saisie
 * partielle côté Basketplan (ex. uniquement le score final renseigné).
 * Côté UI, l'affichage "tableau par quart-temps" est conditionné à la
 * présence d'au moins un quart-temps avec un score non-zéro.
 */
export interface MatchExternalResult {
  homeScore: number
  awayScore: number
  /** `true` quand le match est validé par la fédération (status `homologué`). */
  homologated: boolean
  /** Détail par quart-temps (4 quarts standard) — `undefined` si pas dispo. */
  byQuarter?: Array<{ home: number; away: number }>
}

/**
 * Arbitres fédéraux désignés pour un match Basketplan — chaque slot est
 * `null` quand pas encore désigné (ou pas applicable, ex. pas d'expert
 * sur les ligues régionales).
 */
export interface MatchExternalReferees {
  referee1?: string | null
  referee2?: string | null
  expert?: string | null
}

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

  // -------------------------------------------------------------------------
  // Champs "externes" (intégration Basketplan — PR 2 du chantier intégration).
  // Tous optionnels (`?`) : les matchs manuels (créés via UI admin/coach) ne
  // les portent pas. Posés / mis à jour par le sync nocturne
  // (`scheduledBasketplanSync`) et la callable `syncBasketplanForTeam`.
  // Voir `docs/basketplan-integration.md` § 4.2 pour la spec complète.
  // -------------------------------------------------------------------------

  /** Source fédérale du match. `null`/absent = match court-base pur. */
  externalSource?: MatchExternalSource | null
  /**
   * Numéro de match Basketplan (ex. `"25-08231"`) — **clé d'idempotence** du
   * sync (unique global, persistant cross-saisons). Pose un single-field
   * index Firestore auto pour la query `where('externalGameNumber', '==',
   * X) limit 1` utilisée par `applyGame`.
   */
  externalGameNumber?: string | null
  /** Id Basketplan de la compétition (cf. `BasketplanCompetitionLink.leagueHoldingId`). */
  externalLeagueHoldingId?: number | null
  /** Arbitres fédéraux — `null` global quand le match n'a pas encore d'arbitres désignés. */
  externalReferees?: MatchExternalReferees | null
  /** Score officiel — `null` tant que le match n'est pas joué ou non saisi côté Basketplan. */
  externalResult?: MatchExternalResult | null
  /** Dernier sync réussi qui a touché ce doc (idempotence + diagnostic). */
  externalLastSyncedAt?: Timestamp | null
}

export type Match = MatchData & { id: string }
