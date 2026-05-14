<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { Registration, RegistrationStatus } from '@club-app/shared-types'
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Hourglass,
  Info,
  LogOut,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useDuesStore } from '@/stores/dues'
import { useRegistrationsStore } from '@/stores/registrations'
import MyCotisationsPanel from '@/components/MyCotisationsPanel.vue'

const auth = useAuthStore()
const registrations = useRegistrationsStore()
const dues = useDuesStore()
const router = useRouter()

const menuOpen = ref(false)

const firstName = computed(() => {
  const name = auth.userDoc?.displayName ?? auth.authSnap?.displayName ?? ''
  return name.split(' ')[0] ?? ''
})

const initials = computed(() => {
  const name = auth.userDoc?.displayName ?? auth.authSnap?.displayName ?? ''
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return (parts[0]?.charAt(0) ?? '').toUpperCase()
  return (
    (parts[0]?.charAt(0) ?? '') + (parts[parts.length - 1]?.charAt(0) ?? '')
  ).toUpperCase()
})

const myList = computed(() => registrations.myList)
const isLoading = computed(() => registrations.loading)
const loadError = computed(() => registrations.error)
const hasNoRegistrations = computed(
  () => !isLoading.value && !loadError.value && myList.value.length === 0,
)

const activeList = computed(() =>
  myList.value.filter((r) => r.status !== 'cancelled'),
)
const cancelledList = computed(() =>
  myList.value.filter((r) => r.status === 'cancelled'),
)

onMounted(async () => {
  if (auth.authSnap?.uid) {
    await registrations.loadMyRegistrations(auth.authSnap.uid)
    // Charge cotisations actives + payées (un seul appel — le store
    // parallélise les deux queries Firestore). Indépendant : même si le
    // fetch dues plante, l'écran continue de fonctionner pour le reste.
    await dues.loadMyDues()
  }
})

interface StatusVisual {
  pillClass: string
  label: string
}

function statusVisual(status: RegistrationStatus): StatusVisual {
  switch (status) {
    case 'draft':
      return { pillClass: 'pill-slate', label: 'Brouillon' }
    case 'submitted':
    case 'open_pending_trial':
    case 'conditional_pending_review':
    case 'conditional_pending_trial':
      return { pillClass: 'pill-sky', label: 'En attente' }
    case 'trial_in_progress':
      return { pillClass: 'pill-violet', label: 'Essai' }
    case 'confirmed_pending_dues':
      return { pillClass: 'pill-amber', label: 'Cotisation à payer' }
    case 'active':
      return { pillClass: 'pill-emerald', label: 'Active' }
    case 'refused':
      return { pillClass: 'pill-rose', label: 'Refusée' }
    case 'cancelled':
      return { pillClass: 'pill-slate', label: 'Clôturée' }
  }
}

function playerLabel(reg: Registration): string {
  if (reg.registrationFor === 'self') return 'Pour vous-même'
  const first = reg.player.firstName?.trim() ?? ''
  return first ? `Pour ${first}` : 'Pour un joueur'
}

function playerInitials(reg: Registration): string {
  if (reg.registrationFor === 'self') {
    return initials.value
  }
  const f = (reg.player.firstName?.charAt(0) ?? '').toUpperCase()
  const l = (reg.player.lastName?.charAt(0) ?? '').toUpperCase()
  return (f + l) || '?'
}

function teamLine(reg: Registration): string {
  // teamId résolu en nom côté futur store de teams. En attendant, on n'affiche
  // que le statut humain.
  return statusVisual(reg.status).label
}

function onResumeDraft(reg: Registration) {
  registrations.resumeDraft(reg.id)
  router.push('/register/step-1')
}

const deletingDraftId = ref<string | null>(null)

async function onDeleteDraft(reg: Registration) {
  const playerName = reg.registrationFor === 'self'
    ? 'votre inscription'
    : reg.player.firstName?.trim()
      ? `l'inscription de ${reg.player.firstName}`
      : 'cette inscription'
  const ok = window.confirm(
    `Supprimer ${playerName} ? Le brouillon sera définitivement perdu.`,
  )
  if (!ok) return
  deletingDraftId.value = reg.id
  try {
    await registrations.removeDraft(reg.id)
  } catch (err) {
    console.error('removeDraft failed', err)
    window.alert("Impossible de supprimer ce brouillon. Réessayez plus tard.")
  } finally {
    deletingDraftId.value = null
  }
}

function onStartNew() {
  registrations.clearDraft()
  router.push('/register/step-1')
}

/**
 * Retourne le due actif lié à cette registration (via `matchedMemberId`),
 * ou `null` si pas de due. Privilégie cette dérivation plutôt que le seul
 * status `confirmed_pending_dues` car plus précise : le status passe à
 * `active` au moment où l'admin marque le due `paid`, mais entre
 * `confirmed_pending_dues` et `active` il existe une fenêtre courte où il
 * faut effectivement payer.
 */
function activeDueFor(reg: Registration) {
  return dues.findActiveDueForMember(reg.matchedMemberId)
}

/**
 * Retourne le due payé le plus récent lié à cette registration, ou `null`.
 * Utilisé pour afficher le badge "Cotisation payée le {date}" sur les cards
 * `active` (et plus largement toute card sans due en attente).
 */
function paidDueFor(reg: Registration) {
  return dues.findPaidDueForMember(reg.matchedMemberId)
}

function onPayDue(reg: Registration): void {
  const due = activeDueFor(reg)
  if (!due) return
  void router.push({ name: 'payment-instructions', params: { dueId: due.id } })
}

function onViewReceipt(reg: Registration): void {
  const due = paidDueFor(reg)
  if (!due) return
  void router.push({ name: 'payment-instructions', params: { dueId: due.id } })
}

const amountFmt = new Intl.NumberFormat('fr-CH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const dateFmt = new Intl.DateTimeFormat('fr-CH', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

function formatDueLine(reg: Registration): string | null {
  const due = activeDueFor(reg)
  if (!due) return null
  const amount = `${amountFmt.format(due.amount)} CHF`
  if (!due.dueAt) return amount
  const date = dateFmt.format(new Date(due.dueAt.seconds * 1000))
  return `${amount} · avant le ${date}`
}

/**
 * Formatte la ligne "payée le {date} · {montant}" pour le badge "reçu".
 * Utilise `paidAmount` si présent (montant effectivement encaissé, peut
 * différer de `amount` dans le cas arrangement comité), fallback `amount`.
 * Date : `paidAt` si présent (cas standard), sinon on omet la date.
 */
function formatPaidLine(reg: Registration): string | null {
  const due = paidDueFor(reg)
  if (!due) return null
  const value = due.paidAmount ?? due.amount
  const amount = `${amountFmt.format(value)} CHF`
  if (!due.paidAt) return amount
  const date = dateFmt.format(new Date(due.paidAt.seconds * 1000))
  return `${amount} · le ${date}`
}

async function onSignOut() {
  menuOpen.value = false
  await auth.signOut()
  await router.replace({ name: 'landing' })
}
</script>

<template>
  <div class="m-app">
    <div class="m-header">
      <div
        class="brand-mark"
        style="width: 28px; height: 28px; border-radius: 8px; font-size: 12px;"
      >
        M
      </div>
      <div class="header__id">
        <div class="header__name">Marly Basket</div>
        <div class="header__role">Espace inscriptions</div>
      </div>
      <button
        type="button"
        class="avatar header__avatar"
        :aria-label="`Menu de ${firstName}`"
        @click="menuOpen = !menuOpen"
      >
        {{ initials }}
      </button>

      <div
        v-if="menuOpen"
        class="header__menu"
        role="menu"
      >
        <div class="header__menu-id">
          <div class="header__menu-name">
            {{ auth.userDoc?.displayName }}
          </div>
          <div class="header__menu-email">
            {{ auth.userDoc?.email }}
          </div>
        </div>
        <button
          type="button"
          class="header__menu-action"
          @click="onSignOut"
        >
          <LogOut :size="14" /> Déconnexion
        </button>
      </div>
    </div>

    <div class="m-content">
      <div>
        <h1 class="home__title">
          Bonjour {{ firstName || 'à vous' }}
        </h1>
        <p class="home__sub">
          Vos inscriptions en cours et passées.
        </p>
      </div>

      <!--
        Panneau "Mes cotisations". Rend uniquement si `dues.hasActiveDues` ;
        sinon le composant ne rend rien (pas de carte vide). Positionné en
        tête pour que l'utilisateur voit l'action à faire dès l'arrivée.
      -->
      <MyCotisationsPanel v-if="dues.hasActiveDues" />

      <!-- Erreur de chargement (ex. index Firestore manquant, rules trop strictes). -->
      <!-- L'utilisateur ne peut pas corriger ça lui-même : on l'informe pour qu'il -->
      <!-- contacte le club, et on log l'erreur en console pour le debug. -->
      <div
        v-if="loadError"
        class="banner banner-strong home__error"
        role="alert"
      >
        <AlertTriangle :size="16" class="banner-icon" />
        <div>
          <div class="home__error-title">
            Impossible de charger vos inscriptions.
          </div>
          <div class="home__error-desc">
            Index Firestore manquant ou rules à déployer — contactez le club si le problème persiste.
          </div>
        </div>
      </div>

      <!-- Loading skeletons -->
      <div
        v-if="isLoading && myList.length === 0"
        class="home__section"
      >
        <div class="home__label">CHARGEMENT…</div>
        <div
          v-for="n in 2"
          :key="n"
          class="card home__card"
        >
          <div class="sk h-4 w-2/3 mb-2" />
          <div class="sk h-3 w-1/2" />
        </div>
      </div>

      <!-- Empty state -->
      <div
        v-else-if="hasNoRegistrations"
        class="home__empty"
      >
        <svg
          viewBox="0 0 200 140"
          fill="none"
          class="home__empty-svg"
        >
          <rect
            x="22"
            y="20"
            width="156"
            height="100"
            rx="10"
            fill="#f0fdf4"
            stroke="#a7f3d0"
            stroke-width="1.5"
            stroke-dasharray="4 4"
          />
          <circle
            cx="100"
            cy="56"
            r="20"
            fill="white"
            stroke="#10b981"
            stroke-width="1.5"
          />
          <path
            d="M93 56l5 5 10-10"
            stroke="#10b981"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            fill="none"
          />
          <rect
            x="60"
            y="86"
            width="80"
            height="6"
            rx="3"
            fill="#d1fae5"
          />
          <rect
            x="74"
            y="98"
            width="52"
            height="6"
            rx="3"
            fill="#ecfdf5"
          />
        </svg>
        <div class="home__empty-title">
          Aucune inscription pour le moment
        </div>
        <p class="home__empty-desc">
          Commencez une nouvelle inscription pour vous-même ou pour un enfant. Cela prend environ 5 minutes.
        </p>
      </div>

      <!-- Active registrations -->
      <template v-else>
        <div class="home__label">
          MES INSCRIPTIONS · {{ activeList.length }}
        </div>

        <div
          v-for="reg in activeList"
          :key="reg.id"
          class="card home__card"
          :class="{
            'home__card--highlight': reg.status === 'confirmed_pending_dues',
          }"
        >
          <div class="home__card-head">
            <div
              class="avatar home__card-avatar"
              :class="{
                'home__card-avatar--violet': reg.status === 'trial_in_progress',
                'home__card-avatar--amber': reg.status === 'confirmed_pending_dues',
                'home__card-avatar--rose': reg.status === 'refused',
              }"
            >
              {{ playerInitials(reg) }}
            </div>
            <div class="home__card-body">
              <div class="home__card-name">
                {{ playerLabel(reg) }}
              </div>
              <div class="home__card-team">
                {{ teamLine(reg) }}
              </div>
            </div>
            <span
              class="pill"
              :class="statusVisual(reg.status).pillClass"
            >
              {{ statusVisual(reg.status).label }}
            </span>
          </div>

          <!-- Draft : reprise + suppression -->
          <template v-if="reg.status === 'draft'">
            <div class="home__card-meta">
              <CircleDashed :size="14" /> Brouillon en cours
            </div>
            <div class="home__card-draft-actions">
              <button
                type="button"
                class="btn btn-secondary btn-sm home__card-resume"
                :disabled="deletingDraftId === reg.id"
                @click="onResumeDraft(reg)"
              >
                Reprendre
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-sm home__card-delete"
                aria-label="Supprimer ce brouillon"
                :disabled="deletingDraftId === reg.id"
                @click="onDeleteDraft(reg)"
              >
                <Trash2 :size="14" />
              </button>
            </div>
          </template>

          <!-- Submitted/Pending : message d'attente -->
          <template
            v-else-if="
              reg.status === 'submitted' ||
                reg.status === 'open_pending_trial' ||
                reg.status === 'conditional_pending_review' ||
                reg.status === 'conditional_pending_trial'
            "
          >
            <div class="banner banner-info home__card-banner">
              <Info :size="14" class="banner-icon" />
              <span>Le coach vous contactera bientôt.</span>
            </div>
          </template>

          <!-- Trial in progress -->
          <template v-else-if="reg.status === 'trial_in_progress'">
            <div class="home__card-meta home__card-meta--violet">
              <Hourglass :size="14" /> Essai en cours
            </div>
          </template>

          <!-- Cotisation à payer (le coach a confirmé l'inscription) -->
          <template v-else-if="reg.status === 'confirmed_pending_dues'">
            <p class="home__card-amber">
              Le club a confirmé votre inscription. Réglez la cotisation pour finaliser&nbsp;; le coach se chargera ensuite de la licence fédérale.
            </p>
            <div
              v-if="formatDueLine(reg)"
              class="home__card-due"
            >
              <CalendarClock :size="14" />
              <span>{{ formatDueLine(reg) }}</span>
            </div>
            <button
              v-if="activeDueFor(reg)"
              type="button"
              class="btn btn-primary btn-sm btn-block home__card-cta"
              @click="onPayDue(reg)"
            >
              <Banknote :size="14" /> Payer ma cotisation
            </button>
          </template>

          <!-- Cotisation due alors que la registration n'est pas (plus)
               en status `confirmed_pending_dues` — ex. registration `active`
               avec un due renouvelé en saison N+1. Cas marginal mais on
               garantit l'accès au paiement. -->
          <template v-else-if="activeDueFor(reg)">
            <div class="banner banner-info home__card-banner">
              <Info :size="14" class="banner-icon" />
              <span>Une cotisation est en attente de paiement.</span>
            </div>
            <div
              v-if="formatDueLine(reg)"
              class="home__card-due"
            >
              <CalendarClock :size="14" />
              <span>{{ formatDueLine(reg) }}</span>
            </div>
            <button
              type="button"
              class="btn btn-primary btn-sm btn-block home__card-cta"
              @click="onPayDue(reg)"
            >
              <Banknote :size="14" /> Payer ma cotisation
            </button>
          </template>

          <!-- Cotisation déjà payée : reçu cliquable (mène vers
               PaymentInstructions en mode "paid"). On rend cette branche
               uniquement quand il n'y a plus de due actif (priorité à
               l'action "à payer" du joueur en cas de coexistence,
               typiquement saison N+1 renouvelée). -->
          <template v-else-if="paidDueFor(reg)">
            <div class="home__card-paid">
              <CheckCircle2 :size="14" />
              <span class="home__card-paid-label">Cotisation payée</span>
              <span
                v-if="formatPaidLine(reg)"
                class="home__card-paid-meta"
              >· {{ formatPaidLine(reg) }}</span>
            </div>
            <button
              type="button"
              class="btn btn-secondary btn-sm btn-block home__card-cta"
              @click="onViewReceipt(reg)"
            >
              Voir le reçu
            </button>
          </template>

          <!-- Refused -->
          <template v-else-if="reg.status === 'refused'">
            <p
              v-if="reg.refusalReason"
              class="home__card-reason"
            >
              <span class="home__card-reason-label">Motif :</span>
              {{ reg.refusalReason }}
            </p>
            <div class="banner banner-info home__card-banner">
              <Sparkles :size="14" class="banner-icon" />
              <span>Le coach pourra vous proposer une équipe alternative.</span>
            </div>
          </template>
        </div>

        <!-- Past / cancelled -->
        <template v-if="cancelledList.length > 0">
          <div class="home__label home__label--spaced">
            PASSÉ
          </div>
          <div
            v-for="reg in cancelledList"
            :key="reg.id"
            class="card home__card home__card--muted"
          >
            <div class="home__card-head">
              <div class="avatar home__card-avatar">
                {{ playerInitials(reg) }}
              </div>
              <div class="home__card-body">
                <div class="home__card-name">
                  {{ playerLabel(reg) }}
                </div>
              </div>
              <span class="pill pill-slate">Clôturée</span>
            </div>
          </div>
        </template>
      </template>
    </div>

    <div class="m-bottom">
      <button
        type="button"
        class="btn btn-primary btn-block"
        @click="onStartNew"
      >
        <Plus :size="14" /> Nouvelle inscription
      </button>
    </div>
  </div>
</template>

<style scoped>
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
.header__avatar {
  margin-left: auto;
  width: 30px;
  height: 30px;
  background: #fde68a;
  color: #92400e;
  border: none;
  cursor: pointer;
}
.header__menu {
  position: absolute;
  top: 56px;
  right: 12px;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08), 0 2px 6px rgba(15, 23, 42, 0.04);
  min-width: 200px;
  z-index: 20;
  overflow: hidden;
}
.header__menu-id {
  padding: 12px 14px;
  border-bottom: 1px solid #eef2f6;
}
.header__menu-name {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
}
.header__menu-email {
  font-size: 11.5px;
  color: #64748b;
  margin-top: 2px;
}
.header__menu-action {
  width: 100%;
  background: transparent;
  border: none;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #be123c;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
}
.header__menu-action:hover {
  background: #fff1f2;
}

.home__title {
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0;
  color: #0f172a;
}
.home__sub {
  font-size: 12.5px;
  color: #64748b;
  margin: 4px 0 0 0;
}

.home__label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: #64748b;
  letter-spacing: 0.08em;
  margin-top: 20px;
  margin-bottom: 8px;
}
.home__label--spaced {
  margin-top: 28px;
}

.home__section {
  display: flex;
  flex-direction: column;
}

.home__card {
  padding: 16px;
  margin-bottom: 12px;
}
.home__card--highlight {
  border-color: #fcd34d;
  background: linear-gradient(180deg, #fffbeb 0%, #ffffff 60%);
}
.home__card--muted {
  opacity: 0.75;
}

.home__card-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.home__card-avatar {
  background: #f1f5f9;
  color: #475569;
}
.home__card-avatar--violet {
  background: #ede9fe;
  color: #6d28d9;
}
.home__card-avatar--amber {
  background: #fef3c7;
  color: #92400e;
}
.home__card-avatar--rose {
  background: #ffe4e6;
  color: #be123c;
}
.home__card-body {
  flex: 1;
  min-width: 0;
}
.home__card-name {
  font-size: 13.5px;
  font-weight: 600;
  color: #0f172a;
}
.home__card-team {
  font-size: 12px;
  color: #64748b;
  margin-top: 2px;
}
.home__card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: #64748b;
  margin-top: 12px;
}
.home__card-meta--violet {
  color: #6d28d9;
  font-weight: 500;
}
.home__card-banner {
  margin-top: 12px;
  font-size: 12px;
}
.home__card-cta {
  margin-top: 12px;
}
.home__card-draft-actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}
.home__card-resume {
  flex: 1;
}
.home__card-delete {
  color: #be123c;
  flex: none;
}
.home__card-delete:hover:not(:disabled) {
  background: #fff1f2;
  color: #be123c;
}
.home__card-amber {
  margin: 12px 0 0 0;
  color: #78350f;
  font-size: 12.5px;
  line-height: 1.6;
}
.home__card-due {
  margin-top: 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  background: #fef3c7;
  border: 1px solid #fcd34d;
  color: #78350f;
  font-size: 12px;
  font-weight: 600;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  letter-spacing: 0.01em;
}
.home__card-paid {
  margin-top: 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  color: #047857;
  font-size: 12px;
  font-weight: 600;
}
.home__card-paid-label {
  letter-spacing: 0.01em;
}
.home__card-paid-meta {
  font-weight: 500;
  color: #065f46;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  letter-spacing: 0.01em;
}
.home__card-reason {
  margin: 12px 0 0 0;
  color: #475569;
  font-size: 12px;
  line-height: 1.6;
}
.home__card-reason-label {
  color: #1e293b;
  font-weight: 500;
}

.home__error {
  margin-top: 16px;
  align-items: flex-start;
}
.home__error-title {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
}
.home__error-desc {
  font-size: 12px;
  margin-top: 4px;
  line-height: 1.5;
  opacity: 0.85;
}

.home__empty {
  text-align: center;
  padding: 24px 0 0 0;
}
.home__empty-svg {
  width: 200px;
  height: 140px;
  margin: 16px auto 0;
}
.home__empty-title {
  font-size: 14.5px;
  font-weight: 600;
  color: #0f172a;
  margin-top: 16px;
}
.home__empty-desc {
  font-size: 12.5px;
  color: #64748b;
  margin: 6px 12px 0;
  line-height: 1.6;
}

.h-3 {
  height: 12px;
}
.h-4 {
  height: 16px;
}
.w-2\/3 {
  width: 66.6667%;
}
.w-1\/2 {
  width: 50%;
}
.mb-2 {
  margin-bottom: 8px;
}
</style>
