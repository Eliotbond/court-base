/**
 * Détection des conflits d'agenda d'un officiel cible pour une demande de
 * remplacement.
 *
 * Quand un officiel A demande un remplacement à un officiel B sur un match
 * `[targetStart, targetEnd]`, on doit savoir si B a déjà un engagement
 * pendant ce créneau — sinon la demande risque d'être déclinée pour conflit
 * trivial. Trois sources de conflit possibles :
 *
 *  - **officiating** : B est déjà assigné comme officiel sur un autre match
 *    (HOME `bookings/{}/officialAssignments` ou AWAY
 *    `matches/{}/officialAssignments`) qui chevauche la fenêtre.
 *  - **coaching** : B coache une équipe dont un booking (`coachUid ==
 *    linkedUserId`) chevauche la fenêtre.
 *  - **playing** : B joue dans une équipe (`member.teamIds`) dont un
 *    booking match/training chevauche la fenêtre.
 *
 * **Pure function** : pas d'I/O. Les sources sont passées en input (le
 * caller — un store ou un composant — les a déjà chargées). Permet
 * d'écrire des tests unitaires triviaux et de réutiliser la logique côté
 * UI (badge "conflit" dans le picker target).
 *
 * **Dédoublonnage** : un même booking ne génère qu'**un** conflit par
 * `kind`. Si B est à la fois coach ET joueur d'une équipe (cas rare mais
 * possible — coach-joueur), on retourne deux entries (kind coaching +
 * kind playing) pour clarifier la nature.
 */

export type ConflictKind = 'officiating' | 'coaching' | 'playing'

export interface ConflictInfo {
  kind: ConflictKind
  /** epoch ms du début local. */
  startMs: number
  /** epoch ms de fin locale. */
  endMs: number
  /** Libellé prêt-à-rendu (ex. `"Match vs Lions Genève · 19:00-20:30"`). */
  label: string
  /** ID source du conflit : `booking.id` ou `match.id`. */
  sourceId: string
}

// ─── Inputs publics ──────────────────────────────────────────────────

/** Forme légère d'un booking lu côté store bookings. */
export interface ConflictBookingSource {
  id: string
  startMs: number
  endMs: number
  /** UID Auth du coach principal de la team du booking. */
  coachUid: string | null
  teamId: string | null
  opponentName: string | null
  teamName: string | null
  slotType: string
}

/** Forme légère d'un match AWAY. */
export interface ConflictAwayMatchSource {
  id: string
  /** Reprend la forme structurelle `Timestamp` du SDK. */
  date: { seconds: number }
  /** "HH:mm". */
  startTime: string
  /** "HH:mm". */
  endTime: string
  opponentName: string | null
  teamId: string
}

/** Forme légère d'une assignation (sub-collection `officialAssignments`). */
export interface ConflictAssignmentSource {
  memberId: string
  status: string
}

export interface DetectConflictsInput {
  /** Member dont on cherche les conflits. */
  memberId: string
  /** User UID lié au member (pour les bookings où il est coach). `null` si non lié. */
  linkedUserId: string | null
  /** TeamIds du member (joueur dans une équipe). */
  teamIds: ReadonlyArray<string>
  /** Fenêtre temporelle de l'assignation proposée (epoch ms). */
  targetStartMs: number
  targetEndMs: number
  /** À exclure (ex. le booking sur lequel on propose le remplacement). */
  excludeParentId?: string

  // Sources de données (déjà chargées en amont).
  allBookings: ReadonlyArray<ConflictBookingSource>
  awayMatches: ReadonlyArray<ConflictAwayMatchSource>
  /** Map `bookingId → assignments[]` (sub-collection HOME). */
  homeAssignments: Map<string, ReadonlyArray<ConflictAssignmentSource>>
  /** Map `matchId → assignments[]` (sub-collection AWAY). */
  awayAssignments: Map<string, ReadonlyArray<ConflictAssignmentSource>>
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Deux intervalles `[a1, a2]` et `[b1, b2]` se chevauchent si
 * `a1 < b2 && b1 < a2`. On utilise `<` strict (pas `≤`) pour qu'un match
 * 19:00-20:30 et un autre 20:30-22:00 ne soient PAS considérés en conflit
 * (back-to-back accepté).
 */
function overlaps(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): boolean {
  return startA < endB && startB < endA
}

/**
 * Convertit `Timestamp.seconds` + `"HH:mm"` en epoch ms local. Tolère un
 * `HH:mm` malformé (fallback 00:00).
 */
function timestampAndTimeToMs(
  ts: { seconds: number },
  hhmm: string,
): number {
  const baseMs = ts.seconds * 1000
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!m) return baseMs
  const hours = Number(m[1])
  const minutes = Number(m[2])
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return baseMs
  // On part du baseMs (date à 00:00 locale d'après convention de stockage)
  // et on ajoute hours+minutes.
  return baseMs + hours * 60 * 60 * 1000 + minutes * 60 * 1000
}

/** Format `HH:mm` à partir d'un epoch ms local. */
function formatTime(ms: number): string {
  const d = new Date(ms)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** Label "Match vs X · 19:00-20:30" / fallback "Créneau · 19:00-20:30". */
function buildBookingLabel(b: ConflictBookingSource): string {
  const time = `${formatTime(b.startMs)}-${formatTime(b.endMs)}`
  if (b.slotType === 'match_home' || b.slotType === 'match_away') {
    const opp = b.opponentName ?? '?'
    return `Match vs ${opp} · ${time}`
  }
  if (b.slotType === 'training') {
    const team = b.teamName ?? 'équipe'
    return `Entraînement ${team} · ${time}`
  }
  return `Créneau · ${time}`
}

/** Label "Match away vs X · 19:00-20:30". */
function buildAwayMatchLabel(
  m: ConflictAwayMatchSource,
  startMs: number,
  endMs: number,
): string {
  const time = `${formatTime(startMs)}-${formatTime(endMs)}`
  const opp = m.opponentName ?? '?'
  return `Match away vs ${opp} · ${time}`
}

/**
 * Statuses d'assignation qui **occupent** un slot (pas declined). Aligné
 * avec `autoOfficialsNeeded.SLOT_OCCUPYING_STATUSES`.
 */
function isOccupyingAssignment(status: string): boolean {
  return status === 'pending' || status === 'confirmed'
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Détecte tous les conflits d'agenda pour `memberId` sur la fenêtre
 * `[targetStartMs, targetEndMs]`. Retourne une liste triée par `startMs`
 * ASC, dédoublonnée (au plus 1 entry par `(sourceId, kind)`).
 */
export function detectConflicts(input: DetectConflictsInput): ConflictInfo[] {
  const {
    memberId,
    linkedUserId,
    teamIds,
    targetStartMs,
    targetEndMs,
    excludeParentId,
    allBookings,
    awayMatches,
    homeAssignments,
    awayAssignments,
  } = input

  const teamIdSet = new Set(teamIds)
  const out: ConflictInfo[] = []
  // Dédup par `${sourceId}|${kind}`.
  const seen = new Set<string>()

  function push(c: ConflictInfo): void {
    const key = `${c.sourceId}|${c.kind}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(c)
  }

  // ─── 1. Bookings (HOME match/training/match_away/reserve/custom) ───
  for (const b of allBookings) {
    if (b.id === excludeParentId) continue
    if (!overlaps(b.startMs, b.endMs, targetStartMs, targetEndMs)) continue

    // a. Coaching ?
    if (linkedUserId && b.coachUid === linkedUserId) {
      push({
        kind: 'coaching',
        startMs: b.startMs,
        endMs: b.endMs,
        label: buildBookingLabel(b),
        sourceId: b.id,
      })
    }

    // b. Playing ? (joueur de l'équipe pour un match ou un training).
    const isMatchOrTraining =
      b.slotType === 'match_home' ||
      b.slotType === 'match_away' ||
      b.slotType === 'training'
    if (isMatchOrTraining && b.teamId && teamIdSet.has(b.teamId)) {
      push({
        kind: 'playing',
        startMs: b.startMs,
        endMs: b.endMs,
        label: buildBookingLabel(b),
        sourceId: b.id,
      })
    }

    // c. Officiating ? (assignation sur ce booking, slot occupé).
    const assigns = homeAssignments.get(b.id)
    if (assigns) {
      const mine = assigns.find(
        (a) => a.memberId === memberId && isOccupyingAssignment(a.status),
      )
      if (mine) {
        push({
          kind: 'officiating',
          startMs: b.startMs,
          endMs: b.endMs,
          label: buildBookingLabel(b),
          sourceId: b.id,
        })
      }
    }
  }

  // ─── 2. Away matches (pas de booking) ──────────────────────────────
  for (const m of awayMatches) {
    if (m.id === excludeParentId) continue
    const startMs = timestampAndTimeToMs(m.date, m.startTime)
    const endMs = timestampAndTimeToMs(m.date, m.endTime)
    if (!overlaps(startMs, endMs, targetStartMs, targetEndMs)) continue

    // a. Officiating ?
    const assigns = awayAssignments.get(m.id)
    if (assigns) {
      const mine = assigns.find(
        (a) => a.memberId === memberId && isOccupyingAssignment(a.status),
      )
      if (mine) {
        push({
          kind: 'officiating',
          startMs,
          endMs,
          label: buildAwayMatchLabel(m, startMs, endMs),
          sourceId: m.id,
        })
      }
    }

    // b. Playing ? (joueur de l'équipe AWAY).
    if (teamIdSet.has(m.teamId)) {
      push({
        kind: 'playing',
        startMs,
        endMs,
        label: buildAwayMatchLabel(m, startMs, endMs),
        sourceId: m.id,
      })
    }

    // Pas de "coaching" pour les matchs AWAY : pas de booking → pas de
    // coachUid. Le coaching d'une équipe en match away est représenté par
    // le booking HOME parent côté training/voyage (déjà traité plus haut).
  }

  // ─── Tri final ──────────────────────────────────────────────────
  out.sort((a, b) => a.startMs - b.startMs)
  return out
}
