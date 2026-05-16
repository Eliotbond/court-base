import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { FirebaseError } from 'firebase/app'
import type { Registration } from '@club-app/shared-types'
import {
  appendActionLogToDraft,
  createDraft,
  deleteDraft as deleteDraftRepo,
  getRegistrationById,
  isBlockingSelfRegistration,
  isPendingForUser,
  listMyRegistrations,
  updateDraft,
  type CreateDraftInput,
  type UpdateDraftInput,
} from '@/repositories/registrations.repo'
import {
  cancelRegistration as cancelRegistrationCallable,
  matchExistingMember,
  submitRegistration as submitRegistrationCallable,
  type MatchExistingMemberInput,
  type MemberMatch,
  type SubmitRegistrationInput,
} from '@/services/cloudFunctions'

/**
 * Store Registrations — source unique pour l'état "mes inscriptions" + le
 * draft courant du wizard.
 *
 * Architecture :
 *  - `byId` (Map) : cache de toutes les registrations lues (Home + détail).
 *  - `myList` : array réactif des registrations du user courant, triées
 *    `createdAt desc`.
 *  - `currentDraftId` : id du draft en cours d'édition par le wizard. Null
 *    quand pas de wizard ouvert.
 *  - `matches` : résultats du dernier appel à `matchExistingMember`, exposé
 *    pour la modal §4.7 (confirmation utilisateur).
 *
 * Les transitions de status (submit / cancel) passent par les callables et
 * ne sont jamais écrites directement côté client.
 */
/**
 * Clé sessionStorage pour persister l'id du draft en cours entre les refreshes
 * (F5, retour navigateur). Limitée à l'onglet courant — pas localStorage pour
 * éviter les fuites cross-onglets / cross-utilisateurs sur la même machine.
 */
const CURRENT_DRAFT_ID_STORAGE_KEY = 'court-base.register.currentDraftId'

function readPersistedDraftId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage.getItem(CURRENT_DRAFT_ID_STORAGE_KEY)
  } catch {
    // sessionStorage peut throw en mode privé ou si désactivé — on dégrade silencieusement.
    return null
  }
}

function writePersistedDraftId(id: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (id === null) {
      window.sessionStorage.removeItem(CURRENT_DRAFT_ID_STORAGE_KEY)
    } else {
      window.sessionStorage.setItem(CURRENT_DRAFT_ID_STORAGE_KEY, id)
    }
  } catch {
    // idem — ignorer si sessionStorage indisponible.
  }
}

export const useRegistrationsStore = defineStore('registrations', () => {
  const byId = ref<Map<string, Registration>>(new Map())
  const myList = ref<Registration[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Restore au tout premier setup du store : si l'utilisateur rafraîchit en
  // plein milieu du wizard, on retrouve l'id du draft. La validité du draft
  // (status === 'draft', autorisation de lecture) est vérifiée par le wizard
  // au moment d'appeler `loadRegistration` / `resumeDraft`.
  const currentDraftId = ref<string | null>(readPersistedDraftId())
  const matches = ref<MemberMatch[]>([])
  const matchLoading = ref(false)

  function setCurrentDraftId(id: string | null): void {
    currentDraftId.value = id
    writePersistedDraftId(id)
  }

  const currentDraft = computed<Registration | null>(() =>
    currentDraftId.value ? byId.value.get(currentDraftId.value) ?? null : null,
  )

  /**
   * True si le user courant a déjà une inscription "pour soi-même" (`self`)
   * en cours — statut non terminal. Sert à Step1Whoami pour désactiver
   * l'option "self" et empêcher une double inscription pour soi-même.
   *
   * Une inscription self `cancelled` ou `refused` ne bloque pas : la
   * réinscription est autorisée. Basé sur `myList`, qui doit avoir été chargé
   * via `loadMyRegistrations` au préalable.
   */
  const hasActiveSelfRegistration = computed<boolean>(() =>
    myList.value.some(isBlockingSelfRegistration),
  )

  function upsertCache(reg: Registration): void {
    byId.value = new Map(byId.value).set(reg.id, reg)
  }

  // -------------------------------------------------------------------------
  // Listing & detail
  // -------------------------------------------------------------------------

  async function loadMyRegistrations(uid: string): Promise<void> {
    // Reset systématique en début d'appel — sans ça, le bandeau d'erreur
    // persiste après un retry réussi qui suit un échec précédent.
    loading.value = true
    error.value = null
    try {
      const list = await listMyRegistrations(uid)
      myList.value = list
      const next = new Map(byId.value)
      for (const reg of list) next.set(reg.id, reg)
      byId.value = next
    } catch (err) {
      // Log explicite + code Firestore pour faciliter le diagnostic. Cas
      // courants :
      //  - `permission-denied` : rules non déployées, ou user qui essaie de
      //    lister une registration d'un autre user.
      //  - `failed-precondition` : index composite manquant. Depuis qu'on a
      //    retiré `orderBy('createdAt')` ce cas ne devrait plus arriver pour
      //    cette query précise — mais on le garde pour les futurs.
      //  - `unavailable` / `deadline-exceeded` : réseau / Firestore down.
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`loadMyRegistrations failed [${code}]`, err)
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  async function loadRegistration(id: string): Promise<Registration | null> {
    const reg = await getRegistrationById(id)
    if (reg) upsertCache(reg)
    return reg
  }

  // -------------------------------------------------------------------------
  // Wizard draft lifecycle
  // -------------------------------------------------------------------------

  async function startDraft(input: CreateDraftInput): Promise<Registration> {
    const created = await createDraft(input)
    upsertCache(created)
    myList.value = [created, ...myList.value]
    setCurrentDraftId(created.id)
    return created
  }

  function resumeDraft(registrationId: string): void {
    setCurrentDraftId(registrationId)
  }

  function clearDraft(): void {
    setCurrentDraftId(null)
  }

  async function patchDraft(patch: UpdateDraftInput): Promise<void> {
    if (!currentDraftId.value) {
      throw new Error('No active draft to patch')
    }
    await updateDraft(currentDraftId.value, patch)
    // Re-fetch pour récupérer les valeurs serveur (statusUpdatedAt).
    const refreshed = await loadRegistration(currentDraftId.value)
    if (refreshed) {
      // Met à jour myList aussi (cohérence vue Home).
      const i = myList.value.findIndex((r) => r.id === refreshed.id)
      if (i >= 0) myList.value[i] = refreshed
    }
  }

  async function logDraftAction(byUid: string, note: string): Promise<void> {
    if (!currentDraftId.value) return
    await appendActionLogToDraft(currentDraftId.value, {
      byUid,
      action: 'status_changed',
      previousStatus: 'draft',
      newStatus: 'draft',
      note,
    })
  }

  // -------------------------------------------------------------------------
  // Callables
  // -------------------------------------------------------------------------

  async function findMatches(input: MatchExistingMemberInput): Promise<MemberMatch[]> {
    matchLoading.value = true
    try {
      const out = await matchExistingMember(input)
      matches.value = out.matches
      return out.matches
    } finally {
      matchLoading.value = false
    }
  }

  function clearMatches(): void {
    matches.value = []
  }

  async function submit(
    input: Omit<SubmitRegistrationInput, 'draftRegistrationId'>,
  ): Promise<Registration> {
    const fullInput: SubmitRegistrationInput = currentDraftId.value
      ? { ...input, draftRegistrationId: currentDraftId.value }
      : input
    const out = await submitRegistrationCallable(fullInput)
    const reg = await loadRegistration(out.registrationId)
    if (!reg) {
      throw new Error(`Submitted registration ${out.registrationId} not readable`)
    }
    // Maj `myList` : remplace si déjà présent (draft → submitted), sinon insère.
    const i = myList.value.findIndex((r) => r.id === reg.id)
    if (i >= 0) myList.value[i] = reg
    else myList.value = [reg, ...myList.value]
    setCurrentDraftId(null)
    return reg
  }

  async function cancel(registrationId: string, note?: string): Promise<void> {
    await cancelRegistrationCallable({ registrationId, note: note ?? null })
    const refreshed = await loadRegistration(registrationId)
    if (refreshed) {
      const i = myList.value.findIndex((r) => r.id === refreshed.id)
      if (i >= 0) myList.value[i] = refreshed
    }
  }

  /**
   * Supprime un draft (status `'draft'` uniquement — rules Firestore l'enforcent).
   * Retire le doc de `myList` et `byId`, et clear `currentDraftId` s'il pointait
   * sur ce draft.
   */
  async function removeDraft(registrationId: string): Promise<void> {
    await deleteDraftRepo(registrationId)
    myList.value = myList.value.filter((r) => r.id !== registrationId)
    if (byId.value.has(registrationId)) {
      const next = new Map(byId.value)
      next.delete(registrationId)
      byId.value = next
    }
    if (currentDraftId.value === registrationId) {
      setCurrentDraftId(null)
    }
  }

  return {
    // State
    byId,
    myList,
    loading,
    error,
    currentDraftId,
    currentDraft,
    hasActiveSelfRegistration,
    matches,
    matchLoading,
    // Helpers
    isPendingForUser,
    // Actions
    loadMyRegistrations,
    loadRegistration,
    startDraft,
    resumeDraft,
    clearDraft,
    patchDraft,
    logDraftAction,
    findMatches,
    clearMatches,
    submit,
    cancel,
    removeDraft,
  }
})
