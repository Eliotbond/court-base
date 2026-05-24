/**
 * `_sync.ts` — algorithme central de synchronisation Basketplan → court-base.
 *
 * **PR 2 — scope : AWAY + backfill.**
 *
 * Pour chaque `Game` extrait d'un `showLeagueSchedule.do`, `applyGame`
 * réconcilie l'état Basketplan avec `/matches` court-base en trois passes :
 *
 *   1. **Patch d'un match déjà synchronisé** (via `externalGameNumber`)
 *      → met à jour arbitres + score + statut homologué. Le match a déjà
 *      été créé par un sync précédent (ou par un coach, et déjà lié).
 *   2. **Liaison à un match manuel** (créé à la main par admin/coach) :
 *      même équipe court-base + date ±24h + opponentName fuzzy match
 *      (Levenshtein ≤ 2). Pose les champs `external*` sur le match
 *      existant — pas de duplication.
 *   3. **Création AWAY** quand notre équipe est `guestTeam` du match
 *      Basketplan et qu'aucun match court-base n'a été trouvé. Le match
 *      est créé en `kind: 'away'`, `bookingId: null`, avec tous les
 *      champs `external*` posés.
 *
 * Cas HOME (notre équipe est `homeTeam`) → **différé en PR 3** (création
 * de booking + match avec matching venue/court fuzzy, ou inbox). Ici on
 * renvoie `{ action: 'skipped-home', reason: 'home-creation-deferred-to-pr3' }`.
 *
 * Idempotence forte :
 *   - Re-jouer le même `applyGame` une seconde fois → l'étape 1 patch
 *     les mêmes champs (avec un `externalLastSyncedAt` actualisé) sans
 *     duplication, et ne re-pose `status: 'played'` que si le précédent
 *     état était `≠ 'played'`.
 *   - Concurrent runs (cron + callable manuelle déclenchée par un coach
 *     dans la même fenêtre) : les patches sont idempotents — le pire cas
 *     est un double write sur le même match avec le même contenu.
 *
 * Tests : voir `__tests__/sync.test.ts` (mocks Firestore + cas réels).
 */
import * as admin from 'firebase-admin'
import type {
  MatchData,
  MatchExternalReferees,
  MatchExternalResult,
  MatchTypeData,
  Team,
  BasketplanCompetitionLink,
} from '@club-app/shared-types'
import { logger } from '../shared/logger'
import type { Game } from './_parsers'

// ---------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------

/**
 * Résultat d'un `applyGame` — tagged union pour permettre au caller de
 * compter par action (sync summary).
 */
export type ApplyGameResult =
  | { action: 'patched-existing'; matchId: string }
  | { action: 'linked-manual'; matchId: string; confidence: number }
  | { action: 'created-away'; matchId: string }
  | { action: 'skipped-home'; reason: 'home-creation-deferred-to-pr3' }
  | { action: 'skipped-noise'; reason: string }

/**
 * Compteur d'actions agrégé (pour le summary d'un sync de team).
 */
export interface SyncActionsSummary {
  processed: number
  patched: number
  linked: number
  created: number
  skipped: number
  errors: number
}

export function emptySyncActionsSummary(): SyncActionsSummary {
  return {
    processed: 0,
    patched: 0,
    linked: 0,
    created: 0,
    skipped: 0,
    errors: 0,
  }
}

export function tallyAction(
  summary: SyncActionsSummary,
  res: ApplyGameResult,
): void {
  summary.processed += 1
  switch (res.action) {
    case 'patched-existing':
      summary.patched += 1
      break
    case 'linked-manual':
      summary.linked += 1
      break
    case 'created-away':
      summary.created += 1
      break
    case 'skipped-home':
    case 'skipped-noise':
      summary.skipped += 1
      break
  }
}

// ---------------------------------------------------------------------------
// Distance de Levenshtein (matching opponentName)
// ---------------------------------------------------------------------------

/**
 * Distance d'édition entre deux strings (insert / delete / substitute = 1).
 *
 * Implémentation classique O(m*n) avec deux lignes (mémoire O(min(m,n))).
 * Pas de dépendance externe — la string la plus longue qu'on compare ici
 * fait quelques dizaines de chars (nom d'équipe Basketplan), donc l'algo
 * trivial est largement suffisant.
 *
 * Normalisation pré-application : `toLowerCase()` + `trim()` côté caller
 * (cf. `fuzzyMatchOpponent`) pour absorber les variations cosmétiques sans
 * polluer la distance pure.
 */
export function levenshtein(a: string, a2: string): number {
  // Note : noms a / a2 pour éviter conflit avec `s` du formatter.
  const m = a.length
  const n = a2.length
  if (m === 0) return n
  if (n === 0) return m

  // On itère sur la plus courte des deux pour minimiser la mémoire.
  const [shorter, longer] = m <= n ? [a, a2] : [a2, a]
  const sLen = shorter.length
  const lLen = longer.length

  let prev = new Array<number>(sLen + 1)
  let curr = new Array<number>(sLen + 1)
  for (let j = 0; j <= sLen; j += 1) prev[j] = j

  for (let i = 1; i <= lLen; i += 1) {
    curr[0] = i
    for (let j = 1; j <= sLen; j += 1) {
      const cost = longer.charCodeAt(i - 1) === shorter.charCodeAt(j - 1) ? 0 : 1
      const ins = curr[j - 1] + 1
      const del = prev[j] + 1
      const sub = prev[j - 1] + cost
      let min = ins
      if (del < min) min = del
      if (sub < min) min = sub
      curr[j] = min
    }
    // Swap
    const tmp = prev
    prev = curr
    curr = tmp
  }
  return prev[sLen]
}

/**
 * Compare deux noms d'équipe avec normalisation (lowercase + trim +
 * compaction des espaces). Retourne la distance brute (0 = identique
 * après normalisation, ∞ ≈ rien à voir).
 */
export function fuzzyMatchOpponent(a: string | null, b: string | null): number {
  if (!a || !b) return Number.POSITIVE_INFINITY
  const norm = (s: string): string =>
    s.toLowerCase().trim().replace(/\s+/g, ' ')
  return levenshtein(norm(a), norm(b))
}

/** Seuil "match accepté" pour la liaison à un match manuel. */
export const FUZZY_MATCH_THRESHOLD = 2

// ---------------------------------------------------------------------------
// Helpers internes
// ---------------------------------------------------------------------------

/**
 * Vrai si l'état Basketplan correspond à un match validé fédéralement.
 *
 * Liste élargie pour absorber les variantes : `homologué` (accent FR),
 * `homologue` (sans accent — parfois rencontré), `joué` (parfois renvoyé
 * en intermédiaire avant l'homologation finale). On reste prudent : seul
 * `homologué` force `status: 'played'` (cf. brief § 5.3).
 *
 * En cas de doute (cas `'joué'` simple) on ne touche pas au statut local
 * — l'admin/coach peut toujours marquer le match `played` à la main.
 */
export function isHomologatedState(state: string | null | undefined): boolean {
  if (!state) return false
  const norm = state.toLowerCase().trim()
  return norm === 'homologué' || norm === 'homologue' || norm === 'homologated'
}

/** Convertit `Game.result` (parser) → `MatchExternalResult` (shared-types). */
function mapResult(game: Game): MatchExternalResult | null {
  if (!game.result) return null
  return {
    homeScore: game.result.homeScore,
    awayScore: game.result.guestScore,
    homologated: isHomologatedState(game.state),
    byQuarter: game.result.byQuarter.map((q) => ({
      home: q.home,
      away: q.guest,
    })),
  }
}

/** Convertit les arbitres `Game` → `MatchExternalReferees`. */
function mapReferees(game: Game): MatchExternalReferees | null {
  // Si aucun référé désigné, on stocke `null` global plutôt qu'un objet
  // avec 3 `null` (économie de tokens Firestore + sémantique claire).
  if (!game.referee1Name && !game.referee2Name && !game.expertName) {
    return null
  }
  return {
    referee1: game.referee1Name ?? null,
    referee2: game.referee2Name ?? null,
    expert: game.expertName ?? null,
  }
}

/**
 * Compose une chaîne `awayAddress` lisible à partir de la location parsée
 * Basketplan. Format : `"name, line1, zip city"` — chaque segment omis
 * s'il est vide. Fallback : `''` si pas de location du tout.
 */
function composeAwayAddress(game: Game): string {
  const loc = game.location
  if (!loc) return ''
  const parts: string[] = []
  if (loc.name) parts.push(loc.name)
  const cityLine = [loc.line1, [loc.zip, loc.city].filter(Boolean).join(' ')]
    .filter((p) => p && p.length > 0)
    .join(', ')
  if (cityLine.length > 0) parts.push(cityLine)
  return parts.join(', ')
}

/**
 * Parse `"HH:MM"` + ajoute 2h, clip à `"23:59"` (cas extrême d'un match qui
 * commencerait à 22h+). Format invariant `HH:MM` zéro-paddé.
 */
export function endTimePlusTwoHours(start: string | null): string {
  if (!start || !/^\d{2}:\d{2}$/.test(start)) return '22:00'
  const [hh, mm] = start.split(':').map((n) => parseInt(n, 10))
  let totalMin = hh * 60 + mm + 120
  if (totalMin >= 24 * 60) totalMin = 23 * 60 + 59
  const eh = Math.floor(totalMin / 60)
  const em = totalMin % 60
  return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`
}

/**
 * Convertit une date Basketplan `"YYYY-MM-DD"` en minuit UTC `Timestamp`.
 * Cohérent avec `coachCreateAwayMatch.utcMidnight` (les triggers downstream
 * lisent `/matches.date` comme une date UTC).
 *
 * Si parse fail → `null` (caller décide de skipper).
 */
export function basketplanDateToTimestamp(
  dateStr: string,
): admin.firestore.Timestamp | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null
  const [y, m, d] = dateStr.split('-').map((n) => parseInt(n, 10))
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return null
  }
  return admin.firestore.Timestamp.fromDate(new Date(Date.UTC(y, m - 1, d)))
}

/** Décale un `Timestamp` de `±h` heures (retourne un nouveau `Timestamp`). */
export function shiftTimestampHours(
  t: admin.firestore.Timestamp,
  hours: number,
): admin.firestore.Timestamp {
  const ms = t.toMillis() + hours * 3600_000
  return admin.firestore.Timestamp.fromMillis(ms)
}

// ---------------------------------------------------------------------------
// Résolution `matchTypeId` pour les matchs créés par le sync
// ---------------------------------------------------------------------------

/**
 * Cache process-local de l'id du matchType générique "Championnat
 * (Basketplan)". Vit le temps d'un cold/warm start de la function — sera
 * re-résolu à chaque cold start, ce qui est acceptable (1 lecture
 * Firestore amortie sur N matchs).
 *
 * Reset explicite via `__resetMatchTypeCacheForTests` (réservé aux tests).
 */
let cachedDefaultMatchTypeId: string | null = null

/** Nom canonique du matchType générique créé par le sync au premier run. */
export const DEFAULT_BASKETPLAN_MATCH_TYPE_NAME = 'Championnat (Basketplan)'

/**
 * Résout le `matchTypeId` à utiliser pour les matchs créés par le sync.
 *
 * Stratégie :
 *
 *   1. **Mapping explicite** : lit `/config/club.basketplan.matchTypeMapping`
 *      (optionnel — clé = `federationCode`, valeur = `matchTypeId`). Si une
 *      entrée matche `link.federationCode` → utilise ce matchTypeId.
 *   2. **Fallback générique** : cherche un `/matchTypes` avec
 *      `name === 'Championnat (Basketplan)'`. Si trouvé → cache + retour.
 *      Sinon → **crée** le doc avec defaults raisonnables (active, color
 *      par défaut, official requirements vides) puis cache + retour.
 *
 * Le mapping explicite n'est pas typé dans `BasketplanIntegrationConfig`
 * pour PR 2 (extension future) — on le lit en cast défensif depuis
 * `config.club.basketplan` arbitraire. Quand le besoin de mapping fin
 * apparaîtra, on étendra `BasketplanIntegrationConfig` proprement.
 */
export async function resolveMatchTypeId(
  link: BasketplanCompetitionLink,
  options?: { firestoreOverride?: FirebaseFirestore.Firestore },
): Promise<string> {
  const firestore = options?.firestoreOverride ?? admin.firestore()

  // 1. Mapping explicite côté config (best-effort, schema-less pour PR 2).
  try {
    const configSnap = await firestore.doc('config/club').get()
    if (configSnap.exists) {
      const data = configSnap.data() as Record<string, unknown>
      const bp = data['basketplan'] as Record<string, unknown> | undefined
      const mapping = bp?.['matchTypeMapping'] as
        | Record<string, unknown>
        | undefined
      if (mapping) {
        const explicit = mapping[link.federationCode]
        if (typeof explicit === 'string' && explicit.length > 0) {
          return explicit
        }
      }
    }
  } catch (err) {
    // Lecture config non-critique : on continue sur le fallback.
    logger.warn('[basketplan/_sync] config read failed, falling back', { err })
  }

  // 2. Fallback générique (avec cache process).
  if (cachedDefaultMatchTypeId) return cachedDefaultMatchTypeId

  // Cherche un matchType existant nommé "Championnat (Basketplan)".
  const existingSnap = await firestore
    .collection('matchTypes')
    .where('name', '==', DEFAULT_BASKETPLAN_MATCH_TYPE_NAME)
    .limit(1)
    .get()
  if (!existingSnap.empty) {
    cachedDefaultMatchTypeId = existingSnap.docs[0].id
    return cachedDefaultMatchTypeId
  }

  // Sinon, on crée le doc.
  const newMatchType: MatchTypeData = {
    name: DEFAULT_BASKETPLAN_MATCH_TYPE_NAME,
    requiredCourtSize: 'normal',
    homeOfficialRequirements: [],
    awayOfficialCount: 0,
    color: '#1F6FEB', // Bleu Basketplan — neutre, lisible sur fond clair.
    active: true,
    createdAt:
      admin.firestore.FieldValue.serverTimestamp() as unknown as MatchTypeData['createdAt'],
  }
  const ref = await firestore.collection('matchTypes').add(newMatchType)
  cachedDefaultMatchTypeId = ref.id
  logger.info('[basketplan/_sync] created default matchType', {
    matchTypeId: ref.id,
    name: DEFAULT_BASKETPLAN_MATCH_TYPE_NAME,
  })
  return cachedDefaultMatchTypeId
}

/** Réservé aux tests : reset le cache du matchType générique. */
export function __resetMatchTypeCacheForTests(): void {
  cachedDefaultMatchTypeId = null
}

// ---------------------------------------------------------------------------
// Algorithme central — `applyGame`
// ---------------------------------------------------------------------------

/**
 * Réconcilie un `Game` Basketplan avec `/matches` court-base.
 *
 * Voir le commentaire en tête de fichier pour le contrat (3 passes).
 *
 * @param team team court-base concernée (id + nom requis ; le caller charge
 *             le doc une seule fois et le passe par link).
 * @param link compétition Basketplan sous laquelle ce game a été découvert.
 * @param game match Basketplan parsé (cf. `parseLeagueSchedule`).
 * @param options injection Firestore pour les tests (sinon Admin SDK).
 */
export async function applyGame(
  team: Pick<Team, 'id' | 'name'>,
  link: BasketplanCompetitionLink,
  game: Game,
  options?: { firestoreOverride?: FirebaseFirestore.Firestore },
): Promise<ApplyGameResult> {
  const firestore = options?.firestoreOverride ?? admin.firestore()

  // Garde noise : sans `gameNumber` on ne peut pas indexer le match (pas de
  // clé d'idempotence). On skip — pas d'action utile possible.
  if (!game.gameNumber || game.gameNumber.length === 0) {
    return { action: 'skipped-noise', reason: 'missing-gameNumber' }
  }

  const referees = mapReferees(game)
  const result = mapResult(game)
  const homologated = isHomologatedState(game.state)
  const externalLastSyncedAt = admin.firestore.FieldValue.serverTimestamp()

  // -------------------------------------------------------------------------
  // Passe 1 — match déjà synchronisé (clé `externalGameNumber`).
  // -------------------------------------------------------------------------
  const existingSnap = await firestore
    .collection('matches')
    .where('externalGameNumber', '==', game.gameNumber)
    .limit(1)
    .get()

  if (!existingSnap.empty) {
    const existingDoc = existingSnap.docs[0]
    const existing = existingDoc.data() as MatchData
    const patch: Partial<MatchData> & Record<string, unknown> = {
      externalReferees: referees,
      externalResult: result,
      externalLastSyncedAt:
        externalLastSyncedAt as unknown as MatchData['externalLastSyncedAt'],
    }
    if (homologated && existing.status !== 'played') {
      patch.status = 'played'
    }
    await existingDoc.ref.update(patch)
    logger.info('[basketplan/_sync] patched existing match', {
      matchId: existingDoc.id,
      gameNumber: game.gameNumber,
      homologated,
    })
    return { action: 'patched-existing', matchId: existingDoc.id }
  }

  // -------------------------------------------------------------------------
  // Passe 2 — tentative de liaison à un match manuel.
  // -------------------------------------------------------------------------
  const gameTs = basketplanDateToTimestamp(game.date)
  if (!gameTs) {
    return { action: 'skipped-noise', reason: 'invalid-date' }
  }

  // Notre équipe est-elle home ou guest dans ce game ?
  const weAreGuest = game.guestTeam.id === link.teamIdInLeague
  const weAreHome = game.homeTeam.id === link.teamIdInLeague
  if (!weAreGuest && !weAreHome) {
    // Bruit (filtre du caller devrait l'avoir éliminé) — skip défensif.
    return { action: 'skipped-noise', reason: 'team-not-involved' }
  }

  // Nom de l'adversaire selon notre côté.
  const opponentName = weAreGuest ? game.homeTeam.name : game.guestTeam.name

  // Recherche match manuel de cette team court-base, dans ±24h.
  const lowerTs = shiftTimestampHours(gameTs, -24)
  const upperTs = shiftTimestampHours(gameTs, +24)
  const manualSnap = await firestore
    .collection('matches')
    .where('teamId', '==', team.id)
    .where('date', '>=', lowerTs)
    .where('date', '<=', upperTs)
    .get()

  if (!manualSnap.empty) {
    // Exclure les matchs déjà liés (externalSource set) — passe 1 les
    // aurait normalement attrapés si le gameNumber matchait, mais on ne
    // veut pas re-lier un match qui pointe vers UN AUTRE gameNumber.
    const candidates = manualSnap.docs
      .map((d) => ({
        id: d.id,
        ref: d.ref,
        data: d.data() as MatchData,
      }))
      .filter((c) => !c.data.externalSource)
      .map((c) => ({
        ...c,
        distance: fuzzyMatchOpponent(c.data.opponentName, opponentName),
      }))
      .filter((c) => c.distance <= FUZZY_MATCH_THRESHOLD)
      .sort((a, b) => a.distance - b.distance)

    if (candidates.length > 0) {
      const best = candidates[0]
      const patch: Partial<MatchData> & Record<string, unknown> = {
        externalSource: 'basketplan',
        externalGameNumber: game.gameNumber,
        externalLeagueHoldingId: link.leagueHoldingId,
        externalReferees: referees,
        externalResult: result,
        externalLastSyncedAt:
          externalLastSyncedAt as unknown as MatchData['externalLastSyncedAt'],
      }
      if (homologated && best.data.status !== 'played') {
        patch.status = 'played'
      }
      await best.ref.update(patch)
      logger.info('[basketplan/_sync] linked manual match', {
        matchId: best.id,
        gameNumber: game.gameNumber,
        confidence: best.distance,
      })
      return {
        action: 'linked-manual',
        matchId: best.id,
        confidence: best.distance,
      }
    }
  }

  // -------------------------------------------------------------------------
  // Passe 3 — création AWAY (HOME différé en PR 3).
  // -------------------------------------------------------------------------
  if (weAreHome) {
    logger.info('[basketplan/_sync] skipped HOME (PR3)', {
      gameNumber: game.gameNumber,
      teamId: team.id,
    })
    return { action: 'skipped-home', reason: 'home-creation-deferred-to-pr3' }
  }

  // weAreGuest → on crée un match AWAY.
  const matchTypeId = await resolveMatchTypeId(link, {
    firestoreOverride: options?.firestoreOverride,
  })

  const startTime = game.time ?? '20:00'
  const endTime = endTimePlusTwoHours(startTime)
  const awayAddress = composeAwayAddress(game)

  const matchData: MatchData = {
    bookingId: null,
    kind: 'away',
    teamId: team.id,
    matchTypeId,
    opponentName,
    awayAddress,
    date: gameTs as unknown as MatchData['date'],
    startTime,
    endTime,
    status: homologated ? 'played' : 'scheduled',
    notes: null,
    createdAt:
      admin.firestore.FieldValue.serverTimestamp() as unknown as MatchData['createdAt'],
    createdBy: 'system:basketplan',
    externalSource: 'basketplan',
    externalGameNumber: game.gameNumber,
    externalLeagueHoldingId: link.leagueHoldingId,
    externalReferees: referees,
    externalResult: result,
    externalLastSyncedAt:
      externalLastSyncedAt as unknown as MatchData['externalLastSyncedAt'],
  }

  const ref = await firestore.collection('matches').add(matchData)
  logger.info('[basketplan/_sync] created AWAY match', {
    matchId: ref.id,
    gameNumber: game.gameNumber,
    teamId: team.id,
    opponentName,
  })
  return { action: 'created-away', matchId: ref.id }
}
