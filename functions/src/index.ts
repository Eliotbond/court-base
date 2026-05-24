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
export { generateSeasonBookings } from './bookings/generateSeasonBookings'
export { previewSeasonBookings } from './bookings/previewSeasonBookings'
export { applyClosurePeriod } from './bookings/applyClosurePeriod'

// Matches
export { handleMatchSlotChange } from './matches/handleMatchSlotChange'
export { coachCreateAwayMatch } from './matches/coachCreateAwayMatch'

// Notifications
export { fanoutNotification } from './notifications/fanoutNotification'

// Officials
export { autoOfficialsNeededNotification } from './officials/autoOfficialsNeeded'
export { matchReminders } from './officials/matchReminders'

// Dues
export { initiateDuesOnPlayerActivation } from './dues/initiateDuesOnPlayerActivation'
export { issueDuesScheduled } from './dues/issueDuesScheduled'
export { markOverdueScheduled } from './dues/markOverdueScheduled'
export { syncMemberDuesStatus } from './dues/syncMemberDuesStatus'
export { markDuePaid } from './dues/markDuePaid'
export { updateDue } from './dues/updateDue'
export { transitionRegistrationOnDuePaid } from './dues/transitionRegistrationOnDuePaid'

// Exceptions / Licenses
export {
  applyPaymentException,
  applyPaymentExceptionOnCreate,
} from './exceptions/applyPaymentException'
export { applyLicenseRequest } from './licenses/applyLicenseRequest'
export { confirmLicense } from './licenses/confirmLicense'
export { coachReviewLicenseDoc } from './licenses/coachReviewLicenseDoc'
export { treasurerReviewLicenseDoc } from './licenses/treasurerReviewLicenseDoc'
export { validateLicenseRequest } from './licenses/validateLicenseRequest'
// Treasurer phase (PR-Phase-Treasurer, 2026-05-24) — cf. docs/licenses/parent-completion-workflow.md
export { treasurerUploadSignableDoc } from './licenses/treasurerUploadSignableDoc'
export { treasurerConfirmSignedDoc } from './licenses/treasurerConfirmSignedDoc'
export { treasurerMarkSentAndPaid } from './licenses/treasurerMarkSentAndPaid'
export { treasurerFinalizeLicense } from './licenses/treasurerFinalizeLicense'

// Majority transition
export { onMajorityReached } from './majority/onMajorityReached'
export { respondGuardianConsent } from './majority/respondGuardianConsent'
export { respondMemberConsent } from './majority/respondMemberConsent'

// Migrations
export { runMigrations } from './migrations/runMigrations'

// Admin
export { setRootAdminClaim } from './admin/setRootAdminClaim'
export { listRootAdminUids } from './admin/listRootAdminUids'
export { acceptInvitation } from './admin/acceptInvitation'

// Account (self-service user — app courtbase-register)
export { unlinkGuardian } from './account/unlinkGuardian'
export { deleteMyAccount } from './account/deleteMyAccount'

// Members (operations admin sur /members)
export { deleteMember } from './members/deleteMember'
export { coachCreateMember } from './members/coachCreateMember'
export { coachUpdateMember } from './members/coachUpdateMember'
export { coachDeactivateMember } from './members/coachDeactivateMember'
export { syncUserRolesFromMember } from './members/syncUserRolesFromMember'
// Photo licence du membre (PR-B `docs/members/license-photo.md`).
export { setMemberLicensePhoto } from './members/setMemberLicensePhoto'
export { removeMemberLicensePhoto } from './members/removeMemberLicensePhoto'

// === Basketplan ===
// Intégration Swiss Basketball (Basketplan / ORCA). Cf. docs/basketplan-integration.md.
// PR 1 : mapping team ↔ compétition (6 callables ci-dessous).
// PR 2 : sync AWAY + backfill scores/arbitres (callable manuelle + cron nocturne).
export { listBasketplanLeagueHoldings } from './basketplan/listLeagueHoldings'
export { listClubTeamsInLeague } from './basketplan/listClubTeamsInLeague'
export { linkTeamToBasketplan } from './basketplan/linkTeam'
export { unlinkTeamBasketplan } from './basketplan/unlinkTeam'
export { toggleTeamBasketplanLink } from './basketplan/toggleLink'
export { testBasketplanConnection } from './basketplan/testConnection'
export { syncBasketplanForTeam } from './basketplan/syncForTeam'
export { scheduledBasketplanSync } from './basketplan/scheduledSync'

// Registrations (app courtbase-register)
export { matchExistingMember } from './registrations/matchExistingMember'
export { submitRegistration } from './registrations/submitRegistration'
export { refuseRegistration } from './registrations/refuseRegistration'
export { cancelRegistration } from './registrations/cancelRegistration'
export { markTrialInProgress } from './registrations/markTrialInProgress'
export { confirmRegistration } from './registrations/confirmRegistration'
export { onRegistrationStatusChanged } from './registrations/onRegistrationStatusChanged'
export { onTrialExpired } from './registrations/onTrialExpired'

export const ping = () => 'pong'
