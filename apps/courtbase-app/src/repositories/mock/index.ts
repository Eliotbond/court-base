/**
 * Façade des repositories mock. **Source unique** de données simulées pour
 * toutes les vues `courtbase-app` tant que le backend n'est pas branché.
 *
 * Convention d'usage côté vues :
 * ```ts
 * import { listTeamsForCoach, getMember } from '@/repositories/mock'
 * ```
 *
 * Toutes les fonctions sont **synchrones** (pas de promesses) pour
 * simplifier les vues mock. Quand on branchera Firebase, elles seront
 * réécrites en `async` et retourneront via `getDocs()` — les vues
 * passeront en `await` à ce moment-là.
 *
 * **Aucune mutation** n'est conservée : un `markPaid` mock log dans la
 * console mais ne modifie pas la mémoire. C'est volontaire — on évite que
 * deux vues qui partagent un même mock se contredisent.
 */

import {
  MOCK_ASSIGNMENTS,
  MOCK_CLUB,
  MOCK_DUES,
  MOCK_MATCHES,
  MOCK_MEMBERS,
  MOCK_NOTIFICATIONS,
  MOCK_REGISTRATIONS,
  MOCK_REQUESTS,
  MOCK_SESSION,
  MOCK_TEAMS,
} from './seeds'
import type {
  MockAssignment,
  MockDue,
  MockMatch,
  MockMember,
  MockNotification,
  MockRegistration,
  MockRequest,
  MockSession,
  MockTeam,
} from '@/types/mock'

// ───────────────────────────────────────────────────────────────
// Session + club
// ───────────────────────────────────────────────────────────────

export function getSession(): MockSession {
  return MOCK_SESSION
}

export function getClub(): typeof MOCK_CLUB {
  return MOCK_CLUB
}

// ───────────────────────────────────────────────────────────────
// Teams
// ───────────────────────────────────────────────────────────────

export function listTeams(): MockTeam[] {
  return MOCK_TEAMS
}

export function listTeamsForCoach(coachUid: string): MockTeam[] {
  return MOCK_TEAMS.filter((t) => t.coachIds.includes(coachUid))
}

export function getTeam(id: string): MockTeam | null {
  return MOCK_TEAMS.find((t) => t.id === id) ?? null
}

// ───────────────────────────────────────────────────────────────
// Members
// ───────────────────────────────────────────────────────────────

export function listMembersByTeam(teamId: string): MockMember[] {
  return MOCK_MEMBERS.filter((m) => m.teamIds.includes(teamId))
}

export function getMember(id: string): MockMember | null {
  return MOCK_MEMBERS.find((m) => m.id === id) ?? null
}

// ───────────────────────────────────────────────────────────────
// Matches + Assignments
// ───────────────────────────────────────────────────────────────

export function listMatches(): MockMatch[] {
  return [...MOCK_MATCHES].sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Matches needing officials (staffing incomplet). Optionnellement filtré au
 * niveau d'officiel du caller (`officialLevel`).
 */
export function listOpenMatches(forOfficialLevel?: number | null): MockMatch[] {
  return listMatches().filter((m) => {
    const filled = MOCK_ASSIGNMENTS.filter((a) => a.matchId === m.id).length
    if (filled >= m.requiredOfficialsTotal) return false
    if (forOfficialLevel == null) return true
    // L'officiel ne voit que les matches où **son niveau** est requis et non
    // déjà couvert.
    const requiredAtLevel = m.requiredByLevel[forOfficialLevel] ?? 0
    const filledAtLevel = MOCK_ASSIGNMENTS.filter(
      (a) => a.matchId === m.id && a.requiredLevel === forOfficialLevel,
    ).length
    return filledAtLevel < requiredAtLevel
  })
}

export function getMatch(id: string): MockMatch | null {
  return MOCK_MATCHES.find((m) => m.id === id) ?? null
}

export function listAssignmentsForMatch(matchId: string): MockAssignment[] {
  return MOCK_ASSIGNMENTS.filter((a) => a.matchId === matchId)
}

export function listMyAssignments(memberId: string): MockAssignment[] {
  return MOCK_ASSIGNMENTS.filter((a) => a.memberId === memberId)
}

// ───────────────────────────────────────────────────────────────
// Registrations
// ───────────────────────────────────────────────────────────────

export function listRegistrations(filter?: { status?: MockRegistration['status'][] }): MockRegistration[] {
  if (!filter?.status?.length) return [...MOCK_REGISTRATIONS]
  return MOCK_REGISTRATIONS.filter((r) => filter.status!.includes(r.status))
}

/** Registrations à traiter par le coach (status pré-décision). */
export function listRegistrationsToTreat(): MockRegistration[] {
  return listRegistrations({
    status: ['submitted', 'open_pending_trial', 'conditional_pending_review', 'trial_in_progress'],
  })
}

export function getRegistration(id: string): MockRegistration | null {
  return MOCK_REGISTRATIONS.find((r) => r.id === id) ?? null
}

// ───────────────────────────────────────────────────────────────
// Notifications
// ───────────────────────────────────────────────────────────────

export function listNotifications(): MockNotification[] {
  return [...MOCK_NOTIFICATIONS]
}

export function countUnread(): number {
  return MOCK_NOTIFICATIONS.filter((n) => n.unread).length
}

// ───────────────────────────────────────────────────────────────
// Requests
// ───────────────────────────────────────────────────────────────

export function listRequests(filter?: { kind?: MockRequest['kind']; status?: MockRequest['status'] }): MockRequest[] {
  let out = [...MOCK_REQUESTS]
  if (filter?.kind) out = out.filter((r) => r.kind === filter.kind)
  if (filter?.status) out = out.filter((r) => r.status === filter.status)
  return out
}

export function getRequest(id: string): MockRequest | null {
  return MOCK_REQUESTS.find((r) => r.id === id) ?? null
}

// ───────────────────────────────────────────────────────────────
// Dues
// ───────────────────────────────────────────────────────────────

export function getDueForMember(memberId: string): MockDue | null {
  return MOCK_DUES.find((d) => d.memberId === memberId) ?? null
}

// ───────────────────────────────────────────────────────────────
// Mutations mock — logguent uniquement, ne modifient pas le store.
// Les vues affichent un toast "Action simulée" et restent dans l'état.
// ───────────────────────────────────────────────────────────────

export function logMockAction(action: string, payload?: Record<string, unknown>): void {
  console.info(`[MOCK] ${action}`, payload ?? '')
}

// Re-exports de types pour faciliter les imports côté vues.
export type {
  MockAssignment,
  MockDue,
  MockMatch,
  MockMember,
  MockNotification,
  MockRegistration,
  MockRequest,
  MockSession,
  MockTeam,
} from '@/types/mock'

// ───────────────────────────────────────────────────────────────
// License requests (workflow étendu — fixtures partagées)
// ───────────────────────────────────────────────────────────────

export {
  listLicenseRequests,
  listLicenseRequestsForMember,
  getLicenseRequestById,
  inferRequiredDocs,
} from './licenseRequests'
