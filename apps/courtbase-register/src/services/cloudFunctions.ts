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
// matchExistingMember — lookup d'un member existant par AVS exact.
// Source : functions/src/registrations/matchExistingMember.ts
// Auth : signed-in.
// ---------------------------------------------------------------------------

export interface MatchExistingMemberInput {
  /** AVS au format 756.XXXX.XXXX.XX (obligatoire). */
  avs: string
}

export interface MemberMatch {
  memberId: string
  firstName: string
  lastName: string
  /** ISO YYYY-MM-DD. */
  birthDateIso: string
  matchedOn: 'avs' | 'licenseNumber'
  /**
   * `true` si le dossier est déjà rattaché à un compte autre que le caller
   * (`linkedUserId` ou `guardianUserIds`). Le wizard refuse alors le
   * rattachement self-service et invite à contacter le club.
   */
  linkedToOtherAccount: boolean
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
  /**
   * AVS au format 756.XXXX.XXXX.XX. Obligatoire — la callable `submitRegistration`
   * rejette toute soumission sans AVS valide. `null` n'est toléré qu'au transit
   * d'un draft incomplet (le wizard bloque la soumission en amont).
   */
  avs: string | null
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

// ---------------------------------------------------------------------------
// unlinkGuardian — détache le caller d'un member dont il est tuteur.
// Source : functions/src/account/unlinkGuardian.ts
// Auth : signed-in (la callable vérifie que le caller est dans
// `guardianUserIds` du member ciblé).
// ---------------------------------------------------------------------------

export interface UnlinkGuardianInput {
  memberId: string
}

export interface UnlinkGuardianOutput {
  ok: true
  memberId: string
  /** `true` si le caller a été retiré ; `false` si déjà absent (idempotence). */
  removed: boolean
}

export async function unlinkGuardian(
  input: UnlinkGuardianInput,
): Promise<UnlinkGuardianOutput> {
  const callable = httpsCallable<UnlinkGuardianInput, UnlinkGuardianOutput>(
    functions,
    'unlinkGuardian',
  )
  const result: HttpsCallableResult<UnlinkGuardianOutput> = await callable(input)
  return result.data
}

// ---------------------------------------------------------------------------
// deleteMyAccount — supprime intégralement le compte du caller : Firebase
// Auth + /users/{uid} + linked /members/{id} (en cascade dues/teams/registrations).
// Source : functions/src/account/deleteMyAccount.ts
// Auth : signed-in. Refuse si pupilles restants ou si linked member a des
// dues `paid` (préservation comptable).
// ---------------------------------------------------------------------------

export interface DeleteMyAccountInput {
  /** Doit valoir exactement `"SUPPRIMER"` (anti-fat-finger). */
  confirmText: string
}

export interface DeleteMyAccountOutput {
  ok: true
  deletedUid: string
  hadLinkedMember: boolean
  removedFromTeamsCount: number
  unlinkedRegistrationsCount: number
  deletedDuesCount: number
  deletedDraftsCount: number
  deletedFcmTokensCount: number
  /** `false` si le cleanup Firestore a réussi mais que l'API Auth a échoué. */
  authDeleted: boolean
}

export async function deleteMyAccount(
  input: DeleteMyAccountInput,
): Promise<DeleteMyAccountOutput> {
  const callable = httpsCallable<DeleteMyAccountInput, DeleteMyAccountOutput>(
    functions,
    'deleteMyAccount',
  )
  const result: HttpsCallableResult<DeleteMyAccountOutput> = await callable(input)
  return result.data
}
