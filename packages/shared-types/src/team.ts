import type { Timestamp } from './index'
import type { TeamTagRef } from './tag'

/**
 * Document `/teams/{teamId}` — équipe du club.
 * Voir docs/firebase.md (section /teams/{teamId}).
 *
 * Les teams persistent cross-saisons via `activeSeasonIds[]`. La cotisation
 * de l'équipe est référencée via `cotisationId` (cf. /cotisations).
 *
 * Note: pour l'instant seuls les champs nécessaires au Dashboard sont
 * exposés strictement (`id`, `name`, `categoryId`). Les autres seront ajoutés
 * au fil du dev des écrans Teams / Season planning assistant.
 *
 * `categoryId` est une référence vers `/categories/{categoryId}` (référentiel
 * éditable par l'admin). Le libellé et la tranche d'âge sont résolus à la
 * lecture côté repo — pas de dénormalisation.
 */
export type TeamGender = 'M' | 'F' | 'mixed'

export type TeamRegistrationStatus = 'open' | 'conditional' | 'closed'

export interface TeamSchedulingPreferredDay {
  dayOfWeek: number
  priority: number
}

export interface TeamCoachAvailability {
  coachMemberId: string
  unavailableDays: number[]
  unavailableSlots: string[]
}

export interface TeamSchedulingConstraints {
  preferredDays: TeamSchedulingPreferredDay[]
  /** "HH:MM" */
  maxStartTime: string
  minHoursBetweenSlots: number
  trainingsPerWeek: number
  anticipatedMatches: number
  coachAvailability: TeamCoachAvailability[]
}

/**
 * Lien entre une équipe court-base et une compétition Basketplan (Swiss
 * Basketball / ORCA Systems). Une même équipe peut être inscrite dans
 * **plusieurs** compétitions (championnat + coupe, ou plusieurs fédérations
 * en parallèle) — d'où le tableau `basketplanLinks[]` ci-dessous.
 *
 * Voir `docs/basketplan-integration.md` § 4.1 pour la spec complète et
 * `docs/chantier-basketplan.md` (PR 1) pour le plan d'exécution. Le lien
 * porte des **caches** d'affichage (`federationCode`, `leagueHoldingName`,
 * `season`, `teamNameInLeague`) résolus côté serveur au moment du linkage,
 * pour éviter un re-fetch Basketplan à chaque rendu de la liste.
 *
 * Identifiants externes :
 *  - `federationId` : id numérique de la fédération Basketplan (ex. 9 = AFBB).
 *  - `leagueHoldingId` : id de la compétition (championnat / coupe) saison-précis.
 *  - `teamIdInLeague` : id Basketplan de l'équipe DANS cette compétition
 *    (différent d'une compétition à l'autre, même pour la "même" équipe club).
 *
 * Cycle de vie :
 *  - Créé par les callables `linkTeamToBasketplan` (résout les caches + pose
 *    `id` uuid, `addedAt`, `addedBy`).
 *  - Toggleable via `toggleTeamBasketplanLink` (`active: false` = pause sans
 *    perte). Retiré via `unlinkTeamBasketplan`.
 *  - Les `leagueHoldingId` changent à chaque saison Basketplan : à la fin
 *    d'une saison, prévoir un mécanisme de "renouveler les liens" (cf.
 *    brief § 7.2).
 */
export interface BasketplanCompetitionLink {
  /** UUID local, généré côté Cloud Function via `crypto.randomUUID()`. */
  id: string
  /** Id numérique de la fédération Basketplan (ex. 9 = AFBB). */
  federationId: number
  /** Code court de la fédération (cache pour affichage rapide, ex. "AFBB"). */
  federationCode: string
  /** Id Basketplan de la compétition (championnat ou coupe) — saison-précis. */
  leagueHoldingId: number
  /** Nom complet de la compétition (cache pour affichage). */
  leagueHoldingName: string
  /** Saison extraite du nom (ex. "25/26"). Cache pour groupement UI. */
  season: string
  /** Id Basketplan de l'équipe **dans cette ligue** (≠ id "team club" global). */
  teamIdInLeague: number
  /** Nom de l'équipe tel qu'inscrit dans cette ligue (cache, ex. "Marly Basket 2LM"). */
  teamNameInLeague: string
  /** Pause sans suppression — sync ignore les liens inactifs. */
  active: boolean
  addedAt: Timestamp
  /** uid du caller (admin ou coach) au moment du linkage. */
  addedBy: string
}

export interface TeamData {
  /** Ex. "U20F" */
  name: string
  /** Référence vers `/categories/{categoryId}`. */
  categoryId: string
  gender: TeamGender
  /** memberIds des coachs (cumulable avec /users.teamIds côté coach scope). */
  coachIds: string[]
  /** memberIds des joueurs. */
  playerIds: string[]
  activeSeasonIds: string[]
  /**
   * Référence vers `/cotisations/{id}` — montant et description résolus à la
   * lecture (pas dénormalisé). Cf. docs/main.md → 'Cotisations'.
   */
  cotisationId: string
  schedulingConstraints: TeamSchedulingConstraints
  /**
   * Tags attachés à l'équipe (référence + flag d'affichage par-équipe).
   * Cf. /tags référentiel et docs/main.md ("Tags d'équipes").
   */
  tags: TeamTagRef[]
  /**
   * Statut d'ouverture aux nouvelles inscriptions (saison courante).
   * Affiché publiquement dans l'app register (TeamPicker §4.5 du brief).
   */
  registrationStatus: TeamRegistrationStatus
  /**
   * Manuel d'inscription affiché en branche "équipe ouverte" (markdown court).
   * Écrit par le coach ou l'admin depuis l'app web.
   */
  openHandbook: string
  /**
   * Description des conditions affichée en branche "équipe sous conditions"
   * (markdown court).
   */
  conditionalDescription: string
  /**
   * Liste de critères tagués pour les équipes sous conditions (chips d'affichage).
   */
  conditionalCriteria: string[]
  /**
   * Accroche courte affichée sur la fiche publique de l'équipe (app register).
   * `null` = pas d'accroche, on affiche le nom de l'équipe seul.
   */
  publicTagline: string | null
  /**
   * memberId du coach affiché comme "head coach" sur la fiche publique
   * (quand `coachIds` en contient plusieurs). `null` = premier de la liste utilisé.
   */
  publicHeadCoachMemberId: string | null
  active: boolean
  createdAt: Timestamp
  /**
   * Liens Basketplan (1→N) — voir `BasketplanCompetitionLink` au-dessus et
   * `docs/basketplan-integration.md` § 4.1. `undefined` ou `[]` = équipe
   * jamais liée. Toutes les mutations passent par les callables
   * `linkTeamToBasketplan` / `unlinkTeamBasketplan` / `toggleTeamBasketplanLink`
   * (Admin SDK — `/teams` reste write admin-only côté rules).
   */
  basketplanLinks?: BasketplanCompetitionLink[]
}

export type Team = TeamData & { id: string }
