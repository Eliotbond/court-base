import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  createLicenseType,
  deleteLicenseType,
  listLicenseTypes,
  updateLicenseType,
  type CreateLicenseTypeInput,
  type UpdateLicenseTypeInput,
} from '@/repositories/licenseTypes.repo'
import type { LicenseRole, LicenseType } from '@club-app/shared-types'

export type { CreateLicenseTypeInput, UpdateLicenseTypeInput }

/**
 * Source unique des données du référentiel `/licenseTypes`.
 *
 * Voir `docs/firebase.md` (`/licenseTypes/{licenseTypeId}`) et `docs/main.md`
 * (section "Licences") pour le schéma et la place dans le modèle global. Le
 * store consomme uniquement le repository `licenseTypes.repo` — pattern
 * aligné sur [[stores_categories]] / [[stores_tags]].
 */

const ROLE_ORDER: readonly LicenseRole[] = ['player', 'official', 'coach', 'referee']

export const useLicenseTypesStore = defineStore('licenseTypes', () => {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const licenseTypes = ref<LicenseType[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // ---------------------------------------------------------------------------
  // Helpers (privés)
  // ---------------------------------------------------------------------------

  /**
   * Comparator stable : ordre canonique des rôles, puis `displayOrder asc`,
   * puis `level asc nulls last`, puis `name asc`. Dupliqué depuis le repo
   * pour préserver l'ordre après un upsert local sans round-trip Firestore.
   */
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

  function upsert(next: LicenseType): void {
    const idx = licenseTypes.value.findIndex((t) => t.id === next.id)
    let copy: LicenseType[]
    if (idx === -1) {
      copy = [next, ...licenseTypes.value]
    } else {
      copy = licenseTypes.value.slice()
      copy[idx] = next
    }
    copy.sort(compareLicenseTypes)
    licenseTypes.value = copy
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      licenseTypes.value = await listLicenseTypes()
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur de chargement des types de licence'
    } finally {
      loading.value = false
    }
  }

  /**
   * Les rôles qui portent un niveau de licence. Le rôle `player` n'a **pas**
   * de niveau (cf. docs/main.md "Licences") — ses types sont distingués
   * uniquement par leur `name` (Junior, Senior, …).
   */
  const ROLES_WITH_LEVEL: ReadonlySet<LicenseRole> = new Set([
    'official',
    'coach',
    'referee',
  ])

  /**
   * Renvoie true si le rôle attend un niveau numérique non-null.
   */
  function roleRequiresLevel(role: LicenseRole): boolean {
    return ROLES_WITH_LEVEL.has(role)
  }

  /**
   * Vérifie la cohérence rôle/niveau :
   * - `player` doit avoir `level === null`
   * - `official` / `coach` / `referee` doivent avoir un `level` numérique
   * Renvoie un message d'erreur i18n si incohérent, sinon null.
   */
  function validateRoleLevel(
    role: LicenseRole,
    level: number | null,
  ): string | null {
    if (roleRequiresLevel(role) && level === null) {
      return 'Ce rôle exige un niveau de licence.'
    }
    if (!roleRequiresLevel(role) && level !== null) {
      return 'Le rôle "Joueur" ne porte pas de niveau de licence.'
    }
    return null
  }

  /**
   * Vérifie l'unicité `(role, level)` **uniquement quand `level !== null`** :
   * pour les rôles avec niveau (official/coach/referee), un même (role, level)
   * ne peut exister qu'une fois. Pour les joueurs (level toujours null), pas
   * de contrainte d'unicité côté niveau — les entrées sont distinguées par
   * leur `name` (Junior, Senior, …). Renvoie l'id du type en conflit s'il
   * existe, sinon null.
   */
  function findConflict(
    role: LicenseRole,
    level: number | null,
    excludingId?: string,
  ): string | null {
    if (level === null) return null
    const conflict = licenseTypes.value.find(
      (t) => t.role === role && t.level === level && t.id !== excludingId,
    )
    return conflict ? conflict.id : null
  }

  async function create(input: CreateLicenseTypeInput): Promise<string | null> {
    error.value = null
    const roleLevelError = validateRoleLevel(input.role, input.level)
    if (roleLevelError) {
      error.value = roleLevelError
      return null
    }
    if (findConflict(input.role, input.level)) {
      error.value = 'Un type de licence existe déjà pour ce rôle et ce niveau.'
      return null
    }
    try {
      const created = await createLicenseType(input)
      upsert(created)
      return created.id
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors de la création du type de licence'
      return null
    }
  }

  async function update(
    id: string,
    patch: UpdateLicenseTypeInput,
  ): Promise<boolean> {
    error.value = null
    // Si la modif touche role ou level, valider cohérence + unicité contre l'état courant.
    if (patch.role !== undefined || patch.level !== undefined) {
      const current = licenseTypes.value.find((t) => t.id === id)
      if (!current) return false
      const nextRole = patch.role ?? current.role
      const nextLevel = patch.level !== undefined ? patch.level : current.level
      const roleLevelError = validateRoleLevel(nextRole, nextLevel)
      if (roleLevelError) {
        error.value = roleLevelError
        return false
      }
      if (findConflict(nextRole, nextLevel, id)) {
        error.value = 'Un type de licence existe déjà pour ce rôle et ce niveau.'
        return false
      }
    }
    try {
      const next = await updateLicenseType(id, patch)
      if (!next) return false
      upsert(next)
      return true
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors de la mise à jour du type de licence'
      return false
    }
  }

  async function archive(id: string): Promise<void> {
    await update(id, { active: false })
  }

  async function unarchive(id: string): Promise<void> {
    await update(id, { active: true })
  }

  async function remove(id: string): Promise<boolean> {
    error.value = null
    try {
      await deleteLicenseType(id)
      licenseTypes.value = licenseTypes.value.filter((t) => t.id !== id)
      return true
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors de la suppression du type de licence'
      return false
    }
  }

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const activeLicenseTypes = computed<LicenseType[]>(() => {
    return licenseTypes.value
      .filter((t) => t.active)
      .slice()
      .sort(compareLicenseTypes)
  })

  /**
   * Groupement par rôle dans l'ordre canonique. Utilisé par l'UI Settings
   * qui affiche un fieldset par rôle. Renvoie toujours les 4 rôles, même
   * si le groupe est vide — l'UI affichera un état vide + CTA "Ajouter".
   */
  const groupedByRole = computed<Record<LicenseRole, LicenseType[]>>(() => {
    const grouped: Record<LicenseRole, LicenseType[]> = {
      player: [],
      official: [],
      coach: [],
      referee: [],
    }
    for (const t of licenseTypes.value) {
      grouped[t.role].push(t)
    }
    for (const role of ROLE_ORDER) {
      grouped[role].sort(compareLicenseTypes)
    }
    return grouped
  })

  const byId = computed<Map<string, LicenseType>>(() => {
    const m = new Map<string, LicenseType>()
    for (const t of licenseTypes.value) m.set(t.id, t)
    return m
  })

  return {
    // state
    licenseTypes,
    loading,
    error,
    // derived
    activeLicenseTypes,
    groupedByRole,
    byId,
    // actions
    load,
    create,
    update,
    archive,
    unarchive,
    remove,
    findConflict,
    roleRequiresLevel,
  }
})
