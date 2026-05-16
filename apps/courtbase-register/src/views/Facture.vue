<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  Building2,
  Check,
  ClipboardCopy,
  FileText,
  Info,
} from 'lucide-vue-next'
import type { CotisationStatus } from '@club-app/shared-types'
import { useClubStore } from '@/stores/club'
import { useDuesStore } from '@/stores/dues'
import { useTeamsStore } from '@/stores/teams'

/**
 * Écran "Facture" — accessible via `/facture/:dueId`.
 *
 * Document type facture, en LECTURE SEULE, consultable par le parent À TOUT
 * MOMENT, quel que soit le statut de paiement de la cotisation (En grâce /
 * À payer / En retard / Payée / Annulée / Exceptée).
 *
 * Affiche :
 *  - En-tête club : nom + logo (via `stores/club`).
 *  - Membre/enfant concerné, équipe, saison.
 *  - Montant CHF.
 *  - Dates : activée le (`activatedAt`), émise le (`issuedAt`), échéance
 *    (`dueAt`). Les dates `null` (pas encore posées selon le lifecycle) sont
 *    simplement omises.
 *  - Pill de statut traduit FR.
 *  - Référence de virement (`paymentReference`, fallback `DUE-{8 chars}`).
 *  - Les infos de paiement : coordonnées bancaires (IBAN/BIC/bénéficiaire)
 *    + texte libre `club.paymentInstructions`, intégrées directement dans la
 *    facture (parcours fluide facture + paiement). Un CTA secondaire renvoie
 *    aussi vers `/payment/:dueId` pour l'écran de paiement détaillé.
 *
 * États (calqués sur `PaymentInstructions.vue`) :
 *  - loading → skeletons.
 *  - cotisation introuvable / non lisible → banner "Facture introuvable".
 *  - nominal → la facture, toujours rendue (la variante "reçu après paiement"
 *    reste HORS scope de cette vue — voir TODO §reçu).
 *
 * Catch enrichi : tout fetch passe par le store (`[stores/dues]`,
 * `[stores/club]`, `[stores/teams]`). La vue elle-même ne touche pas Firebase.
 */

const route = useRoute()
const router = useRouter()
const club = useClubStore()
const dues = useDuesStore()
const teams = useTeamsStore()

const dueId = computed(() => {
  const id = route.params.dueId
  return Array.isArray(id) ? (id[0] ?? '') : (id ?? '')
})

const isLoading = ref(true)
const due = ref<Awaited<ReturnType<typeof dues.loadDue>>>(null)
const memberName = ref<string | null>(null)
const teamName = ref<string | null>(null)
const copiedField = ref<string | null>(null)
let copyResetTimer: ReturnType<typeof setTimeout> | null = null

onMounted(async () => {
  isLoading.value = true
  try {
    await club.load()
    if (!dueId.value) return
    due.value = await dues.loadDue(dueId.value)
    if (!due.value) return
    // Résolution nom membre + nom équipe en parallèle. Chacun dégrade en
    // `null` si la lecture échoue (rules / doc absent) — la facture reste
    // affichable sans bloquer.
    const [name, team] = await Promise.all([
      dues.loadMemberNameForDue(dueId.value),
      teams.loadTeam(due.value.teamId),
    ])
    memberName.value = name
    teamName.value = team?.name ?? null
  } finally {
    isLoading.value = false
  }
})

// ---------------------------------------------------------------------------
// Computed display values
// ---------------------------------------------------------------------------

const banking = computed(() => club.banking)
const hasUsableBanking = computed(() => club.hasUsableBanking)
const clubName = computed(() => club.config?.name ?? 'Club')
const clubLogo = computed(() => club.config?.logo ?? null)

const formattedAmount = computed(() => {
  const amount = due.value?.amount ?? 0
  return new Intl.NumberFormat('fr-CH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
})

const formattedIban = computed(() => {
  const iban = banking.value?.iban ?? ''
  return iban.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim()
})

/**
 * Référence de virement. Champ `paymentReference` posé par
 * `initiateDuesOnPlayerActivation` ; fallback `DUE-<8 chars>` pour les lignes
 * legacy (cf. `PaymentInstructions.vue`).
 */
const paymentReference = computed(() => {
  const ref_ = due.value?.paymentReference
  if (ref_ && ref_.length > 0) return ref_
  if (!due.value) return ''
  return `DUE-${due.value.id.slice(0, 8).toUpperCase()}`
})

/** Formatage FR long d'un Timestamp Firestore (ou `''` si `null`). */
function formatDate(ts: { seconds: number } | null | undefined): string {
  if (!ts) return ''
  return new Intl.DateTimeFormat('fr-CH', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date(ts.seconds * 1000))
}

const formattedActivatedAt = computed(() => formatDate(due.value?.activatedAt))
const formattedIssuedAt = computed(() => formatDate(due.value?.issuedAt))
const formattedDueAt = computed(() => formatDate(due.value?.dueAt))

interface StatusVisual {
  pillClass: string
  label: string
}

/** Pill de statut traduit FR — exhaustif sur `CotisationStatus`. */
function statusVisual(status: CotisationStatus): StatusVisual {
  switch (status) {
    case 'pending_grace':
      return { pillClass: 'pill-slate', label: 'En grâce' }
    case 'issued':
      return { pillClass: 'pill-amber', label: 'À payer' }
    case 'overdue':
      return { pillClass: 'pill-rose', label: 'En retard' }
    case 'paid':
      return { pillClass: 'pill-emerald', label: 'Payée' }
    case 'cancelled':
      return { pillClass: 'pill-slate', label: 'Annulée' }
    case 'excepted':
      return { pillClass: 'pill-slate', label: 'Exceptée' }
  }
}

const statusPill = computed<StatusVisual | null>(() =>
  due.value ? statusVisual(due.value.status) : null,
)

const showNotFound = computed(() => !isLoading.value && due.value === null)

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
    // Navigateur ancien / contexte non-secure : dégradation silencieuse.
    console.warn('[views/Facture] clipboard write failed', err)
  }
}

function onBack(): void {
  void router.push({ name: 'home' })
}

function onOpenPayment(): void {
  if (!due.value) return
  void router.push({ name: 'payment-instructions', params: { dueId: due.value.id } })
}
</script>

<template>
  <div class="m-app">
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
        <div class="header__name">Facture de cotisation</div>
        <div class="header__role">Document de référence</div>
      </div>
    </div>

    <div class="m-content">
      <!-- Loading -->
      <template v-if="isLoading">
        <div class="card fac__card">
          <div class="sk h-4 w-2/3 mb-2" />
          <div class="sk h-3 w-1/2" />
        </div>
        <div class="card fac__card">
          <div class="sk h-4 w-1/2 mb-2" />
          <div class="sk h-3 w-full mb-2" />
          <div class="sk h-3 w-3/4" />
        </div>
      </template>

      <!-- Facture introuvable -->
      <template v-else-if="showNotFound">
        <div class="banner banner-strong fac__error" role="alert">
          <AlertTriangle :size="16" class="banner-icon" />
          <div>
            <div class="fac__error-title">Facture introuvable</div>
            <div class="fac__error-desc">
              Cette cotisation n'existe pas ou vous n'y avez pas accès. Contactez le club si le problème persiste.
            </div>
          </div>
        </div>
      </template>

      <!-- Facture -->
      <template v-else-if="due">
        <!-- En-tête club + titre facture -->
        <div class="card fac__doc-head">
          <div class="fac__club">
            <img
              v-if="clubLogo"
              :src="clubLogo"
              :alt="`Logo ${clubName}`"
              class="fac__club-logo"
            />
            <div v-else class="fac__club-logo fac__club-logo--placeholder">
              <Building2 :size="20" />
            </div>
            <div class="fac__club-id">
              <div class="fac__club-name">{{ clubName }}</div>
              <div class="fac__club-sub">Cotisation annuelle</div>
            </div>
          </div>
          <div class="fac__doc-title-row">
            <div class="fac__doc-title">
              <FileText :size="15" /> Facture
            </div>
            <span
              v-if="statusPill"
              class="pill"
              :class="statusPill.pillClass"
            >
              {{ statusPill.label }}
            </span>
          </div>
          <div class="fac__doc-ref">
            Référence&nbsp;: <code>{{ paymentReference }}</code>
          </div>
        </div>

        <!-- Détail facturé : membre / équipe / saison -->
        <div class="card fac__card">
          <div class="fac__card-title">Détail</div>

          <div class="fac__row">
            <div class="fac__row-label">Membre</div>
            <div class="fac__row-value fac__row-value--strong">
              {{ memberName ?? 'Membre du club' }}
            </div>
          </div>

          <div v-if="teamName" class="fac__row">
            <div class="fac__row-label">Équipe</div>
            <div class="fac__row-value">{{ teamName }}</div>
          </div>

          <div class="fac__row">
            <div class="fac__row-label">Saison</div>
            <div class="fac__row-value">{{ due.seasonId }}</div>
          </div>
        </div>

        <!-- Montant -->
        <div class="card fac__amount-card">
          <div class="fac__amount-label">Montant de la cotisation</div>
          <div class="fac__amount">
            {{ formattedAmount }} <span class="fac__amount-ccy">CHF</span>
          </div>
        </div>

        <!-- Dates -->
        <div class="card fac__card">
          <div class="fac__card-title">Dates</div>

          <div v-if="formattedActivatedAt" class="fac__row">
            <div class="fac__row-label">Activée le</div>
            <div class="fac__row-value">{{ formattedActivatedAt }}</div>
          </div>

          <div v-if="formattedIssuedAt" class="fac__row">
            <div class="fac__row-label">Émise le</div>
            <div class="fac__row-value">{{ formattedIssuedAt }}</div>
          </div>

          <div v-if="formattedDueAt" class="fac__row">
            <div class="fac__row-label">Échéance</div>
            <div class="fac__row-value fac__row-value--strong">
              {{ formattedDueAt }}
            </div>
          </div>

          <p
            v-if="!formattedDueAt"
            class="fac__row-note"
          >
            <Info :size="13" />
            <span>
              La date d'échéance sera fixée lorsque la cotisation passera en phase de paiement.
            </span>
          </p>
        </div>

        <!-- Infos de paiement -->
        <template v-if="hasUsableBanking && banking">
          <div class="card fac__card">
            <div class="fac__card-title">
              <Banknote :size="16" /> Coordonnées de paiement
            </div>

            <div class="fac__row">
              <div class="fac__row-label">Bénéficiaire</div>
              <div class="fac__row-value">{{ banking.accountHolder }}</div>
            </div>

            <div class="fac__row">
              <div class="fac__row-label">IBAN</div>
              <div class="fac__row-value fac__row-value--mono">
                {{ formattedIban }}
              </div>
              <button
                type="button"
                class="btn btn-ghost btn-sm fac__copy"
                aria-label="Copier l'IBAN"
                @click="copyToClipboard(banking.iban ?? '', 'iban')"
              >
                <Check v-if="copiedField === 'iban'" :size="14" />
                <ClipboardCopy v-else :size="14" />
                {{ copiedField === 'iban' ? 'Copié' : 'Copier' }}
              </button>
            </div>

            <div v-if="banking.bic" class="fac__row">
              <div class="fac__row-label">BIC / SWIFT</div>
              <div class="fac__row-value fac__row-value--mono">
                {{ banking.bic }}
              </div>
            </div>

            <div v-if="banking.bankName" class="fac__row">
              <div class="fac__row-label">Banque</div>
              <div class="fac__row-value">{{ banking.bankName }}</div>
            </div>

            <div class="fac__row">
              <div class="fac__row-label">Référence à indiquer</div>
              <div class="fac__row-value fac__row-value--mono">
                {{ paymentReference }}
              </div>
              <button
                type="button"
                class="btn btn-ghost btn-sm fac__copy"
                aria-label="Copier la référence"
                @click="copyToClipboard(paymentReference, 'ref')"
              >
                <Check v-if="copiedField === 'ref'" :size="14" />
                <ClipboardCopy v-else :size="14" />
                {{ copiedField === 'ref' ? 'Copié' : 'Copier' }}
              </button>
            </div>

            <p
              v-if="banking.paymentInstructions"
              class="fac__instructions"
            >
              {{ banking.paymentInstructions }}
            </p>
          </div>
        </template>

        <!-- Banking pas encore configurée -->
        <template v-else>
          <div class="banner banner-info fac__no-banking" role="status">
            <Info :size="16" class="banner-icon" />
            <div>
              <div class="fac__no-banking-title">
                Coordonnées de paiement non disponibles
              </div>
              <div class="fac__no-banking-desc">
                Le club n'a pas encore publié ses coordonnées bancaires. Contactez l'administration pour obtenir les instructions de virement.
              </div>
            </div>
          </div>
        </template>

        <!-- CTA vers l'écran de paiement détaillé -->
        <button
          type="button"
          class="btn btn-primary btn-block fac__pay-cta"
          @click="onOpenPayment"
        >
          <Banknote :size="14" /> Voir les instructions de paiement
        </button>
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

.fac__doc-head {
  margin-top: 16px;
  padding: 16px;
}
.fac__club {
  display: flex;
  align-items: center;
  gap: 10px;
}
.fac__club-logo {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  object-fit: cover;
  border: 1px solid #e2e8f0;
  background: #ffffff;
}
.fac__club-logo--placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #64748b;
  background: #f1f5f9;
}
.fac__club-id {
  line-height: 1.25;
}
.fac__club-name {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
}
.fac__club-sub {
  font-size: 11.5px;
  color: #64748b;
}
.fac__doc-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid #f1f5f9;
}
.fac__doc-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 600;
  color: #0f172a;
}
.fac__doc-ref {
  margin-top: 6px;
  font-size: 11.5px;
  color: #64748b;
}
.fac__doc-ref code {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px;
  color: #334155;
  letter-spacing: 0.02em;
}

.fac__card {
  margin-top: 12px;
  padding: 16px;
}
.fac__card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  margin-bottom: 12px;
}

.fac__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid #f1f5f9;
}
.fac__row:first-of-type {
  border-top: none;
  padding-top: 0;
}
.fac__row-label {
  font-size: 12px;
  color: #64748b;
  flex: 0 0 auto;
}
.fac__row-value {
  flex: 1 1 auto;
  font-size: 13px;
  color: #0f172a;
  text-align: right;
  word-break: break-word;
}
.fac__row-value--mono {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  letter-spacing: 0.02em;
  word-break: break-all;
}
.fac__row-value--strong {
  font-weight: 600;
}
.fac__row-note {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 8px 0 0 0;
  font-size: 12px;
  color: #475569;
  line-height: 1.5;
}
.fac__copy {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.fac__amount-card {
  margin-top: 12px;
  padding: 20px;
  text-align: center;
  background: linear-gradient(180deg, #f8fafc 0%, #ffffff 80%);
  border-color: #e2e8f0;
}
.fac__amount-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: #64748b;
  text-transform: uppercase;
}
.fac__amount {
  margin-top: 6px;
  font-size: 32px;
  font-weight: 600;
  color: #0f172a;
  letter-spacing: -0.02em;
}
.fac__amount-ccy {
  font-size: 18px;
  color: #64748b;
  font-weight: 500;
}

.fac__instructions {
  margin: 12px 0 0 0;
  font-size: 12px;
  color: #475569;
  line-height: 1.5;
  white-space: pre-wrap;
}

.fac__no-banking {
  margin-top: 12px;
  align-items: flex-start;
}
.fac__no-banking-title {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
}
.fac__no-banking-desc {
  font-size: 12px;
  margin-top: 4px;
  line-height: 1.5;
  opacity: 0.9;
}

.fac__pay-cta {
  margin-top: 16px;
}

.fac__error {
  margin-top: 16px;
  align-items: flex-start;
}
.fac__error-title {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
}
.fac__error-desc {
  font-size: 12px;
  margin-top: 4px;
  line-height: 1.5;
  opacity: 0.85;
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
