import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '@/services/firebase'
import type {
  Registration,
  RegistrationData,
  RegistrationStatus,
} from '@club-app/shared-types'

/**
 * Repository Registrations — Firestore-backed (côté `apps/web`).
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase
 * (cf. `apps/web/CLAUDE.md` — architecture en couches).
 *
 * Permissions (cf. `firestore.rules` §registrations) :
 *  - **read** : auteur, tuteur d'un matched member, coach de la team, admin.
 *  - **write** : pas de write client — toutes les transitions passent par
 *    callables Admin SDK (`refuseRegistration`, `cancelRegistration`, …).
 *
 * Cette app n'expose donc que des reads + résolutions d'affichage (équipe +
 * member matché). Les actions (refuser, marquer essai, …) passent par
 * `services/cloudFunctions.ts`.
 */

const REGISTRATIONS = 'registrations'
const TEAMS = 'teams'
const MEMBERS = 'members'

// ---------------------------------------------------------------------------
// Statuts non-draft — affichés dans la vue admin/coach. On exclut `draft`
// (brouillons en cours côté app register, non-soumis).
// ---------------------------------------------------------------------------

/**
 * Statuts affichables côté admin/coach (tout sauf `draft`).
 * Firestore `where('status', 'in', [...])` accepte jusqu'à 30 valeurs ; on en
 * a 9 ici.
 */
export const NON_DRAFT_STATUSES: readonly RegistrationStatus[] = [
  'submitted',
  'open_pending_trial',
  'conditional_pending_review',
  'conditional_pending_trial',
  'trial_in_progress',
  'confirmed_pending_dues',
  'active',
  'refused',
  'cancelled',
] as const

/**
 * Statuts considérés "en cours" — utilisés pour les counts et le filtre par
 * défaut. Exclut les statuts terminaux (`active`, `refused`, `cancelled`).
 */
export const ACTIVE_STATUSES: readonly RegistrationStatus[] = [
  'submitted',
  'open_pending_trial',
  'conditional_pending_review',
  'conditional_pending_trial',
  'trial_in_progress',
  'confirmed_pending_dues',
] as const

// ---------------------------------------------------------------------------
// Types exposés pour la vue
// ---------------------------------------------------------------------------

/** Équipe résolue pour affichage : nom + catégorie pour éviter de re-fetcher. */
export interface RegistrationTeamRef {
  id: string
  name: string
  categoryId: string
}

/**
 * Ligne enrichie pour la liste Inscriptions. Étend le doc Firestore
 * (`Registration`) avec quelques résolutions d'affichage :
 *  - `team` : nom de l'équipe (lookup batché par la fonction de liste).
 *  - `playerFullName` : `firstName + lastName` pré-formaté.
 *  - `playerAge` : âge en années entières au moment du load (jugement
 *    d'éligibilité côté UI, pas stocké).
 */
export interface RegistrationRow extends Registration {
  team: RegistrationTeamRef | null
  playerFullName: string
  playerAge: number | null
}

// ---------------------------------------------------------------------------
// Snap → Registration
// ---------------------------------------------------------------------------

function snapToRegistration(
  snap: QueryDocumentSnapshot | DocumentSnapshot,
): Registration {
  const data = snap.data() as RegistrationData
  return { id: snap.id, ...data }
}

// ---------------------------------------------------------------------------
// Team resolution — batch lookup `teamId → name`.
//
// Référentiel petit (< 100 teams), donc on lit `/teams` entièrement en un
// seul `getDocs` plutôt que des reads individuels. Pas de N+1.
// ---------------------------------------------------------------------------

async function readTeamMap(): Promise<Map<string, RegistrationTeamRef>> {
  const snap = await getDocs(collection(db, TEAMS))
  const map = new Map<string, RegistrationTeamRef>()
  for (const d of snap.docs) {
    const t = d.data() as { name?: string; categoryId?: string }
    map.set(d.id, {
      id: d.id,
      name: t.name ?? d.id,
      categoryId: t.categoryId ?? '',
    })
  }
  return map
}

// ---------------------------------------------------------------------------
// Age helper — années entières au moment du load. `null` si pas de birthDate
// renseignée (placeholder epoch 1970 → traité comme inconnu).
// ---------------------------------------------------------------------------

function computeAge(birthSeconds: number | null | undefined): number | null {
  if (!birthSeconds || birthSeconds < 1000) return null
  const birthMs = birthSeconds * 1000
  const now = Date.now()
  const ageMs = now - birthMs
  const ageYears = ageMs / (365.2425 * 24 * 3600 * 1000)
  if (ageYears < 0 || ageYears > 120) return null
  return Math.floor(ageYears)
}

function enrichRow(
  reg: Registration,
  teamMap: Map<string, RegistrationTeamRef>,
): RegistrationRow {
  return {
    ...reg,
    team: teamMap.get(reg.teamId) ?? null,
    playerFullName: `${reg.player.firstName} ${reg.player.lastName}`.trim(),
    playerAge: computeAge(reg.player.birthDate?.seconds ?? null),
  }
}

// ---------------------------------------------------------------------------
// Reads — admin scope
// ---------------------------------------------------------------------------

/**
 * Liste toutes les registrations non-draft (admin scope). Triées par
 * `createdAt desc`. Cap silencieux à 200 (au-delà on paginera).
 *
 * Utilise l'index composite `(status, createdAt desc)` déclaré dans
 * `firestore.indexes.json`.
 */
export async function listAllNonDraftRegistrations(): Promise<RegistrationRow[]> {
  const [regSnap, teamMap] = await Promise.all([
    getDocs(
      query(
        collection(db, REGISTRATIONS),
        where('status', 'in', [...NON_DRAFT_STATUSES]),
        orderBy('createdAt', 'desc'),
        limit(200),
      ),
    ),
    readTeamMap(),
  ])
  return regSnap.docs.map((d) => enrichRow(snapToRegistration(d), teamMap))
}

// ---------------------------------------------------------------------------
// Reads — coach scope
// ---------------------------------------------------------------------------

/**
 * Liste les registrations non-draft pour les équipes du coach courant.
 *
 * Stratégie : une query par teamId, mergées + dédoublonnées + triées en JS.
 * Tolérant à N teams (pas de limite `in` à 10), évite des index composites
 * supplémentaires (l'index `(teamId, status, createdAt desc)` existant suffit).
 *
 * Si `teamIds` est vide → retourne `[]` sans frapper Firestore (un coach sans
 * équipe ne devrait pas être ici, mais on défend la query inutile).
 */
export async function listRegistrationsForTeams(
  teamIds: readonly string[],
): Promise<RegistrationRow[]> {
  if (teamIds.length === 0) return []
  const unique = [...new Set(teamIds)]
  const [perTeamSnaps, teamMap] = await Promise.all([
    Promise.all(
      unique.map((teamId) =>
        getDocs(
          query(
            collection(db, REGISTRATIONS),
            where('teamId', '==', teamId),
            where('status', 'in', [...NON_DRAFT_STATUSES]),
            orderBy('createdAt', 'desc'),
            limit(200),
          ),
        ),
      ),
    ),
    readTeamMap(),
  ])
  const rows: RegistrationRow[] = []
  for (const snap of perTeamSnaps) {
    for (const d of snap.docs) {
      rows.push(enrichRow(snapToRegistration(d), teamMap))
    }
  }
  // Tri global `createdAt desc` après merge multi-team.
  rows.sort((a, b) => {
    const sa = a.createdAt?.seconds ?? 0
    const sb = b.createdAt?.seconds ?? 0
    return sb - sa
  })
  return rows
}

// ---------------------------------------------------------------------------
// Display helpers — labels FR pour status / relationship.
// ---------------------------------------------------------------------------

/**
 * Libellé FR du statut. Aligné sur les copies de
 * `docs/registrations/lifecycle.md`.
 */
export function registrationStatusLabel(status: RegistrationStatus): string {
  switch (status) {
    case 'draft':
      return 'Brouillon'
    case 'submitted':
      return 'Soumise'
    case 'open_pending_trial':
      return 'En attente d’essai'
    case 'conditional_pending_review':
      return 'À examiner'
    case 'conditional_pending_trial':
      return 'Acceptée — essai à venir'
    case 'trial_in_progress':
      return 'Essai en cours'
    case 'confirmed_pending_dues':
      return 'Validée — cotisation en attente'
    case 'active':
      return 'Active'
    case 'refused':
      return 'Refusée'
    case 'cancelled':
      return 'Annulée'
  }
}

/**
 * Variant `<Pill>` pour un statut donné. Aligné sur la grammaire visuelle
 * Mockups (emerald = ok, amber = warning, slate = neutre, rose = erreur).
 */
export function registrationStatusVariant(
  status: RegistrationStatus,
): 'emerald' | 'amber' | 'slate' | 'rose' {
  switch (status) {
    case 'active':
      return 'emerald'
    case 'trial_in_progress':
    case 'conditional_pending_trial':
    case 'open_pending_trial':
      return 'emerald'
    case 'submitted':
    case 'conditional_pending_review':
    case 'confirmed_pending_dues':
      return 'amber'
    case 'refused':
      return 'rose'
    case 'cancelled':
    case 'draft':
      return 'slate'
  }
}

/**
 * True si la registration est dans un état où un coach/admin peut encore la
 * refuser. Source de vérité : `REFUSABLE_STATUSES` côté
 * `functions/src/registrations/refuseRegistration.ts`.
 */
export function isRefusable(status: RegistrationStatus): boolean {
  return (
    status === 'submitted' ||
    status === 'open_pending_trial' ||
    status === 'conditional_pending_review' ||
    status === 'conditional_pending_trial' ||
    status === 'trial_in_progress'
  )
}

/**
 * True si la registration peut passer en `trial_in_progress` (entraînement
 * planifié). Source de vérité : `TRIAL_STARTABLE_STATUSES` côté
 * `functions/src/registrations/markTrialInProgress.ts`.
 */
export function isMarkTrialPossible(status: RegistrationStatus): boolean {
  return (
    status === 'open_pending_trial' ||
    status === 'conditional_pending_review' ||
    status === 'conditional_pending_trial'
  )
}

/**
 * True si la registration peut être confirmée (essai → cotisation émise).
 * Côté server : seul `trial_in_progress` est accepté.
 */
export function isConfirmable(status: RegistrationStatus): boolean {
  return status === 'trial_in_progress'
}

void MEMBERS
