import { FirebaseError } from 'firebase/app'
import { collection, getDocs } from 'firebase/firestore'
import type {
  MatchType,
  MatchTypeData,
  OfficialAssignment,
  OfficialRequirement,
  Team,
  Timestamp,
} from '@club-app/shared-types'
import { db } from '@/services/firebase'
import { listAllMatches } from '@/repositories/matches.repo'
import {
  listAssignments,
  type AssignmentParent,
} from '@/repositories/officialAssignments.repo'

/**
 * Repository OfficialStaffing — agrège le staffing des matchs (À DOMICILE et
 * À L'EXTÉRIEUR) pour l'écran Officials admin.
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase (cf.
 * apps/web/CLAUDE.md — architecture en couches). Consommée par
 * `stores/officialStaffing.ts`.
 *
 * ## Modèle
 *
 * - Un match HOME (`/matches` avec `kind === 'home'`) référence un booking via
 *   `bookingId`. Ses `officialAssignments` vivent sur ce booking
 *   (`/bookings/{bookingId}/officialAssignments`). Le besoin d'officiels vient
 *   du `matchType` (`homeOfficialRequirements`, ventilé par niveau).
 * - Un match AWAY (`kind === 'away'`) n'a pas de booking. Ses
 *   `officialAssignments` vivent directement sur le match
 *   (`/matches/{matchId}/officialAssignments`). Le besoin vient du `matchType`
 *   (`awayOfficialCount`, un total simple sans ventilation par niveau).
 *
 * On compose une `MatchStaffingRow` par match : besoin requis vs. confirmés /
 * en attente / refusés, plus un `staffingStatus` dérivé.
 *
 * ## Stratégie de lecture (pas de N+1, pas d'index composite)
 *
 *  1. `listAllMatches()` (réutilisé depuis `matches.repo.ts`) — déjà enrichi
 *     teamName / matchTypeName / matchTypeColor.
 *  2. Scan unique de `/matchTypes` pour récupérer `homeOfficialRequirements`
 *     et `awayOfficialCount` (non exposés par `MatchRow`).
 *  3. Pour chaque match, `listAssignments` sur son parent (booking pour HOME,
 *     match pour AWAY) — requête sous-collection directe, aucun index requis.
 *     Les appels sont parallélisés via `Promise.all`.
 *
 * ## Dégradation gracieuse
 *
 * Sur `permission-denied` (caller sans rôle adéquat) → `[]`. Toute autre
 * erreur SDK est relancée pour remonter à l'UI.
 */

const MATCH_TYPES = 'matchTypes'
const TEAMS = 'teams'

// ---------------------------------------------------------------------------
// Types exposés
// ---------------------------------------------------------------------------

/** État de staffing d'un match — drive la couleur du Pill côté UI. */
export type MatchStaffingStatus = 'unstaffed' | 'partial' | 'full'

/**
 * Ligne de staffing d'un match (HOME ou AWAY). Agrège le match, son type,
 * l'équipe et l'état des `officialAssignments` de son parent.
 */
export interface MatchStaffingRow {
  matchId: string
  /** `kind === 'away'` : match à l'extérieur (pas de booking). */
  kind: 'home' | 'away'
  /** id du booking pour un match HOME ; `null` pour un match AWAY. */
  bookingId: string | null
  /** Adresse du gymnase extérieur — uniquement renseignée si `kind='away'`. */
  awayAddress: string | null
  teamId: string
  teamName: string | null
  matchTypeId: string
  matchTypeName: string | null
  matchTypeColor: string | null
  opponentName: string | null
  date: Date | null
  startTime: string
  endTime: string
  matchStatus: 'scheduled' | 'cancelled' | 'played'
  /**
   * Besoin d'officiels ventilé par niveau (snapshot du matchType). Renseigné
   * pour les matchs HOME ; vide pour les matchs AWAY (le besoin away est un
   * total simple sans niveau — voir `requiredTotal`).
   */
  requirements: OfficialRequirement[]
  /** Assignations existantes sur le parent (booking pour HOME, match pour AWAY). */
  assignments: OfficialAssignment[]
  /** HOME : Σ `requirement.count`. AWAY : `matchType.awayOfficialCount`. */
  requiredTotal: number
  confirmedTotal: number
  pendingTotal: number
  declinedTotal: number
  staffingStatus: MatchStaffingStatus
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convertit un `Timestamp` (forme neutre `{ seconds, nanoseconds }` exposée
 * par `@club-app/shared-types`) en `Date`. `MatchRow.date` est typé avec
 * cette forme neutre — on lit `seconds` directement. Couvre aussi le cas
 * d'un `Timestamp` SDK Firestore (qui expose `.toDate()`) par robustesse.
 */
function tsToDate(ts: Timestamp | undefined | null): Date | null {
  if (!ts) return null
  const maybeToDate = (ts as { toDate?: () => Date }).toDate
  if (typeof maybeToDate === 'function') return maybeToDate.call(ts)
  const seconds = (ts as { seconds?: number }).seconds
  return typeof seconds === 'number' ? new Date(seconds * 1000) : null
}

/** Besoins d'officiels d'un matchType : ventilation HOME + total AWAY. */
interface MatchTypeNeeds {
  /** `homeOfficialRequirements` — besoin HOME ventilé par niveau. */
  home: OfficialRequirement[]
  /** `awayOfficialCount` — besoin AWAY (total simple). */
  away: number
}

/** Scan `/matchTypes` une fois → map matchTypeId → besoins (HOME + AWAY). */
async function loadNeedsByMatchType(): Promise<Map<string, MatchTypeNeeds>> {
  const map = new Map<string, MatchTypeNeeds>()
  try {
    const snap = await getDocs(collection(db, MATCH_TYPES))
    for (const d of snap.docs) {
      const data = d.data() as MatchTypeData
      map.set(d.id, {
        home: data.homeOfficialRequirements ?? [],
        away: data.awayOfficialCount ?? 0,
      })
    }
  } catch (err: unknown) {
    if (err instanceof FirebaseError && err.code === 'permission-denied') {
      return map
    }
    throw err
  }
  return map
}

/** Scan `/teams` une fois → map teamId → name. */
async function loadTeamNames(): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  try {
    const snap = await getDocs(collection(db, TEAMS))
    for (const d of snap.docs) {
      const data = d.data() as Team
      map.set(d.id, data.name ?? d.id)
    }
  } catch (err: unknown) {
    if (err instanceof FirebaseError && err.code === 'permission-denied') {
      return map
    }
    throw err
  }
  return map
}

/** Dérive le `staffingStatus` selon les compteurs (cf. contrat agent). */
function computeStaffingStatus(
  requiredTotal: number,
  confirmedTotal: number,
  pendingTotal: number,
): MatchStaffingStatus {
  // Aucun officiel requis (ex. matchType amical à l'extérieur) → rien à
  // staffer, on considère le match complet plutôt que de l'afficher en rouge.
  if (requiredTotal === 0) return 'full'
  if (confirmedTotal >= requiredTotal) return 'full'
  if (confirmedTotal === 0 && pendingTotal === 0) return 'unstaffed'
  return 'partial'
}

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

/**
 * Liste le staffing de TOUS les matchs : à domicile (`kind='home'`, via leur
 * booking) et à l'extérieur (`kind='away'`, via le doc match lui-même). Les
 * matchs HOME sans `bookingId` — théoriquement aucun — sont ignorés (on ne
 * peut pas porter d'assignations sans parent).
 *
 * Tri : matchs à venir d'abord (date asc parmi les futurs — le plus proche
 * en premier), puis matchs passés (date desc — le plus récent en premier).
 * Les matchs sans date connue sont rangés en fin.
 *
 * Dégradation gracieuse sur `permission-denied` → `[]`.
 */
export async function listMatchStaffing(): Promise<MatchStaffingRow[]> {
  // 1) Matchs (déjà enrichis teamName/matchType) + besoins + noms d'équipes.
  let matches: Awaited<ReturnType<typeof listAllMatches>>
  let needsByType: Map<string, MatchTypeNeeds>
  let teamNames: Map<string, string>
  try {
    ;[matches, needsByType, teamNames] = await Promise.all([
      listAllMatches(),
      loadNeedsByMatchType(),
      loadTeamNames(),
    ])
  } catch (err: unknown) {
    if (err instanceof FirebaseError && err.code === 'permission-denied') {
      return []
    }
    throw err
  }

  // 2) Déterminer le parent d'assignation de chaque match :
  //    HOME → son booking ; AWAY → le match lui-même. Les matchs HOME sans
  //    booking sont écartés (impossible de porter des assignations).
  const staffables = matches
    .map((m) => {
      const parent: AssignmentParent | null =
        m.kind === 'home'
          ? m.bookingId
            ? { kind: 'booking', id: m.bookingId }
            : null
          : { kind: 'match', id: m.id }
      return parent ? { match: m, parent } : null
    })
    .filter((s): s is { match: (typeof matches)[number]; parent: AssignmentParent } => s !== null)
  if (staffables.length === 0) return []

  // 3) Charger les assignations de chaque parent en parallèle.
  let assignmentsLists: OfficialAssignment[][]
  try {
    assignmentsLists = await Promise.all(
      staffables.map((s) => listAssignments(s.parent)),
    )
  } catch (err: unknown) {
    if (err instanceof FirebaseError && err.code === 'permission-denied') {
      return []
    }
    throw err
  }

  // 4) Composer les rows.
  const rows: MatchStaffingRow[] = staffables.map(({ match: m }, i) => {
    const assignments = assignmentsLists[i] ?? []
    const needs = needsByType.get(m.matchTypeId) ?? { home: [], away: 0 }
    const isHome = m.kind === 'home'
    // HOME : besoin ventilé par niveau. AWAY : total simple, pas de niveau.
    const requirements = isHome ? needs.home : []
    const requiredTotal = isHome
      ? requirements.reduce((sum, r) => sum + r.count, 0)
      : needs.away

    let confirmedTotal = 0
    let pendingTotal = 0
    let declinedTotal = 0
    for (const a of assignments) {
      if (a.status === 'confirmed') confirmedTotal += 1
      else if (a.status === 'pending') pendingTotal += 1
      else if (a.status === 'declined') declinedTotal += 1
    }

    return {
      matchId: m.id,
      kind: m.kind,
      bookingId: m.bookingId,
      awayAddress: m.awayAddress,
      teamId: m.teamId,
      // `m.teamName` vient déjà de listAllMatches ; fallback sur le scan
      // local au cas où (cohérence défensive).
      teamName: m.teamName ?? teamNames.get(m.teamId) ?? null,
      matchTypeId: m.matchTypeId,
      matchTypeName: m.matchTypeName,
      matchTypeColor: m.matchTypeColor,
      opponentName: m.opponentName,
      date: tsToDate(m.date),
      startTime: m.startTime,
      endTime: m.endTime,
      matchStatus: m.status,
      requirements,
      assignments,
      requiredTotal,
      confirmedTotal,
      pendingTotal,
      declinedTotal,
      staffingStatus: computeStaffingStatus(
        requiredTotal,
        confirmedTotal,
        pendingTotal,
      ),
    }
  })

  // 5) Tri : futurs d'abord (date asc), puis passés (date desc). Les rows
  //    sans date partent en fin.
  const now = Date.now()
  rows.sort((a, b) => {
    const aTime = a.date?.getTime() ?? null
    const bTime = b.date?.getTime() ?? null
    if (aTime === null && bTime === null) return 0
    if (aTime === null) return 1
    if (bTime === null) return -1

    const aFuture = aTime >= now
    const bFuture = bTime >= now
    if (aFuture && bFuture) return aTime - bTime // futurs : plus proche d'abord
    if (!aFuture && !bFuture) return bTime - aTime // passés : plus récent d'abord
    return aFuture ? -1 : 1 // futur avant passé
  })

  return rows
}

// ---------------------------------------------------------------------------
// Re-exports types — pour que les consumers n'importent que ce module.
// ---------------------------------------------------------------------------

export type { OfficialAssignment, OfficialRequirement } from '@club-app/shared-types'
export type { MatchType }
