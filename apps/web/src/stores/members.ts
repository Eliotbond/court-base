import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { FirebaseError } from 'firebase/app'
import type { Timestamp } from '@club-app/shared-types'
import {
  addGuardian as repoAddGuardian,
  createMember as repoCreateMember,
  deleteMemberPermanently as repoDeleteMember,
  getMemberById as repoGetMemberById,
  listMembers,
  removeGuardian as repoRemoveGuardian,
  setLinkedUser as repoSetLinkedUser,
  updateMember as repoUpdateMember,
  type CreateMemberInput,
  type MemberCommsPatch,
  type MemberRow,
} from '@/repositories/members.repo'
import type { DeleteMemberOutput } from '@/services/cloudFunctions'

/**
 * Filtres rapides (chips) — alignés sur le design Mockups (screen 2).
 * `all` désactive tous les autres ; un seul chip de rôle/statut à la fois.
 *
 * `minors` : membres avec `birthDate` dans les 18 dernières années.
 * `birthDate === null` est traité comme adulte (cf. `isMinor` ci-dessous).
 */
export type MemberQuickFilter =
  | 'all'
  | 'players'
  | 'officials'
  | 'coachs'
  | 'comite'
  | 'unlicensed'
  | 'duesOverdue'
  | 'minors'

/** Âge légal de majorité (CH). Aligné avec `members.repo.ts`. */
const MAJORITY_AGE_YEARS = 18

/**
 * Vrai si `birthDate` est antérieure à `now` mais postérieure à `now - 18 ans`.
 * `null` (date inconnue) → faux. Voir le commentaire du type `MemberData.birthDate` :
 * en l'absence de date connue, on traite le membre comme adulte côté defaults.
 *
 * On reste local au store (pas dans shared-types qui n'a pas de logique).
 */
function isMinor(birthDate: Timestamp | null, now: number = Date.now()): boolean {
  if (!birthDate) return false
  const birthMs = birthDate.seconds * 1000
  const cutoffMs = new Date(now)
  cutoffMs.setFullYear(cutoffMs.getFullYear() - MAJORITY_AGE_YEARS)
  return birthMs > cutoffMs.getTime()
}

/**
 * Source unique des données affichées sur l'écran Members.
 *
 * `load()` appelle le repo une fois ; la vue passe ensuite par `filtered`
 * qui dérive la liste affichée du `quickFilter` actif + de la recherche
 * texte. Voir docs/frontend-desktop.md (architecture en couches) : la vue
 * ne lit JAMAIS le repo directement.
 */
export const useMembersStore = defineStore('members', () => {
  const members = ref<MemberRow[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  /** Chip filter actif. */
  const quickFilter = ref<MemberQuickFilter>('all')
  /** Texte saisi dans la search box (nom / email / téléphone). */
  const search = ref('')
  /**
   * Toggle "archived" : par défaut on n'affiche QUE les membres `status ===
   * 'active'` (cf. shared-types `MemberStatus`). Quand `true`, on n'affiche
   * QUE les archivés (vue dédiée). Quand `null`, on affiche tout (debug /
   * super-admin).
   */
  const archivedView = ref<'active' | 'archived'>('active')

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      members.value = await listMembers()
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur de chargement des membres'
    } finally {
      loading.value = false
    }
  }

  function setQuickFilter(value: MemberQuickFilter): void {
    quickFilter.value = value
  }

  function setArchivedView(value: 'active' | 'archived'): void {
    archivedView.value = value
  }

  function setSearch(value: string): void {
    search.value = value
  }

  /**
   * Recharge un seul membre depuis Firestore et met à jour `members` en
   * place (préserve l'ordre). Utilisé après une mutation sur ce membre pour
   * refléter les champs dérivés (teamLabels, contact) sans `listMembers`.
   * Si le membre n'existe plus, on le retire de la liste.
   */
  async function refreshOne(memberId: string): Promise<void> {
    const next = await repoGetMemberById(memberId)
    const idx = members.value.findIndex((m) => m.id === memberId)
    if (next === null) {
      if (idx >= 0) members.value.splice(idx, 1)
      return
    }
    if (idx >= 0) members.value.splice(idx, 1, next)
    else {
      // Membre nouvellement éligible (rare via cette route) — insertion triée.
      members.value = [...members.value, next].sort((a, b) =>
        a.lastName.localeCompare(b.lastName, 'fr'),
      )
    }
  }

  /**
   * Crée un membre via le repository et l'insère dans `members` en préservant
   * le tri par `lastName` (ordre du `listMembers`). Retourne l'id du nouveau
   * membre, ou `null` en cas d'erreur (le message est posé dans `error`).
   */
  async function createMember(input: CreateMemberInput): Promise<string | null> {
    error.value = null
    try {
      const row = await repoCreateMember(input)
      // Insertion triée par lastName (locale française) pour rester cohérent
      // avec l'ordre du `listMembers`. Stable + simple : O(n) acceptable
      // pour quelques centaines de membres.
      const next = [...members.value, row].sort((a, b) =>
        a.lastName.localeCompare(b.lastName, 'fr'),
      )
      members.value = next
      return row.id
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors de la création du membre'
      return null
    }
  }

  /**
   * Met à jour la `birthDate` d'un membre. `null` efface (date inconnue).
   * Le repo re-aligne automatiquement les defaults `comms` si aucune
   * transition de majorité n'est en cours.
   */
  async function setBirthDate(
    memberId: string,
    date: Date | null,
  ): Promise<boolean> {
    error.value = null
    try {
      await repoUpdateMember(memberId, { birthDate: date })
      await refreshOne(memberId)
      return true
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors de la mise à jour de la date de naissance'
      return false
    }
  }

  /**
   * Met à jour le n° AVS d'un membre. `null` efface (n° inconnu).
   * Pas de validation de format ici — c'est à l'UI de vérifier (cf.
   * `AVS_REGEX` dans Members.vue / ProfileTab.vue).
   */
  async function setAvs(
    memberId: string,
    avs: string | null,
  ): Promise<boolean> {
    error.value = null
    try {
      await repoUpdateMember(memberId, { avs })
      await refreshOne(memberId)
      return true
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors de la mise à jour du n° AVS'
      return false
    }
  }

  /**
   * Lie un user comme tuteur d'un membre. Atomique côté repo (member +
   * user.roles 'parent'). Idempotent.
   */
  async function addGuardian(
    memberId: string,
    userId: string,
  ): Promise<boolean> {
    error.value = null
    try {
      await repoAddGuardian(memberId, userId)
      await refreshOne(memberId)
      return true
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors de l\'ajout du tuteur'
      return false
    }
  }

  /**
   * Délie un user d'un membre. Retire le rôle `'parent'` du user s'il
   * n'est plus tuteur d'aucun autre membre (logique côté repo).
   */
  async function removeGuardian(
    memberId: string,
    userId: string,
  ): Promise<boolean> {
    error.value = null
    try {
      await repoRemoveGuardian(memberId, userId)
      await refreshOne(memberId)
      return true
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors du retrait du tuteur'
      return false
    }
  }

  /**
   * Lie un compte Firebase Auth `/users/{uid}` comme titulaire du membre
   * (ou délie si `uid === null`). Atomique côté repo (member.linkedUserId
   * + user.memberId, clear orphans des deux côtés).
   *
   * Typique : un parent inscrit son enfant via `apps/courtbase-register`,
   * l'admin convertit la registration en member et associe ensuite le user
   * d'inscription au member créé. `null` casse la liaison.
   */
  async function setLinkedUser(
    memberId: string,
    uid: string | null,
  ): Promise<boolean> {
    error.value = null
    try {
      await repoSetLinkedUser(memberId, uid)
      await refreshOne(memberId)
      return true
    } catch (err: unknown) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`setLinkedUser failed [${code}]`, err)
      error.value =
        err instanceof Error
          ? err.message
          : 'Erreur lors de la liaison du compte'
      return false
    }
  }

  /**
   * Suppression DÉFINITIVE d'un membre (correction d'erreur de création).
   *
   * Distinct du flow d'archive (`status === 'archived'`). Appelle la callable
   * `deleteMember` côté serveur, et — sur succès — retire le membre du state
   * local. Sur erreur, propage telle quelle pour que l'UI puisse adapter le
   * message selon `err.code` (cf. `DeleteMemberDialog`) :
   *   - `failed-precondition` → dues paid existent → suggérer l'archive
   *   - `invalid-argument`    → confirmName mismatch
   *   - autres                → message générique
   *
   * Pas de bool de retour ici (contrairement aux autres mutations) : l'UI a
   * besoin du `DeleteMemberOutput` (counts) pour confirmation visuelle, et de
   * l'erreur typée FirebaseError pour discriminer les cas.
   */
  async function deletePermanently(
    memberId: string,
    confirmName: string,
  ): Promise<DeleteMemberOutput> {
    error.value = null
    try {
      const result = await repoDeleteMember(memberId, confirmName)
      // Retire le membre du state local. Tri préservé (filter conserve l'ordre).
      members.value = members.value.filter((m) => m.id !== memberId)
      return result
    } catch (err: unknown) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`deletePermanently failed [${code}]`, err)
      error.value =
        err instanceof Error
          ? err.message
          : 'Erreur lors de la suppression du membre'
      // Propage la FirebaseError (le caller branche sur err.code).
      throw err
    }
  }

  /**
   * Met à jour la configuration `comms` d'un membre (billing / general
   * recipients). `majorityTransition` n'est pas exposée ici — c'est piloté
   * par les Cloud Functions.
   */
  async function setComms(
    memberId: string,
    patch: MemberCommsPatch,
  ): Promise<boolean> {
    error.value = null
    try {
      await repoUpdateMember(memberId, { comms: patch })
      await refreshOne(memberId)
      return true
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors de la mise à jour des comms'
      return false
    }
  }

  // -------------------------------------------------------------------------
  // Derived counts (used pour les badges des chips, ex. "All 142").
  // -------------------------------------------------------------------------

  /**
   * Filtre par status (`active`/`archived`) appliqué AVANT les chips & search.
   * `MemberData.status` est `'active' | 'archived'`. Lignes legacy sans champ
   * `status` (avant ajout shared-types) sont traitées comme `'active'`.
   */
  function statusOf(m: MemberRow): 'active' | 'archived' {
    return m.status === 'archived' ? 'archived' : 'active'
  }

  const visibleByStatus = computed<MemberRow[]>(() => {
    return members.value.filter((m) => statusOf(m) === archivedView.value)
  })

  const counts = computed(() => {
    const list = visibleByStatus.value
    const now = Date.now()
    return {
      all: list.length,
      active: list.filter((m) => m.active).length,
      players: list.filter((m) => m.roles.includes('player')).length,
      officials: list.filter((m) => m.roles.includes('official')).length,
      coachs: list.filter((m) => m.roles.includes('coach')).length,
      comite: list.filter((m) => m.roles.includes('comite')).length,
      unlicensed: list.filter((m) => !m.licensed).length,
      duesOverdue: list.filter((m) => m.duesStatus === 'overdue' || m.duesStatus === 'excluded').length,
      minors: list.filter((m) => isMinor(m.birthDate, now)).length,
      /** Compteur global des archivés (toujours basé sur la liste complète). */
      archived: members.value.filter((m) => m.status === 'archived').length,
    }
  })

  // -------------------------------------------------------------------------
  // Filtered list — chip + recherche texte.
  // -------------------------------------------------------------------------

  function matchesQuickFilter(m: MemberRow, f: MemberQuickFilter): boolean {
    switch (f) {
      case 'all':
        return true
      case 'players':
        return m.roles.includes('player')
      case 'officials':
        return m.roles.includes('official')
      case 'coachs':
        return m.roles.includes('coach')
      case 'comite':
        return m.roles.includes('comite')
      case 'unlicensed':
        return !m.licensed
      case 'duesOverdue':
        // `excluded` est un downstream prolongé d'`overdue` (cf. docs/main.md
        // lifecycle dues) — inclure les deux dans le filtre "Cotisation en retard".
        return m.duesStatus === 'overdue' || m.duesStatus === 'excluded'
      case 'minors':
        return isMinor(m.birthDate)
      default:
        return true
    }
  }

  function matchesSearch(m: MemberRow, q: string): boolean {
    if (!q) return true
    const needle = q.trim().toLowerCase()
    if (!needle) return true
    const haystack = [
      m.firstName,
      m.lastName,
      `${m.firstName} ${m.lastName}`,
      m.email ?? '',
      m.phone ?? '',
      m.licenseNumber,
      ...m.teamLabels,
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(needle)
  }

  const filtered = computed<MemberRow[]>(() => {
    const f = quickFilter.value
    const q = search.value
    return visibleByStatus.value.filter(
      (m) => matchesQuickFilter(m, f) && matchesSearch(m, q),
    )
  })

  return {
    // state
    members,
    loading,
    error,
    quickFilter,
    search,
    archivedView,
    // derived
    counts,
    filtered,
    // actions
    load,
    setQuickFilter,
    setArchivedView,
    setSearch,
    createMember,
    setBirthDate,
    setAvs,
    addGuardian,
    removeGuardian,
    setLinkedUser,
    setComms,
    deletePermanently,
  }
})
