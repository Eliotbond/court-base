/**
 * Store LicenseRequests — Demandes de licence fédérale (coach).
 *
 * Hybride mock + Firestore réel (cf. pattern `apps/courtbase-app/CLAUDE.md`
 * + mémoire `courtbase_app_firestore_wiring`) :
 *  - **Firestore réel** quand `auth.userDoc.memberId` existe (coach lié à
 *    un member, donc capable d'écrire `/licenseRequests` via les rules
 *    `isCoach() && teamId in userDoc().teamIds`).
 *  - **Mock fallback** sinon (compte dev sans memberId réel), via les
 *    fixtures partagées `MOCK_LICENSE_REQUESTS`.
 *
 * Le contrat public (state + actions + getters) est identique dans les
 * deux modes — `source: 'firestore' | 'mock'` permet à l'UI d'adapter
 * libellés / badges si besoin.
 *
 * **Quand on retirera le mock** : supprimer les fonctions `create` /
 * `getById` / `listForMember` legacy + l'import `MOCK_*`.
 */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import {
  MOCK_LICENSE_REQUESTS,
  inferRequiredDocs,
  type LicenseDocKind,
  type LicenseRequest,
  type LicenseRequestMock,
  type LicenseRequestStatus,
  type UploadedDocRef,
} from '@club-app/shared-types'

import { useActiveSeason } from '@/composables/useSeason'
import { useAuthStore } from '@/stores/auth'
import { useTeamsStore } from '@/stores/teams'
import {
  getLicenseRequestById,
  listLicenseRequestsForMember,
} from '@/repositories/mock/licenseRequests'
import { logMockAction, getMember, getTeam } from '@/repositories/mock'
import {
  createLicenseRequest,
  getLicenseRequest,
  listLicenseRequestsByMembers,
  listLicenseRequestsForCoach,
} from '@/repositories/licenseRequests.repo'
import {
  coachReviewLicenseDoc,
  type CoachReviewLicenseDocResult,
} from '@/services/cloudFunctions'

// ─── Types ────────────────────────────────────────────────────────────

/**
 * Représentation légère d'une demande pour la consommation UI (TeamRoster
 * bascule "déjà en cours", MemberDetail dialog). Subset stable du
 * `LicenseRequestData` canonique — pas de Timestamp exposé en dehors du
 * store (consommateurs travaillent avec `createdAtMs` epoch ms).
 */
export interface LicenseRequestRef {
  requestId: string
  memberId: string
  teamId: string
  status: LicenseRequestStatus
  requiredDocs: LicenseDocKind[]
  /** epoch ms — `Date.now()` côté store, `Timestamp.toMillis()` côté Firestore. */
  createdAtMs: number
}

export type LicenseRequestSource = 'firestore' | 'mock'

/** Input legacy (mock-only) — conservé pour les vues showcase /_design. */
export interface CreateLicenseRequestMockInput {
  memberId: string
  /** Pour un membre multi-équipes, l'équipe au nom de laquelle on demande. */
  teamId: string | undefined
  requiredDocs: LicenseDocKind[]
}

export interface CreateLicenseRequestMockResult {
  ok: true
  /** Id artificiel pour le toast — pas un vrai id Firestore. */
  mockId: string
}

/** Mapping `LicenseDocKind` → libellé humain (faux email mock). */
const DOC_LABELS: Record<LicenseDocKind, string> = {
  id_front: "Carte d'identité (recto)",
  id_back: "Carte d'identité (verso)",
  avs: 'Numéro AVS',
  transfer_letter_swiss: 'Lettre de sortie du club précédent',
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** Coerce un Timestamp Firestore (ou structurel) en epoch ms. */
function tsToMs(ts: unknown): number {
  if (!ts) return 0
  const t = ts as { seconds?: number; toMillis?: () => number }
  if (typeof t.toMillis === 'function') return t.toMillis()
  if (typeof t.seconds === 'number') return t.seconds * 1000
  return 0
}

// ─── Store ────────────────────────────────────────────────────────────

export const useLicenseRequestsStore = defineStore('licenseRequests', () => {
  // ─── State ──────────────────────────────────────────────────────
  /** True pendant `createForMember` (utilisé par l'UI pour disable le bouton). */
  const loading = ref(false)
  const lastError = ref<string | null>(null)

  /**
   * Cache des demandes connues, par memberId.
   *  - `undefined` (absent de la Map) → lookup jamais fait.
   *  - `null` → lookup fait, aucune demande pour cette saison.
   *  - `LicenseRequestRef` → demande trouvée.
   *
   * Map reactive : on réassigne `byMemberId.value = new Map(byMemberId.value)`
   * après chaque set/delete (Vue ne détecte pas les mutations Map). Pattern
   * déjà en place dans `stores/members.ts`.
   */
  const byMemberId = ref<Map<string, LicenseRequestRef | null>>(new Map())

  const source = ref<LicenseRequestSource>('mock')

  /**
   * Cache des demandes connues côté coach review (PR2 UI).
   * Clé = `requestId`. Volontairement séparé de `byMemberId` parce que
   * la consommation est différente (liste à reviewer + détail unique) et
   * que les invalidations ne sont pas synchrones (un review n'invalide
   * pas la pill TeamRoster).
   *
   * Map reactive : on réassigne `pendingReviewByRequestId.value = new Map(...)`
   * après chaque set/delete (cf. pattern Vue Map réactive).
   */
  const pendingReviewByRequestId = ref<Map<string, LicenseRequest>>(new Map())
  const pendingReviewLoading = ref(false)

  // Mock state legacy — placeholder pour le showcase.
  const requests = ref<LicenseRequestMock[]>(MOCK_LICENSE_REQUESTS.slice())

  // ─── Mode discrimination ──────────────────────────────────────
  /**
   * Mode firestore quand le coach est un user avec `userDoc.memberId`.
   * Sinon mode mock (dev sans backend ou compte sans member lié).
   */
  function isFirestoreMode(): boolean {
    const auth = useAuthStore()
    return Boolean(auth.userDoc?.memberId)
  }

  // ─── Actions firestore + hybride ──────────────────────────────

  /**
   * Hydrate le cache pour une liste de members en un seul fetch (chunké par
   * 10 côté repo). Best-effort : si le fetch plante, on logge + le cache
   * reste vide pour les ids non résolus (l'UI dégrade en "pas de pill").
   *
   * Mode firestore : query `/licenseRequests where memberId in (chunk)` +
   * filtre seasonId actif côté JS.
   * Mode mock : remplit depuis `MOCK_LICENSE_REQUESTS` (synchronous).
   *
   * Idempotent : les ids déjà présents (lookup résolu) ne sont pas refetché
   * — utile quand la vue appelle hydrateForMembers à chaque montage.
   */
  async function hydrateForMembers(memberIds: readonly string[]): Promise<void> {
    if (memberIds.length === 0) return

    const toFetch = memberIds.filter((id) => !byMemberId.value.has(id))
    if (toFetch.length === 0) return

    if (!isFirestoreMode()) {
      // Mode mock — peuplement synchrone depuis les fixtures.
      for (const memberId of toFetch) {
        const existing = MOCK_LICENSE_REQUESTS.find((lr) => lr.memberId === memberId)
        if (existing) {
          byMemberId.value.set(memberId, {
            requestId: existing.id,
            memberId: existing.memberId,
            teamId: existing.teamId,
            status: existing.status,
            requiredDocs: existing.requiredDocs,
            createdAtMs: existing.createdAt,
          })
        } else {
          byMemberId.value.set(memberId, null)
        }
      }
      byMemberId.value = new Map(byMemberId.value)
      source.value = 'mock'
      return
    }

    // Mode firestore — résolution saison + fetch chunké.
    source.value = 'firestore'
    const seasonStore = useActiveSeason()
    let seasonId = seasonStore.seasonId.value
    if (!seasonId) seasonId = await seasonStore.load()
    if (!seasonId) {
      // Pas de saison active — on laisse le cache vide pour ces ids
      // (l'UI dégrade en absence de pill). On évite de marquer `null`
      // pour permettre un retry après config saison.
      console.warn('[licenseRequests.store] hydrateForMembers: no active season')
      return
    }

    try {
      const found = await listLicenseRequestsByMembers(toFetch, seasonId)
      const foundByMember = new Map<string, (typeof found)[number]>()
      for (const lr of found) foundByMember.set(lr.memberId, lr)

      for (const memberId of toFetch) {
        const lr = foundByMember.get(memberId)
        if (lr) {
          byMemberId.value.set(memberId, {
            requestId: lr.id,
            memberId: lr.memberId,
            teamId: lr.teamId,
            status: lr.status,
            requiredDocs: lr.requiredDocs,
            createdAtMs: tsToMs(lr.createdAt),
          })
        } else {
          byMemberId.value.set(memberId, null)
        }
      }
      byMemberId.value = new Map(byMemberId.value)
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err)
      console.error('[licenseRequests.store] hydrateForMembers failed', err)
      lastError.value = code
      // Cache laissé tel quel pour les ids non résolus — retry possible.
    }
  }

  /**
   * Crée la demande pour un member.
   *
   * **Pré-conditions** vérifiées par le caller :
   *  - cotisation OK (gate `canRequestLicense(member)`) ;
   *  - `member.licenseNumber` absent (pas déjà licencié).
   *
   * Le store :
   *  1. Résout la `seasonId` active (cache `useActiveSeason`).
   *  2. Calcule `requiredDocs` via `inferRequiredDocs(...)`.
   *  3. Appelle le repo `createLicenseRequest` (idempotent via ID
   *     déterministe).
   *  4. Met à jour le cache `byMemberId` avec la nouvelle ref.
   *
   * Mode mock : log via `logMockAction` + faux email, retourne
   * `alreadyExisted: false` (mock store n'a pas d'idempotence vraie).
   *
   * @throws si pas de saison active (mode firestore) ou si le repo throw.
   */
  async function createForMember(input: {
    memberId: string
    teamId: string
    teamName: string
    memberFirstName: string
    memberLastName: string
    memberHasAvs: boolean
    /** Flag coach "joueur licencié précédemment en Suisse" (drives transfer_letter_swiss). */
    previouslyLicensedInSwitzerland: boolean
    /** linkedUserId ∪ guardianUserIds du membre — destinataires des notifs. */
    notifyUserIds: readonly string[]
    /** auth.uid du coach (audit). */
    requestedByUid: string
    /** userDoc.memberId du coach (denorm). */
    requestedByMemberId: string
    /** displayName du coach (denorm). */
    coachName: string
  }): Promise<{ requestId: string; alreadyExisted: boolean }> {
    loading.value = true
    lastError.value = null

    try {
      const requiredDocs = inferRequiredDocs({
        hasAvs: input.memberHasAvs,
        previouslyLicensedInSwitzerland: input.previouslyLicensedInSwitzerland,
      })

      if (!isFirestoreMode()) {
        // ─── Mock path ────────────────────────────────────────────
        const mockId = `mock-lr-${input.memberId}-${Date.now()}`
        logMockAction('licenseRequests.create', {
          memberId: input.memberId,
          teamId: input.teamId,
          requiredDocs,
          mockId,
        })
        logFakeParentEmail({
          memberFirstName: input.memberFirstName,
          teamName: input.teamName,
          coachName: input.coachName,
          requiredDocs,
          mockId,
        })

        const refOut: LicenseRequestRef = {
          requestId: mockId,
          memberId: input.memberId,
          teamId: input.teamId,
          status: 'pending_parent_docs',
          requiredDocs,
          createdAtMs: Date.now(),
        }
        byMemberId.value.set(input.memberId, refOut)
        byMemberId.value = new Map(byMemberId.value)
        source.value = 'mock'
        return { requestId: mockId, alreadyExisted: false }
      }

      // ─── Firestore path ────────────────────────────────────────
      source.value = 'firestore'
      const seasonStore = useActiveSeason()
      let seasonId = seasonStore.seasonId.value
      if (!seasonId) seasonId = await seasonStore.load()
      if (!seasonId) {
        lastError.value = 'no-active-season'
        throw new Error('Aucune saison active configurée pour ce club.')
      }

      const result = await createLicenseRequest({
        memberId: input.memberId,
        teamId: input.teamId,
        seasonId,
        requestedByUid: input.requestedByUid,
        requestedByMemberId: input.requestedByMemberId,
        requiredDocs,
        notifyUserIds: input.notifyUserIds,
        denorm: {
          memberFirstName: input.memberFirstName,
          memberLastName: input.memberLastName,
          teamName: input.teamName,
          coachName: input.coachName,
        },
      })

      const refOut: LicenseRequestRef = {
        requestId: result.requestId,
        memberId: input.memberId,
        teamId: input.teamId,
        status: 'pending_parent_docs',
        requiredDocs,
        createdAtMs: Date.now(),
      }
      byMemberId.value.set(input.memberId, refOut)
      byMemberId.value = new Map(byMemberId.value)

      return { requestId: result.requestId, alreadyExisted: result.alreadyExisted }
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err)
      lastError.value = code
      throw err
    } finally {
      loading.value = false
    }
  }

  // ─── Getters firestore + hybride ──────────────────────────────

  /**
   * Récupère la demande connue pour un member.
   * `null` = lookup fait + aucune demande / OU lookup pas encore fait
   * (caller doit appeler `hydrateForMembers` avant pour distinguer).
   */
  function existingForMember(memberId: string): LicenseRequestRef | null {
    return byMemberId.value.get(memberId) ?? null
  }

  /** True ssi un lookup a déjà été effectué pour ce memberId. */
  function hasLookup(memberId: string): boolean {
    return byMemberId.value.has(memberId)
  }

  /** Force le refetch au prochain `hydrateForMembers` pour ce memberId. */
  function invalidate(memberId: string): void {
    if (byMemberId.value.delete(memberId)) {
      byMemberId.value = new Map(byMemberId.value)
    }
  }

  // ─── Coach review (PR2) — listing + per-doc decision ──────────

  /**
   * Convertit un fixture mock vers la forme canonique `LicenseRequest` pour
   * que la vue coach détail consomme un seul type. Les `Timestamp` mock
   * (epoch ms `number`) sont coercés en `{ seconds, nanoseconds }`.
   *
   * Mock-only — quand le mock disparaîtra, cette fonction et son call-site
   * dans `loadPendingReviewForCoach` partiront avec.
   */
  function mockToCanonical(m: LicenseRequestMock): LicenseRequest {
    const tsFromMs = (ms: number | null): { seconds: number; nanoseconds: number } | null => {
      if (ms === null || !Number.isFinite(ms)) return null
      return { seconds: Math.floor(ms / 1000), nanoseconds: 0 }
    }
    const uploaded: Partial<Record<LicenseDocKind, UploadedDocRef>> = {}
    for (const [kind, ref] of Object.entries(m.uploadedDocs ?? {})) {
      if (!ref) continue
      uploaded[kind as LicenseDocKind] = {
        storagePath: ref.url,
        uploadedAt: (tsFromMs(ref.uploadedAt) ?? { seconds: 0, nanoseconds: 0 }) as never,
        fileName: ref.fileName,
        sizeBytes: ref.sizeBytes,
        contentType: 'application/octet-stream',
        coachReview: null,
        treasurerReview: null,
      }
    }
    return {
      id: m.id,
      memberId: m.memberId,
      teamId: m.teamId,
      seasonId: '2025-26',
      requestedBy: m.requestedBy,
      status: m.status,
      requiredDocs: m.requiredDocs,
      parentUserIds: [],
      uploadedDocs: uploaded,
      foreignPlayerContext: m.foreignPlayerContext ?? null,
      parentSubmittedAvs: null,
      denorm: m.denorm,
      parentCompletedAt: tsFromMs(m.parentCompletedAt) as never,
      coachValidatedAt: null,
      coachValidatedByUid: null,
      reviewedBy: null,
      reviewedAt: null,
      adminComment: null,
      createdAt: (tsFromMs(m.createdAt) ?? { seconds: 0, nanoseconds: 0 }) as never,
      // Phase trésorier (PR3-trésorier, 2026-05-24) — mocks restent à null.
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
  }

  /**
   * Charge les demandes à reviewer pour le coach courant (status
   * `parent_docs_submitted`, scope `teamId ∈ user.teamIds`).
   *
   * Mode firestore : résout les `teamIds` via `useTeamsStore` (qui doit
   * être chargé en amont, sinon liste vide — caller doit appeler
   * `teamsStore.loadForCoach(...)` avant).
   *
   * Mode mock : retourne les fixtures `MOCK_LICENSE_REQUESTS` dont le
   * `status === 'parent_docs_submitted'` (le fixture `lr-sarah-2025`
   * matche). Suffisant pour démos locales.
   *
   * Best-effort : si le fetch plante, on logge + cache vidé (l'UI affiche
   * un empty state).
   */
  async function loadPendingReviewForCoach(): Promise<void> {
    pendingReviewLoading.value = true
    try {
      if (!isFirestoreMode()) {
        const fromMock = MOCK_LICENSE_REQUESTS.filter(
          (lr) => lr.status === 'parent_docs_submitted',
        )
        const next = new Map<string, LicenseRequest>()
        for (const m of fromMock) next.set(m.id, mockToCanonical(m))
        pendingReviewByRequestId.value = next
        source.value = 'mock'
        return
      }
      source.value = 'firestore'
      const teamsStore = useTeamsStore()
      const teamIds = teamsStore.teams.map((t) => t.id)
      if (teamIds.length === 0) {
        pendingReviewByRequestId.value = new Map()
        return
      }
      const found = await listLicenseRequestsForCoach(teamIds, {
        status: 'parent_docs_submitted',
      })
      const next = new Map<string, LicenseRequest>()
      for (const lr of found) next.set(lr.id, lr)
      pendingReviewByRequestId.value = next
    } catch (err) {
      console.error('[licenseRequests.store] loadPendingReviewForCoach failed', err)
      lastError.value = err instanceof Error ? err.message : String(err)
    } finally {
      pendingReviewLoading.value = false
    }
  }

  /**
   * Récupère une demande pour la vue détail review. Si présente dans le
   * cache `pendingReviewByRequestId`, retourne directement ; sinon tente
   * un single fetch via le repo (et peuple le cache pour réactivité
   * post-review).
   *
   * Mode mock : tente d'abord `pendingReviewByRequestId` (peuplé par
   * `loadPendingReviewForCoach`) puis tombe sur `MOCK_LICENSE_REQUESTS`
   * direct si miss (cas deep-link).
   */
  async function getPendingReview(requestId: string): Promise<LicenseRequest | null> {
    if (!requestId) return null
    const cached = pendingReviewByRequestId.value.get(requestId)
    if (cached) return cached

    if (!isFirestoreMode()) {
      const fromMock = MOCK_LICENSE_REQUESTS.find((lr) => lr.id === requestId)
      if (!fromMock) return null
      const canonical = mockToCanonical(fromMock)
      pendingReviewByRequestId.value.set(requestId, canonical)
      pendingReviewByRequestId.value = new Map(pendingReviewByRequestId.value)
      return canonical
    }

    const fetched = await getLicenseRequest(requestId)
    if (!fetched) return null
    pendingReviewByRequestId.value.set(requestId, fetched)
    pendingReviewByRequestId.value = new Map(pendingReviewByRequestId.value)
    return fetched
  }

  /**
   * Soumet une décision de review per-doc à la callable
   * `coachReviewLicenseDoc`.
   *
   * Met à jour le cache local en miroir de la réponse serveur :
   *  - pose `coachReview` sur le doc concerné ;
   *  - met à jour le `status` de la demande selon `newStatus` ;
   *  - retire la demande du cache `pendingReviewByRequestId` si elle a
   *    quitté `parent_docs_submitted` (passage à `coach_validated` ou
   *    `pending_parent_docs` post-refus).
   *
   * Mode mock : log-only — pas de mutation des fixtures. Retourne un
   * résultat synthétique pour que l'UI puisse tester le toast.
   *
   * @throws si la callable plante (FirebaseError ou autre).
   */
  async function reviewDoc(input: {
    requestId: string
    kind: LicenseDocKind
    decision: 'accept' | 'refuse'
    refusalReason?: string
  }): Promise<CoachReviewLicenseDocResult> {
    if (!isFirestoreMode()) {
      logMockAction('licenseRequests.reviewDoc', input)
      const existing = pendingReviewByRequestId.value.get(input.requestId)
      if (existing) {
        const isRefuse = input.decision === 'refuse'
        const nextStatus: LicenseRequestStatus = isRefuse
          ? 'pending_parent_docs'
          : 'parent_docs_submitted'
        const updated: LicenseRequest = {
          ...existing,
          status: nextStatus,
          uploadedDocs: { ...existing.uploadedDocs },
        }
        const doc = updated.uploadedDocs[input.kind]
        if (doc) {
          updated.uploadedDocs[input.kind] = {
            ...doc,
            coachReview: {
              decision: isRefuse ? 'refused' : 'accepted',
              at: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 } as never,
              byUid: useAuthStore().uid,
              refusalReason: isRefuse ? (input.refusalReason ?? null) : null,
            },
          }
        }
        pendingReviewByRequestId.value.set(input.requestId, updated)
        pendingReviewByRequestId.value = new Map(pendingReviewByRequestId.value)
      }
      return {
        ok: true,
        requestId: input.requestId,
        newStatus: input.decision === 'refuse' ? 'pending_parent_docs' : 'parent_docs_submitted',
        allCoachAccepted: false,
      }
    }

    const result = await coachReviewLicenseDoc({
      requestId: input.requestId,
      kind: input.kind,
      decision: input.decision,
      ...(input.refusalReason !== undefined ? { refusalReason: input.refusalReason } : {}),
    })

    // Mise à jour optimiste du cache : on patche le doc + status sans refetch.
    const existing = pendingReviewByRequestId.value.get(input.requestId)
    if (existing) {
      const updated: LicenseRequest = {
        ...existing,
        status: result.newStatus,
        uploadedDocs: { ...existing.uploadedDocs },
      }
      const doc = updated.uploadedDocs[input.kind]
      if (doc) {
        const isRefuse = input.decision === 'refuse'
        updated.uploadedDocs[input.kind] = {
          ...doc,
          coachReview: {
            decision: isRefuse ? 'refused' : 'accepted',
            at: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 } as never,
            byUid: useAuthStore().uid,
            refusalReason: isRefuse ? (input.refusalReason ?? null) : null,
          },
        }
      }
      // Si la demande a quitté `parent_docs_submitted`, on la retire de la
      // liste à reviewer (status `coach_validated` côté tous-accept,
      // `pending_parent_docs` côté refus).
      if (result.newStatus !== 'parent_docs_submitted') {
        pendingReviewByRequestId.value.delete(input.requestId)
      } else {
        pendingReviewByRequestId.value.set(input.requestId, updated)
      }
      pendingReviewByRequestId.value = new Map(pendingReviewByRequestId.value)
    }

    return result
  }

  /** Liste triée par createdAt DESC pour la vue liste. */
  const pendingReviewList = computed<LicenseRequest[]>(() => {
    const arr = Array.from(pendingReviewByRequestId.value.values())
    arr.sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt))
    return arr
  })

  // ─── Mock helpers (legacy — rétro-compat showcase / Home) ─────

  /** @deprecated Mock-only — utiliser `existingForMember` / `hydrateForMembers`. */
  function listForMember(memberId: string): LicenseRequestMock[] {
    return listLicenseRequestsForMember(memberId)
  }

  /** @deprecated Mock-only — utiliser `existingForMember`. */
  function getById(id: string): LicenseRequestMock | undefined {
    return getLicenseRequestById(id)
  }

  /**
   * @deprecated Mock-only — utiliser `createForMember`.
   *
   * Simule la création d'une demande de licence. **Ne mute pas** les
   * fixtures. Effets : `logMockAction` + faux email console. Retourne
   * `{ ok: true, mockId }`.
   */
  function create(input: CreateLicenseRequestMockInput): CreateLicenseRequestMockResult {
    const mockId = `lr-mock-${Date.now()}`

    logMockAction('licenseRequests.create', {
      memberId: input.memberId,
      teamId: input.teamId,
      requiredDocs: input.requiredDocs,
      mockId,
    })

    const member = getMember(input.memberId)
    const team = input.teamId ? getTeam(input.teamId) : null
    logFakeParentEmail({
      memberFirstName: member?.firstName ?? 'le joueur',
      teamName: team?.name ?? "l'équipe",
      coachName: 'Mathieu Brun',
      requiredDocs: input.requiredDocs,
      mockId,
    })

    return { ok: true, mockId }
  }

  // ─── Computed (utile UI) ──────────────────────────────────────

  /** Nombre de demandes connues (lookup résolu non-null). */
  const knownCount = computed<number>(() => {
    let n = 0
    for (const v of byMemberId.value.values()) if (v !== null) n += 1
    return n
  })

  return {
    // state
    loading,
    lastError,
    byMemberId,
    source,
    requests,
    pendingReviewByRequestId,
    pendingReviewLoading,
    // getters
    existingForMember,
    hasLookup,
    knownCount,
    pendingReviewList,
    // actions firestore + hybride
    hydrateForMembers,
    createForMember,
    invalidate,
    // coach review (PR2)
    loadPendingReviewForCoach,
    getPendingReview,
    reviewDoc,
    // mock legacy
    listForMember,
    getById,
    create,
  }
})

// ─── Mock email box ───────────────────────────────────────────────────

/**
 * Log un faux email parent encadré (console.info). Conservé pour le
 * showcase + le mode mock — pas utilisé en mode firestore (la vraie notif
 * arrivera via /notifications quand le schéma sera étendu).
 */
function logFakeParentEmail(args: {
  memberFirstName: string
  teamName: string
  coachName: string
  requiredDocs: LicenseDocKind[]
  mockId: string
}): void {
  const parentEmail = 'parent@example.ch'
  const docs = args.requiredDocs.map((k) => `    - ${DOC_LABELS[k]}`).join('\n')
  const link = `http://localhost:5174/account/license-requests/${args.mockId}`

  const emailBox = [
    '╔════════════════════════════════════════════════════════════════════╗',
    `║  [MOCK EMAIL] À: ${parentEmail.padEnd(46)}║`,
    `║  Sujet: Documents licence à fournir pour ${args.memberFirstName.padEnd(24)}║`,
    '║                                                                    ║',
    '║  Bonjour,                                                          ║',
    `║  Le coach ${args.coachName} a démarré une demande de licence pour       ║`,
    `║  ${args.memberFirstName} (${args.teamName}). Merci de compléter les documents :  ║`,
    docs,
    '║                                                                    ║',
    `║  → ${link}`,
    '╚════════════════════════════════════════════════════════════════════╝',
  ].join('\n')

  // eslint-disable-next-line no-console
  console.info(emailBox)
}
