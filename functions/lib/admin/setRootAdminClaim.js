"use strict";
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
exports.setRootAdminClaim = void 0;
const https_1 = require("firebase-functions/v2/https");
const v2_1 = require("firebase-functions/v2");
const admin = __importStar(require("firebase-admin"));
exports.setRootAdminClaim = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in.');
    }
    if (request.auth.token.rootAdmin !== true) {
        throw new https_1.HttpsError('permission-denied', 'Only a rootAdmin can call this function.');
    }
    const data = request.data ?? {};
    const { email, value } = data;
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new https_1.HttpsError('invalid-argument', '`email` must be a valid email string.');
    }
    if (typeof value !== 'boolean') {
        throw new https_1.HttpsError('invalid-argument', '`value` must be a boolean.');
    }
    let userRecord;
    try {
        userRecord = await admin.auth().getUserByEmail(email);
    }
    catch (err) {
        v2_1.logger.warn('setRootAdminClaim: target user not found', { email, err });
        throw new https_1.HttpsError('not-found', `No user found for email ${email}.`);
    }
    if (request.auth.uid === userRecord.uid && value === false) {
        throw new https_1.HttpsError('failed-precondition', 'A rootAdmin cannot revoke their own rootAdmin claim. Ask another rootAdmin to do it.');
    }
    const existingClaims = userRecord.customClaims ?? {};
    const nextClaims = { ...existingClaims, rootAdmin: value };
    await admin.auth().setCustomUserClaims(userRecord.uid, nextClaims);
    v2_1.logger.info('setRootAdminClaim: claim updated', {
        callerUid: request.auth.uid,
        targetUid: userRecord.uid,
        targetEmail: userRecord.email,
        value,
    });
    return { uid: userRecord.uid, email: userRecord.email ?? email, rootAdmin: value };
});
