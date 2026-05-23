import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { LicenseRequestMock } from '@club-app/shared-types'
import {
  getById as getByIdMock,
  loadAll as loadAllMock,
  persistOverride,
  seedDevLicenseRequest,
} from '@/repositories/licenseRequests.mock'

/**
 * Store "demandes de licence parent" — mode mock strict.
 *
 * Distinct du store `useLicenseDocsStore` qui lit les `/licenseRequests` réels
 * en Firestore (read-only, sans consumer pour l'instant). Ce store-ci alimente
 * la démo E2E :
 *  - `loadAll()` : charge fixtures partagées + overrides sessionStorage.
 *  - `loadRequest(id)` : sélectionne une request pour la vue détail.
 *  - `patchRequest(id, patch)` : applique un patch local + persiste.
 *  - `submitRequest(id)` : bascule `pending_parent_docs` → `parent_docs_submitted`.
 *  - `seedMock(...)` : helper dev (bouton Home "🧪 Simuler demande coach").
 *
 * Le store ne filtre PAS par memberId — c'est un cache global des fixtures.
 * Le côté UI (Home banner) peut filtrer via `pendingRequests` ou via un
 * sous-ensemble `myMembers` si on veut un jour restreindre.
 */
export const useLicenseRequestsStore = defineStore('licenseRequests', () => {
  const requests = ref<LicenseRequestMock[]>([])
  const currentRequest = ref<LicenseRequestMock | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  /** True si au moins une request est en attente de docs parent. */
  const hasPending = computed(() =>
    requests.value.some((r) => r.status === 'pending_parent_docs'),
  )

  /** Liste filtrée des requests "à compléter" — utilisée par le banner Home. */
  const pendingRequests = computed(() =>
    requests.value.filter((r) => r.status === 'pending_parent_docs'),
  )

  /**
   * Charge l'état effectif (fixtures + overrides) en RAM. Idempotent.
   * Aucun fetch réseau — synchrone côté repo mais l'action est `async` pour
   * faciliter la promotion future vers un repo Firestore.
   */
  async function loadAll(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      requests.value = loadAllMock()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.error(`[licenseRequests.store] loadAll failed: ${msg}`, err)
      error.value = "Impossible de charger les demandes de licence."
    } finally {
      loading.value = false
    }
  }

  /**
   * Charge une request spécifique dans `currentRequest`. Si le store n'a pas
   * encore chargé, on déclenche un `loadAll` implicite — l'UI peut donc
   * appeler `loadRequest(id)` au mount sans pré-condition.
   */
  async function loadRequest(requestId: string): Promise<LicenseRequestMock | null> {
    if (requests.value.length === 0) {
      await loadAll()
    }
    const found = requests.value.find((r) => r.id === requestId)
      ?? getByIdMock(requestId)
      ?? null
    currentRequest.value = found
    return found
  }

  /**
   * Applique un patch partiel à une request (RAM + sessionStorage). Si la
   * request n'existe pas dans le cache, on la recharge d'abord. Renvoie le
   * doc fusionné, ou `null` si introuvable.
   */
  function patchRequest(
    requestId: string,
    patch: Partial<LicenseRequestMock>,
  ): LicenseRequestMock | null {
    const idx = requests.value.findIndex((r) => r.id === requestId)
    const current = idx >= 0 ? requests.value[idx] : getByIdMock(requestId)
    if (!current) {
      console.warn(`[licenseRequests.store] patchRequest: ${requestId} not found`)
      return null
    }
    const merged: LicenseRequestMock = { ...current, ...patch }
    persistOverride(merged)
    if (idx >= 0) {
      // Remplace l'item en place pour préserver la réactivité.
      requests.value[idx] = merged
    } else {
      requests.value.push(merged)
    }
    if (currentRequest.value?.id === requestId) {
      currentRequest.value = merged
    }
    return merged
  }

  /**
   * Soumet une request : passe en `parent_docs_submitted` + horodate
   * `parentCompletedAt`. Idempotent : si déjà submitted, ne fait rien.
   * Renvoie le doc final, ou `null` si introuvable.
   */
  async function submitRequest(requestId: string): Promise<LicenseRequestMock | null> {
    const current = requests.value.find((r) => r.id === requestId) ?? getByIdMock(requestId)
    if (!current) {
      console.warn(`[licenseRequests.store] submitRequest: ${requestId} not found`)
      return null
    }
    if (current.status === 'parent_docs_submitted') return current
    return patchRequest(requestId, {
      status: 'parent_docs_submitted',
      parentCompletedAt: Date.now(),
    })
  }

  /**
   * Seed une demande de démo (bouton dev sur Home). Pousse l'item dans
   * `requests` et persiste en sessionStorage. Renvoie le doc créé pour que
   * l'UI puisse, si elle le souhaite, naviguer directement dessus.
   */
  function seedMock(args: Parameters<typeof seedDevLicenseRequest>[0]): LicenseRequestMock {
    const doc = seedDevLicenseRequest(args)
    requests.value.push(doc)
    return doc
  }

  /** Reset interne — utile pour les tests / la déconnexion future. */
  function reset(): void {
    requests.value = []
    currentRequest.value = null
    loading.value = false
    error.value = null
  }

  return {
    // state
    requests,
    currentRequest,
    loading,
    error,
    // computed
    hasPending,
    pendingRequests,
    // actions
    loadAll,
    loadRequest,
    patchRequest,
    submitRequest,
    seedMock,
    reset,
  }
})
