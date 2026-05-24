/**
 * Repository Registrations — Firestore-backed (courtbase-app, coach mobile).
 *
 * Lecture uniquement : toutes les transitions de status passent par les
 * callables (`markTrialInProgress`, `confirmRegistration`, `refuseRegistration`)
 * — pas de write direct côté client (cf. `firestore.rules` § `/registrations`).
 *
 * Stratégie de scope coach : `/registrations where teamId == X` exécuté **une
 * fois par team** (Firestore ne supporte pas `array-contains` sur `teamId`
 * scalar + filter sur les teams du coach en une seule query). Volume attendu
 * petit (10s de registrations actives par team), donc négligeable.
 *
 * Output shape : `MockRegistration` (cf. `@/types/mock`) pour que les vues
 * mock existantes consomment la même donnée sans adaptation. Champs sans
 * équivalent direct côté Firestore (`submitterName`) sont dérivés best-effort
 * (label de relation) — quand on aura un store /users on enrichira.
 */

import {
  collection,
  getDocs,
  query,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { FirebaseError } from 'firebase/app'

import { db } from '@/services/firebase'
import type { MemberGender, MockRegistration, RegistrationStatus } from '@/types/mock'

const REGISTRATIONS = 'registrations'

/** Statuts visibles dans l'app coach — exclut `draft` (jamais sorti du wizard register). */
export const COACH_VISIBLE_STATUSES: readonly RegistrationStatus[] = [
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

interface FirestoreTimestamp {
  seconds: number
  nanoseconds: number
  toDate?: () => Date
}

function timestampToMs(ts: unknown): number | null {
  if (!ts) return null
  const t = ts as FirestoreTimestamp
  if (typeof t.seconds === 'number') return t.seconds * 1000
  return null
}

/** ISO yyyy-mm-dd depuis un Timestamp Firestore. */
function timestampToIsoDate(ts: unknown): string {
  const ms = timestampToMs(ts)
  if (ms == null) return '2000-01-01'
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Format FR "il y a N jours" / "aujourd'hui" / "hier". */
function relativeFr(ts: unknown): string {
  const ms = timestampToMs(ts)
  if (ms == null) return ''
  const now = Date.now()
  const days = Math.floor((now - ms) / 86_400_000)
  if (days <= 0) return "aujourd'hui"
  if (days === 1) return 'hier'
  if (days < 7) return `il y a ${days} jours`
  if (days < 30) return `il y a ${Math.floor(days / 7)} semaine${days >= 14 ? 's' : ''}`
  return `il y a ${Math.floor(days / 30)} mois`
}

/** Label FR depuis le code `relationship`. */
function relationshipLabel(rel: unknown): string {
  switch (rel) {
    case 'parent':
      return 'le parent'
    case 'legal_guardian':
      return 'le tuteur légal'
    case 'sibling':
      return 'un frère / une sœur'
    case 'caritas':
      return 'Caritas'
    case 'other':
      return 'un proche'
    default:
      return 'le candidat'
  }
}

function mapGender(g: unknown): MemberGender {
  if (g === 'M' || g === 'F' || g === 'other') return g
  return 'na'
}

/** Coerce le status Firestore vers le sous-type connu côté UI. */
function mapStatus(s: unknown): RegistrationStatus {
  if (typeof s === 'string' && (COACH_VISIBLE_STATUSES as readonly string[]).includes(s)) {
    return s as RegistrationStatus
  }
  // `draft` ou inconnu → masque comme `submitted` (cas pathologique).
  return 'submitted'
}

interface RegistrationDoc {
  player?: {
    firstName?: string
    lastName?: string
    birthDate?: unknown
    gender?: string | null
    phone?: string | null
  }
  teamId?: string
  status?: string
  relationship?: string | null
  previouslyLicensed?: boolean
  previousClubName?: string | null
  previousClubAbroad?: boolean
  transferLetterStoragePath?: string | null
  refusalReason?: string | null
  createdAt?: unknown
}

function snapToMockRegistration(snap: QueryDocumentSnapshot<DocumentData>): MockRegistration {
  const data = snap.data() as RegistrationDoc
  const player = data.player ?? {}
  return {
    id: snap.id,
    playerFirstName: player.firstName ?? '',
    playerLastName: player.lastName ?? '',
    playerBirthDate: timestampToIsoDate(player.birthDate),
    playerGender: mapGender(player.gender),
    submitterName: relationshipLabel(data.relationship),
    submitterRelationship: mapRelationshipToMock(data.relationship),
    teamId: data.teamId ?? '',
    status: mapStatus(data.status),
    submittedAt: relativeFr(data.createdAt),
    previouslyLicensed: Boolean(data.previouslyLicensed),
    previousClubName: data.previousClubName ?? undefined,
    previousClubAbroad: Boolean(data.previousClubAbroad),
    hasTransferLetter: typeof data.transferLetterStoragePath === 'string',
    refusalReason: data.refusalReason ?? undefined,
  }
}

function mapRelationshipToMock(
  rel: unknown,
): MockRegistration['submitterRelationship'] {
  switch (rel) {
    case 'parent':
      return 'parent'
    case 'legal_guardian':
      return 'tutor'
    case 'sibling':
      return 'sibling'
    case 'caritas':
      return 'caritas'
    case 'other':
      return 'other'
    default:
      return 'self'
  }
}

/**
 * Liste les registrations pour un set de teams (scope coach).
 *
 * Pattern : une query Firestore par team (Firestore impose `==` sur scalar,
 * pas de `in` portable sur les teamIds + status `in` en même temps). Le tri
 * + la dédup sont JS. Volume attendu : O(10) registrations actives par team.
 *
 * Retourne `[]` en cas d'erreur (logguée) — la vue affiche un empty state
 * plutôt qu'une exception non gérée.
 */
export async function listRegistrationsForTeams(
  teamIds: readonly string[],
): Promise<MockRegistration[]> {
  if (teamIds.length === 0) return []
  try {
    const snaps = await Promise.all(
      teamIds.map((teamId) =>
        getDocs(
          query(
            collection(db, REGISTRATIONS),
            where('teamId', '==', teamId),
            where('status', 'in', COACH_VISIBLE_STATUSES as unknown as string[]),
          ),
        ),
      ),
    )
    const seen = new Set<string>()
    const out: MockRegistration[] = []
    for (const snap of snaps) {
      for (const d of snap.docs) {
        if (seen.has(d.id)) continue
        seen.add(d.id)
        out.push(snapToMockRegistration(d))
      }
    }
    // Tri par submittedAt desc — approximé via le label relatif (les plus
    // récents en premier). Pour un vrai tri exact il faudra carry `createdAt`.
    return out.sort((a, b) => {
      const order: Record<string, number> = {
        "aujourd'hui": 0,
        hier: 1,
      }
      const oa = order[a.submittedAt] ?? 99
      const ob = order[b.submittedAt] ?? 99
      return oa - ob
    })
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[registrations.repo] listRegistrationsForTeams failed [${code}]`, err)
    return []
  }
}

/** Récupère une seule registration par id (pour la vue détail). */
export async function getRegistrationById(id: string): Promise<MockRegistration | null> {
  try {
    const { doc, getDoc } = await import('firebase/firestore')
    const snap = await getDoc(doc(db, REGISTRATIONS, id))
    if (!snap.exists()) return null
    return snapToMockRegistration(snap as QueryDocumentSnapshot<DocumentData>)
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[registrations.repo] getRegistrationById failed [${code}]`, err)
    return null
  }
}
