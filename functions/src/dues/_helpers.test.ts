import { describe, expect, it } from 'vitest'
import { computeMemberDuesStatus } from './_helpers'
import type { CotisationStatus as DueStatus } from '@club-app/shared-types'

describe('computeMemberDuesStatus', () => {
  it('returns "n/a" when no dues exist', () => {
    expect(computeMemberDuesStatus([])).toBe('n/a')
  })

  it('returns "excluded" when any due is overdue (worst-status wins)', () => {
    const statuses: DueStatus[] = ['paid', 'pending_grace', 'overdue', 'issued']
    expect(computeMemberDuesStatus(statuses)).toBe('excluded')
  })

  it('returns "excepted" when no overdue but at least one excepted', () => {
    const statuses: DueStatus[] = ['paid', 'pending_grace', 'excepted', 'issued']
    expect(computeMemberDuesStatus(statuses)).toBe('excepted')
  })

  it('returns "due" when no overdue/excepted but at least one issued', () => {
    const statuses: DueStatus[] = ['paid', 'pending_grace', 'issued']
    expect(computeMemberDuesStatus(statuses)).toBe('due')
  })

  it('returns "pending_grace" when only pending_grace + paid/cancelled exist', () => {
    const statuses: DueStatus[] = ['pending_grace', 'paid', 'cancelled']
    expect(computeMemberDuesStatus(statuses)).toBe('pending_grace')
  })

  it('returns "ok" when all dues are paid', () => {
    expect(computeMemberDuesStatus(['paid', 'paid'])).toBe('ok')
  })

  it('returns "ok" when all dues are paid or cancelled', () => {
    expect(computeMemberDuesStatus(['paid', 'cancelled'])).toBe('ok')
  })

  it('returns "ok" when all dues are cancelled', () => {
    expect(computeMemberDuesStatus(['cancelled', 'cancelled'])).toBe('ok')
  })

  // Verify worst-status precedence chain explicitly.
  it('precedence: overdue > excepted > issued > pending_grace > ok', () => {
    expect(computeMemberDuesStatus(['overdue', 'excepted'])).toBe('excluded')
    expect(computeMemberDuesStatus(['excepted', 'issued'])).toBe('excepted')
    expect(computeMemberDuesStatus(['issued', 'pending_grace'])).toBe('due')
    expect(computeMemberDuesStatus(['pending_grace', 'paid'])).toBe('pending_grace')
  })
})
