/**
 * Repository Members — Firestore-backed (courtbase-app).
 *
 * SEULE couche autorisée à importer le SDK Firebase pour les membres (cf.
 * architecture en couches CLAUDE.md). Minimaliste vs `apps/web/members.repo` :
 * la coach app n'affiche pour l'instant que firstName/lastName/birthDate +
 * statut actif → pas besoin de contacts privés ni de team labels enrichis.
 *
 * Output shape : `MockMember` (cf. `@/types/mock`) — choix volontaire pour
 * que les vues / stores consomment le même type que la couche mock sans
 * adaptation. Les champs absents en prod (ex. `duesStatus` qui requerrait
 * un fetch `/cotisations` en parallèle) sont remplis avec des defaults
 * sensibles documentés ci-dessous.
 *
 * Cf. `docs/firebase.md` § `/members` + `firestore.rules:162-193` (read
 * autorisé pour admin/coach/official/membre lié/tuteur — pas de scope team).
 */

import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
  Timestamp,
  type DocumentData,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { FirebaseError } from 'firebase/app'
import {
  getDownloadURL,
  getStorage,
  ref as storageRef,
  uploadBytes,
} from 'firebase/storage'

import { db, firebaseApp } from '@/services/firebase'
import {
  removeMemberLicensePhoto as callRemoveMemberLicensePhoto,
  setMemberLicensePhoto as callSetMemberLicensePhoto,
} from '@/services/cloudFunctions'
import type { MockMember, MemberGender } from '@/types/mock'

const MEMBERS = 'members'
/** Limite de la clause `in` Firestore (cf. doc Firestore queries). */
const IN_CHUNK = 10

/**
 * Sous-ensemble des champs `/members/{id}` qu'on consomme ici. On ne déclare
 * pas tous les champs canoniques (cf. `packages/shared-types/src/member.ts`)
 * pour rester typesafe avec ce qu'on lit vraiment.
 */
interface MemberFirestoreDoc {
  firstName?: string
  lastName?: string
  birthDate?: Timestamp | null
  gender?: 'M' | 'F' | 'other' | 'na' | null
  licenseNumber?: string | null
  officialLevel?: number | null
  officialLicense?: { seasonId: string; level: number | null } | null
  guardianUserIds?: string[]
  active?: boolean
  status?: 'active' | 'archived'
  avs?: string | null
  /**
   * Photo licence (cf. `docs/members/license-photo.md`). Tous nullables car
   * les champs ne sont pas garantis présents sur tous les docs (pas de
   * migration — lecture defensive).
   */
  photoStoragePath?: string | null
  photoUpdatedAt?: Timestamp | null
}

/**
 * Formate `Timestamp | null` → string `yyyy-mm-dd` (format attendu par
 * `MockMember.birthDate`). Retourne `''` si null/invalide — l'UI affichera
 * une date manquante plutôt que de planter.
 */
function formatBirthDate(ts: Timestamp | null | undefined): string {
  if (!ts) return ''
  const d = ts.toDate()
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Map un snapshot `/members/{id}` vers le shape `MockMember`. Les champs
 * sans équivalent direct sont remplis avec :
 *   - `teamIds: []`        — non stocké côté member (relation inverse via team.playerIds).
 *   - `duesStatus: 'paid'` — neutre tant qu'on ne fetch pas `/cotisations`.
 *                            Évite un faux "exclu" rose dans l'UI.
 *   - `officialLevel`, `officialLicense` : lus directement (déjà dénormalisés).
 *
 * Les pills cotisation/licence dans TeamRoster s'appuieront sur ces champs
 * dégradés tant que le repo `/cotisations` n'est pas branché côté coach app.
 */
function snapToMockMember(
  snap: QueryDocumentSnapshot<DocumentData> | DocumentSnapshot<DocumentData>,
): MockMember {
  const data = snap.data() as MemberFirestoreDoc
  const gender: MemberGender = data.gender ?? 'na'
  return {
    id: snap.id,
    firstName: data.firstName ?? '',
    lastName: data.lastName ?? '',
    birthDate: formatBirthDate(data.birthDate ?? null),
    gender,
    // Pas stocké côté member — la relation vit dans team.playerIds. On laisse
    // l'array vide car l'UI ne s'en sert pas dans TeamRoster (on charge déjà
    // par team).
    teamIds: [],
    // Défaut neutre — la pill "Payée / En attente" reste générique tant qu'on
    // n'a pas branché `/cotisations`. Pas d'effet "Exclu" parasite.
    duesStatus: 'paid',
    licenseNumber: data.licenseNumber && data.licenseNumber.length > 0 ? data.licenseNumber : null,
    // Canonical `ActiveLicenseRef.level` est nullable mais `MockMember`
    // exige `number`. Defensive : on coerce un `null` en `0` (la pill
    // "Licencié" du roster ne consomme pas le level — pas d'impact UI).
    officialLicense: data.officialLicense
      ? { seasonId: data.officialLicense.seasonId, level: data.officialLicense.level ?? 0 }
      : null,
    officialLevel: data.officialLevel ?? null,
    guardianUserIds: Array.isArray(data.guardianUserIds) ? data.guardianUserIds : [],
    active: data.active !== false,
    status: data.status === 'archived' ? 'archived' : 'active',
    avs: data.avs ?? undefined,
    photoStoragePath: data.photoStoragePath ?? null,
    // On expose seulement `seconds` (suffisant pour le cache-buster `?v=…`).
    // Le `Timestamp` complet est volontairement masqué pour rester
    // compatible avec le type `MockMember` (qui n'importe pas firebase).
    photoUpdatedAt: data.photoUpdatedAt ? { seconds: data.photoUpdatedAt.seconds } : null,
  }
}

/**
 * Découpe un array en chunks de taille `size`. Sert à respecter la limite
 * `in` de Firestore (10 valeurs par query).
 */
function chunked<T>(arr: ReadonlyArray<T>, size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}

/**
 * Récupère un membre par son id. Retourne `null` si :
 *   - `id` est vide ;
 *   - le doc n'existe pas ;
 *   - erreur Firestore (rules, network…) — logguée, pas thrown (l'UI affiche
 *     un empty state plutôt qu'un crash).
 */
export async function getMember(id: string): Promise<MockMember | null> {
  if (!id) return null
  try {
    const snap = await getDoc(doc(db, MEMBERS, id))
    if (!snap.exists()) return null
    return snapToMockMember(snap)
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[members.repo] getMember failed [${code}]`, err)
    return null
  }
}

export interface MemberContact {
  email: string | null
  phone: string | null
}

/**
 * Charge le sous-doc `/members/{id}/private/contact`. Champ email/phone
 * coercés en `null` si absents ou vides. Retourne `null` si erreur (rules /
 * network) — le caller affiche un placeholder.
 *
 * Les rules autorisent un coach scope à lire ce sub-doc (cf. `firestore.rules`
 * `/members/{memberId}/private/contact`).
 */
export async function getMemberContact(id: string): Promise<MemberContact | null> {
  if (!id) return null
  try {
    const snap = await getDoc(doc(db, MEMBERS, id, 'private', 'contact'))
    if (!snap.exists()) return { email: null, phone: null }
    const data = snap.data() as { email?: unknown; phone?: unknown }
    const email = typeof data.email === 'string' && data.email.length > 0 ? data.email : null
    const phone = typeof data.phone === 'string' && data.phone.length > 0 ? data.phone : null
    return { email, phone }
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[members.repo] getMemberContact failed [${code}]`, err)
    return null
  }
}

/**
 * Écrit le contact privé d'un member (`/members/{id}/private/contact`).
 *
 * Rules (`firestore.rules` §members.private.contact lignes 195-199) :
 * `write` autorisé pour `isRootAdmin() || isAdmin() || isLinkedMember(memberId)`.
 * Donc côté courtbase-app, seul le user dont `/users/{uid}.memberId === memberId`
 * peut écrire ici (les coachs/tuteurs/officials n'ont PAS le droit — ils
 * passeraient par une callable admin).
 *
 * `setDoc` (sans merge) avec ID fixe `contact` : crée le doc si absent, écrase
 * sinon. L'UI doit fournir email + phone simultanément.
 *
 * Throws sur erreur Firestore (rules denied, network) — le caller affiche
 * un toast / inline error pour signaler à l'utilisateur.
 */
export async function updateMemberContact(
  memberId: string,
  data: MemberContact,
): Promise<void> {
  if (!memberId) throw new Error('memberId is required')
  await setDoc(doc(db, MEMBERS, memberId, 'private', 'contact'), {
    email: data.email ?? '',
    phone: data.phone ?? '',
  })
}

/**
 * Récupère les membres dont l'id est dans `memberIds`. Bat les ids en
 * chunks de 10 (limite Firestore `in`) et lance les queries en parallèle.
 *
 * Retourne `[]` si :
 *   - `memberIds` est vide.
 *   - Erreur Firestore (rules, network…) — logguée mais pas thrown pour
 *     ne pas casser la vue (un empty state est plus sympa qu'un crash).
 *
 * Tri : par lastName puis firstName (FR locale, insensible casse).
 */
export async function listMembersByIds(
  memberIds: ReadonlyArray<string>,
): Promise<MockMember[]> {
  if (memberIds.length === 0) return []
  // Dédupe défensive — un membre peut apparaître plusieurs fois si on
  // concatène coachIds + playerIds plus tard.
  const unique = Array.from(new Set(memberIds))
  try {
    const chunks = chunked(unique, IN_CHUNK)
    const snaps = await Promise.all(
      chunks.map((c) =>
        getDocs(query(collection(db, MEMBERS), where(documentId(), 'in', c))),
      ),
    )
    const members: MockMember[] = []
    for (const snap of snaps) {
      for (const d of snap.docs) {
        members.push(snapToMockMember(d))
      }
    }
    return members.sort((a, b) => {
      const byLast = a.lastName.localeCompare(b.lastName, 'fr', { sensitivity: 'base' })
      if (byLast !== 0) return byLast
      return a.firstName.localeCompare(b.firstName, 'fr', { sensitivity: 'base' })
    })
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[members.repo] listMembersByIds failed [${code}]`, err)
    return []
  }
}

// ─── Photo licence (cf. docs/members/license-photo.md) ──────────────

/** MIME types tolérés côté UI + côté Storage rule. */
const PHOTO_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const
type PhotoMime = (typeof PHOTO_ALLOWED_MIME)[number]
/** Limite cohérente avec la storage rule (≤ 5 Mo). */
const PHOTO_MAX_BYTES = 5 * 1024 * 1024

/**
 * Mappe un MIME image vers une extension de fichier (utilisée pour bâtir le
 * `storagePath` `members/{id}/license-photo.{ext}`).
 */
function extForMime(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    default:
      throw new Error(
        `Format d'image non supporté (${mime}). Acceptés : JPEG, PNG, WebP.`,
      )
  }
}

function assertPhotoMime(mime: string): asserts mime is PhotoMime {
  if (!PHOTO_ALLOWED_MIME.includes(mime as PhotoMime)) {
    throw new Error(
      "Format d'image non supporté. Acceptés : JPEG, PNG, WebP.",
    )
  }
}

/**
 * Upload une photo licence pour un member donné.
 *
 * Pipeline :
 *  1. Validation client : MIME (jpeg/png/webp) + taille (≤ 5 Mo) — pré-checks
 *     pour éviter un round-trip Storage si l'utilisateur a sélectionné un
 *     fichier invalide.
 *  2. `uploadBytes(storage, members/{id}/license-photo.{ext}, file)` — la
 *     rule Storage `/members/{memberId}/{fileName}` autorise tout signed-in
 *     (≤ 5 Mo, MIME image). Le scope coach est re-vérifié serveur-side par
 *     la callable suivante.
 *  3. Callable `setMemberLicensePhoto` — pose `member.photoStoragePath /
 *     photoUpdatedAt / photoUpdatedByUid` (write `/members` réservé admin
 *     côté rules, c'est la callable qui valide le scope coach).
 *
 * Throws sur erreur (le caller affiche un toast/inline error). Pas de
 * `null` retourné silencieusement — on veut que l'UI sache.
 */
export async function uploadMemberPhoto(
  memberId: string,
  file: File,
): Promise<{ storagePath: string }> {
  if (!memberId) throw new Error('memberId is required')
  if (!file) throw new Error('Aucun fichier sélectionné')

  // Pré-validation client.
  assertPhotoMime(file.type)
  if (file.size > PHOTO_MAX_BYTES) {
    throw new Error(
      `Fichier trop volumineux (${(file.size / 1024 / 1024).toFixed(2)} Mo). Maximum 5 Mo.`,
    )
  }

  const ext = extForMime(file.type)
  const storagePath = `members/${memberId}/license-photo.${ext}`

  // 1. Upload Storage.
  try {
    const storage = getStorage(firebaseApp)
    await uploadBytes(storageRef(storage, storagePath), file, {
      contentType: file.type,
    })
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[members.repo] uploadMemberPhoto storage failed [${code}]`, err)
    throw new Error(
      code === 'storage/unauthorized'
        ? "Vous n'avez pas l'autorisation d'uploader cette photo."
        : "Échec de l'envoi du fichier. Réessayez.",
    )
  }

  // 2. Callable : pose les pointeurs Firestore + best-effort delete ancien
  // path (gérée serveur-side via Admin SDK).
  try {
    await callSetMemberLicensePhoto({
      memberId,
      storagePath,
      contentType: file.type,
      sizeBytes: file.size,
    })
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[members.repo] setMemberLicensePhoto callable failed [${code}]`, err)
    throw new Error(
      code === 'permission-denied' || code === 'functions/permission-denied'
        ? "Vous n'avez pas les droits pour modifier cette photo."
        : 'Échec de la mise à jour du profil. Réessayez.',
    )
  }

  return { storagePath }
}

/**
 * Supprime la photo licence d'un member.
 *
 * Appelle uniquement la callable `removeMemberLicensePhoto` — c'est elle qui
 * supprime le fichier Storage (Admin SDK) et clear les champs Firestore.
 * Admin/rootAdmin uniquement (le scope coach n'autorise pas la suppression).
 */
export async function removeMemberPhoto(memberId: string): Promise<void> {
  if (!memberId) throw new Error('memberId is required')
  try {
    await callRemoveMemberLicensePhoto({ memberId })
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[members.repo] removeMemberPhoto failed [${code}]`, err)
    throw new Error(
      code === 'permission-denied' || code === 'functions/permission-denied'
        ? 'Seul un admin peut supprimer la photo licence.'
        : 'Échec de la suppression. Réessayez.',
    )
  }
}

/**
 * Résout l'URL téléchargeable d'une photo licence Storage.
 *
 * Retourne `null` si :
 *  - `storagePath` est vide ou null ;
 *  - le fichier n'existe pas (rule denied, not-found) ;
 *  - autre erreur Firebase Storage.
 *
 * Le caller utilise le résultat dans un `<img :src="…">`. Si `null`, l'UI
 * affiche un placeholder.
 */
export async function getMemberPhotoDownloadUrl(
  storagePath: string | null | undefined,
): Promise<string | null> {
  if (!storagePath) return null
  try {
    const storage = getStorage(firebaseApp)
    return await getDownloadURL(storageRef(storage, storagePath))
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.warn(`[members.repo] getMemberPhotoDownloadUrl failed [${code}]`, err)
    return null
  }
}
