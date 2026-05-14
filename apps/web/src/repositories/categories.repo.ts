import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
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
import type { Category, CategoryData } from '@club-app/shared-types'

/**
 * Repository Categories — référentiel d'âge éditable par l'admin.
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase
 * (cf. docs/frontend-desktop.md — architecture en couches). Les writes
 * passent par `/categories/{categoryId}` (rules : isAdmin || isRootAdmin).
 *
 * Le doc est référencé par `/teams.categoryId` (cf. teams.repo.ts) — le nom
 * et la tranche d'âge sont résolus à la lecture, pas dénormalisés. Voir
 * docs/firebase.md (`/categories`) et docs/main.md ("Catégories d'équipes")
 * pour le lifecycle complet.
 */

const CATEGORIES = 'categories'
const TEAMS = 'teams'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convertit un snapshot Firestore en `Category` typée. */
export function snapToCategory(
  snap: QueryDocumentSnapshot | DocumentSnapshot,
): Category {
  const data = snap.data() as CategoryData
  return { id: snap.id, ...data }
}

/**
 * Comparator stable pour l'affichage : `displayOrder asc`, puis `minAge asc`
 * (null en dernier), puis `name asc`. Utilisé côté client puisque la
 * collection est petite (référentiel club, ordre de magnitude ~dizaines).
 */
function compareCategories(a: Category, b: Category): number {
  if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder
  const aMin = a.minAge
  const bMin = b.minAge
  if (aMin === null && bMin !== null) return 1
  if (aMin !== null && bMin === null) return -1
  if (aMin !== null && bMin !== null && aMin !== bMin) return aMin - bMin
  return a.name.localeCompare(b.name)
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Liste les catégories. Tri primaire `displayOrder asc` (Firestore), tri
 * secondaire `minAge asc nulls last` puis `name asc` (côté client).
 *
 * `activeOnly` filtre côté client — pas besoin d'index composite, la
 * collection reste petite (référentiel admin).
 */
export async function listCategories(
  opts: { activeOnly?: boolean } = {},
): Promise<Category[]> {
  const snap = await getDocs(
    query(collection(db, CATEGORIES), orderBy('displayOrder')),
  )
  if (snap.empty) return []
  let rows = snap.docs.map(snapToCategory)
  if (opts.activeOnly) rows = rows.filter((c) => c.active)
  rows.sort(compareCategories)
  return rows
}

/** Récupère une catégorie par son id. */
export async function getCategoryById(id: string): Promise<Category | null> {
  const snap = await getDoc(doc(db, CATEGORIES, id))
  if (!snap.exists()) return null
  return snapToCategory(snap)
}

/**
 * Compte les équipes référençant cette catégorie. Utilise la COUNT
 * aggregation Firestore (1 read facturé). Appelé par l'UI Settings pour
 * désactiver le bouton "Supprimer" tant que `count > 0`.
 */
export async function countTeamsUsingCategory(id: string): Promise<number> {
  const snap = await getCountFromServer(
    query(collection(db, TEAMS), where('categoryId', '==', id)),
  )
  return snap.data().count
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CreateCategoryInput {
  name: string
  minAge: number | null
  maxAge: number | null
  /** Si absent, calculé : `max(displayOrder) + 1` (ou 0 si collection vide). */
  displayOrder?: number
}

/**
 * Crée une nouvelle catégorie active. Calcule un `displayOrder` par défaut
 * pour l'insérer en queue de liste si l'admin n'en fournit pas.
 */
export async function createCategory(
  input: CreateCategoryInput,
): Promise<Category> {
  let displayOrder = input.displayOrder
  if (displayOrder === undefined) {
    const existing = await listCategories()
    displayOrder = existing.length === 0
      ? 0
      : Math.max(...existing.map((c) => c.displayOrder)) + 1
  }
  const ref = await addDoc(collection(db, CATEGORIES), {
    name: input.name,
    minAge: input.minAge,
    maxAge: input.maxAge,
    displayOrder,
    active: true,
    createdAt: serverTimestamp(),
  })
  const created = await getCategoryById(ref.id)
  if (!created) {
    throw new Error(`Failed to read category ${ref.id} just after creation`)
  }
  return created
}

export interface UpdateCategoryInput {
  name?: string
  minAge?: number | null
  maxAge?: number | null
  displayOrder?: number
  active?: boolean
}

/** Patch partiel sur `/categories/{id}`. Renvoie le doc rafraîchi. */
export async function updateCategory(
  id: string,
  patch: UpdateCategoryInput,
): Promise<Category | null> {
  const update: UpdateData<DocumentData> = {}
  if (patch.name !== undefined) update.name = patch.name
  if (patch.minAge !== undefined) update.minAge = patch.minAge
  if (patch.maxAge !== undefined) update.maxAge = patch.maxAge
  if (patch.displayOrder !== undefined) update.displayOrder = patch.displayOrder
  if (patch.active !== undefined) update.active = patch.active
  if (Object.keys(update).length === 0) return getCategoryById(id)
  await updateDoc(doc(db, CATEGORIES, id), update)
  return getCategoryById(id)
}

/**
 * Supprime une catégorie. Refuse si au moins une équipe la référence — en
 * pratique on encourage l'archive (`active: false`) plutôt que la suppression
 * (cf. docs/main.md, lifecycle "Suppression").
 */
export async function deleteCategory(id: string): Promise<void> {
  const usedSnap = await getDocs(
    query(
      collection(db, TEAMS),
      where('categoryId', '==', id),
      limit(1),
    ),
  )
  if (!usedSnap.empty) {
    throw new Error(
      'Catégorie utilisée par des équipes — archivez-la plutôt que de la supprimer.',
    )
  }
  await deleteDoc(doc(db, CATEGORIES, id))
}
