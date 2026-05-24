import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { FirebaseError } from 'firebase/app'
import type {
  ForeignPlayerContext,
  LicenseDocKind,
  LicenseRequest,
  UploadedDocRef,
} from '@club-app/shared-types'
import {
  clearUploadedDoc,
  getLicenseRequestById,
  listAccessibleLicenseRequests,
  patchLicenseRequest,
  setSignedLicenseDoc,
  setUploadedDoc,
  submitLicenseRequestDocs,
} from '@/repositories/licenseRequests.repo'
import { listMyDependents } from '@/repositories/members.repo'
import {
  getStorageUrl,
  uploadLicenseDocument,
  uploadSignedLicenseDoc,
  type UploadResult,
} from '@/repositories/storage'

/**
 * Store "demandes de licence parent" — Firestore réel.
 *
 * Surface :
 *  - `loadMyRequests(uid, linkedMemberId)` — résout les dépendants (members
 *    dont le user est tuteur) puis liste les `/licenseRequests` accessibles.
 *  - `loadRequest(id)` — fetch single doc + bascule `currentRequest`.
 *  - `uploadDoc({ requestId, kind, file, uid })` — upload Storage + patch
 *    `uploadedDocs[kind]` Firestore.
 *  - `removeUploadedDoc(requestId, kind)` — clear `uploadedDocs[kind]` (le
 *    fichier Storage reste, sera écrasé au prochain upload même path).
 *  - `setForeignContext(requestId, ctx)` — patch `foreignPlayerContext`.
 *  - `setParentAvs(requestId, avs)` — patch `parentSubmittedAvs`.
 *  - `submitRequest(requestId)` — transition `pending_parent_docs →
 *    parent_docs_submitted`.
 *
 * Tous les writes suivent le pattern catch enrichi (cf. `CLAUDE.md` register
 * §"Catch enrichi obligatoire").
 */
export const useLicenseRequestsStore = defineStore('licenseRequests', () => {
  const requests = ref<LicenseRequest[]>([])
  const currentRequest = ref<LicenseRequest | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** True pendant un upload Storage en cours (UI peut disable les autres tiles). */
  const uploadingKind = ref<LicenseDocKind | null>(null)

  /** True si au moins une request est en attente de docs parent. */
  const hasPending = computed(() =>
    requests.value.some((r) => r.status === 'pending_parent_docs'),
  )

  /** Liste filtrée des requests "à compléter" — utilisée par le banner Home. */
  const pendingRequests = computed(() =>
    requests.value.filter((r) => r.status === 'pending_parent_docs'),
  )

  /**
   * `true` si la demande pointée porte au moins un document refusé par le
   * coach OU le trésorier (sur `uploadedDocs[*].coachReview.decision ===
   * 'refused'` ou `treasurerReview.decision === 'refused'`). Utilisé par la
   * vue parent pour afficher un banner "des documents nécessitent votre
   * attention" et bloquer la soumission tant qu'ils ne sont pas re-uploadés.
   */
  function hasRefusedDocs(requestId: string): boolean {
    return refusedDocsKinds(requestId).length > 0
  }

  /**
   * Liste des `LicenseDocKind` portant une review `refused` (coach OU
   * trésorier) sur la demande pointée. Utilisé par la vue parent pour le
   * scroll-to des sections concernées et pour driver le bouton submit.
   */
  function refusedDocsKinds(requestId: string): LicenseDocKind[] {
    const r =
      requests.value.find((x) => x.id === requestId) ??
      (currentRequest.value?.id === requestId ? currentRequest.value : null)
    if (!r) return []
    const out: LicenseDocKind[] = []
    for (const kind of r.requiredDocs) {
      const ref = r.uploadedDocs[kind]
      if (!ref) continue
      if (
        ref.coachReview?.decision === 'refused' ||
        ref.treasurerReview?.decision === 'refused'
      ) {
        out.push(kind)
      }
    }
    return out
  }

  function replaceInCache(updated: LicenseRequest): void {
    const idx = requests.value.findIndex((r) => r.id === updated.id)
    if (idx >= 0) {
      requests.value[idx] = updated
    } else {
      requests.value.push(updated)
    }
    if (currentRequest.value?.id === updated.id) {
      currentRequest.value = updated
    }
  }

  /**
   * Charge toutes les demandes accessibles au user (self linked + pupilles).
   *
   * Résolution dépendants : `listMyDependents(uid)` → array-contains sur
   * `guardianUserIds`. Les `permission-denied` éventuels sont dégradés en
   * listes vides (cf. pattern défensif `register-dues-defensive-layers`).
   */
  async function loadMyRequests(
    uid: string,
    linkedMemberId: string | null,
  ): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const dependents = await listMyDependents(uid)
      const guardianMemberIds = dependents.map((m) => m.id)
      const out = await listAccessibleLicenseRequests({
        uid,
        linkedMemberId,
        guardianMemberIds,
      })
      requests.value = out
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`[licenseRequests.store] loadMyRequests failed [${code}]`, err)
      // Dégradation silencieuse côté Home : pas de banner si pas de demande.
      requests.value = []
    } finally {
      loading.value = false
    }
  }

  /**
   * Charge une demande spécifique dans `currentRequest`. Si elle est déjà
   * dans le cache, on la prend de là (évite un round-trip). Sinon fetch
   * direct via `getLicenseRequestById`.
   */
  async function loadRequest(requestId: string): Promise<LicenseRequest | null> {
    if (!requestId) {
      currentRequest.value = null
      return null
    }
    const cached = requests.value.find((r) => r.id === requestId)
    if (cached) {
      currentRequest.value = cached
      return cached
    }
    try {
      const fresh = await getLicenseRequestById(requestId)
      currentRequest.value = fresh
      if (fresh) replaceInCache(fresh)
      return fresh
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`[licenseRequests.store] loadRequest failed [${code}]`, err)
      currentRequest.value = null
      return null
    }
  }

  /**
   * Upload un fichier dans Storage puis patche `uploadedDocs[kind]` en
   * Firestore. Le `UploadedDocRef` posé porte `storagePath` (pas l'URL
   * signée — résolue on-demand pour le preview cf. `getStorageUrl`).
   *
   * Erreurs : on rethrow pour que l'UI bascule en état `refused` avec le
   * code Firebase. Le caller log déjà l'erreur (toast / console).
   */
  async function uploadDoc(args: {
    requestId: string
    kind: LicenseDocKind
    file: File
    uid: string
  }): Promise<UploadResult> {
    const { requestId, kind, file, uid } = args
    uploadingKind.value = kind
    try {
      const up = await uploadLicenseDocument({ uid, requestId, kind, file })
      const ref: UploadedDocRef = {
        storagePath: up.storagePath,
        fileName: file.name,
        sizeBytes: up.size,
        contentType: up.contentType,
        // Sentinel structurel — sera résolu côté serveur si on passait par un
        // `serverTimestamp()`, mais on a un updateDoc en flat key. Pour rester
        // simple : on pose la valeur côté client (UploadedDocRef interne).
        uploadedAt: nowTimestamp(),
        // Re-upload = reset complet du cycle de review (PR2/PR3). Le doc
        // repart de zéro côté coach et trésorier.
        coachReview: null,
        treasurerReview: null,
      }
      await setUploadedDoc(requestId, kind, ref)
      // Mise à jour optimiste du cache.
      const current = currentRequest.value
      if (current && current.id === requestId) {
        const updated: LicenseRequest = {
          ...current,
          uploadedDocs: { ...current.uploadedDocs, [kind]: ref },
        }
        replaceInCache(updated)
      }
      return up
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`[licenseRequests.store] uploadDoc(${kind}) failed [${code}]`, err)
      throw err
    } finally {
      uploadingKind.value = null
    }
  }

  /** Supprime l'entrée Firestore (le blob Storage reste, écrasé au re-upload). */
  async function removeUploadedDoc(
    requestId: string,
    kind: LicenseDocKind,
  ): Promise<void> {
    try {
      await clearUploadedDoc(requestId, kind)
      const current = currentRequest.value
      if (current && current.id === requestId) {
        const next = { ...current.uploadedDocs }
        delete next[kind]
        const updated: LicenseRequest = { ...current, uploadedDocs: next }
        replaceInCache(updated)
      }
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`[licenseRequests.store] removeUploadedDoc(${kind}) failed [${code}]`, err)
      throw err
    }
  }

  async function setForeignContext(
    requestId: string,
    ctx: ForeignPlayerContext | null,
  ): Promise<void> {
    try {
      await patchLicenseRequest(requestId, { foreignPlayerContext: ctx })
      const current = currentRequest.value
      if (current && current.id === requestId) {
        replaceInCache({ ...current, foreignPlayerContext: ctx })
      }
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`[licenseRequests.store] setForeignContext failed [${code}]`, err)
      throw err
    }
  }

  async function setParentAvs(
    requestId: string,
    avs: string | null,
  ): Promise<void> {
    try {
      await patchLicenseRequest(requestId, { parentSubmittedAvs: avs })
      const current = currentRequest.value
      if (current && current.id === requestId) {
        replaceInCache({ ...current, parentSubmittedAvs: avs })
      }
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`[licenseRequests.store] setParentAvs failed [${code}]`, err)
      throw err
    }
  }

  /**
   * Bascule status `pending_parent_docs → parent_docs_submitted` +
   * `parentCompletedAt = serverTimestamp()`.
   *
   * Idempotent : si la request est déjà submitted, ne fait rien. Sinon,
   * met à jour Firestore puis recharge le doc pour récupérer le vrai
   * Timestamp serveur (pas de cast bidon côté client).
   */
  async function submitRequest(requestId: string): Promise<LicenseRequest | null> {
    const current =
      requests.value.find((r) => r.id === requestId) ?? currentRequest.value
    if (current && current.status === 'parent_docs_submitted') {
      return current
    }
    try {
      await submitLicenseRequestDocs(requestId)
      const fresh = await getLicenseRequestById(requestId)
      if (fresh) {
        currentRequest.value = fresh
        replaceInCache(fresh)
      }
      return fresh
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`[licenseRequests.store] submitRequest failed [${code}]`, err)
      throw err
    }
  }

  /**
   * Phase trésorier — upload du PDF signé par le parent + transition
   * `awaiting_parent_signature → parent_signed`. Une fois fait, le parent
   * n'a plus d'action à faire jusqu'à finalisation par le trésorier.
   */
  async function uploadSignedDoc(opts: {
    requestId: string
    file: File
    uid: string
  }): Promise<void> {
    const { requestId, file, uid } = opts
    try {
      const up = await uploadSignedLicenseDoc({ uid, requestId, file })
      await setSignedLicenseDoc(requestId, up.storagePath, uid)
      // Refetch pour récupérer le vrai serverTimestamp + status server-side.
      const fresh = await getLicenseRequestById(requestId)
      if (fresh) {
        currentRequest.value = fresh
        replaceInCache(fresh)
      }
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`[licenseRequests.store] uploadSignedDoc failed [${code}]`, err)
      throw err
    }
  }

  /** Résout l'URL signée d'un fichier Storage (preview UI on-demand). */
  function resolveStorageUrl(storagePath: string): Promise<string> {
    return getStorageUrl(storagePath)
  }

  /** Reset interne — utile pour la déconnexion. */
  function reset(): void {
    requests.value = []
    currentRequest.value = null
    loading.value = false
    error.value = null
    uploadingKind.value = null
  }

  return {
    // state
    requests,
    currentRequest,
    loading,
    error,
    uploadingKind,
    // computed
    hasPending,
    pendingRequests,
    // getters
    hasRefusedDocs,
    refusedDocsKinds,
    // actions
    loadMyRequests,
    loadRequest,
    uploadDoc,
    removeUploadedDoc,
    setForeignContext,
    setParentAvs,
    submitRequest,
    uploadSignedDoc,
    resolveStorageUrl,
    reset,
  }
})

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Timestamp structurel "now" — pour les champs imbriqués où on ne peut pas
 * passer `serverTimestamp()` (le sentinel ne fonctionne qu'au niveau
 * top-level d'un `set` / `update`). L'écart serveur/client reste < 1s en
 * pratique ; aucune logique métier ne dépend de la précision sub-seconde.
 */
function nowTimestamp(): { seconds: number; nanoseconds: number } {
  const ms = Date.now()
  return {
    seconds: Math.floor(ms / 1000),
    nanoseconds: (ms % 1000) * 1_000_000,
  }
}
