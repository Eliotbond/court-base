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
import type {
  Category,
  Tag,
  TagColor,
  Team,
  TeamData,
  TeamGender,
  TeamTagRef,
} from '@club-app/shared-types'
import { snapToCategory } from './categories.repo'
import { snapToTag } from './tags.repo'

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
 *  - `category` / `ageRange` : résolus via lookup batché sur `/categories`
 *    (cf. categories.repo). Si `team.categoryId` ne référence aucun doc
 *    existant → `category: null` et `ageRange: null` (cas pathologique
 *    documenté dans docs/main.md).
 */

const TEAMS = 'teams'
const MEMBERS = 'members'
const CATEGORIES = 'categories'
const TAGS = 'tags'

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
 */
export interface TeamAgeRange {
  min: number
  max: number | null
}

/**
 * Catégorie résolue pour affichage. Snapshot léger (id + champs UI) :
 * la source de vérité reste `/categories/{id}`. `null` quand
 * `team.categoryId` ne pointe vers aucun doc existant.
 */
export interface TeamCategoryRef {
  id: string
  name: string
  minAge: number | null
  maxAge: number | null
}

/**
 * Tag résolu pour affichage. Snapshot léger : la source de vérité reste
 * `/tags/{id}`. `display` provient du flag par-équipe stocké inline dans
 * `/teams.tags`. Les références orphelines (tag supprimé) sont silencieusement
 * filtrées à la résolution.
 */
export interface TeamTagResolved {
  id: string
  name: string
  color: TagColor
  display: boolean
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
  category: TeamCategoryRef | null
  ageRange: TeamAgeRange | null
  /**
   * Tags résolus (nom + couleur + display). Ordre préservé depuis
   * `data.tags`. Les tags dont l'id ne pointe vers aucun doc `/tags/{id}`
   * sont filtrés silencieusement.
   */
  tagRefs: TeamTagResolved[]
  rosterPlayerNames: string[]
  duesPaidToDate: number
  upcomingMatchesCount: number
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

// ---------------------------------------------------------------------------
// Category resolution — join `team.categoryId` → `/categories/{id}`.
//
// Référentiel petit (~dizaines d'entrées max), donc on lit la collection
// entière en un seul `getDocs` puis on map en mémoire. Pas de N+1.
// ---------------------------------------------------------------------------

async function readCategoryMap(): Promise<Map<string, Category>> {
  const snap = await getDocs(
    query(collection(db, CATEGORIES), orderBy('displayOrder')),
  )
  const map = new Map<string, Category>()
  for (const d of snap.docs) map.set(d.id, snapToCategory(d))
  return map
}

// ---------------------------------------------------------------------------
// Tag resolution — join `team.tags[].tagId` → `/tags/{id}`.
//
// Référentiel petit (~dizaines d'entrées max), donc on lit la collection
// entière en un seul `getDocs` puis on map en mémoire. Pas de N+1.
// ---------------------------------------------------------------------------

async function readTagMap(): Promise<Map<string, Tag>> {
  const snap = await getDocs(
    query(collection(db, TAGS), orderBy('displayOrder')),
  )
  const map = new Map<string, Tag>()
  for (const d of snap.docs) map.set(d.id, snapToTag(d))
  return map
}

function snapToRow(
  snap: QueryDocumentSnapshot | DocumentSnapshot,
  avatarMap: Map<string, TeamCoachAvatar>,
  categoryMap: Map<string, Category>,
  tagMap: Map<string, Tag>,
): TeamRow {
  const data = snap.data() as TeamData
  const coachIds = data.coachIds ?? []
  const coachAvatars = coachIds
    .map((id) => avatarMap.get(id))
    .filter((c): c is TeamCoachAvatar => c !== undefined)
  const cat = data.categoryId ? categoryMap.get(data.categoryId) ?? null : null
  const category: TeamCategoryRef | null = cat
    ? { id: cat.id, name: cat.name, minAge: cat.minAge, maxAge: cat.maxAge }
    : null
  const ageRange: TeamAgeRange | null = cat && cat.minAge !== null
    ? { min: cat.minAge, max: cat.maxAge }
    : null
  // Migration tolerante : les docs antérieurs au champ `tags` ne le portent
  // pas — on traite `undefined` comme tableau vide.
  const rawTags: TeamTagRef[] = data.tags ?? []
  const tagRefs: TeamTagResolved[] = rawTags
    .map((ref) => {
      const t = tagMap.get(ref.tagId)
      if (!t) return null
      return {
        id: t.id,
        name: t.name,
        color: t.color,
        display: ref.display,
      } satisfies TeamTagResolved
    })
    .filter((t): t is TeamTagResolved => t !== null)
  return {
    id: snap.id,
    ...data,
    // Normalise `tags` côté lecture pour que les consumers ne voient jamais
    // `undefined` même sur les anciens docs.
    tags: rawTags,
    coachLabels: coachAvatars.map((c) => c.name),
    coachAvatars,
    playerCount: data.playerIds?.length ?? 0,
    // TODO(firestore): dériver des `timeSlots` rattachés. Vide tant que /venues n'est pas branché.
    preferredSlotLabels: [],
    category,
    ageRange,
    tagRefs,
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
  const [avatarMap, categoryMap, tagMap] = await Promise.all([
    readCoachAvatars(allCoachIds),
    readCategoryMap(),
    readTagMap(),
  ])
  return snap.docs.map((d) => snapToRow(d, avatarMap, categoryMap, tagMap))
}

/** Récupère une équipe par son id. */
export async function getTeamById(id: string): Promise<TeamRow | null> {
  const snap = await getDoc(doc(db, TEAMS, id))
  if (!snap.exists()) return null
  const data = snap.data() as TeamData
  const [avatarMap, categoryMap, tagMap] = await Promise.all([
    readCoachAvatars(data.coachIds ?? []),
    readCategoryMap(),
    readTagMap(),
  ])
  return snapToRow(snap, avatarMap, categoryMap, tagMap)
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CreateTeamInput {
  name: string
  categoryId: string
  gender: TeamGender
  duesAmount: number
  trainingsPerWeek: number
  anticipatedMatches: number
  /** Tags initiaux. Vide par défaut côté caller. */
  tags?: TeamTagRef[]
}

/**
 * Crée une nouvelle équipe active (sans coach, sans joueur). Le doc Firestore
 * porte `createdAt: serverTimestamp()`.
 */
export async function createTeam(input: CreateTeamInput): Promise<TeamRow> {
  const ref = await addDoc(collection(db, TEAMS), {
    name: input.name,
    categoryId: input.categoryId,
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
    tags: input.tags ?? [],
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
  categoryId?: string
  gender?: TeamGender
  duesAmount?: number
  trainingsPerWeek?: number
  anticipatedMatches?: number
  /** Remplace intégralement le tableau `tags` du doc. */
  tags?: TeamTagRef[]
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
  if (patch.categoryId !== undefined) update.categoryId = patch.categoryId
  if (patch.gender !== undefined) update.gender = patch.gender
  if (patch.duesAmount !== undefined) update.duesAmount = patch.duesAmount
  if (patch.trainingsPerWeek !== undefined) {
    update['schedulingConstraints.trainingsPerWeek'] = patch.trainingsPerWeek
  }
  if (patch.anticipatedMatches !== undefined) {
    update['schedulingConstraints.anticipatedMatches'] = patch.anticipatedMatches
  }
  if (patch.tags !== undefined) update.tags = patch.tags
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
    categoryId: data.categoryId,
    gender: data.gender,
    coachIds: [],
    playerIds: [],
    activeSeasonIds: [],
    duesAmount: data.duesAmount,
    schedulingConstraints: data.schedulingConstraints,
    // Les tags sont sémantiquement liés à l'équipe (groupe A vs B, Compet…) :
    // on les conserve sur la copie, l'admin peut les ajuster ensuite.
    tags: data.tags ?? [],
    active: false,
    createdAt: serverTimestamp(),
  })
  return getTeamById(ref.id)
}
