/**
 * `matchExistingMember`
 *
 * Callable invoqué pendant le wizard d'inscription (étape §4.4 — identité du
 * joueur), une fois un AVS valide saisi. Cherche un `/members/{id}` portant le
 * même AVS pour éviter de créer un doublon.
 *
 * L'AVS étant désormais **obligatoire** dans le wizard (cf. `docs/registrations/
 * wizard.md` §Step 2), c'est le seul critère de dédoublonnage live :
 *  1. Match exact `member.avs == avs`.
 *  2. Fallback historique `member.licenseNumber == avs` — anciens dossiers où
 *     l'AVS avait été saisi dans le champ `licenseNumber` avant l'introduction
 *     du champ `avs` dédié.
 *
 * Plus de fuzzy match nom/prénom/DOB : le filet anti-doublon name+DOB subsiste
 * uniquement côté `confirmRegistration` (`findExactMemberMatch`), pour rattraper
 * les membres legacy sans AVS enregistré en base.
 *
 * AVS comparé tel quel, au format `756.XXXX.XXXX.XX` — c'est la forme stockée
 * dans `member.avs` par tous les chemins de création (`confirmRegistration`,
 * `coachCreateMember`, `apps/web` members.repo) et la forme interrogée par
 * `findExactMemberMatch`. Aucune normalisation digits-only : elle ne matcherait
 * aucun document.
 *
 * Chaque match porte `linkedToOtherAccount` : `true` si le dossier est déjà
 * rattaché à un compte AUTRE que le caller (`linkedUserId` propriétaire ou
 * `guardianUserIds` tuteur). Le wizard refuse alors le rattachement
 * self-service et invite à contacter le club — on n'autorise pas un compte à
 * s'approprier le dossier d'une personne déjà gérée ailleurs.
 *
 * Retourne tous les candidats trouvés (max 5). Le client demande confirmation
 * explicite à l'utilisateur avant de set `registration.matchedMemberId`.
 *
 * Auth : signed-in. Pas de scope rôle — le résultat ne fuite que `firstName`,
 * `lastName`, `birthDate` du membre + un booléen `linkedToOtherAccount`. Pas
 * l'AVS, pas l'email, pas le téléphone, pas l'identité de l'autre compte.
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import type { MemberData } from '@club-app/shared-types'
import { col } from './_helpers'

/** Format AVS suisse — identique à la validation du wizard register. */
const AVS_REGEX = /^756\.\d{4}\.\d{4}\.\d{2}$/

const MAX_MATCHES = 5

/**
 * Convertit un Timestamp neutre (`shared-types` package — pas le `firebase-admin`
 * Timestamp) en ISO `YYYY-MM-DD`. Les `MemberData.birthDate` étant typés via le
 * package partagé pour rester portables côté client, on n'a pas `.toDate()`.
 */
function toIsoDay(ts: { seconds: number; nanoseconds: number }): string {
  return new Date(ts.seconds * 1000).toISOString().slice(0, 10)
}

/**
 * `true` si le membre est déjà rattaché à un compte AUTRE que le caller —
 * c.-à-d. `linkedUserId` (compte propriétaire) ou l'un des `guardianUserIds`
 * (compte tuteur) pointe vers un uid différent.
 *
 * Un dossier rattaché UNIQUEMENT au caller (cas renouvellement / ré-inscription
 * par le même compte) renvoie `false` : il reste librement re-rattachable par
 * son propre compte. Un dossier sans aucun rattachement renvoie `false` aussi.
 */
function isLinkedToOtherAccount(m: MemberData, callerUid: string): boolean {
  if (m.linkedUserId != null && m.linkedUserId !== callerUid) return true
  const guardians = Array.isArray(m.guardianUserIds) ? m.guardianUserIds : []
  return guardians.some((g) => g !== callerUid)
}

interface MatchExistingMemberInput {
  /** AVS au format 756.XXXX.XXXX.XX — obligatoire (le wizard valide en amont). */
  avs: unknown
}

export interface MemberMatch {
  memberId: string
  firstName: string
  lastName: string
  /** ISO YYYY-MM-DD. */
  birthDateIso: string
  /** Champ-source du match : explicite pour l'UX de confirmation. */
  matchedOn: 'avs' | 'licenseNumber'
  /**
   * `true` si le dossier est déjà rattaché à un compte autre que le caller.
   * Le wizard refuse alors le rattachement self-service et invite à contacter
   * le club.
   */
  linkedToOtherAccount: boolean
}

export interface MatchExistingMemberOutput {
  matches: MemberMatch[]
}

/** Projette un doc `/members` vers un `MemberMatch` (champs publics + flag). */
function toMemberMatch(
  doc: FirebaseFirestore.QueryDocumentSnapshot<MemberData>,
  matchedOn: MemberMatch['matchedOn'],
  callerUid: string,
): MemberMatch {
  const m = doc.data()
  return {
    memberId: doc.id,
    firstName: m.firstName,
    lastName: m.lastName,
    birthDateIso: m.birthDate ? toIsoDay(m.birthDate) : '',
    matchedOn,
    linkedToOtherAccount: isLinkedToOtherAccount(m, callerUid),
  }
}

export const matchExistingMember = onCall(
  async (
    request: CallableRequest<MatchExistingMemberInput>,
  ): Promise<MatchExistingMemberOutput> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.')
    }
    const callerUid = request.auth.uid

    const raw = request.data?.avs
    const avs = typeof raw === 'string' ? raw.trim() : ''

    // AVS absent / mal formé : on retourne un résultat vide plutôt que de
    // throw. Le matching est best-effort — le wizard valide déjà le format en
    // amont et n'appelle cette callable qu'avec un AVS valide.
    if (!AVS_REGEX.test(avs)) {
      return { matches: [] }
    }

    const matches: MemberMatch[] = []
    const seen = new Set<string>()

    // 1) Match exact sur le champ AVS dédié.
    const avsSnap = await col<MemberData>('members')
      .where('avs', '==', avs)
      .limit(MAX_MATCHES)
      .get()
    for (const doc of avsSnap.docs) {
      if (seen.has(doc.id)) continue
      seen.add(doc.id)
      matches.push(toMemberMatch(doc, 'avs', callerUid))
    }

    // 2) Fallback historique : anciens dossiers où l'AVS avait été saisi dans
    //    le champ `licenseNumber` (avant l'introduction du champ `avs` dédié).
    if (matches.length < MAX_MATCHES) {
      const licSnap = await col<MemberData>('members')
        .where('licenseNumber', '==', avs)
        .limit(MAX_MATCHES - matches.length)
        .get()
      for (const doc of licSnap.docs) {
        if (seen.has(doc.id)) continue
        seen.add(doc.id)
        matches.push(toMemberMatch(doc, 'licenseNumber', callerUid))
      }
    }

    logger.info('matchExistingMember', {
      callerUid,
      matchCount: matches.length,
      blockedCount: matches.filter((x) => x.linkedToOtherAccount).length,
    })

    return { matches }
  },
)
