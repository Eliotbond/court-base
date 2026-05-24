import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type DocumentData,
  type DocumentSnapshot,
  type FieldValue,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { FirebaseError } from 'firebase/app'
import type {
  ForeignPlayerContext,
  LicenseRequest,
  LicenseRequestData,
  Timestamp,
  UploadedDocRef,
} from '@club-app/shared-types'
import { db } from '@/services/firebase'

/**
 * Repository `LicenseRequests` — accès Firestore réel pour l'app register.
 *
 * Permissions (cf. `firestore.rules` §licenseRequests) :
 *  - **read**  : admin / coach team / linked member / guardians.
 *  - **create**: admin / coach team (côté `courtbase-app`, pas ici).
 *  - **update**: admin OU parent (linked member / guardian) avec champs
 *    scopés et transition de status verrouillée à
 *    `pending_parent_docs → parent_docs_submitted`.
 *
 * Ce module est la **seule** couche autorisée à importer le SDK Firestore
 * pour les demandes de licence côté register (cf. architecture en couches
 * `CLAUDE.md` racine §4).
 */

const LICENSE_REQUESTS = 'licenseRequests'
const IN_CHUNK = 10

/** Check robuste `permission-denied` — cf. memo `firebase-error-instanceof-unreliable`. */
function isPermissionDenied(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'permission-denied'
  )
}

function snapToLicenseRequest(
  snap: QueryDocumentSnapshot<DocumentData> | DocumentSnapshot<DocumentData>,
): LicenseRequest {
  const data = snap.data() as Partial<LicenseRequestData> | undefined
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
    createdAt: d.createdAt ?? ({ seconds: 0, nanoseconds: 0 } as Timestamp),
    // Phase trésorier (PR3-trésorier, 2026-05-24) — backward-compat null
    // pour les demandes legacy qui n'ont pas ces champs.
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

// ─── Reads ─────────────────────────────────────────────────────────────

/** Récupère une demande par ID. Retourne `null` si absent ou refusé (dégradation). */
export async function getLicenseRequestById(
  requestId: string,
): Promise<LicenseRequest | null> {
  if (!requestId) return null
  try {
    const snap = await getDoc(doc(db, LICENSE_REQUESTS, requestId))
    if (!snap.exists()) return null
    return snapToLicenseRequest(snap)
  } catch (err) {
    if (isPermissionDenied(err)) return null
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[licenseRequests.repo] getLicenseRequestById failed [${code}]`, err)
    throw err
  }
}

/**
 * Liste les `/licenseRequests` accessibles au user (linked member OU
 * guardian) en s'appuyant sur l'ancre **statiquement filtrable**
 * `parentUserIds` (posée par le coach à la création — cf.
 * `LicenseRequestData.parentUserIds` + memo `firestore-list-query-dynamic-rule`).
 *
 * Une seule query `where parentUserIds array-contains uid` :
 *  - statiquement pré-validable par les rules (la clause LIST ne dépend
 *    d'aucun `get()` dynamique côté rule) ;
 *  - couvre à la fois le linked member et les guardians (le coach inclut
 *    les deux dans `parentUserIds` à la création) ;
 *  - pas de chunking nécessaire (`array-contains` ne s'applique qu'à un
 *    seul UID — celui du caller).
 *
 * Pour les docs **legacy** (créés avant l'ajout de `parentUserIds`), un
 * fallback `where memberId in [...]` couvre les memberIds résolus via
 * `members.repo.listMyDependents` + linkedMemberId. Ce fallback peut
 * échouer en `permission-denied` côté rules (cf. memo) — dans ce cas on
 * dégrade silencieusement en `[]` pour ce chunk.
 *
 * Dédupliqué par doc.id. Tri JS `createdAt desc` (pattern simple query +
 * tri JS — cf. `CLAUDE.md` racine §10).
 */
export async function listAccessibleLicenseRequests(args: {
  uid: string
  linkedMemberId: string | null
  guardianMemberIds: readonly string[]
}): Promise<LicenseRequest[]> {
  const { uid, linkedMemberId, guardianMemberIds } = args
  const found = new Map<string, LicenseRequest>()

  // ─── 1. Query primaire — ancre parentUserIds (statiquement filtrable) ─
  if (uid) {
    try {
      const snap = await getDocs(
        query(
          collection(db, LICENSE_REQUESTS),
          where('parentUserIds', 'array-contains', uid),
        ),
      )
      for (const d of snap.docs) {
        const lr = snapToLicenseRequest(d)
        found.set(lr.id, lr)
      }
    } catch (err) {
      if (isPermissionDenied(err)) {
        console.warn('[licenseRequests.repo] parentUserIds query denied — falling back to memberId')
      } else {
        const code = err instanceof FirebaseError ? err.code : 'unknown'
        console.error(`[licenseRequests.repo] parentUserIds query failed [${code}]`, err)
        throw err
      }
    }
  }

  // ─── 2. Fallback legacy — query par memberId (chunké) ─────────────────
  // Couvre les docs créés AVANT l'ajout du champ `parentUserIds`. Peut
  // être refusée en bloc par les rules (cf. memo). On la garde quand même
  // car best-effort + idempotent (dédup par doc.id).
  const legacyMemberIds = new Set<string>()
  if (linkedMemberId) legacyMemberIds.add(linkedMemberId)
  for (const id of guardianMemberIds) legacyMemberIds.add(id)

  if (legacyMemberIds.size > 0) {
    for (const chunk of chunked(Array.from(legacyMemberIds), IN_CHUNK)) {
      try {
        const snap = await getDocs(
          query(
            collection(db, LICENSE_REQUESTS),
            where('memberId', 'in', chunk),
          ),
        )
        for (const d of snap.docs) {
          const lr = snapToLicenseRequest(d)
          // Évite d'écraser un doc déjà ramené par la query primaire.
          if (!found.has(lr.id)) found.set(lr.id, lr)
        }
      } catch (err) {
        if (isPermissionDenied(err)) {
          console.warn(
            '[licenseRequests.repo] memberId fallback chunk denied — degrading',
            chunk,
          )
          continue
        }
        const code = err instanceof FirebaseError ? err.code : 'unknown'
        console.error(
          `[licenseRequests.repo] memberId fallback failed [${code}]`,
          err,
        )
        // On rethrow PAS — la query primaire a peut-être déjà ramené ce qu'il faut.
        break
      }
    }
  }

  return Array.from(found.values()).sort((a, b) => {
    const sa = a.createdAt?.seconds ?? 0
    const sb = b.createdAt?.seconds ?? 0
    return sb - sa
  })
}

// ─── Writes (parent self-update) ──────────────────────────────────────

/**
 * Patch partiel sur `/licenseRequests/{id}` — autorisé par la rule
 * `update` parent uniquement pour les clés : `uploadedDocs`,
 * `foreignPlayerContext`, `parentSubmittedAvs`, `parentCompletedAt`, `status`.
 *
 * Le caller passe un patch typé — on l'envoie tel quel à `updateDoc`. Tout
 * champ hors-liste sera refusé côté rules (`affectedKeys().hasOnly(...)`).
 */
export type ParentLicenseRequestPatch = {
  uploadedDocs?: Partial<LicenseRequestData['uploadedDocs']>
  foreignPlayerContext?: ForeignPlayerContext | null
  parentSubmittedAvs?: string | null
}

export async function patchLicenseRequest(
  requestId: string,
  patch: ParentLicenseRequestPatch,
): Promise<void> {
  await updateDoc(doc(db, LICENSE_REQUESTS, requestId), patch)
}

/**
 * Submit final : status `pending_parent_docs → parent_docs_submitted` +
 * `parentCompletedAt = serverTimestamp()`. Une fois cette transition faite,
 * le parent ne peut plus écrire (rule scope `status == 'pending_parent_docs'`).
 *
 * Sentinel `serverTimestamp()` casté en Timestamp : Firestore résout
 * server-side, les reads suivants verront un vrai Timestamp.
 */
export async function submitLicenseRequestDocs(requestId: string): Promise<void> {
  const sentinel = serverTimestamp() as unknown as FieldValue & Timestamp
  await updateDoc(doc(db, LICENSE_REQUESTS, requestId), {
    status: 'parent_docs_submitted',
    parentCompletedAt: sentinel,
  })
}

/**
 * Upsert d'un fichier uploadé dans `uploadedDocs[kind]`. Utilise un patch
 * scopé `uploadedDocs: { [kind]: ref }` — Firestore merge naturellement avec
 * `updateDoc` (les autres clés de la map sont préservées).
 *
 * NB : `updateDoc` avec un objet imbriqué REMPLACE la valeur sous la clé
 * top-level ; pour un merge fin, on doit utiliser la dot-notation
 * `'uploadedDocs.id_front'`. C'est ce qu'on fait ici.
 */
export async function setUploadedDoc(
  requestId: string,
  kind: keyof LicenseRequestData['uploadedDocs'],
  ref: UploadedDocRef,
): Promise<void> {
  await updateDoc(doc(db, LICENSE_REQUESTS, requestId), {
    [`uploadedDocs.${kind}`]: ref,
  })
}

/**
 * Supprime une entrée `uploadedDocs[kind]` (cas remove côté UI). On pose
 * explicitement `null` plutôt que `deleteField()` pour rester compatible
 * avec la rule `affectedKeys().hasOnly([...])` qui inclut `uploadedDocs`.
 */
export async function clearUploadedDoc(
  requestId: string,
  kind: keyof LicenseRequestData['uploadedDocs'],
): Promise<void> {
  await updateDoc(doc(db, LICENSE_REQUESTS, requestId), {
    [`uploadedDocs.${kind}`]: null,
  })
}

/**
 * Pose le PDF signé par le parent + transition `awaiting_parent_signature
 * → parent_signed`. Autorisé par la rule parent (linked member / guardian /
 * UID dans `parentUserIds`) avec affectedKeys scopé à
 * `[status, signedDocStoragePath, signedDocUploadedAt, signedDocUploadedByUid]`.
 */
export async function setSignedLicenseDoc(
  requestId: string,
  storagePath: string,
  uid: string,
): Promise<void> {
  const sentinel = serverTimestamp() as unknown as FieldValue & Timestamp
  try {
    await updateDoc(doc(db, LICENSE_REQUESTS, requestId), {
      signedDocStoragePath: storagePath,
      signedDocUploadedAt: sentinel,
      signedDocUploadedByUid: uid,
      status: 'parent_signed',
    })
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[licenseRequests.repo] setSignedLicenseDoc failed [${code}]`, err)
    throw err
  }
}
