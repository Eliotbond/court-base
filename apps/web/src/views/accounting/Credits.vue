<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CircleDollarSign, Plus, RotateCcw } from 'lucide-vue-next'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Message from 'primevue/message'
import { useAccountingEntriesStore } from '@/stores/accountingEntries'
import { useAccountsStore } from '@/stores/accounts'
import CreditFormDialog, {
  type CreditFormPayload,
} from '@/components/accounting/CreditFormDialog.vue'
import type { Account, AccountingEntry } from '@club-app/shared-types'

/**
 * Page « Crédits » du module Comptabilité — route `/comptabilite/credits`.
 *
 * Permet d'enregistrer une entrée d'argent (cash, sponsoring, subvention
 * J+S…) assignée à un compte, et de consulter / annuler les crédits récents.
 *
 * Architecture en couches (apps/web/CLAUDE.md) : la vue ne lit que les stores
 * `accountingEntries` (journal) et `accounts` (plan comptable). Aucune
 * écriture Firestore directe.
 */

const entriesStore = useAccountingEntriesStore()
const accountsStore = useAccountsStore()

onMounted(() => {
  void entriesStore.loadEntries()
  // Le plan comptable alimente les pickers du dialog ; on ne le recharge pas
  // s'il est déjà en mémoire (navigation depuis une autre page comptable).
  if (accountsStore.accounts.length === 0) {
    void accountsStore.loadAccounts()
  }
})

// ---------------------------------------------------------------------------
// Comptes — pickers du dialog.
// ---------------------------------------------------------------------------

/** Comptes de trésorerie actifs — contrepartie automatique des crédits. */
const treasuryAccounts = computed<Account[]>(
  () => accountsStore.treasuryAccounts,
)

/**
 * Comptes éligibles comme compte crédité : tous les comptes actifs. La saisie
 * d'un crédit cible typiquement un compte de produit, mais on n'exclut rien
 * (cf. docs/compta.md §5 — « ou d'actif selon le cas »).
 */
const creditableAccounts = computed<Account[]>(
  () => accountsStore.activeAccounts,
)

/** `true` si aucun compte de trésorerie n'existe → saisie impossible. */
const noTreasury = computed<boolean>(() => treasuryAccounts.value.length === 0)

// ---------------------------------------------------------------------------
// Résolution des libellés de comptes pour la table.
// ---------------------------------------------------------------------------

/** Map `accountId → "numéro — nom"` pour afficher les comptes dans la table. */
const accountLabelById = computed<Map<string, string>>(() => {
  const map = new Map<string, string>()
  for (const a of accountsStore.accounts) {
    map.set(a.id, `${a.number} — ${a.name}`)
  }
  return map
})

function labelForAccount(id: string): string {
  return accountLabelById.value.get(id) ?? '— compte inconnu —'
}

// ---------------------------------------------------------------------------
// Lignes de table — projection des écritures `source === 'credit'`.
// ---------------------------------------------------------------------------

interface CreditRow {
  id: string
  date: Date
  label: string
  amount: number
  /** Compte crédité (la ligne au crédit de l'écriture). */
  creditedAccount: string
  /** Compte de trésorerie débité (la contrepartie). */
  treasuryAccount: string
  reference: string | null
  reversed: boolean
  /** `true` si l'écriture EST une contre-passation (non annulable). */
  isReversal: boolean
}

const creditRows = computed<CreditRow[]>(() =>
  entriesStore.creditEntries.map((e) => {
    const debitLine = e.lines.find((l) => l.debit > 0)
    const creditLine = e.lines.find((l) => l.credit > 0)
    return {
      id: e.id,
      date: tsToDate(e),
      label: e.label,
      amount: creditLine?.credit ?? 0,
      creditedAccount: creditLine
        ? labelForAccount(creditLine.accountId)
        : '—',
      treasuryAccount: debitLine
        ? labelForAccount(debitLine.accountId)
        : '—',
      reference: e.reference,
      reversed: e.reversed,
      isReversal: e.reversalOfEntryId !== null,
    }
  }),
)

/** Convertit le `Timestamp` Firestore d'une écriture en `Date` JS. */
function tsToDate(entry: AccountingEntry): Date {
  const seconds = entry.date?.seconds ?? 0
  return new Date(seconds * 1000)
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('fr-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function formatChf(amount: number): string {
  return amount.toLocaleString('fr-CH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

// ---------------------------------------------------------------------------
// Dialog de saisie d'un crédit.
// ---------------------------------------------------------------------------

const formDialogVisible = ref(false)
const submitting = ref(false)

function openFormDialog(): void {
  entriesStore.error = null
  formDialogVisible.value = true
}

async function onSubmitCredit(payload: CreditFormPayload): Promise<void> {
  submitting.value = true
  try {
    const id = await entriesStore.addCredit(payload)
    if (id) formDialogVisible.value = false
  } finally {
    submitting.value = false
  }
}

// ---------------------------------------------------------------------------
// Annulation d'un crédit — contre-passation (pas de ConfirmDialog global).
// ---------------------------------------------------------------------------

const reverseTarget = ref<CreditRow | null>(null)
const reversing = ref(false)

function openReverseDialog(row: CreditRow): void {
  entriesStore.error = null
  reverseTarget.value = row
}

function closeReverseDialog(): void {
  reverseTarget.value = null
}

async function confirmReverse(): Promise<void> {
  const target = reverseTarget.value
  if (!target) return
  reversing.value = true
  try {
    const id = await entriesStore.reverse(target.id)
    if (id) closeReverseDialog()
  } finally {
    reversing.value = false
  }
}
</script>

<template>
  <section class="p-6 space-y-4">
    <!-- ================= Page heading =================== -->
    <div class="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-[22px] font-semibold tracking-tight">
          Crédits
        </h1>
        <p class="text-[13px] text-surface-500 mt-0.5">
          Enregistrer les entrées d'argent — cash, sponsoring, subventions J+S.
        </p>
      </div>
      <Button
        label="Nouveau crédit"
        :disabled="noTreasury"
        @click="openFormDialog"
      >
        <template #icon>
          <Plus
            :size="15"
            :stroke-width="2.25"
          />
        </template>
      </Button>
    </div>

    <!-- ============ Pas de compte de trésorerie ============ -->
    <Message
      v-if="noTreasury"
      severity="warn"
      :closable="false"
    >
      Aucun compte de trésorerie (Caisse / Banque) n'existe. Créez ou seedez
      le plan comptable depuis la page Comptes avant d'enregistrer un crédit.
    </Message>

    <!-- ============ Erreur store (hors dialog) ============ -->
    <Message
      v-else-if="entriesStore.error && !formDialogVisible && !reverseTarget"
      severity="error"
      :closable="false"
    >
      {{ entriesStore.error }}
    </Message>

    <!-- ================= Liste des crédits ================= -->
    <DataTable
      :value="creditRows"
      :loading="entriesStore.loading"
      data-key="id"
      class="text-[13px]"
      :pt="{ table: { class: 'min-w-full' } }"
    >
      <template #empty>
        <div class="flex flex-col items-center gap-2 py-10 text-surface-500">
          <CircleDollarSign
            :size="28"
            :stroke-width="1.5"
          />
          <span class="text-[13px]">Aucun crédit enregistré.</span>
        </div>
      </template>

      <Column
        header="Date"
        :style="{ width: '7rem' }"
      >
        <template #body="{ data }">
          {{ formatDate((data as CreditRow).date) }}
        </template>
      </Column>

      <Column
        field="label"
        header="Libellé"
      >
        <template #body="{ data }">
          <div class="flex items-center gap-2">
            <span>{{ (data as CreditRow).label }}</span>
            <span
              v-if="(data as CreditRow).isReversal"
              class="text-[11px] text-amber-600 font-medium"
            >
              contre-passation
            </span>
            <span
              v-else-if="(data as CreditRow).reversed"
              class="text-[11px] text-surface-400 font-medium line-through"
            >
              annulé
            </span>
          </div>
        </template>
      </Column>

      <Column
        header="Montant"
        :style="{ width: '8rem' }"
      >
        <template #body="{ data }">
          <span class="font-medium tabular-nums">
            {{ formatChf((data as CreditRow).amount) }} CHF
          </span>
        </template>
      </Column>

      <Column
        field="creditedAccount"
        header="Compte crédité"
      />

      <Column
        field="treasuryAccount"
        header="Contrepartie"
      />

      <Column
        header="Référence"
        :style="{ width: '10rem' }"
      >
        <template #body="{ data }">
          <span class="text-surface-500">
            {{ (data as CreditRow).reference ?? '—' }}
          </span>
        </template>
      </Column>

      <Column
        header=""
        :style="{ width: '6rem' }"
      >
        <template #body="{ data }">
          <Button
            v-if="!(data as CreditRow).reversed && !(data as CreditRow).isReversal"
            label="Annuler"
            text
            size="small"
            severity="danger"
            @click="openReverseDialog(data as CreditRow)"
          >
            <template #icon>
              <RotateCcw
                :size="13"
                :stroke-width="2"
              />
            </template>
          </Button>
        </template>
      </Column>
    </DataTable>

    <!-- ================= Dialog saisie crédit ================= -->
    <CreditFormDialog
      v-model:visible="formDialogVisible"
      :account-options="creditableAccounts"
      :treasury-options="treasuryAccounts"
      :error-message="formDialogVisible ? entriesStore.error : null"
      :submitting="submitting"
      @submit="onSubmitCredit"
    />

    <!-- ============ Dialog confirmation annulation ============ -->
    <Dialog
      :visible="reverseTarget !== null"
      modal
      header="Annuler ce crédit"
      :style="{ width: '28rem' }"
      @update:visible="(v: boolean) => { if (!v) closeReverseDialog() }"
    >
      <div class="flex flex-col gap-3 text-[13px]">
        <p class="text-surface-600">
          L'annulation crée une écriture de contre-passation : le crédit
          d'origine est conservé dans le journal (audit), son effet est neutralisé.
        </p>
        <div
          v-if="reverseTarget"
          class="rounded-md bg-surface-50 px-3 py-2 text-surface-700"
        >
          <div class="font-medium">
            {{ reverseTarget.label }}
          </div>
          <div class="text-surface-500">
            {{ formatChf(reverseTarget.amount) }} CHF —
            {{ reverseTarget.creditedAccount }}
          </div>
        </div>
        <Message
          v-if="entriesStore.error"
          severity="error"
          :closable="false"
        >
          {{ entriesStore.error }}
        </Message>
      </div>

      <template #footer>
        <Button
          label="Retour"
          text
          severity="secondary"
          :disabled="reversing"
          @click="closeReverseDialog"
        />
        <Button
          label="Confirmer l'annulation"
          severity="danger"
          :loading="reversing"
          :disabled="reversing"
          @click="confirmReverse"
        />
      </template>
    </Dialog>
  </section>
</template>
