<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { BookOpen, Pencil, Plus, Trash2 } from 'lucide-vue-next'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'
import { useAccountsStore } from '@/stores/accounts'
import { isAccountUsed } from '@/repositories/accounts.repo'
import type { Account, AccountNature } from '@club-app/shared-types'
import Pill from '@/components/ui/Pill.vue'
import AccountFormDialog, {
  type AccountFormPayload,
} from '@/components/accounting/AccountFormDialog.vue'
import AccountDeleteDialog from '@/components/accounting/AccountDeleteDialog.vue'

/**
 * Vue Comptabilité → Plan comptable (`/comptabilite/comptes`).
 *
 * CRUD complet sur `/accounts` : DataTable + dialog création / édition unifié
 * + dialog de confirmation de suppression. État vide → CTA "Créer les comptes
 * par défaut" (`seedDefaults`). Cf. docs/compta.md §3.
 */

const store = useAccountsStore()

onMounted(() => {
  void store.loadAccounts()
})

const accounts = computed<Account[]>(() => store.accounts)
const isEmpty = computed(() => !store.loading && accounts.value.length === 0)

// ---------------------------------------------------------------------------
// Nature → libellé + variant de Pill.
// ---------------------------------------------------------------------------

type PillVariant = 'emerald' | 'sky' | 'amber' | 'rose' | 'slate' | 'violet'

const NATURE_LABEL: Record<AccountNature, string> = {
  actif: 'Actif',
  passif: 'Passif',
  charge: 'Charge',
  produit: 'Produit',
}

const NATURE_VARIANT: Record<AccountNature, PillVariant> = {
  actif: 'sky',
  passif: 'violet',
  charge: 'rose',
  produit: 'emerald',
}

// ---------------------------------------------------------------------------
// Form dialog (création / édition).
// ---------------------------------------------------------------------------

const formVisible = ref(false)
const formAccount = ref<Account | null>(null)
const formError = ref<string | null>(null)

function openCreate(): void {
  formAccount.value = null
  formError.value = null
  formVisible.value = true
}

function openEdit(account: Account): void {
  formAccount.value = account
  formError.value = null
  formVisible.value = true
}

async function onFormSubmit(payload: AccountFormPayload): Promise<void> {
  formError.value = null
  let ok: boolean
  if (formAccount.value) {
    // Édition : on conserve le `displayOrder` d'origine du compte.
    ok = await store.updateAccount(formAccount.value.id, payload)
  } else {
    // Création : on place le nouveau compte en queue de liste.
    const maxOrder = accounts.value.reduce(
      (max, a) => Math.max(max, a.displayOrder),
      -10,
    )
    ok =
      (await store.createAccount({
        ...payload,
        displayOrder: maxOrder + 10,
      })) !== null
  }
  if (ok) {
    formVisible.value = false
  } else {
    formError.value = store.error
  }
}

// ---------------------------------------------------------------------------
// Delete dialog.
// ---------------------------------------------------------------------------

const deleteVisible = ref(false)
const deleteAccount = ref<Account | null>(null)
const deleteIsUsed = ref(false)
const deleteError = ref<string | null>(null)

async function openDelete(account: Account): Promise<void> {
  deleteAccount.value = account
  deleteError.value = null
  // Compte par défaut : inutile d'interroger les écritures, c'est déjà bloqué.
  deleteIsUsed.value = account.isDefault ? false : await isAccountUsed(account.id)
  deleteVisible.value = true
}

async function onDeleteConfirm(): Promise<void> {
  if (!deleteAccount.value) return
  deleteError.value = null
  const ok = await store.deleteAccount(deleteAccount.value.id)
  if (ok) {
    deleteVisible.value = false
  } else {
    deleteError.value = store.error
  }
}

// ---------------------------------------------------------------------------
// Seed des comptes par défaut.
// ---------------------------------------------------------------------------

const seeding = ref(false)

async function onSeed(): Promise<void> {
  seeding.value = true
  try {
    await store.seedDefaults()
  } finally {
    seeding.value = false
  }
}
</script>

<template>
  <div class="p-6 space-y-5">
    <!-- Page header -->
    <header class="flex items-start justify-between gap-4">
      <div>
        <h1 class="text-lg font-semibold tracking-tight flex items-center gap-2">
          <BookOpen
            :size="18"
            :stroke-width="2"
            class="text-emerald-600"
          />
          Plan comptable
        </h1>
        <p class="text-[13px] text-surface-500 mt-0.5">
          {{ accounts.length }} compte{{ accounts.length > 1 ? 's' : '' }} —
          comptes de la comptabilité en partie double du club.
        </p>
      </div>
      <Button
        v-if="!isEmpty"
        label="Nouveau compte"
        @click="openCreate"
      >
        <template #icon>
          <Plus
            :size="15"
            :stroke-width="2"
          />
        </template>
      </Button>
    </header>

    <Message
      v-if="store.error && !formVisible && !deleteVisible"
      severity="error"
      :closable="false"
    >
      {{ store.error }}
    </Message>

    <!-- Loading -->
    <div
      v-if="store.loading"
      class="flex justify-center py-16"
    >
      <ProgressSpinner
        style="width: 2.5rem; height: 2.5rem"
        stroke-width="4"
      />
    </div>

    <!-- État vide → seed -->
    <div
      v-else-if="isEmpty"
      class="border border-dashed border-surface-300 rounded-lg py-14 flex flex-col items-center text-center gap-3"
    >
      <BookOpen
        :size="32"
        :stroke-width="1.5"
        class="text-surface-300"
      />
      <div>
        <p class="text-[14px] font-medium text-surface-700">
          Aucun compte
        </p>
        <p class="text-[13px] text-surface-500 mt-0.5 max-w-md">
          Le plan comptable est vide. Créez les comptes par défaut (Caisse,
          Banque, cotisations, charges…) pour démarrer la comptabilité.
        </p>
      </div>
      <Button
        label="Créer les comptes par défaut"
        :loading="seeding"
        @click="onSeed"
      >
        <template #icon>
          <Plus
            :size="15"
            :stroke-width="2"
          />
        </template>
      </Button>
    </div>

    <!-- Table -->
    <DataTable
      v-else
      :value="accounts"
      data-key="id"
      class="text-[13px]"
      striped-rows
    >
      <Column
        field="number"
        header="Numéro"
        :style="{ width: '7rem' }"
      >
        <template #body="{ data }">
          <span class="font-mono text-surface-700">{{ data.number }}</span>
        </template>
      </Column>

      <Column
        field="name"
        header="Nom"
      >
        <template #body="{ data }">
          <div class="flex flex-col">
            <span class="font-medium text-surface-800">{{ data.name }}</span>
            <span
              v-if="data.description"
              class="text-[11px] text-surface-500"
            >
              {{ data.description }}
            </span>
          </div>
        </template>
      </Column>

      <Column
        field="nature"
        header="Nature"
        :style="{ width: '7rem' }"
      >
        <template #body="{ data }">
          <Pill :variant="NATURE_VARIANT[data.nature as AccountNature]">
            {{ NATURE_LABEL[data.nature as AccountNature] }}
          </Pill>
        </template>
      </Column>

      <Column
        header="Trésorerie"
        :style="{ width: '7rem' }"
      >
        <template #body="{ data }">
          <Pill
            v-if="data.isTreasury"
            variant="amber"
          >
            Trésorerie
          </Pill>
          <span
            v-else
            class="text-surface-300"
          >—</span>
        </template>
      </Column>

      <Column
        header="Actif"
        :style="{ width: '6rem' }"
      >
        <template #body="{ data }">
          <Pill :variant="data.active ? 'emerald' : 'slate'">
            {{ data.active ? 'Actif' : 'Inactif' }}
          </Pill>
        </template>
      </Column>

      <Column
        header=""
        :style="{ width: '6rem' }"
      >
        <template #body="{ data }">
          <div class="flex items-center gap-1 justify-end">
            <Button
              text
              rounded
              severity="secondary"
              aria-label="Modifier"
              @click="openEdit(data)"
            >
              <template #icon>
                <Pencil
                  :size="15"
                  :stroke-width="2"
                />
              </template>
            </Button>
            <Button
              text
              rounded
              severity="danger"
              aria-label="Supprimer"
              @click="openDelete(data)"
            >
              <template #icon>
                <Trash2
                  :size="15"
                  :stroke-width="2"
                />
              </template>
            </Button>
          </div>
        </template>
      </Column>
    </DataTable>

    <AccountFormDialog
      v-model:visible="formVisible"
      :account="formAccount"
      :error-message="formError"
      @submit="onFormSubmit"
    />

    <AccountDeleteDialog
      v-model:visible="deleteVisible"
      :account="deleteAccount"
      :is-used="deleteIsUsed"
      :error-message="deleteError"
      @confirm="onDeleteConfirm"
    />
  </div>
</template>
