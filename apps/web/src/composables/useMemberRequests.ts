import { computed, ref, type ComputedRef, type Ref } from 'vue'
import {
  approveLicenseRequest,
  listMemberLicenseRequests,
  rejectLicenseRequest,
} from '@/repositories/licenseRequests.repo'
import {
  approvePaymentExceptionRequest,
  listMemberPaymentExceptionRequests,
  rejectPaymentExceptionRequest,
} from '@/repositories/paymentExceptions.repo'
import type {
  LicenseRequest,
  PaymentExceptionRequest,
  Timestamp as NeutralTimestamp,
} from '@club-app/shared-types'

/**
 * Composable `useMemberRequests` — agrège les demandes de licence et les
 * demandes d'exception cotisation pour un membre donné. Expose un état
 * réactif (loading / error), un loader explicite (parallèle), des actions
 * d'approbation / rejet wrappant les repos et un computed `unified` qui
 * fusionne les deux listes pour rendu en timeline.
 *
 * Respecte l'architecture en couches : on ne touche QUE les repositories,
 * jamais le SDK Firebase directement. Le composant `RequestsTab.vue` parle
 * uniquement à ce composable.
 */

export interface UnifiedRequest {
  /** Discriminant pour le rendu côté composant. */
  kind: 'license' | 'payment-exception'
  data: LicenseRequest | PaymentExceptionRequest
  /** `createdAt` converti en `Date` JS pour tri et affichage. */
  createdAt: Date
}

/** Convertit un Timestamp neutre (seconds/nanoseconds) en Date JS. */
function neutralTsToDate(ts: NeutralTimestamp): Date {
  return new Date(ts.seconds * 1000 + Math.floor(ts.nanoseconds / 1_000_000))
}

interface UseMemberRequestsReturn {
  licenseRequests: Ref<LicenseRequest[]>
  paymentExceptionRequests: Ref<PaymentExceptionRequest[]>
  unified: ComputedRef<UnifiedRequest[]>
  loading: Ref<boolean>
  saving: Ref<boolean>
  error: Ref<string | null>
  load: () => Promise<void>
  approveLicense: (id: string, comment?: string) => Promise<void>
  rejectLicense: (id: string, comment?: string) => Promise<void>
  approvePaymentException: (
    id: string,
    options?: { adminComment?: string; newIssuedAt?: Date; newDueAt?: Date },
  ) => Promise<void>
  rejectPaymentException: (id: string, comment?: string) => Promise<void>
}

export function useMemberRequests(memberId: string): UseMemberRequestsReturn {
  const licenseRequests = ref<LicenseRequest[]>([])
  const paymentExceptionRequests = ref<PaymentExceptionRequest[]>([])
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const [lic, exc] = await Promise.all([
        listMemberLicenseRequests(memberId),
        listMemberPaymentExceptionRequests(memberId),
      ])
      licenseRequests.value = lic
      paymentExceptionRequests.value = exc
    } catch (err: unknown) {
      error.value =
        err instanceof Error ? err.message : 'Erreur de chargement des demandes.'
    } finally {
      loading.value = false
    }
  }

  async function withSaving(action: () => Promise<void>): Promise<void> {
    saving.value = true
    error.value = null
    try {
      await action()
      await load()
    } catch (err: unknown) {
      error.value =
        err instanceof Error
          ? err.message
          : 'Erreur lors du traitement de la demande.'
    } finally {
      saving.value = false
    }
  }

  async function approveLicense(id: string, comment?: string): Promise<void> {
    await withSaving(() => approveLicenseRequest(id, { adminComment: comment }))
  }

  async function rejectLicense(id: string, comment?: string): Promise<void> {
    await withSaving(() => rejectLicenseRequest(id, { adminComment: comment }))
  }

  async function approvePaymentException(
    id: string,
    options: { adminComment?: string; newIssuedAt?: Date; newDueAt?: Date } = {},
  ): Promise<void> {
    await withSaving(() => approvePaymentExceptionRequest(id, options))
  }

  async function rejectPaymentException(
    id: string,
    comment?: string,
  ): Promise<void> {
    await withSaving(() =>
      rejectPaymentExceptionRequest(id, { adminComment: comment }),
    )
  }

  /**
   * Timeline unifiée : on annote chaque entrée avec son `kind` et un
   * `createdAt` Date JS, puis on trie desc. Les deux listes étant déjà
   * triées par le repo, la fusion ne fait qu'un merge en O(n log n).
   */
  const unified = computed<UnifiedRequest[]>(() => {
    const items: UnifiedRequest[] = []
    for (const lr of licenseRequests.value) {
      items.push({
        kind: 'license',
        data: lr,
        createdAt: neutralTsToDate(lr.createdAt),
      })
    }
    for (const pr of paymentExceptionRequests.value) {
      items.push({
        kind: 'payment-exception',
        data: pr,
        createdAt: neutralTsToDate(pr.createdAt),
      })
    }
    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    return items
  })

  return {
    licenseRequests,
    paymentExceptionRequests,
    unified,
    loading,
    saving,
    error,
    load,
    approveLicense,
    rejectLicense,
    approvePaymentException,
    rejectPaymentException,
  }
}
