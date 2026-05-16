<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Banknote,
  CheckCircle2,
  Clock,
  FileText,
  MinusCircle,
  Receipt,
} from 'lucide-vue-next'
import type { Component } from 'vue'
import type { CotisationStatus } from '@club-app/shared-types'
import type { DueRecord } from '@/repositories/dues.repo'
import { useDuesStore } from '@/stores/dues'

/**
 * Écran "Mes factures" — liste TOUTES les cotisations du parent (courantes
 * ET passées) dans une seule liste unifiée, triée par date de la cotisation
 * décroissante (la plus récente en tête).
 *
 * Navigation : Home → « Mes factures » (menu header) → cet écran.
 *
 * Plus de sections séparées COURANTES / PASSÉES : une seule liste plate
 * couvrant les 6 statuts de `CotisationStatus`. La liste triée est exposée
 * par le store (`allMyDuesSorted`) — la vue ne trie rien elle-même.
 *
 * Par ligne :
 *  - nom du membre concerné (via le store),
 *  - indicateur de statut (icône + libellé court),
 *  - montant CHF,
 *  - bouton "Facture" TOUJOURS (route `facture`),
 *  - bouton "Payer" UNIQUEMENT pour les statuts actifs (route
 *    `payment-instructions`).
 *
 * Aucun appel Firebase direct ici (architecture en couches) — uniquement
 * le store `useDuesStore`.
 */

const router = useRouter()
const dues = useDuesStore()

/** Statuts "actifs" — appellent une action de paiement (bouton "Payer"). */
const ACTIVE_STATUSES: readonly CotisationStatus[] = [
  'pending_grace',
  'issued',
  'overdue',
]

function isActive(status: CotisationStatus): boolean {
  return ACTIVE_STATUSES.includes(status)
}

const isLoading = ref(true)

/**
 * Erreur de chargement des cotisations. `loadMyDues` capture toute exception
 * Firestore (rules denied, index manquant, réseau) et la pose dans
 * `dues.error` au lieu de propager. Sans ce binding, la vue tombait
 * silencieusement sur l'empty-state « Aucune facture » — masquant l'échec
 * réel. On l'expose dans un bandeau d'erreur (modèle : `loadError` de Home.vue).
 */
const loadError = computed(() => dues.error)

onMounted(async () => {
  isLoading.value = true
  try {
    await dues.loadMyDues()
  } finally {
    isLoading.value = false
  }
})

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

interface StatusVisual {
  /** Icône lucide à afficher dans l'indicateur. */
  icon: Component
  /** Classe de pastille (couleur). */
  pillClass: string
  /** Libellé court affiché à côté de l'icône. */
  label: string
}

/**
 * Mappe un `CotisationStatus` vers son indicateur visuel (icône + libellé).
 * `switch` exhaustif sans `default` → TS strict garantit qu'un nouveau
 * statut casse la compilation tant qu'il n'est pas géré ici.
 *
 * Regroupements demandés :
 *  - « En attente de paiement » : `issued` ET `pending_grace`
 *  - « En retard » : `overdue`
 *  - « Payée » : `paid`
 *  - « Annulée » : `cancelled`
 *  - « Exceptée » : `excepted`
 */
function statusVisual(status: CotisationStatus): StatusVisual {
  switch (status) {
    case 'paid':
      return { icon: CheckCircle2, pillClass: 'pill-emerald', label: 'Payée' }
    case 'overdue':
      return { icon: AlertTriangle, pillClass: 'pill-rose', label: 'En retard' }
    case 'issued':
    case 'pending_grace':
      return {
        icon: Clock,
        pillClass: 'pill-amber',
        label: 'En attente de paiement',
      }
    case 'cancelled':
      return { icon: Ban, pillClass: 'pill-slate', label: 'Annulée' }
    case 'excepted':
      return { icon: MinusCircle, pillClass: 'pill-slate', label: 'Exceptée' }
  }
}

// ---------------------------------------------------------------------------
// Amount formatter
// ---------------------------------------------------------------------------

const amountFmt = new Intl.NumberFormat('fr-CH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * Montant affiché en CHF. Pour une cotisation payée on privilégie le montant
 * effectivement encaissé (`paidAmount`, qui peut être partiel — cf. règle
 * "montant partiel = comité only") ; sinon le montant dû (`amount`).
 */
function formatAmount(d: DueRecord): string {
  const value = d.status === 'paid' ? (d.paidAmount ?? d.amount) : d.amount
  return amountFmt.format(value)
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function onBack(): void {
  void router.push({ name: 'home' })
}

function onPay(d: DueRecord): void {
  void router.push({ name: 'payment-instructions', params: { dueId: d.id } })
}

function onViewFacture(d: DueRecord): void {
  void router.push({ name: 'facture', params: { dueId: d.id } })
}
</script>

<template>
  <div class="m-app">
    <!-- Header -->
    <div class="m-header fac__header">
      <button
        type="button"
        class="fac__back"
        aria-label="Retour à mes inscriptions"
        @click="onBack"
      >
        <ArrowLeft :size="18" />
      </button>
      <div class="header__id">
        <div class="header__name">Mes factures</div>
        <div class="header__role">Cotisations courantes et passées</div>
      </div>
    </div>

    <div class="m-content">
      <!-- Loading skeletons -->
      <template v-if="isLoading">
        <div class="facs__sk-label sk sk-label" />
        <div class="card facs__card-sk">
          <div class="sk h-4 w-2/3 mb-2" />
          <div class="sk h-3 w-1/2 mb-2" />
          <div class="sk h-3 w-full" />
        </div>
        <div class="card facs__card-sk">
          <div class="sk h-4 w-1/2 mb-2" />
          <div class="sk h-3 w-3/4" />
        </div>
        <div class="card facs__card-sk">
          <div class="sk h-4 w-2/3 mb-2" />
          <div class="sk h-3 w-1/2" />
        </div>
      </template>

      <template v-else>
        <!-- Erreur de chargement (rules trop strictes, index Firestore manquant, -->
        <!-- réseau). L'utilisateur ne peut pas corriger ça lui-même : on l'informe -->
        <!-- pour qu'il contacte le club. L'erreur est aussi loggée en console par -->
        <!-- le store (catch enrichi). Sans ce bandeau, l'écran tombait sur -->
        <!-- l'empty-state « Aucune facture » et masquait l'échec réel. -->
        <div
          v-if="loadError"
          class="banner banner-strong facs__error"
          role="alert"
        >
          <AlertTriangle :size="16" class="banner-icon" />
          <div>
            <div class="facs__error-title">
              Impossible de charger vos factures.
            </div>
            <div class="facs__error-desc">
              Index Firestore manquant ou rules à déployer — contactez le club si le problème persiste.
            </div>
          </div>
        </div>

        <!-- Empty state — masqué en cas d'erreur de chargement (le bandeau -->
        <!-- d'erreur ci-dessus le remplace alors). -->
        <div
          v-if="!loadError && !dues.hasAnyDues"
          class="facs__empty"
        >
          <Receipt :size="36" class="facs__empty-icon" />
          <div class="facs__empty-title">Aucune facture pour le moment</div>
          <p class="facs__empty-desc">
            Vos cotisations apparaîtront ici dès que votre inscription sera confirmée par le club.
          </p>
        </div>

        <!-- Liste unifiée — toutes les cotisations, tous statuts confondus, -->
        <!-- triées par date de cotisation décroissante (store). -->
        <template v-if="dues.hasAnyDues">
          <div class="home__label facs__label">
            MES COTISATIONS · {{ dues.allMyDuesSorted.length }}
          </div>

          <div
            v-for="d in dues.allMyDuesSorted"
            :key="d.id"
            class="card facs__card"
            :class="{
              'facs__card--late': d.status === 'overdue',
              'facs__card--issued': d.status === 'issued',
              'facs__card--muted': !isActive(d.status),
            }"
          >
            <div class="facs__card-head">
              <div class="facs__card-id">
                <div class="facs__card-name">{{ dues.memberNameForDue(d.id) ?? 'Membre' }}</div>
              </div>
              <span
                class="pill facs__status"
                :class="statusVisual(d.status).pillClass"
              >
                <component :is="statusVisual(d.status).icon" :size="13" />
                <span>{{ statusVisual(d.status).label }}</span>
              </span>
            </div>

            <div class="facs__amount-row">
              <div class="facs__amount">
                <span class="facs__amount-value">{{ formatAmount(d) }}</span>
                <span class="facs__amount-ccy">CHF</span>
              </div>
            </div>

            <div class="facs__actions">
              <button
                v-if="isActive(d.status)"
                type="button"
                class="btn btn-primary btn-sm facs__btn-pay"
                @click="onPay(d)"
              >
                <Banknote :size="14" /> Payer
              </button>
              <button
                type="button"
                class="btn btn-secondary btn-sm facs__btn-facture"
                :class="{ 'facs__btn-facture--only': !isActive(d.status) }"
                @click="onViewFacture(d)"
              >
                <FileText :size="14" /> Facture
              </button>
            </div>
          </div>
        </template>
      </template>
    </div>

    <div class="m-bottom">
      <button
        type="button"
        class="btn btn-secondary btn-block"
        @click="onBack"
      >
        <ArrowLeft :size="14" /> Retour à mes inscriptions
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Header */
.fac__header {
  display: flex;
  align-items: center;
  gap: 12px;
}
.fac__back {
  background: transparent;
  border: none;
  padding: 6px;
  cursor: pointer;
  color: #0f172a;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.fac__back:hover {
  background: #f1f5f9;
}
.header__id {
  line-height: 1.2;
}
.header__name {
  font-size: 12.5px;
  font-weight: 600;
  color: #0f172a;
}
.header__role {
  font-size: 10.5px;
  color: #64748b;
}

/* Labels de section */
.home__label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: #64748b;
  letter-spacing: 0.08em;
  margin-bottom: 8px;
}
.facs__label {
  margin-top: 20px;
}

/* Skeleton */
.facs__sk-label {
  height: 11px;
  width: 30%;
  border-radius: 4px;
  margin-top: 20px;
  margin-bottom: 8px;
}
.facs__card-sk {
  padding: 14px 16px;
  margin-bottom: 12px;
}

/* Cards */
.facs__card {
  padding: 14px 16px;
  margin-bottom: 12px;
}
.facs__card--issued {
  border-color: #fcd34d;
  background: linear-gradient(180deg, #fffbeb 0%, #ffffff 70%);
}
.facs__card--late {
  border-color: #fecaca;
  background: linear-gradient(180deg, #fef2f2 0%, #ffffff 70%);
}
.facs__card--muted {
  opacity: 0.8;
}

.facs__card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.facs__card-id {
  min-width: 0;
  flex: 1 1 auto;
}
.facs__card-name {
  font-size: 13.5px;
  font-weight: 600;
  color: #0f172a;
  line-height: 1.3;
}

/* Indicateur de statut : pastille icône + libellé */
.facs__status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  flex: 0 0 auto;
}

/* Amount row */
.facs__amount-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
}
.facs__amount {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
}
.facs__amount-value {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: #0f172a;
}
.facs__amount-ccy {
  font-size: 12px;
  color: #64748b;
  font-weight: 500;
}

/* Actions */
.facs__actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}
.facs__btn-pay {
  flex: 1 1 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.facs__btn-facture {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
/* Seul bouton de la ligne (cotisation soldée) → prend toute la largeur. */
.facs__btn-facture--only {
  flex: 1 1 auto;
}

/* Erreur de chargement */
.facs__error {
  margin-top: 4px;
  align-items: flex-start;
}
.facs__error-title {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
}
.facs__error-desc {
  font-size: 12px;
  margin-top: 4px;
  line-height: 1.5;
  opacity: 0.85;
}

/* Empty state */
.facs__empty {
  text-align: center;
  padding: 40px 0 0;
}
.facs__empty-icon {
  color: #94a3b8;
  margin: 0 auto 12px;
  display: block;
}
.facs__empty-title {
  font-size: 14.5px;
  font-weight: 600;
  color: #0f172a;
  margin-bottom: 8px;
}
.facs__empty-desc {
  font-size: 12.5px;
  color: #64748b;
  margin: 0 12px;
  line-height: 1.6;
}

/* Skeleton helpers */
.sk-label {
  display: block;
}
.h-3 {
  height: 12px;
}
.h-4 {
  height: 16px;
}
.w-1\/2 {
  width: 50%;
}
.w-2\/3 {
  width: 66.6667%;
}
.w-3\/4 {
  width: 75%;
}
.w-full {
  width: 100%;
}
.mb-2 {
  margin-bottom: 8px;
}
</style>
