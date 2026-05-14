import {
  FirestoreError,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import type { Member, MemberData } from '@club-app/shared-types'
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
 * `guardianUserIds`). Ordonné par `lastName`. Vide si aucun pupille.
 *
 * Index requis (déjà posé) : `members (guardianUserIds CONTAINS, lastName ASC)`.
 */
export async function listMyDependents(uid: string): Promise<Member[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, MEMBERS),
        where('guardianUserIds', 'array-contains', uid),
        orderBy('lastName'),
      ),
    )
    return snap.docs.map(snapToMember)
  } catch (err) {
    if (err instanceof FirestoreError && err.code === 'permission-denied') {
      return []
    }
    throw err
  }
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
