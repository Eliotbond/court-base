import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { FirebaseError } from 'firebase/app'
import {
  compareAccounts,
  createAccount,
  deleteAccount,
  listAccounts,
  seedDefaultAccounts,
  updateAccount,
} from '@/repositories/accounts.repo'
import type { Account, AccountData, AccountNature } from '@club-app/shared-types'

/**
 * Source unique des données du plan comptable `/accounts` (module
 * Comptabilité — cf. docs/compta.md).
 *
 * Le store consomme uniquement le repository `accounts.repo` — les composants
 * n'écrivent jamais directement dans Firestore (cf. architecture en couches,
 * `apps/web/CLAUDE.md`). Try/catch enrichi avec le code `FirebaseError` pour
 * éviter les erreurs silencieuses (rules denied, index manquant, …).
 *
 * API publique consommée par d'autres modules de la comptabilité (saisie de
 * crédits, factures) : ne pas renommer `accounts`, `loading`, `error`,
 * `activeAccounts`, `treasuryAccounts`, `accountsByNature`, `loadAccounts`,
 * `createAccount`, `updateAccount`, `deleteAccount`, `seedDefaults`.
 */
export const useAccountsStore = defineStore('accounts', () => {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const accounts = ref<Account[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // ---------------------------------------------------------------------------
  // Helpers (privés)
  // ---------------------------------------------------------------------------

  /**
   * Remplace en place le row matching `id` par `next` ; insère sinon. Re-trie
   * ensuite pour conserver l'ordre `displayOrder asc, number asc`. Pattern
   * aligné sur `stores/categories.ts` / `stores/matchTypes.ts`.
   */
  function upsert(next: Account): void {
    const idx = accounts.value.findIndex((a) => a.id === next.id)
    let copy: Account[]
    if (idx === -1) {
      copy = [next, ...accounts.value]
    } else {
      copy = accounts.value.slice()
      copy[idx] = next
    }
    copy.sort(compareAccounts)
    accounts.value = copy
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /** Charge l'ensemble du plan comptable. */
  async function loadAccounts(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      accounts.value = await listAccounts()
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`loadAccounts failed [${code}]`, err)
      error.value =
        err instanceof Error
          ? err.message
          : 'Erreur de chargement du plan comptable'
    } finally {
      loading.value = false
    }
  }

  /**
   * Crée un compte. Upsert local sur le row créé (relu depuis le store local
   * enrichi du `createdAt` réel via un `loadAccounts` léger n'est pas
   * nécessaire — on injecte une valeur optimiste minimale). Retourne l'id ou
   * `null` en cas d'erreur (le message est posé dans `error.value`).
   */
  async function create(
    data: Omit<AccountData, 'createdAt'>,
  ): Promise<string | null> {
    error.value = null
    try {
      const id = await createAccount(data)
      // Upsert optimiste : on connaît tous les champs sauf `createdAt`
      // (serverTimestamp résolu côté serveur). Un `loadAccounts` ultérieur
      // remettra la valeur exacte ; ici on pose un placeholder cohérent.
      upsert({
        id,
        ...data,
        createdAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
      })
      return id
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`createAccount failed [${code}]`, err)
      error.value =
        err instanceof Error
          ? err.message
          : 'Erreur lors de la création du compte'
      return null
    }
  }

  /**
   * Patch partiel via `updateAccount`. Upsert local sur le row mis à jour.
   * Retourne true si l'update a abouti, false sinon (message dans `error`).
   */
  async function update(
    id: string,
    patch: Partial<AccountData>,
  ): Promise<boolean> {
    error.value = null
    try {
      await updateAccount(id, patch)
      const current = accounts.value.find((a) => a.id === id)
      if (current) upsert({ ...current, ...patch })
      return true
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`updateAccount failed [${code}]`, err)
      error.value =
        err instanceof Error
          ? err.message
          : 'Erreur lors de la mise à jour du compte'
      return false
    }
  }

  /**
   * Supprime un compte. Le repo throw si le compte est `isDefault` ou
   * référencé par une écriture — le message est alors surfacé via
   * `error.value`. Retire le row local uniquement si l'appel réussit.
   */
  async function remove(id: string): Promise<boolean> {
    error.value = null
    try {
      await deleteAccount(id)
      accounts.value = accounts.value.filter((a) => a.id !== id)
      return true
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`deleteAccount failed [${code}]`, err)
      error.value =
        err instanceof Error
          ? err.message
          : 'Erreur lors de la suppression du compte'
      return false
    }
  }

  /**
   * Seede les 10 comptes par défaut (idempotent côté repo). Recharge ensuite
   * le plan comptable pour refléter les comptes créés.
   */
  async function seedDefaults(): Promise<boolean> {
    error.value = null
    try {
      await seedDefaultAccounts()
      await loadAccounts()
      return true
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`seedDefaultAccounts failed [${code}]`, err)
      error.value =
        err instanceof Error
          ? err.message
          : 'Erreur lors de la création des comptes par défaut'
      return false
    }
  }

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  /** Comptes actifs uniquement (pickers, contreparties). */
  const activeAccounts = computed<Account[]>(() =>
    accounts.value.filter((a) => a.active),
  )

  /**
   * Comptes de trésorerie actifs (Caisse / Banque) — éligibles comme
   * contrepartie automatique dans la saisie simplifiée (cf. docs/compta.md §2).
   */
  const treasuryAccounts = computed<Account[]>(() =>
    accounts.value.filter((a) => a.isTreasury && a.active),
  )

  /** Comptes regroupés par `nature` — pour bilan / compte de résultat. */
  const accountsByNature = computed<Record<AccountNature, Account[]>>(() => {
    const groups: Record<AccountNature, Account[]> = {
      actif: [],
      passif: [],
      charge: [],
      produit: [],
    }
    for (const a of accounts.value) groups[a.nature].push(a)
    return groups
  })

  return {
    // state
    accounts,
    loading,
    error,
    // derived
    activeAccounts,
    treasuryAccounts,
    accountsByNature,
    // actions
    loadAccounts,
    createAccount: create,
    updateAccount: update,
    deleteAccount: remove,
    seedDefaults,
  }
})
