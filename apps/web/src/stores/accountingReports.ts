import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { FirebaseError } from 'firebase/app'
import { loadAccounts, loadEntries } from '@/repositories/accountingReports.repo'
import type { Account, AccountingEntry } from '@club-app/shared-types'

/**
 * Source unique des données des RAPPORTS comptables — Journal, Bilan,
 * Compte de résultat (module Comptabilité — cf. docs/compta.md §4).
 *
 * Le store consomme uniquement le repository `accountingReports.repo` — les
 * composants n'écrivent jamais et ne touchent jamais Firestore (cf.
 * architecture en couches, `apps/web/CLAUDE.md`). Toute la logique de calcul
 * (soldes, agrégats, équilibre) vit ICI, pas dans les vues.
 *
 * Try/catch enrichi avec le code `FirebaseError` pour éviter les erreurs
 * silencieuses (rules denied, index manquant, …).
 */

// ---------------------------------------------------------------------------
// Types exposés (consommés par les 3 vues)
// ---------------------------------------------------------------------------

/** Solde agrégé d'un compte sur la période courante. */
export interface AccountBalance {
  /** Σ des débits de toutes les lignes imputant ce compte. */
  debit: number
  /** Σ des crédits de toutes les lignes imputant ce compte. */
  credit: number
  /** Solde orienté selon la nature du compte (cf. docs/compta.md §4). */
  solde: number
}

/** Ligne d'un rapport : un compte et son solde. */
export interface ReportLine {
  account: Account
  solde: number
}

/** Structure du Bilan (cf. docs/compta.md §4). */
export interface BalanceSheet {
  actif: ReportLine[]
  passif: ReportLine[]
  /** Résultat de l'exercice = Σ produits − Σ charges. Affiché côté passif. */
  result: number
  totalActif: number
  /** Total passif, résultat de l'exercice inclus. */
  totalPassif: number
  /** `true` si `totalActif === totalPassif` (à la tolérance d'arrondi près). */
  balanced: boolean
}

/** Structure du Compte de résultat (cf. docs/compta.md §4). */
export interface IncomeStatement {
  charges: ReportLine[]
  produits: ReportLine[]
  /** Résultat = Σ produits − Σ charges. Positif = bénéfice, négatif = perte. */
  result: number
  totalCharges: number
  totalProduits: number
}

/** Une ligne d'écriture résolue (nom du compte injecté) pour le journal. */
export interface JournalLineResolved {
  accountId: string
  /** Numéro du compte, ou `'?'` si le compte est introuvable. */
  accountNumber: string
  /** Nom du compte, ou `'Compte inconnu'` si introuvable. */
  accountName: string
  debit: number
  credit: number
}

/** Une écriture résolue, prête à l'affichage dans le journal. */
export interface JournalRow {
  id: string
  /** Date convertie à la frontière (`Timestamp` → `Date`). */
  date: Date | null
  label: string
  reference: string | null
  source: AccountingEntry['source']
  reversed: boolean
  reversalOfEntryId: string | null
  /** Σ des débits de l'écriture (= Σ des crédits, écriture équilibrée). */
  total: number
  lines: JournalLineResolved[]
}

/** Filtre de période optionnel appliqué aux 3 rapports. */
export interface PeriodFilter {
  from: Date | null
  to: Date | null
}

// ---------------------------------------------------------------------------
// Helpers de conversion
// ---------------------------------------------------------------------------

/** Convertit un Timestamp neutre `{ seconds, nanoseconds }` en `Date`. */
function tsToDate(
  ts: { seconds: number; nanoseconds: number } | null | undefined,
): Date | null {
  if (!ts) return null
  return new Date(ts.seconds * 1000 + Math.floor(ts.nanoseconds / 1_000_000))
}

/** Tolérance d'arrondi pour le test d'équilibre du bilan. */
const BALANCE_EPSILON = 0.005

export const useAccountingReportsStore = defineStore(
  'accountingReports',
  () => {
    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    const accounts = ref<Account[]>([])
    const entries = ref<AccountingEntry[]>([])
    const loading = ref(false)
    const error = ref<string | null>(null)

    /** Filtre période optionnel — `null`/`null` = tout l'historique. */
    const period = ref<PeriodFilter>({ from: null, to: null })

    // -------------------------------------------------------------------------
    // Actions
    // -------------------------------------------------------------------------

    /** Charge en parallèle le plan comptable et le journal. */
    async function loadAll(): Promise<void> {
      loading.value = true
      error.value = null
      try {
        const [acc, ent] = await Promise.all([loadAccounts(), loadEntries()])
        accounts.value = acc
        entries.value = ent
      } catch (err) {
        const code = err instanceof FirebaseError ? err.code : 'unknown'
        console.error(`loadAll (accountingReports) failed [${code}]`, err)
        error.value =
          err instanceof Error
            ? err.message
            : 'Erreur de chargement des données comptables'
      } finally {
        loading.value = false
      }
    }

    /** Définit le filtre de période. `null` sur une borne = borne ouverte. */
    function setPeriod(next: PeriodFilter): void {
      period.value = { from: next.from, to: next.to }
    }

    /** Réinitialise le filtre de période (tout l'historique). */
    function clearPeriod(): void {
      period.value = { from: null, to: null }
    }

    // -------------------------------------------------------------------------
    // Derived — écritures filtrées par période
    // -------------------------------------------------------------------------

    /**
     * Écritures retenues après application du filtre période. Le filtre est
     * inclusif : `from` retient les écritures dès 00:00 du jour, `to` jusqu'à
     * 23:59:59.999. Une borne `null` laisse le côté ouvert.
     */
    const filteredEntries = computed<AccountingEntry[]>(() => {
      const { from, to } = period.value
      if (!from && !to) return entries.value
      const fromMs = from
        ? new Date(
            from.getFullYear(),
            from.getMonth(),
            from.getDate(),
          ).getTime()
        : null
      const toMs = to
        ? new Date(
            to.getFullYear(),
            to.getMonth(),
            to.getDate(),
            23,
            59,
            59,
            999,
          ).getTime()
        : null
      return entries.value.filter((e) => {
        const d = tsToDate(e.date)
        if (!d) return false
        const ms = d.getTime()
        if (fromMs !== null && ms < fromMs) return false
        if (toMs !== null && ms > toMs) return false
        return true
      })
    })

    // -------------------------------------------------------------------------
    // Derived — soldes par compte
    // -------------------------------------------------------------------------

    /**
     * Solde de chaque compte agrégé sur les écritures filtrées.
     * `Record<accountId, { debit, credit, solde }>`.
     *
     * On agrège TOUTES les lignes (contre-passations incluses — elles se
     * neutralisent naturellement avec leur écriture d'origine, cf.
     * docs/compta.md §4). Le sens du solde dépend de la `nature` du compte :
     *  - `actif` / `charge`  → solde = Σ débit − Σ crédit
     *  - `passif` / `produit` → solde = Σ crédit − Σ débit
     */
    const accountBalances = computed<Record<string, AccountBalance>>(() => {
      // Initialise un solde nul pour chaque compte connu.
      const balances: Record<string, AccountBalance> = {}
      for (const acc of accounts.value) {
        balances[acc.id] = { debit: 0, credit: 0, solde: 0 }
      }
      // Agrège les débits / crédits de toutes les lignes.
      for (const entry of filteredEntries.value) {
        for (const line of entry.lines ?? []) {
          const bal =
            balances[line.accountId] ??
            (balances[line.accountId] = { debit: 0, credit: 0, solde: 0 })
          bal.debit += line.debit ?? 0
          bal.credit += line.credit ?? 0
        }
      }
      // Oriente le solde selon la nature du compte.
      const natureById = new Map(accounts.value.map((a) => [a.id, a.nature]))
      for (const [accountId, bal] of Object.entries(balances)) {
        const nature = natureById.get(accountId)
        if (nature === 'passif' || nature === 'produit') {
          bal.solde = bal.credit - bal.debit
        } else {
          // `actif`, `charge`, ou compte inconnu (défaut sens débiteur).
          bal.solde = bal.debit - bal.credit
        }
      }
      return balances
    })

    // -------------------------------------------------------------------------
    // Derived — Bilan
    // -------------------------------------------------------------------------

    /**
     * Bilan : comptes `actif` à gauche, `passif` à droite, le « Résultat de
     * l'exercice » ajouté au total passif. Le bilan est équilibré par
     * construction de la partie double (cf. docs/compta.md §4).
     */
    const balanceSheet = computed<BalanceSheet>(() => {
      const balances = accountBalances.value
      const actif: ReportLine[] = []
      const passif: ReportLine[] = []
      for (const account of accounts.value) {
        const solde = balances[account.id]?.solde ?? 0
        if (account.nature === 'actif') {
          actif.push({ account, solde })
        } else if (account.nature === 'passif') {
          passif.push({ account, solde })
        }
      }
      const totalActif = actif.reduce((s, l) => s + l.solde, 0)
      const totalPassifAccounts = passif.reduce((s, l) => s + l.solde, 0)
      // Résultat de l'exercice = Σ produits − Σ charges (cf. compte de résultat).
      const result = incomeStatement.value.result
      const totalPassif = totalPassifAccounts + result
      const balanced = Math.abs(totalActif - totalPassif) < BALANCE_EPSILON
      return { actif, passif, result, totalActif, totalPassif, balanced }
    })

    // -------------------------------------------------------------------------
    // Derived — Compte de résultat
    // -------------------------------------------------------------------------

    /**
     * Compte de résultat : confrontation des comptes `charge` et `produit`.
     * Résultat = Σ produits − Σ charges (bénéfice si > 0, perte si < 0).
     */
    const incomeStatement = computed<IncomeStatement>(() => {
      const balances = accountBalances.value
      const charges: ReportLine[] = []
      const produits: ReportLine[] = []
      for (const account of accounts.value) {
        const solde = balances[account.id]?.solde ?? 0
        if (account.nature === 'charge') {
          charges.push({ account, solde })
        } else if (account.nature === 'produit') {
          produits.push({ account, solde })
        }
      }
      const totalCharges = charges.reduce((s, l) => s + l.solde, 0)
      const totalProduits = produits.reduce((s, l) => s + l.solde, 0)
      const result = totalProduits - totalCharges
      return { charges, produits, result, totalCharges, totalProduits }
    })

    // -------------------------------------------------------------------------
    // Derived — Journal
    // -------------------------------------------------------------------------

    /**
     * Écritures du journal triées par date décroissante (plus récentes en
     * tête), chaque ligne résolue avec le numéro + nom de son compte.
     * Restitution brute de l'historique, contre-passations incluses (cf.
     * docs/compta.md §4). Respecte le filtre période.
     */
    const journalRows = computed<JournalRow[]>(() => {
      const accountById = new Map(accounts.value.map((a) => [a.id, a]))
      return filteredEntries.value
        .map<JournalRow>((entry) => {
          const lines: JournalLineResolved[] = (entry.lines ?? []).map(
            (line) => {
              const account = accountById.get(line.accountId)
              return {
                accountId: line.accountId,
                accountNumber: account?.number ?? '?',
                accountName: account?.name ?? 'Compte inconnu',
                debit: line.debit ?? 0,
                credit: line.credit ?? 0,
              }
            },
          )
          const total = lines.reduce((s, l) => s + l.debit, 0)
          return {
            id: entry.id,
            date: tsToDate(entry.date),
            label: entry.label,
            reference: entry.reference,
            source: entry.source,
            reversed: entry.reversed,
            reversalOfEntryId: entry.reversalOfEntryId,
            total,
            lines,
          }
        })
        .sort((a, b) => {
          const am = a.date?.getTime() ?? 0
          const bm = b.date?.getTime() ?? 0
          return bm - am
        })
    })

    /** `true` si aucune écriture (toutes périodes confondues) n'est chargée. */
    const isEmpty = computed<boolean>(() => entries.value.length === 0)

    return {
      // state
      accounts,
      entries,
      loading,
      error,
      period,
      // actions
      loadAll,
      setPeriod,
      clearPeriod,
      // derived
      filteredEntries,
      accountBalances,
      balanceSheet,
      incomeStatement,
      journalRows,
      isEmpty,
    }
  },
)
