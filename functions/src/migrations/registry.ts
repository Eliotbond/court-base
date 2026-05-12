/**
 * Registry ordonné des migrations.
 *
 * Ordre = ordre d'application. Chaque migration doit avoir `to === from + 1`
 * et la chaîne doit être contigüe en partant de `from === 0`. La validation
 * tourne au chargement du module pour fail-fast au cold start.
 */
import type { Migration } from './types'
import { migration_001_initial_schema } from './migration_001_initial_schema'

/** Liste ordonnée des migrations. Ajouter ici dans l'ordre. */
export const migrations: ReadonlyArray<Migration> = [migration_001_initial_schema]

/**
 * Valide que les migrations forment une chaîne contigüe à partir de 0.
 * Throw au chargement du module si une migration est mal formée — c'est
 * volontaire : on préfère un crash de cold start lisible qu'une migration
 * silencieusement skippée en prod.
 */
function validateRegistry(list: ReadonlyArray<Migration>): void {
  let expectedFrom = 0
  for (const [i, m] of list.entries()) {
    if (m.from !== expectedFrom) {
      throw new Error(
        `Migration registry invalid at index ${i} ("${m.name}"): expected from=${expectedFrom}, got from=${m.from}.`,
      )
    }
    if (m.to !== m.from + 1) {
      throw new Error(
        `Migration registry invalid at index ${i} ("${m.name}"): to must equal from+1 (got from=${m.from}, to=${m.to}).`,
      )
    }
    expectedFrom = m.to
  }
}

validateRegistry(migrations)

/** Plus haute version cible disponible (== `to` de la dernière migration, ou 0 si vide). */
export const latestVersion: number =
  migrations.length === 0 ? 0 : migrations[migrations.length - 1].to

/**
 * Retourne les migrations à appliquer pour passer de `current` à `target`.
 * Throw si `target < current` (pas de down) ou si la chaîne est interrompue.
 */
export function planMigrations(current: number, target: number): Migration[] {
  if (target < current) {
    throw new Error(`Cannot migrate backward: current=${current}, target=${target}.`)
  }
  if (target > latestVersion) {
    throw new Error(
      `Target version ${target} exceeds latest registered version ${latestVersion}.`,
    )
  }
  const plan: Migration[] = []
  let cursor = current
  for (const m of migrations) {
    if (m.from < cursor) continue
    if (m.from !== cursor) {
      throw new Error(
        `Migration chain broken: cursor=${cursor} but next migration "${m.name}" expects from=${m.from}.`,
      )
    }
    if (m.to > target) break
    plan.push(m)
    cursor = m.to
  }
  if (cursor !== target) {
    throw new Error(
      `Cannot reach target=${target} from current=${current}: chain ends at version ${cursor}.`,
    )
  }
  return plan
}
