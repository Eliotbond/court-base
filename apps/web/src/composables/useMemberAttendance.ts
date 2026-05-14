import { computed, isRef, ref, watch, type Ref } from 'vue'
import {
  ATTENDANCE_MISSING_INDEX_TAG,
  listMemberAttendance,
  type AttendanceEntry,
  type AttendanceStatus,
} from '@/repositories/attendance.repo'

/**
 * Composable — agrège l'historique de présences d'un membre pour le tab
 * "Présences" de la page Member detail.
 *
 * Architecture en couches : ce composable ne touche PAS Firestore directement
 * (cf. apps/web/CLAUDE.md). Il consomme `attendance.repo.ts` et expose des
 * stats dérivées pour le composant.
 *
 * Pattern memberId : accepte un `string` figé ou un `Ref<string>` réactif
 * (utile si le parent fait varier l'id via route params).
 */

/** Totaux agrégés tous bookings confondus. */
export interface AttendanceTotals {
  total: number
  present: number
  absent: number
  excused: number
  /** Ratio present / total, en pourcentage (0-100). `0` si total == 0. */
  presentRate: number
}

/** Breakdown par équipe — clé = teamId (ou `__none__` quand teamId nul). */
export interface AttendanceTeamStats {
  teamId: string | null
  teamName: string
  total: number
  present: number
  absent: number
  excused: number
  /** Ratio present / total en pourcentage (0-100). */
  rate: number
}

/** Breakdown par mois (YYYY-MM). */
export interface AttendanceMonthStats {
  /** Clé canonique `YYYY-MM`. */
  ym: string
  total: number
  present: number
  absent: number
  excused: number
}

const STATUSES: readonly AttendanceStatus[] = ['present', 'absent', 'excused']

/** Compteur initialisé à 0 sur chaque status. */
function zeroCounts(): Record<AttendanceStatus, number> {
  return { present: 0, absent: 0, excused: 0 }
}

function ratePct(num: number, denom: number): number {
  if (denom <= 0) return 0
  return Math.round((num / denom) * 100)
}

function ymKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/** Sentinelle utilisée pour grouper les entries sans team rattachée. */
const NO_TEAM_KEY = '__none__'

export function useMemberAttendance(memberId: Ref<string> | string) {
  const entries = ref<AttendanceEntry[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** Vrai quand le repo a remonté `MISSING_INDEX` — le composant affiche
   *  un banner informatif au lieu de l'erreur brute. */
  const missingIndex = ref(false)

  async function load(): Promise<void> {
    const id = isRef(memberId) ? memberId.value : memberId
    if (!id) {
      entries.value = []
      return
    }
    loading.value = true
    error.value = null
    missingIndex.value = false
    try {
      const rows = await listMemberAttendance(id)
      entries.value = rows
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes(ATTENDANCE_MISSING_INDEX_TAG)) {
        missingIndex.value = true
        entries.value = []
        error.value = null
      } else {
        error.value = msg
      }
    } finally {
      loading.value = false
    }
  }

  // Reload auto si memberId est un Ref qui change.
  if (isRef(memberId)) {
    watch(
      memberId,
      (id, prev) => {
        if (id && id !== prev) void load()
      },
      { immediate: false },
    )
  }

  // -------------------------------------------------------------------------
  // Stats dérivées
  // -------------------------------------------------------------------------

  const totals = computed<AttendanceTotals>(() => {
    const counts = zeroCounts()
    for (const e of entries.value) counts[e.status] += 1
    const total = STATUSES.reduce((sum, s) => sum + counts[s], 0)
    return {
      total,
      present: counts.present,
      absent: counts.absent,
      excused: counts.excused,
      presentRate: ratePct(counts.present, total),
    }
  })

  const byTeam = computed<Map<string, AttendanceTeamStats>>(() => {
    const map = new Map<
      string,
      {
        teamId: string | null
        teamName: string
        counts: Record<AttendanceStatus, number>
      }
    >()
    for (const e of entries.value) {
      const key = e.teamId ?? NO_TEAM_KEY
      let entry = map.get(key)
      if (!entry) {
        entry = {
          teamId: e.teamId,
          teamName: e.teamName ?? (e.teamId ? e.teamId : 'Sans équipe'),
          counts: zeroCounts(),
        }
        map.set(key, entry)
      } else if (e.teamName && entry.teamName !== e.teamName) {
        // Au cas où le premier hit n'avait pas pu résoudre le nom.
        entry.teamName = e.teamName
      }
      entry.counts[e.status] += 1
    }
    const out = new Map<string, AttendanceTeamStats>()
    for (const [key, v] of map.entries()) {
      const total = STATUSES.reduce((s, st) => s + v.counts[st], 0)
      out.set(key, {
        teamId: v.teamId,
        teamName: v.teamName,
        total,
        present: v.counts.present,
        absent: v.counts.absent,
        excused: v.counts.excused,
        rate: ratePct(v.counts.present, total),
      })
    }
    return out
  })

  /** Tri ordonné par total (desc) puis nom — pour rendu tableau. */
  const byTeamList = computed<AttendanceTeamStats[]>(() => {
    return [...byTeam.value.values()].sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total
      return a.teamName.localeCompare(b.teamName, 'fr')
    })
  })

  /** Par mois — clé = `bookingDate` si dispo, sinon `recordedAt` en fallback. */
  const byMonth = computed<AttendanceMonthStats[]>(() => {
    const map = new Map<string, Record<AttendanceStatus, number>>()
    for (const e of entries.value) {
      const ref = e.bookingDate ?? e.recordedAt
      const ym = ymKey(ref)
      let counts = map.get(ym)
      if (!counts) {
        counts = zeroCounts()
        map.set(ym, counts)
      }
      counts[e.status] += 1
    }
    const out: AttendanceMonthStats[] = []
    for (const [ym, counts] of map.entries()) {
      const total = STATUSES.reduce((s, st) => s + counts[st], 0)
      out.push({
        ym,
        total,
        present: counts.present,
        absent: counts.absent,
        excused: counts.excused,
      })
    }
    // Plus récent en tête.
    out.sort((a, b) => (a.ym < b.ym ? 1 : a.ym > b.ym ? -1 : 0))
    return out
  })

  /** 10 dernières entrées — entries déjà triées par recordedAt desc côté repo. */
  const recent = computed<AttendanceEntry[]>(() => entries.value.slice(0, 10))

  return {
    entries,
    loading,
    error,
    missingIndex,
    load,
    totals,
    byTeam,
    byTeamList,
    byMonth,
    recent,
  }
}
