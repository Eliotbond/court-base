/**
 * `_client.ts` — accès HTTP brut à Basketplan + parsing XML générique.
 *
 * Toutes les ressources Basketplan retournent du XML quand on suffixe
 * `?xmlView=true&perspective=default` à l'URL HTML publique — aucune
 * authentification requise (cf. `docs/basketplan-integration.md` § 2.1).
 *
 * Conventions :
 *  - `fetch` est natif sur Node ≥ 18 (Functions v2 = Node 20) — pas de
 *    dépendance externe.
 *  - On parse avec `fast-xml-parser` configuré pour exposer les attributs
 *    sans préfixe et garder les enfants nommés. Les attributs numériques
 *    sont conservés en string (les parsers métier convertissent en number
 *    au besoin — plus prévisible que le coercer auto de la lib).
 *  - Timeout 15s par défaut : Basketplan répond généralement < 1s, mais on
 *    se protège des hangs en sync nocturne.
 *  - Try/catch côté callers : ce module ne sait pas si l'erreur est fatale
 *    pour un sync entier ou juste pour un link (cf. CLAUDE.md racine,
 *    règle 9).
 */
import { XMLParser } from 'fast-xml-parser'

/** Base URL Basketplan — utilisée par `buildBasketplanUrl`. */
export const BASKETPLAN_BASE_URL = 'https://www.basketplan.ch'

/** Suffixe obligatoire pour basculer une page HTML en XML. */
export const XML_VIEW_SUFFIX = 'xmlView=true&perspective=default'

/** Timeout par défaut d'un fetch Basketplan (ms). */
const DEFAULT_TIMEOUT_MS = 15_000

/**
 * Compose une URL Basketplan complète à partir d'un chemin endpoint
 * (sans `?` initial) et d'une query optionnelle.
 *
 * Exemples :
 *   buildBasketplanUrl('findAllLeagueHoldings.do', { federationId: 9 })
 *   // -> "https://www.basketplan.ch/findAllLeagueHoldings.do?federationId=9&xmlView=true&perspective=default"
 *
 *   buildBasketplanUrl('showLeagueSchedule.do', { leagueHoldingId: 10584 })
 *   // -> "https://www.basketplan.ch/showLeagueSchedule.do?leagueHoldingId=10584&xmlView=true&perspective=default"
 */
export function buildBasketplanUrl(
  endpoint: string,
  query: Record<string, string | number>,
): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    params.set(k, String(v))
  }
  // Ajoute systématiquement les flags xmlView en fin pour ne pas dépendre
  // de l'appelant (= moins de chance d'oublier).
  const queryStr = params.toString()
  const sep = queryStr.length > 0 ? '&' : ''
  return `${BASKETPLAN_BASE_URL}/${endpoint}?${queryStr}${sep}${XML_VIEW_SUFFIX}`
}

/**
 * Fetch une URL Basketplan et retourne le **texte XML brut**.
 *
 * Lève une `Error` (message explicite) si :
 *   - status HTTP ≠ 2xx,
 *   - timeout dépassé (`AbortController`),
 *   - body vide (suspect — Basketplan retourne toujours un doc XML, même
 *     pour une fédération inconnue).
 */
export async function fetchBasketplanXml(
  url: string,
  options?: { timeoutMs?: number },
): Promise<string> {
  const controller = new AbortController()
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/xml, text/xml' },
    })
    if (!res.ok) {
      throw new Error(
        `Basketplan HTTP ${res.status} ${res.statusText} on ${url}`,
      )
    }
    const text = await res.text()
    if (text.length === 0) {
      throw new Error(`Basketplan returned empty body for ${url}`)
    }
    return text
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Basketplan fetch timeout (${timeoutMs}ms) on ${url}`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Singleton XMLParser configuré pour le format Basketplan.
 *
 *  - `ignoreAttributes: false` : on veut tous les attributs (id, name, etc.).
 *  - `attributeNamePrefix: ''` : pas de préfixe `@_` parasite.
 *  - `parseAttributeValue: false` : on garde les valeurs en string et les
 *    parsers métier les convertissent en number/boolean au besoin (évite
 *    les surprises type "025" → 25 ou "2025-10-01" → NaN).
 *  - `allowBooleanAttributes: true` : tolérance.
 *  - `trimValues: true` : nettoyage des espaces autour des textContent.
 */
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  allowBooleanAttributes: true,
  trimValues: true,
  // Force `Array` / `ArrayList` à toujours produire un array (sinon
  // single-element devient un objet, ce qui casse les `.map`).
  isArray: (name) => name === 'Array' || name === 'ArrayList',
})

/**
 * Parse une string XML en arbre JS générique. Type de retour `unknown` :
 * c'est aux parsers métier (`_parsers.ts`) de naviguer la structure et de
 * typer le résultat.
 */
export function parseXml(xml: string): unknown {
  return xmlParser.parse(xml)
}
