/**
 * `listBasketplanLeagueHoldings` — callable signed-in.
 *
 * Étape 2 de la cascade de mapping côté UI : pour une fédération donnée,
 * retourne la liste des compétitions (championnats + coupes) saison
 * récente. Alimente le dropdown du `BasketplanLinkDialog` web et le picker
 * du `TeamCompetitions.vue` mobile.
 *
 * Auth : tout user signed-in (la lecture XML Basketplan est publique, mais
 * on garde le signed-in pour éviter qu'un projet client serve d'oracle XML
 * sans aucune trace caller).
 *
 * Input wire : `{ federationId: number }`.
 *
 * Cache : `Map<federationId, { items, fetchedAt }>` module-level, TTL 1h.
 * Permet d'absorber les multiples calls UI sans re-fetcher Basketplan à
 * chaque ouverture du dropdown. Le cache vit dans la mémoire de l'instance
 * Cloud Function — chaque cold start repart de zéro (acceptable : un projet
 * client a un volume très faible d'opérations de linkage).
 *
 * Try/catch défensif : toute erreur Basketplan (timeout, parse) est
 * remontée en `HttpsError('unavailable', ...)` avec le message brut pour
 * affichage UI. Pas de partial response.
 *
 * Region : `europe-west6` (héritée du `setGlobalOptions` global).
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from '../shared/logger'
import {
  buildBasketplanUrl,
  fetchBasketplanXml,
  parseXml,
} from './_client'
import { parseLeagueHoldings, type LeagueHolding } from './_parsers'

interface ListLeagueHoldingsInput {
  federationId: unknown
}

export interface ListLeagueHoldingsOutput {
  ok: true
  federationId: number
  /** `true` si la réponse vient du cache (debug). */
  cached: boolean
  items: LeagueHolding[]
}

/** Cache mémoire module-level. TTL 1h. */
const CACHE_TTL_MS = 60 * 60 * 1000
interface CacheEntry {
  items: LeagueHolding[]
  fetchedAt: number
}
const cache = new Map<number, CacheEntry>()

function getCached(federationId: number): LeagueHolding[] | null {
  const entry = cache.get(federationId)
  if (!entry) return null
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    cache.delete(federationId)
    return null
  }
  return entry.items
}

function parseInput(data: ListLeagueHoldingsInput): { federationId: number } {
  const d = data ?? ({} as ListLeagueHoldingsInput)
  const fed = d.federationId
  if (typeof fed !== 'number' || !Number.isFinite(fed) || fed <= 0) {
    throw new HttpsError(
      'invalid-argument',
      'federationId must be a positive number',
    )
  }
  return { federationId: fed }
}

export const listBasketplanLeagueHoldings = onCall(
  async (
    request: CallableRequest<ListLeagueHoldingsInput>,
  ): Promise<ListLeagueHoldingsOutput> => {
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        '[listBasketplanLeagueHoldings] Must be signed in.',
      )
    }
    const { federationId } = parseInput(request.data)

    // --- Cache hit -----------------------------------------------------------
    const cached = getCached(federationId)
    if (cached) {
      return {
        ok: true,
        federationId,
        cached: true,
        items: cached,
      }
    }

    // --- Fetch + parse -------------------------------------------------------
    const url = buildBasketplanUrl('findAllLeagueHoldings.do', {
      federationId,
    })
    let items: LeagueHolding[]
    try {
      const xml = await fetchBasketplanXml(url)
      items = parseLeagueHoldings(parseXml(xml))
    } catch (err) {
      const code = err instanceof Error ? err.name : 'unknown'
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(
        `[listBasketplanLeagueHoldings] fetch/parse failed [${code}]`,
        { federationId, url, err: msg },
      )
      throw new HttpsError(
        'unavailable',
        `Basketplan unavailable: ${msg}`,
      )
    }

    cache.set(federationId, { items, fetchedAt: Date.now() })

    logger.info('[listBasketplanLeagueHoldings] ok', {
      federationId,
      count: items.length,
    })

    return {
      ok: true,
      federationId,
      cached: false,
      items,
    }
  },
)
