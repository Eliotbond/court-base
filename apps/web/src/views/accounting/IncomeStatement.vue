<script setup lang="ts">
import { computed, onMounted } from 'vue'
import {
  AlertTriangle,
  TrendingDown,
  TrendingUp,
} from 'lucide-vue-next'
import { useAccountingReportsStore } from '@/stores/accountingReports'
import ReportPeriodFilter from '@/components/accounting/ReportPeriodFilter.vue'

/**
 * Vue `/comptabilite/resultat` — compte de résultat (cf. docs/compta.md §4).
 * Confrontation des comptes `charge` et `produit` ; le « Résultat » =
 * Σ produits − Σ charges (bénéfice si > 0, perte si < 0).
 */

const store = useAccountingReportsStore()

onMounted(() => {
  void store.loadAll()
})

// ---------------------------------------------------------------------------
// Formatter — CHF.
// ---------------------------------------------------------------------------

const CHF = new Intl.NumberFormat('fr-CH', {
  style: 'currency',
  currency: 'CHF',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function formatChf(n: number): string {
  return CHF.format(n)
}

// ---------------------------------------------------------------------------
// Derived
// ---------------------------------------------------------------------------

const result = computed(() => store.incomeStatement)
const isProfit = computed<boolean>(() => result.value.result >= 0)
</script>

<template>
  <section class="p-6 space-y-4">
    <!-- ================= Page heading =================== -->
    <div class="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-[22px] font-semibold tracking-tight">
          Compte de résultat
        </h1>
        <p class="text-[13px] text-surface-500 mt-0.5">
          Confrontation des charges et des produits — bénéfice ou perte de
          l'exercice.
        </p>
      </div>
      <ReportPeriodFilter
        :model-value="store.period"
        @update:model-value="store.setPeriod($event)"
      />
    </div>

    <!-- ================= Error banner =================== -->
    <div
      v-if="store.error"
      class="card p-4 flex items-center gap-2 text-[13px] text-rose-700 bg-rose-50 border-rose-200"
    >
      <AlertTriangle
        :size="16"
        :stroke-width="2"
      />
      {{ store.error }}
    </div>

    <!-- ================= Loading =================== -->
    <div
      v-if="store.loading"
      class="card p-10 text-center text-[13px] text-surface-500"
    >
      Chargement du compte de résultat…
    </div>

    <!-- ================= Empty =================== -->
    <div
      v-else-if="store.isEmpty"
      class="card p-10 text-center flex flex-col items-center gap-2"
    >
      <span
        class="w-10 h-10 rounded-full bg-surface-100 inline-flex items-center justify-center text-surface-500"
      >
        <TrendingUp
          :size="18"
          :stroke-width="2"
        />
      </span>
      <div class="text-[14px] font-semibold">
        Aucune donnée comptable
      </div>
      <div class="text-[12px] text-surface-500 max-w-md">
        Le journal est vide — le compte de résultat s'affichera dès la première
        écriture.
      </div>
    </div>

    <!-- ================= Compte de résultat =================== -->
    <template v-else>
      <!-- Bandeau résultat -->
      <div
        class="card p-4 flex items-center justify-between gap-3"
        :class="
          isProfit
            ? 'bg-emerald-50 border-emerald-200'
            : 'bg-rose-50 border-rose-200'
        "
      >
        <div class="flex items-center gap-2">
          <span
            class="w-9 h-9 rounded-full inline-flex items-center justify-center"
            :class="
              isProfit
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-rose-100 text-rose-700'
            "
          >
            <TrendingUp
              v-if="isProfit"
              :size="18"
              :stroke-width="2"
            />
            <TrendingDown
              v-else
              :size="18"
              :stroke-width="2"
            />
          </span>
          <div>
            <div
              class="text-[13px] font-semibold"
              :class="isProfit ? 'text-emerald-800' : 'text-rose-800'"
            >
              {{ isProfit ? "Bénéfice de l'exercice" : "Perte de l'exercice" }}
            </div>
            <div class="text-[11px] text-surface-500">
              Résultat = Σ produits − Σ charges
            </div>
          </div>
        </div>
        <span
          class="num font-semibold tabular-nums text-[18px]"
          :class="isProfit ? 'text-emerald-700' : 'text-rose-700'"
        >
          {{ formatChf(result.result) }}
        </span>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <!-- ===== Charges ===== -->
        <div class="card overflow-hidden">
          <div
            class="px-4 py-2.5 bg-surface-50 border-b border-surface-200 flex items-center justify-between"
          >
            <h2 class="text-[13px] font-semibold tracking-tight">
              Charges
            </h2>
            <span class="num font-semibold tabular-nums text-[13px]">
              {{ formatChf(result.totalCharges) }}
            </span>
          </div>
          <table class="w-full text-[13px]">
            <tbody>
              <tr
                v-for="line in result.charges"
                :key="line.account.id"
                class="border-b border-surface-100"
              >
                <td class="px-4 py-2">
                  <span class="num text-surface-500">
                    {{ line.account.number }}
                  </span>
                  <span class="ml-2">{{ line.account.name }}</span>
                </td>
                <td class="px-4 py-2 text-right num tabular-nums">
                  {{ formatChf(line.solde) }}
                </td>
              </tr>
              <tr v-if="result.charges.length === 0">
                <td
                  colspan="2"
                  class="px-4 py-4 text-center text-[12px] text-surface-400"
                >
                  Aucun compte de charge
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="bg-surface-50 border-t border-surface-200">
                <td class="px-4 py-2.5 font-semibold">
                  Total charges
                </td>
                <td
                  class="px-4 py-2.5 text-right num font-semibold tabular-nums"
                >
                  {{ formatChf(result.totalCharges) }}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <!-- ===== Produits ===== -->
        <div class="card overflow-hidden">
          <div
            class="px-4 py-2.5 bg-surface-50 border-b border-surface-200 flex items-center justify-between"
          >
            <h2 class="text-[13px] font-semibold tracking-tight">
              Produits
            </h2>
            <span class="num font-semibold tabular-nums text-[13px]">
              {{ formatChf(result.totalProduits) }}
            </span>
          </div>
          <table class="w-full text-[13px]">
            <tbody>
              <tr
                v-for="line in result.produits"
                :key="line.account.id"
                class="border-b border-surface-100"
              >
                <td class="px-4 py-2">
                  <span class="num text-surface-500">
                    {{ line.account.number }}
                  </span>
                  <span class="ml-2">{{ line.account.name }}</span>
                </td>
                <td class="px-4 py-2 text-right num tabular-nums">
                  {{ formatChf(line.solde) }}
                </td>
              </tr>
              <tr v-if="result.produits.length === 0">
                <td
                  colspan="2"
                  class="px-4 py-4 text-center text-[12px] text-surface-400"
                >
                  Aucun compte de produit
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="bg-surface-50 border-t border-surface-200">
                <td class="px-4 py-2.5 font-semibold">
                  Total produits
                </td>
                <td
                  class="px-4 py-2.5 text-right num font-semibold tabular-nums"
                >
                  {{ formatChf(result.totalProduits) }}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </template>
  </section>
</template>
