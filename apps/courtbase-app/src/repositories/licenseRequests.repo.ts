/**
 * Repository LicenseRequests — Firestore-backed (courtbase-app, coach mobile).
 *
 * SEULE couche autorisée à importer le SDK Firebase pour les demandes de
 * licence (cf. architecture en couches CLAUDE.md racine).
 *
 * Scope PR1 : le coach déclenche une demande pour un joueur. Le doc
 * `/licenseRequests/{id}` est écrit directement côté client (rules
 * existantes autorisent `isCoach() && teamId in userDoc().teamIds`).
 *
 * ID déterministe `lr-{memberId}-{seasonId}` :
 *  - garantit l'idempotence sur double-clic coach (le 2e setDoc serait
 *    refusé/écraserait le doc, mais on check avant pour un retour UX
 *    propre "déjà en cours") ;
 *  - permet l'UX "demande déjà en cours" sans query (un seul getDoc).
 *
 * Cf. `docs/firebase.md` § `/licenseRequests` + `docs/licenses/parent-completion-workflow.md`.
 */

import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type DocumentData,
  type FieldValue,
  type QueryDocumentSnapshot,
  type DocumentSnapshot,
} from 'firebase/firestore'
import { FirebaseError } from 'firebase/app'
import { getDownloadURL, getStorage, ref as storageRef } from 'firebase/storage'

import { db, firebaseApp } from '@/services/firebase'
import type {
  LicenseDocKind,
  LicenseRequest,
  LicenseRequestData,
  LicenseRequestStatus,
  Timestamp,
} from '@club-app/shared-types'

const LICENSE_REQUESTS = 'licenseRequests'
const NOTIFICATIONS = 'notifications'
/** Limite de la clause `in` Firestore. */
const IN_CHUNK = 10

/**
 * ID déterministe d'une demande de licence pour un (member, season). Évite
 * les doublons sur double-clic + permet la pré-vérification "déjà en cours"
 * via un simple `getDoc` (vs query).
 *
 * Cf. mémoire `firestore_functions_phase1` § idempotence IDs déterministes.
 */
export function licenseRequestId(memberId: string, seasonId: string): string {
  return `lr-${memberId}-${seasonId}`
}

// ─── Mapping snapshot → domain ───────────────────────────────────────

/**
 * Map un snapshot `/licenseRequests/{id}` vers le type canonique
 * `LicenseRequest`. Défensif sur les champs optionnels/nullable au cas où
 * un doc legacy traînerait (en pratique : aucun à ce stade, c'est de la
 * defense-in-depth pour les itérations futures).
 */
function snapToLicenseRequest(
  snap: QueryDocumentSnapshot<DocumentData> | DocumentSnapshot<DocumentData>,
): LicenseRequest {
  const data = snap.data() as Partial<LicenseRequestData> | undefined
  // `data()` ne peut pas être undefined ici (snap est garanti `exists()`
  // par les callers), mais TypeScript ne le sait pas pour DocumentSnapshot.
  const d = data ?? ({} as Partial<LicenseRequestData>)
  return {
    id: snap.id,
    memberId: d.memberId ?? '',
    teamId: d.teamId ?? '',
    seasonId: d.seasonId ?? '',
    requestedBy: d.requestedBy ?? '',
    status: d.status ?? 'pending_parent_docs',
    requiredDocs: Array.isArray(d.requiredDocs) ? d.requiredDocs : [],
    parentUserIds: Array.isArray(d.parentUserIds) ? d.parentUserIds : [],
    uploadedDocs: d.uploadedDocs ?? {},
    foreignPlayerContext: d.foreignPlayerContext ?? null,
    parentSubmittedAvs: d.parentSubmittedAvs ?? null,
    denorm: d.denorm ?? null,
    parentCompletedAt: d.parentCompletedAt ?? null,
    coachValidatedAt: d.coachValidatedAt ?? null,
    coachValidatedByUid: d.coachValidatedByUid ?? null,
    reviewedBy: d.reviewedBy ?? null,
    reviewedAt: d.reviewedAt ?? null,
    adminComment: d.adminComment ?? null,
    // `createdAt` est always set côté serveur (sentinel) — coerce un
    // fallback structurel défensif si un doc legacy n'a pas le champ.
    createdAt: d.createdAt ?? ({ seconds: 0, nanoseconds: 0 } as Timestamp),
    // Phase trésorier (PR3-trésorier, 2026-05-24) — backward-compat null
    // pour les demandes legacy en `coach_validated` qui n'ont pas ces champs.
    signableDocStoragePath: d.signableDocStoragePath ?? null,
    signableDocUploadedAt: d.signableDocUploadedAt ?? null,
    signableDocUploadedByUid: d.signableDocUploadedByUid ?? null,
    signedDocStoragePath: d.signedDocStoragePath ?? null,
    signedDocUploadedAt: d.signedDocUploadedAt ?? null,
    signedDocUploadedByUid: d.signedDocUploadedByUid ?? null,
    formConfirmedAt: d.formConfirmedAt ?? null,
    formConfirmedByUid: d.formConfirmedByUid ?? null,
    sentToFederationAt: d.sentToFederationAt ?? null,
    paidAt: d.paidAt ?? null,
    paymentProofStoragePath: d.paymentProofStoragePath ?? null,
    paymentProofUploadedAt: d.paymentProofUploadedAt ?? null,
    licenseNumber: d.licenseNumber ?? null,
    licenseFinalizedAt: d.licenseFinalizedAt ?? null,
    licenseFinalizedByUid: d.licenseFinalizedByUid ?? null,
    linkedLicenseId: d.linkedLicenseId ?? null,
    treasurerNotes: d.treasurerNotes ?? null,
  }
}

function chunked<T>(arr: ReadonlyArray<T>, size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}

// ─── Reads ───────────────────────────────────────────────────────────

/**
 * Récupère une demande par son ID déterministe — utilisée pour la
 * pré-vérification d'existence avant création + pour les vues détail.
 *
 * Retourne `null` si :
 *  - `id` est vide ;
 *  - le doc n'existe pas ;
 *  - erreur Firestore (logguée mais pas thrown — empty state OK).
 */
export async function getLicenseRequest(id: string): Promise<LicenseRequest | null> {
  if (!id) return null
  try {
    const snap = await getDoc(doc(db, LICENSE_REQUESTS, id))
    if (!snap.exists()) return null
    return snapToLicenseRequest(snap)
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[licenseRequests.repo] getLicenseRequest failed [${code}]`, err)
    return null
  }
}

/**
 * Vérifie un code Firestore sans utiliser `instanceof FirestoreError` (non
 * fiable côté bundling Vite — cf. CLAUDE.md règle 13 +
 * mémoire `firebase-error-instanceof-unreliable`).
 */
function isPermissionDenied(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'permission-denied'
  )
}

/**
 * Liste les demandes scopées aux teams du coach, avec filtre `status` optionnel.
 *
 * Query : `where teamId in <chunk>` (chunké par 10 — limite Firestore `in`).
 * Le filtre `status` est appliqué côté JS pour éviter un index composite
 * `(teamId IN, status ==)` non documenté.
 *
 * Pattern conforme à CLAUDE.md règle 10 (petits volumes, tri JS) et règle 9
 * (try/catch défensif + check `err.code` direct via helper plutôt que
 * `instanceof FirebaseError`).
 *
 * Retourne `[]` si :
 *  - `teamIds` vide ;
 *  - aucun match trouvé ;
 *  - permission-denied (logguée, l'UI dégrade en empty state) ;
 *  - autre erreur Firestore (logguée).
 *
 * Volumétrie attendue : quelques dizaines de demandes max par coach. Pas
 * d'index composite nécessaire.
 */
export async function listLicenseRequestsForCoach(
  teamIds: readonly string[],
  opts?: { status?: LicenseRequestStatus | LicenseRequestStatus[] },
): Promise<LicenseRequest[]> {
  if (teamIds.length === 0) return []
  const unique = Array.from(new Set(teamIds.filter((id) => Boolean(id))))
  if (unique.length === 0) return []

  const statusFilter = opts?.status
    ? new Set<LicenseRequestStatus>(
        Array.isArray(opts.status) ? opts.status : [opts.status],
      )
    : null

  try {
    const chunks = chunked(unique, IN_CHUNK)
    const snaps = await Promise.all(
      chunks.map((c) =>
        getDocs(query(collection(db, LICENSE_REQUESTS), where('teamId', 'in', c))),
      ),
    )
    const seenIds = new Set<string>()
    const out: LicenseRequest[] = []
    for (const snap of snaps) {
      for (const d of snap.docs) {
        if (seenIds.has(d.id)) continue
        seenIds.add(d.id)
        const lr = snapToLicenseRequest(d)
        if (statusFilter && !statusFilter.has(lr.status)) continue
        out.push(lr)
      }
    }
    return out
  } catch (err) {
    if (isPermissionDenied(err)) {
      console.warn(
        '[licenseRequests.repo] listLicenseRequestsForCoach permission-denied — empty fallback',
      )
      return []
    }
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(
      `[licenseRequests.repo] listLicenseRequestsForCoach failed [${code}]`,
      err,
    )
    return []
  }
}

/**
 * Résout l'URL téléchargeable d'un document uploadé dans Firebase Storage.
 *
 * Retourne `null` si :
 *  - `storagePath` est vide ou commence par `mock://` (fixture mock — pas de
 *    Storage réel à résoudre) ;
 *  - le fichier n'existe pas (permission ou not-found) ;
 *  - une autre erreur survient (logguée).
 *
 * Le caller utilise le résultat pour brancher un `<a href>` ou un
 * `window.open`. Si `null`, l'UI affiche un bouton désactivé "Aperçu non
 * disponible".
 */
export async function getLicenseDocDownloadUrl(
  storagePath: string | null | undefined,
): Promise<string | null> {
  if (!storagePath) return null
  if (storagePath.startsWith('mock://')) return null
  try {
    const storage = getStorage(firebaseApp)
    return await getDownloadURL(storageRef(storage, storagePath))
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.warn(`[licenseRequests.repo] getLicenseDocDownloadUrl failed [${code}]`, err)
    return null
  }
}

/**
 * Liste les demandes pour une batch de memberIds (chunkée par 10, queries
 * parallèles). Filtre côté JS sur `seasonId === activeSeasonId` pour ne
 * garder que la demande de la saison en cours (utile quand on backfillera
 * des saisons passées).
 *
 * Utilisée par `licenseRequestsStore.hydrateForMembers` pour afficher la
 * pill "demande en cours" sur TeamRoster sans N+1.
 *
 * Retourne `[]` en cas d'erreur (logguée) — le caller dégrade en pill
 * absente, pas en crash.
 */
export async function listLicenseRequestsByMembers(
  memberIds: readonly string[],
  activeSeasonId: string,
): Promise<LicenseRequest[]> {
  if (memberIds.length === 0 || !activeSeasonId) return []
  const unique = Array.from(new Set(memberIds))
  try {
    const chunks = chunked(unique, IN_CHUNK)
    const snaps = await Promise.all(
      chunks.map((c) =>
        getDocs(
          query(collection(db, LICENSE_REQUESTS), where('memberId', 'in', c)),
        ),
      ),
    )
    const out: LicenseRequest[] = []
    for (const snap of snaps) {
      for (const d of snap.docs) {
        const lr = snapToLicenseRequest(d)
        if (lr.seasonId === activeSeasonId) out.push(lr)
      }
    }
    return out
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[licenseRequests.repo] listLicenseRequestsByMembers failed [${code}]`, err)
    return []
  }
}

// ─── Create ──────────────────────────────────────────────────────────

export interface CreateLicenseRequestInput {
  memberId: string
  teamId: string
  seasonId: string
  /** auth.uid du coach (audit). */
  requestedByUid: string
  /** userDoc.memberId du coach (denorm, pas utilisé côté serveur PR1). */
  requestedByMemberId: string
  /** Pré-calculé par le caller via `inferRequiredDocs`. */
  requiredDocs: LicenseDocKind[]
  /** linkedUserId ∪ guardianUserIds — destinataires des notifs (best-effort). */
  notifyUserIds: readonly string[]
  denorm: {
    memberFirstName: string
    memberLastName: string
    teamName: string
    /** displayName du coach. */
    coachName: string
  }
}

export interface CreateLicenseRequestResult {
  requestId: string
  /** True si la demande existait déjà (idempotence sur double-clic). */
  alreadyExisted: boolean
  /** Nombre de docs `/notifications` écrits. `0` si rules refusent / schéma incompatible. */
  notificationsWritten: number
  /** `FirebaseError.code` ou marqueur ('schema-mismatch', 'permission-denied'…). `null` si OK. */
  notificationsError: string | null
}

/**
 * Crée la demande de licence pour un membre, idempotente via ID déterministe.
 *
 * **Idempotence** : si `lr-{memberId}-{seasonId}` existe déjà, retourne
 * `{ alreadyExisted: true }` SANS toucher au doc existant ni renvoyer de
 * notification (le parent en a déjà reçu une à la création initiale).
 *
 * **Notifications — état actuel (PR1)** :
 * Le schéma `/notifications` existant (cf. `docs/firebase.md` § /notifications)
 * est **officials-only** : `type: 'new_match' | 'officials_needed' | ...`,
 * `targetAudience: 'all_officials' | ...`, etc. Le trigger `fanoutNotification`
 * résout uniquement des UIDs d'officiels via `targetAudience`. **Aucun
 * variant "parent / single recipient"** n'est encore défini. De plus, la
 * rule `/notifications` (firestore.rules:424) bloque la création par un
 * coach (`allow create: if isRootAdmin() || isAdmin()`).
 *
 * Conséquence : on n'écrit PAS dans `/notifications` côté PR1. On log un
 * `console.info` informatif et on retourne `notificationsWritten: 0,
 * notificationsError: 'schema-mismatch'`. Le parent recevra la notification
 * via un canal dédié à câbler ultérieurement (PR2 ou plus tard) :
 *
 *  - soit étendre `/notifications` avec `recipientUid` + `type: 'license_documents_pending'`
 *    + update du trigger + assouplir les rules (coach create pour parents
 *    de ses joueurs) ;
 *  - soit un trigger Firestore `onLicenseRequestCreated` côté serveur qui
 *    écrit la notif avec droits admin (préférable — évite d'étendre les
 *    rules côté client).
 *
 * **Best-effort sur l'écriture (quand on la branchera)** : si elle plante,
 * on logge mais on ne fait pas échouer la création de la `/licenseRequests`
 * (un futur bouton "Relancer" côté coach permettra de retenter).
 */
export async function createLicenseRequest(
  input: CreateLicenseRequestInput,
): Promise<CreateLicenseRequestResult> {
  if (!input.memberId || !input.teamId || !input.seasonId) {
    throw new Error('createLicenseRequest: memberId, teamId, seasonId required')
  }

  const id = licenseRequestId(input.memberId, input.seasonId)

  // 1. Pré-vérif idempotence — un seul getDoc, pas de query.
  try {
    const existing = await getDoc(doc(db, LICENSE_REQUESTS, id))
    if (existing.exists()) {
      return {
        requestId: id,
        alreadyExisted: true,
        notificationsWritten: 0,
        notificationsError: null,
      }
    }
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[licenseRequests.repo] precheck failed [${code}]`, err)
    // On laisse passer : si la pré-vérif plante (rules read par ex.) on
    // tente quand même le setDoc — qui plantera proprement avec un code
    // explicite si les rules write sont aussi en cause.
  }

  // 2. Build body — types canoniques. Sentinels Firestore sur Timestamp.
  //
  // Cast `unknown as Timestamp` parce que le SDK retourne `FieldValue` pour
  // `serverTimestamp()` mais le type canonique exige `Timestamp`. Firestore
  // résout la sentinel server-side ; la valeur sera bien un Timestamp dans
  // tous les reads ultérieurs.
  const sentinel = serverTimestamp() as unknown as FieldValue & Timestamp
  const body: LicenseRequestData = {
    memberId: input.memberId,
    teamId: input.teamId,
    seasonId: input.seasonId,
    requestedBy: input.requestedByUid,
    status: 'pending_parent_docs',
    requiredDocs: input.requiredDocs,
    parentUserIds: Array.from(new Set(input.notifyUserIds)),
    uploadedDocs: {},
    foreignPlayerContext: null,
    parentSubmittedAvs: null,
    denorm: input.denorm,
    parentCompletedAt: null,
    coachValidatedAt: null,
    coachValidatedByUid: null,
    reviewedBy: null,
    reviewedAt: null,
    adminComment: null,
    createdAt: sentinel,
    // Phase trésorier (PR3-trésorier, 2026-05-24) — toujours null à la
    // création coach ; remplis au fil des transitions trésorier.
    signableDocStoragePath: null,
    signableDocUploadedAt: null,
    signableDocUploadedByUid: null,
    signedDocStoragePath: null,
    signedDocUploadedAt: null,
    signedDocUploadedByUid: null,
    formConfirmedAt: null,
    formConfirmedByUid: null,
    sentToFederationAt: null,
    paidAt: null,
    paymentProofStoragePath: null,
    paymentProofUploadedAt: null,
    licenseNumber: null,
    licenseFinalizedAt: null,
    licenseFinalizedByUid: null,
    linkedLicenseId: null,
    treasurerNotes: null,
  }

  // 3. Write (setDoc, not addDoc — ID déterministe).
  try {
    await setDoc(doc(db, LICENSE_REQUESTS, id), body)
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[licenseRequests.repo] createLicenseRequest write failed [${code}]`, err)
    throw err
  }

  // 4. Notifications — degraded (cf. docstring). Inutile d'allouer un
  // writeBatch tant qu'on ne sait pas quel doc écrire. Log unique pour
  // que le coach voie en console que la notif n'est pas partie.
  const notificationsResult = await tryWriteParentNotifications(input, id)

  return {
    requestId: id,
    alreadyExisted: false,
    notificationsWritten: notificationsResult.written,
    notificationsError: notificationsResult.error,
  }
}

/**
 * Tente d'écrire les docs `/notifications` pour les destinataires parents.
 * **Actuellement degraded** (cf. docstring de `createLicenseRequest`) :
 * loggue un `console.info` et retourne `written: 0, error: 'schema-mismatch'`.
 *
 * Conservée comme point d'extension : quand le schéma `/notifications`
 * accueillera un variant parent, remplacer le corps de cette fonction par
 * un `writeBatch` (best-effort try/catch). La signature appelante reste
 * la même.
 */
async function tryWriteParentNotifications(
  input: CreateLicenseRequestInput,
  requestId: string,
): Promise<{ written: number; error: string | null }> {
  if (input.notifyUserIds.length === 0) {
    return { written: 0, error: null }
  }

  // ─── Degraded path (PR1) ─────────────────────────────────────────
  // Le schéma `/notifications` est officials-only et les rules bloquent
  // un create coach. On loggue et on s'abstient. Voir docstring de
  // `createLicenseRequest` pour la roadmap.
  console.info(
    `[licenseRequests.repo] parent notification skipped — ${input.notifyUserIds.length} ` +
      `recipient(s) for request ${requestId}. Schéma /notifications encore officials-only ; ` +
      `voir docstring + docs/licenses/parent-completion-workflow.md.`,
  )
  // On garde l'usage symbolique de writeBatch (suppress unused warning à
  // l'avenir quand on remettra la vraie écriture) :
  void writeBatch
  void collection
  void NOTIFICATIONS
  void documentId

  return { written: 0, error: 'schema-mismatch' }
}
