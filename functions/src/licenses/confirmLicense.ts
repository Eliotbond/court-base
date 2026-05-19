/**
 * `confirmLicense` — callable utilisée par le comité (admin / treasurer /
 * secretary) pour confirmer une licence fédérale `/licenses/{id}`.
 *
 * La confirmation matérialise deux faits métier :
 *  1. Swiss Basketball a validé la licence ET le club l'a payée. Le club paie
 *     la fédération → c'est une **charge** : l'argent quitte la banque.
 *  2. Le membre devient officiel / coach ACTIF pour la saison de la licence
 *     (réf dénormalisée `member.officialLicense` / `member.coachLicense`).
 *
 * Effets transactionnels (`db().runTransaction`) :
 *  1. Lit `/licenses/{licenseId}`. Absente → `not-found`.
 *  2. Idempotence : `status === 'active'` → retourne sans rien écrire.
 *  3. `status !== 'pending'` (ex. `cancelled`) → `failed-precondition`.
 *  4. Lit `/members/{license.memberId}`.
 *  5. Résout les comptes comptables (charge "Licences fédérales" + trésorerie
 *     "Banque", avec replis — cf. helpers ci-dessous).
 *  6. Poste l'écriture comptable `/accountingEntries` (partie double : débit
 *     charge / crédit trésorerie, Σdébit === Σcrédit, montant = feeSnapshot).
 *  7. `update` la licence : `status:'active'`, `confirmedAt`, `confirmedByUid`,
 *     `accountingEntryId`.
 *  8. `update` le membre : pose `officialLicense` (rôle `official`) ou
 *     `coachLicense` (rôle `coach`). `player` / `referee` → pas de denorm.
 *
 * Auth : signed-in + (claim `rootAdmin` OU `/users/{uid}.roles` contient
 * `admin` | `treasurer` | `secretary`). Helper local `assertCanConfirmLicense`.
 *
 * Cette callable tourne en Admin SDK → bypasse les rules du module compta
 * (qui interdisent l'`admin` standard sur `/accountingEntries`). C'est le
 * canal contrôlé et audité : l'écriture porte `createdBy = confirmedByUid`.
 *
 * Region : europe-west6 (héritée du `setGlobalOptions` dans `src/index.ts`).
 *
 * NOTE deploy : nouvelle Function v2 → après le premier deploy, ajouter le
 * binding IAM `allUsers/run.invoker` (cf. `functions/CLAUDE.md` §"Après deploy").
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import type {
  AccountData,
  AccountingEntryData,
  AccountingEntryLine,
  LicenseData,
  MemberData,
  UserData,
} from '@club-app/shared-types'
import { Timestamp, db } from '../dues/_helpers'

interface ConfirmLicenseInput {
  licenseId: unknown
}

export interface ConfirmLicenseOutput {
  ok: true
  /** `true` si la licence était déjà `active` (aucune écriture re-postée). */
  alreadyActive: boolean
  /** id de l'écriture `/accountingEntries`. `null` si `alreadyActive`. */
  accountingEntryId: string | null
}

/** Nom canonique du compte de charge des licences fédérales. */
const EXPENSE_ACCOUNT_NAME = 'Licences fédérales'
/** Nom canonique du compte de trésorerie débité (compte par défaut "Banque"). */
const TREASURY_ACCOUNT_NAME = 'Banque'

/**
 * Tolérance d'arrondi (CHF) pour l'invariant `Σ debit === Σ credit`. Aligné sur
 * `BALANCE_EPSILON` du repo web `accountingEntries.repo.ts`.
 */
const BALANCE_EPSILON = 0.005

function parseInput(data: ConfirmLicenseInput): { licenseId: string } {
  const d = data ?? ({} as ConfirmLicenseInput)
  if (typeof d.licenseId !== 'string' || d.licenseId.length === 0) {
    throw new HttpsError('invalid-argument', 'licenseId is required')
  }
  return { licenseId: d.licenseId }
}

/**
 * Garde "qui peut confirmer une licence" : claim `rootAdmin` OU rôle `admin` |
 * `treasurer` | `secretary` côté `/users/{uid}`. Sinon `permission-denied`.
 */
function assertCanConfirmLicense(
  request: CallableRequest<ConfirmLicenseInput>,
  user: UserData,
): void {
  if (request.auth?.token?.rootAdmin === true) return
  const roles = user.roles ?? []
  if (roles.includes('admin')) return
  if (roles.includes('treasurer')) return
  if (roles.includes('secretary')) return
  throw new HttpsError(
    'permission-denied',
    'Caller must be rootAdmin, admin, treasurer or secretary to confirm a license.',
  )
}

/**
 * Réplique l'invariant de la partie double (`validateEntryBalance` côté web) :
 * ≥ 2 lignes, aucun montant négatif, exactement un de `debit`/`credit` > 0 par
 * ligne, `Σ debit === Σ credit` à `BALANCE_EPSILON` près. Garde-fou défensif —
 * on ne pousse jamais une écriture invalide dans le journal.
 */
function validateEntryBalance(lines: AccountingEntryLine[]): void {
  if (lines.length < 2) {
    throw new HttpsError('internal', 'Accounting entry must have at least 2 lines.')
  }
  let totalDebit = 0
  let totalCredit = 0
  for (const line of lines) {
    if (line.debit < 0 || line.credit < 0) {
      throw new HttpsError('internal', 'Accounting line amounts cannot be negative.')
    }
    const debitPositive = line.debit > 0
    const creditPositive = line.credit > 0
    if (debitPositive === creditPositive) {
      throw new HttpsError(
        'internal',
        'Each accounting line must have exactly one strictly positive amount (debit XOR credit).',
      )
    }
    totalDebit += line.debit
    totalCredit += line.credit
  }
  if (Math.abs(totalDebit - totalCredit) > BALANCE_EPSILON) {
    throw new HttpsError('internal', 'Accounting entry is unbalanced (Σ debit ≠ Σ credit).')
  }
}

interface ResolvedAccount {
  id: string
  data: AccountData
}

/**
 * Résout le compte de charge "Licences fédérales".
 *  - 1er choix : compte actif `name === 'Licences fédérales'` (seedé par l'agent
 *    web dans `seedDefaultAccounts`).
 *  - Repli : premier compte actif de nature `charge` (tri `displayOrder` puis
 *    `number` pour un repli stable).
 *  - Aucun compte de charge → `failed-precondition` (plan comptable non seedé).
 */
function resolveExpenseAccount(accounts: ResolvedAccount[]): ResolvedAccount {
  const exact = accounts.find(
    (a) => a.data.active && a.data.name === EXPENSE_ACCOUNT_NAME,
  )
  if (exact) return exact
  const charges = accounts
    .filter((a) => a.data.active && a.data.nature === 'charge')
    .sort(compareAccounts)
  const fallback = charges[0]
  if (fallback) return fallback
  throw new HttpsError(
    'failed-precondition',
    'Comptes comptables non initialisés — seedez les comptes par défaut.',
  )
}

/**
 * Résout le compte de trésorerie crédité (l'argent quitte la banque).
 *  - 1er choix : compte de trésorerie actif `name === 'Banque'` (compte par
 *    défaut seedé). Réplique la résolution du module compta web qui considère
 *    `isTreasury && active` comme contrepartie de trésorerie.
 *  - Repli : premier compte actif `isTreasury` (tri stable) — typiquement la
 *    "Caisse" si la "Banque" a été renommée / désactivée.
 *  - Aucun compte de trésorerie → `failed-precondition`.
 */
function resolveTreasuryAccount(accounts: ResolvedAccount[]): ResolvedAccount {
  const byName = accounts.find(
    (a) => a.data.active && a.data.isTreasury && a.data.name === TREASURY_ACCOUNT_NAME,
  )
  if (byName) return byName
  const treasuries = accounts
    .filter((a) => a.data.active && a.data.isTreasury)
    .sort(compareAccounts)
  const fallback = treasuries[0]
  if (fallback) return fallback
  throw new HttpsError(
    'failed-precondition',
    'Comptes comptables non initialisés — seedez les comptes par défaut.',
  )
}

/** Tri stable `displayOrder asc` puis `number asc` (aligné `compareAccounts` web). */
function compareAccounts(a: ResolvedAccount, b: ResolvedAccount): number {
  if (a.data.displayOrder !== b.data.displayOrder) {
    return a.data.displayOrder - b.data.displayOrder
  }
  return a.data.number.localeCompare(b.data.number)
}

export const confirmLicense = onCall(
  async (
    request: CallableRequest<ConfirmLicenseInput>,
  ): Promise<ConfirmLicenseOutput> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', '[confirmLicense] Must be signed in.')
    }
    const callerUid = request.auth.uid
    const { licenseId } = parseInput(request.data)

    // Pré-charge le user doc hors transaction (rôles stables pendant le call).
    const userSnap = await db().doc(`users/${callerUid}`).get()
    if (!userSnap.exists) {
      throw new HttpsError('permission-denied', '[confirmLicense] No /users doc for caller.')
    }
    const user = userSnap.data() as UserData
    assertCanConfirmLicense(request, user)

    const licenseRef = db().doc(`licenses/${licenseId}`)

    let alreadyActive = false
    let resolvedEntryId: string | null = null

    try {
      await db().runTransaction(async (tx) => {
        // --- 1. Licence ---
        const licenseSnap = await tx.get(licenseRef)
        if (!licenseSnap.exists) {
          throw new HttpsError('not-found', `[confirmLicense] license ${licenseId} not found`)
        }
        const license = licenseSnap.data() as LicenseData

        // --- 2. Idempotence : déjà active → no-op ---
        if (license.status === 'active') {
          alreadyActive = true
          return
        }

        // --- 3. Précondition de statut ---
        if (license.status !== 'pending') {
          throw new HttpsError(
            'failed-precondition',
            `[confirmLicense] cannot confirm license in status '${license.status}' — must be 'pending'`,
          )
        }

        // --- 4. Membre ---
        const memberRef = db().doc(`members/${license.memberId}`)
        const memberSnap = await tx.get(memberRef)
        if (!memberSnap.exists) {
          throw new HttpsError(
            'not-found',
            `[confirmLicense] member ${license.memberId} not found`,
          )
        }
        const member = memberSnap.data() as MemberData

        // --- 5. Comptes comptables ---
        // Lecture de tout le plan comptable dans la transaction (volume faible :
        // quelques dizaines de comptes). Doit rester en amont des writes.
        const accountsSnap = await tx.get(db().collection('accounts'))
        const accounts: ResolvedAccount[] = accountsSnap.docs.map((d) => ({
          id: d.id,
          data: d.data() as AccountData,
        }))
        const expenseAccount = resolveExpenseAccount(accounts)
        const treasuryAccount = resolveTreasuryAccount(accounts)

        const now = Timestamp.now()

        // --- 6. Écriture comptable (partie double équilibrée) ---
        // Le club paie la fédération → charge. L'argent quitte la banque :
        //  - débit du compte de charge "Licences fédérales" ;
        //  - crédit du compte de trésorerie "Banque".
        const amount = license.feeSnapshot
        const lines: AccountingEntryLine[] = [
          { accountId: expenseAccount.id, debit: amount, credit: 0 },
          { accountId: treasuryAccount.id, debit: 0, credit: amount },
        ]
        validateEntryBalance(lines)

        const entryRef = db().collection('accountingEntries').doc()
        const entryData: AccountingEntryData = {
          date: now,
          label: `Licence ${license.licenseName} — ${member.firstName} ${member.lastName}`,
          reference: null,
          source: 'manual',
          invoiceId: null,
          lines,
          reversed: false,
          reversalOfEntryId: null,
          createdBy: callerUid,
          createdAt: now,
        }
        tx.set(entryRef, entryData)
        resolvedEntryId = entryRef.id

        // --- 7. Update licence ---
        tx.update(licenseRef, {
          status: 'active',
          confirmedAt: now,
          confirmedByUid: callerUid,
          accountingEntryId: entryRef.id,
        })

        // --- 8. Denorm membre (official / coach uniquement) ---
        if (license.role === 'official') {
          tx.update(memberRef, {
            officialLicense: {
              licenseId,
              seasonId: license.seasonId,
              level: license.level,
            },
          })
        } else if (license.role === 'coach') {
          tx.update(memberRef, {
            coachLicense: {
              licenseId,
              seasonId: license.seasonId,
              level: license.level,
            },
          })
        }
        // `player` / `referee` → pas de denorm membre (no-op).
      })
    } catch (err) {
      if (err instanceof HttpsError) throw err
      const code = err instanceof Error ? err.message : 'unknown'
      logger.error(`[confirmLicense] transaction failed [${code}]`, { err, licenseId })
      throw new HttpsError('internal', `[confirmLicense] transaction failed`)
    }

    logger.info('[confirmLicense] ok', {
      licenseId,
      callerUid,
      alreadyActive,
      accountingEntryId: resolvedEntryId,
    })

    return {
      ok: true,
      alreadyActive,
      accountingEntryId: alreadyActive ? null : resolvedEntryId,
    }
  },
)
