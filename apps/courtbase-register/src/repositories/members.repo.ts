import {
  FirestoreError,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore'
import type {
  Member,
  MemberContactData,
  MemberData,
} from '@club-app/shared-types'
import { db } from '@/services/firebase'

/**
 * Repository Members — accès lecture pour l'app register.
 *
 * Surface restreinte : aucune écriture (les `/members` sont admin-only-write,
 * et même la création d'un member à l'acceptation d'inscription passe par
 * la callable `submitRegistration` / un futur `acceptRegistration` côté
 * Admin SDK).
 *
 * Permissions (cf. `firestore.rules` §members) :
 *  - **read** parent doc : admin / coach / official / linked member / guardians.
 *  - **read** `/private/contact` : admin / coach / linked member / guardians
 *    (pas les official-only).
 *
 * Côté app register, le caller est typiquement linked member OU guardian.
 * Toute autre lecture (membres dont le caller n'est pas tuteur) sera
 * silencieusement rejetée (`permission-denied`) — on dégrade à `null` / `[]`.
 */

const MEMBERS = 'members'

function snapToMember(snap: { id: string; data: () => unknown }): Member {
  const data = snap.data() as MemberData
  return { id: snap.id, ...data }
}

/** Lecture du member lié au user authentifié (self). */
export async function getLinkedMember(memberId: string): Promise<Member | null> {
  try {
    const snap = await getDoc(doc(db, MEMBERS, memberId))
    if (!snap.exists()) return null
    return snapToMember(snap)
  } catch (err) {
    if (err instanceof FirestoreError && err.code === 'permission-denied') {
      return null
    }
    throw err
  }
}

/**
 * Liste les members dont `uid` est tuteur (via `array-contains` sur
 * `guardianUserIds`). Trié `lastName` asc côté client. Vide si aucun pupille.
 *
 * Pattern simple query + tri JS (cf. `apps/courtbase-register/CLAUDE.md`
 * §"Pattern simple query + JS sort", CLAUDE.md racine point 10) : le `orderBy`
 * Firestore-side a été retiré. Raisons :
 *  - **Robustesse** : Firestore exclut silencieusement de tout `orderBy` les
 *    docs où le champ trié est absent. Un `/members` legacy ou créé
 *    manuellement sans `lastName` disparaissait alors de cette query — donc le
 *    pupille ET toutes ses cotisations s'évaporaient de l'écran `/factures`,
 *    qui affichait à tort l'empty-state « Aucune facture ».
 *  - **Pas d'index composite** : volume faible (< quelques pupilles / user).
 *
 * Le tri JS tolère les `lastName` absents (fallback chaîne vide) au lieu de
 * les écarter du résultat.
 */
export async function listMyDependents(uid: string): Promise<Member[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, MEMBERS),
        where('guardianUserIds', 'array-contains', uid),
      ),
    )
    return snap.docs
      .map(snapToMember)
      .sort((a, b) => (a.lastName ?? '').localeCompare(b.lastName ?? ''))
  } catch (err) {
    if (err instanceof FirestoreError && err.code === 'permission-denied') {
      return []
    }
    throw err
  }
}

/**
 * Lecture du contact privé d'un member (`/members/{id}/private/contact`).
 *
 * Permissions (cf. `firestore.rules` §members.private.contact) : lecture
 * autorisée pour admin / coach / linked member / guardians. Côté register, le
 * caller est soit linkedMember (sa propre fiche), soit guardian (pupille).
 *
 * Retourne `null` si la sub-collection n'a jamais été écrite ou si la lecture
 * est rejetée (dégradation silencieuse — l'UI affichera juste un champ vide).
 */
export async function getMemberContact(
  memberId: string,
): Promise<MemberContactData | null> {
  try {
    const snap = await getDoc(doc(db, MEMBERS, memberId, 'private', 'contact'))
    if (!snap.exists()) return null
    return snap.data() as MemberContactData
  } catch (err) {
    if (err instanceof FirestoreError && err.code === 'permission-denied') {
      return null
    }
    throw err
  }
}

/**
 * Écrit le contact privé d'un member (`/members/{id}/private/contact`).
 *
 * Utilisé exclusivement par le linked member lui-même depuis Account.vue.
 * Rules (`firestore.rules` §members.private.contact) : write par
 * `isLinkedMember(memberId)` autorisé — donc le caller doit avoir
 * `userDoc.memberId === memberId`. Les guardians ne sont PAS autorisés à
 * écrire ici en v1 (ils contactent l'admin si besoin).
 *
 * `setDoc` avec ID fixe `contact` : crée le doc si absent, écrase sinon.
 * Idempotent. Pas de `merge` : on attend que l'UI fournisse les deux champs.
 */
export async function updateMemberContact(
  memberId: string,
  data: MemberContactData,
): Promise<void> {
  await setDoc(doc(db, MEMBERS, memberId, 'private', 'contact'), data)
}

/**
 * Convenience : combine `getLinkedMember` (self-registration majeure) +
 * `listMyDependents` (parents) → la liste des `/members` que le user peut
 * inscrire ou suivre depuis l'app register.
 */
export async function listAccessibleMembers(
  uid: string,
  linkedMemberId: string | null,
): Promise<Member[]> {
  const [self, dependents] = await Promise.all([
    linkedMemberId ? getLinkedMember(linkedMemberId) : Promise.resolve(null),
    listMyDependents(uid),
  ])
  const out: Member[] = []
  if (self) out.push(self)
  for (const m of dependents) {
    if (out.some((x) => x.id === m.id)) continue
    out.push(m)
  }
  return out
}
