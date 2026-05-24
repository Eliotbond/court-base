/**
 * Repository Teams — Firestore-backed (courtbase-app, coach mobile).
 *
 * SEULE couche autorisée à importer le SDK Firebase pour les équipes (cf.
 * architecture en couches CLAUDE.md). Volontairement minimal vs
 * `apps/web/src/repositories/teams.repo.ts` : la coach app n'a pas besoin
 * de gérer les tags, les coachLabels, le rosterPlayerNames, etc. — juste
 * de lister les équipes coachées avec assez d'info pour les cards mobile.
 *
 * Output shape : `MockTeam` (cf. `@/types/mock`) — choix volontaire pour
 * que les vues / le store consomment le même type que la couche mock sans
 * adaptation. Les champs absents en prod (ex. `nextTraining` qui requerrait
 * un fetch /bookings) sont laissés `undefined`.
 *
 * Cf. `docs/firebase.md` § `/teams`.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  type DocumentData,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { FirebaseError } from 'firebase/app'

import { db } from '@/services/firebase'
import type { MockTeam } from '@/types/mock'

const TEAMS = 'teams'
const CATEGORIES = 'categories'
const COTISATIONS = 'cotisations'

interface CategoryDoc {
  name: string
  minAge: number | null
  maxAge: number | null
}

interface CotisationDoc {
  name: string
  price: number
}

interface TeamDoc {
  name: string
  categoryId: string
  gender: 'M' | 'F' | 'mixed'
  coachIds: string[]
  playerIds: string[]
  cotisationId: string
  active: boolean
  registrationStatus: 'open' | 'conditional' | 'closed'
  schedulingConstraints?: {
    trainingsPerWeek?: number
  }
  tags?: Array<{ id: string; displayOnTeam?: boolean }>
}

/**
 * Charge les catégories en un seul fetch (référentiel club, petite taille
 * — typiquement < 30 docs). Retourne une map `id → CategoryDoc` pour lookup
 * O(1) côté caller.
 */
async function loadCategoriesMap(): Promise<Map<string, CategoryDoc>> {
  try {
    const snap = await getDocs(collection(db, CATEGORIES))
    const map = new Map<string, CategoryDoc>()
    for (const d of snap.docs) {
      const data = d.data() as DocumentData
      map.set(d.id, {
        name: (data['name'] as string | undefined) ?? '',
        minAge: (data['minAge'] as number | null | undefined) ?? null,
        maxAge: (data['maxAge'] as number | null | undefined) ?? null,
      })
    }
    return map
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[teams.repo] loadCategoriesMap failed [${code}]`, err)
    return new Map()
  }
}

/**
 * Charge les cotisations (référentiel club, petite taille). Map `id → price`.
 */
async function loadCotisationsMap(): Promise<Map<string, CotisationDoc>> {
  try {
    const snap = await getDocs(collection(db, COTISATIONS))
    const map = new Map<string, CotisationDoc>()
    for (const d of snap.docs) {
      const data = d.data() as DocumentData
      map.set(d.id, {
        name: (data['name'] as string | undefined) ?? '',
        price: (data['price'] as number | undefined) ?? 0,
      })
    }
    return map
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[teams.repo] loadCotisationsMap failed [${code}]`, err)
    return new Map()
  }
}

/**
 * Formate la tranche d'âge d'une catégorie pour affichage mobile.
 * `null` quand la catégorie est ouverte (Seniors / Loisirs / Veterans).
 */
function formatAgeRange(cat: CategoryDoc | undefined): string | null {
  if (!cat) return null
  if (cat.minAge == null && cat.maxAge == null) return null
  if (cat.minAge != null && cat.maxAge != null) return `${cat.minAge}–${cat.maxAge} ans`
  if (cat.minAge != null) return `${cat.minAge}+ ans`
  if (cat.maxAge != null) return `≤ ${cat.maxAge} ans`
  return null
}

/**
 * Mappe un snapshot `/teams/{id}` vers le shape `MockTeam` consommé par les
 * vues coach. Les champs sans équivalent Firestore (`nextTraining`,
 * `preferredSlots`, `tagName`, `tagColor`) sont laissés `undefined`.
 */
function snapToMockTeam(
  snap: QueryDocumentSnapshot<DocumentData> | DocumentSnapshot<DocumentData>,
  categories: Map<string, CategoryDoc>,
  cotisations: Map<string, CotisationDoc>,
): MockTeam {
  const data = snap.data() as TeamDoc
  const category = categories.get(data.categoryId)
  const cotisation = cotisations.get(data.cotisationId)
  return {
    id: snap.id,
    name: data.name,
    categoryName: category?.name ?? '—',
    categoryAgeRange: formatAgeRange(category),
    tagName: null,
    coachIds: Array.isArray(data.coachIds) ? data.coachIds : [],
    playerIds: Array.isArray(data.playerIds) ? data.playerIds : [],
    registrationStatus: data.registrationStatus ?? 'closed',
    cotisationPrice: cotisation?.price ?? 0,
    trainingsPerWeek: data.schedulingConstraints?.trainingsPerWeek,
  }
}

/**
 * Liste les équipes coachées par `coachMemberId` (memberId, pas uid Auth).
 *
 * Requête : `/teams where coachIds contains coachMemberId AND active == true`.
 * **Sans index composite** : `array-contains` + `==` est servi par l'index
 * mono-champ standard de Firestore. Pas de tri Firestore — tri JS par nom.
 *
 * Les catégories et cotisations sont chargées en parallèle puis joinées
 * en mémoire (référentiels < 30 docs chacun, négligeable).
 *
 * Retourne `[]` si :
 *   - `coachMemberId` est vide.
 *   - Aucune équipe ne matche.
 *   - Erreur Firestore (rules, network, etc.) — logguée mais pas thrown
 *     pour ne pas casser la vue (la coach app peut afficher un empty
 *     state plutôt qu'une erreur).
 */
export async function listTeamsForCoach(coachMemberId: string): Promise<MockTeam[]> {
  if (!coachMemberId) return []
  try {
    const [teamsSnap, categories, cotisations] = await Promise.all([
      getDocs(
        query(
          collection(db, TEAMS),
          where('coachIds', 'array-contains', coachMemberId),
          where('active', '==', true),
        ),
      ),
      loadCategoriesMap(),
      loadCotisationsMap(),
    ])
    return teamsSnap.docs
      .map((d) => snapToMockTeam(d, categories, cotisations))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[teams.repo] listTeamsForCoach failed [${code}]`, err)
    return []
  }
}

/**
 * Liste les équipes auxquelles un membre appartient (via `playerIds`).
 *
 * Requête : `/teams where playerIds array-contains memberId AND active == true`.
 * **Sans index composite** : `array-contains` + `==` est servi par l'index
 * mono-champ standard. Tri JS par nom.
 *
 * Retourne `[]` si aucun match / erreur (logguée, pas thrown — l'UI dégrade).
 *
 * Utilisé par `MemberDetail.vue` pour afficher la team primaire d'un joueur
 * (le doc `/members/{id}` n'a pas la relation inverse).
 */
export async function listTeamsForMember(memberId: string): Promise<MockTeam[]> {
  if (!memberId) return []
  try {
    const [teamsSnap, categories, cotisations] = await Promise.all([
      getDocs(
        query(
          collection(db, TEAMS),
          where('playerIds', 'array-contains', memberId),
          where('active', '==', true),
        ),
      ),
      loadCategoriesMap(),
      loadCotisationsMap(),
    ])
    return teamsSnap.docs
      .map((d) => snapToMockTeam(d, categories, cotisations))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[teams.repo] listTeamsForMember failed [${code}]`, err)
    return []
  }
}

/**
 * Récupère une équipe par son id avec sa catégorie + cotisation résolues.
 * Retourne `null` si :
 *   - `teamId` est vide.
 *   - L'équipe n'existe pas dans Firestore.
 *   - Erreur Firestore (rules, network…) — logguée mais pas thrown.
 *
 * Note : on charge les référentiels (catégories + cotisations) à chaque appel
 * — pour un single team c'est volontairement simple (réfs petites < 30 docs
 * chacune). Si la TeamRoster vue appelle ça en boucle, on cachera au store.
 */
export async function getTeam(teamId: string): Promise<MockTeam | null> {
  if (!teamId) return null
  try {
    const [snap, categories, cotisations] = await Promise.all([
      getDoc(doc(db, TEAMS, teamId)),
      loadCategoriesMap(),
      loadCotisationsMap(),
    ])
    if (!snap.exists()) return null
    return snapToMockTeam(snap, categories, cotisations)
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[teams.repo] getTeam failed [${code}]`, err)
    return null
  }
}
