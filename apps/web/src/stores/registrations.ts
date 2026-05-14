import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { FirebaseError } from 'firebase/app'
import type { RegistrationStatus } from '@club-app/shared-types'
import {
  ACTIVE_STATUSES,
  listAllNonDraftRegistrations,
  listRegistrationsForTeams,
  type RegistrationRow,
} from '@/repositories/registrations.repo'
import {
  refuseRegistration as callRefuseRegistration,
  cancelRegistration as callCancelRegistration,
  markTrialInProgress as callMarkTrialInProgress,
  confirmRegistration as callConfirmRegistration,
} from '@/services/cloudFunctions'
import { useAuthStore } from './auth'

/**
 * Filtres rapides (chips) — gating par catégorie de statut.
 *
 *  - `active`   : statuts non-terminaux (par défaut — "en cours")
 *  - `submitted`: en attente d'examen / d'essai
 *  - `trial`    : conditional_pending_trial + open_pending_trial + trial_in_progress
 *  - `done`     : confirmed_pending_dues + active
 *  - `terminal` : refused + cancelled
 *  - `all`      : tout sauf draft (équivalent à la collection chargée)
 */
export type RegistrationQuickFilter =
  | 'all'
  | 'active'
  | 'submitted'
  | 'trial'
  | 'done'
  | 'terminal'

/**
 * Filtre par équipe. `'all'` = pas de filtrage, sinon un `teamId`.
 */
export type RegistrationTeamFilter = 'all' | string

/**
 * Source unique des données de l'écran Inscriptions (côté admin + coach).
 *
 * `load()` scope automatiquement la lecture :
 *  - admin / rootAdmin → `listAllNonDraftRegistrations` (toute la collection).
 *  - coach            → `listRegistrationsForTeams(user.teamIds)` (équipes propres).
 *
 * Voir docs/frontend-desktop.md (architecture en couches) : la vue ne lit
 * JAMAIS le repo directement.
 *
 * Actions (`refuse`, `cancel`) appellent les callables wrappées par
 * `services/cloudFunctions.ts` puis re-`load()` pour récupérer le doc à jour
 * (transitions de status pilotées côté server — pas d'optimistic update).
 */
export const useRegistrationsStore = defineStore('registrations', () => {
  const auth = useAuthStore()

  // ---------------------- State ----------------------
  const items = ref<RegistrationRow[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  /** Filtre chip primaire (statut). Par défaut "en cours". */
  const quickFilter = ref<RegistrationQuickFilter>('active')
  /** Filtre par équipe (chip / select). */
  const teamFilter = ref<RegistrationTeamFilter>('all')
  /** Texte saisi (nom joueur, ancien club…). */
  const search = ref('')

  /** Id de la registration sélectionnée pour le drawer. `null` = drawer fermé. */
  const selectedRegistrationId = ref<string | null>(null)
  /** Loading flag par registration (utilisé par les boutons d'action). */
  const actionPendingId = ref<string | null>(null)

  // ---------------------- Computed ----------------------

  const isAdminScope = computed<boolean>(() => {
    if (auth.rootAdmin) return true
    return auth.roles.includes('admin')
  })

  /** Catégories de statuts mappées aux chip filters. */
  function statusBucket(status: RegistrationStatus): RegistrationQuickFilter[] {
    const buckets: RegistrationQuickFilter[] = ['all']
    const isTerminal =
      status === 'refused' || status === 'cancelled' || status === 'active'
    if (!isTerminal) buckets.push('active')
    if (status === 'submitted' || status === 'conditional_pending_review') {
      buckets.push('submitted')
    }
    if (
      status === 'open_pending_trial' ||
      status === 'conditional_pending_trial' ||
      status === 'trial_in_progress'
    ) {
      buckets.push('trial')
    }
    if (status === 'confirmed_pending_dues' || status === 'active') {
      buckets.push('done')
    }
    if (status === 'refused' || status === 'cancelled') {
      buckets.push('terminal')
    }
    return buckets
  }

  /** Liste filtrée par chip + équipe + recherche texte. */
  const filtered = computed<RegistrationRow[]>(() => {
    const q = search.value.trim().toLowerCase()
    const chip = quickFilter.value
    const team = teamFilter.value
    return items.value.filter((r) => {
      if (chip !== 'all' && !statusBucket(r.status).includes(chip)) return false
      if (team !== 'all' && r.teamId !== team) return false
      if (q.length > 0) {
        const haystack = [
          r.playerFullName,
          r.team?.name ?? '',
          r.previousClubName ?? '',
          r.refusalReason ?? '',
        ]
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  })

  /**
   * Counts par chip — affichés à côté du libellé (UX cohérente avec Members /
   * Teams). Calculé à partir du dataset complet (pas filtré par équipe / recherche)
   * pour rester stable quand l'utilisateur change de chip.
   */
  const counts = computed(() => {
    const c: Record<RegistrationQuickFilter, number> = {
      all: 0,
      active: 0,
      submitted: 0,
      trial: 0,
      done: 0,
      terminal: 0,
    }
    for (const r of items.value) {
      for (const b of statusBucket(r.status)) c[b]++
    }
    return c
  })

  /** Liste des équipes représentées dans le dataset (pour le filtre Select). */
  const teamsInList = computed<Array<{ id: string; name: string; count: number }>>(() => {
    const map = new Map<string, { id: string; name: string; count: number }>()
    for (const r of items.value) {
      const id = r.team?.id ?? r.teamId
      const name = r.team?.name ?? '— équipe inconnue —'
      const existing = map.get(id)
      if (existing) existing.count++
      else map.set(id, { id, name, count: 1 })
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  })

  /** Registration courante (drawer). */
  const selectedRegistration = computed<RegistrationRow | null>(() => {
    const id = selectedRegistrationId.value
    if (!id) return null
    return items.value.find((r) => r.id === id) ?? null
  })

  // ---------------------- Actions ----------------------

  /**
   * Charge la liste selon le scope du caller.
   * Admin / rootAdmin → toute la collection ; coach → ses équipes uniquement.
   */
  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      if (isAdminScope.value) {
        items.value = await listAllNonDraftRegistrations()
      } else {
        const teamIds = auth.userDoc?.teamIds ?? []
        items.value = await listRegistrationsForTeams(teamIds)
      }
    } catch (err: unknown) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`loadRegistrations failed [${code}]`, err)
      error.value =
        err instanceof Error ? err.message : 'Erreur de chargement des inscriptions'
    } finally {
      loading.value = false
    }
  }

  function setQuickFilter(value: RegistrationQuickFilter): void {
    quickFilter.value = value
  }

  function setTeamFilter(value: RegistrationTeamFilter): void {
    teamFilter.value = value
  }

  function setSearch(value: string): void {
    search.value = value
  }

  function openDrawer(id: string): void {
    selectedRegistrationId.value = id
  }

  function closeDrawer(): void {
    selectedRegistrationId.value = null
  }

  /**
   * Refuse une registration via la callable serveur. Le log d'audit
   * `/teams/{teamId}/refusalLogs` est écrit côté server (impossible côté client
   * via rules). Recharge la liste après succès pour récupérer le nouveau
   * `status` + `refusalReason`.
   */
  async function refuse(registrationId: string, reason: string): Promise<boolean> {
    actionPendingId.value = registrationId
    error.value = null
    try {
      await callRefuseRegistration({ registrationId, reason })
      await load()
      return true
    } catch (err: unknown) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`refuseRegistration failed [${code}]`, err)
      error.value =
        err instanceof Error ? err.message : 'Refus impossible'
      return false
    } finally {
      actionPendingId.value = null
    }
  }

  /**
   * Passe une registration en `trial_in_progress` (entraînement planifié) —
   * démarre le compteur 14 j (scheduled `onTrialExpired` à venir). Idempotent
   * côté server : un re-call ne réinitialise pas `trialStartedAt`.
   */
  async function markTrial(registrationId: string): Promise<boolean> {
    actionPendingId.value = registrationId
    error.value = null
    try {
      await callMarkTrialInProgress({ registrationId })
      await load()
      return true
    } catch (err: unknown) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`markTrialInProgress failed [${code}]`, err)
      error.value =
        err instanceof Error ? err.message : "Impossible de démarrer l'essai"
      return false
    } finally {
      actionPendingId.value = null
    }
  }

  /**
   * Confirme une registration en cours d'essai : crée le `/members/{id}`
   * (si nouveau), ajoute le member à `team.playerIds` (déclenche
   * `initiateDuesOnPlayerActivation` → cotisation émise automatiquement),
   * passe la registration en `confirmed_pending_dues`.
   */
  async function confirmToDues(registrationId: string): Promise<boolean> {
    actionPendingId.value = registrationId
    error.value = null
    try {
      await callConfirmRegistration({ registrationId })
      await load()
      return true
    } catch (err: unknown) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`confirmRegistration failed [${code}]`, err)
      error.value =
        err instanceof Error ? err.message : 'Confirmation impossible'
      return false
    } finally {
      actionPendingId.value = null
    }
  }

  /**
   * Annule une registration (auteur uniquement côté server). Côté admin/coach,
   * cet appel échouera en `permission-denied` sauf si le caller est aussi le
   * `submittedByUid` — utile uniquement quand un admin gère sa propre
   * inscription. Maintenu pour symétrie ; sera remplacé par une callable
   * `adminCancelRegistration` séparée plus tard.
   */
  async function cancel(registrationId: string, note?: string | null): Promise<boolean> {
    actionPendingId.value = registrationId
    error.value = null
    try {
      await callCancelRegistration({ registrationId, note: note ?? null })
      await load()
      return true
    } catch (err: unknown) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`cancelRegistration failed [${code}]`, err)
      error.value =
        err instanceof Error ? err.message : 'Annulation impossible'
      return false
    } finally {
      actionPendingId.value = null
    }
  }

  return {
    // state
    items,
    loading,
    error,
    quickFilter,
    teamFilter,
    search,
    selectedRegistrationId,
    actionPendingId,
    // computed
    isAdminScope,
    filtered,
    counts,
    teamsInList,
    selectedRegistration,
    // actions
    load,
    setQuickFilter,
    setTeamFilter,
    setSearch,
    openDrawer,
    closeDrawer,
    refuse,
    cancel,
    markTrial,
    confirmToDues,
  }
})

/**
 * Re-export pour les vues : permet d'utiliser `ACTIVE_STATUSES` sans
 * dépendre du repo directement (architecture en couches).
 */
export { ACTIVE_STATUSES }
