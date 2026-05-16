<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { AlertCircle, Banknote, CalendarClock, FileText, Hourglass } from 'lucide-vue-next'
import type { Cotisation, CotisationStatus } from '@club-app/shared-types'
import { useDuesStore } from '@/stores/dues'

/**
 * Panneau "Mes cotisations à payer" (Home register).
 *
 * Source : `useDuesStore.myActiveDues` (chargé au mount de Home). Affiche
 * une ligne par cotisation avec :
 *  - Nom du membre concerné (via `memberNameById` du store).
 *  - Pill de statut traduit FR (À payer / En grâce / En retard).
 *  - Montant CHF + référence courte.
 *  - Date limite avec formatage relatif ("Aujourd'hui", "Dans X jours", "En retard depuis X jours").
 *  - CTA "Voir les instructions de paiement" → route `/payment/:dueId`.
 *
 * Empty-state : si pas de cotisation active, le composant ne rend RIEN
 * (la décision visuelle vit dans Home — pas de carte vide). Le parent doit
 * donc gater le rendu avec `v-if="dues.hasActiveDues"`.
 *
 * Aucun appel Firebase direct ici (architecture en couches) — uniquement
 * lecture du store.
 */

const router = useRouter()
const dues = useDuesStore()

const list = computed<Cotisation[]>(() => dues.myActiveDues)

interface DueVisual {
  pillClass: string
  label: string
}

function visual(status: CotisationStatus): DueVisual {
  switch (status) {
    case 'pending_grace':
      return { pillClass: 'pill-slate', label: 'En grâce' }
    case 'issued':
      return { pillClass: 'pill-amber', label: 'À payer' }
    case 'overdue':
      return { pillClass: 'pill-rose', label: 'En retard' }
    // Les statuts paid/cancelled/excepted ne sont pas dans `myActiveDues`,
    // mais on garde l'exhaustivité TS strict.
    case 'paid':
      return { pillClass: 'pill-emerald', label: 'Payée' }
    case 'cancelled':
      return { pillClass: 'pill-slate', label: 'Annulée' }
    case 'excepted':
      return { pillClass: 'pill-slate', label: 'Exception' }
  }
}

const amountFmt = new Intl.NumberFormat('fr-CH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * Formatage relatif court d'une date limite. Calcul au début de journée pour
 * éviter qu'un paiement attendu "demain" affiche "Aujourd'hui" à 23h59.
 */
function relativeDue(d: Cotisation): { label: string; tone: 'ok' | 'today' | 'late' } | null {
  if (!d.dueAt) return null
  const dueDate = new Date(d.dueAt.seconds * 1000)
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffMs = startOfDay(dueDate) - startOfDay(new Date())
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays > 0) {
    return { label: diffDays === 1 ? 'Demain' : `Dans ${diffDays} jours`, tone: 'ok' }
  }
  if (diffDays === 0) return { label: "Aujourd'hui", tone: 'today' }
  const late = Math.abs(diffDays)
  return {
    label: late === 1 ? 'En retard depuis 1 jour' : `En retard depuis ${late} jours`,
    tone: 'late',
  }
}

function shortRef(d: Cotisation): string {
  if (d.paymentReference && d.paymentReference.length > 0) return d.paymentReference
  return `DUE-${d.id.slice(0, 8).toUpperCase()}`
}

function memberName(d: Cotisation): string {
  return dues.memberNameForDue(d.id) ?? 'Membre'
}

function onOpen(d: Cotisation): void {
  void router.push({ name: 'payment-instructions', params: { dueId: d.id } })
}

function onOpenFacture(d: Cotisation): void {
  void router.push({ name: 'facture', params: { dueId: d.id } })
}
</script>

<template>
  <div v-if="list.length > 0" class="cot__section">
    <div class="home__label cot__label">
      MES COTISATIONS · {{ list.length }}
    </div>

    <div
      v-for="d in list"
      :key="d.id"
      class="card cot__card"
      :class="{
        'cot__card--late': d.status === 'overdue',
        'cot__card--issued': d.status === 'issued',
      }"
    >
      <div class="cot__head">
        <div class="cot__head-id">
          <div class="cot__name">{{ memberName(d) }}</div>
          <div class="cot__ref">{{ shortRef(d) }}</div>
        </div>
        <span class="pill" :class="visual(d.status).pillClass">
          {{ visual(d.status).label }}
        </span>
      </div>

      <div class="cot__amount-row">
        <div class="cot__amount">
          <span class="cot__amount-value">{{ amountFmt.format(d.amount) }}</span>
          <span class="cot__amount-ccy">CHF</span>
        </div>

        <div
          v-if="relativeDue(d)"
          class="cot__when"
          :class="{
            'cot__when--today': relativeDue(d)?.tone === 'today',
            'cot__when--late': relativeDue(d)?.tone === 'late',
          }"
        >
          <CalendarClock v-if="relativeDue(d)?.tone !== 'late'" :size="13" />
          <AlertCircle v-else :size="13" />
          <span>{{ relativeDue(d)?.label }}</span>
        </div>
        <div v-else class="cot__when cot__when--soft">
          <Hourglass :size="13" />
          <span>Période de grâce</span>
        </div>
      </div>

      <div class="cot__actions">
        <button
          type="button"
          class="btn btn-primary btn-sm cot__cta cot__cta--pay"
          @click="onOpen(d)"
        >
          <Banknote :size="14" /> Instructions de paiement
        </button>
        <button
          type="button"
          class="btn btn-secondary btn-sm cot__cta cot__cta--facture"
          @click="onOpenFacture(d)"
        >
          <FileText :size="14" /> Voir la facture
        </button>
      </div>
    </div>
    <button
      type="button"
      class="cot__all-link"
      @click="() => void router.push({ name: 'factures' })"
    >
      Voir toutes mes factures →
    </button>
  </div>
</template>

<style scoped>
.cot__section {
  display: flex;
  flex-direction: column;
}
.cot__label {
  /* Reprend `.home__label` (parent) sans override : le composant hérite via
     remontée de cascade. On ajoute juste un margin-top pour fixer le rythme
     quand le panneau est en tête d'écran. */
  margin-top: 18px;
}
.cot__card {
  padding: 14px 16px;
  margin-bottom: 12px;
}
.cot__card--issued {
  border-color: #fcd34d;
  background: linear-gradient(180deg, #fffbeb 0%, #ffffff 70%);
}
.cot__card--late {
  border-color: #fecaca;
  background: linear-gradient(180deg, #fef2f2 0%, #ffffff 70%);
}

.cot__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.cot__head-id {
  min-width: 0;
  flex: 1 1 auto;
}
.cot__name {
  font-size: 13.5px;
  font-weight: 600;
  color: #0f172a;
  line-height: 1.3;
}
.cot__ref {
  margin-top: 2px;
  font-size: 11px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  color: #64748b;
  letter-spacing: 0.02em;
}

.cot__amount-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
}
.cot__amount {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
}
.cot__amount-value {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: #0f172a;
}
.cot__amount-ccy {
  font-size: 12px;
  color: #64748b;
  font-weight: 500;
}

.cot__when {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  color: #475569;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  padding: 4px 10px;
  font-weight: 500;
}
.cot__when--today {
  color: #92400e;
  background: #fef3c7;
  border-color: #fcd34d;
}
.cot__when--late {
  color: #b91c1c;
  background: #fee2e2;
  border-color: #fecaca;
}
.cot__when--soft {
  color: #64748b;
}

.cot__actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}
.cot__cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.cot__cta--pay {
  flex: 1 1 auto;
}
.cot__cta--facture {
  flex: 0 0 auto;
}

/* Lien discret "Voir toutes mes factures →" en bas du panneau */
.cot__all-link {
  display: block;
  width: 100%;
  background: transparent;
  border: none;
  padding: 6px 0 2px;
  text-align: center;
  font-size: 12px;
  color: #64748b;
  cursor: pointer;
  font-family: inherit;
  letter-spacing: 0.01em;
}
.cot__all-link:hover {
  color: #334155;
  text-decoration: underline;
}
</style>
