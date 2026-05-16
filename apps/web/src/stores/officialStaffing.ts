import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { FirebaseError } from 'firebase/app'
import {
  listMatchStaffing,
  type MatchStaffingRow,
  type MatchStaffingStatus,
} from '@/repositories/officialStaffing.repo'
import {
  assignOfficial,
  removeAssignment,
  setAssignmentStatus,
  type AssignmentParent,
} from '@/repositories/officialAssignments.repo'
import {
  createNotification,
  type CreateNotificationInput,
} from '@/repositories/notifications.repo'
import type { OfficialAssignmentStatus } from '@club-app/shared-types'
import { useAuthStore } from '@/stores/auth'

/**
 * Filtre rapide (chips) de l'écran Officials admin — staffing des matchs.
 * `all` désactive le filtre ; les autres valeurs filtrent par `staffingStatus`.
 */
export type StaffingQuickFilter = 'all' | MatchStaffingStatus

/**
 * Store OfficialStaffing — source unique du staffing des matchs HOME pour
 * l'écran Officials admin.
 *
 * `load()` charge la liste agrégée (matchs HOME + besoins + assignations).
 * La vue passe par `filtered` (dérivé du `quickFilter` actif) — elle
 * n'appelle JAMAIS le repo directement (cf. apps/web/CLAUDE.md —
 * architecture en couches).
 *
 * Après toute mutation (`assign` / `setStatus` / `remove`), le store
 * recharge la liste pour refléter l'état Firestore.
 *
 * Try/catch enrichi `FirebaseError` partout (cf. apps/web/CLAUDE.md §
 * "Catch enrichi obligatoire").
 */
export const useOfficialStaffingStore = defineStore('officialStaffing', () => {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const matches = ref<MatchStaffingRow[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const quickFilter = ref<StaffingQuickFilter>('all')

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Récupère le uid courant ou throw `'not authenticated'`. */
  function requireUid(): string {
    const auth = useAuthStore()
    const uid = auth.authSnap?.uid ?? null
    if (!uid) throw new Error('not authenticated')
    return uid
  }

  /**
   * Parent d'assignation d'un match : son booking pour un match HOME, le doc
   * match lui-même pour un match AWAY (pas de booking). Cf.
   * `officialAssignments.repo.ts` (`AssignmentParent`).
   */
  function parentOf(row: MatchStaffingRow): AssignmentParent {
    return row.bookingId
      ? { kind: 'booking', id: row.bookingId }
      : { kind: 'match', id: row.matchId }
  }

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  /** Liste filtrée par `quickFilter` — drive le DataTable. */
  const filtered = computed<MatchStaffingRow[]>(() => {
    const f = quickFilter.value
    if (f === 'all') return matches.value
    return matches.value.filter((m) => m.staffingStatus === f)
  })

  /** Counts par bucket — alimente les chips (all en premier). */
  const counts = computed(() => {
    let unstaffed = 0
    let partial = 0
    let full = 0
    for (const m of matches.value) {
      if (m.staffingStatus === 'unstaffed') unstaffed += 1
      else if (m.staffingStatus === 'partial') partial += 1
      else if (m.staffingStatus === 'full') full += 1
    }
    return {
      all: matches.value.length,
      unstaffed,
      partial,
      full,
    }
  })

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /** Charge le staffing de tous les matchs (HOME + AWAY) dans `matches`. */
  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      matches.value = await listMatchStaffing()
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`listMatchStaffing failed [${code}]`, err)
      error.value =
        err instanceof Error
          ? err.message
          : 'Erreur de chargement du staffing des matchs'
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * Assigne un officiel à un match (statut `pending`). Recharge ensuite la
   * liste pour refléter la nouvelle assignation. Le parent (booking ou match)
   * est dérivé du `kind` de la ligne.
   */
  async function assign(
    row: MatchStaffingRow,
    payload: { memberId: string; officialLevel: number },
  ): Promise<void> {
    const assignedBy = requireUid()
    loading.value = true
    error.value = null
    try {
      await assignOfficial(parentOf(row), {
        memberId: payload.memberId,
        officialLevel: payload.officialLevel,
        assignedBy,
      })
      await load()
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`assign official failed [${code}]`, err)
      error.value =
        err instanceof Error
          ? err.message
          : "Erreur lors de l'assignation de l'officiel"
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * Change le statut d'une assignation (`pending` / `confirmed` /
   * `declined`). Recharge ensuite la liste.
   */
  async function setStatus(
    row: MatchStaffingRow,
    assignmentId: string,
    status: OfficialAssignmentStatus,
  ): Promise<void> {
    loading.value = true
    error.value = null
    try {
      await setAssignmentStatus(parentOf(row), assignmentId, status)
      await load()
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`setStatus failed [${code}]`, err)
      error.value =
        err instanceof Error
          ? err.message
          : 'Erreur lors du changement de statut'
      throw err
    } finally {
      loading.value = false
    }
  }

  /** Supprime une assignation. Recharge ensuite la liste. */
  async function remove(
    row: MatchStaffingRow,
    assignmentId: string,
  ): Promise<void> {
    loading.value = true
    error.value = null
    try {
      await removeAssignment(parentOf(row), assignmentId)
      await load()
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`remove assignment failed [${code}]`, err)
      error.value =
        err instanceof Error
          ? err.message
          : "Erreur lors de la suppression de l'assignation"
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * Envoie une notification aux officiels. Le store injecte le `sentBy`
   * (uid courant) — l'appelant ne fournit que le contenu.
   *
   * @returns l'id de la notification créée.
   */
  async function sendNotification(
    input: Omit<CreateNotificationInput, 'sentBy'>,
  ): Promise<string> {
    const sentBy = requireUid()
    loading.value = true
    error.value = null
    try {
      return await createNotification({ ...input, sentBy })
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`sendNotification failed [${code}]`, err)
      error.value =
        err instanceof Error
          ? err.message
          : "Erreur lors de l'envoi de la notification"
      throw err
    } finally {
      loading.value = false
    }
  }

  /** Met à jour le filtre rapide actif. */
  function setQuickFilter(value: StaffingQuickFilter): void {
    quickFilter.value = value
  }

  return {
    // state
    matches,
    loading,
    error,
    quickFilter,
    // derived
    filtered,
    counts,
    // actions
    load,
    assign,
    setStatus,
    remove,
    sendNotification,
    setQuickFilter,
  }
})
