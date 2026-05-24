import { FirebaseError } from 'firebase/app'
import {
  collection,
  collectionGroup,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  query,
  where,
  type Timestamp as FirestoreTimestamp,
} from 'firebase/firestore'
import type { ClubConfig, Member, MemberData } from '@club-app/shared-types'
import { db } from '@/services/firebase'

/**
 * Repository Officials — Firestore-backed.
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase (cf.
 * docs/frontend-desktop.md — architecture en couches). Consommée par
 * `stores/officials.ts` puis `views/Officials.vue`.
 *
 * ## Modèle de charge / "load status"
 *
 * Le schéma `/config/club.officialsConfig` (cf. `packages/shared-types/src/config.ts`)
 * expose deux seuils :
 *   - `thresholdGreen` : à partir de N matches confirmés sur la saison, l'officiel
 *     est "rentable" (vert).
 *   - `thresholdOrange` : en dessous de cette valeur, l'officiel passe en
 *     "rouge" (sous-utilisé, on paie sa licence pour rien). Entre les deux,
 *     on est en "orange" (à risque).
 *
 * Pour l'écran Officials, on étend ce modèle à 4 niveaux ("low" / "ok" / "high"
 * / "critical") afin de capturer aussi la sur-sollicitation (zones où le
 * référé risque le burnout) :
 *   - `critical` : 0 confirmé OU > thresholdGreen × 1.5 (très en-dessous /
 *     très au-dessus → action immédiate).
 *   - `low`      : ∈ ]0, thresholdOrange[  (sous-utilisé, risque rentabilité).
 *   - `ok`       : ∈ [thresholdOrange, thresholdGreen × 1.5]  (zone saine).
 *   - `high`     : ∈ ]thresholdGreen, thresholdGreen × 1.5]   (chargé mais
 *                  encore acceptable — alerte douce).
 *
 * NB : `thresholdGreen / thresholdOrange` ne fournissent pas explicitement de
 * borne haute "max matches" — on dérive une cible haute = `thresholdGreen ×
 * 1.5` parce que c'est l'heuristique simple qui ne nécessite PAS de nouveau
 * champ dans `OfficialsConfig`. Quand `maxMatchesPerSeason` sera ajouté au
 * schéma, remplacer `softCap` ci-dessous par `config.maxMatchesPerSeason`.
 *
 * ## Définition d'un "official"
 *
 * Le modèle de rôles est additif (cf. docs/main.md "Rôles additifs"). Un
 * membre est officiel si `roles` contient `'official'`. Le champ
 * `officialLevel` (1 ou 2) est manuel et indépendant ; il peut être null pour
 * un official non encore qualifié — on l'affiche tout de même dans la liste
 * mais en `—`.
 *
 * ## Stratégie de comptage
 *
 * Pour compter les `officialAssignments` de la saison active par membre, on
 * utilise un `collectionGroup('officialAssignments')`. La query ne porte PAS
 * de filtre `seasonId` (l'attribut vit sur le booking parent, pas sur
 * l'assignation) — on filtre côté client après avoir batch-load les
 * bookings parents par chunks de 10 (limite `where in`).
 *
 * TODO(firestore): `collectionGroup('officialAssignments')` nécessite un
 * index composite si on ajoute des filtres (status). Pour v1 on lit tout et
 * on filtre / agrège côté client — acceptable tant que la volume reste
 * raisonnable (~ saison × ~30 matchs × ~3 officials assignés). Si l'index
 * manque ou si la query est refusée (`failed-precondition` côté SDK), on
 * dégrade en renvoyant `assignmentsThisSeason: 0` pour tout le monde — la
 * liste reste exploitable.
 */

const MEMBERS = 'members'
const BOOKINGS = 'bookings'
const SEASONS = 'seasons'
const CONFIG_DOC = 'club'
const CONFIG_COLL = 'config'

// ---------------------------------------------------------------------------
// Types exposés
// ---------------------------------------------------------------------------

/** Label dérivé de la charge — drive la couleur du Pill côté UI. */
export type OfficialLoadStatus = 'low' | 'ok' | 'high' | 'critical'

/**
 * Ligne enrichie pour la liste Officials. Étend `Member` avec les comptes
 * dérivés des `officialAssignments` de la saison active.
 */
export interface OfficialRow extends Member {
  assignmentsThisSeason: number
  confirmedThisSeason: number
  pendingThisSeason: number
  declinedThisSeason: number
  loadStatus: OfficialLoadStatus
}

/** Seuils déduits de `/config/club.officialsConfig`, lisibles tels quels par la vue. */
export interface OfficialsThresholds {
  /** `thresholdOrange` — borne basse (sous = "low" ou "critical"). */
  min: number
  /** `thresholdGreen × 1.5` — borne haute (sur = "high" ou "critical"). */
  max: number
  /** Cible centrale `thresholdGreen` — utilisée pour la MiniBar. */
  target: number
}

// ---------------------------------------------------------------------------
// Lecture saison active + config
// ---------------------------------------------------------------------------

/** Charge la saison active ; null si aucune. */
export async function fetchActiveSeasonId(): Promise<string | null> {
  try {
    const q = query(
      collection(db, SEASONS),
      where('status', '==', 'active'),
      limit(1),
    )
    const snap = await getDocs(q)
    const first = snap.docs[0]
    return first ? first.id : null
  } catch (err: unknown) {
    if (err instanceof FirebaseError && err.code === 'permission-denied') {
      return null
    }
    throw err
  }
}

const DEFAULT_THRESHOLDS: OfficialsThresholds = {
  min: 3,
  max: 9, // 6 × 1.5
  target: 6,
}

/**
 * Lit `/config/club.officialsConfig` et dérive `{ min, max, target }`. Si le
 * doc n'existe pas ou que la rule rejette la lecture, on retombe sur les
 * valeurs par défaut (alignées sur celles utilisées par le Dashboard).
 */
export async function fetchOfficialsThresholds(): Promise<OfficialsThresholds> {
  try {
    const snap = await getDoc(doc(db, CONFIG_COLL, CONFIG_DOC))
    if (!snap.exists()) return DEFAULT_THRESHOLDS
    const data = snap.data() as Partial<ClubConfig>
    const cfg = data.officialsConfig
    if (!cfg) return DEFAULT_THRESHOLDS
    const target = cfg.thresholdGreen
    return {
      min: cfg.thresholdOrange,
      // Pas de "max" explicite dans le schéma : heuristique target × 1.5.
      // À remplacer quand `OfficialsConfig.maxMatchesPerSeason` existera.
      max: Math.round(target * 1.5),
      target,
    }
  } catch (err: unknown) {
    if (err instanceof FirebaseError && err.code === 'permission-denied') {
      return DEFAULT_THRESHOLDS
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// Comptage des assignments — collectionGroup + batch-join bookings
// ---------------------------------------------------------------------------

interface AssignmentCounts {
  confirmed: number
  pending: number
  declined: number
}

const EMPTY_COUNTS: AssignmentCounts = { confirmed: 0, pending: 0, declined: 0 }

/**
 * Renvoie une map `memberId → counts` pour la saison fournie. Si la query
 * collectionGroup échoue (index manquant / permission-denied), on renvoie
 * une map vide — la vue affichera tout le monde en `critical` (0 confirmé).
 */
async function buildCountsBySeason(
  seasonId: string,
): Promise<Map<string, AssignmentCounts>> {
  const map = new Map<string, AssignmentCounts>()

  const snapDocs: { memberId: string; status: string; bookingId: string }[] = []
  try {
    const cgSnap = await getDocs(collectionGroup(db, 'officialAssignments'))
    for (const d of cgSnap.docs) {
      const parent = d.ref.parent.parent
      if (!parent) continue
      const data = d.data() as { memberId: string; status: string }
      snapDocs.push({
        memberId: data.memberId,
        status: data.status,
        bookingId: parent.id,
      })
    }
  } catch (err: unknown) {
    // TODO(firestore): collectionGroup query needs index sur officialAssignments.memberId
    // + parent booking.seasonId. En attendant, dégradation silencieuse.
    if (
      err instanceof FirebaseError &&
      (err.code === 'permission-denied' || err.code === 'failed-precondition')
    ) {
      return map
    }
    throw err
  }
  if (snapDocs.length === 0) return map

  // Batch-load des bookings parents pour récupérer `seasonId`. Chunks de 10.
  const bookingIds = Array.from(new Set(snapDocs.map((s) => s.bookingId)))
  const bookingSeasonIds = new Map<string, string>()
  for (let i = 0; i < bookingIds.length; i += 10) {
    const chunk = bookingIds.slice(i, i + 10)
    try {
      const bq = query(
        collection(db, BOOKINGS),
        where(documentId(), 'in', chunk),
      )
      const bs = await getDocs(bq)
      for (const bd of bs.docs) {
        const data = bd.data() as { seasonId?: string }
        if (data.seasonId) bookingSeasonIds.set(bd.id, data.seasonId)
      }
    } catch (err: unknown) {
      if (
        err instanceof FirebaseError &&
        err.code === 'permission-denied'
      ) {
        // On ignore le chunk inacessible — les assignments correspondants
        // resteront non comptabilisés (équivalent "saison inconnue").
        continue
      }
      throw err
    }
  }

  // Agréger par memberId, filtré par saison active.
  for (const row of snapDocs) {
    if (bookingSeasonIds.get(row.bookingId) !== seasonId) continue
    const cur = map.get(row.memberId) ?? { ...EMPTY_COUNTS }
    if (row.status === 'confirmed') cur.confirmed += 1
    else if (row.status === 'pending') cur.pending += 1
    else if (row.status === 'declined') cur.declined += 1
    map.set(row.memberId, cur)
  }
  return map
}

// ---------------------------------------------------------------------------
// Classement load
// ---------------------------------------------------------------------------

/**
 * Classe un officiel d'après ses confirmations sur la saison. Voir
 * commentaire en haut du fichier pour le détail des seuils.
 */
function computeLoadStatus(
  confirmed: number,
  thresholds: OfficialsThresholds,
): OfficialLoadStatus {
  // 0 confirmé OU au-dessus de la borne haute → critical.
  if (confirmed === 0) return 'critical'
  if (confirmed > thresholds.max) return 'critical'
  if (confirmed < thresholds.min) return 'low'
  if (confirmed > thresholds.target) return 'high'
  return 'ok'
}

// ---------------------------------------------------------------------------
// Listing public
// ---------------------------------------------------------------------------

/**
 * Liste tous les officials du club avec leurs comptes d'assignations sur la
 * saison active. Si `seasonId` est `null` (aucune saison active), on renvoie
 * la liste avec tous les compteurs à 0 et `loadStatus = "critical"` —
 * l'écran masquera la zone "load" via un état vide dédié.
 */
export async function listOfficialsWithLoad(
  seasonId: string | null,
): Promise<OfficialRow[]> {
  // 1) Lire la liste des officials. `roles` est un `string[]` côté schéma —
  //    Firestore expose `array-contains` pour ce cas.
  //
  //    NB : on N'utilise PAS `orderBy('lastName')` côté Firestore. Raison :
  //    Firestore exclut silencieusement les documents où le champ trié est
  //    absent / null — un member créé via bootstrap script (admin rootAdmin
  //    p.ex.) ou via une callable qui n'aurait pas renseigné `lastName`
  //    disparaîtrait de la liste sans erreur ni log. Cohérent avec
  //    CLAUDE.md racine §10 (« simple query + tri JS, pas d'index composite »)
  //    : le volume officiel par club reste très faible (< 100 docs).
  let officialDocs: Array<{ id: string; data: MemberData }>
  try {
    const q = query(
      collection(db, MEMBERS),
      where('roles', 'array-contains', 'official'),
    )
    const snap = await getDocs(q)
    officialDocs = snap.docs.map((d) => ({
      id: d.id,
      data: d.data() as MemberData,
    }))
  } catch (err: unknown) {
    if (err instanceof FirebaseError && err.code === 'permission-denied') {
      return []
    }
    throw err
  }
  if (officialDocs.length === 0) return []

  // Diagnostic défensif : on signale les members avec `'official'` dans
  // `roles` mais sans `lastName` — ils auraient été silencieusement exclus
  // par un `orderBy('lastName')` côté Firestore. Permet de remonter le cas à
  // l'admin pour qu'il complète la fiche (pas de migration automatique).
  for (const od of officialDocs) {
    if (!od.data.lastName || od.data.lastName.trim() === '') {
      console.warn(
        `[officials.repo] member ${od.id} has role 'official' but missing/empty lastName — fiche à compléter (firstName="${od.data.firstName ?? ''}")`,
      )
    }
  }

  // Tri JS-side. `localeCompare(_, 'fr')` gère correctement les accents (é,
  // è, à, …). Les docs sans lastName remontent en début de liste (string
  // vide) — pratique pour qu'ils sautent aux yeux.
  officialDocs.sort((a, b) =>
    (a.data.lastName ?? '').localeCompare(b.data.lastName ?? '', 'fr', {
      sensitivity: 'base',
    }),
  )

  // 2) Charger les seuils + les counts en parallèle.
  const [thresholds, countsByMember] = await Promise.all([
    fetchOfficialsThresholds(),
    seasonId
      ? buildCountsBySeason(seasonId)
      : Promise.resolve(new Map<string, AssignmentCounts>()),
  ])

  // 3) Composer les rows.
  return officialDocs.map(({ id, data }) => {
    const counts = countsByMember.get(id) ?? EMPTY_COUNTS
    const assignmentsThisSeason =
      counts.confirmed + counts.pending + counts.declined
    const loadStatus = seasonId
      ? computeLoadStatus(counts.confirmed, thresholds)
      : 'critical'
    return {
      id,
      ...data,
      assignmentsThisSeason,
      confirmedThisSeason: counts.confirmed,
      pendingThisSeason: counts.pending,
      declinedThisSeason: counts.declined,
      loadStatus,
    }
  })
}

// ---------------------------------------------------------------------------
// Métriques de tracking — tab "Officiels" (livré 2026-05-24)
// ---------------------------------------------------------------------------

/**
 * Seuil au-delà duquel une assignation est considérée comme « prise à la
 * dernière minute » : si le delta `match.date+startTime - assignedAt` est
 * inférieur à cette valeur (en heures), on incrémente `lastMinuteClaims`.
 *
 * Valeur par défaut 48 h, configurable par `/config/club.officialsConfig
 * .lastMinuteThresholdHours` (champ optionnel — `48` quand absent).
 */
const DEFAULT_LAST_MINUTE_THRESHOLD_HOURS = 48

/**
 * Compteurs étendus par officiel sur une saison. Reprend `confirmed` / `pending`
 * / `declined` (déjà calculés par `buildCountsBySeason`) et ajoute les deux
 * métriques de tracking exposées dans le tab "Officiels" :
 *  - `lastMinuteClaims` : assignations confirmed dont le delta
 *    `(match.date+startTime) - assignment.assignedAt` est inférieur à
 *    `lastMinuteThresholdHours` (heuristique « pris à la dernière minute »).
 *  - `replacementsRequested` : assignations où `replacementRequestedAt != null`
 *    (un remplacement a été demandé, indépendamment du statut courant).
 *
 * Ces métriques sont best-effort : un échec de lecture sur le booking parent
 * (rule denied / index manquant) dégrade silencieusement la valeur à `0` pour
 * l'officiel concerné — la vue reste exploitable.
 */
export interface OfficialMetrics {
  confirmed: number
  pending: number
  declined: number
  lastMinuteClaims: number
  replacementsRequested: number
}

const EMPTY_METRICS: OfficialMetrics = {
  confirmed: 0,
  pending: 0,
  declined: 0,
  lastMinuteClaims: 0,
  replacementsRequested: 0,
}

/** Combine date Firestore (00:00 local) + "HH:MM" → Date ; null si invalide. */
function combineBookingDateAndTime(
  date: FirestoreTimestamp | null | undefined,
  startTime: string | null | undefined,
): Date | null {
  if (!date || typeof date.seconds !== 'number') return null
  if (!startTime || !/^\d{2}:\d{2}$/.test(startTime)) return null
  const base = new Date(date.seconds * 1000)
  const [hStr, mStr] = startTime.split(':')
  const h = Number(hStr)
  const m = Number(mStr)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  base.setHours(h, m, 0, 0)
  return base
}

/** Lit `lastMinuteThresholdHours` depuis `/config/club.officialsConfig` (default 48). */
export async function fetchLastMinuteThresholdHours(): Promise<number> {
  try {
    const snap = await getDoc(doc(db, CONFIG_COLL, CONFIG_DOC))
    if (!snap.exists()) return DEFAULT_LAST_MINUTE_THRESHOLD_HOURS
    const data = snap.data() as Partial<ClubConfig> & {
      officialsConfig?: { lastMinuteThresholdHours?: number }
    }
    const cfg = data.officialsConfig
    const value = cfg?.lastMinuteThresholdHours
    if (typeof value === 'number' && value > 0) return value
    return DEFAULT_LAST_MINUTE_THRESHOLD_HOURS
  } catch (err: unknown) {
    if (err instanceof FirebaseError && err.code === 'permission-denied') {
      return DEFAULT_LAST_MINUTE_THRESHOLD_HOURS
    }
    throw err
  }
}

/**
 * Variante enrichie de `buildCountsBySeason` qui ajoute `lastMinuteClaims` et
 * `replacementsRequested`.
 *
 * Stratégie :
 *  1. collectionGroup('officialAssignments') — lit tous les docs (memberId,
 *     status, assignedAt, replacementRequestedAt, bookingId).
 *  2. Batch-load des bookings parents (`/bookings` par chunks de 10 sur
 *     `documentId() in`) pour récupérer `seasonId` + `date` + `startTime`.
 *  3. Pour chaque assignation appartenant à la saison cible :
 *     - `status === 'confirmed'` : incrémente `confirmed` ; si
 *       `(match.date+startTime - assignedAt) < thresholdHours` → incrémente
 *       `lastMinuteClaims`.
 *     - `status === 'pending' | 'declined'` : incrémente compteur dédié.
 *     - `replacementRequestedAt != null` (quel que soit le statut) :
 *       incrémente `replacementsRequested`.
 *
 * Pas de double-comptage : les compteurs `confirmed` / `pending` / `declined`
 * restent mutuellement exclusifs (status), `lastMinuteClaims` est un
 * sous-ensemble de `confirmed`, `replacementsRequested` est orthogonal.
 *
 * Note : les `/matches/{id}/officialAssignments` (matchs AWAY) sont **inclus**
 * via le collectionGroup, mais leur parent n'est pas un `/bookings/{id}` —
 * pour la saison courante ils sont donc filtrés out (la `seasonId` vit sur le
 * booking, pas sur le match away). Acceptable pour le MVP — à raffiner si
 * besoin (lire `/matches/{id}.date` quand parent path commence par `matches/`).
 */
export async function buildOfficialMetricsBySeason(
  seasonId: string,
  thresholdHours: number = DEFAULT_LAST_MINUTE_THRESHOLD_HOURS,
): Promise<Map<string, OfficialMetrics>> {
  const map = new Map<string, OfficialMetrics>()

  interface SnapDoc {
    memberId: string
    status: string
    bookingId: string
    parentKind: 'booking' | 'match'
    assignedAt: FirestoreTimestamp | null
    replacementRequestedAt: FirestoreTimestamp | null
  }

  const snapDocs: SnapDoc[] = []
  try {
    const cgSnap = await getDocs(collectionGroup(db, 'officialAssignments'))
    for (const d of cgSnap.docs) {
      const parent = d.ref.parent.parent
      if (!parent) continue
      const data = d.data() as {
        memberId: string
        status: string
        assignedAt?: FirestoreTimestamp | null
        replacementRequestedAt?: FirestoreTimestamp | null
      }
      // Parent peut être `/bookings/{id}` ou `/matches/{id}` (cf. away).
      const parentPath = parent.parent?.id ?? null
      const parentKind: 'booking' | 'match' =
        parentPath === 'matches' ? 'match' : 'booking'
      snapDocs.push({
        memberId: data.memberId,
        status: data.status,
        bookingId: parent.id,
        parentKind,
        assignedAt: data.assignedAt ?? null,
        replacementRequestedAt: data.replacementRequestedAt ?? null,
      })
    }
  } catch (err: unknown) {
    if (
      err instanceof FirebaseError &&
      (err.code === 'permission-denied' || err.code === 'failed-precondition')
    ) {
      return map
    }
    throw err
  }
  if (snapDocs.length === 0) return map

  // Batch-load des bookings parents (kind='booking' uniquement — les matchs
  // AWAY n'ont pas de seasonId dénormalisée côté `/matches`).
  const bookingIds = Array.from(
    new Set(
      snapDocs
        .filter((s) => s.parentKind === 'booking')
        .map((s) => s.bookingId),
    ),
  )
  const bookings = new Map<
    string,
    { seasonId: string; date: FirestoreTimestamp | null; startTime: string | null }
  >()
  for (let i = 0; i < bookingIds.length; i += 10) {
    const chunk = bookingIds.slice(i, i + 10)
    try {
      const bq = query(
        collection(db, BOOKINGS),
        where(documentId(), 'in', chunk),
      )
      const bs = await getDocs(bq)
      for (const bd of bs.docs) {
        const data = bd.data() as {
          seasonId?: string
          date?: FirestoreTimestamp | null
          startTime?: string | null
        }
        if (data.seasonId) {
          bookings.set(bd.id, {
            seasonId: data.seasonId,
            date: data.date ?? null,
            startTime: data.startTime ?? null,
          })
        }
      }
    } catch (err: unknown) {
      if (err instanceof FirebaseError && err.code === 'permission-denied') {
        continue
      }
      throw err
    }
  }

  const MS_PER_HOUR = 60 * 60 * 1000

  for (const row of snapDocs) {
    // Filtre saison : on ne garde que les assignments sur un booking de la
    // saison cible. (Matchs away ignorés cf. note du JSDoc.)
    if (row.parentKind !== 'booking') continue
    const booking = bookings.get(row.bookingId)
    if (!booking || booking.seasonId !== seasonId) continue

    const cur: OfficialMetrics = map.get(row.memberId) ?? { ...EMPTY_METRICS }

    if (row.status === 'confirmed') {
      cur.confirmed += 1
      // Last-minute : delta `(match.date+startTime) - assignedAt` en heures.
      const matchStart = combineBookingDateAndTime(booking.date, booking.startTime)
      const assignedAtMs = row.assignedAt?.seconds
        ? row.assignedAt.seconds * 1000
        : null
      if (matchStart !== null && assignedAtMs !== null) {
        const deltaHours = (matchStart.getTime() - assignedAtMs) / MS_PER_HOUR
        // On exclut les deltas négatifs (assignation après le début du match —
        // anomalie) du bucket « last-minute » : ce sont des cas spéciaux, pas
        // une dérive normale.
        if (deltaHours >= 0 && deltaHours < thresholdHours) {
          cur.lastMinuteClaims += 1
        }
      }
    } else if (row.status === 'pending') {
      cur.pending += 1
    } else if (row.status === 'declined') {
      cur.declined += 1
    }

    if (row.replacementRequestedAt !== null) {
      cur.replacementsRequested += 1
    }

    map.set(row.memberId, cur)
  }
  return map
}

/**
 * Ligne enrichie pour le tab "Officiels" — étend `OfficialRow` avec les
 * métriques de tracking + un flag de licence active saison.
 */
export interface OfficialMetricsRow extends OfficialRow {
  /** Nb de matchs pris « last-minute » (delta confirmé < threshold). */
  lastMinuteThisSeason: number
  /** Nb de remplacements demandés sur la saison (assignations marquées). */
  replacementsRequestedThisSeason: number
  /**
   * `true` si le membre a une licence officiel active pour la saison courante
   * (`member.officialLicense.seasonId === seasonId`). Faux sinon, y compris
   * quand `officialLicense` est `null` (qualifié mais pas actif).
   */
  hasActiveOfficialLicenseThisSeason: boolean
}

/**
 * Liste les officials avec leurs métriques enrichies pour le tab "Officiels".
 * Compose `listOfficialsWithLoad` (load + thresholds + counts standards) et
 * `buildOfficialMetricsBySeason` (last-minute + remplacements).
 *
 * Si `seasonId` est `null` : aucune métrique calculée (toutes à 0), licence
 * jamais active. La vue affiche un état "aucune saison active" via le
 * banner existant.
 */
export async function listOfficialsWithMetrics(
  seasonId: string | null,
): Promise<OfficialMetricsRow[]> {
  // 1) Liste de base avec load/counts standards (réutilise l'existant).
  const baseRows = await listOfficialsWithLoad(seasonId)
  if (baseRows.length === 0 || seasonId === null) {
    return baseRows.map((r) => ({
      ...r,
      lastMinuteThisSeason: 0,
      replacementsRequestedThisSeason: 0,
      hasActiveOfficialLicenseThisSeason: false,
    }))
  }

  // 2) Métriques enrichies en parallèle (threshold lu côté config).
  const threshold = await fetchLastMinuteThresholdHours()
  const metricsByMember = await buildOfficialMetricsBySeason(
    seasonId,
    threshold,
  )

  // 3) Compose.
  return baseRows.map((r) => {
    const m = metricsByMember.get(r.id) ?? EMPTY_METRICS
    const hasActive =
      r.officialLicense !== null && r.officialLicense.seasonId === seasonId
    return {
      ...r,
      lastMinuteThisSeason: m.lastMinuteClaims,
      replacementsRequestedThisSeason: m.replacementsRequested,
      hasActiveOfficialLicenseThisSeason: hasActive,
    }
  })
}

// ---------------------------------------------------------------------------
// Demande de remplacement — pose `replacementRequestedAt` sur l'assignation
// ---------------------------------------------------------------------------

/**
 * Marque une assignation comme « remplacement demandé ».
 *
 * Write client-direct : les rules sur `/bookings/{id}/officialAssignments` et
 * `/matches/{id}/officialAssignments` autorisent l'officiel à muter le sous-
 * ensemble `[status, respondedAt, replacementRequestedAt, replacementRequestedByUid]`
 * sur sa propre assignation (cf. `firestore.rules` — PR Tab Officiels). L'admin
 * peut aussi muter (les rules `isAdmin() || isRootAdmin()` couvrent).
 *
 * `parentKind` discrimine le path Firestore (booking vs match away).
 */
export async function requestReplacement(input: {
  parentKind: 'booking' | 'match'
  parentId: string
  assignmentId: string
  requestedByUid: string
}): Promise<void> {
  const root = input.parentKind === 'booking' ? BOOKINGS : 'matches'
  const { updateDoc, serverTimestamp } = await import('firebase/firestore')
  try {
    await updateDoc(
      doc(db, root, input.parentId, 'officialAssignments', input.assignmentId),
      {
        replacementRequestedAt: serverTimestamp(),
        replacementRequestedByUid: input.requestedByUid,
      },
    )
  } catch (err: unknown) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`requestReplacement failed [${code}]`, err)
    throw err
  }
}
