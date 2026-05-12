import { httpsCallable, type HttpsCallableResult } from 'firebase/functions'
import { functions } from './firebase'

// =============================================================================
// Wrappers typés des Cloud Functions callables.
// Les types Input/Output sont gardés en sync manuel avec functions/src/ — toute
// modification de contrat doit être propagée ici. À terme, déplacer dans
// packages/shared-types/src/callables.ts pour single source.
// =============================================================================

// -----------------------------------------------------------------------------
// previewSeasonBookings — dry-run de génération de bookings.
// Côté functions : functions/src/bookings/previewSeasonBookings.ts
// Auth : admin OU rootAdmin claim. UI : écran /seasons/:id/activate.
// -----------------------------------------------------------------------------
export interface PreviewSeasonBookingsInput {
  seasonId: string
}

export interface PreviewSeasonBookingsOutput {
  count: number
  byCourt: Record<string, number>
  /** Index 0 = Sunday, ..., 6 = Saturday. */
  byDayOfWeek: number[]
}

export async function previewSeasonBookings(
  input: PreviewSeasonBookingsInput,
): Promise<PreviewSeasonBookingsOutput> {
  const callable = httpsCallable<PreviewSeasonBookingsInput, PreviewSeasonBookingsOutput>(
    functions,
    'previewSeasonBookings',
  )
  const result: HttpsCallableResult<PreviewSeasonBookingsOutput> = await callable(input)
  return result.data
}

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
