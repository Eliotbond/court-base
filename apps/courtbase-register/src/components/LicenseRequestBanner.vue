<script setup lang="ts">
/**
 * Banner sticky en tête de Home — liste les demandes de licence à compléter
 * pour les membres du parent. Tap sur une ligne → navigation vers le
 * formulaire dédié `LicenseRequestForm.vue`.
 *
 * Affiché uniquement si `requests.length > 0` (le parent décide via `v-if`).
 * On garde la liste à l'intérieur d'une card unique : visuellement plus calme
 * qu'un banner par membre quand 3-4 demandes coexistent (cas démo).
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronRight, FileSignature } from 'lucide-vue-next'
import type { LicenseRequestMock } from '@club-app/shared-types'

const props = defineProps<{
  requests: LicenseRequestMock[]
}>()

const router = useRouter()

const count = computed(() => props.requests.length)

function openRequest(requestId: string): void {
  void router.push({ name: 'license-request', params: { requestId } })
}

function subLine(req: LicenseRequestMock): string {
  const docsLabel =
    req.requiredDocs.length === 1
      ? '1 document requis'
      : `${req.requiredDocs.length} documents requis`
  return `${req.denorm.teamName} · ${docsLabel}`
}
</script>

<template>
  <div class="card lrb">
    <div class="lrb__head">
      <div class="lrb__head-ic">
        <FileSignature :size="16" />
      </div>
      <div class="lrb__head-text">
        <div class="lrb__title">Demandes de licence ({{ count }})</div>
        <div class="lrb__sub">
          Documents à fournir pour finaliser la licence fédérale.
        </div>
      </div>
    </div>

    <button
      v-for="req in requests"
      :key="req.id"
      type="button"
      class="lrb__row"
      :aria-label="`Compléter la demande pour ${req.denorm.memberFirstName} ${req.denorm.memberLastName}`"
      @click="openRequest(req.id)"
    >
      <div class="avatar lrb__row-avatar">
        {{ (req.denorm.memberFirstName.charAt(0) + req.denorm.memberLastName.charAt(0)).toUpperCase() }}
      </div>
      <div class="lrb__row-body">
        <div class="lrb__row-name">
          {{ req.denorm.memberFirstName }} {{ req.denorm.memberLastName }}
        </div>
        <div class="lrb__row-sub">
          {{ subLine(req) }}
        </div>
      </div>
      <ChevronRight :size="16" class="lrb__row-chev" />
    </button>
  </div>
</template>

<style scoped>
.lrb {
  padding: 14px;
  margin-top: 16px;
  border-color: #fcd34d;
  background: linear-gradient(180deg, #fffbeb 0%, #ffffff 70%);
}
.lrb__head {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin-bottom: 10px;
}
.lrb__head-ic {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: #fef3c7;
  color: #b45309;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.lrb__head-text {
  flex: 1;
  min-width: 0;
}
.lrb__title {
  font-size: 13.5px;
  font-weight: 600;
  color: #0f172a;
}
.lrb__sub {
  font-size: 11.5px;
  color: #78350f;
  margin-top: 2px;
  line-height: 1.4;
}
.lrb__row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 8px;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  border-radius: 8px;
  font-family: inherit;
  color: inherit;
}
.lrb__row + .lrb__row {
  border-top: 1px solid #fde68a;
  border-radius: 0;
}
.lrb__row:hover {
  background: rgba(254, 243, 199, 0.55);
}
.lrb__row-avatar {
  background: #fde68a;
  color: #92400e;
  flex: none;
}
.lrb__row-body {
  flex: 1;
  min-width: 0;
}
.lrb__row-name {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
}
.lrb__row-sub {
  font-size: 11.5px;
  color: #64748b;
  margin-top: 2px;
}
.lrb__row-chev {
  color: #b45309;
  flex: none;
}
</style>
