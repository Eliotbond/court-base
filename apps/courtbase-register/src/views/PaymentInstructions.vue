<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  CalendarClock,
  Check,
  CheckCircle2,
  CircleSlash,
  ClipboardCopy,
  Info,
} from 'lucide-vue-next'
import { useClubStore } from '@/stores/club'
import { useDuesStore } from '@/stores/dues'

/**
 * Écran "Payer ma cotisation" — accessible via `/payment/:dueId`.
 *
 * Affiche :
 *  - Le montant exact à virer (CHF).
 *  - Les coordonnées bancaires du club (IBAN, BIC, banque, bénéficiaire).
 *  - La référence à indiquer dans le virement (champ `paymentReference` de
 *    la cotisation, posé par `initiateDuesOnPlayerActivation`). Si absent
 *    (lignes legacy), fallback sur l'id de la cotisation (préfixé `DUE-` —
 *    historique, voir TODO §rename).
 *  - Le texte libre `paymentInstructions` du club (ex. "Indiquer nom +
 *    prénom joueur en référence").
 *  - Une carte "Que se passe-t-il ensuite ?" expliquant le flow.
 *
 * États non-actionables (la route reste accessible via lien partagé) :
 *  - `paid` → banner positif "Cotisation déjà payée" + lien retour.
 *  - `cancelled` → banner info "Cotisation annulée" + lien retour.
 *  - `excepted` → banner info "Cotisation suspendue" + lien retour.
 *
 * États d'erreur :
 *  - Cotisation introuvable / non lisible → message "Cotisation introuvable".
 *  - Banking pas encore configurée par l'admin → message "contactez le club".
 */

const route = useRoute()
const router = useRouter()
const club = useClubStore()
const dues = useDuesStore()

const dueId = computed(() => {
  const id = route.params.dueId
  return Array.isArray(id) ? (id[0] ?? '') : (id ?? '')
})

const isLoading = ref(true)
const due = ref<Awaited<ReturnType<typeof dues.loadDue>>>(null)
const copiedField = ref<string | null>(null)
let copyResetTimer: ReturnType<typeof setTimeout> | null = null

onMounted(async () => {
  isLoading.value = true
  try {
    await club.load()
    if (dueId.value) {
      due.value = await dues.loadDue(dueId.value)
    }
  } finally {
    isLoading.value = false
  }
})

// ---------------------------------------------------------------------------
// Computed display values
// ---------------------------------------------------------------------------

const banking = computed(() => club.banking)
const hasUsableBanking = computed(() => club.hasUsableBanking)

const formattedAmount = computed(() => {
  const amount = due.value?.amount ?? 0
  return new Intl.NumberFormat('fr-CH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
})

const formattedIban = computed(() => {
  const iban = banking.value?.iban ?? ''
  // IBAN en groupes de 4 (lisibilité). On retire tout espace existant d'abord.
  return iban.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim()
})

/**
 * Référence de paiement à indiquer dans le virement. Le champ
 * `paymentReference` est ajouté sur le doc `/dues/{id}` par le subagent
 * banking ; tant qu'il n'est pas disponible, on fallback sur un identifiant
 * dérivé de l'id du due (`DUE-<8 premiers chars>`) — pas idéal mais évite un
 * écran vide.
 */
const paymentReference = computed(() => {
  const dueData = due.value as (typeof due.value & { paymentReference?: string | null }) | null
  const ref_ = dueData?.paymentReference
  if (ref_ && ref_.length > 0) return ref_
  if (!due.value) return ''
  return `DUE-${due.value.id.slice(0, 8).toUpperCase()}`
})

/**
 * Date limite de paiement (`dueAt`) en JS Date, ou `null` si :
 *  - le due n'est pas encore chargé,
 *  - le due est encore en `pending_grace` (dueAt posé seulement à la transition
 *    vers `issued`).
 */
const dueAtDate = computed<Date | null>(() => {
  const ts = due.value?.dueAt
  if (!ts) return null
  return new Date(ts.seconds * 1000)
})

const formattedDueAt = computed(() => {
  const d = dueAtDate.value
  if (!d) return ''
  return new Intl.DateTimeFormat('fr-CH', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(d)
})

/**
 * Délai relatif sous forme "Encore X jour(s)" / "Aujourd'hui" / "En retard
 * depuis X jour(s)". Calculé sur la base du jour calendaire (heures ignorées)
 * pour éviter qu'un paiement attendu "demain" affiche "Aujourd'hui" à 23h59.
 */
const dueRelative = computed<{ label: string; tone: 'ok' | 'today' | 'late' } | null>(() => {
  const d = dueAtDate.value
  if (!d) return null
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffMs = startOfDay(d) - startOfDay(new Date())
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays > 0) {
    return {
      label: diffDays === 1 ? 'Encore 1 jour' : `Encore ${diffDays} jours`,
      tone: 'ok',
    }
  }
  if (diffDays === 0) return { label: "Aujourd'hui", tone: 'today' }
  const late = Math.abs(diffDays)
  return {
    label: late === 1 ? 'En retard depuis 1 jour' : `En retard depuis ${late} jours`,
    tone: 'late',
  }
})

const showNotFound = computed(
  () => !isLoading.value && due.value === null,
)
const showNoBanking = computed(
  () => !isLoading.value &&
    due.value !== null &&
    isActionable.value &&
    !hasUsableBanking.value,
)

/**
 * État non-actionable : la cotisation est déjà payée, annulée, ou suspendue
 * (exception accordée). On évite d'afficher les coordonnées bancaires pour
 * ne pas inciter à un virement inutile.
 */
const isPaid = computed(() => due.value?.status === 'paid')
const isCancelled = computed(() => due.value?.status === 'cancelled')
const isExcepted = computed(() => due.value?.status === 'excepted')
const isActionable = computed(
  () => !isPaid.value && !isCancelled.value && !isExcepted.value,
)
const showNonActionable = computed(
  () => !isLoading.value && due.value !== null && !isActionable.value,
)

// ---------------------------------------------------------------------------
// Reçu (état `paid`)
// ---------------------------------------------------------------------------

/**
 * Montant effectivement encaissé (`paidAmount`). Peut différer de `amount`
 * dans le cas d'un arrangement comité (cf. `docs/main.md` §Cotisations —
 * arrangement comité). Fallback `amount` si `paidAmount` n'a pas été posé
 * (lignes legacy).
 */
const paidAmountFormatted = computed(() => {
  const value = due.value?.paidAmount ?? due.value?.amount ?? 0
  return new Intl.NumberFormat('fr-CH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
})

/** `true` si le montant versé est inférieur au montant attendu (arrangement comité). */
const isPartialPayment = computed(() => {
  const expected = due.value?.amount ?? 0
  const paid = due.value?.paidAmount
  return typeof paid === 'number' && paid < expected
})

const paidAtDate = computed<Date | null>(() => {
  const ts = due.value?.paidAt
  if (!ts) return null
  return new Date(ts.seconds * 1000)
})

const formattedPaidAt = computed(() => {
  const d = paidAtDate.value
  if (!d) return ''
  return new Intl.DateTimeFormat('fr-CH', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(d)
})

/** Libellé FR de la méthode de paiement enregistrée par le trésorier. */
const paymentMethodLabel = computed<string | null>(() => {
  switch (due.value?.paymentMethod) {
    case 'transfer':
      return 'Virement bancaire'
    case 'cash':
      return 'Espèces'
    case 'other':
      return 'Autre'
    case null:
    case undefined:
    default:
      return null
  }
})

// ---------------------------------------------------------------------------
// Copy-to-clipboard
// ---------------------------------------------------------------------------

async function copyToClipboard(value: string, fieldKey: string): Promise<void> {
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
    copiedField.value = fieldKey
    if (copyResetTimer) clearTimeout(copyResetTimer)
    copyResetTimer = setTimeout(() => {
      copiedField.value = null
    }, 2000)
  } catch (err) {
    // Cas typique : navigateur ancien / contexte non-secure. On dégrade
    // silencieusement — le user peut sélectionner manuellement.
    console.warn('[PaymentInstructions] clipboard write failed', err)
  }
}

function onBack(): void {
  void router.push({ name: 'home' })
}
</script>

<template>
  <div class="m-app">
    <div class="m-header pay__header">
      <button
        type="button"
        class="pay__back"
        aria-label="Retour à mes inscriptions"
        @click="onBack"
      >
        <ArrowLeft :size="18" />
      </button>
      <div class="header__id">
        <div class="header__name">Payer ma cotisation</div>
        <div class="header__role">Virement bancaire</div>
      </div>
    </div>

    <div class="m-content">
      <!-- Loading -->
      <template v-if="isLoading">
        <div class="card pay__card">
          <div class="sk h-4 w-2/3 mb-2" />
          <div class="sk h-3 w-1/2" />
        </div>
        <div class="card pay__card">
          <div class="sk h-4 w-1/2 mb-2" />
          <div class="sk h-3 w-full mb-2" />
          <div class="sk h-3 w-3/4" />
        </div>
      </template>

      <!-- Cotisation introuvable -->
      <template v-else-if="showNotFound">
        <div class="banner banner-strong pay__error" role="alert">
          <AlertTriangle :size="16" class="banner-icon" />
          <div>
            <div class="pay__error-title">Cotisation introuvable</div>
            <div class="pay__error-desc">
              Cette cotisation n'existe pas ou vous n'y avez pas accès. Contactez le club si le problème persiste.
            </div>
          </div>
        </div>
      </template>

      <!-- Cotisation déjà résolue (payée, annulée, exception accordée) -->
      <template v-else-if="showNonActionable">
        <template v-if="isPaid">
          <div
            class="banner banner-success pay__settled"
            role="status"
          >
            <CheckCircle2 :size="18" class="banner-icon" />
            <div>
              <div class="pay__settled-title">Cotisation payée</div>
              <div class="pay__settled-desc">
                Merci&nbsp;! Le club a bien enregistré votre paiement. Vous n'avez rien d'autre à faire.
              </div>
            </div>
          </div>

          <!-- Reçu : récap montant + date + méthode. Affiché même si le détail
               est partiel (paidAt manquant sur lignes legacy) — on cache les
               champs absents au cas par cas. -->
          <div class="card pay__receipt">
            <div class="pay__card-title">
              <CheckCircle2 :size="16" /> Reçu
            </div>

            <div class="pay__row">
              <div class="pay__row-label">Montant versé</div>
              <div class="pay__row-value pay__row-value--strong">
                {{ paidAmountFormatted }} CHF
              </div>
            </div>

            <div
              v-if="isPartialPayment"
              class="pay__row pay__row--note"
            >
              <Info :size="13" />
              <span>
                Montant inférieur au tarif&nbsp;: arrangement validé par le comité.
              </span>
            </div>

            <div
              v-if="formattedPaidAt"
              class="pay__row"
            >
              <div class="pay__row-label">Date de paiement</div>
              <div class="pay__row-value pay__row-value--strong">
                {{ formattedPaidAt }}
              </div>
            </div>

            <div
              v-if="paymentMethodLabel"
              class="pay__row"
            >
              <div class="pay__row-label">Méthode</div>
              <div class="pay__row-value">{{ paymentMethodLabel }}</div>
            </div>

            <div
              v-if="paymentReference"
              class="pay__row"
            >
              <div class="pay__row-label">Référence</div>
              <div class="pay__row-value pay__row-value--mono">
                {{ paymentReference }}
              </div>
            </div>
          </div>
        </template>
        <div
          v-else-if="isCancelled"
          class="banner banner-info pay__settled"
          role="status"
        >
          <CircleSlash :size="18" class="banner-icon" />
          <div>
            <div class="pay__settled-title">Cotisation annulée</div>
            <div class="pay__settled-desc">
              Cette cotisation a été annulée par le club&nbsp;: il n'y a aucun virement à effectuer. Contactez le club pour plus de détails.
            </div>
          </div>
        </div>
        <div
          v-else
          class="banner banner-info pay__settled"
          role="status"
        >
          <Info :size="18" class="banner-icon" />
          <div>
            <div class="pay__settled-title">Cotisation suspendue</div>
            <div class="pay__settled-desc">
              Une exception de paiement a été accordée par le club&nbsp;: aucun virement n'est attendu pour l'instant.
            </div>
          </div>
        </div>
      </template>

      <!-- Pas de banking configuré -->
      <template v-else-if="showNoBanking">
        <!-- Carte montant : on l'affiche quand même, c'est l'info la plus utile -->
        <div class="card pay__amount-card">
          <div class="pay__amount-label">Montant à payer</div>
          <div class="pay__amount">
            {{ formattedAmount }} <span class="pay__amount-ccy">CHF</span>
          </div>
        </div>
        <div class="banner banner-strong pay__error" role="alert">
          <AlertTriangle :size="16" class="banner-icon" />
          <div>
            <div class="pay__error-title">Coordonnées bancaires non configurées</div>
            <div class="pay__error-desc">
              Le club n'a pas encore configuré ses coordonnées bancaires. Contactez l'administrateur pour obtenir les instructions de paiement.
            </div>
          </div>
        </div>
      </template>

      <!-- Cas nominal : cotisation actionable + banking OK -->
      <template v-else-if="due && banking && isActionable">
        <!-- Montant -->
        <div class="card pay__amount-card">
          <div class="pay__amount-label">Montant à payer</div>
          <div class="pay__amount">
            {{ formattedAmount }} <span class="pay__amount-ccy">CHF</span>
          </div>
          <div class="pay__amount-sub">
            Cotisation de la saison
          </div>
        </div>

        <!-- Délai -->
        <div
          v-if="dueAtDate"
          class="card pay__due-card"
          :class="{
            'pay__due-card--today': dueRelative?.tone === 'today',
            'pay__due-card--late': dueRelative?.tone === 'late',
          }"
        >
          <div class="pay__due-head">
            <CalendarClock :size="16" /> À payer avant le
          </div>
          <div class="pay__due-date">{{ formattedDueAt }}</div>
          <div
            v-if="dueRelative"
            class="pay__due-rel"
            :class="{
              'pay__due-rel--today': dueRelative.tone === 'today',
              'pay__due-rel--late': dueRelative.tone === 'late',
            }"
          >
            {{ dueRelative.label }}
          </div>
        </div>

        <!-- Coordonnées bancaires -->
        <div class="card pay__card">
          <div class="pay__card-title">
            <Banknote :size="16" /> Coordonnées du virement
          </div>

          <div class="pay__row">
            <div class="pay__row-label">Bénéficiaire</div>
            <div class="pay__row-value">{{ banking.accountHolder }}</div>
          </div>

          <div class="pay__row">
            <div class="pay__row-label">IBAN</div>
            <div class="pay__row-value pay__row-value--mono">
              {{ formattedIban }}
            </div>
            <button
              type="button"
              class="btn btn-ghost btn-sm pay__copy"
              :aria-label="`Copier l'IBAN`"
              @click="copyToClipboard(banking.iban ?? '', 'iban')"
            >
              <Check v-if="copiedField === 'iban'" :size="14" />
              <ClipboardCopy v-else :size="14" />
              {{ copiedField === 'iban' ? 'Copié' : 'Copier' }}
            </button>
          </div>

          <div v-if="banking.bic" class="pay__row">
            <div class="pay__row-label">BIC / SWIFT</div>
            <div class="pay__row-value pay__row-value--mono">{{ banking.bic }}</div>
          </div>

          <div v-if="banking.bankName" class="pay__row">
            <div class="pay__row-label">Banque</div>
            <div class="pay__row-value">{{ banking.bankName }}</div>
          </div>

          <div class="pay__row">
            <div class="pay__row-label">Montant exact</div>
            <div class="pay__row-value pay__row-value--strong">
              {{ formattedAmount }} CHF
            </div>
          </div>
        </div>

        <!-- Référence à indiquer -->
        <div class="card pay__card pay__card--ref">
          <div class="pay__card-title">Référence à indiquer</div>
          <p class="pay__ref-helper">
            Indiquez impérativement cette référence dans le message du virement pour que le club puisse identifier votre paiement.
          </p>
          <div class="pay__ref-block">
            <code class="pay__ref-code">{{ paymentReference }}</code>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              :aria-label="`Copier la référence`"
              @click="copyToClipboard(paymentReference, 'ref')"
            >
              <Check v-if="copiedField === 'ref'" :size="14" />
              <ClipboardCopy v-else :size="14" />
              {{ copiedField === 'ref' ? 'Copié' : 'Copier' }}
            </button>
          </div>
          <p
            v-if="banking.paymentInstructions"
            class="pay__ref-instructions"
          >
            {{ banking.paymentInstructions }}
          </p>
        </div>

        <!-- Que se passe-t-il ensuite -->
        <div class="card pay__card pay__card--next">
          <div class="pay__card-title">
            <Info :size="16" /> Que se passe-t-il ensuite ?
          </div>
          <ol class="pay__steps">
            <li>
              Effectuez le virement depuis votre e-banking avec les coordonnées
              ci-dessus.
            </li>
            <li>
              Le trésorier du club marquera votre cotisation comme payée
              dès réception du virement (généralement sous 2 à 5 jours ouvrés).
            </li>
            <li>
              Votre inscription deviendra alors <strong>active</strong> et le
              club pourra demander la licence fédérale.
            </li>
          </ol>
        </div>
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
.pay__header {
  display: flex;
  align-items: center;
  gap: 12px;
}
.pay__back {
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
.pay__back:hover {
  background: #f1f5f9;
}

.pay__amount-card {
  margin-top: 16px;
  padding: 20px;
  text-align: center;
  background: linear-gradient(180deg, #ecfdf5 0%, #ffffff 80%);
  border-color: #a7f3d0;
}
.pay__amount-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: #047857;
  text-transform: uppercase;
}
.pay__amount {
  margin-top: 6px;
  font-size: 32px;
  font-weight: 600;
  color: #064e3b;
  letter-spacing: -0.02em;
}
.pay__amount-ccy {
  font-size: 18px;
  color: #047857;
  font-weight: 500;
}
.pay__amount-sub {
  margin-top: 4px;
  font-size: 12px;
  color: #047857;
}

.pay__due-card {
  margin-top: 12px;
  padding: 14px 16px;
  border-color: #e2e8f0;
  background: #ffffff;
}
.pay__due-card--today {
  border-color: #fcd34d;
  background: linear-gradient(180deg, #fffbeb 0%, #ffffff 80%);
}
.pay__due-card--late {
  border-color: #fecaca;
  background: linear-gradient(180deg, #fef2f2 0%, #ffffff 80%);
}
.pay__due-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #64748b;
}
.pay__due-date {
  margin-top: 4px;
  font-size: 15px;
  font-weight: 600;
  color: #0f172a;
  text-transform: capitalize;
}
.pay__due-rel {
  margin-top: 4px;
  font-size: 12px;
  color: #475569;
}
.pay__due-rel--today {
  color: #92400e;
  font-weight: 600;
}
.pay__due-rel--late {
  color: #b91c1c;
  font-weight: 600;
}

.pay__card {
  margin-top: 16px;
  padding: 16px;
}
.pay__card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  margin-bottom: 12px;
}

.pay__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid #f1f5f9;
}
.pay__row:first-of-type {
  border-top: none;
  padding-top: 0;
}
.pay__row-label {
  font-size: 12px;
  color: #64748b;
  flex: 0 0 auto;
}
.pay__row-value {
  flex: 1 1 auto;
  font-size: 13px;
  color: #0f172a;
  text-align: right;
  word-break: break-all;
}
.pay__row-value--mono {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  letter-spacing: 0.02em;
}
.pay__row-value--strong {
  font-weight: 600;
}
.pay__copy {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.pay__card--ref {
  border-color: #fcd34d;
  background: linear-gradient(180deg, #fffbeb 0%, #ffffff 80%);
}
.pay__ref-helper {
  margin: 0 0 12px 0;
  font-size: 12px;
  color: #78350f;
  line-height: 1.5;
}
.pay__ref-block {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #fef3c7;
  border: 1px solid #fcd34d;
  border-radius: 8px;
  padding: 10px 12px;
}
.pay__ref-code {
  flex: 1 1 auto;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 14px;
  font-weight: 600;
  color: #78350f;
  letter-spacing: 0.04em;
  word-break: break-all;
  background: transparent;
}
.pay__ref-instructions {
  margin: 12px 0 0 0;
  font-size: 12px;
  color: #475569;
  line-height: 1.5;
  white-space: pre-wrap;
}

.pay__card--next {
  background: #f8fafc;
  border-color: #e2e8f0;
}
.pay__steps {
  margin: 0;
  padding-left: 18px;
  font-size: 12.5px;
  color: #334155;
  line-height: 1.7;
}
.pay__steps li {
  margin-bottom: 4px;
}

.pay__error {
  margin-top: 16px;
  align-items: flex-start;
}
.pay__error-title {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
}
.pay__error-desc {
  font-size: 12px;
  margin-top: 4px;
  line-height: 1.5;
  opacity: 0.85;
}

.pay__settled {
  margin-top: 20px;
  align-items: flex-start;
}
.pay__settled-title {
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.4;
}
.pay__settled-desc {
  font-size: 12.5px;
  margin-top: 4px;
  line-height: 1.55;
  opacity: 0.9;
}

.pay__receipt {
  margin-top: 12px;
  padding: 16px;
  border-color: #a7f3d0;
  background: linear-gradient(180deg, #ecfdf5 0%, #ffffff 70%);
}
.pay__row--note {
  border-top: none;
  padding: 8px 10px;
  margin-top: 4px;
  background: #fef3c7;
  border: 1px solid #fcd34d;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #78350f;
  line-height: 1.4;
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
