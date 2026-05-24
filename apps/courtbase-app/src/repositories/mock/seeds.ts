/**
 * Seeds de données simulées pour la phase mock de `courtbase-app`.
 *
 * **PAS de données réelles**. Tout est inventé. Quand on basculera sur les
 * vraies repos Firestore, ce fichier disparaîtra.
 *
 * Cohérence : un membre référencé dans plusieurs vues doit être ici une fois
 * et UNIQUEMENT ici, sinon les vues divergent (e.g. "Sarah Dupont" qui est
 * exclue dans CO2 mais payée dans son détail CO4).
 *
 * Convention dates : toutes les dates affichées sont **pré-formatées en FR**
 * pour éviter d'avoir à gérer la locale Intl côté vues mock. Quand on
 * branchera les vraies repos, ces strings seront générées via un composable
 * de formatage.
 */

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
// Club (singleton — affichage dans le shell uniquement)
// ───────────────────────────────────────────────────────────────

export const MOCK_CLUB = {
  name: 'BC Aigles',
  initials: 'BCA',
  seasonLabel: 'Saison 2025/26',
  /** ID de la saison active (référencé par `officialLicense.seasonId`). */
  activeSeasonId: 'season-2025-26',
}

// ───────────────────────────────────────────────────────────────
// Session mock (user signed-in, multi-rôle pour traverser toutes les vues)
// ───────────────────────────────────────────────────────────────

export const MOCK_SESSION: MockSession = {
  uid: 'user-mathieu',
  displayName: 'Mathieu Brun',
  email: 'mathieu.brun@example.ch',
  phone: '+41 78 123 45 67',
  // Cumule les 3 rôles pour pouvoir naviguer dans **toutes** les vues du brief.
  // En mode prod, un user aurait typiquement un seul rôle (ou deux).
  roles: ['coach', 'official', 'admin'],
  // En tant que coach + officiel, Mathieu est aussi un member du club.
  linkedMemberId: 'm-mathieu',
  profileCompleted: true,
}

// ───────────────────────────────────────────────────────────────
// Teams
// ───────────────────────────────────────────────────────────────

export const MOCK_TEAMS: MockTeam[] = [
  {
    id: 't-u16m-compet',
    name: 'U16M Compétition',
    categoryName: 'U16M',
    categoryAgeRange: '14-15 ans',
    tagName: 'Compétition',
    tagColor: 'emerald',
    coachIds: ['user-mathieu'],
    playerIds: [
      'm-sarah',
      'm-leo',
      'm-ines',
      'm-tom',
      'm-julian',
      'm-noah',
      'm-emma',
      'm-yann',
      'm-lucas',
      'm-paul',
      'm-pierre',
      'm-david',
      'm-rafael',
    ],
    registrationStatus: 'open',
    cotisationPrice: 380,
    nextTraining: 'Mardi 18:00 · Centre sportif Court A',
    preferredSlots: ['Mardi 18:00–19:30', 'Jeudi 18:00–19:30'],
    trainingsPerWeek: 2,
  },
  {
    id: 't-u14f-loisir',
    name: 'U14F Loisir',
    categoryName: 'U14F',
    categoryAgeRange: '12-13 ans',
    tagName: 'Loisir',
    tagColor: 'sky',
    coachIds: ['user-mathieu'],
    playerIds: ['m-lou', 'm-anais', 'm-zoe', 'm-camille', 'm-mila', 'm-elsa', 'm-jade', 'm-romane'],
    registrationStatus: 'open',
    cotisationPrice: 280,
    nextTraining: 'Mercredi 17:00 · Salle des écoles Court 1',
    preferredSlots: ['Mercredi 17:00–18:15'],
    trainingsPerWeek: 1,
  },
  {
    id: 't-u18m-elite',
    name: 'U18M Élite',
    categoryName: 'U18M',
    categoryAgeRange: '16-17 ans',
    tagName: 'Élite',
    tagColor: 'violet',
    coachIds: ['user-other-coach'],
    playerIds: [],
    registrationStatus: 'conditional',
    cotisationPrice: 450,
    preferredSlots: ['Lundi 19:30–21:00', 'Mercredi 19:30–21:00', 'Vendredi 19:30–21:00'],
    trainingsPerWeek: 3,
  },
]

// ───────────────────────────────────────────────────────────────
// Members
// ───────────────────────────────────────────────────────────────

export const MOCK_MEMBERS: MockMember[] = [
  // ─── Le user lui-même (officiel niveau 2 actif) ───────────────
  {
    id: 'm-mathieu',
    firstName: 'Mathieu',
    lastName: 'Brun',
    birthDate: '1988-03-12',
    gender: 'M',
    teamIds: [],
    duesStatus: 'paid',
    licenseNumber: 'LIC-2003-1842',
    officialLicense: { level: 2, seasonId: MOCK_CLUB.activeSeasonId },
    officialLevel: 2,
    guardianUserIds: [],
    avatarTone: 'emerald',
    active: true,
    status: 'active',
  },

  // ─── U16M Compétition ─────────────────────────────────────────
  {
    id: 'm-sarah',
    firstName: 'Sarah',
    lastName: 'Dupont',
    birthDate: '2009-04-22',
    gender: 'F',
    teamIds: ['t-u16m-compet'],
    duesStatus: 'paid',
    licenseNumber: 'LIC-2024-4501',
    officialLicense: null,
    officialLevel: null,
    guardianUserIds: ['user-parent-dupont'],
    active: true,
    status: 'active',
    avs: '756.1234.5678.91',
  },
  {
    id: 'm-leo',
    firstName: 'Léo',
    lastName: 'Martin',
    birthDate: '2008-09-14',
    gender: 'M',
    teamIds: ['t-u16m-compet'],
    duesStatus: 'issued',
    licenseNumber: null,
    officialLicense: null,
    officialLevel: null,
    guardianUserIds: ['user-parent-martin'],
    avatarTone: 'amber',
    active: true,
    status: 'active',
  },
  {
    id: 'm-ines',
    firstName: 'Inès',
    lastName: 'Vidal',
    birthDate: '2009-07-03',
    gender: 'F',
    teamIds: ['t-u16m-compet'],
    duesStatus: 'excluded',
    licenseNumber: 'LIC-2024-4612',
    officialLicense: null,
    officialLevel: null,
    guardianUserIds: ['user-parent-vidal'],
    active: true,
    status: 'active',
  },
  {
    id: 'm-tom',
    firstName: 'Tom',
    lastName: 'Riedo',
    birthDate: '2008-12-01',
    gender: 'M',
    teamIds: ['t-u16m-compet'],
    duesStatus: 'excepted',
    licenseNumber: 'LIC-2024-4555',
    officialLicense: null,
    officialLevel: null,
    guardianUserIds: ['user-parent-riedo'],
    avatarTone: 'violet',
    active: true,
    status: 'active',
  },
  {
    id: 'm-julian',
    firstName: 'Julian',
    lastName: 'Käser',
    birthDate: '2008-05-18',
    gender: 'M',
    teamIds: ['t-u16m-compet'],
    duesStatus: 'paid',
    licenseNumber: 'LIC-2024-4480',
    officialLicense: null,
    officialLevel: null,
    guardianUserIds: ['user-parent-kaser'],
    active: true,
    status: 'active',
  },
  {
    id: 'm-noah',
    firstName: 'Noah',
    lastName: 'Schaller',
    birthDate: '2009-02-09',
    gender: 'M',
    teamIds: ['t-u16m-compet'],
    duesStatus: 'paid',
    licenseNumber: 'LIC-2024-4571',
    officialLicense: null,
    officialLevel: null,
    guardianUserIds: ['user-parent-schaller'],
    active: true,
    status: 'active',
  },
  {
    id: 'm-emma',
    firstName: 'Emma',
    lastName: 'Roy',
    birthDate: '2008-11-30',
    gender: 'F',
    teamIds: ['t-u16m-compet'],
    duesStatus: 'pending_grace',
    licenseNumber: null,
    officialLicense: null,
    officialLevel: null,
    guardianUserIds: ['user-parent-roy'],
    avatarTone: 'sky',
    active: true,
    status: 'active',
  },
  // ─── Paul Lopez : AVS manquant + non licencié + cotisation payée ──
  // Cas dédié pour la fixture `lr-paul-2025` (cf. shared-types/mock-fixtures)
  // qui requiert le doc `avs` en plus des deux pièces d'identité.
  {
    id: 'm-paul',
    firstName: 'Paul',
    lastName: 'Lopez',
    birthDate: '2009-03-15',
    gender: 'M',
    teamIds: ['t-u16m-compet'],
    duesStatus: 'paid',
    licenseNumber: null,
    officialLicense: null,
    officialLevel: null,
    guardianUserIds: ['user-parent-lopez'],
    avatarTone: 'sky',
    active: true,
    status: 'active',
    // Pas de `avs` — déclenche l'ajout de `avs` dans `inferRequiredDocs`.
  },

  // Quelques joueurs U16M en moins de détail (pour grossir l'effectif)
  ...['Yann Pillet', 'Lucas Berger', 'Pierre Crausaz', 'David Rey', 'Rafael Mota'].map<MockMember>(
    (full, i) => ({
      id: `m-${full.toLowerCase().split(' ')[0]?.normalize('NFD').replace(/[̀-ͯ]/g, '') ?? `extra${i}`}`,
      firstName: full.split(' ')[0] ?? 'Joueur',
      lastName: full.split(' ')[1] ?? '?',
      birthDate: '2008-06-01',
      gender: 'M',
      teamIds: ['t-u16m-compet'],
      duesStatus: 'paid',
      licenseNumber: `LIC-2024-${4600 + i}`,
      officialLicense: null,
      officialLevel: null,
      guardianUserIds: [],
      active: true,
      status: 'active',
    }),
  ),

  // ─── U14F Loisir ──────────────────────────────────────────────
  {
    id: 'm-lou',
    firstName: 'Lou',
    lastName: 'Schmid',
    birthDate: '2011-08-12',
    gender: 'F',
    teamIds: ['t-u14f-loisir'],
    duesStatus: 'paid',
    licenseNumber: 'LIC-2024-5102',
    officialLicense: null,
    officialLevel: null,
    guardianUserIds: ['user-parent-schmid'],
    avatarTone: 'rose',
    active: true,
    status: 'active',
  },
  ...['Anaïs Pittet', 'Zoé Carron', 'Camille Joye', 'Mila Aebi', 'Elsa Wolf', 'Jade Pasche', 'Romane Beck'].map<
    MockMember
  >((full, i) => ({
    id: `m-${full.toLowerCase().split(' ')[0]?.normalize('NFD').replace(/[̀-ͯ]/g, '') ?? `loisir${i}`}`,
    firstName: full.split(' ')[0] ?? 'Joueuse',
    lastName: full.split(' ')[1] ?? '?',
    birthDate: '2011-05-01',
    gender: 'F',
    teamIds: ['t-u14f-loisir'],
    duesStatus: i === 0 ? 'pending_grace' : 'paid',
    licenseNumber: i % 2 === 0 ? `LIC-2024-${5100 + i}` : null,
    officialLicense: null,
    officialLevel: null,
    guardianUserIds: [],
    active: true,
    status: 'active',
  })),
]

// ───────────────────────────────────────────────────────────────
// Matches + Assignments
// ───────────────────────────────────────────────────────────────

export const MOCK_ASSIGNMENTS: MockAssignment[] = [
  // Match 1 — Sa 18 oct. — 2/3 staffé
  { id: 'a-1', matchId: 'match-csjc-pully', memberId: 'm-mathieu', requiredLevel: 2, status: 'confirmed', createdBy: 'self' },
  { id: 'a-2', matchId: 'match-csjc-pully', memberId: 'm-other-official-1', requiredLevel: 2, status: 'pending', createdBy: 'admin' },
  // Match 2 — Di 19 oct. — full staffé
  { id: 'a-3', matchId: 'match-afbb-yverdon', memberId: 'm-mathieu', requiredLevel: 2, status: 'confirmed', createdBy: 'admin' },
  { id: 'a-4', matchId: 'match-afbb-yverdon', memberId: 'm-other-official-2', requiredLevel: 2, status: 'confirmed', createdBy: 'admin' },
  { id: 'a-5', matchId: 'match-afbb-yverdon', memberId: 'm-other-official-3', requiredLevel: 1, status: 'confirmed', createdBy: 'admin' },
  // Match 3 — Sa 25 oct. — away, 0 officiel inscrit, J-2
  // (pas d'assignment encore)
  // Match 4 — Sa 1 nov. — home, 0/3
  // (pas d'assignment encore)
]

export const MOCK_MATCHES: MockMatch[] = [
  {
    id: 'match-csjc-pully',
    kind: 'home',
    teamId: 't-u16m-compet',
    matchType: 'CSJC',
    date: '2025-10-18',
    startTime: '14:30',
    durationHours: 3,
    opponent: 'Pully BC U16M',
    venueLabel: 'Centre sportif · Court A',
    assignmentIds: ['a-1', 'a-2'],
    requiredOfficialsTotal: 3,
    requiredByLevel: { 1: 1, 2: 2 },
  },
  {
    id: 'match-afbb-yverdon',
    kind: 'home',
    teamId: 't-u14f-loisir',
    matchType: 'AFBB',
    date: '2025-10-19',
    startTime: '11:00',
    durationHours: 3,
    opponent: 'Yverdon Basket U14F',
    venueLabel: 'Salle des écoles · Court 1',
    assignmentIds: ['a-3', 'a-4', 'a-5'],
    requiredOfficialsTotal: 3,
    requiredByLevel: { 1: 1, 2: 2 },
  },
  {
    id: 'match-amical-devils',
    kind: 'away',
    teamId: 't-u16m-compet',
    matchType: 'Amical',
    date: '2025-10-25',
    startTime: '18:00',
    durationHours: 3,
    opponent: 'Lausanne Devils U18M',
    venueLabel: 'Pully · Vieux-Moulin · 1009 Pully',
    assignmentIds: [],
    requiredOfficialsTotal: 2,
    requiredByLevel: { 2: 2 },
  },
  {
    id: 'match-csjc-meyrin',
    kind: 'home',
    teamId: 't-u16m-compet',
    matchType: 'CSJC',
    date: '2025-11-01',
    startTime: '15:00',
    durationHours: 3,
    opponent: 'Meyrin BC U16M',
    venueLabel: 'Centre sportif · Court B',
    assignmentIds: [],
    requiredOfficialsTotal: 3,
    requiredByLevel: { 1: 1, 2: 2 },
  },
]

// ───────────────────────────────────────────────────────────────
// Registrations
// ───────────────────────────────────────────────────────────────

export const MOCK_REGISTRATIONS: MockRegistration[] = [
  {
    id: 'reg-1',
    playerFirstName: 'Nathan',
    playerLastName: 'Crausaz',
    playerBirthDate: '2009-03-15',
    playerGender: 'M',
    submitterName: 'Anne Crausaz',
    submitterRelationship: 'parent',
    teamId: 't-u16m-compet',
    status: 'submitted',
    submittedAt: 'il y a 3 jours',
    previouslyLicensed: false,
  },
  {
    id: 'reg-2',
    playerFirstName: 'Eva',
    playerLastName: 'Pittet',
    playerBirthDate: '2011-11-20',
    playerGender: 'F',
    submitterName: 'Sylvie Pittet',
    submitterRelationship: 'parent',
    teamId: 't-u14f-loisir',
    status: 'trial_in_progress',
    submittedAt: 'il y a 9 jours',
    previouslyLicensed: true,
    previousClubName: 'BC Fribourg Olympic',
    previousClubAbroad: false,
    hasTransferLetter: false,
  },
  {
    id: 'reg-3',
    playerFirstName: 'Mateo',
    playerLastName: 'Rocha',
    playerBirthDate: '2009-09-08',
    playerGender: 'M',
    submitterName: 'Diogo Rocha',
    submitterRelationship: 'parent',
    teamId: 't-u16m-compet',
    status: 'open_pending_trial',
    submittedAt: 'il y a 1 jour',
    previouslyLicensed: true,
    previousClubName: 'SC Pombal (PT)',
    previousClubAbroad: true,
  },
  {
    id: 'reg-4',
    playerFirstName: 'Maxime',
    playerLastName: 'Berger',
    playerBirthDate: '2010-04-22',
    playerGender: 'M',
    submitterName: 'Coralie Berger',
    submitterRelationship: 'parent',
    teamId: 't-u16m-compet',
    status: 'trial_in_progress',
    submittedAt: 'il y a 5 jours',
    previouslyLicensed: false,
  },
  {
    id: 'reg-5',
    playerFirstName: 'Lucas',
    playerLastName: 'Favre',
    playerBirthDate: '2009-11-30',
    playerGender: 'M',
    submitterName: 'Olivier Favre',
    submitterRelationship: 'parent',
    teamId: 't-u16m-compet',
    status: 'confirmed_pending_dues',
    submittedAt: 'il y a 2 semaines',
    previouslyLicensed: false,
  },
  {
    id: 'reg-6',
    playerFirstName: 'Nina',
    playerLastName: 'Decker',
    playerBirthDate: '2011-02-12',
    playerGender: 'F',
    submitterName: 'Karin Decker',
    submitterRelationship: 'parent',
    teamId: 't-u14f-loisir',
    status: 'refused',
    submittedAt: 'il y a 1 semaine',
    previouslyLicensed: false,
    refusalReason: 'Catégorie complète pour cette saison — réessayez l\'an prochain.',
  },
]

// ───────────────────────────────────────────────────────────────
// Notifications
// ───────────────────────────────────────────────────────────────

export const MOCK_NOTIFICATIONS: MockNotification[] = [
  {
    id: 'n-1',
    type: 'urgent',
    title: 'Match annulé',
    extract: 'Le match U16M vs Pully BC du Sa 18 oct. est annulé. Plus de détails dans l\'app.',
    time: 'il y a 12 minutes',
    unread: true,
    deepLink: { name: 'match-detail', params: { id: 'match-csjc-pully' } },
  },
  {
    id: 'n-2',
    type: 'officials_needed',
    title: 'Officiel manquant',
    extract: 'U14F vs Yverdon — il manque encore 1 officiel niveau 2 pour ce dimanche.',
    time: 'il y a 2 h',
    unread: true,
    deepLink: { name: 'match-detail', params: { id: 'match-afbb-yverdon' } },
  },
  {
    id: 'n-3',
    type: 'match',
    title: 'Nouveau match programmé',
    extract: 'U16M vs Lausanne Devils — Sa 25 oct., 18:00, Pully Vieux-Moulin.',
    time: 'hier',
    unread: false,
    deepLink: { name: 'match-detail', params: { id: 'match-amical-devils' } },
  },
  {
    id: 'n-4',
    type: 'check',
    title: 'Assignation confirmée',
    extract: 'Vous êtes confirmé pour le match U16M vs Pully BC du Sa 18 oct.',
    time: 'il y a 3 jours',
    unread: false,
    deepLink: { name: 'match-detail', params: { id: 'match-csjc-pully' } },
  },
  {
    id: 'n-5',
    type: 'info',
    title: 'Nouvelle inscription U16M',
    extract: 'Anne Crausaz a soumis une inscription pour Nathan (U16M Compétition).',
    time: 'il y a 4 jours',
    unread: false,
    deepLink: { name: 'registration-detail', params: { id: 'reg-1' } },
  },
]

// ───────────────────────────────────────────────────────────────
// Requests
// ───────────────────────────────────────────────────────────────

export const MOCK_REQUESTS: MockRequest[] = [
  {
    id: 'req-1',
    kind: 'license',
    status: 'pending',
    requesterName: 'Mathieu Brun',
    memberName: 'Léo Martin',
    motivation:
      'Léo est régulier en entraînement depuis 6 mois, niveau de jeu suffisant pour participer aux matchs CSJC. Souhaite obtenir une licence joueur.',
    submittedAt: 'il y a 2 jours',
  },
  {
    id: 'req-2',
    kind: 'payment_exception',
    status: 'pending',
    requesterName: 'Mathieu Brun',
    memberName: 'Inès Vidal',
    motivation:
      'Famille en difficulté financière temporaire (perte d\'emploi du père). Demande de différer la cotisation de 2 mois.',
    submittedAt: 'il y a 4 jours',
  },
  {
    id: 'req-3',
    kind: 'match_move',
    status: 'pending',
    requesterName: 'Mathieu Brun',
    matchOpponent: 'Meyrin BC U16M',
    motivation:
      'Tournoi régional sur le même weekend pour la plupart des joueurs U16M. Demande de déplacer au samedi 8 nov. 15:00.',
    submittedAt: 'il y a 1 jour',
  },
]

// ───────────────────────────────────────────────────────────────
// Dues
// ───────────────────────────────────────────────────────────────

export const MOCK_DUES: MockDue[] = [
  {
    id: 'due-sarah',
    memberId: 'm-sarah',
    amount: 380,
    status: 'paid',
    issuedAt: '15 sept. 2025',
    paidAt: '22 sept. 2025',
  },
  { id: 'due-leo', memberId: 'm-leo', amount: 380, status: 'issued', issuedAt: '15 sept. 2025', dueAt: '29 sept. 2025' },
  { id: 'due-ines', memberId: 'm-ines', amount: 380, status: 'excluded', issuedAt: '15 sept. 2025', dueAt: '29 sept. 2025' },
  { id: 'due-tom', memberId: 'm-tom', amount: 380, status: 'excepted', issuedAt: '15 sept. 2025', dueAt: '29 sept. 2025' },
]
