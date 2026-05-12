import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import * as admin from 'firebase-admin'

/**
 * listRootAdminUids — retourne les `uid` des users portant le custom claim
 * `rootAdmin: true` sur ce projet.
 *
 * Pourquoi cette callable existe :
 * - Les custom claims Firebase Auth ne sont **pas** dans Firestore. Côté
 *   client, seul le user courant peut lire son propre token. Pour afficher
 *   un badge "rootAdmin" sur la liste Settings → Admin team, il faut passer
 *   par l'Admin SDK serveur.
 *
 * Auth : admin OU rootAdmin (les coachs/officiels n'ont aucun besoin de cette
 * info). Les rules Firestore admin-only sur `/users` sont alignées : un user
 * sans rôle admin n'a déjà pas accès à la liste.
 *
 * Pagination : `admin.auth().listUsers()` retourne max 1000 users par page.
 * Pour les projets clients (membres ~250 max selon plan), une seule page suffit
 * largement. On pagine quand même pour rester correct.
 */
interface ListRootAdminUidsOutput {
  uids: string[]
}

export const listRootAdminUids = onCall(
  async (request: CallableRequest<void>): Promise<ListRootAdminUidsOutput> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.')
    }

    const isRootAdmin = request.auth.token.rootAdmin === true
    const callerRoles = Array.isArray(request.auth.token.roles)
      ? (request.auth.token.roles as unknown[])
      : []
    const isAdmin = callerRoles.includes('admin')

    // Si le claim `roles` n'est pas posé sur le token (cas standard : on lit
    // les rôles depuis /users/{uid}), on tombe en fallback Firestore.
    let callerIsAdmin = isAdmin
    if (!isRootAdmin && !callerIsAdmin) {
      const userDoc = await admin
        .firestore()
        .doc(`users/${request.auth.uid}`)
        .get()
      const data = userDoc.exists ? userDoc.data() : undefined
      const docRoles = Array.isArray(data?.roles) ? (data.roles as unknown[]) : []
      callerIsAdmin = docRoles.includes('admin')
    }

    if (!isRootAdmin && !callerIsAdmin) {
      throw new HttpsError(
        'permission-denied',
        'Only an admin or rootAdmin can list rootAdmin uids.',
      )
    }

    const uids: string[] = []
    let pageToken: string | undefined
    do {
      const page = await admin.auth().listUsers(1000, pageToken)
      for (const user of page.users) {
        if (user.customClaims?.rootAdmin === true) {
          uids.push(user.uid)
        }
      }
      pageToken = page.pageToken
    } while (pageToken)

    logger.info('listRootAdminUids: resolved', {
      callerUid: request.auth.uid,
      count: uids.length,
    })

    return { uids }
  },
)
