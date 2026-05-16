<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Message from 'primevue/message'
import { useInvoicesStore, type ManualEntryInput } from '@/stores/invoices'
import { useAccountsStore } from '@/stores/accounts'
import { CREDITORS_ACCOUNT_NUMBER } from '@/repositories/invoices.repo'
import type { CreateInvoiceInput } from '@/stores/invoices'
import type { Account, Invoice, InvoiceStatus } from '@club-app/shared-types'
import Pill from '@/components/ui/Pill.vue'
import InvoiceFormDialog from '@/components/accounting/InvoiceFormDialog.vue'
import InvoiceBookDialog from '@/components/accounting/InvoiceBookDialog.vue'
import ManualEntryDialog from '@/components/accounting/ManualEntryDialog.vue'

/**
 * Page **Factures** — module Comptabilité (route `/comptabilite/factures`).
 *
 * Couvre la saisie manuelle de factures fournisseurs (v1, OCR différé), leur
 * comptabilisation / règlement (écritures en partie double via le moteur
 * `accountingEntries.repo`), et la saisie manuelle de débits génériques.
 *
 * Cf. docs/compta.md §3 (schéma `/invoices`) et §5 (flux facture / saisie).
 */

const invoicesStore = useInvoicesStore()
const accountsStore = useAccountsStore()
const router = useRouter()

// ---------------------------------------------------------------------------
// Chargement initial
// ---------------------------------------------------------------------------

onMounted(() => {
  void invoicesStore.loadInvoices()
  // Le plan comptable alimente les Select (compte de charge, trésorerie,
  // contrepartie Créditeurs). On ne le recharge pas s'il est déjà en mémoire.
  if (accountsStore.accounts.length === 0) {
    void accountsStore.loadAccounts()
  }
})

// ---------------------------------------------------------------------------
// Comptes dérivés
// ---------------------------------------------------------------------------

/** Comptes de charge actifs — picker du compte imputé. */
const expenseAccounts = computed<Account[]>(() =>
  accountsStore.accountsByNature.charge.filter((a) => a.active),
)

/** Comptes de trésorerie actifs (Caisse / Banque) — picker de règlement. */
const treasuryAccounts = computed<Account[]>(
  () => accountsStore.treasuryAccounts,
)

/**
 * Compte « Créditeurs (fournisseurs) ». Résolu par numéro de compte
 * (`'2000'`) ; repli sur le premier compte de nature `passif` si un club a
 * renommé / renuméroté le compte par défaut. `null` si introuvable — l'UI
 * désactive alors les actions de comptabilisation.
 */
const creditorsAccount = computed<Account | null>(() => {
  const byNumber = accountsStore.accounts.find(
    (a) => a.number === CREDITORS_ACCOUNT_NUMBER && a.active,
  )
  if (byNumber) return byNumber
  return accountsStore.accountsByNature.passif.find((a) => a.active) ?? null
})

/** Map `id → Account` pour résoudre le nom du compte de charge en table. */
const accountById = computed<Map<string, Account>>(() => {
  const m = new Map<string, Account>()
  for (const a of accountsStore.accounts) m.set(a.id, a)
  return m
})

// ---------------------------------------------------------------------------
// Filtre par statut
// ---------------------------------------------------------------------------

type StatusFilter = 'all' | InvoiceStatus

interface StatusFilterDef {
  id: StatusFilter
  label: string
}

const STATUS_FILTERS: readonly StatusFilterDef[] = [
  { id: 'all', label: 'Toutes' },
  { id: 'to_pay', label: 'À payer' },
  { id: 'paid', label: 'Payées' },
  { id: 'cancelled', label: 'Annulées' },
] as const

const statusFilter = ref<StatusFilter>('all')

const filteredInvoices = computed<Invoice[]>(() => {
  if (statusFilter.value === 'all') return invoicesStore.invoices
  return invoicesStore.invoices.filter((i) => i.status === statusFilter.value)
})

const statusCounts = computed<Record<StatusFilter, number>>(() => {
  const list = invoicesStore.invoices
  return {
    all: list.length,
    to_pay: list.filter((i) => i.status === 'to_pay').length,
    paid: list.filter((i) => i.status === 'paid').length,
    cancelled: list.filter((i) => i.status === 'cancelled').length,
  }
})

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const DATE_FMT = new Intl.DateTimeFormat('fr-CH', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

function formatDate(
  ts: { seconds: number; nanoseconds: number } | null | undefined,
): string {
  if (!ts) return '—'
  return DATE_FMT.format(new Date(ts.seconds * 1000))
}

function formatChf(amount: number, currency: string): string {
  return new Intl.NumberFormat('fr-CH', {
    style: 'currency',
    currency: currency || 'CHF',
  }).format(amount)
}

function expenseAccountLabel(invoice: Invoice): string {
  if (!invoice.expenseAccountId) return '—'
  const account = accountById.value.get(invoice.expenseAccountId)
  return account ? `${account.number} ${account.name}` : '—'
}

type PillVariant = 'emerald' | 'sky' | 'amber' | 'rose' | 'slate' | 'violet'

interface StatusPillDef {
  variant: PillVariant
  label: string
  strike: boolean
}

function statusPill(status: InvoiceStatus): StatusPillDef {
  switch (status) {
    case 'to_pay':
      return { variant: 'amber', label: 'À payer', strike: false }
    case 'paid':
      return { variant: 'emerald', label: 'Payée', strike: false }
    case 'cancelled':
      return { variant: 'slate', label: 'Annulée', strike: true }
    default:
      return { variant: 'slate', label: status, strike: false }
  }
}

// ---------------------------------------------------------------------------
// Dialog "Nouvelle facture"
// ---------------------------------------------------------------------------

const formDialogVisible = ref(false)
const formError = ref<string | null>(null)

function openFormDialog(): void {
  formError.value = null
  formDialogVisible.value = true
}

async function onCreateInvoice(
  payload: Omit<CreateInvoiceInput, 'createdBy'>,
  file: File | null,
): Promise<void> {
  formError.value = null
  const id = await invoicesStore.addInvoice(payload, file)
  if (id) {
    formDialogVisible.value = false
  } else {
    formError.value = invoicesStore.error
  }
}

// ---------------------------------------------------------------------------
// Dialog "Comptabiliser" / "Marquer payée"
// ---------------------------------------------------------------------------

const bookDialogVisible = ref(false)
const bookDialogMode = ref<'book' | 'pay'>('book')
const bookDialogInvoice = ref<Invoice | null>(null)
const bookError = ref<string | null>(null)

/** Comptes proposés au dialog selon le mode courant. */
const bookDialogAccounts = computed<Account[]>(() =>
  bookDialogMode.value === 'book'
    ? expenseAccounts.value
    : treasuryAccounts.value,
)

function openBookDialog(invoice: Invoice): void {
  bookError.value = null
  bookDialogMode.value = 'book'
  bookDialogInvoice.value = invoice
  bookDialogVisible.value = true
}

function openPayDialog(invoice: Invoice): void {
  bookError.value = null
  bookDialogMode.value = 'pay'
  bookDialogInvoice.value = invoice
  bookDialogVisible.value = true
}

async function onBookConfirm(accountId: string): Promise<void> {
  const invoice = bookDialogInvoice.value
  const creditors = creditorsAccount.value
  if (!invoice || !creditors) return
  bookError.value = null

  if (bookDialogMode.value === 'book') {
    const entryId = await invoicesStore.book(invoice, accountId, creditors.id)
    if (entryId) {
      bookDialogVisible.value = false
    } else {
      bookError.value = invoicesStore.error
    }
  } else {
    const ok = await invoicesStore.markPaid(invoice, accountId, creditors.id)
    if (ok) {
      bookDialogVisible.value = false
    } else {
      bookError.value = invoicesStore.error
    }
  }
}

// ---------------------------------------------------------------------------
// Dialog "Saisie manuelle (débit)"
// ---------------------------------------------------------------------------

const manualDialogVisible = ref(false)
const manualError = ref<string | null>(null)

function openManualDialog(): void {
  manualError.value = null
  manualDialogVisible.value = true
}

async function onManualSubmit(payload: ManualEntryInput): Promise<void> {
  manualError.value = null
  const entryId = await invoicesStore.addManualEntry(payload)
  if (entryId) {
    manualDialogVisible.value = false
  } else {
    manualError.value = invoicesStore.error
  }
}

// ---------------------------------------------------------------------------
// Garde-fous "comptes manquants"
// ---------------------------------------------------------------------------

/** `true` si le plan comptable n'a aucun compte de charge actif. */
const noExpenseAccount = computed(() => expenseAccounts.value.length === 0)

/** `true` si le compte « Créditeurs » n'est pas résolu. */
const noCreditorsAccount = computed(() => creditorsAccount.value === null)

/** `true` si aucun compte de trésorerie actif n'est disponible. */
const noTreasuryAccount = computed(() => treasuryAccounts.value.length === 0)

function goToAccounts(): void {
  void router.push('/comptabilite/comptes')
}

function canBook(invoice: Invoice): boolean {
  return (
    invoice.status === 'to_pay' &&
    invoice.entryId === null &&
    !noCreditorsAccount.value &&
    !noExpenseAccount.value
  )
}

function canPay(invoice: Invoice): boolean {
  return (
    invoice.status === 'to_pay' &&
    !noCreditorsAccount.value &&
    !noTreasuryAccount.value
  )
}
</script>

<template>
  <div class="flex flex-col gap-5 p-6">
    <!-- Header -->
    <div class="flex items-start justify-between">
      <div>
        <h1 class="text-xl font-semibold text-surface-800">
          Factures
        </h1>
        <p class="text-[13px] text-surface-500">
          Saisie des factures fournisseurs, comptabilisation et règlement.
        </p>
      </div>
      <div class="flex gap-2">
        <Button
          label="Saisie manuelle"
          severity="secondary"
          outlined
          @click="openManualDialog"
        />
        <Button
          label="Nouvelle facture"
          @click="openFormDialog"
        />
      </div>
    </div>

    <!-- Garde-fous comptes manquants -->
    <Message
      v-if="noExpenseAccount || noCreditorsAccount"
      severity="warn"
      :closable="false"
    >
      <div class="flex items-center justify-between gap-4">
        <span>
          <template v-if="noCreditorsAccount">
            Le compte « Créditeurs (fournisseurs) » est introuvable —
            la comptabilisation des factures est désactivée.
          </template>
          <template v-else>
            Aucun compte de charge — créez-en un pour pouvoir comptabiliser
            les factures.
          </template>
        </span>
        <Button
          label="Aller aux comptes"
          size="small"
          text
          @click="goToAccounts"
        />
      </div>
    </Message>

    <!-- Erreur de chargement -->
    <Message
      v-if="invoicesStore.error && invoicesStore.invoices.length === 0"
      severity="error"
      :closable="false"
    >
      {{ invoicesStore.error }}
    </Message>

    <!-- Filtres statut -->
    <div class="flex gap-2">
      <button
        v-for="f in STATUS_FILTERS"
        :key="f.id"
        type="button"
        class="h-7 px-3 rounded text-[12px] font-medium transition-colors"
        :class="
          statusFilter === f.id
            ? 'bg-surface-800 text-white'
            : 'bg-surface-100 text-surface-600 hover:bg-surface-200'
        "
        @click="statusFilter = f.id"
      >
        {{ f.label }}
        <span class="ml-1 opacity-70">{{ statusCounts[f.id] }}</span>
      </button>
    </div>

    <!-- Table des factures -->
    <DataTable
      :value="filteredInvoices"
      :loading="invoicesStore.loading"
      data-key="id"
      class="text-[13px]"
      striped-rows
    >
      <template #empty>
        <div class="py-8 text-center text-surface-500 text-[13px]">
          Aucune facture.
        </div>
      </template>

      <Column
        header="Fournisseur"
        field="supplierName"
      >
        <template #body="{ data }">
          <span class="font-medium text-surface-700">
            {{ data.supplierName }}
          </span>
        </template>
      </Column>

      <Column header="N°">
        <template #body="{ data }">
          <span class="text-surface-600">{{ data.invoiceNumber ?? '—' }}</span>
        </template>
      </Column>

      <Column header="Émission">
        <template #body="{ data }">
          {{ formatDate(data.issueDate) }}
        </template>
      </Column>

      <Column header="Échéance">
        <template #body="{ data }">
          {{ formatDate(data.dueDate) }}
        </template>
      </Column>

      <Column header="Montant">
        <template #body="{ data }">
          <span class="font-medium text-surface-700">
            {{ formatChf(data.amount, data.currency) }}
          </span>
        </template>
      </Column>

      <Column header="Statut">
        <template #body="{ data }">
          <Pill
            :variant="statusPill(data.status).variant"
            :strike="statusPill(data.status).strike"
          >
            {{ statusPill(data.status).label }}
          </Pill>
        </template>
      </Column>

      <Column header="Compte de charge">
        <template #body="{ data }">
          <span class="text-surface-600">{{ expenseAccountLabel(data) }}</span>
        </template>
      </Column>

      <Column header="Comptabilisée">
        <template #body="{ data }">
          <Pill
            v-if="data.entryId"
            variant="emerald"
          >
            Oui
          </Pill>
          <Pill
            v-else
            variant="slate"
          >
            Non
          </Pill>
        </template>
      </Column>

      <Column
        header=""
        :style="{ width: '14rem' }"
      >
        <template #body="{ data }">
          <div class="flex gap-1.5 justify-end">
            <Button
              v-if="canBook(data)"
              label="Comptabiliser"
              size="small"
              outlined
              @click="openBookDialog(data)"
            />
            <Button
              v-if="canPay(data)"
              label="Marquer payée"
              size="small"
              severity="secondary"
              outlined
              @click="openPayDialog(data)"
            />
          </div>
        </template>
      </Column>
    </DataTable>

    <!-- Dialogs -->
    <InvoiceFormDialog
      v-model:visible="formDialogVisible"
      :expense-accounts="expenseAccounts"
      :error-message="formError"
      @submit="onCreateInvoice"
    />

    <InvoiceBookDialog
      v-model:visible="bookDialogVisible"
      :mode="bookDialogMode"
      :invoice="bookDialogInvoice"
      :account-options="bookDialogAccounts"
      :error-message="bookError"
      @confirm="onBookConfirm"
    />

    <ManualEntryDialog
      v-model:visible="manualDialogVisible"
      :accounts="accountsStore.activeAccounts"
      :error-message="manualError"
      @submit="onManualSubmit"
    />
  </div>
</template>
