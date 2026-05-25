/**
 * Transport SMTP — wrapper Nodemailer + secrets Plesk.
 *
 * Lit les 6 `defineSecret` au runtime (lazy : la valeur n'est résolue que
 * lors du premier `sendMail()`). Le transporter est ré-instancié à chaque
 * invocation (les Cloud Functions sont stateless ; pas de gain réel à
 * caché un singleton, et garder la connexion ouverte n'a pas de sens pour
 * un volume aussi bas).
 *
 * Voir `docs/emails/setup-plesk.md` pour la procédure de configuration
 * côté serveur (création boîte, DKIM/SPF/DMARC, ports, quotas).
 */
import { defineSecret } from 'firebase-functions/params'
import * as nodemailer from 'nodemailer'
import type SMTPTransport from 'nodemailer/lib/smtp-transport'
import type { SecretParam } from 'firebase-functions/lib/params/types'

// ---------------------------------------------------------------------------
// Secrets (per-project Firebase, configurés via `firebase functions:secrets:set`)
// ---------------------------------------------------------------------------

export const SMTP_HOST = defineSecret('SMTP_HOST')
export const SMTP_PORT = defineSecret('SMTP_PORT')
export const SMTP_USER = defineSecret('SMTP_USER')
export const SMTP_PASS = defineSecret('SMTP_PASS')
export const SMTP_FROM_ADDRESS = defineSecret('SMTP_FROM_ADDRESS')
export const SMTP_FROM_NAME = defineSecret('SMTP_FROM_NAME')

/**
 * Liste des secrets à attacher à toute Function qui veut envoyer un email.
 * Le sender l'utilise dans son `onDocumentCreated({ secrets: EMAIL_SECRETS })`.
 */
export const EMAIL_SECRETS: SecretParam[] = [
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM_ADDRESS,
  SMTP_FROM_NAME,
]

// ---------------------------------------------------------------------------
// Transport factory
// ---------------------------------------------------------------------------

/**
 * Construit un Nodemailer Transporter à partir des secrets résolus.
 *
 * Port 587 → STARTTLS (option `secure: false` + `requireTLS: true`).
 * Port 465 → SMTPS (option `secure: true`). Le code détecte automatiquement.
 *
 * `pool: false` car les Cloud Functions sont stateless — pas de gain à
 * pooler. `connectionTimeout: 10s` pour éviter qu'un Plesk lent ne fasse
 * timeout la Function v2 (60s par défaut).
 */
export function createTransport(): nodemailer.Transporter {
  const host = SMTP_HOST.value()
  const portRaw = SMTP_PORT.value()
  const user = SMTP_USER.value()
  const pass = SMTP_PASS.value()

  if (!host || !user || !pass) {
    throw new Error('SMTP secrets missing — check defineSecret bindings on Function')
  }

  const port = Number(portRaw)
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`SMTP_PORT invalide: "${portRaw}"`)
  }

  const secure = port === 465 // 465 = SMTPS implicite ; 587/25 = STARTTLS
  // Pas de `pool: true` — les Cloud Functions sont stateless ; le default
  // (pas de pool) suffit largement pour le volume attendu.
  const opts: SMTPTransport.Options = {
    host,
    port,
    secure,
    requireTLS: !secure, // force STARTTLS sur 587, no-op sur 465
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  }
  return nodemailer.createTransport(opts)
}

// ---------------------------------------------------------------------------
// API publique : sendMail()
// ---------------------------------------------------------------------------

export interface SendMailArgs {
  to: readonly string[]
  subject: string
  html: string
  text: string
}

export interface SendMailResult {
  messageId: string
  /** Liste des destinataires effectivement accepté par le serveur SMTP. */
  accepted: readonly string[]
  /** Liste des destinataires rejetés (rate limit, format invalide, etc.). */
  rejected: readonly string[]
}

/**
 * Envoie un email via Plesk SMTP. Throw si le serveur SMTP refuse la
 * connexion, l'auth, ou rejette TOUS les destinataires. Si une partie des
 * destinataires est rejetée mais pas tous, on considère l'envoi comme
 * partiel-success (le caller logge les rejets).
 */
export async function sendMail(args: SendMailArgs): Promise<SendMailResult> {
  const transport = createTransport()
  const fromAddress = SMTP_FROM_ADDRESS.value()
  const fromName = SMTP_FROM_NAME.value()

  if (!fromAddress) {
    throw new Error('SMTP_FROM_ADDRESS secret missing')
  }

  const from = fromName ? `"${fromName}" <${fromAddress}>` : fromAddress

  // Nodemailer's `transport.sendMail` returns `any` from the generic
  // `Transporter` interface ; on cast vers le shape SMTP réel (le transport
  // est créé via `createTransport` ci-dessus qui retourne un SMTP transport).
  const info = (await transport.sendMail({
    from,
    to: [...args.to],
    subject: args.subject,
    html: args.html,
    text: args.text,
  })) as SMTPTransport.SentMessageInfo

  const accepted = info.accepted.map(addressToString)
  const rejected = info.rejected.map(addressToString)

  if (accepted.length === 0) {
    throw new Error(
      `SMTP rejected all recipients (rejected=${rejected.join(',')})`,
    )
  }

  return {
    messageId: typeof info.messageId === 'string' ? info.messageId : '',
    accepted,
    rejected,
  }
}

/**
 * Nodemailer renvoie soit une string, soit un objet `{ address, name }` selon
 * le format passé en entrée. On normalise vers string pour le caller.
 */
function addressToString(addr: string | { address: string }): string {
  return typeof addr === 'string' ? addr : addr.address
}
