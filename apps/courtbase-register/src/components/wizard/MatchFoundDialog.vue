<script setup lang="ts">
import { computed } from 'vue'
import { Check, Info, ShieldAlert, UsersRound } from 'lucide-vue-next'
import type { MemberMatch } from '@/services/cloudFunctions'

/**
 * Modal de confirmation de doublon. Les `matches` proviennent de
 * `matchExistingMember`, qui ne retourne que des correspondances AVS exactes
 * (`matchedOn: 'avs' | 'licenseNumber'`) — donc toujours un match certain.
 *
 * Deux modes :
 *  - **normal** : le dossier trouvé n'est rattaché à aucun autre compte. Le
 *    user confirme le rattachement (« Oui, c'est la même personne ») ou indique
 *    qu'il s'agit de quelqu'un d'autre.
 *  - **bloqué** (`blocked`) : au moins un dossier trouvé est déjà rattaché à un
 *    autre compte (`linkedToOtherAccount`). Le rattachement self-service est
 *    refusé — on invite à contacter le club. Aucun bouton de confirmation, et
 *    pas d'option « quelqu'un d'autre » (l'AVS étant unique, créer un nouveau
 *    dossier produirait un doublon de la même personne).
 */
const props = defineProps<{
  matches: MemberMatch[]
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'confirm', memberId: string): void
  (e: 'reject'): void
  (e: 'close'): void
}>()

/**
 * `true` dès qu'un dossier candidat est déjà rattaché à un autre compte. On
 * bascule alors toute la modal en mode bloqué (conservateur : si l'un des
 * candidats est déjà pris, on ne propose aucun rattachement self-service).
 */
const blocked = computed(() => props.matches.some((m) => m.linkedToOtherAccount))

function formatBirth(iso: string): string {
  // YYYY-MM-DD → DD.MM.YYYY
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}.${m}.${y}`
}

function initials(m: MemberMatch): string {
  return ((m.firstName.charAt(0) ?? '') + (m.lastName.charAt(0) ?? '')).toUpperCase()
}

function onConfirm(memberId: string) {
  emit('confirm', memberId)
}

function onReject() {
  emit('reject')
}

function onClose() {
  emit('close')
}
</script>

<template>
  <div v-if="visible" class="match-overlay" role="dialog" aria-modal="true">
    <div class="match-sheet">
      <div class="match-grabber" />

      <!-- Mode bloqué : dossier déjà rattaché à un autre compte -->
      <template v-if="blocked">
        <div class="match-icon match-icon--blocked">
          <ShieldAlert :size="20" />
        </div>
        <h2 class="match-title">Ce dossier est déjà rattaché à un compte</h2>
        <p class="match-sub">
          Ce joueur figure déjà dans nos dossiers, associé à un autre compte.
        </p>

        <div
          v-for="m in matches"
          :key="m.memberId"
          class="card-flat match-card match-card--blocked"
        >
          <div class="match-card__head">
            <div class="avatar match-card__avatar">{{ initials(m) }}</div>
            <div class="match-card__body">
              <div class="match-card__name">{{ m.firstName }} {{ m.lastName }}</div>
              <div class="match-card__sub">Né(e) le {{ formatBirth(m.birthDateIso) }}</div>
            </div>
          </div>
        </div>

        <div class="banner banner-strong match-info" role="alert">
          <Info :size="14" />
          <span>
            Pour des raisons de sécurité, nous ne pouvons pas rattacher ce
            dossier automatiquement. Contactez directement le club pour finaliser
            l'inscription de ce joueur.
          </span>
        </div>

        <button
          type="button"
          class="btn btn-secondary match-reject"
          @click="onClose"
        >
          J'ai compris
        </button>
      </template>

      <!-- Mode normal : rattachement self-service possible -->
      <template v-else>
        <div class="match-icon">
          <UsersRound :size="20" />
        </div>
        <h2 class="match-title">Nous avons trouvé un dossier correspondant</h2>
        <p class="match-sub">Pour éviter les doublons, vérifions s'il s'agit de la même personne.</p>

        <div
          v-for="m in matches"
          :key="m.memberId"
          class="card-flat match-card"
        >
          <div class="match-card__head">
            <div class="avatar match-card__avatar">{{ initials(m) }}</div>
            <div class="match-card__body">
              <div class="match-card__name">{{ m.firstName }} {{ m.lastName }}</div>
              <div class="match-card__sub">Né(e) le {{ formatBirth(m.birthDateIso) }}</div>
            </div>
            <span class="pill pill-emerald">100% match</span>
          </div>
          <div class="match-card__actions">
            <button
              type="button"
              class="btn btn-primary match-card__confirm"
              @click="onConfirm(m.memberId)"
            >
              <Check :size="14" /> Oui, c'est la même personne
            </button>
          </div>
        </div>

        <div class="banner banner-soft match-info">
          <Info :size="14" />
          <span>Si c'est bien la même personne, nous allons rattacher cette inscription à son dossier existant — cela évite de créer un doublon.</span>
        </div>

        <button
          type="button"
          class="btn btn-secondary match-reject"
          @click="onReject"
        >
          Non, c'est quelqu'un d'autre
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.match-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 100;
  animation: fade-in 160ms ease-out;
}
.match-sheet {
  width: 100%;
  max-width: 480px;
  background: white;
  border-top-left-radius: 18px;
  border-top-right-radius: 18px;
  padding: 18px 20px calc(20px + env(safe-area-inset-bottom, 8px));
  max-height: 92dvh;
  overflow-y: auto;
  animation: slide-up 200ms ease-out;
}
.match-grabber {
  width: 38px;
  height: 4px;
  border-radius: 4px;
  background: #cbd5e1;
  margin: 0 auto 12px;
}
.match-icon {
  width: 40px;
  height: 40px;
  border-radius: 999px;
  background: #fffbeb;
  color: #b45309;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 12px;
}
/* Mode bloqué : pastille rouge (dossier déjà rattaché). */
.match-icon--blocked {
  background: #fef2f2;
  color: #b91c1c;
}
.match-title {
  text-align: center;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0;
}
.match-sub {
  text-align: center;
  font-size: 12.5px;
  color: #64748b;
  margin: 6px 8px 0;
  line-height: 1.5;
}
.match-card {
  margin-top: 14px;
  padding: 12px;
  border-color: #a7f3d0;
  background: #f0fdf4;
}
/* Mode bloqué : card neutre (pas de vert "rattachable"). */
.match-card--blocked {
  border-color: #e2e8f0;
  background: #f8fafc;
}
.match-card__head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.match-card__avatar {
  width: 44px;
  height: 44px;
  background: #d1fae5;
  color: #047857;
  font-size: 14px;
}
.match-card--blocked .match-card__avatar {
  background: #e2e8f0;
  color: #475569;
}
.match-card__body {
  flex: 1;
  min-width: 0;
}
.match-card__name {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
}
.match-card__sub {
  font-size: 11.5px;
  color: #64748b;
  margin-top: 2px;
}
.match-card__actions {
  margin-top: 12px;
}
.match-card__confirm {
  width: 100%;
  height: 42px;
}
.match-info {
  margin-top: 14px;
}
.match-reject {
  margin-top: 10px;
  width: 100%;
  height: 44px;
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes slide-up {
  from { transform: translateY(40px); }
  to { transform: translateY(0); }
}
</style>
