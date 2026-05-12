/**
 * Logger Firebase — point d'import unique pour le reste du code Functions.
 *
 * Réexporte le module `firebase-functions/logger` (v2-compatible : même module
 * partagé entre v1 et v2). Évite la dispersion d'imports `firebase-functions/v2`
 * vs `firebase-functions/logger` à travers le codebase.
 *
 * Usage:
 *   import { logger } from '../shared/logger'
 *   logger.info('hello', { foo: 'bar' })
 */
import * as logger from 'firebase-functions/logger'

export { logger }
