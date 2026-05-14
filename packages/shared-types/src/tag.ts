import type { Timestamp } from './index'

/**
 * Document /tags/{tagId} — référentiel de tags d'équipes éditable par l'admin.
 * Voir docs/firebase.md (/tags) et docs/main.md (section "Tags d'équipes").
 *
 * Référencé par /teams.tags[].tagId. Le nom et la couleur ne sont PAS
 * dénormalisés sur /teams : un rename/recolor se reflète automatiquement.
 */

/**
 * Palette bornée — alignée sur les variants du composant `Pill`
 * (apps/web/src/components/ui/Pill.vue) pour rester cohérent avec le
 * design system. Pas de hex libre.
 */
export type TagColor =
  | 'emerald'
  | 'sky'
  | 'amber'
  | 'rose'
  | 'violet'
  | 'slate'

export interface TagData {
  /** Libellé court : "Élite", "Loisir", "Compet", "U14 A". */
  name: string
  /** Couleur du chip (palette bornée). */
  color: TagColor
  /** Entier croissant pour tri stable dans pickers. Tie-break : name asc. */
  displayOrder: number
  /** false = archivée (n'apparaît plus dans le picker, teams existantes inchangées). */
  active: boolean
  createdAt: Timestamp
}

export type Tag = TagData & { id: string }

/**
 * Référence d'un tag attaché à une équipe (inline sur /teams.tags).
 * Le flag `display` est par-équipe — un même tag peut être attaché à
 * plusieurs équipes mais affiché seulement sur certaines.
 */
export interface TeamTagRef {
  tagId: string
  display: boolean
}
