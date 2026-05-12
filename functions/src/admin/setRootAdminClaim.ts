import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import * as admin from 'firebase-admin'

interface SetRootAdminClaimInput {
  email: string
  value: boolean
}

interface SetRootAdminClaimOutput {
  uid: string
  email: string
  rootAdmin: boolean
}

export const setRootAdminClaim = onCall(
  async (request: CallableRequest<SetRootAdminClaimInput>): Promise<SetRootAdminClaimOutput> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.')
    }
    if (request.auth.token.rootAdmin !== true) {
      throw new HttpsError('permission-denied', 'Only a rootAdmin can call this function.')
    }

    const data = request.data ?? ({} as Partial<SetRootAdminClaimInput>)
    const { email, value } = data
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpsError('invalid-argument', '`email` must be a valid email string.')
    }
    if (typeof value !== 'boolean') {
      throw new HttpsError('invalid-argument', '`value` must be a boolean.')
    }

    let userRecord: admin.auth.UserRecord
    try {
      userRecord = await admin.auth().getUserByEmail(email)
    } catch (err) {
      logger.warn('setRootAdminClaim: target user not found', { email, err })
      throw new HttpsError('not-found', `No user found for email ${email}.`)
    }

    if (request.auth.uid === userRecord.uid && value === false) {
      throw new HttpsError(
        'failed-precondition',
        'A rootAdmin cannot revoke their own rootAdmin claim. Ask another rootAdmin to do it.',
      )
    }

    const existingClaims = userRecord.customClaims ?? {}
    const nextClaims = { ...existingClaims, rootAdmin: value }
    await admin.auth().setCustomUserClaims(userRecord.uid, nextClaims)

    logger.info('setRootAdminClaim: claim updated', {
      callerUid: request.auth.uid,
      targetUid: userRecord.uid,
      targetEmail: userRecord.email,
      value,
    })

    return { uid: userRecord.uid, email: userRecord.email ?? email, rootAdmin: value }
  },
)
