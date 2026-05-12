/**
 * Migration 001 — Initialise `/_meta/schema`.
 *
 * Sur un projet vierge, crée le doc `/_meta/schema` avec `{ version: 1, migrationLog: [] }`
 * uniquement s'il n'existe pas déjà. Le runner se chargera ensuite de bumper
 * `version` et d'écrire l'entrée `migrationLog` correspondante — cette migration
 * ne touche **pas** à ces deux champs, pour ne pas dupliquer la logique du runner.
 *
 * Idempotente : safe à re-lancer.
 */
import type { Migration } from './types'

export const migration_001_initial_schema: Migration = {
  from: 0,
  to: 1,
  name: '001_initial_schema',
  async run(db: FirebaseFirestore.Firestore): Promise<void> {
    const ref = db.collection('_meta').doc('schema')
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (snap.exists) {
        return
      }
      tx.set(ref, {
        // Le runner mettra `version` à `to` après ce step ; on initialise à `from`
        // pour refléter l'état pre-step et laisser le runner faire l'update atomique.
        version: 0,
        migrationLog: [],
      })
    })
  },
}
