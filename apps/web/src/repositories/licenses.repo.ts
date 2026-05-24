import { FirebaseError } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '@/services/firebase'
import type { License, LicenseData, LicenseTypeData } from '@club-app/shared-types'

/**
 * Repository Licenses — collection `/licenses` (instances de licences fédérales
 * émises pour un membre × saison × type de licence).
 *
 * Cette couche est la SEULE à pouvoir importer le SDK Firebase
 * (cf. docs/frontend-desktop.md — architecture en couches). Les writes de
 * création passent par `/licenses/{id}` (status `pending`, write client direct,
 * réservé admin côté rules). La transition `pending → active` ne se fait PAS
 * ici : elle passe par la callable serveur `confirmLicense` (cf.
 * `services/cloudFunctions.ts`) qui poste aussi l'écriture comptable de la
 * charge et dénormalise `member.officialLicense` / `coachLicense`.
 *
 * Volume faible attendu par membre (quelques licences sur la durée de vie) :
 * lecture par query simple `where memberId == X` + tri JS par `createdAt`
 * desc, pas d'index composite (cf. règle 10 du `CLAUDE.md` racine).
 */

const LICENSES = 'licenses'
const LICENSE_TYPES = 'licenseTypes'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convertit un snapshot Firestore en `License` typée. */
function snapToLicense(
  snap: QueryDocumentSnapshot | DocumentSnapshot,
): License {
  const data = snap.data() as LicenseData
  return { id: snap.id, ...data }
}

/**
 * Comparator `createdAt` desc. Tolère les docs dont `createdAt` n'est pas
 * encore résolu (serverTimestamp pending → `null`) en les plaçant en tête.
 */
function compareByCreatedAtDesc(a: License, b: License): number {
  const as = a.createdAt?.seconds ?? Number.MAX_SAFE_INTEGER
  const bs = b.createdAt?.seconds ?? Number.MAX_SAFE_INTEGER
  return bs - as
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Liste les licences d'un membre. Query simple `where memberId == X`, tri JS
 * par `createdAt` desc — pas d'index composite (cf. règle 10 du CLAUDE.md
 * racine ; tolère aussi les docs avec `serverTimestamp` pas encore résolu).
 */
export async function listMemberLicenses(memberId: string): Promise<License[]> {
  try {
    const snap = await getDocs(
      query(collection(db, LICENSES), where('memberId', '==', memberId)),
    )
    return snap.docs.map(snapToLicense).sort(compareByCreatedAtDesc)
  } catch (err: unknown) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[licenses.repo/listMemberLicenses] failed [${code}]`, err)
    throw err
  }
}

/**
 * Liste les licences visibles par le caller, optionnellement filtrées par
 * saison. Tri client `createdAt` desc.
 *
 * Scope par rôle (rules Firestore) : staff (admin / coach / treasurer /
 * secretary) voient tout ; member lié + tuteurs voient leurs propres licences
 * (la rule `read` est large mais le cas membre n'est pas le caller cible de
 * cette vue — page admin `/licenses`).
 *
 * Dégradation : sur `permission-denied` (ex. un caller non staff atteindrait
 * la page par erreur), retourne `[]` plutôt que de throw — la vue affichera
 * l'empty state. Toute autre `FirebaseError` est relancée (rules denied
 * non-permission, network, index manquant…).
 *
 * @param seasonId — si fourni, filtre serveur-side via
 *   `where('seasonId', '==', X)`. `undefined` ou chaîne vide → toutes saisons
 *   (full scan de `/licenses`).
 */
export async function listAllLicenses(seasonId?: string): Promise<License[]> {
  try {
    const ref = collection(db, LICENSES)
    const q =
      seasonId && seasonId.length > 0
        ? query(ref, where('seasonId', '==', seasonId))
        : query(ref)
    const snap = await getDocs(q)
    return snap.docs.map(snapToLicense).sort(compareByCreatedAtDesc)
  } catch (err: unknown) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    if (code === 'permission-denied') {
      console.warn(`[licenses.repo/listAllLicenses] denied → []`, err)
      return []
    }
    console.error(`[licenses.repo/listAllLicenses] failed [${code}]`, err)
    throw err
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Payload de création d'une licence. Le `LicenseType` choisi est lu pour
 * snapshotter `role` / `level` / `name` / `fee` dans le doc `/licenses` —
 * figés malgré les évolutions de la grille tarifaire.
 */
export interface CreateLicenseInput {
  memberId: string
  /** `/seasons/{id}` — saison de validité. */
  seasonId: string
  /** `/licenseTypes/{id}` à snapshotter. */
  licenseTypeId: string
}

/**
 * Crée une licence en statut `pending` dans `/licenses`.
 *
 * Lit le `LicenseType` référencé et SNAPSHOTTE `role` / `level` /
 * `name` (→ `licenseName`) / `fee` (→ `feeSnapshot`) dans le doc créé. Les
 * champs de confirmation (`confirmedAt`, `confirmedByUid`, `accountingEntryId`)
 * sont `null` jusqu'à l'appel de la callable `confirmLicense`.
 *
 * @throws FirebaseError sur erreur Firestore (rules denied, réseau, …).
 * @throws Error si le `LicenseType` n'existe pas ou si l'utilisateur n'est
 *  pas authentifié.
 */
export async function createLicense(input: CreateLicenseInput): Promise<License> {
  const uid = getAuth().currentUser?.uid ?? null
  if (!uid) {
    throw new Error("Utilisateur non authentifié — impossible de créer une licence.")
  }
  try {
    const typeSnap = await getDoc(doc(db, LICENSE_TYPES, input.licenseTypeId))
    if (!typeSnap.exists()) {
      throw new Error(`Type de licence introuvable (${input.licenseTypeId}).`)
    }
    const type = typeSnap.data() as LicenseTypeData

    const data: Omit<LicenseData, 'createdAt'> & { createdAt: unknown } = {
      memberId: input.memberId,
      seasonId: input.seasonId,
      licenseTypeId: input.licenseTypeId,
      role: type.role,
      level: type.level,
      licenseName: type.name,
      feeSnapshot: type.fee,
      status: 'pending',
      createdAt: serverTimestamp(),
      createdByUid: uid,
      confirmedAt: null,
      confirmedByUid: null,
      accountingEntryId: null,
      // Création manuelle depuis la fiche membre (hors workflow license
      // request) → pas de référence inverse. Posés par `validateLicenseRequest`
      // (callable serveur PR3) sur le chemin issu d'une demande parent.
      requestId: null,
      requestedByUid: null,
    }

    const ref = await addDoc(collection(db, LICENSES), data)
    const created = await getDoc(ref)
    if (!created.exists()) {
      throw new Error(`Failed to read license ${ref.id} just after creation`)
    }
    return snapToLicense(created)
  } catch (err: unknown) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[licenses.repo/createLicense] failed [${code}]`, err)
    throw err
  }
}

/**
 * Supprime une licence — uniquement autorisé pour les licences `pending`
 * (jamais activées pour la saison). Une licence `active` est une charge
 * comptable confirmée (cf. callable `confirmLicense`) : on ne peut pas la
 * faire disparaître par delete, il faut passer par `cancelled`.
 *
 * Garde défensive côté client en plus de la rule admin/rootAdmin Firestore :
 * vérifie le status actuel via un re-fetch avant le delete, throw clair si
 * la licence n'est pas `pending`.
 *
 * @throws Error si la licence n'existe pas ou n'est pas en `pending`.
 * @throws FirebaseError sur permission-denied / réseau.
 */
export async function deleteLicense(licenseId: string): Promise<void> {
  try {
    const ref = doc(db, LICENSES, licenseId)
    const snap = await getDoc(ref)
    if (!snap.exists()) {
      throw new Error(`Licence introuvable (${licenseId}).`)
    }
    const data = snap.data() as LicenseData
    if (data.status !== 'pending') {
      throw new Error(
        `Impossible de supprimer une licence ${data.status} — seules les licences "pending" peuvent être supprimées.`,
      )
    }
    await deleteDoc(ref)
  } catch (err: unknown) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[licenses.repo/deleteLicense] failed [${code}]`, err)
    throw err
  }
}
