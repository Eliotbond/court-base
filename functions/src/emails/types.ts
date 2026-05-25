/**
 * Types partagés du module `emails/` — sender, templates, registry.
 *
 * Source de vérité pour les `template` valides et le shape du `context`
 * attendu par chaque template. Les hooks métier (callables, triggers)
 * doivent typer leur appel `enqueueEmail({ template, context })` via
 * `ContextByTemplate[template]`.
 */
import type { Timestamp } from 'firebase-admin/firestore'

// ---------------------------------------------------------------------------
// Liste des templates supportés
// ---------------------------------------------------------------------------

/**
 * Union des template keys reconnus par le sender.
 *
 * Tout `pendingEmail.template` hors de cette union sera marqué
 * `status: 'failed'` / `error: 'unknown_template'` par le sender.
 *
 * En PR1 seul `registration_submitted_confirm` a un module template
 * implémenté ; les autres sont déclarés ici pour que la migration PR2-PR4
 * soit triviale (juste ajouter des fichiers dans `templates/`).
 */
export type EmailTemplateKey =
  | 'registration_submitted_confirm'
  | 'registration_refused'
  | 'dues_payment_request'
  | 'dues_payment_confirmed'
  | 'majority_guardian_notify'
  | 'majority_member_confirm'
  | 'trial_started'
  | 'trial_expired'
  | 'license_documents_pending'
  | 'license_document_refused'
  | 'license_request_approved'
  | 'license_request_rejected'

// ---------------------------------------------------------------------------
// Contextes par template
// ---------------------------------------------------------------------------

/**
 * Reproduit le shape posé par `submitRegistration.ts:394-406`. Les futurs
 * producteurs DOIVENT respecter ce contrat (et `enqueueEmail` le force via
 * `ContextByTemplate[K]`).
 */
export interface RegistrationSubmittedConfirmContext {
  submittedByUid: string
  registrationId: string
  teamId: string
  playerName: string
  status: string
}

/** Map template key → type du `context`. À enrichir au fil des PRs. */
export interface ContextByTemplate {
  registration_submitted_confirm: RegistrationSubmittedConfirmContext
  // PR2 — placeholders typés ultérieurement quand les templates seront migrés.
  registration_refused: Record<string, unknown>
  dues_payment_request: Record<string, unknown>
  dues_payment_confirmed: Record<string, unknown>
  majority_guardian_notify: Record<string, unknown>
  majority_member_confirm: Record<string, unknown>
  // PR3
  trial_started: Record<string, unknown>
  trial_expired: Record<string, unknown>
  // PR4
  license_documents_pending: Record<string, unknown>
  license_document_refused: Record<string, unknown>
  license_request_approved: Record<string, unknown>
  license_request_rejected: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Helpers de layout (header/footer commun)
// ---------------------------------------------------------------------------

/** Branding club lu depuis `/config/club` au moment du render. */
export interface BrandingInfo {
  clubName: string
  logoUrl: string | null
  primaryColor: string
}

export interface LayoutHelpers {
  branding: BrandingInfo
  /** Wrap un fragment HTML inner dans le layout email (header + footer). */
  wrap: (innerHtml: string, opts?: { preheader?: string }) => string
  /** Bouton call-to-action accessible (table-based pour Outlook). */
  button: (label: string, url: string) => string
  /** Panneau encadré pour mettre en valeur une info (montant, référence...). */
  panel: (innerHtml: string) => string
}

// ---------------------------------------------------------------------------
// Contrat d'un template
// ---------------------------------------------------------------------------

/**
 * Un template expose un subject, un rendu HTML, un fallback texte, et
 * (optionnellement) un narrowing du context au runtime.
 *
 * Le sender appelle ces 3 fonctions APRÈS avoir validé que le template est
 * connu dans le registry. Une exception thrown par render → catch sender,
 * marquage `failed` + log structuré.
 */
export interface TemplateModule<K extends EmailTemplateKey = EmailTemplateKey> {
  /** Object subject. Doit toujours retourner une string non vide. */
  subject: (ctx: ContextByTemplate[K], branding: BrandingInfo) => string
  /** HTML complet (le layout est responsable du wrapping). */
  html: (ctx: ContextByTemplate[K], layout: LayoutHelpers) => string
  /** Fallback texte (clients sans HTML, accessibility). */
  text: (ctx: ContextByTemplate[K], branding: BrandingInfo) => string
  /**
   * Narrowing optionnel du context au runtime. Si fourni et retourne `false`,
   * le sender marque `status='failed'`/`error='invalid_context'` au lieu de
   * tenter le render.
   */
  validate?: (ctx: unknown) => ctx is ContextByTemplate[K]
}

// ---------------------------------------------------------------------------
// Shape Firestore du doc /pendingEmails/{id}
// ---------------------------------------------------------------------------

/**
 * Statut de cycle de vie du doc /pendingEmails.
 *
 * - `pending`  : créé par un producteur, en attente du sender.
 * - `sent`     : envoyé avec succès (sentAt + messageId posés).
 * - `failed`   : échec définitif (template inconnu, context invalide, SMTP fatal).
 *                Le doc reste inspectable, pas de retry automatique en PR1.
 */
export type PendingEmailStatus = 'pending' | 'sent' | 'failed'

/**
 * Shape attendu d'un doc `/pendingEmails/{emailId}`.
 *
 * Note : `to` est polymorphe pour compatibilité avec les producteurs
 * existants — `submitRegistration` pose `string` alors que les helpers dues
 * posent `string[] | null`. Le sender normalise vers `string[]`.
 */
export interface PendingEmailDoc {
  to: string | readonly string[] | null
  template: string
  context: Record<string, unknown>
  createdAt: Timestamp
  sentAt: Timestamp | null
  /** Posé par le sender — absent sur les docs créés avant PR1. */
  status?: PendingEmailStatus
  /** Posé par le sender en cas d'échec (code court + message tronqué). */
  error?: string | null
  /** Posé par le sender en cas de succès — Message-ID retourné par Plesk. */
  messageId?: string | null
  /** Incrementé à chaque tentative — utile pour debug. */
  attempts?: number
  /** Posé à chaque tentative (pour audit même si le doc reste pending). */
  lastAttemptAt?: Timestamp | null
}
