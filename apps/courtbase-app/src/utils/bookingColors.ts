/**
 * Mapping pur slotType + status → kind visuel, libellé FR, classe CSS et
 * tone CbPill. Consommé par les 3 vues bookings (TeamPlanning, Créneaux
 * libres, Toutes les réservations) pour rester cohérent.
 *
 * Les classes `.cb-bk-*` correspondantes vivent dans `assets/tokens.css`.
 * Les `CbPill` consomment directement les tones (`emerald` | `sky` | ...).
 */

import type { BookingRow } from '@/repositories/bookings.repo'

export type BookingVisualKind =
  | 'training'
  | 'match-home'
  | 'match-away'
  | 'reserve'
  | 'custom'
  | 'freed'
  | 'cancelled'

/**
 * Résout le kind visuel d'un booking. `cancelled` / `freed` priment sur le
 * slotType (un entraînement annulé est rendu "cancelled", pas "training").
 */
export function visualKindOf(b: Pick<BookingRow, 'slotType' | 'status'>): BookingVisualKind {
  if (b.status === 'cancelled') return 'cancelled'
  if (b.status === 'freed') return 'freed'
  // slotType → kind : remplace `_` par `-` pour les composés (`match_home` →
  // `match-home`). Le mapping est exhaustif côté type — pas d'`as` requis.
  switch (b.slotType) {
    case 'training':
      return 'training'
    case 'match_home':
      return 'match-home'
    case 'match_away':
      return 'match-away'
    case 'reserve':
      return 'reserve'
    case 'custom':
    default:
      return 'custom'
  }
}

export const BOOKING_LABELS: Record<BookingVisualKind, string> = {
  training: 'Entraînement',
  'match-home': 'Match à domicile',
  'match-away': "Match à l'extérieur",
  reserve: 'Réserve',
  custom: 'Autre',
  freed: 'Créneau libre',
  cancelled: 'Annulé',
}

/**
 * Classe CSS à appliquer sur le wrapper booking. Conserve un préfixe `cb-bk-`
 * pour ne pas collider avec les classes vue-cal `vc-*` ni avec les classes
 * cb-* existantes (`cb-booking.training` vs `cb-bk-training`).
 */
export const BOOKING_CLASS: Record<BookingVisualKind, string> = {
  training: 'cb-bk-training',
  'match-home': 'cb-bk-match-home',
  'match-away': 'cb-bk-match-away',
  reserve: 'cb-bk-reserve',
  custom: 'cb-bk-custom',
  freed: 'cb-bk-freed',
  cancelled: 'cb-bk-cancelled',
}

/**
 * Tone CbPill — limité aux tones supportés par le composant
 * (`'emerald' | 'sky' | 'amber' | 'violet' | 'rose' | 'slate'`).
 */
export const BOOKING_PILL_TONE: Record<
  BookingVisualKind,
  'emerald' | 'sky' | 'amber' | 'violet' | 'rose' | 'slate'
> = {
  training: 'emerald',
  'match-home': 'violet',
  'match-away': 'sky',
  reserve: 'slate',
  custom: 'amber',
  freed: 'slate',
  cancelled: 'rose',
}
