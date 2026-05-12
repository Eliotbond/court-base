/**
 * Cloud Functions — Club Management App.
 *
 * Voir docs/firebase.md (section "Cloud Functions") pour la liste complète des Functions
 * et docs/deployment.md pour le modèle de déploiement cross-projet.
 *
 * Region par défaut : europe-west6 (Zurich).
 */

import { setGlobalOptions } from 'firebase-functions/v2'
import * as admin from 'firebase-admin'

setGlobalOptions({ region: 'europe-west6' })
admin.initializeApp()

// =============================================================================
// Exports — à compléter au fil du dev
// =============================================================================

// Bookings
// export { generateSeasonBookings } from './bookings/generateSeasonBookings'
// export { previewSeasonBookings } from './bookings/previewSeasonBookings'
// export { applyClosurePeriod } from './bookings/applyClosurePeriod'

// Matches
// export { handleMatchSlotChange } from './matches/handleMatchSlotChange'

// Officials
// export { autoOfficialsNeededNotification } from './officials/autoOfficialsNeeded'
// export { matchReminders } from './officials/matchReminders'

// Dues
// export { initiateDuesOnPlayerActivation } from './dues/initiate'
// export { issueDuesScheduled } from './dues/issueScheduled'
// export { markOverdueScheduled } from './dues/markOverdue'
// export { syncMemberDuesStatus } from './dues/syncMemberStatus'

// Exceptions / Licenses
// export { applyPaymentException } from './exceptions/applyPaymentException'
// export { applyLicenseRequest } from './licenses/applyLicenseRequest'

// Migrations
// export { runMigrations } from './migrations/runMigrations'

export const ping = () => 'pong'
