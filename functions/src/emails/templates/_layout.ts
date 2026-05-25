/**
 * Layout HTML commun pour tous les emails transactionnels.
 *
 * Table-based (Outlook + Gmail-friendly). Pas de CSS externe — tout inline.
 * Largeur 600px (best practice email). Police système (sans-serif fallback).
 *
 * Le `branding` est résolu au runtime depuis `/config/club` par le sender —
 * permet à chaque projet Firebase (= un club) d'avoir son propre nom + logo
 * sans toucher au code.
 */
import type { BrandingInfo, LayoutHelpers } from '../types'

/** Échappe les `&`, `<`, `>`, `"`, `'` pour rendre du contenu non-trusted. */
export function esc(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Construit les helpers de layout à partir du branding club. À appeler
 * UNE FOIS par render dans le sender. Les templates reçoivent les helpers
 * finis (pas le branding brut) pour découpler.
 */
export function buildLayout(branding: BrandingInfo): LayoutHelpers {
  const safeClubName = esc(branding.clubName)
  const safeColor = sanitizeColor(branding.primaryColor)

  const headerHtml = branding.logoUrl
    ? `<img src="${esc(branding.logoUrl)}" alt="${safeClubName}" width="80" style="display:block;border:0;outline:none;text-decoration:none;height:auto;max-width:80px;">`
    : `<div style="font-size:20px;font-weight:600;color:#111;">${safeClubName}</div>`

  return {
    branding,

    wrap(innerHtml: string, opts) {
      const preheader = opts?.preheader ? esc(opts.preheader) : ''
      return `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${safeClubName}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111;">
    ${preheader
      ? `<div style="display:none;font-size:1px;color:#f4f5f7;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</div>`
      : ''}
    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f4f5f7;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="600" border="0" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="padding:24px 32px;border-bottom:3px solid ${safeColor};">
                ${headerHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:32px;font-size:15px;line-height:1.55;color:#1f2937;">
                ${innerHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 24px 32px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;line-height:1.5;">
                Vous recevez cet email parce que vous êtes inscrit au ${safeClubName}.<br>
                Cet email a été envoyé automatiquement — ne pas répondre.
              </td>
            </tr>
          </table>
          <div style="font-size:11px;color:#9ca3af;padding-top:12px;">
            ${safeClubName}
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`
    },

    button(label, url) {
      return `<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:16px 0;">
        <tr>
          <td align="center" bgcolor="${safeColor}" style="border-radius:6px;">
            <a href="${esc(url)}" target="_blank" style="display:inline-block;padding:12px 24px;font-size:15px;color:#ffffff;text-decoration:none;font-weight:600;">${esc(label)}</a>
          </td>
        </tr>
      </table>`
    },

    panel(innerHtml) {
      return `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:16px 0;background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;">
        <tr>
          <td style="padding:16px 20px;">
            ${innerHtml}
          </td>
        </tr>
      </table>`
    },
  }
}

/**
 * Sanitize une couleur primaire : ne tolère que `#RGB` / `#RRGGBB`.
 * Fallback `#1f6feb` (bleu sobre) si invalide.
 */
function sanitizeColor(color: string | null | undefined): string {
  if (!color) return '#1f6feb'
  const trimmed = color.trim()
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed) || /^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed
  }
  return '#1f6feb'
}
