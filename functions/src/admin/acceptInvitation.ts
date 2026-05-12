import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import * as admin from 'firebase-admin'

/**
 * acceptInvitation — appelée juste après une sign-in OAuth réussie quand le
 * doc `/users/{uid}` n'existe pas. Cherche une invitation en attente pour
 * l'email du caller, crée `/users/{uid}` à partir de l'invitation, supprime
 * le doc d'invitation.
 *
 * Auth : signed-in seul (le caller n'a pas encore de rôle dans le club, sinon
 * il aurait déjà un /users doc).
 *
 * Bypass des rules : Admin SDK. Les rules Firestore admin-only sur /users et
 * /invitations resteraient autrement bloquantes pour le caller fraîchement
 * signed-in qui n'a pas encore le rôle.
 */
interface AcceptInvitationOutput {
  uid: string
  email: string
  role: string
}

export const acceptInvitation = onCall(
  async (request: CallableRequest<void>): Promise<AcceptInvitationOutput> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.')
    }

    const callerEmail = request.auth.token.email
    if (typeof callerEmail !== 'string' || callerEmail.length === 0) {
      throw new HttpsError(
        'failed-precondition',
        'No email on the auth token. OAuth provider must expose email.',
      )
    }
    const normalizedEmail = callerEmail.toLowerCase()

    const db = admin.firestore()

    const existingUserSnap = await db.doc(`users/${request.auth.uid}`).get()
    if (existingUserSnap.exists) {
      throw new HttpsError(
        'already-exists',
        'A /users/{uid} doc already exists for this account.',
      )
    }

    const invitationsSnap = await db
      .collection('invitations')
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get()

    if (invitationsSnap.empty) {
      throw new HttpsError(
        'not-found',
        `No pending invitation for ${normalizedEmail}.`,
      )
    }

    const inviteDoc = invitationsSnap.docs[0]
    const invitation = inviteDoc.data() as { email: string; role: string }
    if (typeof invitation.role !== 'string' || invitation.role.length === 0) {
      throw new HttpsError('internal', 'Invitation has no valid role.')
    }

    const userRecord = await admin.auth().getUser(request.auth.uid)

    const batch = db.batch()
    batch.set(db.doc(`users/${request.auth.uid}`), {
      email: userRecord.email ?? normalizedEmail,
      displayName: userRecord.displayName ?? userRecord.email ?? normalizedEmail,
      photoURL: userRecord.photoURL ?? '',
      roles: [invitation.role],
      memberId: null,
      teamIds: [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    batch.delete(inviteDoc.ref)
    await batch.commit()

    logger.info('acceptInvitation: provisioned user from invitation', {
      uid: request.auth.uid,
      email: normalizedEmail,
      role: invitation.role,
      invitationId: inviteDoc.id,
    })

    return {
      uid: request.auth.uid,
      email: normalizedEmail,
      role: invitation.role,
    }
  },
)
