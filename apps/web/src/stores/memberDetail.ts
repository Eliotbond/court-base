import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { FirebaseError } from 'firebase/app'
import {
  getMemberDetail,
  removeMemberPhoto,
  updateMember,
  updateMemberContact,
  uploadMemberPhoto,
  type MemberContactPatch,
  type MemberDetailRow,
  type MemberPatch,
} from '@/repositories/members.repo'

/**
 * Store de la page Member detail (/members/:id).
 *
 * Charge UN membre enrichi (`MemberDetailRow`) avec ses jointures de
 * première ligne (contact, teams, linkedUser). Les sub-features (cotisations,
 * présences, officiel, demandes) sont implémentées comme des composables /
 * repos indépendants côté tabs (cf. apps/web/src/components/member-detail/).
 *
 * Les mutations (updateProfile / updateContact) appliquent une mise à jour
 * locale puis reload depuis le repo pour réconcilier — utile car certaines
 * transitions déclenchent des Functions backend (dues, syncMemberDuesStatus)
 * qui peuvent changer d'autres champs hors patch.
 *
 * Le flag `active` (Actif / Inactif) n'est PAS muté ici : il passe par le
 * store `members` (`setMemberActive`), seul point de contrôle du flag — cf.
 * le toggle de `ProfileTab.vue`.
 */
export const useMemberDetailStore = defineStore('memberDetail', () => {
  const member = ref<MemberDetailRow | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** ID du membre couramment chargé (sert de garde anti-stale-load). */
  const loadedId = ref<string | null>(null)
  /** Une mutation est en cours (UI feedback : disable boutons). */
  const saving = ref(false)

  async function load(id: string): Promise<void> {
    loading.value = true
    error.value = null
    loadedId.value = id
    try {
      const row = await getMemberDetail(id)
      // Garde anti-race : si l'utilisateur a navigué vers un autre membre
      // entre-temps, on ignore le résultat de cette query.
      if (loadedId.value !== id) return
      member.value = row
    } catch (e: unknown) {
      if (loadedId.value !== id) return
      error.value =
        e instanceof Error ? e.message : 'Erreur de chargement du membre'
    } finally {
      if (loadedId.value === id) loading.value = false
    }
  }

  /** Vide le store quand la vue est démontée. */
  function reset(): void {
    member.value = null
    loadedId.value = null
    error.value = null
    loading.value = false
    saving.value = false
  }

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  async function applyProfilePatch(patch: MemberPatch): Promise<void> {
    if (!member.value) return
    const id = member.value.id
    saving.value = true
    try {
      await updateMember(id, patch)
      // Reload : `syncMemberDuesStatus` peut modifier des champs en cascade.
      await load(id)
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors de la mise à jour'
    } finally {
      saving.value = false
    }
  }

  async function applyContactPatch(patch: MemberContactPatch): Promise<void> {
    if (!member.value) return
    const id = member.value.id
    saving.value = true
    try {
      await updateMemberContact(id, patch)
      await load(id)
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors de la mise à jour du contact'
    } finally {
      saving.value = false
    }
  }

  // -------------------------------------------------------------------------
  // Photo licence (cf. docs/members/license-photo.md). Mutations wrappent le
  // repo, mettent à jour le member local sur succès, et reload pour rester
  // cohérent avec d'éventuels champs serveur (`photoUpdatedAt` posé via
  // `serverTimestamp`).
  // Catch enrichi `FirebaseError` (cf. apps/web/CLAUDE.md §"Catch enrichi
  // obligatoire").
  // -------------------------------------------------------------------------

  /**
   * Upload une nouvelle photo licence pour le membre courant. Pré-validations
   * (MIME / taille) côté repo — un `Error` levé localement (pas Firebase) est
   * une erreur de validation client à présenter telle quelle.
   * Retourne `true` sur succès, `false` sinon (avec `error` posé).
   */
  async function uploadPhoto(file: File): Promise<boolean> {
    if (!member.value) return false
    const id = member.value.id
    saving.value = true
    error.value = null
    try {
      await uploadMemberPhoto(id, file)
      // Reload pour récupérer photoUpdatedAt (serverTimestamp).
      await load(id)
      return true
    } catch (err: unknown) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`[memberDetail.uploadPhoto] failed [${code}]`, err)
      error.value =
        err instanceof Error
          ? err.message
          : 'Erreur lors de l\'upload de la photo licence'
      return false
    } finally {
      saving.value = false
    }
  }

  /**
   * Supprime la photo licence du membre courant. Réservé admin/rootAdmin
   * (vérifié serveur — un caller non-admin reçoit `permission-denied`).
   * Retourne `true` sur succès, `false` sinon.
   */
  async function removePhoto(): Promise<boolean> {
    if (!member.value) return false
    const id = member.value.id
    saving.value = true
    error.value = null
    try {
      await removeMemberPhoto(id)
      await load(id)
      return true
    } catch (err: unknown) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`[memberDetail.removePhoto] failed [${code}]`, err)
      error.value =
        err instanceof Error
          ? err.message
          : 'Erreur lors de la suppression de la photo licence'
      return false
    } finally {
      saving.value = false
    }
  }

  // -------------------------------------------------------------------------
  // Derived
  // -------------------------------------------------------------------------

  const fullName = computed(() =>
    member.value ? `${member.value.firstName} ${member.value.lastName}` : '',
  )

  const isOfficial = computed(() => member.value?.officialLevel !== null && member.value?.officialLevel !== undefined)
  const isPlayer = computed(() => member.value?.roles.includes('player') ?? false)
  const isCoach = computed(() => member.value?.roles.includes('coach') ?? false)

  return {
    // state
    member,
    loading,
    error,
    saving,
    // derived
    fullName,
    isOfficial,
    isPlayer,
    isCoach,
    // actions
    load,
    reset,
    applyProfilePatch,
    applyContactPatch,
    uploadPhoto,
    removePhoto,
  }
})
