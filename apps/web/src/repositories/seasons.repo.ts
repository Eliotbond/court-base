import type { Season, SeasonStatus, Timestamp } from '@club-app/shared-types'

/**
 * Repository Seasons — fournit la liste des saisons et les mutations de statut.
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase. Pour
 * l'instant la collection `/seasons/{seasonId}` n'est pas provisionnée de
 * manière exploitable côté client, on renvoie donc des données mockées
 * réalistes (~6 saisons couvrant past / current / future). Chaque retour est
 * annoté d'un `TODO(firestore)` indiquant la query réelle qui le remplacera.
 *
 * Voir docs/firebase.md (`/seasons/{seasonId}`) pour le schéma cible et
 * docs/main.md ("Season — draft → active → archived") pour le lifecycle.
 */

// ---------------------------------------------------------------------------
// Types exposés pour la vue Seasons
// ---------------------------------------------------------------------------

/**
 * Ligne enrichie pour la liste Seasons.
 *
 * Étend `Season` (schéma Firestore) avec quelques champs dérivés nécessaires
 * à l'affichage que la collection brute ne porte pas encore : count d'équipes
 * participantes (dérivé de /teams.activeSeasonIds), count de bookings générés
 * (dérivé de /bookings where seasonId == id), libellé venues. Tous ces champs
 * additionnels sont marqués `// TODO(firestore)` et ne doivent PAS être
 * ajoutés à `packages/shared-types/src/season.ts` tant qu'ils ne sont pas
 * dans le schéma `docs/firebase.md`.
 */
export interface SeasonRow extends Season {
  // TODO(firestore): dériver depuis /teams where activeSeasonIds array-contains id.
  teamsCount: number
  // TODO(firestore): dériver depuis /bookings where seasonId == id (count). 0 en
  // draft tant que la génération n'a pas tourné.
  bookingsCount: number
  // TODO(firestore): joindre /venues sur activeVenueIds → liste des noms. Pour
  // l'instant : libellés mockés cohérents avec le design (Forêt, Vergers,
  // Beaulieu).
  venueLabels: string[]
}

// ---------------------------------------------------------------------------
// Mock dataset
// ---------------------------------------------------------------------------

const MOCK_DELAY_MS = 100

function delay<T>(value: T, ms: number = MOCK_DELAY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

/** Helpers de construction. Évite de répéter `Timestamp` partout. */
function ts(date: Date): { seconds: number; nanoseconds: number } {
  return { seconds: Math.floor(date.getTime() / 1000), nanoseconds: 0 }
}

/** Construit un Date au 1er septembre AAAA, 00:00 local. */
function septFirst(year: number): Date {
  return new Date(year, 8, 1, 0, 0, 0, 0)
}

/** Construit un Date au 30 juin AAAA, 23:59 local. */
function juneLast(year: number): Date {
  return new Date(year, 5, 30, 23, 59, 0, 0)
}

interface MockSeasonSeed {
  id: string
  name: string
  startDate: Date
  endDate: Date
  status: SeasonStatus
  activeVenueIds: string[]
  closurePeriodIds: string[]
  generatedAt: Date | null
  teamsCount: number
  bookingsCount: number
  venueLabels: string[]
}

/**
 * 6 saisons couvrant tout le lifecycle :
 *  - 2 archived (saisons passées 2023-24 et 2024-25)
 *  - 1 active (2025-26 — celle qu'on voit partout dans le design "saison 2025-26")
 *  - 3 draft (futures : 2026-27 prête à activer, 2027-28 ébauche, 2028-29 vide)
 *
 * Cohérent avec le wording du design : "Saison 2025-26", venues "Forêt /
 * Vergers / Beaulieu", ~5 équipes, ~412 bookings annuels.
 */
const SEEDS: MockSeasonSeed[] = [
  {
    id: 'mock-season-23-24',
    name: 'Saison 2023-24',
    startDate: septFirst(2023),
    endDate: juneLast(2024),
    status: 'archived',
    activeVenueIds: ['mock-venue-foret', 'mock-venue-beaulieu'],
    closurePeriodIds: ['mock-closure-noel-23', 'mock-closure-fevrier-24'],
    generatedAt: new Date(2023, 7, 15),
    teamsCount: 4,
    bookingsCount: 318,
    venueLabels: ['Forêt', 'Beaulieu'],
  },
  {
    id: 'mock-season-24-25',
    name: 'Saison 2024-25',
    startDate: septFirst(2024),
    endDate: juneLast(2025),
    status: 'archived',
    activeVenueIds: ['mock-venue-foret', 'mock-venue-vergers', 'mock-venue-beaulieu'],
    closurePeriodIds: ['mock-closure-noel-24', 'mock-closure-fevrier-25'],
    generatedAt: new Date(2024, 7, 22),
    teamsCount: 5,
    bookingsCount: 396,
    venueLabels: ['Forêt', 'Vergers', 'Beaulieu'],
  },
  {
    id: 'mock-season-25-26',
    name: 'Saison 2025-26',
    startDate: septFirst(2025),
    endDate: juneLast(2026),
    status: 'active',
    activeVenueIds: ['mock-venue-foret', 'mock-venue-vergers', 'mock-venue-beaulieu'],
    closurePeriodIds: ['mock-closure-noel-25', 'mock-closure-fevrier-26', 'mock-closure-foret-mars-26'],
    generatedAt: new Date(2025, 7, 18),
    teamsCount: 5,
    bookingsCount: 412,
    venueLabels: ['Forêt', 'Vergers', 'Beaulieu'],
  },
  {
    id: 'mock-season-26-27',
    name: 'Saison 2026-27',
    startDate: septFirst(2026),
    endDate: juneLast(2027),
    status: 'draft',
    activeVenueIds: ['mock-venue-foret', 'mock-venue-vergers', 'mock-venue-beaulieu'],
    closurePeriodIds: ['mock-closure-noel-26'],
    generatedAt: null,
    teamsCount: 6,
    bookingsCount: 0,
    venueLabels: ['Forêt', 'Vergers', 'Beaulieu'],
  },
  {
    id: 'mock-season-27-28',
    name: 'Saison 2027-28',
    startDate: septFirst(2027),
    endDate: juneLast(2028),
    status: 'draft',
    activeVenueIds: ['mock-venue-foret'],
    closurePeriodIds: [],
    generatedAt: null,
    teamsCount: 2,
    bookingsCount: 0,
    venueLabels: ['Forêt'],
  },
  {
    id: 'mock-season-28-29',
    name: 'Saison 2028-29',
    startDate: septFirst(2028),
    endDate: juneLast(2029),
    status: 'draft',
    activeVenueIds: [],
    closurePeriodIds: [],
    generatedAt: null,
    teamsCount: 0,
    bookingsCount: 0,
    venueLabels: [],
  },
]

/** Sérialise un seed en `SeasonRow` complet (Date → Timestamp). */
function seedToRow(seed: MockSeasonSeed): SeasonRow {
  return {
    id: seed.id,
    name: seed.name,
    startDate: ts(seed.startDate),
    endDate: ts(seed.endDate),
    status: seed.status,
    activeVenueIds: seed.activeVenueIds,
    closurePeriodIds: seed.closurePeriodIds,
    generatedAt: seed.generatedAt ? ts(seed.generatedAt) : null,
    teamsCount: seed.teamsCount,
    bookingsCount: seed.bookingsCount,
    venueLabels: seed.venueLabels,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Liste toutes les saisons du club, triées par `startDate` desc.
 *
 * TODO(firestore): remplacer par
 *   `collection('/seasons').orderBy('startDate', 'desc').get()`
 *   puis pour chaque saison, dériver :
 *     - `teamsCount` via `query('/teams', where('activeSeasonIds', 'array-contains', id))`
 *     - `bookingsCount` via `query('/bookings', where('seasonId', '==', id)).count()`
 *     - `venueLabels` via `getDocs('/venues', where(documentId(), 'in', activeVenueIds))`
 *   (Pour l'efficacité prod, agréger côté serveur dans un sub-doc dénormalisé.)
 */
export async function listSeasons(): Promise<SeasonRow[]> {
  // TODO(firestore): replace with real query when /seasons is provisioned.
  const sorted = [...SEEDS].sort((a, b) => b.startDate.getTime() - a.startDate.getTime())
  return delay(sorted.map(seedToRow))
}

/**
 * Récupère la saison active (au plus une) — utilisée par tout l'app pour
 * indiquer "Saison 2025-26" partout (Dashboard, Officials, Dues, etc.).
 *
 * TODO(firestore): remplacer par
 *   `query('/seasons', where('status', '==', 'active'), limit(1)).get()`
 */
export async function getActiveSeason(): Promise<SeasonRow | null> {
  // TODO(firestore): replace when /seasons is provisioned.
  const found = SEEDS.find((s) => s.status === 'active')
  return delay(found ? seedToRow(found) : null)
}

/**
 * Active une saison en passant `draft` → `active`. Côté backend, ceci doit
 * être un wrapper autour de la Function `generateSeasonBookings` (cf.
 * docs/firebase.md "Functions catalog"). Côté UI, le bouton "Activer"
 * doit en réalité router vers l'écran "Activation — preview" (dry-run) et
 * c'est ce dernier qui appellera la mutation après confirmation.
 *
 * Pour l'instant on simule une mutation en mémoire et on renvoie le row
 * mis à jour pour permettre une update optimiste côté store.
 *
 * TODO(firestore): remplacer par un appel à `callable('activateSeason', { seasonId })`
 * (la Function se charge d'updater /seasons/{id} et de générer les bookings).
 */
export async function activateSeason(seasonId: string): Promise<SeasonRow | null> {
  // TODO(firestore): replace by callable Function `activateSeason`.
  const seed = SEEDS.find((s) => s.id === seasonId)
  if (!seed) return delay(null)
  seed.status = 'active'
  seed.generatedAt = new Date()
  return delay(seedToRow(seed))
}

/**
 * Archive une saison en passant `active` → `archived`. Geste réversible côté
 * UI mais le doc Firestore reste éditable (les bookings ne sont pas
 * supprimés).
 *
 * TODO(firestore): remplacer par `updateDoc('/seasons/{id}', { status: 'archived' })`.
 */
export async function archiveSeason(seasonId: string): Promise<SeasonRow | null> {
  // TODO(firestore): replace with updateDoc on /seasons/{id}.
  const seed = SEEDS.find((s) => s.id === seasonId)
  if (!seed) return delay(null)
  seed.status = 'archived'
  return delay(seedToRow(seed))
}

/**
 * Duplique une saison (typiquement la dernière `active`) en `draft`. Reprend
 * `activeVenueIds`, `closurePeriodIds` et incrémente le nom (ex. "Saison
 * 2025-26" → "Saison 2026-27"). Ne copie pas les bookings (ils seront
 * générés à l'activation).
 *
 * TODO(firestore): remplacer par un callable `duplicateSeason({ seasonId,
 * newName, newStartDate, newEndDate })` qui crée le doc et renvoie son id.
 */
export async function duplicateSeason(seasonId: string): Promise<SeasonRow | null> {
  // TODO(firestore): replace by callable Function `duplicateSeason`.
  const seed = SEEDS.find((s) => s.id === seasonId)
  if (!seed) return delay(null)
  const nextStartYear = seed.startDate.getFullYear() + 1
  const newSeed: MockSeasonSeed = {
    id: `mock-season-dup-${Date.now()}`,
    name: `Saison ${nextStartYear}-${(nextStartYear + 1) % 100}`,
    startDate: septFirst(nextStartYear),
    endDate: juneLast(nextStartYear + 1),
    status: 'draft',
    activeVenueIds: [...seed.activeVenueIds],
    closurePeriodIds: [...seed.closurePeriodIds],
    generatedAt: null,
    teamsCount: 0,
    bookingsCount: 0,
    venueLabels: [...seed.venueLabels],
  }
  SEEDS.push(newSeed)
  return delay(seedToRow(newSeed))
}

// ---------------------------------------------------------------------------
// Dry-run preview (B2)
// ---------------------------------------------------------------------------

/**
 * Slot type d'un booking — aligné sur le futur schéma `/bookings.slotType` (cf.
 * docs/firebase.md "Booking lifecycle"). Pour le mock on s'en tient aux 3
 * valeurs principales visibles dans le design.
 */
export type DryRunSlotType = 'training' | 'match-home' | 'match-away'

/**
 * Booking unitaire dans la preview du dry-run (~20 premières lignes générées).
 * À terme : ce shape sortira du callable `previewSeasonActivation` sous forme
 * d'array tronqué côté serveur (pagination cliente sur demande).
 */
export interface DryRunBookingPreview {
  /** Id mock — Firestore générera un vrai id à la confirmation. */
  id: string
  /** Date du booking (jour ouvré) en `Timestamp`. */
  date: Timestamp
  /** Plage horaire affichée "HH:MM → HH:MM". */
  timeSlot: string
  /** Libellé court "Forêt · Court A". */
  court: string
  /** Libellé équipe ("U16M", "Seniors 1 M"…). */
  team: string
  /** Type de slot — drive la couleur du Pill côté UI. */
  slotType: DryRunSlotType
}

/**
 * Résultat agrégé du dry-run d'activation (B2).
 *
 * Structure pensée pour matcher le callable serveur :
 *   `previewSeasonActivation({ seasonId }) → DryRunResult`
 * — le callable compile la liste complète des bookings à générer en RAM,
 * renvoie les counts + la fenêtre de preview (top 20), et stocke le résultat
 * complet sous `/seasons/{id}/_dryRun/{runId}` pour permettre la confirmation
 * sans recomputation. Côté UI, la page Activer affiche les counts + la
 * preview et un CTA "Confirmer" → callable `activateSeason({ seasonId, runId })`.
 */
export interface DryRunResult {
  seasonId: string
  /** Nombre total de bookings qui seront créés à la confirmation. */
  bookingsCount: number
  /** Nombre d'équipes couvertes (au moins un booking généré). */
  teamsCount: number
  /** Nombre de venues impliqués (`activeVenueIds` réellement utilisés). */
  venuesCount: number
  /** Nombre de slots en conflit détectés (>1 booking sur même court+heure). */
  conflictsCount: number
  /** Nombre de jours/sessions exclus par les closure periods. */
  closuresCount: number
  /**
   * Tronqué à ~20 lignes pour le rendu DataTable de la preview. La query
   * côté serveur renverra un sous-ensemble représentatif (chronologique).
   */
  preview: DryRunBookingPreview[]
}

/**
 * Quelques équipes/courts canons réutilisés par le mock — alignés sur le
 * design (Forêt / Vergers / Beaulieu, U14F / U16M / U20F / Seniors 1 M / 2 F).
 */
interface MockBookingTemplate {
  team: string
  court: string
  slotType: DryRunSlotType
  /** Jour de la semaine (0 = dimanche, 1 = lundi, …). */
  weekday: number
  /** Heure de début "HH:MM". */
  start: string
  /** Heure de fin "HH:MM". */
  end: string
}

const PREVIEW_TEMPLATES: readonly MockBookingTemplate[] = [
  { team: 'U14F', court: 'Forêt · Court A', slotType: 'training', weekday: 1, start: '17:00', end: '18:30' },
  { team: 'U14F', court: 'Forêt · Court A', slotType: 'training', weekday: 3, start: '17:00', end: '18:30' },
  { team: 'U16M', court: 'Forêt · Court B', slotType: 'training', weekday: 2, start: '18:30', end: '20:00' },
  { team: 'U16M', court: 'Forêt · Court B', slotType: 'training', weekday: 4, start: '18:30', end: '20:00' },
  { team: 'U20F', court: 'Vergers · Court A', slotType: 'training', weekday: 2, start: '17:30', end: '19:00' },
  { team: 'U20F', court: 'Vergers · Court A', slotType: 'training', weekday: 4, start: '17:30', end: '19:00' },
  { team: 'Seniors 1 M', court: 'Beaulieu · Court A', slotType: 'training', weekday: 1, start: '20:00', end: '22:00' },
  { team: 'Seniors 1 M', court: 'Beaulieu · Court A', slotType: 'training', weekday: 3, start: '20:00', end: '22:00' },
  { team: 'Seniors 2 F', court: 'Forêt · Court A', slotType: 'training', weekday: 5, start: '19:00', end: '21:00' },
  { team: 'U16M', court: 'Forêt · Court A+B', slotType: 'match-home', weekday: 6, start: '14:00', end: '16:00' },
  { team: 'U14F', court: 'Forêt · Court A', slotType: 'match-home', weekday: 6, start: '10:30', end: '12:00' },
  { team: 'Seniors 1 M', court: 'Beaulieu · Court A', slotType: 'match-home', weekday: 6, start: '18:00', end: '20:00' },
  { team: 'U20F', court: 'Vergers · Court A', slotType: 'match-home', weekday: 0, start: '11:00', end: '13:00' },
  { team: 'Seniors 2 F', court: 'Extérieur', slotType: 'match-away', weekday: 6, start: '16:00', end: '18:00' },
  { team: 'U16M', court: 'Extérieur', slotType: 'match-away', weekday: 0, start: '14:00', end: '16:00' },
  { team: 'U14F', court: 'Forêt · Court A', slotType: 'training', weekday: 1, start: '17:00', end: '18:30' },
  { team: 'U16M', court: 'Forêt · Court B', slotType: 'training', weekday: 2, start: '18:30', end: '20:00' },
  { team: 'U20F', court: 'Vergers · Court A', slotType: 'training', weekday: 2, start: '17:30', end: '19:00' },
  { team: 'Seniors 1 M', court: 'Beaulieu · Court A', slotType: 'training', weekday: 1, start: '20:00', end: '22:00' },
  { team: 'U14F', court: 'Forêt · Court A', slotType: 'training', weekday: 3, start: '17:00', end: '18:30' },
]

/**
 * Trouve la prochaine date qui tombe sur `weekday` à partir d'une base. Permet
 * de générer une preview chronologique cohérente à partir du `startDate` de la
 * saison.
 */
function dateForWeekday(base: Date, weekday: number, weekOffset: number): Date {
  const result = new Date(base.getTime())
  const baseDay = result.getDay()
  const diff = (weekday - baseDay + 7) % 7
  result.setDate(result.getDate() + diff + weekOffset * 7)
  return result
}

/**
 * Génère la preview d'activation d'une saison (B2).
 *
 * Implémentation mock : on prend la `SeasonRow` correspondante et on dérive
 * des counts approximatifs depuis ses champs (`teamsCount`, `bookingsCount`,
 * `closurePeriodIds.length`). On hydrate ~20 bookings à partir de
 * `PREVIEW_TEMPLATES` en datant chacun à partir de `startDate`.
 *
 * TODO(firestore): replace with callable result.
 *   `httpsCallable('previewSeasonActivation')({ seasonId }) → DryRunResult`
 *   Le callable consomme :
 *     - `/seasons/{seasonId}` (dates, activeVenueIds, closurePeriodIds)
 *     - `/teams` where activeSeasonIds array-contains seasonId
 *     - `/venues/{venueId}/timeSlots` for each active venue
 *     - `/closurePeriods` for each closurePeriodId
 *   et compile la liste exhaustive de bookings à créer + conflits + exclusions.
 */
export async function previewActivation(seasonId: string): Promise<DryRunResult | null> {
  // TODO(firestore): replace with callable Function `previewSeasonActivation`.
  const seed = SEEDS.find((s) => s.id === seasonId)
  if (!seed) return delay(null)

  // Counts : reprennent les valeurs déjà portées par le seed (cohérent avec la
  // liste Seasons). bookingsCount pour un draft est 0, on simule donc une
  // projection à partir de teamsCount × venuesCount × ~weeks.
  const venuesCount = seed.activeVenueIds.length
  const closuresCount = seed.closurePeriodIds.length

  // Projection naïve : 30 semaines effectives * ~3 sessions par équipe + matchs.
  const projectedBookings = seed.teamsCount === 0
    ? 0
    : Math.round(seed.teamsCount * (30 * 2.5 + 14))

  // Preview : ~20 lignes datées chronologiquement depuis seed.startDate.
  const previewLimit = Math.min(20, PREVIEW_TEMPLATES.length)
  const preview: DryRunBookingPreview[] = []
  for (let i = 0; i < previewLimit; i++) {
    const tpl = PREVIEW_TEMPLATES[i]
    if (!tpl) continue
    const weekOffset = Math.floor(i / 7)
    const date = dateForWeekday(seed.startDate, tpl.weekday, weekOffset)
    preview.push({
      id: `dry-run-${seasonId}-${i}`,
      date: ts(date),
      timeSlot: `${tpl.start} → ${tpl.end}`,
      court: tpl.court,
      team: tpl.team,
      slotType: tpl.slotType,
    })
  }

  const result: DryRunResult = {
    seasonId,
    bookingsCount: projectedBookings,
    teamsCount: seed.teamsCount,
    venuesCount,
    // Pour v1, on annonce 0 conflit — la détection réelle se fait côté serveur.
    conflictsCount: 0,
    closuresCount,
    preview,
  }
  return delay(result)
}

// ---------------------------------------------------------------------------
// Création de saison (B3 — wizard)
// ---------------------------------------------------------------------------

/**
 * Payload du wizard 4-étapes (B3). On reste lisible et plat : `name` + dates
 * + sélection booléenne des `teamIds` participantes + sélection des
 * `venueIds` actifs. Le `closurePeriodIds` n'est pas couvert par le wizard
 * v1 (l'admin l'éditera ensuite via la page détail saison).
 */
export interface CreateSeasonInput {
  name: string
  startDate: Date
  endDate: Date
  /**
   * Ids d'équipes à inscrire dans la saison. Côté Firestore : update parallèle
   * de `/teams/{id}.activeSeasonIds` (array union). Ici on stocke juste le
   * count dans le row mocké.
   */
  teamIds: string[]
  /** Ids de venues à activer (= `activeVenueIds` du doc saison). */
  venueIds: string[]
  /** Libellés des venues sélectionnées — utilisés pour la colonne Venues. */
  venueLabels: string[]
}

/**
 * Crée une nouvelle saison en `draft` (B3).
 *
 * Implémentation mock : push d'un `MockSeasonSeed` dans le singleton SEEDS et
 * renvoi du `SeasonRow` correspondant pour permettre au store d'`upsert()`.
 *
 * TODO(firestore): remplacer par
 *   `addDoc('/seasons', { name, startDate: Timestamp, endDate: Timestamp,
 *                        status: 'draft', activeVenueIds, closurePeriodIds: [],
 *                        generatedAt: null })`
 *   + boucle `updateDoc('/teams/{id}', { activeSeasonIds: arrayUnion(seasonId) })`
 *   pour chaque teamId. Toute la séquence peut être consolidée dans un
 *   callable `createSeason` pour rester atomique côté serveur.
 */
export async function createSeason(input: CreateSeasonInput): Promise<SeasonRow> {
  // TODO(firestore): replace by callable `createSeason` (atomic batch).
  const id = `mock-season-new-${Date.now()}`
  const newSeed: MockSeasonSeed = {
    id,
    name: input.name,
    startDate: input.startDate,
    endDate: input.endDate,
    status: 'draft',
    activeVenueIds: [...input.venueIds],
    closurePeriodIds: [],
    generatedAt: null,
    teamsCount: input.teamIds.length,
    bookingsCount: 0,
    venueLabels: [...input.venueLabels],
  }
  SEEDS.push(newSeed)
  return delay(seedToRow(newSeed))
}
