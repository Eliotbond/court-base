/**
 * Template `registration_submitted_confirm` — confirmation au submitter
 * après une nouvelle inscription via `submitRegistration`.
 *
 * Producteur : `functions/src/registrations/submitRegistration.ts:392`.
 * Context attendu : `RegistrationSubmittedConfirmContext` (cf. `../types.ts`).
 */
import type {
  ContextByTemplate,
  RegistrationSubmittedConfirmContext,
  TemplateModule,
} from '../types'
import { esc } from './_layout'

function isCtx(value: unknown): value is RegistrationSubmittedConfirmContext {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.submittedByUid === 'string' &&
    typeof v.registrationId === 'string' &&
    typeof v.teamId === 'string' &&
    typeof v.playerName === 'string' &&
    typeof v.status === 'string'
  )
}

export const registrationSubmittedConfirm: TemplateModule<'registration_submitted_confirm'> = {
  validate: isCtx,

  subject: (ctx: ContextByTemplate['registration_submitted_confirm'], branding) =>
    `Inscription reçue — ${ctx.playerName} (${branding.clubName})`,

  html: (ctx, layout) => {
    const inner = `
      <p style="margin:0 0 16px 0;font-size:16px;">Bonjour,</p>
      <p style="margin:0 0 16px 0;">
        Nous avons bien reçu l'inscription de <strong>${esc(ctx.playerName)}</strong>
        au ${esc(layout.branding.clubName)}.
      </p>
      ${layout.panel(`
        <div style="font-size:13px;color:#6b7280;">Référence inscription</div>
        <div style="font-size:14px;font-family:'SFMono-Regular',Consolas,Menlo,monospace;color:#111;margin-top:4px;">${esc(ctx.registrationId)}</div>
      `)}
      <p style="margin:16px 0;">
        Notre équipe va examiner la demande et reviendra vers vous dès que possible
        ${ctx.status === 'pending_decision' ? 'pour confirmer la décision finale.' : ''}
        ${ctx.status === 'pending_payment' ? 'pour vous transmettre les modalités de paiement.' : ''}
      </p>
      <p style="margin:16px 0;color:#6b7280;font-size:13px;">
        Vous pouvez suivre l'état de votre inscription depuis votre espace personnel.
      </p>
      <p style="margin:24px 0 0 0;">À bientôt,<br>${esc(layout.branding.clubName)}</p>
    `
    return layout.wrap(inner, {
      preheader: `Inscription de ${ctx.playerName} bien reçue.`,
    })
  },

  text: (ctx, branding) =>
    `Bonjour,

Nous avons bien reçu l'inscription de ${ctx.playerName} au ${branding.clubName}.

Référence inscription : ${ctx.registrationId}

Notre équipe va examiner la demande et reviendra vers vous dès que possible.

Vous pouvez suivre l'état de votre inscription depuis votre espace personnel.

À bientôt,
${branding.clubName}

—
Cet email a été envoyé automatiquement — ne pas répondre.`,
}
