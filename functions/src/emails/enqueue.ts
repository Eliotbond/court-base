/**
 * Helper générique `enqueueEmail` — écrit un doc `/pendingEmails/{id}` avec
 * un ID déterministe (idempotent set). Le sender prend le relais via le
 * trigger `onDocumentCreated`.
 *
 * Pattern reproduit depuis `dues/_emailEnqueue.ts` mais typé via
 * `ContextByTemplate[K]` pour empêcher les drift de schéma au call site.
 *
 * Les wrappers historiques (`enqueueDuesPaymentRequest`, etc.) restent
 * exportés en l'état pour zéro breaking change ; ils seront refactorés pour
 * appeler `enqueueEmail` en interne dans PR2.
 */
import { db, serverTimestamp } from './_db'
import type { ContextByTemplate, EmailTemplateKey } from './types'

export interface EnqueueEmailArgs<K extends EmailTemplateKey> {
  /** Template key déterminant le rendering côté sender. */
  template: K
  /**
   * Destinataires. Peut être :
   *  - tableau d'emails (cas normal)
   *  - `null` quand aucun email n'est résoluble (audit-only, le sender
   *    marquera failed/no_recipients)
   */
  to: readonly string[] | null
  /** Context typé selon le template. */
  context: ContextByTemplate[K]
  /**
   * ID déterministe pour idempotence. Convention :
   * `${entityId}_${template}` (ex. `regAbc123_registration_submitted_confirm`).
   * Permet à un re-trigger du producteur de ne pas dupliquer l'enqueue.
   */
  idempotencyKey: string
}

/**
 * Écrit `/pendingEmails/{idempotencyKey}` via `set` (overwrite OK, le doc ID
 * étant déterministe). Si le sender a déjà envoyé l'email (status='sent'),
 * cet overwrite va le ré-écrire — c'est pourquoi le caller doit guarder via
 * `pendingEmailExists` ou via un marqueur métier (`due.emailedAt`,
 * `registration.confirmedAt`, etc.) si besoin de strict-once.
 *
 * Pour un re-trigger Firestore standard, l'overwrite est inoffensif tant
 * que le doc n'a pas encore été processé (status='pending').
 */
export function enqueueEmail<K extends EmailTemplateKey>(
  args: EnqueueEmailArgs<K>,
): Promise<FirebaseFirestore.WriteResult> {
  const { template, to, context, idempotencyKey } = args
  return db().doc(`pendingEmails/${idempotencyKey}`).set({
    to: to && to.length > 0 ? [...to] : null,
    template,
    context,
    createdAt: serverTimestamp(),
    sentAt: null,
    status: 'pending',
  })
}

/**
 * Vérifie si un doc /pendingEmails existe déjà. Pratique côté caller pour
 * skip l'enqueue (et éviter de bumper `createdAt`).
 */
export async function pendingEmailExists(docId: string): Promise<boolean> {
  const snap = await db().doc(`pendingEmails/${docId}`).get()
  return snap.exists
}
