/**
 * Helpers de résolution & enqueue des emails de cotisation.
 *
 * Responsabilités :
 *  - Centralise les noms de templates `dues_payment_request` / `dues_payment_confirmed`.
 *  - Calcule le `paymentReference` déterministe à partir du `dueId`.
 *  - Lit `/config/club.banking` pour enrichir le contexte email.
 *  - Résout les destinataires email via `member.comms.billingRecipients`
 *    (joueur via `member.linkedUserId` → `/users/{uid}.email`, et/ou tuteurs
 *    via `member.guardianUserIds[]` → `/users/{uid}.email`).
 *  - Écrit un doc `/pendingEmails/{dueId}_dues_payment_request` avec ID
 *    déterministe (idempotence — un re-trigger ne duplique pas l'enqueue).
 *
 * Les fonctions exportées sont en isolation pure (entrée → sortie) pour
 * faciliter les tests unitaires.
 */
import { logger } from 'firebase-functions/v2'
import * as admin from 'firebase-admin'
import type {
  BankingInfo,
  ClubConfigData,
  CommsRecipient,
  MemberData,
  UserData,
} from '@club-app/shared-types'
import { Timestamp, db, serverTimestamp } from './_helpers'

export type { BankingInfo }

/** Nom du template envoyé pour une demande de paiement de cotisation. */
export const TEMPLATE_DUES_PAYMENT_REQUEST = 'dues_payment_request'
/** Nom du template envoyé après enregistrement manuel d'un paiement. */
export const TEMPLATE_DUES_PAYMENT_CONFIRMED = 'dues_payment_confirmed'

/**
 * Génère le `paymentReference` à partir du `dueId`. Déterministe (8 premiers
 * caractères hex en majuscule, préfixe `DUE-`). Stable même si on rerun la
 * Function — c'est ce qui est imprimé sur l'IBAN dans l'email au joueur.
 */
export function buildPaymentReference(dueId: string): string {
  return `DUE-${dueId.slice(0, 8).toUpperCase()}`
}

/**
 * Lecture du doc `/config/club` → champ `banking`. Retourne un objet neutre
 * (tous champs `null`) si le doc n'existe pas ou si `banking` est absent.
 * On évite de bloquer l'enqueue email pour un club mal configuré — le
 * vendor email gérera l'affichage selon la présence des champs.
 */
export async function readClubBanking(): Promise<BankingInfo> {
  const empty: BankingInfo = {
    iban: null,
    bic: null,
    bankName: null,
    accountHolder: null,
    paymentInstructions: null,
  }
  const snap = await db().doc('config/club').get()
  if (!snap.exists) return empty
  const cfg = snap.data() as Partial<ClubConfigData> | undefined
  if (!cfg?.banking) return empty
  return cfg.banking
}

/**
 * Résout la liste des emails destinataires pour un member, en suivant la
 * politique `member.comms.billingRecipients` :
 *  - `'member'` : on prend `users[member.linkedUserId].email` si présent.
 *  - `'guardians'` : on prend `users[uid].email` pour chaque uid de
 *    `member.guardianUserIds`.
 *
 * Les emails inconnus sont silencieusement ignorés (loggés en warning).
 * Renvoie une liste dédupliquée, ordre stable.
 */
export async function resolveBillingRecipients(
  member: MemberData,
): Promise<string[]> {
  const recipients: CommsRecipient[] = member.comms?.billingRecipients ?? []
  const uids: string[] = []
  if (recipients.includes('member') && member.linkedUserId) {
    uids.push(member.linkedUserId)
  }
  if (recipients.includes('guardians')) {
    for (const uid of member.guardianUserIds ?? []) {
      if (!uids.includes(uid)) uids.push(uid)
    }
  }
  if (uids.length === 0) return []

  const refs = uids.map((uid) => db().doc(`users/${uid}`))
  const snaps = await db().getAll(...refs)
  const emails: string[] = []
  for (let i = 0; i < snaps.length; i++) {
    const snap = snaps[i]
    const uid = uids[i]
    if (!snap.exists) {
      logger.warn('resolveBillingRecipients: user doc missing', { uid })
      continue
    }
    const user = snap.data() as UserData
    const email = typeof user.email === 'string' && user.email.length > 0
      ? user.email
      : null
    if (!email) {
      logger.warn('resolveBillingRecipients: user has no email', { uid })
      continue
    }
    if (!emails.includes(email)) emails.push(email)
  }
  return emails
}

interface EnqueueDuesPaymentRequestArgs {
  dueId: string
  amount: number
  memberId: string
  memberFirstName: string
  memberLastName: string
  recipients: readonly string[]
  banking: BankingInfo
  paymentReference: string
  /** ISO string (jour-grained) — typiquement `due.dueAt`. */
  dueAt: string | null
  seasonName?: string | null
}

/**
 * Doc `/pendingEmails/{dueId}_dues_payment_request`. ID déterministe →
 * `set` idempotent (mais le caller doit re-vérifier `due.emailedAt` côté
 * Firestore avant d'appeler pour éviter de réécrire le doc inutilement).
 */
export function enqueueDuesPaymentRequest(
  args: EnqueueDuesPaymentRequestArgs,
): Promise<FirebaseFirestore.WriteResult> {
  const {
    dueId,
    amount,
    memberFirstName,
    memberLastName,
    recipients,
    banking,
    paymentReference,
    dueAt,
    seasonName,
  } = args
  const pendingRef = db().doc(`pendingEmails/${dueId}_dues_payment_request`)
  return pendingRef.set({
    to: recipients.length > 0 ? [...recipients] : null,
    template: TEMPLATE_DUES_PAYMENT_REQUEST,
    context: {
      memberName: `${memberFirstName} ${memberLastName}`.trim(),
      amount,
      currency: 'CHF',
      iban: banking.iban,
      bic: banking.bic,
      bankName: banking.bankName,
      accountHolder: banking.accountHolder,
      paymentReference,
      paymentInstructions: banking.paymentInstructions,
      dueAt,
      seasonName: seasonName ?? null,
    },
    createdAt: serverTimestamp(),
    sentAt: null,
  })
}

interface EnqueueDuesPaymentConfirmedArgs {
  dueId: string
  amount: number
  memberFirstName: string
  memberLastName: string
  recipients: readonly string[]
  paidAt: string
  paymentMethod: string
  paymentReference: string
}

/**
 * Doc `/pendingEmails/{dueId}_dues_payment_confirmed`. ID déterministe → set
 * idempotent. Appelé par `markDuePaid` une fois le due flippé en `paid`.
 */
export function enqueueDuesPaymentConfirmed(
  args: EnqueueDuesPaymentConfirmedArgs,
): Promise<FirebaseFirestore.WriteResult> {
  const {
    dueId,
    amount,
    memberFirstName,
    memberLastName,
    recipients,
    paidAt,
    paymentMethod,
    paymentReference,
  } = args
  const pendingRef = db().doc(`pendingEmails/${dueId}_dues_payment_confirmed`)
  return pendingRef.set({
    to: recipients.length > 0 ? [...recipients] : null,
    template: TEMPLATE_DUES_PAYMENT_CONFIRMED,
    context: {
      memberName: `${memberFirstName} ${memberLastName}`.trim(),
      amount,
      currency: 'CHF',
      paidAt,
      paymentMethod,
      paymentReference,
    },
    createdAt: serverTimestamp(),
    sentAt: null,
  })
}

/**
 * Idempotence-safe : check si le doc `/pendingEmails/{deterministicId}`
 * existe déjà. Pratique pour éviter les ré-écritures (qui ne dupliqueraient
 * pas mais bumperaient `createdAt`).
 */
export async function pendingEmailExists(docId: string): Promise<boolean> {
  const snap = await db().doc(`pendingEmails/${docId}`).get()
  return snap.exists
}

/** Convertit un Firestore Timestamp en ISO string (UTC, day-grained suffit). */
export function tsToIso(ts: { seconds: number; nanoseconds: number } | null | undefined): string | null {
  if (!ts) return null
  return new Date(ts.seconds * 1000).toISOString()
}

/** Convenience: now() ISO string — pour `markDuePaid` quand le caller n'a pas fourni `paidAt`. */
export function nowIso(): string {
  return new Date(Timestamp.now().seconds * 1000).toISOString()
}

/** Petit alias autour de `admin.firestore.FieldValue` pour les call sites. */
export const FieldValue = admin.firestore.FieldValue

/**
 * Extrait le `.code` d'une erreur Firebase (admin SDK ou interface
 * `FirebaseError`). On ne peut pas faire `instanceof FirebaseError` côté
 * admin (c'est une interface), on duck-type sur la présence du champ.
 */
export function errCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const c = (err as { code: unknown }).code
    if (typeof c === 'string') return c
  }
  return 'unknown'
}
