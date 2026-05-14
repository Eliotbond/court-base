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
import type { Tag, TagColor, TagData } from '@club-app/shared-types'

/**
 * Repository Tags — référentiel de tags d'équipes éditable par l'admin.
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase
 * (cf. docs/frontend-desktop.md — architecture en couches). Les writes
 * passent par `/tags/{tagId}` (rules : isAdmin || isRootAdmin).
 *
 * Référencé par `/teams.tags[].tagId` (cf. teams.repo.ts) — le nom et la
 * couleur sont résolus à la lecture, pas dénormalisés. Voir
 * docs/firebase.md (`/tags`) et docs/main.md ("Tags d'équipes") pour le
 * lifecycle complet.
 */

const TAGS = 'tags'
const TEAMS = 'teams'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convertit un snapshot Firestore en `Tag` typée. */
export function snapToTag(
  snap: QueryDocumentSnapshot | DocumentSnapshot,
): Tag {
  const data = snap.data() as TagData
  return { id: snap.id, ...data }
}

/**
 * Comparator stable pour l'affichage : `displayOrder asc`, puis `name asc`.
 * Utilisé côté client puisque la collection est petite (référentiel club,
 * ordre de magnitude ~dizaines).
 */
function compareTags(a: Tag, b: Tag): number {
  if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder
  return a.name.localeCompare(b.name)
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Liste les tags. Tri primaire `displayOrder asc` (Firestore), tri
 * secondaire `name asc` (côté client).
 *
 * `activeOnly` filtre côté client — pas besoin d'index composite, la
 * collection reste petite (référentiel admin).
 */
export async function listTags(
  opts: { activeOnly?: boolean } = {},
): Promise<Tag[]> {
  const snap = await getDocs(
    query(collection(db, TAGS), orderBy('displayOrder')),
  )
  if (snap.empty) return []
  let rows = snap.docs.map(snapToTag)
  if (opts.activeOnly) rows = rows.filter((t) => t.active)
  rows.sort(compareTags)
  return rows
}

/** Récupère un tag par son id. */
export async function getTagById(id: string): Promise<Tag | null> {
  const snap = await getDoc(doc(db, TAGS, id))
  if (!snap.exists()) return null
  return snapToTag(snap)
}

/**
 * Compte les équipes référençant ce tag. Firestore ne permet pas de
 * `where('tags', 'array-contains', { tagId: id, display: ... })` sur un
 * objet partiel, donc on utilise `array-contains-any` avec les deux variants
 * (`display: true` et `display: false`) — 1 read facturé.
 *
 * Appelé par l'UI Settings pour désactiver "Supprimer" tant que `count > 0`.
 */
export async function countTeamsUsingTag(id: string): Promise<number> {
  const variants = [
    { tagId: id, display: true },
    { tagId: id, display: false },
  ]
  const snap = await getCountFromServer(
    query(collection(db, TEAMS), where('tags', 'array-contains-any', variants)),
  )
  return snap.data().count
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CreateTagInput {
  name: string
  color: TagColor
  /** Si absent, calculé : `max(displayOrder) + 1` (ou 0 si collection vide). */
  displayOrder?: number
}

/**
 * Crée un nouveau tag actif. Calcule un `displayOrder` par défaut pour
 * l'insérer en queue de liste si l'admin n'en fournit pas.
 */
export async function createTag(input: CreateTagInput): Promise<Tag> {
  let displayOrder = input.displayOrder
  if (displayOrder === undefined) {
    const existing = await listTags()
    displayOrder = existing.length === 0
      ? 0
      : Math.max(...existing.map((t) => t.displayOrder)) + 1
  }
  const ref = await addDoc(collection(db, TAGS), {
    name: input.name,
    color: input.color,
    displayOrder,
    active: true,
    createdAt: serverTimestamp(),
  })
  const created = await getTagById(ref.id)
  if (!created) {
    throw new Error(`Failed to read tag ${ref.id} just after creation`)
  }
  return created
}

export interface UpdateTagInput {
  name?: string
  color?: TagColor
  displayOrder?: number
  active?: boolean
}

/** Patch partiel sur `/tags/{id}`. Renvoie le doc rafraîchi. */
export async function updateTag(
  id: string,
  patch: UpdateTagInput,
): Promise<Tag | null> {
  const update: UpdateData<DocumentData> = {}
  if (patch.name !== undefined) update.name = patch.name
  if (patch.color !== undefined) update.color = patch.color
  if (patch.displayOrder !== undefined) update.displayOrder = patch.displayOrder
  if (patch.active !== undefined) update.active = patch.active
  if (Object.keys(update).length === 0) return getTagById(id)
  await updateDoc(doc(db, TAGS, id), update)
  return getTagById(id)
}

/**
 * Supprime un tag. Refuse si au moins une équipe le référence — en
 * pratique on encourage l'archive (`active: false`) plutôt que la suppression
 * (cf. docs/main.md, lifecycle "Suppression").
 */
export async function deleteTag(id: string): Promise<void> {
  const variants = [
    { tagId: id, display: true },
    { tagId: id, display: false },
  ]
  const usedSnap = await getDocs(
    query(
      collection(db, TEAMS),
      where('tags', 'array-contains-any', variants),
      limit(1),
    ),
  )
  if (!usedSnap.empty) {
    throw new Error(
      'Tag utilisé par des équipes — archivez-le plutôt que de le supprimer.',
    )
  }
  await deleteDoc(doc(db, TAGS, id))
}
