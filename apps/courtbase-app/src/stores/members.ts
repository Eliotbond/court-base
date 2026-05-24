/**
 * Store Members — cache par équipe (coach app).
 *
 * Charge les membres d'une équipe à la demande via `listMembersByIds`
 * (Firestore réel). Cache par teamId pour éviter les refetches lors de
 * navigations rapides entre TeamRoster → MemberDetail → retour.
 *
 * Pourquoi un cache par teamId (et pas un cache par memberId) :
 *   - La granularité de fetch de la coach app est la team (TeamRoster +
 *     MyTeams stats). Un cache par team correspond à l'usage réel.
 *   - Pas de tentative de joindre les caches entre teams (un joueur peut
 *     être dans plusieurs équipes — pas un problème pour MVP).
 *   - Invalidation simple : `invalidate(teamId)` ou `reset()` global.
 *
 * Pattern hybride (cf. `apps/courtbase-app/CLAUDE.md`) : le store n'a pas
 * de fallback mock — c'est aux vues de choisir entre repo mock et ce store
 * selon que `auth.userDoc?.memberId` existe ou pas.
 */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import {
  getMember,
  listMembersByIds,
  removeMemberPhoto as repoRemovePhoto,
  uploadMemberPhoto as repoUploadPhoto,
} from '@/repositories/members.repo'
import type { MockMember } from '@/types/mock'

export const useMembersStore = defineStore('members', () => {
  // ─── State ──────────────────────────────────────────────────────
  /** Cache `teamId → MockMember[]`. */
  const byTeamId = ref<Map<string, MockMember[]>>(new Map())
  /** Teams en cours de fetch (pour gating UI). */
  const loadingTeamIds = ref<Set<string>>(new Set())
  /** Dernière erreur de fetch, par teamId. */
  const errorByTeamId = ref<Map<string, string>>(new Map())

  // ─── Actions ────────────────────────────────────────────────────

  /**
   * Charge les membres d'une équipe à partir de ses `playerIds` (issus de
   * `team.playerIds`). Idempotent : ne refetch pas si déjà en cache (utiliser
   * `invalidate(teamId)` pour forcer).
   *
   * @param teamId   — clé de cache.
   * @param playerIds — ids des membres à fetch. `[]` → vide le cache de la team.
   * @returns la liste de membres (depuis le cache ou fraîchement chargée).
   */
  async function loadForTeam(
    teamId: string,
    playerIds: ReadonlyArray<string>,
  ): Promise<MockMember[]> {
    if (!teamId) return []
    if (byTeamId.value.has(teamId) && !loadingTeamIds.value.has(teamId)) {
      return byTeamId.value.get(teamId) ?? []
    }
    if (loadingTeamIds.value.has(teamId)) {
      // Déjà un fetch en cours — on attend pas, on retourne ce qu'on a (vide
      // sera remplacé par la version finale via la réactivité Pinia).
      return byTeamId.value.get(teamId) ?? []
    }
    if (playerIds.length === 0) {
      byTeamId.value.set(teamId, [])
      // Force re-render — Vue ne détecte pas les mutations Map sans nouvelle réf.
      byTeamId.value = new Map(byTeamId.value)
      return []
    }
    loadingTeamIds.value.add(teamId)
    loadingTeamIds.value = new Set(loadingTeamIds.value)
    errorByTeamId.value.delete(teamId)
    try {
      const members = await listMembersByIds(playerIds)
      byTeamId.value.set(teamId, members)
      byTeamId.value = new Map(byTeamId.value)
      return members
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[members.store] loadForTeam(${teamId}) failed`, err)
      errorByTeamId.value.set(teamId, message)
      errorByTeamId.value = new Map(errorByTeamId.value)
      byTeamId.value.set(teamId, [])
      byTeamId.value = new Map(byTeamId.value)
      return []
    } finally {
      loadingTeamIds.value.delete(teamId)
      loadingTeamIds.value = new Set(loadingTeamIds.value)
    }
  }

  /** Force le refetch au prochain `loadForTeam(teamId, …)`. */
  function invalidate(teamId: string): void {
    byTeamId.value.delete(teamId)
    byTeamId.value = new Map(byTeamId.value)
  }

  // ─── Photo licence (cf. docs/members/license-photo.md) ─────────────

  /**
   * Patch un member dans toutes les teams du cache où il apparaît. Sert à
   * propager un update photo sans refetcher tout le roster.
   */
  function patchMemberInCaches(updated: MockMember): void {
    let changed = false
    for (const [teamId, members] of byTeamId.value.entries()) {
      const idx = members.findIndex((m) => m.id === updated.id)
      if (idx === -1) continue
      const next = members.slice()
      next[idx] = updated
      byTeamId.value.set(teamId, next)
      changed = true
    }
    if (changed) byTeamId.value = new Map(byTeamId.value)
  }

  /**
   * Upload une nouvelle photo licence pour le member donné.
   *
   * Pipeline :
   *  1. Upload Storage + callable (cf. `uploadMemberPhoto` dans le repo).
   *  2. Refetch du member via `getMember` pour récupérer `photoStoragePath`
   *     + `photoUpdatedAt` fraîchement posés serveur-side.
   *  3. Patch in-place dans toutes les teams du cache (re-render auto).
   *
   * Retourne le member mis à jour pour permettre au composant appelant de
   * patcher son state local (la vue MemberDetail garde une réf locale
   * `realMember` distincte du store).
   *
   * Throws sur erreur — l'UI affiche un toast.
   */
  async function uploadPhoto(memberId: string, file: File): Promise<MockMember | null> {
    if (!memberId) throw new Error('memberId is required')
    await repoUploadPhoto(memberId, file)
    const refreshed = await getMember(memberId)
    if (refreshed) patchMemberInCaches(refreshed)
    return refreshed
  }

  /**
   * Supprime la photo licence (admin only — la callable serveur rejette les
   * coachs). Refetch + patch identique à `uploadPhoto`.
   */
  async function removePhoto(memberId: string): Promise<MockMember | null> {
    if (!memberId) throw new Error('memberId is required')
    await repoRemovePhoto(memberId)
    const refreshed = await getMember(memberId)
    if (refreshed) patchMemberInCaches(refreshed)
    return refreshed
  }

  /** Vide tout le cache (ex. au sign-out). */
  function reset(): void {
    byTeamId.value = new Map()
    loadingTeamIds.value = new Set()
    errorByTeamId.value = new Map()
  }

  // ─── Getters ────────────────────────────────────────────────────

  /** Récupère les membres d'une team depuis le cache (ou `[]` si pas chargé). */
  function getForTeam(teamId: string): MockMember[] {
    return byTeamId.value.get(teamId) ?? []
  }

  function isLoadingForTeam(teamId: string): boolean {
    return loadingTeamIds.value.has(teamId)
  }

  function errorForTeam(teamId: string): string | null {
    return errorByTeamId.value.get(teamId) ?? null
  }

  /**
   * Stats agrégées par team (count + excluded). Utilisé par MyTeams pour le
   * compteur exact. `excluded` toujours 0 tant qu'on ne fetch pas
   * `/cotisations` (cohérent avec le defaut `duesStatus: 'paid'` du repo).
   */
  const statsByTeamId = computed<Map<string, { count: number; excluded: number }>>(() => {
    const map = new Map<string, { count: number; excluded: number }>()
    for (const [teamId, members] of byTeamId.value.entries()) {
      const excluded = members.filter((m) => m.duesStatus === 'excluded').length
      map.set(teamId, { count: members.length, excluded })
    }
    return map
  })

  return {
    // state
    byTeamId,
    loadingTeamIds,
    errorByTeamId,
    // getters
    statsByTeamId,
    getForTeam,
    isLoadingForTeam,
    errorForTeam,
    // actions
    loadForTeam,
    invalidate,
    reset,
    uploadPhoto,
    removePhoto,
  }
})
