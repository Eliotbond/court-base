import { FirebaseError } from 'firebase/app'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentData,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
  type UpdateData,
} from 'firebase/firestore'
import { db } from '@/services/firebase'
import {
  DEFAULT_CUSTOM_ROLE_SEEDS,
  SYSTEM_ROLE_SEEDS,
  type Role,
  type RoleData,
} from '@club-app/shared-types'

/**
 * Repository Roles — référentiel `/roles` du club (vraie collection Firestore).
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase
 * (cf. docs/frontend-desktop.md — architecture en couches). Les writes passent
 * par `/roles/{roleId}` (rules : `create`/`update` admin-only ;
 * `delete` admin-only ET refusé sur `type == 'system'`).
 *
 * Modèle (cf. docs/firebase.md `/roles`) :
 *  - 6 rôles `system` non-supprimables — leur doc id EST la clé canonique
 *    (`admin`, `treasurer`, `secretary`, `coach`, `official`, `player`) ;
 *  - rôles `custom` éditables/supprimables (doc id auto-généré).
 *
 * Volume faible (référentiel club, ordre de magnitude ~dizaines) → lecture par
 * query simple + tri JS, pas d'index composite (cf. règle 10 du CLAUDE.md).
 */

const ROLES = 'roles'

/** Input pour créer/éditer un rôle custom. `id`/`type`/`createdAt` posés ici. */
export interface RoleInput {
  name: string
  color: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convertit un snapshot Firestore en `Role` typé. */
function snapToRole(snap: QueryDocumentSnapshot | DocumentSnapshot): Role {
  const data = snap.data() as RoleData
  return { id: snap.id, ...data }
}

/**
 * Comparator d'affichage : `system` d'abord (dans l'ordre canonique des seeds),
 * puis `custom` par nom. Appliqué côté client (collection petite).
 */
function compareRoles(a: Role, b: Role): number {
  if (a.type !== b.type) return a.type === 'system' ? -1 : 1
  if (a.type === 'system') {
    const order = SYSTEM_ROLE_SEEDS.map((s) => s.id)
    return order.indexOf(a.id) - order.indexOf(b.id)
  }
  return a.name.localeCompare(b.name)
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Liste tous les rôles (`system` + `custom`). Tri JS : système d'abord (ordre
 * canonique), puis custom alphabétique. Renvoie `[]` si la collection n'est pas
 * encore amorcée — l'UI propose alors le CTA `seedRoles`.
 */
export async function listRoles(): Promise<Role[]> {
  try {
    const snap = await getDocs(collection(db, ROLES))
    if (snap.empty) return []
    return snap.docs.map(snapToRole).sort(compareRoles)
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`listRoles failed [${code}]`, err)
    throw err
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Crée un rôle `custom`. Les rôles `system` ne sont jamais créables via UI
 * (seul `seedRoles` les pose, avec leur id canonique). `createdAt` est posé en
 * `serverTimestamp()`. Retourne le `Role` créé.
 */
export async function createRole(input: RoleInput): Promise<Role> {
  try {
    const ref = await addDoc(collection(db, ROLES), {
      name: input.name,
      type: 'custom' as const,
      color: input.color,
      createdAt: serverTimestamp(),
    })
    return {
      id: ref.id,
      name: input.name,
      type: 'custom',
      color: input.color,
      // Approximation : le serverTimestamp() vient d'être posé. L'UI affiche
      // les rôles sans dépendre de `createdAt` — pas de re-getDoc nécessaire.
      createdAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
    }
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`createRole failed [${code}]`, err)
    throw err
  }
}

/**
 * Met à jour un rôle `custom` (name + color). Les rôles `system` sont refusés
 * côté UI ; la garde rules autorise l'`update` admin sur n'importe quel rôle
 * (l'invariant "non-éditable" est purement UI pour les system — leur id reste
 * la clé canonique, le name/color peut être ajusté par l'admin si besoin).
 */
export async function updateRole(id: string, patch: RoleInput): Promise<void> {
  try {
    const update: UpdateData<DocumentData> = {
      name: patch.name,
      color: patch.color,
    }
    await updateDoc(doc(db, ROLES, id), update)
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`updateRole failed [${code}]`, err)
    throw err
  }
}

/**
 * Supprime un rôle `custom`. La règle Firestore refuse déjà la suppression d'un
 * rôle `type == 'system'` (`permission-denied`) — cette garde la double côté
 * repo pour un message d'erreur explicite avant tout aller-retour réseau.
 */
export async function deleteRole(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, ROLES, id))
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`deleteRole failed [${code}]`, err)
    throw err
  }
}

/**
 * Amorce `/roles` : écrit les 6 rôles système (id canonique = doc id) + les 2
 * rôles custom par défaut. Idempotent — no-op si la collection contient déjà
 * des rôles. Les system docs utilisent `setDoc(doc('roles/<id>'))` pour fixer
 * leur id à la clé canonique ; les customs aussi (ids stables des seeds).
 *
 * Pattern aligné sur `seedDefaultAccounts` (`accounts.repo.ts`).
 */
export async function seedRoles(): Promise<void> {
  try {
    const existing = await getDocs(collection(db, ROLES))
    if (!existing.empty) return
    const seeds = [...SYSTEM_ROLE_SEEDS, ...DEFAULT_CUSTOM_ROLE_SEEDS]
    await Promise.all(
      seeds.map((seed) =>
        setDoc(doc(db, ROLES, seed.id), {
          name: seed.name,
          type: seed.type,
          color: seed.color,
          createdAt: serverTimestamp(),
        }),
      ),
    )
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`seedRoles failed [${code}]`, err)
    throw err
  }
}
