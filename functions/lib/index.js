"use strict";
/**
 * Cloud Functions — Club Management App.
 *
 * Voir docs/firebase.md (section "Cloud Functions") pour la liste complète des Functions
 * et docs/deployment.md pour le modèle de déploiement cross-projet.
 *
 * Region par défaut : europe-west6 (Zurich).
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ping = exports.setRootAdminClaim = void 0;
const v2_1 = require("firebase-functions/v2");
const admin = __importStar(require("firebase-admin"));
(0, v2_1.setGlobalOptions)({ region: 'europe-west6' });
admin.initializeApp();
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
// Admin
var setRootAdminClaim_1 = require("./admin/setRootAdminClaim");
Object.defineProperty(exports, "setRootAdminClaim", { enumerable: true, get: function () { return setRootAdminClaim_1.setRootAdminClaim; } });
const ping = () => 'pong';
exports.ping = ping;
