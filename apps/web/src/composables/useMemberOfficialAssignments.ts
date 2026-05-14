import { computed, ref, type Ref } from 'vue'
import {
  DEFAULT_OFFICIALS_CONFIG,
  getOfficialsConfig,
  listMemberOfficialAssignments,
  type OfficialAssignmentRow,
} from '@/repositories/officialAssignments.repo'
import type { OfficialsConfig } from '@club-app/shared-types'

/**
 * Composable de la sous-vue Officiel (Member detail → tab Officiel).
 *
 * Charge en parallèle :
 *  - les assignations du membre (enrichies via le repo)
 *  - `/config/club.officialsConfig` pour les seuils
 *
 * Expose des stats dérivées (totals, par saison) et un score de rentabilité
 * client-side basé sur la config (cf. docs/main.md "Officials — indicateurs
 * de rentabilité").
 *
 * ### Choix : comptage "saison active" sans accès à la saison active
 *
 * Le repo ne peut pas lire `/seasons.where(status == 'active')` ici sans
 * faire dépendre la couche d'un nouveau lookup (et sans imposer une nouvelle
 * rule à l'official-self lui-même, qui peut consulter sa propre fiche). Pour
 * le MVP on prend les **12 derniers mois** comme proxy de "saison courante" —
 * suffisant pour l'indicateur de rentabilité affiché dans le tab. Quand
 * `seasons.repo.ts` exposera un `getActiveSeason()` et que la rule
 * `/seasons` sera ouverte aux signed-in (déjà le cas, cf. firestore.rules),
 * on basculera sur `filter(a => a.seasonId === activeSeasonId)`.
 */

type RentabilityVariant = 'emerald' | 'amber' | 'rose'
type RentabilityStatus = 'green' | 'orange' | 'red'

export interface RentabilityScore {
  variant: RentabilityVariant
  status: RentabilityStatus
  label: string
  matches: number
}

export interface StatusCounts {
  total: number
  confirmed: number
  pending: number
  declined: number
}

const EMPTY_COUNTS: StatusCounts = {
  total: 0,
  confirmed: 0,
  pending: 0,
  declined: 0,
}

const MS_PER_DAY = 86_400_000
const ROLLING_WINDOW_DAYS = 365

function bumpCounts(target: StatusCounts, row: OfficialAssignmentRow): void {
  target.total += 1
  if (row.status === 'confirmed') target.confirmed += 1
  else if (row.status === 'pending') target.pending += 1
  else if (row.status === 'declined') target.declined += 1
}

export interface UseMemberOfficialAssignments {
  assignments: Ref<OfficialAssignmentRow[]>
  loading: Ref<boolean>
  error: Ref<string | null>
  officialsConfig: Ref<OfficialsConfig>
  totals: Ref<StatusCounts>
  bySeasonId: Ref<Map<string, StatusCounts>>
  currentSeasonConfirmed: Ref<number>
  rentabilityScore: Ref<RentabilityScore>
  load: () => Promise<void>
}

export function useMemberOfficialAssignments(
  memberId: Ref<string> | string,
): UseMemberOfficialAssignments {
  const assignments = ref<OfficialAssignmentRow[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const officialsConfig = ref<OfficialsConfig>({ ...DEFAULT_OFFICIALS_CONFIG })

  function currentMemberId(): string {
    return typeof memberId === 'string' ? memberId : memberId.value
  }

  async function load(): Promise<void> {
    const id = currentMemberId()
    if (!id) return
    loading.value = true
    error.value = null
    try {
      const [rows, cfg] = await Promise.all([
        listMemberOfficialAssignments(id),
        getOfficialsConfig(),
      ])
      assignments.value = rows
      officialsConfig.value = cfg
    } catch (e: unknown) {
      error.value =
        e instanceof Error
          ? e.message
          : 'Erreur lors du chargement des assignations'
    } finally {
      loading.value = false
    }
  }

  // -------------------------------------------------------------------------
  // Dérivés
  // -------------------------------------------------------------------------

  const totals = computed<StatusCounts>(() => {
    const acc: StatusCounts = { ...EMPTY_COUNTS }
    for (const row of assignments.value) bumpCounts(acc, row)
    return acc
  })

  const bySeasonId = computed<Map<string, StatusCounts>>(() => {
    const map = new Map<string, StatusCounts>()
    for (const row of assignments.value) {
      const key = row.seasonId ?? '__unknown__'
      const current = map.get(key) ?? { ...EMPTY_COUNTS }
      bumpCounts(current, row)
      map.set(key, current)
    }
    return map
  })

  /**
   * Confirmed sur la "saison courante" — proxy = 365 derniers jours basés
   * sur `bookingDate`. Voir choix documenté en tête de fichier.
   */
  const currentSeasonConfirmed = computed<number>(() => {
    const cutoff = Date.now() - ROLLING_WINDOW_DAYS * MS_PER_DAY
    let count = 0
    for (const row of assignments.value) {
      if (row.status !== 'confirmed') continue
      const ts = row.bookingDate?.getTime() ?? 0
      if (ts >= cutoff) count += 1
    }
    return count
  })

  const rentabilityScore = computed<RentabilityScore>(() => {
    const cfg = officialsConfig.value
    const matches = currentSeasonConfirmed.value
    if (matches >= cfg.thresholdGreen) {
      return { variant: 'emerald', status: 'green', label: 'Rentable', matches }
    }
    if (matches >= cfg.thresholdOrange) {
      return { variant: 'amber', status: 'orange', label: 'Faible', matches }
    }
    return { variant: 'rose', status: 'red', label: 'Critique', matches }
  })

  return {
    assignments,
    loading,
    error,
    officialsConfig,
    totals,
    bySeasonId,
    currentSeasonConfirmed,
    rentabilityScore,
    load,
  }
}
