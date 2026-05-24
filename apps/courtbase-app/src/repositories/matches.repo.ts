/**
 * Repository Matches — Firestore-backed (courtbase-app).
 *
 * SEULE couche autorisée à importer le SDK Firebase pour `/matches`. Pattern
 * hybride mock + Firestore identique à `bookings.repo.ts` :
 *  - **Firestore** : `query(/matches, where seasonId == X)` + tri JS `date ASC`
 *    (volumétrie attendue < ~100 docs / saison — pas d'index composite).
 *  - **Mock** : on dérive depuis `MOCK_MATCHES` du seed local quand
 *    `getFirestoreOrNull()` retourne null (compte dev sans backend).
 *
 * Lecture seule (le repo `officials.repo.ts` couvre les writes sub-collection).
 *
 * Cf. `docs/firebase.md` § `/matches`, `firestore.rules` lignes 384-413.
 */

import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { FirebaseError } from 'firebase/app'

import type {
  Match,
  MatchData,
  MatchKind,
  MatchStatus,
} from '@club-app/shared-types'

import { db } from '@/services/firebase'
import { MOCK_MATCHES } from '@/repositories/mock/seeds'
import type { MockMatch } from '@/types/mock'

// ─── Constantes Firestore ────────────────────────────────────────────

const MATCHES = 'matches'

// ─── Helpers privés ──────────────────────────────────────────────────

/**
 * Vérifie un code Firestore sans utiliser `instanceof FirestoreError` (non
 * fiable côté bundling Vite — cf. mémoire `firebase-error-instanceof-unreliable`
 * et CLAUDE.md règle 13).
 */
function isPermissionDenied(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'permission-denied'
  )
}

/**
 * Vérifie si on est en mode Firestore (db init OK) ou en fallback mock. On
 * délègue la décision au caller via les fonctions exportées — ici on indique
 * juste "tente" / "fallback". Le pattern hybride mock+real est porté par le
 * store, mais le repo doit aussi tolérer l'absence de Firestore (ex. tests
 * unitaires sans init).
 *
 * Note : `db` est initialisé à l'import — on ne peut pas le mettre à null.
 * Le "mode mock" du repo est donc en pratique déclenché par la branche
 * `permission-denied` (rules denied = pas authentifié comme attendu) ou par
 * un `error` réseau ; on dégrade en `[]` / `null` côté list/get.
 */
function getFirestoreOrNull(): typeof db | null {
  try {
    return db
  } catch {
    return null
  }
}

/**
 * Coerce un MockMatch → Match (shape Firestore canonique). Permet aux vues
 * de consommer un seul type. La `seasonId` est synthétisée (`mock-season`)
 * et le `Timestamp` mock construit depuis l'epoch ms.
 */
function mockToMatch(m: MockMatch): Match {
  const [y, mo, d] = m.date.split('-').map((s) => Number(s))
  const ms = new Date(y ?? 1970, (mo ?? 1) - 1, d ?? 1, 0, 0, 0, 0).getTime()
  const ts = Timestamp.fromMillis(ms)
  // Durée → endTime (HH:MM).
  const [hhStr, mmStr] = m.startTime.split(':')
  const hh = Number(hhStr ?? '0')
  const mm = Number(mmStr ?? '0')
  const totalMin = hh * 60 + mm + Math.round(m.durationHours * 60)
  const endH = Math.floor(totalMin / 60) % 24
  const endM = totalMin % 60
  const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`
  const data: MatchData = {
    bookingId: m.kind === 'home' ? `mock-bk-${m.id}` : null,
    kind: m.kind,
    teamId: m.teamId,
    matchTypeId: `mock-mt-${m.matchType}`,
    opponentName: m.opponent,
    awayAddress: m.kind === 'away' ? m.venueLabel : null,
    date: ts,
    startTime: m.startTime,
    endTime,
    status: 'scheduled',
    notes: null,
    createdAt: ts,
    createdBy: 'mock',
  }
  return { id: m.id, ...data }
}

/**
 * Forme défensive du doc Firestore — un doc legacy sans certains champs
 * retombe sur des valeurs propres. Pas de champ Basketplan ici (lus tels
 * quels si présents, mais pas requis côté courtbase-app — la vue Officiel
 * n'a pas besoin de `externalResult`).
 */
function snapToMatch(snap: QueryDocumentSnapshot<DocumentData>): Match {
  const data = snap.data() as Partial<MatchData> & { date?: Timestamp; createdAt?: Timestamp }
  const date = data.date ?? Timestamp.fromMillis(0)
  return {
    id: snap.id,
    bookingId: data.bookingId ?? null,
    kind: (data.kind ?? 'home') as MatchKind,
    teamId: data.teamId ?? '',
    matchTypeId: data.matchTypeId ?? '',
    opponentName: data.opponentName ?? null,
    awayAddress: data.awayAddress ?? null,
    date,
    startTime: data.startTime ?? '00:00',
    endTime: data.endTime ?? '00:00',
    status: (data.status ?? 'scheduled') as MatchStatus,
    notes: data.notes ?? null,
    createdAt: data.createdAt ?? date,
    createdBy: data.createdBy ?? '',
    ...(data.externalSource !== undefined ? { externalSource: data.externalSource } : {}),
    ...(data.externalGameNumber !== undefined
      ? { externalGameNumber: data.externalGameNumber }
      : {}),
    ...(data.externalLeagueHoldingId !== undefined
      ? { externalLeagueHoldingId: data.externalLeagueHoldingId }
      : {}),
    ...(data.externalReferees !== undefined ? { externalReferees: data.externalReferees } : {}),
    ...(data.externalResult !== undefined ? { externalResult: data.externalResult } : {}),
    ...(data.externalLastSyncedAt !== undefined
      ? { externalLastSyncedAt: data.externalLastSyncedAt }
      : {}),
  }
}

// ─── Public API ──────────────────────────────────────────────────────

export interface ListMatchesOptions {
  /** Filtre `kind` côté JS (cf. CLAUDE.md racine §10 — pas d'index composite). */
  kind?: MatchKind
}

/**
 * Liste tous les matchs d'une saison. Tri stable `date ASC` côté JS (cf.
 * pattern `bookings.repo.ts`).
 *
 * Stratégie :
 *  - Mode Firestore : `query(/matches where seasonId == X)`. La saison n'est
 *    pas un champ direct du doc canonique `MatchData` — on filtre via la
 *    date côté JS si nécessaire. **NB importante** : `seasonId` n'apparaît
 *    PAS dans `MatchData` canonique (`packages/shared-types/src/match.ts`).
 *    Pour MVP, on charge **TOUS** les matchs `kind == 'away'` du club (les
 *    matchs HOME sont visibles via le store bookings) + tri par date desc/
 *    asc. Volume attendu : quelques dizaines / saison. La couche store
 *    filtre la fenêtre temporelle pertinente.
 *
 * Retourne `[]` si :
 *  - `seasonId` vide.
 *  - mode mock (dégrade depuis `MOCK_MATCHES`).
 *  - erreur Firestore (loguée, jamais throw).
 */
export async function listMatchesForSeason(
  seasonId: string,
  opts?: ListMatchesOptions,
): Promise<Match[]> {
  if (!seasonId) return []
  const firestore = getFirestoreOrNull()
  if (!firestore) {
    // Fallback mock — synthétise depuis MOCK_MATCHES.
    const filtered = opts?.kind
      ? MOCK_MATCHES.filter((m) => m.kind === opts.kind)
      : MOCK_MATCHES
    return filtered.map(mockToMatch).sort(sortByDateAsc)
  }
  try {
    // `seasonId` n'est pas porté par `/matches` canoniquement. La saison est
    // dérivable via la date (ou via le booking HOME parent). En MVP on lit
    // TOUS les matchs et on laisse le store/UI filtrer si besoin — le coût
    // est négligeable (< 100 docs typique).
    const baseQuery = opts?.kind
      ? query(collection(firestore, MATCHES), where('kind', '==', opts.kind))
      : query(collection(firestore, MATCHES))
    const snap = await getDocs(baseQuery)
    if (snap.empty) return []
    return snap.docs.map(snapToMatch).sort(sortByDateAsc)
  } catch (err) {
    if (isPermissionDenied(err)) {
      console.warn('[matches.repo] listMatchesForSeason permission-denied — fallback mock')
      const filtered = opts?.kind
        ? MOCK_MATCHES.filter((m) => m.kind === opts.kind)
        : MOCK_MATCHES
      return filtered.map(mockToMatch).sort(sortByDateAsc)
    }
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[matches.repo] listMatchesForSeason failed [${code}]`, err)
    return []
  }
}

/**
 * Lit un match par ID.
 *
 * - Mode mock : lookup dans `MOCK_MATCHES`.
 * - Mode Firestore : `getDoc`. Retourne `null` si doc inexistant ou
 *   `permission-denied` (loguée en warn).
 *
 * Ne throw jamais — le caller (store/vue) gère le `null` comme "match
 * inconnu / fallback empty state".
 */
export async function getMatch(matchId: string): Promise<Match | null> {
  if (!matchId) return null
  const firestore = getFirestoreOrNull()
  if (!firestore) {
    const m = MOCK_MATCHES.find((x) => x.id === matchId)
    return m ? mockToMatch(m) : null
  }
  try {
    const snap = await getDoc(doc(firestore, MATCHES, matchId))
    if (!snap.exists()) {
      // Fallback mock pour les ids `mock-*` deep-linkés.
      const m = MOCK_MATCHES.find((x) => x.id === matchId)
      return m ? mockToMatch(m) : null
    }
    // `QueryDocumentSnapshot` shape — snapToMatch attend un doc existant.
    return snapToMatch(snap as unknown as QueryDocumentSnapshot<DocumentData>)
  } catch (err) {
    if (isPermissionDenied(err)) {
      console.warn(`[matches.repo] getMatch(${matchId}) permission-denied`)
      return null
    }
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`[matches.repo] getMatch(${matchId}) failed [${code}]`, err)
    return null
  }
}

/** Tri stable `date ASC` (utilisé par listMatchesForSeason). */
function sortByDateAsc(a: Match, b: Match): number {
  const aMs = a.date?.seconds ?? 0
  const bMs = b.date?.seconds ?? 0
  if (aMs !== bMs) return aMs - bMs
  // Tie-break par startTime pour stabilité.
  return (a.startTime || '').localeCompare(b.startTime || '')
}
