import { computed, isRef, ref, watch, type Ref } from 'vue'
import type { Due } from '@club-app/shared-types'
import { listMemberDues } from '@/repositories/dues.repo'

/**
 * Composable réactif pour le tab "Cotisations" de la page Member detail.
 *
 * Architecture en couches (cf. apps/web/CLAUDE.md) : ce composable wrap
 * `listMemberDues` côté repo. Il reste local au tab (pas un store Pinia)
 * car les données ne sont pas partagées entre composants — le scope est
 * strictement "ce membre, cette page".
 *
 * Conventions :
 *  - Accepte `memberId` en string OU Ref<string>. Si Ref, watch + reload.
 *  - `load()` ne throw jamais — toute erreur est aplatie dans `error`.
 *    `listMemberDues` dégrade déjà `permission-denied` en `[]`.
 *  - Tri : la liste retournée par le repo est déjà triée `activatedAt` desc.
 *  - `bySeasonId` regroupe les dues par saison, ordre antéchronologique
 *    déduit du premier élément de chaque groupe (la liste plate étant déjà
 *    triée par `activatedAt` desc).
 *  - `totals` calcule paid / due / overdue (count + montant en CHF). Les
 *    statuts non comptés (cancelled / pending_grace) ne sont pas inclus.
 */
export interface MemberDuesTotals {
  paid: { count: number; amount: number }
  /** Tout ce qui est dû mais non encore payé : `issued`, `pending_grace`, `excepted`. */
  due: { count: number; amount: number }
  /** `overdue` uniquement — appelle l'attention. */
  overdue: { count: number; amount: number }
}

export interface UseMemberDuesReturn {
  dues: Ref<Due[]>
  loading: Ref<boolean>
  error: Ref<string | null>
  load: () => Promise<void>
  bySeasonId: Ref<{ seasonId: string; dues: Due[] }[]>
  totals: Ref<MemberDuesTotals>
}

export function useMemberDues(
  memberId: Ref<string> | string,
): UseMemberDuesReturn {
  const dues = ref<Due[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  function resolveId(): string {
    return isRef(memberId) ? memberId.value : memberId
  }

  async function load(): Promise<void> {
    const id = resolveId()
    if (!id) {
      dues.value = []
      return
    }
    loading.value = true
    error.value = null
    try {
      dues.value = await listMemberDues(id)
    } catch (e: unknown) {
      error.value =
        e instanceof Error
          ? e.message
          : 'Erreur lors du chargement des cotisations.'
      dues.value = []
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
  const bySeasonId = computed<{ seasonId: string; dues: Due[] }[]>(() => {
    const groups = new Map<string, Due[]>()
    const order: string[] = []
    for (const d of dues.value) {
      const existing = groups.get(d.seasonId)
      if (existing) {
        existing.push(d)
      } else {
        groups.set(d.seasonId, [d])
        order.push(d.seasonId)
      }
    }
    return order.map((seasonId) => ({
      seasonId,
      // Garde le sous-ensemble trié comme la liste plate (activatedAt desc).
      dues: groups.get(seasonId) ?? [],
    }))
  })

  // -------------------------------------------------------------------------
  // Derived : totaux paid / due / overdue.
  // -------------------------------------------------------------------------
  const totals = computed<MemberDuesTotals>(() => {
    const acc: MemberDuesTotals = {
      paid: { count: 0, amount: 0 },
      due: { count: 0, amount: 0 },
      overdue: { count: 0, amount: 0 },
    }
    for (const d of dues.value) {
      switch (d.status) {
        case 'paid':
          acc.paid.count += 1
          acc.paid.amount += d.paidAmount ?? d.amount
          break
        case 'overdue':
          acc.overdue.count += 1
          acc.overdue.amount += d.amount
          break
        case 'issued':
        case 'pending_grace':
        case 'excepted':
          acc.due.count += 1
          acc.due.amount += d.amount
          break
        case 'cancelled':
        default:
          // Non comptés dans les totaux.
          break
      }
    }
    return acc
  })

  return {
    dues,
    loading,
    error,
    load,
    bySeasonId,
    totals,
  }
}
