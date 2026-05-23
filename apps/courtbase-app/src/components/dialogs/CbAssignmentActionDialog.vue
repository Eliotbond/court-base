<script setup lang="ts">
import { computed, defineComponent, h, nextTick, ref, watch } from 'vue'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-vue-next'

import CbBanner from '@/components/ui/CbBanner.vue'
import CbBottomBar from '@/components/ui/CbBottomBar.vue'
import CbMatchTypeChip from '@/components/ui/CbMatchTypeChip.vue'
import CbPill from '@/components/ui/CbPill.vue'

/**
 * O4 — Dialog confirm / decline pour une assignation officiel.
 *
 * Modal fullscreen sur mobile (≤1023px) et dialog centré 480px sur
 * desktop (≥1024px). Implémentation custom via `<Teleport to="body">` +
 * `position: fixed; inset: 0` pour rester fidèle au pattern
 * `.cb-mobile-body.plain` du design (cf. `docs/design-brief-courtbase-app.md`
 * § S9 + § 4 O4).
 *
 * Le composant n'effectue **aucune** action Firebase — il émet `submit`
 * (avec un éventuel `reason` en mode `decline`) et laisse l'appelant
 * gérer le callable + toast + navigation retour.
 */

export interface CbAssignmentMatchSummary {
  /** Date courte humaine (ex. "Sa 18 oct."). */
  dateLabel: string
  /** Heure "HH:mm". */
  time: string
  /** Nom de l'équipe adverse. */
  opponent: string
  /** Lieu ("Centre sportif · Court A" ou adresse libre pour away). */
  venueLabel: string
  /** Code MatchType (ex. "CSJC", "AFBB", "Amical"). */
  type: string
  /** Rôle officiel optionnel (ex. "Marqueur", "Chronométreur"). */
  role?: string
}

const props = defineProps<{
  visible: boolean
  mode: 'confirm' | 'decline'
  matchSummary: CbAssignmentMatchSummary
  /** Désactive le CTA principal (ex. envoi en cours côté appelant). */
  submitting?: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  submit: [reason?: string]
  cancel: []
}>()

const reason = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)

const titleText = computed(() =>
  props.mode === 'confirm' ? 'Confirmer ma présence' : "Décliner l'assignation",
)
const ctaText = computed(() =>
  props.mode === 'confirm' ? 'Confirmer ma présence' : 'Confirmer le refus',
)
const ctaClass = computed(() => (props.mode === 'confirm' ? 'primary' : 'danger'))

watch(
  () => props.visible,
  async (v) => {
    if (v) {
      reason.value = ''
      if (props.mode === 'decline') {
        await nextTick()
        textareaRef.value?.focus()
      }
    }
  },
)

function close() {
  emit('update:visible', false)
  emit('cancel')
}

function handleSubmit() {
  if (props.submitting) return
  if (props.mode === 'decline') {
    const trimmed = reason.value.trim()
    emit('submit', trimmed.length > 0 ? trimmed : undefined)
  } else {
    emit('submit')
  }
}

function onBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) close()
}

/**
 * Petit helper local pour afficher un rôle officiel (Marqueur, Chrono…)
 * en pill violette, fidèle au mock O4. Pas extrait en composant partagé
 * car usage isolé à ce dialog.
 */
const CbPillRole = defineComponent({
  name: 'CbPillRole',
  props: { label: { type: String, required: true } },
  setup(roleProps) {
    return () => h(CbPill, { tone: 'violet' }, { default: () => roleProps.label })
  },
})
</script>

<template>
  <Teleport to="body">
    <transition name="cb-dlg">
      <div
        v-if="visible"
        class="cb-dlg-root"
        :class="`mode-${mode}`"
        role="dialog"
        aria-modal="true"
        :aria-label="titleText"
        @click="onBackdropClick"
      >
        <div class="cb-dlg-panel" @click.stop>
          <!-- Header -->
          <div class="cb-header">
            <div class="left">
              <button
                type="button"
                class="cb-iconbtn"
                aria-label="Fermer"
                @click="close"
              >
                <X :size="20" />
              </button>
            </div>
            <div class="title">{{ titleText }}</div>
            <div class="right" />
          </div>

          <!-- Body -->
          <div class="cb-dlg-body">
            <div class="cb-page">
              <!-- Banner d'info -->
              <CbBanner
                v-if="mode === 'confirm'"
                tone="sky"
                title="Rappel automatique"
              >
                <template #icon><Info :size="18" /></template>
                Vous recevrez un push J-1 à 23:00 et H-2 avant le match.
              </CbBanner>
              <CbBanner
                v-else
                tone="rose"
                title="L'admin sera notifié"
              >
                <template #icon><AlertTriangle :size="18" /></template>
                Le club pourra rechercher un remplaçant pour ce créneau.
              </CbBanner>

              <!-- Récap match -->
              <div v-if="mode === 'confirm'" class="cb-card recap">
                <div class="cb-h1 date">{{ matchSummary.dateLabel }}</div>
                <div class="mono time">{{ matchSummary.time }}</div>
                <div class="opponent">{{ matchSummary.opponent }}</div>
                <div class="cb-sub venue">{{ matchSummary.venueLabel }}</div>
                <div class="chips">
                  <CbMatchTypeChip :type="matchSummary.type" />
                  <CbPillRole v-if="matchSummary.role" :label="matchSummary.role" />
                </div>
              </div>

              <!-- Récap compact (mode decline) -->
              <div v-else class="cb-card recap-compact">
                <div class="mono when">
                  {{ matchSummary.dateLabel }} · {{ matchSummary.time }}
                </div>
                <div class="opponent">{{ matchSummary.opponent }}</div>
                <div class="cb-sub venue">{{ matchSummary.venueLabel }}</div>
                <div class="chips">
                  <CbMatchTypeChip :type="matchSummary.type" />
                  <CbPillRole v-if="matchSummary.role" :label="matchSummary.role" />
                </div>
              </div>

              <!-- Champ motif (mode decline) -->
              <div v-if="mode === 'decline'" class="cb-field">
                <label for="cb-decline-reason">Motif (optionnel)</label>
                <textarea
                  id="cb-decline-reason"
                  ref="textareaRef"
                  v-model="reason"
                  class="cb-input"
                  rows="4"
                  maxlength="500"
                  placeholder="Indisponible, autre engagement, etc."
                />
                <div class="cb-sub helper">
                  Le motif est partagé avec l'admin pour aider à trouver un remplaçant.
                </div>
              </div>
            </div>
          </div>

          <!-- Sticky CTAs -->
          <CbBottomBar>
            <button
              type="button"
              class="cb-btn outline"
              style="flex: 1"
              :disabled="submitting"
              @click="close"
            >
              Annuler
            </button>
            <button
              type="button"
              class="cb-btn"
              :class="ctaClass"
              style="flex: 2"
              :disabled="submitting"
              @click="handleSubmit"
            >
              <CheckCircle2 v-if="mode === 'confirm'" :size="16" />
              {{ ctaText }}
            </button>
          </CbBottomBar>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.cb-dlg-root {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  background: rgba(15, 23, 42, 0.45); /* slate-900 / 45% */
}

/* Mobile : fullscreen */
.cb-dlg-panel {
  position: relative;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.cb-dlg-body {
  flex: 1;
  overflow: auto;
  background: var(--bg);
}

/* Desktop : centré, 480px max, hauteur auto, coins arrondis */
@media (min-width: 1024px) {
  .cb-dlg-root {
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .cb-dlg-panel {
    width: 480px;
    max-width: 100%;
    height: auto;
    max-height: calc(100vh - 48px);
    border-radius: 16px;
    box-shadow: var(--shadow-lg, 0 20px 50px rgba(15, 23, 42, 0.25));
  }
  .cb-dlg-panel :deep(.cb-header) {
    border-radius: 16px 16px 0 0;
  }
  .cb-dlg-panel :deep(.cb-bottom-bar) {
    border-radius: 0 0 16px 16px;
    padding-bottom: 12px; /* pas de safe-area sur desktop */
  }
}

/* Recap card — mode confirm (large) */
.recap { padding: 16px; }
.recap .date { font-size: 22px; }
.recap .time {
  font-size: 16px;
  font-weight: 600;
  color: var(--slate-700);
  margin-top: 2px;
}
.recap .opponent {
  margin-top: 10px;
  font-size: 15px;
  font-weight: 600;
}
.recap .venue { margin-top: 4px; }
.recap .chips { margin-top: 12px; display: flex; gap: 6px; flex-wrap: wrap; }

/* Recap card — mode decline (compact) */
.recap-compact { padding: 12px; }
.recap-compact .when { font-weight: 700; font-size: 13px; }
.recap-compact .opponent { margin-top: 4px; font-weight: 600; }
.recap-compact .venue { margin-top: 2px; }
.recap-compact .chips { margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap; }

/* Helper sous la textarea */
.cb-field .helper { margin-top: 2px; font-size: 12px; }

/* Transition fade + slide léger sur mobile */
.cb-dlg-enter-active,
.cb-dlg-leave-active {
  transition: opacity 180ms ease;
}
.cb-dlg-enter-active .cb-dlg-panel,
.cb-dlg-leave-active .cb-dlg-panel {
  transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.cb-dlg-enter-from,
.cb-dlg-leave-to {
  opacity: 0;
}
.cb-dlg-enter-from .cb-dlg-panel,
.cb-dlg-leave-to .cb-dlg-panel {
  transform: translateY(16px);
}
@media (min-width: 1024px) {
  .cb-dlg-enter-from .cb-dlg-panel,
  .cb-dlg-leave-to .cb-dlg-panel {
    transform: translateY(0) scale(0.96);
  }
}
</style>

<!--
Exemple d'usage depuis une vue (O2 / O3) :

<script setup lang="ts">
import { ref } from 'vue'
import CbAssignmentActionDialog from '@/components/dialogs/CbAssignmentActionDialog.vue'

const dialogOpen = ref(false)
const dialogMode = ref<'confirm' | 'decline'>('decline')

function openDecline() {
  dialogMode.value = 'decline'
  dialogOpen.value = true
}

function openConfirm() {
  dialogMode.value = 'confirm'
  dialogOpen.value = true
}

function onSubmit(reason?: string) {
  logMockAction('o4.' + dialogMode.value, { reason })
  dialogOpen.value = false
}
</script>

<template>
  <CbAssignmentActionDialog
    v-model:visible="dialogOpen"
    :mode="dialogMode"
    :match-summary="{
      dateLabel: 'Sa 18 oct.',
      time: '14:30',
      opponent: 'Pully BC U16M',
      venueLabel: 'Centre sportif · Court A',
      type: 'CSJC',
      role: 'Marqueur',
    }"
    @submit="onSubmit"
  />
</template>
-->
