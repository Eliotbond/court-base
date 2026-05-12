/**
 * Tests des pure helpers de génération de bookings.
 * Pas de Firestore ici — voir `generateSeasonBookings.test.ts` pour les tests bout-en-bout mockés.
 */
import { describe, it, expect } from 'vitest'
import {
  dateRangeForDayOfWeek,
  isInsideClosure,
  formatDateId,
  deterministicBookingId,
  utcMidnight,
  closurePeriodToRange,
  startOfUtcDay,
  type ClosurePeriodDoc,
} from './_helpers'

/** Mini-stub d'un FirebaseFirestore.Timestamp pour les tests. */
function tsFromDate(d: Date): FirebaseFirestore.Timestamp {
  return {
    seconds: Math.floor(d.getTime() / 1000),
    nanoseconds: 0,
    toDate: () => new Date(d.getTime()),
    toMillis: () => d.getTime(),
    isEqual: () => false,
    valueOf: () => '',
    toJSON: () => ({ seconds: 0, nanoseconds: 0 }),
  } as unknown as FirebaseFirestore.Timestamp
}

describe('utcMidnight / startOfUtcDay', () => {
  it('utcMidnight produit une date UTC à 00:00:00.000', () => {
    const d = utcMidnight(2025, 8, 1) // 2025-09-01
    expect(d.getUTCFullYear()).toBe(2025)
    expect(d.getUTCMonth()).toBe(8)
    expect(d.getUTCDate()).toBe(1)
    expect(d.getUTCHours()).toBe(0)
    expect(d.getUTCMinutes()).toBe(0)
  })

  it('startOfUtcDay tronque les heures', () => {
    const d = new Date(Date.UTC(2025, 8, 1, 14, 23, 7))
    const s = startOfUtcDay(d)
    expect(s.getUTCHours()).toBe(0)
    expect(s.getUTCDate()).toBe(1)
  })
})

describe('dateRangeForDayOfWeek', () => {
  it('range [2025-09-01, 2025-09-30] avec dayOfWeek=1 (lundi) → 5 lundis', () => {
    const start = utcMidnight(2025, 8, 1) // Mon 2025-09-01
    const end = utcMidnight(2025, 8, 30) // Tue 2025-09-30
    const got = dateRangeForDayOfWeek(start, end, 1)
    expect(got.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2025-09-01',
      '2025-09-08',
      '2025-09-15',
      '2025-09-22',
      '2025-09-29',
    ])
  })

  it('retourne tableau vide si end < start', () => {
    const start = utcMidnight(2025, 8, 30)
    const end = utcMidnight(2025, 8, 1)
    expect(dateRangeForDayOfWeek(start, end, 1)).toEqual([])
  })

  it('rejette un dayOfWeek invalide', () => {
    expect(() => dateRangeForDayOfWeek(new Date(), new Date(), 7)).toThrow()
    expect(() => dateRangeForDayOfWeek(new Date(), new Date(), -1)).toThrow()
  })

  it('inclut start si start est déjà le bon dayOfWeek', () => {
    // 2025-09-01 = Monday
    const start = utcMidnight(2025, 8, 1)
    const end = utcMidnight(2025, 8, 7)
    const got = dateRangeForDayOfWeek(start, end, 1)
    expect(got).toHaveLength(1)
    expect(got[0]?.toISOString().slice(0, 10)).toBe('2025-09-01')
  })
})

describe('isInsideClosure', () => {
  const closure = closurePeriodToRange('c1', {
    name: 'fall break',
    type: 'holiday',
    createdBy: 'u',
    startDate: tsFromDate(utcMidnight(2025, 8, 8)), // Mon 2025-09-08
    endDate: tsFromDate(utcMidnight(2025, 8, 14)), // Sun 2025-09-14
  } as ClosurePeriodDoc)

  it('inclut les bornes', () => {
    expect(isInsideClosure(utcMidnight(2025, 8, 8).getTime(), [closure])).toBe(true)
    expect(isInsideClosure(utcMidnight(2025, 8, 14).getTime(), [closure])).toBe(true)
  })

  it('exclut juste avant et juste après', () => {
    expect(isInsideClosure(utcMidnight(2025, 8, 7).getTime(), [closure])).toBe(false)
    expect(isInsideClosure(utcMidnight(2025, 8, 15).getTime(), [closure])).toBe(false)
  })

  it('avec closure [2025-09-08, 2025-09-14], 2025-09-08 skip, autres lundis OK', () => {
    const start = utcMidnight(2025, 8, 1)
    const end = utcMidnight(2025, 8, 30)
    const allMondays = dateRangeForDayOfWeek(start, end, 1)
    const survivors = allMondays.filter((d) => !isInsideClosure(d.getTime(), [closure]))
    expect(survivors.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2025-09-01',
      '2025-09-15',
      '2025-09-22',
      '2025-09-29',
    ])
  })
})

describe('formatDateId / deterministicBookingId', () => {
  it('formate YYYYMMDD en UTC', () => {
    expect(formatDateId(utcMidnight(2025, 8, 1))).toBe('20250901')
    expect(formatDateId(utcMidnight(2025, 11, 31))).toBe('20251231')
  })

  it('deterministicBookingId composé sans caractères interdits', () => {
    const id = deterministicBookingId({
      seasonId: 'S1',
      courtId: 'C1',
      timeSlotId: 'T1',
      date: utcMidnight(2025, 8, 1),
    })
    expect(id).toBe('S1_C1_T1_20250901')
    expect(id).not.toContain('/')
    expect(id).not.toContain('.')
  })
})
