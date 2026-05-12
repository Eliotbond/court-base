/**
 * Contrat d'une migration Firestore.
 *
 * Voir docs/firebase.md (`/_meta/schema`) et docs/deployment.md
 * (section "Schema versioning & migrations") pour le contexte runtime.
 *
 * Règles :
 *  - Forward-only (pas de `down`).
 *  - Idempotente : re-runner = no-op si déjà appliquée.
 *  - `to === from + 1` (pas de saut, validé dans `registry.ts`).
 */
export interface Migration {
  /** Version Firestore avant l'application de cette migration. */
  readonly from: number
  /** Version Firestore après l'application (toujours `from + 1`). */
  readonly to: number
  /** Identifiant lisible, loggé dans `_meta/schema.migrationLog`. */
  readonly name: string
  /**
   * Applique la migration. Doit être idempotente : si re-lancée alors que
   * l'état cible existe déjà, elle ne doit rien faire (ou rejouer sans effet).
   *
   * La mise à jour de `_meta/schema.version` et de `migrationLog` est
   * effectuée par le runner, **pas** par la migration elle-même.
   */
  run(db: FirebaseFirestore.Firestore): Promise<void>
}

/** Entrée de log écrite par le runner après chaque step appliqué. */
export interface MigrationLogEntry {
  version: number
  appliedAt: FirebaseFirestore.Timestamp
  appliedBy: string
  notes: string
}

/** Forme du doc `/_meta/schema`. */
export interface SchemaMetaDoc {
  version: number
  migrationLog: MigrationLogEntry[]
}
