import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  orderBy,
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
import type { CotisationType, CotisationTypeData } from '@club-app/shared-types'

/**
 * Repository CotisationTypes — référentiel des **types de cotisation**
 * (templates de pricing : Junior, Senior, …) éditable par l'admin.
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase
 * (cf. docs/frontend-desktop.md — architecture en couches). Les writes passent
 * par `/cotisations/{cotisationTypeId}` (rules : isAdmin || isRootAdmin).
 *
 * NB sémantique : la collection Firestore reste nommée `'cotisations'` (string
 * inchangée pour éviter une migration data). Côté code, on parle de
 * `CotisationType` (analogue à `licenseTypes` / `matchTypes`) pour réserver
 * le mot "cotisation" aux factures membres (ex-`Due`, géré par un autre
 * module).
 *
 * Référencé par `/teams.cotisationId` (cf. teams.repo.ts) — le nom et le prix
 * sont résolus à la lecture, pas dénormalisés. Voir docs/firebase.md
 * (`/cotisations`) et docs/main.md ("Cotisations") pour le lifecycle complet.
 */

const COTISATIONS = 'cotisations'
const TEAMS = 'teams'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convertit un snapshot Firestore en `CotisationType` typé. */
export function snapToCotisationType(
  snap: QueryDocumentSnapshot | DocumentSnapshot,
): CotisationType {
  const data = snap.data() as CotisationTypeData
  return { id: snap.id, ...data }
}

/**
 * Comparator stable pour l'affichage : `displayOrder asc`, puis `name asc`.
 * Utilisé côté client puisque la collection est petite (référentiel club,
 * ordre de magnitude ~dizaines).
 */
function compareCotisationTypes(a: CotisationType, b: CotisationType): number {
  if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder
  return a.name.localeCompare(b.name)
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Liste les types de cotisation. Tri primaire `displayOrder asc` (Firestore),
 * tri secondaire `name asc` (côté client).
 *
 * `activeOnly` filtre côté client — pas besoin d'index composite, la
 * collection reste petite (référentiel admin).
 */
export async function listCotisationTypes(
  opts: { activeOnly?: boolean } = {},
): Promise<CotisationType[]> {
  const snap = await getDocs(
    query(collection(db, COTISATIONS), orderBy('displayOrder')),
  )
  if (snap.empty) return []
  let rows = snap.docs.map(snapToCotisationType)
  if (opts.activeOnly) rows = rows.filter((c) => c.active)
  rows.sort(compareCotisationTypes)
  return rows
}

/** Récupère un type de cotisation par son id. */
export async function getCotisationTypeById(
  id: string,
): Promise<CotisationType | null> {
  const snap = await getDoc(doc(db, COTISATIONS, id))
  if (!snap.exists()) return null
  return snapToCotisationType(snap)
}

/**
 * Compte les équipes référençant ce type de cotisation (1 read facturé via
 * `getCountFromServer`). Appelé par l'UI Settings pour désactiver "Supprimer"
 * tant que `count > 0`.
 */
export async function countTeamsUsingCotisationType(id: string): Promise<number> {
  const snap = await getCountFromServer(
    query(collection(db, TEAMS), where('cotisationId', '==', id)),
  )
  return snap.data().count
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CreateCotisationTypeInput {
  name: string
  description: string
  price: number
  /** Si absent, calculé : `max(displayOrder) + 1` (ou 0 si collection vide). */
  displayOrder?: number
}

/**
 * Crée un nouveau type de cotisation actif. Calcule un `displayOrder` par
 * défaut pour l'insérer en queue de liste si l'admin n'en fournit pas.
 */
export async function createCotisationType(
  input: CreateCotisationTypeInput,
): Promise<CotisationType> {
  let displayOrder = input.displayOrder
  if (displayOrder === undefined) {
    const existing = await listCotisationTypes()
    displayOrder = existing.length === 0
      ? 0
      : Math.max(...existing.map((c) => c.displayOrder)) + 1
  }
  const ref = await addDoc(collection(db, COTISATIONS), {
    name: input.name,
    description: input.description,
    price: input.price,
    displayOrder,
    active: true,
    createdAt: serverTimestamp(),
  })
  const created = await getCotisationTypeById(ref.id)
  if (!created) {
    throw new Error(
      `Failed to read cotisation type ${ref.id} just after creation`,
    )
  }
  return created
}

export interface UpdateCotisationTypeInput {
  name?: string
  description?: string
  price?: number
  displayOrder?: number
  active?: boolean
}

/** Patch partiel sur `/cotisations/{id}`. Renvoie le doc rafraîchi. */
export async function updateCotisationType(
  id: string,
  patch: UpdateCotisationTypeInput,
): Promise<CotisationType | null> {
  const update: UpdateData<DocumentData> = {}
  if (patch.name !== undefined) update.name = patch.name
  if (patch.description !== undefined) update.description = patch.description
  if (patch.price !== undefined) update.price = patch.price
  if (patch.displayOrder !== undefined) update.displayOrder = patch.displayOrder
  if (patch.active !== undefined) update.active = patch.active
  if (Object.keys(update).length === 0) return getCotisationTypeById(id)
  await updateDoc(doc(db, COTISATIONS, id), update)
  return getCotisationTypeById(id)
}

/**
 * Supprime un type de cotisation. Refuse si au moins une équipe le référence
 * — en pratique on encourage l'archive (`active: false`) plutôt que la
 * suppression (cf. docs/main.md, lifecycle "Suppression").
 */
export async function deleteCotisationType(id: string): Promise<void> {
  const used = await countTeamsUsingCotisationType(id)
  if (used > 0) {
    throw new Error(
      'Type de cotisation utilisé par des équipes — archivez-le plutôt que de le supprimer.',
    )
  }
  await deleteDoc(doc(db, COTISATIONS, id))
}
