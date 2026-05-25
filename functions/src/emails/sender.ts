/**
 * `emailSender` — trigger Firestore qui consomme `/pendingEmails/{emailId}`
 * et envoie l'email via Plesk SMTP (Nodemailer + secrets).
 *
 * IMPORTANT — anti-boucle infinie : ce trigger est `onDocumentCreated`,
 * pas `onDocumentWritten` ni `onDocumentUpdated`. L'update final que le
 * sender pose sur le doc (`{ status: 'sent', sentAt, messageId }`) ne le
 * re-déclenche donc PAS. Ne JAMAIS changer le type de trigger sans ré-
 * implémenter une garde explicite côté handler.
 *
 * Schéma attendu du doc : voir `types.PendingEmailDoc`. Le champ `to` est
 * polymorphe (string | string[] | null) pour compatibilité avec les
 * producteurs existants (`submitRegistration` pose string, dues pose
 * string[] | null). Le sender normalise vers `string[]`.
 *
 * Retry : `retry: false`. Un échec laisse le doc en `status: 'failed'`
 * avec un `error` court — inspectable par admin. Pas de retry auto en PR1
 * (backlog : callable manuelle `retryFailedEmail({emailId})` ou cron
 * `retryTransientEmails` pour les erreurs réseau).
 */
import { logger } from 'firebase-functions/v2'
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import type { ClubConfigData } from '@club-app/shared-types'
import { db, FieldValue, serverTimestamp } from './_db'
import { sendMail, EMAIL_SECRETS } from './transport'
import { buildLayout } from './templates/_layout'
import { getTemplate } from './templates/_registry'
import type {
  BrandingInfo,
  PendingEmailDoc,
  PendingEmailStatus,
} from './types'
import * as crypto from 'crypto'

const DEFAULT_PRIMARY_COLOR = '#1f6feb'

export const emailSender = onDocumentCreated(
  {
    document: 'pendingEmails/{emailId}',
    secrets: EMAIL_SECRETS,
    memory: '256MiB',
    timeoutSeconds: 60,
    concurrency: 5,
    retry: false,
  },
  async (event) => {
    const emailId = event.params.emailId
    const snap = event.data
    if (!snap) {
      logger.warn('emailSender: missing snapshot', { emailId })
      return
    }
    const data = snap.data() as PendingEmailDoc | undefined
    if (!data) {
      logger.warn('emailSender: empty data', { emailId })
      return
    }

    // ----- Idempotence : skip si déjà processé. ---------------------------
    if (data.status === 'sent' || data.sentAt) {
      logger.debug('emailSender: already sent, skipping', { emailId })
      return
    }
    if (data.status === 'failed') {
      // Re-trigger d'un doc déjà marqué failed (rare — onCreate ne devrait
      // pas re-fire). Skip défensivement plutôt que de réessayer en boucle.
      logger.debug('emailSender: already failed, skipping retry', { emailId })
      return
    }

    const t0 = Date.now()
    const template = typeof data.template === 'string' ? data.template : ''
    const recipients = normalizeRecipients(data.to)
    const toHash = hashRecipients(recipients)

    // ----- Validation : destinataires présents ----------------------------
    if (recipients.length === 0) {
      await markFailed(emailId, 'no_recipients', 'Aucun destinataire résolu')
      logger.warn('email.failed', { emailId, template, reason: 'no_recipients' })
      return
    }

    // ----- Validation : template connu ------------------------------------
    const mod = getTemplate(template)
    if (!mod) {
      await markFailed(emailId, 'unknown_template', `Template inconnu: ${template}`)
      logger.warn('email.failed', { emailId, template, reason: 'unknown_template' })
      return
    }

    // ----- Validation : context shape (si template fournit un validator) --
    if (mod.validate && !mod.validate(data.context)) {
      await markFailed(emailId, 'invalid_context', `Context shape invalide pour ${template}`)
      logger.warn('email.failed', { emailId, template, reason: 'invalid_context' })
      return
    }
    const context = data.context as never

    // ----- Render + send --------------------------------------------------
    try {
      const branding = await loadBranding()
      const layout = buildLayout(branding)
      const subject = mod.subject(context, branding)
      const html = mod.html(context, layout)
      const text = mod.text(context, branding)

      const result = await sendMail({ to: recipients, subject, html, text })

      await markSent(emailId, result.messageId)
      logger.info('email.sent', {
        emailId,
        template,
        toHash,
        recipientCount: recipients.length,
        accepted: result.accepted.length,
        rejected: result.rejected.length,
        messageId: result.messageId,
        durationMs: Date.now() - t0,
      })
    } catch (err) {
      const code = errCode(err)
      const message = err instanceof Error ? err.message : String(err)
      const truncated = message.length > 500 ? message.slice(0, 500) + '…' : message
      await markFailed(emailId, code, truncated).catch((updateErr) => {
        logger.error('email.markFailed.error', {
          emailId,
          updateError: updateErr instanceof Error ? updateErr.message : String(updateErr),
        })
      })
      logger.error('email.failed', {
        emailId,
        template,
        toHash,
        code,
        durationMs: Date.now() - t0,
      })
    }
  },
)

// ---------------------------------------------------------------------------
// Helpers internes
// ---------------------------------------------------------------------------

function normalizeRecipients(
  to: string | readonly string[] | null | undefined,
): string[] {
  if (!to) return []
  const arr = typeof to === 'string' ? [to] : [...to]
  const cleaned = arr
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => s.length > 0 && s.includes('@'))
  // dédupe ordre stable
  const seen = new Set<string>()
  const result: string[] = []
  for (const email of cleaned) {
    if (seen.has(email)) continue
    seen.add(email)
    result.push(email)
  }
  return result
}

/** SHA-256 court (16 chars hex) — pour traçabilité RGPD-safe en logs. */
function hashRecipients(recipients: readonly string[]): string {
  if (recipients.length === 0) return ''
  const joined = recipients.slice().sort().join(',')
  return crypto.createHash('sha256').update(joined).digest('hex').slice(0, 16)
}

async function markSent(emailId: string, messageId: string): Promise<void> {
  const ref = db().doc(`pendingEmails/${emailId}`)
  await ref.update({
    status: 'sent' satisfies PendingEmailStatus,
    sentAt: serverTimestamp(),
    messageId: messageId || null,
    error: null,
    attempts: FieldValue.increment(1),
    lastAttemptAt: serverTimestamp(),
  })
}

async function markFailed(
  emailId: string,
  code: string,
  message: string,
): Promise<void> {
  const ref = db().doc(`pendingEmails/${emailId}`)
  try {
    await ref.update({
      status: 'failed' satisfies PendingEmailStatus,
      error: `${code}: ${message}`,
      attempts: FieldValue.increment(1),
      lastAttemptAt: serverTimestamp(),
    })
  } catch (err) {
    logger.error('emailSender: markFailed update error', {
      emailId,
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Lit `/config/club` pour résoudre le branding (nom, logo, couleur). Si le
 * doc est absent ou incomplet, fallback sur des valeurs neutres — l'email
 * partira quand même (l'admin ne configure pas toujours `/config/club`
 * avant la première inscription).
 */
async function loadBranding(): Promise<BrandingInfo> {
  try {
    const snap = await db().doc('config/club').get()
    if (!snap.exists) return defaultBranding()
    const cfg = snap.data() as Partial<ClubConfigData> | undefined
    return {
      clubName: typeof cfg?.name === 'string' && cfg.name.length > 0
        ? cfg.name
        : 'Club',
      logoUrl: typeof cfg?.logo === 'string' && cfg.logo.length > 0
        ? cfg.logo
        : null,
      primaryColor: DEFAULT_PRIMARY_COLOR,
    }
  } catch (err) {
    logger.warn('emailSender: loadBranding error, using defaults', {
      err: err instanceof Error ? err.message : String(err),
    })
    return defaultBranding()
  }
}

function defaultBranding(): BrandingInfo {
  return { clubName: 'Club', logoUrl: null, primaryColor: DEFAULT_PRIMARY_COLOR }
}

/** Extrait `.code` d'une erreur Firebase / Nodemailer (duck-typing). */
function errCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const c = err.code
    if (typeof c === 'string') return c
    if (typeof c === 'number') return String(c)
  }
  if (err instanceof Error && err.name) return err.name
  return 'unknown'
}
