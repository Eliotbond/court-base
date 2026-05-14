import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  fetchBookingHeader,
  listRecentBookingsForPicker,
  loadAttendanceLines,
  saveAttendanceBatch,
  type AttendanceLineRow,
  type AttendanceWritePayload,
  type BookingHeader,
  type BookingPickerRow,
} from '@/repositories/attendance.repo'

/**
 * Store Attendance — source unique pour l'écran `/attendance`.
 *
 * Deux modes selon que `bookingId` est posé en query ou non :
 *  - `loadPicker()` hydrate `pickerRows` (liste des créneaux pointables).
 *  - `loadBooking(bookingId)` hydrate `bookingHeader` + `attendanceLines`
 *    + initialise la map `draft` avec les valeurs existantes.
 *
 * Architecture en couches : ce store appelle uniquement `attendance.repo`.
 * La vue ne lit JAMAIS le repo en direct (cf. docs/frontend-desktop.md).
 */

/** Brouillon courant pour une ligne (avant save). */
export interface AttendanceDraft {
  status: 'present' | 'absent' | 'excused'
  note: string | null
}

export const useAttendanceStore = defineStore('attendance', () => {
  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  const pickerRows = ref<BookingPickerRow[]>([])
  const bookingHeader = ref<BookingHeader | null>(null)
  const attendanceLines = ref<AttendanceLineRow[]>([])

  /** Map memberId → brouillon courant. `null` = ligne pas encore pointée. */
  const draft = ref<Map<string, AttendanceDraft | null>>(new Map())

  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  /** `bookingId` actuellement chargé (utilisé par `save()` pour cibler le write). */
  const currentBookingId = ref<string | null>(null)

  // -------------------------------------------------------------------------
  // Derived
  // -------------------------------------------------------------------------

  /**
   * Vrai si au moins une ligne est dans un état "à enregistrer" :
   *  - pas de record existant ET un brouillon a été posé, OU
   *  - record existant ET le brouillon diffère (status ou note).
   */
  const hasUnsavedChanges = computed<boolean>(() => {
    for (const line of attendanceLines.value) {
      if (isLineDirty(line)) return true
    }
    return false
  })

  /** Compte des modifications en attente (pour le label du bouton Save). */
  const changesCount = computed<number>(() => {
    let n = 0
    for (const line of attendanceLines.value) {
      if (isLineDirty(line)) n += 1
    }
    return n
  })

  /** Stats agrégées sur les brouillons + existants — utilisé en header. */
  const stats = computed(() => {
    let countPresent = 0
    let countAbsent = 0
    let countExcused = 0
    let countPending = 0
    for (const line of attendanceLines.value) {
      // Exclus : non comptés dans les stats actives.
      if (line.isExcluded) continue
      const effective = effectiveStatusFor(line)
      if (effective === 'present') countPresent += 1
      else if (effective === 'absent') countAbsent += 1
      else if (effective === 'excused') countExcused += 1
      else countPending += 1
    }
    return { countPresent, countAbsent, countExcused, countPending }
  })

  // -------------------------------------------------------------------------
  // Helpers internes
  // -------------------------------------------------------------------------

  /**
   * Récupère le status effectif d'une ligne (brouillon prioritaire sinon
   * existant). Renvoie `null` si rien n'est posé.
   */
  function effectiveStatusFor(
    line: AttendanceLineRow,
  ): 'present' | 'absent' | 'excused' | null {
    const d = draft.value.get(line.memberId)
    if (d !== undefined) return d?.status ?? null
    return line.existingStatus
  }

  /** Note effective (brouillon prioritaire). */
  function effectiveNoteFor(line: AttendanceLineRow): string | null {
    const d = draft.value.get(line.memberId)
    if (d !== undefined) return d?.note ?? null
    return line.existingNote
  }

  /**
   * Une ligne est "dirty" si le draft diffère de l'existant. Une ligne sans
   * draft (et donc sans changement utilisateur) n'est pas dirty même si
   * `existingStatus === null`.
   */
  function isLineDirty(line: AttendanceLineRow): boolean {
    if (line.isExcluded) return false
    const d = draft.value.get(line.memberId)
    if (d === undefined) return false
    // Brouillon "vidé" sur une ligne sans existant → pas dirty.
    if (d === null && line.existingStatus === null) return false
    if (d === null && line.existingStatus !== null) return true
    if (!d) return false
    return (
      d.status !== line.existingStatus ||
      (d.note ?? null) !== (line.existingNote ?? null)
    )
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  async function loadPicker(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      pickerRows.value = await listRecentBookingsForPicker(new Date())
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur de chargement du picker'
      pickerRows.value = []
    } finally {
      loading.value = false
    }
  }

  async function loadBooking(bookingId: string): Promise<void> {
    loading.value = true
    error.value = null
    currentBookingId.value = bookingId
    // Reset draft à chaque nouveau booking — pas de fuite cross-bookings.
    draft.value = new Map()
    try {
      const [header, lines] = await Promise.all([
        fetchBookingHeader(bookingId),
        loadAttendanceLines(bookingId),
      ])
      bookingHeader.value = header
      attendanceLines.value = lines
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur de chargement du créneau'
      bookingHeader.value = null
      attendanceLines.value = []
    } finally {
      loading.value = false
    }
  }

  /**
   * Pose un brouillon de status pour `memberId`. Conserve la note courante
   * (brouillon prioritaire si présent, sinon existant).
   */
  function setLineStatus(
    memberId: string,
    status: 'present' | 'absent' | 'excused',
  ): void {
    const line = attendanceLines.value.find((l) => l.memberId === memberId)
    if (!line) return
    if (line.isExcluded) return
    const currentNote = effectiveNoteFor(line)
    const next = new Map(draft.value)
    next.set(memberId, { status, note: currentNote })
    draft.value = next
  }

  /**
   * Pose un brouillon de note pour `memberId`. Si pas encore de status posé,
   * hérite de l'existant (sinon `present` par défaut — on ne peut pas avoir
   * une note sans status côté payload).
   */
  function setLineNote(memberId: string, note: string | null): void {
    const line = attendanceLines.value.find((l) => l.memberId === memberId)
    if (!line) return
    if (line.isExcluded) return
    const currentStatus =
      effectiveStatusFor(line) ?? ('present' as const)
    const cleaned = note && note.trim().length > 0 ? note : null
    const next = new Map(draft.value)
    next.set(memberId, { status: currentStatus, note: cleaned })
    draft.value = next
  }

  /** Bulk : pose tout le monde présent (hors exclus). */
  function setAllPresent(): void {
    const next = new Map(draft.value)
    for (const line of attendanceLines.value) {
      if (line.isExcluded) continue
      next.set(line.memberId, {
        status: 'present',
        note: effectiveNoteFor(line),
      })
    }
    draft.value = next
  }

  /** Bulk : pose tout le monde absent (hors exclus). */
  function setAllAbsent(): void {
    const next = new Map(draft.value)
    for (const line of attendanceLines.value) {
      if (line.isExcluded) continue
      next.set(line.memberId, {
        status: 'absent',
        note: effectiveNoteFor(line),
      })
    }
    draft.value = next
  }

  /**
   * Save : envoie en `writeBatch` toutes les lignes ayant un brouillon ou
   * un status existant — convention "snapshot complet" : on persiste l'état
   * courant pour chaque ligne pointée, pas seulement les dirty.
   *
   * Pourquoi : éviter qu'un re-render perde des informations existantes si
   * la rule échoue partiellement. Le batch est atomique côté Firestore.
   *
   * Les lignes "exclues" sont ignorées (pas de pointage UI possible).
   * Les lignes sans status (ni brouillon ni existant) sont ignorées aussi.
   */
  async function save(): Promise<void> {
    if (!currentBookingId.value) {
      throw new Error("Aucun créneau sélectionné — impossible d'enregistrer.")
    }
    const payload: AttendanceWritePayload[] = []
    for (const line of attendanceLines.value) {
      if (line.isExcluded) continue
      const status = effectiveStatusFor(line)
      if (!status) continue
      payload.push({
        memberId: line.memberId,
        status,
        note: effectiveNoteFor(line),
      })
    }
    if (payload.length === 0) return

    saving.value = true
    error.value = null
    try {
      await saveAttendanceBatch(currentBookingId.value, payload)
      // Optimistic merge : push le brouillon dans `existing*` puis vide le draft.
      attendanceLines.value = attendanceLines.value.map((line) => {
        if (line.isExcluded) return line
        const status = effectiveStatusFor(line)
        const note = effectiveNoteFor(line)
        if (!status) return line
        return {
          ...line,
          existingStatus: status,
          existingNote: note,
        }
      })
      draft.value = new Map()
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur lors de la sauvegarde'
      throw e
    } finally {
      saving.value = false
    }
  }

  /**
   * Reset complet (utile entre navigations). Pas appelé automatiquement —
   * la vue invoke explicitement quand elle quitte le mode "booking".
   */
  function resetBooking(): void {
    bookingHeader.value = null
    attendanceLines.value = []
    draft.value = new Map()
    currentBookingId.value = null
    error.value = null
  }

  return {
    // state
    pickerRows,
    bookingHeader,
    attendanceLines,
    draft,
    loading,
    saving,
    error,
    currentBookingId,
    // derived
    hasUnsavedChanges,
    changesCount,
    stats,
    // helpers exposés à la vue (lecture seule, pas de mutation)
    effectiveStatusFor,
    effectiveNoteFor,
    // actions
    loadPicker,
    loadBooking,
    setLineStatus,
    setLineNote,
    setAllPresent,
    setAllAbsent,
    save,
    resetBooking,
  }
})
