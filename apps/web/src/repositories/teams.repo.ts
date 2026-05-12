import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type DocumentData,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
  type UpdateData,
} from 'firebase/firestore'
import { db } from '@/services/firebase'
import type { Team, TeamData, TeamGender } from '@club-app/shared-types'

/**
 * Repository Teams — Firestore-backed.
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase
 * (cf. docs/frontend-desktop.md — architecture en couches). Les writes
 * passent par `/teams/{teamId}` (rules : isAdmin || isRootAdmin).
 *
 * Champs dérivés portés sur `TeamRow` mais qui ne vivent PAS dans le doc :
 *  - `coachLabels` / `coachAvatars` : join sur `/members/{coachId}`. Lookup
 *    batché par `listTeams` (1 read par membre unique, pas par team).
 *  - `playerCount` : `playerIds.length`.
 *  - `preferredSlotLabels` / `rosterPlayerNames` / `duesPaidToDate` /
 *    `upcomingMatchesCount` : valeurs neutres pour l'instant — sortiront
 *    de `/venues/.../timeSlots`, `/dues`, `/bookings` au fil du dev.
 *  - `ageRange` : dérivé de `category` via une table heuristique locale.
 *    Sera remplacé par un référentiel `/categories` éditable côté admin.
 */

const TEAMS = 'teams'
const MEMBERS = 'members'

// ---------------------------------------------------------------------------
// Types exposés pour la vue Teams
// ---------------------------------------------------------------------------

/** Coach résolu pour affichage Avatar (libellé + niveau optionnel). */
export interface TeamCoachAvatar {
  id: string
  name: string
  /** `officialLevel` si le coach est aussi officiel ; sinon null. */
  level: number | null
  /** Email — non joinable côté client tant que `/members/{id}/private/contact` n'est pas exposé. */
  email: string | null
}

/**
 * Tranche d'âge associée à une catégorie. `null` quand la catégorie est
 * ouverte (Seniors / Loisirs / Veterans).
 *
 * TODO(firestore): remplacer par lookup `/categories` une fois le référentiel
 *   admin-éditable provisionné.
 */
export interface TeamAgeRange {
  min: number
  max: number | null
}

/**
 * Ligne enrichie pour la liste Teams. Étend `Team` (schéma `/teams/{teamId}`)
 * avec les champs dérivés listés en tête de fichier.
 */
export interface TeamRow extends Team {
  coachLabels: string[]
  coachAvatars: TeamCoachAvatar[]
  playerCount: number
  preferredSlotLabels: string[]
  ageRange: TeamAgeRange | null
  rosterPlayerNames: string[]
  duesPaidToDate: number
  upcomingMatchesCount: number
}

// ---------------------------------------------------------------------------
// Helpers locaux (UI-only)
// ---------------------------------------------------------------------------

/**
 * Heuristique UI catégorie → âge (transition seulement).
 *
 * TODO(categories): remplacer par lookup sur `/categories/{id}` (référentiel
 *   admin-éditable). Schéma + lifecycle documentés dans `docs/firebase.md`
 *   (section `/categories/{categoryId}`) et `docs/main.md` (section
 *   "Catégories d'équipes"). Une fois le référentiel branché : retirer cette
 *   table + `ageRangeFor` + le champ dérivé `TeamRow.ageRange`, et résoudre
 *   directement depuis le doc `/categories/{team.categoryId}`.
 */
const CATEGORY_AGE_RANGES: Record<string, TeamAgeRange | null> = {
  U11: { min: 9, max: 10 },
  U13: { min: 11, max: 12 },
  U14: { min: 12, max: 13 },
  U16: { min: 14, max: 15 },
  U17: { min: 16, max: 16 },
  U18: { min: 16, max: 17 },
  U20: { min: 18, max: 19 },
  Seniors: null,
}

function ageRangeFor(category: string): TeamAgeRange | null {
  const key = category.trim()
  if (key in CATEGORY_AGE_RANGES) return CATEGORY_AGE_RANGES[key]
  return null
}

// ---------------------------------------------------------------------------
// Coach resolution — join `coachIds[]` → `/members/{id}`.
//
// Pour `listTeams`, on dédup les `coachIds` de toutes les équipes en un seul
// set puis on lit chaque doc /members une fois. Pour `getTeamById`, on lit
// les `coachIds` de l'équipe ciblée en parallèle.
//
// Si `/members/{id}` n'existe pas (membre supprimé ou pas encore créé), on
// fallback sur un placeholder portant l'id — le drawer reste cohérent.
// ---------------------------------------------------------------------------

async function readCoachAvatars(
  coachIds: readonly string[],
): Promise<Map<string, TeamCoachAvatar>> {
  if (coachIds.length === 0) return new Map()
  const unique = [...new Set(coachIds)]
  const snaps = await Promise.all(
    unique.map((id) => getDoc(doc(db, MEMBERS, id))),
  )
  const map = new Map<string, TeamCoachAvatar>()
  for (const snap of snaps) {
    if (!snap.exists()) {
      // Fallback : on connaît l'id mais pas le nom — affiche un placeholder.
      map.set(snap.id, {
        id: snap.id,
        name: `Membre ${snap.id.slice(0, 6)}`,
        level: null,
        email: null,
      })
      continue
    }
    const data = snap.data() as {
      firstName?: string
      lastName?: string
      officialLevel?: number | null
    }
    const name = [data.firstName, data.lastName]
      .filter((v): v is string => !!v && v.length > 0)
      .join(' ')
    map.set(snap.id, {
      id: snap.id,
      name: name || snap.id,
      level: data.officialLevel ?? null,
      // TODO(firestore): lire depuis /members/{id}/private/contact.email
      //   (admin/coach/self only — rules à respecter).
      email: null,
    })
  }
  return map
}

function snapToRow(
  snap: QueryDocumentSnapshot | DocumentSnapshot,
  avatarMap: Map<string, TeamCoachAvatar>,
): TeamRow {
  const data = snap.data() as TeamData
  const coachIds = data.coachIds ?? []
  const coachAvatars = coachIds
    .map((id) => avatarMap.get(id))
    .filter((c): c is TeamCoachAvatar => c !== undefined)
  return {
    id: snap.id,
    ...data,
    coachLabels: coachAvatars.map((c) => c.name),
    coachAvatars,
    playerCount: data.playerIds?.length ?? 0,
    // TODO(firestore): dériver des `timeSlots` rattachés. Vide tant que /venues n'est pas branché.
    preferredSlotLabels: [],
    ageRange: ageRangeFor(data.category),
    // TODO(firestore): join `playerIds[]` → /members.firstName/lastName.
    rosterPlayerNames: [],
    // TODO(firestore): agréger /dues (status=paid) pour la saison active.
    duesPaidToDate: 0,
    // TODO(firestore): count /bookings (status=scheduled) pour la team.
    upcomingMatchesCount: 0,
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Liste toutes les équipes du club triées par nom. */
export async function listTeams(): Promise<TeamRow[]> {
  const snap = await getDocs(query(collection(db, TEAMS), orderBy('name')))
  if (snap.empty) return []
  const allCoachIds: string[] = []
  for (const d of snap.docs) {
    const data = d.data() as TeamData
    if (data.coachIds) allCoachIds.push(...data.coachIds)
  }
  const avatarMap = await readCoachAvatars(allCoachIds)
  return snap.docs.map((d) => snapToRow(d, avatarMap))
}

/** Récupère une équipe par son id. */
export async function getTeamById(id: string): Promise<TeamRow | null> {
  const snap = await getDoc(doc(db, TEAMS, id))
  if (!snap.exists()) return null
  const data = snap.data() as TeamData
  const avatarMap = await readCoachAvatars(data.coachIds ?? [])
  return snapToRow(snap, avatarMap)
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CreateTeamInput {
  name: string
  category: string
  gender: TeamGender
  duesAmount: number
  trainingsPerWeek: number
  anticipatedMatches: number
}

/**
 * Crée une nouvelle équipe active (sans coach, sans joueur). Le doc Firestore
 * porte `createdAt: serverTimestamp()`.
 */
export async function createTeam(input: CreateTeamInput): Promise<TeamRow> {
  const ref = await addDoc(collection(db, TEAMS), {
    name: input.name,
    category: input.category,
    gender: input.gender,
    coachIds: [],
    playerIds: [],
    activeSeasonIds: [],
    duesAmount: input.duesAmount,
    schedulingConstraints: {
      preferredDays: [],
      maxStartTime: '20:00',
      minHoursBetweenSlots: 24,
      trainingsPerWeek: input.trainingsPerWeek,
      anticipatedMatches: input.anticipatedMatches,
      coachAvailability: [],
    },
    active: true,
    createdAt: serverTimestamp(),
  })
  const created = await getTeamById(ref.id)
  if (!created) {
    throw new Error(`Failed to read team ${ref.id} just after creation`)
  }
  return created
}

export interface UpdateTeamInput {
  name?: string
  category?: string
  gender?: TeamGender
  duesAmount?: number
  trainingsPerWeek?: number
  anticipatedMatches?: number
}

/**
 * Met à jour une équipe avec un patch partiel. Les champs scheduling sont
 * écrits sous `schedulingConstraints.*` via dotted paths Firestore.
 */
export async function updateTeam(
  id: string,
  patch: UpdateTeamInput,
): Promise<TeamRow | null> {
  const update: UpdateData<DocumentData> = {}
  if (patch.name !== undefined) update.name = patch.name
  if (patch.category !== undefined) update.category = patch.category
  if (patch.gender !== undefined) update.gender = patch.gender
  if (patch.duesAmount !== undefined) update.duesAmount = patch.duesAmount
  if (patch.trainingsPerWeek !== undefined) {
    update['schedulingConstraints.trainingsPerWeek'] = patch.trainingsPerWeek
  }
  if (patch.anticipatedMatches !== undefined) {
    update['schedulingConstraints.anticipatedMatches'] = patch.anticipatedMatches
  }
  if (Object.keys(update).length === 0) return getTeamById(id)
  await updateDoc(doc(db, TEAMS, id), update)
  return getTeamById(id)
}

/** Ajoute un membre comme coach (idempotent via `arrayUnion`). */
export async function assignCoach(
  teamId: string,
  memberId: string,
): Promise<TeamRow | null> {
  await updateDoc(doc(db, TEAMS, teamId), {
    coachIds: arrayUnion(memberId),
  })
  return getTeamById(teamId)
}

/** Retire un membre du staff coach (idempotent via `arrayRemove`). */
export async function removeCoach(
  teamId: string,
  memberId: string,
): Promise<TeamRow | null> {
  await updateDoc(doc(db, TEAMS, teamId), {
    coachIds: arrayRemove(memberId),
  })
  return getTeamById(teamId)
}

/** Bascule le flag `active` (archive / désarchive). */
export async function setTeamActive(
  teamId: string,
  active: boolean,
): Promise<TeamRow | null> {
  await updateDoc(doc(db, TEAMS, teamId), { active })
  return getTeamById(teamId)
}

/**
 * Duplique une équipe. Clone l'identité et les paramètres scheduling, reset
 * tout ce qui est dynamique : coachs vides, joueurs vides, draft (active=false),
 * aucune saison active. Le nom est suffixé " (copie)".
 */
export async function duplicateTeam(id: string): Promise<TeamRow | null> {
  const source = await getDoc(doc(db, TEAMS, id))
  if (!source.exists()) return null
  const data = source.data() as TeamData
  const ref = await addDoc(collection(db, TEAMS), {
    name: `${data.name} (copie)`,
    category: data.category,
    gender: data.gender,
    coachIds: [],
    playerIds: [],
    activeSeasonIds: [],
    duesAmount: data.duesAmount,
    schedulingConstraints: data.schedulingConstraints,
    active: false,
    createdAt: serverTimestamp(),
  })
  return getTeamById(ref.id)
}
