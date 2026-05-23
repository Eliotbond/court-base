/**
 * Fixtures mock partagées entre `apps/courtbase-app` (coach) et
 * `apps/courtbase-register` (parent). **IDs figés** pour que les liens
 * cliquables du faux email coach pointent vers les bons écrans parent.
 *
 * À NE PAS muter : les mutations runtime (création, upload, submit) doivent
 * passer par les stores des apps (sessionStorage côté parent, log-only côté
 * coach) — conformément à la convention mock du repo.
 *
 * À promouvoir vers `/licenseRequests` réel quand la Phase backend land
 * (voir `license-extended.ts` pour la note de promotion).
 */

import type { LicenseRequestMock } from '../license-extended'

const DAY_MS = 86_400_000
const NOW = Date.now()

const COACH_UID = 'user-mathieu'
const TEAM_ID = 'team-u16m-comp'
const TEAM_NAME = 'U16M Compétition'
const COACH_NAME = 'Mathieu Brun'

export const MOCK_LICENSE_REQUESTS: readonly LicenseRequestMock[] = [
  {
    id: 'lr-leo-2025',
    memberId: 'm-leo',
    teamId: TEAM_ID,
    requestedBy: COACH_UID,
    status: 'pending_parent_docs',
    requiredDocs: ['id_front', 'id_back'],
    uploadedDocs: {},
    parentNotes: null,
    parentCompletedAt: null,
    createdAt: NOW - 3 * DAY_MS,
    denorm: {
      memberFirstName: 'Léo',
      memberLastName: 'Martin',
      teamName: TEAM_NAME,
      coachName: COACH_NAME,
    },
  },
  {
    id: 'lr-julian-2025',
    memberId: 'm-julian',
    teamId: TEAM_ID,
    requestedBy: COACH_UID,
    status: 'pending_parent_docs',
    requiredDocs: ['id_front', 'id_back', 'transfer_letter_swiss'],
    uploadedDocs: {},
    parentNotes: null,
    parentCompletedAt: null,
    createdAt: NOW - 4 * DAY_MS,
    denorm: {
      memberFirstName: 'Julian',
      memberLastName: 'Käser',
      teamName: TEAM_NAME,
      coachName: COACH_NAME,
    },
  },
  {
    id: 'lr-emma-2025',
    memberId: 'm-emma',
    teamId: TEAM_ID,
    requestedBy: COACH_UID,
    status: 'pending_parent_docs',
    requiredDocs: ['id_front', 'id_back'],
    uploadedDocs: {},
    foreignPlayerContext: {
      previousCountry: 'FR',
      hadCompetition: null,
      isMinor: false,
      level: 'regional',
    },
    parentNotes: null,
    parentCompletedAt: null,
    createdAt: NOW - 5 * DAY_MS,
    denorm: {
      memberFirstName: 'Emma',
      memberLastName: 'Roy',
      teamName: TEAM_NAME,
      coachName: COACH_NAME,
    },
  },
  {
    id: 'lr-noah-2025',
    memberId: 'm-noah',
    teamId: TEAM_ID,
    requestedBy: COACH_UID,
    status: 'pending_parent_docs',
    requiredDocs: ['id_front', 'id_back'],
    uploadedDocs: {},
    foreignPlayerContext: {
      previousCountry: 'ES',
      hadCompetition: null,
      isMinor: true,
    },
    parentNotes: null,
    parentCompletedAt: null,
    createdAt: NOW - 6 * DAY_MS,
    denorm: {
      memberFirstName: 'Noah',
      memberLastName: 'Schaller',
      teamName: TEAM_NAME,
      coachName: COACH_NAME,
    },
  },
  {
    id: 'lr-paul-2025',
    memberId: 'm-paul',
    teamId: TEAM_ID,
    requestedBy: COACH_UID,
    status: 'pending_parent_docs',
    requiredDocs: ['id_front', 'id_back', 'avs'],
    uploadedDocs: {},
    parentNotes: null,
    parentCompletedAt: null,
    createdAt: NOW - 7 * DAY_MS,
    denorm: {
      memberFirstName: 'Paul',
      memberLastName: 'Lopez',
      teamName: TEAM_NAME,
      coachName: COACH_NAME,
    },
  },
  {
    id: 'lr-sarah-2025',
    memberId: 'm-sarah',
    teamId: TEAM_ID,
    requestedBy: COACH_UID,
    status: 'parent_docs_submitted',
    requiredDocs: ['id_front', 'id_back'],
    uploadedDocs: {
      id_front: {
        url: 'mock://licenseRequests/user-pascal/lr-sarah-2025/id_front.jpg',
        fileName: 'sarah_id_front.jpg',
        uploadedAt: NOW - 2 * DAY_MS,
        sizeBytes: 1_842_330,
      },
      id_back: {
        url: 'mock://licenseRequests/user-pascal/lr-sarah-2025/id_back.jpg',
        fileName: 'sarah_id_back.jpg',
        uploadedAt: NOW - 2 * DAY_MS,
        sizeBytes: 1_756_120,
      },
    },
    parentNotes: null,
    parentCompletedAt: NOW - 2 * DAY_MS,
    createdAt: NOW - 8 * DAY_MS,
    denorm: {
      memberFirstName: 'Sarah',
      memberLastName: 'Dupont',
      teamName: TEAM_NAME,
      coachName: COACH_NAME,
    },
  },
]

/** Lookup par id. Renvoie `undefined` si absent (pas d'exception). */
export function getMockLicenseRequestById(id: string): LicenseRequestMock | undefined {
  return MOCK_LICENSE_REQUESTS.find((lr) => lr.id === id)
}

/**
 * Filtre les fixtures pour un set de memberIds (ex. les enfants liés d'un
 * parent). Préserve l'ordre des fixtures source.
 */
export function listMockLicenseRequestsForMembers(memberIds: string[]): LicenseRequestMock[] {
  const set = new Set(memberIds)
  return MOCK_LICENSE_REQUESTS.filter((lr) => set.has(lr.memberId))
}

/** Filtre les fixtures pour un seul memberId. */
export function listMockLicenseRequestsForMember(memberId: string): LicenseRequestMock[] {
  return MOCK_LICENSE_REQUESTS.filter((lr) => lr.memberId === memberId)
}
