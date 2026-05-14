import { FirebaseError } from 'firebase/app'
import {
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
  let officialDocs: Array<{ id: string; data: MemberData }>
  try {
    const q = query(
      collection(db, MEMBERS),
      where('roles', 'array-contains', 'official'),
      orderBy('lastName'),
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
