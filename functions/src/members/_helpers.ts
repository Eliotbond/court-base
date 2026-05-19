/**
 * `members/_helpers.ts` — helpers de création/dédup de membres, partagés par
 * les callables `members/` (aujourd'hui `coachCreateMember`).
 *
 * La logique de dédup (`findExactMemberMatch`) et de defaults comms duplique
 * volontairement celle de `registrations/confirmRegistration.ts` : ce dernier
 * est encore en évolution active, on évite de coupler les deux. À dé-dupliquer
 * dans une passe de cleanup une fois les deux chemins stabilisés.
 */
import { HttpsError } from 'firebase-functions/v2/https'
import type {
  CommsRecipient,
  MemberCommsConfig,
  MemberData,
} from '@club-app/shared-types'
import { Timestamp, db, normalizeName } from '../registrations/_helpers'

/** Âge légal CH. Constante stable, dupliquée de `members.repo.ts`. */
const MAJORITY_AGE_YEARS = 18

/** Représentation minimale d'un Timestamp lisible (shared-types ou Admin SDK). */
interface SecondsTimestamp {
  seconds: number
  nanoseconds: number
}

/**
 * `true` si `birthDate` correspond à un mineur à la date `now`. Comparaison
 * day-grained sur `{ seconds }`.
 */
export function isMinor(
  birthDate: { seconds: number },
  now: { seconds: number },
): boolean {
  const SECONDS_PER_YEAR = Math.round(365.25 * 86_400)
  const eighteenYearsLater =
    birthDate.seconds + MAJORITY_AGE_YEARS * SECONDS_PER_YEAR
  return eighteenYearsLater > now.seconds
}

/**
 * Defaults de routage des comms pour un membre créé côté club (coach/admin).
 * Un membre sans date de naissance connue est traité comme **adulte**
 * (`recipient = 'member'`) — l'UI doit avertir l'admin de la birthDate absente.
 * Mineur → `'guardians'`, majeur → `'member'`. `majorityTransition` nul.
 */
export function defaultComms(
  birthDate: SecondsTimestamp | null,
  now: { seconds: number },
): MemberCommsConfig {
  let recipient: CommsRecipient
  if (birthDate == null) {
    recipient = 'member'
  } else {
    recipient = isMinor(birthDate, now) ? 'guardians' : 'member'
  }
  return {
    billingRecipients: [recipient],
    generalRecipients: [recipient],
    majorityTransition: null,
  }
}

/**
 * Cherche un membre existant correspondant strictement à une identité, dans la
 * transaction `tx`. Évite de créer un doublon quand le coach saisit un joueur
 * déjà présent au club (autre équipe, saison précédente…).
 *
 * Stratégie stricte (pas de fuzzy — un faux positif rattacherait un mauvais
 * membre à l'équipe) :
 *  1. AVS présent → match exact `avs`. 1 → utilise ; ≥2 → `failed-precondition`
 *     (doublon DB à résoudre manuellement) ; 0 → fallthrough.
 *  2. `birthDate` présent → query day-window sur `birthDate` + filtre client
 *     `firstName`/`lastName` normalisés. 1 → utilise ; ≥2 → `failed-precondition`.
 *  3. Ni AVS ni `birthDate` → `null` (impossible de dédupliquer de façon sûre).
 *
 * Toutes les lectures (`tx.get`) doivent précéder les writes de la transaction
 * appelante (contrainte Firestore).
 */
export async function findExactMemberMatch(
  tx: FirebaseFirestore.Transaction,
  player: {
    firstName: string
    lastName: string
    birthDate: SecondsTimestamp | null
    avs: string | null
  },
): Promise<string | null> {
  // 1. AVS — censé unique à une personne.
  if (player.avs) {
    const avsQuery = db()
      .collection('members')
      .where('avs', '==', player.avs)
      .limit(2)
    const snap = await tx.get(avsQuery)
    if (snap.size === 1) return snap.docs[0]!.id
    if (snap.size > 1) {
      throw new HttpsError(
        'failed-precondition',
        `Plusieurs membres partagent l'AVS ${player.avs}. Dédoublonnez manuellement.`,
      )
    }
    // 0 → fallthrough vers match name+DOB.
  }

  // 2. firstName + lastName + birthDate (jour exact).
  if (player.birthDate == null) return null

  const start = new Date(player.birthDate.seconds * 1000)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  const dobQuery = db()
    .collection('members')
    .where('birthDate', '>=', Timestamp.fromDate(start))
    .where('birthDate', '<', Timestamp.fromDate(end))
    .limit(10)
  const snap = await tx.get(dobQuery)
  if (snap.empty) return null

  const firstNorm = normalizeName(player.firstName)
  const lastNorm = normalizeName(player.lastName)
  const matches = snap.docs.filter((d) => {
    const m = d.data() as MemberData
    return (
      normalizeName(m.firstName) === firstNorm &&
      normalizeName(m.lastName) === lastNorm
    )
  })
  if (matches.length === 1) return matches[0]!.id
  if (matches.length > 1) {
    const iso = start.toISOString().slice(0, 10)
    throw new HttpsError(
      'failed-precondition',
      `Plusieurs membres correspondent à ${player.firstName} ${player.lastName} (${iso}). Dédoublonnez manuellement.`,
    )
  }
  return null
}
