import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  archiveMember,
  getMemberDetail,
  reactivateMember,
  updateMember,
  updateMemberContact,
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
 * Les mutations (updateProfile / updateContact / archive / reactivate)
 * appliquent une mise à jour optimiste locale puis reload depuis le repo
 * pour réconcilier — utile car certaines transitions déclenchent des
 * Functions backend (dues, syncMemberDuesStatus) qui peuvent changer
 * d'autres champs hors patch.
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

  async function archive(): Promise<void> {
    if (!member.value) return
    const id = member.value.id
    saving.value = true
    try {
      await archiveMember(id)
      await load(id)
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : "Erreur lors de l'archivage"
    } finally {
      saving.value = false
    }
  }

  async function reactivate(): Promise<void> {
    if (!member.value) return
    const id = member.value.id
    saving.value = true
    try {
      await reactivateMember(id)
      await load(id)
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors de la réactivation'
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
    archive,
    reactivate,
  }
})
