<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { AlertTriangle, CheckCircle2, Scale } from 'lucide-vue-next'
import { useAccountingReportsStore } from '@/stores/accountingReports'
import ReportPeriodFilter from '@/components/accounting/ReportPeriodFilter.vue'

/**
 * Vue `/comptabilite/bilan` — état du patrimoine du club (cf. docs/compta.md
 * §4). Deux colonnes : comptes `actif` à gauche, comptes `passif` à droite.
 * Le « Résultat de l'exercice » figure côté passif. Le bilan est équilibré
 * par construction de la partie double — un indicateur le confirme.
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

const bilan = computed(() => store.balanceSheet)
</script>

<template>
  <section class="p-6 space-y-4">
    <!-- ================= Page heading =================== -->
    <div class="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-[22px] font-semibold tracking-tight">
          Bilan
        </h1>
        <p class="text-[13px] text-surface-500 mt-0.5">
          État du patrimoine — actif à gauche, passif à droite, résultat de
          l'exercice inclus.
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
      Chargement du bilan…
    </div>

    <!-- ================= Empty =================== -->
    <div
      v-else-if="store.isEmpty"
      class="card p-10 text-center flex flex-col items-center gap-2"
    >
      <span
        class="w-10 h-10 rounded-full bg-surface-100 inline-flex items-center justify-center text-surface-500"
      >
        <Scale
          :size="18"
          :stroke-width="2"
        />
      </span>
      <div class="text-[14px] font-semibold">
        Aucune donnée comptable
      </div>
      <div class="text-[12px] text-surface-500 max-w-md">
        Le journal est vide — le bilan s'affichera dès la première écriture.
      </div>
    </div>

    <!-- ================= Bilan =================== -->
    <template v-else>
      <!-- Indicateur d'équilibre -->
      <div
        class="card p-3 flex items-center gap-2 text-[13px]"
        :class="
          bilan.balanced
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
            : 'bg-rose-50 border-rose-200 text-rose-700'
        "
      >
        <CheckCircle2
          v-if="bilan.balanced"
          :size="16"
          :stroke-width="2"
        />
        <AlertTriangle
          v-else
          :size="16"
          :stroke-width="2"
        />
        <span class="font-medium">
          {{
            bilan.balanced
              ? 'Bilan équilibré — total actif = total passif.'
              : 'Bilan déséquilibré — écart entre actif et passif détecté.'
          }}
        </span>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <!-- ===== Actif ===== -->
        <div class="card overflow-hidden">
          <div
            class="px-4 py-2.5 bg-surface-50 border-b border-surface-200 flex items-center justify-between"
          >
            <h2 class="text-[13px] font-semibold tracking-tight">
              Actif
            </h2>
            <span class="num font-semibold tabular-nums text-[13px]">
              {{ formatChf(bilan.totalActif) }}
            </span>
          </div>
          <table class="w-full text-[13px]">
            <tbody>
              <tr
                v-for="line in bilan.actif"
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
              <tr v-if="bilan.actif.length === 0">
                <td
                  colspan="2"
                  class="px-4 py-4 text-center text-[12px] text-surface-400"
                >
                  Aucun compte d'actif
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="bg-surface-50 border-t border-surface-200">
                <td class="px-4 py-2.5 font-semibold">
                  Total actif
                </td>
                <td
                  class="px-4 py-2.5 text-right num font-semibold tabular-nums"
                >
                  {{ formatChf(bilan.totalActif) }}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <!-- ===== Passif ===== -->
        <div class="card overflow-hidden">
          <div
            class="px-4 py-2.5 bg-surface-50 border-b border-surface-200 flex items-center justify-between"
          >
            <h2 class="text-[13px] font-semibold tracking-tight">
              Passif
            </h2>
            <span class="num font-semibold tabular-nums text-[13px]">
              {{ formatChf(bilan.totalPassif) }}
            </span>
          </div>
          <table class="w-full text-[13px]">
            <tbody>
              <tr
                v-for="line in bilan.passif"
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
              <!-- Résultat de l'exercice — toujours affiché côté passif -->
              <tr class="border-b border-surface-100 bg-amber-50/50">
                <td class="px-4 py-2">
                  <span class="font-medium">
                    Résultat de l'exercice
                  </span>
                  <span
                    class="ml-2 text-[11px]"
                    :class="
                      bilan.result >= 0 ? 'text-emerald-600' : 'text-rose-600'
                    "
                  >
                    ({{ bilan.result >= 0 ? 'bénéfice' : 'perte' }})
                  </span>
                </td>
                <td
                  class="px-4 py-2 text-right num tabular-nums font-medium"
                  :class="
                    bilan.result >= 0 ? 'text-emerald-700' : 'text-rose-700'
                  "
                >
                  {{ formatChf(bilan.result) }}
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="bg-surface-50 border-t border-surface-200">
                <td class="px-4 py-2.5 font-semibold">
                  Total passif
                </td>
                <td
                  class="px-4 py-2.5 text-right num font-semibold tabular-nums"
                >
                  {{ formatChf(bilan.totalPassif) }}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </template>
  </section>
</template>
