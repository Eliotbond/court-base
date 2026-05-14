import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { FirebaseError } from 'firebase/app'
import {
  getDue,
  listActiveDuesForMembers,
  listPaidDuesForMembers,
  type DueRecord,
} from '@/repositories/dues.repo'
import { listAccessibleMembers } from '@/repositories/members.repo'
import { useAuthStore } from '@/stores/auth'

/**
 * Store Cotisations — source des cotisations (actives + payées) liées au
 * user signed-in.
 *
 * NB. Nommage interne `dues` conservé (id Pinia `'dues'`, type `DueRecord`) car
 * la collection Firestore garde le nom legacy `dues`. La sémantique métier
 * exposée à l'UI utilise toujours "cotisation".
 *
 * Architecture :
 *  - `myActiveDues` : array réactif des cotisations
 *    `pending_grace | issued | overdue` pour les membres liés aux
 *    registrations soumises par le user.
 *  - `myPaidDues` : array réactif des cotisations `paid` (historique +
 *    affichage du reçu sur la card registration `active`). Tri `paidAt desc`.
 *  - `byId` (Map) : cache pour les fetches one-off (`PaymentInstructions.vue`).
 *  - `memberNameById` : cache `memberId → "Prénom Nom"` pour le panneau Home.
 *
 * Source des memberIds : on dérive depuis le store registrations
 * (`registration.matchedMemberId` quand non-null). Sans matched member (cas
 * draft / registration "for self" sans member créé), pas de cotisation
 * possible — elle est créée par la callable `confirmRegistration` (Admin SDK)
 * qui pose un `memberId` sur la registration.
 *
 * Catch enrichi : log `[stores/dues]` + code FirebaseError pour faciliter le
 * diagnostic (cf. `apps/courtbase-register/CLAUDE.md` §catch enrichi).
 */
export const useDuesStore = defineStore('dues', () => {
  const byId = ref<Map<string, DueRecord>>(new Map())
  const myActiveDues = ref<DueRecord[]>([])
  const myPaidDues = ref<DueRecord[]>([])
  const memberNameById = ref<Map<string, string>>(new Map())
  const loading = ref(false)
  const error = ref<string | null>(null)

  function upsertCache(due: DueRecord): void {
    byId.value = new Map(byId.value).set(due.id, due)
  }

  /**
   * Charge l'ensemble des dues du user courant — actifs et payés.
   *
   * Source des memberIds : `listAccessibleMembers(uid, user.memberId)` —
   * c.-à-d. les members où le user est **guardian** (`guardianUserIds
   * array-contains uid`) ou **linked member** (`user.memberId`). On évite
   * ainsi le piège de la dérivation via `registrations.myList.matchedMemberId`
   * qui rate les cas où :
   *  - le member existe côté admin sans qu'un flow d'inscription ait été lancé
   *    (création manuelle admin), MAIS le user est tuteur du member,
   *  - la registration a été archivée / nettoyée mais le lien guardian persiste.
   *
   * Ce path matche **exactement** la rule `/dues` (read autorisé à guardian
   * ou linkedUserId) — donc on ne risque pas de provoquer `permission-denied`
   * sur le `where memberId in [...]` Firestore.
   *
   * Deux queries Firestore parallèles : actives (`pending_grace|issued|overdue`)
   * + payées. Idempotent ; peut être appelé plusieurs fois (mount Home + retour
   * de PaymentInstructions). Pas de cache TTL — volume faible (un user a
   * typiquement 1-3 dues actifs + quelques payés en historique).
   */
  async function loadMyDues(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const auth = useAuthStore()
      const uid = auth.authSnap?.uid
      if (!uid) {
        myActiveDues.value = []
        myPaidDues.value = []
        return
      }

      const accessible = await listAccessibleMembers(
        uid,
        auth.userDoc?.memberId ?? null,
      )
      const memberIds = accessible.map((m) => m.id)

      if (memberIds.length === 0) {
        myActiveDues.value = []
        myPaidDues.value = []
        return
      }

      const [active, paid] = await Promise.all([
        listActiveDuesForMembers(memberIds),
        listPaidDuesForMembers(memberIds),
      ])
      myActiveDues.value = active
      myPaidDues.value = paid

      const next = new Map(byId.value)
      for (const due of active) next.set(due.id, due)
      for (const due of paid) next.set(due.id, due)
      byId.value = next

      // On a déjà les Member docs en main (`accessible`) — on peuple le cache
      // de noms sans repasser par `getLinkedMember` (évite N reads inutiles).
      const nameMap = new Map(memberNameById.value)
      for (const m of accessible) {
        const name = `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim()
        if (name) nameMap.set(m.id, name)
      }
      memberNameById.value = nameMap
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`[stores/dues] loadMyDues failed [${code}]`, err)
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  /** Retourne le nom complet du membre lié à un dueId, ou `null`. */
  function memberNameForDue(dueId: string): string | null {
    const d =
      byId.value.get(dueId) ??
      myActiveDues.value.find((x) => x.id === dueId) ??
      myPaidDues.value.find((x) => x.id === dueId)
    if (!d) return null
    return memberNameById.value.get(d.memberId) ?? null
  }

  /**
   * Fetch un due par id (avec cache). Utilisé par `PaymentInstructions.vue`
   * via la route `/payment/:dueId`. Retourne `null` si introuvable / refusé.
   */
  async function loadDue(dueId: string): Promise<DueRecord | null> {
    const cached = byId.value.get(dueId)
    if (cached) return cached
    try {
      const due = await getDue(dueId)
      if (due) upsertCache(due)
      return due
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`[stores/dues] loadDue(${dueId}) failed [${code}]`, err)
      error.value = err instanceof Error ? err.message : String(err)
      return null
    }
  }

  /**
   * Helper : retrouve le premier due actif pour un memberId donné (utilisé
   * par Home.vue pour câbler le CTA "Payer ma cotisation" à la route
   * `/payment/:dueId` à partir d'une registration).
   */
  function findActiveDueForMember(memberId: string | null): DueRecord | null {
    if (!memberId) return null
    return myActiveDues.value.find((d) => d.memberId === memberId) ?? null
  }

  /**
   * Helper symétrique : retrouve le due payé le plus récent pour un memberId
   * donné. `myPaidDues` est déjà trié `paidAt desc` côté repo — on retourne
   * donc le premier match. Utilisé par Home.vue pour afficher le badge
   * "Cotisation payée le {date}" sur la card registration `active`.
   */
  function findPaidDueForMember(memberId: string | null): DueRecord | null {
    if (!memberId) return null
    return myPaidDues.value.find((d) => d.memberId === memberId) ?? null
  }

  const hasActiveDues = computed(() => myActiveDues.value.length > 0)
  const hasPaidDues = computed(() => myPaidDues.value.length > 0)

  return {
    // State
    byId,
    myActiveDues,
    myPaidDues,
    memberNameById,
    loading,
    error,
    // Computed
    hasActiveDues,
    hasPaidDues,
    // Actions
    loadMyDues,
    loadDue,
    findActiveDueForMember,
    findPaidDueForMember,
    memberNameForDue,
  }
})
