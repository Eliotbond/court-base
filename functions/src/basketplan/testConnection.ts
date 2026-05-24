/**
 * `testBasketplanConnection` — callable admin only.
 *
 * Diagnostic Settings : ping l'endpoint `findAllLeagueHoldings.do` pour la
 * `defaultFederationId` configurée, parse la réponse, retourne un compte
 * de ligues ou un message d'erreur en clair (pas d'`unavailable` global
 * comme les autres callables — on veut afficher la cause à l'admin).
 *
 * Auth : admin / rootAdmin uniquement. Garde via `assertAdminOnly`.
 *
 * Input wire : `{}` (lit `config/club.basketplan.defaultFederationId`).
 *
 * Retour `{ ok: true, leagueCount, federationId }` OR
 * `{ ok: false, error: string, federationId? }`. Pas d'exception sur
 * erreur réseau — on emballe pour que l'UI puisse afficher l'erreur
 * directement.
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import { logger } from '../shared/logger'
import type { ClubConfigData } from '@club-app/shared-types'
import {
  buildBasketplanUrl,
  fetchBasketplanXml,
  parseXml,
} from './_client'
import { parseLeagueHoldings } from './_parsers'
import { assertAdminOnly, loadCallerUser } from './_authz'

interface TestConnectionInput {
  // Aucun champ — réservé pour évolution future (override federationId).
  [k: string]: unknown
}

export interface TestConnectionOutput {
  ok: boolean
  federationId: number | null
  leagueCount?: number
  error?: string
}

/**
 * Charge `/config/club.basketplan` et retourne la `defaultFederationId`.
 * Renvoie `null` si l'intégration n'est pas encore configurée — le caller
 * remonte alors un message UI dédié.
 */
async function loadDefaultFederationId(): Promise<number | null> {
  const snap = await admin.firestore().doc('config/club').get()
  if (!snap.exists) return null
  const cfg = snap.data() as ClubConfigData
  const fed = cfg.basketplan?.defaultFederationId
  if (typeof fed !== 'number' || !Number.isFinite(fed) || fed <= 0) {
    return null
  }
  return fed
}

export const testBasketplanConnection = onCall(
  async (
    request: CallableRequest<TestConnectionInput>,
  ): Promise<TestConnectionOutput> => {
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        '[testBasketplanConnection] Must be signed in.',
      )
    }
    const user = await loadCallerUser(request.auth.uid)
    assertAdminOnly(request.auth, user)

    const federationId = await loadDefaultFederationId()
    if (federationId === null) {
      return {
        ok: false,
        federationId: null,
        error:
          'config/club.basketplan.defaultFederationId not set. Configure the Basketplan integration first.',
      }
    }

    const url = buildBasketplanUrl('findAllLeagueHoldings.do', { federationId })
    try {
      const xml = await fetchBasketplanXml(url)
      const items = parseLeagueHoldings(parseXml(xml))
      logger.info('[testBasketplanConnection] ok', {
        federationId,
        leagueCount: items.length,
      })
      return {
        ok: true,
        federationId,
        leagueCount: items.length,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn('[testBasketplanConnection] fetch/parse failed', {
        federationId,
        url,
        err: msg,
      })
      return {
        ok: false,
        federationId,
        error: msg,
      }
    }
  },
)
