import type { Timestamp } from './index'

/**
 * Document /categories/{categoryId} — référentiel d'âge éditable par l'admin.
 * Voir docs/firebase.md (/categories) et docs/main.md (section "Catégories d'équipes").
 *
 * Référencé par /teams.categoryId. Le nom et la tranche d'âge ne sont PAS
 * dénormalisés sur /teams : un rename se reflète automatiquement.
 */
export interface CategoryData {
  /** Libellé affiché : "U14", "Seniors A", "Loisirs". */
  name: string
  /** Borne basse (incluse). null = catégorie ouverte par le bas. */
  minAge: number | null
  /** Borne haute (incluse). null = catégorie ouverte par le haut. */
  maxAge: number | null
  /** Entier croissant pour tri stable dans pickers. Tie-break : minAge puis name. */
  displayOrder: number
  /** false = archivée (n'apparaît plus dans le picker, teams existantes inchangées). */
  active: boolean
  createdAt: Timestamp
}

export type Category = CategoryData & { id: string }
