import { httpsCallable, type HttpsCallableResult } from 'firebase/functions'
import type {
  BasketplanCompetitionLink,
  CotisationStatus,
  LicenseDocKind,
  LicenseRequestStatus,
  TreasurerConfirmSignedDocInput,
  TreasurerConfirmSignedDocResult,
  TreasurerFinalizeLicenseInput,
  TreasurerFinalizeLicenseResult,
  TreasurerMarkSentAndPaidInput,
  TreasurerMarkSentAndPaidResult,
  TreasurerUploadSignableDocInput,
  TreasurerUploadSignableDocResult,
} from '@club-app/shared-types'
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

// -----------------------------------------------------------------------------
// confirmLicense — confirme une licence `/licenses` (transition `pending` →
// `active`). Côté serveur :
//   - passe `/licenses/{id}` en `status: 'active'` + `confirmedAt` +
//     `confirmedByUid` (uid du caller, anti-spoof).
//   - poste une écriture comptable `/accountingEntries` : débit du compte de
//     charge « Licences fédérales » (résolu par son nom), crédit trésorerie,
//     pour le montant `feeSnapshot`. L'id de l'écriture est dénormalisé dans
//     `license.accountingEntryId`.
//   - dénormalise la réf `member.officialLicense` / `coachLicense` selon le
//     `role` snapshotté de la licence (rend l'officiel / coach ACTIF pour la
//     saison concernée).
// Côté functions : functions/src/licenses/confirmLicense.ts
// Auth : signed-in. Le caller doit être rootAdmin OU admin OU treasurer OU
// secretary. Codes d'erreur typiques :
//   - permission-denied   → caller ni rootAdmin, ni admin, ni treasurer,
//                            ni secretary
//   - failed-precondition → licence déjà `cancelled` (terminal)
//   - not-found           → licenseId inexistant
//   - internal            → compte « Licences fédérales » introuvable côté
//                            plan comptable (seed manquant)
//
// Idempotence : appeler `confirmLicense` sur une licence déjà `active` ne
// re-poste PAS d'écriture comptable — le serveur renvoie `alreadyActive: true`
// avec l'`accountingEntryId` existant.
// -----------------------------------------------------------------------------
export interface ConfirmLicenseInput {
  licenseId: string
}

export interface ConfirmLicenseOutput {
  ok: true
  /** `true` si la licence était déjà `active` (aucune écriture re-postée). */
  alreadyActive: boolean
  /** Id de l'écriture comptable de la charge (`/accountingEntries`). */
  accountingEntryId: string
}

export async function confirmLicense(
  input: ConfirmLicenseInput,
): Promise<ConfirmLicenseOutput> {
  const callable = httpsCallable<ConfirmLicenseInput, ConfirmLicenseOutput>(
    functions,
    'confirmLicense',
  )
  const result: HttpsCallableResult<ConfirmLicenseOutput> = await callable(input)
  return result.data
}

// -----------------------------------------------------------------------------
// treasurerReviewLicenseDoc — review per-doc d'une /licenseRequests par un
// trésorier/admin/secrétaire (PR3 workflow demande de licence parent).
//
// Symétrique à `coachReviewLicenseDoc` mais opère après le coach :
//   - pré-condition serveur : `request.status === 'coach_validated'` ;
//   - pose la review sur `uploadedDocs.{kind}.treasurerReview` ;
//   - **refus** → reset complet (status → `pending_parent_docs`, reset
//     `coachValidatedAt/ByUid` à `null`) ;
//   - **accept** → status reste `coach_validated`. Pour finaliser, le
//     trésorier doit appeler `validateLicenseRequest` séparément.
//
// Côté functions : functions/src/licenses/treasurerReviewLicenseDoc.ts
// Auth : claim `rootAdmin` OU rôle `admin | treasurer | secretary`. Codes
// d'erreur typiques :
//   - permission-denied   → caller n'a pas le rôle requis
//   - failed-precondition → status != `coach_validated`, kind pas dans
//                            `requiredDocs`, ou doc pas encore uploadé
//   - invalid-argument    → `kind` inconnu, `decision` invalide, ou
//                            `refusalReason` mal formaté (trim + 5..500 chars)
//   - not-found           → requestId inexistant
// -----------------------------------------------------------------------------
export interface TreasurerReviewLicenseDocInput {
  requestId: string
  kind: LicenseDocKind
  decision: 'accept' | 'refuse'
  /** Requis si `decision === 'refuse'`. Trim + length ∈ [5, 500] côté serveur. */
  refusalReason?: string
}

export interface TreasurerReviewLicenseDocOutput {
  ok: true
  requestId: string
  newStatus: LicenseRequestStatus
  /** `true` si tous les `requiredDocs` ont désormais `treasurerReview.accepted`. */
  allTreasurerAccepted: boolean
}

export async function treasurerReviewLicenseDoc(
  input: TreasurerReviewLicenseDocInput,
): Promise<TreasurerReviewLicenseDocOutput> {
  const callable = httpsCallable<
    TreasurerReviewLicenseDocInput,
    TreasurerReviewLicenseDocOutput
  >(functions, 'treasurerReviewLicenseDoc')
  const result: HttpsCallableResult<TreasurerReviewLicenseDocOutput> =
    await callable(input)
  return result.data
}

// -----------------------------------------------------------------------------
// validateLicenseRequest — décision finale (approve / reject) sur une
// /licenseRequests par un trésorier/admin/secrétaire (PR3).
//
// Effets côté serveur :
//   - approve : exige que tous les `requiredDocs` aient `treasurerReview.accepted`
//     (sinon `failed-precondition`), résout le 1er `/licenseTypes` joueur actif
//     (sinon `failed-precondition` "Aucun /licenseTypes joueur actif"), crée
//     `/licenses/{auto-id}` `status:'pending'` avec snapshot
//     `role/level/name/fee` + `requestId` + `requestedByUid`, pose
//     `request.status = 'approved'`.
//   - reject : pose `request.status = 'rejected'`. Pas de licence créée.
//
// La transition `pending → active` + l'écriture comptable de la charge restent
// gérées par `confirmLicense` séparément (cf. wrapper ci-dessus).
//
// Côté functions : functions/src/licenses/validateLicenseRequest.ts
// Auth : claim `rootAdmin` OU rôle `admin | treasurer | secretary`. Codes
// d'erreur typiques :
//   - permission-denied   → caller n'a pas le rôle requis
//   - failed-precondition → status != `coach_validated`, ou approve sans
//                            que tous les docs soient validés trésorier, ou
//                            aucun /licenseTypes joueur actif
//   - invalid-argument    → decision invalide, ou comment > 500 chars
//   - not-found           → requestId inexistant (ou memberId orphelin)
// -----------------------------------------------------------------------------
export interface ValidateLicenseRequestInput {
  requestId: string
  decision: 'approve' | 'reject'
  /** Optionnel — trim + length ≤ 500 côté serveur. Vide / whitespace = null. */
  comment?: string
}

export interface ValidateLicenseRequestOutput {
  ok: true
  requestId: string
  newStatus: 'approved' | 'rejected'
  /** id `/licenses/{id}` créée si `approve`, `null` si `reject`. */
  licenseId: string | null
}

export async function validateLicenseRequest(
  input: ValidateLicenseRequestInput,
): Promise<ValidateLicenseRequestOutput> {
  const callable = httpsCallable<
    ValidateLicenseRequestInput,
    ValidateLicenseRequestOutput
  >(functions, 'validateLicenseRequest')
  const result: HttpsCallableResult<ValidateLicenseRequestOutput> =
    await callable(input)
  return result.data
}

// =============================================================================
// Basketplan — wrappers PR 1 (mapping team ↔ compétitions Swiss Basketball).
// Côté functions : functions/src/basketplan/*. Tous les callables sont en
// europe-west6. Le scope auth est appliqué côté serveur via
// `assertAdminOrCoachOfTeam` / `assertAdminOnly` — le client n'ajoute pas de
// garde supplémentaire (mais l'UI peut masquer les CTA hors-scope).
//
// Voir docs/basketplan-integration.md § 5 pour le contrat détaillé et
// docs/chantier-basketplan.md (PR 1) pour le plan d'exécution.
// =============================================================================

/**
 * Description d'une compétition Basketplan (championnat/coupe) renvoyée par
 * `listBasketplanLeagueHoldings`. Type dupliqué depuis
 * `functions/src/basketplan/_parsers.ts` (`LeagueHolding`) — gardé en sync
 * manuel comme les autres types I/O des callables. Ne pas importer du serveur
 * (ce package n'est pas dépendance du front).
 */
export interface BasketplanLeagueHolding {
  id: number
  name: string
  fullName: string
  federationCode: string
  federationId: number
  season: string
  sex: 'M' | 'F' | 'X'
  /** YYYY-MM-DD */
  from: string
  /** YYYY-MM-DD */
  to: string
}

/**
 * Équipe d'un club, telle qu'inscrite dans une compétition donnée. Type
 * dupliqué depuis `functions/src/basketplan/_parsers.ts`
 * (`ClubTeamInLeague`).
 */
export interface BasketplanClubTeamInLeague {
  id: number
  name: string
  clubId: number
  clubName: string
}

// -----------------------------------------------------------------------------
// listBasketplanLeagueHoldings — Liste les compétitions d'une fédération
// (cache mémoire 1h côté serveur). Auth : signed-in.
// Côté functions : functions/src/basketplan/listLeagueHoldings.ts
// Codes d'erreur typiques :
//   - unauthenticated → caller non signé
//   - unavailable     → Basketplan injoignable / parse échoué
// -----------------------------------------------------------------------------
export interface ListBasketplanLeagueHoldingsInput {
  federationId: number
}

export interface ListBasketplanLeagueHoldingsOutput {
  leagueHoldings: BasketplanLeagueHolding[]
}

export async function listBasketplanLeagueHoldings(
  input: ListBasketplanLeagueHoldingsInput,
): Promise<ListBasketplanLeagueHoldingsOutput> {
  const callable = httpsCallable<
    ListBasketplanLeagueHoldingsInput,
    ListBasketplanLeagueHoldingsOutput
  >(functions, 'listBasketplanLeagueHoldings')
  const result: HttpsCallableResult<ListBasketplanLeagueHoldingsOutput> =
    await callable(input)
  return result.data
}

// -----------------------------------------------------------------------------
// listClubTeamsInLeague — Liste les équipes du club inscrites dans une
// compétition donnée (filtrées par `config/club.basketplan.clubId` côté
// serveur, dédupliquées). Auth : signed-in.
// Côté functions : functions/src/basketplan/listClubTeamsInLeague.ts
// Codes d'erreur typiques :
//   - unauthenticated   → caller non signé
//   - failed-precondition → `config/club.basketplan.clubId` non configuré
//   - unavailable       → Basketplan injoignable
// -----------------------------------------------------------------------------
export interface ListClubTeamsInLeagueInput {
  leagueHoldingId: number
}

export interface ListClubTeamsInLeagueOutput {
  teams: BasketplanClubTeamInLeague[]
}

export async function listClubTeamsInLeague(
  input: ListClubTeamsInLeagueInput,
): Promise<ListClubTeamsInLeagueOutput> {
  const callable = httpsCallable<
    ListClubTeamsInLeagueInput,
    ListClubTeamsInLeagueOutput
  >(functions, 'listClubTeamsInLeague')
  const result: HttpsCallableResult<ListClubTeamsInLeagueOutput> =
    await callable(input)
  return result.data
}

// -----------------------------------------------------------------------------
// linkTeamToBasketplan — Ajoute un `BasketplanCompetitionLink` sur
// `/teams/{teamId}.basketplanLinks`. Re-fetch côté serveur pour résoudre les
// caches (`federationCode`, `leagueHoldingName`, `season`, `teamNameInLeague`).
// Auth : admin OU coach-of-team.
// Côté functions : functions/src/basketplan/linkTeam.ts
// Codes d'erreur typiques :
//   - permission-denied   → ni admin, ni coach de la team
//   - already-exists      → lien déjà présent (même federation/league/team)
//   - failed-precondition → `teamIdInLeague` introuvable dans la ligue
//   - not-found           → teamId ou leagueHoldingId inexistant côté
//                            Firestore / Basketplan
//   - unavailable         → Basketplan injoignable
// -----------------------------------------------------------------------------
export interface LinkTeamToBasketplanInput {
  teamId: string
  federationId: number
  leagueHoldingId: number
  teamIdInLeague: number
}

export interface LinkTeamToBasketplanOutput {
  ok: true
  linkId: string
  link: BasketplanCompetitionLink
}

export async function linkTeamToBasketplan(
  input: LinkTeamToBasketplanInput,
): Promise<LinkTeamToBasketplanOutput> {
  const callable = httpsCallable<
    LinkTeamToBasketplanInput,
    LinkTeamToBasketplanOutput
  >(functions, 'linkTeamToBasketplan')
  const result: HttpsCallableResult<LinkTeamToBasketplanOutput> =
    await callable(input)
  return result.data
}

// -----------------------------------------------------------------------------
// unlinkTeamBasketplan — Retire un lien par `linkId`.
// Auth : admin OU coach-of-team.
// Côté functions : functions/src/basketplan/unlinkTeam.ts
// Codes d'erreur typiques :
//   - permission-denied → ni admin, ni coach de la team
//   - not-found         → teamId ou linkId inexistant
// -----------------------------------------------------------------------------
export interface UnlinkTeamBasketplanInput {
  teamId: string
  linkId: string
}

export interface UnlinkTeamBasketplanOutput {
  ok: true
}

export async function unlinkTeamBasketplan(
  input: UnlinkTeamBasketplanInput,
): Promise<UnlinkTeamBasketplanOutput> {
  const callable = httpsCallable<
    UnlinkTeamBasketplanInput,
    UnlinkTeamBasketplanOutput
  >(functions, 'unlinkTeamBasketplan')
  const result: HttpsCallableResult<UnlinkTeamBasketplanOutput> =
    await callable(input)
  return result.data
}

// -----------------------------------------------------------------------------
// toggleTeamBasketplanLink — Active / désactive un lien sans le retirer (pause).
// Idempotent.
// Auth : admin OU coach-of-team.
// Côté functions : functions/src/basketplan/toggleLink.ts
// Codes d'erreur typiques :
//   - permission-denied → ni admin, ni coach de la team
//   - not-found         → teamId ou linkId inexistant
// -----------------------------------------------------------------------------
export interface ToggleTeamBasketplanLinkInput {
  teamId: string
  linkId: string
  active: boolean
}

export interface ToggleTeamBasketplanLinkOutput {
  ok: true
}

export async function toggleTeamBasketplanLink(
  input: ToggleTeamBasketplanLinkInput,
): Promise<ToggleTeamBasketplanLinkOutput> {
  const callable = httpsCallable<
    ToggleTeamBasketplanLinkInput,
    ToggleTeamBasketplanLinkOutput
  >(functions, 'toggleTeamBasketplanLink')
  const result: HttpsCallableResult<ToggleTeamBasketplanLinkOutput> =
    await callable(input)
  return result.data
}

// -----------------------------------------------------------------------------
// testBasketplanConnection — Ping diagnostic Settings.
// Lit `config/club.basketplan.defaultFederationId` puis fetch
// `findAllLeagueHoldings.do?federationId=N`. Pas d'exception sur erreur
// réseau — emballe `error` dans le payload pour affichage UI direct.
// Auth : admin only.
// Côté functions : functions/src/basketplan/testConnection.ts
// Codes d'erreur typiques :
//   - permission-denied → caller ni admin, ni rootAdmin
// -----------------------------------------------------------------------------
export interface TestBasketplanConnectionOutput {
  ok: boolean
  federationId: number | null
  leagueCount?: number
  error?: string
}

export async function testBasketplanConnection(): Promise<TestBasketplanConnectionOutput> {
  const callable = httpsCallable<
    Record<string, never>,
    TestBasketplanConnectionOutput
  >(functions, 'testBasketplanConnection')
  const result: HttpsCallableResult<TestBasketplanConnectionOutput> =
    await callable({})
  return result.data
}

// -----------------------------------------------------------------------------
// syncBasketplanForTeam — déclenchement à la demande du sync Basketplan pour
// une équipe donnée. Le cron nocturne couvre l'ensemble du club ; cette
// callable permet à un admin (ou un coach de la team) de forcer le sync en
// dehors du créneau planifié (debug, urgence calendrier, etc.).
//
// Côté functions : functions/src/basketplan/syncForTeam.ts
// Auth : signed-in + (admin OR coach-of-team), vérifié serveur via
// `assertAdminOrCoachOfTeam`. Codes d'erreur typiques :
//   - unauthenticated     → caller non signé
//   - permission-denied   → caller ni admin, ni coach de la team
//   - not-found           → teamId inexistant
//   - invalid-argument    → teamId vide / manquant
//
// La callable ne touche PAS `config/club.basketplan.lastSyncAt` (réservé au
// cron qui agrège sur toutes les teams). Pour le diagnostic, le summary
// `perLink` est suffisant côté UI (toast / banner inline).
// -----------------------------------------------------------------------------
export interface SyncBasketplanForTeamInput {
  teamId: string
}

export interface SyncBasketplanForTeamPerLink {
  linkId: string
  /** Compétition Basketplan synchronisée (libellé pour reporting UI). */
  leagueHoldingId: number
  leagueHoldingName: string
  processed: number
  created: number
  patched: number
  linked: number
  skipped: number
  errors: number
  /** Message d'erreur si le link a complètement échoué (sinon `null`). */
  error: string | null
}

export interface SyncBasketplanForTeamOutput {
  ok: true
  teamId: string
  summary: {
    perLink: SyncBasketplanForTeamPerLink[]
  }
}

export async function syncBasketplanForTeam(
  input: SyncBasketplanForTeamInput,
): Promise<SyncBasketplanForTeamOutput> {
  const callable = httpsCallable<
    SyncBasketplanForTeamInput,
    SyncBasketplanForTeamOutput
  >(functions, 'syncBasketplanForTeam')
  const result: HttpsCallableResult<SyncBasketplanForTeamOutput> =
    await callable(input)
  return result.data
}

// =============================================================================
// Photo licence membre — PR-D (wrappers minimum, écrasés si besoin par PR-B).
//
// Les deux callables ci-dessous sont livrées par PR-B (`functions/src/members/
// setMemberLicensePhoto.ts` + `removeMemberLicensePhoto.ts`). PR-D est codé en
// supposant qu'elles existent ; si PR-B n'est pas encore mergé au moment du
// typecheck, ces wrappers permettent d'avancer sans bloquer (PR-B peut les
// écraser à la marge — la shape Input/Output est documentée dans
// `docs/members/license-photo.md`).
//
// Le coach upload directement la photo dans Storage (rules permissives :
// signed-in + size/MIME), puis appelle `setMemberLicensePhoto` qui :
//   1. vérifie le scope (`assertCoachOrAdminOfMember` côté serveur),
//   2. pose `member.photoStoragePath / photoUpdatedAt / photoUpdatedByUid`,
//   3. best-effort delete de l'ancien `photoStoragePath` (si différent).
//
// `removeMemberLicensePhoto` est plus restrictif (admin / rootAdmin only,
// vérifié côté serveur). Efface l'objet Storage + clear les 3 champs Firestore.
// =============================================================================

/**
 * Input de `setMemberLicensePhoto`.
 *
 * `storagePath` doit pointer le fichier déjà uploadé par le client juste
 * avant l'appel (pattern `members/{memberId}/license-photo.{ext}`).
 * `contentType` et `sizeBytes` sont snapshottés côté serveur pour audit /
 * future validation côté plan de licence fédérale.
 */
export interface SetMemberLicensePhotoInput {
  memberId: string
  storagePath: string
  contentType: string
  sizeBytes: number
}

export interface SetMemberLicensePhotoOutput {
  ok: true
  memberId: string
  /** Pattern `members/{memberId}/license-photo.{ext}`. */
  photoStoragePath: string
}

export async function setMemberLicensePhoto(
  input: SetMemberLicensePhotoInput,
): Promise<SetMemberLicensePhotoOutput> {
  const callable = httpsCallable<
    SetMemberLicensePhotoInput,
    SetMemberLicensePhotoOutput
  >(functions, 'setMemberLicensePhoto')
  const result: HttpsCallableResult<SetMemberLicensePhotoOutput> =
    await callable(input)
  return result.data
}

/**
 * Input de `removeMemberLicensePhoto`.
 *
 * Réservé à `admin | rootAdmin` (vérifié serveur). Best-effort sur le delete
 * Storage : si l'objet n'existe plus (déjà nettoyé), pas d'erreur, on
 * remet quand même les 3 champs Firestore à `null`.
 */
export interface RemoveMemberLicensePhotoInput {
  memberId: string
}

export interface RemoveMemberLicensePhotoOutput {
  ok: true
  memberId: string
}

export async function removeMemberLicensePhoto(
  input: RemoveMemberLicensePhotoInput,
): Promise<RemoveMemberLicensePhotoOutput> {
  const callable = httpsCallable<
    RemoveMemberLicensePhotoInput,
    RemoveMemberLicensePhotoOutput
  >(functions, 'removeMemberLicensePhoto')
  const result: HttpsCallableResult<RemoveMemberLicensePhotoOutput> =
    await callable(input)
  return result.data
}

// =============================================================================
// Workflow trésorier des /licenseRequests (PR3 trésorier-phase, 2026-05-24).
//
// 4 callables couvrant les transitions trésorier :
//
//   coach_validated
//     │ treasurerUploadSignableDoc  → awaiting_parent_signature
//   parent_signed
//     │ treasurerConfirmSignedDoc   → form_confirmed
//   form_confirmed
//     │ treasurerMarkSentAndPaid    → sent_paid   (+ création /licenses pending)
//   sent_paid
//     │ treasurerFinalizeLicense    → approved    (+ /licenses → active via confirmLicense)
//
// Contrats I/O importés depuis `@club-app/shared-types/license-treasurer.ts`.
// Auth (toutes) : claim `rootAdmin` OU rôle `treasurer` sur /users/{uid}.roles.
// PAS `admin`, PAS `secretary`. Aligné avec le module compta.
// Côté functions : functions/src/licenses/treasurer*.ts (Phase B).
//
// Pattern d'erreurs typique (par callable) :
//   - permission-denied   → caller ni rootAdmin, ni treasurer
//   - failed-precondition → statut source incorrect (transition refusée)
//   - invalid-argument    → input mal formé (storagePath absent, licenseNumber vide, …)
//   - not-found           → requestId inexistant
// =============================================================================

// -----------------------------------------------------------------------------
// 1. treasurerUploadSignableDoc — coach_validated → awaiting_parent_signature
// -----------------------------------------------------------------------------
export async function treasurerUploadSignableDoc(
  input: TreasurerUploadSignableDocInput,
): Promise<TreasurerUploadSignableDocResult> {
  const callable = httpsCallable<
    TreasurerUploadSignableDocInput,
    TreasurerUploadSignableDocResult
  >(functions, 'treasurerUploadSignableDoc')
  const result: HttpsCallableResult<TreasurerUploadSignableDocResult> =
    await callable(input)
  return result.data
}

// -----------------------------------------------------------------------------
// 2. treasurerConfirmSignedDoc — parent_signed → form_confirmed
// -----------------------------------------------------------------------------
export async function treasurerConfirmSignedDoc(
  input: TreasurerConfirmSignedDocInput,
): Promise<TreasurerConfirmSignedDocResult> {
  const callable = httpsCallable<
    TreasurerConfirmSignedDocInput,
    TreasurerConfirmSignedDocResult
  >(functions, 'treasurerConfirmSignedDoc')
  const result: HttpsCallableResult<TreasurerConfirmSignedDocResult> =
    await callable(input)
  return result.data
}

// -----------------------------------------------------------------------------
// 3. treasurerMarkSentAndPaid — form_confirmed → sent_paid
//    + crée /licenses/{id} en status='pending' (utilisable par le coach).
// -----------------------------------------------------------------------------
export async function treasurerMarkSentAndPaid(
  input: TreasurerMarkSentAndPaidInput,
): Promise<TreasurerMarkSentAndPaidResult> {
  const callable = httpsCallable<
    TreasurerMarkSentAndPaidInput,
    TreasurerMarkSentAndPaidResult
  >(functions, 'treasurerMarkSentAndPaid')
  const result: HttpsCallableResult<TreasurerMarkSentAndPaidResult> =
    await callable(input)
  return result.data
}

// -----------------------------------------------------------------------------
// 4. treasurerFinalizeLicense — sent_paid → approved
//    + confirme /licenses/{id} (pending → active) via confirmLicense interne.
// -----------------------------------------------------------------------------
export async function treasurerFinalizeLicense(
  input: TreasurerFinalizeLicenseInput,
): Promise<TreasurerFinalizeLicenseResult> {
  const callable = httpsCallable<
    TreasurerFinalizeLicenseInput,
    TreasurerFinalizeLicenseResult
  >(functions, 'treasurerFinalizeLicense')
  const result: HttpsCallableResult<TreasurerFinalizeLicenseResult> =
    await callable(input)
  return result.data
}
