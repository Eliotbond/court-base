import {
  Timestamp,
  collection,
  collectionGroup,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import type {
  ClubConfig,
  MatchType,
  Member,
  OfficialAssignment,
  OfficialAssignmentStatus,
  Season,
  SlotType,
  Team,
} from '@club-app/shared-types'
import { db } from '@/services/firebase'

/**
 * Repository Dashboard — agrège les données affichées sur l'écran d'accueil.
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase. Les types
 * exposés (`DashboardAlerts`, `WeekBookingRow`, …) sont consommés par
 * `stores/dashboard.ts` et `views/Dashboard.vue` et ne doivent pas changer
 * de shape sans synchroniser ces consumers.
 *
 * Voir docs/firebase.md pour le schéma cible et docs/frontend-desktop.md
 * pour la règle de couches (components → composables → stores → repos → SDK).
 */

// ---------------------------------------------------------------------------
// Alert cards (5)
// ---------------------------------------------------------------------------

/** Mini-entrée affichée dans une alert card "officiels à staffer". */
export interface OfficialsToStaffEntry {
  /** Booking id pour l'éventuel deep-link. */
  bookingId: string
  /** Date du match — formattée côté vue. */
  date: Date
  /** Libellé court "U16M vs Vevey". */
  label: string
  /** `urgent` (<7j sans staff complet), `soon` (<14j), `later` (>=14j). */
  severity: 'urgent' | 'soon' | 'later'
}

/** Mini-entrée affichée dans la carte "Licences en attente". */
export interface LicensePendingEntry {
  /** Member id pour deep-link. */
  memberId: string
  displayName: string
  /** "U14F" ou autre catégorie. */
  teamLabel: string
  /** Couleur de fond du chip avatar (hex). */
  avatarBg: string
  /** Couleur du texte du chip avatar (hex). */
  avatarFg: string
}

/** Mini-entrée affichée dans la carte "Demandes de match". */
export interface MatchRequestEntry {
  /** `matchRequest` id pour deep-link. */
  requestId: string
  date: Date
  /** Libellé "BBC Vernier — Seniors 2 F". */
  label: string
}

/** Données complètes pour les 5 alert cards. */
export interface DashboardAlerts {
  /** Officiels à staffer — count total + 3 prochains matches. */
  officialsToStaff: {
    total: number
    urgent: number
    upcoming: OfficialsToStaffEntry[]
  }
  /** Cotisations en retard — count membres + montant à recouvrer + ratio. */
  duesOverdue: {
    membersCount: number
    amountChf: number
    /** Total émis cette saison (pour ratio). */
    totalIssuedChf: number
  }
  /** Licences en attente — count + 3 latest. */
  licensePending: {
    total: number
    latest: LicensePendingEntry[]
  }
  /** Demandes de match (visiteurs) — count + 2 pending. */
  matchRequests: {
    total: number
    pending: MatchRequestEntry[]
  }
  /** Conflits de planning cette semaine (count uniquement). */
  schedulingConflicts: {
    total: number
  }
}

// ---------------------------------------------------------------------------
// This-week table
// ---------------------------------------------------------------------------

/** Status d'affichage at-a-glance pour la table "Cette semaine". */
export type WeekBookingStatus =
  | 'scheduled'
  | 'conflict'
  | 'staffing'

/** Ligne du tableau "Cette semaine". */
export interface WeekBookingRow {
  id: string
  date: Date
  /** "HH:MM" */
  startTime: string
  /** "HH:MM" */
  endTime: string
  courtLabel: string
  teamLabel: string
  slotType: SlotType
  /** Nom du match type (ex. "CSJC"). Null pour training/reserve/custom. */
  matchTypeLabel: string | null
  /** Couleur affichage matchType (hex). Null si pas de matchType. */
  matchTypeColor: string | null
  /** Libellé coach (ex. "J. Favre"). */
  coachLabel: string
  /** Couleur de fond du chip avatar coach (hex). */
  coachAvatarBg: string
  /** Couleur du texte du chip avatar coach (hex). */
  coachAvatarFg: string
  /** Assignations d'officiels sur ce booking (vide hors match_home). */
  officials: {
    memberId: string
    displayName: string
    level: number
    status: OfficialAssignmentStatus
  }[]
  /** Nombre d'officiels requis (selon MatchType.homeOfficialRequirements). */
  officialsRequired: number
  /** Status at-a-glance (calculé côté repo : scheduled/conflict/staffing). */
  status: WeekBookingStatus
}

// ---------------------------------------------------------------------------
// Officials profitability widget
// ---------------------------------------------------------------------------

/** Couleur de l'indicateur dans le widget rentabilité officials. */
export type OfficialProfitabilityTier = 'green' | 'orange' | 'red'

/** Comptes par tier (pour stacked bar + grid 3-col). */
export interface OfficialsProfitabilityTiers {
  green: number
  orange: number
  red: number
}

/** Ligne "À surveiller" — un official en zone rouge. */
export interface OfficialAtRiskRow {
  memberId: string
  displayName: string
  level: number
  matchesAssigned: number
  /** CHF montant licence (depuis `config/club.officialsConfig.licenseFee`). */
  licenseFeeChf: number
  /** Couleur de fond du chip avatar (hex). */
  avatarBg: string
  /** Couleur du texte du chip avatar (hex). */
  avatarFg: string
}

/** Payload du widget rentabilité officials. */
export interface OfficialsProfitability {
  /** Distribution green/orange/red (counts absolus). */
  tiers: OfficialsProfitabilityTiers
  /** Officiels en zone rouge — pour la liste "À surveiller". */
  atRisk: OfficialAtRiskRow[]
  /** Total officials pour cette saison (header "14 officials · saison X"). */
  totalOfficials: number
  /** Libellé saison (ex. "2025-26"). */
  seasonLabel: string
}

// ---------------------------------------------------------------------------
// Bottom row : cotisations breakdown + activity feed
// ---------------------------------------------------------------------------

/** Une ligne du breakdown "Cotisations · saison". */
export interface DuesBreakdownRow {
  /** Libellé court (ex. "Émis", "Encaissé"). */
  label: string
  amountChf: number
  /** Ratio 0..1 pour la mini-bar (par rapport à `Émis`). */
  ratio: number
  /** Couleur de la mini-bar (hex). */
  color: string
  /** Couleur du texte du montant (hex ou null = surface-900). */
  amountColor: string | null
}

/** Payload du card "Cotisations · saison". */
export interface DuesBreakdown {
  /** Total dues émis (pour header "142 dues"). */
  duesCount: number
  rows: DuesBreakdownRow[]
}

/**
 * Source dérivée de l'entrée — cf. docs/firebase.md "Activity feed".
 */
export type ActivityKind =
  | 'booking_action'
  | 'dues_update'
  | 'license_update'
  | 'exception_update'
  | 'official_assignment'
  | 'system'

/** Entrée du feed "Activité récente". */
export interface ActivityFeedEntry {
  id: string
  kind: ActivityKind
  actor: string
  action: string
  target: string
  pill: { label: string; variant: 'emerald' | 'amber' | 'rose' | 'sky' | 'slate' } | null
  timeAgo: string
}

// ---------------------------------------------------------------------------
// Helpers internes
// ---------------------------------------------------------------------------

const ALERT_PREVIEW_LIMIT = 3
const MATCH_REQUEST_PREVIEW_LIMIT = 2
const WEEK_BOOKING_HARD_LIMIT = 200
const HORIZON_DAYS_OFFICIALS_TO_STAFF = 30
const URGENT_DAYS = 7
const SOON_DAYS = 14

/** Avatar palette déterministe — utilisée pour stabiliser le rendu côté UI. */
const AVATAR_PALETTE: readonly { bg: string; fg: string }[] = [
  { bg: '#dbeafe', fg: '#1e40af' },
  { bg: '#fce7f3', fg: '#9d174d' },
  { bg: '#dcfce7', fg: '#166534' },
  { bg: '#fde68a', fg: '#92400e' },
  { bg: '#cffafe', fg: '#155e75' },
  { bg: '#fee2e2', fg: '#9f1239' },
  { bg: '#e0e7ff', fg: '#3730a3' },
  { bg: '#fef3c7', fg: '#854d0e' },
]

const AT_RISK_AVATAR: { bg: string; fg: string } = { bg: '#fee2e2', fg: '#9f1239' }

/** Hash déterministe (djb2) pour mapper une string sur un index palette. */
function hash(input: string): number {
  let h = 5381
  for (let i = 0; i < input.length; i += 1) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0
  }
  return h
}

function paletteFor(seed: string): { bg: string; fg: string } {
  const palette = AVATAR_PALETTE[hash(seed) % AVATAR_PALETTE.length]
  return palette ?? AVATAR_PALETTE[0]!
}

/** Convertit un Timestamp Firestore en `Date` natif. */
function tsToDate(value: Timestamp): Date {
  return value.toDate()
}

/** Lundi 00:00 local de la semaine contenant `from`. */
function startOfWeek(from: Date): Date {
  const d = new Date(from)
  const day = d.getDay() // 0 = dimanche
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

/** Dimanche 23:59:59 local de la semaine contenant `from`. */
function endOfWeek(from: Date): Date {
  const d = startOfWeek(from)
  d.setDate(d.getDate() + 6)
  d.setHours(23, 59, 59, 999)
  return d
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d
}

/** Diffère deux dates en jours (entiers, fractionnel arrondi vers le bas). */
function daysBetween(later: Date, earlier: Date): number {
  const ms = later.getTime() - earlier.getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

/**
 * Charge la saison active. Retourne `null` si aucune. Utilisé partout pour
 * scoper les agrégats à la saison courante.
 */
async function getActiveSeason(): Promise<Season | null> {
  const q = query(
    collection(db, 'seasons'),
    where('status', '==', 'active'),
    limit(1),
  )
  const snap = await getDocs(q)
  const first = snap.docs[0]
  if (!first) return null
  return { id: first.id, ...(first.data() as Omit<Season, 'id'>) }
}

/** Charge `/config/club` (singleton). Renvoie `null` si absent. */
async function getClubConfig(): Promise<ClubConfig | null> {
  const snap = await getDoc(doc(db, 'config', 'club'))
  if (!snap.exists()) return null
  return { id: snap.id, ...(snap.data() as Omit<ClubConfig, 'id'>) }
}

/**
 * Batch-load des `/members/{id}` par lots de 10 (limite `where in`). Renvoie
 * une map id → Member pour rapidité de lookup côté caller.
 */
async function loadMembersByIds(ids: readonly string[]): Promise<Map<string, Member>> {
  const out = new Map<string, Member>()
  const unique = Array.from(new Set(ids.filter((id) => id.length > 0)))
  if (unique.length === 0) return out
  // Firestore `in` queries are capped at 10 values (v9 SDK).
  for (let i = 0; i < unique.length; i += 10) {
    const chunk = unique.slice(i, i + 10)
    const q = query(collection(db, 'members'), where(documentId(), 'in', chunk))
    const snap = await getDocs(q)
    for (const d of snap.docs) {
      out.set(d.id, { id: d.id, ...(d.data() as Omit<Member, 'id'>) })
    }
  }
  return out
}

/** Idem pour `/teams`. */
async function loadTeamsByIds(ids: readonly string[]): Promise<Map<string, Team>> {
  const out = new Map<string, Team>()
  const unique = Array.from(new Set(ids.filter((id) => id.length > 0)))
  if (unique.length === 0) return out
  for (let i = 0; i < unique.length; i += 10) {
    const chunk = unique.slice(i, i + 10)
    const q = query(collection(db, 'teams'), where(documentId(), 'in', chunk))
    const snap = await getDocs(q)
    for (const d of snap.docs) {
      out.set(d.id, { id: d.id, ...(d.data() as Omit<Team, 'id'>) })
    }
  }
  return out
}

/** Idem pour `/matchTypes`. */
async function loadMatchTypesByIds(ids: readonly string[]): Promise<Map<string, MatchType>> {
  const out = new Map<string, MatchType>()
  const unique = Array.from(new Set(ids.filter((id) => id.length > 0)))
  if (unique.length === 0) return out
  for (let i = 0; i < unique.length; i += 10) {
    const chunk = unique.slice(i, i + 10)
    const q = query(collection(db, 'matchTypes'), where(documentId(), 'in', chunk))
    const snap = await getDocs(q)
    for (const d of snap.docs) {
      out.set(d.id, { id: d.id, ...(d.data() as Omit<MatchType, 'id'>) })
    }
  }
  return out
}

/** Charge les `/venues/{venueId}/courts/{courtId}` listés. Map `${venueId}/${courtId}` → name. */
async function loadCourtLabels(
  pairs: readonly { venueId: string; courtId: string }[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const seen = new Set<string>()
  await Promise.all(
    pairs.map(async ({ venueId, courtId }) => {
      const key = `${venueId}/${courtId}`
      if (seen.has(key) || venueId.length === 0 || courtId.length === 0) return
      seen.add(key)
      try {
        const [venueSnap, courtSnap] = await Promise.all([
          getDoc(doc(db, 'venues', venueId)),
          getDoc(doc(db, 'venues', venueId, 'courts', courtId)),
        ])
        const venueName = venueSnap.exists() ? ((venueSnap.data() as { name?: string }).name ?? '') : ''
        const courtName = courtSnap.exists() ? ((courtSnap.data() as { name?: string }).name ?? '') : ''
        if (venueName.length === 0 && courtName.length === 0) {
          out.set(key, '—')
        } else if (venueName.length === 0) {
          out.set(key, courtName)
        } else if (courtName.length === 0) {
          out.set(key, venueName)
        } else {
          out.set(key, `${venueName} · ${courtName}`)
        }
      } catch {
        out.set(key, '—')
      }
    }),
  )
  return out
}

/** Compute le total d'officiels requis pour un MatchType (somme des counts). */
function requiredOfficialsFor(matchType: MatchType | undefined): number {
  if (!matchType) return 0
  return matchType.homeOfficialRequirements.reduce((acc, r) => acc + r.count, 0)
}

/** Libellé court d'un coach "P. Rochat" depuis Member. */
function shortCoachLabel(m: Member | undefined): string {
  if (!m) return '—'
  const first = m.firstName.trim()
  const last = m.lastName.trim()
  if (first.length === 0 && last.length === 0) return '—'
  if (first.length === 0) return last
  if (last.length === 0) return first
  return `${first.charAt(0).toUpperCase()}. ${last}`
}

/** Libellé court d'un officiel "L. Müller" depuis Member. */
function shortOfficialLabel(m: Member | undefined): string {
  return shortCoachLabel(m)
}

// ---------------------------------------------------------------------------
// fetchDashboardAlerts
// ---------------------------------------------------------------------------

/**
 * Données des 5 cartes d'alerte.
 *
 * Implémentation : 5 sous-queries en parallèle.
 *   - officialsToStaff : `bookings where slotType == 'match_home'
 *     and date >= now and date <= now+30d and status == 'scheduled'`
 *   - duesOverdue : `dues where status == 'overdue'` (count + sum)
 *                 + `dues where status in ['issued','overdue','paid'] and seasonId == activeId`
 *                   pour le totalIssuedChf.
 *   - licensePending : `licenseRequests where status == 'pending'
 *                       orderBy createdAt desc`
 *   - matchRequests : `matchRequests where status == 'pending'
 *                      orderBy createdAt desc`
 *   - schedulingConflicts : pas de collection dédiée — laissé à 0 pour MVP
 *     (le détecteur Season Planning Assistant vivra côté Function /
 *     callable plus tard).
 */
export async function fetchDashboardAlerts(): Promise<DashboardAlerts> {
  const now = new Date()
  const horizon = addDays(now, HORIZON_DAYS_OFFICIALS_TO_STAFF)

  // Lance toutes les sous-queries en parallèle.
  const [officialsToStaff, duesOverdue, licensePending, matchRequestsAlert] = await Promise.all([
    fetchOfficialsToStaffAlert(now, horizon),
    fetchDuesOverdueAlert(),
    fetchLicensePendingAlert(),
    fetchMatchRequestsAlert(),
  ])

  return {
    officialsToStaff,
    duesOverdue,
    licensePending,
    matchRequests: matchRequestsAlert,
    schedulingConflicts: { total: 0 },
  }
}

async function fetchOfficialsToStaffAlert(
  now: Date,
  horizon: Date,
): Promise<DashboardAlerts['officialsToStaff']> {
  const q = query(
    collection(db, 'bookings'),
    where('slotType', '==', 'match_home'),
    where('status', '==', 'scheduled'),
    where('date', '>=', Timestamp.fromDate(now)),
    where('date', '<=', Timestamp.fromDate(horizon)),
    orderBy('date', 'asc'),
  )
  const snap = await getDocs(q)
  if (snap.empty) {
    return { total: 0, urgent: 0, upcoming: [] }
  }

  // Charger en parallèle teams + matchTypes pour libellés et required count.
  const teamIds: string[] = []
  const matchTypeIds: string[] = []
  for (const d of snap.docs) {
    const data = d.data() as { teamId: string | null; matchTypeId: string | null }
    if (data.teamId) teamIds.push(data.teamId)
    if (data.matchTypeId) matchTypeIds.push(data.matchTypeId)
  }
  const [teams, matchTypes] = await Promise.all([
    loadTeamsByIds(teamIds),
    loadMatchTypesByIds(matchTypeIds),
  ])

  // Construire les `upcoming` (top N par date) + count urgent.
  let urgent = 0
  const upcoming: OfficialsToStaffEntry[] = []
  for (const d of snap.docs) {
    const data = d.data() as {
      teamId: string | null
      matchTypeId: string | null
      date: Timestamp
    }
    const date = tsToDate(data.date)
    const delta = daysBetween(date, now)
    const severity: OfficialsToStaffEntry['severity'] =
      delta < URGENT_DAYS ? 'urgent' : delta < SOON_DAYS ? 'soon' : 'later'
    if (severity === 'urgent') urgent += 1

    if (upcoming.length < ALERT_PREVIEW_LIMIT) {
      const team = data.teamId ? teams.get(data.teamId) : undefined
      const matchType = data.matchTypeId ? matchTypes.get(data.matchTypeId) : undefined
      const teamLabel = team?.name ?? 'Équipe ?'
      const matchTypeLabel = matchType?.name ?? ''
      const label = matchTypeLabel ? `${teamLabel} (${matchTypeLabel})` : teamLabel
      upcoming.push({
        bookingId: d.id,
        date,
        label,
        severity,
      })
    }
  }

  return {
    total: snap.size,
    urgent,
    upcoming,
  }
}

async function fetchDuesOverdueAlert(): Promise<DashboardAlerts['duesOverdue']> {
  // 1) Overdue : count + sum amount.
  const overdueQ = query(collection(db, 'dues'), where('status', '==', 'overdue'))
  const overdueSnap = await getDocs(overdueQ)
  let amountChf = 0
  const overdueMemberIds = new Set<string>()
  for (const d of overdueSnap.docs) {
    const data = d.data() as { amount: number; memberId: string }
    amountChf += data.amount
    overdueMemberIds.add(data.memberId)
  }

  // 2) Total émis cette saison (issued + overdue + paid sur saison active).
  let totalIssuedChf = 0
  const activeSeason = await getActiveSeason()
  if (activeSeason) {
    const issuedQ = query(
      collection(db, 'dues'),
      where('seasonId', '==', activeSeason.id),
      where('status', 'in', ['issued', 'overdue', 'paid']),
    )
    const issuedSnap = await getDocs(issuedQ)
    for (const d of issuedSnap.docs) {
      const data = d.data() as { amount: number }
      totalIssuedChf += data.amount
    }
  }

  return {
    membersCount: overdueMemberIds.size,
    amountChf,
    totalIssuedChf,
  }
}

async function fetchLicensePendingAlert(): Promise<DashboardAlerts['licensePending']> {
  const q = query(
    collection(db, 'licenseRequests'),
    where('status', '==', 'pending'),
    orderBy('createdAt', 'desc'),
    limit(ALERT_PREVIEW_LIMIT),
  )
  const snap = await getDocs(q)
  if (snap.empty) {
    return { total: 0, latest: [] }
  }

  // Count total séparément (la query au-dessus est tronquée).
  const countQ = query(
    collection(db, 'licenseRequests'),
    where('status', '==', 'pending'),
  )
  const countSnap = await getDocs(countQ)

  // Charger members + teams pour libellés.
  const memberIds: string[] = []
  const teamIds: string[] = []
  const docPayloads: { id: string; memberId: string; teamId: string }[] = []
  for (const d of snap.docs) {
    const data = d.data() as { memberId: string; teamId: string }
    memberIds.push(data.memberId)
    teamIds.push(data.teamId)
    docPayloads.push({ id: d.id, memberId: data.memberId, teamId: data.teamId })
  }
  const [members, teams] = await Promise.all([
    loadMembersByIds(memberIds),
    loadTeamsByIds(teamIds),
  ])

  const latest: LicensePendingEntry[] = docPayloads.map((p) => {
    const m = members.get(p.memberId)
    const t = teams.get(p.teamId)
    const displayName = m ? `${m.firstName} ${m.lastName}`.trim() : 'Membre ?'
    const palette = paletteFor(p.memberId)
    return {
      memberId: p.memberId,
      displayName,
      teamLabel: t?.name ?? '—',
      avatarBg: palette.bg,
      avatarFg: palette.fg,
    }
  })

  return {
    total: countSnap.size,
    latest,
  }
}

async function fetchMatchRequestsAlert(): Promise<DashboardAlerts['matchRequests']> {
  const previewQ = query(
    collection(db, 'matchRequests'),
    where('status', '==', 'pending'),
    orderBy('createdAt', 'desc'),
    limit(MATCH_REQUEST_PREVIEW_LIMIT),
  )
  const previewSnap = await getDocs(previewQ)
  if (previewSnap.empty) {
    return { total: 0, pending: [] }
  }

  const countQ = query(
    collection(db, 'matchRequests'),
    where('status', '==', 'pending'),
  )
  const countSnap = await getDocs(countQ)

  // Pour le libellé, on lit chaque booking lié (équipe + matchType).
  const bookingIds: { id: string; bookingId: string; proposedDate: Timestamp | null }[] = []
  for (const d of previewSnap.docs) {
    const data = d.data() as { bookingId: string; proposedDate: Timestamp | null }
    bookingIds.push({ id: d.id, bookingId: data.bookingId, proposedDate: data.proposedDate })
  }

  // Charge les bookings + dépendances pour libellé.
  const bookingDocs = await Promise.all(
    bookingIds.map((b) => getDoc(doc(db, 'bookings', b.bookingId))),
  )
  const teamIds = new Set<string>()
  for (const bd of bookingDocs) {
    if (bd.exists()) {
      const data = bd.data() as { teamId: string | null }
      if (data.teamId) teamIds.add(data.teamId)
    }
  }
  const teams = await loadTeamsByIds(Array.from(teamIds))

  const pending: MatchRequestEntry[] = bookingIds.map((b, idx) => {
    const bd = bookingDocs[idx]
    let teamLabel = '—'
    let bookingDate: Date | null = null
    if (bd && bd.exists()) {
      const data = bd.data() as { teamId: string | null; date: Timestamp }
      bookingDate = tsToDate(data.date)
      if (data.teamId) {
        const t = teams.get(data.teamId)
        if (t) teamLabel = t.name
      }
    }
    const date = b.proposedDate ? tsToDate(b.proposedDate) : (bookingDate ?? new Date())
    return {
      requestId: b.id,
      date,
      label: teamLabel,
    }
  })

  return {
    total: countSnap.size,
    pending,
  }
}

// ---------------------------------------------------------------------------
// fetchThisWeekBookings
// ---------------------------------------------------------------------------

/**
 * Bookings de la semaine en cours (lundi → dimanche).
 *
 * Query :
 *   `bookings where date >= startOfWeek and date <= endOfWeek
 *      and status == 'scheduled' orderBy date asc, startTime asc`
 *
 * Jointures :
 *   - `teams/{teamId}` → name + coachIds[0]
 *   - `members/{coachId}` → libellé "P. Rochat"
 *   - `venues/{venueId}/courts/{courtId}` → "Forêt · Court A"
 *   - `matchTypes/{matchTypeId}` → name + color + homeOfficialRequirements
 *   - `bookings/{id}/officialAssignments` (sub-collection) si match_home
 *   - `members/{officialMemberId}` → libellé officiel
 *
 * `status` :
 *   - `staffing` si match_home et officiels confirmés < required
 *   - `conflict` non détecté côté repo (pas de collection dédiée) — TODO
 *   - `scheduled` sinon
 */
export async function fetchThisWeekBookings(): Promise<WeekBookingRow[]> {
  const now = new Date()
  const monday = startOfWeek(now)
  const sunday = endOfWeek(now)

  const q = query(
    collection(db, 'bookings'),
    where('status', '==', 'scheduled'),
    where('date', '>=', Timestamp.fromDate(monday)),
    where('date', '<=', Timestamp.fromDate(sunday)),
    orderBy('date', 'asc'),
    orderBy('startTime', 'asc'),
    limit(WEEK_BOOKING_HARD_LIMIT),
  )
  const snap = await getDocs(q)
  if (snap.empty) return []

  // Ramasse les dépendances à joindre.
  const teamIds: string[] = []
  const matchTypeIds: string[] = []
  const courtPairs: { venueId: string; courtId: string }[] = []
  type Raw = {
    id: string
    teamId: string | null
    matchTypeId: string | null
    venueId: string
    courtId: string
    slotType: SlotType
    date: Timestamp
    startTime: string
    endTime: string
  }
  const raws: Raw[] = snap.docs.map((d) => {
    const data = d.data() as Omit<Raw, 'id'>
    if (data.teamId) teamIds.push(data.teamId)
    if (data.matchTypeId) matchTypeIds.push(data.matchTypeId)
    if (data.venueId && data.courtId) courtPairs.push({ venueId: data.venueId, courtId: data.courtId })
    return { id: d.id, ...data }
  })

  const [teams, matchTypes, courts] = await Promise.all([
    loadTeamsByIds(teamIds),
    loadMatchTypesByIds(matchTypeIds),
    loadCourtLabels(courtPairs),
  ])

  // Pour chaque booking match_home, charger sa sub-collection officialAssignments.
  const assignmentPromises: Promise<{ bookingId: string; assignments: OfficialAssignment[] }>[] =
    raws.map(async (r) => {
      if (r.slotType !== 'match_home') return { bookingId: r.id, assignments: [] }
      const sub = await getDocs(collection(db, 'bookings', r.id, 'officialAssignments'))
      const assignments: OfficialAssignment[] = sub.docs.map((sd) => ({
        id: sd.id,
        ...(sd.data() as Omit<OfficialAssignment, 'id'>),
      }))
      return { bookingId: r.id, assignments }
    })
  const assignmentsByBooking = new Map<string, OfficialAssignment[]>()
  for (const entry of await Promise.all(assignmentPromises)) {
    assignmentsByBooking.set(entry.bookingId, entry.assignments)
  }

  // Charge en batch les members nécessaires : coachs des teams + officiels assignés.
  const memberIds = new Set<string>()
  for (const t of teams.values()) {
    if (t.coachIds.length > 0 && t.coachIds[0]) memberIds.add(t.coachIds[0])
  }
  for (const list of assignmentsByBooking.values()) {
    for (const a of list) memberIds.add(a.memberId)
  }
  const members = await loadMembersByIds(Array.from(memberIds))

  const rows: WeekBookingRow[] = raws.map((r) => {
    const team = r.teamId ? teams.get(r.teamId) : undefined
    const teamLabel = team?.name ?? '—'
    const matchType = r.matchTypeId ? matchTypes.get(r.matchTypeId) : undefined
    const matchTypeLabel = matchType?.name ?? null
    const matchTypeColor = matchType?.color ?? null
    const courtLabel = courts.get(`${r.venueId}/${r.courtId}`) ?? '—'

    const coachId = team && team.coachIds.length > 0 ? team.coachIds[0] : undefined
    const coachMember = coachId ? members.get(coachId) : undefined
    const coachLabel = shortCoachLabel(coachMember)
    const coachPalette = paletteFor(coachId ?? r.id)

    const assignments = assignmentsByBooking.get(r.id) ?? []
    const officials = assignments.map((a) => ({
      memberId: a.memberId,
      displayName: shortOfficialLabel(members.get(a.memberId)),
      level: a.officialLevel,
      status: a.status,
    }))

    const officialsRequired = requiredOfficialsFor(matchType)
    const confirmed = officials.filter((o) => o.status === 'confirmed').length

    let status: WeekBookingStatus = 'scheduled'
    if (r.slotType === 'match_home' && confirmed < officialsRequired) {
      status = 'staffing'
    }

    return {
      id: r.id,
      date: tsToDate(r.date),
      startTime: r.startTime,
      endTime: r.endTime,
      courtLabel,
      teamLabel,
      slotType: r.slotType,
      matchTypeLabel,
      matchTypeColor,
      coachLabel,
      coachAvatarBg: coachPalette.bg,
      coachAvatarFg: coachPalette.fg,
      officials,
      officialsRequired,
      status,
    }
  })

  return rows
}

// ---------------------------------------------------------------------------
// fetchOfficialsProfitability
// ---------------------------------------------------------------------------

/**
 * Distribution rentabilité officials + liste "À surveiller" (rouges).
 *
 * Implémentation (MVP) :
 *   1. Lire saison active + config club (seuils + licenseFee).
 *   2. Lire tous les `/bookings` de la saison via collection-group sur
 *      `/officialAssignments where status == 'confirmed'`, puis filtrer par
 *      seasonId du parent booking. O(N) reads — acceptable pour un dashboard.
 *   3. Agréger par memberId : count des matches confirmés.
 *   4. Classer en green/orange/red selon les seuils.
 */
export async function fetchOfficialsProfitability(): Promise<OfficialsProfitability> {
  const [activeSeason, config] = await Promise.all([
    getActiveSeason(),
    getClubConfig(),
  ])
  const seasonLabel = activeSeason?.name ?? '—'
  const thresholdGreen = config?.officialsConfig.thresholdGreen ?? 6
  const thresholdOrange = config?.officialsConfig.thresholdOrange ?? 3
  const licenseFee = config?.officialsConfig.licenseFee ?? 0

  if (!activeSeason) {
    return {
      tiers: { green: 0, orange: 0, red: 0 },
      atRisk: [],
      totalOfficials: 0,
      seasonLabel,
    }
  }

  // 1) collection-group sur officialAssignments confirmés.
  const cgQ = query(
    collectionGroup(db, 'officialAssignments'),
    where('status', '==', 'confirmed'),
  )
  const cgSnap = await getDocs(cgQ)

  // 2) Filtrer côté client par seasonId du booking parent.
  // Le parent est `bookings/{bookingId}/officialAssignments/{id}` — on lit le
  // booking pour vérifier `seasonId == activeSeason.id`.
  const bookingIdsToCheck = new Set<string>()
  const assignmentRows: { memberId: string; bookingId: string }[] = []
  for (const d of cgSnap.docs) {
    const parent = d.ref.parent.parent
    if (!parent) continue
    const data = d.data() as { memberId: string }
    bookingIdsToCheck.add(parent.id)
    assignmentRows.push({ memberId: data.memberId, bookingId: parent.id })
  }

  // 3) Batch-load des bookings (par chunks de 10 sur documentId in …).
  const bookingSeasonIds = new Map<string, string>()
  const bookingIdsArr = Array.from(bookingIdsToCheck)
  for (let i = 0; i < bookingIdsArr.length; i += 10) {
    const chunk = bookingIdsArr.slice(i, i + 10)
    const bq = query(collection(db, 'bookings'), where(documentId(), 'in', chunk))
    const bs = await getDocs(bq)
    for (const bd of bs.docs) {
      const data = bd.data() as { seasonId: string }
      bookingSeasonIds.set(bd.id, data.seasonId)
    }
  }

  // 4) Comptage par memberId, filtré par saison.
  const matchesByMember = new Map<string, number>()
  for (const row of assignmentRows) {
    if (bookingSeasonIds.get(row.bookingId) !== activeSeason.id) continue
    matchesByMember.set(row.memberId, (matchesByMember.get(row.memberId) ?? 0) + 1)
  }

  // 5) Charger tous les members "official" pour assurer que les officiels SANS
  //    aucune confirmation entrent quand même dans la distribution (zone rouge).
  const officialsQ = query(
    collection(db, 'members'),
    where('officialLevel', 'in', [1, 2]),
  )
  const officialsSnap = await getDocs(officialsQ)
  const allOfficials: Member[] = officialsSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Member, 'id'>),
  }))

  // 6) Classer.
  const tiers: OfficialsProfitabilityTiers = { green: 0, orange: 0, red: 0 }
  const atRisk: OfficialAtRiskRow[] = []
  for (const m of allOfficials) {
    const matches = matchesByMember.get(m.id) ?? 0
    let tier: OfficialProfitabilityTier
    if (matches >= thresholdGreen) tier = 'green'
    else if (matches >= thresholdOrange) tier = 'orange'
    else tier = 'red'
    tiers[tier] += 1

    if (tier === 'red') {
      const displayName = `${m.firstName} ${m.lastName}`.trim()
      atRisk.push({
        memberId: m.id,
        displayName,
        level: m.officialLevel ?? 0,
        matchesAssigned: matches,
        licenseFeeChf: licenseFee,
        avatarBg: AT_RISK_AVATAR.bg,
        avatarFg: AT_RISK_AVATAR.fg,
      })
    }
  }

  // Tri "À surveiller" par matchesAssigned asc (les pires d'abord).
  atRisk.sort((a, b) => a.matchesAssigned - b.matchesAssigned)

  return {
    tiers,
    atRisk,
    totalOfficials: allOfficials.length,
    seasonLabel,
  }
}

// ---------------------------------------------------------------------------
// fetchDuesBreakdown
// ---------------------------------------------------------------------------

/**
 * Breakdown des cotisations de la saison.
 *
 * Query : `dues where seasonId == activeSeasonId` puis agrégat client-side.
 *   - Émis      : sum(amount) sur status ∈ {issued, overdue, paid, excepted}
 *   - Encaissé  : sum(paidAmount) sur status == paid (fallback amount si null)
 *   - En retard : sum(amount) sur status == overdue
 *   - Exception : sum(amount) sur status == excepted
 */
export async function fetchDuesBreakdown(): Promise<DuesBreakdown> {
  const activeSeason = await getActiveSeason()
  if (!activeSeason) {
    return { duesCount: 0, rows: emptyDuesRows() }
  }

  const q = query(
    collection(db, 'dues'),
    where('seasonId', '==', activeSeason.id),
  )
  const snap = await getDocs(q)

  let issued = 0
  let paid = 0
  let overdue = 0
  let exception = 0
  let count = 0
  for (const d of snap.docs) {
    const data = d.data() as {
      amount: number
      paidAmount: number | null
      status: 'pending_grace' | 'issued' | 'paid' | 'overdue' | 'excepted' | 'cancelled'
    }
    if (data.status === 'cancelled' || data.status === 'pending_grace') continue
    count += 1
    if (
      data.status === 'issued' ||
      data.status === 'overdue' ||
      data.status === 'paid' ||
      data.status === 'excepted'
    ) {
      issued += data.amount
    }
    if (data.status === 'paid') paid += data.paidAmount ?? data.amount
    if (data.status === 'overdue') overdue += data.amount
    if (data.status === 'excepted') exception += data.amount
  }

  return {
    duesCount: count,
    rows: buildDuesRows(issued, paid, overdue, exception),
  }
}

function buildDuesRows(
  issued: number,
  paid: number,
  overdue: number,
  exception: number,
): DuesBreakdownRow[] {
  const safeRatio = (n: number): number => (issued > 0 ? n / issued : 0)
  return [
    { label: 'Émis', amountChf: issued, ratio: 1, color: '#e2e8f0', amountColor: null },
    {
      label: 'Encaissé',
      amountChf: paid,
      ratio: safeRatio(paid),
      color: '#10b981',
      amountColor: null,
    },
    {
      label: 'En retard',
      amountChf: overdue,
      ratio: safeRatio(overdue),
      color: '#e11d48',
      amountColor: '#be123c',
    },
    {
      label: 'Exception',
      amountChf: exception,
      ratio: safeRatio(exception),
      color: '#f59e0b',
      amountColor: '#b45309',
    },
  ]
}

function emptyDuesRows(): DuesBreakdownRow[] {
  return buildDuesRows(0, 0, 0, 0)
}

// ---------------------------------------------------------------------------
// fetchActivityFeed
// ---------------------------------------------------------------------------

/**
 * Feed "Activité récente".
 *
 * **Volontairement non-implémenté.** Voir docs/firebase.md section
 * "Activity feed — feed dashboard (TBD)" : pas de collection `/activityLog`
 * provisionnée pour l'instant. Plusieurs options encore ouvertes (vue dérivée
 * client-side ou collection event-sourced alimentée par Functions). Décision
 * trackée par Eliot ; on retourne un array vide tant que la décision n'est
 * pas tranchée, et la vue affiche son état "Aucune activité récente."
 *
 * TODO(firestore): implémenter quand la décision sera tranchée.
 */
export async function fetchActivityFeed(): Promise<ActivityFeedEntry[]> {
  return []
}
