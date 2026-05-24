import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

/**
 * Wrappers typés autour des callables Firebase utilisées par
 * `courtbase-app`. Convention : un wrapper par callable, retour `Promise`
 * sur la `data` extraite.
 *
 * Cf. `docs/firebase.md` pour la liste des callables côté backend.
 */

// ─── acceptInvitation ─────────────────────────────────────────────
// Créé par l'admin via `/invitations`. Quand un user OAuth sign-in avec
// l'email d'une invitation pending, cette callable :
//   - lookup `/invitations` par email du caller
//   - crée `/users/{uid}` avec `roles` issus de l'invitation
//   - supprime le doc `/invitations/{id}`
// Cf. `docs/main.md` § Admin invitation flow.

export interface AcceptInvitationResult {
  /** Rôles posés sur `/users/{uid}` (peut être vide si l'invitation
   * n'en porte pas, mais en pratique au moins 1 rôle est garanti). */
  roles: string[]
}

export async function acceptInvitation(): Promise<AcceptInvitationResult> {
  const fn = httpsCallable<void, AcceptInvitationResult>(functions, 'acceptInvitation')
  const res = await fn()
  return res.data
}

// ─── Registrations (coach actions) ───────────────────────────────
// Toutes les transitions de status passent par ces callables — pas de
// write Firestore direct côté client. Cf. `docs/registrations/lifecycle.md`
// et `docs/registrations/coach-app-screens.md` (bottom-sheets CO9).

export interface MarkTrialInProgressInput {
  registrationId: string
}
export interface MarkTrialInProgressResult {
  ok: true
  registrationId: string
  status: 'trial_in_progress'
  /** Millis epoch — borne du compteur 14 jours côté client. */
  trialStartedAt: number
}

export async function markTrialInProgress(
  input: MarkTrialInProgressInput,
): Promise<MarkTrialInProgressResult> {
  const fn = httpsCallable<MarkTrialInProgressInput, MarkTrialInProgressResult>(
    functions,
    'markTrialInProgress',
  )
  const res = await fn(input)
  return res.data
}

export interface ConfirmRegistrationInput {
  registrationId: string
}
export interface ConfirmRegistrationResult {
  ok: true
  registrationId: string
  memberId: string
  memberCreated: boolean
  status: 'confirmed_pending_dues'
}

export async function confirmRegistration(
  input: ConfirmRegistrationInput,
): Promise<ConfirmRegistrationResult> {
  const fn = httpsCallable<ConfirmRegistrationInput, ConfirmRegistrationResult>(
    functions,
    'confirmRegistration',
  )
  const res = await fn(input)
  return res.data
}

export interface RefuseRegistrationInput {
  registrationId: string
  /** Motif libre, ≥ 5 chars trim (validation serveur). */
  reason: string
}
export interface RefuseRegistrationResult {
  ok: true
  registrationId: string
  refusalLogId: string
}

export async function refuseRegistration(
  input: RefuseRegistrationInput,
): Promise<RefuseRegistrationResult> {
  const fn = httpsCallable<RefuseRegistrationInput, RefuseRegistrationResult>(
    functions,
    'refuseRegistration',
  )
  const res = await fn(input)
  return res.data
}

// ─── Members (coach actions) ─────────────────────────────────────
// Édition restreinte des champs de base d'un joueur de l'équipe du coach.
// Cf. `functions/src/members/coachUpdateMember.ts` pour la whitelist serveur.
// Champ absent ⇒ non modifié. `null` (birthDate / email / phone) ⇒ efface.
// `birthDate` = epoch millis.

export interface CoachUpdateMemberInput {
  memberId: string
  firstName?: string
  lastName?: string
  /** Epoch millis. `null` pour effacer. */
  birthDate?: number | null
  /** `null` ou `''` pour vider. */
  email?: string | null
  /** `null` ou `''` pour vider. */
  phone?: string | null
  comms?: {
    /** Non vide. Valeurs : `'member' | 'guardians'`. */
    generalRecipients?: Array<'member' | 'guardians'>
  }
}

export interface CoachUpdateMemberResult {
  ok: true
  memberId: string
}

export async function coachUpdateMember(
  input: CoachUpdateMemberInput,
): Promise<CoachUpdateMemberResult> {
  const fn = httpsCallable<CoachUpdateMemberInput, CoachUpdateMemberResult>(
    functions,
    'coachUpdateMember',
  )
  const res = await fn(input)
  return res.data
}

export interface CoachDeactivateMemberInput {
  memberId: string
  mode: 'bench' | 'archive'
  /** Requis si mode === 'archive'. */
  reason?: string
}

export interface CoachDeactivateMemberResult {
  ok: true
  memberId: string
  mode: 'bench' | 'archive'
}

export async function coachDeactivateMember(
  input: CoachDeactivateMemberInput,
): Promise<CoachDeactivateMemberResult> {
  const fn = httpsCallable<CoachDeactivateMemberInput, CoachDeactivateMemberResult>(
    functions,
    'coachDeactivateMember',
  )
  const res = await fn(input)
  return res.data
}

// ─── Licenses — coach review per-doc (PR2) ───────────────────────
// Cf. `functions/src/licenses/coachReviewLicenseDoc.ts` + brief PR2
// dans `docs/licenses/parent-completion-workflow.md` § PR2.
//
// Auth coach scope (`teamId ∈ user.teamIds`) ou admin/rootAdmin.
// Pré-conditions : `status === 'parent_docs_submitted'` + `kind ∈ requiredDocs`
// + `uploadedDocs[kind]` présent. Refus → status → `pending_parent_docs`.
// Accept all → status → `coach_validated`.

export interface CoachReviewLicenseDocInput {
  requestId: string
  kind: 'id_front' | 'id_back' | 'avs' | 'transfer_letter_swiss'
  decision: 'accept' | 'refuse'
  refusalReason?: string
}

export interface CoachReviewLicenseDocResult {
  ok: true
  requestId: string
  newStatus:
    | 'pending_parent_docs'
    | 'parent_docs_submitted'
    | 'coach_validated'
    | 'approved'
    | 'rejected'
  allCoachAccepted: boolean
}

export async function coachReviewLicenseDoc(
  input: CoachReviewLicenseDocInput,
): Promise<CoachReviewLicenseDocResult> {
  const fn = httpsCallable<CoachReviewLicenseDocInput, CoachReviewLicenseDocResult>(
    functions,
    'coachReviewLicenseDoc',
  )
  const res = await fn(input)
  return res.data
}

// ─── Members — photo licence (PR-B) ─────────────────────────────
// Cf. `functions/src/members/setMemberLicensePhoto.ts` +
// `docs/members/license-photo.md`. Si PR-B n'est pas encore mergée au
// moment du build, ces wrappers existent quand même (PR-B pourra les
// remplacer / enrichir sans risque). Auth coach scope ou admin.

export interface SetMemberLicensePhotoInput {
  memberId: string
  /** Pattern `members/{memberId}/license-photo.{ext}`. */
  storagePath: string
  /** MIME type du fichier uploadé (jpeg/png/webp). */
  contentType: string
  /** Taille en octets — re-vérifiée serveur-side. */
  sizeBytes: number
}

export interface SetMemberLicensePhotoResult {
  ok: true
  memberId: string
  photoStoragePath: string
}

export async function setMemberLicensePhoto(
  input: SetMemberLicensePhotoInput,
): Promise<SetMemberLicensePhotoResult> {
  const fn = httpsCallable<SetMemberLicensePhotoInput, SetMemberLicensePhotoResult>(
    functions,
    'setMemberLicensePhoto',
  )
  const res = await fn(input)
  return res.data
}

export interface RemoveMemberLicensePhotoInput {
  memberId: string
}

export interface RemoveMemberLicensePhotoResult {
  ok: true
  memberId: string
}

export async function removeMemberLicensePhoto(
  input: RemoveMemberLicensePhotoInput,
): Promise<RemoveMemberLicensePhotoResult> {
  const fn = httpsCallable<RemoveMemberLicensePhotoInput, RemoveMemberLicensePhotoResult>(
    functions,
    'removeMemberLicensePhoto',
  )
  const res = await fn(input)
  return res.data
}
