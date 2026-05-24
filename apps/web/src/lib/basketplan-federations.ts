/**
 * Liste statique des fédérations Swiss Basketball / Basketplan connues. Sert
 * de source au dropdown "Fédération" du dialog de mapping
 * (`BasketplanLinkDialog.vue`) et du Select `defaultFederationId` dans
 * Settings → Intégrations → Basketplan.
 *
 * Pour les fédérations non listées (CSJC, ACNBA, Vaud, Valais, Tessin, Berne,
 * et les championnats nationaux Swiss Basketball), l'UI propose une option
 * "Autre ID…" qui laisse saisir l'`id` numérique manuellement (cf. brief
 * `docs/basketplan-integration.md` § 2.3).
 *
 * TODO(basketplan): inventorier exhaustivement les fédérations en exécutant
 * `findAllLeagueHoldings.do?federationId=N` pour N de 1 à 30 (cf. action
 * immédiate dans `docs/chantier-basketplan.md`). Compléter la table ci-dessous
 * + brief § 2.3 dans la même PR.
 */
export interface BasketplanFederation {
  /** Id numérique Basketplan (utilisé dans l'URL des endpoints). */
  id: number
  /** Code court de la fédération (cache pour affichage, ex. "AFBB"). */
  code: string
  /** Nom complet (libellé du Select). */
  name: string
}

export const BASKETPLAN_FEDERATIONS: ReadonlyArray<BasketplanFederation> = [
  { id: 1, code: 'BVN', name: 'Nord-Ouest (Bâle)' },
  { id: 5, code: 'ACGBA', name: 'Genève' },
  { id: 9, code: 'AFBB', name: 'Fribourg' },
  // TODO(basketplan): à compléter — CSJC, ACNBA (Neuchâtel), Vaud, Valais,
  // Tessin, Berne, et fédérations nationales Swiss Basketball (NLB, etc.).
] as const

/**
 * Lookup d'une fédération par id. Renvoie `null` si l'id n'est pas dans la
 * liste statique (cas d'un `defaultFederationId` saisi manuellement via
 * "Autre ID" dans Settings — l'UI affichera juste le numéro brut).
 */
export function findFederationById(id: number): BasketplanFederation | null {
  return BASKETPLAN_FEDERATIONS.find((f) => f.id === id) ?? null
}
