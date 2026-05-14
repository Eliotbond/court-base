/**
 * `matchExistingMember`
 *
 * Callable invoqué pendant le wizard d'inscription (étape §4.4 — identité du
 * joueur). Cherche un `/members/{id}` correspondant aux infos saisies pour
 * éviter de créer un doublon :
 *
 *  1. Si `avs` fourni → exact match sur `member.avs` (normalisé digits) puis
 *     fallback sur `member.licenseNumber == avs` (historique).
 *  2. Sinon → fuzzy match `firstName + lastName` (Levenshtein ≤ 2 sommé) ET
 *     `birthDate` identique au jour près.
 *
 * Retourne tous les candidats trouvés (max 5) avec un score de confiance.
 * Le client demande confirmation explicite à l'utilisateur avant de set
 * `registration.matchedMemberId`.
 *
 * Auth : signed-in. Pas de scope rôle — n'importe quel utilisateur authentifié
 * peut tester un match (le résultat ne fuite que les infos identité du membre :
 * firstName, lastName, birthDate. Pas l'AVS, pas l'email, pas le téléphone).
 *
 * Volume : on lit la collection `/members` filtrée par `birthDate` pour
 * limiter la taille du scan (un seul index simple sur `birthDate`). Acceptable
 * tant que < 10k membres / club.
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import type { MemberData } from '@club-app/shared-types'
import { Timestamp, col, levenshtein, normalizeAvs, normalizeName } from './_helpers'

/**
 * Convertit un Timestamp neutre (`shared-types` package — pas le `firebase-admin`
 * Timestamp) en ISO `YYYY-MM-DD`. Les `MemberData.birthDate` étant typés via le
 * package partagé pour rester portables côté client, on n'a pas `.toDate()`.
 */
function toIsoDay(ts: { seconds: number; nanoseconds: number }): string {
  return new Date(ts.seconds * 1000).toISOString().slice(0, 10)
}

interface MatchExistingMemberInput {
  firstName: unknown
  lastName: unknown
  /** ISO string "YYYY-MM-DD" — converti en jour-Timestamp côté server. */
  birthDate: unknown
  /** AVS brut saisi (format libre), `null` si avsUnavailable. */
  avs: unknown
}

export interface MemberMatch {
  memberId: string
  firstName: string
  lastName: string
  birthDateIso: string
  /** Champ-source du match : explicite pour l'UX de confirmation. */
  matchedOn: 'avs' | 'licenseNumber' | 'fuzzy_name_dob'
  /** 0 = exact, > 0 = nombre d'opérations Levenshtein cumulées (fuzzy). */
  distance: number
}

export interface MatchExistingMemberOutput {
  matches: MemberMatch[]
}

interface ParsedInput {
  firstName: string
  lastName: string
  birthDate: Date
  avs: string | null
}

function parseInput(data: MatchExistingMemberInput): ParsedInput {
  const { firstName, lastName, birthDate, avs } = data ?? ({} as MatchExistingMemberInput)
  if (typeof firstName !== 'string' || firstName.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'firstName is required')
  }
  if (typeof lastName !== 'string' || lastName.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'lastName is required')
  }
  if (typeof birthDate !== 'string' || birthDate.length === 0) {
    throw new HttpsError('invalid-argument', 'birthDate is required (ISO YYYY-MM-DD)')
  }
  const parsed = new Date(birthDate)
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpsError('invalid-argument', 'birthDate is not a valid ISO date')
  }
  const avsStr = typeof avs === 'string' ? avs : null
  return {
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    birthDate: parsed,
    // AVS reste optionnel à ce stade — la callable matche aussi sans.
    avs: avsStr,
  }
}

/**
 * Borne haute/basse d'une journée (UTC) pour query Firestore. Les
 * `member.birthDate` sont stockées comme jour-Timestamp sans heure
 * (cf. `members.repo.createMember`) — on cherche `[startOfDay, endOfDay)`.
 */
function dayWindow(d: Date): { from: FirebaseFirestore.Timestamp; to: FirebaseFirestore.Timestamp } {
  const start = new Date(d)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  return {
    from: Timestamp.fromDate(start),
    to: Timestamp.fromDate(end),
  }
}

const MAX_MATCHES = 5
const FUZZY_MAX_DISTANCE = 2

export const matchExistingMember = onCall(
  async (
    request: CallableRequest<MatchExistingMemberInput>,
  ): Promise<MatchExistingMemberOutput> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.')
    }
    const input = parseInput(request.data)

    const matches: MemberMatch[] = []
    const seen = new Set<string>()

    // 1) Match exact AVS (ou fallback licenseNumber, pour historique).
    const normalizedAvs = normalizeAvs(input.avs)
    if (normalizedAvs) {
      const avsSnap = await col<MemberData>('members')
        .where('avs', '==', normalizedAvs)
        .limit(MAX_MATCHES)
        .get()
      for (const doc of avsSnap.docs) {
        if (seen.has(doc.id)) continue
        seen.add(doc.id)
        const m = doc.data()
        matches.push({
          memberId: doc.id,
          firstName: m.firstName,
          lastName: m.lastName,
          birthDateIso: m.birthDate ? toIsoDay(m.birthDate) : '',
          matchedOn: 'avs',
          distance: 0,
        })
      }
      if (matches.length < MAX_MATCHES) {
        const licSnap = await col<MemberData>('members')
          .where('licenseNumber', '==', normalizedAvs)
          .limit(MAX_MATCHES - matches.length)
          .get()
        for (const doc of licSnap.docs) {
          if (seen.has(doc.id)) continue
          seen.add(doc.id)
          const m = doc.data()
          matches.push({
            memberId: doc.id,
            firstName: m.firstName,
            lastName: m.lastName,
            birthDateIso: m.birthDate ? toIsoDay(m.birthDate) : '',
            matchedOn: 'licenseNumber',
            distance: 0,
          })
        }
      }
    }

    // 2) Fuzzy match (nom + prénom + DOB exact) — toujours testé, même si
    //    un match AVS a déjà été trouvé : un parent peut saisir un AVS erroné
    //    et on veut signaler la collision potentielle.
    const { from, to } = dayWindow(input.birthDate)
    const dobSnap = await col<MemberData>('members')
      .where('birthDate', '>=', from)
      .where('birthDate', '<', to)
      .limit(50)  // garde-fou : DOB collision avec 50+ membres c'est pathologique
      .get()
    const targetFirst = normalizeName(input.firstName)
    const targetLast = normalizeName(input.lastName)
    for (const doc of dobSnap.docs) {
      if (seen.has(doc.id)) continue
      const m = doc.data()
      const dFirst = levenshtein(normalizeName(m.firstName), targetFirst)
      const dLast = levenshtein(normalizeName(m.lastName), targetLast)
      const total = dFirst + dLast
      if (total > FUZZY_MAX_DISTANCE) continue
      seen.add(doc.id)
      matches.push({
        memberId: doc.id,
        firstName: m.firstName,
        lastName: m.lastName,
        birthDateIso: m.birthDate ? toIsoDay(m.birthDate) : '',
        matchedOn: 'fuzzy_name_dob',
        distance: total,
      })
      if (matches.length >= MAX_MATCHES) break
    }

    // Tri stable : exacts d'abord (distance 0), puis par distance croissante.
    matches.sort((a, b) => a.distance - b.distance)

    logger.info('matchExistingMember', {
      callerUid: request.auth.uid,
      matchCount: matches.length,
      avsProvided: normalizedAvs !== null,
    })

    return { matches: matches.slice(0, MAX_MATCHES) }
  },
)
