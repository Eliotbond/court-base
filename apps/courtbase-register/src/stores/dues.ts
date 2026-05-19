import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { FirebaseError } from 'firebase/app'
import {
  getDue,
  listActiveDuesForMembers,
  listPaidDuesForMembers,
  listSettledDuesForMembers,
  sortDuesByCotisationDateDesc,
  type DueRecord,
} from '@/repositories/dues.repo'
import { getLinkedMember, listAccessibleMembers } from '@/repositories/members.repo'
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
  /**
   * Cotisations "passées / soldées" (`paid | cancelled | excepted`).
   * Alimenté par `loadMyDues` → `listSettledDuesForMembers`. Tri desc par date
   * (paidAt > dueAt > createdAt). Utilisé par le panneau "Historique" et
   * la vue `MyCotisationsPanel`.
   */
  const myPastDues = ref<DueRecord[]>([])
  const memberNameById = ref<Map<string, string>>(new Map())
  const loading = ref(false)
  const error = ref<string | null>(null)

  function upsertCache(due: DueRecord): void {
    byId.value = new Map(byId.value).set(due.id, due)
  }

  /**
   * Charge l'ensemble des dues du user courant — actifs, payés et soldés.
   *
   * Critères de lecture en UNION (cf. `dues.repo.ts` §fetchAccessibleDues) :
   *
   *  1. **memberIds** : `listAccessibleMembers(uid, user.memberId)` — les
   *     members où le user est **guardian** (`guardianUserIds array-contains
   *     uid`) ou **linked member** (`user.memberId`). On évite ainsi le piège
   *     de la dérivation via `registrations.myList.matchedMemberId` qui rate
   *     les cas où le member existe côté admin sans flow d'inscription, ou
   *     la registration a été archivée mais le lien guardian persiste.
   *  2. **registeredByUid** : l'`uid` du user est passé aux fonctions de
   *     liste du repo, qui ajoutent une query `where registeredByUid == uid`.
   *     Couvre le cas où aucun binding membre n'a pris : inscription
   *     `for: 'self'` sur un member déjà lié à un autre compte — le submitter
   *     reste l'`registeredByUid` de la cotisation sans devenir `linkedUserId`.
   *
   * Les deux critères matchent **exactement** la rule `/dues` (read autorisé
   * à guardian, linkedUserId, OU `registeredByUid == auth.uid`) — donc pas de
   * risque de `permission-denied` sur les queries Firestore. C'est pourquoi on
   * ne shortcut PAS sur `memberIds.length === 0` : la query `registeredByUid`
   * peut encore remonter des cotisations.
   *
   * Idempotent ; peut être appelé plusieurs fois (mount Home + retour de
   * PaymentInstructions). Pas de cache TTL — volume faible (un user a
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
        myPastDues.value = []
        return
      }

      const accessible = await listAccessibleMembers(
        uid,
        auth.userDoc?.memberId ?? null,
      )
      const memberIds = accessible.map((m) => m.id)

      // Pas de shortcut sur `memberIds.length === 0` : même sans member
      // accessible (binding `linkedUserId` / `guardianUserIds` pas pris), le
      // user peut avoir des cotisations via la query `registeredByUid == uid`
      // exécutée par les fonctions de liste du repo.
      const [active, paid, past] = await Promise.all([
        listActiveDuesForMembers(memberIds, uid),
        listPaidDuesForMembers(memberIds, uid),
        listSettledDuesForMembers(memberIds, uid),
      ])
      myActiveDues.value = active
      myPaidDues.value = paid
      myPastDues.value = past

      const next = new Map(byId.value)
      for (const due of active) next.set(due.id, due)
      for (const due of paid) next.set(due.id, due)
      for (const due of past) next.set(due.id, due)
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
   * Résout le nom complet du membre lié à une cotisation, avec fetch
   * Firestore si le nom n'est pas déjà en cache.
   *
   * `memberNameForDue` (synchrone) ne fonctionne que si `loadMyDues` a déjà
   * peuplé `memberNameById`. Sur un accès direct à `/facture/:dueId` (lien
   * partagé, deep-link), ce cache est vide — d'où ce helper async qui :
   *  1. tente le cache synchrone,
   *  2. à défaut, lit le doc `/members/{memberId}` (lecture autorisée par les
   *     rules au membre lié / tuteur — mêmes garanties que `/dues`),
   *  3. met le résultat en cache pour les appels suivants.
   *
   * Retourne `null` si la cotisation est inconnue ou si le member n'est pas
   * lisible (permission-denied dégradé en `null` par `getLinkedMember`).
   */
  async function loadMemberNameForDue(dueId: string): Promise<string | null> {
    const cachedName = memberNameForDue(dueId)
    if (cachedName) return cachedName

    const d =
      byId.value.get(dueId) ??
      myActiveDues.value.find((x) => x.id === dueId) ??
      myPaidDues.value.find((x) => x.id === dueId)
    if (!d) return null

    try {
      const member = await getLinkedMember(d.memberId)
      if (!member) return null
      const name = `${member.firstName ?? ''} ${member.lastName ?? ''}`.trim()
      if (!name) return null
      memberNameById.value = new Map(memberNameById.value).set(d.memberId, name)
      return name
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`[stores/dues] loadMemberNameForDue(${dueId}) failed [${code}]`, err)
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
  /** `true` si au moins une cotisation "passée / soldée" est disponible. */
  const hasPastDues = computed(() => myPastDues.value.length > 0)

  /**
   * Liste unifiée de TOUTES les cotisations du user — actives ET soldées —
   * triée par date de la cotisation décroissante (la plus récente en tête).
   *
   * Source : `myActiveDues` (`pending_grace | issued | overdue`) ∪
   * `myPastDues` (`paid | cancelled | excepted`) → couvre les 6 statuts de
   * `CotisationStatus`. Les deux listes sont disjointes par construction
   * (`loadMyDues` les remplit via des filtres de statuts mutuellement
   * exclusifs), donc pas de doublon possible.
   *
   * Le tri est délégué au repository (`sortDuesByCotisationDateDesc`) pour ne
   * pas réimplémenter la logique de date dans la couche store. Utilisé par la
   * vue `Factures.vue` qui affiche une seule liste plate.
   */
  const allMyDuesSorted = computed<DueRecord[]>(() =>
    sortDuesByCotisationDateDesc([
      ...myActiveDues.value,
      ...myPastDues.value,
    ]),
  )

  /** `true` si au moins une cotisation (active ou soldée) est disponible. */
  const hasAnyDues = computed(() => allMyDuesSorted.value.length > 0)

  return {
    // State
    byId,
    myActiveDues,
    myPaidDues,
    myPastDues,
    memberNameById,
    loading,
    error,
    // Computed
    hasActiveDues,
    hasPaidDues,
    hasPastDues,
    allMyDuesSorted,
    hasAnyDues,
    // Actions
    loadMyDues,
    loadDue,
    findActiveDueForMember,
    findPaidDueForMember,
    memberNameForDue,
    loadMemberNameForDue,
  }
})
