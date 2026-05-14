import type { Timestamp } from './index'
import type { SlotType } from './booking'

/**
 * Document `/bookingSeries/{seriesId}` — pattern de réservation manuelle
 * (one-shot ou récurrente, modèle Outlook).
 * Voir docs/firebase.md (section /bookingSeries).
 *
 * Chaque série produit N documents `/bookings` (un par occurrence) à la
 * création ; les bookings instanciés référencent la série via `seriesId` et
 * conservent `originalDate` pour tracer un éventuel déplacement.
 *
 * Au MVP : `interval` toujours à 1 (chaque semaine / chaque mois) ;
 * `endDate` obligatoire (pas de série infinie).
 */
export type RecurrenceFrequency = 'weekly' | 'monthly'
export type MonthlyMode = 'dayOfMonth' | 'nthWeekday'

export interface RecurrenceRule {
  frequency: RecurrenceFrequency
  /** Toujours 1 au MVP (chaque semaine / chaque mois). Réservé pour évolution. */
  interval: number
  /** 0-6 (0=dimanche) pour `weekly`. `null` pour `monthly`. */
  weekday: number | null
  /** Mode mensuel : `dayOfMonth` (ex: tous les 15 du mois) ou `nthWeekday` (ex: 3e mardi). `null` pour `weekly`. */
  monthlyMode: MonthlyMode | null
}

export interface BookingSeriesData {
  seasonId: string
  venueId: string
  courtId: string
  teamId: string | null
  /** Mirroré sur chaque booking instance à la création. */
  slotType: SlotType
  matchTypeId: string | null
  /** Première occurrence (00:00 local). */
  startDate: Timestamp
  /** Dernière date possible (incluse). Obligatoire au MVP. */
  endDate: Timestamp
  /** "HH:MM" — appliqué à toutes les occurrences. */
  startTime: string
  /** "HH:MM" */
  endTime: string
  recurrence: RecurrenceRule
  /**
   * Si true, les occurrences tombant pendant une closure du venue sont
   * skippées à la création.
   *
   * NOTE — pour les séries créées via l'UI, ce champ est **toujours `true`** :
   * les fermetures de salle (`/closurePeriods` + `venue.customClosures`) sont
   * obligatoirement respectées pour une série récurrente, sans bypass possible
   * (cf. `apps/web/src/repositories/bookings.repo.ts` → `createBookingSeries`).
   * Le bypass volontaire reste autorisé pour les bookings one-shot manuels via
   * `createManualBooking` (override admin documenté).
   *
   * Le champ subsiste dans le schéma Firestore pour compat ascendante avec les
   * documents historiques (qui peuvent porter `false`). Aucune lecture côté
   * code ne dépend plus de cette valeur depuis 2026-05-15.
   */
  considerClosures: boolean
  title: string
  notes: string | null
  createdBy: string
  createdAt: Timestamp
}

export type BookingSeries = BookingSeriesData & { id: string }
