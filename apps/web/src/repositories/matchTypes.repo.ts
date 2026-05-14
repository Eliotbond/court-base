import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type DocumentData,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
  type UpdateData,
} from 'firebase/firestore'
import { db } from '@/services/firebase'
import type {
  CourtSize,
  MatchType,
  MatchTypeData,
  OfficialRequirement,
} from '@club-app/shared-types'

/**
 * Repository MatchTypes — référentiel des types de compétition (CSJC, AFBB,
 * Amical, …). Définit les besoins officiels (`homeOfficialRequirements`) et
 * la taille de court requise.
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase
 * (cf. docs/frontend-desktop.md — architecture en couches). Les writes
 * passent par `/matchTypes/{matchTypeId}` (rules : isAdmin || isRootAdmin).
 *
 * Le doc est référencé par `/bookings.matchTypeId` (cf. bookings.repo.ts) — un
 * garde-fou côté `deleteMatchType` interdit la suppression d'un type encore
 * utilisé par au moins un booking. Pour archiver, basculer `active: false`.
 *
 * Schéma `/matchTypes/{matchTypeId}` : voir docs/firebase.md et
 * `packages/shared-types/src/matchType.ts`.
 */

const MATCH_TYPES = 'matchTypes'
const BOOKINGS = 'bookings'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convertit un snapshot Firestore en `MatchType` typé. */
export function snapToMatchType(
  snap: QueryDocumentSnapshot | DocumentSnapshot,
): MatchType {
  const data = snap.data() as MatchTypeData
  return { id: snap.id, ...data }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Liste tous les types de match. Filtrage `active` fait côté client — la
 * collection est petite (référentiel club, ordre de magnitude ~dizaines).
 * Tri par `name` côté client pour offrir un ordre stable dans le Select.
 */
export async function listMatchTypes(
  opts: { activeOnly?: boolean } = {},
): Promise<MatchType[]> {
  const snap = await getDocs(query(collection(db, MATCH_TYPES)))
  if (snap.empty) return []
  let rows = snap.docs.map(snapToMatchType)
  if (opts.activeOnly) rows = rows.filter((m) => m.active)
  rows.sort((a, b) => a.name.localeCompare(b.name))
  return rows
}

/** Récupère un type de match par son id. */
export async function getMatchTypeById(id: string): Promise<MatchType | null> {
  const snap = await getDoc(doc(db, MATCH_TYPES, id))
  if (!snap.exists()) return null
  return snapToMatchType(snap)
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface MatchTypeInput {
  name: string
  requiredCourtSize: CourtSize
  homeOfficialRequirements: OfficialRequirement[]
  awayOfficialCount: number
  /** Couleur hex `#RRGGBB`. */
  color: string
  active: boolean
}

/**
 * Crée un nouveau type de match. Retourne le doc rafraîchi pour permettre à
 * l'UI d'upsert le state local sans re-fetch global.
 */
export async function createMatchType(input: MatchTypeInput): Promise<MatchType> {
  const ref = await addDoc(collection(db, MATCH_TYPES), {
    name: input.name,
    requiredCourtSize: input.requiredCourtSize,
    homeOfficialRequirements: input.homeOfficialRequirements,
    awayOfficialCount: input.awayOfficialCount,
    color: input.color,
    active: input.active,
    createdAt: serverTimestamp(),
  })
  const created = await getMatchTypeById(ref.id)
  if (!created) {
    throw new Error(`Failed to read matchType ${ref.id} just after creation`)
  }
  return created
}

/** Patch partiel sur `/matchTypes/{id}`. Renvoie le doc rafraîchi. */
export async function updateMatchType(
  id: string,
  patch: Partial<MatchTypeInput>,
): Promise<MatchType | null> {
  const update: UpdateData<DocumentData> = {}
  if (patch.name !== undefined) update.name = patch.name
  if (patch.requiredCourtSize !== undefined) {
    update.requiredCourtSize = patch.requiredCourtSize
  }
  if (patch.homeOfficialRequirements !== undefined) {
    update.homeOfficialRequirements = patch.homeOfficialRequirements
  }
  if (patch.awayOfficialCount !== undefined) {
    update.awayOfficialCount = patch.awayOfficialCount
  }
  if (patch.color !== undefined) update.color = patch.color
  if (patch.active !== undefined) update.active = patch.active
  if (Object.keys(update).length === 0) return getMatchTypeById(id)
  await updateDoc(doc(db, MATCH_TYPES, id), update)
  return getMatchTypeById(id)
}

/**
 * Compte (binaire : 0 ou 1) les bookings référençant ce match type. Utilise
 * un `limit(1)` au lieu de `getCountFromServer` pour minimiser les reads —
 * on a juste besoin de savoir si le type est référencé ou pas.
 */
export async function isMatchTypeUsed(id: string): Promise<boolean> {
  const snap = await getDocs(
    query(
      collection(db, BOOKINGS),
      where('matchTypeId', '==', id),
      limit(1),
    ),
  )
  return !snap.empty
}

/**
 * Supprime un type de match. Refuse si au moins un booking le référence — en
 * pratique on encourage la désactivation (`active: false`) plutôt que la
 * suppression d'un type historique. Lance `'matchType in use'` pour permettre
 * à l'UI d'afficher un message dédié (suggérer la désactivation).
 */
export async function deleteMatchType(id: string): Promise<void> {
  const used = await isMatchTypeUsed(id)
  if (used) {
    throw new Error(
      'matchType in use — désactivez-le plutôt que de le supprimer.',
    )
  }
  await deleteDoc(doc(db, MATCH_TYPES, id))
}
