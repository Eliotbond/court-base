import { GoogleAuthProvider, OAuthProvider, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, signOut, } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/services/firebase';
/**
 * Levée quand un compte Firebase Auth valide signe in mais n'a pas de
 * doc `/users/{uid}` correspondant. Le club provisionne ses users en amont :
 * un compte Auth orphelin n'est pas autorisé.
 */
export class NotAuthorizedError extends Error {
    code = 'auth/not-authorized-for-club';
    constructor() {
        super('No /users doc for the signed-in account.');
        this.name = 'NotAuthorizedError';
    }
}
export function subscribeAuthState(callback) {
    return onAuthStateChanged(auth, async (user) => {
        if (!user) {
            callback(null);
            return;
        }
        const token = await user.getIdTokenResult();
        callback({
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            rootAdmin: token.claims.rootAdmin === true,
        });
    });
}
export async function getUserDoc(uid) {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists())
        return null;
    return { id: snap.id, ...snap.data() };
}
export function signInWithEmail(email, password) {
    return signInWithEmailAndPassword(auth, email, password).then(() => undefined);
}
/**
 * Vérifie qu'un user Firebase Auth a un doc /users/{uid} de provisioning.
 * Sinon : sign out + throw NotAuthorizedError (pour ne pas laisser un compte
 * Auth orphelin attaché au projet).
 */
async function ensureProvisioned(cred) {
    const userDoc = await getUserDoc(cred.user.uid);
    if (!userDoc) {
        await signOut(auth);
        throw new NotAuthorizedError();
    }
}
export async function signInWithGoogle() {
    const provider = new GoogleAuthProvider();
    const cred = await signInWithPopup(auth, provider);
    await ensureProvisioned(cred);
}
export async function signInWithApple() {
    const provider = new OAuthProvider('apple.com');
    provider.addScope('email');
    provider.addScope('name');
    const cred = await signInWithPopup(auth, provider);
    await ensureProvisioned(cred);
}
export function signOutUser() {
    return signOut(auth);
}
