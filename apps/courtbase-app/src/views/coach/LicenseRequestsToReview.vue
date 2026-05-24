<script setup lang="ts">
/**
 * Vue coach — Liste "Demandes de licence à valider" (PR2 UI).
 *
 * Liste les `/licenseRequests` :
 *  - `status === 'parent_docs_submitted'`
 *  - `teamId ∈ user.teamIds` (scope coach)
 *
 * Click sur une card → vue détail `license-request-review` pour valider /
 * refuser doc par doc.
 *
 * Hybride mock + Firestore réel — la liste vient de
 * `useLicenseRequestsStore.pendingReviewList` (cf. store).
 *
 * Architecture en couches : ce composant n'importe JAMAIS Firestore ; toute
 * la donnée vient de Pinia.
 */
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronRight, FileCheck, Inbox } from 'lucide-vue-next'

import CbAvatar from '@/components/ui/CbAvatar.vue'
import CbDesktopShell from '@/components/ui/CbDesktopShell.vue'
import CbEmptyState from '@/components/ui/CbEmptyState.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbPageHead from '@/components/ui/CbPageHead.vue'
import CbPill from '@/components/ui/CbPill.vue'
import { useShellNav } from '@/composables/useShellNav'
import { useViewport } from '@/composables/useViewport'
import { useAuthStore } from '@/stores/auth'
import { useLicenseRequestsStore } from '@/stores/licenseRequests'
import { useTeamsStore } from '@/stores/teams'
import type { LicenseRequest } from '@club-app/shared-types'

const router = useRouter()
const auth = useAuthStore()
const teamsStore = useTeamsStore()
const licenseRequestsStore = useLicenseRequestsStore()
const { isDesktop } = useViewport()
const { tabs, nav, primaryRoleLabel } = useShellNav()

// ─── Chargement ───────────────────────────────────────────────────
onMounted(async () => {
  // S'assurer que les teams du coach sont chargées (scope pour la query).
  if (teamsStore.teams.length === 0) {
    await teamsStore.loadForCoach(auth.userDoc?.memberId ?? null, auth.uid)
  }
  await licenseRequestsStore.loadPendingReviewForCoach()
})

const list = computed<ReadonlyArray<LicenseRequest>>(
  () => licenseRequestsStore.pendingReviewList,
)

const loading = computed(() => licenseRequestsStore.pendingReviewLoading)

// ─── Helpers UI ──────────────────────────────────────────────────
function memberFullName(lr: LicenseRequest): string {
  if (lr.denorm) return `${lr.denorm.memberFirstName} ${lr.denorm.memberLastName}`
  return 'Joueur'
}

function teamLabel(lr: LicenseRequest): string {
  return lr.denorm?.teamName ?? 'Équipe inconnue'
}

function tsToMs(ts: unknown): number {
  if (!ts) return 0
  const t = ts as { seconds?: number; toMillis?: () => number }
  if (typeof t.toMillis === 'function') return t.toMillis()
  if (typeof t.seconds === 'number') return t.seconds * 1000
  return 0
}

const RELATIVE_DATE_FMT = new Intl.RelativeTimeFormat('fr-CH', { numeric: 'auto' })

/** "il y a 3 jours", "aujourd'hui", "il y a 1 mois"... */
function relativeFromMs(ms: number): string {
  if (!ms) return ''
  const diffMs = ms - Date.now()
  const diffDays = Math.round(diffMs / 86_400_000)
  if (Math.abs(diffDays) >= 30) {
    const months = Math.round(diffDays / 30)
    return RELATIVE_DATE_FMT.format(months, 'month')
  }
  if (Math.abs(diffDays) >= 1) return RELATIVE_DATE_FMT.format(diffDays, 'day')
  const diffHours = Math.round(diffMs / 3_600_000)
  if (Math.abs(diffHours) >= 1) return RELATIVE_DATE_FMT.format(diffHours, 'hour')
  return 'à l\'instant'
}

function uploadedAtLabel(lr: LicenseRequest): string {
  const completed = tsToMs(lr.parentCompletedAt)
  if (!completed) return ''
  return `soumis ${relativeFromMs(completed)}`
}

function docCountLabel(lr: LicenseRequest): string {
  const n = lr.requiredDocs.length
  return n === 1 ? '1 document' : `${n} documents`
}

// ─── Navigation ──────────────────────────────────────────────────
function openDetail(lr: LicenseRequest): void {
  router
    .push({ name: 'license-request-review', params: { requestId: lr.id } })
    .catch((err) => {
      console.warn('[license-requests.open-detail] navigation failed', err)
    })
}

function goBack(): void {
  router.push({ name: 'home' })
}
</script>

<template>
  <!-- Desktop shell (≥1024px) ─────────────────────────────────── -->
  <CbDesktopShell
    v-if="isDesktop"
    :items="nav"
    brand-name="BC Aigles"
    brand-sub="Saison 2025/26"
    club-initials="BCA"
    :user-name="auth.displayName"
    :user-role="primaryRoleLabel"
  >
    <CbPageHead
      title="Demandes à valider"
      subtitle="Demandes de licence avec documents soumis par le parent — à valider doc par doc."
    />

    <div
      style="
        flex: 1;
        overflow: auto;
        padding: 20px 28px 32px;
        max-width: 720px;
        margin: 0 auto;
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 12px;
      "
    >
      <CbEmptyState
        v-if="!loading && list.length === 0"
        :icon="Inbox"
        title="Aucune demande à valider"
        body="Les demandes de licence dont le parent a soumis les pièces apparaîtront ici."
      />

      <div
        v-for="lr in list"
        :key="lr.id"
        class="cb-card cb-lr-card"
        role="button"
        tabindex="0"
        @click="openDetail(lr)"
        @keyup.enter="openDetail(lr)"
      >
        <div style="display: flex; gap: 12px; align-items: center">
          <CbAvatar :name="memberFullName(lr)" tone="amber" />
          <div style="flex: 1; min-width: 0">
            <div style="font-weight: 600">{{ memberFullName(lr) }}</div>
            <div class="cb-sub">
              {{ teamLabel(lr) }} · {{ docCountLabel(lr) }}
              <template v-if="uploadedAtLabel(lr)"> · {{ uploadedAtLabel(lr) }}</template>
            </div>
          </div>
          <CbPill tone="amber" dot>À valider</CbPill>
          <ChevronRight :size="18" color="var(--slate-400)" />
        </div>
      </div>
    </div>
  </CbDesktopShell>

  <!-- Mobile shell (< 1024px) ────────────────────────────────── -->
  <CbMobileShell
    v-else
    title="Demandes à valider"
    club="BCA"
    show-back
    :tabs="tabs"
    @back="goBack"
  >
    <div
      style="
        flex: 1;
        overflow: auto;
        padding: 12px 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      "
    >
      <CbEmptyState
        v-if="!loading && list.length === 0"
        :icon="FileCheck"
        title="Aucune demande à valider"
        body="Les demandes de licence dont le parent a soumis les pièces apparaîtront ici."
      />

      <div
        v-for="lr in list"
        :key="lr.id"
        class="cb-card cb-lr-card"
        role="button"
        tabindex="0"
        @click="openDetail(lr)"
        @keyup.enter="openDetail(lr)"
      >
        <div style="display: flex; gap: 12px; align-items: center; padding: 14px">
          <CbAvatar :name="memberFullName(lr)" tone="amber" />
          <div style="flex: 1; min-width: 0">
            <div style="font-weight: 600">{{ memberFullName(lr) }}</div>
            <div class="cb-sub">
              {{ teamLabel(lr) }} · {{ docCountLabel(lr) }}
            </div>
            <div v-if="uploadedAtLabel(lr)" class="cb-sub" style="margin-top: 2px">
              {{ uploadedAtLabel(lr) }}
            </div>
          </div>
          <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 6px">
            <CbPill tone="amber" dot>À valider</CbPill>
            <ChevronRight :size="18" color="var(--slate-400)" />
          </div>
        </div>
      </div>
    </div>
  </CbMobileShell>
</template>

<style scoped>
.cb-lr-card {
  cursor: pointer;
  border-left: 4px solid var(--amber-500, #f59e0b);
  padding: 0;
}
.cb-lr-card:hover {
  background: var(--slate-50, var(--bg));
}
</style>
