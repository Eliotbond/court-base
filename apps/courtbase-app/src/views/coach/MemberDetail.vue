<script setup lang="ts">
/**
 * CO4 — Fiche détail joueur (coach). Transcription quasi-littérale du JSX
 * `CO4Mobile` (cf. `/tmp/courtbase-app-design/courtbase-app/project/screens/coach.jsx`
 * lignes 213-291).
 *
 * Démo via le seed :
 *   - `m-sarah` → cotisation payée + licenciée
 *   - `m-leo`   → cotisation issued + non licencié
 *   - `m-ines`  → cotisation excluded (CTA "Soumettre exception")
 *   - `m-tom`   → cotisation excepted (badge "Exception pending")
 *
 * Mock-only — toutes les mutations passent par `logMockAction(...)`.
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Edit,
  Eye,
  EyeOff,
  Info,
  MoreVertical,
  User,
  X,
} from 'lucide-vue-next'

import CbAvatar from '@/components/ui/CbAvatar.vue'
import CbBanner from '@/components/ui/CbBanner.vue'
import CbBottomBar from '@/components/ui/CbBottomBar.vue'
import CbEmptyState from '@/components/ui/CbEmptyState.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbPill, { type CbPillTone } from '@/components/ui/CbPill.vue'
import { useAuthStore } from '@/stores/auth'
import {
  getDueForMember,
  getMember,
  getTeam,
  inferRequiredDocs,
  logMockAction,
  type MockDue,
  type MockMember,
  type MockTeam,
} from '@/repositories/mock'
import { useLicenseRequestsStore } from '@/stores/licenseRequests'
import type { DuesStatus } from '@/types/mock'
import { canRequestLicense, licenseGateReason } from '@/utils/licenseGate'

// ────────────────────────────────────────────────────────────────
// Mock — id forcé pour démo (override le router param si défini)
// ────────────────────────────────────────────────────────────────
//   null        → utilise `route.params.memberId`
//   'm-sarah'   → cotisation payée + licenciée
//   'm-leo'     → cotisation issued + non licencié
//   'm-ines'    → cotisation excluded (CTA exception)
//   'm-tom'     → cotisation excepted (badge "Exception pending")
const MOCK_DEMO_MEMBER_ID: string | null = null

// ────────────────────────────────────────────────────────────────
// Data
// ────────────────────────────────────────────────────────────────

const route = useRoute()
const router = useRouter()
useAuthStore()

const memberId = computed<string>(() => {
  if (MOCK_DEMO_MEMBER_ID !== null) return MOCK_DEMO_MEMBER_ID
  const raw = route.params['memberId']
  return Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
})

const member = computed<MockMember | null>(() =>
  memberId.value ? getMember(memberId.value) : null,
)

const due = computed<MockDue | null>(() =>
  memberId.value ? getDueForMember(memberId.value) : null,
)

const primaryTeam = computed<MockTeam | null>(() => {
  if (!member.value || member.value.teamIds.length === 0) return null
  const firstTeamId = member.value.teamIds[0]
  return firstTeamId ? getTeam(firstTeamId) : null
})

const memberFullName = computed(() =>
  member.value ? `${member.value.firstName} ${member.value.lastName}` : '',
)

const memberAvatarTone = computed<'emerald' | 'sky' | 'amber' | 'violet' | 'rose'>(() => {
  if (member.value?.avatarTone) return member.value.avatarTone
  return member.value?.gender === 'F' ? 'amber' : 'sky'
})

// ────────────────────────────────────────────────────────────────
// Formatting / age
// ────────────────────────────────────────────────────────────────

function parseIsoDate(iso: string): { y: number; m: number; d: number } | null {
  const parts = iso.split('-').map((p) => Number(p))
  if (parts.length !== 3) return null
  const y = parts[0]
  const m = parts[1]
  const d = parts[2]
  if (y === undefined || m === undefined || d === undefined) return null
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return null
  return { y, m, d }
}

function ageFromIso(iso: string): number | null {
  const parts = parseIsoDate(iso)
  if (!parts) return null
  const today = new Date()
  let age = today.getFullYear() - parts.y
  const beforeBirthday =
    today.getMonth() + 1 < parts.m ||
    (today.getMonth() + 1 === parts.m && today.getDate() < parts.d)
  if (beforeBirthday) age -= 1
  return age
}

function formatBirthDateShort(iso: string): string {
  const parts = parseIsoDate(iso)
  if (!parts) return iso
  const dd = String(parts.d).padStart(2, '0')
  const mm = String(parts.m).padStart(2, '0')
  return `${dd}.${mm}.${parts.y}`
}

const memberAge = computed(() =>
  member.value ? ageFromIso(member.value.birthDate) : null,
)

// "U16M Compétition · né le 03.12.2009 (15 ans)"
const memberSubLine = computed(() => {
  if (!member.value) return ''
  const team = primaryTeam.value?.name ?? 'Sans équipe'
  const dob = formatBirthDateShort(member.value.birthDate)
  const gender = member.value.gender === 'F' ? 'née' : 'né'
  const age = memberAge.value
  const ageStr = age != null ? ` (${age} ans)` : ''
  return `${team} · ${gender} le ${dob}${ageStr}`
})

// ────────────────────────────────────────────────────────────────
// AVS masking
// ────────────────────────────────────────────────────────────────

const showAvs = ref(false)

const avsValue = computed(() => {
  if (member.value?.avs) return member.value.avs
  return '756.0000.0000.00'
})

const avsMasked = computed(() => '756.•••.•••.97')

function toggleAvs(): void {
  showAvs.value = !showAvs.value
}

// ────────────────────────────────────────────────────────────────
// Tuteurs mockés
// ────────────────────────────────────────────────────────────────

interface GuardianRef {
  uid: string
  name: string
  relationship: 'père' | 'mère'
}

const guardians = computed<GuardianRef[]>(() => {
  if (!member.value) return []
  return member.value.guardianUserIds.map((uid, idx) => {
    const slug = uid.replace(/^user-parent-/, '').replace(/^user-/, '')
    const familyName = slug
      ? slug.charAt(0).toUpperCase() + slug.slice(1)
      : 'Parent'
    const firstName = idx === 0 ? 'Pascal' : 'Claire'
    const relationship: 'père' | 'mère' = idx === 0 ? 'père' : 'mère'
    return {
      uid,
      name: `${firstName} ${familyName}`,
      relationship,
    }
  })
})

const isMinor = computed(() => {
  const age = memberAge.value
  return age != null && age < 18
})

// ────────────────────────────────────────────────────────────────
// Status pills
// ────────────────────────────────────────────────────────────────

interface StatusBadge {
  label: string
  tone: CbPillTone
  dot: boolean
}

function duesStatusBadge(status: DuesStatus): StatusBadge {
  switch (status) {
    case 'paid':
      return { label: 'Payée', tone: 'emerald', dot: true }
    case 'pending_grace':
      return { label: 'Délai en cours', tone: 'amber', dot: true }
    case 'issued':
      return { label: 'Émise', tone: 'amber', dot: true }
    case 'overdue':
      return { label: 'En retard', tone: 'rose', dot: true }
    case 'excluded':
      return { label: 'Exclu', tone: 'rose', dot: true }
    case 'excepted':
      return { label: 'Exception pending', tone: 'violet', dot: true }
    default:
      return { label: status, tone: 'slate', dot: false }
  }
}

const duesBadge = computed<StatusBadge | null>(() =>
  member.value ? duesStatusBadge(member.value.duesStatus) : null,
)

const isLicensed = computed(() => Boolean(member.value?.licenseNumber))

// "Échue le 30.09.2025 · impayée" / "Payée le …" etc.
const duesSubLine = computed(() => {
  if (!due.value) return ''
  if (due.value.paidAt) return `Payée le ${due.value.paidAt}`
  if (due.value.dueAt) {
    const status = due.value.status
    if (status === 'paid') return `Échue le ${due.value.dueAt}`
    if (status === 'excluded' || status === 'overdue') return `Échue le ${due.value.dueAt} · impayée`
    if (status === 'excepted') return `Échue le ${due.value.dueAt} · impayée`
    return `Échue le ${due.value.dueAt}`
  }
  if (due.value.issuedAt) return `Émise le ${due.value.issuedAt}`
  return ''
})

// ────────────────────────────────────────────────────────────────
// Présences saison (mock fixe)
// ────────────────────────────────────────────────────────────────

const attendanceSummary = computed(() => ({
  present: 18,
  absent: 1,
  excused: 3,
}))

function seeAttendance(): void {
  logMockAction('co4.see-attendance', { memberId: memberId.value })
  showToast('Détail des présences à venir.', 'amber')
}

// ────────────────────────────────────────────────────────────────
// Toast (auto-hide 3s)
// ────────────────────────────────────────────────────────────────

const toastMessage = ref<string>('')
const toastTone = ref<'emerald' | 'amber' | 'rose'>('emerald')
const toastVisible = ref(false)
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(message: string, tone: 'emerald' | 'amber' | 'rose' = 'emerald'): void {
  toastMessage.value = message
  toastTone.value = tone
  toastVisible.value = true
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastVisible.value = false
  }, 3000)
}

function dismissToast(): void {
  toastVisible.value = false
  if (toastTimer) {
    clearTimeout(toastTimer)
    toastTimer = null
  }
}

// ────────────────────────────────────────────────────────────────
// Dialog "Demande d'exception cotisation"
// ────────────────────────────────────────────────────────────────

const exceptionDialogOpen = ref(false)
const exceptionMotivation = ref('')
const exceptionError = ref('')

function openExceptionDialog(): void {
  exceptionMotivation.value = ''
  exceptionError.value = ''
  exceptionDialogOpen.value = true
}

function closeExceptionDialog(): void {
  exceptionDialogOpen.value = false
}

function submitException(): void {
  if (!member.value) return
  const motivation = exceptionMotivation.value.trim()
  if (motivation.length < 20) {
    exceptionError.value = 'Précisez la motivation (20 caractères minimum).'
    return
  }
  logMockAction('co4.payment-exception-request', {
    memberId: memberId.value,
    motivation,
  })
  exceptionDialogOpen.value = false
  showToast(
    'Demande envoyée — le joueur peut s\'entraîner en attendant la décision.',
    'emerald',
  )
}

// ────────────────────────────────────────────────────────────────
// Dialog "Demande / Retrait de licence" + gate cotisation
// ────────────────────────────────────────────────────────────────

const licenseRequestsStore = useLicenseRequestsStore()
const licenseDialogOpen = ref(false)

/**
 * `true` si la cotisation autorise la demande de licence (cf.
 * `utils/licenseGate.ts`). Pour un joueur déjà licencié, le gate retourne
 * `false` mais l'UI propose un retrait — pas un message d'erreur.
 */
const canRequest = computed(() => (member.value ? canRequestLicense(member.value) : false))

/** Message FR à afficher sous le CTA quand le gate bloque la demande. */
const gateReason = computed(() =>
  member.value ? licenseGateReason(member.value) : null,
)

function openLicenseDialog(): void {
  // Si déjà licencié → on autorise toujours l'ouverture (cas "retrait").
  // Sinon, on n'ouvre que si le gate cotisation passe.
  if (!isLicensed.value && !canRequest.value) return
  licenseDialogOpen.value = true
}

function closeLicenseDialog(): void {
  licenseDialogOpen.value = false
}

function confirmLicenseAction(): void {
  if (!member.value) return
  const kind: 'request' | 'withdraw' = isLicensed.value ? 'withdraw' : 'request'

  if (kind === 'request') {
    // Garde-fou (le CTA est déjà disabled, mais on évite l'appel en cas de
    // race ou de deep-link forçant l'ouverture).
    if (!canRequest.value) {
      licenseDialogOpen.value = false
      return
    }
    // Le store logge + console.info du faux email parent (pas besoin de
    // doubler avec un logMockAction ici).
    const requiredDocs = inferRequiredDocs(member.value)
    licenseRequestsStore.create({
      memberId: member.value.id,
      teamId: member.value.teamIds[0],
      requiredDocs,
    })
    licenseDialogOpen.value = false
    showToast('Demande envoyée. Le parent recevra un email.', 'emerald')
    return
  }

  // Retrait — pas de fixture côté shared-types (out-of-scope mock).
  logMockAction('co4.license-withdraw', { memberId: memberId.value })
  licenseDialogOpen.value = false
  showToast(
    'Demande de retrait envoyée — en attente de validation admin.',
    'emerald',
  )
}

// ────────────────────────────────────────────────────────────────
// Deep-link `?action=request-license` — ouvre auto le dialog
// ────────────────────────────────────────────────────────────────
//
// Permet à `TeamRoster.vue` (kebab menu sur un joueur) de naviguer
// directement vers le dialog sans étape intermédiaire. On ne déclenche
// l'ouverture qu'à 2 conditions : member chargé ET gate cotisation OK.

onMounted(() => {
  if (route.query['action'] !== 'request-license') return
  if (!member.value) return
  if (!canRequest.value) return
  licenseDialogOpen.value = true
})

// ────────────────────────────────────────────────────────────────
// Dialog "Désactiver" (type-to-confirm)
// ────────────────────────────────────────────────────────────────

const deactivateDialogOpen = ref(false)
const deactivateConfirmText = ref('')
const deactivateError = ref('')
const DEACTIVATE_CONFIRM_KEYWORD = 'désactiver'

function openDeactivateDialog(): void {
  deactivateConfirmText.value = ''
  deactivateError.value = ''
  deactivateDialogOpen.value = true
  kebabOpen.value = false
}

function closeDeactivateDialog(): void {
  deactivateDialogOpen.value = false
}

function submitDeactivate(): void {
  if (!member.value) return
  if (
    deactivateConfirmText.value.trim().toLowerCase() !==
    DEACTIVATE_CONFIRM_KEYWORD
  ) {
    deactivateError.value = `Tapez "${DEACTIVATE_CONFIRM_KEYWORD}" pour confirmer.`
    return
  }
  logMockAction('co4.deactivate', { memberId: memberId.value })
  deactivateDialogOpen.value = false
  showToast('Joueur désactivé.', 'rose')
}

// ────────────────────────────────────────────────────────────────
// Kebab menu
// ────────────────────────────────────────────────────────────────

const kebabOpen = ref(false)

function toggleKebab(): void {
  kebabOpen.value = !kebabOpen.value
}

function closeKebab(): void {
  kebabOpen.value = false
}

// ────────────────────────────────────────────────────────────────
// Actions
// ────────────────────────────────────────────────────────────────

function goBack(): void {
  if (window.history.length > 1) {
    router.back()
  } else {
    void router.push({ name: 'home' })
  }
}

function goEdit(): void {
  if (!member.value) return
  logMockAction('co4.edit', { memberId: memberId.value })
  void router.push({ name: 'member-edit', params: { memberId: member.value.id } })
}
</script>

<template>
  <!-- ─── Cas erreur : membre introuvable ───────────────────── -->
  <CbMobileShell
    v-if="!member"
    title="Joueur introuvable"
    show-back
    @back="goBack"
  >
    <div class="cb-page">
      <CbEmptyState
        :icon="User"
        title="Joueur introuvable"
        body="Ce joueur n'existe pas ou n'est plus accessible."
      >
        <template #actions>
          <button type="button" class="cb-btn primary sm" @click="goBack">
            <ArrowLeft :size="16" /> Retour
          </button>
        </template>
      </CbEmptyState>
    </div>
  </CbMobileShell>

  <!-- ─── CO4 — Member detail (mobile) ──────────────────────── -->
  <CbMobileShell
    v-else
    :title="memberFullName"
    show-back
    @back="goBack"
  >
    <template #right>
      <button
        type="button"
        class="cb-iconbtn"
        aria-label="Plus d'options"
        @click="toggleKebab"
      >
        <MoreVertical :size="20" />
      </button>
    </template>

    <div class="cb-page" @click="closeKebab">
      <!-- En-tête centré : avatar + nom + sub + pills -->
      <div style="display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 8px 0 4px">
        <CbAvatar :name="memberFullName" :tone="memberAvatarTone" size="lg" />
        <div class="cb-h2">{{ memberFullName }}</div>
        <div class="cb-sub">{{ memberSubLine }}</div>
        <div style="display: flex; gap: 6px; margin-top: 4px">
          <CbPill v-if="duesBadge" :tone="duesBadge.tone" :dot="duesBadge.dot">
            {{ duesBadge.label }}
          </CbPill>
          <CbPill v-if="isLicensed" tone="emerald" dot>Licencié</CbPill>
          <CbPill v-else tone="slate">Non licencié</CbPill>
        </div>
      </div>

      <!-- Card identité : 2-col grid (Licence + AVS + Tuteurs) -->
      <div class="cb-card" style="padding: 14px">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; font-size: 13px">
          <div>
            <div class="cb-sub" style="font-size: 11px; text-transform: uppercase; letter-spacing: .05em">Licence</div>
            <div class="mono" style="font-weight: 600; margin-top: 2px">
              <span v-if="member.licenseNumber">#{{ member.licenseNumber.replace(/[^0-9]/g, '').slice(-5) || member.licenseNumber }}</span>
              <span v-else style="font-style: italic; font-weight: 500">—</span>
            </div>
          </div>
          <div>
            <div class="cb-sub" style="font-size: 11px; text-transform: uppercase; letter-spacing: .05em">AVS</div>
            <div class="mono" style="font-weight: 600; margin-top: 2px; display: flex; align-items: center; gap: 6px">
              {{ showAvs ? avsValue : avsMasked }}
              <button
                type="button"
                class="cb-eye-btn"
                :aria-label="showAvs ? 'Masquer AVS' : 'Voir AVS'"
                @click="toggleAvs"
              >
                <EyeOff v-if="showAvs" :size="14" color="var(--slate-400)" />
                <Eye v-else :size="14" color="var(--slate-400)" />
              </button>
            </div>
          </div>
          <div v-if="isMinor && guardians.length > 0" style="grid-column: 1 / -1">
            <div class="cb-sub" style="font-size: 11px; text-transform: uppercase; letter-spacing: .05em">Tuteurs</div>
            <div style="font-weight: 500; margin-top: 4px; display: flex; gap: 4px; flex-wrap: wrap">
              <CbPill v-for="g in guardians" :key="g.uid" tone="slate">
                {{ g.name }} · {{ g.relationship }}
              </CbPill>
            </div>
          </div>
        </div>
      </div>

      <!-- Section Cotisation -->
      <div>
        <div class="cb-section-label" style="padding: 0 0 6px">
          Cotisation 2025/26
        </div>
        <div class="cb-card" style="padding: 14px">
          <div style="display: flex; align-items: center; justify-content: space-between">
            <div>
              <div style="font-weight: 600">
                <span v-if="due">CHF {{ due.amount }}</span>
                <span v-else class="cb-sub" style="font-style: italic">Pas encore émise</span>
              </div>
              <div v-if="duesSubLine" class="cb-sub">{{ duesSubLine }}</div>
            </div>
            <CbPill v-if="duesBadge" :tone="duesBadge.tone" :dot="duesBadge.dot">
              {{ duesBadge.label }}
            </CbPill>
          </div>

          <CbBanner
            v-if="member.duesStatus === 'excepted'"
            tone="sky"
            class="co4-banner-violet"
            style="margin-top: 10px"
          >
            <template #icon>
              <Info :size="16" />
            </template>
            Demande soumise — en cours d'examen par l'admin.
          </CbBanner>

          <button
            v-if="member.duesStatus === 'excluded'"
            type="button"
            class="cb-btn outline danger"
            style="margin-top: 10px; width: 100%"
            @click="openExceptionDialog"
          >
            <AlertTriangle :size="16" /> Soumettre une demande d'exception
          </button>
        </div>
      </div>

      <!-- Section Licence -->
      <div>
        <div class="cb-section-label" style="padding: 0 0 6px">Licence</div>
        <div
          class="cb-card"
          style="padding: 14px"
        >
          <div
            style="display: flex; align-items: center; justify-content: space-between; gap: 12px"
          >
            <div style="min-width: 0">
              <div style="font-weight: 600; display: flex; align-items: center; gap: 6px; flex-wrap: wrap">
                <span v-if="isLicensed">Licencié</span>
                <span v-else>Non licencié</span>
                <CbPill v-if="isLicensed" tone="emerald" dot>
                  <span class="mono">#{{ member.licenseNumber }}</span>
                </CbPill>
              </div>
              <div class="cb-sub" style="margin-top: 2px">
                <template v-if="isLicensed">Émise le 12.09.2024</template>
                <template v-else>Le joueur ne peut pas jouer en compétition.</template>
              </div>
            </div>
            <button
              type="button"
              class="cb-btn ghost sm"
              style="flex-shrink: 0"
              :disabled="!isLicensed && !canRequest"
              :title="!isLicensed && gateReason ? gateReason : undefined"
              @click="openLicenseDialog"
            >
              <span v-if="isLicensed">Demander retrait</span>
              <span v-else>Demander licence</span>
            </button>
          </div>
          <!-- Helper text : explicite pourquoi le CTA est désactivé. -->
          <p
            v-if="!isLicensed && gateReason"
            class="cb-sub"
            style="margin-top: 8px; font-size: 12px; line-height: 1.45; color: var(--rose-700)"
          >
            {{ gateReason }}
          </p>
        </div>
      </div>

      <!-- Section Présences saison -->
      <div>
        <div class="cb-section-label" style="padding: 0 0 6px">
          Présences saison
        </div>
        <button
          type="button"
          class="cb-card co4-attendance-row"
          style="padding: 14px; display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; background: var(--bg); border: 1px solid var(--border); cursor: pointer"
          @click="seeAttendance"
        >
          <div style="display: flex; gap: 12px; flex: 1">
            <div>
              <div class="cb-sub" style="font-size: 11px">Présent</div>
              <div style="font-weight: 700; font-size: 20px; color: var(--emerald-700)">
                {{ attendanceSummary.present }}
              </div>
            </div>
            <div>
              <div class="cb-sub" style="font-size: 11px">Absent</div>
              <div style="font-weight: 700; font-size: 20px; color: var(--rose-700)">
                {{ attendanceSummary.absent }}
              </div>
            </div>
            <div>
              <div class="cb-sub" style="font-size: 11px">Excusé</div>
              <div style="font-weight: 700; font-size: 20px; color: var(--amber-700)">
                {{ attendanceSummary.excused }}
              </div>
            </div>
          </div>
          <ChevronRight :size="18" color="var(--slate-400)" />
        </button>
      </div>
    </div>

    <!-- Kebab dropdown -->
    <div v-if="kebabOpen" class="co4-kebab-menu" @click.stop>
      <button
        type="button"
        class="co4-kebab-item danger"
        @click="openDeactivateDialog"
      >
        <X :size="16" /> Désactiver le joueur
      </button>
    </div>

    <!-- Sticky bottom CTAs -->
    <CbBottomBar>
      <button
        type="button"
        class="cb-btn outline"
        style="flex: 1"
        @click="goEdit"
      >
        <Edit :size="16" /> Éditer
      </button>
      <button
        type="button"
        class="cb-btn primary"
        style="flex: 1"
        @click="seeAttendance"
      >
        Voir présences
      </button>
    </CbBottomBar>
  </CbMobileShell>

  <!-- ─── Dialog Exception cotisation ─────────────────────────── -->
  <Teleport to="body">
    <div
      v-if="exceptionDialogOpen"
      class="co4-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      :aria-label="`Demande d'exception cotisation pour ${memberFullName}`"
      @click.self="closeExceptionDialog"
    >
      <div class="co4-dialog">
        <div class="co4-dialog-head">
          <h2 class="cb-h2">Exception cotisation — {{ member?.firstName ?? '' }}</h2>
          <button
            type="button"
            class="cb-iconbtn"
            aria-label="Fermer"
            @click="closeExceptionDialog"
          >
            <X :size="18" />
          </button>
        </div>
        <div class="co4-dialog-body">
          <p class="cb-sub" style="margin-bottom: 14px">
            Soumettez une demande d'exception pour que ce joueur puisse
            continuer à s'entraîner pendant que sa cotisation est régularisée.
            L'admin examinera votre demande.
          </p>
          <label class="co4-dialog-label" for="co4-exception-motivation">
            Motivation (obligatoire, 20 caractères minimum)
          </label>
          <textarea
            id="co4-exception-motivation"
            v-model="exceptionMotivation"
            class="co4-textarea"
            rows="5"
            placeholder="Ex. Famille en difficulté financière temporaire. Échéancier discuté avec la trésorière…"
            :aria-invalid="exceptionError ? 'true' : 'false'"
          />
          <p v-if="exceptionError" class="co4-error">{{ exceptionError }}</p>
        </div>
        <div class="co4-dialog-actions">
          <button type="button" class="cb-btn ghost" @click="closeExceptionDialog">
            Annuler
          </button>
          <button type="button" class="cb-btn primary" @click="submitException">
            <CheckCircle2 :size="16" /> Soumettre la demande
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ─── Dialog Licence (request / withdraw) ─────────────────── -->
  <Teleport to="body">
    <div
      v-if="licenseDialogOpen"
      class="co4-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Confirmation demande de licence"
      @click.self="closeLicenseDialog"
    >
      <div class="co4-dialog">
        <div class="co4-dialog-head">
          <h2 class="cb-h2">
            <span v-if="isLicensed">Retrait de licence</span>
            <span v-else>Demande de licence</span>
          </h2>
          <button
            type="button"
            class="cb-iconbtn"
            aria-label="Fermer"
            @click="closeLicenseDialog"
          >
            <X :size="18" />
          </button>
        </div>
        <div class="co4-dialog-body">
          <p style="font-size: 13px; line-height: 1.55">
            <template v-if="isLicensed">
              Vous allez soumettre une demande de retrait de la licence
              <strong class="mono">#{{ member?.licenseNumber }}</strong> pour
              <strong>{{ memberFullName }}</strong>. L'admin examinera votre demande
              avant transmission à la fédération.
            </template>
            <template v-else>
              Vous allez soumettre une demande de licence fédérale pour
              <strong>{{ memberFullName }}</strong>. L'admin du club validera la
              demande et transmettra le dossier à la fédération.
            </template>
          </p>
        </div>
        <div class="co4-dialog-actions">
          <button type="button" class="cb-btn ghost" @click="closeLicenseDialog">
            Annuler
          </button>
          <button type="button" class="cb-btn primary" @click="confirmLicenseAction">
            <CheckCircle2 :size="16" />
            <span v-if="isLicensed">Confirmer le retrait</span>
            <span v-else>Soumettre la demande</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ─── Dialog Désactiver (type-to-confirm) ─────────────────── -->
  <Teleport to="body">
    <div
      v-if="deactivateDialogOpen"
      class="co4-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      :aria-label="`Désactiver ${memberFullName}`"
      @click.self="closeDeactivateDialog"
    >
      <div class="co4-dialog">
        <div class="co4-dialog-head">
          <h2 class="cb-h2">Désactiver le joueur</h2>
          <button
            type="button"
            class="cb-iconbtn"
            aria-label="Fermer"
            @click="closeDeactivateDialog"
          >
            <X :size="18" />
          </button>
        </div>
        <div class="co4-dialog-body">
          <p style="font-size: 13px; line-height: 1.55; margin-bottom: 14px">
            Vous allez désactiver <strong>{{ memberFullName }}</strong>. Le joueur
            ne pourra plus accéder à l'app du club. Cette action peut être annulée
            par un admin.
          </p>
          <label class="co4-dialog-label" for="co4-deactivate-confirm">
            Tapez "{{ DEACTIVATE_CONFIRM_KEYWORD }}" pour confirmer
          </label>
          <input
            id="co4-deactivate-confirm"
            v-model="deactivateConfirmText"
            type="text"
            class="co4-input"
            autocomplete="off"
            :aria-invalid="deactivateError ? 'true' : 'false'"
            :placeholder="DEACTIVATE_CONFIRM_KEYWORD"
          />
          <p v-if="deactivateError" class="co4-error">{{ deactivateError }}</p>
        </div>
        <div class="co4-dialog-actions">
          <button type="button" class="cb-btn ghost" @click="closeDeactivateDialog">
            Annuler
          </button>
          <button type="button" class="cb-btn danger" @click="submitDeactivate">
            <X :size="16" /> Désactiver
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ─── Toast (emerald / amber / rose) ──────────────────────── -->
  <Teleport to="body">
    <div
      v-if="toastVisible"
      class="cb-toast"
      :class="toastTone"
      role="status"
      aria-live="polite"
      @click="dismissToast"
    >
      <CheckCircle2 v-if="toastTone === 'emerald'" :size="18" />
      <AlertTriangle v-else-if="toastTone === 'amber'" :size="18" />
      <X v-else :size="18" />
      <span style="flex: 1">{{ toastMessage }}</span>
    </div>
  </Teleport>
</template>

<style scoped>
/* Banner violet : CbBanner ne supporte que amber/sky/rose/emerald, on
   override la couleur pour matcher le `Banner tone="violet"` du JSX. */
.co4-banner-violet {
  background: var(--violet-50, rgba(139, 92, 246, 0.08));
  border-color: var(--violet-200, rgba(139, 92, 246, 0.25));
  color: var(--violet-700, #6d28d9);
}

/* AVS eye toggle button. */
.cb-eye-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 0;
  background: transparent;
  cursor: pointer;
  padding: 0;
}
.cb-eye-btn:hover {
  background: var(--slate-50);
}

.co4-attendance-row:hover {
  background: var(--slate-50);
}

/* Kebab dropdown (fixed pour overlay au-dessus du shell). */
.co4-kebab-menu {
  position: fixed;
  top: 56px;
  right: 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow-md, 0 8px 24px rgba(15, 23, 42, 0.12));
  padding: 4px;
  min-width: 220px;
  z-index: 70;
}
.co4-kebab-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  width: 100%;
  background: transparent;
  border: 0;
  border-radius: 6px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  cursor: pointer;
  text-align: left;
}
.co4-kebab-item:hover {
  background: var(--slate-50);
}
.co4-kebab-item.danger {
  color: var(--rose-600);
}
.co4-kebab-item.danger:hover {
  background: var(--rose-50, rgba(244, 63, 94, 0.08));
}

/* ─── Dialogs (exception / licence / désactiver) ──────────── */
.co4-dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 1000;
}
.co4-dialog {
  background: var(--bg);
  border-radius: 16px;
  box-shadow: var(--shadow-lg, 0 20px 40px rgba(0, 0, 0, 0.18));
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.co4-dialog-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border);
}
.co4-dialog-body {
  padding: 18px;
}
.co4-dialog-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-subtle);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.co4-textarea {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  font: inherit;
  font-size: 13px;
  resize: vertical;
  background: var(--bg);
  color: var(--text);
  outline: none;
}
.co4-textarea:focus {
  border-color: var(--emerald-500, var(--slate-700));
  box-shadow: 0 0 0 3px var(--emerald-100, rgba(16, 185, 129, 0.15));
}
.co4-textarea[aria-invalid='true'] {
  border-color: var(--rose-500);
}
.co4-input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  font: inherit;
  font-size: 13px;
  background: var(--bg);
  color: var(--text);
  outline: none;
}
.co4-input:focus {
  border-color: var(--rose-500);
  box-shadow: 0 0 0 3px rgba(244, 63, 94, 0.12);
}
.co4-input[aria-invalid='true'] {
  border-color: var(--rose-500);
}
.co4-error {
  color: var(--rose-600);
  font-size: 12px;
  margin-top: 6px;
}
.co4-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 18px 18px;
  border-top: 1px solid var(--border);
  background: var(--slate-50, var(--bg));
}
</style>
