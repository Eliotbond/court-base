import { httpsCallable, type HttpsCallableResult } from 'firebase/functions'
import type {
  RegistrationFor,
  RegistrationRelationship,
  RegistrationStatus,
} from '@club-app/shared-types'
import { functions } from './firebase'

/**
 * Wrappers typés des Cloud Functions callables — côté app `courtbase-register`.
 *
 * Pattern identique à `apps/web/src/services/cloudFunctions.ts` : types
 * Input/Output gardés en sync manuel avec `functions/src/registrations/`. À
 * terme, déplacer dans `packages/shared-types/src/callables.ts` (single
 * source) — pour l'instant on duplique pour avancer.
 */

// ---------------------------------------------------------------------------
// matchExistingMember — lookup AVS + fuzzy match nom/DOB.
// Source : functions/src/registrations/matchExistingMember.ts
// Auth : signed-in.
// ---------------------------------------------------------------------------

export interface MatchExistingMemberInput {
  firstName: string
  lastName: string
  /** ISO YYYY-MM-DD. */
  birthDate: string
  /** AVS brut (format libre, normalisé côté server). `null` si avsUnavailable. */
  avs: string | null
}

export interface MemberMatch {
  memberId: string
  firstName: string
  lastName: string
  /** ISO YYYY-MM-DD. */
  birthDateIso: string
  matchedOn: 'avs' | 'licenseNumber' | 'fuzzy_name_dob'
  distance: number
}

export interface MatchExistingMemberOutput {
  matches: MemberMatch[]
}

export async function matchExistingMember(
  input: MatchExistingMemberInput,
): Promise<MatchExistingMemberOutput> {
  const callable = httpsCallable<MatchExistingMemberInput, MatchExistingMemberOutput>(
    functions,
    'matchExistingMember',
  )
  const result: HttpsCallableResult<MatchExistingMemberOutput> = await callable(input)
  return result.data
}

// ---------------------------------------------------------------------------
// submitRegistration — soumission finale d'une registration.
// Source : functions/src/registrations/submitRegistration.ts
// Auth : signed-in + profil complété.
// ---------------------------------------------------------------------------

export interface SubmitRegistrationPlayer {
  firstName: string
  lastName: string
  /** ISO YYYY-MM-DD. */
  birthDate: string
  gender: 'M' | 'F' | 'other' | null
  /** AVS brut, normalisé côté server. `null` si `avsUnavailable`. */
  avs: string | null
  avsUnavailable: boolean
  phone: string | null
}

export interface SubmitRegistrationInput {
  /** Si fourni, finalise un draft existant ; sinon crée un nouveau doc. */
  draftRegistrationId?: string
  registrationFor: RegistrationFor
  relationship: RegistrationRelationship | null
  relationshipOther: string | null
  player: SubmitRegistrationPlayer
  matchedMemberId: string | null
  teamId: string
  previouslyLicensed: boolean
  previousClubName: string | null
  previousClubAbroad: boolean
  /** Storage path de la lettre de sortie déjà uploadée (peut être null). */
  transferLetterStoragePath: string | null
}

export interface SubmitRegistrationOutput {
  registrationId: string
  status: RegistrationStatus
}

export async function submitRegistration(
  input: SubmitRegistrationInput,
): Promise<SubmitRegistrationOutput> {
  const callable = httpsCallable<SubmitRegistrationInput, SubmitRegistrationOutput>(
    functions,
    'submitRegistration',
  )
  const result: HttpsCallableResult<SubmitRegistrationOutput> = await callable(input)
  return result.data
}

// ---------------------------------------------------------------------------
// cancelRegistration — annulation par le user.
// Source : functions/src/registrations/cancelRegistration.ts
// Auth : signed-in + auteur de la registration.
// ---------------------------------------------------------------------------

export interface CancelRegistrationInput {
  registrationId: string
  note?: string | null
}

export interface CancelRegistrationOutput {
  ok: true
  registrationId: string
  status: RegistrationStatus
}

export async function cancelRegistration(
  input: CancelRegistrationInput,
): Promise<CancelRegistrationOutput> {
  const callable = httpsCallable<CancelRegistrationInput, CancelRegistrationOutput>(
    functions,
    'cancelRegistration',
  )
  const result: HttpsCallableResult<CancelRegistrationOutput> = await callable(input)
  return result.data
}

// ---------------------------------------------------------------------------
// refuseRegistration — exposé pour complétude, mais l'app register n'a pas
// vocation à appeler cette callable (elle vit côté app web pour les coachs).
// Maintenue ici pour les futurs flows admin "à la maison" et pour la
// cohérence du contrat de types.
// ---------------------------------------------------------------------------

export interface RefuseRegistrationInput {
  registrationId: string
  reason: string
}

export interface RefuseRegistrationOutput {
  ok: true
  registrationId: string
  refusalLogId: string
}

export async function refuseRegistration(
  input: RefuseRegistrationInput,
): Promise<RefuseRegistrationOutput> {
  const callable = httpsCallable<RefuseRegistrationInput, RefuseRegistrationOutput>(
    functions,
    'refuseRegistration',
  )
  const result: HttpsCallableResult<RefuseRegistrationOutput> = await callable(input)
  return result.data
}
