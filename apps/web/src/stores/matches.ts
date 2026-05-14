import { ref } from 'vue'
import { defineStore } from 'pinia'
import { FirebaseError } from 'firebase/app'
import {
  createAwayMatch as repoCreateAwayMatch,
  createHomeMatch as repoCreateHomeMatch,
  deleteMatch as repoDeleteMatch,
  listAllMatches,
  updateMatch as repoUpdateMatch,
  type MatchRow,
} from '@/repositories/matches.repo'
import type { MatchData } from '@club-app/shared-types'
import { useAuthStore } from '@/stores/auth'
import { useBookingsStore } from '@/stores/bookings'

/**
 * Store Matches — source unique pour l'écran `/matches`.
 *
 * Modèle : `/matches/{matchId}` est la collection racine ; un match HOME
 * référence un booking via `bookingId` (le booking porte `matchId` en
 * retour). Cf. `repositories/matches.repo.ts` et
 * `packages/shared-types/src/match.ts`.
 *
 * Pourquoi le store recharge AUSSI le store bookings après une mutation :
 *  - `createHome` set `booking.matchId` / `matchTypeId` / `opponentName`
 *    via writeBatch → le calendrier `/bookings` doit refléter ces champs
 *    immédiatement.
 *  - `createAway` ne touche pas `/bookings` directement mais
 *    `freeConflictingTrainings` (best-effort) peut passer des trainings
 *    en `status: 'freed'` — la grille doit le voir.
 *  - `update` / `remove` propagent éventuellement sur le booking lié.
 *
 * Try/catch enrichi `FirebaseError` partout (cf. `apps/web/CLAUDE.md` §
 * "Catch enrichi obligatoire").
 */
export const useMatchesStore = defineStore('matches', () => {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const matches = ref<MatchRow[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

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
   * Recharge `useBookingsStore.allBookings` après une mutation matches.
   * Best-effort : si le reload bookings échoue, on log mais on n'annule pas
   * la mutation matches (déjà committée Firestore-side).
   */
  async function refreshBookingsStore(): Promise<void> {
    try {
      const bookingsStore = useBookingsStore()
      await bookingsStore.loadAllBookingsAndSeries()
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`refreshBookingsStore failed [${code}]`, err)
    }
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /** Charge tous les matchs (avec joints) dans `matches`. */
  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      matches.value = await listAllMatches()
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`listAllMatches failed [${code}]`, err)
      error.value = err instanceof Error ? err.message : 'Erreur de chargement des matchs'
      throw err
    } finally {
      loading.value = false
    }
  }

  /** Form input pour `createHome`. */
  interface CreateHomeForm {
    /** Booking match_home pending à rattacher. */
    bookingId: string
    teamId: string
    matchTypeId: string
    opponentName: string | null
    notes: string | null
  }

  /**
   * Crée un match HOME (doc `/matches` + lien sur le booking via writeBatch
   * atomique). Recharge ensuite `matches` ET `bookings` (pour refléter les
   * dénormalisations matchTypeId/opponentName/matchId).
   *
   * @returns `{ matchId, bookingId, freedBookingIds }` — utile pour
   *   afficher un toast genre "Match créé. 2 entraînements libérés.".
   */
  async function createHome(
    form: CreateHomeForm,
  ): Promise<{ matchId: string; bookingId: string; freedBookingIds: string[] }> {
    const createdBy = requireUid()
    loading.value = true
    error.value = null
    try {
      const result = await repoCreateHomeMatch({
        bookingId: form.bookingId,
        teamId: form.teamId,
        matchTypeId: form.matchTypeId,
        opponentName: form.opponentName,
        notes: form.notes,
        createdBy,
      })
      await Promise.all([load(), refreshBookingsStore()])
      return result
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`createHome failed [${code}]`, err)
      error.value = err instanceof Error ? err.message : 'Erreur de création du match à domicile'
      throw err
    } finally {
      loading.value = false
    }
  }

  /** Form input pour `createAway`. */
  interface CreateAwayForm {
    teamId: string
    matchTypeId: string
    opponentName: string
    awayAddress: string
    date: Date
    startTime: string
    endTime: string
    notes: string | null
  }

  /**
   * Crée un match AWAY (doc `/matches` seul — pas de booking créé). Le repo
   * libère best-effort les trainings/reserves conflictuels de l'équipe.
   *
   * @returns `{ matchId, freedBookingIds }`.
   */
  async function createAway(
    form: CreateAwayForm,
  ): Promise<{ matchId: string; freedBookingIds: string[] }> {
    const createdBy = requireUid()
    loading.value = true
    error.value = null
    try {
      const result = await repoCreateAwayMatch({
        teamId: form.teamId,
        matchTypeId: form.matchTypeId,
        opponentName: form.opponentName,
        awayAddress: form.awayAddress,
        date: form.date,
        startTime: form.startTime,
        endTime: form.endTime,
        notes: form.notes,
        createdBy,
      })
      await Promise.all([load(), refreshBookingsStore()])
      return result
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`createAway failed [${code}]`, err)
      error.value = err instanceof Error ? err.message : 'Erreur de création du match à l\'extérieur'
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * Met à jour les champs éditables d'un match. Pour HOME, propage
   * `matchTypeId` / `opponentName` / `teamId` sur le booking lié (writeBatch
   * côté repo).
   */
  async function update(matchId: string, patch: Partial<MatchData>): Promise<void> {
    // requireUid pour signaler "not authenticated" tôt — pas utilisé par
    // l'API repo (pas d'actionLog côté /matches en MVP).
    requireUid()
    loading.value = true
    error.value = null
    try {
      await repoUpdateMatch(matchId, patch)
      await Promise.all([load(), refreshBookingsStore()])
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`update match failed [${code}]`, err)
      error.value = err instanceof Error ? err.message : 'Erreur de mise à jour du match'
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * Supprime un match. Pour HOME, clear `matchId`/`matchTypeId`/
   * `opponentName` sur le booking lié (qui redevient pending) via writeBatch.
   */
  async function remove(matchId: string): Promise<void> {
    requireUid()
    loading.value = true
    error.value = null
    try {
      await repoDeleteMatch(matchId)
      await Promise.all([load(), refreshBookingsStore()])
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`remove match failed [${code}]`, err)
      error.value = err instanceof Error ? err.message : 'Erreur de suppression du match'
      throw err
    } finally {
      loading.value = false
    }
  }

  return {
    matches,
    loading,
    error,
    load,
    createHome,
    createAway,
    update,
    remove,
  }
})
