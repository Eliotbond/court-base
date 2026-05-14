import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore'
import type {
  Category,
  CategoryData,
  Member,
  MemberData,
  Team,
  TeamData,
  TeamRegistrationStatus,
} from '@club-app/shared-types'
import { db } from '@/services/firebase'

/**
 * Repository Teams — Firestore-backed (côté app courtbase-register).
 *
 * Lecture only — les écritures sur `/teams` restent réservées à `apps/web`
 * (admin / coach via callable). Ici on expose ce dont le wizard d'inscription
 * a besoin : la liste publique des équipes éligibles à l'âge du joueur.
 *
 * Permissions (cf. `firestore.rules`) : `/teams` est `read: if isSignedIn()`,
 * `/categories` idem. Le user authentifié de l'app register passe.
 */

const TEAMS = 'teams'
const CATEGORIES = 'categories'
const MEMBERS = 'members'

// ---------------------------------------------------------------------------
// Types exposés
// ---------------------------------------------------------------------------

/** Snapshot léger d'un head coach pour affichage public (app register). */
export interface PublicCoach {
  memberId: string
  firstName: string
  lastName: string
  /** Niveau official si renseigné, sinon `null`. UI peut afficher un badge. */
  officialLevel: number | null
  /** Pas d'email/phone exposés : la rule `/members/{id}/private/contact` exclut le user public. */
}

/**
 * Vue publique d'une équipe pour le TeamPicker (§4.5). On expose
 * uniquement les champs nécessaires à la card publique. Pas de `coachIds`,
 * `playerIds`, `schedulingConstraints` détaillés, etc.
 */
export interface PublicTeam {
  id: string
  name: string
  gender: TeamData['gender']
  categoryId: string
  category: PublicCategory | null
  registrationStatus: TeamRegistrationStatus
  openHandbook: string
  conditionalDescription: string
  conditionalCriteria: string[]
  publicTagline: string | null
  headCoach: PublicCoach | null
  /** True si l'équipe accepte les nouvelles inscriptions (open ou conditional). */
  acceptingRegistrations: boolean
}

export interface PublicCategory {
  id: string
  name: string
  minAge: number | null
  maxAge: number | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ageAt(birthDate: Date, ref: Date = new Date()): number {
  let age = ref.getFullYear() - birthDate.getFullYear()
  const mDiff = ref.getMonth() - birthDate.getMonth()
  if (mDiff < 0 || (mDiff === 0 && ref.getDate() < birthDate.getDate())) {
    age -= 1
  }
  return age
}

function fitsCategory(age: number, cat: CategoryData): boolean {
  if (cat.minAge !== null && age < cat.minAge) return false
  if (cat.maxAge !== null && age > cat.maxAge) return false
  return true
}

function toPublicCategory(c: Category | null): PublicCategory | null {
  if (!c) return null
  return { id: c.id, name: c.name, minAge: c.minAge, maxAge: c.maxAge }
}

async function readCategoriesMap(): Promise<Map<string, Category>> {
  const snap = await getDocs(
    query(collection(db, CATEGORIES), where('active', '==', true)),
  )
  const map = new Map<string, Category>()
  for (const d of snap.docs) {
    const data = d.data() as CategoryData
    map.set(d.id, { id: d.id, ...data })
  }
  return map
}

async function readHeadCoach(team: TeamData & { publicHeadCoachMemberId?: string | null }): Promise<PublicCoach | null> {
  // Si `publicHeadCoachMemberId` défini, on le lit. Sinon fallback sur le
  // premier `coachIds`. Pas de cascade : si la lecture échoue (rules ou
  // member absent), on renvoie `null` — la card affiche juste l'équipe.
  const memberId = team.publicHeadCoachMemberId ?? team.coachIds?.[0] ?? null
  if (!memberId) return null
  try {
    const snap = await getDoc(doc(db, MEMBERS, memberId))
    if (!snap.exists()) return null
    const m = snap.data() as MemberData
    return {
      memberId,
      firstName: m.firstName,
      lastName: m.lastName,
      officialLevel: m.officialLevel ?? null,
    }
  } catch {
    return null
  }
}

function snapToPublicTeam(
  snap: { id: string; data: () => unknown },
  categoryMap: Map<string, Category>,
  headCoach: PublicCoach | null,
): PublicTeam {
  const data = snap.data() as TeamData
  const status = data.registrationStatus ?? 'closed'
  return {
    id: snap.id,
    name: data.name,
    gender: data.gender,
    categoryId: data.categoryId,
    category: toPublicCategory(categoryMap.get(data.categoryId) ?? null),
    registrationStatus: status,
    openHandbook: data.openHandbook ?? '',
    conditionalDescription: data.conditionalDescription ?? '',
    conditionalCriteria: data.conditionalCriteria ?? [],
    publicTagline: data.publicTagline ?? null,
    headCoach,
    acceptingRegistrations: status === 'open' || status === 'conditional',
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Liste publique des équipes éligibles à l'âge `birthDate`. Filtres :
 *  - `active != false` (tolérant : `active === true` ou champ absent → on inclut)
 *  - `category.minAge <= age <= category.maxAge` (ou catégorie ouverte
 *    par le bas/haut)
 *
 * Note : on récupère toutes les teams puis filtre en mémoire — Firestore
 * ne peut pas faire un join `team → category` côté query. Acceptable tant
 * que < ~100 équipes / club. Pas d'`orderBy` Firestore : le tri final est
 * recalculé en mémoire (status → name), ce qui évite un index composite
 * dédié `(active, name)`.
 *
 * Le tri d'affichage est : `open` d'abord, puis `conditional`, puis `closed`.
 * À l'intérieur de chaque groupe, tri alpha sur `name`.
 */
export async function listEligibleTeams(birthDate: Date): Promise<PublicTeam[]> {
  const age = ageAt(birthDate)
  const [teamsSnap, categoryMap] = await Promise.all([
    getDocs(collection(db, TEAMS)),
    readCategoriesMap(),
  ])

  const eligible: { snap: typeof teamsSnap.docs[number]; team: TeamData }[] = []
  for (const d of teamsSnap.docs) {
    const team = d.data() as TeamData
    // Tolérance : champ `active` peut être absent sur teams pré-existantes.
    // On exclut uniquement les `active === false` explicites.
    if ((team as { active?: boolean }).active === false) continue
    const cat = categoryMap.get(team.categoryId)
    if (!cat) continue  // catégorie inactive ou orpheline → équipe non éligible
    if (!fitsCategory(age, cat)) continue
    eligible.push({ snap: d, team })
  }

  // Lecture head-coach batch en parallèle.
  const headCoaches = await Promise.all(eligible.map(({ team }) => readHeadCoach(team)))

  const result = eligible.map(({ snap }, i) =>
    snapToPublicTeam(snap, categoryMap, headCoaches[i] ?? null),
  )

  // Tri secondaire par registrationStatus (`open` > `conditional` > `closed`).
  const order: Record<TeamRegistrationStatus, number> = {
    open: 0,
    conditional: 1,
    closed: 2,
  }
  result.sort((a, b) => {
    const oa = order[a.registrationStatus] ?? 3
    const ob = order[b.registrationStatus] ?? 3
    if (oa !== ob) return oa - ob
    return a.name.localeCompare(b.name)
  })
  return result
}

/**
 * Lecture publique d'une équipe pour les écrans "Manuel" / "Conditions"
 * (§4.6 / §4.7). Retourne `null` si la team n'existe pas ou n'est pas
 * publiquement lisible.
 */
export async function getPublicTeamById(teamId: string): Promise<PublicTeam | null> {
  const snap = await getDoc(doc(db, TEAMS, teamId))
  if (!snap.exists()) return null
  const team = snap.data() as TeamData
  const [categoryMap, headCoach] = await Promise.all([
    readCategoriesMap(),
    readHeadCoach(team),
  ])
  return snapToPublicTeam(snap, categoryMap, headCoach)
}

/**
 * Retourne le `Member` (linkable) pour un coach d'une équipe — utilisé pour
 * l'écran §4.6 si on veut afficher en option l'email (pas exposé par défaut).
 * Pas appelé en MVP — pour info, exporté pour les tests.
 */
export async function getCoachMember(memberId: string): Promise<Member | null> {
  try {
    const snap = await getDoc(doc(db, MEMBERS, memberId))
    if (!snap.exists()) return null
    return { id: snap.id, ...(snap.data() as MemberData) }
  } catch {
    return null
  }
}

// Re-export pour ergonomie store (évite un second import).
export type { Team }
