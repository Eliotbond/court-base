import { httpsCallable, type HttpsCallableResult } from 'firebase/functions'
import type { CotisationStatus } from '@club-app/shared-types'
import { functions } from './firebase'

// =============================================================================
// Wrappers typés des Cloud Functions callables.
// Les types Input/Output sont gardés en sync manuel avec functions/src/ — toute
// modification de contrat doit être propagée ici. À terme, déplacer dans
// packages/shared-types/src/callables.ts pour single source.
// =============================================================================

// -----------------------------------------------------------------------------
// runMigrations — applique les migrations Firestore jusqu'à `targetVersion`
// (ou latest si omis). Idempotent.
// Côté functions : functions/src/migrations/runMigrations.ts
// Auth : admin OU rootAdmin. À appeler depuis Settings → Admin team ou un script
// d'ops. Le tout premier appel sur un projet vierge crée /_meta/schema.
// -----------------------------------------------------------------------------
export interface RunMigrationsInput {
  /** Version cible. Omis = latest disponible. */
  targetVersion?: number
}

export interface AppliedMigration {
  version: number
  name: string
}

export interface RunMigrationsOutput {
  from: number
  to: number
  applied: AppliedMigration[]
}

export async function runMigrations(
  input: RunMigrationsInput = {},
): Promise<RunMigrationsOutput> {
  const callable = httpsCallable<RunMigrationsInput, RunMigrationsOutput>(
    functions,
    'runMigrations',
  )
  const result: HttpsCallableResult<RunMigrationsOutput> = await callable(input)
  return result.data
}

// -----------------------------------------------------------------------------
// setRootAdminClaim — grant / revoke le claim rootAdmin sur un user existant.
// Côté functions : functions/src/admin/setRootAdminClaim.ts
// Auth : **rootAdmin uniquement**. Anti-self-revoke (le caller ne peut pas
// retirer son propre claim). Pour le tout premier rootAdmin d'un projet, voir
// `functions/scripts/setRootAdmin.ts` (script local, hors-app).
// -----------------------------------------------------------------------------
export interface SetRootAdminClaimInput {
  email: string
  value: boolean
}

export interface SetRootAdminClaimOutput {
  uid: string
  email: string
  rootAdmin: boolean
}

export async function setRootAdminClaim(
  input: SetRootAdminClaimInput,
): Promise<SetRootAdminClaimOutput> {
  const callable = httpsCallable<SetRootAdminClaimInput, SetRootAdminClaimOutput>(
    functions,
    'setRootAdminClaim',
  )
  const result: HttpsCallableResult<SetRootAdminClaimOutput> = await callable(input)
  return result.data
}

// -----------------------------------------------------------------------------
// listRootAdminUids — retourne les uids portant le claim rootAdmin sur ce
// projet. Le claim étant stocké côté Auth (et non Firestore), seul l'Admin SDK
// peut lister les autres rootAdmins. Côté UI : badge sur la liste Admin team.
// Côté functions : functions/src/admin/listRootAdminUids.ts
// Auth : admin OU rootAdmin.
// -----------------------------------------------------------------------------
export interface ListRootAdminUidsOutput {
  uids: string[]
}

export async function listRootAdminUids(): Promise<ListRootAdminUidsOutput> {
  const callable = httpsCallable<void, ListRootAdminUidsOutput>(
    functions,
    'listRootAdminUids',
  )
  const result: HttpsCallableResult<ListRootAdminUidsOutput> = await callable()
  return result.data
}

// -----------------------------------------------------------------------------
// acceptInvitation — appelée juste après une sign-in OAuth si /users/{uid}
// est absent. Cherche une invitation pour l'email du caller, crée /users/{uid}
// avec le rôle de l'invitation, supprime le doc d'invitation.
// Côté functions : functions/src/admin/acceptInvitation.ts
// Auth : signed-in. Codes d'erreur typiques :
//   - not-found      → pas d'invitation pour cet email
//   - already-exists → /users/{uid} existe déjà
// -----------------------------------------------------------------------------
export interface AcceptInvitationOutput {
  uid: string
  email: string
  role: string
}

export async function acceptInvitation(): Promise<AcceptInvitationOutput> {
  const callable = httpsCallable<void, AcceptInvitationOutput>(
    functions,
    'acceptInvitation',
  )
  const result: HttpsCallableResult<AcceptInvitationOutput> = await callable()
  return result.data
}

// -----------------------------------------------------------------------------
// refuseRegistration — passe une /registrations/{id} en `refused` et logge
// /teams/{teamId}/refusalLogs.
// Côté functions : functions/src/registrations/refuseRegistration.ts
// Auth : signed-in. Le caller doit être admin OU coach de la team
// (cf. assertCoachOrAdmin côté server). Codes d'erreur typiques :
//   - permission-denied  → caller ni admin, ni coach de la team
//   - failed-precondition → status non-refusable (terminal)
//   - not-found          → registrationId inexistant
//   - invalid-argument   → reason vide
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// cancelRegistration — l'auteur annule sa propre inscription.
// Côté functions : functions/src/registrations/cancelRegistration.ts
// Auth : signed-in + submittedByUid == caller. **Pas** utilisable par un
// admin/coach pour annuler une inscription tierce — pour ce flow il faudra
// une callable séparée (à venir). Cette app web ne l'expose donc qu'en
// dépannage (ex. l'admin sait que l'auteur est ici).
// -----------------------------------------------------------------------------
export interface CancelRegistrationInput {
  registrationId: string
  note?: string | null
}

export interface CancelRegistrationOutput {
  ok: true
  registrationId: string
  status: string
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

// -----------------------------------------------------------------------------
// markTrialInProgress — passe une registration en `trial_in_progress`, démarre
// le compteur 14j (scheduled `onTrialExpired` à venir).
// Côté functions : functions/src/registrations/markTrialInProgress.ts
// Auth : signed-in. Caller doit être admin OU coach de la team. Codes typiques :
//   - permission-denied   → ni admin, ni coach de la team
//   - failed-precondition → status pas dans {open_pending_trial,
//                            conditional_pending_review, conditional_pending_trial}
//   - not-found           → registrationId inexistant
// -----------------------------------------------------------------------------
export interface MarkTrialInProgressInput {
  registrationId: string
}

export interface MarkTrialInProgressOutput {
  ok: true
  registrationId: string
  status: 'trial_in_progress'
  trialStartedAt: { seconds: number; nanoseconds: number }
}

export async function markTrialInProgress(
  input: MarkTrialInProgressInput,
): Promise<MarkTrialInProgressOutput> {
  const callable = httpsCallable<MarkTrialInProgressInput, MarkTrialInProgressOutput>(
    functions,
    'markTrialInProgress',
  )
  const result: HttpsCallableResult<MarkTrialInProgressOutput> = await callable(input)
  return result.data
}

// -----------------------------------------------------------------------------
// confirmRegistration — interrompt la période d'essai en confirmant le joueur :
// crée le `/members/{id}` (si `matchedMemberId === null`), ajoute le member au
// `team.playerIds` (déclenche `initiateDuesOnPlayerActivation` → cotisation
// émise), passe la registration en `confirmed_pending_dues`.
// Côté functions : functions/src/registrations/confirmRegistration.ts
// Auth : signed-in. Caller doit être admin OU coach de la team. Codes typiques :
//   - permission-denied   → ni admin, ni coach de la team
//   - failed-precondition → status != 'trial_in_progress'
//   - not-found           → registrationId inexistant
//   - internal            → team disparue (cohérence broken)
// -----------------------------------------------------------------------------
export interface ConfirmRegistrationInput {
  registrationId: string
}

export interface ConfirmRegistrationOutput {
  ok: true
  registrationId: string
  memberId: string
  memberCreated: boolean
  status: 'confirmed_pending_dues'
}

export async function confirmRegistration(
  input: ConfirmRegistrationInput,
): Promise<ConfirmRegistrationOutput> {
  const callable = httpsCallable<ConfirmRegistrationInput, ConfirmRegistrationOutput>(
    functions,
    'confirmRegistration',
  )
  const result: HttpsCallableResult<ConfirmRegistrationOutput> = await callable(input)
  return result.data
}

// -----------------------------------------------------------------------------
// markCotisationPaid (wrapper TS) — marque une cotisation comme payée côté
// serveur. Le nom de la callable serveur reste `'markDuePaid'` (non renommée
// pour ne pas casser le déploiement Firebase Functions existant). Côté wire,
// les champs `dueId` (input/output) sont conservés ; le wrapper TS traduit
// ces champs en `cotisationId` pour aligner l'API client sur la terminologie
// "cotisation" (facture membre).
//
// Le serveur :
//   - applique `status: 'paid'` + `paidAt` + `paidAmount` + `paymentMethod`
//     (+ `notes` optionnel) sur `/dues/{dueId}` (transaction).
//   - pose `recordedBy` à l'uid du caller (côté serveur, anti-spoof).
//   - relit/synchronise `member.duesStatus` (via trigger ou inline).
//   - peut être appelée par un admin OU un treasurer (cf. nouveau rôle).
// Côté functions : functions/src/dues/markDuePaid.ts (subagent 2).
// Auth : signed-in. Codes d'erreur typiques :
//   - permission-denied   → caller ni admin, ni treasurer, ni rootAdmin
//   - failed-precondition → cotisation déjà `paid` ou `cancelled`
//   - not-found           → cotisationId inexistant
//   - invalid-argument    → paidAmount négatif ou paymentMethod inconnu
// -----------------------------------------------------------------------------
export type MarkCotisationPaymentMethod = 'transfer' | 'cash' | 'card' | 'other'

export interface MarkCotisationPaidInput {
  cotisationId: string
  /** Montant effectivement perçu (CHF). Si omis : le serveur utilise `cotisation.amount`. */
  paidAmount?: number
  paymentMethod: MarkCotisationPaymentMethod
  /** Date de paiement (ISO 8601 ou epoch ms). Si omis : `now`. */
  paidAt?: string | number | null
  /** Note libre optionnelle (référence externe, commentaire). */
  notes?: string | null
}

export interface MarkCotisationPaidOutput {
  ok: true
  cotisationId: string
  status: 'paid'
  paidAt: { seconds: number; nanoseconds: number }
  paidAmount: number
}

/**
 * Shape du payload côté wire (vers/depuis le callable serveur).
 * Le serveur attend/renvoie `dueId` — on l'isole en interne pour ne pas
 * polluer l'API client.
 */
interface WireMarkDuePaidInput {
  dueId: string
  paidAmount?: number
  paymentMethod: MarkCotisationPaymentMethod
  paidAt?: string | number | null
  notes?: string | null
}

interface WireMarkDuePaidOutput {
  ok: true
  dueId: string
  status: 'paid'
  paidAt: { seconds: number; nanoseconds: number }
  paidAmount: number
}

export async function markCotisationPaid(
  input: MarkCotisationPaidInput,
): Promise<MarkCotisationPaidOutput> {
  const callable = httpsCallable<WireMarkDuePaidInput, WireMarkDuePaidOutput>(
    functions,
    'markDuePaid',
  )
  const wireInput: WireMarkDuePaidInput = {
    dueId: input.cotisationId,
    paymentMethod: input.paymentMethod,
  }
  if (input.paidAmount !== undefined) wireInput.paidAmount = input.paidAmount
  if (input.paidAt !== undefined) wireInput.paidAt = input.paidAt
  if (input.notes !== undefined) wireInput.notes = input.notes
  const result: HttpsCallableResult<WireMarkDuePaidOutput> = await callable(wireInput)
  return {
    ok: result.data.ok,
    cotisationId: result.data.dueId,
    status: result.data.status,
    paidAt: result.data.paidAt,
    paidAmount: result.data.paidAmount,
  }
}

// -----------------------------------------------------------------------------
// updateCotisation (wrapper TS) — modifie une cotisation hors du flux paiement
// (dates, statut, note). Le nom de la callable serveur reste `'updateDue'` ;
// côté wire les champs `dueId` et les dates en epoch millis sont utilisés. Le
// wrapper traduit `cotisationId`→`dueId` et `Date`→epoch millis.
//
// Sémantique : un champ omis n'est PAS modifié côté serveur ; un `null`
// explicite efface le champ (`issuedAt` / `dueAt` / `notes`). `activatedAt`
// n'est pas nullable. Le statut `'paid'` est refusé (`invalid-argument`) — le
// passage à payé passe par `markCotisationPaid`.
//
// Côté functions : functions/src/dues/updateDue.ts
// Auth : signed-in. Le caller doit être rootAdmin OU admin OU treasurer.
// Codes d'erreur typiques :
//   - permission-denied → caller ni rootAdmin, ni admin, ni treasurer
//   - not-found         → cotisationId inexistant
//   - invalid-argument  → statut 'paid', statut inconnu, date mal formée, ou
//                          aucun champ fourni
// -----------------------------------------------------------------------------
export interface UpdateCotisationInput {
  cotisationId: string
  /** Date d'activation (J0). `null` interdit — champ non nullable. Omis = inchangé. */
  activatedAt?: Date | null
  /** Date d'émission. `null` = effacer. Omis = inchangé. */
  issuedAt?: Date | null
  /** Date d'échéance. `null` = effacer. Omis = inchangé. */
  dueAt?: Date | null
  /** Statut. `'paid'` interdit (passer par markCotisationPaid). Omis = inchangé. */
  status?: CotisationStatus
  /** Note libre. `null` = effacer. Omis = inchangé. */
  notes?: string | null
}

/**
 * Shape du payload côté wire — le serveur attend `dueId` + dates en epoch ms.
 */
interface WireUpdateDueInput {
  dueId: string
  activatedAt?: number
  issuedAt?: number | null
  dueAt?: number | null
  status?: CotisationStatus
  notes?: string | null
}

interface WireUpdateDueOutput {
  ok: true
}

export async function updateCotisation(input: UpdateCotisationInput): Promise<void> {
  const callable = httpsCallable<WireUpdateDueInput, WireUpdateDueOutput>(
    functions,
    'updateDue',
  )
  const wireInput: WireUpdateDueInput = { dueId: input.cotisationId }
  // `activatedAt` n'est pas nullable côté serveur — on n'envoie que les Date.
  if (input.activatedAt !== undefined && input.activatedAt !== null) {
    wireInput.activatedAt = input.activatedAt.getTime()
  }
  // `issuedAt` / `dueAt` : `null` explicite = effacer, Date = poser, omis = inchangé.
  if (input.issuedAt !== undefined) {
    wireInput.issuedAt = input.issuedAt === null ? null : input.issuedAt.getTime()
  }
  if (input.dueAt !== undefined) {
    wireInput.dueAt = input.dueAt === null ? null : input.dueAt.getTime()
  }
  if (input.status !== undefined) wireInput.status = input.status
  if (input.notes !== undefined) wireInput.notes = input.notes
  await callable(wireInput)
}

// -----------------------------------------------------------------------------
// deleteMember — suppression DÉFINITIVE d'un membre (correction d'erreur de
// création). À distinguer de l'archive (`member.status = 'archived'`) qui est
// le flow normal de fin d'adhésion et conserve l'historique comptable.
//
// Effets côté serveur :
//   - delete /members/{memberId} + sub-collections (`private/contact`, etc.)
//   - retire l'uid du member des `team.coachIds` / `team.playerIds`
//   - met à `null` le `matchedMemberId` sur les `/registrations` historiques
//   - supprime les `/dues` non payées (status != 'paid')
//
// Côté functions : functions/src/members/deleteMember.ts
// Auth : admin uniquement (pas treasurer, pas coach). Codes d'erreur :
//   - unauthenticated     → user pas signé
//   - permission-denied   → user signé mais pas admin / rootAdmin
//   - not-found           → memberId inexistant
//   - invalid-argument    → confirmName ne correspond pas au "First Last" du
//                            member (normalisation diacritiques côté serveur)
//   - failed-precondition → au moins un /dues `status === 'paid'` existe — le
//                            message serveur suggère d'utiliser l'archive
//                            à la place pour préserver la compta.
// -----------------------------------------------------------------------------
export interface DeleteMemberInput {
  memberId: string
  /**
   * Confirmation typée par l'admin : doit matcher `"<firstName> <lastName>"`
   * du member (côté serveur : trim + lowercase + normalisation diacritiques
   * avant comparaison). Sert de filet anti-clic-accidentel.
   */
  confirmName: string
}

export interface DeleteMemberOutput {
  ok: true
  memberId: string
  /** Nombre d'équipes (coach ou player) dont le member a été retiré. */
  removedFromTeamsCount: number
  /** Nombre de /registrations dont le `matchedMemberId` a été nullifié. */
  unlinkedRegistrationsCount: number
  /** Nombre de /dues non payées supprimées. */
  deletedDuesCount: number
}

export async function deleteMember(
  input: DeleteMemberInput,
): Promise<DeleteMemberOutput> {
  const callable = httpsCallable<DeleteMemberInput, DeleteMemberOutput>(
    functions,
    'deleteMember',
  )
  const result: HttpsCallableResult<DeleteMemberOutput> = await callable(input)
  return result.data
}
