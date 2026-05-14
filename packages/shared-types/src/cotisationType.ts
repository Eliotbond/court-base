import type { Timestamp } from './index'

/**
 * Document /cotisations/{cotisationTypeId} — référentiel des **types de
 * cotisation** (templates de pricing) éditable par l'admin. Voir
 * docs/firebase.md (/cotisations) et docs/main.md (section "Cotisations").
 *
 * NB sémantique : ce type représente le **template de prix** (Junior,
 * Senior, …) référencé par `team.cotisationId`. Il ne représente PAS la
 * facture membre — celle-ci est `Cotisation` (ex-`Due`, `/dues`), gérée
 * par un autre module. La string Firestore `'cotisations'` est conservée
 * pour éviter une migration data ; seul le nom du type côté code est
 * renommé en `CotisationType` (analogue à `licenseTypes` / `matchTypes`).
 *
 * Référencé par /teams.cotisationId. Le nom et le prix ne sont PAS
 * dénormalisés sur /teams : un rename/reprice se reflète automatiquement
 * à la lecture.
 */
export interface CotisationTypeData {
  /** Libellé court : "Cotisation Junior", "Cotisation Senior". */
  name: string
  /** Texte libre court (description du périmètre, conditions, etc.). */
  description: string
  /** Montant CHF/an/joueur (>= 0). La devise est une convention club, pas enforced. */
  price: number
  /** Entier croissant pour tri stable dans pickers. Tie-break : name asc. */
  displayOrder: number
  /** false = archivée (n'apparaît plus dans le picker, teams existantes inchangées). */
  active: boolean
  createdAt: Timestamp
}

export type CotisationType = CotisationTypeData & { id: string }
