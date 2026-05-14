import { computed, isRef, ref, watch, type Ref } from 'vue'
import { FirebaseError } from 'firebase/app'
import type { Cotisation } from '@club-app/shared-types'
import {
  cancelCotisation as repoCancelCotisation,
  deleteCotisation as repoDeleteCotisation,
  listMemberCotisations,
} from '@/repositories/cotisations.repo'

/**
 * Composable réactif pour le tab "Cotisations" de la page Member detail.
 *
 * Architecture en couches (cf. apps/web/CLAUDE.md) : ce composable wrap
 * `listMemberCotisations` côté repo. Il reste local au tab (pas un store
 * Pinia) car les données ne sont pas partagées entre composants — le scope
 * est strictement "ce membre, cette page".
 *
 * Conventions :
 *  - Accepte `memberId` en string OU Ref<string>. Si Ref, watch + reload.
 *  - `load()` ne throw jamais — toute erreur est aplatie dans `error`.
 *    `listMemberCotisations` dégrade déjà `permission-denied` en `[]`.
 *  - Tri : la liste retournée par le repo est déjà triée `activatedAt` desc.
 *  - `bySeasonId` regroupe les cotisations par saison, ordre antéchronologique
 *    déduit du premier élément de chaque groupe (la liste plate étant déjà
 *    triée par `activatedAt` desc).
 *  - `totals` calcule paid / due / overdue (count + montant en CHF). Les
 *    statuts non comptés (cancelled / pending_grace) ne sont pas inclus.
 */
export interface MemberCotisationsTotals {
  paid: { count: number; amount: number }
  /** Tout ce qui est dû mais non encore payé : `issued`, `pending_grace`, `excepted`. */
  due: { count: number; amount: number }
  /** `overdue` uniquement — appelle l'attention. */
  overdue: { count: number; amount: number }
}

export interface UseMemberCotisationsReturn {
  cotisations: Ref<Cotisation[]>
  loading: Ref<boolean>
  error: Ref<string | null>
  /** Id de la cotisation en cours de mutation (UI feedback ligne par ligne). */
  pendingActionFor: Ref<string | null>
  load: () => Promise<void>
  bySeasonId: Ref<{ seasonId: string; cotisations: Cotisation[] }[]>
  totals: Ref<MemberCotisationsTotals>
  /** Annule (statut `cancelled` + motif append dans notes). Reload après. */
  cancel: (cotisationId: string, reason: string) => Promise<void>
  /** Suppression définitive (deleteDoc). Refuse si `status === 'paid'`. */
  remove: (cotisationId: string) => Promise<void>
}

export function useMemberCotisations(
  memberId: Ref<string> | string,
): UseMemberCotisationsReturn {
  const cotisations = ref<Cotisation[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const pendingActionFor = ref<string | null>(null)

  function resolveId(): string {
    return isRef(memberId) ? memberId.value : memberId
  }

  async function load(): Promise<void> {
    const id = resolveId()
    if (!id) {
      cotisations.value = []
      return
    }
    loading.value = true
    error.value = null
    try {
      cotisations.value = await listMemberCotisations(id)
    } catch (e: unknown) {
      error.value =
        e instanceof Error
          ? e.message
          : 'Erreur lors du chargement des cotisations.'
      cotisations.value = []
    } finally {
      loading.value = false
    }
  }

  // Si memberId est un Ref, on re-charge sur changement (cas navigation
  // /members/:id → /members/:other-id sans démontage du composant).
  if (isRef(memberId)) {
    watch(memberId, () => {
      void load()
    })
  }

  // -------------------------------------------------------------------------
  // Derived : groupement par saison, ordre antéchronologique.
  // -------------------------------------------------------------------------
  const bySeasonId = computed<{ seasonId: string; cotisations: Cotisation[] }[]>(() => {
    const groups = new Map<string, Cotisation[]>()
    const order: string[] = []
    for (const c of cotisations.value) {
      const existing = groups.get(c.seasonId)
      if (existing) {
        existing.push(c)
      } else {
        groups.set(c.seasonId, [c])
        order.push(c.seasonId)
      }
    }
    return order.map((seasonId) => ({
      seasonId,
      // Garde le sous-ensemble trié comme la liste plate (activatedAt desc).
      cotisations: groups.get(seasonId) ?? [],
    }))
  })

  // -------------------------------------------------------------------------
  // Derived : totaux paid / due / overdue.
  // -------------------------------------------------------------------------
  const totals = computed<MemberCotisationsTotals>(() => {
    const acc: MemberCotisationsTotals = {
      paid: { count: 0, amount: 0 },
      due: { count: 0, amount: 0 },
      overdue: { count: 0, amount: 0 },
    }
    for (const c of cotisations.value) {
      switch (c.status) {
        case 'paid':
          acc.paid.count += 1
          acc.paid.amount += c.paidAmount ?? c.amount
          break
        case 'overdue':
          acc.overdue.count += 1
          acc.overdue.amount += c.amount
          break
        case 'issued':
        case 'pending_grace':
        case 'excepted':
          acc.due.count += 1
          acc.due.amount += c.amount
          break
        case 'cancelled':
        default:
          // Non comptés dans les totaux.
          break
      }
    }
    return acc
  })

  // -------------------------------------------------------------------------
  // Mutations — délèguent au repo (admin-only côté rules), puis reload pour
  // refléter l'état serveur (les triggers Functions ont pu propager
  // `member.duesStatus`).
  //
  // Catch enrichi (cf. apps/web/CLAUDE.md §"Catch enrichi obligatoire") :
  // log le code FirebaseError pour faciliter le diagnostic, ré-emet l'erreur
  // pour que la dialog puisse afficher un message contextuel à l'utilisateur.
  // -------------------------------------------------------------------------
  async function cancel(cotisationId: string, reason: string): Promise<void> {
    pendingActionFor.value = cotisationId
    error.value = null
    try {
      await repoCancelCotisation(cotisationId, reason)
      await load()
    } catch (err: unknown) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`useMemberCotisations.cancel failed [${code}]`, err)
      error.value =
        err instanceof Error ? err.message : "Erreur lors de l'annulation de la cotisation."
      throw err
    } finally {
      pendingActionFor.value = null
    }
  }

  async function remove(cotisationId: string): Promise<void> {
    pendingActionFor.value = cotisationId
    error.value = null
    try {
      await repoDeleteCotisation(cotisationId)
      await load()
    } catch (err: unknown) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`useMemberCotisations.remove failed [${code}]`, err)
      error.value =
        err instanceof Error ? err.message : 'Erreur lors de la suppression de la cotisation.'
      throw err
    } finally {
      pendingActionFor.value = null
    }
  }

  return {
    cotisations,
    loading,
    error,
    pendingActionFor,
    load,
    bySeasonId,
    totals,
    cancel,
    remove,
  }
}
