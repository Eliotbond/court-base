import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { FirebaseError } from 'firebase/app'
import {
  deleteLicenseRequest,
  getLicenseRequest,
  listAllLicenseRequests,
  licenseRequestIsTerminal,
  uploadPaymentProof,
  uploadSignableDoc,
} from '@/repositories/licenseRequests.repo'
import { auth as firebaseAuth } from '@/services/firebase'
import {
  treasurerConfirmSignedDoc,
  treasurerFinalizeLicense,
  treasurerMarkSentAndPaid,
  treasurerReviewLicenseDoc,
  treasurerUploadSignableDoc,
  validateLicenseRequest,
  type TreasurerReviewLicenseDocOutput,
  type ValidateLicenseRequestOutput,
} from '@/services/cloudFunctions'
import type {
  LicenseDocKind,
  LicenseRequest,
  LicenseRequestStatus,
  TreasurerConfirmSignedDocResult,
  TreasurerFinalizeLicenseResult,
  TreasurerMarkSentAndPaidResult,
  TreasurerUploadSignableDocResult,
} from '@club-app/shared-types'
import { useAuthStore } from './auth'

/**
 * Filtre statut pour les chips au-dessus du tableau. `all` désactive le
 * filtre — on affiche toutes les demandes visibles par le caller (scope
 * géré côté rules selon le rôle). Les autres valeurs matchent 1:1 le
 * `LicenseRequestStatus` du schéma (y compris la valeur legacy `'pending'`
 * pour les docs antérieurs au workflow 4-étapes).
 */
export type LicenseRequestStatusFilter = 'all' | LicenseRequestStatus

/**
 * Compteurs par statut + total. Tous les statuts canoniques sont énumérés
 * (incl. `pending` legacy) pour que l'UI puisse afficher une valeur stable
 * sans test d'existence.
 */
export type LicenseRequestCounts = Record<LicenseRequestStatus, number> & {
  all: number
}

/**
 * Normalise une chaîne pour comparaison insensible à la casse + sans accent.
 * Pattern aligné sur `apps/courtbase-app/src/stores/teams.ts` (`normalize`).
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/**
 * Source unique pour le tab "Demandes en cours" de la page `/licenses`.
 *
 * Architecture en couches : la vue ne lit JAMAIS le repo directement, et le
 * repo est le SEUL à importer le SDK Firebase (cf. apps/web/CLAUDE.md).
 *
 * Cache court : `load()` est idempotent par défaut (re-appel = no-op si la
 * liste est déjà chargée et non en erreur) — utiliser `load(true)` pour
 * forcer le re-fetch après une mutation externe. Pas de mutation côté tab
 * (lecture only) ; les transitions de statut sont gérées par d'autres
 * surfaces (coach review en PR2, treasurer review en PR3).
 *
 * Filtres UI (combinables, tous JS-only — `load()` ne refilte pas) :
 *  - `statusFilter` : chip `all | <LicenseRequestStatus>`.
 *  - `search` : normalisé (lowercase + accent strip), match substring sur
 *    `denorm.memberFirstName`, `denorm.memberLastName`, `denorm.teamName`,
 *    `denorm.coachName`. Si `denorm` est `null` (cas légitime selon le
 *    schéma), la demande sort des résultats search dès qu'une query est
 *    posée — voulu pour ne pas polluer la liste filtrée avec des entrées
 *    non-identifiables.
 */
export const useLicenseRequestsStore = defineStore('licenseRequests', () => {
  const auth = useAuthStore()

  // ─── State ─────────────────────────────────────────────────────────
  const requests = ref<LicenseRequest[]>([])
  const loading = ref(false)
  /** `null` = nominal, sinon code `FirebaseError.code` (ou `'unknown'`). */
  const error = ref<string | null>(null)
  const statusFilter = ref<LicenseRequestStatusFilter>('all')
  const search = ref('')

  /**
   * Marqueur "déjà chargé avec succès au moins une fois" — sert au cache
   * court de `load()` (pas de re-fetch automatique au switch d'onglet).
   */
  const loaded = ref(false)

  /** Id de la demande dont une action serveur est en cours. `null` = idle. */
  const actionPendingId = ref<string | null>(null)

  /** Vrai si le caller peut gérer (= supprimer) toutes les demandes. */
  const isAdminScope = computed<boolean>(() => {
    if (auth.rootAdmin) return true
    return auth.roles.includes('admin')
  })

  // ─── Actions ───────────────────────────────────────────────────────

  /**
   * Charge toutes les demandes. Idempotent par défaut — un second appel
   * sans `force` est no-op si la liste a déjà été chargée avec succès.
   * Catch enrichi obligatoire (cf. apps/web/CLAUDE.md).
   */
  async function load(force = false): Promise<void> {
    if (loading.value) return
    if (loaded.value && !force) return
    loading.value = true
    error.value = null
    try {
      requests.value = await listAllLicenseRequests()
      loaded.value = true
    } catch (err: unknown) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`licenseRequests.load failed [${code}]`, err)
      error.value = code
    } finally {
      loading.value = false
    }
  }

  function setStatusFilter(v: LicenseRequestStatusFilter): void {
    statusFilter.value = v
  }

  function setSearch(v: string): void {
    search.value = v
  }

  function resetFilters(): void {
    statusFilter.value = 'all'
    search.value = ''
  }

  /**
   * Charge une demande seule par id (vue détail trésorier). Pose le doc en
   * cache `requests` (remplace l'entrée existante par id, sinon append) pour
   * que les composants qui lisent `requests` ou `filtered` voient l'update.
   *
   * Retourne le `LicenseRequest` chargé (ou `null` si introuvable /
   * permission-denied) — l'UI peut afficher un not-found gracieux.
   * Catch enrichi obligatoire (cf. apps/web/CLAUDE.md).
   */
  async function loadOne(id: string): Promise<LicenseRequest | null> {
    error.value = null
    try {
      const req = await getLicenseRequest(id)
      if (!req) return null
      const idx = requests.value.findIndex((r) => r.id === req.id)
      if (idx >= 0) {
        requests.value.splice(idx, 1, req)
      } else {
        requests.value = [req, ...requests.value]
      }
      return req
    } catch (err: unknown) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`licenseRequests.loadOne failed [${code}]`, err)
      error.value = code
      return null
    }
  }

  /**
   * Pose une review trésorier sur un document précis d'une demande
   * (`treasurerReviewLicenseDoc`). Sur succès, recharge la demande pour
   * synchroniser les changements de status (`refus` → reset complet) et la
   * review per-doc côté UI. Retourne le wrapper output (`null` si échec).
   */
  async function treasurerReview(payload: {
    requestId: string
    kind: LicenseDocKind
    decision: 'accept' | 'refuse'
    refusalReason?: string
  }): Promise<TreasurerReviewLicenseDocOutput | null> {
    actionPendingId.value = payload.requestId
    error.value = null
    try {
      const res = await treasurerReviewLicenseDoc(payload)
      // Reload pour que `uploadedDocs.{kind}.treasurerReview` + status
      // soient à jour dans le cache local (pas de patch local — la review
      // pose plusieurs champs corrélés, simpler de relire).
      await loadOne(payload.requestId)
      return res
    } catch (err: unknown) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`licenseRequests.treasurerReview failed [${code}]`, err)
      error.value = code
      return null
    } finally {
      actionPendingId.value = null
    }
  }

  /**
   * Décision finale du trésorier sur une demande (`validateLicenseRequest`).
   * Approve crée une `/licenses/{id}` `pending` ; reject pose simplement le
   * status. Sur succès, recharge la demande pour synchroniser le status local.
   */
  async function validate(payload: {
    requestId: string
    decision: 'approve' | 'reject'
    comment?: string
  }): Promise<ValidateLicenseRequestOutput | null> {
    actionPendingId.value = payload.requestId
    error.value = null
    try {
      const res = await validateLicenseRequest(payload)
      await loadOne(payload.requestId)
      return res
    } catch (err: unknown) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`licenseRequests.validate failed [${code}]`, err)
      error.value = code
      return null
    } finally {
      actionPendingId.value = null
    }
  }

  /**
   * Résout l'uid Firebase Auth du caller (= trésorier) pour les uploads
   * Storage côté actions trésorier ci-dessous. Throw plutôt que renvoyer
   * `null` : si on n'a pas d'uid signed-in, on ne peut pas continuer (les
   * callables échoueraient en `unauthenticated` de toute façon).
   */
  function requireCallerUid(): string {
    const uid = firebaseAuth.currentUser?.uid
    if (!uid) {
      throw new Error('Trésorier non authentifié — action impossible.')
    }
    return uid
  }

  // =====================================================================
  // Phase trésorier (PR3-trésorier, 2026-05-24)
  // ---------------------------------------------------------------------
  // Pattern uniforme pour les 4 actions ci-dessous :
  //   1. `actionPendingId = requestId` (gate UI globale).
  //   2. (optionnel) upload Storage côté `storage.rules` pour le caller uid.
  //   3. Appel callable (treasurer* dans services/cloudFunctions.ts).
  //   4. `loadOne(requestId)` pour synchroniser le doc local (transition de
  //      statut + champs trésorier corrélés).
  //   5. Catch enrichi `FirebaseError` + log + retour `null` (le composant
  //      lit `error.value` pour afficher un banner).
  //
  // Pas d'optimistic update : la transition pose 3-5 champs corrélés
  // (`signableDocUploadedAt`, `signableDocUploadedByUid`, `status`, …) — plus
  // simple et plus sûr de relire le doc après succès. Coût acceptable : un
  // seul read Firestore par action, volumétrie minuscule.
  // =====================================================================

  /**
   * Étape 2 — Trésorier uploade le formulaire fédéral pré-rempli ("signable
   * doc"). Path Storage : `licenseRequests/{callerUid}/{requestId}/signable.pdf`.
   * Transition : `coach_validated → awaiting_parent_signature`.
   *
   * Le composant doit avoir gaté l'appel sur `status === 'coach_validated'` et
   * sur le rôle trésorier — mais les rules + la callable serveur enforce
   * également.
   */
  async function uploadSignableDocAction(
    requestId: string,
    file: File,
  ): Promise<TreasurerUploadSignableDocResult | null> {
    actionPendingId.value = requestId
    error.value = null
    try {
      const callerUid = requireCallerUid()
      const upload = await uploadSignableDoc(requestId, callerUid, file)
      const res = await treasurerUploadSignableDoc({
        requestId,
        storagePath: upload.storagePath,
        fileName: upload.fileName,
        sizeBytes: upload.sizeBytes,
        contentType: upload.contentType,
      })
      await loadOne(requestId)
      return res
    } catch (err: unknown) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(
        `licenseRequests.uploadSignableDocAction failed [${code}]`,
        err,
      )
      error.value = code
      return null
    } finally {
      actionPendingId.value = null
    }
  }

  /**
   * Étape 3 — Trésorier valide la conformité du doc signé re-uploadé par le
   * parent. Transition : `parent_signed → form_confirmed`. `notes` optionnel
   * (alimente `treasurerNotes`).
   *
   * Pas d'upload Storage — le doc signé est déjà sur Storage (uploadé par le
   * parent côté `courtbase-register`).
   */
  async function confirmSignedDocAction(
    requestId: string,
    notes: string | null,
  ): Promise<TreasurerConfirmSignedDocResult | null> {
    actionPendingId.value = requestId
    error.value = null
    try {
      const res = await treasurerConfirmSignedDoc({ requestId, notes })
      await loadOne(requestId)
      return res
    } catch (err: unknown) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(
        `licenseRequests.confirmSignedDocAction failed [${code}]`,
        err,
      )
      error.value = code
      return null
    } finally {
      actionPendingId.value = null
    }
  }

  /**
   * Étape 4 — Trésorier marque la demande "envoyée fédération + payée".
   * Transition : `form_confirmed → sent_paid`. Crée une `/licenses/{id}` en
   * `status: 'pending'` (utilisable par le coach immédiatement). La preuve
   * de paiement est optionnelle — peut être re-uploadée plus tard via cette
   * même action si elle arrive après l'envoi (workflow async).
   */
  async function markSentAndPaidAction(
    requestId: string,
    proofFile: File | null,
  ): Promise<TreasurerMarkSentAndPaidResult | null> {
    actionPendingId.value = requestId
    error.value = null
    try {
      let paymentProofStoragePath: string | null = null
      if (proofFile) {
        const callerUid = requireCallerUid()
        const upload = await uploadPaymentProof(requestId, callerUid, proofFile)
        paymentProofStoragePath = upload.storagePath
      }
      const res = await treasurerMarkSentAndPaid({
        requestId,
        paymentProofStoragePath,
      })
      await loadOne(requestId)
      return res
    } catch (err: unknown) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(
        `licenseRequests.markSentAndPaidAction failed [${code}]`,
        err,
      )
      error.value = code
      return null
    } finally {
      actionPendingId.value = null
    }
  }

  /**
   * Étape 5 — Trésorier saisit le numéro de licence reçu de la fédération.
   * Transition : `sent_paid → approved`. Côté serveur, `/licenses/{id}` passe
   * `pending → active` via `confirmLicense` (qui poste l'écriture comptable
   * + dénormalise `member.officialLicense / coachLicense`).
   */
  async function finalizeLicenseAction(
    requestId: string,
    licenseNumber: string,
  ): Promise<TreasurerFinalizeLicenseResult | null> {
    actionPendingId.value = requestId
    error.value = null
    try {
      const res = await treasurerFinalizeLicense({ requestId, licenseNumber })
      await loadOne(requestId)
      return res
    } catch (err: unknown) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(
        `licenseRequests.finalizeLicenseAction failed [${code}]`,
        err,
      )
      error.value = code
      return null
    } finally {
      actionPendingId.value = null
    }
  }

  /**
   * Supprime définitivement une `/licenseRequests/{id}` (admin / rootAdmin
   * uniquement, gating par rules). Destiné aux demandes "en cours" — l'UI
   * gate l'affichage du bouton sur les statuts non-terminaux et confirme via
   * dialog type-to-confirm. Patch local pour éviter un re-fetch.
   * Retourne `true` si succès, `false` si erreur (le code est posé dans
   * `error.value`).
   */
  async function remove(id: string): Promise<boolean> {
    actionPendingId.value = id
    error.value = null
    try {
      await deleteLicenseRequest(id)
      requests.value = requests.value.filter((r) => r.id !== id)
      return true
    } catch (err: unknown) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`licenseRequests.remove failed [${code}]`, err)
      error.value = code
      return false
    } finally {
      actionPendingId.value = null
    }
  }

  // ─── Getters ───────────────────────────────────────────────────────

  /**
   * Compteurs par statut (tous les statuts canoniques + total). Calculé sur
   * `requests` brut — n'est PAS influencé par les filtres (les chips
   * affichent toujours le compte total par statut).
   */
  const countsByStatus = computed<LicenseRequestCounts>(() => {
    const counts: LicenseRequestCounts = {
      all: requests.value.length,
      pending: 0,
      pending_parent_docs: 0,
      parent_docs_submitted: 0,
      coach_validated: 0,
      // Phase trésorier (PR3-trésorier, 2026-05-24)
      awaiting_parent_signature: 0,
      parent_signed: 0,
      form_confirmed: 0,
      sent_paid: 0,
      approved: 0,
      rejected: 0,
    }
    for (const r of requests.value) {
      counts[r.status] += 1
    }
    return counts
  })

  /**
   * Map id → demande (cache lecture pour la vue détail). Recalculé à chaque
   * mutation de `requests` — taille attendue petite (quelques centaines max).
   */
  const byId = computed<Map<string, LicenseRequest>>(() => {
    const m = new Map<string, LicenseRequest>()
    for (const r of requests.value) m.set(r.id, r)
    return m
  })

  /**
   * Statuts pour lesquels le trésorier (ou admin/secretary) a une action
   * concrète à mener — alimente l'onglet "À traiter" de `/license-requests`.
   *
   * Inclus :
   *  - `coach_validated`         → uploader le doc à signer.
   *  - `parent_signed`           → valider la conformité du doc signé.
   *  - `form_confirmed`          → marquer envoyé + payé.
   *  - `sent_paid`               → finaliser avec le numéro de licence.
   *
   * Exclu volontairement :
   *  - `awaiting_parent_signature` (on attend le parent — staff inactif).
   *  - `pending_parent_docs` / `parent_docs_submitted` (phase coach).
   *  - `pending` legacy (pas dans le workflow 4-étapes).
   *  - `approved` / `rejected` (terminaux).
   *
   * NB : à conserver synchronisé avec la gate UI dans
   * `LicenseRequestReview.vue` (boutons per-doc + actions section trésorier).
   */
  const TREASURER_ACTIONABLE_STATUSES: readonly LicenseRequestStatus[] = [
    'coach_validated',
    'parent_signed',
    'form_confirmed',
    'sent_paid',
  ] as const

  /**
   * Demandes pour lesquelles le staff trésorier (treasurer / admin /
   * secretary / rootAdmin) a une action en attente. Onglet "À traiter" de
   * `/license-requests`. Cf. `TREASURER_ACTIONABLE_STATUSES` ci-dessus pour
   * l'union précise des statuts couverts.
   */
  const pendingTreasurer = computed<LicenseRequest[]>(() =>
    requests.value.filter((r) =>
      TREASURER_ACTIONABLE_STATUSES.includes(r.status),
    ),
  )

  /**
   * Toutes les demandes non-terminales (statuts `pending_parent_docs`,
   * `parent_docs_submitted`, `coach_validated`, et legacy `pending`).
   * Onglet "Toutes en cours" de `/license-requests`.
   */
  const allActive = computed<LicenseRequest[]>(() =>
    requests.value.filter((r) => !licenseRequestIsTerminal(r.status)),
  )

  /**
   * Demandes dans la phase trésorier active (entre `coach_validated` et la
   * licence finalisée). Permet aux chips de filtre de la page liste de
   * surfacer rapidement le pipeline trésorier sans agréger les statuts un
   * par un côté composant.
   */
  const pendingTreasurerPhase = computed<LicenseRequest[]>(() =>
    requests.value.filter((r) =>
      [
        'awaiting_parent_signature',
        'parent_signed',
        'form_confirmed',
        'sent_paid',
      ].includes(r.status),
    ),
  )

  /**
   * Liste filtrée par statut + recherche, conserve l'ordre `createdAt`
   * desc déjà appliqué côté repo. La recherche est strict-match sur les
   * champs `denorm.*` (cf. doc du store) ; les demandes sans `denorm`
   * sortent des résultats dès qu'une query est posée.
   */
  const filtered = computed<LicenseRequest[]>(() => {
    const status = statusFilter.value
    const q = normalize(search.value.trim())
    return requests.value.filter((r) => {
      if (status !== 'all' && r.status !== status) return false
      if (q.length === 0) return true
      const d = r.denorm
      if (!d) return false
      const haystack = [
        d.memberFirstName,
        d.memberLastName,
        d.teamName,
        d.coachName,
      ]
        .map((s) => normalize(s ?? ''))
        .join(' ')
      return haystack.includes(q)
    })
  })

  return {
    // state
    requests,
    loading,
    error,
    statusFilter,
    search,
    actionPendingId,
    // actions
    load,
    loadOne,
    setStatusFilter,
    setSearch,
    resetFilters,
    remove,
    treasurerReview,
    validate,
    // actions — phase trésorier (PR3-trésorier)
    uploadSignableDoc: uploadSignableDocAction,
    confirmSignedDoc: confirmSignedDocAction,
    markSentAndPaid: markSentAndPaidAction,
    finalizeLicense: finalizeLicenseAction,
    // getters
    isAdminScope,
    countsByStatus,
    filtered,
    byId,
    pendingTreasurer,
    pendingTreasurerPhase,
    allActive,
  }
})
