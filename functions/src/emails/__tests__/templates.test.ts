/**
 * Snapshot-light tests pour les templates : on vérifie les invariants
 * (subject non vide, HTML wrappé, échappement basique, texte sans tags).
 * Pas de snapshot byte-pour-byte — trop fragile face aux ajustements de
 * tournure ; on couvre les contrats stables.
 */
import { describe, expect, it } from 'vitest'
import { buildLayout, esc } from '../templates/_layout'
import { registrationSubmittedConfirm } from '../templates/registration_submitted_confirm'
import type { BrandingInfo } from '../types'

const branding: BrandingInfo = {
  clubName: 'Marly Basketball',
  logoUrl: 'https://example.com/logo.png',
  primaryColor: '#ff0066',
}

describe('esc()', () => {
  it('escapes HTML entities', () => {
    expect(esc('<script>"hi"&\'b\'</script>')).toBe(
      '&lt;script&gt;&quot;hi&quot;&amp;&#39;b&#39;&lt;/script&gt;',
    )
  })

  it('handles null/undefined safely', () => {
    expect(esc(null)).toBe('')
    expect(esc(undefined)).toBe('')
  })

  it('stringifies numbers', () => {
    expect(esc(42)).toBe('42')
  })
})

describe('buildLayout', () => {
  it('falls back to default color on invalid input', () => {
    const layout = buildLayout({ ...branding, primaryColor: 'not-a-color' })
    const html = layout.wrap('<p>hi</p>')
    expect(html).toContain('#1f6feb') // default
    expect(html).not.toContain('not-a-color')
  })

  it('accepts valid hex colors', () => {
    const layout = buildLayout({ ...branding, primaryColor: '#abc' })
    const html = layout.wrap('<p>hi</p>')
    expect(html).toContain('#abc')
  })

  it('emits the club name in header when no logo', () => {
    const layout = buildLayout({ ...branding, logoUrl: null })
    const html = layout.wrap('<p>hi</p>')
    expect(html).toContain('Marly Basketball')
  })

  it('emits an <img> when logoUrl is set', () => {
    const layout = buildLayout(branding)
    const html = layout.wrap('<p>hi</p>')
    expect(html).toContain('<img')
    expect(html).toContain('https://example.com/logo.png')
  })

  it('includes preheader when provided', () => {
    const layout = buildLayout(branding)
    const html = layout.wrap('<p>hi</p>', { preheader: 'Confirmation reçue' })
    expect(html).toContain('Confirmation reçue')
  })
})

describe('registrationSubmittedConfirm', () => {
  const ctx = {
    submittedByUid: 'u1',
    registrationId: 'reg-abc-123',
    teamId: 't1',
    playerName: 'Alice <Bob>',
    status: 'pending_payment',
  }

  it('subject contains player name and club name', () => {
    const subject = registrationSubmittedConfirm.subject(ctx, branding)
    expect(subject).toContain('Alice')
    expect(subject).toContain('Marly Basketball')
  })

  it('html escapes user-provided values (XSS-safe)', () => {
    const layout = buildLayout(branding)
    const html = registrationSubmittedConfirm.html(ctx, layout)
    expect(html).toContain('Alice &lt;Bob&gt;')
    expect(html).not.toContain('Alice <Bob>')
  })

  it('html includes registration ID', () => {
    const layout = buildLayout(branding)
    const html = registrationSubmittedConfirm.html(ctx, layout)
    expect(html).toContain('reg-abc-123')
  })

  it('text version has no HTML tags (with clean input)', () => {
    const cleanCtx = { ...ctx, playerName: 'Alice' }
    const text = registrationSubmittedConfirm.text(cleanCtx, branding)
    expect(text).not.toMatch(/<[a-z]+[^>]*>/i)
    expect(text).toContain('Alice')
    expect(text).toContain('reg-abc-123')
  })

  it('text version keeps raw user-provided values (no escaping)', () => {
    // Pas d'échappement HTML côté text : c'est volontaire, le mail client
    // affichera ces caractères tels quels.
    const text = registrationSubmittedConfirm.text(ctx, branding)
    expect(text).toContain('Alice <Bob>')
  })

  it('validate accepts well-formed context', () => {
    expect(registrationSubmittedConfirm.validate?.(ctx)).toBe(true)
  })

  it('validate rejects missing fields', () => {
    expect(registrationSubmittedConfirm.validate?.({})).toBe(false)
    expect(registrationSubmittedConfirm.validate?.({ submittedByUid: 'u1' })).toBe(false)
    expect(registrationSubmittedConfirm.validate?.(null)).toBe(false)
    expect(registrationSubmittedConfirm.validate?.(undefined)).toBe(false)
  })
})
