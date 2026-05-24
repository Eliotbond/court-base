<script setup lang="ts">
/**
 * `Licenses` — vue parent listant toutes les demandes de licence
 * accessibles au user (self linked + pupilles), tous statuts confondus.
 *
 * Sert de point d'entrée stable (deep-link, marque-page, lien Home) en
 * complément du banner Home qui n'expose que les demandes en
 * `pending_parent_docs`. Ici on montre TOUT — y compris les demandes
 * approuvées, validées par le coach, en attente de signature, refusées —
 * pour donner une vision complète "où en est ma licence ?".
 *
 * Pattern : page longue scrollable style `Account.vue`. Groupée par
 * membre (linked member ou pupille). Chaque card est cliquable → ouvre
 * `LicenseRequestForm` qui sait gérer l'affichage read-only quand la
 * demande n'est plus éditable côté parent.
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { FirebaseError } from 'firebase/app'
import { ArrowLeft, ChevronRight, IdCard } from 'lucide-vue-next'
import type {
  LicenseRequest,
  LicenseRequestStatus,
} from '@club-app/shared-types'
import { useAuthStore } from '@/stores/auth'
import { useLicenseRequestsStore } from '@/stores/licenseRequests'

const auth = useAuthStore()
const licenseRequests = useLicenseRequestsStore()
const router = useRouter()

const loading = ref(false)

const requests = computed<LicenseRequest[]>(() => licenseRequests.requests)

const hasAny = computed(() => requests.value.length > 0)

/**
 * Regroupe les demandes par membre (clé = `memberId`). On utilise le
 * `denorm.memberFirstName/LastName` pour le nom affiché ; en l'absence on
 * tombe sur "Joueur" (cas dégradé où la demande n'a pas été dénormalisée
 * par le coach).
 */
interface GroupedRequests {
  memberId: string
  memberLabel: string
  initials: string
  requests: LicenseRequest[]
}

const grouped = computed<GroupedRequests[]>(() => {
  const map = new Map<string, GroupedRequests>()
  for (const r of requests.value) {
    const memberId = r.memberId
    const first = r.denorm?.memberFirstName ?? ''
    const last = r.denorm?.memberLastName ?? ''
    const fullName = `${first} ${last}`.trim() || 'Joueur'
    const initials = ((first.charAt(0) ?? '') + (last.charAt(0) ?? ''))
      .toUpperCase() || 'J'
    let g = map.get(memberId)
    if (!g) {
      g = {
        memberId,
        memberLabel: fullName,
        initials,
        requests: [],
      }
      map.set(memberId, g)
    }
    g.requests.push(r)
  }
  // Tri par nom de membre alphabétique, demandes de chaque groupe par date
  // de création décroissante (plus récente en haut).
  const out = Array.from(map.values())
  for (const g of out) {
    g.requests.sort((a, b) => {
      const aSec = a.createdAt?.seconds ?? 0
      const bSec = b.createdAt?.seconds ?? 0
      return bSec - aSec
    })
  }
  out.sort((a, b) => a.memberLabel.localeCompare(b.memberLabel, 'fr-CH'))
  return out
})

// =============================================================================
// Mapping statut → pill (libellé FR + classes utilitaires).
//
// Volontairement local : `LicenseRequestForm.vue` utilise déjà ses propres
// libellés contextuels ("À compléter" / "En cours de validation" / …)
// qui ne mappent pas 1:1 sur la liste — factoriser forcerait l'un ou
// l'autre à compromettre son vocabulaire. On garde donc deux mappings
// indépendants ; si un 3e consumer arrive plus tard, on factorise.
// =============================================================================

interface StatusPill {
  label: string
  cls: string
}

function statusPill(s: LicenseRequestStatus): StatusPill {
  switch (s) {
    case 'pending_parent_docs':
      return { label: 'À compléter par vous', cls: 'pill-status pill-status--amber' }
    case 'parent_docs_submitted':
      return { label: 'En attente du coach', cls: 'pill-status pill-status--sky' }
    case 'coach_validated':
      return { label: 'Validée par le coach', cls: 'pill-status pill-status--indigo' }
    case 'awaiting_parent_signature':
      return { label: 'À signer par vous', cls: 'pill-status pill-status--amber' }
    case 'parent_signed':
      return { label: 'Document signé envoyé', cls: 'pill-status pill-status--sky' }
    case 'form_confirmed':
      return { label: 'En cours de finalisation', cls: 'pill-status pill-status--indigo' }
    case 'sent_paid':
      return { label: 'Envoyée à la fédération', cls: 'pill-status pill-status--indigo' }
    case 'approved':
      return { label: 'Approuvée', cls: 'pill-status pill-status--emerald' }
    case 'rejected':
      return { label: 'Refusée', cls: 'pill-status pill-status--rose' }
    case 'pending':
      return { label: 'En attente', cls: 'pill-status pill-status--slate' }
  }
}

// =============================================================================
// Sous-ligne (saison / type de licence ou date de création en fallback).
// =============================================================================

const dateFmt = new Intl.DateTimeFormat('fr-CH', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

function formatCreated(req: LicenseRequest): string {
  const sec = req.createdAt?.seconds
  if (!sec) return '—'
  return dateFmt.format(new Date(sec * 1000))
}

/**
 * Libellé secondaire d'une card. On préfère la saison + le nom d'équipe si
 * dispos, sinon on retombe sur la date de création.
 */
function subLine(req: LicenseRequest): string {
  const parts: string[] = []
  if (req.seasonId) parts.push(`Saison ${req.seasonId}`)
  const team = req.denorm?.teamName
  if (team) parts.push(team)
  if (parts.length > 0) return parts.join(' · ')
  return `Demande créée le ${formatCreated(req)}`
}

/**
 * Caption — date du dernier changement métier connu (review trésorier >
 * coach > parent soumission > création). Sert d'indicateur "quand est-ce
 * que ça a bougé pour la dernière fois".
 */
function lastUpdateCaption(req: LicenseRequest): string {
  const ts =
    req.reviewedAt ??
    req.licenseFinalizedAt ??
    req.sentToFederationAt ??
    req.formConfirmedAt ??
    req.signedDocUploadedAt ??
    req.signableDocUploadedAt ??
    req.coachValidatedAt ??
    req.parentCompletedAt ??
    req.createdAt
  const sec = ts?.seconds
  if (!sec) return ''
  return `Dernière mise à jour le ${dateFmt.format(new Date(sec * 1000))}`
}

// =============================================================================
// Navigation
// =============================================================================

function openRequest(req: LicenseRequest): void {
  void router.push({ name: 'license-request', params: { requestId: req.id } })
}

function onBack(): void {
  void router.push({ name: 'home' })
}

// =============================================================================
// Mount
// =============================================================================

onMounted(async () => {
  // Si rien en cache, on hydrate. Sinon on consomme tel quel (Home aura
  // probablement déjà chargé). Pattern catch enrichi obligatoire (cf.
  // CLAUDE.md register §"Catch enrichi obligatoire").
  if (!auth.authSnap?.uid) return
  if (requests.value.length > 0) return
  loading.value = true
  try {
    await licenseRequests.loadMyRequests(
      auth.authSnap.uid,
      auth.userDoc?.memberId ?? null,
    )
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`Licenses.onMounted loadMyRequests failed [${code}]`, err)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="m-app">
    <div class="m-header">
      <button
        type="button"
        class="header__back"
        aria-label="Retour"
        @click="onBack"
      >
        <ArrowLeft :size="18" />
      </button>
      <div class="header__id">
        <div class="header__name">Mes licences</div>
        <div class="header__role">Demandes de licence en cours et passées</div>
      </div>
    </div>

    <div class="m-content licenses__content">
      <!-- Loading skeleton (rare : Home a normalement déjà hydraté). -->
      <div
        v-if="loading && !hasAny"
        class="card licenses__card"
      >
        <div class="sk h-4 w-2/3 mb-2" />
        <div class="sk h-3 w-1/2" />
      </div>

      <!-- Empty state minimal. -->
      <div
        v-else-if="!hasAny"
        class="licenses__empty"
      >
        <div class="licenses__empty-ic">
          <IdCard :size="22" />
        </div>
        <div class="licenses__empty-title">
          Aucune demande de licence pour le moment.
        </div>
        <p class="licenses__empty-desc">
          Quand le coach déclenchera une demande, vous la verrez apparaître ici.
        </p>
      </div>

      <!-- Liste groupée par membre. -->
      <template v-else>
        <section
          v-for="group in grouped"
          :key="group.memberId"
          class="licenses__group"
        >
          <header class="licenses__group-head">
            <div class="avatar licenses__group-avatar">
              {{ group.initials }}
            </div>
            <div class="licenses__group-name">
              {{ group.memberLabel }}
            </div>
            <span class="licenses__group-count">
              {{ group.requests.length }} demande{{ group.requests.length > 1 ? 's' : '' }}
            </span>
          </header>

          <button
            v-for="req in group.requests"
            :key="req.id"
            type="button"
            class="card licenses__card licenses__card--clickable"
            :aria-label="`Ouvrir la demande de ${group.memberLabel}`"
            @click="openRequest(req)"
          >
            <div class="licenses__card-row">
              <div class="licenses__card-body">
                <div class="licenses__card-name">
                  {{ group.memberLabel }}
                </div>
                <div class="licenses__card-sub">
                  {{ subLine(req) }}
                </div>
              </div>
              <span
                class="pill"
                :class="statusPill(req.status).cls"
              >
                {{ statusPill(req.status).label }}
              </span>
              <ChevronRight :size="16" class="licenses__card-chev" />
            </div>
            <div
              v-if="lastUpdateCaption(req)"
              class="licenses__card-caption"
            >
              {{ lastUpdateCaption(req) }}
            </div>
          </button>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* ---------------- header ---------------- */
.header__back {
  background: transparent;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #334155;
  cursor: pointer;
  margin-right: 6px;
}
.header__back:hover {
  background: #f8fafc;
}
.header__id {
  line-height: 1.2;
}
.header__name {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
}
.header__role {
  font-size: 10.5px;
  color: #64748b;
}

/* ---------------- content ---------------- */
.licenses__content {
  padding-bottom: 32px;
}

/* ---------------- empty state ---------------- */
.licenses__empty {
  margin-top: 32px;
  text-align: center;
  padding: 0 12px;
}
.licenses__empty-ic {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: #f1f5f9;
  color: #64748b;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
}
.licenses__empty-title {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
}
.licenses__empty-desc {
  margin: 6px 0 0 0;
  font-size: 12.5px;
  color: #64748b;
  line-height: 1.5;
}

/* ---------------- groups ---------------- */
.licenses__group {
  margin-top: 18px;
}
.licenses__group:first-child {
  margin-top: 8px;
}
.licenses__group-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  padding: 0 2px;
}
.licenses__group-avatar {
  background: #e0e7ff;
  color: #3730a3;
  width: 30px;
  height: 30px;
  font-size: 11.5px;
  font-weight: 600;
  flex: none;
}
.licenses__group-name {
  font-size: 13.5px;
  font-weight: 600;
  color: #0f172a;
  flex: 1;
  min-width: 0;
}
.licenses__group-count {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  color: #64748b;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

/* ---------------- cards ---------------- */
.licenses__card {
  display: block;
  padding: 14px;
  margin-bottom: 8px;
  text-align: left;
  font-family: inherit;
  color: inherit;
  width: 100%;
}
.licenses__card--clickable {
  cursor: pointer;
  background: white;
  border: 1px solid #e2e8f0;
}
.licenses__card--clickable:hover {
  background: #f8fafc;
}
.licenses__card-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.licenses__card-body {
  flex: 1;
  min-width: 0;
}
.licenses__card-name {
  font-size: 13.5px;
  font-weight: 600;
  color: #0f172a;
}
.licenses__card-sub {
  font-size: 11.5px;
  color: #64748b;
  margin-top: 2px;
}
.licenses__card-chev {
  color: #94a3b8;
  flex: none;
}
.licenses__card-caption {
  margin-top: 8px;
  font-size: 11px;
  color: #94a3b8;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  letter-spacing: 0.02em;
}

/* ---------------- pill colors ---------------- */
/* Hérite de `.pill` global (style.css) pour la base ; on override les
   couleurs pour aligner sur les tons utilisés côté admin web. Sky / amber /
   emerald / slate / rose existent en global mais sont ré-écrits ici pour
   matcher exactement la spec (border + bg + couleur texte). */
.pill-status {
  border: 1px solid transparent;
}
.pill-status--amber {
  background: #fffbeb;
  color: #b45309;
  border-color: #fde68a;
}
.pill-status--sky {
  background: #f0f9ff;
  color: #0369a1;
  border-color: #bae6fd;
}
.pill-status--indigo {
  background: #eef2ff;
  color: #4338ca;
  border-color: #c7d2fe;
}
.pill-status--emerald {
  background: #ecfdf5;
  color: #047857;
  border-color: #a7f3d0;
}
.pill-status--rose {
  background: #fff1f2;
  color: #be123c;
  border-color: #fecaca;
}
.pill-status--slate {
  background: #f1f5f9;
  color: #475569;
  border-color: #e2e8f0;
}

/* ---------------- skeletons ---------------- */
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
