import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type DocumentData,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
  type UpdateData,
} from 'firebase/firestore'
import { db } from '@/services/firebase'
import type { LicenseRole, LicenseType, LicenseTypeData } from '@club-app/shared-types'

/**
 * Repository LicenseTypes — référentiel grille tarifaire (rôle × niveau).
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase
 * (cf. docs/frontend-desktop.md — architecture en couches). Les writes
 * passent par `/licenseTypes/{id}` (rules : isAdmin || isRootAdmin).
 *
 * Référencé par la future entité `/licenses` (pas encore implémentée). Voir
 * docs/firebase.md (`/licenseTypes`) et docs/main.md ("Licences") pour le
 * lifecycle complet.
 */

const LICENSE_TYPES = 'licenseTypes'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convertit un snapshot Firestore en `LicenseType` typé. */
export function snapToLicenseType(
  snap: QueryDocumentSnapshot | DocumentSnapshot,
): LicenseType {
  const data = snap.data() as LicenseTypeData
  return { id: snap.id, ...data }
}

/**
 * Comparator stable pour l'affichage : `role` (ordre canonique), puis
 * `displayOrder asc`, puis `level asc` (null en dernier), puis `name asc`.
 * Utilisé côté client puisque la collection reste petite (~dizaines max).
 */
const ROLE_ORDER: readonly LicenseRole[] = ['player', 'official', 'coach', 'referee']

function compareLicenseTypes(a: LicenseType, b: LicenseType): number {
  const ra = ROLE_ORDER.indexOf(a.role)
  const rb = ROLE_ORDER.indexOf(b.role)
  if (ra !== rb) return ra - rb
  if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder
  const aLvl = a.level
  const bLvl = b.level
  if (aLvl === null && bLvl !== null) return 1
  if (aLvl !== null && bLvl === null) return -1
  if (aLvl !== null && bLvl !== null && aLvl !== bLvl) return aLvl - bLvl
  return a.name.localeCompare(b.name)
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Liste les types de licence. Tri primaire `displayOrder asc` côté Firestore,
 * tri secondaire `role` (ordre canonique) + `level` côté client.
 *
 * `activeOnly` filtre côté client — pas besoin d'index composite, la
 * collection reste petite (référentiel admin).
 */
export async function listLicenseTypes(
  opts: { activeOnly?: boolean } = {},
): Promise<LicenseType[]> {
  const snap = await getDocs(
    query(collection(db, LICENSE_TYPES), orderBy('displayOrder')),
  )
  if (snap.empty) return []
  let rows = snap.docs.map(snapToLicenseType)
  if (opts.activeOnly) rows = rows.filter((t) => t.active)
  rows.sort(compareLicenseTypes)
  return rows
}

/** Récupère un type de licence par son id. */
export async function getLicenseTypeById(id: string): Promise<LicenseType | null> {
  const snap = await getDoc(doc(db, LICENSE_TYPES, id))
  if (!snap.exists()) return null
  return snapToLicenseType(snap)
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CreateLicenseTypeInput {
  role: LicenseRole
  level: number | null
  name: string
  fee: number
  /** Si absent, calculé : `max(displayOrder) + 1` (ou 0 si collection vide). */
  displayOrder?: number
}

/**
 * Crée un nouveau type de licence actif. Calcule un `displayOrder` par défaut
 * pour l'insérer en queue de liste si l'admin n'en fournit pas.
 *
 * L'unicité `(role, level)` est vérifiée côté store avant l'appel (pas de
 * contrainte côté Firestore — collection référentielle, faible volume).
 */
export async function createLicenseType(
  input: CreateLicenseTypeInput,
): Promise<LicenseType> {
  let displayOrder = input.displayOrder
  if (displayOrder === undefined) {
    const existing = await listLicenseTypes()
    displayOrder = existing.length === 0
      ? 0
      : Math.max(...existing.map((t) => t.displayOrder)) + 1
  }
  const ref = await addDoc(collection(db, LICENSE_TYPES), {
    role: input.role,
    level: input.level,
    name: input.name,
    fee: input.fee,
    displayOrder,
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  const created = await getLicenseTypeById(ref.id)
  if (!created) {
    throw new Error(`Failed to read licenseType ${ref.id} just after creation`)
  }
  return created
}

export interface UpdateLicenseTypeInput {
  role?: LicenseRole
  level?: number | null
  name?: string
  fee?: number
  displayOrder?: number
  active?: boolean
}

/** Patch partiel sur `/licenseTypes/{id}`. Renvoie le doc rafraîchi. */
export async function updateLicenseType(
  id: string,
  patch: UpdateLicenseTypeInput,
): Promise<LicenseType | null> {
  const update: UpdateData<DocumentData> = {}
  if (patch.role !== undefined) update.role = patch.role
  if (patch.level !== undefined) update.level = patch.level
  if (patch.name !== undefined) update.name = patch.name
  if (patch.fee !== undefined) update.fee = patch.fee
  if (patch.displayOrder !== undefined) update.displayOrder = patch.displayOrder
  if (patch.active !== undefined) update.active = patch.active
  if (Object.keys(update).length === 0) return getLicenseTypeById(id)
  update.updatedAt = serverTimestamp()
  await updateDoc(doc(db, LICENSE_TYPES, id), update)
  return getLicenseTypeById(id)
}

/**
 * Supprime un type de licence. Une fois l'entité `/licenses` créée, ce delete
 * devra refuser si au moins une licence référence ce type (cf. pattern
 * `deleteCategory` / `deleteTag`). Pour l'instant : delete libre.
 */
export async function deleteLicenseType(id: string): Promise<void> {
  await deleteDoc(doc(db, LICENSE_TYPES, id))
}
