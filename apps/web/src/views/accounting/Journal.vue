<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  AlertTriangle,
  BookOpen,
  RotateCcw,
  ScrollText,
} from 'lucide-vue-next'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import { useAccountingReportsStore } from '@/stores/accountingReports'
import type { JournalRow } from '@/stores/accountingReports'
import ReportPeriodFilter from '@/components/accounting/ReportPeriodFilter.vue'

/**
 * Vue `/comptabilite/journal` — restitution chronologique du journal
 * comptable (`/accountingEntries`). Liste descendante par date, chaque ligne
 * dépliable montrant ses lignes débit/crédit par compte (cf. docs/compta.md
 * §4). Lecture seule — aucune mutation depuis cette vue.
 */

const store = useAccountingReportsStore()

onMounted(() => {
  void store.loadAll()
})

// ---------------------------------------------------------------------------
// Formatters — CHF + dates short FR.
// ---------------------------------------------------------------------------

const CHF = new Intl.NumberFormat('fr-CH', {
  style: 'currency',
  currency: 'CHF',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const DATE_FMT = new Intl.DateTimeFormat('fr-CH', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

function formatChf(n: number): string {
  return CHF.format(n)
}

function formatDate(d: Date | null): string {
  return d ? DATE_FMT.format(d) : '—'
}

// ---------------------------------------------------------------------------
// Source label — origine de l'écriture (cf. docs/compta.md §3).
// ---------------------------------------------------------------------------

function sourceLabel(source: JournalRow['source']): string {
  switch (source) {
    case 'credit':
      return 'Crédit'
    case 'invoice':
      return 'Facture'
    case 'manual':
      return 'Manuel'
    default:
      return source
  }
}

const rows = computed<JournalRow[]>(() => store.journalRows)

/** Lignes dépliées du DataTable — keyée par `id` de l'écriture. */
const expandedRows = ref<Record<string, boolean>>({})
</script>

<template>
  <section class="p-6 space-y-4">
    <!-- ================= Page heading =================== -->
    <div class="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-[22px] font-semibold tracking-tight">
          Journal comptable
        </h1>
        <p class="text-[13px] text-surface-500 mt-0.5">
          Historique chronologique des écritures — contre-passations incluses.
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

    <!-- ================= Table =================== -->
    <div class="card overflow-hidden">
      <DataTable
        v-model:expanded-rows="expandedRows"
        :value="rows"
        data-key="id"
        :loading="store.loading"
        class="text-[13px]"
        responsive-layout="scroll"
      >
        <template #empty>
          <div
            v-if="!store.loading"
            class="px-3 py-10 text-center flex flex-col items-center gap-2"
          >
            <span
              class="w-10 h-10 rounded-full bg-surface-100 inline-flex items-center justify-center text-surface-500"
            >
              <BookOpen
                :size="18"
                :stroke-width="2"
              />
            </span>
            <div class="text-[14px] font-semibold">
              Aucune écriture
            </div>
            <div class="text-[12px] text-surface-500 max-w-md">
              {{
                store.isEmpty
                  ? 'Le journal est vide — aucune écriture comptable enregistrée.'
                  : 'Aucune écriture sur la période sélectionnée.'
              }}
            </div>
          </div>
        </template>

        <Column
          expander
          style="width: 3rem"
        />
        <Column
          header="Date"
          style="width: 9rem"
        >
          <template #body="{ data }">
            <span class="num">{{ formatDate(data.date) }}</span>
          </template>
        </Column>
        <Column header="Libellé">
          <template #body="{ data }">
            <div class="flex items-center gap-2">
              <span class="font-medium">{{ data.label }}</span>
              <Tag
                v-if="data.reversed"
                severity="warn"
                value="Contre-passée"
              />
              <Tag
                v-if="data.reversalOfEntryId"
                severity="info"
                value="Contre-passation"
              />
            </div>
          </template>
        </Column>
        <Column
          header="Source"
          style="width: 8rem"
        >
          <template #body="{ data }">
            <span class="text-[12px] text-surface-600">
              {{ sourceLabel(data.source) }}
            </span>
          </template>
        </Column>
        <Column
          header="Référence"
          style="width: 10rem"
        >
          <template #body="{ data }">
            <span class="text-[12px] text-surface-500">
              {{ data.reference || '—' }}
            </span>
          </template>
        </Column>
        <Column
          header="Montant"
          style="width: 9rem"
        >
          <template #body="{ data }">
            <span class="num font-semibold tabular-nums">
              {{ formatChf(data.total) }}
            </span>
          </template>
        </Column>

        <!-- Row expansion : lignes débit / crédit de l'écriture -->
        <template #expansion="{ data }">
          <div class="px-4 py-3 bg-surface-50">
            <div
              class="flex items-center gap-1.5 text-[12px] font-medium text-surface-500 mb-2"
            >
              <ScrollText
                :size="13"
                :stroke-width="2"
              />
              Lignes de l'écriture
            </div>
            <table class="w-full text-[12px]">
              <thead>
                <tr class="text-surface-500 text-left">
                  <th class="py-1 font-medium">
                    Compte
                  </th>
                  <th class="py-1 font-medium text-right w-32">
                    Débit
                  </th>
                  <th class="py-1 font-medium text-right w-32">
                    Crédit
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(line, idx) in data.lines"
                  :key="`${data.id}-${idx}`"
                  class="border-t border-surface-200"
                >
                  <td class="py-1.5">
                    <span class="num text-surface-500">
                      {{ line.accountNumber }}
                    </span>
                    <span class="ml-2">{{ line.accountName }}</span>
                  </td>
                  <td class="py-1.5 text-right num tabular-nums">
                    {{ line.debit > 0 ? formatChf(line.debit) : '—' }}
                  </td>
                  <td class="py-1.5 text-right num tabular-nums">
                    {{ line.credit > 0 ? formatChf(line.credit) : '—' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </DataTable>
    </div>

    <p class="text-[11px] text-surface-400 flex items-center gap-1.5">
      <RotateCcw
        :size="12"
        :stroke-width="2"
      />
      Une écriture erronée s'annule par contre-passation — le journal conserve
      l'historique complet.
    </p>
  </section>
</template>
