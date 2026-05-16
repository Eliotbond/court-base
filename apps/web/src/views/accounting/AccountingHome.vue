<script setup lang="ts">
import { computed, onMounted, type Component } from 'vue'
import {
  ArrowRight,
  BookOpen,
  Calculator,
  FileText,
  PlusCircle,
  Scale,
  ScrollText,
  Wallet,
} from 'lucide-vue-next'
import { useAccountsStore } from '@/stores/accounts'

/**
 * Vue Comptabilité → hub du module (`/comptabilite`).
 *
 * Page d'accueil : grille de cartes-liens vers les sous-pages. Ne dépend que
 * du store `accounts` (pour le compteur "comptes actifs") — les stores des
 * autres sous-modules (crédits, factures, journal) ne sont pas mobilisés ici.
 */

const accountsStore = useAccountsStore()

onMounted(() => {
  if (accountsStore.accounts.length === 0 && !accountsStore.loading) {
    void accountsStore.loadAccounts()
  }
})

const activeAccountsCount = computed(() => accountsStore.activeAccounts.length)

interface HubCard {
  to: string
  title: string
  description: string
  icon: Component
  /** Note dynamique optionnelle affichée sous la description. */
  note?: string
}

const cards = computed<HubCard[]>(() => [
  {
    to: '/comptabilite/comptes',
    title: 'Plan comptable',
    description: 'Comptes du club — actif, passif, charges, produits.',
    icon: BookOpen,
    note:
      activeAccountsCount.value > 0
        ? `${activeAccountsCount.value} compte${activeAccountsCount.value > 1 ? 's' : ''} actif${activeAccountsCount.value > 1 ? 's' : ''}`
        : undefined,
  },
  {
    to: '/comptabilite/credits',
    title: 'Crédits',
    description: 'Saisie des entrées d’argent — cash, sponsoring, subventions.',
    icon: PlusCircle,
  },
  {
    to: '/comptabilite/factures',
    title: 'Factures',
    description: 'Factures fournisseurs — comptabilisation et règlement.',
    icon: FileText,
  },
  {
    to: '/comptabilite/journal',
    title: 'Journal',
    description: 'Toutes les écritures comptables, ordre chronologique.',
    icon: ScrollText,
  },
  {
    to: '/comptabilite/bilan',
    title: 'Bilan',
    description: 'État du patrimoine — actif et passif à une date donnée.',
    icon: Scale,
  },
  {
    to: '/comptabilite/resultat',
    title: 'Compte de résultat',
    description: 'Confrontation des charges et des produits sur l’exercice.',
    icon: Calculator,
  },
])
</script>

<template>
  <div class="p-6 space-y-5">
    <header>
      <h1 class="text-lg font-semibold tracking-tight flex items-center gap-2">
        <Wallet
          :size="18"
          :stroke-width="2"
          class="text-emerald-600"
        />
        Comptabilité
      </h1>
      <p class="text-[13px] text-surface-500 mt-0.5">
        Comptabilité en partie double du club — plan comptable, journal des
        écritures, factures et restitutions.
      </p>
    </header>

    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <RouterLink
        v-for="card in cards"
        :key="card.to"
        :to="card.to"
        class="group border border-surface-200 rounded-lg p-4 bg-white hover:border-emerald-300 hover:shadow-sm transition flex flex-col gap-2"
      >
        <div class="flex items-center justify-between">
          <span
            class="w-9 h-9 rounded-md bg-emerald-50 text-emerald-600 flex items-center justify-center"
          >
            <component
              :is="card.icon"
              :size="18"
              :stroke-width="2"
            />
          </span>
          <ArrowRight
            :size="16"
            :stroke-width="2"
            class="text-surface-300 group-hover:text-emerald-500 transition"
          />
        </div>
        <div>
          <h2 class="text-[14px] font-semibold text-surface-800">
            {{ card.title }}
          </h2>
          <p class="text-[12px] text-surface-500 mt-0.5 leading-snug">
            {{ card.description }}
          </p>
          <p
            v-if="card.note"
            class="text-[11px] text-emerald-600 font-medium mt-1.5"
          >
            {{ card.note }}
          </p>
        </div>
      </RouterLink>
    </div>
  </div>
</template>
